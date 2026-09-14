const { pool } = require('../config/db.config');
const SubscriptionModel = require('./subscription.model');

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
   * Process an order.paid or payment.captured event
   */
  static async processPaymentSuccess({ order, payment, notes, eventId }) {
    const schoolId = notes?.school_id || order?.notes?.school_id || payment?.notes?.school_id;
    const planId = notes?.plan_id || order?.notes?.plan_id || payment?.notes?.plan_id;
    const paymentId = payment?.id || null;
    const amount = (payment?.amount || order?.amount || 0) / 100;

    if (!schoolId || !planId) {
      console.warn(
        `[Webhook Payment Success] Missing school_id (${schoolId}) or plan_id (${planId}) in notes.`
      );
      return { status: 'skipped', reason: 'Missing school_id or plan_id in notes metadata.' };
    }

    // Check if subscription with this payment_transaction_id has already been activated
    if (paymentId) {
      const [existing] = await pool.query(
        "SELECT id FROM school_subscriptions WHERE payment_transaction_id = ? AND status = 'active' LIMIT 1",
        [paymentId]
      );
      if (existing.length > 0) {
        return { status: 'already_active', subscription_id: existing[0].id };
      }
    }

    // Activate the school subscription using SubscriptionModel
    const result = await SubscriptionModel.upgradeSubscription({
      schoolId: parseInt(schoolId, 10),
      planId: parseInt(planId, 10),
      amountPaid: amount,
      paymentGateway: 'razorpay',
      paymentTransactionId: paymentId,
    });

    console.log(
      `[Webhook Payment Success] School #${schoolId} successfully upgraded to Plan #${planId} via Razorpay event ${eventId}.`
    );

    return { status: 'upgraded', result };
  }

  /**
   * Process payment.failed event
   */
  static async processPaymentFailure({ payment, notes, eventId }) {
    const schoolId = notes?.school_id || payment?.notes?.school_id;
    const paymentId = payment?.id || null;
    const errorCode = payment?.error_code || 'PAYMENT_FAILED';
    const errorDescription = payment?.error_description || 'Payment failed at gateway.';

    console.warn(
      `[Webhook Payment Failed] Event ${eventId} for School #${schoolId}, Payment #${paymentId}. Reason: ${errorDescription} (${errorCode})`
    );

    return {
      status: 'failed_recorded',
      school_id: schoolId,
      payment_id: paymentId,
      error_code: errorCode,
      error_description: errorDescription,
    };
  }
}

module.exports = WebhookModel;
