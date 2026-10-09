const ParentModel = require('../models/parent.model');
const ApiResponse = require('../utils/api.response');

class AdminParentController {
  static getSchoolId(req) {
    const schoolId = req.user?.schoolId || req.user?.school_id;
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }
    return Number(schoolId);
  }

  static async getAllParents(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const paramsSrc = { ...req.query, ...req.body };

      const search = paramsSrc.search || '';
      const name = paramsSrc.name || '';
      const email = paramsSrc.email || '';
      const classId = paramsSrc.classId || paramsSrc.class || paramsSrc.class_id || '';
      const sectionId = paramsSrc.sectionId || paramsSrc.section || paramsSrc.section_id || '';
      const page = paramsSrc.page || 1;
      const limit = paramsSrc.limit || 12;
      const offset = (Number(page) - 1) * Number(limit);

      const branchId = req.branchId || paramsSrc.branch_id || paramsSrc.branchId || null;

      const { parents, total } = await ParentModel.getAll(schoolId, {
        search: String(search).trim(),
        name: String(name).trim(),
        email: String(email).trim(),
        classId,
        sectionId,
        branchId,
        limit: Number(limit),
        offset,
      });

      return ApiResponse.success(res, 'Parents fetched successfully.', {
        parents,
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

  static async getParentById(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const parentId = req.params.id;

      const parent = await ParentModel.getById(parentId, schoolId, branchId);

      if (!parent) {
        return ApiResponse.error(res, 'Parent record not found.', null, 404);
      }

      return ApiResponse.success(res, 'Parent details fetched successfully.', { parent });
    } catch (error) {
      next(error);
    }
  }

  static async checkDuplicate(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || req.body?.branch_id || req.body?.branchId || null;
      const email = req.body?.email || req.query?.email || '';
      const phone = req.body?.phone || req.query?.phone || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;

      const { isEmailDuplicate, isPhoneDuplicate } = await ParentModel.checkDuplicate(
        schoolId,
        { email, phone },
        excludeId,
        branchId
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

  static async checkEmail(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || req.body?.branch_id || req.body?.branchId || null;
      const email = req.body?.email || req.query?.email || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;
      if (!email) {
        return ApiResponse.success(res, 'Email is valid.', { exists: false });
      }
      const exists = await ParentModel.checkEmail(schoolId, email, excludeId, branchId);
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
      const schoolId = AdminParentController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || req.body?.branch_id || req.body?.branchId || null;
      const phone = req.body?.phone || req.query?.phone || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;
      if (!phone) {
        return ApiResponse.success(res, 'Phone is valid.', { exists: false });
      }
      const exists = await ParentModel.checkPhone(schoolId, phone, excludeId, branchId);
      return ApiResponse.success(res, exists ? 'Mobile number already exists.' : 'Mobile number is available.', {
        exists,
        message: exists ? 'Mobile number already registered' : '',
      });
    } catch (error) {
      next(error);
    }
  }

  static async createParent(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const { first_name } = req.body || {};

      if (!first_name) {
        return ApiResponse.error(res, 'First name is required.', null, 400);
      }

      const branchId = req.branchId || req.body?.branch_id || req.body?.branchId || req.user?.branch_id || req.user?.branchId || null;
      const insertId = await ParentModel.create(schoolId, { ...(req.body || {}), branch_id: branchId }, branchId);

      return ApiResponse.success(res, 'Parent registered successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateParent(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || req.body?.branch_id || req.body?.branchId || null;
      const parentId = req.params.id;
      const { first_name } = req.body || {};

      if (!first_name) {
        return ApiResponse.error(res, 'First name is required.', null, 400);
      }

      const updated = await ParentModel.update(parentId, schoolId, req.body, branchId);

      if (!updated) {
        return ApiResponse.error(res, 'Parent record update failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Parent profile updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteParent(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const parentId = req.params.id;

      const deleted = await ParentModel.delete(parentId, schoolId, branchId);

      if (!deleted) {
        return ApiResponse.error(res, 'Parent record delete failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Parent record deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async linkStudentParent(req, res, next) {
    try {
      const schoolId = AdminParentController.getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || req.body?.branchId || null;
      const { student_id, father_id, mother_id, guardian_id } = req.body;

      if (!student_id) {
        return ApiResponse.error(res, 'Student selection is required.', null, 400);
      }

      await ParentModel.linkStudentToParent(schoolId, {
        student_id,
        father_id,
        mother_id,
        guardian_id,
        branch_id: branchId,
      });

      return ApiResponse.success(res, 'Student parent link updated successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminParentController;
