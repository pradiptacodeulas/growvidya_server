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
        publish_on DATE DEFAULT NULL,
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

const AnnouncementModel = {
  // --- Notice Operations ---
  async getAllNotices(schoolId, branchId = null) {
    let query = `SELECT * FROM notice WHERE school_id = ? AND status != 4`;
    const params = [schoolId];
    if (branchId) {
      query += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    query += ` ORDER BY id DESC`;
    const [notices] = await pool.query(query, params);

    // Fetch lookup maps for class_name and section_name
    const [allClasses] = await pool.query(
      `SELECT id, class_name FROM class_master WHERE school_id = ?`,
      [schoolId]
    ).catch(() => [[]]);
    const classMap = new Map((allClasses || []).map((c) => [c.id, c.class_name]));

    const [allSections] = await pool.query(
      `SELECT id, section_name, class_id FROM section_master WHERE school_id = ?`,
      [schoolId]
    ).catch(() => [[]]);
    const sectionMap = new Map((allSections || []).map((s) => [s.id, s.section_name]));

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

    // Attach message_to recipients and parsed targeting info to each notice
    for (const n of notices) {
      const [messages] = await pool.query(
        `SELECT message_to FROM notice_message WHERE notice_id = ?`,
        [n.id]
      );
      n.message_to = messages.map((m) => m.message_to);
      n.target_type = n.target_type || 'all';
      n.target_classes = parseJson(n.target_classes);
      n.target_sections = parseJson(n.target_sections);
      n.target_roles = parseJson(n.target_roles);
      n.target_user_ids = parseJson(n.target_user_ids);

      n.target_class_names = n.target_classes.map((cid) => classMap.get(Number(cid)) || `Class ${cid}`);
      n.target_section_names = n.target_sections.map((sid) => sectionMap.get(Number(sid)) || `Sec ${sid}`);
    }
    return notices;
  },

  async getNoticeById(id, schoolId, branchId = null) {
    let sql = `SELECT * FROM notice 
       WHERE id = ? AND school_id = ? AND status != 4`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
    if (!rows[0]) return null;
    const notice = rows[0];
    const [messages] = await pool.query(
      `SELECT message_to FROM notice_message WHERE notice_id = ?`,
      [notice.id]
    );
    notice.message_to = messages.map((m) => m.message_to);

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

    notice.target_type = notice.target_type || 'all';
    notice.target_classes = parseJson(notice.target_classes);
    notice.target_sections = parseJson(notice.target_sections);
    notice.target_roles = parseJson(notice.target_roles);
    notice.target_user_ids = parseJson(notice.target_user_ids);

    const [allClasses] = await pool.query(
      `SELECT id, class_name FROM class_master WHERE school_id = ?`,
      [schoolId]
    ).catch(() => [[]]);
    const classMap = new Map((allClasses || []).map((c) => [c.id, c.class_name]));

    const [allSections] = await pool.query(
      `SELECT id, section_name, class_id FROM section_master WHERE school_id = ?`,
      [schoolId]
    ).catch(() => [[]]);
    const sectionMap = new Map((allSections || []).map((s) => [s.id, s.section_name]));

    notice.target_class_names = notice.target_classes.map((cid) => classMap.get(Number(cid)) || `Class ${cid}`);
    notice.target_section_names = notice.target_sections.map((sid) => sectionMap.get(Number(sid)) || `Sec ${sid}`);

    return notice;
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
        status !== undefined ? parseInt(status, 10) : 1,
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
            `INSERT INTO notice_message (notice_id, message_to) VALUES (?, ?)`,
            [noticeId, recipient]
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
      status !== undefined ? parseInt(status, 10) : 1,
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
      for (const recipient of message_to) {
        if (recipient) {
          await pool.query(
            `INSERT INTO notice_message (notice_id, message_to) VALUES (?, ?)`,
            [id, recipient]
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
    let query = `SELECT e.*, bm.branch_name, bm.branch_code 
                 FROM event e 
                 LEFT JOIN branch_master bm ON e.branch_id = bm.id 
                 WHERE e.school_id = ? AND e.status != 4`;
    const params = [schoolId];
    if (branchId) {
      query += ` AND (e.branch_id = ? OR e.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    query += ` ORDER BY e.from_date DESC, e.id DESC`;
    const [rows] = await pool.query(query, params);
    return rows;
  },

  async getEventById(id, schoolId, branchId = null) {
    let sql = `SELECT e.*, bm.branch_name, bm.branch_code 
       FROM event e 
       LEFT JOIN branch_master bm ON e.branch_id = bm.id 
       WHERE e.id = ? AND e.school_id = ? AND e.status != 4`;
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
        status !== undefined ? parseInt(status, 10) : 1,
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
      status !== undefined ? parseInt(status, 10) : 1,
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
    let query = `SELECT h.*, bm.branch_name, bm.branch_code 
                 FROM holiday h 
                 LEFT JOIN branch_master bm ON h.branch_id = bm.id 
                 WHERE h.school_id = ? AND h.status != 4`;
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
    let sql = `SELECT h.*, bm.branch_name, bm.branch_code 
       FROM holiday h 
       LEFT JOIN branch_master bm ON h.branch_id = bm.id 
       WHERE h.id = ? AND h.school_id = ? AND h.status != 4`;
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
        status !== undefined ? parseInt(status, 10) : 1,
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
      status !== undefined ? parseInt(status, 10) : 1,
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
