const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');
const adminAnnouncementController = require('../controllers/adminAnnouncement.controller');

// All admin announcement routes require Admin or Super Admin auth
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for announcement routes
router.use((req, res, next) => {
  // Read-only access to notices, events, and holidays is available to any authenticated school user
  // (e.g. for Navbar notification bell, dashboard feeds, and school calendar)
  if (req.method === 'GET') {
    return next();
  }

  let targetModule = 'announcement/notice';
  if (req.path.startsWith('/events')) {
    targetModule = 'announcement/event';
  } else if (req.path.startsWith('/holidays')) {
    targetModule = 'announcement/holiday';
  }

  let targetAction = 'add';
  if (req.method === 'PUT' || req.method === 'PATCH') targetAction = 'edit';
  else if (req.method === 'DELETE') targetAction = 'delete';

  return authorizeRoles(targetModule, targetAction)(req, res, next);
});

// --- Notice Routes ---
router.get('/notices', adminAnnouncementController.getAllNotices);
router.get('/notice', adminAnnouncementController.getAllNotices);
router.get('/notices/:id', adminAnnouncementController.getNoticeById);
router.get('/notice/:id', adminAnnouncementController.getNoticeById);
router.post('/notices', adminAnnouncementController.createNotice);
router.post('/notice', adminAnnouncementController.createNotice);
router.put('/notices/:id', adminAnnouncementController.updateNotice);
router.put('/notice/:id', adminAnnouncementController.updateNotice);
router.delete('/notices/:id', adminAnnouncementController.deleteNotice);
router.delete('/notice/:id', adminAnnouncementController.deleteNotice);

// --- Event Routes ---
router.get('/events', adminAnnouncementController.getAllEvents);
router.get('/events/:id', adminAnnouncementController.getEventById);
router.post('/events', adminAnnouncementController.createEvent);
router.put('/events/:id', adminAnnouncementController.updateEvent);
router.delete('/events/:id', adminAnnouncementController.deleteEvent);

// --- Holiday Routes ---
router.get('/holidays', adminAnnouncementController.getAllHolidays);
router.get('/holidays/:id', adminAnnouncementController.getHolidayById);
router.post('/holidays', adminAnnouncementController.createHoliday);
router.put('/holidays/:id', adminAnnouncementController.updateHoliday);
router.delete('/holidays/:id', adminAnnouncementController.deleteHoliday);

module.exports = router;
