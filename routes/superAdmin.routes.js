const express = require('express');
const router = express.Router();
const SuperAdminController = require('../controllers/superAdmin.controller');
const authenticateToken = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

// All Super Admin routes require authentication and Super Admin or Admin authorization
router.use(authenticateToken);
router.use(authorizeRoles('Super Admin', 'Admin'));

// GET /v1/admin/super-admin/dashboard (supports optional ?branch_id= filter)
router.get('/dashboard', SuperAdminController.getDashboard);

// GET /v1/admin/super-admin/branches (branch performance matrix)
router.get('/branches', SuperAdminController.getBranches);

// GET /v1/admin/super-admin/branches/:id (branch drill-down details)
router.get('/branches/:id', SuperAdminController.getBranchById);

// GET /v1/admin/super-admin/storage (storage analysis)
router.get('/storage', SuperAdminController.getStorage);

// GET /v1/admin/super-admin/subscription (subscription limits & usage)
router.get('/subscription', SuperAdminController.getSubscription);

module.exports = router;
