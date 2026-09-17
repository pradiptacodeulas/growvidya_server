const express = require('express');
const router = express.Router();
const CommonOptionsController = require('../controllers/commonOptions.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// All options endpoints require authentication (Super Admin, Admin/Staff, Teacher, Parent, Student)
router.use(authMiddleware);

// Master Lookups & Dropdowns
router.get('/academic-years', CommonOptionsController.getAcademicYears);
router.get('/classes', CommonOptionsController.getClasses);
router.get('/sections', CommonOptionsController.getSections);
router.get('/sections/:classId', CommonOptionsController.getSections);
router.get('/subjects', CommonOptionsController.getSubjects);
router.get('/shifts', CommonOptionsController.getShifts);
router.get('/houses', CommonOptionsController.getHouses);
router.get('/roles', CommonOptionsController.getRoles);

// Bundled options in a single call for high-performance page boots
router.get('/academic-bundle', CommonOptionsController.getAcademicBundle);

module.exports = router;
