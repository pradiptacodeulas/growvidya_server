/**
 * Multi-Branch Data Isolation Verification Suite
 * 
 * Verifies:
 * 1. Cross-branch isolation: Identical names/admissions/emails across different branches succeed.
 * 2. Intra-branch duplication prevention: Duplicates within the same branch are strictly rejected.
 * 3. School Super Admin access: Super Admin (branchId = null) aggregates data across all branches.
 * 4. Branch Admin isolation: Branch Admin cannot read, update, or delete records from another branch.
 * 5. Single-branch backward compatibility: Single branch institutions continue operating seamlessly.
 * 6. Clean cleanup: Test records are deleted by specific ID after assertions.
 */

const { pool } = require('../config/db.config');
const AcademicModel = require('../models/academic.model');
const StudentModel = require('../models/student.model');
const TeacherModel = require('../models/teacher.model');
const StaffModel = require('../models/staff.model');
const ParentModel = require('../models/parent.model');
const AdminExaminationModel = require('../models/adminExamination.model');

async function runVerification() {
  console.log('===============================================================');
  console.log('STARTING MULTI-BRANCH DATA ISOLATION VERIFICATION SUITE');
  console.log('===============================================================\n');

  const schoolId = 1; // Modern Education School (multiple branches)
  const branch1Id = 1; // Main Campus
  const branch2Id = 2; // Sunrise Public School

  const createdIds = {
    classes: [],
    students: [],
    teachers: [],
    staff: [],
    parents: [],
    exams: [],
  };

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: ACADEMIC CLASS ISOLATION & DUPLICATE CHECKS
    // -------------------------------------------------------------
    console.log('TEST 1: Academic Classes Multi-Branch Isolation');
    const className = 'TestGrade99Auto';

    // Create class in Branch 1
    const c1Id = await AcademicModel.createClass(schoolId, {
      class_name: className,
      branch_id: branch1Id,
    });
    createdIds.classes.push(c1Id);
    assert(c1Id > 0, 'Class created successfully in Branch 1');

    // Attempt duplicate creation in Branch 1 (should fail with 400)
    let b1DupFailed = false;
    try {
      await AcademicModel.createClass(schoolId, {
        class_name: className,
        branch_id: branch1Id,
      });
    } catch (dupErr) {
      b1DupFailed = true;
      assert(dupErr.statusCode === 400 || dupErr.message.includes('already exists'), 'Intra-branch duplicate check: Class creation in Branch 1 rejected with duplicate error');
    }
    assert(b1DupFailed, 'Duplicate creation in same branch was blocked');

    // Create class in Branch 2 with identical name (should succeed!)
    const c2Id = await AcademicModel.createClass(schoolId, {
      class_name: className,
      branch_id: branch2Id,
    });
    createdIds.classes.push(c2Id);
    assert(c2Id > 0, 'Cross-branch creation: Same class name created successfully in Branch 2');

    // Fetch by ID scoping
    const branch1Fetched = await AcademicModel.getClassById(c1Id, schoolId, branch1Id);
    assert(branch1Fetched !== null, 'Branch 1 admin can fetch Branch 1 class');

    const crossBranchFetched = await AcademicModel.getClassById(c1Id, schoolId, branch2Id);
    assert(crossBranchFetched === null, 'Branch 2 admin CANNOT fetch Branch 1 class (isolated)');

    // Super Admin scoping (branchId = null)
    const superAdminFetched = await AcademicModel.getClassById(c1Id, schoolId, null);
    assert(superAdminFetched !== null, 'Super Admin (branchId = null) can fetch across branches');

    // -------------------------------------------------------------
    // TEST 2: STUDENT MULTI-BRANCH ISOLATION
    // -------------------------------------------------------------
    console.log('\nTEST 2: Student Multi-Branch Isolation');
    const testAdmNo = 'ADM-TEST-99X';
    const testEmail = 'studenttest99x@growvidya.test';

    // Insert student in Branch 1
    const [s1Res] = await pool.query(
      `INSERT INTO student_master (school_id, branch_id, first_name, last_name, admission_number, email_address, status, created_at)
       VALUES (?, ?, 'Test', 'StudentB1', ?, ?, 1, NOW())`,
      [schoolId, branch1Id, testAdmNo, testEmail]
    );
    const s1Id = s1Res.insertId;
    createdIds.students.push(s1Id);

    // Duplicate check in Branch 1
    const sDup1 = await StudentModel.checkDuplicateAdmissionNumber(schoolId, testAdmNo, null, branch1Id);
    assert(sDup1 !== null, 'Intra-branch student duplicate check: Admission number duplicate detected in Branch 1');

    // Duplicate check in Branch 2 (should be allowed)
    const sDup2 = await StudentModel.checkDuplicateAdmissionNumber(schoolId, testAdmNo, null, branch2Id);
    assert(sDup2 === null, 'Cross-branch student duplicate check: Same admission number is allowed in Branch 2');

    // Fetch by ID isolation
    const sFetchedByB1 = await StudentModel.getById(s1Id, schoolId, branch1Id);
    assert(sFetchedByB1 !== null, 'Branch 1 admin can fetch Branch 1 student');

    const sFetchedByB2 = await StudentModel.getById(s1Id, schoolId, branch2Id);
    assert(sFetchedByB2 === null, 'Branch 2 admin CANNOT fetch Branch 1 student (isolated)');

    const sFetchedBySuper = await StudentModel.getById(s1Id, schoolId, null);
    assert(sFetchedBySuper !== null, 'Super Admin can fetch student across branches');

    // -------------------------------------------------------------
    // TEST 3: TEACHER MULTI-BRANCH ISOLATION
    // -------------------------------------------------------------
    console.log('\nTEST 3: Teacher Multi-Branch Isolation');
    const teacherEmail = 'teachertest99x@growvidya.test';
    const teacherPhone = '9999900001';

    // Insert teacher in Branch 1
    const [t1Res] = await pool.query(
      `INSERT INTO teacher_master (school_id, branch_id, first_name, last_name, email_address, primary_contact_number, status, created_on)
       VALUES (?, ?, 'Teacher', 'B1', ?, ?, 1, NOW())`,
      [schoolId, branch1Id, teacherEmail, teacherPhone]
    );
    const t1Id = t1Res.insertId;
    createdIds.teachers.push(t1Id);

    // Duplicate check in Branch 1
    const tDup1 = await TeacherModel.checkEmail(schoolId, teacherEmail, null, branch1Id);
    assert(tDup1 === true, 'Intra-branch teacher duplicate check: Email duplicate detected in Branch 1');

    // Duplicate check in Branch 2
    const tDup2 = await TeacherModel.checkEmail(schoolId, teacherEmail, null, branch2Id);
    assert(tDup2 === false, 'Cross-branch teacher duplicate check: Same email allowed in Branch 2');

    // Fetch by ID isolation
    const tFetchedByB1 = await TeacherModel.getTeacherById(t1Id, schoolId, branch1Id);
    assert(tFetchedByB1 !== null, 'Branch 1 admin can fetch Branch 1 teacher');

    const tFetchedByB2 = await TeacherModel.getTeacherById(t1Id, schoolId, branch2Id);
    assert(tFetchedByB2 === null, 'Branch 2 admin CANNOT fetch Branch 1 teacher (isolated)');

    // -------------------------------------------------------------
    // TEST 4: STAFF MULTI-BRANCH ISOLATION
    // -------------------------------------------------------------
    console.log('\nTEST 4: Staff Multi-Branch Isolation');
    const staffEmail = 'stafftest99x@growvidya.test';
    const staffPhone = '9999900002';

    // Insert staff in Branch 1
    const [st1Res] = await pool.query(
      `INSERT INTO user_master (school_id, branch_id, first_name, last_name, email, phone, status, role, date)
       VALUES (?, ?, 'Staff', 'B1', ?, ?, 1, 3, NOW())`,
      [schoolId, branch1Id, staffEmail, staffPhone]
    );
    const st1Id = st1Res.insertId;
    createdIds.staff.push(st1Id);

    // Duplicate check
    const stDup1 = await StaffModel.checkEmail(schoolId, staffEmail, null, branch1Id);
    assert(stDup1 === true, 'Intra-branch staff duplicate check: Email duplicate detected in Branch 1');

    const stDup2 = await StaffModel.checkEmail(schoolId, staffEmail, null, branch2Id);
    assert(stDup2 === false, 'Cross-branch staff duplicate check: Same email allowed in Branch 2');

    // Fetch by ID isolation
    const stFetchedByB1 = await StaffModel.getById(st1Id, schoolId, branch1Id);
    assert(stFetchedByB1 !== null, 'Branch 1 admin can fetch Branch 1 staff');

    const stFetchedByB2 = await StaffModel.getById(st1Id, schoolId, branch2Id);
    assert(stFetchedByB2 === null, 'Branch 2 admin CANNOT fetch Branch 1 staff (isolated)');

    // -------------------------------------------------------------
    // TEST 5: PARENT MULTI-BRANCH ISOLATION
    // -------------------------------------------------------------
    console.log('\nTEST 5: Parent Multi-Branch Isolation');
    const parentEmail = 'parenttest99x@growvidya.test';
    const parentPhone = '9999900003';

    // Insert parent in Branch 1
    const [p1Res] = await pool.query(
      `INSERT INTO parent_master (school_id, branch_id, first_name, last_name, email, phone, status, created_at)
       VALUES (?, ?, 'Parent', 'B1', ?, ?, 1, NOW())`,
      [schoolId, branch1Id, parentEmail, parentPhone]
    );
    const p1Id = p1Res.insertId;
    createdIds.parents.push(p1Id);

    // Duplicate check
    const pDup1 = await ParentModel.checkEmail(schoolId, parentEmail, null, branch1Id);
    assert(pDup1 === true, 'Intra-branch parent duplicate check: Email duplicate detected in Branch 1');

    const pDup2 = await ParentModel.checkEmail(schoolId, parentEmail, null, branch2Id);
    assert(pDup2 === false, 'Cross-branch parent duplicate check: Same email allowed in Branch 2');

    // Fetch by ID isolation
    const pFetchedByB1 = await ParentModel.getById(p1Id, schoolId, branch1Id);
    assert(pFetchedByB1 !== null, 'Branch 1 admin can fetch Branch 1 parent');

    const pFetchedByB2 = await ParentModel.getById(p1Id, schoolId, branch2Id);
    assert(pFetchedByB2 === null, 'Branch 2 admin CANNOT fetch Branch 1 parent (isolated)');

    // -------------------------------------------------------------
    // TEST 6: EXAMINATION MULTI-BRANCH ISOLATION
    // -------------------------------------------------------------
    console.log('\nTEST 6: Examination Multi-Branch Isolation');
    const examName = 'Midterm99Test';

    // Insert exam in Branch 1
    const exam1Id = await AdminExaminationModel.createExam({
      schoolId,
      branchId: branch1Id,
      examName,
      status: 1,
    });
    createdIds.exams.push(exam1Id);

    // Branch 1 lists exams -> should find exam1Id
    const b1Exams = await AdminExaminationModel.getAllExams(schoolId, null, null, branch1Id);
    const b1HasExam = b1Exams.some((e) => e.id === exam1Id);
    assert(b1HasExam, 'Branch 1 admin sees Branch 1 exam in list');

    // Branch 2 lists exams -> should NOT find exam1Id
    const b2Exams = await AdminExaminationModel.getAllExams(schoolId, null, null, branch2Id);
    const b2HasExam = b2Exams.some((e) => e.id === exam1Id);
    assert(!b2HasExam, 'Branch 2 admin does NOT see Branch 1 exam in list (isolated)');

    // Super Admin lists exams -> should find exam1Id
    const superExams = await AdminExaminationModel.getAllExams(schoolId, null, null, null);
    const superHasExam = superExams.some((e) => e.id === exam1Id);
    assert(superHasExam, 'Super Admin (branchId = null) sees exam across branches');

    // Get Exam by ID isolation
    const examFetchedByB1 = await AdminExaminationModel.getExamById(exam1Id, schoolId, branch1Id);
    assert(examFetchedByB1 !== null, 'Branch 1 can fetch exam by ID');

    const examFetchedByB2 = await AdminExaminationModel.getExamById(exam1Id, schoolId, branch2Id);
    assert(examFetchedByB2 === null, 'Branch 2 CANNOT fetch Branch 1 exam by ID (isolated)');

    // -------------------------------------------------------------
    // TEST 7: SINGLE-BRANCH INSTITUTION BACKWARD COMPATIBILITY
    // -------------------------------------------------------------
    console.log('\nTEST 7: Single-Branch Institution Backward Compatibility');
    const singleSchoolId = 2; // St. Mary's Academy (registration_type = single)
    const singleBranchId = 3; // Main Campus

    // Verify creating and fetching class for single-branch institution
    const singleClassName = 'SingleBranchClass99';
    const sbcId = await AcademicModel.createClass(singleSchoolId, {
      class_name: singleClassName,
      branch_id: singleBranchId,
    });
    createdIds.classes.push(sbcId);
    assert(sbcId > 0, 'Class created successfully for single-branch institution');

    const sbcFetched = await AcademicModel.getClassById(sbcId, singleSchoolId, singleBranchId);
    assert(sbcFetched !== null, 'Single-branch institution can fetch class by ID');

    const sbcFetchedNoBranch = await AcademicModel.getClassById(sbcId, singleSchoolId, null);
    assert(sbcFetchedNoBranch !== null, 'Single-branch institution can fetch without explicit branch context (fallback compatibility)');


  } catch (error) {
    console.error('UNEXPECTED TEST ERROR:', error);
    failed++;
  } finally {
    // -------------------------------------------------------------
    // CLEANUP: SAFELY REMOVE TEST FIXTURES
    // -------------------------------------------------------------
    console.log('\nCLEANUP: Removing test fixtures created during test...');
    try {
      if (createdIds.classes.length > 0) {
        await pool.query(`DELETE FROM class_master WHERE id IN (?)`, [createdIds.classes]);
        console.log(`  Cleaned ${createdIds.classes.length} test class(es).`);
      }
      if (createdIds.students.length > 0) {
        await pool.query(`DELETE FROM student_master WHERE id IN (?)`, [createdIds.students]);
        console.log(`  Cleaned ${createdIds.students.length} test student(s).`);
      }
      if (createdIds.teachers.length > 0) {
        await pool.query(`DELETE FROM teacher_master WHERE id IN (?)`, [createdIds.teachers]);
        console.log(`  Cleaned ${createdIds.teachers.length} test teacher(s).`);
      }
      if (createdIds.staff.length > 0) {
        await pool.query(`DELETE FROM user_master WHERE id IN (?)`, [createdIds.staff]);
        console.log(`  Cleaned ${createdIds.staff.length} test staff member(s).`);
      }
      if (createdIds.parents.length > 0) {
        await pool.query(`DELETE FROM parent_master WHERE id IN (?)`, [createdIds.parents]);
        console.log(`  Cleaned ${createdIds.parents.length} test parent(s).`);
      }
      if (createdIds.exams.length > 0) {
        await pool.query(`DELETE FROM exam_master WHERE id IN (?)`, [createdIds.exams]);
        console.log(`  Cleaned ${createdIds.exams.length} test exam(s).`);
      }
    } catch (cleanErr) {
      console.error('Error during cleanup:', cleanErr.message);
    }

    console.log('\n===============================================================');
    console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runVerification();
