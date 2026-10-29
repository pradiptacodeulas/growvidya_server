const { pool } = require('../config/db.config');
const SubscriptionPolicyService = require('../services/subscriptionPolicy.service');
const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');
const StorageQuotaService = require('../services/storageQuota.service');
const {
  ALL_BILLING_CYCLE_LIST,
  getBillingCycleMeta,
  getTodayIST,
} = require('../constants/subscriptionModules.constant');

function buildFeaturesMap(planFeaturesJson = null, planItems = []) {
  const featuresMap = {};

  if (planFeaturesJson) {
    let parsed = planFeaturesJson;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (_) {
        parsed = null;
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (k && Boolean(v)) {
          featuresMap[String(k).toLowerCase()] = true;
        }
      }
    }
  }

  for (const it of planItems || []) {
    if (it?.item_code) {
      const lowerCode = String(it.item_code).trim().toLowerCase();
      featuresMap[lowerCode] = true;
    }
  }

  return featuresMap;
}

class SubscriptionModel {
  /**
   * Fetch school SMS & Push Notification Wallet balances
   */
  static async getNotificationWallet(schoolId) {
    const parsedSchoolId = parseInt(schoolId, 10);
    if (!parsedSchoolId) {
      return {
        sms_balance: 0,
        push_balance: 0,
        total_sms_purchased: 0,
        total_sms_used: 0,
        total_push_purchased: 0,
        total_push_used: 0,
      };
    }

    try {
      const [rows] = await pool.query(
        'SELECT * FROM school_notification_wallets WHERE school_id = ? LIMIT 1',
        [parsedSchoolId]
      );
      if (rows.length > 0) {
        const w = rows[0];
        return {
          sms_balance: parseInt(w.sms_balance, 10) || 0,
          push_balance: parseInt(w.push_balance, 10) || 0,
          total_sms_purchased: parseInt(w.total_sms_purchased, 10) || 0,
          total_sms_used: parseInt(w.total_sms_used, 10) || 0,
          total_push_purchased: parseInt(w.total_push_purchased, 10) || 0,
          total_push_used: parseInt(w.total_push_used, 10) || 0,
        };
      }
    } catch (_) {}

    return {
      sms_balance: 0,
      push_balance: 0,
      total_sms_purchased: 0,
      total_sms_used: 0,
      total_push_purchased: 0,
      total_push_used: 0,
    };
  }

