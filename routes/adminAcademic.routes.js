const express = require('express');
const router = express.Router();
const AdminAcademicController = require('../controllers/adminAcademic.controller');
const authenticateToken = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

// Authenticate user
router.use(authenticateToken);

const pathModuleMap = {
  'shifts': 'academic/shift',
  'classes': 'academic/classes',
  'class': 'academic/classes',
  'sections': 'academic/sections',
  'subjects': 'academic/subject',
  'houses': 'academic/house',
  'periods': 'academic/period',
  'days': 'academic/days',
  'years': 'academic/year',
  'academic-years': 'academic/year',
  'academic-year': 'academic/year',
  'year': 'academic/year',
  'document-types': 'academic/documentType',
  'routines': 'academic/routine',
  'syllabus': 'academic/syllabus',
  'lessons': 'academic/syllabus',
  'assignment-types': 'academic/assignmenttype',
  'assignments': 'academic/assignment',
  'study-materials': 'academic/material',
  'material-types': 'academic/material',
};

// Academic master taxonomy segments used across multiple modules for dropdowns and filtering
const MASTER_LOOKUP_SEGMENTS = new Set([
  'classes',
  'class',
  'sections',
  'years',
  'academic-years',
  'academic-year',
  'year',
  'subjects',
  'shifts',
  'houses',
  'periods',
  'days',
  'document-types',
]);

