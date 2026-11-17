const express = require('express');
const router = express.Router();
const ParentAuthController = require('../controllers/parentAuth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/login', ParentAuthController.login);
router.post('/request-passcode', ParentAuthController.requestPasscode);
router.post('/verify-passcode', ParentAuthController.verifyPasscode);
router.post('/request-otp', ParentAuthController.requestPasscode);
router.post('/verify-otp', ParentAuthController.verifyPasscode);
router.post('/forgot-password/request-otp', ParentAuthController.requestForgotPasswordOtp);
router.post('/forgot-password/verify-otp', ParentAuthController.verifyForgotPasswordOtp);
router.post('/forgot-password/reset', ParentAuthController.resetPassword);
router.post('/logout', ParentAuthController.logout);

// Protected routes
router.use(authMiddleware);
router.get('/profile', ParentAuthController.getProfile);
router.post('/profile/request-otp', ParentAuthController.requestProfileOtp);
router.put('/profile', ParentAuthController.updateProfile);
router.patch('/profile', ParentAuthController.updateProfile);
router.post('/switch-student', ParentAuthController.switchStudent);

module.exports = router;
