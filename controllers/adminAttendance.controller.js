const AttendanceModel = require('../models/attendance.model');
const ApiResponse = require('../utils/api.response');

class AdminAttendanceController {
  static async getMetaOptions(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const teacherId =
        req.query.teacher_id ||
        req.query.teacherId ||
        (String(req.user?.roleName || '').toLowerCase().includes('teacher')
          ? req.user.teacherId || req.user.userId
          : null);
      const options = await AttendanceModel.getMetaOptions(schoolId, teacherId);
      return ApiResponse.success(res, 'Attendance options fetched successfully.', options);
    } catch (error) {
      next(error);
    }
  }

  /* =========================================================================
   * 1. STUDENT ATTENDANCE CONTROLLER ACTIONS
   * ========================================================================= */

  static async getStudentAttendanceList(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { class_id, section_id, academic_year, date, page = 1, limit = 10, search = '' } = req.query;
      const branchId = req.branchId || req.query.branch_id || null;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { students, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getStudentAttendanceList(schoolId, {
          class_id,
          section_id,
          academic_year,
          date: targetDate,
          branch_id: branchId,
          page: Number(page) || 1,
          limit: Number(limit) || 10,
          search: String(search || '').trim(),
        });

      return ApiResponse.success(res, 'Student attendance list fetched successfully.', {
        students,
        date: targetDate,
        pagination: {
          total,
          page: curPage,
          limit: curLimit,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStudentsForAttendance(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { class_id, section_id, academic_year, date, page = 1, limit = 10, search = '' } = req.query;
      const branchId = req.branchId || req.query.branch_id || null;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { students, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getStudentsForAttendance(schoolId, {
          class_id,
          section_id,
          academic_year,
          date: targetDate,
          branch_id: branchId,
          page: Number(page) || 1,
          limit: Number(limit) || 10,
          search: String(search || '').trim(),
        });

      return ApiResponse.success(res, 'Student roster for attendance fetched successfully.', {
        students,
        date: targetDate,
        pagination: {
          total,
          page: curPage,
          limit: curLimit,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async saveStudentAttendance(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { attendanceDate, academic_year, attendanceRecords, branch_id } = req.body;
      const branchId = branch_id || req.branchId || null;

      if (!attendanceDate) {
        return ApiResponse.error(res, 'Attendance date is required.', null, 400);
      }

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      const formattedDate = String(attendanceDate).split('T')[0].trim();

      if (formattedDate < todayStr) {
        return ApiResponse.error(
          res,
          `Previous student attendance cannot be modified. Only current date (${todayStr}) attendance can be updated.`,
          null,
          403
        );
      }

      if (formattedDate > todayStr) {
        return ApiResponse.error(res, 'Future date attendance cannot be submitted.', null, 400);
      }

      if (!Array.isArray(attendanceRecords) || attendanceRecords.length === 0) {
        return ApiResponse.error(res, 'No student attendance records provided.', null, 400);
      }

      await AttendanceModel.saveStudentAttendance(schoolId, {
        attendanceDate: formattedDate,
        academic_year,
        attendanceRecords,
        branch_id: branchId,
      });

      return ApiResponse.success(res, 'Student attendance submitted successfully.');
    } catch (error) {
      next(error);
    }
  }

  /* =========================================================================
   * 2. TEACHER ATTENDANCE CONTROLLER ACTIONS
   * ========================================================================= */

  static async getTeacherAttendanceList(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { date, page = 1, limit = 10, search = '' } = req.query;
      const branchId = req.branchId || req.query.branch_id || null;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { teachers, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getTeacherAttendanceList(schoolId, {
          date: targetDate,
          branch_id: branchId,
          page: Number(page) || 1,
          limit: Number(limit) || 10,
          search: String(search || '').trim(),
        });

      return ApiResponse.success(res, 'Teacher attendance list fetched successfully.', {
        teachers,
        date: targetDate,
        pagination: {
          total,
          page: curPage,
          limit: curLimit,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getTeachersForAttendance(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { date, page = 1, limit = 10, search = '' } = req.query;
      const branchId = req.branchId || req.query.branch_id || null;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { teachers, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getTeachersForAttendance(schoolId, {
          date: targetDate,
          branch_id: branchId,
          page: Number(page) || 1,
          limit: Number(limit) || 10,
          search: String(search || '').trim(),
        });

      return ApiResponse.success(res, 'Teacher roster for attendance fetched successfully.', {
        teachers,
        date: targetDate,
        pagination: {
          total,
          page: curPage,
          limit: curLimit,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async saveTeacherAttendance(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { attendanceDate, attendanceRecords, branch_id } = req.body;
      const branchId = branch_id || req.branchId || null;

      if (!attendanceDate) {
        return ApiResponse.error(res, 'Attendance date is required.', null, 400);
      }

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      const formattedDate = String(attendanceDate).split('T')[0].trim();

      if (formattedDate < todayStr) {
        return ApiResponse.error(
          res,
          `Previous teacher attendance cannot be modified. Only current date (${todayStr}) attendance can be updated.`,
          null,
          403
        );
      }

      if (formattedDate > todayStr) {
        return ApiResponse.error(res, 'Future date attendance cannot be submitted.', null, 400);
      }

      if (!Array.isArray(attendanceRecords) || attendanceRecords.length === 0) {
        return ApiResponse.error(res, 'No teacher attendance records provided.', null, 400);
      }

      await AttendanceModel.saveTeacherAttendance(schoolId, {
        attendanceDate: formattedDate,
        attendanceRecords,
        branch_id: branchId,
      });

      return ApiResponse.success(res, 'Teacher attendance submitted successfully.');
    } catch (error) {
      next(error);
    }
  }

  /* =========================================================================
   * 3. STAFF ATTENDANCE CONTROLLER ACTIONS
   * ========================================================================= */

  static async getStaffAttendanceList(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { date, page = 1, limit = 10, search = '' } = req.query;
      const branchId = req.branchId || req.query.branch_id || null;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { staffs, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getStaffAttendanceList(schoolId, {
          date: targetDate,
          branch_id: branchId,
          page: Number(page) || 1,
          limit: Number(limit) || 10,
          search: String(search || '').trim(),
        });

      return ApiResponse.success(res, 'Staff attendance list fetched successfully.', {
        staffs,
        date: targetDate,
        pagination: {
          total,
          page: curPage,
          limit: curLimit,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStaffForAttendance(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { date, page = 1, limit = 10, search = '' } = req.query;
      const branchId = req.branchId || req.query.branch_id || null;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { staffs, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getStaffForAttendance(schoolId, {
          date: targetDate,
          branch_id: branchId,
          page: Number(page) || 1,
          limit: Number(limit) || 10,
          search: String(search || '').trim(),
        });

      return ApiResponse.success(res, 'Staff roster for attendance fetched successfully.', {
        staffs,
        date: targetDate,
        pagination: {
          total,
          page: curPage,
          limit: curLimit,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async saveStaffAttendance(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { attendanceDate, attendanceRecords, branch_id } = req.body;
      const branchId = branch_id || req.branchId || null;

      if (!attendanceDate) {
        return ApiResponse.error(res, 'Attendance date is required.', null, 400);
      }

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      const formattedDate = String(attendanceDate).split('T')[0].trim();

      if (formattedDate < todayStr) {
        return ApiResponse.error(
          res,
          `Previous staff attendance cannot be modified. Only current date (${todayStr}) attendance can be updated.`,
          null,
          403
        );
      }

      if (formattedDate > todayStr) {
        return ApiResponse.error(res, 'Future date attendance cannot be submitted.', null, 400);
      }

      if (!Array.isArray(attendanceRecords) || attendanceRecords.length === 0) {
        return ApiResponse.error(res, 'No staff attendance records provided.', null, 400);
      }

      await AttendanceModel.saveStaffAttendance(schoolId, {
        attendanceDate: formattedDate,
        attendanceRecords,
        branch_id: branchId,
      });

      return ApiResponse.success(res, 'Staff attendance submitted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminAttendanceController;
