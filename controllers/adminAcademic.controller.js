const fs = require('fs');
const path = require('path');
const AcademicModel = require('../models/academic.model');
const ApiResponse = require('../utils/api.response');

class AdminAcademicController {
  static getSchoolId(req) {
    return req.user?.schoolId;
  }

  // ==================== ALL MASTERS OVERVIEW ====================
  static async getAllMasters(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const [years, classes, sections, subjects, shifts, houses, periods] = await Promise.all([
        AcademicModel.getAcademicYears(schoolId),
        AcademicModel.getClasses(schoolId),
        AcademicModel.getSections(schoolId),
        AcademicModel.getSubjects(schoolId),
        AcademicModel.getShifts(schoolId),
        AcademicModel.getHouses(schoolId),
        AcademicModel.getPeriods(schoolId),
      ]);

      return ApiResponse.success(res, 'Academic masters fetched successfully.', {
        years,
        classes,
        sections,
        subjects,
        shifts,
        houses,
        periods,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== ACADEMIC YEARS ====================
  static async getAcademicYears(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getAcademicYears(schoolId);
      return ApiResponse.success(res, 'Academic years fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getAcademicYearById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getAcademicYearById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Academic year not found', null, 404);
      return ApiResponse.success(res, 'Academic year fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createAcademicYear(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createAcademicYear(schoolId, req.body);
      return ApiResponse.success(res, 'Academic year created successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateAcademicYear(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const updated = await AcademicModel.updateAcademicYear(req.params.id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Academic year not found', null, 404);
      return ApiResponse.success(res, 'Academic year updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteAcademicYear(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const deleted = await AcademicModel.deleteAcademicYear(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Academic year not found', null, 404);
      return ApiResponse.success(res, 'Academic year deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ==================== CLASSES ====================
  static async getClasses(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const activeOnly = req.query.activeOnly === 'true' || req.query.status === '1' || req.user?.roleName === 'Teacher';
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const teacherId =
        req.query.teacher_id ||
        req.query.teacherId ||
        (String(req.user?.roleName || '').toLowerCase().includes('teacher')
          ? req.user.teacherId || req.user.userId
          : null);
      const data = await AcademicModel.getClasses(schoolId, activeOnly, teacherId, branchId);
      return ApiResponse.success(res, 'Classes fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getClassById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getClassById(req.params.id, schoolId);
      if (!data) return ApiResponse.error(res, 'Class not found', null, 404);
      return ApiResponse.success(res, 'Class fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createClass(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const branchId = req.body.branch_id || req.body.branchId || req.branchId || null;
      const insertId = await AcademicModel.createClass(schoolId, {
        ...req.body,
        branch_id: branchId,
      });
      return ApiResponse.success(res, 'Class created successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateClass(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const branchId = req.body.branch_id || req.body.branchId || undefined;
      const updated = await AcademicModel.updateClass(req.params.id, schoolId, {
        ...req.body,
        ...(branchId !== undefined ? { branch_id: branchId } : {}),
      });
      if (!updated) return ApiResponse.error(res, 'Class not found', null, 404);
      return ApiResponse.success(res, 'Class updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteClass(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const deleted = await AcademicModel.deleteClass(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Class not found', null, 404);
      return ApiResponse.success(res, 'Class deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ==================== SECTIONS ====================
  static async getSections(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const classId = req.params.classId || req.query.classId || req.query.class_id || req.body?.class_id || req.body?.classId || null;
      const status = req.query.status !== undefined && req.query.status !== '' ? Number(req.query.status) : null;
      const activeOnly = req.query.activeOnly === 'true' || status === 1 || req.user?.roleName === 'Teacher';
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const data = await AcademicModel.getSections(schoolId, classId, activeOnly, status, branchId);
      return ApiResponse.success(res, 'Sections fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async getSectionById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getSectionById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Section not found', null, 404);
      return ApiResponse.success(res, 'Section fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createSection(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const branchId = req.body.branch_id || req.body.branchId || req.branchId || null;
      const insertId = await AcademicModel.createSection(schoolId, {
        ...req.body,
        branch_id: branchId,
      });
      return ApiResponse.success(res, 'Section created successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateSection(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const updated = await AcademicModel.updateSection(req.params.id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Section not found', null, 404);
      return ApiResponse.success(res, 'Section updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteSection(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const deleted = await AcademicModel.deleteSection(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Section not found', null, 404);
      return ApiResponse.success(res, 'Section deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUBJECTS ====================
  static async getSubjects(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const classId = req.query.classId || req.query.class_id || req.params.classId || null;
      const activeOnly = req.query.activeOnly === 'true' || req.query.status === '1' || req.user?.roleName === 'Teacher';
      const teacherId =
        req.query.teacher_id ||
        req.query.teacherId ||
        (String(req.user?.roleName || '').toLowerCase().includes('teacher')
          ? req.user.teacherId || req.user.userId
          : null);
      const data = await AcademicModel.getSubjects(schoolId, classId, activeOnly, teacherId);
      return ApiResponse.success(res, 'Subjects fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async getSubjectById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getSubjectById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Subject not found', null, 404);
      return ApiResponse.success(res, 'Subject fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createSubject(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createSubject(schoolId, req.body);
      return ApiResponse.success(res, 'Subject created successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateSubject(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const updated = await AcademicModel.updateSubject(req.params.id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Subject not found', null, 404);
      return ApiResponse.success(res, 'Subject updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteSubject(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const deleted = await AcademicModel.deleteSubject(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Subject not found', null, 404);
      return ApiResponse.success(res, 'Subject deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ==================== SHIFTS ====================
  static async getShifts(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const activeOnly = req.query.status === '1' || req.query.active === 'true';
      const data = await AcademicModel.getShifts(schoolId, activeOnly);
      return ApiResponse.success(res, 'Shifts fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getShiftById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getShiftById(req.params.id, schoolId);
      if (!data) return ApiResponse.error(res, 'Shift not found', null, 404);
      return ApiResponse.success(res, 'Shift fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createShift(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createShift(schoolId, req.body);
      return ApiResponse.success(res, 'Shift created successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateShift(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const updated = await AcademicModel.updateShift(req.params.id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Shift not found', null, 404);
      return ApiResponse.success(res, 'Shift updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteShift(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const deleted = await AcademicModel.deleteShift(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Shift not found', null, 404);
      return ApiResponse.success(res, 'Shift deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ==================== HOUSES ====================
  static async getHouses(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getHouses(schoolId);
      return ApiResponse.success(res, 'Houses fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getHouseById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getHouseById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'House not found', null, 404);
      return ApiResponse.success(res, 'House fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createHouse(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createHouse(schoolId, req.body);
      return ApiResponse.success(res, 'House created successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateHouse(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const updated = await AcademicModel.updateHouse(req.params.id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'House not found', null, 404);
      return ApiResponse.success(res, 'House updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteHouse(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const deleted = await AcademicModel.deleteHouse(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'House not found', null, 404);
      return ApiResponse.success(res, 'House deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ==================== PERIODS ====================
  static async getPeriods(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getPeriods(schoolId);
      return ApiResponse.success(res, 'Periods fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getPeriodById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getPeriodById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Period not found', null, 404);
      return ApiResponse.success(res, 'Period fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createPeriod(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createPeriod(schoolId, req.body);
      return ApiResponse.success(res, 'Period created successfully.', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updatePeriod(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const updated = await AcademicModel.updatePeriod(req.params.id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Period not found', null, 404);
      return ApiResponse.success(res, 'Period updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deletePeriod(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const deleted = await AcademicModel.deletePeriod(req.params.id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Period not found', null, 404);
      return ApiResponse.success(res, 'Period deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ==================== LOOKUPS FOR ADD STUDENT ====================
  static async getCountries(req, res, next) {
    try {
      const data = await AcademicModel.getCountries();
      return ApiResponse.success(res, 'Countries fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getStates(req, res, next) {
    try {
      const countryId = req.query.country_id || req.query.countryId;
      const data = await AcademicModel.getStates(countryId);
      return ApiResponse.success(res, 'States fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getCities(req, res, next) {
    try {
      const stateId = req.query.state_id || req.query.stateId;
      const data = await AcademicModel.getCities(stateId);
      return ApiResponse.success(res, 'Cities fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getTransportRoutes(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getTransportRoutes(schoolId);
      return ApiResponse.success(res, 'Transport routes fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getHostels(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getHostels(schoolId);
      return ApiResponse.success(res, 'Hostels fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getHostelRooms(req, res, next) {
    try {
      const hostelId = req.query.hostel_id || req.query.hostelId;
      const schoolId = req.user?.schoolId;
      const data = await AcademicModel.getHostelRooms(hostelId, schoolId);
      return ApiResponse.success(res, 'Hostel rooms fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getGenders(req, res, next) {
    try {
      const data = await AcademicModel.getGenders();
      return ApiResponse.success(res, 'Genders fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getBloodGroups(req, res, next) {
    try {
      const data = await AcademicModel.getBloodGroups();
      return ApiResponse.success(res, 'Blood groups fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getMaritalStatuses(req, res, next) {
    try {
      const data = await AcademicModel.getMaritalStatuses();
      return ApiResponse.success(res, 'Marital statuses fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getReligions(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getReligions(schoolId);
      return ApiResponse.success(res, 'Religions fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getCategories(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getCategories(schoolId);
      return ApiResponse.success(res, 'Categories fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getMotherTongues(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getMotherTongues(schoolId);
      return ApiResponse.success(res, 'Mother tongues fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getStudentMasters(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getStudentMasters(schoolId);
      return ApiResponse.success(res, 'Student masters fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getNextRollNumber(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const classId = req.query.class_id || req.query.classId;
      const sectionId = req.query.section_id || req.query.sectionId;
      const rollNumber = await AcademicModel.getNextRollNumber(schoolId, classId, sectionId);
      return ApiResponse.success(res, 'Next roll number generated', { roll_number: rollNumber });
    } catch (error) {
      next(error);
    }
  }

  // ==================== DAYS ====================
  static async getDays(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getDays(schoolId);
      return ApiResponse.success(res, 'Days fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getDayById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getDayById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Day not found', null, 404);
      return ApiResponse.success(res, 'Day fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createDay(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createDay(schoolId, req.body);
      return ApiResponse.success(res, 'Day created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateDay(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.updateDay(id, schoolId, req.body);
      return ApiResponse.success(res, 'Day updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteDay(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.deleteDay(id, schoolId);
      return ApiResponse.success(res, 'Day deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // ==================== DOCUMENT TYPES ====================
  static async getDocumentTypes(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const data = await AcademicModel.getDocumentTypes(schoolId);
      return ApiResponse.success(res, 'Document types fetched', data);
    } catch (error) {
      next(error);
    }
  }

  static async getDocumentTypeById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getDocumentTypeById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Document type not found', null, 404);
      return ApiResponse.success(res, 'Document type fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  static async createDocumentType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createDocumentType(schoolId, req.body);
      return ApiResponse.success(res, 'Document type added', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateDocumentType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const updated = await AcademicModel.updateDocumentType(id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Document type not found', null, 404);
      return ApiResponse.success(res, 'Document type updated successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  static async deleteDocumentType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const deleted = await AcademicModel.deleteDocumentType(id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Document type not found', null, 404);
      return ApiResponse.success(res, 'Document type deleted');
    } catch (error) {
      next(error);
    }
  }

  // ==================== ROUTINES ====================
  static async getRoutines(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { class_id, classId, section_id, sectionId, day, teacher_id, teacherId } = req.query;

      let resolvedTeacherId = teacher_id || teacherId;
      const isTeacherRole =
        String(req.user?.roleName || '').toLowerCase().includes('teacher') ||
        Boolean(req.user?.teacherId);

      // If requested by a teacher without choosing a class, default to their personal routine
      if (isTeacherRole && !class_id && !classId && !resolvedTeacherId) {
        resolvedTeacherId = req.user.teacherId || req.user.userId;
      }

      const data = await AcademicModel.getRoutines(schoolId, {
        classId: class_id || classId,
        sectionId: section_id || sectionId,
        day,
        teacherId: resolvedTeacherId,
      });
      return ApiResponse.success(res, 'Routines fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createRoutine(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createRoutine(schoolId, req.body);
      return ApiResponse.success(res, 'Routine period scheduled', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateRoutine(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const updated = await AcademicModel.updateRoutine(id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Routine period not found', null, 404);
      return ApiResponse.success(res, 'Routine period updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteRoutine(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.deleteRoutine(id, schoolId);
      return ApiResponse.success(res, 'Routine period deleted');
    } catch (error) {
      next(error);
    }
  }

  static async getClassAssignedTeachers(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { class_id, classId, subject_id, subjectId } = req.query;
      const data = await AcademicModel.getClassAssignedTeachers(schoolId, {
        classId: class_id || classId,
        subjectId: subject_id || subjectId,
      });
      return ApiResponse.success(res, 'Class assigned teachers fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  // ==================== LESSONS / SYLLABUS ====================
  static async getSyllabusList(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { academic_year, academicYear, class_id, classId, subject_id, subjectId, status, search, page, limit } = req.query;
      const data = await AcademicModel.getSyllabusList(schoolId, {
        academic_year: academic_year || academicYear,
        class_id: class_id || classId,
        subject_id: subject_id || subjectId,
        status,
        search,
        page: Number(page) || 1,
        limit: Number(limit) || 10,
      });
      return ApiResponse.success(res, 'Syllabus list fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getSyllabusById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getSyllabusById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Syllabus item not found', null, 404);
      return ApiResponse.success(res, 'Syllabus item fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createSyllabus(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createSyllabus(schoolId, req.body);
      return ApiResponse.success(res, 'Syllabus added successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateSyllabus(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const updated = await AcademicModel.updateSyllabus(id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Syllabus record not found', null, 404);
      return ApiResponse.success(res, 'Syllabus updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async updateSyllabusStatus(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const { status } = req.body;

      if (status === undefined || status === null) {
        return ApiResponse.error(res, 'Status is required.', null, 400);
      }

      const updated = await AcademicModel.updateSyllabusStatus(id, schoolId, status);
      if (!updated) return ApiResponse.error(res, 'Syllabus record not found', null, 404);
      return ApiResponse.success(res, 'Syllabus status updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteSyllabus(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.deleteSyllabus(id, schoolId);
      return ApiResponse.success(res, 'Syllabus deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getLessons(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { class_id, classId, subject_id, subjectId } = req.query;
      const data = await AcademicModel.getLessons(schoolId, {
        classId: class_id || classId,
        subjectId: subject_id || subjectId,
      });
      return ApiResponse.success(res, 'Lessons fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createLesson(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createLesson(schoolId, req.body);
      return ApiResponse.success(res, 'Lesson created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async deleteLesson(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.deleteLesson(id, schoolId);
      return ApiResponse.success(res, 'Lesson deleted');
    } catch (error) {
      next(error);
    }
  }

  // ==================== ASSIGNMENTS ====================
  static async getAssignmentTypes(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { search, status, page, limit } = req.query;
      const data = await AcademicModel.getAssignmentTypes(schoolId, {
        search,
        status,
        page: Number(page) || 1,
        limit: Number(limit) || 10,
      });
      return ApiResponse.success(res, 'Assignment types fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getAssignmentTypeById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getAssignmentTypeById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Assignment type not found', null, 404);
      return ApiResponse.success(res, 'Assignment type fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createAssignmentType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createAssignmentType(schoolId, req.body);
      return ApiResponse.success(res, 'Assignment type created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateAssignmentType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const updated = await AcademicModel.updateAssignmentType(id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Assignment type not found', null, 404);
      return ApiResponse.success(res, 'Assignment type updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getAssignments(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { class_id, classId, section_id, sectionId, subject_id, subjectId, search, status, page, limit } = req.query;
      const data = await AcademicModel.getAssignments(schoolId, {
        classId: class_id || classId,
        sectionId: section_id || sectionId,
        subjectId: subject_id || subjectId,
        search,
        status,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Assignments fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getAssignmentById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getAssignmentById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Assignment not found', null, 404);
      return ApiResponse.success(res, 'Assignment fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getAssignmentQuestions(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getAssignmentQuestions(id, schoolId);
      return ApiResponse.success(res, 'Assignment questions fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async publishAssignment(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const updated = await AcademicModel.publishAssignment(id, schoolId);
      if (!updated) return ApiResponse.error(res, 'Assignment not found', null, 404);
      return ApiResponse.success(res, 'Assignment published successfully');
    } catch (error) {
      next(error);
    }
  }

  static async createAssignment(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createAssignment(schoolId, req.body);
      return ApiResponse.success(res, 'Assignment created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateAssignment(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.updateAssignment(id, schoolId, req.body);
      return ApiResponse.success(res, 'Assignment updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteAssignment(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.deleteAssignment(id, schoolId);
      return ApiResponse.success(res, 'Assignment deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // ==================== STUDY MATERIALS & TYPES ====================
  static async getMaterialTypes(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { search, status, page, limit } = req.query;
      const data = await AcademicModel.getMaterialTypes(schoolId, {
        search,
        status,
        page: Number(page) || 1,
        limit: Number(limit) || 100,
      });
      return ApiResponse.success(res, 'Material types fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getMaterialTypeById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getMaterialTypeById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Material type not found', null, 404);
      return ApiResponse.success(res, 'Material type fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createMaterialType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createMaterialType(schoolId, req.body);
      return ApiResponse.success(res, 'Material type created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateMaterialType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const updated = await AcademicModel.updateMaterialType(id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Material type not found', null, 404);
      return ApiResponse.success(res, 'Material type updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteMaterialType(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.deleteMaterialType(id, schoolId);
      return ApiResponse.success(res, 'Material type deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getStudyMaterials(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { academic_year_id, class_id, classId, section_id, sectionId, subject_id, subjectId, material_type_id, status, search, page, limit } = req.query;
      const data = await AcademicModel.getStudyMaterials(schoolId, {
        academic_year_id,
        class_id: class_id || classId,
        section_id: section_id || sectionId,
        subject_id: subject_id || subjectId,
        material_type_id,
        status,
        search,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Study materials fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getStudyMaterialById(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getStudyMaterialById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Study material not found', null, 404);
      return ApiResponse.success(res, 'Study material fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createStudyMaterial(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const userId = req.user?.id || 1;
      const insertId = await AcademicModel.createStudyMaterial(schoolId, req.body, userId);
      return ApiResponse.success(res, 'Study material created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateStudyMaterial(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const updated = await AcademicModel.updateStudyMaterial(id, schoolId, req.body);
      if (!updated) return ApiResponse.error(res, 'Study material not found', null, 404);
      return ApiResponse.success(res, 'Study material updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async toggleStudyMaterialStatus(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const newStatus = await AcademicModel.toggleStudyMaterialStatus(id, schoolId);
      if (newStatus === null) return ApiResponse.error(res, 'Study material not found', null, 404);
      return ApiResponse.success(res, 'Status updated successfully', { status: newStatus });
    } catch (error) {
      next(error);
    }
  }

  static async deleteStudyMaterial(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      await AcademicModel.deleteStudyMaterial(id, schoolId);
      return ApiResponse.success(res, 'Study material deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async downloadStudyMaterial(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getStudyMaterialById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Study material not found', null, 404);
      if (!data.attachment) return ApiResponse.error(res, 'No attachment for this study material', null, 404);

      const filename = path.basename(data.attachment);
      const originalName =
        data.attachment_original_name ||
        (data.title
          ? `${data.title.replace(/[^a-zA-Z0-9_\-\. ]/g, '_')}.${data.attachment_extension || 'pdf'}`
          : filename);

      const cleanRelPath = data.attachment.replace(/^[/\\]+/, '').replace(/^upload[/\\]+/, '');

      const candidatePaths = [
        path.join(__dirname, '../public', data.attachment.replace(/^[/\\]+/, '')),
        path.join(__dirname, '../public/upload', cleanRelPath),
        path.join(__dirname, '../public/upload/study_material', filename),
        path.join(__dirname, '../public/upload/study_materials', filename),
        path.join(__dirname, '../public/upload/general', filename),
        path.join(__dirname, '../public/upload', filename),
        path.join('C:/xampp/htdocs/growvidya', data.attachment.replace(/^[/\\]+/, '')),
        path.join('C:/xampp/htdocs/growvidya/upload', cleanRelPath),
        path.join('C:/xampp/htdocs/growvidya/upload/study_material', filename),
        path.join('C:/xampp/htdocs/growvidya/upload', filename),
      ];

      for (const p of candidatePaths) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return res.download(p, originalName);
        }
      }

      return ApiResponse.error(res, 'Attachment file not found on server.', null, 404);
    } catch (error) {
      next(error);
    }
  }

  // ==================== LESSONS ====================
  static async getLessons(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { classId, subjectId } = req.query;
      const data = await AcademicModel.getLessons(schoolId, { classId, subjectId });
      return ApiResponse.success(res, 'Lessons fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createLesson(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createLesson(schoolId, req.body);
      return ApiResponse.success(res, 'Lesson created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async deleteLesson(req, res, next) {
    try {
      const schoolId = AdminAcademicController.getSchoolId(req);
      const { id } = req.params;
      const success = await AcademicModel.deleteLesson(id, schoolId);
      if (!success) return ApiResponse.error(res, 'Lesson not found or delete failed', null, 400);
      return ApiResponse.success(res, 'Lesson deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminAcademicController;
