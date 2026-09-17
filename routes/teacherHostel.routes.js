const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');
const TeacherHostelController = require('../controllers/teacherHostel.controller');

// Strictly for Teacher role
router.use(authMiddleware, authorizeRoles('Teacher', 'Super Admin', 'Admin'));

// GET /api/v1/teacher/hostel/my-hostel
router.get('/my-hostel', TeacherHostelController.getMyAssignedHostel);

module.exports = router;
