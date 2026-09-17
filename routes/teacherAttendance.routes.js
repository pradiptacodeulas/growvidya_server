const express = require('express');
const router = express.Router();
const TeacherAttendanceController = require('../controllers/teacherAttendance.controller');
const authenticateToken = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

// Protect all routes for Teacher role (and Admin for management)
router.use(authenticateToken);
router.use(authorizeRoles('Teacher', 'Super Admin', 'Admin'));

// Meta options
router.get('/meta', TeacherAttendanceController.getMetaOptions);

// Student Attendance
router.get('/student/list', TeacherAttendanceController.getStudentAttendanceList);
router.get('/student/roster', TeacherAttendanceController.getStudentsForAttendance);
router.post('/student/save', TeacherAttendanceController.saveStudentAttendance);

module.exports = router;
