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
            schoolName: parent.school_name || 'Growvidya School',
          },
          children: [],
          activeChild: null,
          attendance: { total: 0, present: 0, absent: 0, percentage: 100 },
          fees: { totalDue: 0, totalPaid: 0, totalAmount: 0 },
          todayClasses: [],
          notices: [],
          events: [],
          holidays: [],
        });
      }

      // 3. Child's Full Profile
      const fullChild = await ParentModel.getChildFullProfile(activeChild.id, schoolId);

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

        const [periods] = await pool.query(
          `SELECT 
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
            AND (r.status != 4 OR r.status IS NULL)
          ORDER BY pm.start_time ASC, r.id ASC`,
          [
            activeChild.class_id || fullChild.class,
            activeChild.section_id || fullChild.section,
            activeChild.section_id || fullChild.section,
            schoolId,
            schoolId,
            todayDayName,
            dayNum,
            dayNum,
          ]
        );
        todayClasses = periods || [];
      } catch (err) {
        console.error('Error fetching child todayClasses:', err.message);
      }

      // 7. Recent Notices & Announcements
      let notices = [];
      let events = [];
      let holidays = [];
      try {
        notices = await AnnouncementModel.getAllNotices(schoolId);
        events = await AnnouncementModel.getAllEvents(schoolId);
        holidays = await AnnouncementModel.getAllHolidays(schoolId);
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
          schoolName: parent.school_name || 'Growvidya School',
        },
        children,
        activeChild: fullChild || activeChild,
        attendance: attendanceData.summary,
        fees: feesData.summary,
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
