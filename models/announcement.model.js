const { pool } = require('../config/db.config');

// Ensure tables exist
const initAnnouncementTables = async () => {
  try {
    // Notice table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notice (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        notice_date DATE DEFAULT NULL,
        publish_on DATETIME DEFAULT NULL,
        message TEXT,
        status TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Notice message recipients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notice_message (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT DEFAULT NULL,
        notice_id INT NOT NULL,
        message_to VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Event table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS event (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        from_date DATETIME DEFAULT NULL,
        to_date DATETIME DEFAULT NULL,
        details TEXT,
        status TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Holiday table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS holiday (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        from_date DATE DEFAULT NULL,
        to_date DATE DEFAULT NULL,
        details TEXT,
        status TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error('Error initializing announcement tables:', err);
  }
};

initAnnouncementTables();

const normalizeStatus = (status) => {
  if (status === undefined || status === null) return 1;
  const parsed = parseInt(status, 10);
  if (parsed === 4) return 4;
  if (parsed === 2 || parsed === 0) return 2;
  return 1;
};

const AnnouncementModel = {
  // Helper to enrich raw notice rows with message_to, parsed JSON fields, and class/section names in batch (no N+1 queries)
  async _enrichNoticeRows(notices, schoolId) {
    if (!Array.isArray(notices) || notices.length === 0) return [];

    const noticeIds = notices.map((n) => n.id);

    const [
      [allMessages],
      [allClasses],
      [allSections],
    ] = await Promise.all([
      pool
        .query(
          `SELECT notice_id, message_to FROM notice_message WHERE notice_id IN (${noticeIds
            .map(() => '?')
            .join(',')})`,
          noticeIds
        )
        .catch(() => [[]]),
      pool
        .query(`SELECT id, class_name FROM class_master WHERE school_id = ?`, [schoolId])
        .catch(() => [[]]),
      pool
        .query(`SELECT id, section_name, class_id FROM section_master WHERE school_id = ?`, [
          schoolId,
        ])
        .catch(() => [[]]),
    ]);

    const messageMap = new Map();
    for (const m of allMessages || []) {
      const list = messageMap.get(m.notice_id) || [];
      list.push(m.message_to);
      messageMap.set(m.notice_id, list);
    }

    const classMap = new Map((allClasses || []).map((c) => [Number(c.id), c.class_name]));
    const sectionMap = new Map((allSections || []).map((s) => [Number(s.id), s.section_name]));

    const parseJson = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    for (const n of notices) {
      n.message_to = messageMap.get(n.id) || [];
      n.target_type = n.target_type || 'all';
      n.target_classes = parseJson(n.target_classes);
      n.target_sections = parseJson(n.target_sections);
      n.target_roles = parseJson(n.target_roles);
      n.target_user_ids = parseJson(n.target_user_ids);

      n.target_class_names = n.target_classes.map(
        (cid) => classMap.get(Number(cid)) || `Class ${cid}`
      );
      n.target_section_names = n.target_sections.map(
        (sid) => sectionMap.get(Number(sid)) || `Sec ${sid}`
      );
    }

    return notices;
  },

  // --- Notice Operations ---
  async getAllNotices(schoolId, branchId = null, onlyActive = false) {
    let query = `
      SELECT n.*, bm.branch_name, bm.branch_code
      FROM notice n
      LEFT JOIN branch_master bm ON n.branch_id = bm.id
      WHERE n.school_id = ? AND n.status != 4
    `;
    const params = [schoolId];
    if (onlyActive) {
      query += ` AND n.status = 1`;
    }
    if (branchId) {
      query += ` AND (n.branch_id = ? OR n.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    query += ` ORDER BY COALESCE(n.publish_on, n.notice_date, n.created_at) DESC, n.id DESC`;
    const [notices] = await pool.query(query, params);

    return AnnouncementModel._enrichNoticeRows(notices, schoolId);
  },

  async getNoticesPaginated(schoolId, branchId = null, filters = {}) {
    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const search = String(filters.search || '').trim();
    const statusFilter =
      filters.status !== undefined && filters.status !== '' && filters.status !== 'all'
        ? Number(filters.status)
        : null;
    const targetType =
      filters.target_type && filters.target_type !== 'all_scopes'
        ? String(filters.target_type).trim()
        : '';
    const recipient =
      filters.recipient && filters.recipient !== 'Select' && filters.recipient !== 'all'
        ? String(filters.recipient).trim().toLowerCase()
        : '';
    const startDate = filters.start_date ? String(filters.start_date).trim() : '';
    const endDate = filters.end_date ? String(filters.end_date).trim() : '';

    // Base school + branch scope (for summary counts)
    let baseWhere = `WHERE n.school_id = ? AND n.status != 4`;
    const baseParams = [schoolId];
    if (branchId) {
      baseWhere += ` AND (n.branch_id = ? OR n.branch_id IS NULL)`;
      baseParams.push(Number(branchId));
    }

    // Filtered WHERE clause
    let filterWhere = baseWhere;
    const filterParams = [...baseParams];

    if (statusFilter === 1) {
      filterWhere += ` AND n.status = 1`;
    } else if (statusFilter === 2) {
      filterWhere += ` AND (n.status = 2 OR n.status = 0)`;
    }

    if (targetType) {
      if (targetType === 'all') {
        filterWhere += ` AND (n.target_type = 'all' OR n.target_type IS NULL OR n.target_type = '')`;
      } else {
        filterWhere += ` AND n.target_type = ?`;
        filterParams.push(targetType);
      }
    }

    if (search) {
      const likeTerm = `%${search}%`;
      filterWhere += ` AND (n.title LIKE ? OR n.message LIKE ?)`;
      filterParams.push(likeTerm, likeTerm);
    }

    if (recipient) {
      const roleCodeMap = {
        student: '1',
        parent: '2',
        teacher: '3',
        admin: '4',
        'super admin': '5',
        super_admin: '5',
        staff: '6',
      };
      const mappedCode = roleCodeMap[recipient] || recipient;
      const likeRole = `%${recipient}%`;
      filterWhere += ` AND (
        LOWER(COALESCE(n.target_roles, '')) LIKE ?
        OR EXISTS (
          SELECT 1 FROM notice_message nm
          WHERE nm.notice_id = n.id
            AND (LOWER(nm.message_to) = ? OR nm.message_to = ? OR LOWER(nm.message_to) LIKE ?)
        )
      )`;
      filterParams.push(likeRole, recipient, mappedCode, likeRole);
    }

    if (startDate) {
      filterWhere += ` AND DATE(COALESCE(n.publish_on, n.notice_date, n.created_at)) >= ?`;
      filterParams.push(startDate);
    }

    if (endDate) {
      filterWhere += ` AND DATE(COALESCE(n.publish_on, n.notice_date, n.created_at)) <= ?`;
      filterParams.push(endDate);
    }

    const [
      [countRows],
      [summaryRows],
      [noticeRows],
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM notice n ${filterWhere}`, filterParams),
      pool.query(
        `SELECT
          COUNT(*) AS totalNotices,
          SUM(CASE WHEN n.status = 1 THEN 1 ELSE 0 END) AS activeCount,
          SUM(CASE WHEN n.status = 2 OR n.status = 0 THEN 1 ELSE 0 END) AS inactiveCount,
          SUM(CASE WHEN n.target_type = 'class_section' THEN 1 ELSE 0 END) AS classTargetedCount,
          SUM(CASE WHEN n.target_type = 'specific_users' THEN 1 ELSE 0 END) AS specificUsersCount,
          SUM(CASE WHEN n.target_type = 'all' OR n.target_type IS NULL OR n.target_type = '' THEN 1 ELSE 0 END) AS branchWideCount
         FROM notice n
         ${baseWhere}`,
        baseParams
      ),
      pool.query(
        `SELECT n.*, bm.branch_name, bm.branch_code
         FROM notice n
         LEFT JOIN branch_master bm ON n.branch_id = bm.id
         ${filterWhere}
         ORDER BY COALESCE(n.publish_on, n.notice_date, n.created_at) DESC, n.id DESC
         LIMIT ? OFFSET ?`,
        [...filterParams, limit, offset]
      ),
    ]);

    const total = Number(countRows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const enrichedNotices = await AnnouncementModel._enrichNoticeRows(noticeRows, schoolId);

    const rawSummary = summaryRows?.[0] || {};
    const summary = {
      totalNotices: Number(rawSummary.totalNotices || 0),
      activeCount: Number(rawSummary.activeCount || 0),
      inactiveCount: Number(rawSummary.inactiveCount || 0),
      classTargetedCount: Number(rawSummary.classTargetedCount || 0),
      specificUsersCount: Number(rawSummary.specificUsersCount || 0),
      branchWideCount: Number(rawSummary.branchWideCount || 0),
    };

    return {
      notices: enrichedNotices,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary,
    };
  },

  async getNoticeById(id, schoolId, branchId = null) {
    let sql = `
      SELECT n.*, bm.branch_name, bm.branch_code
      FROM notice n
      LEFT JOIN branch_master bm ON n.branch_id = bm.id
      WHERE n.id = ? AND n.school_id = ? AND n.status != 4
    `;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (n.branch_id = ? OR n.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
    if (!rows[0]) return null;
    const enriched = await AnnouncementModel._enrichNoticeRows([rows[0]], schoolId);
    return enriched[0] || null;
  },

  async createNotice({
    school_id,
    branch_id,
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
  }) {
    const branchVal = branch_id !== undefined && branch_id !== null ? Number(branch_id) : null;
    const [result] = await pool.query(
      `INSERT INTO notice (
        school_id, branch_id, title, notice_date, publish_on, message, status,
        target_type, target_classes, target_sections, target_roles, target_user_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        school_id,
        branchVal,
        title,
        notice_date || null,
        publish_on || null,
        message || null,
        normalizeStatus(status),
        target_type || 'all',
        JSON.stringify(target_classes || []),
        JSON.stringify(target_sections || []),
        JSON.stringify(target_roles || []),
        JSON.stringify(target_user_ids || []),
      ]
    );
    const noticeId = result.insertId;

    if (Array.isArray(message_to) && message_to.length > 0) {
      for (const recipient of message_to) {
        if (recipient) {
          await pool.query(
            `INSERT INTO notice_message (branch_id, notice_id, message_to) VALUES (?, ?, ?)`,
            [branchVal, noticeId, recipient]
          );
        }
      }
    }
    return noticeId;
  },

  async updateNotice(
    id,
    schoolId,
    {
      branch_id,
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
    },
    branchId = null
  ) {
    const branchVal = branch_id !== undefined && branch_id !== null ? Number(branch_id) : null;
    let sql = `UPDATE notice 
       SET branch_id = COALESCE(?, branch_id), title = ?, notice_date = ?, publish_on = ?, message = ?, status = ?,
           target_type = ?, target_classes = ?, target_sections = ?, target_roles = ?, target_user_ids = ?
       WHERE id = ? AND school_id = ?`;
    const params = [
      branchVal,
      title,
      notice_date || null,
      publish_on || null,
      message || null,
      normalizeStatus(status),
      target_type || 'all',
      JSON.stringify(target_classes || []),
      JSON.stringify(target_sections || []),
      JSON.stringify(target_roles || []),
      JSON.stringify(target_user_ids || []),
      id,
      schoolId,
    ];

    const effectiveBranchId = branchId || branchVal;
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    await pool.query(sql, params);

    if (Array.isArray(message_to)) {
      await pool.query(`DELETE FROM notice_message WHERE notice_id = ?`, [id]);
      let msgBranchId = effectiveBranchId;
      if (!msgBranchId) {
        const [nRows] = await pool.query(`SELECT branch_id FROM notice WHERE id = ?`, [id]);
        msgBranchId = nRows[0]?.branch_id || null;
      }
      for (const recipient of message_to) {
        if (recipient) {
          await pool.query(
            `INSERT INTO notice_message (branch_id, notice_id, message_to) VALUES (?, ?, ?)`,
            [msgBranchId ? Number(msgBranchId) : null, id, recipient]
          );
        }
      }
    }
    return true;
  },

  async deleteNotice(id, schoolId, branchId = null) {
    let sql = `UPDATE notice SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    return true;
  },

  // --- Event Operations ---
  async getAllEvents(schoolId, branchId = null) {
    let query = `
      SELECT e.*,
             DATE_FORMAT(e.from_date, '%Y-%m-%d') AS from_ymd,
             DATE_FORMAT(COALESCE(e.to_date, e.from_date), '%Y-%m-%d') AS to_ymd,
             bm.branch_name, bm.branch_code 
      FROM event e 
      LEFT JOIN branch_master bm ON e.branch_id = bm.id 
      WHERE e.school_id = ? AND e.status != 4
    `;
    const params = [schoolId];
    if (branchId) {
      query += ` AND (e.branch_id = ? OR e.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    query += ` ORDER BY e.from_date DESC, e.id DESC`;
    const [rows] = await pool.query(query, params);
    return rows;
  },

  async getEventsPaginated(schoolId, branchId = null, filters = {}) {
    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const search = String(filters.search || '').trim();
    const statusFilter =
      filters.status !== undefined && filters.status !== '' && filters.status !== 'all'
        ? Number(filters.status)
        : null;
    const timelineFilter =
      filters.timeline_status && filters.timeline_status !== 'all'
        ? String(filters.timeline_status).trim().toLowerCase()
        : '';
    const yearFilter =
      filters.year && filters.year !== 'all' ? parseInt(filters.year, 10) : null;
    const monthFilter =
      filters.month !== undefined && filters.month !== '' && filters.month !== 'all'
        ? parseInt(filters.month, 10) // 1-12
        : null;
    const startDate = filters.start_date ? String(filters.start_date).trim() : '';
    const endDate = filters.end_date ? String(filters.end_date).trim() : '';

    let baseWhere = `WHERE e.school_id = ? AND e.status != 4`;
    const baseParams = [schoolId];
    if (branchId) {
      baseWhere += ` AND (e.branch_id = ? OR e.branch_id IS NULL)`;
      baseParams.push(Number(branchId));
    }

    let filterWhere = baseWhere;
    const filterParams = [...baseParams];

    if (statusFilter === 1) {
      filterWhere += ` AND e.status = 1`;
    } else if (statusFilter === 2) {
      filterWhere += ` AND (e.status = 2 OR e.status = 0)`;
    }

    if (timelineFilter === 'ongoing') {
      filterWhere += ` AND CURDATE() BETWEEN DATE(e.from_date) AND DATE(COALESCE(e.to_date, e.from_date))`;
    } else if (timelineFilter === 'upcoming') {
      filterWhere += ` AND DATE(e.from_date) > CURDATE()`;
    } else if (timelineFilter === 'completed') {
      filterWhere += ` AND DATE(COALESCE(e.to_date, e.from_date)) < CURDATE()`;
    }

    if (yearFilter) {
      filterWhere += ` AND (YEAR(e.from_date) = ? OR YEAR(COALESCE(e.to_date, e.from_date)) = ?)`;
      filterParams.push(yearFilter, yearFilter);
    }

    if (monthFilter && monthFilter >= 1 && monthFilter <= 12) {
      filterWhere += ` AND (MONTH(e.from_date) = ? OR MONTH(COALESCE(e.to_date, e.from_date)) = ?)`;
      filterParams.push(monthFilter, monthFilter);
    }

    if (search) {
      const likeTerm = `%${search}%`;
      filterWhere += ` AND (e.title LIKE ? OR e.details LIKE ?)`;
      filterParams.push(likeTerm, likeTerm);
    }

    if (startDate) {
      filterWhere += ` AND DATE(COALESCE(e.to_date, e.from_date)) >= ?`;
      filterParams.push(startDate);
    }
    if (endDate) {
      filterWhere += ` AND DATE(e.from_date) <= ?`;
      filterParams.push(endDate);
    }

    const [
      [countRows],
      [summaryRows],
      [eventRows],
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM event e ${filterWhere}`, filterParams),
      pool.query(
        `SELECT
          COUNT(*) AS totalEvents,
          SUM(CASE WHEN e.status = 1 THEN 1 ELSE 0 END) AS activeCount,
          SUM(CASE WHEN CURDATE() BETWEEN DATE(e.from_date) AND DATE(COALESCE(e.to_date, e.from_date)) THEN 1 ELSE 0 END) AS ongoingCount,
          SUM(CASE WHEN DATE(e.from_date) > CURDATE() THEN 1 ELSE 0 END) AS upcomingCount,
          SUM(CASE WHEN DATE(COALESCE(e.to_date, e.from_date)) < CURDATE() THEN 1 ELSE 0 END) AS completedCount
         FROM event e
         ${baseWhere}`,
        baseParams
      ),
      pool.query(
        `SELECT e.*,
                DATE_FORMAT(e.from_date, '%Y-%m-%d') AS from_ymd,
                DATE_FORMAT(COALESCE(e.to_date, e.from_date), '%Y-%m-%d') AS to_ymd,
                bm.branch_name, bm.branch_code
         FROM event e
         LEFT JOIN branch_master bm ON e.branch_id = bm.id
         ${filterWhere}
         ORDER BY e.from_date DESC, e.id DESC
         LIMIT ? OFFSET ?`,
        [...filterParams, limit, offset]
      ),
    ]);

    const total = Number(countRows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const rawSummary = summaryRows?.[0] || {};

    return {
      events: eventRows,
      pagination: { page, limit, total, totalPages },
      summary: {
        totalEvents: Number(rawSummary.totalEvents || 0),
        activeCount: Number(rawSummary.activeCount || 0),
        ongoingCount: Number(rawSummary.ongoingCount || 0),
        upcomingCount: Number(rawSummary.upcomingCount || 0),
        completedCount: Number(rawSummary.completedCount || 0),
      },
    };
  },

  async getEventById(id, schoolId, branchId = null) {
    let sql = `
      SELECT e.*,
             DATE_FORMAT(e.from_date, '%Y-%m-%d') AS from_ymd,
             DATE_FORMAT(COALESCE(e.to_date, e.from_date), '%Y-%m-%d') AS to_ymd,
             bm.branch_name, bm.branch_code 
      FROM event e 
      LEFT JOIN branch_master bm ON e.branch_id = bm.id 
      WHERE e.id = ? AND e.school_id = ? AND e.status != 4
    `;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (e.branch_id = ? OR e.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  },

  async createEvent({ school_id, branch_id = null, title, from_date, to_date, details, status }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;
    const [result] = await pool.query(
      `INSERT INTO event (school_id, branch_id, title, from_date, to_date, details, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        school_id,
        resolvedBranchId,
        title,
        from_date || null,
        to_date || null,
        details || null,
        normalizeStatus(status),
      ]
    );
    return result.insertId;
  },

  async updateEvent(id, schoolId, { branch_id, title, from_date, to_date, details, status }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : null;
    let sql = `UPDATE event 
       SET title = ?, from_date = ?, to_date = ?, details = ?, status = ?, branch_id = COALESCE(?, branch_id)
       WHERE id = ? AND school_id = ?`;
    const params = [
      title,
      from_date || null,
      to_date || null,
      details || null,
      normalizeStatus(status),
      resolvedBranchId,
      id,
      schoolId,
    ];

    const effectiveBranchId = branchId || resolvedBranchId;
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    await pool.query(sql, params);
    return true;
  },

  async deleteEvent(id, schoolId, branchId = null) {
    let sql = `UPDATE event SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    return true;
  },

  // --- Holiday Operations ---
  async getAllHolidays(schoolId, branchId = null) {
    let query = `
      SELECT h.*,
             DATE_FORMAT(h.from_date, '%Y-%m-%d') AS from_ymd,
             DATE_FORMAT(COALESCE(h.to_date, h.from_date), '%Y-%m-%d') AS to_ymd,
             bm.branch_name, bm.branch_code 
      FROM holiday h 
      LEFT JOIN branch_master bm ON h.branch_id = bm.id 
      WHERE h.school_id = ? AND h.status != 4
    `;
    const params = [schoolId];
    if (branchId) {
      query += ` AND (h.branch_id = ? OR h.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    query += ` ORDER BY h.from_date DESC, h.id DESC`;
    const [rows] = await pool.query(query, params);
    return rows;
  },

  async getHolidayById(id, schoolId, branchId = null) {
    let sql = `
      SELECT h.*,
             DATE_FORMAT(h.from_date, '%Y-%m-%d') AS from_ymd,
             DATE_FORMAT(COALESCE(h.to_date, h.from_date), '%Y-%m-%d') AS to_ymd,
             bm.branch_name, bm.branch_code 
      FROM holiday h 
      LEFT JOIN branch_master bm ON h.branch_id = bm.id 
      WHERE h.id = ? AND h.school_id = ? AND h.status != 4
    `;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (h.branch_id = ? OR h.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  },

  async createHoliday({ school_id, branch_id = null, title, from_date, to_date, details, status }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;
    const [result] = await pool.query(
      `INSERT INTO holiday (school_id, branch_id, title, from_date, to_date, details, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        school_id,
        resolvedBranchId,
        title,
        from_date || null,
        to_date || null,
        details || null,
        normalizeStatus(status),
      ]
    );
    return result.insertId;
  },

  async updateHoliday(id, schoolId, { branch_id, title, from_date, to_date, details, status }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : null;
    let sql = `UPDATE holiday 
       SET title = ?, from_date = ?, to_date = ?, details = ?, status = ?, branch_id = COALESCE(?, branch_id)
       WHERE id = ? AND school_id = ?`;
    const params = [
      title,
      from_date || null,
      to_date || null,
      details || null,
      normalizeStatus(status),
      resolvedBranchId,
      id,
      schoolId,
    ];

    const effectiveBranchId = branchId || resolvedBranchId;
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    await pool.query(sql, params);
    return true;
  },

  async deleteHoliday(id, schoolId, branchId = null) {
    let sql = `UPDATE holiday SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    return true;
  },
};

module.exports = AnnouncementModel;
