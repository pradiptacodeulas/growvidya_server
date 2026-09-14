const DashboardModel = require('../models/dashboard.model');
const ApiResponse = require('../utils/api.response');

class AdminDashboardController {
  static async getStats(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const branchId = req.branchId || req.query.branch_id || null;
      const stats = await DashboardModel.getDashboardStats(schoolId, branchId);
      return ApiResponse.success(res, 'Dashboard stats fetched successfully.', stats);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminDashboardController;
