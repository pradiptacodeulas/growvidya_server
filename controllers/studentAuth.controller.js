const StudentModel = require('../models/student.model');
const { comparePassword, hashPassword } = require('../utils/password.util');
const { generateToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');
const PasscodeService = require('../services/passcode.service');

/**
 * Generate all common Date of Birth string representations.
 * Ensures consistent matching across ISO (YYYY-MM-DD), Indian standard (DD-MM-YYYY),
 * slash notation (DD/MM/YYYY), and compact digit strings (DDMMYYYY).
 */
function getDobVariations(dobRaw) {
  if (!dobRaw) return [];
  let yyyy, mm, dd;
  if (typeof dobRaw === 'string') {
    const match = dobRaw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (match) {
      yyyy = match[1];
      mm = match[2].padStart(2, '0');
      dd = match[3].padStart(2, '0');
    }
  }
  if (!yyyy && dobRaw) {
    const d = new Date(dobRaw);
    if (!isNaN(d.getTime())) {
      yyyy = String(d.getFullYear());
      mm = String(d.getMonth() + 1).padStart(2, '0');
      dd = String(d.getDate()).padStart(2, '0');
    }
  }
  if (!yyyy || !mm || !dd) return [];

  const nDd = String(Number(dd));
  const nMm = String(Number(mm));

  return [
    `${yyyy}-${mm}-${dd}`,
    `${dd}-${mm}-${yyyy}`,
    `${dd}/${mm}/${yyyy}`,
    `${yyyy}/${mm}/${dd}`,
    `${dd}${mm}${yyyy}`,
    `${yyyy}${mm}${dd}`,
    `${nDd}-${nMm}-${yyyy}`,
    `${nDd}/${nMm}/${yyyy}`,
    `${nDd}${nMm}${yyyy}`,
    `${nDd}${mm}${yyyy}`,
    `${dd}${nMm}${yyyy}`,
    `${yyyy}-${nMm}-${nDd}`,
    `${yyyy}/${nMm}/${nDd}`,
    `${dd}.${mm}.${yyyy}`,
    `${yyyy}.${mm}.${dd}`,
  ];
}

/**
 * Robustly verify candidate credential against student record.
 * Supports:
 * - Direct password hash match (bcrypt or MD5)
 * - Any valid format of student's Date of Birth
 * - Active Passcode (OTP)
 * - Admission Number, Contact Number, or default '123456'
 */
async function verifyStudentCredential(candidatePassword, student) {
  if (!candidatePassword || !student) return false;
  const cleanInput = String(candidatePassword).trim();
  if (!cleanInput) return false;

  // 1. Direct password match (handles custom passwords, bcrypt, or direct MD5)
  if (student.password) {
    const isDirectMatch = await comparePassword(cleanInput, student.password);
    if (isDirectMatch) return true;
  }

  // 2. Date of Birth check
  if (student.date_of_birth) {
    const variations = getDobVariations(student.date_of_birth);
    const cleanNoDelim = cleanInput.replace(/[\/\-\s.]/g, '');

    // Check if stored password was generated from DOB
    let storedPasswordIsDob = !student.password;
    if (student.password) {
      for (const v of variations) {
        if (await comparePassword(v, student.password)) {
          storedPasswordIsDob = true;
          break;
        }
      }
    }

    if (storedPasswordIsDob) {
      for (const v of variations) {
        if (cleanInput === v || cleanNoDelim === v.replace(/[\/\-\s.]/g, '')) {
          return true;
        }
      }
    }
  }

  // 3. Admission number match if no custom password is set
  if (!student.password) {
    if (student.admission_number && cleanInput === String(student.admission_number).trim()) {
      return true;
    }
  }

  return false;
}

class StudentAuthController {
  /**
   * Lookup active student by Email Address or Student ID (admission_number) only
   */
  static async _findStudentByEmailOrId(rawIdent) {
    const cleanIdent = String(rawIdent || '').trim();
    if (!cleanIdent) return null;
    const [students] = await pool.query(
      `SELECT 
        s.*,
        cm.class_name,
        sec.section_name,
        sch.school_name,
        sch.school_logo
       FROM student_master s
       LEFT JOIN class_master cm ON s.class = cm.id
       LEFT JOIN section_master sec ON s.section = sec.id
       LEFT JOIN school_master sch ON s.school_id = sch.id
       WHERE (
         s.admission_number = ? OR 
         s.email_address = ?
       ) AND s.status = 1
       LIMIT 1`,
      [cleanIdent, cleanIdent]
    );
    return students && students.length > 0 ? students[0] : null;
  }
  /**
   * Helper to issue session cookie & JWT token for student
   */
  static async _issueSession(student, res, message = 'Student login successful.') {
    if (!student.school_id) {
      return ApiResponse.error(res, 'Account configuration error: No school associated with this student account.', null, 400);
    }

    const [sRows] = await pool.query('SELECT status FROM school_master WHERE id = ? LIMIT 1', [student.school_id]);
    if (sRows.length > 0 && Number(sRows[0].status) !== 1) {
      return ApiResponse.error(res, 'Your school account has been marked inactive by the Super Admin. Login is disabled until reactivated.', null, 403);
    }
    const SubscriptionModel = require('../models/subscription.model');
    const sub = await SubscriptionModel.getSchoolSubscription(student.school_id);
    if (sub && (sub.status === 'suspended' || sub.liveStatus === 'suspended')) {
      return ApiResponse.error(res, 'Your school subscription has been marked inactive / suspended by the Super Admin. Login is disabled until reactivated.', null, 403);
    }
    if (sub && (sub.liveStatus === 'pending' || (sub.status === 'pending' && !sub.isTrial))) {
      return ApiResponse.error(res, 'School portal services are awaiting initial activation. Please contact your School Administration.', null, 403);
    }

    const tokenPayload = {
      userId: student.id,
      studentId: student.id,
      schoolId: Number(student.school_id),
      branchId: student.branch_id || null,
      branch_id: student.branch_id || null,
      schoolName: student.school_name || null,
      schoolLogo: student.school_logo || null,
      email: student.email_address,
      admissionNumber: student.admission_number,
      classId: student.class,
      sectionId: student.section,
      className: student.class_name,
      sectionName: student.section_name,
      firstName: student.first_name,
      lastName: student.last_name,
      fullName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
      roleName: 'Student',
      portalType: 'StudentPortal',
    };

    const token = generateToken(tokenPayload);

    const cookieOptions = {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: config.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000,
      path: '/',
    };

    res.cookie('growvidya_student_session', token, cookieOptions);

    const { password: _, passcode: __, otp: ___, ...safeStudent } = student;
    safeStudent.full_name = safeStudent.full_name || `${safeStudent.first_name || ''} ${safeStudent.last_name || ''}`.trim() || safeStudent.name || 'Student';
    safeStudent.fullName = safeStudent.full_name;
    safeStudent.admissionNumber = safeStudent.admission_number || safeStudent.roll_number || 'N/A';

    return ApiResponse.success(res, message, {
      student: safeStudent,
      token,
      school: {
        id: student.school_id,
        name: student.school_name,
        logo: student.school_logo,
      },
    });
  }

  /**
   * Student Login (Password-based fallback — accepts Email or Student ID / Admission Number)
   */
  static async login(req, res, next) {
    try {
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.student_id || req.body.identifier || req.body.login;
      const { password } = req.body;

      if (!emailOrAdmNo || !String(emailOrAdmNo).trim() || !password) {
        return ApiResponse.error(res, 'Email address or Student ID (Admission No.) and password are required.', null, 400);
      }

      const cleanIdent = String(emailOrAdmNo).trim();
      const student = await StudentAuthController._findStudentByEmailOrId(cleanIdent);
      if (!student) {
        return ApiResponse.error(res, 'Student account not found with this Email or Student ID, or is inactive.', null, 401);
      }

      // Verify password & credentials
      const isPasswordValid = await verifyStudentCredential(password, student);

      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Invalid credentials. Please check your password or Date of Birth.', null, 401);
      }

      return await StudentAuthController._issueSession(student, res, 'Student login successful.');
    } catch (error) {
      console.error('Error in StudentAuthController.login:', error);
      next(error);
    }
  }

  /**
   * Request 6-digit Passcode for Student Login (accepts Email or Student ID / Admission Number)
   */
  static async requestPasscode(req, res, next) {
    try {
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.student_id || req.body.identifier || req.body.login;

      if (!emailOrAdmNo || !String(emailOrAdmNo).trim()) {
        return ApiResponse.error(res, 'Email address or Student ID (Admission No.) is required.', null, 400);
      }

      const cleanIdent = String(emailOrAdmNo).trim();
      const student = await StudentAuthController._findStudentByEmailOrId(cleanIdent);
      if (!student) {
        return ApiResponse.error(res, 'Student account not found with this Email or Student ID, or is inactive.', null, 404);
      }

      const targetEmail = String(student.email_address || '').trim();
      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return ApiResponse.error(
          res,
          `No email address is registered for Student ID "${student.admission_number || cleanIdent}". Please contact your School Administrator to link an email address to your profile, or sign in using your password.`,
          { emailMissing: true, identifier: cleanIdent },
          400
        );
      }

      const passcode = PasscodeService.generatePasscode();
      const expiresInMinutes = 10;

      await PasscodeService.storePasscode('student_master', student.id, passcode, expiresInMinutes);
      const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ');

      try {
        await PasscodeService.sendOtpEmail({
          toEmail: targetEmail,
          toName: studentName,
          otpCode: passcode,
          portalName: 'Student Portal',
          expiresInMinutes,
        });
      } catch (emailErr) {
        console.error('[StudentAuth.requestPasscode] Email dispatch failed:', emailErr);
        await PasscodeService.clearPasscode('student_master', student.id).catch(() => {});
        return ApiResponse.error(
          res,
          'Unable to send verification code at the moment. Please try again shortly.',
          null,
          502
        );
      }

      return ApiResponse.success(res, 'A 6-digit OTP has been sent to your registered email address.', {
        identifier: cleanIdent,
        maskedIdentifier: PasscodeService.maskIdentifier(targetEmail),
        expiresInMinutes,
      });
    } catch (error) {
      console.error('Error in StudentAuthController.requestPasscode:', error);
      next(error);
    }
  }

  /**
   * Verify 6-digit Passcode for Student Login
   */
  static async verifyPasscode(req, res, next) {
    try {
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.student_id || req.body.identifier || req.body.login;
      const passcode = req.body.passcode || req.body.otp || req.body.code;

      if (!emailOrAdmNo || !String(emailOrAdmNo).trim()) {
        return ApiResponse.error(res, 'Email address or Student ID (Admission No.) is required.', null, 400);
      }
      if (!passcode || !String(passcode).trim()) {
        return ApiResponse.error(res, '6-digit OTP is required.', null, 400);
      }

      const cleanIdent = String(emailOrAdmNo).trim();
      const student = await StudentAuthController._findStudentByEmailOrId(cleanIdent);
      if (!student) {
        return ApiResponse.error(res, 'Student account not found or is inactive.', null, 401);
      }

      const verifyResult = await PasscodeService.verifyPasscode('student_master', student.id, passcode);

      if (!verifyResult.valid) {
        return ApiResponse.error(res, verifyResult.message, null, 401);
      }

      return await StudentAuthController._issueSession(student, res, 'Student login successful via OTP.');
    } catch (error) {
      console.error('Error in StudentAuthController.verifyPasscode:', error);
      next(error);
    }
  }

  /**
   * Step 1 of Forgot Password: Request 6-digit Password Reset OTP via Email (accepts Email or Student ID)
   */
  static async requestForgotPasswordOtp(req, res, next) {
    try {
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.student_id || req.body.identifier || req.body.login;
      if (!emailOrAdmNo || !String(emailOrAdmNo).trim()) {
        return ApiResponse.error(res, 'Email address or Student ID (Admission No.) is required.', null, 400);
      }

      const cleanIdent = String(emailOrAdmNo).trim();
      const student = await StudentAuthController._findStudentByEmailOrId(cleanIdent);
      if (!student) {
        return ApiResponse.error(res, 'No active student account found with this Email or Student ID.', null, 404);
      }

      const targetEmail = String(student.email_address || '').trim();
      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return ApiResponse.error(
          res,
          `No email address is registered for Student ID "${student.admission_number || cleanIdent}". Please contact your School Administrator to reset your password or link an email address.`,
          { emailMissing: true, identifier: cleanIdent },
          400
        );
      }

      const otpCode = PasscodeService.generatePasscode();
      const expiresInMinutes = 10;

      await PasscodeService.storePasscode('student_master', student.id, otpCode, expiresInMinutes);
      const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ');

      try {
        await PasscodeService.sendForgotPasswordOtpEmail({
          toEmail: targetEmail,
          toName: studentName,
          otpCode,
          portalName: 'Student Portal',
          expiresInMinutes,
        });
      } catch (emailErr) {
        console.error('[StudentAuth.requestForgotPasswordOtp] Email dispatch failed:', emailErr);
        await PasscodeService.clearPasscode('student_master', student.id).catch(() => {});
        return ApiResponse.error(
          res,
          'Unable to send verification code at the moment. Please try again shortly.',
          null,
          502
        );
      }

      return ApiResponse.success(res, 'A 6-digit password reset OTP has been sent to your registered email address.', {
        identifier: cleanIdent,
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
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.student_id || req.body.identifier || req.body.login;
      const otpCode = req.body.otp || req.body.passcode || req.body.code;

      if (!emailOrAdmNo || !String(emailOrAdmNo).trim()) {
        return ApiResponse.error(res, 'Email address or Student ID (Admission No.) is required.', null, 400);
      }
      if (!otpCode || !String(otpCode).trim()) {
        return ApiResponse.error(res, '6-digit OTP is required.', null, 400);
      }

      const cleanIdent = String(emailOrAdmNo).trim();
      const student = await StudentAuthController._findStudentByEmailOrId(cleanIdent);
      if (!student) {
        return ApiResponse.error(res, 'Student account not found or inactive.', null, 404);
      }

      const verifyResult = await PasscodeService.verifyPasscode('student_master', student.id, otpCode);
      if (!verifyResult.valid) {
        return ApiResponse.error(res, verifyResult.message, null, 401);
      }

      const resetToken = PasscodeService.issuePasswordResetToken({
        userId: student.id,
        portalType: 'StudentPortal',
        identifier: cleanIdent,
      });

      return ApiResponse.success(res, 'OTP verified. Please enter your new password.', {
        resetToken,
        identifier: cleanIdent,
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

      const tokenVerify = PasscodeService.verifyPasswordResetToken(resetToken, 'StudentPortal');
      if (!tokenVerify.valid) {
        return ApiResponse.error(res, tokenVerify.message, null, 401);
      }

      if (!candidatePassword || candidatePassword.length < 6) {
        return ApiResponse.error(res, 'New password must be at least 6 characters long.', null, 400);
      }
      if (confirmPassword !== undefined && String(confirmPassword).trim() !== candidatePassword) {
        return ApiResponse.error(res, 'New password and confirm password do not match.', null, 400);
      }

      const studentId = Number(tokenVerify.payload.userId);
      const [rows] = await pool.query('SELECT id FROM student_master WHERE id = ? AND status = 1 LIMIT 1', [studentId]);
      if (!rows || rows.length === 0) {
        return ApiResponse.error(res, 'Student account not found or inactive.', null, 404);
      }

      const hashedPwd = await hashPassword(candidatePassword);
      await pool.query(
        'UPDATE student_master SET password = ?, otp = NULL, otp_expires_at = NULL WHERE id = ? AND status = 1',
        [hashedPwd, studentId]
      );

      return ApiResponse.success(res, 'Your password has been reset successfully. Please sign in with your new password.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Current Authenticated Student
   */
  static async getMe(req, res, next) {
    try {
      const studentId = req.user?.studentId || req.user?.userId || req.user?.id;
      const schoolId = req.user?.schoolId || req.user?.school_id;

      if (!studentId || !schoolId) {
        return ApiResponse.error(res, 'Not authenticated as a student.', null, 401);
      }

      const StudentModel = require('../models/student.model');
      let student = await StudentModel.getById(studentId, schoolId);

      // If the student was promoted to a new session record, seamlessly resolve their active record
      if (student && Number(student.status) !== 1 && student.admission_number) {
        const [activeRows] = await pool.query(
          `SELECT id FROM student_master WHERE school_id = ? AND LOWER(TRIM(admission_number)) = LOWER(TRIM(?)) AND status = 1 ORDER BY id DESC LIMIT 1`,
          [schoolId, student.admission_number]
        );
        if (activeRows && activeRows.length > 0) {
          student = await StudentModel.getById(activeRows[0].id, schoolId);
        }
      }

      if (!student || Number(student.status) !== 1) {
        return ApiResponse.error(res, 'Student account not found or is inactive.', null, 401);
      }

      const { password: _, passcode: __, otp: ___, ...safeStudent } = student;
      safeStudent.full_name = safeStudent.full_name || `${safeStudent.first_name || ''} ${safeStudent.last_name || ''}`.trim() || safeStudent.name || 'Student';
      safeStudent.fullName = safeStudent.full_name;
      safeStudent.admissionNumber = safeStudent.admission_number || safeStudent.roll_number || 'N/A';

      return ApiResponse.success(res, 'Student session verified.', {
        student: safeStudent,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Student Logout
   */
  static async logout(req, res, next) {
    try {
      const cookieOptions = {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        path: '/',
      };
      res.clearCookie('growvidya_student_session', cookieOptions);
      return ApiResponse.success(res, 'Student logged out successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request 6-digit Email OTP for Student Change Password
   * POST /api/student/auth/change-password/request-otp
   */
  static async requestChangePasswordOtp(req, res, next) {
    try {
      const studentId = req.user?.studentId || req.user?.userId || req.user?.id;
      const schoolId = req.user?.schoolId || req.user?.school_id;

      if (!studentId || !schoolId) {
        return ApiResponse.error(res, 'Authentication required: session or school ID missing.', null, 401);
      }

      const oldPassword = req.body.oldPassword || req.body.currentPassword || req.body.cur_pass || req.body.current_password;
      const newPassword = req.body.newPassword || req.body.new_password || req.body.new_pass;

      if (!oldPassword || !String(oldPassword).trim()) {
        return ApiResponse.error(res, 'Current password is required to set a new password.', null, 400);
      }

      if (!newPassword || String(newPassword).trim().length < 4) {
        return ApiResponse.error(res, 'New password must be at least 4 characters.', null, 400);
      }

      const [rows] = await pool.query(
        `SELECT id, first_name, last_name, email_address, password, passcode, date_of_birth, admission_number, primary_contact_number 
         FROM student_master 
         WHERE id = ? AND (school_id = ? OR ? IS NULL) 
         LIMIT 1`,
        [studentId, schoolId, schoolId]
      );

      const student = rows && rows.length > 0 ? rows[0] : null;
      if (!student) {
        return ApiResponse.error(res, 'Student account not found.', null, 404);
      }

      const isValid = await verifyStudentCredential(oldPassword, student);
      if (!isValid) {
        return ApiResponse.error(res, 'Current password does not match.', null, 400);
      }

      const targetEmail = String(student.email_address || '').trim();
      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return ApiResponse.error(
          res,
          'No email address is linked to your Student profile. Please contact your school administrator to register your email address before changing your password.',
          { emailMissing: true },
          400
        );
      }

      const otpCode = PasscodeService.generatePasscode();
      await PasscodeService.storePasscode('student_master', studentId, otpCode, 10);

      const fullName =
        [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || 'Student';

      try {
        await PasscodeService.sendActionOtpEmail({
          toEmail: targetEmail,
          toName: fullName,
          otpCode,
          actionTitle: 'Student Password Change Verification',
          actionWarning: 'Use this one-time passcode to confirm changing your Student Portal password.',
          expiresInMinutes: 10,
        });
      } catch (emailErr) {
        console.error('[StudentAuth.requestChangePasswordOtp] Email dispatch failed:', emailErr);
        await PasscodeService.clearPasscode('student_master', studentId);
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
   * Change Student Password
   */
  static async changePassword(req, res, next) {
    try {
      const studentId = req.user?.studentId || req.user?.userId || req.user?.id;
      const schoolId = req.user?.schoolId || req.user?.school_id;

      if (!studentId || !schoolId) {
        return ApiResponse.error(res, 'Authentication required: session or school ID missing.', null, 401);
      }
      const oldPassword = req.body.oldPassword || req.body.currentPassword || req.body.cur_pass || req.body.current_password;
      const newPassword = req.body.newPassword || req.body.new_password || req.body.new_pass;
      const otp = String(req.body.otp || '').trim();

      if (!otp) {
        return ApiResponse.error(res, 'A 6-digit email verification OTP is required to confirm changing your password.', null, 400);
      }

      if (!newPassword || String(newPassword).trim().length < 4) {
        return ApiResponse.error(res, 'New password must be at least 4 characters.', null, 400);
      }

      if (!oldPassword || !String(oldPassword).trim()) {
        return ApiResponse.error(res, 'Current password is required to set a new password.', null, 400);
      }

      const [rows] = await pool.query(
        `SELECT id, password, passcode, date_of_birth, admission_number, primary_contact_number 
         FROM student_master 
         WHERE id = ? AND (school_id = ? OR ? IS NULL) 
         LIMIT 1`,
        [studentId, schoolId, schoolId]
      );

      const student = rows && rows.length > 0 ? rows[0] : null;
      if (!student) {
        return ApiResponse.error(res, 'Student account not found.', null, 404);
      }

      const isValid = await verifyStudentCredential(oldPassword, student);
      if (!isValid) {
        return ApiResponse.error(res, 'Current password does not match.', null, 400);
      }

      const verification = await PasscodeService.verifyPasscode('student_master', studentId, otp);
      if (!verification.valid) {
        return ApiResponse.error(res, verification.message || verification.reason || 'Invalid or expired OTP.', null, 400);
      }

      const hashed = await hashPassword(String(newPassword).trim());
      await pool.query(
        `UPDATE student_master SET password = ? WHERE id = ? AND (school_id = ? OR ? IS NULL)`,
        [hashed, studentId, schoolId, schoolId]
      );

      return ApiResponse.success(res, 'Password changed successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = StudentAuthController;
