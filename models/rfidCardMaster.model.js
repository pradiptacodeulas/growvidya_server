const { pool } = require('../config/db.config');
const SubscriptionSchemaModel = require('./subscriptionSchema.model');
const { parsePagination, buildPagination } = require('../utils/pagination.util');

class RfidCardMasterModel {
  /**
   * Fetch a page of RFID cards (with search, status and card_type filters)
   * Returns { cards, pagination, counts }
   */
  static async getAll({ search = '', status = '', card_type = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    let conditions = ['status IN (1, 2)'];
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
        rfid_image,
        description,
        status,
        created_at,
        updated_at
      FROM rfid_card_master
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM rfid_card_master ${where}`;

    await SubscriptionSchemaModel.initTable();
    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(query, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      RfidCardMasterModel.getCounts(),
    ]);

    return {
      cards: rows,
      pagination: buildPagination(countRow.total, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Global (unfiltered) RFID card counts for summary metric cards
   */
  static async getCounts() {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0) AS inactive
      FROM rfid_card_master
      WHERE status IN (1, 2)
    `);
    const total = Number(row.total) || 0;
    const active = Number(row.active) || 0;
    const inactive = Number(row.inactive) || 0;
    return { total, active, inactive };
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
        rfid_image,
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
      'SELECT * FROM rfid_card_master WHERE id = ? AND status IN (1, 2) LIMIT 1',
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
      'SELECT * FROM rfid_card_master WHERE card_code = ? AND status IN (1, 2) LIMIT 1',
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
    card_type = null,
    frequency = null,
    read_range = null,
    unit_price = 0,
    min_order_qty = 1,
    card_image = null,
    rfid_image = null,
    description = null,
    status = 1,
  }) {
    const finalImage = card_image || rfid_image || null;
    const [result] = await pool.query(
      `INSERT INTO rfid_card_master 
       (card_name, card_code, card_type, frequency, read_range, unit_price, min_order_qty, card_image, rfid_image, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        card_name.trim(),
        card_code.trim().toUpperCase(),
        card_type || null,
        frequency ? frequency.trim() : null,
        read_range ? read_range.trim() : null,
        parseFloat(unit_price) || 0.00,
        parseInt(min_order_qty, 10) || 1,
        finalImage,
        finalImage,
        description || '',
        parseInt(status, 10) === 2 ? 2 : 1,
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
    if (data.card_image !== undefined || data.rfid_image !== undefined) {
      const img = data.card_image !== undefined ? data.card_image : data.rfid_image;
      updates.push('card_image = ?', 'rfid_image = ?');
      params.push(img, img);
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
    const query = `UPDATE rfid_card_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND status != 4`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Soft delete an RFID card item (status = 4)
   */
  static async delete(id) {
    const [result] = await pool.query(
      'UPDATE rfid_card_master SET status = 4, updated_at = NOW() WHERE id = ? AND status != 4',
      [id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Toggle status (1 = Active, 2 = Inactive)
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE rfid_card_master SET status = ?, updated_at = NOW() WHERE id = ? AND status != 4',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Fetch paginated list of schools/users who ordered RFID Cards
   * Returns { buyers, pagination, counts }
   */
  static async getBuyers({ search = '', status = '', rfid_card_id = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      conditions.push('sro.order_status = ?');
      params.push(status.trim().toLowerCase());
    }

    if (rfid_card_id && String(rfid_card_id).trim() && rfid_card_id !== 'all') {
      conditions.push('sro.rfid_card_id = ?');
      params.push(parseInt(rfid_card_id, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(`(
        sro.order_no LIKE ? OR
        s.school_name LIKE ? OR
        s.school_code LIKE ? OR
        s.email LIKE ? OR
        s.phone_number LIKE ? OR
        school_admin.admin_name LIKE ? OR
        school_admin.admin_email LIKE ? OR
        school_admin.admin_phone LIKE ? OR
        rcm.card_name LIKE ? OR
        rcm.card_code LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseJoins = `
      FROM school_rfid_orders sro
      JOIN rfid_card_master rcm ON sro.rfid_card_id = rcm.id
      JOIN school_master s ON sro.school_id = s.id
      LEFT JOIN subscription_payment_orders spo ON sro.payment_order_id = spo.id
      LEFT JOIN bank_account_master bam ON spo.bank_account_id = bam.id
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
        sro.id,
        sro.order_no,
        sro.school_id,
        sro.rfid_card_id,
        sro.quantity,
        sro.unit_price,
        sro.total_amount,
        sro.order_status,
        sro.payment_transaction_id,
        sro.payment_order_id,
        spo.order_no AS payment_order_no,
        spo.order_type AS payment_order_type,
        spo.payment_method,
        spo.status AS payment_order_status,
        spo.utr_number,
        spo.grand_total AS payment_order_total,
        spo.bank_account_id,
        bam.bank_name AS company_bank_name,
        bam.account_title AS company_bank_title,
        bam.beneficiary_name AS company_bank_beneficiary,
        bam.account_number AS company_account_number,
        bam.ifsc_code AS company_ifsc_code,
        COALESCE(sro.shipping_address, s.address) AS shipping_address,
        sro.remarks,
        sro.created_at,
        sro.updated_at,
        rcm.card_name,
        rcm.card_code,
        rcm.card_type,
        rcm.frequency,
        rcm.read_range,
        COALESCE(rcm.card_image, rcm.rfid_image) AS card_image,
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
      ORDER BY sro.id DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      ${baseJoins}
      ${where}
    `;

    await SubscriptionSchemaModel.initTable();
    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(selectQuery, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      RfidCardMasterModel.getBuyerCounts(),
    ]);

    return {
      buyers: rows,
      pagination: buildPagination(countRow?.total || 0, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Global counts for RFID Card Buyers KPI summary cards
   */
  static async getBuyerCounts() {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(quantity), 0) AS total_cards_ordered,
        COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN order_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
        COALESCE(SUM(CASE WHEN order_status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
        COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count,
        COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
      FROM school_rfid_orders
    `);
    return {
      total_orders: Number(row?.total_orders || 0),
      total_cards_ordered: Number(row?.total_cards_ordered || 0),
      total_revenue: parseFloat(row?.total_revenue || 0),
      pending_count: Number(row?.pending_count || 0),
      approved_count: Number(row?.approved_count || 0),
      dispatched_count: Number(row?.dispatched_count || 0),
      delivered_count: Number(row?.delivered_count || 0),
      cancelled_count: Number(row?.cancelled_count || 0),
    };
  }

  /**
   * Get single RFID order by ID
   */
  static async getBuyerOrderById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM school_rfid_orders WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Update RFID card buyer order status / shipping address / remarks
   */
  static async updateBuyerOrder(id, data) {
    const existing = await this.getBuyerOrderById(id);
    if (!existing) return false;

    const updates = [];
    const params = [];
    let normalizedStatus = null;

    if (data.order_status !== undefined) {
      normalizedStatus = String(data.order_status).trim().toLowerCase();
      updates.push('order_status = ?');
      params.push(normalizedStatus);
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

    await SubscriptionSchemaModel.initTable();

    // Block marking hardware as approved/dispatched/delivered until Payment Order UTR is verified ('paid')
    if (existing.payment_order_id && ['approved', 'dispatched', 'delivered'].includes(normalizedStatus)) {
      const [ordRows] = await pool.query(
        'SELECT id, order_no, order_type, status FROM subscription_payment_orders WHERE id = ? LIMIT 1',
        [existing.payment_order_id]
      );
      const ord = ordRows[0];
      if (ord && ord.status !== 'paid') {
        const err = new Error(
          `Cannot mark RFID card order as "${normalizedStatus}" while Payment Order ${ord.order_no} is "${ord.status}". Please verify the UTR payment order first.`
        );
        err.statusCode = 400;
        err.code = 'PAYMENT_UNVERIFIED';
        throw err;
      }
    }

    params.push(id);
    const [result] = await pool.query(
      `UPDATE school_rfid_orders SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    if (existing.payment_order_id && normalizedStatus === 'cancelled') {
      try {
        const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');
        await SubscriptionFulfillmentService.syncStandaloneAddonCancellation({
          orderId: existing.payment_order_id,
          reason: data.remarks || 'Cancelled via RFID Card Buyers',
        });
      } catch (e) {
        console.error('[RfidCardMasterModel.updateBuyerOrder cancellation sync error]:', e.message);
      }
    }

    return result.affectedRows > 0;
  }
}

module.exports = RfidCardMasterModel;
