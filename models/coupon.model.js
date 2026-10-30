const { pool } = require('../config/db.config');
const { getTodayIST, parseDateParts, formatDateParts } = require('../constants/subscriptionModules.constant');

class CouponModel {
  /**
   * Ensure max_uses_per_user and applicable_scope columns exist on coupons
   */
  static async initTable() {
    try {
      const [cols] = await pool.query(
        `SELECT COLUMN_NAME, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'coupons'`
      );
      const colMap = new Map(cols.map((c) => [c.COLUMN_NAME, c]));

      if (!colMap.has('max_uses_per_user')) {
        await pool.query(
          `ALTER TABLE coupons
           ADD COLUMN max_uses_per_user INT UNSIGNED NOT NULL DEFAULT 1 AFTER max_uses`
        );
      } else {
        await pool.query(
          `UPDATE coupons SET max_uses_per_user = 1 WHERE max_uses_per_user IS NULL OR max_uses_per_user < 1`
        );
        if (colMap.get('max_uses_per_user').IS_NULLABLE === 'YES') {
          await pool.query(
            `ALTER TABLE coupons
             MODIFY COLUMN max_uses_per_user INT UNSIGNED NOT NULL DEFAULT 1`
          );
        }
      }

      if (!colMap.has('applicable_scope')) {
        await pool.query(
          `ALTER TABLE coupons
           ADD COLUMN applicable_scope ENUM('plan_only','software_and_storage','all') NOT NULL DEFAULT 'plan_only' AFTER discount_value`
        );
      }
    } catch (err) {
      console.error('Error initializing coupons table columns:', err.message);
    }
  }

