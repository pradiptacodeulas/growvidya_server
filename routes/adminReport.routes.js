const express = require('express');
const router = express.Router();
const AdminReportController = require('../controllers/adminReport.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const rbacMiddleware = require('../middlewares/rbac.middleware');

// All report routes require JWT authentication
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for report routes
router.use((req, res, next) => {
  if (req.path.includes('/options')) return next();

  let targetModule = 'report/classReport';
  const path = req.path.toLowerCase();

  if (path.includes('class-report')) {
    targetModule = 'report/classReport';
  } else if (path.includes('student-report')) {
    targetModule = 'report/studentReport';
  } else if (path.includes('attendance-report')) {
    targetModule = 'report/attendanceReport';
  } else if (path.includes('calendar')) {
    targetModule = 'report/calendarReport';
  }

  return rbacMiddleware(targetModule, 'view')(req, res, next);
});

// Options for dropdown filter
router.get('/class-report/options', AdminReportController.getClassReportOptions);
router.get('/student-report/options', AdminReportController.getClassReportOptions);
router.get('/options', AdminReportController.getClassReportOptions);

// Class Report queries (GET and POST)
router.get('/class-report', AdminReportController.getClassReport);
router.post('/class-report', AdminReportController.getClassReport);

// Student Report queries (GET and POST)
router.get('/student-report', AdminReportController.getStudentReport);
router.post('/student-report', AdminReportController.getStudentReport);

// Attendance Report queries (GET and POST)
router.get('/attendance-report', AdminReportController.getAttendanceReport);
router.post('/attendance-report', AdminReportController.getAttendanceReport);

// Calendar Events queries (GET and POST)
router.get('/calendar-events', AdminReportController.getCalendarEvents);
router.post('/calendar-events', AdminReportController.getCalendarEvents);
router.get('/calendar-report', AdminReportController.getCalendarEvents);

module.exports = router;
