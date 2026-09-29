const express = require('express');
const router = express.Router();
const BankAccountMasterController = require('../controllers/bankAccountMaster.controller');
const couponAuthMiddleware = require('../middlewares/couponAuth.middleware');
const { bankImageMiddleware } = require('../middlewares/upload.middleware');

// Public active endpoint (for schools during subscription configuration)
router.get('/active', BankAccountMasterController.getActive);

// Protected routes (Requires authentication)
router.use(couponAuthMiddleware);

// Listing & details
router.get('/', BankAccountMasterController.getAll);
router.get('/:id', BankAccountMasterController.getById);

// Admin / Mutation routes
router.post('/', bankImageMiddleware, BankAccountMasterController.create);
router.put('/:id', bankImageMiddleware, BankAccountMasterController.update);
router.put('/', bankImageMiddleware, BankAccountMasterController.update);
router.delete('/:id', BankAccountMasterController.delete);
router.delete('/', BankAccountMasterController.delete);
router.patch('/:id/status', BankAccountMasterController.toggleStatus);
router.patch('/status', BankAccountMasterController.toggleStatus);
router.patch('/:id/default', BankAccountMasterController.setDefault);
router.patch('/default', BankAccountMasterController.setDefault);

module.exports = router;
