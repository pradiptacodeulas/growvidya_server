const express = require('express');
const router = express.Router();
const ParentDashboardController = require('../controllers/parentDashboard.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);
router.get('/', ParentDashboardController.getDashboardData);

module.exports = router;
