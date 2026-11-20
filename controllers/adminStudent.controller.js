const StudentModel = require('../models/student.model');
const SubscriptionModel = require('../models/subscription.model');
const ApiResponse = require('../utils/api.response');
const { getBase64FileSize } = require('../utils/file.util');
const { pool } = require('../config/db.config');

class AdminStudentController {
  static validateStudentDocuments(documents) {
    if (!Array.isArray(documents) || documents.length === 0) return null;
    const MAX_DOC_SIZE = 4 * 1024 * 1024; // 4 MB
    for (const doc of documents) {
      const rawDoc = doc?.attachments || doc?.file_url || '';
      if (typeof rawDoc === 'string' && rawDoc.startsWith('data:')) {
        if (!/^data:application\/pdf;/i.test(rawDoc)) {
          return 'Student document attachments must be PDF files only.';
        }
        if (getBase64FileSize(rawDoc) > MAX_DOC_SIZE) {
          return 'Each student document attachment must not exceed 4 MB.';
        }
      }
    }
    return null;
  }

  static async getAllStudents(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }
      const paramsSrc = { ...req.query, ...req.body };
      
      const search = paramsSrc.search || paramsSrc.name || '';
      const academicYear = paramsSrc.academicYear || paramsSrc.academic_year || paramsSrc.academicYearId || paramsSrc.academic_year_id || paramsSrc.yearId || paramsSrc.year || '';
      const classId = paramsSrc.classId || paramsSrc.class || paramsSrc.class_id || '';
      const sectionId = paramsSrc.sectionId || paramsSrc.section || paramsSrc.section_id || '';
      const status = paramsSrc.status !== undefined ? paramsSrc.status : '';
      const admissionDate = paramsSrc.admissionDate || paramsSrc.date || paramsSrc.admission_date || '';
      const sortBy = paramsSrc.sortBy || paramsSrc.sort_by || '';
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
        sortBy,
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
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      let studentId = req.params.id;

      if (typeof studentId === 'string' && !/^\d+$/.test(studentId)) {
        try {
          const decoded = Buffer.from(studentId, 'base64').toString('utf-8');
          if (/^\d+$/.test(decoded)) {
            studentId = decoded;
          }
        } catch (e) {}
      }

