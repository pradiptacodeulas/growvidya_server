const ApiResponse = require('../utils/api.response');
const ParentModel = require('../models/parent.model');
const AcademicModel = require('../models/academic.model');
const AnnouncementModel = require('../models/announcement.model');
const { pool } = require('../config/db.config');

/**
 * Helper to check if an assignment deadline has passed
 * @param {string|Date} dueDateStr
 * @returns {boolean}
 */
const isAssignmentExpired = (dueDateStr) => {
  if (!dueDateStr) return false;
  const str = String(dueDateStr).trim();
  let deadline;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    // If only date is provided (YYYY-MM-DD), expires at 23:59:59.999 of that day
    deadline = new Date(`${str}T23:59:59.999`);
  } else {
    // Has time or ISO format (e.g. YYYY-MM-DD HH:mm:ss or YYYY-MM-DDTHH:mm:ss)
    deadline = new Date(str.replace(' ', 'T'));
  }
  return !isNaN(deadline.getTime()) && Date.now() > deadline.getTime();
};

class StudentPortalController {
  static getStudentId(req) {
    return req.user?.studentId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    const schoolId = req.user?.schoolId || req.user?.school_id;
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }
    return Number(schoolId);
  }

  static getBranchId(req) {
    return req.branchId || req.user?.branchId || req.user?.branch_id || null;
  }

  /**
   * Get Student Dashboard Overview
   */
  static async getDashboard(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const userBranchId = StudentPortalController.getBranchId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      if (!student) {
        return ApiResponse.error(res, 'Student record not found.', null, 404);
      }

      const branchId = userBranchId || student.branch_id || null;
      const classId = student.class;
      const sectionId = student.section;

      // 1. Attendance Summary
      let attendancePercentage = 0;
      let presentDays = 0;
      let totalDays = 0;
      try {
        const [attRows] = await pool.query(
          `SELECT attendance, COUNT(*) as cnt 
           FROM student_attendance 
           WHERE student_id = ? AND (school_id = ? OR ? IS NULL)
           GROUP BY attendance`,
          [studentId, schoolId, schoolId]
        );
        let present = 0;
        let total = 0;
        (attRows || []).forEach((r) => {
          const count = Number(r.cnt || 0);
          total += count;
          if (r.attendance === 1 || r.attendance === '1') present += count;
          else if (r.attendance === 2 || r.attendance === '2') present += count * 0.8;
          else if (r.attendance === 3 || r.attendance === '3') present += count * 0.5;
        });
        totalDays = total;
        presentDays = present;
        if (total > 0) {
          attendancePercentage = Math.round((present / total) * 100);
        }
      } catch (e) {
        console.error('Error fetching attendance summary for student:', e.message);
      }

      // 2. Fees Due Summary
      let feeSummary = { totalAmount: 0, paidAmount: 0, dueAmount: 0 };
      try {
        const fees = await ParentModel.getChildFees(studentId, schoolId);
        if (fees && fees.metrics) {
          feeSummary = {
            totalAmount: fees.metrics.totalPayable || 0,
            paidAmount: fees.metrics.totalPaid || 0,
            dueAmount: fees.metrics.totalOutstanding || 0,
          };
        }
      } catch (e) {
        console.error('Error fetching fees summary for student:', e.message);
      }

      // 3. Timetable / Today's Classes
      let todayClasses = [];
      let weeklyClassesCount = 0;
      try {
        let routines = await ParentModel.getChildTimetable(studentId, schoolId, classId, sectionId);
        if ((!routines || routines.length === 0) && classId && sectionId) {
          routines = await ParentModel.getChildTimetable(studentId, schoolId, classId, null);
        }
        weeklyClassesCount = routines.length;

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const now = new Date();
        const todayDayName = dayNames[now.getDay()].toLowerCase();
        const dayNum = now.getDay() === 0 ? 7 : now.getDay();

        todayClasses = routines.filter((r) => {
          const rDayName = String(r.day_name || '').toLowerCase().trim();
          const rDay = Number(r.day);
          return rDayName === todayDayName || rDay === dayNum;
        }).map((cls, idx) => ({
          ...cls,
          period: cls.period || cls.period_name || `P${idx + 1}`,
          start_time: cls.start_time ? String(cls.start_time).slice(0, 5) : '',
          end_time: cls.end_time ? String(cls.end_time).slice(0, 5) : '',
        }));
      } catch (e) {
        console.error('Error fetching today classes for student:', e.message);
      }

      // 4. Study Materials Count
      let materialsCount = 0;
      try {
        const materials = await ParentModel.getChildStudyMaterials(classId, schoolId, studentId);
        materialsCount = materials.length;
      } catch (e) {
        console.error('Error fetching study materials count:', e.message);
      }

      // 5. Recent Notices (Target-filtered for this student)
      let notices = [];
      try {
        const allNotices = await AnnouncementModel.getAllNotices(schoolId, branchId, true);
        const filteredNotices = (allNotices || []).filter((n) => {
          if (Number(n.status ?? 1) !== 1) return false;
          const type = n.target_type || 'all';

          if (type === 'class_section') {
            const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
            const isTargetedRole = roles.length === 0 || roles.includes('student');
            if (!isTargetedRole) return false;

            const noticeClasses = (n.target_classes || []).map(Number);
            const noticeSections = (n.target_sections || []).map(Number);

            if (noticeClasses.length > 0 && (!classId || !noticeClasses.includes(Number(classId)))) {
              return false;
            }
            if (noticeSections.length > 0 && (!sectionId || !noticeSections.includes(Number(sectionId)))) {
              return false;
            }
            return true;
          }

          if (type === 'specific_users') {
            return (n.target_user_ids || []).some((u) => {
              if (typeof u === 'object' && u !== null) {
                const uRole = String(u.role || '').toLowerCase();
                return Number(u.id) === Number(studentId) && (!uRole || uRole === 'student');
              }
              return false;
            });
          }

          const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
          const msgTo = (n.message_to || []).map((m) => String(m).toLowerCase());
          if (roles.length === 0 && msgTo.length === 0) return true;
          return (
            roles.includes('student') ||
            roles.includes('all') ||
            msgTo.includes('student') ||
            msgTo.includes('1') ||
            msgTo.includes('all')
          );
        });

        notices = filteredNotices.slice(0, 5);
      } catch (e) {
        console.error('Error fetching notices for student:', e.message);
      }

      // 6. Activities
      let activities = [];
      try {
        activities = (await ParentModel.getChildActivities(studentId, schoolId)) || [];
      } catch (e) {
        console.error('Error fetching activities for student:', e.message);
      }

      // 7. Assignments Summary from MySQL assignments & student_assignment_attempts
      let totalAssignments = 0;
      let attemptedAssignments = 0;
      let pendingAssignments = 0;
      try {
        const stats = await AcademicModel.getStudentDashboardAssignmentStats(
          studentId,
          schoolId,
          branchId,
          classId,
          sectionId
        );
        totalAssignments = stats.totalAssignments;
        attemptedAssignments = stats.attemptedAssignments;
        pendingAssignments = stats.pendingAssignments;
      } catch (e) {
        console.error('Error fetching assignments stats:', e.message);
      }

      return ApiResponse.success(res, 'Student dashboard fetched successfully.', {
        student,
        metrics: {
          attendancePercentage,
          presentDays,
          totalDays,
          dueAmount: feeSummary.dueAmount,
          paidAmount: feeSummary.paidAmount,
          totalFee: feeSummary.totalAmount,
          weeklyClassesCount,
          todayClassesCount: todayClasses.length,
          materialsCount,
          activitiesCount: activities.length,
          totalAssignments,
          attemptedAssignments,
          pendingAssignments: pendingAssignments >= 0 ? pendingAssignments : 0,
        },
        todayClasses,
        notices,
        recentActivities: activities.slice(0, 5),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Full Profile
   */
  static async getProfile(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      if (!student) {
        return ApiResponse.error(res, 'Student profile not found.', null, 404);
      }

      return ApiResponse.success(res, 'Student profile fetched successfully.', student);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Student Profile
   */
  static async updateProfile(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const {
        primary_contact_number,
        email_address,
        blood_group,
        mother_tongue,
        ...allowedUpdates
      } = req.body || {};

      const updated = await ParentModel.updateChildProfile(
        studentId,
        schoolId,
        null,
        allowedUpdates
      );

      return ApiResponse.success(res, 'Profile updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Attendance
   */
  static async getAttendance(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const { month, year } = req.query;

      const data = await ParentModel.getChildAttendance(studentId, schoolId, { month, year });
      return ApiResponse.success(res, 'Student attendance fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Timetable / Routine
   */
  static async getTimetable(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      const classId = student ? student.class : null;
      const sectionId = student ? student.section : null;
      const branchId = student ? student.branch_id : null;

      let data = await ParentModel.getChildTimetable(studentId, schoolId, classId, sectionId);
      if ((!data || data.length === 0) && classId && sectionId) {
        data = await ParentModel.getChildTimetable(studentId, schoolId, classId, null);
      }

      const formatted = (data || []).map((cls, idx) => ({
        ...cls,
        period: cls.period || cls.period_name || `P${idx + 1}`,
        start_time: cls.start_time ? String(cls.start_time).slice(0, 5) : '',
        end_time: cls.end_time ? String(cls.end_time).slice(0, 5) : '',
      }));

      const AcademicModel = require('../models/academic.model');
      let rawDays = await AcademicModel.getDays(schoolId, branchId);
      let days = (rawDays || []).filter((d) => Number(d.status) === 1);
      if (days.length === 0 && branchId) {
        const schoolDays = await AcademicModel.getDays(schoolId, null);
        days = (schoolDays || []).filter((d) => Number(d.status) === 1);
      }

      return ApiResponse.success(res, 'Student timetable fetched successfully.', {
        routines: formatted,
        days,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Exam Results / Marksheet
   */
  static async getExamResults(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const data = await ParentModel.getChildExamResults(studentId, schoolId);
      return ApiResponse.success(res, 'Student exam results fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Syllabus
   */
  static async getSyllabus(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      const classId = student ? (student.class || student.class_id || student.classId) : null;
      const branchId = student ? (student.branch_id || student.branchId || null) : null;

      const data = await ParentModel.getChildSyllabus(studentId, schoolId, classId, branchId, req.query);
      return ApiResponse.success(res, 'Student syllabus fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Study Materials
   */
  static async getStudyMaterials(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      const classId = student ? student.class : null;

      const data = await ParentModel.getChildStudyMaterials(classId, schoolId, studentId);
      return ApiResponse.success(res, 'Student study materials fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Activities
   */
  static async getActivities(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const data = await ParentModel.getChildActivities(studentId, schoolId);
      return ApiResponse.success(res, 'Student activities fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Fees & Invoices
   */
  static async getFees(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const data = await ParentModel.getChildFees(studentId, schoolId);
      return ApiResponse.success(res, 'Student fees fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Transport
   */
  static async getTransport(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const data = await ParentModel.getChildTransport(studentId, schoolId);
      return ApiResponse.success(res, 'Student transport details fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Hostel
   */
  static async getHostel(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const data = await ParentModel.getChildHostel(studentId, schoolId);
      return ApiResponse.success(res, 'Student hostel details fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Medical History
   */
  static async getMedical(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const data = await ParentModel.getChildMedical(studentId, schoolId);
      return ApiResponse.success(res, 'Student medical records fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Uploaded Documents
   */
  static async getDocuments(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const data = await ParentModel.getChildDocuments(studentId, schoolId);
      return ApiResponse.success(res, 'Student documents fetched successfully.', data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Student Assignments
   */
  static async getAssignments(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const userBranchId = StudentPortalController.getBranchId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      const branchId = userBranchId || student?.branch_id || null;
      const classId = student ? student.class : null;
      const sectionId = student ? student.section : null;

      const evaluatedRows = await AcademicModel.getStudentAssignments(
        studentId,
        schoolId,
        branchId,
        classId,
        sectionId
      );

      return ApiResponse.success(res, 'Student assignments fetched successfully.', evaluatedRows);
    } catch (error) {
      console.error('Error in StudentPortalController.getAssignments:', error);
      next(error);
    }
  }

  /**
   * Get Single Assignment Details & Questions for Student Attempt
   */
  static async getAssignmentForAttempt(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const assignmentId = req.params.id;

      const data = await AcademicModel.getStudentAssignmentForAttempt(assignmentId, studentId, schoolId);
      return ApiResponse.success(res, 'Assignment details fetched successfully.', data);
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 404) {
        return ApiResponse.error(res, error.message, error.data || null, error.statusCode);
      }
      console.error('Error in getAssignmentForAttempt:', error);
      next(error);
    }
  }

  /**
   * Submit Assignment Attempt & Calculate Score
   */
  static async submitAssignmentAttempt(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const assignmentId = req.params.id;
      const { answers, isAutoSubmit, is_auto_submit } = req.body || {};
      const userBranchId = req.user?.branch_id || req.user?.branchId || null;

      const result = await AcademicModel.submitStudentAssignmentAttempt(
        assignmentId,
        studentId,
        schoolId,
        {
          answers,
          isAutoSubmit: Boolean(isAutoSubmit || is_auto_submit),
        },
        userBranchId
      );

      return ApiResponse.success(res, 'Assignment submitted successfully!', result);
    } catch (error) {
      if (error.statusCode === 400 || error.statusCode === 403 || error.statusCode === 404) {
        return ApiResponse.error(res, error.message, error.data || null, error.statusCode);
      }
      console.error('Error submitting assignment attempt:', error);
      next(error);
    }
  }

  /**
   * Get Student Assignment Results with Questions, Options & Student Answers
   */
  static async getAssignmentResult(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const assignmentId = req.params.id;

      const result = await AcademicModel.getStudentAssignmentResult(assignmentId, studentId, schoolId);
      if (!result) {
        return ApiResponse.error(res, 'Assignment not found', null, 404);
      }

      return ApiResponse.success(res, 'Assignment result fetched successfully.', result);
    } catch (error) {
      console.error('Error fetching assignment result:', error);
      next(error);
    }
  }

  /**
   * Get Targeted School Notices for Student
   */
  static async getNotices(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const userBranchId = StudentPortalController.getBranchId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      if (!student) {
        return ApiResponse.error(res, 'Student profile not found.', null, 404);
      }

      const branchId = userBranchId || student.branch_id || null;
      const studentClass = student.class ? Number(student.class) : null;
      const studentSection = student.section ? Number(student.section) : null;

      const allNotices = await AnnouncementModel.getAllNotices(schoolId, branchId, true);

      const filtered = (allNotices || []).filter((n) => {
        if (Number(n.status ?? 1) !== 1) return false;
        const type = n.target_type || 'all';

        if (type === 'class_section') {
          const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
          const isTargetedRole = roles.length === 0 || roles.includes('student');
          if (!isTargetedRole) return false;

          const noticeClasses = (n.target_classes || []).map(Number);
          const noticeSections = (n.target_sections || []).map(Number);

          // If classes specified, must match student's class
          if (noticeClasses.length > 0 && (!studentClass || !noticeClasses.includes(studentClass))) {
            return false;
          }

          // If sections specified, must match student's section
          if (noticeSections.length > 0 && (!studentSection || !noticeSections.includes(studentSection))) {
            return false;
          }

          return true;
        }

        if (type === 'specific_users') {
          return (n.target_user_ids || []).some((u) => {
            if (typeof u === 'object' && u !== null) {
              const uRole = String(u.role || '').toLowerCase();
              return Number(u.id) === Number(studentId) && (!uRole || uRole === 'student');
            }
            return false;
          });
        }

        // Default: 'all' / School-Wide
        const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
        const msgTo = (n.message_to || []).map((m) => String(m).toLowerCase());
        if (roles.length === 0 && msgTo.length === 0) return true;
        return (
          roles.includes('student') ||
          roles.includes('all') ||
          msgTo.includes('student') ||
          msgTo.includes('1') ||
          msgTo.includes('all')
        );
      });

      return ApiResponse.success(res, 'Student notices fetched successfully.', filtered);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get School Holidays for Student (scoped to student's campus + school-wide holidays)
   */
  static async getHolidays(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const userBranchId = StudentPortalController.getBranchId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      const branchId = userBranchId || student?.branch_id || null;

      const holidays = await AnnouncementModel.getAllHolidays(schoolId, branchId);
      const activeHolidays = (holidays || []).filter((h) => Number(h.status ?? 1) === 1);

      return ApiResponse.success(res, 'Student holidays fetched successfully.', activeHolidays);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = StudentPortalController;

