const { pool } = require('../config/db.config');

class SubscriptionItemModel {
  /**
   * Fetch all items belonging to a subscription plan
   */
  static async getByPlanId(subId, { status = '' } = {}) {
    let conditions = ['sub_id = ?'];
    let params = [subId];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    const query = `
      SELECT 
        id,
        sub_id,
        item_name,
        item_code,
        description,
        status,
        created_at,
        updated_at
      FROM subscription_items
      WHERE ${conditions.join(' AND ')}
      ORDER BY id ASC
    `;

    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Get single item by ID
   */
  static async getById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM subscription_items WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Create a single subscription item / feature
   */
  static async create({
    sub_id,
    item_name,
    item_code = null,
    description = null,
    status = 1,
  }) {
    const [result] = await pool.query(
      `INSERT INTO subscription_items 
       (sub_id, item_name, item_code, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [
        parseInt(sub_id, 10),
        item_name.trim(),
        item_code ? item_code.trim().toUpperCase() : null,
        description || '',
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update an existing subscription item
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.item_name !== undefined) {
      updates.push('item_name = ?');
      params.push(data.item_name.trim());
    }
    if (data.item_code !== undefined) {
      updates.push('item_code = ?');
      params.push(data.item_code ? data.item_code.trim().toUpperCase() : null);
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
    const query = `UPDATE subscription_items SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete a subscription item
   */
  static async delete(id) {
    const [result] = await pool.query('DELETE FROM subscription_items WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle status
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE subscription_items SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Bulk sync / replace items for a subscription plan
   */
  static async syncItemsForPlan(subId, items = []) {
    if (!Array.isArray(items)) return;

    // Delete existing items for clean sync or update
    await pool.query('DELETE FROM subscription_items WHERE sub_id = ?', [subId]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.item_name || !item.item_name.trim()) continue;

      await this.create({
        sub_id: subId,
        item_name: item.item_name,
        item_code: item.item_code,
        description: item.description,
        status: item.status !== undefined ? item.status : 1,
      });
    }
  }
}

module.exports = SubscriptionItemModel;
