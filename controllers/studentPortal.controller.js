const ApiResponse = require('../utils/api.response');
const ParentModel = require('../models/parent.model');
const AcademicModel = require('../models/academic.model');
const AnnouncementModel = require('../models/announcement.model');
const { pool } = require('../config/db.config');

class StudentPortalController {
  static getStudentId(req) {
    return req.user?.studentId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    return req.user?.schoolId || 1;
  }

  /**
   * Get Student Dashboard Overview
   */
  static async getDashboard(req, res, next) {
    try {
      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      if (!student) {
        return ApiResponse.error(res, 'Student record not found.', null, 404);
      }

      const classId = student.class;
      const sectionId = student.section;

      // 1. Attendance Summary
      let attendancePercentage = 100;
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
        const routines = await ParentModel.getChildTimetable(studentId, schoolId, classId, sectionId);
        weeklyClassesCount = routines.length;
        const currentDayIndex = new Date().getDay();
        const currentDayId = currentDayIndex === 0 ? 7 : currentDayIndex;
        todayClasses = routines.filter((r) => Number(r.day) === currentDayId);
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

      // 5. Recent Notices
      let notices = [];
      try {
        const [noticeRows] = await pool.query(
          `SELECT id, title, message, notice_date, publish_on, created_at 
           FROM notice 
           WHERE (school_id = ? OR ? IS NULL) AND status != 4 AND status != 0
           ORDER BY id DESC LIMIT 5`,
          [schoolId, schoolId]
        );
        notices = noticeRows || [];
      } catch (e) {
        console.error('Error fetching notices for student:', e.message);
      }

      // 7. Assignments Summary from MySQL assignments & student_assignment_attempts
      let totalAssignments = 0;
      let attemptedAssignments = 0;
      let pendingAssignments = 0;
      try {
        const assignSql = `
          SELECT 
            a.id,
            att.id AS attempt_id
          FROM assignments a
          LEFT JOIN student_assignment_attempts att ON (a.id = att.assignment_id AND att.student_id = ?)
          WHERE (a.school_id = ? OR ? IS NULL)
            AND (a.class_id = ? OR ? IS NULL)
            AND (a.section_id = ? OR a.section_id IS NULL OR a.section_id = 0 OR ? IS NULL)
            AND a.status != 4
            AND a.is_published = 1;
        `;
        const [assignRows] = await pool.query(assignSql, [
          studentId,
          schoolId,
          schoolId,
          classId,
          classId,
          sectionId,
          sectionId,
        ]);
        const assignmentsList = assignRows || [];
        totalAssignments = assignmentsList.length;
        attemptedAssignments = assignmentsList.filter((a) => a.attempt_id != null).length;
        pendingAssignments = totalAssignments - attemptedAssignments;
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

      const updated = await ParentModel.updateChildProfile(
        studentId,
        schoolId,
        null,
        req.body
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

      let data = await ParentModel.getChildTimetable(studentId, schoolId, classId, sectionId);
      if ((!data || data.length === 0) && classId && sectionId) {
        data = await ParentModel.getChildTimetable(studentId, schoolId, classId, null);
      }

      return ApiResponse.success(res, 'Student timetable fetched successfully.', data);
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

      const student = await ParentModel.getChildFullProfile(studentId, schoolId);
      const classId = student ? student.class : null;
      const sectionId = student ? student.section : null;

      const sql = `
        SELECT 
          a.id,
          a.school_id,
          a.title,
          a.assignment_type_id,
          at.type_name AS assignment_type,
          a.class_id,
          cm.class_name,
          a.section_id,
          sec.section_name,
          a.subject_id,
          COALESCE(sub.subject_name, 'General') AS subject_name,
          a.assigned_date,
          a.due_date,
          a.status AS assignment_status,
          a.is_published,
          a.created_on,
          COALESCE(q.total_questions, 0) AS total_questions,
          att.id AS attempt_id,
          att.correct_answers,
          att.score_percentage,
          att.attempted_at,
          CASE 
            WHEN att.id IS NOT NULL THEN 'Attempted'
            WHEN a.due_date < CURDATE() THEN 'Expired'
            ELSE 'Pending'
          END AS status
        FROM assignments a
        LEFT JOIN assignment_types at ON a.assignment_type_id = at.id
        LEFT JOIN class_master cm ON a.class_id = cm.id
        LEFT JOIN section_master sec ON a.section_id = sec.id
        LEFT JOIN subject_master sub ON a.subject_id = sub.id
        LEFT JOIN (
          SELECT assignment_id, COUNT(*) AS total_questions
          FROM assignment_questions
          GROUP BY assignment_id
        ) q ON a.id = q.assignment_id
        LEFT JOIN student_assignment_attempts att ON (a.id = att.assignment_id AND att.student_id = ?)
        WHERE (a.school_id = ? OR ? IS NULL)
          AND (a.class_id = ? OR ? IS NULL)
          AND (a.section_id = ? OR a.section_id IS NULL OR a.section_id = 0 OR ? IS NULL)
          AND a.status != 4
          AND a.is_published = 1
        ORDER BY a.id DESC;
      `;

      const [rows] = await pool.query(sql, [
        studentId,
        schoolId,
        schoolId,
        classId,
        classId,
        sectionId,
        sectionId,
      ]);

      return ApiResponse.success(res, 'Student assignments fetched successfully.', rows || []);
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

      // 1. Fetch assignment info
      const [asgRows] = await pool.query(
        `SELECT 
           a.*,
           COALESCE(sub.subject_name, 'General') AS subject_name,
           at.type_name AS assignment_type
         FROM assignments a
         LEFT JOIN subject_master sub ON a.subject_id = sub.id
         LEFT JOIN assignment_types at ON a.assignment_type_id = at.id
         WHERE a.id = ? AND (a.school_id = ? OR ? IS NULL) AND a.status != 4`,
        [assignmentId, schoolId, schoolId]
      );

      if (asgRows.length === 0) {
        return ApiResponse.error(res, 'Assignment not found', 404);
      }
      const assignment = asgRows[0];

      // 2. Check if student already attempted
      const [attRows] = await pool.query(
        `SELECT * FROM student_assignment_attempts WHERE assignment_id = ? AND student_id = ?`,
        [assignmentId, studentId]
      );
      const alreadyAttempted = attRows.length > 0 ? attRows[0] : null;

      // 3. Fetch questions
      const [questions] = await pool.query(
        `SELECT id, question, status FROM assignment_questions WHERE assignment_id = ? AND status = 1 ORDER BY id ASC`,
        [assignmentId]
      );

      // 4. Fetch options for each question (without revealing is_correct to the student during attempt)
      for (const q of questions) {
        const [options] = await pool.query(
          `SELECT id, answer, status FROM assignment_answers WHERE question_id = ? AND status = 1 ORDER BY id ASC`,
          [q.id]
        );
        q.options = options;
      }

      return ApiResponse.success(res, 'Assignment details fetched successfully.', {
        assignment,
        alreadyAttempted,
        questions,
      });
    } catch (error) {
      console.error('Error in getAssignmentForAttempt:', error);
      next(error);
    }
  }

  /**
   * Submit Assignment Attempt & Calculate Score
   */
  static async submitAssignmentAttempt(req, res, next) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const studentId = StudentPortalController.getStudentId(req);
      const schoolId = StudentPortalController.getSchoolId(req);
      const assignmentId = req.params.id;
      const { answers } = req.body; // { [question_id]: selected_answer_id }

      if (!answers || typeof answers !== 'object') {
        await connection.rollback();
        return ApiResponse.error(res, 'Please provide answers to submit.', 400);
      }

      // 1. Fetch questions and correct answers for this assignment
      const [questions] = await connection.query(
        `SELECT q.id AS question_id, a.id AS correct_answer_id
         FROM assignment_questions q
         LEFT JOIN assignment_answers a ON (q.id = a.question_id AND a.is_correct = 1)
         WHERE q.assignment_id = ? AND q.status = 1`,
        [assignmentId]
      );

      if (questions.length === 0) {
        await connection.rollback();
        return ApiResponse.error(res, 'No questions found for this assignment.', 400);
      }

      const totalQuestions = questions.length;
      let correctAnswersCount = 0;

      // 2. Evaluate answers
      const submissionRecords = [];
      for (const q of questions) {
        const selectedAnswerId = answers[q.question_id] ? Number(answers[q.question_id]) : null;
        const isCorrect =
          selectedAnswerId && q.correct_answer_id && selectedAnswerId === q.correct_answer_id ? 1 : 0;
        if (isCorrect) correctAnswersCount++;
        submissionRecords.push({
          question_id: q.question_id,
          selected_answer_id: selectedAnswerId,
          is_correct: isCorrect,
        });
      }

      const scorePercentage =
        totalQuestions > 0 ? ((correctAnswersCount / totalQuestions) * 100).toFixed(2) : '0.00';

      // 3. Insert or update student_assignment_attempts
      await connection.query(
        `DELETE FROM student_assignment_attempts WHERE assignment_id = ? AND student_id = ?`,
        [assignmentId, studentId]
      );

      const [attRes] = await connection.query(
        `INSERT INTO student_assignment_attempts 
         (school_id, assignment_id, student_id, total_questions, correct_answers, score_percentage, attempted_at, status)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
        [schoolId, assignmentId, studentId, totalQuestions, correctAnswersCount, scorePercentage]
      );
      const attemptId = attRes.insertId;

      // 4. Delete previous submissions if any, then insert submissions
      await connection.query(
        `DELETE FROM student_assignment_submissions WHERE assignment_id = ? AND student_id = ?`,
        [assignmentId, studentId]
      );

      for (const sub of submissionRecords) {
        await connection.query(
          `INSERT INTO student_assignment_submissions 
           (school_id, attempt_id, assignment_id, student_id, question_id, selected_answer_id, is_correct, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [schoolId, attemptId, assignmentId, studentId, sub.question_id, sub.selected_answer_id, sub.is_correct]
        );
      }

      await connection.commit();

      return ApiResponse.success(res, 'Assignment submitted successfully!', {
        attemptId,
        totalQuestions,
        correctAnswersCount,
        scorePercentage,
      });
    } catch (error) {
      await connection.rollback();
      console.error('Error submitting assignment attempt:', error);
      next(error);
    } finally {
      connection.release();
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

      // 1. Fetch assignment info
      const [asgRows] = await pool.query(
        `SELECT 
           a.*,
           COALESCE(sub.subject_name, 'General') AS subject_name,
           at.type_name AS assignment_type
         FROM assignments a
         LEFT JOIN subject_master sub ON a.subject_id = sub.id
         LEFT JOIN assignment_types at ON a.assignment_type_id = at.id
         WHERE a.id = ? AND (a.school_id = ? OR ? IS NULL)`,
        [assignmentId, schoolId, schoolId]
      );
      if (asgRows.length === 0) {
        return ApiResponse.error(res, 'Assignment not found', 404);
      }
      const assignment = asgRows[0];

      // 2. Fetch attempt info
      const [attRows] = await pool.query(
        `SELECT * FROM student_assignment_attempts WHERE assignment_id = ? AND student_id = ?`,
        [assignmentId, studentId]
      );
      const attempt = attRows[0] || null;

      // 3. Fetch questions with options and student selected answer
      const [questions] = await pool.query(
        `SELECT id, question FROM assignment_questions WHERE assignment_id = ? AND status = 1 ORDER BY id ASC`,
        [assignmentId]
      );

      const [submissions] = await pool.query(
        `SELECT question_id, selected_answer_id, is_correct FROM student_assignment_submissions WHERE assignment_id = ? AND student_id = ?`,
        [assignmentId, studentId]
      );
      const subMap = {};
      submissions.forEach((s) => {
        subMap[s.question_id] = s;
      });

      for (const q of questions) {
        const [options] = await pool.query(
          `SELECT id, answer, is_correct FROM assignment_answers WHERE question_id = ? AND status = 1 ORDER BY id ASC`,
          [q.id]
        );
        q.options = options;
        q.studentSubmission = subMap[q.id] || null;
      }

      return ApiResponse.success(res, 'Assignment result fetched successfully.', {
        assignment,
        attempt,
        questions,
      });
    } catch (error) {
      console.error('Error fetching assignment result:', error);
      next(error);
    }
  }
}

module.exports = StudentPortalController;

