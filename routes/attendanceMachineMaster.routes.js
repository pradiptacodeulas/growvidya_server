const express = require('express');
const router = express.Router();
const AttendanceMachineMasterController = require('../controllers/attendanceMachineMaster.controller');

// Public/Active listing (for school portals / selectors)
// All SuperAdmin CRUD operations are strictly protected under /api/v1/saas-admin/attendance-machines
router.get('/active', AttendanceMachineMasterController.getActive);

module.exports = router;