  /**
   * Fetch paginated list of coupons with optional search and filters
   */
  static async getAll({ search = '', status = '', discount_type = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('c.status = ?');
      params.push(parseInt(status, 10));
    }

    if (discount_type && discount_type !== 'all') {
      conditions.push('c.discount_type = ?');
      params.push(discount_type.trim().toLowerCase());
    }

    if (search && search.trim()) {
      conditions.push('(c.code LIKE ? OR c.description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM coupons c
      ${where}
    `;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const selectQuery = `
      SELECT 
        c.*,
        GREATEST(c.used_count, (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id)) AS used_count,
        (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_redemptions,
        (SELECT IFNULL(SUM(discount_amount), 0.00) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_discount_given
      FROM coupons c
      ${where}
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?
    `;
    const queryParams = [...params, limitNum, offset];
    const [coupons] = await pool.query(selectQuery, queryParams);

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      coupons,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    };
  }

  /**
   * Get coupon details by ID with usage history
   */
  static async getById(id) {
    const [rows] = await pool.query(
      `SELECT 
         c.*,
         GREATEST(c.used_count, (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id)) AS used_count,
         (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_redemptions,
         (SELECT IFNULL(SUM(discount_amount), 0.00) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_discount_given
       FROM coupons c
       WHERE c.id = ?
       LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return null;
    const coupon = rows[0];

    const [usages] = await pool.query(
      `SELECT 
        cu.*, 
        s.school_name, 
        s.school_code, 
        s.email AS user_email,
        ss.payment_status,
        spo.order_no AS order_id,
        (SELECT COUNT(*) FROM coupon_usages cu2 WHERE cu2.coupon_id = cu.coupon_id AND cu2.school_id = cu.school_id) AS user_used_count
       FROM coupon_usages cu
       JOIN school_master s ON cu.school_id = s.id
       LEFT JOIN school_subscriptions ss ON cu.subscription_id = ss.id
       LEFT JOIN subscription_payment_orders spo ON ss.payment_order_id = spo.id
       WHERE cu.coupon_id = ?
       ORDER BY cu.id DESC`,
      [id]
    );
    coupon.usages = usages;
    return coupon;
  }

  /**
   * Get coupon by code
   */
  static async getByCode(code) {
    if (!code) return null;
    const [rows] = await pool.query('SELECT * FROM coupons WHERE code = ? LIMIT 1', [
      code.trim().toUpperCase(),
    ]);
    return rows[0] || null;
  }

  /**
   * Create a new coupon
   */
  static async create({
    code,
    description = '',
    discount_type = 'percentage',
    discount_value,
    applicable_scope = 'plan_only',
    min_order_amount = 0,
    max_discount_amount = null,
    start_date = null,
    end_date = null,
    max_uses = null,
    max_uses_per_user = 1,
    status = 1,
  }) {
    const perUserLimit = Math.max(1, parseInt(max_uses_per_user, 10) || 1);
    const validScopes = ['plan_only', 'software_and_storage', 'all'];
    const scope = validScopes.includes(applicable_scope) ? applicable_scope : 'plan_only';

    const [result] = await pool.query(
      `INSERT INTO coupons 
       (code, description, discount_type, discount_value, applicable_scope, min_order_amount, max_discount_amount, start_date, end_date, max_uses, max_uses_per_user, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        code.toUpperCase().trim(),
        description || '',
        discount_type,
        parseFloat(discount_value) || 0,
        scope,
        parseFloat(min_order_amount) || 0,
        max_discount_amount ? parseFloat(max_discount_amount) : null,
        start_date || null,
        end_date || null,
        max_uses ? parseInt(max_uses, 10) : null,
        perUserLimit,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update an existing coupon
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.code !== undefined) {
      updates.push('code = ?');
      params.push(data.code.toUpperCase().trim());
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (data.discount_type !== undefined) {
      updates.push('discount_type = ?');
      params.push(data.discount_type);
    }
    if (data.discount_value !== undefined) {
      updates.push('discount_value = ?');
      params.push(parseFloat(data.discount_value) || 0);
    }
    if (data.applicable_scope !== undefined) {
      const validScopes = ['plan_only', 'software_and_storage', 'all'];
      if (validScopes.includes(data.applicable_scope)) {
        updates.push('applicable_scope = ?');
        params.push(data.applicable_scope);
      }
    }
    if (data.min_order_amount !== undefined) {
      updates.push('min_order_amount = ?');
      params.push(parseFloat(data.min_order_amount) || 0);
    }
    if (data.max_discount_amount !== undefined) {
      updates.push('max_discount_amount = ?');
      params.push(data.max_discount_amount ? parseFloat(data.max_discount_amount) : null);
    }
    if (data.start_date !== undefined) {
      updates.push('start_date = ?');
      params.push(data.start_date || null);
    }
    if (data.end_date !== undefined) {
      updates.push('end_date = ?');
      params.push(data.end_date || null);
    }
    if (data.max_uses !== undefined) {
      updates.push('max_uses = ?');
      params.push(data.max_uses ? parseInt(data.max_uses, 10) : null);
    }
    if (data.max_uses_per_user !== undefined) {
      updates.push('max_uses_per_user = ?');
      params.push(Math.max(1, parseInt(data.max_uses_per_user, 10) || 1));
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(data.status, 10));
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE coupons SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete a coupon
   */
  static async delete(id) {
    const [result] = await pool.query('DELETE FROM coupons WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle status
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE coupons SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Validate coupon eligibility and compute discount in IST with scope protection.
   * By default (applicable_scope = 'plan_only'), coupons discount ONLY the software plan amount
   * so hardware (Biometric Machines, RFID Cards) and SMS gateway costs are never discounted below cost.
   */
  static async validateCoupon(code, orderAmount, schoolId = null, options = {}) {
    if (!code || !String(code).trim()) {
      return { valid: false, message: 'Please provide a coupon code.' };
    }

    const db = options.connection || pool;
    const forUpdate = Boolean(options.forUpdate && options.connection);
    const cleanCode = String(code).trim().toUpperCase();
    const totalOrderAmount = parseFloat(orderAmount) || 0;

    const [rows] = await db.query(
      `SELECT * FROM coupons WHERE code = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [cleanCode]
    );
    if (rows.length === 0) {
      return { valid: false, message: 'Invalid coupon code.' };
    }

    const coupon = rows[0];

    if (Number(coupon.status) !== 1) {
      return { valid: false, message: 'This coupon is no longer active.' };
    }

    // IST-accurate date comparison (fixes 00:00–05:30 IST UTC drift)
    const todayStr = getTodayIST();

    if (coupon.start_date) {
      const startStr = formatDateParts(parseDateParts(coupon.start_date));
      if (todayStr < startStr) {
        return { valid: false, message: 'This coupon is not valid yet.' };
      }
    }

    if (coupon.end_date) {
      const endStr = formatDateParts(parseDateParts(coupon.end_date));
      if (todayStr > endStr) {
        return { valid: false, message: 'This coupon has expired.' };
      }
    }

    // Compute authoritative global usage count from coupon_usages + coupons.used_count + active pending reservations
    let pendingGlobalReservations = 0;
    let recordedUsagesCount = 0;
    try {
      const [pendRows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM subscription_payment_orders
         WHERE coupon_id = ? AND status = 'pending_verification'
           AND (? IS NULL OR id != ?)`,
        [coupon.id, options.excludeOrderId || null, options.excludeOrderId || null]
      );
      pendingGlobalReservations = parseInt(pendRows[0]?.cnt, 10) || 0;

      const [redempRows] = await db.query(
        'SELECT COUNT(*) AS cnt FROM coupon_usages WHERE coupon_id = ?',
        [coupon.id]
      );
      recordedUsagesCount = parseInt(redempRows[0]?.cnt, 10) || 0;
    } catch (_) {}

    const currentUsedCount = Math.max(Number(coupon.used_count) || 0, recordedUsagesCount) + pendingGlobalReservations;
    const maxUsesLimit =
      coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.max_uses) > 0
        ? Number(coupon.max_uses)
        : null;

    if (maxUsesLimit !== null && currentUsedCount >= maxUsesLimit) {
      return {
        valid: false,
        message: `This coupon has reached its maximum usage limit (${currentUsedCount}/${maxUsesLimit}).`,
      };
    }

    // Per-school / per-user usage check
    const maxUsesPerUser = Math.max(1, parseInt(coupon.max_uses_per_user, 10) || 1);
    let userUsedCount = 0;
    if (schoolId !== null && schoolId !== undefined && String(schoolId).trim() !== '') {
      const targetSchoolId = parseInt(schoolId, 10);
      if (!isNaN(targetSchoolId) && targetSchoolId > 0) {
        const [usageRows] = await db.query(
          `SELECT (
             (SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = ? AND school_id = ?) +
             (SELECT COUNT(*) FROM school_subscriptions ss
              WHERE ss.coupon_id = ? AND ss.school_id = ?
                AND ss.status IN ('pending', 'active', 'trial')
                AND (? IS NULL OR ss.id != ?)
                AND NOT EXISTS (
                  SELECT 1 FROM coupon_usages cu WHERE cu.subscription_id = ss.id AND cu.coupon_id = ss.coupon_id
                )
             )
           ) AS user_used_count`,
          [
            coupon.id,
            targetSchoolId,
            coupon.id,
            targetSchoolId,
            options.excludeSubscriptionId || null,
            options.excludeSubscriptionId || null,
          ]
        );
        userUsedCount = parseInt(usageRows[0]?.user_used_count, 10) || 0;
        if (userUsedCount >= maxUsesPerUser) {
          return {
            valid: false,
            message: `You have reached the maximum usage limit (${userUsedCount}/${maxUsesPerUser}) for this coupon.`,
          };
        }
      }
    } else if (options.email || options.phone) {
      // Onboarding pre-school check against existing schools matching email or phone
      const cleanEmail = options.email ? String(options.email).trim().toLowerCase() : null;
      const cleanPhone = options.phone ? String(options.phone).trim() : null;
      const phoneDigits = cleanPhone ? cleanPhone.replace(/[^0-9]/g, '') : '';
      const phoneLast10 = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;
      const [priorRows] = await db.query(
        `SELECT COUNT(DISTINCT cu.id) AS cnt
         FROM coupon_usages cu
         JOIN school_master sm ON cu.school_id = sm.id
         LEFT JOIN user_master um ON um.school_id = sm.id
         WHERE cu.coupon_id = ?
           AND (
             (? IS NOT NULL AND (LOWER(sm.email) = ? OR LOWER(um.email) = ?))
             OR (? IS NOT NULL AND (sm.phone_number = ? OR um.phone = ?))
             OR (? IS NOT NULL AND (
                  RIGHT(REPLACE(REPLACE(REPLACE(COALESCE(sm.phone_number, ''), ' ', ''), '-', ''), '+', ''), 10) = ?
                  OR RIGHT(REPLACE(REPLACE(REPLACE(COALESCE(um.phone, ''), ' ', ''), '-', ''), '+', ''), 10) = ?
                ))
           )`,
        [
          coupon.id,
          cleanEmail,
          cleanEmail,
          cleanEmail,
          cleanPhone,
          cleanPhone,
          cleanPhone,
          phoneLast10,
          phoneLast10,
          phoneLast10,
        ]
      );
      userUsedCount = parseInt(priorRows[0]?.cnt, 10) || 0;
      if (userUsedCount >= maxUsesPerUser) {
        return {
          valid: false,
          message: `This coupon has already been redeemed for this email/phone (${userUsedCount}/${maxUsesPerUser}).`,
        };
      }
    }

    // Scope-protected eligible discountable base amount
    const scope = coupon.applicable_scope || 'plan_only';
    const hasScopedBreakdown = options.planAmount !== undefined;
    const planAmt = hasScopedBreakdown ? (parseFloat(options.planAmount) || 0) : totalOrderAmount;
    const storageAmt = hasScopedBreakdown ? (parseFloat(options.storageAmount) || 0) : 0;

    let eligibleAmount = totalOrderAmount;
    if (hasScopedBreakdown) {
      if (scope === 'plan_only') {
        eligibleAmount = planAmt;
      } else if (scope === 'software_and_storage') {
        eligibleAmount = planAmt + storageAmt;
      } else {
        eligibleAmount = totalOrderAmount;
      }
    }

    if (eligibleAmount <= 0) {
      return {
        valid: false,
        message:
          scope === 'plan_only'
            ? 'This coupon applies to software subscription plans only and cannot discount standalone add-ons or free trials.'
            : 'No eligible items in your cart qualify for this coupon.',
      };
    }

    if (coupon.min_order_amount && eligibleAmount < parseFloat(coupon.min_order_amount)) {
      return {
        valid: false,
        message: `Minimum eligible software plan amount of ₹${parseFloat(coupon.min_order_amount).toFixed(2)} is required to use this coupon.`,
      };
    }

    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (eligibleAmount * parseFloat(coupon.discount_value)) / 100;
      if (coupon.max_discount_amount && discount > parseFloat(coupon.max_discount_amount)) {
        discount = parseFloat(coupon.max_discount_amount);
      }
    } else {
      discount = parseFloat(coupon.discount_value);
    }

    if (discount > eligibleAmount) {
      discount = eligibleAmount;
    }

    discount = Math.round(discount * 100) / 100;
    const finalPayable = Math.max(0, Math.round((totalOrderAmount - discount) * 100) / 100);

    return {
      valid: true,
      message: 'Coupon applied successfully!',
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discount_type,
        discount_type: coupon.discount_type,
        discountValue: parseFloat(coupon.discount_value),
        discount_value: parseFloat(coupon.discount_value),
        applicableScope: scope,
        applicable_scope: scope,
        minOrderAmount: parseFloat(coupon.min_order_amount || 0),
        min_order_amount: parseFloat(coupon.min_order_amount || 0),
        maxDiscountAmount: coupon.max_discount_amount ? parseFloat(coupon.max_discount_amount) : null,
        max_discount_amount: coupon.max_discount_amount ? parseFloat(coupon.max_discount_amount) : null,
        max_discount: coupon.max_discount_amount ? parseFloat(coupon.max_discount_amount) : null,
        eligibleAmount,
        discountAmount: discount,
        discount_amount: discount,
        originalAmount: totalOrderAmount,
        finalAmount: finalPayable,
        usedCount: currentUsedCount,
        used_count: currentUsedCount,
        maxUses: maxUsesLimit,
        max_uses: maxUsesLimit,
        remainingUses: maxUsesLimit !== null ? Math.max(0, maxUsesLimit - currentUsedCount) : null,
        remaining_uses: maxUsesLimit !== null ? Math.max(0, maxUsesLimit - currentUsedCount) : null,
        maxUsesPerUser,
        max_uses_per_user: maxUsesPerUser,
        userUsedCount,
        user_used_count: userUsedCount,
      },
    };
  }

  /**
   * Record coupon redemption idempotently and enforce usage limits atomically (supports external DB transaction connection)
   */
  static async recordCouponUsage(couponId, schoolId, subscriptionId, discountAmount, connection = null) {
    if (!couponId || !schoolId) return;
    const db = connection || pool;

    const [couponRows] = await db.query(
      `SELECT id, code, max_uses, max_uses_per_user, used_count, status
       FROM coupons
       WHERE id = ?
       LIMIT 1${connection ? ' FOR UPDATE' : ''}`,
      [couponId]
    );
    if (couponRows.length === 0) {
      const err = new Error('Applied coupon no longer exists.');
      err.statusCode = 400;
      throw err;
    }
    const coupon = couponRows[0];

    if (subscriptionId) {
      const [existing] = await db.query(
        'SELECT id FROM coupon_usages WHERE coupon_id = ? AND school_id = ? AND subscription_id = ? LIMIT 1',
        [couponId, schoolId, subscriptionId]
      );
      if (existing.length > 0) return;
    }

    const [totalRows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM coupon_usages WHERE coupon_id = ?',
      [couponId]
    );
    const currentTotalUsed = Math.max(
      Number(coupon.used_count) || 0,
      parseInt(totalRows[0]?.cnt, 10) || 0
    );
    const maxUsesLimit =
      coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.max_uses) > 0
        ? Number(coupon.max_uses)
        : null;

    if (maxUsesLimit !== null && currentTotalUsed >= maxUsesLimit) {
      const err = new Error(
        `Coupon "${coupon.code}" has reached its maximum usage limit (${currentTotalUsed}/${maxUsesLimit}).`
      );
      err.statusCode = 400;
      err.code = 'COUPON_LIMIT_EXCEEDED';
      throw err;
    }

    const maxUsesPerUser = Math.max(1, parseInt(coupon.max_uses_per_user, 10) || 1);
    const [schoolUsageRows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM coupon_usages WHERE coupon_id = ? AND school_id = ?',
      [couponId, schoolId]
    );
    const currentSchoolUsed = parseInt(schoolUsageRows[0]?.cnt, 10) || 0;
    if (currentSchoolUsed >= maxUsesPerUser) {
      const err = new Error(
        `You have reached the maximum usage limit (${currentSchoolUsed}/${maxUsesPerUser}) for coupon "${coupon.code}".`
      );
      err.statusCode = 400;
      err.code = 'COUPON_USER_LIMIT_EXCEEDED';
      throw err;
    }

    await db.query(
      'INSERT INTO coupon_usages (coupon_id, school_id, subscription_id, discount_amount, used_at) VALUES (?, ?, ?, ?, NOW())',
      [couponId, schoolId, subscriptionId || null, parseFloat(discountAmount) || 0]
    );
    await db.query(
      `UPDATE coupons c
       SET c.used_count = GREATEST(c.used_count + 1, (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id)),
           c.updated_at = NOW()
       WHERE c.id = ?`,
      [couponId]
    );
  }

  /**
   * Release a recorded coupon redemption if a subscription is rejected/cancelled
   */
  static async releaseCouponUsage(couponId, schoolId, subscriptionId, connection = null) {
    if (!couponId || !schoolId || !subscriptionId) return;
    const db = connection || pool;

    const [del] = await db.query(
      'DELETE FROM coupon_usages WHERE coupon_id = ? AND school_id = ? AND subscription_id = ?',
      [couponId, schoolId, subscriptionId]
    );
    if (del.affectedRows > 0) {
      await db.query(
        `UPDATE coupons c
         SET c.used_count = (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id),
             c.updated_at = NOW()
         WHERE c.id = ?`,
        [couponId]
      );
    }
  }
}

module.exports = CouponModel;
