const express = require('express');
const router = express.Router();
const RfidCardMasterController = require('../controllers/rfidCardMaster.controller');
const couponAuthMiddleware = require('../middlewares/couponAuth.middleware');

// Public/Active listing (for school portals / selection)
router.get('/active', RfidCardMasterController.getActive);

// Protected routes (Requires authentication)
router.use(couponAuthMiddleware);

// Listing & details
router.get('/', RfidCardMasterController.getAll);
router.get('/:id', RfidCardMasterController.getById);

// Admin / Mutation routes
router.post('/', RfidCardMasterController.create);
router.put('/:id', RfidCardMasterController.update);
router.delete('/:id', RfidCardMasterController.delete);
router.patch('/:id/status', RfidCardMasterController.toggleStatus);

module.exports = router;
