const crypto = require('crypto');
const SubscriptionModel = require('../models/subscription.model');
const CouponModel = require('../models/coupon.model');
const ApiResponse = require('../utils/api.response');
const { razorpayInstance, keyId, keySecret } = require('../config/razorpay.config');
const { pool } = require('../config/db.config');

/**
 * Calculates verified total and item breakdown strictly from database records
 */
const calculateVerifiedTotal = async ({
  plan,
  addon_ids = [],
  storage_plan_id = null,
  storage_qty = 1,
  selected_machines = [],
  selected_cards = [],
  selected_notifications = [],
  coupon_code = null,
  school_id = null,
}) => {
  let totalAmount = parseFloat(plan.price);
  const breakdown = {
    plan_name: plan.plan_name,
    plan_price: parseFloat(plan.price),
    billing_cycle: plan.billing_cycle,
    addons: [],
    storage: null,
    machines: [],
    cards: [],
    notifications: [],
  };

  // 1. Subscription child items / Add-ons
  const selectedAddonIds = (addon_ids || []).map(Number);
  if (selectedAddonIds.length > 0 && Array.isArray(plan.items)) {
    for (const item of plan.items) {
      if (selectedAddonIds.includes(Number(item.id)) && item.item_type === 'addon') {
        const itemPrice = parseFloat(item.price || 0);
        totalAmount += itemPrice;
        breakdown.addons.push({ id: item.id, item_name: item.item_name, price: itemPrice });
      }
    }
  }

  // 2. Storage Plan from storage_master
  if (storage_plan_id) {
    const [sRows] = await pool.query(
      'SELECT id, plan_name, storage_capacity, monthly_price, annual_price FROM storage_master WHERE id = ? AND status = 1 LIMIT 1',
      [parseInt(storage_plan_id, 10)]
    );
    if (sRows.length > 0) {
      const s = sRows[0];
      const sUnitRate = plan.billing_cycle === 'monthly' ? parseFloat(s.monthly_price) : parseFloat(s.annual_price);
      const sQuantity = Math.max(1, parseInt(storage_qty, 10) || 1);
      const sTotal = sUnitRate * sQuantity;
      totalAmount += sTotal;
      breakdown.storage = {
        id: s.id,
        plan_name: s.plan_name,
        storage_capacity: s.storage_capacity,
        quantity: sQuantity,
        unit_price: sUnitRate,
        total_price: sTotal,
      };
    }
  }

  // 3. Attendance Machines from attendance_machine_master
  if (Array.isArray(selected_machines) && selected_machines.length > 0) {
    for (const entry of selected_machines) {
      const mId = parseInt(entry.id || entry.machine_id, 10);
      const mQty = Math.max(1, parseInt(entry.quantity || entry.qty, 10) || 1);
      if (mId) {
        const [mRows] = await pool.query(
          'SELECT id, machine_name, model_number, unit_price FROM attendance_machine_master WHERE id = ? AND status = 1 LIMIT 1',
          [mId]
        );
        if (mRows.length > 0) {
          const m = mRows[0];
          const mUnitRate = parseFloat(m.unit_price);
          const mTotal = mUnitRate * mQty;
          totalAmount += mTotal;
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
  }

  // 4. RFID Cards from rfid_card_master
  if (Array.isArray(selected_cards) && selected_cards.length > 0) {
    for (const entry of selected_cards) {
      const cId = parseInt(entry.id || entry.card_id, 10);
      const cQty = Math.max(1, parseInt(entry.quantity || entry.qty, 10) || 1);
      if (cId) {
        const [cRows] = await pool.query(
          'SELECT id, card_name, card_code, unit_price, min_order_qty FROM rfid_card_master WHERE id = ? AND status = 1 LIMIT 1',
          [cId]
        );
        if (cRows.length > 0) {
          const c = cRows[0];
          const cUnitRate = parseFloat(c.unit_price);
          const cTotal = cUnitRate * cQty;
          totalAmount += cTotal;
          breakdown.cards.push({
            id: c.id,
            card_name: c.card_name,
            card_code: c.card_code,
            quantity: cQty,
            unit_price: cUnitRate,
            total_price: cTotal,
          });
        }
      }
    }
  }

  // 5. SMS & Push Notifications from notification_master (Strictly from database - NO FALLBACK DATA)
  if (Array.isArray(selected_notifications) && selected_notifications.length > 0) {
    const [notifMasterRows] = await pool.query('SELECT id, type, cost FROM notification_master');
    const rateMap = {};
    for (const r of notifMasterRows) {
      if (r.id) rateMap[r.id] = parseFloat(r.cost || 0);
      if (r.type && rateMap[r.type.toLowerCase()] === undefined) {
        rateMap[r.type.toLowerCase()] = parseFloat(r.cost || 0);
      }
    }

    for (const entry of selected_notifications) {
      const nId = parseInt(entry.id, 10);
      const nType = (entry.type || '').toLowerCase();
      const nQty = Math.max(0, parseInt(entry.quantity || entry.qty, 10) || 0);

      if (nQty > 0) {
        const unitRate = (!isNaN(nId) && rateMap[nId] !== undefined)
          ? rateMap[nId]
          : (rateMap[nType] !== undefined ? rateMap[nType] : 0);

        const nTotal = Math.round(unitRate * nQty * 100) / 100;
        totalAmount += nTotal;
        breakdown.notifications.push({
          id: !isNaN(nId) ? nId : null,
          type: nType,
          name: nType === 'sms' ? 'SMS Notifications' : 'Push Notifications',
          quantity: nQty,
          unit_price: unitRate,
          total_price: nTotal,
        });
      }
    }
  }

  // 6. Coupon validation & discount computation against database records
  const originalSubtotal = totalAmount;
  let couponInfo = null;
  let discountAmount = 0;

  if (coupon_code && String(coupon_code).trim()) {
    const couponValidation = await CouponModel.validateCoupon(coupon_code, originalSubtotal, school_id);
    if (!couponValidation.valid) {
      const err = new Error(couponValidation.message);
      err.statusCode = 400;
      throw err;
    }
    couponInfo = couponValidation.coupon;
    discountAmount = parseFloat(couponValidation.coupon.discountAmount) || 0;
  }

  const finalPayable = Math.max(0, Math.round((originalSubtotal - discountAmount) * 100) / 100);
  breakdown.subtotal = originalSubtotal;
  breakdown.discount_amount = discountAmount;
  breakdown.final_payable = finalPayable;
  breakdown.coupon = couponInfo;

  return {
    totalAmount: finalPayable,
    originalAmount: originalSubtotal,
    discountAmount,
    couponInfo,
    breakdown,
  };
};

class AdminSubscriptionController {
  /**
   * Get current school subscription status, trial countdown, and upgrade plans
   */
  static async getSubscriptionStatus(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const subscription = await SubscriptionModel.getSchoolSubscription(schoolId);
      const upgradePlans = await SubscriptionModel.getUpgradePlans(schoolId);
      const catalog = await SubscriptionModel.getConfigurationCatalog();

      return ApiResponse.success(res, 'Subscription status retrieved successfully.', {
        subscription,
        upgrade_plans: upgradePlans,
        catalog,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get standalone storage, machine, and rfid card options catalog
   */
  static async getConfigurationCatalog(req, res, next) {
    try {
      const catalog = await SubscriptionModel.getConfigurationCatalog();
      return ApiResponse.success(res, 'Configuration catalog retrieved successfully.', catalog);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create Razorpay Order for school subscription upgrade with configured add-ons, storage, machines & RFID cards
   */
  static async createSubscriptionOrder(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const {
        plan_id,
        planId,
        addon_ids,
        addonIds,
        storage_plan_id,
        storagePlanId,
        storage_qty,
        storageQty,
        selected_machines,
        selectedMachines,
        selected_cards,
        selectedCards,
        selected_notifications,
        selectedNotifications,
        coupon_code,
        couponCode,
      } = req.body;

      const targetPlanId = plan_id || planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please specify a plan_id to create an order.', null, 400);
      }

      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan) {
        return ApiResponse.error(res, 'The selected subscription plan was not found.', null, 404);
      }

      // Check downgrade prevention against current active subscription
      const currentSub = await SubscriptionModel.getSchoolSubscription(schoolId);
      if (currentSub && currentSub.status === 'active' && !currentSub.isTrial && currentSub.price !== null) {
        const currentPrice = parseFloat(currentSub.price);
        const targetPrice = parseFloat(plan.price);
        if (currentPrice > 0 && targetPrice < currentPrice) {
          return ApiResponse.error(
            res,
            `Downgrading to a lower-tier plan is not permitted. You are currently subscribed to the "${currentSub.plan_name}" plan (₹${currentPrice.toFixed(2)}). You may only remain on your current plan or upgrade to an equal or higher-tier plan.`,
            null,
            400
          );
        }
      }

      if (parseFloat(plan.price) <= 0) {
        return ApiResponse.error(res, 'Cannot create payment order for a free plan.', null, 400);
      }

      if (!keyId || !keySecret || keyId === 'rzp_test_placeholder_key') {
        return ApiResponse.error(
          res,
          'Razorpay keys are not configured. Please set valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server .env file.',
          null,
          500
        );
      }

      // Calculate total price accurately against database records including coupon
      const { totalAmount, originalAmount, discountAmount, couponInfo, breakdown } = await calculateVerifiedTotal({
        plan,
        addon_ids: addon_ids || addonIds,
        storage_plan_id: storage_plan_id || storagePlanId,
        storage_qty: storage_qty || storageQty,
        selected_machines: selected_machines || selectedMachines,
        selected_cards: selected_cards || selectedCards,
        selected_notifications: selected_notifications || selectedNotifications,
        coupon_code: coupon_code || couponCode,
        school_id: schoolId,
      });

      const amountInPaise = Math.round(totalAmount * 100);
      const receiptId = `SUB_${schoolId}_${Date.now()}`.slice(0, 40);

      const order = await razorpayInstance.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          school_id: String(schoolId),
          plan_id: String(plan.id),
          plan_name: plan.plan_name,
          addon_count: String(breakdown.addons.length),
          machines_count: String(breakdown.machines.length),
          cards_count: String(breakdown.cards.length),
          coupon_code: couponInfo?.code || '',
          discount_amount: String(discountAmount),
        },
      });

      return ApiResponse.success(res, 'Subscription payment order created successfully.', {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: keyId,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        price: plan.price,
        total_amount: totalAmount,
        original_amount: originalAmount,
        discount_amount: discountAmount,
        coupon: couponInfo,
        breakdown,
        billing_cycle: plan.billing_cycle,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify Razorpay Payment Signature and activate paid subscription
   */
  static async verifySubscriptionPayment(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const {
        razorpay_order_id,
        razorpayOrderId,
        razorpay_payment_id,
        razorpayPaymentId,
        razorpay_signature,
        razorpaySignature,
        plan_id,
        planId,
        addon_ids,
        addonIds,
        storage_plan_id,
        storagePlanId,
        storage_qty,
        storageQty,
        selected_machines,
        selectedMachines,
        selected_cards,
        selectedCards,
        selected_notifications,
        selectedNotifications,
        shipping_address,
        coupon_code,
        couponCode,
      } = req.body;

      const orderId = razorpay_order_id || razorpayOrderId;
      const paymentId = razorpay_payment_id || razorpayPaymentId;
      const signature = razorpay_signature || razorpaySignature;
      const targetPlanId = plan_id || planId;

      if (!orderId || !paymentId || !signature || !targetPlanId) {
        return ApiResponse.error(
          res,
          'Missing payment verification parameters (order_id, payment_id, signature, plan_id are required).',
          null,
          400
        );
      }

      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan) {
        return ApiResponse.error(res, 'Target subscription plan was not found.', null, 404);
      }

      // Check downgrade prevention against current active subscription
      const currentSub = await SubscriptionModel.getSchoolSubscription(schoolId);
      if (currentSub && currentSub.status === 'active' && !currentSub.isTrial && currentSub.price !== null) {
        const currentPrice = parseFloat(currentSub.price);
        const targetPrice = parseFloat(plan.price);
        if (currentPrice > 0 && targetPrice < currentPrice) {
          return ApiResponse.error(
            res,
            `Downgrading to a lower-tier plan is not permitted. You are currently subscribed to the "${currentSub.plan_name}" plan (₹${currentPrice.toFixed(2)}). You may only remain on your current plan or upgrade to an equal or higher-tier plan.`,
            null,
            400
          );
        }
      }

      // Cryptographically verify signature using HMAC SHA256
      const body = `${orderId}|${paymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(body.toString())
        .digest('hex');

      if (expectedSignature !== signature) {
        return ApiResponse.error(
          res,
          'Payment verification failed: Invalid transaction signature detected.',
          null,
          400
        );
      }

      // Calculate total amount paid including verified add-ons, storage, machines, cards, notifications, and coupon
      const { totalAmount, originalAmount, discountAmount, couponInfo, breakdown } = await calculateVerifiedTotal({
        plan,
        addon_ids: addon_ids || addonIds,
        storage_plan_id: storage_plan_id || storagePlanId,
        storage_qty: storage_qty || storageQty,
        selected_machines: selected_machines || selectedMachines,
        selected_cards: selected_cards || selectedCards,
        selected_notifications: selected_notifications || selectedNotifications,
        coupon_code: coupon_code || couponCode,
        school_id: schoolId,
      });

      const finalAmountPaid = req.body.amount_paid !== undefined ? parseFloat(req.body.amount_paid) : totalAmount;

      // Signature is valid. Create plan request in PENDING state awaiting Super Admin review and approval!
      const planRequest = await SubscriptionModel.requestPlanSelection({
        schoolId,
        planId: targetPlanId,
        amountPaid: finalAmountPaid,
        paymentGateway: 'razorpay',
        paymentTransactionId: paymentId,
        couponId: couponInfo?.id || null,
        discountAmount,
        originalAmount,
        paymentStatus: 'completed',
      });

      // Record RFID card purchase order in school_rfid_orders if cards were ordered
      if (breakdown.cards && breakdown.cards.length > 0) {
        for (const card of breakdown.cards) {
          try {
            const orderNo = `RFID_${schoolId}_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
            await pool.query(
              `INSERT INTO school_rfid_orders 
               (order_no, school_id, rfid_card_id, quantity, unit_price, total_amount, order_status, shipping_address, remarks, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'Ordered with subscription configuration (Pending Super Admin Approval)', NOW(), NOW())`,
              [orderNo, schoolId, card.id, card.quantity, card.unit_price, card.total_price, shipping_address || 'School Campus Delivery']
            );
          } catch (rfidErr) {
            console.error('Failed to log school_rfid_orders:', rfidErr.message);
          }
        }
      }

      // Record attendance machines in school_attendance_machines if machines were ordered
      if (breakdown.machines && breakdown.machines.length > 0) {
        for (const machine of breakdown.machines) {
          try {
            for (let i = 0; i < machine.quantity; i++) {
              const serialNo = `DEV_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
              await pool.query(
                `INSERT INTO school_attendance_machines 
                 (school_id, machine_master_id, device_serial_number, device_location, status, created_at, updated_at)
                 VALUES (?, ?, ?, 'Main School Gate - Scheduled Setup', 0, NOW(), NOW())`,
                [schoolId, machine.id, serialNo]
              );
            }
          } catch (mErr) {
            console.error('Failed to register school_attendance_machines:', mErr.message);
          }
        }
      }

      return ApiResponse.success(
        res,
        `🎉 Payment verified successfully! Your plan request for ${plan.plan_name} has been submitted and is currently pending Super Admin review and approval. Once approved, your new plan will become active.`,
        { ...planRequest, breakdown },
        200
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Validate a coupon against current checkout amount for the school
   */
  static async validateCoupon(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      const { code, amount } = req.body;
      if (!code || !String(code).trim()) {
        return ApiResponse.error(res, 'Coupon code is required.', null, 400);
      }
      const result = await CouponModel.validateCoupon(code, amount || 0, schoolId);
      if (!result.valid) {
        return ApiResponse.error(res, result.message, null, 400);
      }
      return ApiResponse.success(res, result.message, result.coupon);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upgrade to a paid subscription plan (Securely handled)
   * Prevents unauthorized free activations.
   */
  static async upgradeSubscription(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const {
        plan_id,
        planId,
        amount_paid,
        amountPaid,
        payment_gateway,
        paymentGateway,
        payment_transaction_id,
        paymentTransactionId,
        coupon_code,
        couponCode,
      } = req.body;

      const targetPlanId = plan_id || planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please select a plan to upgrade to.', null, 400);
      }

      const gateway = (payment_gateway || paymentGateway || '').toLowerCase();
      const txnId = payment_transaction_id || paymentTransactionId;

      // 1. Offline Bank Transfer Flow
      if (gateway === 'bank_transfer') {
        if (!txnId || String(txnId).trim().length < 4) {
          return ApiResponse.error(
            res,
            'Please provide a valid Bank Transfer reference number or UTR number.',
            null,
            400
          );
        }

        let couponInfo = null;
        let discountAmount = 0;
        let originalSubtotal = amount_paid !== undefined ? parseFloat(amount_paid) : (amountPaid !== undefined ? parseFloat(amountPaid) : null);

        const couponToApply = coupon_code || couponCode;
        if (couponToApply && String(couponToApply).trim()) {
          const couponRes = await CouponModel.validateCoupon(couponToApply, originalSubtotal || 0, schoolId);
          if (couponRes.valid) {
            couponInfo = couponRes.coupon;
            discountAmount = parseFloat(couponRes.coupon.discountAmount) || 0;
          }
        }

        const finalOfflineAmount = originalSubtotal !== null ? Math.max(0, originalSubtotal - discountAmount) : originalSubtotal;

        const offlineReq = await SubscriptionModel.requestOfflineUpgrade({
          schoolId,
          planId: targetPlanId,
          amountPaid: finalOfflineAmount,
          paymentTransactionId: String(txnId).trim(),
          couponId: couponInfo?.id || null,
          discountAmount,
          originalAmount: originalSubtotal,
        });

        return ApiResponse.success(
          res,
          `Offline payment request recorded with reference "${txnId}". Your plan will remain pending until the Super Admin reviews and approves it.`,
          offlineReq,
          200
        );
      }

      // 2. Direct Plan Selection / Request
      if (gateway === 'direct_selection' || gateway === 'request' || !gateway) {
        const plan = await SubscriptionModel.getPlanById(targetPlanId);
        if (!plan) {
          return ApiResponse.error(res, 'Selected subscription plan not found.', null, 404);
        }

        const planReq = await SubscriptionModel.requestPlanSelection({
          schoolId,
          planId: targetPlanId,
          amountPaid: amount_paid !== undefined ? amount_paid : (amountPaid !== undefined ? amountPaid : plan.price),
          paymentGateway: 'direct_selection',
          paymentTransactionId: txnId || `SEL_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
          paymentStatus: 'pending',
        });

        return ApiResponse.success(
          res,
          `Plan selection for "${plan.plan_name}" submitted successfully. It will remain pending until the Super Admin reviews and approves it.`,
          planReq,
          200
        );
      }

      // 3. Check for Platform Owner Authorization Secret (for internal scripts or emergency manual overrides)
      const platformSecret = req.headers['x-platform-admin-secret'];
      const isAuthorizedManual =
        platformSecret &&
        process.env.PLATFORM_ADMIN_SECRET &&
        platformSecret === process.env.PLATFORM_ADMIN_SECRET;

      if (isAuthorizedManual) {
        const upgraded = await SubscriptionModel.upgradeSubscription({
          schoolId,
          planId: targetPlanId,
          amountPaid: amount_paid || amountPaid,
          paymentGateway: gateway || 'platform_admin',
          paymentTransactionId: txnId || `MANUAL_${Date.now()}`,
          immediateActivate: true,
        });
        return ApiResponse.success(
          res,
          'Subscription manually activated by Platform Administrator.',
          upgraded,
          200
        );
      }

      return ApiResponse.error(
        res,
        'Invalid upgrade request. Please select a valid plan and payment option.',
        null,
        400
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Direct Plan Selection Endpoint:
   * When a user selects a plan, it remains pending until Super Admin reviews and approves it.
   */
  static async selectPlan(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const { plan_id, planId } = req.body;
      const targetPlanId = plan_id || planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please specify a plan_id to select a plan.', null, 400);
      }

      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan) {
        return ApiResponse.error(res, 'Selected subscription plan not found.', null, 404);
      }

      // Check downgrade prevention against current active subscription
      const currentSub = await SubscriptionModel.getSchoolSubscription(schoolId);
      if (currentSub && currentSub.status === 'active' && !currentSub.isTrial && currentSub.price !== null) {
        const currentPrice = parseFloat(currentSub.price);
        const targetPrice = parseFloat(plan.price);
        if (currentPrice > 0 && targetPrice < currentPrice) {
          return ApiResponse.error(
            res,
            `Downgrading to a lower-tier plan is not permitted. You are currently subscribed to the "${currentSub.plan_name}" plan (₹${currentPrice.toFixed(2)}). You may only remain on your current plan or upgrade to an equal or higher-tier plan.`,
            null,
            400
          );
        }
      }

      const planReq = await SubscriptionModel.requestPlanSelection({
        schoolId,
        planId: targetPlanId,
        amountPaid: plan.price,
        paymentGateway: 'direct_selection',
        paymentTransactionId: `SEL_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
        paymentStatus: 'pending',
      });

      return ApiResponse.success(
        res,
        `Plan selection for "${plan.plan_name}" submitted successfully. It will remain pending until the Super Admin reviews and approves it.`,
        planReq,
        200
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminSubscriptionController;

