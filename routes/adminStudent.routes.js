const express = require('express');
const router = express.Router();
const AdminStudentController = require('../controllers/adminStudent.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// All student admin routes require JWT authentication
router.use(authMiddleware);

// Read-only queries (Accessible by Super Admin, Admin, Teacher)
router.get('/', rbacMiddleware(['Super Admin', 'Admin', 'Teacher'], 'ward/students', 'view'), AdminStudentController.getAllStudents);
router.post('/filter', rbacMiddleware(['Super Admin', 'Admin', 'Teacher'], 'ward/students', 'view'), AdminStudentController.getAllStudents);
router.post('/search', rbacMiddleware(['Super Admin', 'Admin', 'Teacher'], 'ward/students', 'view'), AdminStudentController.getAllStudents);

// Check email duplicate availability
router.get('/check-email', rbacMiddleware(['Super Admin', 'Admin'], 'ward/students', 'add'), AdminStudentController.checkEmail);

// Student activities management (Accessible by Super Admin, Admin, Teacher)
router.post('/:id/activity', rbacMiddleware(['Super Admin', 'Admin', 'Teacher'], 'ward/students', 'edit'), AdminStudentController.addActivity);
router.delete('/activity/:activityId', rbacMiddleware(['Super Admin', 'Admin', 'Teacher'], 'ward/students', 'delete'), AdminStudentController.deleteActivity);

// Student details view (Accessible by Super Admin, Admin, Teacher)
router.get('/:id', rbacMiddleware(['Super Admin', 'Admin', 'Teacher'], 'ward/students', 'view'), AdminStudentController.getStudentById);

// Student core record mutations (Strictly Super Admin & Admin - Teachers cannot create, edit details, or delete students)
router.post('/', rbacMiddleware(['Super Admin', 'Admin'], 'ward/students', 'add'), AdminStudentController.createStudent);
router.put('/:id', rbacMiddleware(['Super Admin', 'Admin'], 'ward/students', 'edit'), AdminStudentController.updateStudent);
router.delete('/:id', rbacMiddleware(['Super Admin', 'Admin'], 'ward/students', 'delete'), AdminStudentController.deleteStudent);

module.exports = router;
