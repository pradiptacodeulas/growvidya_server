const GeneralSettingModel = require('../models/generalSetting.model');
const { verifyToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');

class SchoolController {
  /**
   * Fetch non-sensitive school branding configuration (name, code, logo)
   * Strictly resolves schoolId from the authenticated session token.
   */
  static async getSchoolConfig(req, res, next) {
    try {
      let schoolId = Number(req.user?.schoolId || req.user?.school_id) || null;

      if (!schoolId) {
        let token = null;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
          token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies || req.signedCookies) {
          const getCookie = (name) => req.cookies?.[name] || req.signedCookies?.[name];
          const cookieName = config.cookie?.name || 'growvidya_session';
          token =
            getCookie('growvidya_admin_session') ||
            getCookie(cookieName) ||
            getCookie('growvidya_teacher_session') ||
            getCookie('growvidya_parent_session') ||
            getCookie('growvidya_student_session') ||
            getCookie('token') ||
            getCookie('session_token') ||
            null;
        }

        if (token) {
          const decoded = verifyToken(token);
          if (decoded?.schoolId || decoded?.school_id) {
            schoolId = Number(decoded.schoolId || decoded.school_id);
          }
        }
      }

      if (!schoolId) {
        return ApiResponse.error(res, 'Authentication required to fetch school configuration.', null, 401);
      }

      const configData = await GeneralSettingModel.getSchoolConfig(schoolId);
      if (!configData || !configData.id) {
        return ApiResponse.error(res, 'Active school configuration not found.', null, 404);
      }

      return ApiResponse.success(res, 'School configuration fetched successfully.', configData);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SchoolController;
