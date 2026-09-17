const StaffModel = require('../models/staff.model');
const ApiResponse = require('../utils/api.response');

class AdminStaffController {
  static async getAllStaff(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const paramsSrc = { ...req.query, ...req.body };

      const search = paramsSrc.search || paramsSrc.name || '';
      const role = paramsSrc.role || paramsSrc.role_id || '';
      const status = paramsSrc.status !== undefined ? paramsSrc.status : '';
      const branchId = req.branchId || paramsSrc.branch_id || paramsSrc.branchId || null;
      const page = paramsSrc.page || 1;
      const limit = paramsSrc.limit || 12;
      const offset = (Number(page) - 1) * Number(limit);

      const { staff, total } = await StaffModel.getAll(schoolId, {
        search: String(search).trim(),
        role,
        status,
        branchId,
        limit: Number(limit),
        offset,
      });

      return ApiResponse.success(res, 'Staff members fetched successfully.', {
        staff,
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

  static async getStaffById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const staffId = req.params.id;

      const staffMember = await StaffModel.getById(staffId, schoolId);

      if (!staffMember) {
        return ApiResponse.error(res, 'Staff member record not found.', null, 404);
      }

      return ApiResponse.success(res, 'Staff member details fetched successfully.', {
        staff: staffMember,
      });
    } catch (error) {
      next(error);
    }
  }

  static async checkEmail(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const email = req.body?.email || req.query?.email || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;
      if (!email) {
        return ApiResponse.success(res, 'Email is valid.', { exists: false });
      }
      const exists = await StaffModel.checkEmail(schoolId, email, excludeId);
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
      const schoolId = req.user.schoolId;
      const phone = req.body?.phone || req.query?.phone || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;
      if (!phone) {
        return ApiResponse.success(res, 'Phone is valid.', { exists: false });
      }
      const exists = await StaffModel.checkPhone(schoolId, phone, excludeId);
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
      const schoolId = req.user.schoolId;
      const email = req.body?.email || req.query?.email || '';
      const phone = req.body?.phone || req.query?.phone || '';
      const excludeId = req.body?.exclude_id || req.query?.exclude_id || null;

      const { isEmailDuplicate, isPhoneDuplicate } = await StaffModel.checkDuplicate(
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

  static async createStaff(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const data = req.body;

      if (!data.first_name || !data.last_name) {
        return ApiResponse.error(res, 'First name and Last name are required.', null, 400);
      }
      if (!data.email) {
        return ApiResponse.error(res, 'Email address is required.', null, 400);
      }

      const branchId = req.body.branch_id || req.body.branchId || req.branchId || null;
      const createdStaff = await StaffModel.create(schoolId, {
        ...data,
        branch_id: branchId,
      });
      return ApiResponse.success(res, 'Staff member registered successfully.', {
        staff: createdStaff,
      }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateStaff(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const staffId = req.params.id;
      const data = req.body;
      const branchId = req.body.branch_id || req.body.branchId || undefined;

      const updatedStaff = await StaffModel.update(staffId, schoolId, {
        ...data,
        ...(branchId !== undefined ? { branch_id: branchId } : {}),
      });

      if (!updatedStaff) {
        return ApiResponse.error(res, 'Staff member record not found or could not be updated.', null, 404);
      }

      return ApiResponse.success(res, 'Staff member details updated successfully.', {
        staff: updatedStaff,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteStaff(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const staffId = req.params.id;

      const success = await StaffModel.delete(staffId, schoolId);

      if (!success) {
        return ApiResponse.error(res, 'Staff member not found or already deleted.', null, 404);
      }

      return ApiResponse.success(res, 'Staff member deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getRoles(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const roles = await StaffModel.getRoles(schoolId);
      return ApiResponse.success(res, 'Staff roles fetched successfully.', { roles });
    } catch (error) {
      next(error);
    }
  }

  static async getOptions(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const options = await StaffModel.getOptions(schoolId);
      return ApiResponse.success(res, 'Staff options fetched successfully.', options);
    } catch (error) {
      next(error);
    }
  }

  static async getStates(req, res, next) {
    try {
      const countryId = req.params.countryId || req.query.country_id;
      const states = await StaffModel.getStates(countryId);
      return ApiResponse.success(res, 'States fetched successfully.', { states });
    } catch (error) {
      next(error);
    }
  }

  static async getCities(req, res, next) {
    try {
      const stateId = req.params.stateId || req.query.state_id;
      const cities = await StaffModel.getCities(stateId);
      return ApiResponse.success(res, 'Cities fetched successfully.', { cities });
    } catch (error) {
      next(error);
    }
  }

  static async getRooms(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const hostelId = req.params.hostelId || req.query.hostel_id;
      const rooms = await StaffModel.getRooms(hostelId, schoolId);
      return ApiResponse.success(res, 'Hostel rooms fetched successfully.', { rooms });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminStaffController;
