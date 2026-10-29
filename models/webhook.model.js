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
   * Process an order.paid or payment.captured event atomically & idempotently via SubscriptionFulfillmentService
   */
  static async processPaymentSuccess({ order, payment, notes, eventId }) {
    const razorpayOrderId = order?.id || payment?.order_id || notes?.razorpay_order_id || null;
    const orderNo = notes?.order_no || null;
    const paymentId = payment?.id || null;

    if (!razorpayOrderId && !orderNo) {
      return { status: 'skipped', reason: 'Missing razorpay_order_id and order_no in webhook payload.' };
    }

    try {
      const result = await SubscriptionFulfillmentService.fulfillPaidOrder({
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
      // Pre-registration onboarding orders don't have school_id until /saas/register-with-plan completes;
      // acknowledge cleanly so client registration finishes fulfillment, or if order is non-SaaS (e.g. student fee), ignore safely.
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
