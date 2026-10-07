const { pool } = require('../config/db.config');

/**
 * Rates per sent communication unit (in INR ₹)
 */
const RATES = Object.freeze({
  SMS: 0.2000,   // ₹0.20 per sent SMS
  PUSH: 0.0100,  // ₹0.01 per sent Push notification
});

class NotificationRecordModel {
  static get RATES() {
    return RATES;
  }

  /**
   * Log an SMS notification record
   */
  static async logSms({
    school_id = null,
    branch_id = null,
    recipient_phone,
    message,
    recipient_name = null,
    recipient_role = 'other',
    recipient_id = null,
    category = 'general',
    title = null,
    status = 'pending',
    units_count = 1,
    provider = null,
    provider_message_id = null,
    provider_response = null,
    dlt_template_id = null,
    dlt_entity_id = null,
    sender_id = null,
    sender_role = 'system',
    error_message = null,
  }) {
    const unit_cost = RATES.SMS;
    const total_cost = ['sent', 'delivered'].includes(status) ? unit_cost * Math.max(1, units_count) : 0.0000;
    const sent_at = ['sent', 'delivered'].includes(status) ? new Date() : null;

    const query = `
      INSERT INTO notification_records (
        school_id, branch_id, channel, category, title, message,
        recipient_role, recipient_id, recipient_name, recipient_phone,
        units_count, unit_cost, total_cost, currency, status,
        provider, provider_message_id, provider_response, error_message,
        dlt_template_id, dlt_entity_id, sender_id, sender_role, sent_at
      ) VALUES (?, ?, 'sms', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      school_id,
      branch_id,
      category,
      title,
      message,
      recipient_role,
      recipient_id,
      recipient_name,
      recipient_phone,
      Math.max(1, units_count),
      unit_cost,
      total_cost,
      status,
      provider,
      provider_message_id,
      provider_response ? JSON.stringify(provider_response) : null,
      error_message,
      dlt_template_id,
      dlt_entity_id,
      sender_id,
      sender_role,
      sent_at,
    ]);

    return { id: result.insertId, channel: 'sms', unit_cost, total_cost, status };
  }

  /**
   * Log a Push notification record
   */
  static async logPush({
    school_id = null,
    branch_id = null,
    recipient_device_token = null,
    recipient_device_type = 'all',
    title,
    message,
    payload = null,
    recipient_name = null,
    recipient_role = 'other',
    recipient_id = null,
    category = 'general',
    status = 'pending',
    units_count = 1,
    provider = 'fcm',
    provider_message_id = null,
    provider_response = null,
    sender_id = null,
    sender_role = 'system',
    error_message = null,
  }) {
    const unit_cost = RATES.PUSH;
    const total_cost = ['sent', 'delivered'].includes(status) ? unit_cost * Math.max(1, units_count) : 0.0000;
    const sent_at = ['sent', 'delivered'].includes(status) ? new Date() : null;

    const query = `
      INSERT INTO notification_records (
        school_id, branch_id, channel, category, title, message, payload,
        recipient_role, recipient_id, recipient_name, recipient_device_token, recipient_device_type,
        units_count, unit_cost, total_cost, currency, status,
        provider, provider_message_id, provider_response, error_message,
        sender_id, sender_role, sent_at
      ) VALUES (?, ?, 'push', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      school_id,
      branch_id,
      category,
      title,
      message,
      payload ? JSON.stringify(payload) : null,
      recipient_role,
      recipient_id,
      recipient_name,
      recipient_device_token,
      recipient_device_type,
      Math.max(1, units_count),
      unit_cost,
      total_cost,
      status,
      provider,
      provider_message_id,
      provider_response ? JSON.stringify(provider_response) : null,
      error_message,
      sender_id,
      sender_role,
      sent_at,
    ]);

