const express = require('express');
const router = express.Router();
const StudentAuthController = require('../controllers/studentAuth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/login', StudentAuthController.login);
router.post('/studentlogin', StudentAuthController.login);
router.post('/request-passcode', StudentAuthController.requestPasscode);
router.post('/verify-passcode', StudentAuthController.verifyPasscode);
router.post('/request-otp', StudentAuthController.requestPasscode);
router.post('/verify-otp', StudentAuthController.verifyPasscode);
router.post('/forgot-password/request-otp', StudentAuthController.requestForgotPasswordOtp);
router.post('/forgot-password/verify-otp', StudentAuthController.verifyForgotPasswordOtp);
router.post('/forgot-password/reset', StudentAuthController.resetPassword);
router.post('/logout', StudentAuthController.logout);

router.get('/me', authMiddleware, StudentAuthController.getMe);
router.post('/change-password/request-otp', authMiddleware, StudentAuthController.requestChangePasswordOtp);
router.post('/change-password', authMiddleware, StudentAuthController.changePassword);

module.exports = router;
