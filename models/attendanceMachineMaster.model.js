const { pool } = require('../config/db.config');
const { parsePagination, buildPagination } = require('../utils/pagination.util');

class AttendanceMachineMasterModel {
  /**
   * Ensure school_attendance_machines has order-tracking columns and backfill existing rows
   */
  static async initTable() {
    try {
      const [cols] = await pool.query('SHOW COLUMNS FROM school_attendance_machines');
      const existingCols = new Set(cols.map((c) => c.Field));

      const alterParts = [];
      if (!existingCols.has('order_no')) {
        alterParts.push('ADD COLUMN order_no VARCHAR(100) DEFAULT NULL AFTER id');
      }
      if (!existingCols.has('quantity')) {
        alterParts.push('ADD COLUMN quantity INT NOT NULL DEFAULT 1 AFTER machine_master_id');
      }
      if (!existingCols.has('unit_price')) {
        alterParts.push('ADD COLUMN unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER quantity');
      }
      if (!existingCols.has('total_amount')) {
        alterParts.push('ADD COLUMN total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER unit_price');
      }
      if (!existingCols.has('order_status')) {
        alterParts.push("ADD COLUMN order_status ENUM('pending','approved','dispatched','delivered','cancelled') NOT NULL DEFAULT 'pending' AFTER status");
      }
      if (!existingCols.has('payment_transaction_id')) {
        alterParts.push('ADD COLUMN payment_transaction_id VARCHAR(150) DEFAULT NULL AFTER order_status');
      }
      if (!existingCols.has('shipping_address')) {
        alterParts.push('ADD COLUMN shipping_address TEXT DEFAULT NULL AFTER payment_transaction_id');
      }
      if (!existingCols.has('remarks')) {
        alterParts.push('ADD COLUMN remarks TEXT DEFAULT NULL AFTER shipping_address');
      }

      if (alterParts.length > 0) {
        await pool.query(`ALTER TABLE school_attendance_machines ${alterParts.join(', ')}`);
      }

      // Backfill order_no, unit_price, total_amount, and shipping_address for existing records
      await pool.query(`
        UPDATE school_attendance_machines sam
        JOIN attendance_machine_master amm ON sam.machine_master_id = amm.id
        LEFT JOIN school_master sm ON sam.school_id = sm.id
        SET
          sam.order_no = COALESCE(sam.order_no, CONCAT('MACH_', sam.school_id, '_', sam.id)),
          sam.unit_price = CASE WHEN sam.unit_price = 0 THEN amm.unit_price ELSE sam.unit_price END,
          sam.total_amount = CASE WHEN sam.total_amount = 0 THEN (amm.unit_price * sam.quantity) ELSE sam.total_amount END,
          sam.shipping_address = COALESCE(sam.shipping_address, sm.address)
        WHERE sam.order_no IS NULL OR sam.unit_price = 0
      `);
    } catch (error) {
      console.error('Error initializing school_attendance_machines columns:', error.message);
    }
  }

