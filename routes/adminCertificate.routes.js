const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const adminCertificateController = require('../controllers/adminCertificate.controller');
const { upload, uploadJpgOnly } = require('../middlewares/upload.middleware');

const rbacMiddleware = require('../middlewares/rbac.middleware');

// All certificate routes require admin auth
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for certificate routes
router.use((req, res, next) => {
  let targetModule = 'certificate/category';
  const path = req.path.toLowerCase();

  if (path.startsWith('/categories')) {
    targetModule = 'certificate/category';
  } else if (path.startsWith('/templates') || path.startsWith('/borders')) {
    targetModule = 'certificate/template';
  } else if (path.startsWith('/issued') || path.startsWith('/populate-template')) {
    targetModule = 'certificate/certificatecreate';
  }

  let targetAction = 'view';
  if (path.includes('/download') || path.startsWith('/populate-template')) {
    targetAction = 'view';
  } else if (req.method === 'POST') {
    targetAction = 'add';
  } else if (req.method === 'PUT' || req.method === 'PATCH') {
    targetAction = 'edit';
  } else if (req.method === 'DELETE') {
    targetAction = 'delete';
  }

  return rbacMiddleware(targetModule, targetAction)(req, res, next);
});

// --- Categories ---
router.get('/categories', adminCertificateController.getAllCategories);
router.get('/categories/:id', adminCertificateController.getCategoryById);
router.post('/categories', adminCertificateController.createCategory);
router.put('/categories/:id', adminCertificateController.updateCategory);
router.delete('/categories/:id', adminCertificateController.deleteCategory);

// --- Templates ---
router.get('/templates', adminCertificateController.getAllTemplates);
router.get('/templates/:id', adminCertificateController.getTemplateById);
router.post('/templates', adminCertificateController.createTemplate);
router.put('/templates/:id', adminCertificateController.updateTemplate);
router.delete('/templates/:id', adminCertificateController.deleteTemplate);

// --- Borders (Strictly JPG/JPEG only) ---
router.get('/borders', adminCertificateController.getAllBorders);
router.get('/borders/:id', adminCertificateController.getBorderById);
router.post('/borders', uploadJpgOnly.single('border_image'), adminCertificateController.createBorder);
router.put('/borders/:id', uploadJpgOnly.single('border_image'), adminCertificateController.updateBorder);
router.delete('/borders/:id', adminCertificateController.deleteBorder);

// --- Issued Certificates (Certificate Create) ---
router.get('/issued', adminCertificateController.getAllIssuedCertificates);
router.get('/issued/:id', adminCertificateController.getIssuedCertificateById);
router.get('/issued/:id/download', adminCertificateController.downloadIssuedCertificate);
router.post('/issued/download-bulk', adminCertificateController.downloadBulkIssuedCertificates);
router.post('/issued', adminCertificateController.createIssuedCertificate);
router.delete('/issued/:id', adminCertificateController.deleteIssuedCertificate);
router.post('/populate-template', adminCertificateController.populateTemplate);

module.exports = router;