    return { id: result.insertId, channel: 'push', unit_cost, total_cost, status };
  }

  /**
   * Update status of an existing record (e.g. from gateway webhook callback)
   */
  static async updateStatus(id, {
    status,
    provider_message_id = null,
    provider_response = null,
    error_message = null,
    delivered_at = null,
  }) {
    const updates = ['status = ?'];
    const params = [status];

    if (provider_message_id) {
      updates.push('provider_message_id = ?');
      params.push(provider_message_id);
    }
    if (provider_response) {
      updates.push('provider_response = ?');
      params.push(typeof provider_response === 'string' ? provider_response : JSON.stringify(provider_response));
    }
    if (error_message !== undefined) {
      updates.push('error_message = ?');
      params.push(error_message);
    }
    if (status === 'delivered') {
      updates.push('delivered_at = COALESCE(?, NOW())');
      params.push(delivered_at);
    }

    params.push(id);
    const query = `UPDATE notification_records SET ${updates.join(', ')} WHERE id = ?`;
    await pool.query(query, params);

    return this.getById(id);
  }

  /**
   * Get single notification record by ID
   */
  static async getById(id) {
    const [rows] = await pool.query('SELECT * FROM notification_records WHERE id = ?', [id]);
    return rows[0] || null;
  }

  /**
   * List records with filters and pagination
   */
  static async list({
    school_id = null,
    channel = null,
    category = null,
    status = null,
    recipient_role = null,
    search = '',
    start_date = null,
    end_date = null,
    page = 1,
    limit = 20,
  } = {}) {
    const conditions = [];
    const params = [];

    if (school_id) {
      conditions.push('school_id = ?');
      params.push(parseInt(school_id, 10));
    }
    if (channel && ['sms', 'push'].includes(channel.toLowerCase())) {
      conditions.push('channel = ?');
      params.push(channel.toLowerCase());
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (recipient_role) {
      conditions.push('recipient_role = ?');
      params.push(recipient_role);
    }
    if (start_date) {
      conditions.push('created_at >= ?');
      params.push(`${start_date} 00:00:00`);
    }
    if (end_date) {
      conditions.push('created_at <= ?');
      params.push(`${end_date} 23:59:59`);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push('(recipient_name LIKE ? OR recipient_phone LIKE ? OR title LIKE ? OR message LIKE ?)');
      params.push(term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const [countResult] = await pool.query(`SELECT COUNT(*) AS total FROM notification_records ${where}`, params);
    const total = countResult[0].total;

    const listQuery = `
      SELECT * FROM notification_records
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(listQuery, [...params, parseInt(limit, 10), offset]);

    return {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(total / limit),
      data: rows,
    };
  }

  /**
   * Summary of costs and counts grouped by channel and status
   */
  static async getCostSummary({ school_id = null, start_date = null, end_date = null } = {}) {
    const conditions = [];
    const params = [];

    if (school_id) {
      conditions.push('school_id = ?');
      params.push(parseInt(school_id, 10));
    }
    if (start_date) {
      conditions.push('created_at >= ?');
      params.push(`${start_date} 00:00:00`);
    }
    if (end_date) {
      conditions.push('created_at <= ?');
      params.push(`${end_date} 23:59:59`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        channel,
        COUNT(*) AS total_records,
        SUM(CASE WHEN status IN ('sent', 'delivered') THEN 1 ELSE 0 END) AS total_sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS total_failed,
        SUM(CASE WHEN status IN ('pending', 'queued') THEN 1 ELSE 0 END) AS total_pending,
        SUM(CASE WHEN status IN ('sent', 'delivered') THEN units_count ELSE 0 END) AS billable_units,
        COALESCE(SUM(total_cost), 0.0000) AS total_cost_inr
      FROM notification_records
      ${where}
      GROUP BY channel
    `;

    const [rows] = await pool.query(query, params);

    let smsStats = { total_records: 0, total_sent: 0, total_failed: 0, total_pending: 0, billable_units: 0, total_cost_inr: 0.00 };
    let pushStats = { total_records: 0, total_sent: 0, total_failed: 0, total_pending: 0, billable_units: 0, total_cost_inr: 0.00 };

    for (const r of rows) {
      if (r.channel === 'sms') {
        smsStats = {
          total_records: Number(r.total_records),
          total_sent: Number(r.total_sent),
          total_failed: Number(r.total_failed),
          total_pending: Number(r.total_pending),
          billable_units: Number(r.billable_units),
          total_cost_inr: Number(r.total_cost_inr),
        };
      } else if (r.channel === 'push') {
        pushStats = {
          total_records: Number(r.total_records),
          total_sent: Number(r.total_sent),
          total_failed: Number(r.total_failed),
          total_pending: Number(r.total_pending),
          billable_units: Number(r.billable_units),
          total_cost_inr: Number(r.total_cost_inr),
        };
      }
    }

    const overallTotalCost = Number((smsStats.total_cost_inr + pushStats.total_cost_inr).toFixed(4));

    return {
      rates: RATES,
      sms: smsStats,
      push: pushStats,
      overall: {
        total_records: smsStats.total_records + pushStats.total_records,
        total_sent: smsStats.total_sent + pushStats.total_sent,
        total_failed: smsStats.total_failed + pushStats.total_failed,
        total_cost_inr: overallTotalCost,
        currency: 'INR',
      },
    };
  }
}

module.exports = NotificationRecordModel;
