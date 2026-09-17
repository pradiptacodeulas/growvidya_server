const PayrollModel = require('../models/payroll.model');
const ApiResponse = require('../utils/api.response');

class AdminPayrollController {
  static async getBeneficiaries(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { search } = req.query;
      const beneficiaries = await PayrollModel.getAllBeneficiaries(schoolId, { search });
      return ApiResponse.success(res, 'Beneficiaries retrieved successfully.', { beneficiaries });
    } catch (err) {
      next(err);
    }
  }

  static async getBeneficiaryById(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { id } = req.params;
      const beneficiary = await PayrollModel.getBeneficiaryById(schoolId, id);
      if (!beneficiary) {
        return ApiResponse.notFound(res, 'Beneficiary record not found.');
      }
      return ApiResponse.success(res, 'Beneficiary retrieved successfully.', { beneficiary });
    } catch (err) {
      next(err);
    }
  }

  static async createBeneficiary(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to manage beneficiaries.');
      }
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { user_type, employee_id, basic_salary, bank_name, account_name, account_no, ifsc_code, branch_name } = req.body;

      if (!user_type || !String(user_type).trim()) {
        return ApiResponse.badRequest(res, 'User type is required.');
      }
      if (!employee_id || !String(employee_id).trim()) {
        return ApiResponse.badRequest(res, 'Employee is required.');
      }
      if (!basic_salary || isNaN(basic_salary) || Number(basic_salary) <= 0) {
        return ApiResponse.badRequest(res, 'Valid basic salary amount is required.');
      }
      if (
        !bank_name || !String(bank_name).trim() ||
        !account_name || !String(account_name).trim() ||
        !account_no || !String(account_no).trim() ||
        !ifsc_code || !String(ifsc_code).trim() ||
        !branch_name || !String(branch_name).trim()
      ) {
        return ApiResponse.badRequest(res, 'All bank details are required.');
      }

      const existing = await PayrollModel.getBeneficiaryByUserAndEmployee(schoolId, user_type, employee_id);
      if (existing) {
        return ApiResponse.badRequest(res, 'A beneficiary record already exists for this employee.');
      }

      const insertId = await PayrollModel.createBeneficiary(schoolId, req.body);
      return ApiResponse.created(res, 'Beneficiary created successfully.', { id: insertId });
    } catch (err) {
      next(err);
    }
  }

  static async updateBeneficiary(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to manage beneficiaries.');
      }
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { id } = req.params;
      const { user_type, employee_id, basic_salary, bank_name, account_name, account_no, ifsc_code, branch_name } = req.body;

      if (!user_type || !String(user_type).trim()) {
        return ApiResponse.badRequest(res, 'User type is required.');
      }
      if (!employee_id || !String(employee_id).trim()) {
        return ApiResponse.badRequest(res, 'Employee is required.');
      }
      if (!basic_salary || isNaN(basic_salary) || Number(basic_salary) <= 0) {
        return ApiResponse.badRequest(res, 'Valid basic salary amount is required.');
      }
      if (
        !bank_name || !String(bank_name).trim() ||
        !account_name || !String(account_name).trim() ||
        !account_no || !String(account_no).trim() ||
        !ifsc_code || !String(ifsc_code).trim() ||
        !branch_name || !String(branch_name).trim()
      ) {
        return ApiResponse.badRequest(res, 'All bank details are required.');
      }

      const existing = await PayrollModel.getBeneficiaryByUserAndEmployee(schoolId, user_type, employee_id, id);
      if (existing) {
        return ApiResponse.badRequest(res, 'A beneficiary record already exists for this employee.');
      }

      await PayrollModel.updateBeneficiary(schoolId, id, req.body);
      return ApiResponse.success(res, 'Beneficiary updated successfully.');
    } catch (err) {
      next(err);
    }
  }

  static async deleteBeneficiary(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to manage beneficiaries.');
      }
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { id } = req.params;
      await PayrollModel.deleteBeneficiary(schoolId, id);
      return ApiResponse.success(res, 'Beneficiary deleted successfully.');
    } catch (err) {
      next(err);
    }
  }

  static async getEmployeesByType(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { user_type } = req.query;
      const employees = await PayrollModel.getEmployeesByType(schoolId, user_type);
      return ApiResponse.success(res, 'Employees retrieved successfully.', { employees });
    } catch (err) {
      next(err);
    }
  }

  static async getSalaries(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { search } = req.query;

      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      const teacherId = req.user?.teacherId || req.user?.userId;

      let filters = { search };
      if (isTeacher && teacherId) {
        filters.user_type = 2; // Teacher
        filters.employee_id = teacherId;
      }

      const salaries = await PayrollModel.getAllSalaries(schoolId, filters);
      return ApiResponse.success(res, 'Salaries retrieved successfully.', { salaries });
    } catch (err) {
      next(err);
    }
  }

  static async createSalary(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to create salary records.');
      }
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const insertId = await PayrollModel.createSalary(schoolId, req.body);
      return ApiResponse.created(res, 'Salary record created successfully.', { id: insertId });
    } catch (err) {
      next(err);
    }
  }

  static async updateSalaryStatus(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to modify salary status.');
      }
      const schoolId = req.user?.schoolId || req.user?.school_id || 1;
      const { id } = req.params;
      const { payment_status } = req.body;
      await PayrollModel.updateSalaryStatus(schoolId, id, payment_status);
      return ApiResponse.success(res, 'Salary payment status updated successfully.');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = AdminPayrollController;
