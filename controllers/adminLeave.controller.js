const LeaveModel = require('../models/leave.model');
const ApiResponse = require('../utils/api.response');

class AdminLeaveController {
  static async getAllLeaves(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { name, role, date, status } = req.query;

      const leaves = await LeaveModel.getAllLeaves(schoolId, { name, role, date, status });
      return ApiResponse.success(res, 'Leaves fetched successfully.', { leaves });
    } catch (error) {
      next(error);
    }
  }

  static async getLeaveById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const leave = await LeaveModel.getLeaveById(schoolId, id);
      if (!leave) {
        return ApiResponse.error(res, 'Leave record not found.', null, 404);
      }

      return ApiResponse.success(res, 'Leave details fetched successfully.', { leave });
    } catch (error) {
      next(error);
    }
  }

  static async createLeave(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { role, staff_id, leave_id, duration, document, leave_reason, dates } = req.body;

      if (!role || !staff_id || !leave_id || !duration) {
        return ApiResponse.error(res, 'Role, staff, leave type, and duration are required.', null, 400);
      }

      const leaveId = await LeaveModel.createLeave(schoolId, {
        role,
        staff_id,
        leave_id,
        duration,
        document,
        leave_reason,
        dates,
      });

      return ApiResponse.success(res, 'Leave applied successfully.', { leaveId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateLeaveStatus(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { status } = req.body;

      if (status === undefined || status === null) {
        return ApiResponse.error(res, 'Status is required.', null, 400);
      }

      await LeaveModel.updateLeaveStatus(schoolId, id, Number(status));
      return ApiResponse.success(res, 'Leave status updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updateLeaveDateStatus(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { dateId } = req.params;
      const { status } = req.body;

      if (status === undefined || status === null) {
        return ApiResponse.error(res, 'Status is required.', null, 400);
      }

      await LeaveModel.updateLeaveDateStatus(schoolId, dateId, Number(status));
      return ApiResponse.success(res, 'Leave date status updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getLeaveTypes(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { role } = req.query;

      const types = await LeaveModel.getLeaveTypes(schoolId, role);
      return ApiResponse.success(res, 'Leave types fetched successfully.', { types });
    } catch (error) {
      next(error);
    }
  }

  static async getStaffByRole(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { role } = req.params;

      const staff = await LeaveModel.getStaffByRole(schoolId, role);
      return ApiResponse.success(res, 'Staff fetched successfully.', { staff });
    } catch (error) {
      next(error);
    }
  }

  static async getLeaveTypeById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const type = await LeaveModel.getLeaveTypeById(schoolId, id);
      if (!type) {
        return ApiResponse.error(res, 'Leave assignment not found.', null, 404);
      }
      return ApiResponse.success(res, 'Leave assignment fetched successfully.', { type });
    } catch (error) {
      next(error);
    }
  }

  static async createLeaveType(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { role, leave_name, need_document, no_leave, sort_order, status, leaveRows } = req.body;

      if (!role) {
        return ApiResponse.error(res, 'Role is required.', null, 400);
      }

      if (Array.isArray(leaveRows) && leaveRows.length > 0) {
        const ids = await LeaveModel.createLeaveType(schoolId, { role, leaveRows });
        return ApiResponse.success(res, 'Leave assignments created successfully.', { ids }, 201);
      }

      if (!leave_name) {
        return ApiResponse.error(res, 'Leave name is required.', null, 400);
      }

      const id = await LeaveModel.createLeaveType(schoolId, {
        role,
        leave_name,
        need_document,
        no_leave,
        sort_order,
        status,
      });
      return ApiResponse.success(res, 'Leave assignment created successfully.', { id }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateLeaveType(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { role, leave_name, need_document, no_leave, sort_order, status } = req.body;

      await LeaveModel.updateLeaveType(schoolId, id, {
        role,
        leave_name,
        need_document,
        no_leave,
        sort_order,
        status,
      });
      return ApiResponse.success(res, 'Leave type updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteLeaveType(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      await LeaveModel.deleteLeaveType(schoolId, id);
      return ApiResponse.success(res, 'Leave assignment deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteLeave(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      await LeaveModel.deleteLeave(schoolId, id);
      return ApiResponse.success(res, 'Leave application deleted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminLeaveController;
