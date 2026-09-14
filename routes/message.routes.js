const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const { upload } = require('../middlewares/upload.middleware');
const MessageController = require('../controllers/message.controller');
const UploadController = require('../controllers/upload.controller');

// Require authentication for all message routes
router.use(authMiddleware);

// Get list of permitted contacts with unread badges & last message
router.get('/contacts', MessageController.getContacts);

// Get total unread count for navbar badge
router.get('/unread-count', MessageController.getUnreadCount);

// Get conversation history with a specific contact
router.get('/conversation/:contactRole/:contactId', MessageController.getConversation);
router.get('/conversation', MessageController.getConversation);

// Send message (REST fallback)
router.post('/send', MessageController.sendMessage);

// Mark messages from a contact as read
router.post('/read', MessageController.markAsRead);

// Upload chat attachment (images, pdfs, documents)
router.post(
  '/upload',
  (req, res, next) => {
    req.query.folder = 'messages';
    next();
  },
  upload.single('file'),
  UploadController.uploadSingle
);

module.exports = router;
