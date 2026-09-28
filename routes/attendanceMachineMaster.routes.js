const express = require('express');
const router = express.Router();
const AttendanceMachineMasterController = require('../controllers/attendanceMachineMaster.controller');
const couponAuthMiddleware = require('../middlewares/couponAuth.middleware');
const { machineImageMiddleware } = require('../middlewares/upload.middleware');

// Public/Active listing (for school portals / selectors)
router.get('/active', AttendanceMachineMasterController.getActive);

// Protected routes (Requires authentication)
router.use(couponAuthMiddleware);

// Listing & details
router.get('/', AttendanceMachineMasterController.getAll);
router.get('/:id', AttendanceMachineMasterController.getById);

// Admin / Mutation routes
router.post('/', machineImageMiddleware, AttendanceMachineMasterController.create);
router.put('/:id', machineImageMiddleware, AttendanceMachineMasterController.update);
router.post('/:id/image', machineImageMiddleware, AttendanceMachineMasterController.uploadImage);
router.delete('/:id/image', AttendanceMachineMasterController.deleteImage);
router.delete('/:id', AttendanceMachineMasterController.delete);
router.patch('/:id/status', AttendanceMachineMasterController.toggleStatus);

module.exports = router;

