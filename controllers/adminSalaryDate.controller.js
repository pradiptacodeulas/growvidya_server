const SalaryDateModel = require('../models/salaryDate.model');
const ApiResponse = require('../utils/api.response');

class AdminSalaryDateController {
  static getSchoolId(req) {
    return Number(req.user?.schoolId || req.user?.school_id || 1);
  }

  static async getSalaryDates(req, res, next) {
    try {
      const schoolId = AdminSalaryDateController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { page = 1, limit = 10, search = '', salary_month = null } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const [{ total, rows }, activeSetting] = await Promise.all([
        SalaryDateModel.getAllSalaryDates(schoolId, {
          search,
          limit,
          offset,
          branchId,
        }),
        SalaryDateModel.getActiveSalaryDateSetting(schoolId, branchId, salary_month),
      ]);

      return ApiResponse.success(res, 'Salary dates fetched successfully.', {
        salaryDates: rows,
        activeSalaryDate: activeSetting,
        configured_salary_date: activeSetting?.configured_salary_date || null,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async createSalaryDate(req, res, next) {
    try {
      const schoolId = AdminSalaryDateController.getSchoolId(req);
      const branchId = req.body.branch_id !== undefined ? req.body.branch_id : (req.branchId || req.query.branch_id || req.query.branchId || null);
      const { salary_date, status = 1 } = req.body;
      if (!salary_date) {
        return ApiResponse.error(res, 'Salary date is required.', 400);
      }

      const newId = await SalaryDateModel.createSalaryDate(schoolId, { branch_id: branchId, salary_date, status });
      const activeSetting = await SalaryDateModel.getActiveSalaryDateSetting(schoolId, branchId);
      return ApiResponse.success(res, 'Salary date added successfully.', {
        id: newId,
        activeSalaryDate: activeSetting,
        configured_salary_date: activeSetting?.configured_salary_date || salary_date,
      }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateSalaryDate(req, res, next) {
    try {
      const schoolId = AdminSalaryDateController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;
      const { salary_date, status = 1, branch_id } = req.body;
      if (!salary_date) {
        return ApiResponse.error(res, 'Salary date is required.', 400);
      }

      const existing = await SalaryDateModel.getSalaryDateById(id, schoolId, branchId);
      if (!existing) {
        return ApiResponse.error(res, 'Salary date record not found.', 404);
      }

      await SalaryDateModel.updateSalaryDate(id, schoolId, { branch_id: branch_id !== undefined ? branch_id : branchId, salary_date, status }, branchId);
      const activeSetting = await SalaryDateModel.getActiveSalaryDateSetting(schoolId, branchId);
      return ApiResponse.success(res, 'Salary date updated successfully.', {
        activeSalaryDate: activeSetting,
        configured_salary_date: activeSetting?.configured_salary_date || salary_date,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteSalaryDate(req, res, next) {
    try {
      const schoolId = AdminSalaryDateController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;

      const existing = await SalaryDateModel.getSalaryDateById(id, schoolId, branchId);
      if (!existing) {
        return ApiResponse.error(res, 'Salary date record not found.', 404);
      }

      await SalaryDateModel.deleteSalaryDate(id, schoolId, branchId);
      return ApiResponse.success(res, 'Salary date deleted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminSalaryDateController;
