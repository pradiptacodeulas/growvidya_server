const express = require('express');
const router = express.Router();
const AdminExaminationController = require('../controllers/adminExamination.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');

// All routes require authenticated Admin/Staff
router.use(authMiddleware);

// 1. Grade Settings
router.get(
  '/grades',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    [
      'examination/gradeSettings',
      'examination/examResult',
      'examination/exam',
      'examination/examschedule',
      'examination/examsubject',
      'examination/examtype',
      'examination/examAttendance',
      'records/marksheet',
    ],
    'view'
  ),
  AdminExaminationController.getAllGrades
);
router.get(
  '/grades/:id',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    [
      'examination/gradeSettings',
      'examination/examResult',
      'examination/exam',
      'examination/examschedule',
      'examination/examsubject',
      'examination/examtype',
      'examination/examAttendance',
      'records/marksheet',
    ],
    'view'
  ),
  AdminExaminationController.getGradeById
);
router.post(
  '/grades',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/gradeSettings', 'add'),
  AdminExaminationController.createGrade
);
router.put(
  '/grades/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/gradeSettings', 'edit'),
  AdminExaminationController.updateGrade
);
router.delete(
  '/grades/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/gradeSettings', 'delete'),
  AdminExaminationController.deleteGrade
);

// 2. Exam Master
router.get(
  '/exams',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    [
      'examination/exam',
      'examination/examschedule',
      'examination/examsubject',
      'examination/examtype',
      'examination/examAttendance',
      'examination/examResult',
      'report/attendanceReport',
      'report/studentReport',
      'records/marksheet',
      'records/admitcard',
    ],
    'view'
  ),
  AdminExaminationController.getAllExams
);
router.get(
  '/exams/:id',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    [
      'examination/exam',
      'examination/examschedule',
      'examination/examsubject',
      'examination/examtype',
      'examination/examAttendance',
      'examination/examResult',
      'report/attendanceReport',
      'report/studentReport',
      'records/marksheet',
      'records/admitcard',
    ],
    'view'
  ),
  AdminExaminationController.getExamById
);
router.post(
  '/exams',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/exam', 'add'),
  AdminExaminationController.createExam
);
router.put(
  '/exams/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/exam', 'edit'),
  AdminExaminationController.updateExam
);
router.delete(
  '/exams/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/exam', 'delete'),
  AdminExaminationController.deleteExam
);

// 3. Exam Types (Theory, Practical, Assessment)
router.get(
  '/exam-types',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examtype', 'examination/examsubject', 'examination/examResult', 'examination/exam'],
    'view'
  ),
  AdminExaminationController.getAllExamTypes
);
router.get(
  '/exam-types/:id',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examtype', 'examination/examsubject', 'examination/examResult', 'examination/exam'],
    'view'
  ),
  AdminExaminationController.getExamTypeById
);
router.post(
  '/exam-types',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examtype', 'add'),
  AdminExaminationController.createExamType
);
router.put(
  '/exam-types/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examtype', 'edit'),
  AdminExaminationController.updateExamType
);
router.delete(
  '/exam-types/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examtype', 'delete'),
  AdminExaminationController.deleteExamType
);

// 4. Exam Subjects & Marks Configuration
router.get(
  '/exam-subjects',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examsubject', 'examination/examschedule', 'examination/examAttendance', 'examination/examResult'],
    'view'
  ),
  AdminExaminationController.getExamSubjectsList
);
router.get(
  '/exam-subjects/config',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examsubject', 'examination/examschedule', 'examination/examAttendance', 'examination/examResult'],
    'view'
  ),
  AdminExaminationController.getExamSubjectConfig
);
router.post(
  '/exam-subjects/config',
  rbacMiddleware(['Admin', 'Super Admin', 'Teacher'], 'examination/examsubject', 'add'),
  AdminExaminationController.saveExamSubjectConfig
);
router.delete(
  '/exam-subjects/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examsubject', 'delete'),
  AdminExaminationController.deleteExamSubject
);

