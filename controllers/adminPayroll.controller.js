const PayrollModel = require('../models/payroll.model');
const ApiResponse = require('../utils/api.response');

class AdminPayrollController {
  static getSchoolId(req) {
    const schoolId = req.user?.schoolId || req.user?.school_id;
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }
    return Number(schoolId);
  }

  static async getBeneficiaries(req, res, next) {
    try {
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { search, user_type } = req.query;
      const beneficiaries = await PayrollModel.getAllBeneficiaries(schoolId, { search, user_type, branchId });
      return ApiResponse.success(res, 'Beneficiaries retrieved successfully.', { beneficiaries });
    } catch (err) {
      next(err);
    }
  }

  static async getBeneficiaryById(req, res, next) {
    try {
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;
      const beneficiary = await PayrollModel.getBeneficiaryById(schoolId, id, branchId);
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
      const schoolId = AdminPayrollController.getSchoolId(req);
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

      const branchId = req.branchId || req.body?.branch_id || null;
      const insertId = await PayrollModel.createBeneficiary(schoolId, { ...req.body, branch_id: branchId });
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
      const schoolId = AdminPayrollController.getSchoolId(req);
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

      const branchId = req.branchId || req.body?.branch_id || req.query.branch_id || req.query.branchId || null;
      await PayrollModel.updateBeneficiary(schoolId, id, { ...req.body, branch_id: branchId }, branchId);
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
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;
      await PayrollModel.deleteBeneficiary(schoolId, id, branchId);
      return ApiResponse.success(res, 'Beneficiary deleted successfully.');
    } catch (err) {
      next(err);
    }
  }

  static async getEmployeesByType(req, res, next) {
    try {
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { user_type, salary_month, payment_date, only_beneficiaries } = req.query;
      const targetMonth = salary_month || (payment_date ? String(payment_date).slice(0, 7) : null);
      const onlyBeneficiaries = String(only_beneficiaries) === '1' || String(only_beneficiaries).toLowerCase() === 'true';

      const [employees, salaryDateSetting] = await Promise.all([
        PayrollModel.getEmployeesByType(schoolId, user_type, branchId, targetMonth, {
          onlyBeneficiaries,
        }),
        PayrollModel.getConfiguredSalaryDate(schoolId, branchId, targetMonth),
      ]);

      return ApiResponse.success(res, 'Employees retrieved successfully.', {
        employees,
        configured_salary_date: salaryDateSetting?.configured_salary_date || null,
        salary_date_setting: salaryDateSetting || null,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getBulkSalaryCandidates(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to process bulk salary.');
      }
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { salary_month, payment_date, user_type, search } = req.query;
      const requestedMonth = salary_month || (payment_date ? String(payment_date).slice(0, 7) : null);
      const initialSetting = await PayrollModel.getConfiguredSalaryDate(schoolId, branchId, requestedMonth);
      const targetMonth = requestedMonth || initialSetting?.salary_month || new Date().toISOString().slice(0, 7);

      const [candidates, salaryDateSetting] = await Promise.all([
        PayrollModel.getBulkSalaryCandidates(schoolId, {
          salary_month: targetMonth,
          user_type: user_type || null,
          branchId,
          search: search || '',
        }),
        PayrollModel.getConfiguredSalaryDate(schoolId, branchId, targetMonth),
      ]);

      return ApiResponse.success(res, 'Bulk salary candidates retrieved successfully.', {
        salary_month: targetMonth,
        configured_salary_date: salaryDateSetting?.configured_salary_date || null,
        salary_date_setting: salaryDateSetting || null,
        candidates,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getSalaries(req, res, next) {
    try {
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { search, payment_status, salary_month, user_type } = req.query;

      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      const teacherId = req.user?.teacherId || req.user?.userId;

      let filters = { search, payment_status, salary_month, user_type, branchId };
      if (isTeacher && teacherId) {
        filters.user_type = 2; // Teacher
        filters.employee_id = teacherId;
      }

      const [salaries, salaryDateSetting] = await Promise.all([
        PayrollModel.getAllSalaries(schoolId, filters),
        PayrollModel.getConfiguredSalaryDate(schoolId, branchId, salary_month),
      ]);
      return ApiResponse.success(res, 'Salaries retrieved successfully.', {
        salaries,
        configured_salary_date: salaryDateSetting?.configured_salary_date || null,
        salary_date_setting: salaryDateSetting || null,
      });
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
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || null;
      const insertId = await PayrollModel.createSalary(schoolId, { ...req.body, branch_id: branchId });
      return ApiResponse.created(res, 'Salary record created successfully.', { id: insertId });
    } catch (err) {
      next(err);
    }
  }

  static async processBulkSalary(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to process bulk salary payments.');
      }
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || null;
      const result = await PayrollModel.processBulkSalary(schoolId, {
        ...req.body,
        branch_id: branchId,
      });

      const { summary } = result;
      const msg = `Bulk salary processed: ${summary.successful} paid, ${summary.pending} pending, ${summary.failed} failed${
        summary.skipped_already_paid > 0 ? `, ${summary.skipped_already_paid} skipped (already paid)` : ''
      }.`;
      return ApiResponse.success(res, msg, result);
    } catch (err) {
      next(err);
    }
  }

  static async retryFailedSalaries(req, res, next) {
    try {
      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal' || req.user?.role === 'Teacher' || Boolean(req.user?.teacherId);
      if (isTeacher) {
        return ApiResponse.forbidden(res, 'Teachers do not have permission to retry salary payments.');
      }
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || req.query.branch_id || req.query.branchId || null;
      const result = await PayrollModel.retryFailedSalaries(schoolId, {
        salary_ids: req.body?.salary_ids || req.body?.id || [],
        payment_date: req.body?.payment_date || null,
        branchId,
      });

      const { summary } = result;
      const msg =
        summary.successful > 0
          ? `Retry complete: ${summary.successful} payment(s) succeeded${summary.failed > 0 ? `, ${summary.failed} still failed` : ''}.`
          : `Retry could not complete (${summary.failed} failed, ${summary.skipped_already_paid} already paid).`;
      return ApiResponse.success(res, msg, result);
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
      const schoolId = AdminPayrollController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;
      const { payment_status } = req.body;
      await PayrollModel.updateSalaryStatus(schoolId, id, payment_status, branchId);
      return ApiResponse.success(res, 'Salary payment status updated successfully.');
    } catch (err) {
      next(err);
    }
  }
}

module.exports = AdminPayrollController;
