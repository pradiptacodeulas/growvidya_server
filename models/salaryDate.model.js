const { pool } = require('../config/db.config');

class SalaryDateModel {
  /**
   * Fetches paginated salary date settings
   */
  static async getAllSalaryDates(schoolId, { search = '', limit = 10, offset = 0 } = {}) {
    let whereClause = 'WHERE school_id = ? AND status != 4';
    const params = [schoolId];

    if (search && search.trim() !== '') {
      whereClause += ' AND salary_date LIKE ?';
      params.push(`%${search.trim()}%`);
    }

    const countSql = `SELECT COUNT(*) AS total FROM settings_salary_date ${whereClause}`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0]?.total || 0;

    const dataSql = `
      SELECT id, school_id, salary_date, status, created_on 
      FROM settings_salary_date 
      ${whereClause} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataSql, [...params, Number(limit), Number(offset)]);

    return { total, rows };
  }

  static async getSalaryDateById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM settings_salary_date WHERE id = ? AND school_id = ? AND status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createSalaryDate(schoolId, { salary_date, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO settings_salary_date (school_id, salary_date, status, created_on) VALUES (?, ?, ?, NOW())`,
      [schoolId, salary_date, status]
    );
    return result.insertId;
  }

  static async updateSalaryDate(id, schoolId, { salary_date, status = 1 }) {
    const [result] = await pool.query(
      `UPDATE settings_salary_date SET salary_date = ?, status = ? WHERE id = ? AND school_id = ?`,
      [salary_date, status, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteSalaryDate(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE settings_salary_date SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = SalaryDateModel;
