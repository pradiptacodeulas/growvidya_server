const express = require('express');
const path = require('path');
const router = express.Router();
const SaasAdminController = require('../controllers/saasAdmin.controller');
const StorageMasterController = require('../controllers/storageMaster.controller');
const RfidCardMasterController = require('../controllers/rfidCardMaster.controller');
const AttendanceMachineMasterController = require('../controllers/attendanceMachineMaster.controller');
const BankAccountMasterController = require('../controllers/bankAccountMaster.controller');
const saasAdminAuthMiddleware = require('../middlewares/saasAdminAuth.middleware');
const { checkPermission } = require('../middlewares/saasPermission.middleware');
const { upload, machineImageMiddleware } = require('../middlewares/upload.middleware');

// ==========================================
// 1. PUBLIC SAAS ADMIN ROUTES
// ==========================================
router.post('/login', SaasAdminController.login);
router.post('/validate-coupon', SaasAdminController.validateCoupon);
router.get('/genders', SaasAdminController.getGenders);
router.use('/upload', express.static(path.join(__dirname, '../public/upload')));

// ==========================================
// 2. PROTECTED SAAS ADMIN ROUTES
// ==========================================
router.use(saasAdminAuthMiddleware);

// Profile & Session (Any authenticated admin can access their own profile)
router.get('/profile', SaasAdminController.getProfile);
router.put('/profile', upload.single('profile_image'), SaasAdminController.updateProfile);
router.post('/logout', SaasAdminController.logout);

// Modules Lookup
router.get('/modules', SaasAdminController.getModules);

// Dashboard
router.get('/dashboard/stats', checkPermission('dashboard', 'can_view'), SaasAdminController.getDashboardStats);

// School Management
router.get('/schools', checkPermission('schools', 'can_view'), SaasAdminController.getSchools);
router.get('/schools/:id', checkPermission('schools', 'can_view'), SaasAdminController.getSchoolById);
router.patch('/schools/:id/status', checkPermission('schools', 'can_manage'), SaasAdminController.updateSchoolStatus);
router.put('/schools/:id', checkPermission('schools', 'can_edit'), SaasAdminController.updateSchool);

// Subscription & Payment Verification
router.get('/subscriptions', checkPermission('subscriptions', 'can_view'), SaasAdminController.getSubscriptions);
router.get('/subscriptions/:id', checkPermission('subscriptions', 'can_view'), SaasAdminController.getSubscriptionById);
router.post('/subscriptions/:id/verify', checkPermission('subscriptions', 'can_manage'), SaasAdminController.verifySubscriptionPayment);
router.patch('/subscriptions/:id/status', checkPermission('subscriptions', 'can_manage'), SaasAdminController.updateSubscriptionStatus);
router.post('/subscriptions/:id/extend', checkPermission('subscriptions', 'can_manage'), SaasAdminController.extendSubscription);

// Package / Subscription Plan Management
router.get('/packages', checkPermission('packages', 'can_view'), SaasAdminController.getPackages);
router.get('/packages/:id', checkPermission('packages', 'can_view'), SaasAdminController.getPackageById);
router.post('/packages', checkPermission('packages', 'can_add'), SaasAdminController.createPackage);
router.put('/packages/:id', checkPermission('packages', 'can_edit'), SaasAdminController.updatePackage);
router.delete('/packages/:id', checkPermission('packages', 'can_delete'), SaasAdminController.deletePackage);
router.patch('/packages/:id/status', checkPermission('packages', 'can_manage'), SaasAdminController.togglePackageStatus);

// Package Items & Add-ons
router.get('/packages/:id/items', checkPermission('packages', 'can_view'), SaasAdminController.getPackageItems);
router.post('/packages/:id/items', checkPermission('packages', 'can_edit'), SaasAdminController.addPackageItem);
router.put('/packages/items/:itemId', checkPermission('packages', 'can_edit'), SaasAdminController.updatePackageItem);
router.delete('/packages/items/:itemId', checkPermission('packages', 'can_delete'), SaasAdminController.deletePackageItem);
router.patch('/packages/items/:itemId/status', checkPermission('packages', 'can_manage'), SaasAdminController.togglePackageItemStatus);

