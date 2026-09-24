const express = require('express');
const router = express.Router();
const CouponController = require('../controllers/coupon.controller');
const couponAuthMiddleware = require('../middlewares/couponAuth.middleware');

// Validation route (Public / Accessible during checkout & onboarding)
router.post('/validate', CouponController.validateCoupon);

// Protected routes (Requires authentication)
router.use(couponAuthMiddleware);

// CRUD routes
router.get('/', CouponController.getCoupons);
router.get('/:id', CouponController.getCouponById);
router.post('/', CouponController.createCoupon);
router.put('/:id', CouponController.updateCoupon);
router.delete('/:id', CouponController.deleteCoupon);
router.patch('/:id/status', CouponController.toggleStatus);

module.exports = router;
