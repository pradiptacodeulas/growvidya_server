const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');

class SaasAdminModel {
  // ========================================================
  // 1. AUTHENTICATION & ADMIN USERS
  // ========================================================
  static async findByEmail(email) {
    const [rows] = await pool.query(
      'SELECT * FROM saas_admin_users WHERE email = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, status, created_at FROM saas_admin_users WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  static async updateProfile(id, { name, email, password }) {
    let query = 'UPDATE saas_admin_users SET name = ?, email = ?';
    const params = [name.trim(), email.toLowerCase().trim()];

    if (password && password.length >= 6) {
      const hashed = await hashPassword(password);
      query += ', password = ?';
      params.push(hashed);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 2. DASHBOARD & ANALYTICS
  // ========================================================
  static async getDashboardStats() {
    // School counts
    const [schoolRows] = await pool.query(`
      SELECT 
        COUNT(*) AS total_schools,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active_schools,
        SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END) AS inactive_schools
      FROM school_master
    `);

    // Subscription & Payment counts
    const [subRows] = await pool.query(`
      SELECT 
        COUNT(*) AS total_subscriptions,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_subscriptions,
        SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END) AS trial_subscriptions,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_subscriptions,
        SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END) AS pending_payments,
        SUM(CASE WHEN payment_status = 'completed' THEN amount_paid ELSE 0 END) AS total_revenue
      FROM school_subscriptions
    `);

    // Package count
    const [planRows] = await pool.query(`
      SELECT COUNT(*) AS total_packages, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active_packages
      FROM subscription_plans
    `);

    // Coupon count
    const [couponRows] = await pool.query(`
      SELECT COUNT(*) AS total_coupons, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS active_coupons
      FROM coupons
    `);

    // Recent registered schools (latest 5)
    const [recentSchools] = await pool.query(`
      SELECT 
        s.id, s.school_name, s.school_code, s.email, s.phone_number, s.status, s.created_at,
        ss.status AS subscription_status, ss.payment_status, sp.plan_name
      FROM school_master s
      LEFT JOIN school_subscriptions ss ON ss.id = (
        SELECT id FROM school_subscriptions WHERE school_id = s.id ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
      ORDER BY s.id DESC
      LIMIT 5
    `);

    // Pending payment subscriptions (latest 5)
    const [pendingSubs] = await pool.query(`
      SELECT 
        ss.*, s.school_name, s.email AS school_email, sp.plan_name, sp.price AS plan_price
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
      JOIN subscription_plans sp ON ss.plan_id = sp.id
      WHERE ss.payment_status = 'pending'
      ORDER BY ss.id DESC
      LIMIT 5
    `);

    return {
      schools: {
        total: schoolRows[0]?.total_schools || 0,
        active: schoolRows[0]?.active_schools || 0,
        inactive: schoolRows[0]?.inactive_schools || 0,
      },
      subscriptions: {
        total: subRows[0]?.total_subscriptions || 0,
        active: subRows[0]?.active_subscriptions || 0,
        trial: subRows[0]?.trial_subscriptions || 0,
        expired: subRows[0]?.expired_subscriptions || 0,
        pendingPayments: subRows[0]?.pending_payments || 0,
        totalRevenue: parseFloat(subRows[0]?.total_revenue || 0),
      },
      packages: {
        total: planRows[0]?.total_packages || 0,
        active: planRows[0]?.active_packages || 0,
      },
      coupons: {
        total: couponRows[0]?.total_coupons || 0,
        active: couponRows[0]?.active_coupons || 0,
      },
      recentSchools,
      pendingSubscriptions: pendingSubs,
    };
  }

  // ========================================================
  // 3. SCHOOL MANAGEMENT
  // ========================================================
  static async getSchools({ search = '', status = '', subscriptionStatus = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    let whereConditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      whereConditions.push('s.status = ?');
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereConditions.push('(s.school_name LIKE ? OR s.school_code LIKE ? OR s.email LIKE ? OR s.phone_number LIKE ?)');
      params.push(term, term, term, term);
    }

    if (subscriptionStatus && subscriptionStatus !== 'all') {
      whereConditions.push('latest_sub.status = ?');
      params.push(subscriptionStatus);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM school_master s
      LEFT JOIN (
        SELECT ss1.* FROM school_subscriptions ss1
        INNER JOIN (
          SELECT school_id, MAX(id) AS max_id FROM school_subscriptions GROUP BY school_id
        ) ss2 ON ss1.id = ss2.max_id
      ) latest_sub ON s.id = latest_sub.school_id
      ${whereClause}
    `;

    const selectQuery = `
      SELECT 
        s.*,
        latest_sub.id AS current_subscription_id,
        latest_sub.plan_id,
        latest_sub.status AS subscription_status,
        latest_sub.payment_status,
        latest_sub.amount_paid,
        latest_sub.start_date AS subscription_start,
        latest_sub.end_date AS subscription_end,
        sp.plan_name,
        sp.billing_cycle,
        (SELECT COUNT(*) FROM student_master sm WHERE sm.school_id = s.id AND sm.status != 4) AS student_count,
        (SELECT COUNT(*) FROM user_master um WHERE um.school_id = s.id AND um.role = 2 AND um.status = 1) AS teacher_count,
        (SELECT COUNT(*) FROM branch_master bm WHERE bm.school_id = s.id AND bm.status = 1) AS branch_count
      FROM school_master s
      LEFT JOIN (
        SELECT ss1.* FROM school_subscriptions ss1
        INNER JOIN (
          SELECT school_id, MAX(id) AS max_id FROM school_subscriptions GROUP BY school_id
        ) ss2 ON ss1.id = ss2.max_id
      ) latest_sub ON s.id = latest_sub.school_id
      LEFT JOIN subscription_plans sp ON latest_sub.plan_id = sp.id
      ${whereClause}
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const queryParams = [...params, limitNum, offset];
    const [schools] = await pool.query(selectQuery, queryParams);

    return {
      schools,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  static async getSchoolById(id) {
    const [rows] = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM student_master sm WHERE sm.school_id = s.id AND sm.status != 4) AS total_students,
              (SELECT COUNT(*) FROM user_master um WHERE um.school_id = s.id AND um.role = 2 AND um.status = 1) AS total_teachers,
              (SELECT COUNT(*) FROM class_master cm WHERE cm.school_id = s.id AND cm.status = 1) AS total_classes,
              (SELECT COUNT(*) FROM branch_master bm WHERE bm.school_id = s.id AND bm.status = 1) AS total_branches
       FROM school_master s
       WHERE s.id = ? LIMIT 1`,
      [id]
    );

    if (rows.length === 0) return null;
    const school = rows[0];

    // Get school superadmin account
    const [adminRows] = await pool.query(
      'SELECT id, first_name, last_name, email, phone, status, created_at, date FROM user_master WHERE school_id = ? AND admin_type = 1 LIMIT 1',
      [id]
    );
    school.admin_user = adminRows[0] || null;

    // Get branches
    const [branches] = await pool.query(
      'SELECT * FROM branch_master WHERE school_id = ? ORDER BY id ASC',
      [id]
    );
    school.branches = branches;

    // Get full subscription history
    const [subs] = await pool.query(
      `SELECT ss.*, sp.plan_name, sp.plan_code, sp.price AS plan_price, sp.billing_cycle,
              c.code AS coupon_code, c.discount_type AS coupon_discount_type,
              sau.name AS verified_by_name
       FROM school_subscriptions ss
       LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
       LEFT JOIN coupons c ON ss.coupon_id = c.id
       LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
       WHERE ss.school_id = ?
       ORDER BY ss.id DESC`,
      [id]
    );
    school.subscriptions = subs;
    school.current_subscription = subs[0] || null;

    return school;
  }

  static async updateSchoolStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE school_master SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }

  static async updateSchool(id, data) {
    const allowed = [
      'school_name', 'school_code', 'phone_number', 'email', 'website',
      'address', 'postal_code', 'established_year', 'school_type',
      'affiliation_board', 'medium_of_instruction', 'status'
    ];

    const updates = [];
    const params = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE school_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 4. SUBSCRIPTION & PAYMENT VERIFICATION
  // ========================================================
  static async getSubscriptions({ search = '', status = '', paymentStatus = '', planId = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    let whereConditions = [];
    let params = [];

    if (status && status !== 'all') {
      whereConditions.push('ss.status = ?');
      params.push(status);
    }

    if (paymentStatus && paymentStatus !== 'all') {
      whereConditions.push('ss.payment_status = ?');
      params.push(paymentStatus);
    }

    if (planId && planId !== 'all') {
      whereConditions.push('ss.plan_id = ?');
      params.push(parseInt(planId, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereConditions.push('(s.school_name LIKE ? OR s.school_code LIKE ? OR ss.payment_transaction_id LIKE ? OR c.code LIKE ?)');
      params.push(term, term, term, term);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
      LEFT JOIN coupons c ON ss.coupon_id = c.id
      ${whereClause}
    `;

    const selectQuery = `
      SELECT 
        ss.*,
        s.school_name,
        s.school_code,
        s.email AS school_email,
        s.phone_number AS school_phone,
        sp.plan_name,
        sp.plan_code,
        sp.price AS plan_price,
        sp.billing_cycle,
        c.code AS coupon_code,
        c.discount_type AS coupon_discount_type,
        sau.name AS verified_by_name
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
      LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
      LEFT JOIN coupons c ON ss.coupon_id = c.id
      LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
      ${whereClause}
      ORDER BY ss.id DESC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const queryParams = [...params, limitNum, offset];
    const [subscriptions] = await pool.query(selectQuery, queryParams);

    return {
      subscriptions,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  static async getSubscriptionById(id) {
    const [rows] = await pool.query(
      `SELECT ss.*,
              s.school_name, s.school_code, s.email AS school_email, s.phone_number AS school_phone, s.address AS school_address,
              sp.plan_name, sp.plan_code, sp.price AS plan_price, sp.billing_cycle, sp.features_json, sp.max_students, sp.max_teachers,
              c.code AS coupon_code, c.discount_type AS coupon_discount_type, c.discount_value AS coupon_discount_val,
              sau.name AS verified_by_name
       FROM school_subscriptions ss
       JOIN school_master s ON ss.school_id = s.id
       LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
       LEFT JOIN coupons c ON ss.coupon_id = c.id
       LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
       WHERE ss.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async verifySubscriptionPayment(id, { paymentStatus = 'completed', status = 'active', verificationNotes = '', verifiedBy = null, startDate = null, endDate = null }) {
    let query = `
      UPDATE school_subscriptions SET
        payment_status = ?,
        status = ?,
        verification_notes = ?,
        verified_by = ?,
        verified_at = NOW()
    `;
    const params = [paymentStatus, status, verificationNotes, verifiedBy];

    if (startDate) {
      query += ', start_date = ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ', end_date = ?';
      params.push(endDate);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const [result] = await pool.query(query, params);

    // If verified as active and completed, also ensure school is active
    if (result.affectedRows > 0 && paymentStatus === 'completed' && status === 'active') {
      const [subRows] = await pool.query('SELECT school_id FROM school_subscriptions WHERE id = ?', [id]);
      if (subRows.length > 0) {
        await pool.query('UPDATE school_master SET status = 1 WHERE id = ?', [subRows[0].school_id]);
      }
    }

    return result.affectedRows > 0;
  }

  static async updateSubscriptionStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE school_subscriptions SET status = ? WHERE id = ?',
      [status, id]
    );
    return result.affectedRows > 0;
  }

  static async extendSubscription(id, { endDate, notes = '', verifiedBy = null }) {
    let query = 'UPDATE school_subscriptions SET end_date = ?, status = "active"';
    const params = [endDate];

    if (notes) {
      query += ', verification_notes = CONCAT(IFNULL(verification_notes, ""), "\n[Extension] ", ?)';
      params.push(notes);
    }
    if (verifiedBy) {
      query += ', verified_by = ?, verified_at = NOW()';
      params.push(verifiedBy);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 5. PACKAGE / SUBSCRIPTION PLAN MANAGEMENT
  // ========================================================
  static async getAllPackages({ search = '', status = '' } = {}) {
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      conditions.push('(plan_name LIKE ? OR plan_code LIKE ? OR description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT sp.*,
             (SELECT COUNT(*) FROM school_subscriptions ss WHERE ss.plan_id = sp.id) AS subscriber_count
      FROM subscription_plans sp
      ${where}
      ORDER BY sp.id ASC
    `;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async getPackageById(id) {
    const [rows] = await pool.query(
      `SELECT sp.*,
              (SELECT COUNT(*) FROM school_subscriptions ss WHERE ss.plan_id = sp.id) AS subscriber_count
       FROM subscription_plans sp
       WHERE sp.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async createPackage({ plan_name, plan_code, description, price, billing_cycle = 'annual', max_students = 0, max_teachers = 0, features_json = null, status = 1 }) {
    const cleanFeatures = typeof features_json === 'object' ? JSON.stringify(features_json) : (features_json || '[]');
    const [result] = await pool.query(
      `INSERT INTO subscription_plans (plan_name, plan_code, description, price, billing_cycle, max_students, max_teachers, features_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        plan_name.trim(),
        (plan_code || plan_name.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim(),
        description || '',
        parseFloat(price) || 0,
        billing_cycle,
        parseInt(max_students, 10) || 0,
        parseInt(max_teachers, 10) || 0,
        cleanFeatures,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  static async updatePackage(id, { plan_name, plan_code, description, price, billing_cycle, max_students, max_teachers, features_json, status }) {
    const updates = [];
    const params = [];

    if (plan_name !== undefined) { updates.push('plan_name = ?'); params.push(plan_name.trim()); }
    if (plan_code !== undefined) { updates.push('plan_code = ?'); params.push(plan_code.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (price !== undefined) { updates.push('price = ?'); params.push(parseFloat(price) || 0); }
    if (billing_cycle !== undefined) { updates.push('billing_cycle = ?'); params.push(billing_cycle); }
    if (max_students !== undefined) { updates.push('max_students = ?'); params.push(parseInt(max_students, 10) || 0); }
    if (max_teachers !== undefined) { updates.push('max_teachers = ?'); params.push(parseInt(max_teachers, 10) || 0); }
    if (features_json !== undefined) {
      updates.push('features_json = ?');
      params.push(typeof features_json === 'object' ? JSON.stringify(features_json) : features_json);
    }
    if (status !== undefined) { updates.push('status = ?'); params.push(parseInt(status, 10)); }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE subscription_plans SET ${updates.join(', ')} WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async deletePackage(id) {
    // Check if in use by any subscription
    const [inUse] = await pool.query('SELECT id FROM school_subscriptions WHERE plan_id = ? LIMIT 1', [id]);
    if (inUse.length > 0) {
      // Soft-delete by setting status = 0
      const [res] = await pool.query('UPDATE subscription_plans SET status = 0 WHERE id = ?', [id]);
      return { softDeleted: true, affectedRows: res.affectedRows };
    }
    const [res] = await pool.query('DELETE FROM subscription_plans WHERE id = ?', [id]);
    return { hardDeleted: true, affectedRows: res.affectedRows };
  }

  static async togglePackageStatus(id, status) {
    const [result] = await pool.query('UPDATE subscription_plans SET status = ? WHERE id = ?', [parseInt(status, 10), id]);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 6. COUPON MANAGEMENT
  // ========================================================
  static async getAllCoupons({ search = '', status = '' } = {}) {
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      conditions.push('(code LIKE ? OR description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT c.*,
             (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_redemptions,
             (SELECT SUM(discount_amount) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_discount_given
      FROM coupons c
      ${where}
      ORDER BY c.id DESC
    `;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async getCouponById(id) {
    const [rows] = await pool.query('SELECT * FROM coupons WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) return null;
    const coupon = rows[0];

    // Get usage history
    const [usages] = await pool.query(
      `SELECT cu.*, s.school_name, s.school_code, ss.payment_status
       FROM coupon_usages cu
       JOIN school_master s ON cu.school_id = s.id
       LEFT JOIN school_subscriptions ss ON cu.subscription_id = ss.id
       WHERE cu.coupon_id = ?
       ORDER BY cu.id DESC`,
      [id]
    );
    coupon.usages = usages;
    return coupon;
  }

  static async createCoupon({ code, description, discount_type = 'percentage', discount_value, min_order_amount = 0, max_discount_amount = null, start_date = null, end_date = null, max_uses = null, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_order_amount, max_discount_amount, start_date, end_date, max_uses, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code.toUpperCase().trim(),
        description || '',
        discount_type,
        parseFloat(discount_value) || 0,
        parseFloat(min_order_amount) || 0,
        max_discount_amount ? parseFloat(max_discount_amount) : null,
        start_date || null,
        end_date || null,
        max_uses ? parseInt(max_uses, 10) : null,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  static async updateCoupon(id, { code, description, discount_type, discount_value, min_order_amount, max_discount_amount, start_date, end_date, max_uses, status }) {
    const updates = [];
    const params = [];

    if (code !== undefined) { updates.push('code = ?'); params.push(code.toUpperCase().trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (discount_type !== undefined) { updates.push('discount_type = ?'); params.push(discount_type); }
    if (discount_value !== undefined) { updates.push('discount_value = ?'); params.push(parseFloat(discount_value) || 0); }
    if (min_order_amount !== undefined) { updates.push('min_order_amount = ?'); params.push(parseFloat(min_order_amount) || 0); }
    if (max_discount_amount !== undefined) { updates.push('max_discount_amount = ?'); params.push(max_discount_amount ? parseFloat(max_discount_amount) : null); }
    if (start_date !== undefined) { updates.push('start_date = ?'); params.push(start_date || null); }
    if (end_date !== undefined) { updates.push('end_date = ?'); params.push(end_date || null); }
    if (max_uses !== undefined) { updates.push('max_uses = ?'); params.push(max_uses ? parseInt(max_uses, 10) : null); }
    if (status !== undefined) { updates.push('status = ?'); params.push(parseInt(status, 10)); }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE coupons SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async deleteCoupon(id) {
    const [result] = await pool.query('DELETE FROM coupons WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  static async toggleCouponStatus(id, status) {
    const [result] = await pool.query('UPDATE coupons SET status = ?, updated_at = NOW() WHERE id = ?', [parseInt(status, 10), id]);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 7. COUPON VALIDATION & USAGE ENGINE (Used by Checkout / SaaS Registration)
  // ========================================================
  static async validateCoupon(code, orderAmount, schoolId = null) {
    if (!code || !String(code).trim()) {
      return { valid: false, message: 'Please provide a coupon code.' };
    }

    const cleanCode = String(code).trim().toUpperCase();
    const amount = parseFloat(orderAmount) || 0;

    const [rows] = await pool.query('SELECT * FROM coupons WHERE code = ? LIMIT 1', [cleanCode]);
    if (rows.length === 0) {
      return { valid: false, message: 'Invalid coupon code.' };
    }

    const coupon = rows[0];

    if (coupon.status !== 1) {
      return { valid: false, message: 'This coupon is no longer active.' };
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (coupon.start_date && todayStr < coupon.start_date.toISOString?.().slice(0, 10) && String(coupon.start_date).slice(0, 10) > todayStr) {
      return { valid: false, message: 'This coupon is not valid yet.' };
    }

    if (coupon.end_date) {
      const endStr = typeof coupon.end_date === 'string' ? coupon.end_date.slice(0, 10) : coupon.end_date.toISOString().slice(0, 10);
      if (todayStr > endStr) {
        return { valid: false, message: 'This coupon has expired.' };
      }
    }

    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
      return { valid: false, message: 'This coupon has reached its maximum usage limit.' };
    }

    if (coupon.min_order_amount && amount < parseFloat(coupon.min_order_amount)) {
      return {
        valid: false,
        message: `Minimum package amount of ₹${parseFloat(coupon.min_order_amount).toFixed(2)} is required to use this coupon.`,
      };
    }

    // Calculate discount amount
    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (amount * parseFloat(coupon.discount_value)) / 100;
      if (coupon.max_discount_amount && discount > parseFloat(coupon.max_discount_amount)) {
        discount = parseFloat(coupon.max_discount_amount);
      }
    } else {
      // fixed discount
      discount = parseFloat(coupon.discount_value);
    }

    // Discount cannot exceed package price
    if (discount > amount) {
      discount = amount;
    }

    discount = Math.round(discount * 100) / 100;
    const finalPayable = Math.max(0, Math.round((amount - discount) * 100) / 100);

    return {
      valid: true,
      message: 'Coupon applied successfully!',
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discount_type,
        discountValue: parseFloat(coupon.discount_value),
        discountAmount: discount,
        originalAmount: amount,
        finalAmount: finalPayable,
      },
    };
  }

  static async recordCouponUsage(couponId, schoolId, subscriptionId, discountAmount) {
    await pool.query(
      'INSERT INTO coupon_usages (coupon_id, school_id, subscription_id, discount_amount, used_at) VALUES (?, ?, ?, ?, NOW())',
      [couponId, schoolId, subscriptionId, parseFloat(discountAmount) || 0]
    );
    await pool.query(
      'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?',
      [couponId]
    );
  }
}

module.exports = SaasAdminModel;
