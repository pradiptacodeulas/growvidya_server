const { pool } = require('../config/db.config');
const AdminExaminationModel = require('../models/adminExamination.model');
const MarksheetPdfService = require('../services/marksheetPdf.service');
const AdmitCardPdfService = require('../services/admitCardPdf.service');
const ApiResponse = require('../utils/api.response');

class AdminExaminationController {
  // =========================================================
  // 1. GRADE SETTINGS
  // =========================================================

  static async getAllGrades(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { status } = req.query;
      const grades = await AdminExaminationModel.getAllGrades(schoolId, status);
      return ApiResponse.success(res, 'Grade settings retrieved successfully.', { grades });
    } catch (error) {
      next(error);
    }
  }

  static async getGradeById(req, res, next) {
    try {
      const { id } = req.params;
      const grade = await AdminExaminationModel.getGradeById(id);
      if (!grade) {
        return ApiResponse.error(res, 'Grade setting not found.', null, 404);
      }
      return ApiResponse.success(res, 'Grade setting retrieved successfully.', { grade });
    } catch (error) {
      next(error);
    }
  }

  static async createGrade(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { grade_name, min_percentage, max_percentage, status } = req.body;

      if (!grade_name || grade_name.trim() === '') {
        return ApiResponse.error(res, 'Grade name is required.', null, 400);
      }
      if (min_percentage === undefined || max_percentage === undefined) {
        return ApiResponse.error(res, 'Min and Max percentage are required.', null, 400);
      }

      const gradeId = await AdminExaminationModel.createGrade({
        schoolId,
        gradeName: grade_name.trim(),
        minPercentage: parseInt(min_percentage, 10),
        maxPercentage: parseInt(max_percentage, 10),
        status: status !== undefined ? parseInt(status, 10) : 1,
      });

      return ApiResponse.success(res, 'Grade setting created successfully.', { gradeId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateGrade(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const { grade_name, min_percentage, max_percentage, status } = req.body;

      const existing = await AdminExaminationModel.getGradeById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Grade setting not found.', null, 404);
      }

      await AdminExaminationModel.updateGrade(id, {
        gradeName: grade_name ? grade_name.trim() : undefined,
        minPercentage: min_percentage !== undefined ? parseInt(min_percentage, 10) : undefined,
        maxPercentage: max_percentage !== undefined ? parseInt(max_percentage, 10) : undefined,
        status: status !== undefined ? parseInt(status, 10) : undefined,
        schoolId,
      });

      return ApiResponse.success(res, 'Grade setting updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteGrade(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const existing = await AdminExaminationModel.getGradeById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Grade setting not found.', null, 404);
      }

      await AdminExaminationModel.deleteGrade(id, schoolId);
      return ApiResponse.success(res, 'Grade setting deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 2. EXAM MASTER
  // =========================================================

  static async getAllExams(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const academic_year = req.query.academic_year || req.query.academic_year_id || req.query.academicYear;
      const { status } = req.query;
      const exams = await AdminExaminationModel.getAllExams(schoolId, academic_year, status);
      return ApiResponse.success(res, 'Exams retrieved successfully.', { exams });
    } catch (error) {
      next(error);
    }
  }

  static async getExamById(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const exam = await AdminExaminationModel.getExamById(id, schoolId);
      if (!exam) {
        return ApiResponse.error(res, 'Exam not found.', null, 404);
      }
      return ApiResponse.success(res, 'Exam details retrieved successfully.', { exam });
    } catch (error) {
      next(error);
    }
  }

  static async createExam(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { exam_name, academic_year, status } = req.body;

      if (!exam_name || exam_name.trim() === '') {
        return ApiResponse.error(res, 'Exam name is required.', null, 400);
      }

      const examId = await AdminExaminationModel.createExam({
        schoolId,
        academicYear: academic_year ? parseInt(academic_year, 10) : undefined,
        examName: exam_name.trim(),
        status: status !== undefined ? parseInt(status, 10) : 1,
      });

      return ApiResponse.success(res, 'Exam created successfully.', { examId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateExam(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const { exam_name, academic_year, status } = req.body;

      const existing = await AdminExaminationModel.getExamById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Exam not found.', null, 404);
      }

      await AdminExaminationModel.updateExam(id, {
        examName: exam_name ? exam_name.trim() : undefined,
        academicYear: academic_year !== undefined ? parseInt(academic_year, 10) : undefined,
        status: status !== undefined ? parseInt(status, 10) : undefined,
        schoolId,
      });

      return ApiResponse.success(res, 'Exam updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteExam(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const existing = await AdminExaminationModel.getExamById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Exam not found.', null, 404);
      }

      await AdminExaminationModel.deleteExam(id, schoolId);
      return ApiResponse.success(res, 'Exam deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 3. EXAM TYPES
  // =========================================================

  static async getAllExamTypes(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, status } = req.query;
      const examTypes = await AdminExaminationModel.getAllExamTypes(schoolId, exam_id, status);
      return ApiResponse.success(res, 'Exam types retrieved successfully.', { examTypes });
    } catch (error) {
      next(error);
    }
  }

  static async getExamTypeById(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const examType = await AdminExaminationModel.getExamTypeById(id, schoolId);
      if (!examType) {
        return ApiResponse.error(res, 'Exam type not found.', null, 404);
      }
      return ApiResponse.success(res, 'Exam type retrieved successfully.', { examType });
    } catch (error) {
      next(error);
    }
  }

  static async createExamType(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { exam_id, academic_year, exam_type, sort_order, status, items } = req.body;

      if (Array.isArray(items) && items.length > 0) {
        const createdIds = [];
        for (const item of items) {
          if (item.exam_type && item.exam_type.trim()) {
            const id = await AdminExaminationModel.createExamType({
              schoolId,
              academicYear: academic_year ? parseInt(academic_year, 10) : undefined,
              examId: exam_id ? parseInt(exam_id, 10) : undefined,
              examType: item.exam_type.trim(),
              sortOrder: item.sort_order ? parseInt(item.sort_order, 10) : 1,
              status: item.status !== undefined ? parseInt(item.status, 10) : 1,
            });
            createdIds.push(id);
          }
        }
        return ApiResponse.success(res, 'Exam types created successfully.', { createdIds }, 201);
      }

      if (!exam_type || exam_type.trim() === '') {
        return ApiResponse.error(res, 'Exam type name is required.', null, 400);
      }

      const examTypeId = await AdminExaminationModel.createExamType({
        schoolId,
        academicYear: academic_year ? parseInt(academic_year, 10) : undefined,
        examId: exam_id ? parseInt(exam_id, 10) : undefined,
        examType: exam_type.trim(),
        sortOrder: sort_order ? parseInt(sort_order, 10) : 1,
        status: status !== undefined ? parseInt(status, 10) : 1,
      });

      return ApiResponse.success(res, 'Exam type created successfully.', { examTypeId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateExamType(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const { exam_id, academic_year, exam_type, sort_order, status } = req.body;

      await AdminExaminationModel.updateExamType(id, {
        examId: exam_id !== undefined ? parseInt(exam_id, 10) : undefined,
        academicYear: academic_year !== undefined ? parseInt(academic_year, 10) : undefined,
        examType: exam_type ? exam_type.trim() : undefined,
        sortOrder: sort_order !== undefined ? parseInt(sort_order, 10) : undefined,
        status: status !== undefined ? parseInt(status, 10) : undefined,
        schoolId,
      });

      return ApiResponse.success(res, 'Exam type updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteExamType(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      await AdminExaminationModel.deleteExamType(id, schoolId);
      return ApiResponse.success(res, 'Exam type deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 4. EXAM SUBJECTS & MARKS CONFIGURATION
  // =========================================================

  static async getExamSubjectsList(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, class_id } = req.query;

      const examSubjects = await AdminExaminationModel.getExamSubjectsList(
        schoolId,
        exam_id ? parseInt(exam_id, 10) : undefined,
        class_id ? parseInt(class_id, 10) : undefined
      );

      let config = {};
      if (exam_id && class_id) {
        config = await AdminExaminationModel.getExamSubjectConfig({
          schoolId,
          examId: parseInt(exam_id, 10),
          classId: parseInt(class_id, 10),
          configuredOnly: true,
        });
      }

      return ApiResponse.success(res, 'Exam subjects retrieved successfully.', {
        examSubjects,
        ...config,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getExamSubjectConfig(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, class_id, configured_only } = req.query;

      if (!exam_id || !class_id) {
        return ApiResponse.error(res, 'Exam ID and Class ID are required.', null, 400);
      }

      const isConfiguredOnly =
        configured_only === 'true' || configured_only === '1' || configured_only === true;

      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal';
      const teacherId = isTeacher ? req.user?.teacherId : null;

      const config = await AdminExaminationModel.getExamSubjectConfig({
        schoolId,
        examId: parseInt(exam_id, 10),
        classId: parseInt(class_id, 10),
        configuredOnly: isConfiguredOnly,
        teacherId: teacherId ? parseInt(teacherId, 10) : null,
      });

      return ApiResponse.success(res, 'Exam subject config retrieved successfully.', config);
    } catch (error) {
      next(error);
    }
  }

  static async saveExamSubjectConfig(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, class_id, items } = req.body;

      if (!exam_id || !class_id) {
        return ApiResponse.error(res, 'Exam ID and Class ID are required.', null, 400);
      }

      if (!Array.isArray(items) || items.length === 0) {
        return ApiResponse.error(res, 'At least one subject mark configuration is required.', null, 400);
      }

      // Filter and validate items (must have positive mark and valid identifiers)
      const validItems = [];
      for (const it of items) {
        const isChecked = it.isCheck === 1 || it.is_check === 1 || it.isCheck === true || it.is_check === true;
        const markVal = parseInt(it.mark, 10);
        const subId = parseInt(it.subjectId || it.subject_id, 10);
        const typeId = parseInt(it.examTypeId || it.exam_type_id, 10);

        if (isChecked) {
          if (!subId || !typeId || isNaN(markVal) || markVal <= 0) {
            return ApiResponse.error(
              res,
              'All selected subjects must have valid marks greater than 0.',
              null,
              400
            );
          }
          validItems.push({
            subjectId: subId,
            examTypeId: typeId,
            isCheck: 1,
            mark: markVal,
          });
        }
      }

      if (validItems.length === 0) {
        return ApiResponse.error(
          res,
          'Please configure marks (greater than 0) for at least one subject.',
          null,
          400
        );
      }

      const lockStatus = await AdminExaminationModel.isExamPatternLocked({
        schoolId,
        examId: parseInt(exam_id, 10),
        classId: parseInt(class_id, 10),
      });

      if (lockStatus.isLocked) {
        return ApiResponse.error(
          res,
          `This exam pattern is locked and cannot be modified: ${lockStatus.lockReason}`,
          null,
          400
        );
      }

      const examSubjectId = await AdminExaminationModel.saveExamSubjectConfig({
        schoolId,
        examId: parseInt(exam_id, 10),
        classId: parseInt(class_id, 10),
        items: validItems,
      });

      return ApiResponse.success(res, 'Exam subject marks configured successfully.', { examSubjectId });
    } catch (error) {
      next(error);
    }
  }

  static async deleteExamSubject(req, res, next) {
    try {
      const { id } = req.params;
      const schoolId = req.user.schoolId;
      await AdminExaminationModel.deleteExamSubject(id, schoolId);
      return ApiResponse.success(res, 'Exam subject configuration deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 5. EXAM SCHEDULES
  // =========================================================

  static async getExamSchedules(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, class_id, subject_id, assigned_only, assignedOnly } = req.query;
      const academic_year_id = req.query.academic_year_id || req.query.academic_year || req.query.academicYear;

      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal';
      const teacherId = isTeacher ? (req.user?.teacherId || req.user?.id) : undefined;
      const shouldFilterAssigned = Boolean(
        assigned_only === '1' || assigned_only === 'true' || assignedOnly === '1' || assignedOnly === 'true'
      );

      const schedules = await AdminExaminationModel.getExamSchedules({
        schoolId,
        examId: exam_id ? parseInt(exam_id, 10) : undefined,
        classId: class_id ? parseInt(class_id, 10) : undefined,
        subjectId: subject_id ? parseInt(subject_id, 10) : undefined,
        academicYearId: academic_year_id ? parseInt(academic_year_id, 10) : undefined,
        teacherId,
        assignedOnly: shouldFilterAssigned,
      });

      return ApiResponse.success(res, 'Exam schedules retrieved successfully.', {
        schedules,
        isTeacherUser: isTeacher,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getExamScheduleById(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const schedule = await AdminExaminationModel.getExamScheduleById(id, schoolId);
      if (!schedule) {
        return ApiResponse.error(res, 'Exam schedule not found.', null, 404);
      }
      return ApiResponse.success(res, 'Exam schedule retrieved successfully.', { schedule });
    } catch (error) {
      next(error);
    }
  }

  static async createExamSchedule(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, class_id, subject_id, date, start_time, end_time, academic_year_id, status, items } = req.body;

      const effectiveAyId = academic_year_id
        ? parseInt(academic_year_id, 10)
        : await AdminExaminationModel.getCurrentAcademicYearId(schoolId, exam_id);

      if (Array.isArray(items) && items.length > 0) {
        if (exam_id && class_id) {
          // Verify exam subjects & marks are configured before creating schedule
          const [configured] = await pool.query(
            `SELECT esm.id 
             FROM exam_subject_master esm
             JOIN exam_subject_marks esm_marks ON esm_marks.exam_subject_id = esm.id
             WHERE esm.school_id = ? AND esm.exam_id = ? AND esm.class_id = ? AND esm.status = 1 AND esm_marks.status != 4
             LIMIT 1`,
            [schoolId, parseInt(exam_id, 10), parseInt(class_id, 10)]
          );

          if (!configured || configured.length === 0) {
            return ApiResponse.error(
              res,
              'Exam subjects and marks must be configured for this exam and class before creating an exam schedule.',
              null,
              400
            );
          }

          // Delete existing schedules for this exam and class before re-inserting
          await pool.query(
            `DELETE FROM exam_schedule WHERE school_id = ? AND exam_id = ? AND class_id = ?`,
            [schoolId, parseInt(exam_id, 10), parseInt(class_id, 10)]
          );
        }

        const createdIds = [];
        for (const item of items) {
          if (item.subject_id && item.date) {
            const id = await AdminExaminationModel.createExamSchedule({
              schoolId,
              academicYearId: effectiveAyId,
              examId: parseInt(exam_id, 10),
              classId: parseInt(class_id, 10),
              subjectId: parseInt(item.subject_id, 10),
              date: item.date.trim(),
              startTime: item.start_time ? item.start_time.trim() : '',
              endTime: item.end_time ? item.end_time.trim() : '',
              status: item.status !== undefined ? parseInt(item.status, 10) : 1,
            });
            createdIds.push(id);
          }
        }
        return ApiResponse.success(res, 'Exam schedules saved successfully.', { createdIds }, 201);
      }

      if (!exam_id || !class_id || !subject_id || !date) {
        return ApiResponse.error(res, 'Exam, Class, Subject and Date are required.', null, 400);
      }

      const scheduleId = await AdminExaminationModel.createExamSchedule({
        schoolId,
        academicYearId: effectiveAyId,
        examId: parseInt(exam_id, 10),
        classId: parseInt(class_id, 10),
        subjectId: parseInt(subject_id, 10),
        date: date.trim(),
        startTime: start_time ? start_time.trim() : '',
        endTime: end_time ? end_time.trim() : '',
        status: status !== undefined ? parseInt(status, 10) : 1,
      });

      return ApiResponse.success(res, 'Exam schedule created successfully.', { scheduleId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateExamSchedule(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      const { exam_id, class_id, subject_id, date, start_time, end_time, academic_year_id, status } = req.body;

      await AdminExaminationModel.updateExamSchedule(id, {
        examId: exam_id !== undefined ? parseInt(exam_id, 10) : undefined,
        classId: class_id !== undefined ? parseInt(class_id, 10) : undefined,
        subjectId: subject_id !== undefined ? parseInt(subject_id, 10) : undefined,
        date: date !== undefined ? date.trim() : undefined,
        startTime: start_time !== undefined ? start_time.trim() : undefined,
        endTime: end_time !== undefined ? end_time.trim() : undefined,
        academicYearId: academic_year_id !== undefined ? parseInt(academic_year_id, 10) : undefined,
        status: status !== undefined ? parseInt(status, 10) : undefined,
        schoolId,
      });

      return ApiResponse.success(res, 'Exam schedule updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteExamSchedule(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const { id } = req.params;
      await AdminExaminationModel.deleteExamSchedule(id, schoolId);
      return ApiResponse.success(res, 'Exam schedule deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 5. EXAM ATTENDANCE
  // =========================================================

  static async getStudentsForExamAttendance(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, class_id, section_id, subject_id, exam_schedule_id, academic_year_id, roster, page, limit, search } = req.query;

      if (!exam_id || !class_id) {
        return ApiResponse.error(res, 'Exam ID and Class ID are required.', null, 400);
      }

      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal';
      const teacherId = isTeacher ? (req.user?.teacherId || req.user?.id) : undefined;

      const result = await AdminExaminationModel.getStudentsForExamAttendance({
        schoolId,
        examId: parseInt(exam_id, 10),
        classId: parseInt(class_id, 10),
        sectionId: section_id ? parseInt(section_id, 10) : undefined,
        subjectId: subject_id ? parseInt(subject_id, 10) : undefined,
        examScheduleId: exam_schedule_id ? parseInt(exam_schedule_id, 10) : undefined,
        academicYearId: academic_year_id ? parseInt(academic_year_id, 10) : undefined,
        roster: roster === 'true' || roster === '1' || roster === true,
        page: page !== undefined ? (Number(page) || 1) : 1,
        limit: limit !== undefined ? (Number(limit) || 10) : 10,
        search: typeof search === 'string' ? search.trim() : undefined,
        teacherId,
      });

      return ApiResponse.success(res, 'Students for exam attendance retrieved.', {
        students: result.students,
        subjects: result.subjects,
        rawAttendance: result.rawAttendance,
        hasAttendance: result.hasAttendance,
        isLocked: result.isLocked !== undefined ? result.isLocked : false,
        hasSchedule: result.hasSchedule !== undefined ? result.hasSchedule : true,
        examSchedule: result.examSchedule || null,
        message: result.message || null,
        isSubjectEditable: result.isSubjectEditable !== undefined ? result.isSubjectEditable : true,
        isTeacherUser: isTeacher,
        total: result.total !== undefined ? result.total : (result.students ? result.students.length : 0),
        page: result.page !== undefined ? result.page : (Number(page) || 1),
        limit: result.limit !== undefined ? result.limit : (Number(limit) || 10),
        totalPages: result.totalPages !== undefined ? result.totalPages : 1,
      });
    } catch (error) {
      next(error);
    }
  }

  static async saveExamAttendanceBatch(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const userRole = req.user.roleName || req.user.role || '';
      const { exam_id, class_id, section_id, subject_id, exam_schedule_id, schedule_id, academic_year_id, records } = req.body;

      if (!exam_id || !class_id || !Array.isArray(records)) {
        return ApiResponse.error(res, 'Exam, Class, and Attendance records are required.', null, 400);
      }

      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal';
      if (isTeacher) {
        const teacherId = req.user?.teacherId || req.user?.id;
        if (!teacherId) {
          return ApiResponse.error(res, 'Teacher identification not found in session.', null, 403);
        }

        const assignedSubjectIds = await AdminExaminationModel.getTeacherAssignedSubjectIds({
          schoolId,
          teacherId,
          classId: parseInt(class_id, 10),
        });

        if (!assignedSubjectIds.includes(parseInt(subject_id, 10))) {
          return ApiResponse.error(
            res,
            'You are not authorized to mark attendance for this subject. You can only mark attendance for your assigned subject(s).',
            null,
            403
          );
        }
      }

      const scheduleIdVal = exam_schedule_id || schedule_id;

      await AdminExaminationModel.saveExamAttendanceBatch({
        schoolId,
        academicYearId: academic_year_id ? parseInt(academic_year_id, 10) : undefined,
        examId: parseInt(exam_id, 10),
        classId: parseInt(class_id, 10),
        sectionId: section_id ? parseInt(section_id, 10) : undefined,
        subjectId: subject_id ? parseInt(subject_id, 10) : undefined,
        examScheduleId: scheduleIdVal ? parseInt(scheduleIdVal, 10) : undefined,
        records,
        userRole,
        isTeacher,
        isAdminOrSchool: !isTeacher || req.user?.portalType === 'AdminPortal' || req.user?.adminType === 1 || req.user?.adminType === 2,
      });

      return ApiResponse.success(res, 'Exam attendance saved successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 6. EXAM RESULTS & MARKS
  // =========================================================

  static async getExamResultsList(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { exam_id, class_id, section_id, academic_year_id } = req.query;

      const data = await AdminExaminationModel.getExamResultsList({
        schoolId,
        examId: exam_id ? parseInt(exam_id, 10) : undefined,
        classId: class_id ? parseInt(class_id, 10) : undefined,
        sectionId: section_id ? parseInt(section_id, 10) : undefined,
        academicYearId: academic_year_id ? parseInt(academic_year_id, 10) : undefined,
      });

      return ApiResponse.success(res, 'Exam results list retrieved.', data);
    } catch (error) {
      next(error);
    }
  }

  static async getStudentMarksheet(req, res, next) {
    try {
      const studentId = req.params.studentId || req.query.student_id || req.query.studentId;
      const examId = req.query.exam_id || req.query.examId;

      if (!examId || !studentId) {
        return ApiResponse.error(res, 'Both exam_id and student_id are required.', null, 400);
      }

      const marksheet = await AdminExaminationModel.getStudentMarksheet({
        studentId: parseInt(studentId, 10),
        examId: parseInt(examId, 10),
      });

      if (!marksheet) {
        return ApiResponse.error(res, 'Marksheet not found for student and exam.', null, 404);
      }

      return ApiResponse.success(res, 'Student marksheet retrieved successfully.', marksheet);
    } catch (error) {
      next(error);
    }
  }

  static async saveStudentMarksBatch(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const {
        exam_id,
        examId,
        class_id,
        classId,
        academic_year_id,
        academicYearId,
        student_id,
        studentId,
        student_marks,
        items,
      } = req.body;

      const finalExamId = parseInt(exam_id || examId, 10);
      const finalClassId = parseInt(class_id || classId, 10);
      const finalYearId = academic_year_id || academicYearId ? parseInt(academic_year_id || academicYearId, 10) : undefined;

      const isTeacher = req.user?.roleName === 'Teacher' || req.user?.portalType === 'TeacherPortal';
      let assignedSubjectIds = null;

      if (isTeacher) {
        const teacherId = req.user?.teacherId;
        if (!teacherId) {
          return ApiResponse.error(res, 'Teacher identification not found in session.', null, 403);
        }

        const [assignRows] = await pool.query(
          `SELECT subject_id FROM teacher_class_assign 
           WHERE school_id = ? AND teacher_id = ? AND class_id = ? AND status = 1`,
          [schoolId, teacherId, finalClassId]
        );
        assignedSubjectIds = assignRows.map((r) => r.subject_id);

        if (assignedSubjectIds.length === 0) {
          return ApiResponse.error(
            res,
            'You are not assigned as a teacher for any subject in this class.',
            null,
            403
          );
        }
      }

      let marksList = [];

      if (Array.isArray(student_marks)) {
        marksList = student_marks;
      } else if (Array.isArray(items) && (student_id || studentId)) {
        marksList = [
          {
            studentId: parseInt(student_id || studentId, 10),
            marksPerSubject: items.map((it) => ({
              subjectId: it.subject_id || it.subjectId,
              examTypeId: it.exam_type_id || it.examTypeId,
              marks: it.marks,
              gradeId: it.grade_id || it.gradeId,
            })),
          },
        ];
      } else {
        return ApiResponse.error(res, 'Marks items or student_marks array is required.', null, 400);
      }

      // If teacher, filter marksPerSubject so only assigned subject marks are submitted
      if (isTeacher && assignedSubjectIds) {
        marksList = marksList
          .map((st) => ({
            ...st,
            marksPerSubject: (st.marksPerSubject || []).filter((sm) =>
              assignedSubjectIds.includes(parseInt(sm.subjectId || sm.subject_id, 10))
            ),
          }))
          .filter((st) => st.marksPerSubject && st.marksPerSubject.length > 0);

        if (marksList.length === 0) {
          return ApiResponse.error(
            res,
            'You are only authorized to enter or update marks for your assigned subject(s).',
            null,
            403
          );
        }
      }

      // If teacher, enforce that the student is marked present (attendance_status = 1) for each subject
      if (isTeacher) {
        for (const st of marksList) {
          const sId = st.studentId;
          const subjectIds = [
            ...new Set((st.marksPerSubject || []).map((sm) => parseInt(sm.subjectId || sm.subject_id, 10))),
          ];

          if (subjectIds.length > 0) {
            const [attRecords] = await pool.query(
              `SELECT subject_id, attendance_status 
               FROM exam_attendance 
               WHERE school_id = ? AND exam_id = ? AND student_id = ? AND subject_id IN (?) AND status != 4`,
              [schoolId, finalExamId, sId, subjectIds]
            );

            const presentSubjectIdSet = new Set(
              attRecords
                .filter((r) => Number(r.attendance_status) === 1)
                .map((r) => r.subject_id)
            );

            const unpermittedSubjects = subjectIds.filter((subId) => !presentSubjectIdSet.has(subId));
            if (unpermittedSubjects.length > 0) {
              const [unpRows] = await pool.query(
                `SELECT subject_name FROM subject_master WHERE id IN (?)`,
                [unpermittedSubjects]
              );
              const unpNames = unpRows.map((r) => r.subject_name).join(', ') || 'the selected subject(s)';
              return ApiResponse.error(
                res,
                `Cannot enter marks: The student is not marked present in exam attendance for ${unpNames}.`,
                null,
                403
              );
            }
          }
        }
      }

      await AdminExaminationModel.saveStudentMarksBatch({
        schoolId,
        academicYearId: finalYearId,
        examId: finalExamId,
        classId: finalClassId,
        studentMarksList: marksList,
      });

      return ApiResponse.success(res, 'Student marks saved and grades computed successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 7. A4 PORTRAIT MARKSHEET & PAGINATED STUDENTS
  // =========================================================

  static async getMarksheetStudents(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const {
        academicYearId,
        academic_year_id,
        classId,
        class_id,
        sectionId,
        section_id,
        search,
        page = 1,
        limit = 10,
      } = { ...req.query, ...req.body };

      const finalYearId = academicYearId || academic_year_id ? parseInt(academicYearId || academic_year_id, 10) : null;
      const finalClassId = classId || class_id ? parseInt(classId || class_id, 10) : null;
      const finalSectionId = sectionId || section_id ? parseInt(sectionId || section_id, 10) : null;

      const result = await AdminExaminationModel.getMarksheetStudentsPaginated({
        schoolId,
        academicYearId: finalYearId,
        classId: finalClassId,
        sectionId: finalSectionId,
        search,
        page,
        limit,
      });

      return ApiResponse.success(res, 'Marksheet student list retrieved successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  static async downloadMarksheetPdf(req, res, next) {
    try {
      const schoolId = req.user?.schoolId;
      const params = { ...req.query, ...req.body, ...req.params };
      const {
        studentId,
        student_id,
        studentIds,
        classId,
        class_id,
        sectionId,
        section_id,
        academicYearId,
        academic_year_id,
      } = params;

      let parsedStudentIds = [];
      const singleId = studentId || student_id;
      if (singleId) {
        parsedStudentIds = [parseInt(singleId, 10)];
      } else if (Array.isArray(studentIds)) {
        parsedStudentIds = studentIds.map((id) => parseInt(id, 10)).filter(Boolean);
      } else if (typeof studentIds === 'string' && studentIds.trim()) {
        parsedStudentIds = studentIds.split(',').map((id) => parseInt(id.trim(), 10)).filter(Boolean);
      }

      const finalClassId = classId || class_id ? parseInt(classId || class_id, 10) : null;
      const finalSectionId = sectionId || section_id ? parseInt(sectionId || section_id, 10) : null;
      const finalYearId = academicYearId || academic_year_id ? parseInt(academicYearId || academic_year_id, 10) : null;

      const marksheetData = await AdminExaminationModel.getMarksheetDataForPdf({
        schoolId,
        studentIds: parsedStudentIds,
        classId: finalClassId,
        sectionId: finalSectionId,
        academicYearId: finalYearId,
      });

      if (!marksheetData || marksheetData.length === 0) {
        return ApiResponse.error(res, 'No marksheet records found for the selected student(s)', null, 404);
      }

      if (req.query.format === 'json') {
        return ApiResponse.success(res, 'Marksheet data retrieved successfully', marksheetData);
      }

      const pdfBuffer = await MarksheetPdfService.generateMarksheetPdfBuffer(marksheetData);

      let fileName = 'Student_Marksheet.pdf';
      if (marksheetData.length === 1 && marksheetData[0].student) {
        const s = marksheetData[0].student;
        const sName = `${s.first_name || ''}_${s.last_name || ''}`.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'Student';
        fileName = `Marksheet_${sName}_${s.admission_no || s.id || ''}.pdf`;
      } else {
        fileName = `Marksheet_Batch_${new Date().toISOString().split('T')[0]}.pdf`;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } catch (error) {
      console.error('Marksheet PDF generation error:', error);
      next(error);
    }
  }

  // =========================================================
  // 8. A4 PORTRAIT ADMIT CARD PDF GENERATION
  // =========================================================

  static async downloadAdmitCardPdf(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const params = { ...req.query, ...req.body, ...req.params };
      const {
        studentId,
        student_id,
        studentIds,
        classId,
        class_id,
        sectionId,
        section_id,
        academicYearId,
        academic_year_id,
        examId,
        exam_id,
      } = params;

      let parsedStudentIds = [];
      const singleId = studentId || student_id;
      if (singleId) {
        parsedStudentIds = [parseInt(singleId, 10)];
      } else if (Array.isArray(studentIds)) {
        parsedStudentIds = studentIds.map((id) => parseInt(id, 10)).filter(Boolean);
      } else if (typeof studentIds === 'string' && studentIds.trim()) {
        parsedStudentIds = studentIds.split(',').map((id) => parseInt(id.trim(), 10)).filter(Boolean);
      }

      const finalClassId = classId || class_id ? parseInt(classId || class_id, 10) : null;
      const finalSectionId = sectionId || section_id ? parseInt(sectionId || section_id, 10) : null;
      const finalYearId = academicYearId || academic_year_id ? parseInt(academicYearId || academic_year_id, 10) : null;
      const finalExamId = examId || exam_id ? parseInt(examId || exam_id, 10) : null;

      const admitCardData = await AdminExaminationModel.getAdmitCardDataForPdf({
        schoolId,
        studentIds: parsedStudentIds,
        classId: finalClassId,
        sectionId: finalSectionId,
        academicYearId: finalYearId,
        examId: finalExamId,
      });

      if (!admitCardData || admitCardData.length === 0) {
        return ApiResponse.error(res, 'No student records found for the selected criteria to generate Admit Cards', null, 404);
      }

      if (req.query.format === 'json') {
        return ApiResponse.success(res, 'Admit card data retrieved successfully', admitCardData);
      }

      const pdfBuffer = await AdmitCardPdfService.generateAdmitCardPdfBuffer(admitCardData);

      let fileName = 'Student_Admit_Card.pdf';
      if (admitCardData.length === 1 && admitCardData[0].student) {
        const s = admitCardData[0].student;
        const sName = `${s.first_name || ''}_${s.last_name || ''}`.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'Student';
        fileName = `AdmitCard_${sName}_${s.admission_no || s.id || ''}.pdf`;
      } else {
        fileName = `AdmitCards_Batch_${new Date().toISOString().split('T')[0]}.pdf`;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } catch (error) {
      console.error('Admit Card PDF generation error:', error);
      next(error);
    }
  }
}

module.exports = AdminExaminationController;
