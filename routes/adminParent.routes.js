const express = require('express');
const router = express.Router();
const AdminParentController = require('../controllers/adminParent.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// Protect all parent admin routes with JWT + RBAC
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for parents routes
router.use((req, res, next) => {
  const targetModule = 'ward/parents';
  let targetAction = 'view';
  if (req.method === 'POST') {
    if (req.path === '/filter' || req.path === '/search' || req.path.startsWith('/check-')) targetAction = 'view';
    else targetAction = 'add';
  } else if (req.method === 'PUT' || req.method === 'PATCH') {
    targetAction = 'edit';
  } else if (req.method === 'DELETE') {
    targetAction = 'delete';
  }

  return rbacMiddleware(targetModule, targetAction)(req, res, next);
});

router.get('/check-duplicate', AdminParentController.checkDuplicate);
router.post('/check-duplicate', AdminParentController.checkDuplicate);
router.get('/check-email', AdminParentController.checkEmail);
router.post('/check-email', AdminParentController.checkEmail);
router.get('/check-phone', AdminParentController.checkPhone);
router.post('/check-phone', AdminParentController.checkPhone);

router.get('/', AdminParentController.getAllParents);
router.post('/filter', AdminParentController.getAllParents);
router.post('/search', AdminParentController.getAllParents);

router.get('/:id', AdminParentController.getParentById);
router.post('/', AdminParentController.createParent);
router.put('/:id', AdminParentController.updateParent);
router.delete('/:id', AdminParentController.deleteParent);

router.post('/link-student', AdminParentController.linkStudentParent);

module.exports = router;
