const AnnouncementModel = require('../models/announcement.model');

// ================= TEACHER NOTICE CONTROLLERS =================
exports.getTeacherNotices = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const notices = await AnnouncementModel.getAllNotices(schoolId);
    return res.status(200).json({ success: true, data: notices, notices });
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
