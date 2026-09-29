const { pool } = require('../config/db.config');

class SubscriptionModel {
  /**
   * Get the current active/latest subscription for a given school
   */
  static async getSchoolSubscription(schoolId) {
    const targetSchoolId = parseInt(schoolId, 10);
    if (!targetSchoolId) {
      return null;
    }

    const query = `
      SELECT 
        s.id AS subscription_id,
        s.school_id,
        s.plan_id,
        s.amount_paid,
        s.payment_gateway,
        s.payment_transaction_id,
        s.payment_status,
        s.start_date,
        s.end_date,
        s.status,
        s.created_at,
        DATEDIFF(s.end_date, CURDATE()) AS days_left,
        p.plan_name,
        p.plan_code,
        p.description AS plan_description,
        p.price,
        p.billing_cycle,
        p.max_students,
        p.max_teachers
      FROM school_subscriptions s
      JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.school_id = ?
      ORDER BY 
        CASE 
          -- 1. Active paid subscriptions first (annual/monthly with valid end_date)
          WHEN s.status = 'active' AND p.billing_cycle != 'trial' AND DATEDIFF(s.end_date, CURDATE()) >= 0 THEN 1
          -- 2. Active trials next (only if valid end_date)
          WHEN s.status = 'trial' AND DATEDIFF(s.end_date, CURDATE()) >= 0 THEN 2
          -- 3. Paid subscriptions (even if expired, latest first)
          WHEN p.billing_cycle != 'trial' THEN 3
          -- 4. Expired trials
          ELSE 4
        END ASC,
        s.id DESC
      LIMIT 1
    `;

    const [rows] = await pool.query(query, [targetSchoolId]);
    if (rows.length === 0) {
      return {
        subscription_id: null,
        school_id: targetSchoolId,
        plan_name: 'No Active Subscription',
        status: 'expired',
        isTrial: false,
        isExpired: true,
        days_left: 0,
      };
    }

    const sub = rows[0];
    const daysLeft = sub.days_left !== null ? Number(sub.days_left) : 0;
    const planNameLower = (sub.plan_name || '').toLowerCase();
    const planCodeLower = (sub.plan_code || '').toLowerCase();

    // A subscription is ONLY a trial if its billing cycle is trial or code/name indicates trial,
    // AND it is not an annual/monthly paid plan (like Starter Plan, Growth Plan, Enterprise Plan).
    const isTrial = Boolean(
      (sub.billing_cycle === 'trial' ||
       planCodeLower.includes('trial') ||
       planNameLower.includes('trial') ||
       sub.status === 'trial') &&
      sub.billing_cycle !== 'annual' &&
      sub.billing_cycle !== 'monthly' &&
      !planNameLower.includes('starter') &&
      !planNameLower.includes('growth') &&
      !planNameLower.includes('enterprise')
    );

    let liveStatus = sub.status;
    let isExpired = false;

    if (daysLeft <= 0 || sub.status === 'expired') {
      liveStatus = 'expired';
      isExpired = true;

      // Automatically sync the database status if not yet marked expired
      if (sub.status !== 'expired') {
        try {
          await pool.query(
            "UPDATE school_subscriptions SET status = 'expired' WHERE id = ?",
            [sub.subscription_id]
          );
        } catch (syncErr) {
          console.error('Failed to sync expired subscription status:', syncErr.message);
        }
      }
    }

    // Fetch active items for the school's plan
    let planItems = [];
    if (sub.plan_id) {
      try {
        const [items] = await pool.query(
          'SELECT id, item_name, item_code, item_type, price, quota_limit, unit, billing_type, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY display_order ASC, id ASC',
          [sub.plan_id]
        );
        planItems = items || [];
      } catch (e) {
        planItems = [];
      }
    }

    const featuresMap = {};
    planItems.forEach(it => {
      if (it.item_code) featuresMap[it.item_code.toLowerCase()] = true;
    });

    return {
      ...sub,
      days_left: Math.max(0, daysLeft),
      actual_days_left: daysLeft,
      isTrial,
      isExpired,
      liveStatus,
      features: featuresMap,
      items: planItems,
    };
  }

  /**
   * Get all available paid plans for upgrading
   */
  static async getUpgradePlans() {
    const query = `
      SELECT id, plan_name, plan_code, description, price, billing_cycle,
             max_students, max_teachers
      FROM subscription_plans
      WHERE status = 1 AND billing_cycle != 'trial' AND price > 0
      ORDER BY price ASC
    `;
    const [rows] = await pool.query(query);
    const plans = [];
    for (const row of rows) {
      const [items] = await pool.query(
        'SELECT id, item_name, item_code, item_type, price, quota_limit, unit, billing_type, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY display_order ASC, id ASC',
        [row.id]
      );
      const featuresMap = {};
      (items || []).forEach(it => {
        if (it.item_code) featuresMap[it.item_code.toLowerCase()] = true;
      });
      plans.push({
        ...row,
        features: featuresMap,
        items: items || [],
      });
    }
    return plans;
  }

