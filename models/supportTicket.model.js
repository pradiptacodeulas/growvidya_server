const { pool } = require('../config/db.config');
const { parsePagination, buildPagination } = require('../utils/pagination.util');

class SupportTicketModel {
  /**
   * Initialize support_tickets and support_ticket_messages tables
   */
  static async initTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          ticket_number VARCHAR(40) NOT NULL UNIQUE,
          school_id INT UNSIGNED NOT NULL,
          branch_id INT UNSIGNED NULL DEFAULT NULL,
          created_by_admin_id INT UNSIGNED NOT NULL,
          subject VARCHAR(255) NOT NULL,
          category ENUM('technical', 'billing', 'subscription', 'hardware_rfid', 'feature_request', 'other') NOT NULL DEFAULT 'technical',
          priority ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
          status ENUM('open', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'open',
          assigned_to_saas_admin_id INT UNSIGNED NULL DEFAULT NULL,
          last_reply_at DATETIME NULL DEFAULT NULL,
          last_reply_by ENUM('school', 'saas_admin') NULL DEFAULT NULL,
          resolved_at DATETIME NULL DEFAULT NULL,
          closed_at DATETIME NULL DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_st_school (school_id),
          INDEX idx_st_status (status),
          INDEX idx_st_priority (priority),
          INDEX idx_st_category (category),
          INDEX idx_st_assigned (assigned_to_saas_admin_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS support_ticket_messages (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          ticket_id INT UNSIGNED NOT NULL,
          sender_type ENUM('school_admin', 'saas_admin') NOT NULL,
          sender_id INT UNSIGNED NOT NULL,
          sender_name VARCHAR(150) NOT NULL,
          message TEXT NOT NULL,
          attachment_url VARCHAR(500) NULL DEFAULT NULL,
          attachment_name VARCHAR(255) NULL DEFAULT NULL,
          is_internal_note TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_stm_ticket (ticket_id),
          CONSTRAINT fk_stm_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    } catch (error) {
      console.error('Error initializing support_tickets tables:', error.message);
    }
  }

  /**
   * Generate a unique ticket number like TKT-202610-0001
   */
  static async generateTicketNumber(conn = pool) {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `TKT-${ym}-`;

    const [rows] = await conn.query(
      'SELECT id FROM support_tickets ORDER BY id DESC LIMIT 1'
    );
    const nextSeq = (Number(rows[0]?.id || 0) + 1);
    const suffix = String(nextSeq).padStart(4, '0');
    return `${prefix}${suffix}`;
  }

  /**
   * Create a new support ticket and its initial message
   */
  static async createTicket({
    school_id,
    branch_id = null,
    created_by_admin_id,
    sender_name,
    subject,
    category = 'technical',
    priority = 'medium',
    message,
    attachment_url = null,
    attachment_name = null,
  }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const ticketNumber = await SupportTicketModel.generateTicketNumber(conn);
      const validCategories = ['technical', 'billing', 'subscription', 'hardware_rfid', 'feature_request', 'other'];
      const validPriorities = ['low', 'medium', 'high', 'urgent'];

      const safeCategory = validCategories.includes(String(category).toLowerCase())
        ? String(category).toLowerCase()
        : 'technical';
      const safePriority = validPriorities.includes(String(priority).toLowerCase())
        ? String(priority).toLowerCase()
        : 'medium';

      const [ticketResult] = await conn.query(
        `INSERT INTO support_tickets
          (ticket_number, school_id, branch_id, created_by_admin_id, subject, category, priority, status, last_reply_at, last_reply_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NOW(), 'school', NOW())`,
        [
          ticketNumber,
          Number(school_id),
          branch_id ? Number(branch_id) : null,
          Number(created_by_admin_id),
          String(subject).trim(),
          safeCategory,
          safePriority,
        ]
      );

      const ticketId = ticketResult.insertId;

      // Ensure unique ticket number derived from actual auto-increment ID if needed
      const now = new Date();
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const exactTicketNumber = `TKT-${ym}-${String(ticketId).padStart(4, '0')}`;
      if (exactTicketNumber !== ticketNumber) {
        await conn.query(
          'UPDATE support_tickets SET ticket_number = ? WHERE id = ?',
          [exactTicketNumber, ticketId]
        );
      }

      await conn.query(
        `INSERT INTO support_ticket_messages
          (ticket_id, sender_type, sender_id, sender_name, message, attachment_url, attachment_name, is_internal_note, created_at)
         VALUES (?, 'school_admin', ?, ?, ?, ?, ?, 0, NOW())`,
        [
          ticketId,
          Number(created_by_admin_id),
          String(sender_name || 'School Admin').trim(),
          String(message).trim(),
          attachment_url || null,
          attachment_name || null,
        ]
      );

      await conn.commit();
      return await SupportTicketModel.getTicketByIdForSchool(ticketId, school_id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Get KPI counts for a single school
   */
  static async getSchoolTicketCounts(school_id, branch_id = null) {
    const conditions = ['school_id = ?'];
    const params = [Number(school_id)];

    if (branch_id && branch_id !== 'all') {
      conditions.push('(branch_id = ? OR branch_id IS NULL)');
      params.push(Number(branch_id));
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [[row]] = await pool.query(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open_count,
        COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
        COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved_count,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed_count
       FROM support_tickets
       ${where}`,
      params
    );

    return {
      total: Number(row?.total || 0),
      open: Number(row?.open_count || 0),
      in_progress: Number(row?.in_progress_count || 0),
      resolved: Number(row?.resolved_count || 0),
      closed: Number(row?.closed_count || 0),
    };
  }

  /**
   * List tickets for a specific school (School Admin Portal)
   */
  static async getSchoolTickets({
    school_id,
    branch_id = null,
    search = '',
    status = '',
    priority = '',
    category = '',
    page,
    limit,
  } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    const conditions = ['st.school_id = ?'];
    const params = [Number(school_id)];

    if (branch_id && branch_id !== 'all') {
      conditions.push('(st.branch_id = ? OR st.branch_id IS NULL)');
      params.push(Number(branch_id));
    }

    if (status && status !== 'all') {
      conditions.push('st.status = ?');
      params.push(String(status).trim().toLowerCase());
    }

    if (priority && priority !== 'all') {
      conditions.push('st.priority = ?');
      params.push(String(priority).trim().toLowerCase());
    }

    if (category && category !== 'all') {
      conditions.push('st.category = ?');
      params.push(String(category).trim().toLowerCase());
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push('(st.ticket_number LIKE ? OR st.subject LIKE ?)');
      params.push(term, term);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const selectQuery = `
      SELECT
        st.*,
        bm.branch_name,
        TRIM(CONCAT_WS(' ', um.first_name, um.last_name)) AS created_by_name,
        um.email AS created_by_email,
        TRIM(CONCAT_WS(' ', sau.first_name, sau.last_name)) AS assigned_admin_name,
        (
          SELECT COUNT(*)
          FROM support_ticket_messages stm
          WHERE stm.ticket_id = st.id AND stm.is_internal_note = 0
        ) AS message_count
      FROM support_tickets st
      LEFT JOIN branch_master bm ON st.branch_id = bm.id
      LEFT JOIN user_master um ON st.created_by_admin_id = um.id
      LEFT JOIN saas_admin_users sau ON st.assigned_to_saas_admin_id = sau.id
      ${where}
      ORDER BY st.updated_at DESC, st.id DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM support_tickets st
      ${where}
    `;

    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(selectQuery, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      SupportTicketModel.getSchoolTicketCounts(school_id, branch_id),
    ]);

    return {
      tickets: rows,
      pagination: buildPagination(countRow?.total || 0, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Get single ticket + conversation messages for a school
   */
  static async getTicketByIdForSchool(id, school_id) {
    const [rows] = await pool.query(
      `SELECT
        st.*,
        bm.branch_name,
        TRIM(CONCAT_WS(' ', um.first_name, um.last_name)) AS created_by_name,
        um.email AS created_by_email,
        TRIM(CONCAT_WS(' ', sau.first_name, sau.last_name)) AS assigned_admin_name
       FROM support_tickets st
       LEFT JOIN branch_master bm ON st.branch_id = bm.id
       LEFT JOIN user_master um ON st.created_by_admin_id = um.id
       LEFT JOIN saas_admin_users sau ON st.assigned_to_saas_admin_id = sau.id
       WHERE st.id = ? AND st.school_id = ?
       LIMIT 1`,
      [Number(id), Number(school_id)]
    );

    if (rows.length === 0) return null;
    const ticket = rows[0];

    const [messages] = await pool.query(
      `SELECT
        id,
        ticket_id,
        sender_type,
        sender_id,
        sender_name,
        message,
        attachment_url,
        attachment_name,
        created_at
       FROM support_ticket_messages
       WHERE ticket_id = ? AND is_internal_note = 0
       ORDER BY id ASC`,
      [ticket.id]
    );

    ticket.messages = messages;
    return ticket;
  }

  /**
   * Add a school admin reply to a ticket
   */
  static async addSchoolReply({
    ticket_id,
    school_id,
    sender_id,
    sender_name,
    message,
    attachment_url = null,
    attachment_name = null,
  }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [tickets] = await conn.query(
        'SELECT id, status FROM support_tickets WHERE id = ? AND school_id = ? LIMIT 1 FOR UPDATE',
        [Number(ticket_id), Number(school_id)]
      );

      if (tickets.length === 0) {
        await conn.rollback();
        return null;
      }

      const ticket = tickets[0];
      const nextStatus = ticket.status === 'resolved' ? 'open' : ticket.status;

      await conn.query(
        `INSERT INTO support_ticket_messages
          (ticket_id, sender_type, sender_id, sender_name, message, attachment_url, attachment_name, is_internal_note, created_at)
         VALUES (?, 'school_admin', ?, ?, ?, ?, ?, 0, NOW())`,
        [
          Number(ticket_id),
          Number(sender_id),
          String(sender_name || 'School Admin').trim(),
          String(message).trim(),
          attachment_url || null,
          attachment_name || null,
        ]
      );

      await conn.query(
        `UPDATE support_tickets
         SET status = ?,
             last_reply_at = NOW(),
             last_reply_by = 'school',
             resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE resolved_at END,
             updated_at = NOW()
         WHERE id = ?`,
        [nextStatus, nextStatus, Number(ticket_id)]
      );

      await conn.commit();
      return await SupportTicketModel.getTicketByIdForSchool(ticket_id, school_id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Close or reopen ticket by school
   */
  static async updateStatusBySchool(ticket_id, school_id, status = 'closed') {
    const safeStatus = status === 'open' ? 'open' : 'closed';
    const [result] = await pool.query(
      `UPDATE support_tickets
       SET status = ?,
           closed_at = CASE WHEN ? = 'closed' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = ? AND school_id = ?`,
      [safeStatus, safeStatus, Number(ticket_id), Number(school_id)]
    );
    if (result.affectedRows === 0) return null;
    return await SupportTicketModel.getTicketByIdForSchool(ticket_id, school_id);
  }

  // =========================================================================
  // SAAS SUPER ADMIN METHODS
  // =========================================================================

  /**
   * Global KPI counts for SaaS Super Admin Support Tickets dashboard
   */
  static async getSaasTicketCounts() {
    const [[row]] = await pool.query(`
      SELECT
        COUNT(*) AS total_tickets,
        COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open_tickets,
        COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_tickets,
        COALESCE(SUM(CASE WHEN status IN ('open', 'in_progress') AND priority IN ('high', 'urgent') THEN 1 ELSE 0 END), 0) AS urgent_high_open_tickets,
        COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved_tickets,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed_tickets
      FROM support_tickets
    `);

    return {
      total_tickets: Number(row?.total_tickets || 0),
      open_tickets: Number(row?.open_tickets || 0),
      in_progress_tickets: Number(row?.in_progress_tickets || 0),
      urgent_high_open_tickets: Number(row?.urgent_high_open_tickets || 0),
      resolved_tickets: Number(row?.resolved_tickets || 0),
      closed_tickets: Number(row?.closed_tickets || 0),
    };
  }

  /**
   * List all support tickets across all schools for SaaS Super Admin
   */
  static async getAllTicketsForSaas({
    search = '',
    status = '',
    priority = '',
    category = '',
    assigned_to = '',
    school_id = '',
    page,
    limit,
  } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      conditions.push('st.status = ?');
      params.push(String(status).trim().toLowerCase());
    }

    if (priority && priority !== 'all') {
      conditions.push('st.priority = ?');
      params.push(String(priority).trim().toLowerCase());
    }

    if (category && category !== 'all') {
      conditions.push('st.category = ?');
      params.push(String(category).trim().toLowerCase());
    }

    if (assigned_to && assigned_to !== 'all') {
      if (assigned_to === 'unassigned') {
        conditions.push('st.assigned_to_saas_admin_id IS NULL');
      } else {
        conditions.push('st.assigned_to_saas_admin_id = ?');
        params.push(Number(assigned_to));
      }
    }

    if (school_id && school_id !== 'all') {
      conditions.push('st.school_id = ?');
      params.push(Number(school_id));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(`(
        st.ticket_number LIKE ? OR
        st.subject LIKE ? OR
        s.school_name LIKE ? OR
        s.school_code LIKE ? OR
        s.email LIKE ? OR
        s.phone_number LIKE ? OR
        TRIM(CONCAT_WS(' ', um.first_name, um.last_name)) LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseJoins = `
      FROM support_tickets st
      JOIN school_master s ON st.school_id = s.id
      LEFT JOIN branch_master bm ON st.branch_id = bm.id
      LEFT JOIN user_master um ON st.created_by_admin_id = um.id
      LEFT JOIN saas_admin_users sau ON st.assigned_to_saas_admin_id = sau.id
      LEFT JOIN (
        SELECT ss1.school_id,
               ss1.id AS subscription_id,
               ss1.plan_id,
               ss1.status AS subscription_status,
               ss1.end_date AS subscription_end_date,
               sp.plan_name,
               sp.plan_code,
               sp.billing_cycle
        FROM school_subscriptions ss1
        INNER JOIN (
          SELECT school_id, MAX(id) AS max_id
          FROM school_subscriptions
          GROUP BY school_id
        ) ss2 ON ss1.id = ss2.max_id
        LEFT JOIN subscription_plans sp ON ss1.plan_id = sp.id
      ) latest_sub ON s.id = latest_sub.school_id
    `;

    const selectQuery = `
      SELECT
        st.*,
        s.school_name,
        s.school_code,
        s.email AS school_email,
        s.phone_number AS school_phone,
        s.school_logo,
        bm.branch_name,
        TRIM(CONCAT_WS(' ', um.first_name, um.last_name)) AS created_by_name,
        COALESCE(um.email, s.email) AS created_by_email,
        COALESCE(um.phone, s.phone_number) AS created_by_phone,
        TRIM(CONCAT_WS(' ', sau.first_name, sau.last_name)) AS assigned_admin_name,
        sau.email AS assigned_admin_email,
        latest_sub.subscription_id,
        latest_sub.plan_id,
        latest_sub.plan_name,
        latest_sub.plan_code,
        latest_sub.billing_cycle,
        latest_sub.subscription_status,
        latest_sub.subscription_end_date,
        (
          SELECT COUNT(*)
          FROM support_ticket_messages stm
          WHERE stm.ticket_id = st.id
        ) AS message_count
      ${baseJoins}
      ${where}
      ORDER BY
        CASE st.status
          WHEN 'open' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'resolved' THEN 3
          WHEN 'closed' THEN 4
          ELSE 5
        END ASC,
        CASE st.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END ASC,
        st.updated_at DESC,
        st.id DESC
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
      SupportTicketModel.getSaasTicketCounts(),
    ]);

    return {
      tickets: rows,
      pagination: buildPagination(countRow?.total || 0, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Get single ticket + full conversation thread (including internal notes) for SaaS Admin
   */
  static async getTicketByIdForSaas(id) {
    const [rows] = await pool.query(
      `SELECT
        st.*,
        s.school_name,
        s.school_code,
        s.email AS school_email,
        s.phone_number AS school_phone,
        s.address AS school_address,
        s.school_logo,
        bm.branch_name,
        TRIM(CONCAT_WS(' ', um.first_name, um.last_name)) AS created_by_name,
        COALESCE(um.email, s.email) AS created_by_email,
        COALESCE(um.phone, s.phone_number) AS created_by_phone,
        TRIM(CONCAT_WS(' ', sau.first_name, sau.last_name)) AS assigned_admin_name,
        sau.email AS assigned_admin_email,
        latest_sub.subscription_id,
        latest_sub.plan_id,
        latest_sub.plan_name,
        latest_sub.plan_code,
        latest_sub.billing_cycle,
        latest_sub.subscription_status,
        latest_sub.subscription_end_date
       FROM support_tickets st
       JOIN school_master s ON st.school_id = s.id
       LEFT JOIN branch_master bm ON st.branch_id = bm.id
       LEFT JOIN user_master um ON st.created_by_admin_id = um.id
       LEFT JOIN saas_admin_users sau ON st.assigned_to_saas_admin_id = sau.id
       LEFT JOIN (
         SELECT ss1.school_id,
                ss1.id AS subscription_id,
                ss1.plan_id,
                ss1.status AS subscription_status,
                ss1.end_date AS subscription_end_date,
                sp.plan_name,
                sp.plan_code,
                sp.billing_cycle
         FROM school_subscriptions ss1
         INNER JOIN (
           SELECT school_id, MAX(id) AS max_id
           FROM school_subscriptions
           GROUP BY school_id
         ) ss2 ON ss1.id = ss2.max_id
         LEFT JOIN subscription_plans sp ON ss1.plan_id = sp.id
       ) latest_sub ON s.id = latest_sub.school_id
       WHERE st.id = ?
       LIMIT 1`,
      [Number(id)]
    );

    if (rows.length === 0) return null;
    const ticket = rows[0];

    const [messages] = await pool.query(
      `SELECT
        id,
        ticket_id,
        sender_type,
        sender_id,
        sender_name,
        message,
        attachment_url,
        attachment_name,
        is_internal_note,
        created_at
       FROM support_ticket_messages
       WHERE ticket_id = ?
       ORDER BY id ASC`,
      [ticket.id]
    );

    ticket.messages = messages;
    return ticket;
  }

  /**
   * Add a SaaS Admin reply or internal note to a ticket
   */
  static async addSaasReply({
    ticket_id,
    sender_id,
    sender_name,
    message,
    attachment_url = null,
    attachment_name = null,
    is_internal_note = false,
    next_status = null,
  }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [tickets] = await conn.query(
        'SELECT id, status, assigned_to_saas_admin_id FROM support_tickets WHERE id = ? LIMIT 1 FOR UPDATE',
        [Number(ticket_id)]
      );

      if (tickets.length === 0) {
        await conn.rollback();
        return null;
      }

      const ticket = tickets[0];
      const internalFlag = is_internal_note === true || Number(is_internal_note) === 1 || String(is_internal_note) === 'true' ? 1 : 0;

      await conn.query(
        `INSERT INTO support_ticket_messages
          (ticket_id, sender_type, sender_id, sender_name, message, attachment_url, attachment_name, is_internal_note, created_at)
         VALUES (?, 'saas_admin', ?, ?, ?, ?, ?, ?, NOW())`,
        [
          Number(ticket_id),
          Number(sender_id),
          String(sender_name || 'Growvidya Support').trim(),
          String(message).trim(),
          attachment_url || null,
          attachment_name || null,
          internalFlag,
        ]
      );

      const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
      let targetStatus = ticket.status;
      if (next_status && validStatuses.includes(String(next_status).toLowerCase())) {
        targetStatus = String(next_status).toLowerCase();
      } else if (!internalFlag && ticket.status === 'open') {
        targetStatus = 'in_progress';
      }

      const assignedId = ticket.assigned_to_saas_admin_id || Number(sender_id);

      if (!internalFlag) {
        await conn.query(
          `UPDATE support_tickets
           SET status = ?,
               assigned_to_saas_admin_id = ?,
               last_reply_at = NOW(),
               last_reply_by = 'saas_admin',
               resolved_at = CASE WHEN ? = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
               closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, NOW()) ELSE closed_at END,
               updated_at = NOW()
           WHERE id = ?`,
          [targetStatus, assignedId, targetStatus, targetStatus, Number(ticket_id)]
        );
      } else if (next_status && validStatuses.includes(String(next_status).toLowerCase())) {
        await conn.query(
          `UPDATE support_tickets
           SET status = ?,
               resolved_at = CASE WHEN ? = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
               closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, NOW()) ELSE closed_at END,
               updated_at = NOW()
           WHERE id = ?`,
          [targetStatus, targetStatus, targetStatus, Number(ticket_id)]
        );
      }

      await conn.commit();
      return await SupportTicketModel.getTicketByIdForSaas(ticket_id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Update ticket status, priority, or assigned SaaS Admin
   */
  static async updateTicketBySaas(ticket_id, { status, priority, assigned_to_saas_admin_id }) {
    const updates = [];
    const params = [];

    if (status !== undefined) {
      const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
      const s = String(status).trim().toLowerCase();
      if (validStatuses.includes(s)) {
        updates.push('status = ?');
        params.push(s);

        if (s === 'resolved') {
          updates.push('resolved_at = COALESCE(resolved_at, NOW())');
        } else if (s === 'closed') {
          updates.push('closed_at = COALESCE(closed_at, NOW())');
        } else if (s === 'open' || s === 'in_progress') {
          updates.push('resolved_at = NULL, closed_at = NULL');
        }
      }
    }

    if (priority !== undefined) {
      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      const p = String(priority).trim().toLowerCase();
      if (validPriorities.includes(p)) {
        updates.push('priority = ?');
        params.push(p);
      }
    }

    if (assigned_to_saas_admin_id !== undefined) {
      if (assigned_to_saas_admin_id === null || assigned_to_saas_admin_id === '' || assigned_to_saas_admin_id === 'unassigned') {
        updates.push('assigned_to_saas_admin_id = NULL');
      } else {
        updates.push('assigned_to_saas_admin_id = ?');
        params.push(Number(assigned_to_saas_admin_id));
      }
    }

    if (updates.length === 0) {
      return await SupportTicketModel.getTicketByIdForSaas(ticket_id);
    }

    params.push(Number(ticket_id));
    await pool.query(
      `UPDATE support_tickets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    return await SupportTicketModel.getTicketByIdForSaas(ticket_id);
  }

  /**
   * List active SaaS Admin users for ticket assignment dropdown
   */
  static async getAssignableSaasAdmins() {
    const [rows] = await pool.query(`
      SELECT
        sau.id,
        sau.first_name,
        sau.last_name,
        TRIM(CONCAT_WS(' ', sau.first_name, sau.last_name)) AS full_name,
        sau.email,
        sau.role,
        COALESCE(sr.role_name, IF(sau.role = 'superadmin', 'Super Admin', 'Sub Admin')) AS role_name
      FROM saas_admin_users sau
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id
      WHERE sau.status = 1
      ORDER BY sau.first_name ASC, sau.id ASC
    `);
    return rows;
  }
}

module.exports = SupportTicketModel;
