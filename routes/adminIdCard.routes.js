const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');
const AdminIdCardController = require('../controllers/adminIdCard.controller');

// All ID card routes require authentication
router.use(authMiddleware);

// RBAC check for ID card module
router.use(
  rbacMiddleware(
    ['Admin', 'Super Admin'],
    ['records/idcard', 'students/idcard', 'teachers/idcard', 'staff/idcard'],
    'view'
  )
);

// ID Card PDF Endpoints
router.get('/pdf', AdminIdCardController.downloadIdCardPdf);
router.post('/pdf', AdminIdCardController.downloadIdCardPdf);
router.get('/pdf/:type/:candidateId', AdminIdCardController.downloadIdCardPdf);

module.exports = router;
