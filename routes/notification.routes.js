const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const NotificationController = require('../controllers/notification.controller');

// Public route to retrieve VAPID public key for Web PushManager subscription
router.get('/vapid-public-key', NotificationController.getVapidPublicKey);

// Authenticated routes to register and revoke push notification tokens
router.post('/device-token', authMiddleware, NotificationController.registerDeviceToken);
router.delete('/device-token', authMiddleware, NotificationController.unregisterDeviceToken);

module.exports = router;
