const { pool } = require('../config/db.config');
const CapacityUnitMasterModel = require('./capacityUnitMaster.model');
const { parsePagination, buildPagination } = require('../utils/pagination.util');

class StorageMasterModel {
  /**
   * Helper to resolve unit ID from unit code string or numeric ID
   */
  static async resolveUnitId(unitIdOrCode) {
    if (!unitIdOrCode) return null;

    if (!isNaN(unitIdOrCode)) {
      return parseInt(unitIdOrCode, 10);
    }

    const unit = await CapacityUnitMasterModel.getByCode(String(unitIdOrCode));
    return unit ? unit.id : null;
  }

  /**
   * Fetch a page of storage plans with joined capacity unit details
   * Returns { plans, pagination, counts }
   */
  static async getAll({ search = '', status = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    let conditions = ['sm.status IN (1, 2)'];
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
      ORDER BY total_capacity_mb ASC, sm.id ASC
      LIMIT ? OFFSET ?
    `;
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM storage_master sm
      JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
      ${where}
    `;

    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(query, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      StorageMasterModel.getCounts(),
    ]);

    return {
      plans: rows,
      pagination: buildPagination(countRow.total, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Global (unfiltered) storage plan counts for summary metric cards
   */
  static async getCounts() {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0) AS inactive
      FROM storage_master
      WHERE status IN (1, 2)
    `);
    const total = Number(row.total) || 0;
    const active = Number(row.active) || 0;
    const inactive = Number(row.inactive) || 0;
    return { total, active, inactive };
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
      WHERE sm.id = ? AND sm.status IN (1, 2)
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
        parseInt(status, 10) === 2 ? 2 : 1,
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
    const query = `UPDATE storage_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND status != 4`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Soft delete a storage plan (status = 4)
   */
  static async delete(id) {
    const [result] = await pool.query(
      'UPDATE storage_master SET status = 4, updated_at = NOW() WHERE id = ? AND status != 4',
      [id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Toggle active/inactive status (1 = Active, 2 = Inactive)
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE storage_master SET status = ?, updated_at = NOW() WHERE id = ? AND status != 4',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Fetch paginated list of schools/users who purchased Storage Plans
   * Returns { buyers, pagination, counts }
   */
  static async getBuyers({ search = '', status = '', storage_plan_id = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      conditions.push('sso.order_status = ?');
      params.push(status.trim().toLowerCase());
    }

    if (storage_plan_id && String(storage_plan_id).trim() && storage_plan_id !== 'all') {
      conditions.push('sso.storage_plan_id = ?');
      params.push(parseInt(storage_plan_id, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(`(
        sso.order_no LIKE ? OR
        sso.payment_transaction_id LIKE ? OR
        s.school_name LIKE ? OR
        s.school_code LIKE ? OR
        s.email LIKE ? OR
        s.phone_number LIKE ? OR
        school_admin.admin_name LIKE ? OR
        school_admin.admin_email LIKE ? OR
        school_admin.admin_phone LIKE ? OR
        stm.plan_name LIKE ? OR
        cu.unit_code LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term, term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseJoins = `
      FROM school_storage_orders sso
      JOIN storage_master stm ON sso.storage_plan_id = stm.id
      JOIN capacity_unit_master cu ON stm.capacity_unit_id = cu.id
      JOIN school_master s ON sso.school_id = s.id
      LEFT JOIN (
        SELECT um1.school_id,
               um1.id AS admin_user_id,
               TRIM(CONCAT_WS(' ', um1.first_name, um1.last_name)) AS admin_name,
               um1.email AS admin_email,
               um1.phone AS admin_phone
        FROM user_master um1
        INNER JOIN (
          SELECT school_id, MIN(id) AS min_id
          FROM user_master
          WHERE admin_type = 1
          GROUP BY school_id
        ) um2 ON um1.id = um2.min_id
      ) school_admin ON s.id = school_admin.school_id
      LEFT JOIN (
        SELECT ss1.school_id,
               ss1.id AS base_subscription_id,
               ss1.plan_id AS base_plan_id,
               ss1.status AS base_subscription_status,
               ss1.start_date AS base_start_date,
               ss1.end_date AS base_end_date,
               sp.plan_name AS base_plan_name,
               sp.plan_code AS base_plan_code,
               sp.billing_cycle AS base_billing_cycle
        FROM school_subscriptions ss1
        INNER JOIN (
          SELECT school_id, MAX(id) AS max_id
          FROM school_subscriptions
          GROUP BY school_id
        ) ss2 ON ss1.id = ss2.max_id
        LEFT JOIN subscription_plans sp ON ss1.plan_id = sp.id
      ) base_sub ON s.id = base_sub.school_id
    `;

    const selectQuery = `
      SELECT
        sso.id,
        sso.order_no,
        sso.school_id,
        sso.storage_plan_id,
        sso.billing_cycle,
        sso.quantity,
        sso.unit_price,
        sso.total_amount,
        sso.payment_transaction_id,
        sso.order_status,
        sso.start_date,
        sso.end_date,
        sso.remarks,
        sso.created_at,
        sso.updated_at,
        stm.plan_name AS storage_plan_name,
        stm.storage_capacity,
        cu.unit_code,
        cu.unit_name,
        stm.monthly_price,
        stm.annual_price,
        s.school_name,
        s.school_code,
        s.email AS school_email,
        s.phone_number AS school_phone,
        s.address AS school_address,
        school_admin.admin_user_id,
        school_admin.admin_name,
        COALESCE(school_admin.admin_email, s.email) AS admin_email,
        COALESCE(school_admin.admin_phone, s.phone_number) AS admin_phone,
        base_sub.base_subscription_id,
        base_sub.base_plan_id,
        base_sub.base_plan_name,
        base_sub.base_plan_code,
        base_sub.base_billing_cycle,
        base_sub.base_subscription_status,
        base_sub.base_start_date,
        base_sub.base_end_date
      ${baseJoins}
      ${where}
      ORDER BY sso.id DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      ${baseJoins}
      ${where}
    `;

    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(selectQuery, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      StorageMasterModel.getBuyerCounts(),
    ]);

    return {
      buyers: rows,
      pagination: buildPagination(countRow?.total || 0, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Global counts for Storage Plan Buyers KPI summary cards
   */
  static async getBuyerCounts() {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(quantity), 0) AS total_quantity,
        COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN order_status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
        COALESCE(SUM(CASE WHEN order_status = 'expired' THEN 1 ELSE 0 END), 0) AS expired_count,
        COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
      FROM school_storage_orders
    `);
    return {
      total_orders: Number(row?.total_orders || 0),
      total_quantity: Number(row?.total_quantity || 0),
      total_revenue: parseFloat(row?.total_revenue || 0),
      pending_count: Number(row?.pending_count || 0),
      active_count: Number(row?.active_count || 0),
      expired_count: Number(row?.expired_count || 0),
      cancelled_count: Number(row?.cancelled_count || 0),
    };
  }

  /**
   * Get single storage purchase order by ID
   */
  static async getBuyerOrderById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM school_storage_orders WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Update storage plan buyer order status / dates / remarks
   */
  static async updateBuyerOrder(id, data) {
    const updates = [];
    const params = [];

    if (data.order_status !== undefined) {
      updates.push('order_status = ?');
      params.push(String(data.order_status).trim().toLowerCase());
    }
    if (data.start_date !== undefined) {
      updates.push('start_date = ?');
      params.push(data.start_date || null);
    }
    if (data.end_date !== undefined) {
      updates.push('end_date = ?');
      params.push(data.end_date || null);
    }
    if (data.remarks !== undefined) {
      updates.push('remarks = ?');
      params.push(data.remarks ? String(data.remarks).trim() : null);
    }

    if (updates.length === 0) return false;

    params.push(id);
    const [result] = await pool.query(
      `UPDATE school_storage_orders SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );
    return result.affectedRows > 0;
  }
}

module.exports = StorageMasterModel;
