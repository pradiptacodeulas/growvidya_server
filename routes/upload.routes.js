const express = require('express');
const router = express.Router();
const { upload } = require('../middlewares/upload.middleware');
const UploadController = require('../controllers/upload.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// Protect upload routes with JWT authentication
router.use(authMiddleware);

// Upload single file (supports image, pdf, documents)
router.post('/single', upload.single('file'), UploadController.uploadSingle);

// Upload multiple files
router.post('/multiple', upload.array('files', 10), UploadController.uploadMultiple);

// Hard delete physical file from disk (Restricted to Super Admin & Admin)
router.delete('/file', rbacMiddleware(['Super Admin', 'Admin']), UploadController.deleteFile);

module.exports = router;

