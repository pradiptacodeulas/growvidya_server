const crypto = require('crypto');
const SubscriptionModel = require('../models/subscription.model');
const ApiResponse = require('../utils/api.response');
const { razorpayInstance, keyId, keySecret } = require('../config/razorpay.config');

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
      const upgradePlans = await SubscriptionModel.getUpgradePlans();

      return ApiResponse.success(res, 'Subscription status retrieved successfully.', {
        subscription,
        upgrade_plans: upgradePlans,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create Razorpay Order for school subscription upgrade
   */
  static async createSubscriptionOrder(req, res, next) {
    try {
      const schoolId = req.user?.school_id || req.user?.schoolId;
      if (!schoolId) {
        return ApiResponse.error(res, 'School ID not found in session.', null, 400);
      }

      const { plan_id, planId } = req.body;
      const targetPlanId = plan_id || planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please specify a plan_id to create an order.', null, 400);
      }

      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan) {
        return ApiResponse.error(res, 'The selected subscription plan was not found.', null, 404);
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

      const amountInPaise = Math.round(parseFloat(plan.price) * 100);
      const receiptId = `SUB_${schoolId}_${Date.now()}`.slice(0, 40);

      const order = await razorpayInstance.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          school_id: String(schoolId),
          plan_id: String(plan.id),
          plan_name: plan.plan_name,
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

      // Signature is valid. Activate the school subscription
      const upgraded = await SubscriptionModel.upgradeSubscription({
        schoolId,
        planId: targetPlanId,
        amountPaid: plan.price,
        paymentGateway: 'razorpay',
        paymentTransactionId: paymentId,
      });

      return ApiResponse.success(
        res,
        `🎉 Payment verified successfully! Your school has been upgraded to ${plan.plan_name}.`,
        upgraded,
        200
      );
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

        const offlineReq = await SubscriptionModel.requestOfflineUpgrade({
          schoolId,
          planId: targetPlanId,
          amountPaid: amount_paid || amountPaid,
          paymentTransactionId: String(txnId).trim(),
        });

        return ApiResponse.success(
          res,
          `Offline payment request recorded with reference "${txnId}". Our team will verify the payment and activate your subscription within 24 hours.`,
          offlineReq,
          200
        );
      }

      // 2. Check for Platform Owner Authorization Secret (for internal scripts or emergency manual overrides)
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
        });
        return ApiResponse.success(
          res,
          'Subscription manually activated by Platform Administrator.',
          upgraded,
          200
        );
      }

      // 3. Reject all unverified/dummy free upgrades
      return ApiResponse.error(
        res,
        'Direct unverified upgrades are not permitted. Please use Instant Online Checkout (Razorpay) or submit an Offline Bank Transfer request with your transfer reference number.',
        null,
        403
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminSubscriptionController;

