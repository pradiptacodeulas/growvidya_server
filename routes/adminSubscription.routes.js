const express = require('express');
const router = express.Router();
const AdminSubscriptionController = require('../controllers/adminSubscription.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// Protect all subscription management routes with admin auth
router.use(authMiddleware);

router.get('/status', AdminSubscriptionController.getSubscriptionStatus);
router.post('/create-order', AdminSubscriptionController.createSubscriptionOrder);
router.post('/verify-payment', AdminSubscriptionController.verifySubscriptionPayment);
router.post('/upgrade', rbacMiddleware(['Super Admin']), AdminSubscriptionController.upgradeSubscription);

module.exports = router;

