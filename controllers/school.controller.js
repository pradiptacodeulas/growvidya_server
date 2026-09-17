const GeneralSettingModel = require('../models/generalSetting.model');
const { verifyToken } = require('../utils/jwt.util');
const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

class SchoolController {
  /**
   * Fetch school configuration (branding, logos, name, footer) for public or authenticated consumers
   */
  static async getSchoolConfig(req, res, next) {
    try {
      let schoolId = null;

      // 1. Check query parameter explicitly passed by client
      if (req.query?.school_id) {
        const parsedId = Number(req.query.school_id);
        if (parsedId > 0) schoolId = parsedId;
      }

      // 2. If not specified in query, extract dynamically from session token
      if (!schoolId) {
        let token = null;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
          token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies || req.signedCookies) {
          token =
            req.cookies?.growvidya_session ||
            req.signedCookies?.growvidya_session ||
            req.cookies?.growvidya_admin_session ||
            req.cookies?.growvidya_teacher_session ||
            req.cookies?.growvidya_parent_session ||
            req.cookies?.growvidya_student_session ||
            req.cookies?.token ||
            req.signedCookies?.token ||
            null;
        }

        if (token) {
          const decoded = verifyToken(token);
          if (decoded?.schoolId || decoded?.school_id) {
            schoolId = Number(decoded.schoolId || decoded.school_id);
          }
        }
      }

      // 3. If unauthenticated, fallback to the first active school in school_master
      if (!schoolId) {
        const [firstSchool] = await pool.query(
          'SELECT id FROM school_master WHERE status = 1 ORDER BY id ASC LIMIT 1'
        );
        schoolId = firstSchool[0]?.id || 1;
      }

      const configData = await GeneralSettingModel.getSchoolConfig(schoolId);
      return ApiResponse.success(res, 'School configuration fetched successfully.', configData);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SchoolController;
