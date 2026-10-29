const { verifyToken } = require('../utils/jwt.util');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');

/**
 * Strict SaaS Master Admin Authentication Middleware for Catalog & Coupon Management APIs.
 * Only accepts active SaaS Master Admin tokens (portalType: 'SaaSAdminPortal').
 * School Admin, Teacher, Parent, and Student tokens are strictly rejected with 403 Forbidden.
 */
const couponAuthMiddleware = async (req, res, next) => {
  try {
    let token = null;

    // 1. Check HTTP Authorization Header
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader) {
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        token = authHeader.substring(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    // 2. Check Custom Authentication Headers
    if (!token) {
      token =
        req.headers['x-access-token'] ||
        req.headers['x-auth-token'] ||
        req.headers['token'] ||
        req.headers['auth-token'];
    }

    // 3. Check Query parameter token
    if (!token && req.query) {
      token = req.query.token || req.query.auth_token || req.query.access_token;
    }

    // 4. Check SaaS Admin Session Cookies only
    const isPostman = Boolean(
      req.headers['postman-token'] ||
      (typeof req.headers['user-agent'] === 'string' && req.headers['user-agent'].includes('PostmanRuntime'))
    );

    if (!token && !isPostman && (req.cookies || req.signedCookies)) {
      const getCookie = (name) => req.cookies?.[name] || req.signedCookies?.[name];
      token =
        getCookie('growvidya_saas_admin_session') ||
        getCookie('saas_admin_token');
    }

    if (!token) {
      return ApiResponse.error(
        res,
        'Access denied. SaaS Super Admin authentication required.',
        null,
        401
      );
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return ApiResponse.error(
        res,
        'Invalid or expired authentication session/token. Please log in again.',
        null,
        401
      );
    }

    // Strictly enforce SaaSAdminPortal identity — prevent privilege escalation from school/student/teacher tokens
    const userId = decoded.userId || decoded.id;
    if (decoded.portalType !== 'SaaSAdminPortal' || !userId) {
      return ApiResponse.error(
        res,
        'Forbidden: Only authorized SaaS Super Administrators can access or modify platform catalogs and coupons.',
        null,
        403
      );
    }

    const [adminRows] = await pool.query(
      'SELECT id, first_name, last_name, email, role, role_id, status FROM saas_admin_users WHERE id = ? AND status = 1 LIMIT 1',
      [userId]
    );
    if (adminRows.length === 0) {
      return ApiResponse.error(res, 'SaaS Admin account not found or deactivated.', null, 403);
    }

    req.saasAdmin = adminRows[0];
    req.user = decoded;
    return next();
  } catch (error) {
    console.error('couponAuthMiddleware error:', error);
    return ApiResponse.error(res, 'Internal server error during authentication.', null, 500);
  }
};

module.exports = couponAuthMiddleware;