// Coupon Management
router.get('/coupons', checkPermission('coupons', 'can_view'), SaasAdminController.getCoupons);
router.get('/coupons/:id', checkPermission('coupons', 'can_view'), SaasAdminController.getCouponById);
router.post('/coupons', checkPermission('coupons', 'can_add'), SaasAdminController.createCoupon);
router.put('/coupons/:id', checkPermission('coupons', 'can_edit'), SaasAdminController.updateCoupon);
router.delete('/coupons/:id', checkPermission('coupons', 'can_delete'), SaasAdminController.deleteCoupon);
router.patch('/coupons/:id/status', checkPermission('coupons', 'can_manage'), SaasAdminController.toggleCouponStatus);
router.post('/coupons/validate', checkPermission('coupons', 'can_view'), SaasAdminController.validateCoupon);

// Storage Master Plan Management
router.get('/storage-plans', checkPermission('storage_plans', 'can_view'), StorageMasterController.getAll);
router.get('/storage-plans/units', checkPermission('storage_plans', 'can_view'), StorageMasterController.getCapacityUnits);
router.get('/capacity-units', checkPermission('storage_plans', 'can_view'), StorageMasterController.getCapacityUnits);
router.get('/storage-plans/:id', checkPermission('storage_plans', 'can_view'), StorageMasterController.getById);
router.post('/storage-plans', checkPermission('storage_plans', 'can_add'), StorageMasterController.create);
router.put('/storage-plans/:id', checkPermission('storage_plans', 'can_edit'), StorageMasterController.update);
router.put('/storage-plans', checkPermission('storage_plans', 'can_edit'), StorageMasterController.update);
router.delete('/storage-plans/:id', checkPermission('storage_plans', 'can_delete'), StorageMasterController.delete);
router.delete('/storage-plans', checkPermission('storage_plans', 'can_delete'), StorageMasterController.delete);
router.patch('/storage-plans/:id/status', checkPermission('storage_plans', 'can_manage'), StorageMasterController.toggleStatus);
router.patch('/storage-plans/status', checkPermission('storage_plans', 'can_manage'), StorageMasterController.toggleStatus);

// RFID Card Master Management
router.get('/rfid-cards', checkPermission('rfid_cards', 'can_view'), RfidCardMasterController.getAll);
router.get('/rfid-cards/active', checkPermission('rfid_cards', 'can_view'), RfidCardMasterController.getActive);
router.get('/rfid-cards/:id', checkPermission('rfid_cards', 'can_view'), RfidCardMasterController.getById);
router.post('/rfid-cards', checkPermission('rfid_cards', 'can_add'), RfidCardMasterController.create);
router.put('/rfid-cards/:id', checkPermission('rfid_cards', 'can_edit'), RfidCardMasterController.update);
router.put('/rfid-cards', checkPermission('rfid_cards', 'can_edit'), RfidCardMasterController.update);
router.delete('/rfid-cards/:id', checkPermission('rfid_cards', 'can_delete'), RfidCardMasterController.delete);
router.delete('/rfid-cards', checkPermission('rfid_cards', 'can_delete'), RfidCardMasterController.delete);
router.patch('/rfid-cards/:id/status', checkPermission('rfid_cards', 'can_manage'), RfidCardMasterController.toggleStatus);
router.patch('/rfid-cards/status', checkPermission('rfid_cards', 'can_manage'), RfidCardMasterController.toggleStatus);

