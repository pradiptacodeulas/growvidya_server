const { pool } = require('../config/db.config');
const CouponModel = require('../models/coupon.model');
const {
  getTodayIST,
  parseDateParts,
  formatDateParts,
  addCycleDuration,
  getCycleMonths,
  getCycleMeta,
} = require('../constants/subscriptionModules.constant');

function normalizeDateStr(val) {
  if (!val) return null;
  return formatDateParts(parseDateParts(val));
}

function createPolicyError(message, code = 'SUBSCRIPTION_POLICY_VIOLATION', statusCode = 400, meta = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.meta = meta;
  return err;
}

class SubscriptionPolicyService {
  /**
   * Compute storage unit rate cleanly across all 4 paid cycles using storage_master (monthly_price, annual_price)
   */
  static computeStorageCyclePrice(storageRow, billingCycle = 'annual') {
    const monthly = parseFloat(storageRow.monthly_price) || 0;
    const annual = parseFloat(storageRow.annual_price) || 0;
    const cycle = String(billingCycle || 'annual').toLowerCase();

    if (cycle === 'monthly') {
      return monthly > 0 ? monthly : Math.round((annual / 12) * 100) / 100;
    }
    if (cycle === 'quarterly') {
      if (monthly > 0 && annual > 0) return Math.round(Math.min(annual, monthly * 3) * 100) / 100;
      return monthly > 0 ? Math.round(monthly * 3 * 100) / 100 : Math.round((annual / 4) * 100) / 100;
    }
    if (cycle === 'half_yearly') {
      if (monthly > 0 && annual > 0) return Math.round(Math.min(annual, monthly * 6) * 100) / 100;
      return monthly > 0 ? Math.round(monthly * 6 * 100) / 100 : Math.round((annual / 2) * 100) / 100;
    }
    return annual > 0 ? annual : Math.round(monthly * 12 * 100) / 100;
  }

