const express = require('express');
const router = express.Router();
const StorageMasterController = require('../controllers/storageMaster.controller');

// Public listing
router.get('/', StorageMasterController.getAll);
router.get('/active', StorageMasterController.getActive);
router.get('/units', StorageMasterController.getCapacityUnits);
router.get('/:id', StorageMasterController.getById);

// Admin / Mutation routes
router.post('/', StorageMasterController.create);
router.put('/:id', StorageMasterController.update);
router.delete('/:id', StorageMasterController.delete);
router.patch('/:id/status', StorageMasterController.toggleStatus);

module.exports = router;
