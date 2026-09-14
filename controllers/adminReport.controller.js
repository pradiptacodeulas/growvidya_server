const ReportModel = require('../models/report.model');
const ApiResponse = require('../utils/api.response');

class AdminReportController {
  /**
   * GET /api/v1/admin/reports/class-report/options
   * Returns available academic years, shifts, classes, and sections for report filtering
   */
  static async getClassReportOptions(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const options = await ReportModel.getFilterOptions(schoolId);
      return ApiResponse.success(res, 'Report filter options fetched successfully.', options);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET/POST /api/v1/admin/reports/class-report
   * Returns filtered students and summary metadata for Class Report
   */
  static async getClassReport(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const paramsSrc = { ...req.query, ...req.body };

      const academicYearId = paramsSrc.academicYearId || paramsSrc.academic_year || '';
      const shiftId = paramsSrc.shiftId || paramsSrc.shift || '';
      const classId = paramsSrc.classId || paramsSrc.class || '';
      const sectionId = paramsSrc.sectionId || paramsSrc.section || '';
      const search = paramsSrc.search || '';
      const page = Number(paramsSrc.page) || 1;
      const limit = Number(paramsSrc.limit) || 10;
      const offset = (page - 1) * limit;

      const { students, total, summary } = await ReportModel.getClassReport(schoolId, {
        academicYearId,
        shiftId,
        classId,
        sectionId,
        search,
        limit,
        offset,
      });

      return ApiResponse.success(res, 'Class report fetched successfully.', {
        students,
        summary,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET/POST /api/v1/admin/reports/student-report
   * Returns filtered students and summary metadata for Student Report
   */
  static async getStudentReport(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const paramsSrc = { ...req.query, ...req.body };

      const academicYearId = paramsSrc.academicYearId || paramsSrc.academic_year || '';
      const shiftId = paramsSrc.shiftId || paramsSrc.shift || '';
      const classId = paramsSrc.classId || paramsSrc.class || '';
      const sectionId = paramsSrc.sectionId || paramsSrc.section || '';
      const search = paramsSrc.search || '';
      const page = Number(paramsSrc.page) || 1;
      const limit = Number(paramsSrc.limit) || 10;
      const offset = (page - 1) * limit;

      const { students, total, summary } = await ReportModel.getStudentReport(schoolId, {
        academicYearId,
        shiftId,
        classId,
        sectionId,
        search,
        limit,
        offset,
      });

      return ApiResponse.success(res, 'Student report fetched successfully.', {
        students,
        summary,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET/POST /api/v1/admin/reports/attendance-report
   * Returns monthly attendance report matrix with P, L, A, H, F counts and day-by-day status
   */
  static async getAttendanceReport(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const paramsSrc = { ...req.query, ...req.body };

      const type = paramsSrc.type || 'student';
      const academicYearId = paramsSrc.academicYearId || paramsSrc.academic_year || '';
      const shiftId = paramsSrc.shiftId || paramsSrc.shift || '';
      const classId = paramsSrc.classId || paramsSrc.class || '';
      const sectionId = paramsSrc.sectionId || paramsSrc.section || '';
      const month = paramsSrc.month || new Date().getMonth() + 1;
      const year = paramsSrc.year || new Date().getFullYear();
      const search = paramsSrc.search || '';
      const page = Number(paramsSrc.page) || 1;
      const limit = Number(paramsSrc.limit) || 10;
      const offset = (page - 1) * limit;

      const reportData = await ReportModel.getAttendanceReport(schoolId, {
        type,
        academicYearId,
        shiftId,
        classId,
        sectionId,
        month,
        year,
        search,
        limit,
        offset,
      });

      return ApiResponse.success(res, 'Attendance report fetched successfully.', {
        ...reportData,
        pagination: {
          total: reportData.total,
          page,
          limit,
          totalPages: Math.ceil(reportData.total / limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET/POST /api/v1/admin/reports/calendar-events
   * Returns school events, holidays, and exams for Calendar Report
   */
  static async getCalendarEvents(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const paramsSrc = { ...req.query, ...req.body };

      const startDate = paramsSrc.startDate || paramsSrc.start || '';
      const endDate = paramsSrc.endDate || paramsSrc.end || '';
      const year = paramsSrc.year || '';
      const month = paramsSrc.month || '';

      const events = await ReportModel.getCalendarReportEvents(schoolId, {
        startDate,
        endDate,
        year,
        month,
      });

      return ApiResponse.success(res, 'Calendar events fetched successfully.', events);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminReportController;