  /**
   * Deterministic SaaS Plan Transition & Strict No-Downgrade Classifier.
   * Zero hardcoded plan names or prices — uses dynamic DB tier_rank, billing_cycle, and max_students.
   */
  static classifyPlanTransition({
    activeSub = null,
    lastPaidSub = null,
    hasClaimedTrial = false,
    targetPlan,
    isTrialIntent = false,
    activeStudentCount = 0,
    baseDateStr = null,
  }) {
    if (!targetPlan) {
      return {
        allowed: false,
        code: 'PLAN_NOT_FOUND',
        transition_type: 'invalid',
        action_type: 'renewal',
        reason: 'Selected subscription plan does not exist or is inactive.',
      };
    }

    const todayStr = baseDateStr ? normalizeDateStr(baseDateStr) : getTodayIST();
    const isTargetTrial = Boolean(isTrialIntent) || String(targetPlan.billing_cycle).toLowerCase() === 'trial';

    // 1. Free Trial Rules: Strictly one free trial ever per school across ALL plans
    if (isTargetTrial) {
      const trialDays = Math.max(0, parseInt(targetPlan.free_trial_days, 10) || 0);
      if (trialDays <= 0) {
        return {
          allowed: false,
          code: 'TRIAL_NOT_AVAILABLE',
          transition_type: 'trial_unavailable',
          action_type: 'trial',
          reason: `The "${targetPlan.plan_name}" plan does not offer a free trial.`,
        };
      }
      if (hasClaimedTrial || activeSub || lastPaidSub) {
        return {
          allowed: false,
          code: 'TRIAL_ALREADY_USED',
          transition_type: 'downgrade_locked',
          action_type: 'trial',
          is_downgrade: true,
          reason: 'Free trials can only be claimed once per school during initial onboarding.',
        };
      }

      const targetMaxStudents = parseInt(targetPlan.max_students, 10) || 0;
      if (targetMaxStudents > 0 && activeStudentCount > targetMaxStudents) {
        return {
          allowed: false,
          code: 'QUOTA_BELOW_ACTIVE_USAGE',
          transition_type: 'quota_locked',
          action_type: 'trial',
          reason: `Your school has ${activeStudentCount} active students, which exceeds the ${targetMaxStudents}-student limit of "${targetPlan.plan_name}".`,
        };
      }

      return {
        allowed: true,
        code: 'OK',
        transition_type: 'trial',
        action_type: 'trial',
        is_downgrade: false,
        is_renewal: false,
        is_upgrade: false,
        stacks_dates: false,
        start_date: todayStr,
        end_date: addCycleDuration(todayStr, 'trial', trialDays),
        reason: `${trialDays}-day free trial evaluation.`,
      };
    }

    // 2. Quota Floor Guard against live student count (Teachers & Branches are Unlimited across all plans)
    const targetMaxStudents = parseInt(targetPlan.max_students, 10) || 0;
    if (targetMaxStudents > 0 && activeStudentCount > targetMaxStudents) {
      return {
        allowed: false,
        code: 'QUOTA_BELOW_ACTIVE_USAGE',
        transition_type: 'quota_locked',
        action_type: 'upgrade',
        is_quota_locked: true,
        reason: `Your school currently has ${activeStudentCount} active students, exceeding the ${targetMaxStudents}-student limit of "${targetPlan.plan_name}". Please choose a higher capacity plan.`,
      };
    }

    // 3. Reference subscription for Strict No-Downgrade Policy (persists even after plan expiry!)
    const activeIsPaidAndLive = Boolean(
      activeSub &&
      !activeSub.isTrial &&
      activeSub.status === 'active' &&
      !activeSub.isExpired
    );
    const referencePaidSub = activeIsPaidAndLive ? activeSub : lastPaidSub;

    // 4. First paid plan ever (New onboarding OR converting from an active/expired Free Trial)
    if (!referencePaidSub) {
      const isFromTrial = Boolean(activeSub?.isTrial || hasClaimedTrial);
      return {
        allowed: true,
        code: 'OK',
        transition_type: isFromTrial ? 'trial_conversion' : 'onboarding',
        action_type: isFromTrial ? 'upgrade' : 'onboarding',
        is_downgrade: false,
        is_renewal: false,
        is_upgrade: true,
        stacks_dates: false,
        start_date: todayStr,
        end_date: addCycleDuration(todayStr, targetPlan.billing_cycle),
        reason: isFromTrial
          ? `Upgrading from Free Trial to ${targetPlan.plan_name}.`
          : `Activating ${targetPlan.plan_name}.`,
      };
    }

    const refTierRank = Math.max(1, parseInt(referencePaidSub.tier_rank, 10) || 1);
    const targetTierRank = Math.max(1, parseInt(targetPlan.tier_rank, 10) || 1);
    const refCycleMonths = getCycleMonths(referencePaidSub.billing_cycle);
    const targetCycleMonths = getCycleMonths(targetPlan.billing_cycle);

    // 5. Rule A: Strict Tier No-Downgrade (even post-expiry)
    if (targetTierRank < refTierRank) {
      return {
        allowed: false,
        code: 'DOWNGRADE_NOT_ALLOWED',
        transition_type: 'downgrade_locked',
        action_type: 'upgrade',
        is_downgrade: true,
        reason: `Downgrading from "${referencePaidSub.plan_name}" (Tier ${refTierRank}) to "${targetPlan.plan_name}" (Tier ${targetTierRank}) is not permitted.`,
      };
    }

    // 6. Rule B: Same-Tier Billing Cycle Shrink Blocked (e.g. Annual -> Monthly on same tier)
    if (targetTierRank === refTierRank && targetCycleMonths < refCycleMonths) {
      const refMeta = getCycleMeta(referencePaidSub.billing_cycle);
      const targetMeta = getCycleMeta(targetPlan.billing_cycle);
      const article = /^[aeiou]/i.test(refMeta.label || '') ? 'an' : 'a';
      return {
        allowed: false,
        code: 'CYCLE_DOWNGRADE_NOT_ALLOWED',
        transition_type: 'downgrade_locked',
        action_type: 'renewal',
        is_downgrade: true,
        reason: `Switching from ${article} ${refMeta.label} commitment to a shorter ${targetMeta.label} cycle on "${targetPlan.plan_name}" is not permitted.`,
      };
    }

    // 7. Rule C: Active Longer-Cycle Subscriber Upgrading to Shorter-Cycle Higher Tier Blocked
    if (activeIsPaidAndLive && targetTierRank > refTierRank) {
      const activeCycleMonths = getCycleMonths(activeSub.billing_cycle);
      if (targetCycleMonths < activeCycleMonths) {
        const activeMeta = getCycleMeta(activeSub.billing_cycle);
        const targetMeta = getCycleMeta(targetPlan.billing_cycle);
        return {
          allowed: false,
          code: 'ACTIVE_CYCLE_SHRINK_NOT_ALLOWED',
          transition_type: 'downgrade_locked',
          action_type: 'upgrade',
          is_downgrade: true,
          reason: `While your ${activeMeta.label} plan is active, upgrades must use an equal or longer billing cycle (${activeMeta.label}) rather than ${targetMeta.label} so your remaining validity is protected.`,
        };
      }
    }

    // 8. Same Tier Allowed Transitions: Early Renewal (Date Stacking!) vs Post-Expiry Renewal vs Cycle Upgrade
    if (targetTierRank === refTierRank) {
      const activeEndStr = activeIsPaidAndLive ? normalizeDateStr(activeSub.end_date) : null;
      const canStackDates = Boolean(activeIsPaidAndLive && activeEndStr && activeEndStr >= todayStr);

      if (canStackDates) {
        const stackedEndDate = addCycleDuration(activeEndStr, targetPlan.billing_cycle);
        const isCycleUpgrade = targetCycleMonths > refCycleMonths;
        return {
          allowed: true,
          code: 'OK',
          transition_type: isCycleUpgrade ? 'cycle_upgrade' : 'early_renewal',
          action_type: 'renewal',
          is_downgrade: false,
          is_renewal: true,
          is_upgrade: isCycleUpgrade,
          stacks_dates: true,
          previous_end_date: activeEndStr,
          start_date: normalizeDateStr(activeSub.start_date) || todayStr,
          end_date: stackedEndDate,
          reason: `Extends your active subscription from ${activeEndStr} to ${stackedEndDate} (100% of remaining days preserved).`,
        };
      }

      const freshEndDate = addCycleDuration(todayStr, targetPlan.billing_cycle);
      return {
        allowed: true,
        code: 'OK',
        transition_type: 'post_expiry_renewal',
        action_type: 'renewal',
        is_downgrade: false,
        is_renewal: true,
        is_upgrade: false,
        stacks_dates: false,
        start_date: todayStr,
        end_date: freshEndDate,
        reason: `Renews ${targetPlan.plan_name} from ${todayStr} to ${freshEndDate}.`,
      };
    }

    // 9. Higher Tier Upgrade (Full Target Price, Immediate Fresh Cycle)
    const upgradeEndDate = addCycleDuration(todayStr, targetPlan.billing_cycle);
    return {
      allowed: true,
      code: 'OK',
      transition_type: 'upgrade',
      action_type: 'upgrade',
      is_downgrade: false,
      is_renewal: false,
      is_upgrade: true,
      stacks_dates: false,
      start_date: todayStr,
      end_date: upgradeEndDate,
      reason: `Immediate upgrade to ${targetPlan.plan_name} (${todayStr} to ${upgradeEndDate}).`,
    };
  }

