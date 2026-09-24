const { pool } = require('../config/db.config');
const CapacityUnitMasterModel = require('./capacityUnitMaster.model');

class StorageMasterModel {
  /**
   * Helper to resolve unit ID from unit code string or numeric ID
   */
  static async resolveUnitId(unitIdOrCode) {
    if (!unitIdOrCode) {
      // Default to GB
      const gb = await CapacityUnitMasterModel.getByCode('GB');
      return gb ? gb.id : 1;
    }

    if (!isNaN(unitIdOrCode)) {
      return parseInt(unitIdOrCode, 10);
    }

    const unit = await CapacityUnitMasterModel.getByCode(String(unitIdOrCode));
    if (unit) return unit.id;

    // Default to GB if not found
    const gb = await CapacityUnitMasterModel.getByCode('GB');
    return gb ? gb.id : 1;
  }

  /**
   * Fetch all storage plans with joined capacity unit details
   */
  static async getAll({ search = '', status = '' } = {}) {
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('sm.status = ?');
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      conditions.push('(sm.plan_name LIKE ? OR sm.description LIKE ? OR cu.unit_code LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT 
        sm.id,
        sm.plan_name,
        sm.storage_capacity,
        sm.capacity_unit_id,
        cu.unit_code,
        cu.unit_name,
        cu.factor_in_mb,
        (sm.storage_capacity * cu.factor_in_mb) AS total_capacity_mb,
        sm.monthly_price,
        sm.annual_price,
        sm.description,
        sm.status,
        sm.created_at,
        sm.updated_at
      FROM storage_master sm
      JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
      ${where}
      ORDER BY total_capacity_mb ASC
    `;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Fetch all active storage plans for public/customer selection
   */
  static async getActivePlans() {
    const query = `
      SELECT 
        sm.id,
        sm.plan_name,
        sm.storage_capacity,
        sm.capacity_unit_id,
        cu.unit_code,
        cu.unit_name,
        cu.factor_in_mb,
        (sm.storage_capacity * cu.factor_in_mb) AS total_capacity_mb,
        sm.monthly_price,
        sm.annual_price,
        sm.description,
        sm.status,
        sm.created_at,
        sm.updated_at
      FROM storage_master sm
      JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
      WHERE sm.status = 1
      ORDER BY total_capacity_mb ASC
    `;
    const [rows] = await pool.query(query);
    return rows;
  }

  /**
   * Get single storage plan by ID with joined capacity unit
   */
  static async getById(id) {
    const query = `
      SELECT 
        sm.id,
        sm.plan_name,
        sm.storage_capacity,
        sm.capacity_unit_id,
        cu.unit_code,
        cu.unit_name,
        cu.factor_in_mb,
        (sm.storage_capacity * cu.factor_in_mb) AS total_capacity_mb,
        sm.monthly_price,
        sm.annual_price,
        sm.description,
        sm.status,
        sm.created_at,
        sm.updated_at
      FROM storage_master sm
      JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
      WHERE sm.id = ?
      LIMIT 1
    `;
    const [rows] = await pool.query(query, [id]);
    return rows[0] || null;
  }

  /**
   * Create a new storage master plan
   */
  static async create({
    plan_name,
    storage_capacity,
    capacity_unit_id,
    capacity_unit,
    monthly_price = 0,
    annual_price = 0,
    description = '',
    status = 1,
  }) {
    const resolvedUnitId = await this.resolveUnitId(capacity_unit_id || capacity_unit);

    const [result] = await pool.query(
      `INSERT INTO storage_master 
       (plan_name, storage_capacity, capacity_unit_id, monthly_price, annual_price, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        plan_name.trim(),
        parseInt(storage_capacity, 10) || 0,
        resolvedUnitId,
        parseFloat(monthly_price) || 0,
        parseFloat(annual_price) || 0,
        description || '',
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update an existing storage plan
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.plan_name !== undefined) {
      updates.push('plan_name = ?');
      params.push(data.plan_name.trim());
    }
    if (data.storage_capacity !== undefined) {
      updates.push('storage_capacity = ?');
      params.push(parseInt(data.storage_capacity, 10) || 0);
    }
    if (data.capacity_unit_id !== undefined || data.capacity_unit !== undefined) {
      const resolvedId = await this.resolveUnitId(data.capacity_unit_id || data.capacity_unit);
      updates.push('capacity_unit_id = ?');
      params.push(resolvedId);
    }
    if (data.monthly_price !== undefined) {
      updates.push('monthly_price = ?');
      params.push(parseFloat(data.monthly_price) || 0);
    }
    if (data.annual_price !== undefined) {
      updates.push('annual_price = ?');
      params.push(parseFloat(data.annual_price) || 0);
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
    const query = `UPDATE storage_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete a storage plan
   */
  static async delete(id) {
    const [result] = await pool.query('DELETE FROM storage_master WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle active/inactive status
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE storage_master SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = StorageMasterModel;
