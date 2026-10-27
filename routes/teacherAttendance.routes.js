const express = require('express');
const router = express.Router();
const TeacherAttendanceController = require('../controllers/teacherAttendance.controller');
const TeacherSelfAttendanceController = require('../controllers/teacherSelfAttendance.controller');
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
router.post('/qr-scan', TeacherAttendanceController.scanStudentAttendance);
router.post('/student/qr-scan', TeacherAttendanceController.scanStudentAttendance);

// Teacher Self Attendance (geofence check-in from Teacher App)
router.get('/self/status', TeacherSelfAttendanceController.getStatus);
router.post('/self/check-in', TeacherSelfAttendanceController.checkIn);

module.exports = router;
