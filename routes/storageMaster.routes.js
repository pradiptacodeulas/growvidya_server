const express = require('express');
const router = express.Router();
const StorageMasterController = require('../controllers/storageMaster.controller');

// Public / School-readable active catalog endpoints
// All SuperAdmin CRUD operations are strictly protected under /api/v1/saas-admin/storage-plans
router.get('/active', StorageMasterController.getActive);
router.get('/units', StorageMasterController.getCapacityUnits);

module.exports = router;
