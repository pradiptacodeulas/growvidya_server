const { pool } = require('../config/db.config');
const CouponModel = require('../models/coupon.model');
const {
  getTodayIST,
  parseDateParts,
  formatDateParts,
  addCycleDuration,
  getCycleMonths,
  getCycleMeta,
  getActiveBillingCycles,
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
  static computeStorageCyclePrice(storageRow, billingCycle) {
    if (!storageRow) return 0;
    if (!billingCycle) {
      throw new Error('billingCycle is required for computeStorageCyclePrice.');
    }
    const monthly = parseFloat(storageRow.monthly_price) || 0;
    const annual = parseFloat(storageRow.annual_price) || 0;
    const cycleMonths = getCycleMonths(billingCycle);

    if (cycleMonths === 1) {
      return monthly > 0 ? monthly : Math.round((annual / 12) * 100) / 100;
    }
    if (cycleMonths >= 12) {
      // Annual or multi-year (e.g. 12 months = annual, 24 months = annual * 2, 36 months = annual * 3)
      const annualBase = annual > 0 ? annual : monthly * 12;
      return Math.round(annualBase * (cycleMonths / 12) * 100) / 100;
    }
    // Intermediate cycles (e.g. 3 months, 6 months)
    if (monthly > 0 && annual > 0) {
      return Math.round(Math.min(annual, monthly * cycleMonths) * 100) / 100;
    }
    return Math.round(monthly * cycleMonths * 100) / 100;
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
          reason: `Your school has ${activeStudentCount} enrolled students (active + inactive), which exceeds the ${targetMaxStudents}-student limit of "${targetPlan.plan_name}".`,
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

    // 2. Quota Floor Guard against live student count (Active + Inactive; Teachers & Branches are Unlimited across all plans)
    const targetMaxStudents = parseInt(targetPlan.max_students, 10) || 0;
    if (targetMaxStudents > 0 && activeStudentCount > targetMaxStudents) {
      return {
        allowed: false,
        code: 'QUOTA_BELOW_ACTIVE_USAGE',
        transition_type: 'quota_locked',
        action_type: 'upgrade',
        is_quota_locked: true,
        reason: `Your school currently has ${activeStudentCount} enrolled students (active + inactive), exceeding the ${targetMaxStudents}-student limit of "${targetPlan.plan_name}". Please choose a higher capacity plan.`,
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

    const refTierRank = Math.max(
      1,
      parseInt(referencePaidSub.tier_rank, 10) || 1,
      parseInt(lastPaidSub?.tier_rank, 10) || 1
    );
    const targetTierRank = Math.max(1, parseInt(targetPlan.tier_rank, 10) || 1);
    const refCycleMonths = Math.max(
      getCycleMonths(referencePaidSub.billing_cycle),
      lastPaidSub ? getCycleMonths(lastPaidSub.billing_cycle) : 0
    );
    const targetCycleMonths = getCycleMonths(targetPlan.billing_cycle);

    // 5. Rule A: Strict Tier No-Downgrade (both mid-cycle and post-expiry)
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

    // 6. Rule B: Strict Billing Cycle No-Downgrade (Monthly -> Annual is allowed, but Annual -> Monthly is strictly forbidden across all tiers, both mid-cycle and post-expiry)
    if (targetCycleMonths < refCycleMonths) {
      const refCycleSource =
        lastPaidSub && getCycleMonths(lastPaidSub.billing_cycle) > getCycleMonths(referencePaidSub.billing_cycle)
          ? lastPaidSub.billing_cycle
          : referencePaidSub.billing_cycle;
      const refMeta = getCycleMeta(refCycleSource);
      const targetMeta = getCycleMeta(targetPlan.billing_cycle);
      const article = /^[aeiou]/i.test(refMeta.label || '') ? 'an' : 'a';
      return {
        allowed: false,
        code: 'CYCLE_DOWNGRADE_NOT_ALLOWED',
        transition_type: 'downgrade_locked',
        action_type: targetTierRank > refTierRank ? 'upgrade' : 'renewal',
        is_downgrade: true,
        reason: `Switching from ${article} ${refMeta.label} plan to a shorter ${targetMeta.label} billing cycle is not permitted.`,
      };
    }

    // 7. Same Tier Transitions: Early Renewal (Date Stacking!) vs Post-Expiry Renewal vs Cycle Upgrade (Monthly -> Annual with Date Stacking when active)
    if (targetTierRank === refTierRank) {
      const activeEndStr = activeIsPaidAndLive ? normalizeDateStr(activeSub.end_date) : null;
      const canStackDates = Boolean(activeIsPaidAndLive && activeEndStr && activeEndStr >= todayStr);
      const isCycleUpgrade = targetCycleMonths > refCycleMonths;

      if (canStackDates) {
        const stackedEndDate = addCycleDuration(activeEndStr, targetPlan.billing_cycle);
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
        transition_type: isCycleUpgrade ? 'cycle_upgrade' : 'post_expiry_renewal',
        action_type: 'renewal',
        is_downgrade: false,
        is_renewal: true,
        is_upgrade: isCycleUpgrade,
        stacks_dates: false,
        start_date: todayStr,
        end_date: freshEndDate,
        reason: `Renews ${targetPlan.plan_name} from ${todayStr} to ${freshEndDate}.`,
      };
    }

    // 8. Higher Tier Upgrade (Full Target Price, Immediate Fresh Cycle)
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
    state_id = null,
    state_name = null,
    email = null,
    phone = null,
    exclude_order_id = null,
    connection = null,
    forUpdateCoupon = false,
  }) {
    const db = connection || pool;
    const isTrial = !is_addon_only && (Boolean(is_trial) || (plan && String(plan.billing_cycle).toLowerCase() === 'trial'));
    const planAmount = (!plan || isTrial || is_addon_only) ? 0 : Math.round((parseFloat(plan.price) || 0) * 100) / 100;
    const activePaid = getActiveBillingCycles(true);
    const dynamicDefaultCycle = activePaid[0]?.code || null;
    const effectiveCycle = storage_billing_cycle || (plan && !isTrial ? plan.billing_cycle : dynamicDefaultCycle);

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
      const sCycle = (!effectiveCycle || String(effectiveCycle).toLowerCase() === 'trial') ? dynamicDefaultCycle : effectiveCycle;
      if (!sCycle) {
        throw createPolicyError('Valid storage billing cycle is required.', 'INVALID_STORAGE_BILLING_CYCLE', 400);
      }
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

    // 5. Scoped Coupon Validation (protects physical hardware & SMS margins; never burns coupons on ₹0 free trials)
    let couponInfo = null;
    let discountAmount = 0;
    let payableDiscountAmount = 0;

    if (coupon_code && String(coupon_code).trim()) {
      if (isTrial && planAmount === 0) {
        // On a Free Trial, coupons only apply if the school is purchasing eligible paid add-ons alongside the trial
        if (subtotalAmount <= 0) {
          throw createPolicyError(
            'Coupons cannot be applied to a ₹0 free trial without eligible add-ons.',
            'INVALID_COUPON',
            400
          );
        }
        const existingCoupon = await CouponModel.getByCode(coupon_code);
        if (!existingCoupon) {
          throw createPolicyError('Invalid coupon code.', 'INVALID_COUPON', 400);
        }
        const couponScope = String(existingCoupon.applicable_scope || 'plan_only').toLowerCase();
        const trialEligibleAmt =
          couponScope === 'all'
            ? subtotalAmount
            : couponScope === 'software_and_storage'
            ? storageAmount
            : 0;

        if (trialEligibleAmt <= 0) {
          throw createPolicyError(
            couponScope === 'plan_only'
              ? 'This coupon applies to paid software subscription plans only and cannot discount free trial add-ons.'
              : 'This coupon applies to software plans and cloud storage only.',
            'INVALID_COUPON',
            400
          );
        }

        const couponValidation = await CouponModel.validateCoupon(coupon_code, subtotalAmount, school_id, {
          planAmount: 0,
          storageAmount,
          email,
          phone,
          excludeOrderId: exclude_order_id || null,
          connection: db,
          forUpdate: forUpdateCoupon,
          isCheckoutVerification: true,
        });
        if (!couponValidation.valid) {
          throw createPolicyError(couponValidation.message, 'INVALID_COUPON', 400);
        }
        couponInfo = couponValidation.coupon;
        discountAmount = parseFloat(couponValidation.coupon.discountAmount) || 0;
        payableDiscountAmount = discountAmount;
      } else {
        const couponValidation = await CouponModel.validateCoupon(coupon_code, subtotalAmount, school_id, {
          planAmount,
          storageAmount,
          email,
          phone,
          excludeOrderId: exclude_order_id || null,
          connection: db,
          forUpdate: forUpdateCoupon,
          isCheckoutVerification: true,
        });
        if (!couponValidation.valid) {
          throw createPolicyError(couponValidation.message, 'INVALID_COUPON', 400);
        }
        couponInfo = couponValidation.coupon;
        discountAmount = parseFloat(couponValidation.coupon.discountAmount) || 0;
        payableDiscountAmount = discountAmount;
      }
    }

    // 6. Proportional Coupon Discount Allocation across eligible line items
    // Ensures netPlanAmount + netAddonsAmount === grandTotal and add-on revenue tables record actual net revenue collected.
    const scope = String(couponInfo?.applicable_scope || couponInfo?.applicableScope || 'plan_only').toLowerCase();
    const eligibleItems = [];

    if (planAmount > 0) {
      eligibleItems.push({ kind: 'plan', gross: planAmount, discount: 0, net: planAmount });
    }
    if (breakdown.storage) {
      breakdown.storage.gross_total_price = breakdown.storage.total_price;
      breakdown.storage.discount_amount = 0;
      breakdown.storage.net_total_price = breakdown.storage.total_price;
      if ((scope === 'software_and_storage' || scope === 'all') && breakdown.storage.total_price > 0) {
        eligibleItems.push({
          kind: 'storage',
          ref: breakdown.storage,
          gross: breakdown.storage.total_price,
          discount: 0,
          net: breakdown.storage.total_price,
        });
      }
    }
    for (const m of breakdown.machines) {
      m.gross_total_price = m.total_price;
      m.discount_amount = 0;
      m.net_total_price = m.total_price;
      if (scope === 'all' && m.total_price > 0) {
        eligibleItems.push({ kind: 'machine', ref: m, gross: m.total_price, discount: 0, net: m.total_price });
      }
    }
    for (const c of breakdown.cards) {
      c.gross_total_price = c.total_price;
      c.discount_amount = 0;
      c.net_total_price = c.total_price;
      if (scope === 'all' && c.total_price > 0) {
        eligibleItems.push({ kind: 'card', ref: c, gross: c.total_price, discount: 0, net: c.total_price });
      }
    }
    for (const n of breakdown.notifications) {
      n.gross_total_price = n.total_price;
      n.discount_amount = 0;
      n.net_total_price = n.total_price;
      if (scope === 'all' && n.total_price > 0) {
        eligibleItems.push({ kind: 'notification', ref: n, gross: n.total_price, discount: 0, net: n.total_price });
      }
    }

    const totalEligibleGross =
      Math.round(eligibleItems.reduce((sum, it) => sum + it.gross, 0) * 100) / 100;

    if (payableDiscountAmount > 0 && totalEligibleGross > 0 && eligibleItems.length > 0) {
      let remainingDiscount = Math.min(totalEligibleGross, payableDiscountAmount);
      for (let i = 0; i < eligibleItems.length; i++) {
        const it = eligibleItems[i];
        let itemDisc = 0;
        if (i === eligibleItems.length - 1) {
          itemDisc = Math.min(it.gross, Math.round(remainingDiscount * 100) / 100);
        } else {
          const rawShare = Math.round(((payableDiscountAmount * it.gross) / totalEligibleGross) * 100) / 100;
          itemDisc = Math.min(it.gross, Math.min(remainingDiscount, rawShare));
        }
        remainingDiscount = Math.max(0, Math.round((remainingDiscount - itemDisc) * 100) / 100);
        it.discount = itemDisc;
        it.net = Math.max(0, Math.round((it.gross - itemDisc) * 100) / 100);
        if (it.ref) {
          it.ref.discount_amount = it.discount;
          it.ref.net_total_price = it.net;
        }
      }
    }

    const planEligibleEntry = eligibleItems.find((it) => it.kind === 'plan');
    const netPlanAmount = planEligibleEntry ? planEligibleEntry.net : planAmount;
    const netStorageAmount = breakdown.storage ? breakdown.storage.net_total_price : 0;
    const netMachinesAmount =
      Math.round(breakdown.machines.reduce((s, m) => s + m.net_total_price, 0) * 100) / 100;
    const netRfidAmount =
      Math.round(breakdown.cards.reduce((s, c) => s + c.net_total_price, 0) * 100) / 100;
    const netNotificationsAmount =
      Math.round(breakdown.notifications.reduce((s, n) => s + n.net_total_price, 0) * 100) / 100;
    const netAddonsAmount =
      Math.round((netStorageAmount + netMachinesAmount + netRfidAmount + netNotificationsAmount) * 100) / 100;
    const taxableAmount = Math.max(0, Math.round((subtotalAmount - payableDiscountAmount) * 100) / 100);

    const GstSettingModel = require('../models/gstSetting.model');
    const taxCalc = await GstSettingModel.calculateTax({
      taxableAmount,
      schoolId: school_id,
      stateId: state_id,
      stateName: state_name,
      connection: db,
    });

    const taxAmount = taxCalc.tax_amount;
    const grandTotal = Math.max(0, Math.round((taxableAmount + taxAmount) * 100) / 100);

    breakdown.plan_discount_amount = planEligibleEntry ? planEligibleEntry.discount : 0;
    breakdown.net_plan_price = netPlanAmount;
    breakdown.net_addons_amount = netAddonsAmount;
    breakdown.taxable_amount = taxableAmount;
    breakdown.tax_type = taxCalc.tax_type;
    breakdown.billing_state_id = taxCalc.billing_state_id;
    breakdown.billing_state_name = taxCalc.billing_state_name;
    breakdown.home_state_id = taxCalc.home_state_id;
    breakdown.home_state_name = taxCalc.home_state_name;
    breakdown.gst_percentage = taxCalc.gst_percentage;
    breakdown.cgst_percentage = taxCalc.cgst_percentage;
    breakdown.cgst_amount = taxCalc.cgst_amount;
    breakdown.sgst_percentage = taxCalc.sgst_percentage;
    breakdown.sgst_amount = taxCalc.sgst_amount;
    breakdown.igst_percentage = taxCalc.igst_percentage;
    breakdown.igst_amount = taxCalc.igst_amount;
    breakdown.tax_percentage = taxCalc.tax_percentage;
    breakdown.tax_amount = taxAmount;

    return {
      planAmount,
      netPlanAmount,
      storageAmount,
      netStorageAmount,
      machinesAmount,
      netMachinesAmount,
      rfidAmount,
      netRfidAmount,
      notificationsAmount,
      netNotificationsAmount,
      addonsAmount,
      netAddonsAmount,
      subtotalAmount,
      discountAmount,
      taxableAmount,
      taxType: taxCalc.tax_type,
      billingStateId: taxCalc.billing_state_id,
      billingStateName: taxCalc.billing_state_name,
      cgstPercentage: taxCalc.cgst_percentage,
      cgstAmount: taxCalc.cgst_amount,
      sgstPercentage: taxCalc.sgst_percentage,
      sgstAmount: taxCalc.sgst_amount,
      igstPercentage: taxCalc.igst_percentage,
      igstAmount: taxCalc.igst_amount,
      taxPercentage: taxCalc.tax_percentage,
      taxAmount,
      grandTotal,
      totalAmount: grandTotal,
      originalAmount: subtotalAmount,
      couponInfo,
      breakdown,
    };
  }
}

module.exports = SubscriptionPolicyService;
