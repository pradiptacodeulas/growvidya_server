const express = require('express');
const router = express.Router();
const RfidCardMasterController = require('../controllers/rfidCardMaster.controller');

// Public/Active listing (for school portals / selection)
// All SuperAdmin CRUD operations are strictly protected under /api/v1/saas-admin/rfid-cards
router.get('/active', RfidCardMasterController.getActive);

module.exports = router;
