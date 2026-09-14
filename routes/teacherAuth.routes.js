const express = require('express');
const router = express.Router();
const TeacherAuthController = require('../controllers/teacherAuth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/login', TeacherAuthController.login);
router.post('/request-passcode', TeacherAuthController.requestPasscode);
router.post('/verify-passcode', TeacherAuthController.verifyPasscode);
router.get('/profile', authMiddleware, TeacherAuthController.getProfile);
router.put('/profile', authMiddleware, TeacherAuthController.updateProfile);
router.patch('/profile', authMiddleware, TeacherAuthController.updateProfile);
router.post('/logout', TeacherAuthController.logout);

module.exports = router;