  /**
   * Fetch a page of attendance machines (with search, status, machine_type, brand filters)
   * Returns { machines, pagination, counts }
   */
  static async getAll({ search = '', status = '', machine_type = '', brand = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (machine_type && machine_type.trim()) {
      conditions.push('machine_type = ?');
      params.push(machine_type.trim());
    }

    if (brand && brand.trim()) {
      conditions.push('brand = ?');
      params.push(brand.trim());
    }

    if (search && search.trim()) {
      conditions.push('(machine_name LIKE ? OR model_number LIKE ? OR brand LIKE ? OR connectivity LIKE ? OR specifications LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT 
        id,
        machine_name,
        model_number,
        brand,
        machine_type,
        connectivity,
        user_capacity,
        log_capacity,
        push_protocol,
        unit_price,
        amc_price,
        machine_image,
        specifications,
        status,
        created_at,
        updated_at
      FROM attendance_machine_master
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM attendance_machine_master ${where}`;

    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(query, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      AttendanceMachineMasterModel.getCounts(),
    ]);

    return {
      machines: rows,
      pagination: buildPagination(countRow.total, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Global (unfiltered) attendance machine counts for summary metric cards
   */
  static async getCounts() {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active
      FROM attendance_machine_master
    `);
    const total = Number(row.total) || 0;
    const active = Number(row.active) || 0;
    return { total, active, inactive: total - active };
  }

  /**
   * Fetch only active attendance machines
   */
  static async getActive() {
    const [rows] = await pool.query(`
      SELECT 
        id,
        machine_name,
        model_number,
        brand,
        machine_type,
        connectivity,
        user_capacity,
        log_capacity,
        push_protocol,
        unit_price,
        amc_price,
        machine_image,
        specifications,
        status,
        created_at
      FROM attendance_machine_master
      WHERE status = 1
      ORDER BY machine_name ASC
    `);
    return rows;
  }

  /**
   * Get single machine by ID
   */
  static async getById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM attendance_machine_master WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Get single machine by model_number
   */
  static async getByModelNumber(modelNumber) {
    if (!modelNumber) return null;
    const [rows] = await pool.query(
      'SELECT * FROM attendance_machine_master WHERE model_number = ? LIMIT 1',
      [modelNumber.trim()]
    );
    return rows[0] || null;
  }

  /**
   * Create a new attendance machine item
   */
  static async create({
    machine_name,
    model_number,
    brand,
    machine_type = 'hybrid',
    connectivity = 'LAN, Wi-Fi',
    user_capacity = 1000,
    log_capacity = 100000,
    push_protocol = 'Cloud Push',
    unit_price = 0,
    amc_price = 0,
    machine_image = null,
    specifications = null,
    status = 1,
  }) {
    const [result] = await pool.query(
      `INSERT INTO attendance_machine_master 
       (machine_name, model_number, brand, machine_type, connectivity, user_capacity, log_capacity, push_protocol, unit_price, amc_price, machine_image, specifications, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        machine_name.trim(),
        model_number.trim().toUpperCase(),
        brand.trim(),
        machine_type || 'hybrid',
        connectivity ? connectivity.trim() : 'LAN, Wi-Fi',
        parseInt(user_capacity, 10) || 1000,
        parseInt(log_capacity, 10) || 100000,
        push_protocol ? push_protocol.trim() : 'Cloud Push',
        parseFloat(unit_price) || 0.00,
        parseFloat(amc_price) || 0.00,
        machine_image || null,
        specifications || '',
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update an attendance machine item
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.machine_name !== undefined) {
      updates.push('machine_name = ?');
      params.push(data.machine_name.trim());
    }
    if (data.model_number !== undefined) {
      updates.push('model_number = ?');
      params.push(data.model_number.trim().toUpperCase());
    }
    if (data.brand !== undefined) {
      updates.push('brand = ?');
      params.push(data.brand.trim());
    }
    if (data.machine_type !== undefined) {
      updates.push('machine_type = ?');
      params.push(data.machine_type);
    }
    if (data.connectivity !== undefined) {
      updates.push('connectivity = ?');
      params.push(data.connectivity ? data.connectivity.trim() : null);
    }
    if (data.user_capacity !== undefined) {
      updates.push('user_capacity = ?');
      params.push(parseInt(data.user_capacity, 10) || 0);
    }
    if (data.log_capacity !== undefined) {
      updates.push('log_capacity = ?');
      params.push(parseInt(data.log_capacity, 10) || 0);
    }
    if (data.push_protocol !== undefined) {
      updates.push('push_protocol = ?');
      params.push(data.push_protocol ? data.push_protocol.trim() : null);
    }
    if (data.unit_price !== undefined) {
      updates.push('unit_price = ?');
      params.push(parseFloat(data.unit_price) || 0);
    }
    if (data.amc_price !== undefined) {
      updates.push('amc_price = ?');
      params.push(parseFloat(data.amc_price) || 0);
    }
    if (data.machine_image !== undefined) {
      updates.push('machine_image = ?');
      params.push(data.machine_image);
    }
    if (data.specifications !== undefined) {
      updates.push('specifications = ?');
      params.push(data.specifications);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(data.status, 10));
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE attendance_machine_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete an attendance machine
   */
  static async delete(id) {
    // Check if machine is linked to any schools
    const [schoolMachines] = await pool.query(
      'SELECT COUNT(*) AS count FROM school_attendance_machines WHERE machine_master_id = ?',
      [id]
    );
    if (schoolMachines[0].count > 0) {
      throw new Error('Cannot delete this machine model because it is assigned to school campuses. Please deactivate it instead.');
    }

    const [result] = await pool.query('DELETE FROM attendance_machine_master WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle status
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE attendance_machine_master SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Fetch paginated list of schools/users who purchased Attendance Machines
   * Returns { buyers, pagination, counts }
   */
  static async getBuyers({ search = '', status = '', machine_id = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      if (status === '1' || status === '0') {
        conditions.push('sam.status = ?');
        params.push(parseInt(status, 10));
      } else {
        conditions.push('sam.order_status = ?');
        params.push(status.trim().toLowerCase());
      }
    }

    if (machine_id && String(machine_id).trim() && machine_id !== 'all') {
      conditions.push('sam.machine_master_id = ?');
      params.push(parseInt(machine_id, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(`(
        sam.order_no LIKE ? OR
        sam.device_serial_number LIKE ? OR
        s.school_name LIKE ? OR
        s.school_code LIKE ? OR
        s.email LIKE ? OR
        s.phone_number LIKE ? OR
        school_admin.admin_name LIKE ? OR
        school_admin.admin_email LIKE ? OR
        school_admin.admin_phone LIKE ? OR
        amm.machine_name LIKE ? OR
        amm.model_number LIKE ? OR
        amm.brand LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term, term, term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseJoins = `
      FROM school_attendance_machines sam
      JOIN attendance_machine_master amm ON sam.machine_master_id = amm.id
      JOIN school_master s ON sam.school_id = s.id
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
        sam.id,
        sam.order_no,
        sam.school_id,
        sam.branch_id,
        sam.machine_master_id,
        sam.quantity,
        sam.unit_price,
        sam.total_amount,
        sam.device_serial_number,
        sam.device_location,
        sam.ip_address,
        sam.port,
        sam.status,
        sam.order_status,
        sam.payment_transaction_id,
        COALESCE(sam.shipping_address, s.address) AS shipping_address,
        sam.remarks,
        sam.last_sync_at,
        sam.created_at,
        sam.updated_at,
        amm.machine_name,
        amm.model_number,
        amm.brand,
        amm.machine_type,
        amm.connectivity,
        amm.machine_image,
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
      ORDER BY sam.id DESC
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
      AttendanceMachineMasterModel.getBuyerCounts(),
    ]);

    return {
      buyers: rows,
      pagination: buildPagination(countRow?.total || 0, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Global counts for Attendance Machine Buyers KPI summary cards
   */
  static async getBuyerCounts() {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(quantity), 0) AS total_quantity,
        COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN order_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
        COALESCE(SUM(CASE WHEN order_status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
        COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count,
        COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
        COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_devices
      FROM school_attendance_machines
    `);
    return {
      total_orders: Number(row?.total_orders || 0),
      total_quantity: Number(row?.total_quantity || 0),
      total_revenue: parseFloat(row?.total_revenue || 0),
      pending_count: Number(row?.pending_count || 0),
      approved_count: Number(row?.approved_count || 0),
      dispatched_count: Number(row?.dispatched_count || 0),
      delivered_count: Number(row?.delivered_count || 0),
      cancelled_count: Number(row?.cancelled_count || 0),
      active_devices: Number(row?.active_devices || 0),
    };
  }

  /**
   * Get a single attendance machine purchase/allocation by ID
   */
  static async getBuyerOrderById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM school_attendance_machines WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Update attendance machine buyer order / device details
   */
  static async updateBuyerOrder(id, data) {
    const updates = [];
    const params = [];

    if (data.order_status !== undefined) {
      updates.push('order_status = ?');
      params.push(String(data.order_status).trim().toLowerCase());
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(data.status, 10) === 1 ? 1 : 0);
    }
    if (data.device_serial_number !== undefined && String(data.device_serial_number).trim() !== '') {
      updates.push('device_serial_number = ?');
      params.push(String(data.device_serial_number).trim());
    }
    if (data.device_location !== undefined) {
      updates.push('device_location = ?');
      params.push(data.device_location ? String(data.device_location).trim() : null);
    }
    if (data.ip_address !== undefined) {
      updates.push('ip_address = ?');
      params.push(data.ip_address ? String(data.ip_address).trim() : null);
    }
    if (data.port !== undefined) {
      updates.push('port = ?');
      params.push(data.port !== null && data.port !== '' ? parseInt(data.port, 10) : null);
    }
    if (data.shipping_address !== undefined) {
      updates.push('shipping_address = ?');
      params.push(data.shipping_address ? String(data.shipping_address).trim() : null);
    }
    if (data.remarks !== undefined) {
      updates.push('remarks = ?');
      params.push(data.remarks ? String(data.remarks).trim() : null);
    }

    if (updates.length === 0) return false;

    params.push(id);
    const [result] = await pool.query(
      `UPDATE school_attendance_machines SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );
    return result.affectedRows > 0;
  }
}

module.exports = AttendanceMachineMasterModel;
