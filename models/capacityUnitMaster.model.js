const { pool } = require('../config/db.config');

class CapacityUnitMasterModel {
  /**
   * Fetch all capacity units
   */
  static async getAll({ status = '' } = {}) {
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT *
      FROM capacity_unit_master
      ${where}
      ORDER BY factor_in_mb ASC
    `;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Fetch active capacity units (for dropdowns / selectors)
   */
  static async getActive() {
    const [rows] = await pool.query(
      'SELECT * FROM capacity_unit_master WHERE status = 1 ORDER BY factor_in_mb ASC'
    );
    return rows;
  }

  /**
   * Get single capacity unit by ID
   */
  static async getById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM capacity_unit_master WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Get single capacity unit by code (e.g. 'GB', 'TB', 'MB')
   */
  static async getByCode(code) {
    if (!code) return null;
    const [rows] = await pool.query(
      'SELECT * FROM capacity_unit_master WHERE unit_code = ? LIMIT 1',
      [code.trim().toUpperCase()]
    );
    return rows[0] || null;
  }

  /**
   * Create a new capacity unit
   */
  static async create({ unit_name, unit_code, factor_in_mb = 1, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO capacity_unit_master (unit_name, unit_code, factor_in_mb, status, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        unit_name.trim(),
        unit_code.trim().toUpperCase(),
        parseInt(factor_in_mb, 10) || 1,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update capacity unit
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.unit_name !== undefined) {
      updates.push('unit_name = ?');
      params.push(data.unit_name.trim());
    }
    if (data.unit_code !== undefined) {
      updates.push('unit_code = ?');
      params.push(data.unit_code.trim().toUpperCase());
    }
    if (data.factor_in_mb !== undefined) {
      updates.push('factor_in_mb = ?');
      params.push(parseInt(data.factor_in_mb, 10) || 1);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(data.status, 10));
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE capacity_unit_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }
}

module.exports = CapacityUnitMasterModel;
