const BranchModel = require('../models/branch.model');
const ApiResponse = require('../utils/api.response');

class BranchController {
  /**
   * Helper to get schoolId from req.user
   */
  static getSchoolId(req) {
    return Number(req.user?.schoolId || req.user?.school_id) || 1;
  }

  /**
   * Get all branches for current user's school
   */
  static async getBranches(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { status } = req.query;

      const branches = await BranchModel.getAllBranches({
        school_id: schoolId,
        status: status !== undefined ? status : null,
      });

      return ApiResponse.success(res, 'Branches retrieved successfully.', branches);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get branch summary with statistics
   */
  static async getBranchesSummary(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const summary = await BranchModel.getBranchesSummary(schoolId);
      return ApiResponse.success(res, 'Branches summary retrieved successfully.', summary);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single branch details by ID
   */
  static async getBranchById(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      const branch = await BranchModel.getBranchById(Number(id), schoolId);
      if (!branch) {
        return ApiResponse.error(res, 'Branch not found.', null, 404);
      }

      return ApiResponse.success(res, 'Branch details retrieved.', branch);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new branch
   */
  static async createBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const {
        branch_name,
        branch_code,
        address,
        country_id,
        state_id,
        city_id,
        pincode,
        phone,
        email,
        principal_name,
        is_main_branch,
        status,
      } = req.body;

      if (!branch_name || !branch_code) {
        return ApiResponse.error(res, 'Branch name and branch code are required.', null, 400);
      }

      // Check if branch code already exists for this school
      const existing = await BranchModel.getAllBranches({ school_id: schoolId });
      const duplicateCode = existing.some(
        (b) => b.branch_code?.toLowerCase() === String(branch_code).trim().toLowerCase()
      );
      if (duplicateCode) {
        return ApiResponse.error(res, `Branch code "${branch_code}" is already in use in this school.`, null, 400);
      }

      const newBranch = await BranchModel.createBranch({
        school_id: schoolId,
        branch_name,
        branch_code,
        address,
        country_id,
        state_id,
        city_id,
        pincode,
        phone,
        email,
        principal_name,
        is_main_branch,
        status,
      });

      return ApiResponse.success(res, 'Branch created successfully.', newBranch, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update an existing branch
   */
  static async updateBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      const existing = await BranchModel.getBranchById(Number(id), schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Branch not found.', null, 404);
      }

      // If branch_code is being changed, check for duplicate
      if (req.body.branch_code && req.body.branch_code.trim().toUpperCase() !== existing.branch_code) {
        const allBranches = await BranchModel.getAllBranches({ school_id: schoolId });
        const duplicate = allBranches.some(
          (b) =>
            b.id !== Number(id) &&
            b.branch_code?.toLowerCase() === req.body.branch_code.trim().toLowerCase()
        );
        if (duplicate) {
          return ApiResponse.error(
            res,
            `Branch code "${req.body.branch_code}" is already in use by another branch.`,
            null,
            400
          );
        }
      }

      await BranchModel.updateBranch(Number(id), schoolId, req.body);
      const updated = await BranchModel.getBranchById(Number(id), schoolId);

      return ApiResponse.success(res, 'Branch updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Set a branch as the main campus
   */
  static async setMainBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      const success = await BranchModel.setMainBranch(Number(id), schoolId);
      if (!success) {
        return ApiResponse.error(res, 'Failed to set main branch.', null, 400);
      }

      return ApiResponse.success(res, 'Primary main branch updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a branch
   */
  static async deleteBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      await BranchModel.deleteBranch(Number(id), schoolId);
      return ApiResponse.success(res, 'Branch deleted successfully.');
    } catch (error) {
      return ApiResponse.error(res, error.message || 'Failed to delete branch.', null, 400);
    }
  }

  /**
   * Get countries list from countries table
   */
  static async getCountries(req, res, next) {
    try {
      const countries = await BranchModel.getCountries();
      return ApiResponse.success(res, 'Countries retrieved successfully.', countries);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get states list for country
   */
  static async getStates(req, res, next) {
    try {
      const countryId = req.query.country_id || req.query.countryId;
      const states = await BranchModel.getStates(countryId);
      return ApiResponse.success(res, 'States retrieved successfully.', states);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get cities list for state
   */
  static async getCities(req, res, next) {
    try {
      const stateId = req.query.state_id || req.query.stateId;
      const cities = await BranchModel.getCities(stateId);
      return ApiResponse.success(res, 'Cities retrieved successfully.', cities);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = BranchController;
