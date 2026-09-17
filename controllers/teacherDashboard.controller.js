const { pool } = require('../config/db.config');
const TeacherModel = require('../models/teacher.model');
const AnnouncementModel = require('../models/announcement.model');
const AttendanceModel = require('../models/attendance.model');
const ApiResponse = require('../utils/api.response');

function calculateTeacherAttendanceStats(attRows, now = new Date()) {
  const parseStatus = (val) => {
    const s = String(val).trim().toLowerCase();
    if (s === '1' || s === 'present' || s === 'p') return '1';
    if (s === '2' || s === 'late' || s === 'l') return '2';
    if (s === '3' || s === 'halfday' || s === 'half' || s === 'hd' || s === '4') return '3';
    if (s === '0' || s === 'absent' || s === 'a') return '0';
    return null;
  };

  const toDateKey = (d) => {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const curr = new Date(now);
  const dayOfWeek = (curr.getDay() + 6) % 7; // 0=Mon, 6=Sun
  const thisWeekMonday = new Date(curr);
  thisWeekMonday.setDate(curr.getDate() - dayOfWeek);
  thisWeekMonday.setHours(0, 0, 0, 0);

  const thisWeekSunday = new Date(thisWeekMonday);
  thisWeekSunday.setDate(thisWeekMonday.getDate() + 6);
  thisWeekSunday.setHours(23, 59, 59, 999);

  const lastWeekMonday = new Date(thisWeekMonday);
  lastWeekMonday.setDate(thisWeekMonday.getDate() - 7);

  const lastWeekSunday = new Date(thisWeekMonday);
  lastWeekSunday.setDate(thisWeekMonday.getDate() - 1);
  lastWeekSunday.setHours(23, 59, 59, 999);

  const lastMonthStart = new Date(curr.getFullYear(), curr.getMonth() - 1, 1);
  const lastMonthEnd = new Date(curr.getFullYear(), curr.getMonth(), 0, 23, 59, 59, 999);

  const stats = {
    overall: { present: 0, late: 0, half: 0, absent: 0 },
    this_week: { present: 0, late: 0, half: 0, absent: 0 },
    last_week: { present: 0, late: 0, half: 0, absent: 0 },
    last_month: { present: 0, late: 0, half: 0, absent: 0 },
  };

  const attendanceMap = {};

  (attRows || []).forEach((row) => {
    const code = parseStatus(row.attendance);
    const dateKey = toDateKey(row.date);
    if (dateKey && code !== null) {
      attendanceMap[dateKey] = code;
    }

    const rowDate = row.date ? new Date(row.date) : null;

    const addStat = (target) => {
      if (code === '1') target.present++;
      else if (code === '2') target.late++;
      else if (code === '3') target.half++;
      else if (code === '0') target.absent++;
    };

    if (code !== null) {
      addStat(stats.overall);
      if (rowDate) {
        if (rowDate >= thisWeekMonday && rowDate <= thisWeekSunday) {
          addStat(stats.this_week);
        }
        if (rowDate >= lastWeekMonday && rowDate <= lastWeekSunday) {
          addStat(stats.last_week);
        }
        if (rowDate >= lastMonthStart && rowDate <= lastMonthEnd) {
          addStat(stats.last_month);
        }
      }
    }
  });

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const recentDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(thisWeekMonday);
    d.setDate(thisWeekMonday.getDate() + i);
    const key = toDateKey(d);
    recentDays.push({
      day: dayLetters[i],
      day_name: dayNames[i],
      date: key,
      status: attendanceMap[key] || '',
    });
  }

  return {
    stats,
    attendanceMap,
    recentDays,
  };
}

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

      // Student Attendance Summary (if class teacher)
      let studentAttendanceSummary = {
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
          studentAttendanceSummary.marked = true;
          let markedTotal = 0;
          for (const row of attRows) {
            const val = String(row.attendance).toLowerCase();
            const cnt = Number(row.count) || 0;
            markedTotal += cnt;
            if (val === 'present' || val === 'p' || val === '1') studentAttendanceSummary.present += cnt;
            else if (val === 'absent' || val === 'a' || val === '2') studentAttendanceSummary.absent += cnt;
            else if (val === 'late' || val === 'l' || val === '3') studentAttendanceSummary.late += cnt;
            else if (val === 'halfday' || val === 'hd' || val === '4') studentAttendanceSummary.halfday += cnt;
          }
          if (markedTotal > 0) studentAttendanceSummary.total = markedTotal;
        }
      }

      // Teacher's Personal Attendance Data
      let teacherAttendanceData = {
        present: 0,
        late: 0,
        half: 0,
        absent: 0,
      };
      let teacherAttendanceMap = {};
      let teacherAttendancePeriods = {
        this_week: { present: 0, late: 0, half: 0, absent: 0 },
        last_week: { present: 0, late: 0, half: 0, absent: 0 },
        last_month: { present: 0, late: 0, half: 0, absent: 0 },
        overall: { present: 0, late: 0, half: 0, absent: 0 },
      };
      let teacherRecentDays = [];

      try {
        const [tAttRows] = await pool.query(
          `SELECT * FROM teacher_attendance 
           WHERE (teacher_id = ? OR teacher_id = ?) 
             AND (status != 4 OR status IS NULL)
           ORDER BY date DESC`,
          [teacherId, teacher.teacher_id || '']
        );

        if (tAttRows && tAttRows.length > 0) {
          const parsed = calculateTeacherAttendanceStats(tAttRows, now);
          teacherAttendanceData = parsed.stats.overall;
          teacherAttendancePeriods = parsed.stats;
          teacherAttendanceMap = parsed.attendanceMap;
          teacherRecentDays = parsed.recentDays;
        } else if (studentAttendanceSummary.marked) {
          teacherAttendanceData = {
            present: studentAttendanceSummary.present,
            late: studentAttendanceSummary.late,
            half: studentAttendanceSummary.halfday,
            absent: studentAttendanceSummary.absent,
          };
        }
      } catch (err) {
        console.error('Error calculating teacher attendance:', err.message);
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

      // 8. Assignments & Syllabus Dynamic List
      let totalAssignments = 0;
      let totalSyllabus = 0;
      let syllabus = [];

      try {
        const [assignRows] = await pool.query(
          `SELECT COUNT(*) AS count FROM assignments WHERE school_id = ? AND (status != 4 OR status IS NULL)`,
          [schoolId]
        );
        totalAssignments = assignRows[0]?.count || 0;

        // Fetch Syllabus for teacher's school and assigned classes
        let sylSql = `
          SELECT s.*, 
            cm.class_name, 
            sm.subject_name,
            aym.academic_year AS academic_year_code
          FROM syllabus s
          LEFT JOIN class_master cm ON cm.id = s.class_id
          LEFT JOIN subject_master sm ON sm.id = s.subject_id
          LEFT JOIN academic_year_master aym ON aym.id = s.academic_year
          WHERE s.school_id = ?
            AND (s.status != 4 OR s.status IS NULL)
        `;
        const sylParams = [schoolId];

        const assignedClassIds = (teacher.class_assignments || [])
          .map((c) => c.class_id)
          .filter(Boolean);
        if (teacher.class && !assignedClassIds.includes(teacher.class)) {
          assignedClassIds.push(teacher.class);
        }

        if (assignedClassIds.length > 0) {
          sylSql += ` AND (s.class_id IN (?) OR s.class_id IS NULL)`;
          sylParams.push(assignedClassIds);
        }

        sylSql += ` ORDER BY s.id DESC LIMIT 50`;

        const [sylList] = await pool.query(sylSql, sylParams);
        syllabus = (sylList || []).map((s) => ({
          id: String(s.id),
          school_id: String(s.school_id),
          academic_year: String(s.academic_year || ''),
          class_id: String(s.class_id || ''),
          subject_id: String(s.subject_id || ''),
          lession: s.lession || '',
          status: String(s.status || '1'),
          created_at: s.created_at ? new Date(s.created_at).toISOString() : '',
          class_name: s.class_name || (s.class_id ? `Class ${s.class_id}` : 'General'),
          subject_name: s.subject_name || 'Subject',
        }));

        totalSyllabus = syllabus.length;
      } catch (err) {
        console.error('Error counting assignments/fetching syllabus:', err.message);
      }

      // 9. Teacher Leaves Dynamic List
      let teacherLeaves = [];
      try {
        const [leaveRows] = await pool.query(
          `SELECT l.*, lm.leave_name
           FROM leaves l
           LEFT JOIN leave_master lm ON l.leave_id = lm.id
           WHERE (l.staff_id = ? OR l.staff_id = ?) 
             AND l.role = 1 
             AND (l.status != 4 OR l.status IS NULL)
           ORDER BY l.id DESC LIMIT 50`,
          [teacherId, teacher.teacher_id || '']
        );

        for (const l of leaveRows || []) {
          const [dateRows] = await pool.query(
            `SELECT * FROM leaves_date WHERE staff_leave_id = ? ORDER BY date ASC`,
            [l.id]
          );
          const dates = dateRows || [];
          const firstDate = dates.length > 0 ? dates[0].date : l.created_at;
          const lastDate = dates.length > 0 ? dates[dates.length - 1].date : l.created_at;

          teacherLeaves.push({
            id: String(l.id),
            role: String(l.role || '1'),
            school_id: String(l.school_id || schoolId),
            staff_id: String(l.staff_id),
            leave_id: String(l.leave_id),
            duration: String(l.duration || '1'),
            document: l.document || null,
            leave_reason: l.leave_reason || '',
            status: String(l.status || '1'),
            created_at: l.created_at ? new Date(l.created_at).toISOString() : '',
            leave_name: l.leave_name || 'Leave',
            first_leave_date: firstDate ? new Date(firstDate).toISOString() : '',
            last_leave_date: lastDate ? new Date(lastDate).toISOString() : '',
            all_leave_date: dates.map((d) => ({
              date: d.date ? new Date(d.date).toISOString() : '',
              status: String(d.status || '1'),
            })),
          });
        }
      } catch (err) {
        console.error('Error fetching teacher leaves:', err.message);
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
          schoolName: safeTeacher.school_name || null,
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
        attendanceSummary: {
          present: teacherAttendanceData.present,
          late: teacherAttendanceData.late,
          halfday: teacherAttendanceData.half,
          absent: teacherAttendanceData.absent,
          total: teacherAttendanceData.present + teacherAttendanceData.late + teacherAttendanceData.half + teacherAttendanceData.absent,
          marked: teacherAttendanceData.present + teacherAttendanceData.late + teacherAttendanceData.half + teacherAttendanceData.absent > 0,
        },
        studentAttendanceSummary,
        teacher_attendance_data: {
          present: teacherAttendanceData.present,
          late: teacherAttendanceData.late,
          half: teacherAttendanceData.half,
          absent: teacherAttendanceData.absent,
          periods: teacherAttendancePeriods,
          recent_days: teacherRecentDays,
        },
        teacher_attendance: teacherAttendanceMap,
        teacher_leave: teacherLeaves,
        syllabus,
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
