const express = require('express');
const router = express.Router();
const StudentPortalController = require('../controllers/studentPortal.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/dashboard', StudentPortalController.getDashboard);
router.get('/profile', StudentPortalController.getProfile);
router.put('/profile', StudentPortalController.updateProfile);
router.post('/profile', StudentPortalController.updateProfile);
router.get('/attendance', StudentPortalController.getAttendance);
router.get('/timetable', StudentPortalController.getTimetable);
router.get('/routine', StudentPortalController.getTimetable);
router.get('/exam-results', StudentPortalController.getExamResults);
router.get('/results', StudentPortalController.getExamResults);
router.get('/study-materials', StudentPortalController.getStudyMaterials);
router.get('/studymaterial', StudentPortalController.getStudyMaterials);
router.get('/activities', StudentPortalController.getActivities);
router.get('/activity', StudentPortalController.getActivities);
router.get('/fees', StudentPortalController.getFees);
router.get('/transport', StudentPortalController.getTransport);
router.get('/hostel', StudentPortalController.getHostel);
router.get('/medical', StudentPortalController.getMedical);
router.get('/documents', StudentPortalController.getDocuments);
router.get('/document', StudentPortalController.getDocuments);
router.get('/assignments', StudentPortalController.getAssignments);
router.get('/assignment', StudentPortalController.getAssignments);
router.get('/assignments/:id/attempt', StudentPortalController.getAssignmentForAttempt);
router.post('/assignments/:id/submit', StudentPortalController.submitAssignmentAttempt);
router.get('/assignments/:id/result', StudentPortalController.getAssignmentResult);

module.exports = router;
