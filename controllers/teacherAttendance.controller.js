const AttendanceModel = require('../models/attendance.model');
const ApiResponse = require('../utils/api.response');

class TeacherAttendanceController {
  static getTeacherId(req) {
    return req.user?.teacherId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    return req.user?.schoolId || req.user?.school_id || 1;
  }

  static async getMetaOptions(req, res, next) {
    try {
      const schoolId = TeacherAttendanceController.getSchoolId(req);
      const teacherId = TeacherAttendanceController.getTeacherId(req);
      const options = await AttendanceModel.getMetaOptions(schoolId, teacherId);
      return ApiResponse.success(res, 'Teacher attendance options fetched successfully.', options);
    } catch (error) {
      next(error);
    }
  }

  static async getStudentAttendanceList(req, res, next) {
    try {
      const schoolId = TeacherAttendanceController.getSchoolId(req);
      const { class_id, section_id, academic_year, date, page = 1, limit = 10, search = '' } = req.query;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { students, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getStudentAttendanceList(schoolId, {
          class_id,
          section_id,
          academic_year,
          date: targetDate,
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
      const schoolId = TeacherAttendanceController.getSchoolId(req);
      const { class_id, section_id, academic_year, date, page = 1, limit = 10, search = '' } = req.query;

      const targetDate = date || new Date().toISOString().split('T')[0];
      const { students, total, page: curPage, limit: curLimit, totalPages } =
        await AttendanceModel.getStudentsForAttendance(schoolId, {
          class_id,
          section_id,
          academic_year,
          date: targetDate,
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
      const schoolId = TeacherAttendanceController.getSchoolId(req);
      const { attendanceDate, academic_year, attendanceRecords } = req.body;

      if (!attendanceDate) {
        return ApiResponse.error(res, 'Attendance date is required.', null, 400);
      }

      // Calculate today's date in local server date (YYYY-MM-DD)
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;

      const formattedAttendanceDate = String(attendanceDate).split('T')[0].trim();

      // Strictly block previous and future day attendance
      if (formattedAttendanceDate < todayStr) {
        return ApiResponse.error(
          res,
          `Previous student attendance cannot be modified. Only current date (${todayStr}) attendance can be updated.`,
          null,
          403
        );
      }

      if (formattedAttendanceDate > todayStr) {
        return ApiResponse.error(res, 'Future date attendance cannot be submitted.', null, 400);
      }

      if (!Array.isArray(attendanceRecords) || attendanceRecords.length === 0) {
        return ApiResponse.error(res, 'No student attendance records provided.', null, 400);
      }

      await AttendanceModel.saveStudentAttendance(schoolId, {
        attendanceDate: formattedAttendanceDate,
        academic_year,
        attendanceRecords,
      });

      return ApiResponse.success(res, 'Student attendance saved successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = TeacherAttendanceController;