// Granular RBAC enforcement per academic sub-module & action
router.use((req, res, next) => {
  const cleanPath = req.path.replace(/^\//, '');
  const firstSegment = cleanPath.split('/')[0];
  const targetModule = pathModuleMap[firstSegment];

  let action = 'view';
  const method = req.method.toUpperCase();

  if (method === 'GET') {
    action = 'view';
  } else if (method === 'DELETE') {
    action = 'delete';
  } else if (method === 'PUT' || method === 'PATCH' || req.path.includes('update') || req.path.includes('toggle') || req.path.includes('publish')) {
    action = 'edit';
  } else if (method === 'POST') {
    if (req.path.includes('by-class')) {
      action = 'view';
    } else if (req.path.includes('update') || req.path.includes('toggle') || req.path.includes('publish')) {
      action = 'edit';
    } else {
      action = 'add';
    }
  }

  // Master data lookups (classes, sections, years, overview, genders, countries, etc.)
  // When reading (GET or POST by-class), allow all authenticated school roles
  // (Super Admin, Admin/Staff, Teacher, Parent, Student) to populate dropdowns/filters
  const isMasterLookup =
    (action === 'view' && MASTER_LOOKUP_SEGMENTS.has(firstSegment)) ||
    !targetModule;

  if (isMasterLookup) {
    return authorizeRoles('Super Admin', 'Admin', 'Teacher', 'Parent', 'Student')(req, res, next);
  }

  return authorizeRoles(['Super Admin', 'Admin', 'Teacher', 'Parent'], targetModule, action)(req, res, next);
});

// Overview Route
router.get('/overview', AdminAcademicController.getAllMasters);

// Academic Years & aliases
router.get(['/years', '/academic-years', '/academic-year', '/year'], AdminAcademicController.getAcademicYears);
router.get(['/years/:id', '/academic-years/:id', '/academic-year/:id', '/year/:id'], AdminAcademicController.getAcademicYearById);
router.post(['/years', '/academic-years', '/academic-year', '/year'], AdminAcademicController.createAcademicYear);
router.put(['/years/:id', '/academic-years/:id', '/academic-year/:id', '/year/:id'], AdminAcademicController.updateAcademicYear);
router.post(['/years/updateYear/:id', '/academic-years/updateYear/:id'], AdminAcademicController.updateAcademicYear);
router.delete(['/years/:id', '/academic-years/:id', '/academic-year/:id', '/year/:id'], AdminAcademicController.deleteAcademicYear);

// Classes & alias /class
router.get('/classes', AdminAcademicController.getClasses);
router.get('/class', AdminAcademicController.getClasses);
router.get('/classes/:id', AdminAcademicController.getClassById);
router.get('/class/:id', AdminAcademicController.getClassById);
router.post('/classes', AdminAcademicController.createClass);
router.post('/class', AdminAcademicController.createClass);
router.put('/classes/:id', AdminAcademicController.updateClass);
router.put('/class/:id', AdminAcademicController.updateClass);
router.delete('/classes/:id', AdminAcademicController.deleteClass);
router.delete('/class/:id', AdminAcademicController.deleteClass);

// Sections (supports query ?classId= or ?class_id= or path /sections/:classId)
router.get('/sections', AdminAcademicController.getSections);
router.get('/sections/detail/:id', AdminAcademicController.getSectionById);
router.get('/sections/:classId', AdminAcademicController.getSections);
router.get('/classes/:classId/sections', AdminAcademicController.getSections);
router.post('/sections/by-class', AdminAcademicController.getSections);
router.post('/sections', AdminAcademicController.createSection);
router.put('/sections/:id', AdminAcademicController.updateSection);
router.post('/sections/updateSection/:id', AdminAcademicController.updateSection);
router.delete('/sections/:id', AdminAcademicController.deleteSection);

// Subjects
router.get('/subjects', AdminAcademicController.getSubjects);
router.get('/subjects/:id', AdminAcademicController.getSubjectById);
router.post('/subjects', AdminAcademicController.createSubject);
router.put('/subjects/:id', AdminAcademicController.updateSubject);
router.post('/subjects/updateSubject/:id', AdminAcademicController.updateSubject);
router.delete('/subjects/:id', AdminAcademicController.deleteSubject);

// Shifts
router.get('/shifts', AdminAcademicController.getShifts);
router.get('/shifts/:id', AdminAcademicController.getShiftById);
router.post('/shifts', AdminAcademicController.createShift);
router.put('/shifts/:id', AdminAcademicController.updateShift);
router.delete('/shifts/:id', AdminAcademicController.deleteShift);

// Houses
router.get('/houses', AdminAcademicController.getHouses);
router.get('/houses/:id', AdminAcademicController.getHouseById);
router.post('/houses', AdminAcademicController.createHouse);
router.put('/houses/:id', AdminAcademicController.updateHouse);
router.post('/houses/updateHouse/:id', AdminAcademicController.updateHouse);
router.delete('/houses/:id', AdminAcademicController.deleteHouse);

// Periods
router.get('/periods', AdminAcademicController.getPeriods);
router.get('/periods/:id', AdminAcademicController.getPeriodById);
router.post('/periods', AdminAcademicController.createPeriod);
router.put('/periods/:id', AdminAcademicController.updatePeriod);
router.post('/periods/update_period/:id', AdminAcademicController.updatePeriod);
router.delete('/periods/:id', AdminAcademicController.deletePeriod);

// Days
router.get('/days', AdminAcademicController.getDays);
router.get('/days/:id', AdminAcademicController.getDayById);
router.post('/days', AdminAcademicController.createDay);
router.put('/days/:id', AdminAcademicController.updateDay);
router.post('/days/update_days/:id', AdminAcademicController.updateDay);
router.delete('/days/:id', AdminAcademicController.deleteDay);

// Document Types
router.get('/document-types', AdminAcademicController.getDocumentTypes);
router.get('/document-types/:id', AdminAcademicController.getDocumentTypeById);
router.post('/document-types', AdminAcademicController.createDocumentType);
router.put('/document-types/:id', AdminAcademicController.updateDocumentType);
router.post('/document-types/updateDocumentType/:id', AdminAcademicController.updateDocumentType);
router.delete('/document-types/:id', AdminAcademicController.deleteDocumentType);

// Routines / Timetable
router.get('/routines', AdminAcademicController.getRoutines);
router.post('/routines', AdminAcademicController.createRoutine);
router.put('/routines/:id', AdminAcademicController.updateRoutine);
router.post('/routines/updateRoutine/:id', AdminAcademicController.updateRoutine);
router.delete('/routines/:id', AdminAcademicController.deleteRoutine);
router.get('/class-teachers', AdminAcademicController.getClassAssignedTeachers);

// Syllabus
router.get('/syllabus', AdminAcademicController.getSyllabusList);
router.get('/syllabus/:id', AdminAcademicController.getSyllabusById);
router.post('/syllabus', AdminAcademicController.createSyllabus);
router.put('/syllabus/:id', AdminAcademicController.updateSyllabus);
router.post('/syllabus/update_syllabus/:id', AdminAcademicController.updateSyllabus);
router.put('/syllabus/:id/status', AdminAcademicController.updateSyllabusStatus);
router.patch('/syllabus/:id/status', AdminAcademicController.updateSyllabusStatus);
router.delete('/syllabus/:id', AdminAcademicController.deleteSyllabus);

// Lessons (legacy)
router.get('/lessons', AdminAcademicController.getLessons);
router.post('/lessons', AdminAcademicController.createLesson);
router.delete('/lessons/:id', AdminAcademicController.deleteLesson);

// Assignments
router.get('/assignment-types', AdminAcademicController.getAssignmentTypes);
router.get('/assignment-types/:id', AdminAcademicController.getAssignmentTypeById);
router.post('/assignment-types', AdminAcademicController.createAssignmentType);
router.put('/assignment-types/:id', AdminAcademicController.updateAssignmentType);
router.post('/assignment-types/update_assignment/:id', AdminAcademicController.updateAssignmentType);
router.post('/assignment-types/update_assignment_type/:id', AdminAcademicController.updateAssignmentType);
router.post('/assignment-types/updateAssignmentType/:id', AdminAcademicController.updateAssignmentType);
router.get('/assignments', AdminAcademicController.getAssignments);
router.get('/assignments/:id', AdminAcademicController.getAssignmentById);
router.get('/assignments/:id/questions', AdminAcademicController.getAssignmentQuestions);
router.post('/assignments', AdminAcademicController.createAssignment);
router.post('/assignment/insertData', AdminAcademicController.createAssignment);
router.put('/assignments/:id', AdminAcademicController.updateAssignment);
router.post('/assignments/:id/publish', AdminAcademicController.publishAssignment);
router.post('/assignment/publishAssignment/:id', AdminAcademicController.publishAssignment);
router.delete('/assignments/:id', AdminAcademicController.deleteAssignment);

// Study Materials & Material Types
router.get('/material-types', AdminAcademicController.getMaterialTypes);
router.get('/material-types/:id', AdminAcademicController.getMaterialTypeById);
router.post('/material-types', AdminAcademicController.createMaterialType);
router.put('/material-types/:id', AdminAcademicController.updateMaterialType);
router.delete('/material-types/:id', AdminAcademicController.deleteMaterialType);

router.get('/study-materials', AdminAcademicController.getStudyMaterials);
router.get('/study-materials/download/:id', AdminAcademicController.downloadStudyMaterial);
router.get('/study-materials/:id/download', AdminAcademicController.downloadStudyMaterial);
router.get('/study-materials/:id', AdminAcademicController.getStudyMaterialById);
router.post('/study-materials', AdminAcademicController.createStudyMaterial);
router.put('/study-materials/:id', AdminAcademicController.updateStudyMaterial);
router.post('/study-materials/updateMaterial/:id', AdminAcademicController.updateStudyMaterial);
router.post('/study-materials/toggle_status/:id', AdminAcademicController.toggleStudyMaterialStatus);
router.post('/study-materials/toggle-status/:id', AdminAcademicController.toggleStudyMaterialStatus);
router.delete('/study-materials/:id', AdminAcademicController.deleteStudyMaterial);

// Lookups for Add Student
router.get('/student-masters', AdminAcademicController.getStudentMasters);
router.get('/genders', AdminAcademicController.getGenders);
router.get('/blood-groups', AdminAcademicController.getBloodGroups);
router.get('/marital-statuses', AdminAcademicController.getMaritalStatuses);
router.get('/religions', AdminAcademicController.getReligions);
router.get('/categories', AdminAcademicController.getCategories);
router.get('/mother-tongues', AdminAcademicController.getMotherTongues);
router.get('/countries', AdminAcademicController.getCountries);
router.get('/states', AdminAcademicController.getStates);
router.get('/cities', AdminAcademicController.getCities);
router.get('/routes', AdminAcademicController.getTransportRoutes);
router.get('/hostels', AdminAcademicController.getHostels);
router.get('/hostel-rooms', AdminAcademicController.getHostelRooms);
router.get('/roll-number', AdminAcademicController.getNextRollNumber);

module.exports = router;
