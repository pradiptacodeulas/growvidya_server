const express = require('express');
const router = express.Router();
const AdminPermissionController = require('../controllers/adminPermission.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// Protect all permission routes with authentication
router.use(authMiddleware);

// Current user permissions lookup (any authenticated admin/staff can fetch their own permissions)
router.get('/my-permissions', AdminPermissionController.getMyPermissions);

// Roles & Permissions management (Super Admin or permissions/permission module)
router.get('/roles', rbacMiddleware('permissions/permission', 'view'), AdminPermissionController.getAllRoles);
router.get('/roles/:roleId', rbacMiddleware('permissions/permission', 'view'), AdminPermissionController.getRolePermissions);
router.get('/modules', rbacMiddleware('permissions/permission', 'view'), AdminPermissionController.getAllModules);
router.post('/save', rbacMiddleware('permissions/permission', 'edit'), AdminPermissionController.saveRoleAndPermissions);
router.delete('/roles/:roleId', rbacMiddleware('permissions/permission', 'delete'), AdminPermissionController.deleteRole);

module.exports = router;
