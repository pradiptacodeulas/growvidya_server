const express = require('express');
const router = express.Router();
const RfidCardMasterController = require('../controllers/rfidCardMaster.controller');
const couponAuthMiddleware = require('../middlewares/couponAuth.middleware');
const { rfidImageMiddleware } = require('../middlewares/upload.middleware');

// Public/Active listing (for school portals / selection)
router.get('/active', RfidCardMasterController.getActive);

// Protected routes (Requires authentication)
router.use(couponAuthMiddleware);

// Listing & details
router.get('/', RfidCardMasterController.getAll);
router.get('/:id', RfidCardMasterController.getById);

// Admin / Mutation routes
router.post('/', rfidImageMiddleware, RfidCardMasterController.create);
router.put('/:id', rfidImageMiddleware, RfidCardMasterController.update);
router.put('/', rfidImageMiddleware, RfidCardMasterController.update);
router.post('/:id/image', rfidImageMiddleware, RfidCardMasterController.uploadImage);
router.post('/image', rfidImageMiddleware, RfidCardMasterController.uploadImage);
router.delete('/:id/image', RfidCardMasterController.deleteImage);
router.delete('/image', RfidCardMasterController.deleteImage);
router.delete('/:id', RfidCardMasterController.delete);
router.delete('/', RfidCardMasterController.delete);
router.patch('/:id/status', RfidCardMasterController.toggleStatus);
router.patch('/status', RfidCardMasterController.toggleStatus);

module.exports = router;
