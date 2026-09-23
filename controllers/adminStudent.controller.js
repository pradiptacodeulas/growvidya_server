const StudentModel = require('../models/student.model');
const SubscriptionModel = require('../models/subscription.model');
const ApiResponse = require('../utils/api.response');
const { getBase64FileSize } = require('../utils/file.util');

class AdminStudentController {
  static async getAllStudents(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id || 1;
      const paramsSrc = { ...req.query, ...req.body };
      
      const search = paramsSrc.search || paramsSrc.name || '';
      const academicYear = paramsSrc.academicYear || paramsSrc.academic_year || paramsSrc.academicYearId || paramsSrc.academic_year_id || paramsSrc.yearId || paramsSrc.year || '';
      const classId = paramsSrc.classId || paramsSrc.class || paramsSrc.class_id || '';
      const sectionId = paramsSrc.sectionId || paramsSrc.section || paramsSrc.section_id || '';
      const status = paramsSrc.status !== undefined ? paramsSrc.status : '';
      const admissionDate = paramsSrc.admissionDate || paramsSrc.date || paramsSrc.admission_date || '';
      const branchId = req.branchId || paramsSrc.branch_id || paramsSrc.branchId || null;
      const page = paramsSrc.page || 1;
      const limit = paramsSrc.limit || 12;
      const offset = (Number(page) - 1) * Number(limit);

      const { students, total } = await StudentModel.getAll(schoolId, {
        search: String(search).trim(),
        academicYear,
        classId,
        sectionId,
        status,
        admissionDate,
        branchId,
        limit: Number(limit),
        offset,
      });

      return ApiResponse.success(res, 'Students fetched successfully.', {
        students,
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

  static async getStudentById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      let studentId = req.params.id;

      if (typeof studentId === 'string' && !/^\d+$/.test(studentId)) {
        try {
          const decoded = Buffer.from(studentId, 'base64').toString('utf-8');
          if (/^\d+$/.test(decoded)) {
            studentId = decoded;
          }
        } catch (e) {}
      }

      const student = await StudentModel.getById(studentId, schoolId);

      if (!student) {
        return ApiResponse.error(res, 'Student record not found.', null, 404);
      }

      return ApiResponse.success(res, 'Student details fetched successfully.', { student });
    } catch (error) {
      next(error);
    }
  }

  static async checkEmail(req, res, next) {
    try {
      const schoolId = req.user.schoolId || req.user.school_id || 1;
      const email = req.query.email || req.body.email;
      const studentId = req.query.studentId || req.query.id || null;

      if (!email || !String(email).trim()) {
        return ApiResponse.success(res, 'Email query is empty.', { isDuplicate: false });
      }

      const existing = await StudentModel.checkDuplicateEmail(schoolId, email, studentId);
      if (existing) {
        return ApiResponse.success(res, 'Email is already registered.', {
          isDuplicate: true,
          student: {
            id: existing.id,
            name: `${existing.first_name || ''} ${existing.last_name || ''}`.trim(),
            admission_number: existing.admission_number,
          },
        });
      }

      return ApiResponse.success(res, 'Email is available.', { isDuplicate: false });
    } catch (error) {
      next(error);
    }
  }

  static async createStudent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { first_name, class_id, email_address } = req.body;

      if (!first_name || !class_id) {
        return ApiResponse.error(res, 'First name and Class selection are required.', null, 400);
      }

      // Enforce subscription plan student quota
      const quotaCheck = await SubscriptionModel.checkQuota(schoolId, 'students');
      if (!quotaCheck.allowed) {
        return ApiResponse.error(
          res,
          quotaCheck.message,
          {
            code: 'STUDENT_QUOTA_EXCEEDED',
            quota: quotaCheck,
          },
          403
        );
      }

      // Check duplicate email
      if (email_address && String(email_address).trim()) {
        const existingStudent = await StudentModel.checkDuplicateEmail(schoolId, email_address);
        if (existingStudent) {
          return ApiResponse.error(res, 'A student with this email address already exists.', null, 400);
        }
      }

      // Security check: Profile pictures must not exceed 100 KB
      const MAX_IMAGE_SIZE = 100 * 1024; // 100 KB
      if (req.body.picture && getBase64FileSize(req.body.picture) > MAX_IMAGE_SIZE) {
        return ApiResponse.error(res, 'Student profile picture must not exceed 100 KB.', null, 400);
      }
      if (req.body.father_info?.father_picture && getBase64FileSize(req.body.father_info.father_picture) > MAX_IMAGE_SIZE) {
        return ApiResponse.error(res, "Father's profile picture must not exceed 100 KB.", null, 400);
      }
      if (req.body.mother_info?.mother_picture && getBase64FileSize(req.body.mother_info.mother_picture) > MAX_IMAGE_SIZE) {
        return ApiResponse.error(res, "Mother's profile picture must not exceed 100 KB.", null, 400);
      }

      const branchId = req.body.branch_id || req.body.branchId || req.branchId || null;
      const newId = await StudentModel.create({
        ...req.body,
        branch_id: branchId,
        school_id: schoolId,
      });

      return ApiResponse.success(res, 'Student created successfully.', { id: newId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateStudent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const studentId = req.params.id;
      const { first_name, class_id, email_address } = req.body;

      if (!first_name || !class_id) {
        return ApiResponse.error(res, 'First name and Class selection are required.', null, 400);
      }

      // Check duplicate email (excluding current student)
      if (email_address && String(email_address).trim()) {
        const existingStudent = await StudentModel.checkDuplicateEmail(schoolId, email_address, studentId);
        if (existingStudent) {
          return ApiResponse.error(res, 'A student with this email address already exists.', null, 400);
        }
      }

      // Security check: Profile pictures must not exceed 100 KB
      const MAX_IMAGE_SIZE = 100 * 1024; // 100 KB
      if (req.body.picture && getBase64FileSize(req.body.picture) > MAX_IMAGE_SIZE) {
        return ApiResponse.error(res, 'Student profile picture must not exceed 100 KB.', null, 400);
      }
      if (req.body.father_info?.father_picture && getBase64FileSize(req.body.father_info.father_picture) > MAX_IMAGE_SIZE) {
        return ApiResponse.error(res, "Father's profile picture must not exceed 100 KB.", null, 400);
      }
      if (req.body.mother_info?.mother_picture && getBase64FileSize(req.body.mother_info.mother_picture) > MAX_IMAGE_SIZE) {
        return ApiResponse.error(res, "Mother's profile picture must not exceed 100 KB.", null, 400);
      }

      if (req.body.branch_id !== undefined || req.body.branchId !== undefined) {
        req.body.branch_id = req.body.branch_id || req.body.branchId;
      }

      const updated = await StudentModel.update(studentId, schoolId, req.body);

      if (!updated) {
        return ApiResponse.error(res, 'Student record update failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Student updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteStudent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const studentId = req.params.id;

      const deleted = await StudentModel.delete(studentId, schoolId);

      if (!deleted) {
        return ApiResponse.error(res, 'Student record delete failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Student record deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async addActivity(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const studentId = req.params.id;
      const { activities } = req.body;

      if (!activities || !Array.isArray(activities) || activities.length === 0) {
        return ApiResponse.error(res, 'At least one activity with date and description is required.', null, 400);
      }

      await StudentModel.addActivity(studentId, schoolId, activities);
      return ApiResponse.success(res, 'Activity added successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteActivity(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const activityId = req.params.activityId;

      const deleted = await StudentModel.deleteActivity(activityId, schoolId);
      if (!deleted) {
        return ApiResponse.error(res, 'Activity record delete failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Activity deleted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminStudentController;
