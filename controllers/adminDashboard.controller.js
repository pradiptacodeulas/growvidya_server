const DashboardModel = require('../models/dashboard.model');
const ApiResponse = require('../utils/api.response');

class AdminDashboardController {
  static async getStats(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }
      const branchId = req.branchId || req.user?.branch_id || req.query.branch_id || null;
      const stats = await DashboardModel.getDashboardStats(schoolId, branchId);
      return ApiResponse.success(res, 'Dashboard stats fetched successfully.', stats);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminDashboardController;
