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
  async getAllNotices(schoolId) {
    const [notices] = await pool.query(
      `SELECT * FROM notice 
       WHERE school_id = ? AND status != 4 
       ORDER BY id DESC`,
      [schoolId]
    );

    // Attach message_to recipients to each notice
    for (const n of notices) {
      const [messages] = await pool.query(
        `SELECT message_to FROM notice_message WHERE notice_id = ?`,
        [n.id]
      );
      n.message_to = messages.map((m) => m.message_to);
    }
    return notices;
  },

  async getNoticeById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM notice 
       WHERE id = ? AND school_id = ? AND status != 4`,
      [id, schoolId]
    );
    if (!rows[0]) return null;
    const notice = rows[0];
    const [messages] = await pool.query(
      `SELECT message_to FROM notice_message WHERE notice_id = ?`,
      [notice.id]
    );
    notice.message_to = messages.map((m) => m.message_to);
    return notice;
  },

  async createNotice({ school_id, title, notice_date, publish_on, message, message_to, status }) {
    const [result] = await pool.query(
      `INSERT INTO notice (school_id, title, notice_date, publish_on, message, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        school_id,
        title,
        notice_date || null,
        publish_on || null,
        message || null,
        status !== undefined ? parseInt(status, 10) : 1,
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

  async updateNotice(id, schoolId, { title, notice_date, publish_on, message, message_to, status }) {
    await pool.query(
      `UPDATE notice 
       SET title = ?, notice_date = ?, publish_on = ?, message = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        title,
        notice_date || null,
        publish_on || null,
        message || null,
        status !== undefined ? parseInt(status, 10) : 1,
        id,
        schoolId,
      ]
    );

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

  async deleteNotice(id, schoolId) {
    await pool.query(
      `UPDATE notice SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  },

  // --- Event Operations ---
  async getAllEvents(schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM event 
       WHERE school_id = ? AND status != 4 
       ORDER BY from_date DESC, id DESC`,
      [schoolId]
    );
    return rows;
  },

  async getEventById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM event 
       WHERE id = ? AND school_id = ? AND status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  },

  async createEvent({ school_id, title, from_date, to_date, details, status }) {
    const [result] = await pool.query(
      `INSERT INTO event (school_id, title, from_date, to_date, details, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        school_id,
        title,
        from_date || null,
        to_date || null,
        details || null,
        status !== undefined ? parseInt(status, 10) : 1,
      ]
    );
    return result.insertId;
  },

  async updateEvent(id, schoolId, { title, from_date, to_date, details, status }) {
    await pool.query(
      `UPDATE event 
       SET title = ?, from_date = ?, to_date = ?, details = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        title,
        from_date || null,
        to_date || null,
        details || null,
        status !== undefined ? parseInt(status, 10) : 1,
        id,
        schoolId,
      ]
    );
    return true;
  },

  async deleteEvent(id, schoolId) {
    await pool.query(
      `UPDATE event SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  },

  // --- Holiday Operations ---
  async getAllHolidays(schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM holiday 
       WHERE school_id = ? AND status != 4 
       ORDER BY from_date DESC, id DESC`,
      [schoolId]
    );
    return rows;
  },

  async getHolidayById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM holiday 
       WHERE id = ? AND school_id = ? AND status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  },

  async createHoliday({ school_id, title, from_date, to_date, details, status }) {
    const [result] = await pool.query(
      `INSERT INTO holiday (school_id, title, from_date, to_date, details, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        school_id,
        title,
        from_date || null,
        to_date || null,
        details || null,
        status !== undefined ? parseInt(status, 10) : 1,
      ]
    );
    return result.insertId;
  },

  async updateHoliday(id, schoolId, { title, from_date, to_date, details, status }) {
    await pool.query(
      `UPDATE holiday 
       SET title = ?, from_date = ?, to_date = ?, details = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        title,
        from_date || null,
        to_date || null,
        details || null,
        status !== undefined ? parseInt(status, 10) : 1,
        id,
        schoolId,
      ]
    );
    return true;
  },

  async deleteHoliday(id, schoolId) {
    await pool.query(
      `UPDATE holiday SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  },
};

module.exports = AnnouncementModel;