  /**
   * Get the current active/latest subscription for a given school.
   * - Never hardcodes plan names ('starter'/'growth'/'enterprise').
   * - Uses IST dates and fixes off-by-one expiry (days_left === 0 is STILL active today; days_left < 0 is expired).
   * - Keeps active/trial schools unlocked even when an offline bank transfer renewal/upgrade is pending Super Admin review.
   */
  static async getSchoolSubscription(schoolId) {
    const targetSchoolId = parseInt(schoolId, 10);
    if (!targetSchoolId) {
      return null;
    }

    const todayStr = getTodayIST();

    const query = `
      SELECT 
        s.id AS subscription_id,
        s.school_id,
        s.plan_id,
        s.storage_plan_id,
        s.action_type,
        s.plan_amount,
        s.addons_amount,
        s.amount_paid,
        s.payment_gateway,
        s.payment_transaction_id,
        s.payment_order_id,
        s.invoice_no,
        s.payment_status,
        s.start_date,
        s.end_date,
        s.status,
        s.verification_notes,
        s.created_at,
        DATEDIFF(DATE(s.end_date), ?) AS days_left,
        p.plan_name,
        p.plan_code,
        p.plan_group,
        p.tier_rank,
        p.description AS plan_description,
        p.price,
        p.billing_cycle,
        p.free_trial_days,
        p.max_students,
        p.included_storage_gb,
        p.is_popular,
        p.features_json
      FROM school_subscriptions s
      JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.school_id = ?
        AND s.status NOT IN ('rejected', 'superseded')
      ORDER BY 
        CASE 
          -- 1. Active paid subscriptions first (valid end_date >= today IST)
          WHEN s.status = 'active' AND LOWER(p.billing_cycle) != 'trial' AND DATEDIFF(DATE(s.end_date), ?) >= 0 THEN 1
          -- 2. Active trials next (valid end_date >= today IST)
          WHEN s.status IN ('trial', 'active') AND DATEDIFF(DATE(s.end_date), ?) >= 0 THEN 2
          -- 3. Suspended subscriptions
          WHEN s.status = 'suspended' THEN 3
          -- 4. Expired paid subscriptions (prioritized over pending so lifecycle history is preserved)
          WHEN s.status != 'pending' AND LOWER(p.billing_cycle) != 'trial' THEN 4
          -- 5. Expired trials
          WHEN s.status != 'pending' THEN 5
          -- 6. Standalone pending offline subscriptions (only primary when school has no prior active/expired row)
          ELSE 6
        END ASC,
        s.id DESC
      LIMIT 1
    `;

    const [rows] = await pool.query(query, [
      todayStr,
      targetSchoolId,
      todayStr,
      todayStr,
    ]);

    // Check for any pending offline bank transfer request awaiting Super Admin verification
    const [pendingRows] = await pool.query(
      `SELECT 
        s.id AS subscription_id,
        s.school_id,
        s.plan_id,
        s.storage_plan_id,
        s.action_type,
        s.plan_amount,
        s.addons_amount,
        s.amount_paid,
        s.payment_gateway,
        s.payment_transaction_id,
        s.payment_order_id,
        s.payment_status,
        s.start_date,
        s.end_date,
        s.status,
        s.verification_notes,
        s.created_at,
        DATEDIFF(DATE(s.end_date), ?) AS days_left,
        p.plan_name,
        p.plan_code,
        p.plan_group,
        p.tier_rank,
        p.description AS plan_description,
        p.price,
        p.billing_cycle,
        p.free_trial_days,
        p.max_students,
        p.included_storage_gb
      FROM school_subscriptions s
      JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.school_id = ? AND s.status = 'pending'
      ORDER BY s.id DESC
      LIMIT 1`,
      [todayStr, targetSchoolId]
    );
    const pendingSubscription = pendingRows.length > 0 ? pendingRows[0] : null;

    // Check latest rejected offline submission (for banner feedback if needed)
    const [rejectedRows] = await pool.query(
      `SELECT s.id AS subscription_id, s.plan_id, s.payment_transaction_id, s.verification_notes, s.verified_at, p.plan_name
       FROM school_subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.school_id = ? AND s.status = 'rejected'
       ORDER BY s.id DESC LIMIT 1`,
      [targetSchoolId]
    );
    const latestRejected = rejectedRows[0] || null;

    const wallet = await SubscriptionModel.getNotificationWallet(targetSchoolId);
    const lifecycle = await SubscriptionFulfillmentService.loadSchoolLifecycleSnapshot(targetSchoolId);

    if (rows.length === 0) {
      if (pendingSubscription) {
        const pendingDaysLeft = pendingSubscription.days_left !== null ? Number(pendingSubscription.days_left) : 0;
        return {
          subscription_id: pendingSubscription.subscription_id,
          school_id: targetSchoolId,
          plan_id: pendingSubscription.plan_id,
          storage_plan_id: pendingSubscription.storage_plan_id,
          plan_name: pendingSubscription.plan_name,
          plan_code: pendingSubscription.plan_code,
          plan_group: pendingSubscription.plan_group,
          tier_rank: Number(pendingSubscription.tier_rank) || 1,
          billing_cycle: pendingSubscription.billing_cycle,
          cycle_meta: getBillingCycleMeta(pendingSubscription.billing_cycle),
          included_storage_gb: Math.max(0, parseInt(pendingSubscription.included_storage_gb, 10) || 0),
          max_students: Number(pendingSubscription.max_students) || 0,
          max_teachers: 0,
          max_branches: 0,
          amount_paid: pendingSubscription.amount_paid,
          payment_gateway: pendingSubscription.payment_gateway,
          payment_transaction_id: pendingSubscription.payment_transaction_id,
          payment_status: pendingSubscription.payment_status,
          status: 'pending',
          liveStatus: 'pending',
          isPending: true,
          has_pending_offline: true,
          isTrial: false,
          isExpired: false,
          days_left: Math.max(0, pendingDaysLeft),
          actual_days_left: pendingDaysLeft,
          features: buildFeaturesMap(null, []),
          items: [],
          notification_wallet: wallet,
          last_paid_subscription: lifecycle.lastPaidSub || null,
          has_claimed_trial: lifecycle.hasClaimedTrial,
          active_student_count: lifecycle.activeStudentCount,
          latest_rejected_subscription: latestRejected,
          pending_subscription: pendingSubscription,
          pendingSubscription,
        };
      }

      return {
        subscription_id: null,
        school_id: targetSchoolId,
        plan_name: 'No Active Subscription',
        status: latestRejected ? 'rejected' : 'expired',
        liveStatus: latestRejected ? 'rejected' : 'expired',
        isPending: false,
        has_pending_offline: false,
        isTrial: false,
        isExpired: true,
        days_left: 0,
        max_teachers: 0,
        max_branches: 0,
        features: buildFeaturesMap(null, []),
        items: [],
        notification_wallet: wallet,
        last_paid_subscription: lifecycle.lastPaidSub || null,
        has_claimed_trial: lifecycle.hasClaimedTrial,
        active_student_count: lifecycle.activeStudentCount,
        latest_rejected_subscription: latestRejected,
        pending_subscription: null,
        pendingSubscription: null,
      };
    }

    const sub = rows[0];
    const daysLeft = sub.days_left !== null ? Number(sub.days_left) : 0;

    // Dynamic trial identification — zero hardcoded plan names
    const isTrial = Boolean(
      sub.status === 'trial' ||
      String(sub.billing_cycle || '').toLowerCase() === 'trial' ||
      sub.payment_gateway === 'free_trial'
    );

    let liveStatus = sub.status;
    let isExpired = false;

    if (sub.status === 'pending') {
      liveStatus = 'pending';
      isExpired = false;
    } else if (sub.status === 'suspended') {
      liveStatus = 'suspended';
      isExpired = false;
    } else if (daysLeft < 0 || sub.status === 'expired') {
      // If an expired school has submitted an offline bank transfer, expose pending state cleanly to Admin UI
      if (pendingSubscription) {
        liveStatus = 'pending';
        isExpired = false;
      } else {
        liveStatus = 'expired';
        isExpired = true;
      }

      if (sub.status !== 'expired' && sub.status !== 'pending') {
        try {
          await pool.query(
            "UPDATE school_subscriptions SET status = 'expired' WHERE id = ?",
            [sub.subscription_id]
          );
        } catch (_) {}
      }
    }

    let planItems = [];
    if (sub.plan_id) {
      try {
        const [items] = await pool.query(
          'SELECT id, item_name, item_code, item_type, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY FIELD(item_type, "module", "feature"), id ASC',
          [sub.plan_id]
        );
        planItems = items || [];
      } catch (_) {
        planItems = [];
      }
    }

    const featuresMap = buildFeaturesMap(sub.features_json, planItems);

    let storageAllocation = null;
    try {
      storageAllocation = await StorageQuotaService.getAllocatedBytes(targetSchoolId);
    } catch (_) {}

    const primaryIsPending = liveStatus === 'pending';

    return {
      ...sub,
      tier_rank: Number(sub.tier_rank) || 1,
      included_storage_gb: Math.max(0, parseInt(sub.included_storage_gb, 10) || 0),
      total_storage_gb: storageAllocation ? storageAllocation.totalAllowedGb : Math.max(0, parseInt(sub.included_storage_gb, 10) || 0),
      addon_storage_gb: storageAllocation ? storageAllocation.addonStorageGb : 0,
      max_students: Number(sub.max_students) || 0,
      max_teachers: 0, // Unlimited teachers on all plans
      max_branches: 0, // Unlimited branches on all plans
      cycle_meta: getBillingCycleMeta(sub.billing_cycle, sub.free_trial_days),
      days_left: isExpired ? 0 : Math.max(0, daysLeft),
      actual_days_left: daysLeft,
      isTrial,
      isExpired,
      isPending: primaryIsPending,
      has_pending_offline: Boolean(pendingSubscription),
      liveStatus,
      features: featuresMap,
      items: planItems,
      notification_wallet: wallet,
      last_paid_subscription: lifecycle.lastPaidSub || null,
      has_claimed_trial: lifecycle.hasClaimedTrial,
      active_student_count: lifecycle.activeStudentCount,
      latest_rejected_subscription: latestRejected,
      pending_subscription: pendingSubscription,
      pendingSubscription,
    };
  }

