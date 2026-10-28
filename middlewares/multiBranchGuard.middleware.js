const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

/**
 * Multi-Branch Guard Middleware
 * Restricts multi-branch operations (e.g., creating additional branches, switching main campus)
 * to schools registered as 'multiple' in school_master.registration_type.
 *
 * The registration type is always read fresh from the database (never from the JWT),
 * so a stale or tampered token cannot bypass this check.
 * Fails closed: if the school cannot be verified, the request is rejected.
 */
async function multiBranchGuard(req, res, next) {
  try {
    const schoolId = Number(req.user?.schoolId || req.user?.school_id);
    if (!schoolId) {
      return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
    }

    const [rows] = await pool.query(
      'SELECT registration_type FROM school_master WHERE id = ? LIMIT 1',
      [schoolId]
    );
    const registrationType = String(rows[0]?.registration_type || 'single').toLowerCase();

    if (registrationType !== 'multiple') {
      return ApiResponse.error(
        res,
        'This school is registered as a single campus. Multi-branch management is not available.',
        { code: 'MULTI_BRANCH_NOT_ENABLED', registration_type: registrationType },
        403
      );
    }

    req.registrationType = registrationType;
    next();
  } catch (error) {
    console.error('[Multi-Branch Guard Error]:', error.message);
    return ApiResponse.error(res, 'Unable to verify school registration type.', null, 500);
  }
}

module.exports = multiBranchGuard;
