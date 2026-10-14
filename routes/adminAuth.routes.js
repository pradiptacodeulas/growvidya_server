const express = require('express');
const router = express.Router();
const AdminAuthController = require('../controllers/adminAuth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// Public / Session-management routes
router.post('/login', AdminAuthController.login);
router.post('/logout', AdminAuthController.logout);

// Protected routes (Super Admin & Admin)
router.get('/me', authMiddleware, rbacMiddleware(['Super Admin', 'Admin']), AdminAuthController.getProfile);
router.get('/profile', authMiddleware, rbacMiddleware(['Super Admin', 'Admin']), AdminAuthController.getFullProfile);
router.put('/profile', authMiddleware, rbacMiddleware(['Super Admin', 'Admin']), AdminAuthController.updateProfile);

module.exports = router;