  /**
   * Server-Authoritative Zero-GST Checkout & Add-on Calculator.
   * - Never trusts client prices or totals.
   * - Enforces RFID min_order_qty and Notification min_qty & active catalog status.
   * - Applies coupons strictly to coupon.applicable_scope ('plan_only' by default, protecting hardware & SMS).
   * - Zero GST everywhere.
   */
  static async calculateVerifiedCheckout({
    plan = null,
    is_trial = false,
    is_addon_only = false,
    storage_plan_id = null,
    storage_qty = 1,
    storage_billing_cycle = null,
    selected_machines = [],
    selected_cards = [],
    selected_notifications = [],
    coupon_code = null,
    school_id = null,
    email = null,
    phone = null,
    connection = null,
    forUpdateCoupon = false,
  }) {
    const db = connection || pool;
    const isTrial = !is_addon_only && (Boolean(is_trial) || (plan && String(plan.billing_cycle).toLowerCase() === 'trial'));
    const planAmount = (!plan || isTrial || is_addon_only) ? 0 : Math.round((parseFloat(plan.price) || 0) * 100) / 100;
    const effectiveCycle = storage_billing_cycle || (plan && !isTrial ? plan.billing_cycle : 'annual');

    let storageAmount = 0;
    let machinesAmount = 0;
    let rfidAmount = 0;
    let notificationsAmount = 0;

    const breakdown = {
      is_trial: isTrial,
      is_addon_only: Boolean(is_addon_only),
      plan_id: plan ? plan.id : null,
      plan_name: plan ? plan.plan_name : null,
      plan_price: planAmount,
      billing_cycle: plan ? (isTrial ? 'trial' : plan.billing_cycle) : effectiveCycle,
      included_storage_gb: plan ? Math.max(0, parseInt(plan.included_storage_gb, 10) || 0) : null,
      storage: null,
      machines: [],
      cards: [],
      notifications: [],
      tax_amount: 0, // Strict Zero GST
    };

    // 1. Cloud Storage Add-on (storage_master)
    if (storage_plan_id) {
      const [sRows] = await db.query(
        `SELECT sm.id, sm.plan_name, sm.storage_capacity, sm.capacity_unit_id, sm.monthly_price, sm.annual_price,
                cu.unit_code, cu.unit_name, cu.factor_in_mb
         FROM storage_master sm
         LEFT JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
         WHERE sm.id = ? AND sm.status = 1
         LIMIT 1`,
        [parseInt(storage_plan_id, 10)]
      );
      if (sRows.length === 0) {
        throw createPolicyError('Selected cloud storage plan is invalid or inactive.', 'INVALID_STORAGE_PLAN', 400);
      }
      const s = sRows[0];
      const sCycle = String(effectiveCycle || 'annual').toLowerCase() === 'trial' ? 'annual' : effectiveCycle;
      const sUnitRate = SubscriptionPolicyService.computeStorageCyclePrice(s, sCycle);
      const sQuantity = Math.max(1, parseInt(storage_qty, 10) || 1);
      const sTotal = Math.round(sUnitRate * sQuantity * 100) / 100;
      storageAmount = sTotal;
      breakdown.storage = {
        id: s.id,
        plan_name: s.plan_name,
        storage_capacity: Number(s.storage_capacity),
        unit_code: s.unit_code || 'GB',
        factor_in_mb: Number(s.factor_in_mb) || 1024,
        billing_cycle: sCycle,
        quantity: sQuantity,
        unit_price: sUnitRate,
        total_price: sTotal,
      };
    }

    // 2. Biometric Attendance Machines (attendance_machine_master — One-Time Physical Goods)
    if (Array.isArray(selected_machines) && selected_machines.length > 0) {
      for (const entry of selected_machines) {
        const mId = parseInt(entry.id || entry.machine_id, 10);
        const mQty = parseInt(entry.quantity || entry.qty, 10) || 0;
        if (mId && mQty > 0) {
          const [mRows] = await db.query(
            'SELECT id, machine_name, model_number, unit_price FROM attendance_machine_master WHERE id = ? AND status = 1 LIMIT 1',
            [mId]
          );
          if (mRows.length === 0) {
            throw createPolicyError(`Selected attendance machine (#${mId}) is unavailable or inactive.`, 'INVALID_MACHINE', 400);
          }
          const m = mRows[0];
          const mUnitRate = parseFloat(m.unit_price) || 0;
          const mTotal = Math.round(mUnitRate * mQty * 100) / 100;
          machinesAmount = Math.round((machinesAmount + mTotal) * 100) / 100;
          breakdown.machines.push({
            id: m.id,
            machine_name: m.machine_name,
            model_number: m.model_number,
            quantity: mQty,
            unit_price: mUnitRate,
            total_price: mTotal,
          });
        }
      }
    }

    // 3. RFID Cards (rfid_card_master — Enforces min_order_qty!)
    if (Array.isArray(selected_cards) && selected_cards.length > 0) {
      for (const entry of selected_cards) {
        const cId = parseInt(entry.id || entry.card_id, 10);
        const cQty = parseInt(entry.quantity || entry.qty, 10) || 0;
        if (cId && cQty > 0) {
          const [cRows] = await db.query(
            'SELECT id, card_name, card_code, unit_price, min_order_qty FROM rfid_card_master WHERE id = ? AND status = 1 LIMIT 1',
            [cId]
          );
          if (cRows.length === 0) {
            throw createPolicyError(`Selected RFID card (#${cId}) is unavailable or inactive.`, 'INVALID_RFID_CARD', 400);
          }
          const c = cRows[0];
          const minQty = Math.max(1, parseInt(c.min_order_qty, 10) || 1);
          if (cQty < minQty) {
            throw createPolicyError(
              `Minimum order quantity for "${c.card_name}" is ${minQty} cards (selected: ${cQty}).`,
              'RFID_MIN_ORDER_QTY',
              400
            );
          }
          const cUnitRate = parseFloat(c.unit_price) || 0;
          const cTotal = Math.round(cUnitRate * cQty * 100) / 100;
          rfidAmount = Math.round((rfidAmount + cTotal) * 100) / 100;
          breakdown.cards.push({
            id: c.id,
            card_name: c.card_name,
            card_code: c.card_code,
            min_order_qty: minQty,
            quantity: cQty,
            unit_price: cUnitRate,
            total_price: cTotal,
          });
        }
      }
    }

    // 4. SMS & Push Notification Credits (Strictly from notification_pricing_master — never from log table!)
    if (Array.isArray(selected_notifications) && selected_notifications.length > 0) {
      const [pricingRows] = await db.query(
        'SELECT id, channel, pack_name, unit_price, min_qty, status FROM notification_pricing_master WHERE status = 1'
      );
      const pricingById = new Map();
      const pricingByChannel = new Map();
      for (const p of pricingRows) {
        pricingById.set(Number(p.id), p);
        pricingByChannel.set(String(p.channel).toLowerCase(), p);
      }

      for (const entry of selected_notifications) {
        const nId = parseInt(entry.id, 10);
        const nChannel = String(entry.type || entry.channel || '').toLowerCase();
        const nQty = parseInt(entry.quantity || entry.qty, 10) || 0;

        if (nQty > 0) {
          const pricing = (!isNaN(nId) && pricingById.get(nId)) || pricingByChannel.get(nChannel);
          if (!pricing || parseFloat(pricing.unit_price) <= 0) {
            throw createPolicyError(
              `Notification credit pack (${nChannel || nId}) is not currently available for purchase.`,
              'INVALID_NOTIFICATION_PACK',
              400
            );
          }
          const minQty = Math.max(1, parseInt(pricing.min_qty, 10) || 1);
          if (nQty < minQty) {
            throw createPolicyError(
              `Minimum purchase quantity for "${pricing.pack_name}" is ${minQty} credits.`,
              'NOTIFICATION_MIN_QTY',
              400
            );
          }
          const unitRate = parseFloat(pricing.unit_price);
          const nTotal = Math.round(unitRate * nQty * 100) / 100;
          notificationsAmount = Math.round((notificationsAmount + nTotal) * 100) / 100;
          breakdown.notifications.push({
            id: pricing.id,
            type: pricing.channel,
            channel: pricing.channel,
            name: pricing.pack_name,
            min_qty: minQty,
            quantity: nQty,
            unit_price: unitRate,
            total_price: nTotal,
          });
        }
      }
    }

    const addonsAmount = Math.round((storageAmount + machinesAmount + rfidAmount + notificationsAmount) * 100) / 100;
    const subtotalAmount = Math.round((planAmount + addonsAmount) * 100) / 100;

    // 5. Scoped Coupon Validation (protects physical hardware & SMS margins!)
    let couponInfo = null;
    let discountAmount = 0;

    if (coupon_code && String(coupon_code).trim()) {
      const couponValidation = await CouponModel.validateCoupon(coupon_code, subtotalAmount, school_id, {
        planAmount,
        storageAmount,
        email,
        phone,
        connection: db,
        forUpdate: forUpdateCoupon,
      });
      if (!couponValidation.valid) {
        throw createPolicyError(couponValidation.message, 'INVALID_COUPON', 400);
      }
      couponInfo = couponValidation.coupon;
      discountAmount = parseFloat(couponValidation.coupon.discountAmount) || 0;
    }

    // Net software plan amount after software-scoped discount (never negative)
    const netPlanAmount = Math.max(0, Math.round((planAmount - Math.min(planAmount, discountAmount)) * 100) / 100);
    const grandTotal = Math.max(0, Math.round((subtotalAmount - discountAmount) * 100) / 100);

    return {
      planAmount,
      netPlanAmount,
      storageAmount,
      machinesAmount,
      rfidAmount,
      notificationsAmount,
      addonsAmount,
      subtotalAmount,
      discountAmount,
      taxAmount: 0, // Zero GST
      grandTotal,
      totalAmount: grandTotal,
      originalAmount: subtotalAmount,
      couponInfo,
      breakdown,
    };
  }
}

module.exports = SubscriptionPolicyService;
