const AnnouncementModel = require('../models/announcement.model');

// ================= NOTICE CONTROLLERS =================
exports.getAllNotices = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const notices = await AnnouncementModel.getAllNotices(schoolId);
    return res.status(200).json({ success: true, data: notices, notices });
  } catch (err) {
    console.error('Error in getAllNotices:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getNoticeById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const notice = await AnnouncementModel.getNoticeById(id, schoolId);
    if (!notice) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }
    return res.status(200).json({ success: true, data: notice });
  } catch (err) {
    console.error('Error in getNoticeById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.createNotice = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { title, notice_date, publish_on, message, message_to, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Notice title is required' });
    }

    const insertId = await AnnouncementModel.createNotice({
      school_id: schoolId,
      title: title.trim(),
      notice_date,
      publish_on,
      message,
      message_to: Array.isArray(message_to) ? message_to : (message_to ? [message_to] : []),
      status: status !== undefined ? status : 1,
    });

    return res.status(201).json({
      success: true,
      message: 'Notice added successfully',
      id: insertId,
    });
  } catch (err) {
    console.error('Error in createNotice:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.updateNotice = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const { title, notice_date, publish_on, message, message_to, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Notice title is required' });
    }

    await AnnouncementModel.updateNotice(id, schoolId, {
      title: title.trim(),
      notice_date,
      publish_on,
      message,
      message_to: Array.isArray(message_to) ? message_to : (message_to ? [message_to] : []),
      status: status !== undefined ? status : 1,
    });

    return res.status(200).json({
      success: true,
      message: 'Notice updated successfully',
    });
  } catch (err) {
    console.error('Error in updateNotice:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.deleteNotice = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    await AnnouncementModel.deleteNotice(id, schoolId);
    return res.status(200).json({
      success: true,
      message: 'Notice deleted successfully',
    });
  } catch (err) {
    console.error('Error in deleteNotice:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================= EVENT CONTROLLERS =================
exports.getAllEvents = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const events = await AnnouncementModel.getAllEvents(schoolId);
    return res.status(200).json({ success: true, data: events, events });
  } catch (err) {
    console.error('Error in getAllEvents:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getEventById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const event = await AnnouncementModel.getEventById(id, schoolId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    return res.status(200).json({ success: true, data: event });
  } catch (err) {
    console.error('Error in getEventById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    let { title, from_date, to_date, daterange, details, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Event title is required' });
    }

    if (!from_date && daterange) {
      const parts = daterange.split(' - ');
      if (parts.length === 2) {
        from_date = parts[0].trim();
        to_date = parts[1].trim();
      } else {
        from_date = daterange.trim();
        to_date = from_date;
      }
    }

    const insertId = await AnnouncementModel.createEvent({
      school_id: schoolId,
      title: title.trim(),
      from_date: from_date || null,
      to_date: to_date || from_date || null,
      details: details || null,
      status: status !== undefined ? status : 1,
    });

    return res.status(201).json({
      success: true,
      message: 'Event added successfully',
      id: insertId,
    });
  } catch (err) {
    console.error('Error in createEvent:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    let { title, from_date, to_date, daterange, details, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Event title is required' });
    }

    if (!from_date && daterange) {
      const parts = daterange.split(' - ');
      if (parts.length === 2) {
        from_date = parts[0].trim();
        to_date = parts[1].trim();
      } else {
        from_date = daterange.trim();
        to_date = from_date;
      }
    }

    await AnnouncementModel.updateEvent(id, schoolId, {
      title: title.trim(),
      from_date: from_date || null,
      to_date: to_date || from_date || null,
      details: details || null,
      status: status !== undefined ? status : 1,
    });

    return res.status(200).json({
      success: true,
      message: 'Event updated successfully',
    });
  } catch (err) {
    console.error('Error in updateEvent:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    await AnnouncementModel.deleteEvent(id, schoolId);
    return res.status(200).json({
      success: true,
      message: 'Event deleted successfully',
    });
  } catch (err) {
    console.error('Error in deleteEvent:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ================= HOLIDAY CONTROLLERS =================
exports.getAllHolidays = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const holidays = await AnnouncementModel.getAllHolidays(schoolId);
    return res.status(200).json({ success: true, data: holidays, holidays });
  } catch (err) {
    console.error('Error in getAllHolidays:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getHolidayById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const holiday = await AnnouncementModel.getHolidayById(id, schoolId);
    if (!holiday) {
      return res.status(404).json({ success: false, message: 'Holiday not found' });
    }
    return res.status(200).json({ success: true, data: holiday });
  } catch (err) {
    console.error('Error in getHolidayById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.createHoliday = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    let { title, from_date, to_date, daterange, details, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Holiday title is required' });
    }

    if (!from_date && daterange) {
      const parts = daterange.split(' - ');
      if (parts.length === 2) {
        from_date = parts[0].trim();
        to_date = parts[1].trim();
      } else {
        from_date = daterange.trim();
        to_date = from_date;
      }
    }

    const insertId = await AnnouncementModel.createHoliday({
      school_id: schoolId,
      title: title.trim(),
      from_date: from_date || null,
      to_date: to_date || from_date || null,
      details: details || null,
      status: status !== undefined ? status : 1,
    });

    return res.status(201).json({
      success: true,
      message: 'Holiday added successfully',
      id: insertId,
    });
  } catch (err) {
    console.error('Error in createHoliday:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.updateHoliday = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    let { title, from_date, to_date, daterange, details, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Holiday title is required' });
    }

    if (!from_date && daterange) {
      const parts = daterange.split(' - ');
      if (parts.length === 2) {
        from_date = parts[0].trim();
        to_date = parts[1].trim();
      } else {
        from_date = daterange.trim();
        to_date = from_date;
      }
    }

    await AnnouncementModel.updateHoliday(id, schoolId, {
      title: title.trim(),
      from_date: from_date || null,
      to_date: to_date || from_date || null,
      details: details || null,
      status: status !== undefined ? status : 1,
    });

    return res.status(200).json({
      success: true,
      message: 'Holiday updated successfully',
    });
  } catch (err) {
    console.error('Error in updateHoliday:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.deleteHoliday = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    await AnnouncementModel.deleteHoliday(id, schoolId);
    return res.status(200).json({
      success: true,
      message: 'Holiday deleted successfully',
    });
  } catch (err) {
    console.error('Error in deleteHoliday:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
