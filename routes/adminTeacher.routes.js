const express = require('express');
const router = express.Router();
const AdminTeacherController = require('../controllers/adminTeacher.controller');
const authenticateToken = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

router.use(authenticateToken);

router.get('/', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'view'), AdminTeacherController.getAllTeachers);
router.get('/meta/options', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'view'), AdminTeacherController.getTeacherOptions);
router.post('/check-email', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'add'), AdminTeacherController.checkEmail);
router.get('/check-email', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'add'), AdminTeacherController.checkEmail);
router.post('/check-phone', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'add'), AdminTeacherController.checkPhone);
router.get('/check-phone', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'add'), AdminTeacherController.checkPhone);
router.post('/check-duplicate', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'add'), AdminTeacherController.checkDuplicate);
router.get('/check-duplicate', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'add'), AdminTeacherController.checkDuplicate);
router.get('/:id', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'view'), AdminTeacherController.getTeacherById);
router.post('/', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'add'), AdminTeacherController.createTeacher);
router.put('/:id', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'edit'), AdminTeacherController.updateTeacher);
router.delete('/:id', authorizeRoles(['Super Admin', 'Admin'], 'staff/teachers', 'delete'), AdminTeacherController.deleteTeacher);

module.exports = router;
