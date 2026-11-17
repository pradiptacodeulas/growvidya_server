const express = require('express');
const router = express.Router();
const CouponController = require('../controllers/coupon.controller');

// Validation routes (Public / Accessible during checkout & onboarding)
// All SuperAdmin CRUD operations are strictly protected under /api/v1/saas-admin/coupons
router.post('/validate', CouponController.validateCoupon);
router.post('/remove', CouponController.removeCoupon);

module.exports = router;