  /**
   * Get all available paid plans dynamically from DB, annotated with exact policy transition states:
   * - Strict no-downgrade enforcement (tier_rank + billing cycle duration, even after expiry!)
   * - Active student quota floor check
   * - Early renewal date-stacking preview vs fresh cycle upgrade preview
   */
  static async getUpgradePlans(schoolId = null) {
    const query = `
      SELECT id, plan_name, plan_code, plan_group, tier_rank, description, price, original_price, billing_cycle,
             free_trial_days, max_students, included_storage_gb, is_popular, features_json
      FROM subscription_plans
      WHERE status = 1 AND LOWER(billing_cycle) != 'trial' AND price > 0
      ORDER BY tier_rank ASC, price ASC
    `;
    const [rows] = await pool.query(query);

    let lifecycle = {
      activeSub: null,
      lastPaidSub: null,
      hasClaimedTrial: false,
      activeStudentCount: 0,
    };
    if (schoolId) {
      lifecycle = await SubscriptionFulfillmentService.loadSchoolLifecycleSnapshot(schoolId);
    }

    const refSub =
      lifecycle.activeSub && !lifecycle.activeSub.isTrial && !lifecycle.activeSub.isExpired
        ? lifecycle.activeSub
        : lifecycle.lastPaidSub;

    const plans = [];
    for (const row of rows) {
      const [items] = await pool.query(
        'SELECT id, item_name, item_code, item_type, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY FIELD(item_type, "module", "feature"), id ASC',
        [row.id]
      );

      const featuresMap = buildFeaturesMap(row.features_json, items || []);
      const cycleMeta = getBillingCycleMeta(row.billing_cycle, row.free_trial_days);

      const transition = schoolId
        ? SubscriptionPolicyService.classifyPlanTransition({
            activeSub: lifecycle.activeSub,
            lastPaidSub: lifecycle.lastPaidSub,
            hasClaimedTrial: lifecycle.hasClaimedTrial,
            targetPlan: row,
            isTrialIntent: false,
            activeStudentCount: lifecycle.activeStudentCount,
          })
        : {
            allowed: true,
            code: 'OK',
            transition_type: 'new_subscription',
            action_type: 'onboarding',
            is_downgrade: false,
            is_renewal: false,
            is_upgrade: false,
            stacks_dates: false,
            start_date: getTodayIST(),
            end_date: null,
            reason: null,
          };

      const isCurrent = Boolean(
        lifecycle.activeSub &&
          !lifecycle.activeSub.isTrial &&
          !lifecycle.activeSub.isExpired &&
          Number(lifecycle.activeSub.plan_id) === Number(row.id)
      );

      const isQuotaLocked = Boolean(
        transition.is_quota_locked ||
        transition.code === 'QUOTA_BELOW_ACTIVE_USAGE' ||
        transition.code === 'QUOTA_EXCEEDED'
      );

      const sellingPrice = parseFloat(row.price) || 0;
      const rawOrig =
        row.original_price !== null && row.original_price !== undefined && row.original_price !== ''
          ? parseFloat(row.original_price)
          : null;
      const validOrig =
        rawOrig !== null && !isNaN(rawOrig) && rawOrig > sellingPrice
          ? Number(rawOrig.toFixed(2))
          : null;

      plans.push({
        ...row,
        original_price: validOrig,
        discount_amount: validOrig ? Number((validOrig - sellingPrice).toFixed(2)) : 0,
        discount_percent: validOrig
          ? Math.round(((validOrig - sellingPrice) / validOrig) * 100)
          : 0,
        tier_rank: Number(row.tier_rank) || 1,
        included_storage_gb: Math.max(0, parseInt(row.included_storage_gb, 10) || 0),
        is_popular: Number(row.is_popular) === 1 ? 1 : 0,
        max_students: Number(row.max_students) || 0,
        max_teachers: 0,
        max_branches: 0,
        cycle_meta: cycleMeta,
        is_current: isCurrent,
        is_downgrade: Boolean(transition.is_downgrade),
        is_quota_locked: isQuotaLocked,
        is_upgrade: Boolean(transition.is_upgrade),
        is_renewal: Boolean(transition.is_renewal),
        is_equal_tier: Boolean(refSub && Number(refSub.tier_rank) === Number(row.tier_rank)),
        can_switch: Boolean(transition.allowed),
        transition_type: transition.transition_type,
        action_type: transition.action_type,
        stacks_dates: Boolean(transition.stacks_dates),
        projected_start_date: transition.start_date || null,
        projected_end_date: transition.end_date || null,
        lock_code: transition.allowed ? null : transition.code,
        lock_reason: transition.allowed ? null : transition.reason,
        validity_note: transition.allowed ? transition.reason : null,
        current_plan_name: refSub?.plan_name || null,
        current_plan_price: refSub ? parseFloat(refSub.catalog_price || refSub.price || 0) : 0,
        downgrade_message: !transition.allowed ? transition.reason : null,
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
      `SELECT id, plan_name, plan_code, plan_group, tier_rank, description, price, original_price, billing_cycle,
              free_trial_days, max_students, included_storage_gb, is_popular, features_json, status
       FROM subscription_plans
       WHERE id = ? LIMIT 1`,
      [targetPlanId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    const [items] = await pool.query(
      'SELECT id, item_name, item_code, item_type, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY FIELD(item_type, "module", "feature"), id ASC',
      [row.id]
    );
    const featuresMap = buildFeaturesMap(row.features_json, items || []);
    const sellingPrice = parseFloat(row.price) || 0;
    const rawOrig =
      row.original_price !== null && row.original_price !== undefined && row.original_price !== ''
        ? parseFloat(row.original_price)
        : null;
    const validOrig =
      rawOrig !== null && !isNaN(rawOrig) && rawOrig > sellingPrice
        ? Number(rawOrig.toFixed(2))
        : null;

    return {
      ...row,
      original_price: validOrig,
      discount_amount: validOrig ? Number((validOrig - sellingPrice).toFixed(2)) : 0,
      discount_percent: validOrig
        ? Math.round(((validOrig - sellingPrice) / validOrig) * 100)
        : 0,
      tier_rank: Number(row.tier_rank) || 1,
      included_storage_gb: Math.max(0, parseInt(row.included_storage_gb, 10) || 0),
      is_popular: Number(row.is_popular) === 1 ? 1 : 0,
      max_students: Number(row.max_students) || 0,
      max_teachers: 0,
      max_branches: 0,
      cycle_meta: getBillingCycleMeta(row.billing_cycle, row.free_trial_days),
      features: featuresMap,
      items: items || [],
    };
  }

  /**
   * Check if school has reached its quota for a specific entity ('students', 'teachers', 'branches')
   * Note: Teachers and Branches are unlimited (0) on all plans per business rules.
   */
  static async checkQuota(schoolId, type) {
    const targetSchoolId = parseInt(schoolId, 10);
    if (!targetSchoolId) return { allowed: true };

    if (type === 'teachers' || type === 'branches') {
      return { allowed: true };
    }

    const sub = await this.getSchoolSubscription(targetSchoolId);
    if (!sub) return { allowed: true };

    if (type === 'students') {
      const maxStudents =
        sub.max_students !== null && sub.max_students !== undefined
          ? Number(sub.max_students)
          : 0;
      // 0 indicates unlimited student quota
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
    }

    return { allowed: true };
  }

  /**
   * Get active catalog for subscription configuration (Storage, Machines, RFID Cards, Bank Accounts, Notification Pricing)
   */
  static async getConfigurationCatalog() {
    const [storagePlans] = await pool.query(
      `SELECT sm.id, sm.plan_name, sm.storage_capacity, sm.capacity_unit_id, sm.monthly_price, sm.annual_price, sm.description,
              cu.unit_name, cu.unit_code, cu.factor_in_mb
       FROM storage_master sm
       LEFT JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
       WHERE sm.status = 1
       ORDER BY (sm.storage_capacity * COALESCE(cu.factor_in_mb, 1024)) ASC`
    );

    const [attendanceMachines] = await pool.query(
      'SELECT id, machine_name, model_number, brand, machine_type, connectivity, user_capacity, log_capacity, push_protocol, unit_price, amc_price, machine_image, specifications FROM attendance_machine_master WHERE status = 1 ORDER BY unit_price ASC'
    );

    const [rfidCards] = await pool.query(
      'SELECT id, card_name, card_code, card_type, frequency, read_range, unit_price, min_order_qty, card_image, rfid_image, description FROM rfid_card_master WHERE status = 1 ORDER BY unit_price ASC'
    );

    const [bankAccounts] = await pool.query(
      'SELECT id, account_title, beneficiary_name, account_number, bank_name, branch_name, ifsc_code, account_type, upi_id, swift_code, instructions, qr_code_image, is_default, status FROM bank_account_master WHERE status = 1 ORDER BY is_default DESC, id ASC'
    );

    const [notificationPricing] = await pool.query(
      'SELECT id, channel, pack_name, unit_price, min_qty, description, status FROM notification_pricing_master WHERE status = 1 ORDER BY id ASC'
    );

    const enrichedStoragePlans = (storagePlans || []).map((sp) => {
      const cycle_prices = {};
      for (const c of ALL_BILLING_CYCLE_LIST) {
        cycle_prices[c] = SubscriptionPolicyService.computeStorageCyclePrice(sp, c);
      }
      return {
        ...sp,
        cycle_prices,
      };
    });

    // Backwards-compatible shape for existing UI components reading `notification_records`
    const notificationRecords = (notificationPricing || []).map((np) => ({
      id: np.id,
      type: np.channel,
      channel: np.channel,
      name: np.pack_name,
      pack_name: np.pack_name,
      message: np.description || np.pack_name,
      cost: parseFloat(np.unit_price) || 0,
      unit_price: parseFloat(np.unit_price) || 0,
      min_qty: Math.max(1, parseInt(np.min_qty, 10) || 1),
      status: np.status,
    }));

    return {
      storage_plans: enrichedStoragePlans,
      attendance_machines: attendanceMachines || [],
      rfid_cards: rfidCards || [],
      bank_accounts: bankAccounts || [],
      notification_pricing: notificationPricing || [],
      notification_records: notificationRecords,
    };
  }
}

module.exports = SubscriptionModel;
