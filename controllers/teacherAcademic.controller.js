const AcademicModel = require('../models/academic.model');
const ApiResponse = require('../utils/api.response');

class TeacherAcademicController {
  static getTeacherId(req) {
    return req.user?.teacherId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    return req.user?.schoolId || req.user?.school_id || 1;
  }

  // ==================== CLASSES (Strict Teacher Assignment) ====================
  static async getClasses(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const classes = await AcademicModel.getClasses(schoolId, true, teacherId);
      return ApiResponse.success(res, 'Teacher classes fetched successfully', classes);
    } catch (error) {
      next(error);
    }
  }

  static async getClassById(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const classItem = await AcademicModel.getClassById(id, schoolId);
      if (!classItem) return ApiResponse.error(res, 'Class not found', null, 404);
      return ApiResponse.success(res, 'Class details fetched successfully', classItem);
    } catch (error) {
      next(error);
    }
  }

  // ==================== SECTIONS ====================
  static async getSections(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const classId = req.params.classId || req.query.classId || req.query.class_id;
      const sections = await AcademicModel.getSections(schoolId, classId, true);
      return ApiResponse.success(res, 'Sections fetched successfully', sections);
    } catch (error) {
      next(error);
    }
  }

  static async getSectionById(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const section = await AcademicModel.getSectionById(id, schoolId);
      if (!section) return ApiResponse.error(res, 'Section not found', null, 404);
      return ApiResponse.success(res, 'Section details fetched successfully', section);
    } catch (error) {
      next(error);
    }
  }

  // ==================== SHIFTS ====================
  static async getShifts(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const activeOnly = req.query.status === '1' || req.query.activeOnly === 'true';
      const shifts = await AcademicModel.getShifts(schoolId, activeOnly);
      return ApiResponse.success(res, 'Teacher shifts fetched successfully', shifts);
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUBJECTS (Strict Teacher Assignment) ====================
  static async getSubjects(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const classId = req.params.classId || req.query.classId || req.query.class_id;
      const subjects = await AcademicModel.getSubjects(schoolId, classId, true, teacherId);
      return ApiResponse.success(res, 'Teacher subjects fetched successfully', subjects);
    } catch (error) {
      next(error);
    }
  }

  static async getSubjectById(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const subject = await AcademicModel.getSubjectById(id, schoolId);
      if (!subject) return ApiResponse.error(res, 'Subject not found', null, 404);
      return ApiResponse.success(res, 'Subject details fetched successfully', subject);
    } catch (error) {
      next(error);
    }
  }

  // ==================== ROUTINE & TIMETABLE ====================
  static async getRoutine(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const targetClassId = req.query.class_id || req.query.classId;
      const targetSectionId = req.query.section_id || req.query.sectionId;
      const { day, academic_year_id } = req.query;

      // When a specific class or section is selected, fetch the entire class routine (all subjects and teachers)
      // When no class is selected (default), fetch the teacher's personal schedule
      const queryOptions = {
        classId: targetClassId || null,
        sectionId: targetSectionId || null,
        day: day || null,
        academic_year_id: academic_year_id || null,
      };

      if (!targetClassId && !targetSectionId) {
        queryOptions.teacherId = teacherId;
      }

      const routines = await AcademicModel.getRoutines(schoolId, queryOptions);
      return ApiResponse.success(res, 'Teacher routine fetched successfully', routines);
    } catch (error) {
      next(error);
    }
  }

  // ==================== SYLLABUS ====================
  static async getSyllabus(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { class_id, classId, subject_id, subjectId, academic_year, academic_year_id, status, search, page, limit } = req.query;
      const data = await AcademicModel.getSyllabusList(schoolId, {
        class_id: class_id || classId,
        subject_id: subject_id || subjectId,
        academic_year: academic_year || academic_year_id,
        academic_year_id: academic_year_id || academic_year,
        status,
        search,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Syllabus fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getSyllabusById(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
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
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createSyllabus(schoolId, req.body);
      return ApiResponse.success(res, 'Syllabus added successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateSyllabus(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
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
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const { status } = req.body;

      if (status === undefined || status === null) {
        return ApiResponse.error(res, 'Status is required.', null, 400);
      }

      const updated = await AcademicModel.updateSyllabusStatus(id, schoolId, status);
      if (!updated) {
        return ApiResponse.error(res, 'Syllabus record not found.', null, 404);
      }

      return ApiResponse.success(res, 'Syllabus status updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteSyllabus(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const deleted = await AcademicModel.deleteSyllabus(id, schoolId);
      if (!deleted) return ApiResponse.error(res, 'Syllabus record not found or could not be deleted', null, 404);
      return ApiResponse.success(res, 'Syllabus deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // ==================== ASSIGNMENTS ====================
  static async getAssignments(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { class_id, classId, section_id, sectionId, subject_id, subjectId, assignment_type_id, assignmentTypeId, status, search, page, limit } = req.query;
      const data = await AcademicModel.getAssignments(schoolId, {
        classId: classId || class_id,
        sectionId: sectionId || section_id,
        subjectId: subjectId || subject_id,
        assignmentTypeId: assignmentTypeId || assignment_type_id,
        status,
        search,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Teacher assignments fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async getAssignmentById(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const data = await AcademicModel.getAssignmentById(id, schoolId);
      if (!data) return ApiResponse.error(res, 'Assignment not found', null, 404);
      return ApiResponse.success(res, 'Assignment details fetched successfully', data);
    } catch (error) {
      next(error);
    }
  }

  static async createAssignment(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const insertId = await AcademicModel.createAssignment(schoolId, {
        ...req.body,
        created_by: teacherId,
        creator_type: 'teacher',
      });
      return ApiResponse.success(res, 'Assignment created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateAssignment(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const success = await AcademicModel.updateAssignment(id, schoolId, req.body);
      if (!success) return ApiResponse.error(res, 'Assignment not found or update failed', null, 400);
      return ApiResponse.success(res, 'Assignment updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteAssignment(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const success = await AcademicModel.deleteAssignment(id, schoolId);
      if (!success) return ApiResponse.error(res, 'Assignment not found or delete failed', null, 400);
      return ApiResponse.success(res, 'Assignment deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async publishAssignment(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const success = await AcademicModel.publishAssignment(id, schoolId);
      if (!success) return ApiResponse.error(res, 'Assignment not found or publish failed', null, 400);
      return ApiResponse.success(res, 'Assignment published successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getAssignmentQuestions(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const questions = await AcademicModel.getAssignmentQuestions(id, schoolId);
      return ApiResponse.success(res, 'Assignment questions fetched successfully', questions);
    } catch (error) {
      next(error);
    }
  }

  static async getAssignmentTypes(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const types = await AcademicModel.getAssignmentTypes(schoolId, true);
      return ApiResponse.success(res, 'Assignment types fetched successfully', types);
    } catch (error) {
      next(error);
    }
  }

  // ==================== STUDY MATERIALS ====================
  static async getStudyMaterials(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const {
        academic_year_id,
        class_id,
        classId,
        section_id,
        sectionId,
        subject_id,
        subjectId,
        material_type_id,
        status,
        search,
        scope,
        my_uploads_only,
        only_mine,
        page,
        limit,
      } = req.query;

      const isOnlyMine =
        scope === 'my_uploads' ||
        String(my_uploads_only) === 'true' ||
        String(only_mine) === 'true';

      const data = await AcademicModel.getStudyMaterials(schoolId, {
        academic_year_id,
        class_id: class_id || classId,
        section_id: section_id || sectionId,
        subject_id: subject_id || subjectId,
        material_type_id,
        status,
        search,
        uploaded_by: isOnlyMine ? teacherId : undefined,
        uploader_type: isOnlyMine ? 'teacher' : undefined,
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
      const schoolId = TeacherAcademicController.getSchoolId(req);
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
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const insertId = await AcademicModel.createStudyMaterial(
        schoolId,
        {
          ...req.body,
          uploader_type: 'teacher',
        },
        teacherId
      );
      return ApiResponse.success(res, 'Study material created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateStudyMaterial(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const { id } = req.params;

      const existing = await AcademicModel.getStudyMaterialById(id, schoolId);
      if (!existing) return ApiResponse.error(res, 'Study material not found', null, 404);

      if (
        existing.uploader_type !== 'teacher' ||
        Number(existing.uploaded_by) !== Number(teacherId)
      ) {
        return ApiResponse.error(
          res,
          'Forbidden: You can only edit study materials uploaded by yourself.',
          null,
          403
        );
      }

      const success = await AcademicModel.updateStudyMaterial(id, schoolId, req.body);
      if (!success) return ApiResponse.error(res, 'Study material not found or update failed', null, 400);
      return ApiResponse.success(res, 'Study material updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteStudyMaterial(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const { id } = req.params;

      const existing = await AcademicModel.getStudyMaterialById(id, schoolId);
      if (!existing) return ApiResponse.error(res, 'Study material not found', null, 404);

      if (
        existing.uploader_type !== 'teacher' ||
        Number(existing.uploaded_by) !== Number(teacherId)
      ) {
        return ApiResponse.error(
          res,
          'Forbidden: You can only delete study materials uploaded by yourself.',
          null,
          403
        );
      }

      const success = await AcademicModel.deleteStudyMaterial(id, schoolId);
      if (!success) return ApiResponse.error(res, 'Study material not found or delete failed', null, 400);
      return ApiResponse.success(res, 'Study material deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async toggleStudyMaterialStatus(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const teacherId = TeacherAcademicController.getTeacherId(req);
      const { id } = req.params;

      const existing = await AcademicModel.getStudyMaterialById(id, schoolId);
      if (!existing) return ApiResponse.error(res, 'Study material not found', null, 404);

      if (
        existing.uploader_type !== 'teacher' ||
        Number(existing.uploaded_by) !== Number(teacherId)
      ) {
        return ApiResponse.error(
          res,
          'Forbidden: You can only toggle status of study materials uploaded by yourself.',
          null,
          403
        );
      }

      const newStatus = await AcademicModel.toggleStudyMaterialStatus(id, schoolId);
      return ApiResponse.success(res, 'Status updated successfully', { status: newStatus });
    } catch (error) {
      next(error);
    }
  }

  static async getMaterialTypes(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const types = await AcademicModel.getMaterialTypes(schoolId);
      return ApiResponse.success(res, 'Material types fetched successfully', types);
    } catch (error) {
      next(error);
    }
  }

  static async createMaterialType(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const insertId = await AcademicModel.createMaterialType(schoolId, req.body);
      return ApiResponse.success(res, 'Material type created successfully', { id: insertId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateMaterialType(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const success = await AcademicModel.updateMaterialType(id, schoolId, req.body);
      if (!success) return ApiResponse.error(res, 'Material type not found or update failed', null, 400);
      return ApiResponse.success(res, 'Material type updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteMaterialType(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const { id } = req.params;
      const success = await AcademicModel.deleteMaterialType(id, schoolId);
      if (!success) return ApiResponse.error(res, 'Material type not found or delete failed', null, 400);
      return ApiResponse.success(res, 'Material type deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // ==================== ACADEMIC YEARS ====================
  static async getAcademicYears(req, res, next) {
    try {
      const schoolId = TeacherAcademicController.getSchoolId(req);
      const years = await AcademicModel.getAcademicYears(schoolId, true);
      return ApiResponse.success(res, 'Academic years fetched successfully', years);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = TeacherAcademicController;
