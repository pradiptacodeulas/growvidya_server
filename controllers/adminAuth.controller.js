const AdminUserModel = require('../models/adminUser.model');
const StaffModel = require('../models/staff.model');
const PermissionModel = require('../models/permission.model');
const SubscriptionModel = require('../models/subscription.model');
const { pool } = require('../config/db.config');
const { comparePassword } = require('../utils/password.util');
const { generateToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');

class AdminAuthController {
  /**
   * Admin Login Controller
   * Hybrid Authentication:
   * - Web: Issues secure HTTP-Only session cookies
   * - Mobile / API: Returns Bearer JWT token in response body
   */
  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return ApiResponse.error(res, 'Email and password are required.', null, 400);
      }

      const user = await AdminUserModel.findByEmail(email.trim());

      if (!user) {
        return ApiResponse.error(res, 'Invalid credentials. User not found or inactive.', null, 401);
      }

      // Verify admin role access:
      // admin_type: 1 = Super Admin, 2 = Staff
      const adminType = Number(user.admin_type);
      const isSuperAdmin = adminType === 1;
      const isAdmin = isSuperAdmin || adminType === 2 || Boolean(user.role_id);

      if (!isAdmin) {
        return ApiResponse.error(res, 'Access denied. Account does not have administrative privileges.', null, 403);
      }

      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Invalid credentials. Incorrect password.', null, 401);
      }

      const roleName = isSuperAdmin ? 'Super Admin' : (user.role_name || null);
      const permissions = isSuperAdmin ? {} : await PermissionModel.getUserPermissionMap(user.role_id);
      const sub = await SubscriptionModel.getSchoolSubscription(user.school_id);

      // Block login if school has purchased a paid plan that is awaiting Super Admin approval.
      // Free trials (sub.isTrial) are NOT guarded and can log in immediately.
      if (sub && sub.status === 'pending' && !sub.isTrial) {
        return ApiResponse.error(
          res,
          `Your subscription plan "${sub.plan_name}" is currently awaiting review and approval by the Super Admin. You will be able to log in once your subscription is approved and activated.`,
          {
            subscription_id: sub.subscription_id,
            plan_name: sub.plan_name,
            status: 'pending',
            is_pending: true,
            is_trial: false,
          },
          403
        );
      }

      const tokenPayload = {
        userId: user.id,
        schoolId: user.school_id,
        branchId: user.branch_id || null,
        branchName: user.branch_name || null,
        branchCode: user.branch_code || null,
        schoolName: user.school_name,
        schoolLogo: user.school_logo,
        registrationType: user.registration_type || 'single',
        email: user.email,
        roleId: user.role_id,
        adminType: adminType,
        isSuperAdmin: Boolean(isSuperAdmin),
        roleName,
        portalType: 'AdminPortal',
      };

      const token = generateToken(tokenPayload);

      // Set HTTP-Only Persistent Session Cookie for Web Clients (persists across tab closes & reloads)
      const cookieOptions = {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        maxAge: config.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000,
        path: '/',
      };

      const cookieName = config.cookie?.name || 'growvidya_session';
      res.cookie('growvidya_admin_session', token, cookieOptions);
      res.cookie(cookieName, token, cookieOptions);

      return ApiResponse.success(res, 'Admin authentication successful.', {
        authType: 'hybrid (session + token)',
        token, // Available for mobile app & external API consumption via Authorization header
        user: {
          id: user.id,
          schoolId: user.school_id,
          schoolName: user.school_name || '',
          schoolLogo: user.school_logo || null,
          registrationType: user.registration_type || 'single',
          schoolFooter: user.school_footer || null,
          branchId: user.branch_id || null,
          branch_id: user.branch_id || null,
          branchName: user.branch_name || null,
          branchCode: user.branch_code || null,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          picture: user.picture,
          roleId: user.role_id,
          roleName,
          adminType: adminType,
          admin_type: adminType,
          isSuperAdmin: Boolean(isSuperAdmin),
          isTrial: Boolean(sub?.isTrial),
          isExpired: Boolean(sub?.isExpired),
          subscription: sub,
          permissions,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Current Admin Profile
   * Works for both Session Cookie and Bearer Token clients
   */
  static async getProfile(req, res, next) {
    try {
      if (req.user.portalType && req.user.portalType !== 'AdminPortal') {
        return ApiResponse.error(res, 'Access denied. Not an administrative session.', null, 401);
      }
      if (req.user.roleName === 'Teacher' || req.user.roleName === 'Parent') {
        return ApiResponse.error(res, 'Access denied. Not an administrative session.', null, 401);
      }

      const userId = req.user.userId;
      const user = await AdminUserModel.findById(userId);

      if (!user) {
        return ApiResponse.error(res, 'Admin profile not found.', null, 404);
      }

      const adminType = Number(user.admin_type);
      const isSuperAdmin = adminType === 1;
      const roleName = isSuperAdmin ? 'Super Admin' : (user.role_name || null);
      const permissions = isSuperAdmin ? {} : await PermissionModel.getUserPermissionMap(user.role_id);
      const sub = await SubscriptionModel.getSchoolSubscription(user.school_id);

      if (sub && sub.status === 'pending' && !sub.isTrial) {
        return ApiResponse.error(
          res,
          `Your subscription plan "${sub.plan_name}" is currently awaiting review and approval by the Super Admin.`,
          {
            subscription_id: sub.subscription_id,
            plan_name: sub.plan_name,
            status: 'pending',
            is_pending: true,
            is_trial: false,
          },
          403
        );
      }

      return ApiResponse.success(res, 'Admin profile fetched successfully.', {
        authSource: req.authSource || 'authenticated',
        user: {
          id: user.id,
          schoolId: user.school_id,
          schoolName: user.school_name || '',
          schoolLogo: user.school_logo || null,
          registrationType: user.registration_type || 'single',
          schoolFooter: user.school_footer || null,
          branchId: user.branch_id || null,
          branch_id: user.branch_id || null,
          branchName: user.branch_name || null,
          branchCode: user.branch_code || null,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          picture: user.picture,
          roleId: user.role_id,
          roleName,
          adminType: adminType,
          admin_type: adminType,
          isSuperAdmin: Boolean(isSuperAdmin),
          isTrial: Boolean(sub?.isTrial),
          isExpired: Boolean(sub?.isExpired),
          subscription: sub,
          permissions,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Full Admin Profile Details (including address, bank, transport, hostel, documents)
   */
  static async getFullProfile(req, res, next) {
    try {
      const userId = req.user.userId;
      const user = await AdminUserModel.findById(userId);
      if (!user) {
        return ApiResponse.error(res, 'Admin profile not found.', null, 404);
      }

      const fullProfile = await StaffModel.getById(userId, user.school_id);
      if (!fullProfile) {
        return ApiResponse.error(res, 'Admin profile record not found.', null, 404);
      }

      return ApiResponse.success(res, 'Admin profile details fetched successfully.', {
        profile: {
          ...fullProfile,
          school_name: user.school_name || '',
          school_logo: user.school_logo || null,
          registration_type: user.registration_type || 'single',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Current Admin Profile (Self-Service)
   */
  static async updateProfile(req, res, next) {
    try {
      const userId = req.user.userId;
      const user = await AdminUserModel.findById(userId);
      if (!user) {
        return ApiResponse.error(res, 'Admin profile not found.', null, 404);
      }

      const data = req.body || {};

      // Handle password change if current_password or new_password is provided
      let passwordToUpdate = undefined;
      if (data.new_password || data.password) {
        const candidateNewPassword = String(data.new_password || data.password || '').trim();
        if (candidateNewPassword) {
          if (data.current_password !== undefined) {
            const [pwdRows] = await pool.execute('SELECT password FROM user_master WHERE id = ? LIMIT 1', [userId]);
            const currentHash = pwdRows[0]?.password;
            if (!currentHash) {
              return ApiResponse.error(res, 'Unable to verify current password.', null, 400);
            }
            const isCurrentValid = await comparePassword(String(data.current_password), currentHash);
            if (!isCurrentValid) {
              return ApiResponse.error(res, 'Current password is incorrect.', null, 400);
            }
          }
          passwordToUpdate = candidateNewPassword;
        }
      }

      // Prevent self-modification of role or account status
      const safeUpdatePayload = {
        ...data,
        role: user.role_id,
        status: user.status,
        branch_id: user.branch_id || null,
        password: passwordToUpdate,
      };

      const updatedProfile = await StaffModel.update(userId, user.school_id, safeUpdatePayload);
      if (!updatedProfile) {
        return ApiResponse.error(res, 'Failed to update admin profile.', null, 404);
      }

      const refreshedUser = await AdminUserModel.findById(userId);
      const adminType = Number(refreshedUser.admin_type);
      const isSuperAdmin = adminType === 1;
      const roleName = isSuperAdmin ? 'Super Admin' : (refreshedUser.role_name || null);

      return ApiResponse.success(res, 'Profile updated successfully.', {
        profile: {
          ...updatedProfile,
          school_name: refreshedUser.school_name || '',
          school_logo: refreshedUser.school_logo || null,
          registration_type: refreshedUser.registration_type || 'single',
        },
        user: {
          id: refreshedUser.id,
          schoolId: refreshedUser.school_id,
          schoolName: refreshedUser.school_name || '',
          schoolLogo: refreshedUser.school_logo || null,
          registrationType: refreshedUser.registration_type || 'single',
          schoolFooter: refreshedUser.school_footer || null,
          branchId: refreshedUser.branch_id || null,
          branch_id: refreshedUser.branch_id || null,
          branchName: refreshedUser.branch_name || null,
          branchCode: refreshedUser.branch_code || null,
          firstName: refreshedUser.first_name,
          lastName: refreshedUser.last_name,
          email: refreshedUser.email,
          phone: refreshedUser.phone,
          picture: refreshedUser.picture,
          roleId: refreshedUser.role_id,
          roleName,
          adminType: adminType,
          admin_type: adminType,
          isSuperAdmin: Boolean(isSuperAdmin),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin Logout Controller
   * Clears Web Session cookies and returns successful response
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

      res.clearCookie('growvidya_admin_session', cookieOptions);
      res.clearCookie(cookieName, cookieOptions);

      return ApiResponse.success(res, 'Admin logged out successfully. Session cookies cleared.');
    } catch (error) {
      return ApiResponse.error(res, 'Failed to logout cleanly.', error.message, 500);
    }
  }
}

module.exports = AdminAuthController;

