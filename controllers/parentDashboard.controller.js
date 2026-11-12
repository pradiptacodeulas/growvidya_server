const ParentModel = require('../models/parent.model');
const AnnouncementModel = require('../models/announcement.model');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');

class ParentDashboardController {
  static async getDashboardData(req, res, next) {
    try {
      const parentId = req.user.parentId || req.user.userId;
      const schoolId = req.user?.schoolId;

      // 1. Get Parent Profile
      const parent = await ParentModel.findAuthProfileById(parentId);
      if (!parent) {
        return ApiResponse.error(res, 'Parent profile not found.', null, 404);
      }

      // 2. Determine Active Student
      const children = parent.children || [];
      const requestedStudentId = req.query.student_id ? Number(req.query.student_id) : req.user.studentId;
      const activeChild = children.find((c) => Number(c.id) === requestedStudentId) || (children.length > 0 ? children[0] : null);

      if (!activeChild) {
        return ApiResponse.success(res, 'Parent dashboard loaded with no linked students.', {
          parent: {
            id: parent.id,
            name: `${parent.first_name || ''} ${parent.last_name || ''}`.trim(),
            email: parent.email,
            phone: parent.phone,
            picture: parent.picture,
            schoolName: parent.school_name || null,
          },
          children: [],
          activeChild: null,
          attendance: { total: 0, present: 0, absent: 0, percentage: 0 },
          fees: { totalDue: 0, totalPaid: 0, totalAmount: 0 },
          todayClasses: [],
          notices: [],
          events: [],
          holidays: [],
        });
      }

      // 3. Child's Full Profile
      const fullChild = await ParentModel.getChildFullProfile(activeChild.id, schoolId);
      const childBranchId = fullChild?.branch_id || activeChild?.branch_id || req.branchId || req.user?.branch_id || null;
      const studentClass = Number(activeChild.class_id || fullChild?.class || 0) || null;
      const studentSection = Number(activeChild.section_id || fullChild?.section || 0) || null;

      // 4. Attendance Summary
      const attendanceData = await ParentModel.getChildAttendance(activeChild.id, schoolId);

      // 5. Fee Summary
      const feesData = await ParentModel.getChildFees(activeChild.id, schoolId);

      // 6. Today's Timetable / Classes
      let todayClasses = [];
      try {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const now = new Date();
        const todayDayName = days[now.getDay()];
        const dayNum = now.getDay() === 0 ? 7 : now.getDay();

        let routineSql = `SELECT 
            r.id,
            r.period_id,
            pm.period_name,
            pm.start_time,
            pm.end_time,
            sub.subject_name,
            CONCAT(t.first_name, ' ', IFNULL(t.last_name, '')) AS teacher_name
          FROM routine r
          LEFT JOIN period_master pm ON r.period_id = pm.id
          LEFT JOIN days_master d ON r.day = d.id
          LEFT JOIN subject_master sub ON r.subject_id = sub.id
          LEFT JOIN teacher_master t ON r.teacher_id = t.id
          WHERE r.class_id = ? AND (r.section_id = ? OR ? IS NULL)
            AND (r.school_id = ? OR ? IS NULL)
            AND (LOWER(d.day_name) = LOWER(?) OR d.id = ? OR r.day = ?)
            AND (r.status != 4 OR r.status IS NULL)`;
        const routineParams = [
          studentClass,
          studentSection,
          studentSection,
          schoolId,
          schoolId,
          todayDayName,
          dayNum,
          dayNum,
        ];
        if (childBranchId) {
          routineSql += ` AND (r.branch_id = ? OR r.branch_id IS NULL)`;
          routineParams.push(Number(childBranchId));
        }
        routineSql += ` ORDER BY pm.start_time ASC, r.id ASC`;

        const [periods] = await pool.query(routineSql, routineParams);
        todayClasses = periods || [];
      } catch (err) {
        console.error('Error fetching child todayClasses:', err.message);
      }

      // 7. Recent Notices & Announcements (Filtered for Parent & Active Child)
      let notices = [];
      let events = [];
      let holidays = [];
      try {
        const allNotices = await AnnouncementModel.getAllNotices(schoolId, childBranchId, true);
        notices = (allNotices || []).filter((n) => {
          if (Number(n.status ?? 1) !== 1) return false;
          const type = n.target_type || 'all';
          if (type === 'class_section') {
            const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
            const isTargetedRole = roles.length === 0 || roles.includes('student') || roles.includes('parent');
            if (!isTargetedRole) return false;
            const noticeClasses = (n.target_classes || []).map(Number);
            const noticeSections = (n.target_sections || []).map(Number);
            if (noticeClasses.length > 0 && (!studentClass || !noticeClasses.includes(studentClass))) return false;
            if (noticeSections.length > 0 && (!studentSection || !noticeSections.includes(studentSection))) return false;
            return true;
          }
          if (type === 'specific_users') {
            return (n.target_user_ids || []).some((u) => {
              if (typeof u === 'object' && u !== null) {
                const uRole = String(u.role || '').toLowerCase();
                const uId = Number(u.id);
                if (uRole === 'parent') return Boolean(parentId && uId === Number(parentId));
                if (uRole === 'student') return Boolean(activeChild.id && uId === Number(activeChild.id));
                return false;
              }
              return false;
            });
          }
          const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
          const msgTo = (n.message_to || []).map((m) => String(m).toLowerCase());
          if (roles.length === 0 && msgTo.length === 0) return true;
          return (
            roles.includes('student') ||
            roles.includes('parent') ||
            roles.includes('all') ||
            msgTo.includes('student') ||
            msgTo.includes('parent') ||
            msgTo.includes('1') ||
            msgTo.includes('2') ||
            msgTo.includes('all')
          );
        });
        const allEvents = await AnnouncementModel.getAllEvents(schoolId, childBranchId);
        events = (allEvents || []).filter((e) => Number(e.status ?? 1) === 1);
        const allHolidays = await AnnouncementModel.getAllHolidays(schoolId, childBranchId);
        holidays = (allHolidays || []).filter((h) => Number(h.status ?? 1) === 1);
      } catch (err) {
        console.error('Error fetching announcements:', err.message);
      }

      return ApiResponse.success(res, 'Parent dashboard data loaded successfully.', {
        parent: {
          id: parent.id,
          name: `${parent.first_name || ''} ${parent.last_name || ''}`.trim(),
          email: parent.email,
          phone: parent.phone,
          picture: parent.picture,
          relation: parent.relation,
          schoolName: parent.school_name || null,
        },
        children,
        activeChild: fullChild || activeChild,
        attendance: attendanceData.summary,
        fees: {
          ...feesData.summary,
          dueFees: feesData.dueFees || [],
          due_this_month: feesData.dueFees || [],
        },
        dueFees: feesData.dueFees || [],
        due_this_month: feesData.dueFees || [],
        student_due_fees: feesData.dueFees || [],
        invoices: feesData.invoices || [],
        paidFees: feesData.paidFees || [],
        bank_details: feesData.bank_details || null,
        todayClasses,
        notices: notices.slice(0, 5),
        events: events.slice(0, 5),
        holidays: holidays.slice(0, 5),
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ParentDashboardController;
