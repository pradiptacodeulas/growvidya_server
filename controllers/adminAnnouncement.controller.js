const AnnouncementModel = require('../models/announcement.model');

const getSchoolId = (req) => {
  const sId = req.user?.schoolId || req.user?.school_id;
  if (!sId) {
    const err = new Error('Unauthorized: School ID missing');
    err.statusCode = 401;
    throw err;
  }
  return Number(sId);
};

// ================= NOTICE CONTROLLERS =================
exports.getAllNotices = async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
    const notices = await AnnouncementModel.getAllNotices(schoolId, branchId);
    return res.status(200).json({ success: true, data: notices, notices });
  } catch (err) {
    console.error('Error in getAllNotices:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

exports.getNoticeById = async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    const { id } = req.params;
    const notice = await AnnouncementModel.getNoticeById(id, schoolId);
    if (!notice) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }
    return res.status(200).json({ success: true, data: notice });
  } catch (err) {
    console.error('Error in getNoticeById:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

exports.createNotice = async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    let branchId = req.body.branch_id !== undefined ? req.body.branch_id : (req.user?.branchId || req.user?.branch_id || null);
    if (!branchId) {
      try {
        const { pool } = require('../config/db.config');
        const [branches] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND status = 1 ORDER BY is_main_branch DESC, id ASC LIMIT 1`,
          [schoolId]
        );
        if (branches && branches[0]) {
          branchId = branches[0].id;
        }
      } catch (_) {}
    }

    const {
      title,
      notice_date,
      publish_on,
      message,
      message_to,
      status,
      target_type = 'all',
      target_classes = [],
      target_sections = [],
      target_roles = [],
      target_user_ids = [],
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Notice title is required' });
    }

    const insertId = await AnnouncementModel.createNotice({
      school_id: schoolId,
      branch_id: branchId,
      title: title.trim(),
      notice_date,
      publish_on,
      message,
      message_to: Array.isArray(message_to) ? message_to : (message_to ? [message_to] : []),
      status: status !== undefined ? status : 1,
      target_type,
      target_classes,
      target_sections,
      target_roles,
      target_user_ids,
    });

    // Dispatch targeted push notification
    try {
      const PushNotificationService = require('../services/pushNotification.service');
      const { pool } = require('../config/db.config');

      const noticeTitle = `Notice: ${title.trim()}`;
      const noticeBody = message
        ? (String(message).length > 120 ? String(message).substring(0, 117) + '...' : String(message))
        : 'A new school notice has been published.';

      const pushPayloadData = {
        type: 'notice',
        noticeId: insertId,
        url: '/admin/announcement/notice',
      };

      if (target_type === 'class_section') {
        const classIds = (target_classes || []).map(Number).filter(Boolean);
        const sectionIds = (target_sections || []).map(Number).filter(Boolean);
        const rolesInClass = (target_roles || []).map((r) => String(r).toLowerCase());
        const effectiveRoles = rolesInClass.length > 0 ? rolesInClass : ['student', 'parent', 'teacher'];

        const targetedRecipients = [];

        // 1. Resolve Students in target class & section
        if (effectiveRoles.includes('student') && classIds.length > 0) {
          let studentQuery = `SELECT id FROM student_master WHERE school_id = ? AND status = 1 AND class IN (${classIds.map(() => '?').join(',')})`;
          const studentParams = [schoolId, ...classIds];
          if (sectionIds.length > 0) {
            studentQuery += ` AND section IN (${sectionIds.map(() => '?').join(',')})`;
            studentParams.push(...sectionIds);
          }
          const [students] = await pool.query(studentQuery, studentParams);
          for (const s of students) {
            targetedRecipients.push({ id: s.id, role: 'student' });
          }
        }

        // 2. Resolve Parents of those students
        if (effectiveRoles.includes('parent') && classIds.length > 0) {
          let parentQuery = `
            SELECT DISTINCT sp.father_id, sp.mother_id, sp.guardian_id 
            FROM student_to_parent sp
            JOIN student_master s ON sp.student_id = s.id
            WHERE sp.school_id = ? AND sp.status = 1 AND s.class IN (${classIds.map(() => '?').join(',')})
          `;
          const parentParams = [schoolId, ...classIds];
          if (sectionIds.length > 0) {
            parentQuery += ` AND s.section IN (${sectionIds.map(() => '?').join(',')})`;
            parentParams.push(...sectionIds);
          }
          const [parentRows] = await pool.query(parentQuery, parentParams);
          const parentIdSet = new Set();
          for (const p of parentRows) {
            if (p.father_id) parentIdSet.add(Number(p.father_id));
            if (p.mother_id) parentIdSet.add(Number(p.mother_id));
            if (p.guardian_id) parentIdSet.add(Number(p.guardian_id));
          }
          for (const pid of parentIdSet) {
            targetedRecipients.push({ id: pid, role: 'parent' });
          }
        }

        // 3. Resolve Teachers assigned to those classes
        if (effectiveRoles.includes('teacher') && classIds.length > 0) {
          const [teacherRows] = await pool.query(
            `SELECT DISTINCT teacher_id FROM teacher_class_assign 
             WHERE school_id = ? AND (status = 1 OR status IS NULL) AND class_id IN (${classIds.map(() => '?').join(',')})`,
            [schoolId, ...classIds]
          );
          for (const t of teacherRows) {
            if (t.teacher_id) {
              targetedRecipients.push({ id: Number(t.teacher_id), role: 'teacher' });
            }
          }
        }

        if (targetedRecipients.length > 0) {
          PushNotificationService.sendToTargetedRecipients({
            recipients: targetedRecipients,
            school_id: schoolId,
            title: noticeTitle,
            body: noticeBody,
            data: pushPayloadData,
            category: 'notice',
          }).catch((pushErr) => console.warn('[Targeted Notice Push Error]:', pushErr?.message));
        }
      } else if (target_type === 'specific_users') {
        const recipients = (target_user_ids || []).map((u) => {
          if (typeof u === 'object' && u !== null) return { id: Number(u.id), role: u.role || 'teacher' };
          return { id: Number(u), role: 'teacher' };
        }).filter((u) => u.id);

        if (recipients.length > 0) {
          PushNotificationService.sendToTargetedRecipients({
            recipients,
            school_id: schoolId,
            title: noticeTitle,
            body: noticeBody,
            data: pushPayloadData,
            category: 'notice',
          }).catch((pushErr) => console.warn('[Specific Users Notice Push Error]:', pushErr?.message));
        }
      } else {
        // School-Wide / Role broadcast (target_type === 'all')
        const rawRoles = (target_roles && target_roles.length > 0)
          ? target_roles
          : (Array.isArray(message_to) ? message_to : ['all']);

        let targetRoles = rawRoles.map((r) => {
          if (String(r) === '1' || String(r).toLowerCase() === 'student') return 'student';
          if (String(r) === '2' || String(r).toLowerCase() === 'parent') return 'parent';
          if (String(r) === '3' || String(r).toLowerCase() === 'teacher') return 'teacher';
          if (String(r) === '4' || String(r).toLowerCase() === 'admin') return 'admin';
          return String(r).toLowerCase();
        });

        if (targetRoles.includes('all')) {
          targetRoles = ['student', 'parent', 'teacher', 'admin'];
        }

        PushNotificationService.sendToRoles({
          roles: Array.from(new Set(targetRoles)),
          school_id: schoolId,
          title: noticeTitle,
          body: noticeBody,
          data: pushPayloadData,
          category: 'notice',
        }).catch((pushErr) => console.warn('[Notice Push Error]:', pushErr?.message));
      }

      // Real-time socket broadcast for active users in the school / target groups
      try {
        const { getIO } = require('../services/socket.service');
        const io = getIO();
        if (io) {
          const socketNotice = {
            id: insertId,
            school_id: schoolId,
            branch_id: branchId,
            title: title.trim(),
            message,
            notice_date,
            publish_on,
            target_type,
            target_classes,
            target_sections,
            target_roles,
          };
          if (target_type === 'all') {
            io.to(`school_${schoolId}`).emit('new_notice', socketNotice);
          } else if (typeof targetedRecipients !== 'undefined' && Array.isArray(targetedRecipients)) {
            for (const r of targetedRecipients) {
              io.to(`user_${r.role}_${r.id}`).emit('new_notice', socketNotice);
            }
          }
        }
      } catch (socketErr) {
        console.warn('[Notice Socket Broadcast Error]:', socketErr?.message);
      }
    } catch (_) {}

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
    const schoolId = getSchoolId(req);
    const { id } = req.params;
    let branchId = req.body.branch_id !== undefined ? req.body.branch_id : (req.user?.branchId || req.user?.branch_id || null);
    const {
      title,
      notice_date,
      publish_on,
      message,
      message_to,
      status,
      target_type = 'all',
      target_classes = [],
      target_sections = [],
      target_roles = [],
      target_user_ids = [],
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Notice title is required' });
    }

    await AnnouncementModel.updateNotice(id, schoolId, {
      branch_id: branchId,
      title: title.trim(),
      notice_date,
      publish_on,
      message,
      message_to: Array.isArray(message_to) ? message_to : (message_to ? [message_to] : []),
      status: status !== undefined ? status : 1,
      target_type,
      target_classes,
      target_sections,
      target_roles,
      target_user_ids,
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
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
    const events = await AnnouncementModel.getAllEvents(schoolId);
    return res.status(200).json({ success: true, data: events, events });
  } catch (err) {
    console.error('Error in getAllEvents:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getEventById = async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
    const holidays = await AnnouncementModel.getAllHolidays(schoolId);
    return res.status(200).json({ success: true, data: holidays, holidays });
  } catch (err) {
    console.error('Error in getAllHolidays:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getHolidayById = async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
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
    const schoolId = getSchoolId(req);
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

// ================= SEARCH USERS (FOR TARGETED NOTICES) =================
exports.searchUsers = async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    const query = String(req.query.q || '').trim();
    const filterRole = String(req.query.role || '').toLowerCase();
    const { pool } = require('../config/db.config');

    const searchParam = `%${query}%`;
    const results = [];

    // 1. Search Teachers
    if (!filterRole || filterRole === 'teacher') {
      let teacherSql = `
        SELECT 
          t.id,
          CONCAT(TRIM(COALESCE(t.first_name, '')), ' ', TRIM(COALESCE(t.last_name, ''))) AS name,
          'teacher' AS role,
          t.picture,
          t.email_address AS email,
          t.primary_contact_number AS phone,
          t.teacher_id AS code,
          COALESCE(cm.class_name, '') AS class_name,
          COALESCE(sec.section_name, '') AS section_name
        FROM teacher_master t
        LEFT JOIN class_master cm ON t.class = cm.id
        LEFT JOIN section_master sec ON t.section = sec.id
        WHERE t.school_id = ? AND (t.status = 1 OR t.status IS NULL)
      `;
      const teacherParams = [schoolId];
      if (query) {
        teacherSql += ` AND (t.first_name LIKE ? OR t.last_name LIKE ? OR t.teacher_id LIKE ? OR t.primary_contact_number LIKE ? OR t.email_address LIKE ?)`;
        teacherParams.push(searchParam, searchParam, searchParam, searchParam, searchParam);
      }
      teacherSql += ` ORDER BY t.first_name ASC LIMIT 20`;
      const [teachers] = await pool.query(teacherSql, teacherParams).catch(() => [[]]);
      for (const t of teachers) {
        results.push({
          id: t.id,
          name: t.name.trim(),
          role: 'teacher',
          role_label: 'Teacher',
          code: t.code,
          info: t.code ? `Teacher ID: ${t.code}` : (t.phone ? `Phone: ${t.phone}` : ''),
          picture: t.picture,
        });
      }
    }

    // 2. Search Students
    if (!filterRole || filterRole === 'student') {
      let studentSql = `
        SELECT 
          s.id,
          CONCAT(TRIM(COALESCE(s.first_name, '')), ' ', TRIM(COALESCE(s.last_name, ''))) AS name,
          'student' AS role,
          s.picture,
          s.email_address AS email,
          s.primary_contact_number AS phone,
          s.admission_number AS code,
          COALESCE(cm.class_name, '') AS class_name,
          COALESCE(sec.section_name, '') AS section_name
        FROM student_master s
        LEFT JOIN class_master cm ON s.class = cm.id
        LEFT JOIN section_master sec ON s.section = sec.id
        WHERE s.school_id = ? AND (s.status = 1 OR s.status = '1' OR s.status IS NULL)
      `;
      const studentParams = [schoolId];
      if (query) {
        studentSql += ` AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_number LIKE ? OR s.primary_contact_number LIKE ?)`;
        studentParams.push(searchParam, searchParam, searchParam, searchParam);
      }
      studentSql += ` ORDER BY s.first_name ASC LIMIT 20`;
      const [students] = await pool.query(studentSql, studentParams).catch(() => [[]]);
      for (const s of students) {
        let classSectionInfo = '';
        if (s.class_name) {
          classSectionInfo = `Class ${s.class_name}${s.section_name ? ` (${s.section_name})` : ''}`;
        }
        results.push({
          id: s.id,
          name: s.name.trim(),
          role: 'student',
          role_label: 'Student',
          code: s.code,
          info: classSectionInfo ? `${classSectionInfo}${s.code ? ` • Adm: ${s.code}` : ''}` : (s.code ? `Adm: ${s.code}` : ''),
          picture: s.picture,
        });
      }
    }

    // 3. Search Parents
    if (!filterRole || filterRole === 'parent') {
      let parentSql = `
        SELECT 
          p.id,
          CONCAT(TRIM(COALESCE(p.first_name, '')), ' ', TRIM(COALESCE(p.last_name, ''))) AS name,
          'parent' AS role,
          p.picture,
          p.email,
          p.phone
        FROM parent_master p
        WHERE p.school_id = ? AND (p.status = 1 OR p.status IS NULL)
      `;
      const parentParams = [schoolId];
      if (query) {
        parentSql += ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)`;
        parentParams.push(searchParam, searchParam, searchParam, searchParam);
      }
      parentSql += ` ORDER BY p.first_name ASC LIMIT 20`;
      const [parents] = await pool.query(parentSql, parentParams).catch(() => [[]]);
      for (const p of parents) {
        results.push({
          id: p.id,
          name: p.name.trim(),
          role: 'parent',
          role_label: 'Parent',
          info: p.phone ? `Phone: ${p.phone}` : (p.email ? `Email: ${p.email}` : ''),
          picture: p.picture,
        });
      }
    }

    // 4. Search Staff / Admins
    if (!filterRole || filterRole === 'admin' || filterRole === 'staff') {
      let userSql = `
        SELECT 
          u.id,
          CONCAT(TRIM(COALESCE(u.first_name, '')), ' ', TRIM(COALESCE(u.last_name, ''))) AS name,
          'admin' AS role,
          u.picture,
          u.email,
          u.phone,
          CASE 
            WHEN u.admin_type = 1 THEN 'Super Admin'
            ELSE r.role_name
          END AS designation
        FROM user_master u
        LEFT JOIN role_master r ON u.role = r.id
        WHERE u.school_id = ? AND (u.status = 1 OR u.status IS NULL)
      `;
      const userParams = [schoolId];
      if (query) {
        userSql += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)`;
        userParams.push(searchParam, searchParam, searchParam, searchParam);
      }
      userSql += ` ORDER BY u.first_name ASC LIMIT 20`;
      const [users] = await pool.query(userSql, userParams).catch(() => [[]]);
      for (const u of users) {
        results.push({
          id: u.id,
          name: u.name.trim(),
          role: 'admin',
          role_label: u.designation || 'Staff',
          info: u.email ? u.email : (u.phone ? `Phone: ${u.phone}` : ''),
          picture: u.picture,
        });
      }
    }

    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('Error in searchUsers:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
