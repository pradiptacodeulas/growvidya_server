const express = require('express');
const router = express.Router();
const WebhookController = require('../controllers/webhook.controller');
const saasAdminAuthMiddleware = require('../middlewares/saasAdminAuth.middleware');
const { checkPermission } = require('../middlewares/saasPermission.middleware');

/**
 * Public Webhook Receiver Endpoint (Invoked directly by Razorpay Gateway servers)
 * Verified using cryptographic HMAC-SHA256 signature in X-Razorpay-Signature
 */
router.post('/razorpay', WebhookController.handleRazorpayWebhook);

/**
 * Company SuperAdmin Webhook Audit Logs Endpoint
 */
router.get('/logs', saasAdminAuthMiddleware, checkPermission('subscriptions', 'can_view'), WebhookController.getWebhookLogs);

module.exports = router;
