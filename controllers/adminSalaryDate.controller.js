const SalaryDateModel = require('../models/salaryDate.model');
const ApiResponse = require('../utils/api.response');

class AdminSalaryDateController {
  static async getSalaryDates(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { page = 1, limit = 10, search = '' } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const { total, rows } = await SalaryDateModel.getAllSalaryDates(schoolId, {
        search,
        limit,
        offset,
      });

      return ApiResponse.success(res, 'Salary dates fetched successfully.', {
        salaryDates: rows,
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
      const schoolId = req.user.schoolId;
      const { salary_date, status = 1 } = req.body;
      if (!salary_date) {
        return ApiResponse.error(res, 'Salary date is required.', 400);
      }

      const newId = await SalaryDateModel.createSalaryDate(schoolId, { salary_date, status });
      return ApiResponse.success(res, 'Salary date added successfully.', { id: newId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateSalaryDate(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { salary_date, status = 1 } = req.body;
      if (!salary_date) {
        return ApiResponse.error(res, 'Salary date is required.', 400);
      }

      const existing = await SalaryDateModel.getSalaryDateById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Salary date record not found.', 404);
      }

      await SalaryDateModel.updateSalaryDate(id, schoolId, { salary_date, status });
      return ApiResponse.success(res, 'Salary date updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteSalaryDate(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const existing = await SalaryDateModel.getSalaryDateById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Salary date record not found.', 404);
      }

      await SalaryDateModel.deleteSalaryDate(id, schoolId);
      return ApiResponse.success(res, 'Salary date deleted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminSalaryDateController;
