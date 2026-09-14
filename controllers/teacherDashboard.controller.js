const { pool } = require('../config/db.config');
const TeacherModel = require('../models/teacher.model');
const AnnouncementModel = require('../models/announcement.model');
const AttendanceModel = require('../models/attendance.model');
const ApiResponse = require('../utils/api.response');

class TeacherDashboardController {
  static async getDashboardData(req, res, next) {
    try {
      const teacherId = req.user.teacherId || req.user.userId;
      const schoolId = req.user.schoolId || req.user.school_id || 1;

      // 1. Get Teacher Profile
      const teacher = await TeacherModel.findAuthProfileById(teacherId);
      if (!teacher) {
        return ApiResponse.error(res, 'Teacher profile not found.', null, 404);
      }

      // 2. Get Academic Year
      const [academicYears] = await pool.query(
        `SELECT id, academic_year, start_date, end_date, is_current FROM academic_year_master WHERE school_id = ? AND status = 1 ORDER BY is_current DESC, id DESC LIMIT 1`,
        [schoolId]
      );
      const currentYearObj = academicYears && academicYears.length > 0 ? academicYears[0] : null;
      const academicYearRange = currentYearObj ? AttendanceModel.formatAcademicYearRange(currentYearObj) : '2025 - 2026';
      const academicYearId = currentYearObj ? currentYearObj.id : 1;

      // 3. Get Student Counts
      let totalStudentsInClass = 0;
      let totalStudentsInSchool = 0;

      if (teacher.class && teacher.section) {
        const [classStudents] = await pool.query(
          `SELECT COUNT(*) AS count FROM student_master WHERE school_id = ? AND class = ? AND section = ? AND status = 1`,
          [schoolId, teacher.class, teacher.section]
        );
        totalStudentsInClass = classStudents[0]?.count || 0;
      } else if (teacher.class_assignments && teacher.class_assignments.length > 0) {
        const classIds = teacher.class_assignments.map((c) => c.class_id).filter(Boolean);
        if (classIds.length > 0) {
          const [classStudents] = await pool.query(
            `SELECT COUNT(DISTINCT id) AS count FROM student_master WHERE school_id = ? AND class IN (?) AND status = 1`,
            [schoolId, classIds]
          );
          totalStudentsInClass = classStudents[0]?.count || 0;
        }
      }

      const [schoolStudents] = await pool.query(
        `SELECT COUNT(*) AS count FROM student_master WHERE school_id = ? AND status = 1`,
        [schoolId]
      );
      totalStudentsInSchool = schoolStudents[0]?.count || 0;

      // 4. Today's Date and Day
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const now = new Date();
      const todayDayName = days[now.getDay()];
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayDate = `${year}-${month}-${day}`;

      let attendanceSummary = {
        total: totalStudentsInClass || totalStudentsInSchool,
        present: 0,
        absent: 0,
        late: 0,
        halfday: 0,
        marked: false,
      };

      if (teacher.class && teacher.section) {
        const [attRows] = await pool.query(
          `SELECT sa.attendance, COUNT(*) AS count 
           FROM student_attendance sa
           JOIN student_master s ON sa.student_id = s.id
           WHERE sa.school_id = ? 
             AND s.class = ? 
             AND s.section = ? 
             AND sa.date = ? 
             AND sa.status = 1 
           GROUP BY sa.attendance`,
          [schoolId, teacher.class, teacher.section, todayDate]
        );

        if (attRows && attRows.length > 0) {
          attendanceSummary.marked = true;
          let markedTotal = 0;
          for (const row of attRows) {
            const val = String(row.attendance).toLowerCase();
            const cnt = Number(row.count) || 0;
            markedTotal += cnt;
            if (val === 'present' || val === 'p' || val === '1') attendanceSummary.present += cnt;
            else if (val === 'absent' || val === 'a' || val === '2') attendanceSummary.absent += cnt;
            else if (val === 'late' || val === 'l' || val === '3') attendanceSummary.late += cnt;
            else if (val === 'halfday' || val === 'hd' || val === '4') attendanceSummary.halfday += cnt;
          }
          if (markedTotal > 0) attendanceSummary.total = markedTotal;
        }
      }

      // 5. Today's Classes (from routine / period_master)
      let todayClasses = [];
      try {
        const dayNum = now.getDay() === 0 ? 7 : now.getDay();
        const [periods] = await pool.query(
          `SELECT 
            r.id,
            r.period_id,
            pm.period_name,
            pm.start_time,
            pm.end_time,
            c.class_name,
            sec.section_name,
            sub.subject_name
          FROM routine r
          LEFT JOIN period_master pm ON r.period_id = pm.id
          LEFT JOIN days_master d ON r.day = d.id
          LEFT JOIN class_master c ON r.class_id = c.id
          LEFT JOIN section_master sec ON r.section_id = sec.id
          LEFT JOIN subject_master sub ON r.subject_id = sub.id
          WHERE r.school_id = ?
            AND (r.teacher_id = ? OR r.teacher_id = ? OR r.class_id = ? OR r.section_id = ?)
            AND (LOWER(d.day_name) = LOWER(?) OR d.id = ? OR r.day = ?)
            AND (r.status != 4 OR r.status IS NULL)
          ORDER BY pm.start_time ASC, r.id ASC`,
          [schoolId, teacherId, teacher.teacher_id || '', teacher.class || 0, teacher.section || 0, todayDayName, dayNum, dayNum]
        );
        todayClasses = periods || [];
      } catch (err) {
        console.error('Error fetching todayClasses:', err.message);
      }

      // 6. Recent Notices & Announcements
      let notices = [];
      try {
        notices = await AnnouncementModel.getAllNotices(schoolId);
      } catch (err) {
        console.error('Error fetching notices:', err.message);
      }

      // 7. Upcoming Events & Holidays
      let events = [];
      let holidays = [];
      try {
        events = await AnnouncementModel.getAllEvents(schoolId);
        holidays = await AnnouncementModel.getAllHolidays(schoolId);
      } catch (err) {
        console.error('Error fetching events/holidays:', err.message);
      }

      // 8. Assignments & Syllabus Counters
      let totalAssignments = 0;
      let totalSyllabus = 0;
      try {
        const [assignRows] = await pool.query(
          `SELECT COUNT(*) AS count FROM assignments WHERE school_id = ? AND (status != 4 OR status IS NULL)`,
          [schoolId]
        );
        totalAssignments = assignRows[0]?.count || 0;

        const [sylRows] = await pool.query(
          `SELECT COUNT(*) AS count FROM syllabus WHERE school_id = ? AND (status != 4 OR status IS NULL)`,
          [schoolId]
        );
        totalSyllabus = sylRows[0]?.count || 0;
      } catch (err) {
        console.error('Error counting assignments/syllabus:', err.message);
      }

      const { password: _, passcode: __, otp: ___, ...safeTeacher } = teacher;

      return ApiResponse.success(res, 'Teacher dashboard data loaded successfully.', {
        teacher: {
          id: safeTeacher.id,
          teacherId: safeTeacher.teacher_id,
          name: `${safeTeacher.first_name || ''} ${safeTeacher.last_name || ''}`.trim(),
          firstName: safeTeacher.first_name,
          lastName: safeTeacher.last_name,
          email: safeTeacher.email_address,
          phone: safeTeacher.primary_contact_number,
          picture: safeTeacher.picture,
          className: safeTeacher.class_name || null,
          classId: safeTeacher.class || null,
          sectionName: safeTeacher.section_name || null,
          sectionId: safeTeacher.section || null,
          subjectName: safeTeacher.subject_name || null,
          classAssignments: safeTeacher.class_assignments || [],
          qualification: safeTeacher.qualification,
          schoolName: safeTeacher.school_name || 'Growvidya School',
        },
        academicYear: {
          id: academicYearId,
          range: academicYearRange,
        },
        counts: {
          totalStudentsInClass,
          totalStudentsInSchool,
          todayClassesCount: todayClasses.length,
          totalAssignments,
          totalSyllabus,
          totalNotices: notices.length,
        },
        attendanceSummary,
        todayClasses,
        todayDayName,
        todayDate,
        notices: notices.slice(0, 5),
        events: events.slice(0, 5),
        holidays: holidays.slice(0, 5),
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = TeacherDashboardController;
