const { verifyToken } = require('../utils/jwt.util');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');

/**
 * Authentication Middleware for Coupon Management APIs
 * Accepts:
 * 1. SaaS Master Admin Bearer token / cookies (portalType: 'SaaSAdminPortal')
 * 2. School Admin / System Staff Bearer token / cookies
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

    // 4. Check Session Cookies (unsigned & signed) - do NOT silently use cookies in Postman without auth header
    const isPostman = Boolean(
      req.headers['postman-token'] ||
      (typeof req.headers['user-agent'] === 'string' && req.headers['user-agent'].includes('PostmanRuntime'))
    );

    if (!token && !isPostman && (req.cookies || req.signedCookies)) {
      const getCookie = (name) => req.cookies?.[name] || req.signedCookies?.[name];
      token =
        getCookie('growvidya_saas_admin_session') ||
        getCookie('saas_admin_token') ||
        getCookie('growvidya_admin_session') ||
        getCookie('growvidya_session') ||
        getCookie('token') ||
        getCookie('session_token');
    }

    if (!token) {
      return ApiResponse.error(
        res,
        'Access denied. Authentication required. Please provide a Bearer token or sign in.',
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

    // Verify SaaS Admin account if it is a SaaS Admin token
    const userId = decoded.userId || decoded.id;
    if (decoded.portalType === 'SaaSAdminPortal' && userId) {
      const [adminRows] = await pool.query(
        'SELECT id, first_name, last_name, email, role, status FROM saas_admin_users WHERE id = ? AND status = 1 LIMIT 1',
        [userId]
      );
      if (adminRows.length === 0) {
        return ApiResponse.error(res, 'SaaS Admin account not found or deactivated.', null, 403);
      }
      req.saasAdmin = adminRows[0];
    }

    req.user = decoded;
    return next();
  } catch (error) {
    console.error('couponAuthMiddleware error:', error);
    return ApiResponse.error(res, 'Internal server error during authentication.', null, 500);
  }
};

module.exports = couponAuthMiddleware;
