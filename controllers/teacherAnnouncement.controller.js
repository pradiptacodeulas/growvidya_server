const AnnouncementModel = require('../models/announcement.model');

// ================= TEACHER NOTICE CONTROLLERS =================
exports.getTeacherNotices = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const teacherId = Number(req.user?.teacherId || req.user?.userId || req.user?.id);
    const { pool } = require('../config/db.config');

    // 1. Fetch teacher's assigned classes
    const [assignedRows] = await pool.query(
      `SELECT DISTINCT class_id FROM teacher_class_assign 
       WHERE teacher_id = ? AND school_id = ? AND (status = 1 OR status IS NULL)`,
      [teacherId, schoolId]
    ).catch(() => [[]]);
    const assignedClassIds = new Set((assignedRows || []).map((r) => Number(r.class_id)));

    // 2. Fetch all school notices
    const allNotices = await AnnouncementModel.getAllNotices(schoolId);

    // 3. Filter notices relevant to this teacher
    const filtered = allNotices.filter((n) => {
      const type = n.target_type || 'all';

      if (type === 'class_section') {
        const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
        const isTeacherTargeted = roles.length === 0 || roles.includes('teacher');
        if (!isTeacherTargeted) return false;

        const noticeClasses = (n.target_classes || []).map(Number);
        if (noticeClasses.length === 0) return true;
        return noticeClasses.some((cid) => assignedClassIds.has(cid));
      }

      if (type === 'specific_users') {
        const userIds = (n.target_user_ids || []).map((u) => {
          if (typeof u === 'object' && u !== null) return Number(u.id);
          return Number(u);
        });
        return userIds.includes(teacherId);
      }

      // Default: 'all' / School-Wide
      const roles = (n.target_roles || []).map((r) => String(r).toLowerCase());
      const msgTo = (n.message_to || []).map((m) => String(m).toLowerCase());
      if (roles.length === 0 && msgTo.length === 0) return true;
      return (
        roles.includes('teacher') ||
        roles.includes('all') ||
        msgTo.includes('teacher') ||
        msgTo.includes('3') ||
        msgTo.includes('all')
      );
    });

    return res.status(200).json({ success: true, data: filtered, notices: filtered });
  } catch (err) {
    console.error('Error in getTeacherNotices:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getTeacherNoticeById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const notice = await AnnouncementModel.getNoticeById(id, schoolId);
    if (!notice) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }
    return res.status(200).json({ success: true, data: notice });
  } catch (err) {
    console.error('Error in getTeacherNoticeById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================= TEACHER EVENT CONTROLLERS =================
exports.getTeacherEvents = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const events = await AnnouncementModel.getAllEvents(schoolId);
    return res.status(200).json({ success: true, data: events, events });
  } catch (err) {
    console.error('Error in getTeacherEvents:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getTeacherEventById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const event = await AnnouncementModel.getEventById(id, schoolId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    return res.status(200).json({ success: true, data: event });
  } catch (err) {
    console.error('Error in getTeacherEventById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================= TEACHER HOLIDAY CONTROLLERS =================
exports.getTeacherHolidays = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const holidays = await AnnouncementModel.getAllHolidays(schoolId);
    return res.status(200).json({ success: true, data: holidays, holidays });
  } catch (err) {
    console.error('Error in getTeacherHolidays:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getTeacherHolidayById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const holiday = await AnnouncementModel.getHolidayById(id, schoolId);
    if (!holiday) {
      return res.status(404).json({ success: false, message: 'Holiday not found' });
    }
    return res.status(200).json({ success: true, data: holiday });
  } catch (err) {
    console.error('Error in getTeacherHolidayById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
