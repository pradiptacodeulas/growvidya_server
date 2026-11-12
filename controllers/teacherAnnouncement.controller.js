const AnnouncementModel = require('../models/announcement.model');

const getTeacherSchoolId = (req) => {
  const schoolId = req.user?.schoolId || req.user?.school_id;
  if (!schoolId) {
    const err = new Error('School context required. Please log in again.');
    err.statusCode = 401;
    throw err;
  }
  return Number(schoolId);
};

// ================= TEACHER NOTICE CONTROLLERS =================
exports.getTeacherNotices = async (req, res) => {
  try {
    const schoolId = getTeacherSchoolId(req);
    const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
    const teacherId = Number(req.user?.teacherId || req.user?.userId || req.user?.id);
    const { pool } = require('../config/db.config');

    // 1. Fetch teacher's assigned classes
    let assignQuery = `SELECT DISTINCT class_id FROM teacher_class_assign 
       WHERE teacher_id = ? AND school_id = ? AND (status = 1 OR status IS NULL)`;
    const assignParams = [teacherId, schoolId];
    if (branchId) {
      assignQuery += ` AND (branch_id = ? OR branch_id IS NULL)`;
      assignParams.push(Number(branchId));
    }
    const [assignedRows] = await pool.query(assignQuery, assignParams).catch(() => [[]]);
    const assignedClassIds = new Set((assignedRows || []).map((r) => Number(r.class_id)));

    // 2. Fetch active school notices
    const allNotices = await AnnouncementModel.getAllNotices(schoolId, branchId, true);

    // 3. Filter notices relevant to this teacher
    const teacherNotices = allNotices.filter((n) => {
      if (Number(n.status ?? 1) !== 1) return false;
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
        return (n.target_user_ids || []).some((u) => {
          if (typeof u === 'object' && u !== null) {
            const uRole = String(u.role || '').toLowerCase();
            return Number(u.id) === teacherId && (!uRole || uRole === 'teacher');
          }
          return false;
        });
      }

      // Default: 'all' / Branch-Wide
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

    const summary = {
      totalNotices: teacherNotices.length,
      activeCount: teacherNotices.length,
      inactiveCount: 0,
      classTargetedCount: teacherNotices.filter((n) => n.target_type === 'class_section').length,
      specificUsersCount: teacherNotices.filter((n) => n.target_type === 'specific_users').length,
      branchWideCount: teacherNotices.filter(
        (n) => !n.target_type || n.target_type === 'all'
      ).length,
    };

    const search = String(req.query.search || '').trim().toLowerCase();
    const targetType =
      req.query.target_type && req.query.target_type !== 'all_scopes'
        ? String(req.query.target_type).trim()
        : '';
    const startDate = req.query.start_date ? String(req.query.start_date).trim() : '';
    const endDate = req.query.end_date ? String(req.query.end_date).trim() : '';

    const filtered = teacherNotices.filter((n) => {
      if (targetType) {
        const nType = n.target_type || 'all';
        if (nType !== targetType) return false;
      }
      if (search) {
        const titleMatch = n.title && n.title.toLowerCase().includes(search);
        const msgMatch = n.message && n.message.toLowerCase().includes(search);
        if (!titleMatch && !msgMatch) return false;
      }
      const dateRaw = n.publish_on || n.notice_date || n.created_at;
      const dateYmd = dateRaw ? String(dateRaw).slice(0, 10) : '';
      if (startDate && (!dateYmd || dateYmd < startDate)) return false;
      if (endDate && (!dateYmd || dateYmd > endDate)) return false;
      return true;
    });

    if (req.query.page !== undefined || req.query.limit !== undefined) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paged = filtered.slice((page - 1) * limit, page * limit);

      return res.status(200).json({
        success: true,
        data: paged,
        notices: paged,
        pagination: { page, limit, total, totalPages },
        summary,
      });
    }

    return res.status(200).json({ success: true, data: filtered, notices: filtered, summary });
  } catch (err) {
    console.error('Error in getTeacherNotices:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

exports.getTeacherNoticeById = async (req, res) => {
  try {
    const schoolId = getTeacherSchoolId(req);
    const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
    const { id } = req.params;
    const notice = await AnnouncementModel.getNoticeById(id, schoolId, branchId);
    if (!notice || Number(notice.status ?? 1) !== 1) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }
    return res.status(200).json({ success: true, data: notice });
  } catch (err) {
    console.error('Error in getTeacherNoticeById:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

// ================= TEACHER EVENT CONTROLLERS =================
exports.getTeacherEvents = async (req, res) => {
  try {
    const schoolId = getTeacherSchoolId(req);
    const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
    const {
      page,
      limit,
      search,
      timeline,
      year,
      month,
      start_date,
      end_date,
      sort_by,
      sort_dir,
    } = req.query;

    const hasQueryFilters =
      page !== undefined ||
      limit !== undefined ||
      search ||
      timeline ||
      year ||
      month ||
      start_date ||
      end_date;

    if (hasQueryFilters) {
      const result = await AnnouncementModel.getEventsPaginated(schoolId, branchId, {
        page,
        limit,
        search,
        status: '1',
        timeline,
        year,
        month,
        start_date,
        end_date,
        sort_by,
        sort_dir,
      });
      return res.status(200).json({
        success: true,
        data: result.rows,
        events: result.rows,
        pagination: result.pagination,
        summary: result.summary,
        availableYears: result.availableYears,
      });
    }

    const events = await AnnouncementModel.getAllEvents(schoolId, branchId);
    const activeEvents = (events || []).filter((e) => Number(e.status ?? 1) === 1);
    return res.status(200).json({ success: true, data: activeEvents, events: activeEvents });
  } catch (err) {
    console.error('Error in getTeacherEvents:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

exports.getTeacherEventById = async (req, res) => {
  try {
    const schoolId = getTeacherSchoolId(req);
    const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
    const { id } = req.params;
    const event = await AnnouncementModel.getEventById(id, schoolId, branchId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    return res.status(200).json({ success: true, data: event });
  } catch (err) {
    console.error('Error in getTeacherEventById:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

// ================= TEACHER HOLIDAY CONTROLLERS =================
exports.getTeacherHolidays = async (req, res) => {
  try {
    const schoolId = getTeacherSchoolId(req);
    const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
    const holidays = await AnnouncementModel.getAllHolidays(schoolId, branchId);
    const activeHolidays = (holidays || []).filter((h) => Number(h.status ?? 1) === 1);
    return res.status(200).json({ success: true, data: activeHolidays, holidays: activeHolidays });
  } catch (err) {
    console.error('Error in getTeacherHolidays:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

exports.getTeacherHolidayById = async (req, res) => {
  try {
    const schoolId = getTeacherSchoolId(req);
    const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
    const { id } = req.params;
    const holiday = await AnnouncementModel.getHolidayById(id, schoolId, branchId);
    if (!holiday) {
      return res.status(404).json({ success: false, message: 'Holiday not found' });
    }
    return res.status(200).json({ success: true, data: holiday });
  } catch (err) {
    console.error('Error in getTeacherHolidayById:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};
