const express = require('express');
const router = express.Router();
const AdminSubscriptionController = require('../controllers/adminSubscription.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

const billingAdminGuard = rbacMiddleware(['Super Admin', 'Admin']);

// Protect all subscription management routes with admin auth
router.use(authMiddleware);

// Read endpoints (accessible to authenticated school admins)
router.get('/status', AdminSubscriptionController.getSubscriptionStatus);
router.get('/config-catalog', AdminSubscriptionController.getConfigurationCatalog);
router.get('/orders', AdminSubscriptionController.getBillingHistory);
router.get('/orders/:orderNo', AdminSubscriptionController.getOrderDetails);
router.get('/orders/:orderNo/invoice', AdminSubscriptionController.getOrderDetails);
router.get('/notification-wallet', AdminSubscriptionController.getNotificationWallet);

// Billing mutation & checkout endpoints (strictly restricted to Super Admin / Admin roles)
router.post('/create-order', billingAdminGuard, AdminSubscriptionController.createSubscriptionOrder);
router.post('/verify-payment', billingAdminGuard, AdminSubscriptionController.verifySubscriptionPayment);
router.post('/create-addon-order', billingAdminGuard, AdminSubscriptionController.createAddonOrder);
router.post('/verify-addon-payment', billingAdminGuard, AdminSubscriptionController.verifyAddonPayment);
router.post('/purchase-addons', billingAdminGuard, AdminSubscriptionController.purchaseAddons);
router.post('/record-payment-failure', billingAdminGuard, AdminSubscriptionController.recordPaymentFailure);
router.post('/validate-coupon', billingAdminGuard, AdminSubscriptionController.validateCoupon);
router.post('/remove-coupon', billingAdminGuard, AdminSubscriptionController.removeCoupon);
router.post('/select-plan', billingAdminGuard, AdminSubscriptionController.selectPlan);
router.post('/upgrade', billingAdminGuard, AdminSubscriptionController.upgradeSubscription);

module.exports = router;
