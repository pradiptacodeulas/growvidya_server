const { pool } = require('../config/db.config');
const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');

class WebhookModel {
  /**
   * Check if a webhook event has already been successfully processed (Idempotency)
   */
  static async isEventProcessed(eventId) {
    if (!eventId) return false;
    const [rows] = await pool.query(
      "SELECT id FROM payment_webhook_logs WHERE event_id = ? AND status = 'processed' LIMIT 1",
      [eventId]
    );
    return rows.length > 0;
  }

  /**
   * Log an incoming webhook event to payment_webhook_logs
   */
  static async logWebhookEvent({
    eventId,
    eventName,
    orderId = null,
    paymentId = null,
    schoolId = null,
    planId = null,
    amount = null,
    currency = 'INR',
    status = 'processed',
    errorMessage = null,
    payloadJson = null,
  }) {
    try {
      const query = `
        INSERT INTO payment_webhook_logs (
          event_id, event_name, order_id, payment_id,
          school_id, plan_id, amount, currency,
          status, error_message, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          error_message = VALUES(error_message),
          payload_json = VALUES(payload_json)
      `;

      await pool.query(query, [
        eventId,
        eventName,
        orderId,
        paymentId,
        schoolId ? parseInt(schoolId, 10) : null,
        planId ? parseInt(planId, 10) : null,
        amount !== null ? parseFloat(amount) : null,
        currency || 'INR',
        status,
        errorMessage,
        typeof payloadJson === 'object' ? JSON.stringify(payloadJson) : payloadJson,
      ]);
    } catch (err) {
      console.error('[WebhookModel.logWebhookEvent Error]:', err.message);
    }
  }

  /**
   * Process an order.paid or payment.captured event atomically & idempotently via SubscriptionFulfillmentService.
   * Enforces strict amount & currency verification, and automatically provisions pre-registration onboarding orders
   * if the user's browser disconnected after Razorpay captured payment.
   */
  static async processPaymentSuccess({ order, payment, notes, eventId }) {
    const razorpayOrderId = order?.id || payment?.order_id || notes?.razorpay_order_id || null;
    const orderNo = notes?.order_no || null;
    const paymentId = payment?.id || null;

    if (!razorpayOrderId && !orderNo) {
      return { status: 'skipped', reason: 'Missing razorpay_order_id and order_no in webhook payload.' };
    }

    try {
      const [orderRows] = await pool.query(
        `SELECT * FROM subscription_payment_orders
         WHERE (? IS NOT NULL AND razorpay_order_id = ?)
            OR (? IS NOT NULL AND order_no = ?)
         LIMIT 1`,
        [razorpayOrderId, razorpayOrderId, orderNo, orderNo]
      );

      if (orderRows.length === 0) {
        return { status: 'skipped', reason: 'Checkout order record not found (non-SaaS payment).' };
      }

      const persistedOrder = orderRows[0];

      // 1. Strict Amount & Currency Verification
      const expectedPaise = Math.round((parseFloat(persistedOrder.grand_total) || 0) * 100);
      const webhookAmountPaise = Number(payment?.amount ?? order?.amount ?? 0);
      const webhookCurrency = String(payment?.currency || order?.currency || 'INR').toUpperCase();
      const expectedCurrency = String(persistedOrder.currency || 'INR').toUpperCase();

      if (
        expectedPaise > 0 &&
        webhookAmountPaise > 0 &&
        (webhookAmountPaise !== expectedPaise || webhookCurrency !== expectedCurrency)
      ) {
        const err = new Error(
          `Webhook amount/currency mismatch: received ${webhookCurrency} ${(webhookAmountPaise / 100).toFixed(2)}, expected ${expectedCurrency} ${(expectedPaise / 100).toFixed(2)}.`
        );
        err.code = 'AMOUNT_MISMATCH';
        err.statusCode = 400;
        throw err;
      }

      // 2. Auto-provision pre-registration onboarding school if browser disconnected before /register-school completed
      if (!persistedOrder.school_id) {
        let parsedSnap = {};
        try {
          parsedSnap = persistedOrder.payload_snapshot_json
            ? JSON.parse(persistedOrder.payload_snapshot_json)
            : {};
        } catch (_) {}

        const regSnap = parsedSnap?.extra?.onboarding_registration;
        if (
          regSnap &&
          regSnap.school?.school_name &&
          regSnap.admin?.email &&
          regSnap.admin?.password_hash
        ) {
          const SaasModel = require('./saas.model');
          const provisioned = await SaasModel.registerSchoolWithPlan({
            planId: persistedOrder.plan_id,
            paymentOrderId: persistedOrder.id,
            razorpayOrderId: persistedOrder.razorpay_order_id || razorpayOrderId,
            razorpayPaymentId: paymentId,
            schoolData: regSnap.school,
            academicYearData: regSnap.academic_year || {},
            adminData: regSnap.admin,
            isTrial: Boolean(regSnap.is_trial || persistedOrder.action_type === 'trial'),
          });

          return {
            status: provisioned.alreadyRegistered ? 'already_active' : 'fulfilled',
            result: provisioned,
          };
        }
      }

      const result = await SubscriptionFulfillmentService.fulfillPaidOrder({
        orderId: persistedOrder.id,
        orderNo,
        razorpayOrderId,
        razorpayPaymentId: paymentId,
        actorType: 'webhook',
        verificationNotes: `Auto-activated via Razorpay webhook (${eventId})`,
      });

      return {
        status: result.alreadyFulfilled ? 'already_active' : 'fulfilled',
        result,
      };
    } catch (err) {
      if (err.code === 'ORDER_NOT_FOUND' || err.code === 'MISSING_SCHOOL_ID') {
        return { status: 'skipped', reason: err.message };
      }
      throw err;
    }
  }

  /**
   * Process payment.failed event without overwriting any already-paid order
   */
  static async processPaymentFailure({ order, payment, notes, eventId }) {
    const razorpayOrderId = order?.id || payment?.order_id || null;
    const orderNo = notes?.order_no || null;
    const paymentId = payment?.id || null;
    const errorCode = payment?.error_code || 'PAYMENT_FAILED';
    const errorDescription = payment?.error_description || 'Payment failed at gateway.';

    if (razorpayOrderId || orderNo) {
      await SubscriptionFulfillmentService.recordPaymentFailure({
        orderNo,
        razorpayOrderId,
        razorpayPaymentId: paymentId,
        failureCode: errorCode,
        failureReason: errorDescription,
      });
    }

    return {
      status: 'failed_recorded',
      razorpay_order_id: razorpayOrderId,
      payment_id: paymentId,
      error_code: errorCode,
      error_description: errorDescription,
    };
  }
}

module.exports = WebhookModel;
