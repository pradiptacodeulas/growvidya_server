const crypto = require('crypto');
const WebhookModel = require('../models/webhook.model');
const { getRazorpayConfig } = require('../config/razorpay.config');
const ApiResponse = require('../utils/api.response');

class WebhookController {
  /**
   * Handle Razorpay Webhook Events
   * Dynamically resolves encrypted `webhookSecret` from DB (or env fallback),
   * verifies HMAC-SHA256 signature on rawBody, enforces idempotency,
   * and atomically activates or marks failed orders via SubscriptionFulfillmentService.
   */
  static async handleRazorpayWebhook(req, res) {
    try {
      const signature = req.headers['x-razorpay-signature'];

      if (!signature) {
        console.warn('[Webhook Warning] Missing x-razorpay-signature header in request.');
        return ApiResponse.error(res, 'Missing webhook signature header.', null, 400);
      }

      const { webhookSecret } = await getRazorpayConfig();
      if (!webhookSecret) {
        console.warn('[Webhook Warning] Razorpay webhook_secret is not configured in Payment Gateway Settings.');
        return ApiResponse.error(res, 'Webhook secret is not configured on server.', null, 503);
      }

      // 1. Verify HMAC SHA256 Signature using rawBody buffer
      const rawPayload = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
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
      const eventId = event?.id || req.headers['x-razorpay-event-id'];
      const eventName = event?.event;
      const payload = event?.payload || {};

      if (!eventId || !eventName) {
        return ApiResponse.error(res, 'Invalid webhook payload structure.', null, 400);
      }

      // 2. Idempotency Check (Prevent duplicate handling of retried events)
      const alreadyProcessed = await WebhookModel.isEventProcessed(eventId);
      if (alreadyProcessed) {
        return res.status(200).json({ status: 'ok', message: 'Event already processed' });
      }

      const orderEntity = payload.order?.entity || null;
      const paymentEntity = payload.payment?.entity || null;
      const notes =
        orderEntity?.notes ||
        paymentEntity?.notes ||
        {};

      const schoolId = notes.school_id || null;
      const planId = notes.plan_id || null;
      const orderId = orderEntity?.id || paymentEntity?.order_id || null;
      const paymentId = paymentEntity?.id || null;
      const amount = (paymentEntity?.amount || orderEntity?.amount || 0) / 100;
      const currency = paymentEntity?.currency || orderEntity?.currency || 'INR';
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
            order: orderEntity,
            payment: paymentEntity,
            notes,
            eventId,
          });
          status = 'processed';
          errorMessage = paymentEntity?.error_description || 'Payment failed';
          break;
        }

        default: {
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

      return res.status(200).json({
        status: 'ok',
        event_id: eventId,
        event_name: eventName,
        processed: status === 'processed',
      });
    } catch (error) {
      console.error('[Webhook Controller Fatal Error]:', error.message);
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
