const express = require('express');
const router = express.Router();
const AdminAttendanceController = require('../controllers/adminAttendance.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

// All admin attendance routes require active admin authentication
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for attendance routes
router.use((req, res, next) => {
  let targetModule = 'attendance/student';
  if (req.path.startsWith('/teacher')) {
    targetModule = 'attendance/teacher';
  } else if (req.path.startsWith('/staff')) {
    targetModule = 'attendance/staff';
  } else if (req.path.startsWith('/meta')) {
    return next();
  }

  const targetAction = req.method === 'POST' ? 'add' : 'view';
  return authorizeRoles(targetModule, targetAction)(req, res, next);
});

// Meta options (classes, sections, academic years)
router.get('/meta', AdminAttendanceController.getMetaOptions);

// Student Attendance
router.get('/student/list', AdminAttendanceController.getStudentAttendanceList);
router.get('/student/roster', AdminAttendanceController.getStudentsForAttendance);
router.post('/student/save', AdminAttendanceController.saveStudentAttendance);

// Teacher Attendance
router.get('/teacher/list', AdminAttendanceController.getTeacherAttendanceList);
router.get('/teacher/roster', AdminAttendanceController.getTeachersForAttendance);
router.post('/teacher/save', AdminAttendanceController.saveTeacherAttendance);

// Staff Attendance
router.get('/staff/list', AdminAttendanceController.getStaffAttendanceList);
router.get('/staff/roster', AdminAttendanceController.getStaffForAttendance);
router.post('/staff/save', AdminAttendanceController.saveStaffAttendance);

module.exports = router;
