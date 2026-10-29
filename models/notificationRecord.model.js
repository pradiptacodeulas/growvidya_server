const { pool } = require('../config/db.config');

let _cachedRates = null;
let _cachedAt = 0;
const RATE_CACHE_TTL_MS = 60 * 1000;

class NotificationRecordModel {
  /**
   * Clear in-memory pricing cache whenever Super Admin updates `notification_pricing_master`
   */
  static invalidateRateCache() {
    _cachedRates = null;
    _cachedAt = 0;
  }

  /**
   * Dynamically resolve per-unit SMS & Push rates strictly from `notification_pricing_master`
   */
  static async getDynamicRates() {
    const now = Date.now();
    if (_cachedRates && now - _cachedAt < RATE_CACHE_TTL_MS) {
      return _cachedRates;
    }

    const rates = { SMS: 0, PUSH: 0 };
    try {
      const [rows] = await pool.query(
        'SELECT channel, unit_price FROM notification_pricing_master WHERE status = 1'
      );
      for (const r of rows) {
        const ch = String(r.channel || '').toUpperCase();
        if (ch === 'SMS' || ch === 'PUSH') {
          rates[ch] = parseFloat(r.unit_price) || 0;
        }
      }
      _cachedRates = rates;
      _cachedAt = now;
    } catch (_) {}

    return rates;
  }

  /**
   * Check whether a school's notification wallet has sufficient prepaid credits
   */
  static async checkWalletCredits(schoolId, channel, requiredUnits = 1) {
    const parsedSchoolId = parseInt(schoolId, 10);
    const ch = String(channel || '').toLowerCase();
    const units = Math.max(1, parseInt(requiredUnits, 10) || 1);
    if (!parsedSchoolId || !['sms', 'push'].includes(ch)) {
      return { allowed: true, balance: 0 };
    }

    const [rows] = await pool.query(
      'SELECT sms_balance, push_balance FROM school_notification_wallets WHERE school_id = ? LIMIT 1',
      [parsedSchoolId]
    );
    const balance = rows.length > 0
      ? parseInt(ch === 'sms' ? rows[0].sms_balance : rows[0].push_balance, 10) || 0
      : 0;

    return {
      allowed: balance >= units,
      balance,
      required: units,
      channel: ch,
    };
  }

