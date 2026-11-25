const express = require('express');
const router = express.Router();
const AdminSubscriptionController = require('../controllers/adminSubscription.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const ApiResponse = require('../utils/api.response');

/**
 * Strictly restrict subscription purchases, renewals, upgrades, and billing history
 * to the School Super Admin (admin_type = 1) only. Branch Heads (admin_type = 2) and Staff are blocked.
 */
const superAdminBillingGuard = (req, res, next) => {
  const adminType = Number(req.user?.adminType ?? req.user?.admin_type);
  const roleStr = String(req.user?.roleName || req.user?.role_name || req.user?.role || '').toLowerCase().trim();
  const isSuperAdmin =
    Boolean(req.user?.isSuperAdmin) ||
    adminType === 1 ||
    roleStr === 'super admin' ||
    roleStr === 'superadmin';

  if (!isSuperAdmin) {
    return ApiResponse.error(
      res,
      'Access denied: Only the School Super Admin can manage subscriptions, plans, and billing.',
      null,
      403
    );
  }
  return next();
};

// Protect all subscription routes with JWT authentication
router.use(authMiddleware);

// Read endpoints needed by authenticated portal sessions (lockout state & notification credit display)
router.get('/status', AdminSubscriptionController.getSubscriptionStatus);
router.get('/notification-wallet', AdminSubscriptionController.getNotificationWallet);

// Billing catalog, history, invoices, and checkout mutations (Strictly School Super Admin ONLY)
router.get('/config-catalog', superAdminBillingGuard, AdminSubscriptionController.getConfigurationCatalog);
router.get('/orders', superAdminBillingGuard, AdminSubscriptionController.getBillingHistory);
router.get('/orders/:orderNo', superAdminBillingGuard, AdminSubscriptionController.getOrderDetails);
router.get('/orders/:orderNo/invoice', superAdminBillingGuard, AdminSubscriptionController.getOrderDetails);
router.get('/orders/:orderNo/invoice-pdf', superAdminBillingGuard, AdminSubscriptionController.getOrderInvoicePdf);

router.post('/create-order', superAdminBillingGuard, AdminSubscriptionController.createSubscriptionOrder);
router.post('/verify-payment', superAdminBillingGuard, AdminSubscriptionController.verifySubscriptionPayment);
router.post('/create-addon-order', superAdminBillingGuard, AdminSubscriptionController.createAddonOrder);
router.post('/verify-addon-payment', superAdminBillingGuard, AdminSubscriptionController.verifyAddonPayment);
router.post('/purchase-addons', superAdminBillingGuard, AdminSubscriptionController.purchaseAddons);
router.post('/record-payment-failure', superAdminBillingGuard, AdminSubscriptionController.recordPaymentFailure);
router.post('/validate-coupon', superAdminBillingGuard, AdminSubscriptionController.validateCoupon);
router.post('/remove-coupon', superAdminBillingGuard, AdminSubscriptionController.removeCoupon);
router.post('/select-plan', superAdminBillingGuard, AdminSubscriptionController.selectPlan);
router.post('/upgrade', superAdminBillingGuard, AdminSubscriptionController.upgradeSubscription);

module.exports = router;
