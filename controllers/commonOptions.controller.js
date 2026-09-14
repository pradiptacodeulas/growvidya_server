const AcademicModel = require('../models/academic.model');
const PermissionModel = require('../models/permission.model');
const ApiResponse = require('../utils/api.response');

class CommonOptionsController {
  static getSchoolId(req) {
    return req.user?.schoolId || req.user?.school_id || 1;
  }

  // Academic Years lookup
  static async getAcademicYears(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const years = await AcademicModel.getAcademicYears(schoolId);
      const formatted = (years || []).map((y) => ({
        id: y.id,
        name: y.name || y.academic_year,
        academic_year: y.academic_year,
        raw_academic_year: y.raw_academic_year || y.academic_year,
        is_current: Number(y.is_current) === 1 ? 1 : 0,
        isCurrent: Number(y.is_current) === 1,
        status: y.status,
      }));
      return ApiResponse.success(res, 'Academic years fetched successfully.', formatted);
    } catch (error) {
      next(error);
    }
  }

  // Classes lookup
  static async getClasses(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const activeOnly = req.query.activeOnly === 'true' || req.query.active_only === 'true';
      const classes = await AcademicModel.getClasses(schoolId, activeOnly);
      const formatted = (classes || []).map((c) => ({
        id: c.id,
        class_name: c.class_name,
        name: c.class_name,
        shift_id: c.shift_id,
        shift_name: c.shift_name,
        sort_order: c.sort_order,
        status: c.status,
      }));
      return ApiResponse.success(res, 'Classes fetched successfully.', formatted);
    } catch (error) {
      next(error);
    }
  }

  // Sections lookup (filtered by classId or all)
  static async getSections(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const classId = req.query?.classId || req.query?.class_id || req.params?.classId || null;
      const activeOnly = req.query?.activeOnly === 'true' || req.query?.active_only === 'true';
      const sections = await AcademicModel.getSections(schoolId, classId, activeOnly);
      const formatted = (sections || []).map((s) => ({
        id: s.id,
        class_id: s.class_id,
        class_name: s.class_name,
        section_name: s.section_name,
        name: s.section_name,
        capacity: s.capacity,
        status: s.status,
      }));
      return ApiResponse.success(res, 'Sections fetched successfully.', formatted);
    } catch (error) {
      next(error);
    }
  }

  // Subjects lookup (filtered by classId or all)
  static async getSubjects(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const classId = req.query.classId || req.query.class_id || null;
      const activeOnly = req.query.activeOnly === 'true' || req.query.active_only === 'true';
      const subjects = await AcademicModel.getSubjects(schoolId, classId, activeOnly);
      const formatted = (subjects || []).map((s) => ({
        id: s.id,
        class_id: s.class_id,
        class_name: s.class_name,
        subject_name: s.subject_name,
        name: s.subject_name,
        subject_code: s.subject_code,
        subject_type: s.subject_type,
        status: s.status,
      }));
      return ApiResponse.success(res, 'Subjects fetched successfully.', formatted);
    } catch (error) {
      next(error);
    }
  }

  // Shifts lookup
  static async getShifts(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const shifts = await AcademicModel.getShifts(schoolId);
      const formatted = (shifts || []).map((s) => ({
        id: s.id,
        shift_name: s.shift_name,
        name: s.shift_name,
        start_time: s.start_time,
        end_time: s.end_time,
        status: s.status,
      }));
      return ApiResponse.success(res, 'Shifts fetched successfully.', formatted);
    } catch (error) {
      next(error);
    }
  }

  // Houses lookup
  static async getHouses(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const houses = await AcademicModel.getHouses(schoolId);
      const formatted = (houses || []).map((h) => ({
        id: h.id,
        house_name: h.house_name,
        name: h.house_name,
        status: h.status,
      }));
      return ApiResponse.success(res, 'Houses fetched successfully.', formatted);
    } catch (error) {
      next(error);
    }
  }

  // Roles lookup
  static async getRoles(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const roles = await PermissionModel.getAllRoles(schoolId);
      const formatted = (roles || []).map((r) => ({
        id: r.id,
        role_name: r.role_name,
        name: r.role_name,
        status: r.status,
      }));
      return ApiResponse.success(res, 'Roles fetched successfully.', formatted);
    } catch (error) {
      next(error);
    }
  }

  // Bundled Academic Masters (single request for forms needing years, classes, shifts, houses)
  static async getAcademicBundle(req, res, next) {
    try {
      const schoolId = CommonOptionsController.getSchoolId(req);
      const [years, classes, shifts, houses] = await Promise.all([
        AcademicModel.getAcademicYears(schoolId),
        AcademicModel.getClasses(schoolId, true),
        AcademicModel.getShifts(schoolId, true),
        AcademicModel.getHouses(schoolId),
      ]);
      return ApiResponse.success(res, 'Academic options bundle fetched successfully.', {
        academicYears: (years || []).map((y) => ({
          id: y.id,
          name: y.name || y.academic_year,
          academic_year: y.academic_year,
          raw_academic_year: y.raw_academic_year || y.academic_year,
          is_current: Number(y.is_current) === 1 ? 1 : 0,
          isCurrent: Number(y.is_current) === 1,
        })),
        classes: (classes || []).map((c) => ({
          id: c.id,
          class_name: c.class_name,
          name: c.class_name,
          shift_id: c.shift_id,
        })),
        shifts: (shifts || []).map((s) => ({
          id: s.id,
          shift_name: s.shift_name,
          name: s.shift_name,
        })),
        houses: (houses || []).map((h) => ({
          id: h.id,
          house_name: h.house_name,
          name: h.house_name,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = CommonOptionsController;
