const express = require('express');
const router = express.Router();
const AdminDashboardController = require('../controllers/adminDashboard.controller');
const authenticateToken = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

router.use(authenticateToken);
router.use(authorizeRoles('Super Admin', 'Admin'));

router.get('/stats', AdminDashboardController.getStats);

module.exports = router;