  /**
   * Get specific subscription plan by ID
   */
  static async getPlanById(planId) {
    const targetPlanId = parseInt(planId, 10);
    if (!targetPlanId) return null;

    const [rows] = await pool.query(
      `SELECT id, plan_name, plan_code, description, price, billing_cycle,
              max_students, max_teachers
       FROM subscription_plans
       WHERE id = ? LIMIT 1`,
      [targetPlanId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    const [items] = await pool.query(
      'SELECT id, item_name, item_code, item_type, price, quota_limit, unit, billing_type, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY display_order ASC, id ASC',
      [row.id]
    );
    const featuresMap = {};
    (items || []).forEach(it => {
      if (it.item_code) featuresMap[it.item_code.toLowerCase()] = true;
    });

    return {
      ...row,
      features: featuresMap,
      items: items || [],
    };
  }

  /**
   * Upgrade school subscription to a paid plan
   */
  static async upgradeSubscription({
    schoolId,
    planId,
    amountPaid,
    paymentGateway = 'dummy',
    paymentTransactionId = null,
    couponId = null,
    discountAmount = 0,
    originalAmount = null,
  }) {
    const targetSchoolId = parseInt(schoolId, 10);
    const targetPlanId = parseInt(planId, 10);

    const [planRows] = await pool.query(
      'SELECT id, plan_name, price, billing_cycle FROM subscription_plans WHERE id = ? LIMIT 1',
      [targetPlanId]
    );
    const plan = planRows[0];
    if (!plan) {
      throw new Error('Selected upgrade plan not found.');
    }

    const finalAmount = amountPaid !== undefined ? parseFloat(amountPaid) : parseFloat(plan.price);
    const finalTxnId =
      paymentTransactionId ||
      `UPGRADE_PAY_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    const startDate = new Date();
    const endDate = new Date();
    if (plan.billing_cycle === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Expire any existing subscriptions for this school
    await pool.query(
      "UPDATE school_subscriptions SET status = 'expired' WHERE school_id = ? AND status IN ('trial', 'active')",
      [targetSchoolId]
    );

    // Insert new active paid subscription with coupon audit fields
    const insertQuery = `
      INSERT INTO school_subscriptions (
        school_id, plan_id, amount_paid, payment_gateway,
        payment_transaction_id, coupon_id, discount_amount, original_amount,
        payment_status, start_date, end_date, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, 'active', NOW())
    `;

    const [result] = await pool.query(insertQuery, [
      targetSchoolId,
      targetPlanId,
      finalAmount,
      paymentGateway,
      finalTxnId,
      couponId ? parseInt(couponId, 10) : null,
      parseFloat(discountAmount) || 0,
      originalAmount !== null && originalAmount !== undefined ? parseFloat(originalAmount) : finalAmount,
      startDateStr,
      endDateStr,
    ]);

    const subscriptionId = result.insertId;

    // Record coupon usage and increment used_count in coupons master table
    if (couponId && parseFloat(discountAmount) > 0) {
      try {
        const CouponModel = require('./coupon.model');
        await CouponModel.recordCouponUsage(couponId, targetSchoolId, subscriptionId, discountAmount);
      } catch (couponErr) {
        console.error('Failed to record coupon usage in coupon_usages:', couponErr.message);
      }
    }

    return {
      subscription_id: subscriptionId,
      school_id: targetSchoolId,
      plan_id: targetPlanId,
      plan_name: plan.plan_name,
      amount_paid: finalAmount,
      coupon_id: couponId,
      discount_amount: parseFloat(discountAmount) || 0,
      original_amount: originalAmount !== null && originalAmount !== undefined ? parseFloat(originalAmount) : finalAmount,
      transaction_id: finalTxnId,
      start_date: startDateStr,
      end_date: endDateStr,
      status: 'active',
    };
  }

  /**
   * Check if school has reached its quota for a specific entity ('students' or 'teachers')
   */
  static async checkQuota(schoolId, type) {
    const targetSchoolId = parseInt(schoolId, 10);
    if (!targetSchoolId) return { allowed: true };

    const sub = await this.getSchoolSubscription(targetSchoolId);
    if (!sub) return { allowed: true };

    if (type === 'students') {
      const maxStudents =
        sub.max_students !== null && sub.max_students !== undefined
          ? Number(sub.max_students)
          : 0;
      // 0 indicates unlimited quota (e.g. Enterprise)
      if (maxStudents > 0) {
        const [rows] = await pool.query(
          'SELECT COUNT(id) AS count FROM student_master WHERE school_id = ? AND status != 0',
          [targetSchoolId]
        );
        const currentCount = rows[0]?.count || 0;
        if (currentCount >= maxStudents) {
          return {
            allowed: false,
            currentCount,
            maxQuota: maxStudents,
            planName: sub.plan_name,
            message: `Student enrollment limit reached (${currentCount}/${maxStudents}) for your ${sub.plan_name}. Please upgrade your subscription plan to enroll more students.`,
          };
        }
      }
    } else if (type === 'teachers') {
      const maxTeachers =
        sub.max_teachers !== null && sub.max_teachers !== undefined
          ? Number(sub.max_teachers)
          : 0;
      // 0 indicates unlimited quota (e.g. Enterprise)
      if (maxTeachers > 0) {
        const [rows] = await pool.query(
          'SELECT COUNT(id) AS count FROM teacher_master WHERE school_id = ? AND status != 0',
          [targetSchoolId]
        );
        const currentCount = rows[0]?.count || 0;
        if (currentCount >= maxTeachers) {
          return {
            allowed: false,
            currentCount,
            maxQuota: maxTeachers,
            planName: sub.plan_name,
            message: `Teacher & staff quota reached (${currentCount}/${maxTeachers}) for your ${sub.plan_name}. Please upgrade your subscription plan to add more staff.`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Record an offline upgrade request for administrative review
   */
  static async requestOfflineUpgrade({
    schoolId,
    planId,
    amountPaid,
    paymentTransactionId = null,
    couponId = null,
    discountAmount = 0,
    originalAmount = null,
  }) {
    const targetSchoolId = parseInt(schoolId, 10);
    const targetPlanId = parseInt(planId, 10);

    const plan = await this.getPlanById(targetPlanId);
    if (!plan) {
      throw new Error('Selected upgrade plan not found.');
    }

    const finalAmount = amountPaid !== undefined ? parseFloat(amountPaid) : parseFloat(plan.price);
    const finalTxnId =
      paymentTransactionId ||
      `OFFLINE_REQ_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    const startDate = new Date();
    const endDate = new Date();
    if (plan.billing_cycle === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Insert as pending record without replacing active license until manual DB verification
    const insertQuery = `
      INSERT INTO school_subscriptions (
        school_id, plan_id, amount_paid, payment_gateway,
        payment_transaction_id, coupon_id, discount_amount, original_amount,
        payment_status, start_date, end_date, status, created_at
      ) VALUES (?, ?, ?, 'bank_transfer', ?, ?, ?, ?, 'pending', ?, ?, 'suspended', NOW())
    `;

    const [result] = await pool.query(insertQuery, [
      targetSchoolId,
      targetPlanId,
      finalAmount,
      finalTxnId,
      couponId ? parseInt(couponId, 10) : null,
      parseFloat(discountAmount) || 0,
      originalAmount !== null && originalAmount !== undefined ? parseFloat(originalAmount) : finalAmount,
      startDateStr,
      endDateStr,
    ]);

    return {
      request_id: result.insertId,
      school_id: targetSchoolId,
      plan_id: targetPlanId,
      plan_name: plan.plan_name,
      amount: finalAmount,
      coupon_id: couponId,
      discount_amount: parseFloat(discountAmount) || 0,
      original_amount: originalAmount !== null && originalAmount !== undefined ? parseFloat(originalAmount) : finalAmount,
      transaction_id: finalTxnId,
      payment_status: 'pending',
    };
  }

  /**
   * Get active catalog for subscription configuration (Storage, Machines, RFID Cards, Notifications)
   */
  static async getConfigurationCatalog() {
    const [storagePlans] = await pool.query(
      'SELECT id, plan_name, storage_capacity, capacity_unit_id, monthly_price, annual_price, description FROM storage_master WHERE status = 1 ORDER BY storage_capacity ASC'
    );
    const [attendanceMachines] = await pool.query(
      'SELECT id, machine_name, model_number, brand, machine_type, connectivity, user_capacity, log_capacity, push_protocol, unit_price, amc_price, machine_image, specifications FROM attendance_machine_master WHERE status = 1 ORDER BY unit_price ASC'
    );
    const [rfidCards] = await pool.query(
      'SELECT id, card_name, card_code, card_type, frequency, read_range, unit_price, min_order_qty, card_image, rfid_image, description FROM rfid_card_master WHERE status = 1 ORDER BY unit_price ASC'
    );
    const [bankAccounts] = await pool.query(
      'SELECT id, account_title, beneficiary_name, account_number, bank_name, branch_name, ifsc_code, account_type, upi_id, swift_code, instructions, qr_code_image, is_default FROM bank_account_master WHERE status = 1 ORDER BY is_default DESC, id ASC'
    );
    const [notificationRecords] = await pool.query(
      'SELECT id, type, recipient, message, cost, status, created_at FROM notification_master ORDER BY id ASC'
    );

    return {
      storage_plans: storagePlans || [],
      attendance_machines: attendanceMachines || [],
      rfid_cards: rfidCards || [],
      bank_accounts: bankAccounts || [],
      notification_records: notificationRecords || [],
    };
  }
}

module.exports = SubscriptionModel;
