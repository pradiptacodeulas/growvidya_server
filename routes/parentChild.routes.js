const express = require('express');
const router = express.Router();
const ParentChildController = require('../controllers/parentChild.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/profile', ParentChildController.getProfile);
router.put('/profile', ParentChildController.updateProfile);
router.post('/profile', ParentChildController.updateProfile);
router.post('/profile/update', ParentChildController.updateProfile);
router.get('/academic-years', ParentChildController.getAcademicYears);
router.get('/years', ParentChildController.getAcademicYears);
router.get('/attendance', ParentChildController.getAttendance);
router.get('/fees', ParentChildController.getFees);
router.post('/fees/pay', ParentChildController.payFee);
router.post('/pay-fee', ParentChildController.payFee);
router.get('/exam-results', ParentChildController.getExamResults);
router.get('/study-materials', ParentChildController.getStudyMaterials);
router.get('/material-types', ParentChildController.getMaterialTypes);
router.get('/timetable', ParentChildController.getTimetable);
router.get('/transport', ParentChildController.getTransport);
router.get('/hostel', ParentChildController.getHostel);
router.get('/medical', ParentChildController.getMedical);
router.get('/activities', ParentChildController.getActivities);
router.get('/activity', ParentChildController.getActivities);
router.get('/documents', ParentChildController.getDocuments);
router.get('/document', ParentChildController.getDocuments);

module.exports = router;