      const student = await StudentModel.getById(studentId, schoolId, branchId);

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
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }
      const branchId = req.query.branch_id || req.query.branchId || req.body?.branch_id || req.branchId || null;
      const email = req.query.email || req.body.email;
      const studentId = req.query.studentId || req.query.id || null;

      if (!email || !String(email).trim()) {
        return ApiResponse.success(res, 'Email query is empty.', { isDuplicate: false });
      }

      const existing = await StudentModel.checkDuplicateEmail(schoolId, email, studentId, branchId);
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

  static async checkAdmissionNumber(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }
      const branchId = req.query.branch_id || req.query.branchId || req.body?.branch_id || req.branchId || null;
      const admissionNumber = req.query.admission_number || req.query.admissionNumber || req.body?.admission_number;
      const studentId = req.query.studentId || req.query.id || null;

      if (!admissionNumber || !String(admissionNumber).trim()) {
        return ApiResponse.success(res, 'Admission number query is empty.', { isDuplicate: false });
      }

      const existing = await StudentModel.checkDuplicateAdmissionNumber(schoolId, admissionNumber, studentId, branchId);
      if (existing) {
        return ApiResponse.success(res, 'Admission number is already registered.', {
          isDuplicate: true,
          student: {
            id: existing.id,
            name: `${existing.first_name || ''} ${existing.last_name || ''}`.trim(),
            admission_number: existing.admission_number,
          },
        });
      }

      return ApiResponse.success(res, 'Admission number is available.', { isDuplicate: false });
    } catch (error) {
      next(error);
    }
  }

  static async checkRollNumber(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context required. Please log in again.', null, 401);
      }
      const branchId = req.query.branch_id || req.query.branchId || req.body?.branch_id || req.branchId || null;
      const rollNumber = req.query.roll_number || req.query.rollNumber || req.body?.roll_number;
      const classId = req.query.class_id || req.query.classId || req.body?.class_id || req.body?.class_student;
      const sectionId = req.query.section_id || req.query.sectionId || req.body?.section_id || req.body?.section_student;
      const academicYear = req.query.academic_year || req.query.academicYear || req.body?.academic_year || null;
      const studentId = req.query.studentId || req.query.id || null;

      if (!rollNumber || !String(rollNumber).trim()) {
        return ApiResponse.success(res, 'Roll number query is empty.', { isDuplicate: false, isValid: false });
      }

      const formatCheck = StudentModel.validateRollNumberFormat(rollNumber);
      if (!formatCheck.valid) {
        return ApiResponse.success(res, formatCheck.error, {
          isDuplicate: false,
          isValid: false,
          message: formatCheck.error,
        });
      }

      if (!classId) {
        return ApiResponse.success(res, 'Roll number format is valid.', { isDuplicate: false, isValid: true });
      }

      const existing = await StudentModel.checkDuplicateRollNumber(schoolId, {
        rollNumber: formatCheck.value,
        classId,
        sectionId,
        academicYear,
        excludeStudentId: studentId,
        branchId,
      });

      if (existing) {
        return ApiResponse.success(res, 'Roll number is already assigned in this class/section.', {
          isDuplicate: true,
          isValid: true,
          student: {
            id: existing.id,
            name: `${existing.first_name || ''} ${existing.last_name || ''}`.trim(),
            admission_number: existing.admission_number,
            roll_number: existing.roll_number,
          },
        });
      }

      return ApiResponse.success(res, 'Roll number is available.', { isDuplicate: false, isValid: true });
    } catch (error) {
      next(error);
    }
  }

  static async createStudent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.body.branch_id || req.body.branchId || req.branchId || req.user?.branch_id || req.user?.branchId || null;
      const { first_name, class_id, section_id, roll_number, admission_date, date_of_birth, academic_year, email_address, admission_number } = req.body || {};

      if (!first_name || !class_id) {
        return ApiResponse.error(res, 'First name and Class selection are required.', null, 400);
      }

      // Validate Admission Date
      const admDateCheck = StudentModel.parseAndValidateDate(admission_date, {
        fieldLabel: 'Admission Date',
        allowFuture: true,
        minYear: 1900,
      });
      if (!admDateCheck.valid) {
        return ApiResponse.error(res, admDateCheck.error, null, 400);
      }
      const effectiveAdmissionDate = admDateCheck.value || StudentModel.getLocalTodayDate();
      req.body.admission_date = effectiveAdmissionDate;

      // Validate Date of Birth
      if (date_of_birth !== undefined && date_of_birth !== null && String(date_of_birth).trim() !== '') {
        const dobCheck = StudentModel.parseAndValidateDate(date_of_birth, {
          fieldLabel: 'Date of Birth',
          allowFuture: false,
          minYear: 1900,
          maxDateYMD: effectiveAdmissionDate,
        });
        if (!dobCheck.valid) {
          return ApiResponse.error(res, dobCheck.error, null, 400);
        }
        req.body.date_of_birth = dobCheck.value;
      }

      // Validate Roll Number format and duplicate check
      if (roll_number !== undefined && roll_number !== null && String(roll_number).trim() !== '') {
        const rollCheck = StudentModel.validateRollNumberFormat(roll_number);
        if (!rollCheck.valid) {
          return ApiResponse.error(res, rollCheck.error, null, 400);
        }
        req.body.roll_number = rollCheck.value;

        const existingRoll = await StudentModel.checkDuplicateRollNumber(schoolId, {
          rollNumber: rollCheck.value,
          classId: class_id,
          sectionId: section_id || req.body.section_student,
          academicYear: academic_year,
          excludeStudentId: null,
          branchId,
        });
        if (existingRoll) {
          return ApiResponse.error(
            res,
            'A student with this roll number already exists in the selected class and section.',
            null,
            400
          );
        }
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

      // Check duplicate admission number within school + branch scope
      if (admission_number && String(admission_number).trim()) {
        const existingAdm = await StudentModel.checkDuplicateAdmissionNumber(schoolId, admission_number, null, branchId);
        if (existingAdm) {
          return ApiResponse.error(res, 'A student with this admission number already exists.', null, 400);
        }
      }

      // Check duplicate email within branch scope
      if (email_address && String(email_address).trim()) {
        const existingStudent = await StudentModel.checkDuplicateEmail(schoolId, email_address, null, branchId);
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

      const docError = AdminStudentController.validateStudentDocuments(req.body.documents);
      if (docError) {
        return ApiResponse.error(res, docError, null, 400);
      }

      const newId = await StudentModel.create({
        ...req.body,
        branch_id: branchId,
        school_id: schoolId,
      });

      return ApiResponse.success(res, 'Student created successfully.', { id: newId }, 201);
    } catch (error) {
      if (error && error.code === 'STUDENT_QUOTA_EXCEEDED') {
        return ApiResponse.error(
          res,
          error.message,
          { code: 'STUDENT_QUOTA_EXCEEDED', quota: error.quota || null },
          403
        );
      }
      next(error);
    }
  }

  static async updateStudent(req, res, next) {
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

      const branchId = req.body.branch_id || req.body.branchId || req.branchId || req.user?.branch_id || req.user?.branchId || null;
      const { first_name, class_id, section_id, roll_number, admission_date, date_of_birth, academic_year, email_address, admission_number } = req.body || {};

      if (!first_name || !class_id) {
        return ApiResponse.error(res, 'First name and Class selection are required.', null, 400);
      }

      // Validate Admission Date if provided
      let effectiveAdmissionDate = null;
      if (admission_date !== undefined && admission_date !== null && String(admission_date).trim() !== '') {
        const admDateCheck = StudentModel.parseAndValidateDate(admission_date, {
          fieldLabel: 'Admission Date',
          allowFuture: true,
          minYear: 1900,
        });
        if (!admDateCheck.valid) {
          return ApiResponse.error(res, admDateCheck.error, null, 400);
        }
        effectiveAdmissionDate = admDateCheck.value;
        req.body.admission_date = effectiveAdmissionDate;
      }

      // Validate Date of Birth if provided
      if (date_of_birth !== undefined && date_of_birth !== null && String(date_of_birth).trim() !== '') {
        const dobCheck = StudentModel.parseAndValidateDate(date_of_birth, {
          fieldLabel: 'Date of Birth',
          allowFuture: false,
          minYear: 1900,
          maxDateYMD: effectiveAdmissionDate,
        });
        if (!dobCheck.valid) {
          return ApiResponse.error(res, dobCheck.error, null, 400);
        }
        req.body.date_of_birth = dobCheck.value;
      }

      // Validate Roll Number format and duplicate check if provided
      if (roll_number !== undefined && roll_number !== null && String(roll_number).trim() !== '') {
        const rollCheck = StudentModel.validateRollNumberFormat(roll_number);
        if (!rollCheck.valid) {
          return ApiResponse.error(res, rollCheck.error, null, 400);
        }
        req.body.roll_number = rollCheck.value;

        const existingRoll = await StudentModel.checkDuplicateRollNumber(schoolId, {
          rollNumber: rollCheck.value,
          classId: class_id,
          sectionId: section_id || req.body.section_student,
          academicYear: academic_year,
          excludeStudentId: studentId,
          branchId,
        });
        if (existingRoll) {
          return ApiResponse.error(
            res,
            'A student with this roll number already exists in the selected class and section.',
            null,
            400
          );
        }
      }

      // Prevent student quota bypass via restoring a soft-deleted student (status: 4 -> 1 or 2)
      if (req.body.status !== undefined && [1, 2].includes(Number(req.body.status))) {
        const [existingStatusRows] = await pool.query(
          'SELECT status FROM student_master WHERE id = ? AND school_id = ? LIMIT 1',
          [studentId, schoolId]
        );
        if (existingStatusRows.length > 0 && Number(existingStatusRows[0].status) === 4) {
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
        }
      }

      // Check duplicate admission number within school + branch scope (excluding current student)
      if (admission_number && String(admission_number).trim()) {
        const existingAdm = await StudentModel.checkDuplicateAdmissionNumber(schoolId, admission_number, studentId, branchId);
        if (existingAdm) {
          return ApiResponse.error(res, 'A student with this admission number already exists.', null, 400);
        }
      }

      // Check duplicate email within branch scope (excluding current student)
      if (email_address && String(email_address).trim()) {
        const existingStudent = await StudentModel.checkDuplicateEmail(schoolId, email_address, studentId, branchId);
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

      const docError = AdminStudentController.validateStudentDocuments(req.body.documents);
      if (docError) {
        return ApiResponse.error(res, docError, null, 400);
      }

      if (branchId) {
        req.body.branch_id = branchId;
      }

      const updated = await StudentModel.update(studentId, schoolId, req.body, branchId);

      if (!updated) {
        return ApiResponse.error(res, 'Student record update failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Student updated successfully.');
    } catch (error) {
      if (error && error.code === 'STUDENT_QUOTA_EXCEEDED') {
        return ApiResponse.error(
          res,
          error.message,
          { code: 'STUDENT_QUOTA_EXCEEDED', quota: error.quota || null },
          403
        );
      }
      next(error);
    }
  }

  static async deleteStudent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const studentId = req.params.id;
      const branchId = req.branchId || req.query.branch_id || null;

      const deleted = await StudentModel.delete(studentId, schoolId, branchId);

      if (!deleted) {
        return ApiResponse.error(res, 'Student record delete failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Student record deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async _notifyParentsOnActivityAdded(schoolId, branchId, entries = []) {
    try {
      if (!Array.isArray(entries) || entries.length === 0) {
        return { pushSent: false, notifiedParentsCount: 0, quotaExhausted: false };
      }

      const { pool } = require('../config/db.config');
      const NotificationRecordModel = require('../models/notificationRecord.model');
      const PushNotificationService = require('../services/pushNotification.service');
      const { getIO } = require('../services/socket.service');

      const studentIds = [...new Set(entries.map((e) => Number(e.student_id)).filter((id) => id > 0))];
      if (studentIds.length === 0) {
        return { pushSent: false, notifiedParentsCount: 0, quotaExhausted: false };
      }

      // Resolve active students and their active linked parents
      const [rows] = await pool.query(
        `
        SELECT 
          s.id AS student_id,
          s.first_name,
          s.last_name,
          s.branch_id,
          sp.father_id,
          sp.mother_id,
          sp.guardian_id
        FROM student_master s
        LEFT JOIN student_to_parent sp ON sp.student_id = s.id AND sp.school_id = s.school_id AND sp.status = 1
        WHERE s.school_id = ? AND s.status = 1 AND s.id IN (${studentIds.map(() => '?').join(',')})
        `,
        [schoolId, ...studentIds]
      );

      if (!rows || rows.length === 0) {
        return { pushSent: false, notifiedParentsCount: 0, quotaExhausted: false };
      }

      const studentInfoMap = new Map();
      const allParentIds = new Set();

      for (const r of rows) {
        const sid = Number(r.student_id);
        if (!studentInfoMap.has(sid)) {
          const fullName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Student';
          studentInfoMap.set(sid, {
            id: sid,
            name: fullName,
            branch_id: r.branch_id ? Number(r.branch_id) : (branchId ? Number(branchId) : null),
            parentIds: new Set(),
          });
        }
        const info = studentInfoMap.get(sid);
        if (r.father_id) {
          info.parentIds.add(Number(r.father_id));
          allParentIds.add(Number(r.father_id));
        }
        if (r.mother_id) {
          info.parentIds.add(Number(r.mother_id));
          allParentIds.add(Number(r.mother_id));
        }
        if (r.guardian_id) {
          info.parentIds.add(Number(r.guardian_id));
          allParentIds.add(Number(r.guardian_id));
        }
      }

      if (allParentIds.size === 0) {
        return {
          pushSent: false,
          notifiedParentsCount: 0,
          quotaExhausted: false,
          message: 'No linked parent accounts found for the selected student(s).',
        };
      }

      // Check Push Notification Quota in school wallet
      const creditCheck = await NotificationRecordModel.checkWalletCredits(schoolId, 'push', 1);
      if (!creditCheck.allowed || creditCheck.balance <= 0) {
        return {
          pushSent: false,
          notifiedParentsCount: 0,
          quotaExhausted: true,
          message: 'Push notification quota exhausted. Parents can refresh their portal to view the latest activities.',
        };
      }

      // Group entries by (date + activity_description) so bulk activities use a single multicast call
      const groupsMap = new Map();
      for (const entry of entries) {
        const sid = Number(entry.student_id);
        const sInfo = studentInfoMap.get(sid);
        if (!sInfo || sInfo.parentIds.size === 0) continue;

        const desc = String(entry.activity_description || '').trim();
        const dt = String(entry.date || '').split('T')[0].trim();
        if (!desc || !dt) continue;

        const key = `${dt}||${desc}`;
        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            date: dt,
            description: desc,
            studentIds: new Set(),
            studentNames: [],
            parentIds: new Set(),
            branchId: sInfo.branch_id || (branchId ? Number(branchId) : null),
          });
        }
        const grp = groupsMap.get(key);
        if (!grp.studentIds.has(sid)) {
          grp.studentIds.add(sid);
          grp.studentNames.push(sInfo.name);
        }
        for (const pid of sInfo.parentIds) {
          grp.parentIds.add(pid);
        }
      }

      let totalDevicesSent = 0;
      const notifiedParentSet = new Set();
      const io = getIO();

      for (const grp of groupsMap.values()) {
        // Re-check quota before each group in case multiple distinct descriptions were submitted
        const currentCredit = await NotificationRecordModel.checkWalletCredits(schoolId, 'push', 1);
        if (!currentCredit.allowed || currentCredit.balance <= 0) {
          break;
        }

        const isSingleStudent = grp.studentNames.length === 1;
        const title = isSingleStudent
          ? `New Activity: ${grp.studentNames[0]}`
          : 'New Student Activity Logged';
        const bodyText = isSingleStudent
          ? `${grp.studentNames[0]}: ${grp.description}`
          : `${grp.description} (${grp.date})`;
        const truncatedBody = bodyText.length > 140 ? `${bodyText.substring(0, 137)}...` : bodyText;

        const parentList = Array.from(grp.parentIds).slice(0, currentCredit.balance);
        const recipients = parentList.map((pid) => ({ id: pid, role: 'parent' }));

        const pushPayload = {
          type: 'activity',
          category: 'activity',
          date: grp.date,
          url: '/parent/activities',
        };

        const pushRes = await PushNotificationService.sendToTargetedRecipients({
          recipients,
          school_id: schoolId,
          branch_id: grp.branchId,
          title,
          body: truncatedBody,
          data: pushPayload,
          category: 'activity',
          billable: true,
        });

        const sentDevices = Number(pushRes?.totalDevices || pushRes?.sentCount || 0);
        totalDevicesSent += sentDevices;

        // If no Web/FCM device tokens were registered for these parents, log billable push for real-time socket alert (capped to balance)
        if (sentDevices === 0 && io && parentList.length > 0) {
          for (const pid of parentList) {
            await NotificationRecordModel.logPush({
              school_id: schoolId,
              branch_id: grp.branchId,
              recipient_device_token: `socket_parent_${pid}`,
              recipient_device_type: 'web',
              title,
              message: truncatedBody,
              payload: pushPayload,
              recipient_role: 'parent',
              recipient_id: pid,
              category: 'activity',
              status: 'sent',
              provider: 'webpush',
              billable: true,
            }).catch(() => {});
          }
        }

        // Emit real-time Socket.IO event to parents (within quota) and students
        if (io) {
          const socketPayload = {
            id: `act_${Date.now()}`,
            type: 'activity',
            category: 'activity',
            title,
            message: truncatedBody,
            activity_description: grp.description,
            date: grp.date,
            publish_on: grp.date,
            notice_date: grp.date,
            studentIds: Array.from(grp.studentIds),
            url: '/parent/activities',
          };

          for (const pid of parentList) {
            notifiedParentSet.add(pid);
            io.to(`user_parent_${pid}`).emit('student_activity_added', socketPayload);
            io.to(`user_parent_${pid}`).emit('new_notice', socketPayload);
          }

          for (const sid of grp.studentIds) {
            io.to(`user_student_${sid}`).emit('student_activity_added', {
              ...socketPayload,
              url: '/student/activities',
            });
          }
        } else {
          for (const pid of parentList) {
            notifiedParentSet.add(pid);
          }
        }
      }

      return {
        pushSent: notifiedParentSet.size > 0 || totalDevicesSent > 0,
        notifiedParentsCount: notifiedParentSet.size,
        totalDevicesSent,
        quotaExhausted: false,
      };
    } catch (err) {
      console.error('[Student Activity Push Notification Error]:', err.message);
      return { pushSent: false, notifiedParentsCount: 0, quotaExhausted: false };
    }
  }

  static async addActivity(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const studentId = req.params.id;
      const { activities, notify_parents = true } = req.body;
      const branchId = req.branchId || req.body?.branch_id || req.body?.branchId || null;

      if (!activities || !Array.isArray(activities) || activities.length === 0) {
        return ApiResponse.error(res, 'At least one activity with date and description is required.', null, 400);
      }

      await StudentModel.addActivity(studentId, schoolId, activities, branchId);

      const entries = activities.map((a) => ({
        student_id: Number(studentId),
        date: a.date,
        activity_description: a.activity_description,
      }));
      const notificationStatus = await AdminStudentController._notifyParentsOnActivityAdded(
        schoolId,
        branchId,
        entries
      );

      return ApiResponse.success(res, 'Activity added successfully.', { notification: notificationStatus });
    } catch (error) {
      next(error);
    }
  }

  static async getActivitiesList(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const {
        classId = '',
        class_id = '',
        sectionId = '',
        section_id = '',
        search = '',
        date = '',
        fromDate = '',
        toDate = '',
        studentId = '',
        page = 1,
        limit = 20,
      } = req.query;

      const result = await StudentModel.getActivitiesList(schoolId, {
        branchId,
        classId: classId || class_id,
        sectionId: sectionId || section_id,
        search,
        date,
        fromDate,
        toDate,
        studentId,
        page,
        limit,
      });

      return ApiResponse.success(res, 'Student activities fetched successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  static async bulkAddActivities(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.branchId || req.body?.branch_id || req.body?.branchId || null;
      const { entries, studentIds, date, activity_description, notify_parents = true } = req.body;

      let normalizedEntries = [];
      if (Array.isArray(entries) && entries.length > 0) {
        normalizedEntries = entries;
      } else if (Array.isArray(studentIds) && studentIds.length > 0 && date && activity_description) {
        normalizedEntries = studentIds.map((sid) => ({
          student_id: Number(sid),
          date,
          activity_description,
        }));
      }

      if (normalizedEntries.length === 0) {
        return ApiResponse.error(
          res,
          'Please select at least one student and provide an activity date and description.',
          null,
          400
        );
      }

      const insertRes = await StudentModel.bulkAddActivities(schoolId, normalizedEntries, branchId);
      if (!insertRes.insertedCount) {
        return ApiResponse.error(res, 'No valid student activities were provided to save.', null, 400);
      }

      const notificationStatus = await AdminStudentController._notifyParentsOnActivityAdded(
        schoolId,
        branchId,
        insertRes.entries || normalizedEntries
      );

      const message = `Successfully added activity for ${insertRes.insertedCount} ${
        insertRes.insertedCount === 1 ? 'student' : 'students'
      }.`;

      return ApiResponse.success(res, message, {
        insertedCount: insertRes.insertedCount,
        studentIds: insertRes.studentIds,
        notification: notificationStatus,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateActivity(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const activityId = req.params.activityId;
      const branchId = req.branchId || req.body?.branch_id || req.query?.branch_id || null;
      const { date, activity_description } = req.body;

      if (!date || !activity_description || !String(activity_description).trim()) {
        return ApiResponse.error(res, 'Activity date and description are required.', null, 400);
      }

      const updated = await StudentModel.updateActivity(
        activityId,
        schoolId,
        { date, activity_description },
        branchId
      );
      if (!updated) {
        return ApiResponse.error(res, 'Activity record not found or update failed.', null, 404);
      }

      return ApiResponse.success(res, 'Activity updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteActivity(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const activityId = req.params.activityId;
      const branchId = req.branchId || req.query.branch_id || null;

      const deleted = await StudentModel.deleteActivity(activityId, schoolId, branchId);
      if (!deleted) {
        return ApiResponse.error(res, 'Activity record delete failed or not found.', null, 400);
      }

      return ApiResponse.success(res, 'Activity deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async promoteStudents(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const promotedBy = req.user?.userId || req.user?.id || null;
      const branchId = req.branchId || req.body?.branch_id || req.body?.branchId || null;
      const {
        from_academic_year,
        to_academic_year,
        to_class_id,
        to_section_id = null,
        students = [],
      } = req.body;

      if (!Array.isArray(students) || students.length === 0) {
        return ApiResponse.error(res, 'Please select at least one student to process.', null, 400);
      }

      const needsTargetClass = students.some(
        (s) => String(s.promotion_status || 'promoted').toLowerCase() === 'promoted'
      );

      if (!to_academic_year || (needsTargetClass && !to_class_id)) {
        return ApiResponse.error(
          res,
          'Target academic year and target class are required.',
          null,
          400
        );
      }

      const isSameYear =
        from_academic_year && String(from_academic_year) === String(to_academic_year);
      const allowsSameYearHoldUpdate = students.every((s) =>
        ['assign_hold', 'hold'].includes(String(s.promotion_status || '').toLowerCase())
      );

      if (isSameYear && !allowsSameYearHoldUpdate) {
        return ApiResponse.error(
          res,
          'Target academic year must be different from the current academic year.',
          null,
          400
        );
      }

      const result = await StudentModel.promoteStudents(schoolId, {
        fromAcademicYear: from_academic_year ? Number(from_academic_year) : null,
        toAcademicYear: Number(to_academic_year),
        toClassId: to_class_id ? Number(to_class_id) : null,
        toSectionId: to_section_id ? Number(to_section_id) : null,
        students,
        promotedBy,
        branchId,
      });

      return ApiResponse.success(
        res,
        `${result.promotedCount} student record(s) processed successfully.`,
        result
      );
    } catch (error) {
      if (error && error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  static async getPromotionTargetStatus(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const branchId = req.branchId || req.query?.branch_id || req.query?.branchId || null;
      const toAcademicYear =
        req.query?.toAcademicYear || req.query?.to_academic_year || req.query?.academicYear || '';
      const toClassId = req.query?.toClassId || req.query?.to_class_id || req.query?.classId || '';

      if (!toAcademicYear || !toClassId) {
        return ApiResponse.success(res, 'Target promotion status fetched.', {
          sections: [],
          totalCapacity: 0,
          totalEnrolled: 0,
          totalRemaining: 0,
          heldCount: 0,
        });
      }

      const statusData = await StudentModel.getPromotionTargetStatus(schoolId, {
        toAcademicYear: Number(toAcademicYear),
        toClassId: Number(toClassId),
        branchId,
      });

      return ApiResponse.success(res, 'Target promotion status fetched successfully.', statusData);
    } catch (error) {
      next(error);
    }
  }

  static async getPromotionHistory(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const branchId = req.branchId || req.query?.branch_id || req.query?.branchId || null;
      const { fromAcademicYear = '', toAcademicYear = '', classId = '' } = req.query;

      const history = await StudentModel.getPromotionHistory(schoolId, {
        branchId,
        fromAcademicYear,
        toAcademicYear,
        classId,
      });

      return ApiResponse.success(res, 'Promotion history fetched successfully.', { history });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminStudentController;
