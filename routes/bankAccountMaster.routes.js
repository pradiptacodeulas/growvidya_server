const express = require('express');
const router = express.Router();
const BankAccountMasterController = require('../controllers/bankAccountMaster.controller');

// Public active endpoint (for schools during subscription configuration)
// All SuperAdmin CRUD operations are strictly protected under /api/v1/saas-admin/bank-accounts
router.get('/active', BankAccountMasterController.getActive);

module.exports = router;
