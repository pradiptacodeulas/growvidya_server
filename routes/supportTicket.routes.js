const express = require('express');
const router = express.Router();
const SupportTicketController = require('../controllers/supportTicket.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { supportTicketAttachmentMiddleware } = require('../middlewares/upload.middleware');

// All school admin support ticket routes require school admin authentication
router.use(authMiddleware);

router.get('/', SupportTicketController.getSchoolTickets);
router.post('/', supportTicketAttachmentMiddleware, SupportTicketController.createSchoolTicket);
router.get('/:id', SupportTicketController.getSchoolTicketById);
router.post('/:id/reply', supportTicketAttachmentMiddleware, SupportTicketController.addSchoolReply);
router.patch('/:id/status', SupportTicketController.updateSchoolTicketStatus);
router.patch('/:id/close', SupportTicketController.updateSchoolTicketStatus);

module.exports = router;