// 5. Exam Schedules
router.get(
  '/schedules',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examschedule', 'examination/examAttendance', 'examination/examResult', 'records/admitcard'],
    'view'
  ),
  AdminExaminationController.getExamSchedules
);
router.get(
  '/exam-schedules',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examschedule', 'examination/examAttendance', 'examination/examResult', 'records/admitcard'],
    'view'
  ),
  AdminExaminationController.getExamSchedules
);
router.get(
  '/exam-schedule',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examschedule', 'examination/examAttendance', 'examination/examResult', 'records/admitcard'],
    'view'
  ),
  AdminExaminationController.getExamSchedules
);
router.get(
  '/schedules/:id',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examschedule', 'examination/examAttendance', 'examination/examResult', 'records/admitcard'],
    'view'
  ),
  AdminExaminationController.getExamScheduleById
);
router.get(
  '/exam-schedules/:id',
  rbacMiddleware(
    ['Admin', 'Super Admin', 'Teacher'],
    ['examination/examschedule', 'examination/examAttendance', 'examination/examResult', 'records/admitcard'],
    'view'
  ),
  AdminExaminationController.getExamScheduleById
);
router.post(
  '/schedules',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examschedule', 'add'),
  AdminExaminationController.createExamSchedule
);
router.post(
  '/exam-schedules',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examschedule', 'add'),
  AdminExaminationController.createExamSchedule
);
router.put(
  '/schedules/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examschedule', 'edit'),
  AdminExaminationController.updateExamSchedule
);
router.put(
  '/exam-schedules/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examschedule', 'edit'),
  AdminExaminationController.updateExamSchedule
);
router.delete(
  '/schedules/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examschedule', 'delete'),
  AdminExaminationController.deleteExamSchedule
);
router.delete(
  '/exam-schedules/:id',
  rbacMiddleware(['Admin', 'Super Admin'], 'examination/examschedule', 'delete'),
  AdminExaminationController.deleteExamSchedule
);

// 5. Exam Attendance
router.get(
  '/attendance',
  rbacMiddleware(['Admin', 'Super Admin', 'Teacher'], 'examination/examAttendance', 'view'),
  AdminExaminationController.getStudentsForExamAttendance
);
router.post(
  '/attendance',
  rbacMiddleware(['Admin', 'Super Admin', 'Teacher'], 'examination/examAttendance', 'add'),
  AdminExaminationController.saveExamAttendanceBatch
);

// 6. Exam Results / Marks
router.get(
  '/results',
  rbacMiddleware(['Admin', 'Super Admin', 'Teacher'], 'examination/examResult', 'view'),
  AdminExaminationController.getExamResultsList
);
router.get(
  '/results/student/:studentId',
  rbacMiddleware(['Admin', 'Super Admin', 'Teacher'], 'examination/examResult', 'view'),
  AdminExaminationController.getStudentMarksheet
);
router.post(
  '/results/save-marks',
  rbacMiddleware(['Admin', 'Super Admin', 'Teacher'], 'examination/examResult', 'add'),
  AdminExaminationController.saveStudentMarksBatch
);

// 7. A4 Portrait Marksheet PDF Generation & Student List
router.get(
  '/marksheet/students',
  AdminExaminationController.getMarksheetStudents
);
router.get(
  '/marksheet/pdf',
  AdminExaminationController.downloadMarksheetPdf
);
router.post(
  '/marksheet/pdf',
  AdminExaminationController.downloadMarksheetPdf
);
router.get(
  '/marksheet/pdf/:studentId',
  AdminExaminationController.downloadMarksheetPdf
);
router.get(
  '/results/student/:studentId/pdf',
  AdminExaminationController.downloadMarksheetPdf
);

// 8. A4 Portrait Admit Card PDF Generation
router.get(
  '/admitcard/pdf',
  AdminExaminationController.downloadAdmitCardPdf
);
router.post(
  '/admitcard/pdf',
  AdminExaminationController.downloadAdmitCardPdf
);
router.get(
  '/admitcard/pdf/:studentId',
  AdminExaminationController.downloadAdmitCardPdf
);

module.exports = router;
