const express = require('express');
const router = express.Router();
const AdminStaffController = require('../controllers/adminStaff.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const rbacMiddleware = require('../middlewares/rbac.middleware');

// All staff management routes require active admin authentication
router.use(authMiddleware);

// Staff roles and meta options endpoints
router.get('/roles', rbacMiddleware('Super Admin', 'Admin'), AdminStaffController.getRoles);
router.get('/meta/options', rbacMiddleware('Super Admin', 'Admin'), AdminStaffController.getOptions);
router.get('/meta/states/:countryId', rbacMiddleware('Super Admin', 'Admin'), AdminStaffController.getStates);
router.get('/meta/cities/:stateId', rbacMiddleware('Super Admin', 'Admin'), AdminStaffController.getCities);
router.get('/meta/rooms/:hostelId', rbacMiddleware('Super Admin', 'Admin'), AdminStaffController.getRooms);

// Duplicate check endpoints
router.post('/check-email', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'add'), AdminStaffController.checkEmail);
router.get('/check-email', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'add'), AdminStaffController.checkEmail);
router.post('/check-phone', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'add'), AdminStaffController.checkPhone);
router.get('/check-phone', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'add'), AdminStaffController.checkPhone);
router.post('/check-duplicate', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'add'), AdminStaffController.checkDuplicate);
router.get('/check-duplicate', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'add'), AdminStaffController.checkDuplicate);

// Staff CRUD endpoints
router.get('/', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'view'), AdminStaffController.getAllStaff);
router.get('/:id', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'view'), AdminStaffController.getStaffById);
router.post('/', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'add'), AdminStaffController.createStaff);
router.put('/:id', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'edit'), AdminStaffController.updateStaff);
router.delete('/:id', rbacMiddleware(['Super Admin', 'Admin'], 'staff/users', 'delete'), AdminStaffController.deleteStaff);

module.exports = router;
