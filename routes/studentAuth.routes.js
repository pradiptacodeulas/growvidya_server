const express = require('express');
const router = express.Router();
const StudentAuthController = require('../controllers/studentAuth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/login', StudentAuthController.login);
router.post('/studentlogin', StudentAuthController.login);
router.post('/request-passcode', StudentAuthController.requestPasscode);
router.post('/verify-passcode', StudentAuthController.verifyPasscode);
router.post('/logout', StudentAuthController.logout);

router.get('/me', authMiddleware, StudentAuthController.getMe);
router.post('/change-password', authMiddleware, StudentAuthController.changePassword);

module.exports = router;
