const express = require('express');
const router = express.Router();
const WebhookController = require('../controllers/webhook.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

/**
 * Public Webhook Receiver Endpoint (Invoked directly by Razorpay Gateway servers)
 * Verified using cryptographic HMAC-SHA256 signature in X-Razorpay-Signature
 */
router.post('/razorpay', WebhookController.handleRazorpayWebhook);

/**
 * Admin Webhook Audit Logs Endpoint (Protected for Super Admins & Admins)
 */
router.get('/logs', authMiddleware, rbacMiddleware(['Super Admin', 'Admin']), WebhookController.getWebhookLogs);

module.exports = router;
