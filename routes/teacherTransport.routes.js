const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');
const TeacherTransportController = require('../controllers/teacherTransport.controller');

// Strictly for Teacher role
router.use(authMiddleware, authorizeRoles('Teacher', 'Super Admin', 'Admin'));

// GET /api/v1/teacher/transport/my-transport
router.get('/my-transport', TeacherTransportController.getMyAssignedTransport);

module.exports = router;
