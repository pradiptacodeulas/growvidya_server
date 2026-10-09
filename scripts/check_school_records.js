const { pool } = require('../config/db.config');

async function checkSchoolRecords() {
  const [classes] = await pool.query('SELECT id, school_id, branch_id, class_name, status FROM class_master WHERE school_id = 1 AND status != 4');
  console.log('Classes in School 1:');
  console.table(classes);

  const [sections] = await pool.query('SELECT id, school_id, branch_id, class_id, section_name, status FROM section_master WHERE school_id = 1 AND status != 4');
  console.log('Sections in School 1:');
  console.table(sections);

  const [students] = await pool.query('SELECT id, school_id, branch_id, admission_number, first_name, last_name, class, section, status FROM student_master WHERE school_id = 1 AND status != 4');
  console.log('Students in School 1:');
  console.table(students);

  const [fees] = await pool.query('SELECT id, school_id, branch_id, name, code, status FROM fee_components WHERE school_id = 1 AND status != 4');
  console.log('Fee Components in School 1:');
  console.table(fees);

  const [feeStructures] = await pool.query('SELECT id, school_id, branch_id, name, class_id, is_published, status FROM fee_structures WHERE school_id = 1 AND status != 4');
  console.log('Fee Structures in School 1:');
  console.table(feeStructures);

  await pool.end();
}

checkSchoolRecords();
