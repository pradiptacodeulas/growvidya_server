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
        p.max_teachers,
        p.features_json
      FROM school_subscriptions s
      JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.school_id = ?
      ORDER BY 
        CASE s.status 
          WHEN 'active' THEN 1 
          WHEN 'trial' THEN 2 
          WHEN 'expired' THEN 3 
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
    const isTrial =
      sub.status === 'trial' ||
      sub.billing_cycle === 'trial' ||
      parseFloat(sub.price) === 0 ||
      (sub.plan_code || '').includes('trial');

    let liveStatus = sub.status;
    let isExpired = false;

    if (daysLeft < 0 || sub.status === 'expired') {
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

    return {
      ...sub,
      days_left: Math.max(0, daysLeft),
      actual_days_left: daysLeft,
      isTrial,
      isExpired,
      liveStatus,
      features:
        typeof sub.features_json === 'string'
          ? JSON.parse(sub.features_json)
          : sub.features_json || {},
    };
  }

  /**
   * Get all available paid plans for upgrading
   */
  static async getUpgradePlans() {
    const query = `
      SELECT id, plan_name, plan_code, description, price, billing_cycle,
             max_students, max_teachers, features_json
      FROM subscription_plans
      WHERE status = 1 AND billing_cycle != 'trial' AND price > 0
      ORDER BY price ASC
    `;
    const [rows] = await pool.query(query);
    return rows.map((row) => ({
      ...row,
      features:
        typeof row.features_json === 'string'
          ? JSON.parse(row.features_json)
          : row.features_json || {},
    }));
  }

  /**
   * Get specific subscription plan by ID
   */
  static async getPlanById(planId) {
    const targetPlanId = parseInt(planId, 10);
    if (!targetPlanId) return null;

    const [rows] = await pool.query(
      `SELECT id, plan_name, plan_code, description, price, billing_cycle,
              max_students, max_teachers, features_json
       FROM subscription_plans
       WHERE id = ? LIMIT 1`,
      [targetPlanId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      ...row,
      features:
        typeof row.features_json === 'string'
          ? JSON.parse(row.features_json)
          : row.features_json || {},
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

    // Insert new active paid subscription
    const insertQuery = `
      INSERT INTO school_subscriptions (
        school_id, plan_id, amount_paid, payment_gateway,
        payment_transaction_id, payment_status, start_date, end_date, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, 'active', NOW())
    `;

    const [result] = await pool.query(insertQuery, [
      targetSchoolId,
      targetPlanId,
      finalAmount,
      paymentGateway,
      finalTxnId,
      startDateStr,
      endDateStr,
    ]);

    return {
      subscription_id: result.insertId,
      school_id: targetSchoolId,
      plan_id: targetPlanId,
      plan_name: plan.plan_name,
      amount_paid: finalAmount,
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
        payment_transaction_id, payment_status, start_date, end_date, status, created_at
      ) VALUES (?, ?, ?, 'bank_transfer', ?, 'pending', ?, ?, 'suspended', NOW())
    `;

    const [result] = await pool.query(insertQuery, [
      targetSchoolId,
      targetPlanId,
      finalAmount,
      finalTxnId,
      startDateStr,
      endDateStr,
    ]);

    return {
      request_id: result.insertId,
      school_id: targetSchoolId,
      plan_id: targetPlanId,
      plan_name: plan.plan_name,
      amount: finalAmount,
      transaction_id: finalTxnId,
      payment_status: 'pending',
    };
  }
}

module.exports = SubscriptionModel;
