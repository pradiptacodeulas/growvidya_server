const { pool } = require('../config/db.config');
const { getTodayIST, parseDateParts, formatDateParts } = require('../constants/subscriptionModules.constant');

class CouponModel {
  /**
   * Fetch paginated list of coupons with optional search and filters
   */
  static async getAll({ search = '', status = '', discount_type = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    let conditions = ['c.status IN (1, 2)'];
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
        (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS used_count,
        (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_redemptions,
        (SELECT IFNULL(SUM(discount_amount), 0.00) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_discount_given
      FROM coupons c
      ${where}
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?
    `;
    const queryParams = [...params, limitNum, offset];
    const [coupons] = await pool.query(selectQuery, queryParams);

    const [summaryRows] = await pool.query(`
      SELECT
        COUNT(*) AS total_coupons,
        SUM(CASE WHEN c.status = 1 THEN 1 ELSE 0 END) AS active_coupons,
        SUM(CASE WHEN c.status = 2 THEN 1 ELSE 0 END) AS inactive_coupons,
        (
          SELECT COUNT(*)
          FROM coupon_usages cu
          JOIN coupons c2 ON cu.coupon_id = c2.id
          WHERE c2.status IN (1, 2)
        ) AS total_redemptions,
        (
          SELECT IFNULL(SUM(cu.discount_amount), 0.00)
          FROM coupon_usages cu
          JOIN coupons c2 ON cu.coupon_id = c2.id
          WHERE c2.status IN (1, 2)
        ) AS total_discount_given
      FROM coupons c
      WHERE c.status IN (1, 2)
    `);
    const summaryRow = summaryRows[0] || {};

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      coupons,
      summary: {
        total_coupons: parseInt(summaryRow.total_coupons, 10) || 0,
        active_coupons: parseInt(summaryRow.active_coupons, 10) || 0,
        inactive_coupons: parseInt(summaryRow.inactive_coupons, 10) || 0,
        total_redemptions: parseInt(summaryRow.total_redemptions, 10) || 0,
        total_discount_given: parseFloat(summaryRow.total_discount_given) || 0,
      },
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
         (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS used_count,
         (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_redemptions,
         (SELECT IFNULL(SUM(discount_amount), 0.00) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_discount_given
       FROM coupons c
       WHERE c.id = ? AND c.status IN (1, 2)
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
        COALESCE(
          ss.payment_status,
          CASE WHEN spo.status = 'paid' THEN 'completed' ELSE spo.status END
        ) AS payment_status,
        spo.order_no AS order_id,
        spo.order_type,
        (SELECT COUNT(*) FROM coupon_usages cu2 WHERE cu2.coupon_id = cu.coupon_id AND cu2.school_id = cu.school_id) AS user_used_count
       FROM coupon_usages cu
       JOIN school_master s ON cu.school_id = s.id
       LEFT JOIN school_subscriptions ss ON cu.subscription_id = ss.id
       LEFT JOIN subscription_payment_orders spo ON spo.id = COALESCE(cu.payment_order_id, ss.payment_order_id)
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
    const [rows] = await pool.query(
      'SELECT * FROM coupons WHERE code = ? AND status IN (1, 2) LIMIT 1',
      [code.trim().toUpperCase()]
    );
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
        parseInt(status, 10) === 2 ? 2 : 1,
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
    const query = `UPDATE coupons SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND status != 4`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Soft delete a coupon (status = 4)
   */
  static async delete(id) {
    const [result] = await pool.query(
      'UPDATE coupons SET status = 4, updated_at = NOW() WHERE id = ? AND status != 4',
      [id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Toggle status (1 = Active, 2 = Inactive)
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE coupons SET status = ?, updated_at = NOW() WHERE id = ? AND status != 4',
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
      `SELECT * FROM coupons WHERE code = ? AND status IN (1, 2) LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
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

    // Compute authoritative global usage count strictly from:
    // 1. Completed redemptions (coupon_usages)
    // 2. Active pending offline orders (status = 'pending_verification')
    // 3. Active in-flight Razorpay checkouts within 15-minute reservation window (status = 'created'),
    //    excluding the current school/onboarding user's own in-flight Razorpay order so retries are never self-blocked.
    let pendingGlobalReservations = 0;
    let recordedUsagesCount = 0;
    const targetSchoolIdForExclude =
      schoolId !== null && schoolId !== undefined && String(schoolId).trim() !== ''
        ? parseInt(schoolId, 10) || null
        : null;
    const cleanEmailForExclude = options.email ? String(options.email).trim().toLowerCase() : null;
    const cleanPhoneForExclude = options.phone ? String(options.phone).trim() : null;

    const [pendRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM subscription_payment_orders spo
       WHERE spo.coupon_id = ?
         AND (
           spo.status = 'pending_verification'
           OR (
             spo.status = 'created'
             AND spo.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
             AND NOT (
               (? IS NOT NULL AND spo.school_id = ?)
               OR (
                 ? IS NULL AND spo.school_id IS NULL AND (
                   (? IS NOT NULL AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(spo.payload_snapshot_json, '$.extra.email')), '')) = ?)
                   OR (? IS NOT NULL AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(spo.payload_snapshot_json, '$.extra.phone')), '') = ?)
                 )
               )
             )
           )
         )
         AND (? IS NULL OR spo.id != ?)
         AND NOT EXISTS (
           SELECT 1 FROM coupon_usages cu
           WHERE cu.coupon_id = spo.coupon_id
             AND (cu.payment_order_id = spo.id OR (spo.activated_subscription_id IS NOT NULL AND cu.subscription_id = spo.activated_subscription_id))
         )`,
      [
        coupon.id,
        targetSchoolIdForExclude,
        targetSchoolIdForExclude,
        targetSchoolIdForExclude,
        cleanEmailForExclude,
        cleanEmailForExclude,
        cleanPhoneForExclude,
        cleanPhoneForExclude,
        options.excludeOrderId || null,
        options.excludeOrderId || null,
      ]
    );
    pendingGlobalReservations = parseInt(pendRows[0]?.cnt, 10) || 0;

    const [redempRows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM coupon_usages WHERE coupon_id = ?',
      [coupon.id]
    );
    recordedUsagesCount = parseInt(redempRows[0]?.cnt, 10) || 0;

    const currentUsedCount = recordedUsagesCount + pendingGlobalReservations;
    const maxUsesLimit =
      coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.max_uses) > 0
        ? Number(coupon.max_uses)
        : null;

    if (maxUsesLimit !== null && currentUsedCount >= maxUsesLimit) {
      return {
        valid: false,
        message: `This coupon has reached its maximum usage limit (${Math.min(currentUsedCount, maxUsesLimit)}/${maxUsesLimit}).`,
      };
    }

    // Per-school / per-user usage check (counts completed coupon_usages + pending offline orders)
    const maxUsesPerUser = Math.max(1, parseInt(coupon.max_uses_per_user, 10) || 1);
    let userUsedCount = 0;
    if (schoolId !== null && schoolId !== undefined && String(schoolId).trim() !== '') {
      const targetSchoolId = parseInt(schoolId, 10);
      if (!isNaN(targetSchoolId) && targetSchoolId > 0) {
        const [usageRows] = await db.query(
          `SELECT (
             (SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = ? AND school_id = ?) +
             (SELECT COUNT(*) FROM subscription_payment_orders spo
              WHERE spo.coupon_id = ? AND spo.school_id = ?
                AND spo.status = 'pending_verification'
                AND (? IS NULL OR spo.id != ?)
                AND (? IS NULL OR spo.activated_subscription_id IS NULL OR spo.activated_subscription_id != ?)
                AND NOT EXISTS (
                  SELECT 1 FROM coupon_usages cu
                  WHERE cu.coupon_id = spo.coupon_id
                    AND (cu.payment_order_id = spo.id OR (spo.activated_subscription_id IS NOT NULL AND cu.subscription_id = spo.activated_subscription_id))
                )
             )
           ) AS user_used_count`,
          [
            coupon.id,
            targetSchoolId,
            coupon.id,
            targetSchoolId,
            options.excludeOrderId || null,
            options.excludeOrderId || null,
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
      // Onboarding pre-school check against existing schools (completed coupon_usages + pending_verification orders) matching email or phone
      const cleanEmail = options.email ? String(options.email).trim().toLowerCase() : null;
      const cleanPhone = options.phone ? String(options.phone).trim() : null;
      const phoneDigits = cleanPhone ? cleanPhone.replace(/[^0-9]/g, '') : '';
      const phoneLast10 = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;
      const [priorRows] = await db.query(
        `SELECT (
           (SELECT COUNT(DISTINCT cu.id)
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
              )) +
           (SELECT COUNT(DISTINCT spo.id)
            FROM subscription_payment_orders spo
            JOIN school_master sm ON spo.school_id = sm.id
            LEFT JOIN user_master um ON um.school_id = sm.id
            WHERE spo.coupon_id = ?
              AND spo.status = 'pending_verification'
              AND (? IS NULL OR spo.id != ?)
              AND NOT EXISTS (
                SELECT 1 FROM coupon_usages cu2
                WHERE cu2.coupon_id = spo.coupon_id
                  AND (cu2.payment_order_id = spo.id OR (spo.activated_subscription_id IS NOT NULL AND cu2.subscription_id = spo.activated_subscription_id))
              )
              AND (
                (? IS NOT NULL AND (LOWER(sm.email) = ? OR LOWER(um.email) = ?))
                OR (? IS NOT NULL AND (sm.phone_number = ? OR um.phone = ?))
                OR (? IS NOT NULL AND (
                     RIGHT(REPLACE(REPLACE(REPLACE(COALESCE(sm.phone_number, ''), ' ', ''), '-', ''), '+', ''), 10) = ?
                     OR RIGHT(REPLACE(REPLACE(REPLACE(COALESCE(um.phone, ''), ' ', ''), '-', ''), '+', ''), 10) = ?
                   ))
              ))
         ) AS cnt`,
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
          coupon.id,
          options.excludeOrderId || null,
          options.excludeOrderId || null,
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
            : scope === 'software_and_storage'
            ? 'This coupon applies to software subscription plans and cloud storage only.'
            : 'No eligible items in your cart qualify for this coupon.',
      };
    }

    if (coupon.min_order_amount && eligibleAmount < parseFloat(coupon.min_order_amount)) {
      const scopeLabel =
        scope === 'plan_only'
          ? 'eligible software plan amount'
          : scope === 'software_and_storage'
          ? 'eligible plan + cloud storage amount'
          : 'order amount';
      return {
        valid: false,
        message: `Minimum ${scopeLabel} of ₹${parseFloat(coupon.min_order_amount).toFixed(2)} is required to use this coupon.`,
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
   * UI coupon removal is strictly read-only under Order-Based Reservation.
   * `coupons.used_count` is only modified when `recordCouponUsage` or `releaseCouponUsage` executes.
   */
  static async decrementAppliedCount(_code, _connection = null) {
    return true;
  }

  /**
   * Record coupon redemption idempotently and enforce usage limits atomically (supports external DB transaction connection)
   */
  static async recordCouponUsage(
    couponId,
    schoolId,
    subscriptionId,
    discountAmount,
    connection = null,
    paymentOrderId = null
  ) {
    if (!couponId || !schoolId) return;
    const parsedDiscount = parseFloat(discountAmount) || 0;
    if (parsedDiscount <= 0) return;

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

    if (subscriptionId || paymentOrderId) {
      const [existing] = await db.query(
        `SELECT id FROM coupon_usages
         WHERE coupon_id = ? AND school_id = ?
           AND (
             (? IS NOT NULL AND subscription_id = ?)
             OR (? IS NOT NULL AND payment_order_id = ?)
           )
         LIMIT 1`,
        [
          couponId,
          schoolId,
          subscriptionId || null,
          subscriptionId || null,
          paymentOrderId || null,
          paymentOrderId || null,
        ]
      );
      if (existing.length > 0) return;
    }

    // Check if this order already captured real funds via Razorpay (reserved at order creation)
    let isCapturedGatewayOrder = false;
    if (paymentOrderId) {
      const [ordRows] = await db.query(
        'SELECT payment_method, grand_total FROM subscription_payment_orders WHERE id = ? LIMIT 1',
        [paymentOrderId]
      );
      if (
        ordRows.length > 0 &&
        ordRows[0].payment_method === 'razorpay' &&
        (parseFloat(ordRows[0].grand_total) || 0) > 0
      ) {
        isCapturedGatewayOrder = true;
      }
    }

    if (!isCapturedGatewayOrder) {
      const [totalRows] = await db.query(
        `SELECT (
           (SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = ?) +
           (SELECT COUNT(*) FROM subscription_payment_orders spo
            WHERE spo.coupon_id = ? AND spo.status = 'pending_verification'
              AND (? IS NULL OR spo.id != ?)
              AND NOT EXISTS (
                SELECT 1 FROM coupon_usages cu
                WHERE cu.coupon_id = spo.coupon_id
                  AND (cu.payment_order_id = spo.id OR (spo.activated_subscription_id IS NOT NULL AND cu.subscription_id = spo.activated_subscription_id))
              )
           )
         ) AS cnt`,
        [couponId, couponId, paymentOrderId || null, paymentOrderId || null]
      );
      const recordedUsagesCount = parseInt(totalRows[0]?.cnt, 10) || 0;
      const maxUsesLimit =
        coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.max_uses) > 0
          ? Number(coupon.max_uses)
          : null;

      if (maxUsesLimit !== null && recordedUsagesCount >= maxUsesLimit) {
        const err = new Error(
          `Coupon "${coupon.code}" has reached its maximum usage limit (${recordedUsagesCount}/${maxUsesLimit}).`
        );
        err.statusCode = 400;
        err.code = 'COUPON_LIMIT_EXCEEDED';
        throw err;
      }

      const maxUsesPerUser = Math.max(1, parseInt(coupon.max_uses_per_user, 10) || 1);
      const [schoolUsageRows] = await db.query(
        `SELECT (
           (SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = ? AND school_id = ?) +
           (SELECT COUNT(*) FROM subscription_payment_orders spo
            WHERE spo.coupon_id = ? AND spo.school_id = ?
              AND spo.status = 'pending_verification'
              AND (? IS NULL OR spo.id != ?)
              AND NOT EXISTS (
                SELECT 1 FROM coupon_usages cu
                WHERE cu.coupon_id = spo.coupon_id
                  AND (cu.payment_order_id = spo.id OR (spo.activated_subscription_id IS NOT NULL AND cu.subscription_id = spo.activated_subscription_id))
              )
           )
         ) AS cnt`,
        [couponId, schoolId, couponId, schoolId, paymentOrderId || null, paymentOrderId || null]
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
    }

    await db.query(
      `INSERT INTO coupon_usages
         (coupon_id, school_id, subscription_id, payment_order_id, discount_amount, used_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [couponId, schoolId, subscriptionId || null, paymentOrderId || null, parsedDiscount]
    );
    await db.query(
      `UPDATE coupons c
       SET c.used_count = (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id),
           c.updated_at = NOW()
       WHERE c.id = ?`,
      [couponId]
    );
  }

  /**
   * Release a recorded coupon redemption if a subscription or order is rejected/cancelled
   */
  static async releaseCouponUsage(
    couponId,
    schoolId,
    subscriptionId,
    connection = null,
    paymentOrderId = null
  ) {
    if (!couponId || !schoolId || (!subscriptionId && !paymentOrderId)) return;
    const db = connection || pool;

    const [del] = await db.query(
      `DELETE FROM coupon_usages
       WHERE coupon_id = ? AND school_id = ?
         AND (
           (? IS NOT NULL AND subscription_id = ?)
           OR (? IS NOT NULL AND payment_order_id = ?)
         )`,
      [
        couponId,
        schoolId,
        subscriptionId || null,
        subscriptionId || null,
        paymentOrderId || null,
        paymentOrderId || null,
      ]
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
