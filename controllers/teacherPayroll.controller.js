const PayrollModel = require('../models/payroll.model');
const ApiResponse = require('../utils/api.response');

class TeacherPayrollController {
  static getTeacherId(req) {
    return req.user?.teacherId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    const schoolId = req.user?.schoolId || req.user?.school_id;
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }
    return Number(schoolId);
  }

  static async getMySalaries(req, res, next) {
    try {
      const schoolId = TeacherPayrollController.getSchoolId(req);
      const teacherId = TeacherPayrollController.getTeacherId(req);
      const { search } = req.query;

      const filters = {
        search,
        user_type: 2, // 2 = Teacher
        employee_id: teacherId,
      };

      const salaries = await PayrollModel.getAllSalaries(schoolId, filters);
      return ApiResponse.success(res, 'Teacher salaries retrieved successfully.', { salaries });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = TeacherPayrollController;
