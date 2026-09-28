const { pool } = require('../config/db.config');

class BankAccountMasterModel {
  /**
   * List all bank accounts (with search and status filters)
   */
  static async getAll({ search = '', status = null } = {}) {
    let query = `
      SELECT 
        id, 
        account_title, 
        beneficiary_name, 
        account_number, 
        bank_name, 
        branch_name, 
        ifsc_code, 
        account_type, 
        upi_id, 
        swift_code, 
        instructions, 
        qr_code_image, 
        is_default, 
        status, 
        created_at, 
        updated_at
      FROM bank_account_master
      WHERE 1=1
    `;
    const params = [];

    if (search && String(search).trim() !== '') {
      const term = `%${String(search).trim()}%`;
      query += ` AND (account_title LIKE ? OR beneficiary_name LIKE ? OR account_number LIKE ? OR bank_name LIKE ? OR ifsc_code LIKE ? OR upi_id LIKE ?)`;
      params.push(term, term, term, term, term, term);
    }

    if (status !== null && status !== undefined && status !== '') {
      query += ` AND status = ?`;
      params.push(parseInt(status, 10));
    }

    query += ` ORDER BY is_default DESC, id DESC`;

    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * List only active bank accounts (for school subscription / checkout display)
   */
  static async getActive() {
    const query = `
      SELECT 
        id, 
        account_title, 
        beneficiary_name, 
        account_number, 
        bank_name, 
        branch_name, 
        ifsc_code, 
        account_type, 
        upi_id, 
        swift_code, 
        instructions, 
        qr_code_image, 
        is_default
      FROM bank_account_master
      WHERE status = 1
      ORDER BY is_default DESC, id ASC
    `;
    const [rows] = await pool.query(query);
    return rows;
  }

  /**
   * Get single bank account by ID
   */
  static async getById(id) {
    const [rows] = await pool.query(
      `SELECT * FROM bank_account_master WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create new bank account
   */
  static async create(data) {
    const {
      account_title,
      beneficiary_name,
      account_number,
      bank_name,
      branch_name = null,
      ifsc_code,
      account_type = 'Current',
      upi_id = null,
      swift_code = null,
      instructions = null,
      qr_code_image = null,
      is_default = 0,
      status = 1,
    } = data;

    // If is_default is 1, unset any other default accounts
    if (Number(is_default) === 1) {
      await pool.query(`UPDATE bank_account_master SET is_default = 0 WHERE is_default = 1`);
    }

    const query = `
      INSERT INTO bank_account_master (
        account_title,
        beneficiary_name,
        account_number,
        bank_name,
        branch_name,
        ifsc_code,
        account_type,
        upi_id,
        swift_code,
        instructions,
        qr_code_image,
        is_default,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      account_title,
      beneficiary_name,
      account_number,
      bank_name,
      branch_name,
      ifsc_code,
      account_type,
      upi_id,
      swift_code,
      instructions,
      qr_code_image,
      Number(is_default) ? 1 : 0,
      status !== undefined ? (Number(status) ? 1 : 0) : 1,
    ]);

    return this.getById(result.insertId);
  }

  /**
   * Update existing bank account
   */
  static async update(id, data) {
    const allowedFields = [
      'account_title',
      'beneficiary_name',
      'account_number',
      'bank_name',
      'branch_name',
      'ifsc_code',
      'account_type',
      'upi_id',
      'swift_code',
      'instructions',
      'qr_code_image',
      'is_default',
      'status',
    ];

    const updates = [];
    const values = [];

    // If setting as default, clear others
    if (data.is_default !== undefined && Number(data.is_default) === 1) {
      await pool.query(`UPDATE bank_account_master SET is_default = 0 WHERE id != ?`, [id]);
    }

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(data[field]);
      }
    }

    if (updates.length === 0) {
      return this.getById(id);
    }

    values.push(id);
    const query = `UPDATE bank_account_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await pool.query(query, values);

    return this.getById(id);
  }

  /**
   * Delete bank account
   */
  static async delete(id) {
    const [result] = await pool.query(`DELETE FROM bank_account_master WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle status (active / inactive)
   */
  static async toggleStatus(id, status = null) {
    if (status !== null && status !== undefined) {
      await pool.query(`UPDATE bank_account_master SET status = ?, updated_at = NOW() WHERE id = ?`, [
        Number(status) ? 1 : 0,
        id,
      ]);
    } else {
      await pool.query(
        `UPDATE bank_account_master SET status = IF(status = 1, 0, 1), updated_at = NOW() WHERE id = ?`,
        [id]
      );
    }
    return this.getById(id);
  }

  /**
   * Set account as primary default
   */
  static async setDefault(id) {
    await pool.query(`UPDATE bank_account_master SET is_default = 0 WHERE is_default = 1`);
    await pool.query(`UPDATE bank_account_master SET is_default = 1, status = 1, updated_at = NOW() WHERE id = ?`, [id]);
    return this.getById(id);
  }
}

module.exports = BankAccountMasterModel;
