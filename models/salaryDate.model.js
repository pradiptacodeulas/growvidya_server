const { pool } = require('../config/db.config');

class SalaryDateModel {
  /**
   * Fetches paginated salary date settings
   */
  static async getAllSalaryDates(schoolId, { search = '', limit = 10, offset = 0, branchId = null } = {}) {
    let whereClause = 'WHERE sd.school_id = ? AND sd.status != 4';
    const params = [schoolId];

    if (branchId) {
      whereClause += ' AND (sd.branch_id = ? OR sd.branch_id IS NULL)';
      params.push(Number(branchId));
    }

    if (search && search.trim() !== '') {
      whereClause += ' AND sd.salary_date LIKE ?';
      params.push(`%${search.trim()}%`);
    }

    const countSql = `SELECT COUNT(*) AS total FROM settings_salary_date sd ${whereClause}`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0]?.total || 0;

    const dataSql = `
      SELECT sd.id, sd.school_id, sd.branch_id, sd.salary_date, sd.status, sd.created_on, bm.branch_name, bm.branch_code 
      FROM settings_salary_date sd
      LEFT JOIN branch_master bm ON sd.branch_id = bm.id
      ${whereClause} 
      ORDER BY sd.id DESC 
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataSql, [...params, Number(limit), Number(offset)]);

    return { total, rows };
  }

  static async getSalaryDateById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT sd.*, bm.branch_name, bm.branch_code 
       FROM settings_salary_date sd 
       LEFT JOIN branch_master bm ON sd.branch_id = bm.id
       WHERE sd.id = ? AND sd.school_id = ? AND sd.status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createSalaryDate(schoolId, { branch_id = null, salary_date, status = 1 }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;
    const [result] = await pool.query(
      `INSERT INTO settings_salary_date (school_id, branch_id, salary_date, status, created_on) VALUES (?, ?, ?, ?, NOW())`,
      [schoolId, resolvedBranchId, salary_date, status]
    );
    return result.insertId;
  }

  static async updateSalaryDate(id, schoolId, { branch_id, salary_date, status = 1 }) {
    let sql = `UPDATE settings_salary_date SET salary_date = COALESCE(?, salary_date), status = COALESCE(?, status)`;
    const params = [salary_date, status];
    if (branch_id !== undefined) {
      sql += `, branch_id = ?`;
      params.push(branch_id ? Number(branch_id) : null);
    }
    sql += ` WHERE id = ? AND school_id = ?`;
    params.push(id, schoolId);

    const [result] = await pool.query(sql, params);
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
