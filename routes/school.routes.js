const express = require('express');
const router = express.Router();
const SchoolController = require('../controllers/school.controller');

router.get('/config', SchoolController.getSchoolConfig);

module.exports = router;
