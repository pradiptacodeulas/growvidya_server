const express = require('express');
const router = express.Router();
const AdminPayrollController = require('../controllers/adminPayroll.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const rbacMiddleware = require('../middlewares/rbac.middleware');

router.use(authMiddleware);

// Dynamic module & action RBAC middleware for payroll routes
router.use((req, res, next) => {
  const userRole = String(req.user?.roleName || req.user?.role || req.user?.portalType || '').toLowerCase();
  const isTeacher = userRole.includes('teacher') || req.user?.portalType === 'TeacherPortal' || Boolean(req.user?.teacherId);

  // Teachers are allowed to view salary list (filtered to their own records in controller)
  if (req.method === 'GET' && req.path === '/salary' && isTeacher) {
    return next();
  }

  const targetModule = 'settings/salarydatesettings';
  let targetAction = 'view';
  if (req.method === 'POST') targetAction = 'add';
  else if (req.method === 'PUT' || req.method === 'PATCH') targetAction = 'edit';
  else if (req.method === 'DELETE') targetAction = 'delete';

  return rbacMiddleware(targetModule, targetAction)(req, res, next);
});

// Beneficiaries
router.get('/employees', AdminPayrollController.getEmployeesByType);
router.get('/beneficiaries', AdminPayrollController.getBeneficiaries);
router.get('/beneficiaries/:id', AdminPayrollController.getBeneficiaryById);
router.post('/beneficiaries', AdminPayrollController.createBeneficiary);
router.put('/beneficiaries/:id', AdminPayrollController.updateBeneficiary);
router.delete('/beneficiaries/:id', AdminPayrollController.deleteBeneficiary);

// Salary
router.get('/salary', AdminPayrollController.getSalaries);
router.post('/salary', AdminPayrollController.createSalary);
router.put('/salary/:id/status', AdminPayrollController.updateSalaryStatus);
router.patch('/salary/:id/status', AdminPayrollController.updateSalaryStatus);

module.exports = router;
