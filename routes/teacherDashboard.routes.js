const express = require('express');
const router = express.Router();
const TeacherDashboardController = require('../controllers/teacherDashboard.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.get('/', authMiddleware, TeacherDashboardController.getDashboardData);

module.exports = router;
