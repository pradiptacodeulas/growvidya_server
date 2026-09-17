const express = require('express');
const router = express.Router();
const AdminFeesController = require('../controllers/adminFees.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// All fees endpoints require authentication and module permissions
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for fees routes
router.use((req, res, next) => {
  let targetModule = 'feesmanagement/payments';
  const path = req.path.toLowerCase();

  if (path.startsWith('/components')) {
    targetModule = req.method === 'GET'
      ? ['feesmanagement/components', 'feesmanagement/structures', 'feesmanagement/allocations', 'feesmanagement/invoices', 'feesmanagement/payments']
      : 'feesmanagement/components';
  } else if (path.startsWith('/structures')) {
    targetModule = req.method === 'GET'
      ? ['feesmanagement/structures', 'feesmanagement/allocations', 'feesmanagement/invoices', 'feesmanagement/payments']
      : 'feesmanagement/structures';
  } else if (path.startsWith('/allocations')) {
    targetModule = 'feesmanagement/allocations';
  } else if (path.startsWith('/invoices')) {
    targetModule = req.method === 'GET'
      ? ['feesmanagement/invoices', 'feesmanagement/payments']
      : 'feesmanagement/invoices';
  } else if (path.startsWith('/payments') || path.startsWith('/stats')) {
    targetModule = 'feesmanagement/payments';
  }

  let targetAction = 'view';
  if (req.method === 'POST') targetAction = 'add';
  else if (req.method === 'PUT' || req.method === 'PATCH') targetAction = 'edit';
  else if (req.method === 'DELETE') targetAction = 'delete';

  return rbacMiddleware(targetModule, targetAction)(req, res, next);
});

// =========================================================
// 1. FEE COMPONENTS
// =========================================================
router.get('/components', AdminFeesController.getAllComponents);
router.get('/components/:id', AdminFeesController.getComponentById);
router.post('/components', AdminFeesController.createComponent);
router.put('/components/:id', AdminFeesController.updateComponent);
router.delete('/components/:id', AdminFeesController.deleteComponent);

// =========================================================
// 2. FEE STRUCTURES
// =========================================================
router.get('/structures', AdminFeesController.getAllStructures);
router.get('/structures/:id', AdminFeesController.getStructureById);
router.post('/structures', AdminFeesController.saveStructure);
router.put('/structures/:id', AdminFeesController.saveStructure);
router.delete('/structures/:id', AdminFeesController.deleteStructure);

// =========================================================
// 3. STUDENT ALLOCATIONS
// =========================================================
router.get('/allocations', AdminFeesController.getAllocations);
router.post('/allocations', AdminFeesController.allocateStructureToStudents);
router.delete('/allocations/:id', AdminFeesController.deleteAllocation);

// =========================================================
// 4. FEE INVOICES & DEMANDS
// =========================================================
router.get('/invoices', AdminFeesController.getAllInvoices);
router.get('/invoices/:id', AdminFeesController.getInvoiceById);
router.post('/invoices/generate', AdminFeesController.generateInvoices);
router.delete('/invoices/:id', AdminFeesController.deleteInvoice);

// =========================================================
// 5. FEE PAYMENTS & STATS
// =========================================================
router.get('/stats', AdminFeesController.getCollectionStats);
router.get('/payments', AdminFeesController.getAllPayments);
router.get('/payments/:id', AdminFeesController.getPaymentById);
router.post('/payments/collect', AdminFeesController.recordPayment);

module.exports = router;
