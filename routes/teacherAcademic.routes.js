const express = require('express');
const router = express.Router();
const TeacherAcademicController = require('../controllers/teacherAcademic.controller');
const authenticateToken = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

// Protect all routes for Teacher role (and Admin for testing/management)
router.use(authenticateToken);
router.use(authorizeRoles('Teacher', 'Super Admin', 'Admin'));

// Academic Years
router.get('/years', TeacherAcademicController.getAcademicYears);

// Classes (Strictly assigned to teacher)
router.get('/classes', TeacherAcademicController.getClasses);
router.get('/classes/:id', TeacherAcademicController.getClassById);

// Sections
router.get('/sections', TeacherAcademicController.getSections);
router.get('/sections/:classId', TeacherAcademicController.getSections);
router.get('/sections/detail/:id', TeacherAcademicController.getSectionById);

// Shifts
router.get('/shifts', TeacherAcademicController.getShifts);

// Subjects (Strictly assigned to teacher)
router.get('/subjects', TeacherAcademicController.getSubjects);
router.get('/subjects/:id', TeacherAcademicController.getSubjectById);

// Routine & Timetable
router.get('/routine', TeacherAcademicController.getRoutine);

// Syllabus
router.get('/syllabus', TeacherAcademicController.getSyllabus);
router.get('/syllabus/:id', TeacherAcademicController.getSyllabusById);
router.post('/syllabus', TeacherAcademicController.createSyllabus);
router.put('/syllabus/:id/status', TeacherAcademicController.updateSyllabusStatus);
router.patch('/syllabus/:id/status', TeacherAcademicController.updateSyllabusStatus);
router.put('/syllabus/:id', TeacherAcademicController.updateSyllabus);
router.delete('/syllabus/:id', TeacherAcademicController.deleteSyllabus);

// Assignments
router.get('/assignments', TeacherAcademicController.getAssignments);
router.get('/assignments/types', TeacherAcademicController.getAssignmentTypes);
router.get('/assignments/:id', TeacherAcademicController.getAssignmentById);
router.post('/assignments', TeacherAcademicController.createAssignment);
router.put('/assignments/:id', TeacherAcademicController.updateAssignment);
router.delete('/assignments/:id', TeacherAcademicController.deleteAssignment);
router.post('/assignments/:id/publish', TeacherAcademicController.publishAssignment);
router.get('/assignments/:id/questions', TeacherAcademicController.getAssignmentQuestions);
router.get('/assignment-types', TeacherAcademicController.getAssignmentTypes);

// Study Materials
router.get('/study-materials', TeacherAcademicController.getStudyMaterials);
router.get('/study-materials/:id', TeacherAcademicController.getStudyMaterialById);
router.post('/study-materials', TeacherAcademicController.createStudyMaterial);
router.put('/study-materials/:id', TeacherAcademicController.updateStudyMaterial);
router.post('/study-materials/toggle_status/:id', TeacherAcademicController.toggleStudyMaterialStatus);
router.put('/study-materials/toggle_status/:id', TeacherAcademicController.toggleStudyMaterialStatus);
router.delete('/study-materials/:id', TeacherAcademicController.deleteStudyMaterial);

// Material Types
router.get('/material-types', TeacherAcademicController.getMaterialTypes);
router.post('/material-types', TeacherAcademicController.createMaterialType);
router.put('/material-types/:id', TeacherAcademicController.updateMaterialType);
router.delete('/material-types/:id', TeacherAcademicController.deleteMaterialType);

module.exports = router;
