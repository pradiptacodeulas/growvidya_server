const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');
const teacherAnnouncementController = require('../controllers/teacherAnnouncement.controller');

// Read-only Announcement Routes for Teachers
router.use(authMiddleware, authorizeRoles('Teacher', 'Super Admin', 'Admin'));

// --- Notice Routes ---
router.get('/notices', teacherAnnouncementController.getTeacherNotices);
router.get('/notice', teacherAnnouncementController.getTeacherNotices);
router.get('/notices/:id', teacherAnnouncementController.getTeacherNoticeById);
router.get('/notice/:id', teacherAnnouncementController.getTeacherNoticeById);

// --- Event Routes ---
router.get('/events', teacherAnnouncementController.getTeacherEvents);
router.get('/events/:id', teacherAnnouncementController.getTeacherEventById);

// --- Holiday Routes ---
router.get('/holidays', teacherAnnouncementController.getTeacherHolidays);
router.get('/holidays/:id', teacherAnnouncementController.getTeacherHolidayById);

module.exports = router;
