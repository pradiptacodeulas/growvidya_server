const { pool } = require('../config/db.config');
const CouponModel = require('../models/coupon.model');
const SubscriptionSchemaModel = require('../models/subscriptionSchema.model');
const SubscriptionPolicyService = require('./subscriptionPolicy.service');
const SubscriptionAlertService = require('./subscriptionAlert.service');
const {
  getTodayIST,
  parseDateParts,
  formatDateParts,
  addCycleDuration,
  getBillingCycleMeta,
} = require('../constants/subscriptionModules.constant');

function normalizeDateStr(val) {
  if (!val) return null;
  return formatDateParts(parseDateParts(val));
}

function generateOrderNo(prefix = 'ORD') {
  const todayCompact = getTodayIST().replace(/-/g, '');
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${todayCompact}-${rand}`;
}

function formatInvoiceNo(orderId, dateStr = null) {
  const year = (dateStr || getTodayIST()).slice(0, 4);
  return `INV-${year}-${String(orderId).padStart(5, '0')}`;
}

class SubscriptionFulfillmentService {
  /**
   * Load school's current active/trial subscription, last paid subscription, trial history, and active student count
   * inside or outside an active DB transaction.
   */
  static async loadSchoolLifecycleSnapshot(schoolId, connection = null, forUpdate = false) {
    const db = connection || pool;
    const parsedSchoolId = parseInt(schoolId, 10);
    if (!parsedSchoolId) {
      return {
        activeSub: null,
        lastPaidSub: null,
        pendingSub: null,
        hasClaimedTrial: false,
        activeStudentCount: 0,
      };
    }

    const todayStr = getTodayIST();
    const lockClause = forUpdate && connection ? ' FOR UPDATE' : '';

    const [subs] = await db.query(
      `SELECT s.*, p.plan_name, p.plan_code, p.plan_group,
              COALESCE(s.snapshot_billing_cycle, p.billing_cycle) AS billing_cycle,
              COALESCE(s.snapshot_tier_rank, p.tier_rank) AS tier_rank,
              p.price AS catalog_price,
              COALESCE(s.snapshot_max_students, p.max_students) AS max_students,
              COALESCE(s.snapshot_storage_gb, p.included_storage_gb) AS included_storage_gb,
              p.included_push_credits, p.included_sms_credits, p.free_trial_days,
              DATEDIFF(s.end_date, ?) AS days_left
       FROM school_subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.school_id = ?
         AND s.status NOT IN ('rejected', 'superseded')
       ORDER BY s.id DESC${lockClause}`,
      [todayStr, parsedSchoolId]
    );

    const [histRows] = await db.query(
      `SELECT s.id, s.plan_id, s.status, s.action_type, s.payment_gateway, s.storage_plan_id,
              p.plan_name, p.plan_code, p.plan_group, p.price AS catalog_price,
              COALESCE(s.snapshot_billing_cycle, p.billing_cycle) AS billing_cycle,
              COALESCE(s.snapshot_tier_rank, p.tier_rank) AS tier_rank
       FROM school_subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.school_id = ? AND s.status = 'superseded'
       ORDER BY COALESCE(s.snapshot_tier_rank, p.tier_rank) DESC, s.id DESC`,
      [parsedSchoolId]
    );

    // If Super Admin manually assigned a plan, that override becomes the new baseline floor (older superseded/expired rows do not lock renewals)
    let latestManualOverrideId = 0;
    for (const r of subs) {
      if (r.action_type === 'manual_override' && r.status !== 'pending' && Number(r.id) > latestManualOverrideId) {
        latestManualOverrideId = Number(r.id);
      }
    }
    for (const h of histRows) {
      if (h.action_type === 'manual_override' && Number(h.id) > latestManualOverrideId) {
        latestManualOverrideId = Number(h.id);
      }
    }

    let activeSub = null;
    let lastPaidSub = null;
    let pendingSub = null;
    let hasClaimedTrial = false;

    for (const row of subs) {
      const isTrialRow = row.status === 'trial' || String(row.billing_cycle).toLowerCase() === 'trial' || row.payment_gateway === 'free_trial';
      const daysLeft = Number(row.days_left);
      const isExpired = daysLeft < 0 || row.status === 'expired';

      if (isTrialRow) {
        hasClaimedTrial = true;
      }

      if (row.status === 'pending') {
        if (!pendingSub) pendingSub = { ...row, isTrial: isTrialRow, isExpired: false };
        continue;
      }

      if (!isTrialRow && row.status !== 'pending' && Number(row.id) >= latestManualOverrideId) {
        const rowRank = Number(row.tier_rank) || 1;
        const rowMonths = getBillingCycleMeta(row.billing_cycle)?.months || 1;
        const lastRank = lastPaidSub ? Number(lastPaidSub.tier_rank) || 1 : 0;
        const lastMonths = lastPaidSub ? getBillingCycleMeta(lastPaidSub.billing_cycle)?.months || 1 : 0;

        // Track highest tier_rank and longest billing_cycle paid subscription since latest manual override
        if (
          !lastPaidSub ||
          rowRank > lastRank ||
          (rowRank === lastRank && rowMonths > lastMonths) ||
          (rowRank === lastRank && rowMonths === lastMonths && row.id > lastPaidSub.id)
        ) {
          lastPaidSub = { ...row, isTrial: false, isExpired };
        }
      }

      if (!activeSub && (row.status === 'active' || row.status === 'trial') && !isExpired) {
        activeSub = { ...row, isTrial: isTrialRow, isExpired: false };
      }
    }

    for (const h of histRows) {
      const isTr = String(h.billing_cycle).toLowerCase() === 'trial' || h.payment_gateway === 'free_trial';
      if (isTr) {
        hasClaimedTrial = true;
      } else if (Number(h.id) >= latestManualOverrideId) {
        const hRank = Number(h.tier_rank) || 1;
        const hMonths = getBillingCycleMeta(h.billing_cycle)?.months || 1;
        const lastRank = lastPaidSub ? Number(lastPaidSub.tier_rank) || 1 : 0;
        const lastMonths = lastPaidSub ? getBillingCycleMeta(lastPaidSub.billing_cycle)?.months || 1 : 0;

        if (
          !lastPaidSub ||
          hRank > lastRank ||
          (hRank === lastRank && hMonths > lastMonths)
        ) {
          lastPaidSub = { ...h, isTrial: false, isExpired: true };
        }
      }
    }

    // Student quota counts both Active (status = 1) and Inactive (status = 2) students, excluding soft-deleted (status = 4)
    const [[stuRow]] = await db.query(
      'SELECT COUNT(id) AS cnt FROM student_master WHERE school_id = ? AND status IN (1, 2)',
      [parsedSchoolId]
    );

    return {
      activeSub,
      lastPaidSub,
      pendingSub,
      hasClaimedTrial,
      activeStudentCount: parseInt(stuRow?.cnt, 10) || 0,
    };
  }

  /**
   * Create an immutable server-side checkout order intent in `subscription_payment_orders`.
   * For `bank_transfer`, also creates the `pending` subscription & pending add-on rows for Super Admin queue.
   */
  static async createOrderIntent({
    schoolId = null,
    orderType = 'renewal', // 'onboarding' | 'trial_with_addons' | 'renewal' | 'upgrade' | 'addon_only'
    actionType = 'renewal',
    plan = null,
    verifiedCalc,
    transition = null,
    paymentMethod = 'razorpay',
    razorpayOrderId = null,
    utrNumber = null,
    bankAccountId = null,
    shippingAddress = null,
    extraMetadata = {},
  }) {
    await SubscriptionSchemaModel.initTable();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const parsedSchoolId = schoolId ? parseInt(schoolId, 10) : null;
      const cleanUtr = utrNumber && String(utrNumber).trim() ? String(utrNumber).trim().toUpperCase() : null;
      let resolvedBankAccountId = null;
      let resolvedBankSnapshot = null;

      // Enforce unique UTR number & prevent duplicate pending offline requests (both subscription & standalone add-on orders)
      if (paymentMethod === 'bank_transfer') {
        if (!cleanUtr) {
          const err = new Error('UTR / Bank Transaction Reference Number is required for offline bank transfer orders.');
          err.statusCode = 400;
          err.code = 'UTR_REQUIRED';
          throw err;
        }

        if (bankAccountId !== null && bankAccountId !== undefined && String(bankAccountId).trim() !== '') {
          const parsedBankId = parseInt(bankAccountId, 10);
          if (!parsedBankId || parsedBankId <= 0) {
            const err = new Error('Please select a valid active company bank account.');
            err.statusCode = 400;
            err.code = 'INVALID_BANK_ACCOUNT';
            throw err;
          }
          const [bankRows] = await conn.query(
            `SELECT id, account_title, beneficiary_name, account_number, bank_name, branch_name, ifsc_code, upi_id
             FROM bank_account_master
             WHERE id = ? AND status = 1
             LIMIT 1`,
            [parsedBankId]
          );
          if (bankRows.length === 0) {
            const err = new Error('Selected company bank account is inactive or does not exist.');
            err.statusCode = 400;
            err.code = 'INVALID_BANK_ACCOUNT';
            throw err;
          }
          resolvedBankAccountId = bankRows[0].id;
          resolvedBankSnapshot = bankRows[0];
        } else {
          const [defaultBankRows] = await conn.query(
            `SELECT id, account_title, beneficiary_name, account_number, bank_name, branch_name, ifsc_code, upi_id
             FROM bank_account_master
             WHERE status = 1
             ORDER BY is_default DESC, id ASC
             LIMIT 1`
          );
          if (defaultBankRows.length > 0) {
            resolvedBankAccountId = defaultBankRows[0].id;
            resolvedBankSnapshot = defaultBankRows[0];
          }
        }

        const [existingUtrRows] = await conn.query(
          `SELECT id FROM subscription_payment_orders
           WHERE UPPER(TRIM(utr_number)) = ? AND status NOT IN ('rejected', 'failed')
           UNION ALL
           SELECT id FROM school_subscriptions
           WHERE UPPER(TRIM(payment_transaction_id)) = ? AND status != 'rejected'
           LIMIT 1`,
          [cleanUtr, cleanUtr]
        );
        if (existingUtrRows.length > 0) {
          const err = new Error(
            'This UTR / Transaction Reference Number has already been submitted for another order. Please provide a unique transaction reference.'
          );
          err.statusCode = 409;
          err.code = 'UTR_ALREADY_USED';
          throw err;
        }

        if (parsedSchoolId) {
          if (orderType !== 'addon_only') {
            const [existingPending] = await conn.query(
              `SELECT id, plan_id FROM school_subscriptions
               WHERE school_id = ? AND status = 'pending'
               LIMIT 1 FOR UPDATE`,
              [parsedSchoolId]
            );
            if (existingPending.length > 0) {
              const err = new Error(
                'Your school already has an offline bank transfer request awaiting Super Admin verification. Please wait for verification or pay via Razorpay for instant activation.'
              );
              err.statusCode = 409;
              err.code = 'DUPLICATE_PENDING_REQUEST';
              throw err;
            }
          } else {
            const [existingPendingAddon] = await conn.query(
              `SELECT id FROM subscription_payment_orders
               WHERE school_id = ? AND order_type = 'addon_only' AND status = 'pending_verification'
               LIMIT 1 FOR UPDATE`,
              [parsedSchoolId]
            );
            if (existingPendingAddon.length > 0) {
              const err = new Error(
                'Your school already has an offline add-on order awaiting Super Admin verification. Please wait for verification or pay via Razorpay for instant activation.'
              );
              err.statusCode = 409;
              err.code = 'DUPLICATE_PENDING_REQUEST';
              throw err;
            }
          }
        }
      }

      let resolvedShipping = shippingAddress || null;
      if (!resolvedShipping && parsedSchoolId) {
        const [sch] = await conn.query('SELECT address FROM school_master WHERE id = ? LIMIT 1', [parsedSchoolId]);
        resolvedShipping = sch[0]?.address || null;
      }

      const hasPhysicalItems =
        (verifiedCalc.breakdown?.machines?.length || 0) > 0 ||
        (verifiedCalc.breakdown?.cards?.length || 0) > 0;

      if (hasPhysicalItems && (!resolvedShipping || !String(resolvedShipping).trim())) {
        const err = new Error('Shipping address is required when purchasing Biometric Attendance Machines or RFID Cards.');
        err.statusCode = 400;
        err.code = 'SHIPPING_ADDRESS_REQUIRED';
        throw err;
      }

      // Supersede any prior abandoned unpaid Razorpay ('created') orders for this same school or onboarding email/phone
      // so retrying checkout never self-blocks or holds multiple 15-minute coupon reservations.
      if (parsedSchoolId) {
        await conn.query(
          `UPDATE subscription_payment_orders
           SET status = 'failed',
               failure_code = 'SUPERSEDED',
               failure_reason = 'Superseded by a newer checkout attempt.'
           WHERE school_id = ? AND status = 'created'`,
          [parsedSchoolId]
        );
      } else if (extraMetadata?.email || extraMetadata?.phone) {
        const cleanEmail = extraMetadata.email ? String(extraMetadata.email).trim().toLowerCase() : null;
        const cleanPhone = extraMetadata.phone ? String(extraMetadata.phone).trim() : null;
        await conn.query(
          `UPDATE subscription_payment_orders
           SET status = 'failed',
               failure_code = 'SUPERSEDED',
               failure_reason = 'Superseded by a newer checkout attempt.'
           WHERE school_id IS NULL
             AND status = 'created'
             AND (
               (? IS NOT NULL AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload_snapshot_json, '$.extra.email')), '')) = ?)
               OR (? IS NOT NULL AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload_snapshot_json, '$.extra.phone')), '') = ?)
             )`,
          [cleanEmail, cleanEmail, cleanPhone, cleanPhone]
        );
      }

      // Lock and re-verify coupon usage limits atomically for ALL payment methods before reserving a slot
      if (verifiedCalc.couponInfo?.id && verifiedCalc.couponInfo?.code) {
        const recheck = await CouponModel.validateCoupon(
          verifiedCalc.couponInfo.code,
          verifiedCalc.subtotalAmount || 0,
          parsedSchoolId,
          {
            planAmount: verifiedCalc.planAmount || 0,
            storageAmount: verifiedCalc.storageAmount || 0,
            email: extraMetadata?.email || null,
            phone: extraMetadata?.phone || null,
            connection: conn,
            forUpdate: true,
            isCheckoutVerification: true,
          }
        );
        if (!recheck.valid) {
          const err = new Error(recheck.message || 'Coupon is no longer available.');
          err.statusCode = 400;
          err.code = 'INVALID_COUPON';
          throw err;
        }
      }

      const orderNo = generateOrderNo(orderType === 'addon_only' ? 'ADD' : 'ORD');
      const initialStatus = paymentMethod === 'bank_transfer' ? 'pending_verification' : 'created';
      const snapshot = {
        breakdown: verifiedCalc.breakdown,
        transition,
        extra: {
          ...extraMetadata,
          ...(resolvedBankSnapshot ? { bank_account: resolvedBankSnapshot } : {}),
        },
      };

      const [orderResult] = await conn.query(
        `INSERT INTO subscription_payment_orders (
           order_no, school_id, order_type, action_type, plan_id, billing_cycle,
           plan_amount, storage_plan_id, storage_qty, storage_amount,
           machines_amount, rfid_amount, notifications_amount, subtotal_amount,
           coupon_id, coupon_code, discount_amount, grand_total, currency,
           payment_method, razorpay_order_id, utr_number, bank_account_id, shipping_address,
           payload_snapshot_json, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderNo,
          parsedSchoolId,
          orderType,
          actionType,
          plan ? plan.id : null,
          verifiedCalc.breakdown?.billing_cycle || (plan ? plan.billing_cycle : null),
          verifiedCalc.planAmount || 0,
          verifiedCalc.breakdown?.storage?.id || null,
          verifiedCalc.breakdown?.storage?.quantity || 0,
          verifiedCalc.storageAmount || 0,
          verifiedCalc.machinesAmount || 0,
          verifiedCalc.rfidAmount || 0,
          verifiedCalc.notificationsAmount || 0,
          verifiedCalc.subtotalAmount || 0,
          verifiedCalc.couponInfo?.id || null,
          verifiedCalc.couponInfo?.code || null,
          verifiedCalc.discountAmount || 0,
          verifiedCalc.grandTotal || 0,
          paymentMethod,
          razorpayOrderId || null,
          utrNumber || null,
          resolvedBankAccountId,
          resolvedShipping,
          JSON.stringify(snapshot),
          initialStatus,
        ]
      );

      const paymentOrderId = orderResult.insertId;
      let pendingSubscriptionId = null;

      // For Offline Bank Transfer, create linked pending rows so Super Admin sees them in the approval queue
      if (paymentMethod === 'bank_transfer' && parsedSchoolId) {
        const todayStr = getTodayIST();
        const startDate = transition?.start_date || todayStr;
        const endDate = transition?.end_date || (plan ? addCycleDuration(todayStr, plan.billing_cycle) : todayStr);

        if (orderType !== 'addon_only' && plan) {
          const carryStorageId = verifiedCalc.breakdown?.storage?.id || null;

          const [subRes] = await conn.query(
            `INSERT INTO school_subscriptions (
               school_id, plan_id, storage_plan_id, action_type, plan_amount, addons_amount, amount_paid,
               payment_gateway, payment_transaction_id, payment_order_id,
               coupon_id, discount_amount, original_amount,
               payment_status, start_date, end_date, status,
               snapshot_max_students, snapshot_storage_gb, snapshot_tier_rank, snapshot_billing_cycle
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'bank_transfer', ?, ?, ?, ?, ?, 'pending', ?, ?, 'pending', ?, ?, ?, ?)`,
            [
              parsedSchoolId,
              plan.id,
              carryStorageId,
              actionType === 'addon_only' ? 'renewal' : actionType,
              verifiedCalc.netPlanAmount || 0,
              verifiedCalc.netAddonsAmount !== undefined ? verifiedCalc.netAddonsAmount : (verifiedCalc.addonsAmount || 0),
              verifiedCalc.grandTotal || 0,
              utrNumber || orderNo,
              paymentOrderId,
              verifiedCalc.couponInfo?.id || null,
              verifiedCalc.discountAmount || 0,
              verifiedCalc.subtotalAmount || 0,
              startDate,
              endDate,
              Number(plan.max_students) || 0,
              Math.max(0, parseInt(plan.included_storage_gb, 10) || 0),
              Number(plan.tier_rank) || 1,
              plan.billing_cycle,
            ]
          );
          pendingSubscriptionId = subRes.insertId;

          await conn.query(
            'UPDATE subscription_payment_orders SET activated_subscription_id = ? WHERE id = ?',
            [pendingSubscriptionId, paymentOrderId]
          );
        }

        // Insert pending add-on rows linked by payment_order_id (each paid storage add-on runs for its own full cycle from todayStr)
        await SubscriptionFulfillmentService._insertAddonRows(conn, {
          schoolId: parsedSchoolId,
          paymentOrderId,
          breakdown: verifiedCalc.breakdown,
          paymentTxnId: utrNumber || orderNo,
          shippingAddress: resolvedShipping,
          isPaidAndApproved: false,
          startDate: todayStr,
        });

        await conn.query(
          `INSERT INTO subscription_audit_logs
             (school_id, subscription_id, payment_order_id, actor_type, action, new_state_json, reason)
           VALUES (?, ?, ?, 'school_admin', 'OFFLINE_ORDER_SUBMITTED', ?, ?)`,
          [
            parsedSchoolId,
            pendingSubscriptionId,
            paymentOrderId,
            JSON.stringify({ order_no: orderNo, utr_number: utrNumber, grand_total: verifiedCalc.grandTotal }),
            `Offline bank transfer submitted (UTR: ${utrNumber || 'N/A'})`,
          ]
        );
      }

      await conn.commit();

      return {
        orderId: paymentOrderId,
        orderNo,
        status: initialStatus,
        pendingSubscriptionId,
        grandTotal: verifiedCalc.grandTotal,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Helper to insert storage, machine, and RFID rows linked to `payment_order_id`
   */
  static async _insertAddonRows(
    conn,
    { schoolId, paymentOrderId, breakdown, paymentTxnId, shippingAddress, isPaidAndApproved, startDate }
  ) {
    const todayStr = startDate || getTodayIST();

    // 1. Storage Expansion Order
    if (breakdown?.storage?.id) {
      const s = breakdown.storage;
      const sCycle = s.billing_cycle || breakdown?.billing_cycle;
      const sEnd = addCycleDuration(todayStr, sCycle);
      const sNetTotal =
        s.net_total_price !== undefined ? parseFloat(s.net_total_price) || 0 : parseFloat(s.total_price) || 0;
      const storageOrderNo = `STOR_${schoolId}_${paymentOrderId}_${Math.floor(100 + Math.random() * 900)}`;
      await conn.query(
        `INSERT INTO school_storage_orders
           (order_no, school_id, payment_order_id, storage_plan_id, billing_cycle, quantity, unit_price, total_amount,
            payment_transaction_id, order_status, start_date, end_date, remarks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          storageOrderNo,
          schoolId,
          paymentOrderId,
          s.id,
          sCycle,
          s.quantity || 1,
          s.unit_price || 0,
          sNetTotal,
          paymentTxnId,
          isPaidAndApproved ? 'active' : 'pending',
          todayStr,
          sEnd,
          isPaidAndApproved
            ? 'Activated automatically on verified payment'
            : 'Pending Super Admin bank transfer verification',
        ]
      );
    }

    // 2. RFID Card Orders
    if (Array.isArray(breakdown?.cards) && breakdown.cards.length > 0) {
      for (const card of breakdown.cards) {
        const cardNetTotal =
          card.net_total_price !== undefined
            ? parseFloat(card.net_total_price) || 0
            : parseFloat(card.total_price) || 0;
        const rfidOrderNo = `RFID_${schoolId}_${paymentOrderId}_${card.id}_${Math.floor(100 + Math.random() * 900)}`;
        await conn.query(
          `INSERT INTO school_rfid_orders
             (order_no, school_id, payment_order_id, rfid_card_id, quantity, unit_price, total_amount,
              order_status, payment_transaction_id, shipping_address, remarks, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            rfidOrderNo,
            schoolId,
            paymentOrderId,
            card.id,
            card.quantity,
            card.unit_price,
            cardNetTotal,
            isPaidAndApproved ? 'approved' : 'pending',
            paymentTxnId,
            shippingAddress || null,
            isPaidAndApproved
              ? 'Payment verified — Approved for printing & dispatch'
              : 'Pending Super Admin bank transfer verification',
          ]
        );
      }
    }

    // 3. Biometric Attendance Machine Orders
    if (Array.isArray(breakdown?.machines) && breakdown.machines.length > 0) {
      for (const machine of breakdown.machines) {
        const qty = Math.max(1, parseInt(machine.quantity, 10) || 1);
        const machineNetLineTotal =
          machine.net_total_price !== undefined
            ? parseFloat(machine.net_total_price) || 0
            : parseFloat(machine.total_price ?? (parseFloat(machine.unit_price) || 0) * qty) || 0;
        let remainingMachineNet = machineNetLineTotal;
        for (let i = 0; i < qty; i++) {
          const unitNet =
            i === qty - 1
              ? Math.max(0, Math.round(remainingMachineNet * 100) / 100)
              : Math.max(0, Math.round((machineNetLineTotal / qty) * 100) / 100);
          remainingMachineNet = Math.max(0, Math.round((remainingMachineNet - unitNet) * 100) / 100);
          const machOrderNo = `MACH_${schoolId}_${paymentOrderId}_${machine.id}_${i + 1}`;
          await conn.query(
            `INSERT INTO school_attendance_machines
               (order_no, school_id, payment_order_id, machine_master_id, quantity, unit_price, total_amount,
                device_serial_number, device_location, status, order_status, payment_transaction_id, shipping_address, remarks, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              machOrderNo,
              schoolId,
              paymentOrderId,
              machine.id,
              machine.unit_price,
              unitNet,
              isPaidAndApproved ? 1 : 2,
              isPaidAndApproved ? 'approved' : 'pending',
              paymentTxnId,
              shippingAddress || null,
              isPaidAndApproved
                ? 'Payment verified — Approved for dispatch'
                : 'Pending Super Admin bank transfer verification',
            ]
          );
        }
      }
    }
  }

  /**
   * Credit school's SMS & Push Notification Wallet inside an active DB transaction
   */
  static async _creditNotificationWallet(conn, { schoolId, paymentOrderId, notifications = [] }) {
    if (!Array.isArray(notifications) || notifications.length === 0) return;

    await conn.query(
      `INSERT IGNORE INTO school_notification_wallets (school_id, sms_balance, push_balance)
       VALUES (?, 0, 0)`,
      [schoolId]
    );

    const [walletRows] = await conn.query(
      'SELECT * FROM school_notification_wallets WHERE school_id = ? LIMIT 1 FOR UPDATE',
      [schoolId]
    );
    let smsBalance = parseInt(walletRows[0]?.sms_balance, 10) || 0;
    let pushBalance = parseInt(walletRows[0]?.push_balance, 10) || 0;

    for (const item of notifications) {
      const channel = String(item.channel || item.type || '').toLowerCase();
      const qty = Math.max(0, parseInt(item.quantity, 10) || 0);
      if (qty <= 0 || !['sms', 'push'].includes(channel)) continue;

      if (channel === 'sms') {
        smsBalance += qty;
        await conn.query(
          `UPDATE school_notification_wallets
           SET sms_balance = sms_balance + ?, total_sms_purchased = total_sms_purchased + ?
           WHERE school_id = ?`,
          [qty, qty, schoolId]
        );
      } else {
        pushBalance += qty;
        await conn.query(
          `UPDATE school_notification_wallets
           SET push_balance = push_balance + ?, total_push_purchased = total_push_purchased + ?
           WHERE school_id = ?`,
          [qty, qty, schoolId]
        );
      }

      const itemNetTotal =
        item.net_total_price !== undefined
          ? parseFloat(item.net_total_price) || 0
          : parseFloat(item.total_price) || 0;

      await conn.query(
        `INSERT INTO school_notification_ledger
           (school_id, channel, entry_type, units, balance_after, unit_price, total_amount, payment_order_id, reference_note)
         VALUES (?, ?, 'credit', ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          channel,
          qty,
          channel === 'sms' ? smsBalance : pushBalance,
          parseFloat(item.unit_price) || 0,
          itemNetTotal,
          paymentOrderId,
          `Purchased ${qty.toLocaleString()} ${channel.toUpperCase()} credits (Order #${paymentOrderId})`,
        ]
      );
    }
  }

  /**
   * Credit any Push or SMS Notification Credits bundled inside a Subscription Plan (`included_push_credits`, `included_sms_credits`)
   * into `school_notification_wallets` and `school_notification_ledger` inside an active DB transaction.
   * Free plan-included credits increase wallet balance without inflating `total_sms_purchased` / `total_push_purchased`.
   */
  static async _creditIncludedPlanNotifications(conn, { schoolId, plan, paymentOrderId = null }) {
    if (!plan || !schoolId) return;

    const includedSms = Math.max(0, parseInt(plan.included_sms_credits, 10) || 0);
    const includedPush = Math.max(0, parseInt(plan.included_push_credits, 10) || 0);
    if (includedSms <= 0 && includedPush <= 0) return;

    // Idempotency guard per paymentOrderId
    if (paymentOrderId) {
      const [existing] = await conn.query(
        `SELECT id FROM school_notification_ledger
         WHERE school_id = ? AND payment_order_id = ? AND reference_note LIKE 'Included with %'
         LIMIT 1`,
        [schoolId, paymentOrderId]
      );
      if (existing.length > 0) return;
    }

    await conn.query(
      `INSERT IGNORE INTO school_notification_wallets (school_id, sms_balance, push_balance)
       VALUES (?, 0, 0)`,
      [schoolId]
    );

    const [walletRows] = await conn.query(
      'SELECT * FROM school_notification_wallets WHERE school_id = ? LIMIT 1 FOR UPDATE',
      [schoolId]
    );
    let smsBalance = parseInt(walletRows[0]?.sms_balance, 10) || 0;
    let pushBalance = parseInt(walletRows[0]?.push_balance, 10) || 0;
    const planLabel = plan.plan_name || 'Subscription';

    if (includedSms > 0) {
      smsBalance += includedSms;
      await conn.query(
        `UPDATE school_notification_wallets
         SET sms_balance = sms_balance + ?
         WHERE school_id = ?`,
        [includedSms, schoolId]
      );
      await conn.query(
        `INSERT INTO school_notification_ledger
           (school_id, channel, entry_type, units, balance_after, unit_price, total_amount, payment_order_id, reference_note)
         VALUES (?, 'sms', 'credit', ?, ?, 0, 0, ?, ?)`,
        [
          schoolId,
          includedSms,
          smsBalance,
          paymentOrderId,
          `Included with ${planLabel} plan (${includedSms.toLocaleString()} SMS credits)`,
        ]
      );
    }

    if (includedPush > 0) {
      pushBalance += includedPush;
      await conn.query(
        `UPDATE school_notification_wallets
         SET push_balance = push_balance + ?
         WHERE school_id = ?`,
        [includedPush, schoolId]
      );
      await conn.query(
        `INSERT INTO school_notification_ledger
           (school_id, channel, entry_type, units, balance_after, unit_price, total_amount, payment_order_id, reference_note)
         VALUES (?, 'push', 'credit', ?, ?, 0, 0, ?, ?)`,
        [
          schoolId,
          includedPush,
          pushBalance,
          paymentOrderId,
          `Included with ${planLabel} plan (${includedPush.toLocaleString()} Push credits)`,
        ]
      );
    }
  }

  /**
   * Atomically & Idempotently Fulfill a Paid Order (Razorpay verify-payment, Razorpay Webhook,
   * 100%-Discount Coupon, Onboarding Registration, or Super Admin Offline Approval).
   */
  static async fulfillPaidOrder({
    orderId = null,
    orderNo = null,
    razorpayOrderId = null,
    razorpayPaymentId = null,
    schoolIdOverride = null,
    expectedSchoolId = null,
    actorType = 'school_admin',
    actorId = null,
    verificationNotes = null,
    startDateOverride = null,
    endDateOverride = null,
    externalConnection = null,
  }) {
    const ownsConnection = !externalConnection;
    const conn = externalConnection || (await pool.getConnection());

    let alertPayload = null;
    let isOfflineApproval = false;

    try {
      if (ownsConnection) {
        await conn.beginTransaction();
      }

      // 1. Lock the order row FOR UPDATE (100% concurrency & webhook idempotency!)
      let whereSql = '';
      let whereParam = null;
      if (orderId) {
        whereSql = 'id = ?';
        whereParam = parseInt(orderId, 10);
      } else if (razorpayOrderId) {
        whereSql = 'razorpay_order_id = ?';
        whereParam = String(razorpayOrderId).trim();
      } else if (orderNo) {
        whereSql = 'order_no = ?';
        whereParam = String(orderNo).trim();
      } else {
        throw new Error('Order identifier is required for fulfillment.');
      }

      const [orderRows] = await conn.query(
        `SELECT * FROM subscription_payment_orders WHERE ${whereSql} LIMIT 1 FOR UPDATE`,
        [whereParam]
      );

      if (orderRows.length === 0) {
        const err = new Error('Checkout order record not found.');
        err.statusCode = 404;
        err.code = 'ORDER_NOT_FOUND';
        throw err;
      }

      const order = orderRows[0];

      // Prevent cross-school payment replay
      if (expectedSchoolId && order.school_id && Number(order.school_id) !== Number(expectedSchoolId)) {
        const err = new Error('Forbidden: Payment order belongs to a different school tenant.');
        err.statusCode = 403;
        err.code = 'CROSS_TENANT_ORDER';
        throw err;
      }

      const targetSchoolId = parseInt(schoolIdOverride || order.school_id, 10);
      if (!targetSchoolId) {
        const err = new Error('Cannot fulfill payment order before school record is created.');
        err.statusCode = 400;
        err.code = 'MISSING_SCHOOL_ID';
        throw err;
      }

      // Bind school_id if created during pre-registration onboarding
      if (!order.school_id && targetSchoolId) {
        await conn.query(
          'UPDATE subscription_payment_orders SET school_id = ? WHERE id = ?',
          [targetSchoolId, order.id]
        );
        order.school_id = targetSchoolId;
      }

      // Idempotency return if already fulfilled!
      if (order.status === 'paid') {
        if (ownsConnection) await conn.commit();
        return {
          alreadyFulfilled: true,
          orderId: order.id,
          orderNo: order.order_no,
          invoiceNo: order.invoice_no,
          subscriptionId: order.activated_subscription_id,
          schoolId: targetSchoolId,
        };
      }

      if (order.status === 'rejected') {
        const err = new Error(
          'Cannot approve an already rejected payment order because its bundled items and coupons were cancelled. Ask the school to submit a fresh order with a valid UTR.'
        );
        err.statusCode = 400;
        err.code = 'ORDER_ALREADY_REJECTED';
        throw err;
      }

      isOfflineApproval = order.payment_method === 'bank_transfer';
      const todayStr = getTodayIST();
      const invoiceNo = order.invoice_no || formatInvoiceNo(order.id, todayStr);
      const finalPaymentTxnId =
        razorpayPaymentId ||
        order.razorpay_payment_id ||
        order.utr_number ||
        order.order_no;

      let parsedSnapshot = {};
      try {
        parsedSnapshot = order.payload_snapshot_json ? JSON.parse(order.payload_snapshot_json) : {};
      } catch (_) {}
      const breakdown = parsedSnapshot.breakdown || {};

      let activatedSubscriptionId = order.activated_subscription_id || null;
      let finalStartDate = todayStr;
      let finalEndDate = null;
      let bundledStorageStartDate = todayStr;
      let planName = breakdown.plan_name || null;

      // 2. Activate Software Subscription (unless standalone add-on order)
      if (order.order_type !== 'addon_only' && order.plan_id) {
        const [planRows] = await conn.query(
          'SELECT * FROM subscription_plans WHERE id = ? LIMIT 1',
          [order.plan_id]
        );
        const targetPlan = planRows[0];
        if (!targetPlan) {
          throw new Error('Target subscription plan no longer exists.');
        }
        planName = targetPlan.plan_name;

        const lifecycle = await SubscriptionFulfillmentService.loadSchoolLifecycleSnapshot(targetSchoolId, conn, true);
        const isTrialSub = order.order_type === 'trial_with_addons' || order.payment_method === 'free_trial';
        const customStartStr = normalizeDateStr(startDateOverride);
        const customEndStr = normalizeDateStr(endDateOverride);

        if (customStartStr || customEndStr) {
          const trialDays = Math.max(0, parseInt(targetPlan.free_trial_days, 10) || 0);
          finalStartDate = customStartStr || todayStr;
          finalEndDate =
            customEndStr ||
            addCycleDuration(finalStartDate, isTrialSub ? 'trial' : targetPlan.billing_cycle, trialDays);
          bundledStorageStartDate = finalStartDate;
        } else if (isTrialSub) {
          const trialDays = Math.max(0, parseInt(targetPlan.free_trial_days, 10) || 0);
          finalStartDate = todayStr;
          finalEndDate = addCycleDuration(todayStr, 'trial', trialDays);
        } else {
          // Compute exact dates at fulfillment time (preserves 100% of remaining days on early renewal!)
          const liveTransition = SubscriptionPolicyService.classifyPlanTransition({
            activeSub: lifecycle.activeSub,
            lastPaidSub: lifecycle.lastPaidSub,
            hasClaimedTrial: lifecycle.hasClaimedTrial,
            targetPlan,
            isTrialIntent: false,
            activeStudentCount: 0, // Already validated at order creation; paid money must not get stuck
            baseDateStr: todayStr,
          });

          if (liveTransition.stacks_dates && lifecycle.activeSub?.end_date) {
            const activeEndStr = normalizeDateStr(lifecycle.activeSub.end_date);
            finalStartDate = normalizeDateStr(lifecycle.activeSub.start_date) || todayStr;
            finalEndDate = addCycleDuration(activeEndStr, targetPlan.billing_cycle);
            bundledStorageStartDate = todayStr;
          } else {
            finalStartDate = todayStr;
            finalEndDate = addCycleDuration(todayStr, targetPlan.billing_cycle);
          }
        }

        // Only record storage_plan_id if a storage add-on was explicitly purchased in this order
        const effectiveStoragePlanId = order.storage_plan_id || null;

        const targetSubStatus = isTrialSub ? 'trial' : 'active';
        const grossPlanAmt = parseFloat(order.plan_amount) || 0;
        const grossAddonsAmt =
          Math.round(
            ((parseFloat(order.storage_amount) || 0) +
              (parseFloat(order.machines_amount) || 0) +
              (parseFloat(order.rfid_amount) || 0) +
              (parseFloat(order.notifications_amount) || 0)) *
              100
          ) / 100;
        const orderGrandTotal = Math.max(0, parseFloat(order.grand_total) || 0);
        const netPlanAmt =
          breakdown.net_plan_price !== undefined
            ? parseFloat(breakdown.net_plan_price) || 0
            : Math.max(
                0,
                Math.round((grossPlanAmt - Math.min(grossPlanAmt, parseFloat(order.discount_amount) || 0)) * 100) /
                  100
              );
        const addonsAmt =
          breakdown.net_addons_amount !== undefined
            ? parseFloat(breakdown.net_addons_amount) || 0
            : Math.max(0, Math.round((orderGrandTotal - netPlanAmt) * 100) / 100 || grossAddonsAmt);

        // Check if an offline pending subscription row already exists for this order
        let existingPendingSubId = activatedSubscriptionId;
        if (!existingPendingSubId) {
          const [pendRows] = await conn.query(
            'SELECT id FROM school_subscriptions WHERE payment_order_id = ? LIMIT 1 FOR UPDATE',
            [order.id]
          );
          if (pendRows.length > 0) existingPendingSubId = pendRows[0].id;
        }

        const snapMaxStudents = Number(targetPlan.max_students) || 0;
        const snapStorageGb = Math.max(0, parseInt(targetPlan.included_storage_gb, 10) || 0);
        const snapTierRank = isTrialSub ? 0 : (Number(targetPlan.tier_rank) || 1);
        const snapBillingCycle = isTrialSub ? 'trial' : targetPlan.billing_cycle;

        if (existingPendingSubId) {
          await conn.query(
            `UPDATE school_subscriptions
             SET storage_plan_id = ?,
                 plan_amount = ?,
                 addons_amount = ?,
                 amount_paid = ?,
                 payment_transaction_id = ?,
                 invoice_no = ?,
                 payment_status = 'completed',
                 start_date = ?,
                 end_date = ?,
                 status = ?,
                 verified_by = ?,
                 verified_at = NOW(),
                 verification_notes = ?,
                 snapshot_max_students = ?,
                 snapshot_storage_gb = ?,
                 snapshot_tier_rank = ?,
                 snapshot_billing_cycle = ?
             WHERE id = ?`,
            [
              effectiveStoragePlanId,
              netPlanAmt,
              addonsAmt,
              order.grand_total,
              finalPaymentTxnId,
              invoiceNo,
              finalStartDate,
              finalEndDate,
              targetSubStatus,
              actorId || null,
              verificationNotes || 'Verified and activated',
              snapMaxStudents,
              snapStorageGb,
              snapTierRank,
              snapBillingCycle,
              existingPendingSubId,
            ]
          );
          activatedSubscriptionId = existingPendingSubId;
        } else {
          const [insSub] = await conn.query(
            `INSERT INTO school_subscriptions (
               school_id, plan_id, storage_plan_id, action_type,
               plan_amount, addons_amount, amount_paid,
               payment_gateway, payment_transaction_id, payment_order_id, invoice_no,
               coupon_id, discount_amount, original_amount,
               payment_status, start_date, end_date, status,
               verified_by, verified_at, verification_notes,
               snapshot_max_students, snapshot_storage_gb, snapshot_tier_rank, snapshot_billing_cycle
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
            [
              targetSchoolId,
              targetPlan.id,
              effectiveStoragePlanId,
              ['onboarding', 'trial', 'renewal', 'upgrade', 'manual_override'].includes(order.action_type)
                ? order.action_type
                : 'renewal',
              netPlanAmt,
              addonsAmt,
              order.grand_total,
              order.payment_method,
              finalPaymentTxnId,
              order.id,
              invoiceNo,
              order.coupon_id || null,
              order.discount_amount || 0,
              order.subtotal_amount || 0,
              finalStartDate,
              finalEndDate,
              targetSubStatus,
              actorId || null,
              verificationNotes || 'Auto-activated upon verified payment',
              snapMaxStudents,
              snapStorageGb,
              snapTierRank,
              snapBillingCycle,
            ]
          );
          activatedSubscriptionId = insSub.insertId;
        }

        // Mark all older active/trial subscriptions for this school as 'superseded'
        await conn.query(
          `UPDATE school_subscriptions
           SET status = 'superseded', superseded_by_id = ?
           WHERE school_id = ?
             AND id != ?
             AND status IN ('active', 'trial')`,
          [activatedSubscriptionId, targetSchoolId, activatedSubscriptionId]
        );

        // Credit any Push or SMS Notification Credits bundled with this subscription plan
        await SubscriptionFulfillmentService._creditIncludedPlanNotifications(conn, {
          schoolId: targetSchoolId,
          plan: targetPlan,
          paymentOrderId: order.id,
        });
      }

      // 3. Activate or Insert Linked Add-ons (Storage, Machines, RFID)
      if (isOfflineApproval) {
        // Offline order already inserted pending add-on rows with payment_order_id = order.id; activate non-cancelled items!
        if (order.storage_plan_id) {
          const sCycle = breakdown?.storage?.billing_cycle || breakdown?.billing_cycle;
          const customStartStr = normalizeDateStr(startDateOverride);
          const customEndStr = normalizeDateStr(endDateOverride);
          const sStart = customStartStr || bundledStorageStartDate;
          const sEnd =
            customEndStr && (!order.plan_id || String(sCycle || '').toLowerCase() === String(breakdown?.billing_cycle || '').toLowerCase())
              ? customEndStr
              : addCycleDuration(sStart, sCycle);
          await conn.query(
            `UPDATE school_storage_orders
             SET order_status = 'active', start_date = ?, end_date = ?,
                 remarks = 'Approved and activated by Super Admin', updated_at = NOW()
             WHERE payment_order_id = ? AND order_status != 'cancelled'`,
            [sStart, sEnd, order.id]
          );
        }
        await conn.query(
          `UPDATE school_rfid_orders
           SET order_status = 'approved', remarks = 'Approved by Super Admin — Ready for dispatch', updated_at = NOW()
           WHERE payment_order_id = ? AND order_status = 'pending'`,
          [order.id]
        );
        await conn.query(
          `UPDATE school_attendance_machines
           SET status = 1, order_status = 'approved', remarks = 'Approved by Super Admin — Ready for dispatch', updated_at = NOW()
           WHERE payment_order_id = ? AND order_status = 'pending'`,
          [order.id]
        );
      } else {
        // Online Razorpay / 100% Coupon / Onboarding: insert paid & approved add-on rows now
        await SubscriptionFulfillmentService._insertAddonRows(conn, {
          schoolId: targetSchoolId,
          paymentOrderId: order.id,
          breakdown,
          paymentTxnId: finalPaymentTxnId,
          shippingAddress: order.shipping_address,
          isPaidAndApproved: true,
          startDate: bundledStorageStartDate,
        });
      }

      // 4. Credit SMS & Push Notification Wallet
      if (Array.isArray(breakdown.notifications) && breakdown.notifications.length > 0) {
        await SubscriptionFulfillmentService._creditNotificationWallet(conn, {
          schoolId: targetSchoolId,
          paymentOrderId: order.id,
          notifications: breakdown.notifications,
        });
      }

      // 5. Record Coupon Redemption inside transaction
      if (order.coupon_id && parseFloat(order.discount_amount) > 0) {
        await conn.query('SELECT id FROM coupons WHERE id = ? FOR UPDATE', [order.coupon_id]);
        await CouponModel.recordCouponUsage(
          order.coupon_id,
          targetSchoolId,
          activatedSubscriptionId,
          order.discount_amount,
          conn,
          order.id
        );
      }

      // 6. Finalize Order Row
      await conn.query(
        `UPDATE subscription_payment_orders
         SET status = 'paid',
             invoice_no = ?,
             razorpay_payment_id = COALESCE(?, razorpay_payment_id),
             activated_subscription_id = ?,
             verified_by = COALESCE(?, verified_by),
             verification_notes = COALESCE(?, verification_notes),
             paid_at = NOW()
         WHERE id = ?`,
        [
          invoiceNo,
          razorpayPaymentId || null,
          activatedSubscriptionId,
          actorId || null,
          verificationNotes || null,
          order.id,
        ]
      );

      // 7. Audit Log
      await conn.query(
        `INSERT INTO subscription_audit_logs
           (school_id, subscription_id, payment_order_id, actor_type, actor_id, action, new_state_json, reason)
         VALUES (?, ?, ?, ?, ?, 'ORDER_FULFILLED', ?, ?)`,
        [
          targetSchoolId,
          activatedSubscriptionId,
          order.id,
          actorType,
          actorId || null,
          JSON.stringify({
            order_no: order.order_no,
            invoice_no: invoiceNo,
            order_type: order.order_type,
            plan_id: order.plan_id,
            grand_total: order.grand_total,
            start_date: finalStartDate,
            end_date: finalEndDate,
          }),
          verificationNotes || `Fulfilled via ${order.payment_method}`,
        ]
      );

      if (ownsConnection) {
        await conn.commit();
      }

      alertPayload = {
        schoolId: targetSchoolId,
        planName: planName || 'Add-ons & Credits',
        invoiceNo,
        amountPaid: order.grand_total,
        startDate: finalStartDate,
        endDate: finalEndDate,
        utrNumber: order.utr_number,
        notes: verificationNotes,
      };

      // Non-blocking optional notification (respects Super Admin On/Off toggles)
      if (ownsConnection && alertPayload) {
        setImmediate(() => {
          if (isOfflineApproval) {
            SubscriptionAlertService.sendOfflineDecisionAlert({
              schoolId: alertPayload.schoolId,
              approved: true,
              planName: alertPayload.planName,
              utrNumber: alertPayload.utrNumber,
              notes: alertPayload.notes,
              startDate: alertPayload.startDate,
              endDate: alertPayload.endDate,
            }).catch(() => {});
          } else {
            SubscriptionAlertService.sendPaymentSuccessAlert(alertPayload).catch(() => {});
          }
        });
      }

      return {
        alreadyFulfilled: false,
        orderId: order.id,
        orderNo: order.order_no,
        invoiceNo,
        subscriptionId: activatedSubscriptionId,
        schoolId: targetSchoolId,
        planName,
        startDate: finalStartDate,
        endDate: finalEndDate,
        grandTotal: parseFloat(order.grand_total) || 0,
        breakdown,
      };
    } catch (error) {
      if (ownsConnection) {
        await conn.rollback();
      }
      throw error;
    } finally {
      if (ownsConnection) {
        conn.release();
      }
    }
  }

  /**
   * Atomically Reject an Offline Bank Transfer Subscription / Order
   */
  static async rejectOfflineSubscription({ subscriptionId, adminId, reason = '' }) {
    const conn = await pool.getConnection();
    let alertInfo = null;

    try {
      await conn.beginTransaction();

      const [subRows] = await conn.query(
        `SELECT s.*, p.plan_name
         FROM school_subscriptions s
         LEFT JOIN subscription_plans p ON s.plan_id = p.id
         WHERE s.id = ? LIMIT 1 FOR UPDATE`,
        [subscriptionId]
      );
      if (subRows.length === 0) {
        const err = new Error('Subscription record not found.');
        err.statusCode = 404;
        throw err;
      }

      const sub = subRows[0];
      if (sub.status === 'active') {
        const err = new Error('Cannot reject an already active subscription. Use Suspend instead.');
        err.statusCode = 400;
        throw err;
      }

      const cleanReason = reason && String(reason).trim()
        ? String(reason).trim()
        : 'Offline payment verification failed / rejected by Super Admin.';

      await conn.query(
        `UPDATE school_subscriptions
         SET status = 'rejected',
             payment_status = 'failed',
             verified_by = ?,
             verified_at = NOW(),
             verification_notes = ?
         WHERE id = ?`,
        [adminId || null, cleanReason, sub.id]
      );

      if (sub.payment_order_id) {
        await conn.query(
          `UPDATE subscription_payment_orders
           SET status = 'rejected',
               failure_reason = ?,
               verified_by = ?,
               verification_notes = ?
           WHERE id = ?`,
          [cleanReason, adminId || null, cleanReason, sub.payment_order_id]
        );

        await conn.query(
          `UPDATE school_storage_orders SET order_status = 'cancelled', remarks = ? WHERE payment_order_id = ?`,
          [cleanReason, sub.payment_order_id]
        );
        await conn.query(
          `UPDATE school_rfid_orders SET order_status = 'cancelled', remarks = ? WHERE payment_order_id = ?`,
          [cleanReason, sub.payment_order_id]
        );
        await conn.query(
          `UPDATE school_attendance_machines SET order_status = 'cancelled', status = 2, remarks = ? WHERE payment_order_id = ?`,
          [cleanReason, sub.payment_order_id]
        );
      }

      if (sub.coupon_id) {
        await CouponModel.releaseCouponUsage(sub.coupon_id, sub.school_id, sub.id, conn, sub.payment_order_id || null);
      }

      await conn.query(
        `INSERT INTO subscription_audit_logs
           (school_id, subscription_id, payment_order_id, actor_type, actor_id, action, reason)
         VALUES (?, ?, ?, 'saas_super_admin', ?, 'OFFLINE_ORDER_REJECTED', ?)`,
        [sub.school_id, sub.id, sub.payment_order_id || null, adminId || null, cleanReason]
      );

      await conn.commit();

      alertInfo = {
        schoolId: sub.school_id,
        planName: sub.plan_name,
        utrNumber: sub.payment_transaction_id,
        notes: cleanReason,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    if (alertInfo) {
      setImmediate(() => {
        SubscriptionAlertService.sendOfflineDecisionAlert({
          schoolId: alertInfo.schoolId,
          approved: false,
          planName: alertInfo.planName,
          utrNumber: alertInfo.utrNumber,
          notes: alertInfo.notes,
        }).catch(() => {});
      });
    }

    return true;
  }

  /**
   * Approve a standalone Offline Bank Transfer Add-on Order (`order_type = 'addon_only'`)
   */
  static async approveOfflineAddonOrder({ orderId, adminId = null, verificationNotes = '' }) {
    const parsedOrderId = parseInt(orderId, 10);
    if (!parsedOrderId) {
      const err = new Error('Valid payment order ID is required.');
      err.statusCode = 400;
      throw err;
    }

    return await SubscriptionFulfillmentService.fulfillPaidOrder({
      orderId: parsedOrderId,
      actorType: 'saas_super_admin',
      actorId: adminId || null,
      verificationNotes:
        verificationNotes && String(verificationNotes).trim()
          ? String(verificationNotes).trim()
          : 'Offline add-on bank transfer verified and approved by Super Admin',
    });
  }

  /**
   * Atomically Reject a standalone Offline Bank Transfer Add-on Order (`order_type = 'addon_only'`)
   */
  static async rejectOfflineAddonOrder({ orderId, adminId = null, reason = '' }) {
    const parsedOrderId = parseInt(orderId, 10);
    if (!parsedOrderId) {
      const err = new Error('Valid payment order ID is required.');
      err.statusCode = 400;
      throw err;
    }

    const conn = await pool.getConnection();
    let alertInfo = null;

    try {
      await conn.beginTransaction();

      const [orderRows] = await conn.query(
        'SELECT * FROM subscription_payment_orders WHERE id = ? LIMIT 1 FOR UPDATE',
        [parsedOrderId]
      );
      if (orderRows.length === 0) {
        const err = new Error('Add-on payment order record not found.');
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];
      if (order.status === 'paid') {
        const err = new Error('Cannot reject an already fulfilled add-on order.');
        err.statusCode = 400;
        throw err;
      }

      const cleanReason =
        reason && String(reason).trim()
          ? String(reason).trim()
          : 'Offline add-on payment verification failed / rejected by Super Admin.';

      await conn.query(
        `UPDATE subscription_payment_orders
         SET status = 'rejected',
             failure_reason = ?,
             verified_by = ?,
             verification_notes = ?
         WHERE id = ?`,
        [cleanReason, adminId || null, cleanReason, order.id]
      );

      await conn.query(
        `UPDATE school_storage_orders SET order_status = 'cancelled', remarks = ?, updated_at = NOW() WHERE payment_order_id = ?`,
        [cleanReason, order.id]
      );
      await conn.query(
        `UPDATE school_rfid_orders SET order_status = 'cancelled', remarks = ?, updated_at = NOW() WHERE payment_order_id = ?`,
        [cleanReason, order.id]
      );
      await conn.query(
        `UPDATE school_attendance_machines SET order_status = 'cancelled', status = 2, remarks = ?, updated_at = NOW() WHERE payment_order_id = ?`,
        [cleanReason, order.id]
      );

      if (order.coupon_id && order.school_id) {
        await CouponModel.releaseCouponUsage(order.coupon_id, order.school_id, null, conn, order.id);
      }

      if (order.school_id) {
        await conn.query(
          `INSERT INTO subscription_audit_logs
             (school_id, subscription_id, payment_order_id, actor_type, actor_id, action, reason)
           VALUES (?, NULL, ?, 'saas_super_admin', ?, 'OFFLINE_ORDER_REJECTED', ?)`,
          [order.school_id, order.id, adminId || null, cleanReason]
        );
      }

      await conn.commit();

      if (order.school_id) {
        alertInfo = {
          schoolId: order.school_id,
          planName: 'Add-ons & Notification Credits',
          utrNumber: order.utr_number || order.order_no,
          notes: cleanReason,
        };
      }
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    if (alertInfo) {
      setImmediate(() => {
        SubscriptionAlertService.sendOfflineDecisionAlert({
          schoolId: alertInfo.schoolId,
          approved: false,
          planName: alertInfo.planName,
          utrNumber: alertInfo.utrNumber,
          notes: alertInfo.notes,
        }).catch(() => {});
      });
    }

    return true;
  }

  /**
   * When a single add-on item (Storage, RFID, or Biometric Machine) is cancelled on its Buyer page,
   * only mark the parent `addon_only` payment order as rejected if NO other non-cancelled items
   * (and no notification credits) remain in that order. Sibling add-ons are never auto-cancelled!
   */
  static async syncStandaloneAddonCancellation({ orderId, adminId = null, reason = '' }) {
    const parsedOrderId = parseInt(orderId, 10);
    if (!parsedOrderId) return false;

    const [orderRows] = await pool.query(
      'SELECT id, order_type, status, notifications_amount FROM subscription_payment_orders WHERE id = ? LIMIT 1',
      [parsedOrderId]
    );
    if (orderRows.length === 0) return false;
    const ord = orderRows[0];
    if (ord.order_type !== 'addon_only' || ord.status !== 'pending_verification') return false;
    if ((parseFloat(ord.notifications_amount) || 0) > 0) return false;

    const [[remRows]] = await pool.query(
      `SELECT (
         (SELECT COUNT(*) FROM school_storage_orders WHERE payment_order_id = ? AND order_status != 'cancelled') +
         (SELECT COUNT(*) FROM school_rfid_orders WHERE payment_order_id = ? AND order_status != 'cancelled') +
         (SELECT COUNT(*) FROM school_attendance_machines WHERE payment_order_id = ? AND order_status != 'cancelled')
       ) AS remaining_count`,
      [parsedOrderId, parsedOrderId, parsedOrderId]
    );
    const remainingCount = parseInt(remRows?.remaining_count, 10) || 0;
    if (remainingCount === 0) {
      return await SubscriptionFulfillmentService.rejectOfflineAddonOrder({
        orderId: parsedOrderId,
        adminId,
        reason,
      });
    }
    return false;
  }

  /**
   * Super Admin Manual Plan Assignment / Enterprise Override (bypasses self-service restrictions with full audit trail)
   */
  static async manualAssignPlan({
    schoolId,
    planId,
    customEndDate = null,
    amountPaid = 0,
    reason = 'Manual plan assignment by SaaS Super Admin',
    adminId = null,
  }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const parsedSchoolId = parseInt(schoolId, 10);
      const parsedPlanId = parseInt(planId, 10);

      const [planRows] = await conn.query('SELECT * FROM subscription_plans WHERE id = ? LIMIT 1', [parsedPlanId]);
      if (planRows.length === 0) {
        const err = new Error('Target subscription plan not found.');
        err.statusCode = 404;
        throw err;
      }
      const plan = planRows[0];

      const lifecycle = await SubscriptionFulfillmentService.loadSchoolLifecycleSnapshot(parsedSchoolId, conn, true);
      const todayStr = getTodayIST();
      const isTrialPlan = String(plan.billing_cycle).toLowerCase() === 'trial';
      const endDate = customEndDate
        ? normalizeDateStr(customEndDate)
        : addCycleDuration(todayStr, plan.billing_cycle, plan.free_trial_days);

      const finalAmount = Math.max(0, parseFloat(amountPaid) || 0);
      const orderNo = generateOrderNo('ADM');

      const [ordRes] = await conn.query(
        `INSERT INTO subscription_payment_orders (
           order_no, school_id, order_type, action_type, plan_id, billing_cycle,
           plan_amount, subtotal_amount, grand_total, currency,
           payment_method, payload_snapshot_json, status, verified_by, verification_notes, paid_at
         ) VALUES (?, ?, 'manual_override', 'manual_override', ?, ?, ?, ?, ?, 'INR', 'super_admin_manual', ?, 'paid', ?, ?, NOW())`,
        [
          orderNo,
          parsedSchoolId,
          plan.id,
          plan.billing_cycle,
          finalAmount,
          finalAmount,
          finalAmount,
          JSON.stringify({
            breakdown: {
              plan_id: plan.id,
              plan_name: plan.plan_name,
              plan_price: finalAmount,
              billing_cycle: plan.billing_cycle,
              tax_amount: 0,
            },
          }),
          adminId || null,
          reason,
        ]
      );

      const paymentOrderId = ordRes.insertId;
      const invoiceNo = finalAmount > 0 ? formatInvoiceNo(paymentOrderId, todayStr) : null;
      if (invoiceNo) {
        await conn.query('UPDATE subscription_payment_orders SET invoice_no = ? WHERE id = ?', [invoiceNo, paymentOrderId]);
      }

      const carryStorageId = null;

      const [subRes] = await conn.query(
        `INSERT INTO school_subscriptions (
           school_id, plan_id, storage_plan_id, action_type,
           plan_amount, addons_amount, amount_paid,
           payment_gateway, payment_transaction_id, payment_order_id, invoice_no,
           payment_status, start_date, end_date, status,
           verified_by, verified_at, verification_notes,
           snapshot_max_students, snapshot_storage_gb, snapshot_tier_rank, snapshot_billing_cycle
         ) VALUES (?, ?, ?, 'manual_override', ?, 0.00, ?, 'super_admin_manual', ?, ?, ?, 'completed', ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
        [
          parsedSchoolId,
          plan.id,
          carryStorageId,
          finalAmount,
          finalAmount,
          orderNo,
          invoiceNo,
          todayStr,
          endDate,
          isTrialPlan ? 'trial' : 'active',
          adminId || null,
          reason,
          Number(plan.max_students) || 0,
          Math.max(0, parseInt(plan.included_storage_gb, 10) || 0),
          isTrialPlan ? 0 : (Number(plan.tier_rank) || 1),
          plan.billing_cycle,
        ]
      );

      const newSubId = subRes.insertId;
      await conn.query('UPDATE subscription_payment_orders SET activated_subscription_id = ? WHERE id = ?', [newSubId, paymentOrderId]);

      await conn.query(
        `UPDATE school_subscriptions
         SET status = 'superseded', superseded_by_id = ?
         WHERE school_id = ? AND id != ? AND status IN ('active', 'trial', 'pending')`,
        [newSubId, parsedSchoolId, newSubId]
      );

      // Cancel any dangling unpaid software plan orders (and their pending bundled add-on rows), releasing reserved coupons automatically
      const [danglingOrders] = await conn.query(
        `SELECT id FROM subscription_payment_orders
         WHERE school_id = ?
           AND id != ?
           AND order_type != 'addon_only'
           AND status IN ('created', 'pending_verification')
         FOR UPDATE`,
        [parsedSchoolId, paymentOrderId]
      );
      if (danglingOrders.length > 0) {
        const danglingIds = danglingOrders.map((o) => o.id);
        await conn.query(
          `UPDATE subscription_payment_orders
           SET status = 'rejected',
               verified_by = ?,
               verification_notes = 'Superseded by Super Admin manual plan assignment'
           WHERE id IN (?)`,
          [adminId || null, danglingIds]
        );
        await conn.query(
          `UPDATE school_storage_orders
           SET order_status = 'cancelled', remarks = 'Cancelled — superseded by Super Admin manual plan assignment', updated_at = NOW()
           WHERE payment_order_id IN (?) AND order_status = 'pending'`,
          [danglingIds]
        );
        await conn.query(
          `UPDATE school_rfid_orders
           SET order_status = 'cancelled', remarks = 'Cancelled — superseded by Super Admin manual plan assignment', updated_at = NOW()
           WHERE payment_order_id IN (?) AND order_status = 'pending'`,
          [danglingIds]
        );
        await conn.query(
          `UPDATE school_attendance_machines
           SET status = 2, order_status = 'cancelled', remarks = 'Cancelled — superseded by Super Admin manual plan assignment', updated_at = NOW()
           WHERE payment_order_id IN (?) AND order_status = 'pending'`,
          [danglingIds]
        );
      }

      // Credit any Push or SMS Notification Credits bundled with this subscription plan
      await SubscriptionFulfillmentService._creditIncludedPlanNotifications(conn, {
        schoolId: parsedSchoolId,
        plan,
        paymentOrderId,
      });

      await conn.query(
        `INSERT INTO subscription_audit_logs
           (school_id, subscription_id, payment_order_id, actor_type, actor_id, action, previous_state_json, new_state_json, reason)
         VALUES (?, ?, ?, 'saas_super_admin', ?, 'SUPER_ADMIN_MANUAL_OVERRIDE', ?, ?, ?)`,
        [
          parsedSchoolId,
          newSubId,
          paymentOrderId,
          adminId || null,
          JSON.stringify(lifecycle.activeSub || lifecycle.lastPaidSub || null),
          JSON.stringify({ subscription_id: newSubId, plan_id: plan.id, plan_name: plan.plan_name, start_date: todayStr, end_date: endDate, amount_paid: finalAmount }),
          reason,
        ]
      );

      await conn.commit();

      return {
        subscriptionId: newSubId,
        orderId: paymentOrderId,
        orderNo,
        invoiceNo,
        planName: plan.plan_name,
        startDate: todayStr,
        endDate,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Record a Razorpay payment failure without ever overwriting an already 'paid', 'pending_verification', or 'rejected' order
   */
  static async recordPaymentFailure({
    orderNo = null,
    razorpayOrderId = null,
    razorpayPaymentId = null,
    failureCode = null,
    failureReason = null,
    schoolId = null,
    publicOnboardingOnly = false,
  }) {
    if (!orderNo && !razorpayOrderId) return null;

    let whereSql = razorpayOrderId ? 'razorpay_order_id = ?' : 'order_no = ?';
    const params = [razorpayOrderId || orderNo];

    if (publicOnboardingOnly || !schoolId) {
      whereSql += " AND school_id IS NULL AND order_type IN ('onboarding', 'trial_with_addons')";
    } else {
      whereSql += ' AND school_id = ?';
      params.push(parseInt(schoolId, 10));
    }

    const [rows] = await pool.query(
      `SELECT id, order_no, razorpay_order_id, order_type, payment_method, status, grand_total
       FROM subscription_payment_orders
       WHERE ${whereSql}
       LIMIT 1`,
      params
    );

    if (rows.length === 0) return null;
    const ord = rows[0];
    if (ord.status === 'paid') {
      return { ...ord, alreadyPaid: true };
    }

    // Never allow gateway failure callbacks to overwrite offline bank_transfer or rejected orders
    if (ord.payment_method !== 'razorpay' || !['created', 'failed'].includes(ord.status)) {
      return null;
    }

    await pool.query(
      `UPDATE subscription_payment_orders
       SET status = 'failed',
           razorpay_payment_id = COALESCE(?, razorpay_payment_id),
           failure_code = ?,
           failure_reason = ?
       WHERE id = ? AND payment_method = 'razorpay' AND status IN ('created', 'failed')`,
      [
        razorpayPaymentId || null,
        failureCode ? String(failureCode).slice(0, 95) : 'PAYMENT_DECLINED',
        failureReason || 'Payment was declined or cancelled at gateway.',
        ord.id,
      ]
    );

    return await SubscriptionFulfillmentService.getOrderWithInvoice(ord.order_no, schoolId, {
      publicOnboardingOnly: Boolean(publicOnboardingOnly || !schoolId),
    });
  }

  /**
   * Fetch complete Order + Zero-GST Printable Invoice payload by order_no, razorpay_order_id, invoice_no, or id
   */
  static async getOrderWithInvoice(identifier, schoolId = null, options = {}) {
    if (!identifier) return null;
    const cleanId = String(identifier).trim();
    const publicOnboardingOnly = Boolean(options?.publicOnboardingOnly);
    const numericId = !publicOnboardingOnly && /^\d+$/.test(cleanId) ? parseInt(cleanId, 10) : -1;

    let sql = `
      SELECT o.*,
             p.plan_name, p.plan_code, p.max_students, p.included_storage_gb,
             ss.start_date AS sub_start_date, ss.end_date AS sub_end_date, ss.status AS sub_status,
             sm.school_name, sm.school_code, sm.email AS school_email, sm.phone_number AS school_phone, sm.address AS school_address,
             bam.account_title AS company_bank_title,
             bam.beneficiary_name AS company_bank_beneficiary,
             bam.account_number AS company_bank_account_number,
             bam.bank_name AS company_bank_name,
             bam.branch_name AS company_bank_branch,
             bam.ifsc_code AS company_bank_ifsc,
             bam.upi_id AS company_bank_upi
      FROM subscription_payment_orders o
      LEFT JOIN subscription_plans p ON o.plan_id = p.id
      LEFT JOIN school_subscriptions ss ON o.activated_subscription_id = ss.id
      LEFT JOIN school_master sm ON o.school_id = sm.id
      LEFT JOIN bank_account_master bam ON o.bank_account_id = bam.id
    `;
    const params = [];

    if (publicOnboardingOnly) {
      sql += ` WHERE (o.order_no = ? OR o.razorpay_order_id = ?) AND o.order_type IN ('onboarding', 'trial_with_addons')`;
      params.push(cleanId, cleanId);
    } else {
      sql += ` WHERE (o.id = ? OR o.order_no = ? OR o.razorpay_order_id = ? OR o.invoice_no = ?)`;
      params.push(numericId, cleanId, cleanId, cleanId);
    }

    if (schoolId) {
      sql += ' AND o.school_id = ?';
      params.push(parseInt(schoolId, 10));
    }

    sql += ' LIMIT 1';

    const [rows] = await pool.query(sql, params);
    if (rows.length === 0) return null;

    const row = rows[0];
    let snapshot = {};
    try {
      snapshot = row.payload_snapshot_json ? JSON.parse(row.payload_snapshot_json) : {};
    } catch (_) {}

    const breakdown = snapshot.breakdown || {};
    const lineItems = [];

    if (row.order_type !== 'addon_only' && row.plan_id) {
      const planTotal = parseFloat(row.plan_amount) || 0;
      lineItems.push({
        category: 'subscription_plan',
        title: `${row.plan_name || breakdown.plan_name || 'Subscription Plan'} (${String(row.billing_cycle || '').replace('_', ' ').toUpperCase()})`,
        quantity: 1,
        unit_price: planTotal,
        total_price: planTotal,
        total: planTotal,
      });
    }

    if (breakdown.storage) {
      const storageTotal = parseFloat(breakdown.storage.total_price) || 0;
      lineItems.push({
        category: 'cloud_storage',
        title: `Cloud Storage: ${breakdown.storage.plan_name} (${breakdown.storage.billing_cycle || breakdown.billing_cycle})`,
        quantity: breakdown.storage.quantity || 1,
        unit_price: parseFloat(breakdown.storage.unit_price) || 0,
        total_price: storageTotal,
        total: storageTotal,
      });
    }

    if (Array.isArray(breakdown.machines)) {
      for (const m of breakdown.machines) {
        const machineTotal = parseFloat(m.total_price) || 0;
        lineItems.push({
          category: 'attendance_machine',
          title: `Biometric Machine: ${m.machine_name} (${m.model_number || 'Hardware'})`,
          quantity: m.quantity || 1,
          unit_price: parseFloat(m.unit_price) || 0,
          total_price: machineTotal,
          total: machineTotal,
        });
      }
    }

    if (Array.isArray(breakdown.cards)) {
      for (const c of breakdown.cards) {
        const cardTotal = parseFloat(c.total_price) || 0;
        lineItems.push({
          category: 'rfid_cards',
          title: `RFID Smart Cards: ${c.card_name} (${c.card_code || 'RFID'})`,
          quantity: c.quantity || 1,
          unit_price: parseFloat(c.unit_price) || 0,
          total_price: cardTotal,
          total: cardTotal,
        });
      }
    }

    if (Array.isArray(breakdown.notifications)) {
      for (const n of breakdown.notifications) {
        const notifTotal = parseFloat(n.total_price) || 0;
        lineItems.push({
          category: 'notification_credits',
          title: `${n.name || `${String(n.type || '').toUpperCase()} Credits`}`,
          quantity: n.quantity || 0,
          unit_price: parseFloat(n.unit_price) || 0,
          total_price: notifTotal,
          total: notifTotal,
        });
      }
    }

    const storageAmount = parseFloat(row.storage_amount) || 0;
    const machinesAmount = parseFloat(row.machines_amount) || 0;
    const rfidAmount = parseFloat(row.rfid_amount) || 0;
    const notificationsAmount = parseFloat(row.notifications_amount) || 0;
    const addonsAmount =
      Math.round((storageAmount + machinesAmount + rfidAmount + notificationsAmount) * 100) / 100;

    const schoolName = row.school_name || snapshot?.extra?.school_name || null;
    const schoolCode = row.school_code || null;
    const schoolEmail = row.school_email || snapshot?.extra?.email || null;
    const schoolPhone = row.school_phone || snapshot?.extra?.phone || null;
    const schoolAddress = row.school_address || row.shipping_address || null;

    return {
      id: row.id,
      order_no: row.order_no,
      invoice_no: row.invoice_no,
      school_id: row.school_id,
      school_name: schoolName,
      school_code: schoolCode,
      school_email: schoolEmail,
      school_phone: schoolPhone,
      school_address: schoolAddress,
      school: {
        name: schoolName,
        code: schoolCode,
        email: schoolEmail,
        phone: schoolPhone,
        address: schoolAddress,
      },
      order_type: row.order_type,
      action_type: row.action_type,
      plan_id: row.plan_id,
      plan_name: row.plan_name || breakdown.plan_name || null,
      billing_cycle: row.billing_cycle,
      cycle_meta: row.billing_cycle ? getBillingCycleMeta(row.billing_cycle) : null,
      plan_amount: parseFloat(row.plan_amount) || 0,
      storage_amount: storageAmount,
      machines_amount: machinesAmount,
      rfid_amount: rfidAmount,
      notifications_amount: notificationsAmount,
      addons_amount: addonsAmount,
      subtotal_amount: parseFloat(row.subtotal_amount) || 0,
      coupon_code: row.coupon_code || null,
      discount_amount: parseFloat(row.discount_amount) || 0,
      tax_amount: 0, // Zero GST
      grand_total: parseFloat(row.grand_total) || 0,
      currency: row.currency || 'INR',
      payment_method: row.payment_method,
      razorpay_order_id: row.razorpay_order_id,
      razorpay_payment_id: row.razorpay_payment_id,
      utr_number: row.utr_number,
      bank_account_id: row.bank_account_id || snapshot?.extra?.bank_account?.id || null,
      company_bank_account:
        row.bank_account_id || snapshot?.extra?.bank_account
          ? {
              id: row.bank_account_id || snapshot?.extra?.bank_account?.id || null,
              account_title: row.company_bank_title || snapshot?.extra?.bank_account?.account_title || null,
              beneficiary_name: row.company_bank_beneficiary || snapshot?.extra?.bank_account?.beneficiary_name || null,
              account_number: row.company_bank_account_number || snapshot?.extra?.bank_account?.account_number || null,
              bank_name: row.company_bank_name || snapshot?.extra?.bank_account?.bank_name || null,
              branch_name: row.company_bank_branch || snapshot?.extra?.bank_account?.branch_name || null,
              ifsc_code: row.company_bank_ifsc || snapshot?.extra?.bank_account?.ifsc_code || null,
              upi_id: row.company_bank_upi || snapshot?.extra?.bank_account?.upi_id || null,
            }
          : null,
      shipping_address: row.shipping_address,
      status: row.status,
      failure_code: row.failure_code,
      failure_reason: row.failure_reason,
      subscription_id: row.activated_subscription_id,
      start_date: row.sub_start_date ? normalizeDateStr(row.sub_start_date) : null,
      end_date: row.sub_end_date ? normalizeDateStr(row.sub_end_date) : null,
      subscription_status: row.sub_status || null,
      verification_notes: row.verification_notes,
      paid_at: row.paid_at,
      created_at: row.created_at,
      line_items: lineItems,
      breakdown,
    };
  }

  /**
   * Fetch unified Billing & Order History for a School (combines subscription_payment_orders + legacy school_subscriptions)
   */
  static async getSchoolBillingHistory(schoolId) {
    const parsedSchoolId = parseInt(schoolId, 10);
    if (!parsedSchoolId) return [];

    const [orders] = await pool.query(
      `SELECT o.id, o.order_no, o.invoice_no, o.order_type, o.action_type, o.plan_id,
              COALESCE(p.plan_name, 'Add-ons & Credits') AS plan_name,
              o.billing_cycle, o.subtotal_amount, o.coupon_code, o.discount_amount, o.grand_total,
              o.payment_method, o.razorpay_order_id, o.razorpay_payment_id, o.utr_number, o.bank_account_id,
              bam.bank_name AS company_bank_name, bam.account_number AS company_bank_account_number, bam.ifsc_code AS company_bank_ifsc,
              o.status, o.failure_reason, o.paid_at, o.created_at,
              ss.start_date, ss.end_date, ss.status AS subscription_status
       FROM subscription_payment_orders o
       LEFT JOIN subscription_plans p ON o.plan_id = p.id
       LEFT JOIN school_subscriptions ss ON o.activated_subscription_id = ss.id
       LEFT JOIN bank_account_master bam ON o.bank_account_id = bam.id
       WHERE o.school_id = ?
         AND o.status != 'created'
       ORDER BY o.id DESC
       LIMIT 100`,
      [parsedSchoolId]
    );

    // Also include historical school_subscriptions rows created before subscription_payment_orders existed
    const [legacySubs] = await pool.query(
      `SELECT s.id AS subscription_id, s.invoice_no, s.action_type, s.plan_id,
              p.plan_name, p.billing_cycle,
              COALESCE(s.original_amount, s.amount_paid) AS subtotal_amount,
              s.discount_amount, s.amount_paid AS grand_total,
              s.payment_gateway AS payment_method, s.payment_transaction_id,
              s.payment_status, s.status AS subscription_status,
              s.start_date, s.end_date, s.created_at
       FROM school_subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.school_id = ?
         AND s.payment_order_id IS NULL
       ORDER BY s.id DESC
       LIMIT 50`,
      [parsedSchoolId]
    );

    const formattedOrders = orders.map((o) => ({
      record_source: 'payment_order',
      id: o.id,
      order_no: o.order_no,
      invoice_no: o.invoice_no,
      order_type: o.order_type,
      action_type: o.action_type,
      plan_name: o.plan_name,
      billing_cycle: o.billing_cycle,
      cycle_meta: o.billing_cycle ? getBillingCycleMeta(o.billing_cycle) : null,
      subtotal_amount: parseFloat(o.subtotal_amount) || 0,
      discount_amount: parseFloat(o.discount_amount) || 0,
      coupon_code: o.coupon_code,
      tax_amount: 0,
      grand_total: parseFloat(o.grand_total) || 0,
      payment_method: o.payment_method,
      bank_account_id: o.bank_account_id || null,
      company_bank_name: o.company_bank_name || null,
      company_bank_account_number: o.company_bank_account_number || null,
      company_bank_ifsc: o.company_bank_ifsc || null,
      transaction_ref: o.razorpay_payment_id || o.utr_number || o.razorpay_order_id || o.order_no,
      status: o.status,
      subscription_status: o.subscription_status,
      failure_reason: o.failure_reason,
      start_date: o.start_date ? normalizeDateStr(o.start_date) : null,
      end_date: o.end_date ? normalizeDateStr(o.end_date) : null,
      date: o.paid_at || o.created_at,
    }));

    const formattedLegacy = legacySubs.map((s) => ({
      record_source: 'legacy_subscription',
      id: `SUB-${s.subscription_id}`,
      subscription_id: s.subscription_id,
      order_no: `SUB-${String(s.subscription_id).padStart(5, '0')}`,
      invoice_no: s.invoice_no,
      order_type: s.action_type || 'onboarding',
      action_type: s.action_type || 'onboarding',
      plan_name: s.plan_name,
      billing_cycle: s.billing_cycle,
      cycle_meta: s.billing_cycle ? getBillingCycleMeta(s.billing_cycle) : null,
      subtotal_amount: parseFloat(s.subtotal_amount) || 0,
      discount_amount: parseFloat(s.discount_amount) || 0,
      coupon_code: null,
      tax_amount: 0,
      grand_total: parseFloat(s.grand_total) || 0,
      payment_method: s.payment_method,
      transaction_ref: s.payment_transaction_id,
      status:
        s.payment_status === 'completed'
          ? 'paid'
          : s.subscription_status === 'rejected'
          ? 'rejected'
          : s.payment_status === 'pending'
          ? 'pending_verification'
          : 'failed',
      subscription_status: s.subscription_status,
      failure_reason: null,
      start_date: s.start_date ? normalizeDateStr(s.start_date) : null,
      end_date: s.end_date ? normalizeDateStr(s.end_date) : null,
      date: s.created_at,
    }));
//
    return [...formattedOrders, ...formattedLegacy].sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    );
  }
}

module.exports = SubscriptionFulfillmentService;
