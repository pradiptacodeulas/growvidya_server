const crypto = require('crypto');
const SubscriptionModel = require('../models/subscription.model');
const CouponModel = require('../models/coupon.model');
const SubscriptionPolicyService = require('../services/subscriptionPolicy.service');
const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');
const StorageQuotaService = require('../services/storageQuota.service');
const ApiResponse = require('../utils/api.response');
const { getRazorpayConfig } = require('../config/razorpay.config');
const { pool } = require('../config/db.config');
const { getBillingCycleMeta } = require('../constants/subscriptionModules.constant');

function verifyRazorpaySignature(orderId, paymentId, signature, keySecret) {
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const receivedBuf = Buffer.from(String(signature || ''), 'utf8');
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

class AdminSubscriptionController {
  /**
   * GET /api/v1/admin/subscription/status
   * Current school subscription status, dynamic billing cycles, annotated upgrade/renewal plans, storage quota & catalog
   */
  static async getSubscriptionStatus(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const [subscription, upgradePlans, catalog, storageQuota] = await Promise.all([
        SubscriptionModel.getSchoolSubscription(schoolId),
        SubscriptionModel.getUpgradePlans(schoolId),
        SubscriptionModel.getConfigurationCatalog(),
        StorageQuotaService.getSchoolStorageQuota(schoolId).catch(() => null),
      ]);

      // Derive distinct active billing cycles dynamically from DB plans
      const cycleMap = new Map();
      for (const p of upgradePlans) {
        const key = String(p.billing_cycle || '').toLowerCase();
        if (key && !cycleMap.has(key)) {
          cycleMap.set(key, getBillingCycleMeta(key));
        }
      }
      const activeCycles = Array.from(cycleMap.values()).sort((a, b) => a.months - b.months);

      return ApiResponse.success(res, 'Subscription status retrieved successfully.', {
        subscription,
        storage_quota: storageQuota,
        upgrade_plans: upgradePlans,
        active_cycles: activeCycles,
        catalog,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/subscription/config-catalog
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
   * POST /api/v1/admin/subscription/create-order
   * Creates an authoritative server-bound checkout order intent in `subscription_payment_orders`
   * (zero GST, strict no-downgrade enforcement, scoped coupon check, 100%-coupon instant activation support).
   */
  static async createSubscriptionOrder(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const targetPlanId = req.body.plan_id || req.body.planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please specify a plan_id to create an order.', null, 400);
      }

      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan || Number(plan.status) !== 1) {
        return ApiResponse.error(res, 'The selected subscription plan was not found or is inactive.', null, 404);
      }

      if (String(plan.billing_cycle).toLowerCase() === 'trial' || parseFloat(plan.price) <= 0) {
        return ApiResponse.error(res, 'Trial plans cannot be purchased via paid checkout.', null, 400);
      }

      // 1. Authoritative Policy & No-Downgrade Enforcement
      const lifecycle = await SubscriptionFulfillmentService.loadSchoolLifecycleSnapshot(schoolId);
      const transition = SubscriptionPolicyService.classifyPlanTransition({
        activeSub: lifecycle.activeSub,
        lastPaidSub: lifecycle.lastPaidSub,
        hasClaimedTrial: lifecycle.hasClaimedTrial,
        targetPlan: plan,
        isTrialIntent: false,
        activeStudentCount: lifecycle.activeStudentCount,
      });

      if (!transition.allowed) {
        return ApiResponse.error(
          res,
          transition.reason,
          { code: transition.code, transition_type: transition.transition_type },
          400
        );
      }

      // 2. Server-Verified Zero-GST Cart Calculation
      const verifiedCalc = await SubscriptionPolicyService.calculateVerifiedCheckout({
        plan,
        is_trial: false,
        is_addon_only: false,
        storage_plan_id: req.body.storage_plan_id || req.body.storagePlanId || null,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        storage_billing_cycle: req.body.storage_billing_cycle || plan.billing_cycle,
        selected_machines: req.body.selected_machines || req.body.selectedMachines || [],
        selected_cards: req.body.selected_cards || req.body.selectedCards || [],
        selected_notifications: req.body.selected_notifications || req.body.selectedNotifications || [],
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: schoolId,
      });

      const orderType = transition.action_type === 'upgrade' ? 'upgrade' : 'renewal';
      const shippingAddress = req.body.shipping_address || req.body.shippingAddress || null;

      // 3. Handle 100% Discount Coupon (₹0 Payable) -> Instant Activation without calling Razorpay!
      if (verifiedCalc.grandTotal <= 0) {
        const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
          schoolId,
          orderType,
          actionType: transition.action_type,
          plan,
          verifiedCalc,
          transition,
          paymentMethod: 'coupon_100',
          shippingAddress,
        });

        const fulfilled = await SubscriptionFulfillmentService.fulfillPaidOrder({
          orderId: orderIntent.orderId,
          expectedSchoolId: schoolId,
          actorType: 'school_admin',
          actorId: req.user?.id || null,
          verificationNotes: `Activated immediately via 100% coupon (${verifiedCalc.couponInfo?.code || 'COUPON'})`,
        });

        return ApiResponse.success(res, 'Subscription activated immediately via 100% discount coupon.', {
          zero_amount_activated: true,
          order_no: fulfilled.orderNo,
          invoice_no: fulfilled.invoiceNo,
          subscription_id: fulfilled.subscriptionId,
          status: 'active',
          plan_id: plan.id,
          plan_name: plan.plan_name,
          start_date: fulfilled.startDate,
          end_date: fulfilled.endDate,
          total_amount: 0,
          original_amount: verifiedCalc.subtotalAmount,
          discount_amount: verifiedCalc.discountAmount,
          tax_amount: 0,
          coupon: verifiedCalc.couponInfo,
          breakdown: verifiedCalc.breakdown,
          transition,
        });
      }

      // 4. Standard Razorpay Order Creation
      const razorpayConfig = await getRazorpayConfig();
      if (!razorpayConfig?.razorpayInstance || !razorpayConfig.keyId || !razorpayConfig.keySecret) {
        return ApiResponse.error(
          res,
          'Online payment gateway is currently unavailable. Please configure Razorpay credentials or use Offline Bank Transfer.',
          null,
          503
        );
      }

      const amountInPaise = Math.round(verifiedCalc.grandTotal * 100);
      const receiptId = `SUB_${schoolId}_${Date.now()}`.slice(0, 40);

      // Persist order intent first or create Razorpay order and bind order_no in notes
      let rzpOrder;
      try {
        rzpOrder = await razorpayConfig.razorpayInstance.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: receiptId,
          notes: {
            school_id: String(schoolId),
            plan_id: String(plan.id),
            plan_name: plan.plan_name,
            action_type: transition.action_type,
            coupon_code: verifiedCalc.couponInfo?.code || '',
          },
        });
      } catch (rzpErr) {
        return ApiResponse.error(
          res,
          'Failed to initialize payment order with Razorpay. Please check Payment Gateway Settings.',
          null,
          502
        );
      }

      const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
        schoolId,
        orderType,
        actionType: transition.action_type,
        plan,
        verifiedCalc,
        transition,
        paymentMethod: 'razorpay',
        razorpayOrderId: rzpOrder.id,
        shippingAddress,
      });

      return ApiResponse.success(res, 'Subscription payment order created successfully.', {
        zero_amount_activated: false,
        order_id: rzpOrder.id,
        order_no: orderIntent.orderNo,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency || 'INR',
        key_id: razorpayConfig.keyId,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        price: plan.price,
        total_amount: verifiedCalc.grandTotal,
        original_amount: verifiedCalc.subtotalAmount,
        discount_amount: verifiedCalc.discountAmount,
        tax_amount: 0,
        coupon: verifiedCalc.couponInfo,
        breakdown: verifiedCalc.breakdown,
        billing_cycle: plan.billing_cycle,
        transition,
      });
    } catch (error) {
      if (error.statusCode) {
        return ApiResponse.error(res, error.message, { code: error.code || null }, error.statusCode);
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/subscription/verify-payment
   * Verifies Razorpay HMAC signature against persisted `subscription_payment_orders` row
   * and activates the subscription + add-ons + SMS wallet IMMEDIATELY (`status = 'active'`).
   */
  static async verifySubscriptionPayment(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const orderId = req.body.razorpay_order_id || req.body.razorpayOrderId;
      const paymentId = req.body.razorpay_payment_id || req.body.razorpayPaymentId;
      const signature = req.body.razorpay_signature || req.body.razorpaySignature;

      if (!orderId || !paymentId || !signature) {
        return ApiResponse.error(
          res,
          'Missing payment verification parameters (razorpay_order_id, razorpay_payment_id, razorpay_signature).',
          null,
          400
        );
      }

      const razorpayConfig = await getRazorpayConfig();
      if (!razorpayConfig?.keySecret) {
        return ApiResponse.error(
          res,
          'Payment verification is unavailable because Razorpay credentials are not configured.',
          null,
          503
        );
      }

      if (!verifyRazorpaySignature(orderId, paymentId, signature, razorpayConfig.keySecret)) {
        return ApiResponse.error(
          res,
          'Payment verification failed: Invalid cryptographic signature.',
          { code: 'INVALID_PAYMENT_SIGNATURE' },
          400
        );
      }

      const persistedOrder = await SubscriptionFulfillmentService.getOrderWithInvoice(orderId, schoolId);
      if (!persistedOrder) {
        return ApiResponse.error(
          res,
          'Payment order record not found for your school.',
          { code: 'ORDER_NOT_FOUND' },
          404
        );
      }

      // Cross-verify Razorpay gateway order amount matches server-persisted grand_total
      if (razorpayConfig.razorpayInstance?.orders?.fetch) {
        try {
          const remoteOrder = await razorpayConfig.razorpayInstance.orders.fetch(orderId);
          const expectedPaise = Math.round(parseFloat(persistedOrder.grand_total) * 100);
          if (remoteOrder && Number(remoteOrder.amount) !== expectedPaise) {
            return ApiResponse.error(
              res,
              'Order amount mismatch detected during verification.',
              { code: 'AMOUNT_MISMATCH' },
              400
            );
          }
        } catch (_) {
          // If network fetch fails transiently, HMAC signature + DB-bound order_id already prevents tampering
        }
      }

      const fulfilled = await SubscriptionFulfillmentService.fulfillPaidOrder({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        expectedSchoolId: schoolId,
        actorType: 'school_admin',
        actorId: req.user?.id || null,
        verificationNotes: 'Instant activation via verified Razorpay payment',
      });

      const invoiceOrder = await SubscriptionFulfillmentService.getOrderWithInvoice(fulfilled.orderNo, schoolId);

      return ApiResponse.success(
        res,
        `Payment verified! ${fulfilled.planName || 'Your order'} is now active immediately.`,
        {
          status: 'active',
          order_no: fulfilled.orderNo,
          invoice_no: fulfilled.invoiceNo,
          subscription_id: fulfilled.subscriptionId,
          school_id: schoolId,
          plan_name: fulfilled.planName,
          start_date: fulfilled.startDate,
          end_date: fulfilled.endDate,
          amount_paid: fulfilled.grandTotal,
          tax_amount: 0,
          transaction_id: paymentId,
          breakdown: fulfilled.breakdown,
          order: invoiceOrder,
        },
        200
      );
    } catch (error) {
      if (error.statusCode) {
        return ApiResponse.error(res, error.message, { code: error.code || null }, error.statusCode);
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/subscription/create-addon-order
   * Creates a Razorpay order for standalone mid-cycle Add-on purchases (Storage, Hardware, RFID, SMS/Push Credits)
   */
  static async createAddonOrder(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const storagePlanId = req.body.storage_plan_id || req.body.storagePlanId || null;
      const machines = req.body.selected_machines || req.body.selectedMachines || [];
      const cards = req.body.selected_cards || req.body.selectedCards || [];
      const notifications = req.body.selected_notifications || req.body.selectedNotifications || [];

      if (
        !storagePlanId &&
        (!Array.isArray(machines) || machines.length === 0) &&
        (!Array.isArray(cards) || cards.length === 0) &&
        (!Array.isArray(notifications) || notifications.length === 0)
      ) {
        return ApiResponse.badRequest(
          res,
          'Please select at least one add-on (Cloud Storage, Attendance Machine, RFID Cards, or SMS/Push Credits).'
        );
      }

      const storageCycle = req.body.billing_cycle || req.body.billingCycle || 'annual';
      const verifiedCalc = await SubscriptionPolicyService.calculateVerifiedCheckout({
        plan: null,
        is_trial: false,
        is_addon_only: true,
        storage_plan_id: storagePlanId,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        storage_billing_cycle: storageCycle,
        selected_machines: machines,
        selected_cards: cards,
        selected_notifications: notifications,
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: schoolId,
      });

      const shippingAddress = req.body.shipping_address || req.body.shippingAddress || null;

      if (verifiedCalc.grandTotal <= 0) {
        const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
          schoolId,
          orderType: 'addon_only',
          actionType: 'addon_only',
          plan: null,
          verifiedCalc,
          paymentMethod: 'coupon_100',
          shippingAddress,
        });
        const fulfilled = await SubscriptionFulfillmentService.fulfillPaidOrder({
          orderId: orderIntent.orderId,
          expectedSchoolId: schoolId,
          actorType: 'school_admin',
          actorId: req.user?.id || null,
          verificationNotes: 'Standalone add-on activated via 100% coupon',
        });
        return ApiResponse.success(res, 'Add-on order activated immediately.', {
          zero_amount_activated: true,
          order_no: fulfilled.orderNo,
          invoice_no: fulfilled.invoiceNo,
          total_amount: 0,
          tax_amount: 0,
          breakdown: verifiedCalc.breakdown,
        });
      }

      const razorpayConfig = await getRazorpayConfig();
      if (!razorpayConfig?.razorpayInstance || !razorpayConfig.keyId || !razorpayConfig.keySecret) {
        return ApiResponse.error(
          res,
          'Online payment gateway is currently unavailable. Please configure Razorpay credentials or use Offline Bank Transfer.',
          null,
          503
        );
      }

      const amountInPaise = Math.round(verifiedCalc.grandTotal * 100);
      const rzpOrder = await razorpayConfig.razorpayInstance.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `ADD_${schoolId}_${Date.now()}`.slice(0, 40),
        notes: {
          school_id: String(schoolId),
          order_type: 'addon_only',
        },
      });

      const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
        schoolId,
        orderType: 'addon_only',
        actionType: 'addon_only',
        plan: null,
        verifiedCalc,
        paymentMethod: 'razorpay',
        razorpayOrderId: rzpOrder.id,
        shippingAddress,
      });

      return ApiResponse.success(res, 'Add-on payment order created successfully.', {
        zero_amount_activated: false,
        order_id: rzpOrder.id,
        order_no: orderIntent.orderNo,
        amount: rzpOrder.amount,
        currency: 'INR',
        key_id: razorpayConfig.keyId,
        total_amount: verifiedCalc.grandTotal,
        original_amount: verifiedCalc.subtotalAmount,
        discount_amount: verifiedCalc.discountAmount,
        tax_amount: 0,
        coupon: verifiedCalc.couponInfo,
        breakdown: verifiedCalc.breakdown,
      });
    } catch (error) {
      if (error.statusCode) {
        return ApiResponse.error(res, error.message, { code: error.code || null }, error.statusCode);
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/subscription/verify-addon-payment
   * Verifies Razorpay signature for standalone add-ons (delegates to verifySubscriptionPayment)
   */
  static async verifyAddonPayment(req, res, next) {
    return await AdminSubscriptionController.verifySubscriptionPayment(req, res, next);
  }

  /**
   * POST /api/v1/admin/subscription/purchase-addons
   * Offline Bank Transfer (with UTR) for standalone Add-on purchases
   */
  static async purchaseAddons(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const utrNumber =
        req.body.utr_number ||
        req.body.utrNumber ||
        req.body.payment_transaction_id ||
        req.body.paymentTransactionId;

      if (!utrNumber || String(utrNumber).trim().length < 4) {
        return ApiResponse.badRequest(
          res,
          'A valid Bank Transfer UTR / Reference Number is required for offline add-on orders, or use Online Razorpay Checkout.'
        );
      }

      const storagePlanId = req.body.storage_plan_id || req.body.storagePlanId || null;
      const machines = req.body.selected_machines || req.body.selectedMachines || [];
      const cards = req.body.selected_cards || req.body.selectedCards || [];
      const notifications = req.body.selected_notifications || req.body.selectedNotifications || [];

      if (
        !storagePlanId &&
        (!Array.isArray(machines) || machines.length === 0) &&
        (!Array.isArray(cards) || cards.length === 0) &&
        (!Array.isArray(notifications) || notifications.length === 0)
      ) {
        return ApiResponse.badRequest(
          res,
          'Please select at least one add-on product (Cloud Storage, Attendance Machine, RFID Card, or SMS/Push Credits).'
        );
      }

      const storageCycle = req.body.billing_cycle || req.body.billingCycle || 'annual';
      const verifiedCalc = await SubscriptionPolicyService.calculateVerifiedCheckout({
        plan: null,
        is_trial: false,
        is_addon_only: true,
        storage_plan_id: storagePlanId,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        storage_billing_cycle: storageCycle,
        selected_machines: machines,
        selected_cards: cards,
        selected_notifications: notifications,
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: schoolId,
      });

      const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
        schoolId,
        orderType: 'addon_only',
        actionType: 'addon_only',
        plan: null,
        verifiedCalc,
        paymentMethod: 'bank_transfer',
        utrNumber: String(utrNumber).trim(),
        shippingAddress: req.body.shipping_address || req.body.shippingAddress || null,
        extraMetadata: { remarks: req.body.remarks || 'Offline standalone add-on purchase' },
      });

      return ApiResponse.created(
        res,
        `Offline add-on order (${orderIntent.orderNo}) recorded with UTR "${String(utrNumber).trim()}". Items will activate once verified by Super Admin.`,
        {
          order_no: orderIntent.orderNo,
          status: 'pending_verification',
          total_amount: verifiedCalc.grandTotal,
          tax_amount: 0,
          payment_transaction_id: String(utrNumber).trim(),
          breakdown: verifiedCalc.breakdown,
        }
      );
    } catch (error) {
      if (error.statusCode) {
        return ApiResponse.error(res, error.message, { code: error.code || null }, error.statusCode);
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/subscription/validate-coupon
   * Validates coupon against scoped eligible subtotal (protects hardware & SMS margins!)
   */
  static async validateCoupon(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      const { code, amount, plan_amount, storage_amount, check_only, checkOnly } = req.body;
      if (!code || !String(code).trim()) {
        return ApiResponse.error(res, 'Coupon code is required.', null, 400);
      }

      const totalAmt = parseFloat(amount) || 0;
      const options = { checkOnly: Boolean(check_only || checkOnly) };
      if (plan_amount !== undefined) options.planAmount = parseFloat(plan_amount) || 0;
      if (storage_amount !== undefined) options.storageAmount = parseFloat(storage_amount) || 0;

      const result = await CouponModel.validateCoupon(code, totalAmt, schoolId, options);
      if (!result.valid) {
        return ApiResponse.error(res, result.message, null, 400);
      }
      return ApiResponse.success(res, result.message, result.coupon);
    } catch (error) {
      next(error);
    }
  }

  static async removeCoupon(req, res, next) {
    try {
      const { code } = req.body;
      if (code && String(code).trim()) {
        await CouponModel.decrementAppliedCount(code);
      }
      return ApiResponse.success(res, 'Coupon removed.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/subscription/upgrade
   * Offline Bank Transfer Submission (with UTR + full Add-on bundle support)
   */
  static async upgradeSubscription(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const targetPlanId = req.body.plan_id || req.body.planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please select a plan to upgrade or renew.', null, 400);
      }

      const gateway = String(req.body.payment_gateway || req.body.paymentGateway || '').toLowerCase();
      const txnId =
        req.body.utr_number ||
        req.body.utrNumber ||
        req.body.payment_transaction_id ||
        req.body.paymentTransactionId;

      if (gateway !== 'bank_transfer') {
        return ApiResponse.error(
          res,
          'Paid plans require verified Online Payment (Razorpay) or an Offline Bank Transfer with a valid UTR reference.',
          { code: 'PAYMENT_VERIFICATION_REQUIRED' },
          400
        );
      }

      if (!txnId || String(txnId).trim().length < 4) {
        return ApiResponse.error(
          res,
          'Please provide a valid Bank Transfer UTR / Reference number (minimum 4 characters).',
          { code: 'UTR_REQUIRED' },
          400
        );
      }

      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan || Number(plan.status) !== 1) {
        return ApiResponse.error(res, 'Selected subscription plan not found or inactive.', null, 404);
      }

      const lifecycle = await SubscriptionFulfillmentService.loadSchoolLifecycleSnapshot(schoolId);
      const transition = SubscriptionPolicyService.classifyPlanTransition({
        activeSub: lifecycle.activeSub,
        lastPaidSub: lifecycle.lastPaidSub,
        hasClaimedTrial: lifecycle.hasClaimedTrial,
        targetPlan: plan,
        isTrialIntent: false,
        activeStudentCount: lifecycle.activeStudentCount,
      });

      if (!transition.allowed) {
        return ApiResponse.error(
          res,
          transition.reason,
          { code: transition.code, transition_type: transition.transition_type },
          400
        );
      }

      const verifiedCalc = await SubscriptionPolicyService.calculateVerifiedCheckout({
        plan,
        is_trial: false,
        is_addon_only: false,
        storage_plan_id: req.body.storage_plan_id || req.body.storagePlanId || null,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        storage_billing_cycle: req.body.storage_billing_cycle || plan.billing_cycle,
        selected_machines: req.body.selected_machines || req.body.selectedMachines || [],
        selected_cards: req.body.selected_cards || req.body.selectedCards || [],
        selected_notifications: req.body.selected_notifications || req.body.selectedNotifications || [],
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: schoolId,
      });

      const orderType = transition.action_type === 'upgrade' ? 'upgrade' : 'renewal';
      const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
        schoolId,
        orderType,
        actionType: transition.action_type,
        plan,
        verifiedCalc,
        transition,
        paymentMethod: 'bank_transfer',
        utrNumber: String(txnId).trim(),
        shippingAddress: req.body.shipping_address || req.body.shippingAddress || null,
      });

      return ApiResponse.success(
        res,
        `Offline Bank Transfer recorded (Order: ${orderIntent.orderNo}, UTR: ${String(txnId).trim()}). Your submission is queued for Super Admin verification.`,
        {
          order_no: orderIntent.orderNo,
          subscription_id: orderIntent.pendingSubscriptionId,
          school_id: schoolId,
          plan_id: plan.id,
          plan_name: plan.plan_name,
          amount_paid: verifiedCalc.grandTotal,
          tax_amount: 0,
          transaction_id: String(txnId).trim(),
          status: 'pending',
          breakdown: verifiedCalc.breakdown,
          transition,
        },
        200
      );
    } catch (error) {
      if (error.statusCode) {
        return ApiResponse.error(res, error.message, { code: error.code || null }, error.statusCode);
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/subscription/select-plan
   * Redirects unverified plan selections to require verified payment or UTR bank transfer
   */
  static async selectPlan(req, res, next) {
    req.body.payment_gateway = req.body.payment_gateway || 'bank_transfer';
    return await AdminSubscriptionController.upgradeSubscription(req, res, next);
  }

  /**
   * POST /api/v1/admin/subscription/record-payment-failure
   */
  static async recordPaymentFailure(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      const recorded = await SubscriptionFulfillmentService.recordPaymentFailure({
        orderNo: req.body.order_no || req.body.orderNo || null,
        razorpayOrderId: req.body.razorpay_order_id || req.body.razorpayOrderId || null,
        razorpayPaymentId: req.body.razorpay_payment_id || req.body.razorpayPaymentId || null,
        failureCode: req.body.error_code || req.body.failure_code || 'PAYMENT_FAILED',
        failureReason: req.body.error_description || req.body.failure_reason || 'Payment cancelled or failed.',
        schoolId,
      });
      return ApiResponse.success(res, 'Payment failure logged.', recorded);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/subscription/orders
   * Unified Billing & Order History for the School
   */
  static async getBillingHistory(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }
      const history = await SubscriptionFulfillmentService.getSchoolBillingHistory(schoolId);
      return ApiResponse.success(res, 'Billing history retrieved successfully.', {
        orders: history,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/subscription/orders/:orderNo
   * GET /api/v1/admin/subscription/orders/:orderNo/invoice
   * Order status + Printable Zero-GST Invoice payload
   */
  static async getOrderDetails(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }
      const orderNo = req.params.orderNo;
      const order = await SubscriptionFulfillmentService.getOrderWithInvoice(orderNo, schoolId);
      if (!order) {
        return ApiResponse.error(res, 'Order or invoice not found.', null, 404);
      }
      return ApiResponse.success(res, 'Order details retrieved successfully.', order);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/subscription/notification-wallet
   * School SMS & Push Notification Wallet balances + recent ledger entries
   */
  static async getNotificationWallet(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const wallet = await SubscriptionModel.getNotificationWallet(schoolId);
      const [ledger] = await pool.query(
        `SELECT id, channel, entry_type, units, balance_after, unit_price, total_amount, payment_order_id, reference_note, created_at
         FROM school_notification_ledger
         WHERE school_id = ?
         ORDER BY id DESC
         LIMIT 50`,
        [parseInt(schoolId, 10)]
      );

      return ApiResponse.success(res, 'Notification wallet retrieved successfully.', {
        wallet,
        ledger: ledger || [],
      });
    } catch (error) {
      next(error);
    }
  }
}

AdminSubscriptionController.calculateVerifiedTotal = SubscriptionPolicyService.calculateVerifiedCheckout;

module.exports = AdminSubscriptionController;
