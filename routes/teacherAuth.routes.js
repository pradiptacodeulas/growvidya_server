const express = require('express');
const router = express.Router();
const TeacherAuthController = require('../controllers/teacherAuth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/login', TeacherAuthController.login);
router.post('/request-passcode', TeacherAuthController.requestPasscode);
router.post('/verify-passcode', TeacherAuthController.verifyPasscode);
router.post('/request-otp', TeacherAuthController.requestPasscode);
router.post('/verify-otp', TeacherAuthController.verifyPasscode);
router.post('/forgot-password/request-otp', TeacherAuthController.requestForgotPasswordOtp);
router.post('/forgot-password/verify-otp', TeacherAuthController.verifyForgotPasswordOtp);
router.post('/forgot-password/reset', TeacherAuthController.resetPassword);
router.get('/profile', authMiddleware, TeacherAuthController.getProfile);
router.post('/profile/request-otp', authMiddleware, TeacherAuthController.requestProfileOtp);
router.put('/profile', authMiddleware, TeacherAuthController.updateProfile);
router.patch('/profile', authMiddleware, TeacherAuthController.updateProfile);
router.post('/logout', TeacherAuthController.logout);

module.exports = router;
