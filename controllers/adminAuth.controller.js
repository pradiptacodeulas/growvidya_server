const AdminUserModel = require('../models/adminUser.model');
const PermissionModel = require('../models/permission.model');
const SubscriptionModel = require('../models/subscription.model');
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
      const isSuperAdmin = adminType === 1 || user.role_name === 'Super Admin';
      const isAdmin = isSuperAdmin || adminType === 2 || Boolean(user.role_id) || (user.role_name && user.role_name.toLowerCase().includes('admin'));

      if (!isAdmin) {
        return ApiResponse.error(res, 'Access denied. Account does not have administrative privileges.', null, 403);
      }

      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Invalid credentials. Incorrect password.', null, 401);
      }

      const roleName = isSuperAdmin ? 'Super Admin' : (user.role_name || 'Staff');
      const permissions = isSuperAdmin ? {} : await PermissionModel.getUserPermissionMap(user.role_id);
      const sub = await SubscriptionModel.getSchoolSubscription(user.school_id);

      const tokenPayload = {
        userId: user.id,
        schoolId: user.school_id,
        schoolName: user.school_name,
        schoolLogo: user.school_logo,
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
          schoolName: user.school_name || '',
          schoolLogo: user.school_logo || null,
          schoolFooter: user.school_footer || null,
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
      const isSuperAdmin = adminType === 1 || user.role_name === 'Super Admin';
      const roleName = isSuperAdmin ? 'Super Admin' : (user.role_name || 'Staff');
      const permissions = isSuperAdmin ? {} : await PermissionModel.getUserPermissionMap(user.role_id);
      const sub = await SubscriptionModel.getSchoolSubscription(user.school_id);

      return ApiResponse.success(res, 'Admin profile fetched successfully.', {
        authSource: req.authSource || 'authenticated',
        user: {
          id: user.id,
          schoolName: user.school_name || '',
          schoolLogo: user.school_logo || null,
          schoolFooter: user.school_footer || null,
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

