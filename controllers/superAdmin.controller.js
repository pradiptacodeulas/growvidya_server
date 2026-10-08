const SuperAdminModel = require('../models/superAdmin.model');
const ApiResponse = require('../utils/api.response');

class SuperAdminController {
  /**
   * Get Super Admin Organization Dashboard Stats
   * Supports optional ?branch_id= query to filter stats to a specific campus
   */
  static async getDashboard(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }

      const branchId = req.query.branch_id || null;
      const stats = await SuperAdminModel.getOrganizationStats(schoolId, branchId);
      return ApiResponse.success(res, 'Organization dashboard stats fetched successfully.', stats);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Branch Performance List for Organization
   */
  static async getBranches(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }

      const branches = await SuperAdminModel.getBranchesPerformance(schoolId);
      return ApiResponse.success(res, 'Branches performance retrieved successfully.', branches);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Branch Details for Drill-down View
   */
  static async getBranchById(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }

      const branchId = req.params.id;
      if (!branchId) {
        return ApiResponse.error(res, 'Branch ID parameter is required.', null, 400);
      }

      const details = await SuperAdminModel.getBranchDetails(schoolId, branchId);
      if (!details) {
        return ApiResponse.error(res, 'Branch not found or access denied.', null, 404);
      }

      return ApiResponse.success(res, 'Branch details retrieved successfully.', details);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Consolidated Storage Breakdown
   */
  static async getStorage(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }

      const storage = await SuperAdminModel.getStorageBreakdown(schoolId);
      return ApiResponse.success(res, 'Organization storage metrics fetched successfully.', storage);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Subscription Limits and Usage
   */
  static async getSubscription(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }

      const subscription = await SuperAdminModel.getSubscriptionUsage(schoolId);
      return ApiResponse.success(res, 'Subscription usage metrics fetched successfully.', subscription);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SuperAdminController;
