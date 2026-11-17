const ParentModel = require('../models/parent.model');
const { comparePassword, hashPassword } = require('../utils/password.util');
const { generateToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');
const PasscodeService = require('../services/passcode.service');

class ParentAuthController {
  /**
   * Helper to issue session cookie & JWT token for parent
   */
  static async _issueSession(parent, res, message = 'Parent authentication successful.') {
    const children = await ParentModel.getChildrenByParentId(parent.id, parent.school_id);
    const activeStudent = children.length > 0 ? children[0] : null;

    if (!parent.school_id) {
      return ApiResponse.error(res, 'Account configuration error: No school associated with this parent account.', null, 400);
    }

    const [sRows] = await pool.query('SELECT status FROM school_master WHERE id = ? LIMIT 1', [parent.school_id]);
    if (sRows.length > 0 && Number(sRows[0].status) !== 1) {
      return ApiResponse.error(res, 'Your school account has been marked inactive by the Super Admin. Login is disabled until reactivated.', null, 403);
    }
    const SubscriptionModel = require('../models/subscription.model');
    const sub = await SubscriptionModel.getSchoolSubscription(parent.school_id);
    if (sub && (sub.status === 'suspended' || sub.liveStatus === 'suspended')) {
      return ApiResponse.error(res, 'Your school subscription has been marked inactive / suspended by the Super Admin. Login is disabled until reactivated.', null, 403);
    }
    if (sub && (sub.liveStatus === 'pending' || (sub.status === 'pending' && !sub.isTrial))) {
      return ApiResponse.error(res, 'School portal services are awaiting initial activation. Please contact your School Administration.', null, 403);
    }

    const tokenPayload = {
      userId: parent.id,
      parentId: parent.id,
      studentId: activeStudent ? activeStudent.id : null,
      branchId: activeStudent ? (activeStudent.branch_id || null) : null,
      branch_id: activeStudent ? (activeStudent.branch_id || null) : null,
      schoolId: Number(parent.school_id),
      schoolName: parent.school_name || null,
      schoolLogo: parent.school_logo || null,
      email: parent.email,
      phone: parent.phone,
      firstName: parent.first_name,
      lastName: parent.last_name,
      roleName: 'Parent',
      portalType: 'ParentPortal',
    };

    const token = generateToken(tokenPayload);

    const cookieOptions = {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: config.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000,
      path: '/',
    };

    res.cookie('growvidya_parent_session', token, cookieOptions);

    const { password: _, passcode: __, otp: ___, ...safeParent } = parent;

    return ApiResponse.success(res, message, {
      authType: 'hybrid (session + token)',
      token,
      parent: {
        id: safeParent.id,
        firstName: safeParent.first_name,
        lastName: safeParent.last_name,
        name: `${safeParent.first_name || ''} ${safeParent.last_name || ''}`.trim(),
        email: safeParent.email,
        phone: safeParent.phone,
        occupation: safeParent.occupation,
        relation: safeParent.relation,
        picture: safeParent.picture,
        schoolId: safeParent.school_id,
        schoolName: safeParent.school_name || null,
        schoolLogo: safeParent.school_logo || null,
        roleName: 'Parent',
        portalType: 'ParentPortal',
        children: children,
        activeChild: activeStudent,
      },
    });
  }

  /**
   * Validate Email-Only Identifier for Parent Portal
   */
  static _validateParentEmail(rawInput) {
    const cleanEmail = String(rawInput || '').trim();
    if (!cleanEmail) {
      return { valid: false, message: 'Email address is required.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return {
        valid: false,
        message: 'Please enter a valid registered email address. Phone number login is not supported.',
      };
    }
    return { valid: true, email: cleanEmail };
  }

  /**
   * Parent Login Controller (Password-based fallback)
   */
  static async login(req, res, next) {
    try {
      const rawIdentifier = req.body.email || req.body.identifier || req.body.login;
      const { password } = req.body;

      if (!rawIdentifier || !password) {
        return ApiResponse.error(res, 'Email address and password are required.', null, 400);
      }

      const emailCheck = ParentAuthController._validateParentEmail(rawIdentifier);
      if (!emailCheck.valid) {
        return ApiResponse.error(res, emailCheck.message, null, 400);
      }

      const parent = await ParentModel.findByLoginIdentifier(emailCheck.email);

      if (!parent || Number(parent.status) !== 1) {
        return ApiResponse.error(res, 'Invalid credentials. Parent account not found or inactive.', null, 401);
      }

      let isPasswordValid = false;
      if (parent.password) {
        isPasswordValid = await comparePassword(password, parent.password);
      }

      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Invalid credentials. Incorrect password.', null, 401);
      }

      return await ParentAuthController._issueSession(parent, res, 'Parent authentication successful.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request 6-digit Passcode for Parent Login
   */
  static async requestPasscode(req, res, next) {
    try {
      const rawIdentifier = req.body.email || req.body.identifier || req.body.login;
      const emailCheck = ParentAuthController._validateParentEmail(rawIdentifier);
      if (!emailCheck.valid) {
        return ApiResponse.error(res, emailCheck.message, null, 400);
      }

      const cleanEmail = emailCheck.email;
      const parent = await ParentModel.findByLoginIdentifier(cleanEmail);

      if (!parent || Number(parent.status) !== 1) {
        return ApiResponse.error(res, 'Parent account not found with this email address or is inactive.', null, 404);
      }

      const targetEmail = String(parent.email || '').trim();
      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return ApiResponse.error(res, 'No valid email address is registered for this account to receive the OTP.', null, 400);
      }

      const passcode = PasscodeService.generatePasscode();
      const expiresInMinutes = 10;

      await PasscodeService.storePasscode('parent_master', parent.id, passcode, expiresInMinutes);
      const parentName = [parent.first_name, parent.last_name].filter(Boolean).join(' ');

      try {
        await PasscodeService.sendOtpEmail({
          toEmail: targetEmail,
          toName: parentName,
          otpCode: passcode,
          portalName: 'Parent Portal',
          expiresInMinutes,
        });
      } catch (emailErr) {
        console.error('[ParentAuth.requestPasscode] Email dispatch failed:', emailErr);
        await PasscodeService.clearPasscode('parent_master', parent.id).catch(() => {});
        return ApiResponse.error(
          res,
          'Unable to send verification code at the moment. Please try again shortly.',
          null,
          502
        );
      }

      return ApiResponse.success(res, 'A 6-digit OTP has been sent to your registered email address.', {
        identifier: cleanEmail,
        maskedIdentifier: PasscodeService.maskIdentifier(targetEmail),
        expiresInMinutes,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify 6-digit Passcode for Parent Login
   */
  static async verifyPasscode(req, res, next) {
    try {
      const rawIdentifier = req.body.email || req.body.identifier || req.body.login;
      const passcode = req.body.passcode || req.body.otp || req.body.code;

      const emailCheck = ParentAuthController._validateParentEmail(rawIdentifier);
      if (!emailCheck.valid) {
        return ApiResponse.error(res, emailCheck.message, null, 400);
      }
      if (!passcode || !String(passcode).trim()) {
        return ApiResponse.error(res, '6-digit OTP is required.', null, 400);
      }

      const parent = await ParentModel.findByLoginIdentifier(emailCheck.email);

      if (!parent || Number(parent.status) !== 1) {
        return ApiResponse.error(res, 'Parent account not found or is inactive.', null, 401);
      }

      const verifyResult = await PasscodeService.verifyPasscode('parent_master', parent.id, passcode);

      if (!verifyResult.valid) {
        return ApiResponse.error(res, verifyResult.message, null, 401);
      }

      return await ParentAuthController._issueSession(parent, res, 'Parent authenticated successfully via OTP.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Step 1 of Forgot Password: Request 6-digit Password Reset OTP via Email
   */
  static async requestForgotPasswordOtp(req, res, next) {
    try {
      const rawIdentifier = req.body.email || req.body.identifier || req.body.login;
      const emailCheck = ParentAuthController._validateParentEmail(rawIdentifier);
      if (!emailCheck.valid) {
        return ApiResponse.error(res, emailCheck.message, null, 400);
      }

      const cleanEmail = emailCheck.email;
      const parent = await ParentModel.findByLoginIdentifier(cleanEmail);
      if (!parent || Number(parent.status) !== 1) {
        return ApiResponse.error(res, 'No active parent account found with this email address.', null, 404);
      }

      const targetEmail = String(parent.email || '').trim();
      const otpCode = PasscodeService.generatePasscode();
      const expiresInMinutes = 10;

      await PasscodeService.storePasscode('parent_master', parent.id, otpCode, expiresInMinutes);
      const parentName = [parent.first_name, parent.last_name].filter(Boolean).join(' ');

      try {
        await PasscodeService.sendForgotPasswordOtpEmail({
          toEmail: targetEmail,
          toName: parentName,
          otpCode,
          portalName: 'Parent Portal',
          expiresInMinutes,
        });
      } catch (emailErr) {
        console.error('[ParentAuth.requestForgotPasswordOtp] Email dispatch failed:', emailErr);
        await PasscodeService.clearPasscode('parent_master', parent.id).catch(() => {});
        return ApiResponse.error(
          res,
          'Unable to send verification code at the moment. Please try again shortly.',
          null,
          502
        );
      }

      return ApiResponse.success(res, 'A 6-digit password reset OTP has been sent to your registered email address.', {
        identifier: cleanEmail,
        maskedIdentifier: PasscodeService.maskIdentifier(targetEmail),
        expiresInMinutes,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Step 2 of Forgot Password: Verify 6-digit OTP and issue short-lived resetToken
   */
  static async verifyForgotPasswordOtp(req, res, next) {
    try {
      const rawIdentifier = req.body.email || req.body.identifier || req.body.login;
      const otpCode = req.body.otp || req.body.passcode || req.body.code;

      const emailCheck = ParentAuthController._validateParentEmail(rawIdentifier);
      if (!emailCheck.valid) {
        return ApiResponse.error(res, emailCheck.message, null, 400);
      }
      if (!otpCode || !String(otpCode).trim()) {
        return ApiResponse.error(res, '6-digit OTP is required.', null, 400);
      }

      const cleanEmail = emailCheck.email;
      const parent = await ParentModel.findByLoginIdentifier(cleanEmail);
      if (!parent || Number(parent.status) !== 1) {
        return ApiResponse.error(res, 'Parent account not found or inactive.', null, 404);
      }

      const verifyResult = await PasscodeService.verifyPasscode('parent_master', parent.id, otpCode);
      if (!verifyResult.valid) {
        return ApiResponse.error(res, verifyResult.message, null, 401);
      }

      const resetToken = PasscodeService.issuePasswordResetToken({
        userId: parent.id,
        portalType: 'ParentPortal',
        identifier: cleanEmail,
      });

      return ApiResponse.success(res, 'OTP verified. Please enter your new password.', {
        resetToken,
        identifier: cleanEmail,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Step 3 of Forgot Password: Set new password using verified resetToken
   */
  static async resetPassword(req, res, next) {
    try {
      const { resetToken, newPassword, confirmPassword, password } = req.body || {};
      const candidatePassword = String(newPassword || password || '').trim();

      const tokenVerify = PasscodeService.verifyPasswordResetToken(resetToken, 'ParentPortal');
      if (!tokenVerify.valid) {
        return ApiResponse.error(res, tokenVerify.message, null, 401);
      }

      if (!candidatePassword || candidatePassword.length < 6) {
        return ApiResponse.error(res, 'New password must be at least 6 characters long.', null, 400);
      }
      if (confirmPassword !== undefined && String(confirmPassword).trim() !== candidatePassword) {
        return ApiResponse.error(res, 'New password and confirm password do not match.', null, 400);
      }

      const parentId = Number(tokenVerify.payload.userId);
      const [rows] = await pool.query('SELECT id FROM parent_master WHERE id = ? AND status = 1 LIMIT 1', [parentId]);
      if (!rows || rows.length === 0) {
        return ApiResponse.error(res, 'Parent account not found or inactive.', null, 404);
      }

      const hashedPwd = await hashPassword(candidatePassword);
      await pool.query(
        'UPDATE parent_master SET password = ?, otp = NULL, otp_expires_at = NULL WHERE id = ? AND status = 1',
        [hashedPwd, parentId]
      );

      return ApiResponse.success(res, 'Your password has been reset successfully. Please sign in with your new password.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Current Parent Profile & Active Child
   */
  static async getProfile(req, res, next) {
    try {
      if (req.user.portalType && req.user.portalType !== 'ParentPortal') {
        return ApiResponse.error(res, 'Access denied. Not a parent session.', null, 401);
      }
      if (req.user.roleName !== 'Parent' && !req.user.parentId) {
        return ApiResponse.error(res, 'Access denied. Not a parent session.', null, 401);
      }

      const parentId = req.user.parentId || req.user.userId;
      const parent = await ParentModel.findAuthProfileById(parentId);

      if (!parent || Number(parent.status) !== 1) {
        return ApiResponse.error(res, 'Parent profile not found or account is inactive.', null, 401);
      }

      const requestedStudentId = req.query.student_id ? Number(req.query.student_id) : req.user.studentId;
      const children = parent.children || [];
      const activeStudent = children.find((c) => Number(c.id) === requestedStudentId) || (children.length > 0 ? children[0] : null);

      const { password: _, passcode: __, otp: ___, ...safeParent } = parent;

      return ApiResponse.success(res, 'Parent profile fetched successfully.', {
        authSource: req.authSource || 'authenticated',
        parent: {
          id: safeParent.id,
          firstName: safeParent.first_name,
          lastName: safeParent.last_name,
          name: `${safeParent.first_name || ''} ${safeParent.last_name || ''}`.trim(),
          email: safeParent.email,
          phone: safeParent.phone,
          occupation: safeParent.occupation,
          relation: safeParent.relation,
          picture: safeParent.picture,
          schoolId: safeParent.school_id,
          schoolName: safeParent.school_name || null,
          schoolLogo: safeParent.school_logo || null,
          address1: safeParent.address1 || '',
          address2: safeParent.address2 || '',
          country: safeParent.country,
          countryName: safeParent.country_name || '',
          state: safeParent.state,
          stateName: safeParent.state_name || '',
          city: safeParent.city,
          cityName: safeParent.city_name || '',
          postalCode: safeParent.postal_code || '',
          roleName: 'Parent',
          portalType: 'ParentPortal',
          children: children,
          activeChild: activeStudent,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Switch Active Child in Session
   */
  static async switchStudent(req, res, next) {
    try {
      const parentId = req.user.parentId || req.user.userId;
      const studentId = Number(req.body.student_id || req.body.studentId);

      if (!studentId) {
        return ApiResponse.error(res, 'Student ID is required.', null, 400);
      }

      const children = await ParentModel.getChildrenByParentId(parentId, req.user.schoolId);
      const matchedChild = children.find((c) => Number(c.id) === studentId);

      if (!matchedChild) {
        return ApiResponse.error(res, 'Invalid child selection. Student not linked to this parent.', null, 403);
      }

      const parent = await ParentModel.findAuthProfileById(parentId);

      if (!parent.school_id) {
        return ApiResponse.error(res, 'Account configuration error: No school associated with this parent account.', null, 400);
      }

      const tokenPayload = {
        userId: parent.id,
        parentId: parent.id,
        studentId: matchedChild.id,
        branchId: matchedChild.branch_id || null,
        branch_id: matchedChild.branch_id || null,
        schoolId: Number(parent.school_id),
        schoolName: parent.school_name || null,
        schoolLogo: parent.school_logo || null,
        email: parent.email,
        phone: parent.phone,
        firstName: parent.first_name,
        lastName: parent.last_name,
        roleName: 'Parent',
        portalType: 'ParentPortal',
      };

      const token = generateToken(tokenPayload);

      const cookieOptions = {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        maxAge: config.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000,
        path: '/',
      };

      res.cookie('growvidya_parent_session', token, cookieOptions);

      return ApiResponse.success(res, 'Active student switched successfully.', {
        token,
        activeChild: matchedChild,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request 6-digit Email OTP for Parent Password Change
   * POST /api/parent/auth/profile/request-otp
   */
  static async requestProfileOtp(req, res, next) {
    try {
      const parentId = req.user.parentId || req.user.userId;
      const existingParent = await ParentModel.findAuthProfileById(parentId);
      if (!existingParent) {
        return ApiResponse.error(res, 'Parent profile not found.', null, 404);
      }

      const data = req.body || {};
      const currentPassword = String(data.current_password || '');
      const candidateNewPassword = String(data.new_password || '').trim();

      if (!currentPassword) {
        return ApiResponse.error(res, 'Current password is required to change password.', null, 400);
      }
      if (!candidateNewPassword || candidateNewPassword.length < 6) {
        return ApiResponse.error(res, 'New password must be at least 6 characters long.', null, 400);
      }

      let isCurrentValid = false;
      if (existingParent.password) {
        isCurrentValid = await comparePassword(currentPassword, existingParent.password);
      }
      if (!isCurrentValid) {
        return ApiResponse.error(res, 'Current password is incorrect.', null, 400);
      }

      const targetEmail = String(existingParent.email || '').trim();
      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return ApiResponse.error(
          res,
          'No email address is registered with your Parent profile. Please contact your school administrator to link your email address.',
          { emailMissing: true },
          400
        );
      }

      const otpCode = PasscodeService.generatePasscode();
      await PasscodeService.storePasscode('parent_master', parentId, otpCode, 10);

      const fullName =
        [existingParent.first_name, existingParent.last_name].filter(Boolean).join(' ').trim() ||
        'Parent';

      try {
        await PasscodeService.sendActionOtpEmail({
          toEmail: targetEmail,
          toName: fullName,
          otpCode,
          actionTitle: 'Parent Password Change Verification',
          actionWarning: 'Use this one-time passcode to confirm changing your Parent Portal password.',
          expiresInMinutes: 10,
        });
      } catch (emailErr) {
        console.error('[ParentAuth.requestProfileOtp] Email dispatch failed:', emailErr);
        await PasscodeService.clearPasscode('parent_master', parentId);
        return ApiResponse.error(
          res,
          'Unable to send verification code at the moment. Please try again shortly.',
          null,
          502
        );
      }

      const maskedEmail = PasscodeService.maskIdentifier(targetEmail);
      return ApiResponse.success(
        res,
        `A 6-digit verification code has been sent to ${maskedEmail}.`,
        {
          maskedEmail,
          expiresInMinutes: 10,
        }
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Parent Profile
   */
  static async updateProfile(req, res, next) {
    try {
      const parentId = req.user.parentId || req.user.userId;
      const schoolId = req.user?.schoolId;

      const {
        first_name,
        last_name,
        phone,
        email,
        occupation,
        picture,
        current_password,
        new_password,
        address1,
        address2,
        country,
        state,
        city,
        postal_code,
        otp,
      } = req.body;

      const existingParent = await ParentModel.findAuthProfileById(parentId);
      if (!existingParent) {
        return ApiResponse.error(res, 'Parent profile not found.', null, 404);
      }

      let hashedPassword = undefined;
      if (new_password) {
        const cleanOtp = String(otp || '').trim();
        if (!cleanOtp) {
          return ApiResponse.error(
            res,
            'A 6-digit email verification OTP is required to change your password.',
            null,
            400
          );
        }
        if (!current_password) {
          return ApiResponse.error(res, 'Current password is required to change password.', null, 400);
        }
        if (String(new_password).trim().length < 6) {
          return ApiResponse.error(res, 'New password must be at least 6 characters long.', null, 400);
        }

        let isCurrentValid = false;
        if (existingParent.password) {
          isCurrentValid = await comparePassword(current_password, existingParent.password);
        }

        if (!isCurrentValid) {
          return ApiResponse.error(res, 'Current password is incorrect.', null, 400);
        }

        const verification = await PasscodeService.verifyPasscode('parent_master', parentId, cleanOtp);
        if (!verification.valid) {
          return ApiResponse.error(res, verification.message || verification.reason || 'Invalid or expired OTP.', null, 400);
        }

        hashedPassword = await hashPassword(String(new_password).trim());
      }

      const updatedParent = await ParentModel.updateParentProfile(parentId, schoolId, {
        first_name,
        last_name,
        phone: existingParent.phone,
        email: existingParent.email,
        occupation,
        picture,
        password: hashedPassword,
        address1,
        address2,
        country,
        state,
        city,
        postal_code,
      });

      const { password: _, passcode: __, otp: ___, ...safeParent } = updatedParent;

      return ApiResponse.success(res, 'Profile updated successfully.', {
        parent: {
          id: safeParent.id,
          firstName: safeParent.first_name,
          lastName: safeParent.last_name,
          name: `${safeParent.first_name || ''} ${safeParent.last_name || ''}`.trim(),
          email: safeParent.email,
          phone: safeParent.phone,
          occupation: safeParent.occupation,
          relation: safeParent.relation,
          picture: safeParent.picture,
          schoolId: safeParent.school_id,
          schoolName: safeParent.school_name || null,
          schoolLogo: safeParent.school_logo || null,
          address1: safeParent.address1 || '',
          address2: safeParent.address2 || '',
          country: safeParent.country,
          countryName: safeParent.country_name || '',
          state: safeParent.state,
          stateName: safeParent.state_name || '',
          city: safeParent.city,
          cityName: safeParent.city_name || '',
          postalCode: safeParent.postal_code || '',
          roleName: 'Parent',
          portalType: 'ParentPortal',
          children: safeParent.children || [],
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Parent Logout
   */
  static async logout(req, res) {
    try {
      const cookieName = config.cookie?.name || 'growvidya_session';
      const cookieOptions = {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        path: '/',
      };

      res.clearCookie('growvidya_parent_session', cookieOptions);

      return ApiResponse.success(res, 'Parent logged out successfully.', null);
    } catch (error) {
      return ApiResponse.error(res, 'Logout encountered an error.', error.message, 500);
    }
  }
}

module.exports = ParentAuthController;
