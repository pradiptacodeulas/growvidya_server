const express = require('express');
const router = express.Router();
const AdminLeaveController = require('../controllers/adminLeave.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

router.use(authMiddleware);

// Dynamic module & action RBAC middleware for leave routes
router.use((req, res, next) => {
  const isType = req.path.startsWith('/types') || req.path.startsWith('/staff');
  const targetModule = isType ? 'leaves/leaveassign' : 'leaves/leaveapply';

  let targetAction = 'view';
  if (req.method === 'POST') targetAction = 'add';
  else if (req.method === 'PUT' || req.method === 'PATCH') targetAction = 'edit';
  else if (req.method === 'DELETE') targetAction = 'delete';

  return authorizeRoles(targetModule, targetAction)(req, res, next);
});

// Leave Applications
router.get('/', AdminLeaveController.getAllLeaves);
router.post('/', AdminLeaveController.createLeave);
router.get('/details/:id', AdminLeaveController.getLeaveById);
router.put('/:id/status', AdminLeaveController.updateLeaveStatus);
router.put('/date/:dateId/status', AdminLeaveController.updateLeaveDateStatus);
router.delete('/:id', AdminLeaveController.deleteLeave);

// Master & Helpers
router.get('/types', AdminLeaveController.getLeaveTypes);
router.post('/types', AdminLeaveController.createLeaveType);
router.get('/types/:id', AdminLeaveController.getLeaveTypeById);
router.put('/types/:id', AdminLeaveController.updateLeaveType);
router.delete('/types/:id', AdminLeaveController.deleteLeaveType);
router.get('/staff/:role', AdminLeaveController.getStaffByRole);

module.exports = router;
