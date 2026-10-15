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

  static async getSalaryDateById(id, schoolId, branchId = null) {
    let sql = `SELECT sd.*, bm.branch_name, bm.branch_code 
       FROM settings_salary_date sd 
       LEFT JOIN branch_master bm ON sd.branch_id = bm.id
       WHERE sd.id = ? AND sd.school_id = ? AND sd.status != 4`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (sd.branch_id = ? OR sd.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
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

  static async updateSalaryDate(id, schoolId, { branch_id, salary_date, status = 1 }, branchId = null) {
    let sql = `UPDATE settings_salary_date SET salary_date = COALESCE(?, salary_date), status = COALESCE(?, status)`;
    const params = [salary_date, status];
    if (branch_id !== undefined) {
      sql += `, branch_id = ?`;
      params.push(branch_id ? Number(branch_id) : null);
    }
    sql += ` WHERE id = ? AND school_id = ?`;
    params.push(id, schoolId);

    const effectiveBranchId = branchId || branch_id;
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static resolveSalaryDateForMonth(rawDateStr, targetMonth = null) {
    if (!rawDateStr) return null;
    const trimmed = String(rawDateStr).trim();
    if (!trimmed) return null;

    let configuredYear = null;
    let configuredMonth = null;
    let configuredDay = 1;

    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const parts = trimmed.slice(0, 10).split('-');
      configuredYear = parseInt(parts[0], 10);
      configuredMonth = parseInt(parts[1], 10);
      configuredDay = parseInt(parts[2], 10) || 1;
    } else if (/^\d{1,2}$/.test(trimmed)) {
      configuredDay = Math.min(31, Math.max(1, parseInt(trimmed, 10) || 1));
    } else {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        configuredYear = parsed.getFullYear();
        configuredMonth = parsed.getMonth() + 1;
        configuredDay = parsed.getDate();
      }
    }

    let year = configuredYear || new Date().getFullYear();
    let month = configuredMonth || new Date().getMonth() + 1;

    if (targetMonth && typeof targetMonth === 'string' && /^\d{4}-\d{2}/.test(targetMonth.trim())) {
      const [ty, tm] = targetMonth.trim().slice(0, 7).split('-').map((n) => parseInt(n, 10));
      if (!isNaN(ty) && ty > 1900 && !isNaN(tm) && tm >= 1 && tm <= 12) {
        year = ty;
        month = tm;
      }
    }

    const maxDaysInMonth = new Date(year, month, 0).getDate() || 30;
    const safeDay = Math.min(maxDaysInMonth, Math.max(1, configuredDay));

    return {
      configured_salary_date: `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`,
      salary_month: `${year}-${String(month).padStart(2, '0')}`,
      salary_day: safeDay,
      raw_salary_date: trimmed.slice(0, 10),
    };
  }

  static async getActiveSalaryDateSetting(schoolId, branchId = null, targetMonth = null) {
    const sId = Number(schoolId);
    const bId = branchId ? Number(branchId) : null;

    let rows = [];
    if (bId) {
      const [branchRows] = await pool.query(
        `SELECT sd.id, sd.school_id, sd.branch_id, sd.salary_date, sd.status, sd.created_on, bm.branch_name, bm.branch_code
         FROM settings_salary_date sd
         LEFT JOIN branch_master bm ON sd.branch_id = bm.id
         WHERE sd.school_id = ? AND sd.status = 1 AND (sd.branch_id = ? OR sd.branch_id IS NULL)
         ORDER BY CASE WHEN sd.branch_id = ? THEN 0 ELSE 1 END ASC, sd.id DESC
         LIMIT 1`,
        [sId, bId, bId]
      );
      rows = branchRows || [];
    }

    if (!rows.length) {
      const [fallbackRows] = await pool.query(
        `SELECT sd.id, sd.school_id, sd.branch_id, sd.salary_date, sd.status, sd.created_on, bm.branch_name, bm.branch_code
         FROM settings_salary_date sd
         LEFT JOIN branch_master bm ON sd.branch_id = bm.id
         WHERE sd.school_id = ? AND sd.status = 1
         ORDER BY sd.id DESC
         LIMIT 1`,
        [sId]
      );
      rows = fallbackRows || [];
    }

    if (!rows.length) {
      return null;
    }

    const activeRow = rows[0];
    const resolved = SalaryDateModel.resolveSalaryDateForMonth(activeRow.salary_date, targetMonth);

    return {
      id: activeRow.id,
      school_id: activeRow.school_id,
      branch_id: activeRow.branch_id,
      branch_name: activeRow.branch_name || null,
      branch_code: activeRow.branch_code || null,
      salary_date: activeRow.salary_date,
      raw_salary_date: resolved?.raw_salary_date || activeRow.salary_date,
      configured_salary_date: resolved?.configured_salary_date || activeRow.salary_date,
      salary_month: resolved?.salary_month || String(activeRow.salary_date || '').slice(0, 7),
      salary_day: resolved?.salary_day || 1,
      status: Number(activeRow.status),
      created_on: activeRow.created_on,
    };
  }

  static async deleteSalaryDate(id, schoolId, branchId = null) {
    let sql = `UPDATE settings_salary_date SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }
}

module.exports = SalaryDateModel;
