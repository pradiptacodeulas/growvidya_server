const { verifyToken } = require('../utils/jwt.util');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');

const saasAdminAuthMiddleware = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization Header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // Check Cookies
    if (!token && req.cookies) {
      token = req.cookies.growvidya_saas_admin_session || req.cookies.saas_admin_token;
    }

    if (!token) {
      return ApiResponse.error(res, 'Authentication required. No session token provided.', null, 401);
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return ApiResponse.error(res, 'Invalid or expired session token. Please log in again.', null, 401);
    }

    if (!decoded || decoded.portalType !== 'SaaSAdminPortal') {
      return ApiResponse.error(res, 'Access denied. Invalid portal credentials.', null, 403);
    }

    // Verify user exists and is active in database
    const [rows] = await pool.query(
      'SELECT id, first_name, last_name, gender, profile_image, phone_number, name, email, role, status, created_at FROM saas_admin_users WHERE id = ? AND status = 1 LIMIT 1',
      [decoded.userId]
    );

    if (rows.length === 0) {
      return ApiResponse.error(res, 'SaaS Admin account not found or deactivated.', null, 403);
    }

    req.saasAdmin = rows[0];
    next();
  } catch (error) {
    console.error('saasAdminAuthMiddleware error:', error);
    return ApiResponse.error(res, 'Internal server error during authentication.', null, 500);
  }
};

module.exports = saasAdminAuthMiddleware;
