const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');
const TeacherLeaveController = require('../controllers/teacherLeave.controller');

// Teacher Leaves authorization
router.use(authMiddleware, authorizeRoles('Teacher', 'Super Admin', 'Admin'));

router.get('/my-leaves', TeacherLeaveController.getMyLeaves);
router.get('/my-leaves/:id', TeacherLeaveController.getMyLeaveById);
router.get('/types', TeacherLeaveController.getTeacherLeaveTypes);
router.post('/apply', TeacherLeaveController.applyLeave);

module.exports = router;
