const express = require('express');
const router = express.Router();
const ParentAuthController = require('../controllers/parentAuth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/login', ParentAuthController.login);
router.post('/request-passcode', ParentAuthController.requestPasscode);
router.post('/verify-passcode', ParentAuthController.verifyPasscode);
router.post('/logout', ParentAuthController.logout);

// Protected routes
router.use(authMiddleware);
router.get('/profile', ParentAuthController.getProfile);
router.put('/profile', ParentAuthController.updateProfile);
router.patch('/profile', ParentAuthController.updateProfile);
router.post('/switch-student', ParentAuthController.switchStudent);

module.exports = router;
