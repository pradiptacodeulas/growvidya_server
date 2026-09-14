const { pool } = require('../config/db.config');

class MiscSettingModel {
  // ==================== RELIGION ====================

  static async getAllReligions(schoolId, { search = '', limit = 10, offset = 0 } = {}) {
    let whereConditions = [`school_id = ?`];
    let params = [schoolId];

    if (search) {
      whereConditions.push(`religion LIKE ?`);
      params.push(`%${search.trim()}%`);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const sql = `
      SELECT id, school_id, religion, sort_order, status
      FROM religion_master
      ${whereClause}
      ORDER BY sort_order ASC, id ASC
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM religion_master
      ${whereClause}
    `;

    const [rows] = await pool.query(sql, [...params, Number(limit), Number(offset)]);
    const [cRows] = await pool.query(countSql, params);

    return {
      rows,
      total: cRows[0]?.total || 0,
    };
  }

  static async getReligionById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM religion_master WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createReligion(schoolId, { religion, sort_order = 1, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO religion_master (school_id, religion, sort_order, status) VALUES (?, ?, ?, ?)`,
      [schoolId, religion, Number(sort_order) || 1, Number(status) || 1]
    );
    return result.insertId;
  }

  static async updateReligion(id, schoolId, { religion, sort_order, status }) {
    const fields = [];
    const params = [];

    if (religion !== undefined) {
      fields.push(`religion = ?`);
      params.push(religion);
    }
    if (sort_order !== undefined) {
      fields.push(`sort_order = ?`);
      params.push(Number(sort_order));
    }
    if (status !== undefined) {
      fields.push(`status = ?`);
      params.push(Number(status));
    }

    if (fields.length === 0) return true;

    params.push(id, schoolId);
    const [result] = await pool.query(
      `UPDATE religion_master SET ${fields.join(', ')} WHERE id = ? AND school_id = ?`,
      params
    );
    return result.affectedRows > 0;
  }

  static async deleteReligion(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE religion_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== MOTHER TONGUE ====================

  static async getAllMotherTongues(schoolId, { search = '', limit = 10, offset = 0 } = {}) {
    let whereConditions = [`school_id = ?`];
    let params = [schoolId];

    if (search) {
      whereConditions.push(`mother_tongue LIKE ?`);
      params.push(`%${search.trim()}%`);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const sql = `
      SELECT id, school_id, mother_tongue, sort_order, status
      FROM mother_tongue_master
      ${whereClause}
      ORDER BY sort_order ASC, id ASC
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM mother_tongue_master
      ${whereClause}
    `;

    const [rows] = await pool.query(sql, [...params, Number(limit), Number(offset)]);
    const [cRows] = await pool.query(countSql, params);

    return {
      rows,
      total: cRows[0]?.total || 0,
    };
  }

  static async getMotherTongueById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM mother_tongue_master WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createMotherTongue(schoolId, { mother_tongue, sort_order = 1, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO mother_tongue_master (school_id, mother_tongue, sort_order, status) VALUES (?, ?, ?, ?)`,
      [schoolId, mother_tongue, Number(sort_order) || 1, Number(status) || 1]
    );
    return result.insertId;
  }

  static async updateMotherTongue(id, schoolId, { mother_tongue, sort_order, status }) {
    const fields = [];
    const params = [];

    if (mother_tongue !== undefined) {
      fields.push(`mother_tongue = ?`);
      params.push(mother_tongue);
    }
    if (sort_order !== undefined) {
      fields.push(`sort_order = ?`);
      params.push(Number(sort_order));
    }
    if (status !== undefined) {
      fields.push(`status = ?`);
      params.push(Number(status));
    }

    if (fields.length === 0) return true;

    params.push(id, schoolId);
    const [result] = await pool.query(
      `UPDATE mother_tongue_master SET ${fields.join(', ')} WHERE id = ? AND school_id = ?`,
      params
    );
    return result.affectedRows > 0;
  }

  static async deleteMotherTongue(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE mother_tongue_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== GENDER ====================

  static async getAllGenders({ search = '', limit = 10, offset = 0 } = {}) {
    let whereConditions = [];
    let params = [];

    if (search) {
      whereConditions.push(`gender LIKE ?`);
      params.push(`%${search.trim()}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const sql = `
      SELECT id, gender
      FROM gender_master
      ${whereClause}
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM gender_master
      ${whereClause}
    `;

    const [rows] = await pool.query(sql, [...params, Number(limit), Number(offset)]);
    const [cRows] = await pool.query(countSql, params);

    return {
      rows,
      total: cRows[0]?.total || 0,
    };
  }

  // ==================== CATEGORY ====================

  static async getAllCategories(schoolId, { search = '', limit = 10, offset = 0 } = {}) {
    let whereConditions = [`school_id = ?`];
    let params = [schoolId];

    if (search) {
      whereConditions.push(`category LIKE ?`);
      params.push(`%${search.trim()}%`);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const sql = `
      SELECT id, school_id, category, sort_order, status
      FROM student_category_master
      ${whereClause}
      ORDER BY sort_order ASC, id ASC
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM student_category_master
      ${whereClause}
    `;

    const [rows] = await pool.query(sql, [...params, Number(limit), Number(offset)]);
    const [cRows] = await pool.query(countSql, params);

    return {
      rows,
      total: cRows[0]?.total || 0,
    };
  }

  static async getCategoryById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM student_category_master WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createCategory(schoolId, { category, sort_order = 1, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO student_category_master (school_id, category, sort_order, status) VALUES (?, ?, ?, ?)`,
      [schoolId, category, Number(sort_order) || 1, Number(status) || 1]
    );
    return result.insertId;
  }

  static async updateCategory(id, schoolId, { category, sort_order, status }) {
    const fields = [];
    const params = [];

    if (category !== undefined) {
      fields.push(`category = ?`);
      params.push(category);
    }
    if (sort_order !== undefined) {
      fields.push(`sort_order = ?`);
      params.push(Number(sort_order));
    }
    if (status !== undefined) {
      fields.push(`status = ?`);
      params.push(Number(status));
    }

    if (fields.length === 0) return true;

    params.push(id, schoolId);
    const [result] = await pool.query(
      `UPDATE student_category_master SET ${fields.join(', ')} WHERE id = ? AND school_id = ?`,
      params
    );
    return result.affectedRows > 0;
  }

  static async deleteCategory(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE student_category_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = MiscSettingModel;
