const TeacherModel = require('../models/teacher.model');
const SubscriptionModel = require('../models/subscription.model');
const ApiResponse = require('../utils/api.response');

class AdminTeacherController {
  static getSchoolId(req) {
    return req.user?.schoolId;
  }

  static async getAllTeachers(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const paramsSrc = { ...req.query, ...req.body };

      const search = paramsSrc.search || paramsSrc.name || '';
      const email = paramsSrc.email || '';
      const status = paramsSrc.status !== undefined ? paramsSrc.status : '';
      const branchId = req.branchId || paramsSrc.branch_id || paramsSrc.branchId || null;
      const page = Number(paramsSrc.page) || 1;
      const limit = Number(paramsSrc.limit) || 12;
      const offset = (page - 1) * limit;

      const { teachers, total } = await TeacherModel.getAllTeachers(schoolId, {
        search: String(search).trim(),
        email: String(email).trim(),
        status,
        branchId,
        limit,
        offset,
      });

      const totalPages = Math.ceil(total / limit) || 1;
      const hasMore = page < totalPages;

      return ApiResponse.success(res, 'Teachers retrieved successfully.', {
        teachers,
        total,
        page,
        limit,
        totalPages,
        hasMore,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getTeacherOptions(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const options = await TeacherModel.getTeacherOptions(schoolId);
      return ApiResponse.success(res, 'Teacher options retrieved successfully.', options);
    } catch (error) {
      next(error);
    }
  }

  static async checkEmail(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const email = req.body?.email || req.query?.email || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;
      if (!email) {
        return ApiResponse.success(res, 'Email is valid.', { exists: false });
      }
      const exists = await TeacherModel.checkEmail(schoolId, email, excludeId);
      return ApiResponse.success(res, exists ? 'Email address already exists.' : 'Email is available.', {
        exists,
        message: exists ? 'Email address already registered' : '',
      });
    } catch (error) {
      next(error);
    }
  }

  static async checkPhone(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const phone = req.body?.phone || req.query?.phone || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;
      if (!phone) {
        return ApiResponse.success(res, 'Phone is valid.', { exists: false });
      }
      const exists = await TeacherModel.checkPhone(schoolId, phone, excludeId);
      return ApiResponse.success(res, exists ? 'Mobile number already exists.' : 'Mobile number is available.', {
        exists,
        message: exists ? 'Mobile number already registered' : '',
      });
    } catch (error) {
      next(error);
    }
  }

  static async checkDuplicate(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const email = req.body?.email || req.query?.email || '';
      const phone = req.body?.phone || req.query?.phone || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;

      const { isEmailDuplicate, isPhoneDuplicate } = await TeacherModel.checkDuplicate(
        schoolId,
        { email, phone },
        excludeId
      );

      return ApiResponse.success(res, 'Duplicate check completed.', {
        isEmailDuplicate,
        isPhoneDuplicate,
        message: isEmailDuplicate
          ? 'Email address already registered'
          : isPhoneDuplicate
          ? 'Mobile number already registered'
          : '',
      });
    } catch (error) {
      next(error);
    }
  }

  static async getTeacherById(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const teacher = await TeacherModel.getTeacherById(req.params.id, schoolId);
      if (!teacher) return ApiResponse.error(res, 'Teacher not found.', null, 404);
      return ApiResponse.success(res, 'Teacher details retrieved.', teacher);
    } catch (error) {
      next(error);
    }
  }

  static async createTeacher(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);

      // Enforce subscription plan teacher/staff quota
      const quotaCheck = await SubscriptionModel.checkQuota(schoolId, 'teachers');
      if (!quotaCheck.allowed) {
        return ApiResponse.error(
          res,
          quotaCheck.message,
          {
            code: 'TEACHER_QUOTA_EXCEEDED',
            quota: quotaCheck,
          },
          403
        );
      }

      const branchId = req.body.branch_id || req.body.branchId || req.branchId || null;
      const insertId = await TeacherModel.createTeacher(schoolId, {
        ...req.body,
        branch_id: branchId,
      });
      return ApiResponse.success(res, 'Teacher registered successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateTeacher(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const branchId = req.body.branch_id || req.body.branchId || undefined;
      const updated = await TeacherModel.updateTeacher(req.params.id, schoolId, {
        ...req.body,
        ...(branchId !== undefined ? { branch_id: branchId } : {}),
      });
      if (!updated) return ApiResponse.error(res, 'Teacher record not found.', null, 404);
      return ApiResponse.success(res, 'Teacher updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteTeacher(req, res, next) {
    try {
      const schoolId = AdminTeacherController.getSchoolId(req);
      const deleted = await TeacherModel.deleteTeacher(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Teacher record not found.', null, 404);
      return ApiResponse.success(res, 'Teacher deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminTeacherController;
