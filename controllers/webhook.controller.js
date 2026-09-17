const crypto = require('crypto');
const WebhookModel = require('../models/webhook.model');
const { webhookSecret } = require('../config/razorpay.config');
const ApiResponse = require('../utils/api.response');

class WebhookController {
  /**
   * Handle Razorpay Webhook Events
   * Verifies HMAC-SHA256 signature, enforces idempotency, updates subscriptions, and logs transactions.
   */
  static async handleRazorpayWebhook(req, res) {
    try {
      const signature = req.headers['x-razorpay-signature'];

      if (!signature) {
        console.warn('[Webhook Warning] Missing x-razorpay-signature header in request.');
        return ApiResponse.error(res, 'Missing webhook signature header.', null, 400);
      }

      // 1. Verify HMAC SHA256 Signature using rawBody buffer
      const rawPayload = req.rawBody || JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawPayload)
        .digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const receivedBuffer = Buffer.from(String(signature), 'utf8');

      const isSignatureValid =
        expectedBuffer.length === receivedBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

      if (!isSignatureValid) {
        console.warn('[Webhook Warning] Invalid Razorpay webhook signature detected.');
        return ApiResponse.error(res, 'Invalid webhook signature.', null, 400);
      }

      const event = req.body;
      const eventId = event?.id;
      const eventName = event?.event;
      const payload = event?.payload || {};

      if (!eventId || !eventName) {
        return ApiResponse.error(res, 'Invalid webhook payload structure.', null, 400);
      }

      console.log(`[Webhook Received] Event: ${eventName} | ID: ${eventId}`);

      // 2. Idempotency Check (Prevent duplicate handling of retried events)
      const alreadyProcessed = await WebhookModel.isEventProcessed(eventId);
      if (alreadyProcessed) {
        console.log(`[Webhook Idempotent] Event ${eventId} was already processed. Returning 200 OK.`);
        return res.status(200).json({ status: 'ok', message: 'Event already processed' });
      }

      let orderEntity = payload.order?.entity || null;
      let paymentEntity = payload.payment?.entity || null;
      let notes =
        orderEntity?.notes ||
        paymentEntity?.notes ||
        payload.payment?.entity?.notes ||
        {};

      let schoolId = notes.school_id || null;
      let planId = notes.plan_id || null;
      let orderId = orderEntity?.id || paymentEntity?.order_id || null;
      let paymentId = paymentEntity?.id || null;
      let amount = (paymentEntity?.amount || orderEntity?.amount || 0) / 100;
      let currency = paymentEntity?.currency || orderEntity?.currency || 'INR';
      let status = 'processed';
      let errorMessage = null;

      // 3. Process Specific Events
      switch (eventName) {
        case 'order.paid':
        case 'payment.captured': {
          const result = await WebhookModel.processPaymentSuccess({
            order: orderEntity,
            payment: paymentEntity,
            notes,
            eventId,
          });
          if (result.status === 'skipped') {
            status = 'ignored';
            errorMessage = result.reason;
          }
          break;
        }

        case 'payment.failed': {
          await WebhookModel.processPaymentFailure({
            payment: paymentEntity,
            notes,
            eventId,
          });
          status = 'processed';
          errorMessage = paymentEntity?.error_description || 'Payment failed';
          break;
        }

        default: {
          console.log(`[Webhook Notice] Unhandled event type: ${eventName}. Acknowledged and logged.`);
          status = 'ignored';
          break;
        }
      }

      // 4. Log event for audit trail
      await WebhookModel.logWebhookEvent({
        eventId,
        eventName,
        orderId,
        paymentId,
        schoolId,
        planId,
        amount,
        currency,
        status,
        errorMessage,
        payloadJson: event,
      });

      // 5. Always acknowledge Razorpay promptly with 200 OK
      return res.status(200).json({
        status: 'ok',
        event_id: eventId,
        event_name: eventName,
        processed: status === 'processed',
      });
    } catch (error) {
      console.error('[Webhook Controller Fatal Error]:', error.message);
      // Return 500 so Razorpay can retry transient server failures
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error processing webhook event.',
      });
    }
  }

  /**
   * Get Webhook Event Logs (for SaaS / Platform SuperAdmin audit inspection)
   */
  static async getWebhookLogs(req, res, next) {
    try {
      const { pool } = require('../config/db.config');
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const offset = (page - 1) * limit;

      const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM payment_webhook_logs');
      const total = countRows[0]?.total || 0;

      const [rows] = await pool.query(
        `SELECT id, event_id, event_name, order_id, payment_id, school_id, plan_id, amount, currency, status, error_message, created_at
         FROM payment_webhook_logs
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      return ApiResponse.success(res, 'Webhook logs retrieved successfully.', {
        logs: rows,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = WebhookController;
