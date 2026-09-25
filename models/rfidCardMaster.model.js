const { pool } = require('../config/db.config');

class RfidCardMasterModel {
  /**
   * Fetch all RFID cards (with search and status filter)
   */
  static async getAll({ search = '', status = '', card_type = '' } = {}) {
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (card_type && card_type.trim()) {
      conditions.push('card_type = ?');
      params.push(card_type.trim());
    }

    if (search && search.trim()) {
      conditions.push('(card_name LIKE ? OR card_code LIKE ? OR frequency LIKE ? OR description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT 
        id,
        card_name,
        card_code,
        card_type,
        frequency,
        read_range,
        unit_price,
        min_order_qty,
        card_image,
        description,
        status,
        created_at,
        updated_at
      FROM rfid_card_master
      ${where}
      ORDER BY id DESC
    `;

    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Fetch only active RFID cards
   */
  static async getActive() {
    const [rows] = await pool.query(`
      SELECT 
        id,
        card_name,
        card_code,
        card_type,
        frequency,
        read_range,
        unit_price,
        min_order_qty,
        card_image,
        description,
        status,
        created_at
      FROM rfid_card_master
      WHERE status = 1
      ORDER BY card_name ASC
    `);
    return rows;
  }

  /**
   * Get single RFID card by ID
   */
  static async getById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM rfid_card_master WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Get single RFID card by card_code / SKU
   */
  static async getByCode(code) {
    if (!code) return null;
    const [rows] = await pool.query(
      'SELECT * FROM rfid_card_master WHERE card_code = ? LIMIT 1',
      [code.trim()]
    );
    return rows[0] || null;
  }

  /**
   * Create a new RFID Card item
   */
  static async create({
    card_name,
    card_code,
    card_type = 'pvc_card',
    frequency = null,
    read_range = null,
    unit_price = 0,
    min_order_qty = 1,
    card_image = null,
    description = null,
    status = 1,
  }) {
    const [result] = await pool.query(
      `INSERT INTO rfid_card_master 
       (card_name, card_code, card_type, frequency, read_range, unit_price, min_order_qty, card_image, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        card_name.trim(),
        card_code.trim().toUpperCase(),
        card_type || 'pvc_card',
        frequency ? frequency.trim() : null,
        read_range ? read_range.trim() : null,
        parseFloat(unit_price) || 0.00,
        parseInt(min_order_qty, 10) || 1,
        card_image || null,
        description || '',
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update an existing RFID Card item
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.card_name !== undefined) {
      updates.push('card_name = ?');
      params.push(data.card_name.trim());
    }
    if (data.card_code !== undefined) {
      updates.push('card_code = ?');
      params.push(data.card_code.trim().toUpperCase());
    }
    if (data.card_type !== undefined) {
      updates.push('card_type = ?');
      params.push(data.card_type);
    }
    if (data.frequency !== undefined) {
      updates.push('frequency = ?');
      params.push(data.frequency ? data.frequency.trim() : null);
    }
    if (data.read_range !== undefined) {
      updates.push('read_range = ?');
      params.push(data.read_range ? data.read_range.trim() : null);
    }
    if (data.unit_price !== undefined) {
      updates.push('unit_price = ?');
      params.push(parseFloat(data.unit_price) || 0);
    }
    if (data.min_order_qty !== undefined) {
      updates.push('min_order_qty = ?');
      params.push(parseInt(data.min_order_qty, 10) || 1);
    }
    if (data.card_image !== undefined) {
      updates.push('card_image = ?');
      params.push(data.card_image);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(data.status, 10));
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE rfid_card_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete an RFID card item
   */
  static async delete(id) {
    // Check if card is referenced in school_rfid_orders
    const [orders] = await pool.query(
      'SELECT COUNT(*) AS count FROM school_rfid_orders WHERE rfid_card_id = ?',
      [id]
    );
    if (orders[0].count > 0) {
      throw new Error('Cannot delete this RFID card because school orders are associated with it. Please deactivate it instead.');
    }

    const [result] = await pool.query('DELETE FROM rfid_card_master WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle status
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE rfid_card_master SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = RfidCardMasterModel;
