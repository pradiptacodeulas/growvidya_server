const express = require('express');
const router = express.Router();
const TeacherPayrollController = require('../controllers/teacherPayroll.controller');
const authenticateToken = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

router.use(authenticateToken);
router.use(authorizeRoles('Teacher', 'Super Admin', 'Admin'));

router.get('/salary', TeacherPayrollController.getMySalaries);

module.exports = router;
