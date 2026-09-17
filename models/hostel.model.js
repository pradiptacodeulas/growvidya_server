const { pool } = require('../config/db.config');

// Ensure tables and columns exist
const initHostelTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hostel_name_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        hostel_name VARCHAR(255) NOT NULL,
        hostel_fee DECIMAL(10,2) DEFAULT 0.00,
        sort_order INT DEFAULT 0,
        status TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure hostel_fee column exists if table existed previously
    const [columns] = await pool.query(`SHOW COLUMNS FROM hostel_name_master LIKE 'hostel_fee'`);
    if (columns.length === 0) {
      await pool.query(`ALTER TABLE hostel_name_master ADD COLUMN hostel_fee DECIMAL(10,2) DEFAULT 0.00`);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS hostel_room_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        hostel_id INT NOT NULL,
        room_number VARCHAR(100) NOT NULL,
        sort_order INT DEFAULT 0,
        status TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error('Error initializing hostel tables:', err);
  }
};

initHostelTables();

const HostelModel = {
  // --- Hostel Name Master ---
  async getAllHostels(schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM hostel_name_master 
       WHERE school_id = ? AND status != 4 
       ORDER BY sort_order ASC, id DESC`,
      [schoolId]
    );
    return rows;
  },

  async getHostelById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM hostel_name_master 
       WHERE id = ? AND school_id = ? AND status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  },

  async createHostel({ school_id, hostel_name, hostel_fee, sort_order, status }) {
    const [result] = await pool.query(
      `INSERT INTO hostel_name_master (school_id, hostel_name, hostel_fee, sort_order, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        school_id,
        hostel_name,
        parseFloat(hostel_fee) || 0.00,
        parseInt(sort_order, 10) || 0,
        status !== undefined ? parseInt(status, 10) : 1,
      ]
    );
    return result.insertId;
  },

  async updateHostel(id, schoolId, { hostel_name, hostel_fee, sort_order, status }) {
    await pool.query(
      `UPDATE hostel_name_master 
       SET hostel_name = ?, hostel_fee = ?, sort_order = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        hostel_name,
        parseFloat(hostel_fee) || 0.00,
        parseInt(sort_order, 10) || 0,
        status !== undefined ? parseInt(status, 10) : 1,
        id,
        schoolId,
      ]
    );
    return true;
  },

  async deleteHostel(id, schoolId) {
    await pool.query(
      `UPDATE hostel_name_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  },

  // --- Hostel Room Master ---
  async getAllHostelRooms(schoolId) {
    const [rows] = await pool.query(
      `SELECT rm.*, rm.room_number AS room_no, hn.hostel_name, hn.hostel_fee 
       FROM hostel_room_master rm
       LEFT JOIN hostel_name_master hn ON hn.id = rm.hostel_id
       WHERE rm.school_id = ? AND rm.status != 4
       ORDER BY rm.sort_order ASC, rm.id DESC`,
      [schoolId]
    );
    return rows;
  },

  async getHostelRoomById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT rm.*, rm.room_number AS room_no, hn.hostel_name 
       FROM hostel_room_master rm
       LEFT JOIN hostel_name_master hn ON hn.id = rm.hostel_id
       WHERE rm.id = ? AND rm.school_id = ? AND rm.status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  },

  async createHostelRoom({ school_id, hostel_id, room_number, sort_order, status }) {
    const [result] = await pool.query(
      `INSERT INTO hostel_room_master (school_id, hostel_id, room_number, sort_order, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        school_id,
        parseInt(hostel_id, 10),
        room_number,
        parseInt(sort_order, 10) || 0,
        status !== undefined ? parseInt(status, 10) : 1,
      ]
    );
    return result.insertId;
  },

  async updateHostelRoom(id, schoolId, { hostel_id, room_number, sort_order, status }) {
    await pool.query(
      `UPDATE hostel_room_master 
       SET hostel_id = ?, room_number = ?, sort_order = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        parseInt(hostel_id, 10),
        room_number,
        parseInt(sort_order, 10) || 0,
        status !== undefined ? parseInt(status, 10) : 1,
        id,
        schoolId,
      ]
    );
    return true;
  },

  async deleteHostelRoom(id, schoolId) {
    await pool.query(
      `UPDATE hostel_room_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  },
};

module.exports = HostelModel;