  /**
   * Atomically debit sent notification units from `school_notification_wallets` and record in `school_notification_ledger`
   */
  static async debitWalletCredits({
    schoolId,
    channel,
    units = 1,
    unitCost = 0,
    referenceNote = null,
  }) {
    const parsedSchoolId = parseInt(schoolId, 10);
    const ch = String(channel || '').toLowerCase();
    const deductUnits = Math.max(1, parseInt(units, 10) || 1);
    if (!parsedSchoolId || !['sms', 'push'].includes(ch)) {
      return { debited: false };
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        'SELECT * FROM school_notification_wallets WHERE school_id = ? LIMIT 1 FOR UPDATE',
        [parsedSchoolId]
      );
      if (rows.length === 0) {
        await conn.commit();
        return { debited: false, balance_after: 0 };
      }

      const wallet = rows[0];
      const currentBalance = parseInt(ch === 'sms' ? wallet.sms_balance : wallet.push_balance, 10) || 0;
      const actualDebit = Math.min(currentBalance, deductUnits);
      if (actualDebit <= 0) {
        await conn.commit();
        return { debited: false, balance_after: currentBalance };
      }

      const balanceAfter = currentBalance - actualDebit;
      if (ch === 'sms') {
        await conn.query(
          `UPDATE school_notification_wallets
           SET sms_balance = ?, total_sms_used = total_sms_used + ?
           WHERE school_id = ?`,
          [balanceAfter, actualDebit, parsedSchoolId]
        );
      } else {
        await conn.query(
          `UPDATE school_notification_wallets
           SET push_balance = ?, total_push_used = total_push_used + ?
           WHERE school_id = ?`,
          [balanceAfter, actualDebit, parsedSchoolId]
        );
      }

      const totalAmt = Math.round(actualDebit * (parseFloat(unitCost) || 0) * 10000) / 10000;
      await conn.query(
        `INSERT INTO school_notification_ledger
           (school_id, channel, entry_type, units, balance_after, unit_price, total_amount, reference_note)
         VALUES (?, ?, 'debit', ?, ?, ?, ?, ?)`,
        [
          parsedSchoolId,
          ch,
          actualDebit,
          balanceAfter,
          parseFloat(unitCost) || 0,
          totalAmt,
          referenceNote || `Sent ${actualDebit} ${ch.toUpperCase()} unit(s)`,
        ]
      );

      await conn.commit();
      return { debited: true, debited_units: actualDebit, balance_after: balanceAfter };
    } catch (err) {
      await conn.rollback();
      console.error('[NotificationRecordModel.debitWalletCredits Error]:', err.message);
      return { debited: false };
    } finally {
      conn.release();
    }
  }

  /**
   * Log an SMS notification record (using dynamic rate from `notification_pricing_master` + atomic wallet deduction)
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
    const rates = await NotificationRecordModel.getDynamicRates();
    const unit_cost = rates.SMS;
    const normalizedUnits = Math.max(1, parseInt(units_count, 10) || 1);
    const isBillable = ['sent', 'delivered'].includes(status);
    const total_cost = isBillable ? unit_cost * normalizedUnits : 0.0000;
    const sent_at = isBillable ? new Date() : null;

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
      normalizedUnits,
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

    if (isBillable && school_id) {
      await NotificationRecordModel.debitWalletCredits({
        schoolId: school_id,
        channel: 'sms',
        units: normalizedUnits,
        unitCost: unit_cost,
        referenceNote: `SMS #${result.insertId} (${category})`,
      });
    }

    return { id: result.insertId, channel: 'sms', unit_cost, total_cost, status };
  }

  /**
   * Log a Push notification record (using dynamic rate from `notification_pricing_master` + atomic wallet deduction)
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
    const rates = await NotificationRecordModel.getDynamicRates();
    const unit_cost = rates.PUSH;
    const normalizedUnits = Math.max(1, parseInt(units_count, 10) || 1);
    const isBillable = ['sent', 'delivered'].includes(status);
    const total_cost = isBillable ? unit_cost * normalizedUnits : 0.0000;
    const sent_at = isBillable ? new Date() : null;

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
      normalizedUnits,
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

    if (isBillable && school_id) {
      await NotificationRecordModel.debitWalletCredits({
        schoolId: school_id,
        channel: 'push',
        units: normalizedUnits,
        unitCost: unit_cost,
        referenceNote: `Push #${result.insertId} (${category})`,
      });
    }

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
    const existing = await this.getById(id);
    const wasBillable = existing && ['sent', 'delivered'].includes(existing.status);
    const becomesBillable = !wasBillable && ['sent', 'delivered'].includes(status);

    const updates = ['status = ?'];
    const params = [status];

    if (becomesBillable && existing) {
      const rates = await NotificationRecordModel.getDynamicRates();
      const chKey = String(existing.channel || '').toUpperCase();
      const unitCost = rates[chKey] ?? (parseFloat(existing.unit_cost) || 0);
      const units = Math.max(1, parseInt(existing.units_count, 10) || 1);
      updates.push('unit_cost = ?', 'total_cost = ?', 'sent_at = COALESCE(sent_at, NOW())');
      params.push(unitCost, unitCost * units);
    }

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

    if (becomesBillable && existing?.school_id) {
      const rates = await NotificationRecordModel.getDynamicRates();
      const chKey = String(existing.channel || '').toUpperCase();
      await NotificationRecordModel.debitWalletCredits({
        schoolId: existing.school_id,
        channel: existing.channel,
        units: Math.max(1, parseInt(existing.units_count, 10) || 1),
        unitCost: rates[chKey] || 0,
        referenceNote: `Notification #${id} delivered`,
      });
    }

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
    branch_id = null,
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
    if (branch_id) {
      conditions.push('(branch_id = ? OR branch_id IS NULL)');
      params.push(parseInt(branch_id, 10));
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
  static async getCostSummary({ school_id = null, branch_id = null, start_date = null, end_date = null } = {}) {
    const conditions = [];
    const params = [];

    if (school_id) {
      conditions.push('school_id = ?');
      params.push(parseInt(school_id, 10));
    }
    if (branch_id) {
      conditions.push('(branch_id = ? OR branch_id IS NULL)');
      params.push(parseInt(branch_id, 10));
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
    const dynamicRates = await NotificationRecordModel.getDynamicRates();

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
      rates: dynamicRates,
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
