const { verifyToken } = require('../utils/jwt.util');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');

const saasAdminAuthMiddleware = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization Header
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader) {
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        token = authHeader.substring(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    // Check Custom Headers
    if (!token) {
      token =
        req.headers['x-access-token'] ||
        req.headers['x-auth-token'] ||
        req.headers['token'] ||
        req.headers['auth-token'];
    }

    // Check Query Param
    if (!token && req.query) {
      token = req.query.token || req.query.auth_token;
    }

    // Check Cookies only for browser sessions (do NOT silently fall back to cookies in Postman when auth header is missing)
    const isPostman = Boolean(
      req.headers['postman-token'] ||
      (typeof req.headers['user-agent'] === 'string' && req.headers['user-agent'].includes('PostmanRuntime'))
    );

    if (!token && !isPostman && (req.cookies || req.signedCookies)) {
      const getCookie = (name) => req.cookies?.[name] || req.signedCookies?.[name];
      token =
        getCookie('growvidya_saas_admin_session') ||
        getCookie('saas_admin_token') ||
        getCookie('token') ||
        getCookie('session_token');
    }

    if (!token) {
      return ApiResponse.error(
        res,
        'Authentication required. Please provide a valid Bearer token in the Authorization header.',
        null,
        401
      );
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return ApiResponse.error(res, 'Invalid or expired session token. Please log in again.', null, 401);
    }

    if (!decoded || decoded.portalType !== 'SaaSAdminPortal') {
      return ApiResponse.error(
        res,
        'Access denied. Only authorized SaaS administrators can access this data.',
        null,
        403
      );
    }

    const adminId = decoded.userId || decoded.id;
    const [rows] = await pool.query(
      'SELECT id, first_name, last_name, gender, profile_image, phone_number, email, role, status, created_at FROM saas_admin_users WHERE id = ? AND status = 1 LIMIT 1',
      [adminId]
    );

    if (rows.length === 0) {
      return ApiResponse.error(res, 'Access denied. SaaS Admin account not found or deactivated.', null, 403);
    }

    req.saasAdmin = rows[0];
    next();
  } catch (error) {
    console.error('saasAdminAuthMiddleware error:', error);
    return ApiResponse.error(res, 'Internal server error during authentication.', null, 500);
  }
};

module.exports = saasAdminAuthMiddleware;