// Attendance Machine Master Management
router.get('/attendance-machines', checkPermission('attendance_machines', 'can_view'), AttendanceMachineMasterController.getAll);
router.get('/attendance-machines/active', checkPermission('attendance_machines', 'can_view'), AttendanceMachineMasterController.getActive);
router.get('/attendance-machines/:id', checkPermission('attendance_machines', 'can_view'), AttendanceMachineMasterController.getById);
router.post('/attendance-machines', checkPermission('attendance_machines', 'can_add'), machineImageMiddleware, AttendanceMachineMasterController.create);
router.put('/attendance-machines/:id', checkPermission('attendance_machines', 'can_edit'), machineImageMiddleware, AttendanceMachineMasterController.update);
router.put('/attendance-machines', checkPermission('attendance_machines', 'can_edit'), machineImageMiddleware, AttendanceMachineMasterController.update);
router.post('/attendance-machines/:id/image', checkPermission('attendance_machines', 'can_edit'), machineImageMiddleware, AttendanceMachineMasterController.uploadImage);
router.post('/attendance-machines/image', checkPermission('attendance_machines', 'can_edit'), machineImageMiddleware, AttendanceMachineMasterController.uploadImage);
router.delete('/attendance-machines/:id/image', checkPermission('attendance_machines', 'can_edit'), AttendanceMachineMasterController.deleteImage);
router.delete('/attendance-machines/image', checkPermission('attendance_machines', 'can_edit'), AttendanceMachineMasterController.deleteImage);
router.delete('/attendance-machines/:id', checkPermission('attendance_machines', 'can_delete'), AttendanceMachineMasterController.delete);
router.delete('/attendance-machines', checkPermission('attendance_machines', 'can_delete'), AttendanceMachineMasterController.delete);
router.patch('/attendance-machines/:id/status', checkPermission('attendance_machines', 'can_manage'), AttendanceMachineMasterController.toggleStatus);
router.patch('/attendance-machines/status', checkPermission('attendance_machines', 'can_manage'), AttendanceMachineMasterController.toggleStatus);

// Bank Account Master Management (Super Admin)
router.get('/bank-accounts', checkPermission('bank_accounts', 'can_view'), BankAccountMasterController.getAll);
router.get('/bank-accounts/active', checkPermission('bank_accounts', 'can_view'), BankAccountMasterController.getActive);
router.get('/bank-accounts/:id', checkPermission('bank_accounts', 'can_view'), BankAccountMasterController.getById);
router.post('/bank-accounts', checkPermission('bank_accounts', 'can_add'), BankAccountMasterController.create);
router.put('/bank-accounts/:id', checkPermission('bank_accounts', 'can_edit'), BankAccountMasterController.update);
router.put('/bank-accounts', checkPermission('bank_accounts', 'can_edit'), BankAccountMasterController.update);
router.delete('/bank-accounts/:id', checkPermission('bank_accounts', 'can_delete'), BankAccountMasterController.delete);
router.delete('/bank-accounts', checkPermission('bank_accounts', 'can_delete'), BankAccountMasterController.delete);
router.patch('/bank-accounts/:id/status', checkPermission('bank_accounts', 'can_manage'), BankAccountMasterController.toggleStatus);
router.patch('/bank-accounts/status', checkPermission('bank_accounts', 'can_manage'), BankAccountMasterController.toggleStatus);
router.patch('/bank-accounts/:id/default', checkPermission('bank_accounts', 'can_manage'), BankAccountMasterController.setDefault);
router.patch('/bank-accounts/default', checkPermission('bank_accounts', 'can_manage'), BankAccountMasterController.setDefault);

// Roles & Permissions Management
router.get('/roles', checkPermission('roles', 'can_view'), SaasAdminController.getRoles);
router.get('/roles/:id', checkPermission('roles', 'can_view'), SaasAdminController.getRoleById);
router.post('/roles', checkPermission('roles', 'can_add'), SaasAdminController.createRole);
router.put('/roles/:id', checkPermission('roles', 'can_edit'), SaasAdminController.updateRole);
router.delete('/roles/:id', checkPermission('roles', 'can_delete'), SaasAdminController.deleteRole);

// Sub Admin Users Management
router.get('/sub-admins', checkPermission('sub_admins', 'can_view'), SaasAdminController.getSubAdmins);
router.get('/sub-admins/:id', checkPermission('sub_admins', 'can_view'), SaasAdminController.getSubAdminById);
router.post('/sub-admins', checkPermission('sub_admins', 'can_add'), upload.single('profile_image'), SaasAdminController.createSubAdmin);
router.put('/sub-admins/:id', checkPermission('sub_admins', 'can_edit'), upload.single('profile_image'), SaasAdminController.updateSubAdmin);
router.delete('/sub-admins/:id', checkPermission('sub_admins', 'can_delete'), SaasAdminController.deleteSubAdmin);
router.patch('/sub-admins/:id/status', checkPermission('sub_admins', 'can_manage'), SaasAdminController.toggleSubAdminStatus);

module.exports = router;
