const express = require('express');
const router = express.Router();
const SaasAdminController = require('../controllers/saasAdmin.controller');
const StorageMasterController = require('../controllers/storageMaster.controller');
const saasAdminAuthMiddleware = require('../middlewares/saasAdminAuth.middleware');

// ==========================================
// 1. PUBLIC SAAS ADMIN ROUTES
// ==========================================
router.post('/login', SaasAdminController.login);
router.post('/validate-coupon', SaasAdminController.validateCoupon);

// ==========================================
// 2. PROTECTED SAAS ADMIN ROUTES
// ==========================================
router.use(saasAdminAuthMiddleware);

// Profile & Session
router.get('/profile', SaasAdminController.getProfile);
router.put('/profile', SaasAdminController.updateProfile);
router.post('/logout', SaasAdminController.logout);

// Dashboard
router.get('/dashboard/stats', SaasAdminController.getDashboardStats);

// School Management
router.get('/schools', SaasAdminController.getSchools);
router.get('/schools/:id', SaasAdminController.getSchoolById);
router.patch('/schools/:id/status', SaasAdminController.updateSchoolStatus);
router.put('/schools/:id', SaasAdminController.updateSchool);

// Subscription & Payment Verification
router.get('/subscriptions', SaasAdminController.getSubscriptions);
router.get('/subscriptions/:id', SaasAdminController.getSubscriptionById);
router.post('/subscriptions/:id/verify', SaasAdminController.verifySubscriptionPayment);
router.patch('/subscriptions/:id/status', SaasAdminController.updateSubscriptionStatus);
router.post('/subscriptions/:id/extend', SaasAdminController.extendSubscription);

// Package / Subscription Plan Management
router.get('/packages', SaasAdminController.getPackages);
router.get('/packages/:id', SaasAdminController.getPackageById);
router.post('/packages', SaasAdminController.createPackage);
router.put('/packages/:id', SaasAdminController.updatePackage);
router.delete('/packages/:id', SaasAdminController.deletePackage);
router.patch('/packages/:id/status', SaasAdminController.togglePackageStatus);

// Coupon Management
router.get('/coupons', SaasAdminController.getCoupons);
router.get('/coupons/:id', SaasAdminController.getCouponById);
router.post('/coupons', SaasAdminController.createCoupon);
router.put('/coupons/:id', SaasAdminController.updateCoupon);
router.delete('/coupons/:id', SaasAdminController.deleteCoupon);
router.patch('/coupons/:id/status', SaasAdminController.toggleCouponStatus);
router.post('/coupons/validate', SaasAdminController.validateCoupon);

// Storage Master Plan Management
router.get('/storage-plans', StorageMasterController.getAll);
router.get('/storage-plans/units', StorageMasterController.getCapacityUnits);
router.get('/capacity-units', StorageMasterController.getCapacityUnits);
router.get('/storage-plans/:id', StorageMasterController.getById);
router.post('/storage-plans', StorageMasterController.create);
router.put('/storage-plans/:id', StorageMasterController.update);
router.delete('/storage-plans/:id', StorageMasterController.delete);
router.patch('/storage-plans/:id/status', StorageMasterController.toggleStatus);

module.exports = router;
