const { pool } = require('../config/db.config');

const tablesToAdd = [
  'subject_master',
  'document_type_master',
  'lession_master',
  'assignment_types',
  'assignment_questions',
  'assignment_answers',
  'material_types',
  'grade_settings',
  'exam_master',
  'exam_type_master',
  'exam_subject_master',
  'exam_subject_marks',
  'exam_attendance',
  'exam_result',
  'exam_result_subject',
  'fee_structure_components',
  'student_fee_allocations',
  'fee_invoice_items',
  'notice_message',
  'certificate_border_master',
  'user_device_tokens',
  'weekends',
  'leaves_date',
  'leave_master',
  'religion_master',
  'mother_tongue_master',
  'student_category_master',
  'parent_master',
  'student_to_parent',
  'parent_master_address',
  'teacher_bank',
  'user_bank',
  'user_transport',
  'user_hostel',
  'user_document',
  'student_hostel',
  'student_medical_history',
  'previous_school_address',
  'student_document',
  'student_address',
  'teacher_address',
  'teacher_class_assign',
  'teacher_payroll',
  'teacher_transport',
  'teacher_hostel',
  'teacher_social_link',
  'teacher_document',
  'bus_to_operator',
  'student_assignment_attempts',
  'student_assignment_submissions',
  'assesment',
  'assesment_master',
  'sibilings',
  'student_class',
  'trans_pickup_master',
  'trans_vehicle_master'
];

async function migrate() {
  console.log('--- STARTING ADDITIVE branch_id MIGRATION ---');

  for (const table of tablesToAdd) {
    try {
      const [cols] = await pool.execute(`SHOW COLUMNS FROM \`${table}\``);
      const colNames = cols.map(c => c.Field);

      if (colNames.includes('branch_id')) {
        console.log(`[ALREADY EXISTS] ${table}.branch_id`);
      } else {
        const afterClause = colNames.includes('school_id') ? 'AFTER `school_id`' : '';
        const alterSql = `ALTER TABLE \`${table}\` ADD COLUMN \`branch_id\` INT(11) NULL DEFAULT NULL ${afterClause}`;
        await pool.execute(alterSql);

        // Add index on branch_id
        try {
          await pool.execute(`ALTER TABLE \`${table}\` ADD INDEX \`idx_${table}_branch_id\` (\`branch_id\`)`);
        } catch (_) {}

        console.log(`[ADDED] ${table}.branch_id`);
      }
    } catch (err) {
      console.error(`[ERROR] Table ${table}:`, err.message);
    }
  }

  console.log('\n--- BACKFILLING branch_id FROM REAL EXISTING RELATIONSHIPS (NO DUMMY/STATIC DATA) ---');

  const backfillQueries = [
    // Student child tables -> from student_master.branch_id
    `UPDATE student_address sa JOIN student_master sm ON sa.student_id = sm.id SET sa.branch_id = sm.branch_id WHERE sa.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE student_document sd JOIN student_master sm ON sd.student_id = sm.id SET sd.branch_id = sm.branch_id WHERE sd.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE student_hostel sh JOIN student_master sm ON sh.student_id = sm.id SET sh.branch_id = sm.branch_id WHERE sh.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE student_medical_history smh JOIN student_master sm ON smh.student_id = sm.id SET smh.branch_id = sm.branch_id WHERE smh.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE previous_school_address psa JOIN student_master sm ON psa.student_id = sm.id SET psa.branch_id = sm.branch_id WHERE psa.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE student_to_parent stp JOIN student_master sm ON stp.student_id = sm.id SET stp.branch_id = sm.branch_id WHERE stp.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE student_fee_allocations sfa JOIN student_master sm ON sfa.student_id = sm.id SET sfa.branch_id = sm.branch_id WHERE sfa.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE student_assignment_attempts saa JOIN student_master sm ON saa.student_id = sm.id SET saa.branch_id = sm.branch_id WHERE saa.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE student_assignment_submissions sas JOIN student_master sm ON sas.student_id = sm.id SET sas.branch_id = sm.branch_id WHERE sas.branch_id IS NULL AND sm.branch_id IS NOT NULL`,

    // Parent master & address -> from student_to_parent / student_master.branch_id
    `UPDATE parent_master pm JOIN student_to_parent stp ON pm.id = stp.parent_id JOIN student_master sm ON stp.student_id = sm.id SET pm.branch_id = sm.branch_id WHERE pm.branch_id IS NULL AND sm.branch_id IS NOT NULL`,
    `UPDATE parent_master_address pma JOIN parent_master pm ON pma.parent_id = pm.id SET pma.branch_id = pm.branch_id WHERE pma.branch_id IS NULL AND pm.branch_id IS NOT NULL`,

    // Teacher child tables -> from teacher_master.branch_id
    `UPDATE teacher_address ta JOIN teacher_master tm ON ta.teacher_id = tm.id SET ta.branch_id = tm.branch_id WHERE ta.branch_id IS NULL AND tm.branch_id IS NOT NULL`,
    `UPDATE teacher_bank tb JOIN teacher_master tm ON tb.teacher_id = tm.id SET tb.branch_id = tm.branch_id WHERE tb.branch_id IS NULL AND tm.branch_id IS NOT NULL`,
    `UPDATE teacher_class_assign tca JOIN teacher_master tm ON tca.teacher_id = tm.id SET tca.branch_id = tm.branch_id WHERE tca.branch_id IS NULL AND tm.branch_id IS NOT NULL`,
    `UPDATE teacher_payroll tp JOIN teacher_master tm ON tp.teacher_id = tm.id SET tp.branch_id = tm.branch_id WHERE tp.branch_id IS NULL AND tm.branch_id IS NOT NULL`,
    `UPDATE teacher_transport tt JOIN teacher_master tm ON tt.teacher_id = tm.id SET tt.branch_id = tm.branch_id WHERE tt.branch_id IS NULL AND tm.branch_id IS NOT NULL`,
    `UPDATE teacher_hostel th JOIN teacher_master tm ON th.teacher_id = tm.id SET th.branch_id = tm.branch_id WHERE th.branch_id IS NULL AND tm.branch_id IS NOT NULL`,
    `UPDATE teacher_social_link tsl JOIN teacher_master tm ON tsl.teacher_id = tm.id SET tsl.branch_id = tm.branch_id WHERE tsl.branch_id IS NULL AND tm.branch_id IS NOT NULL`,
    `UPDATE teacher_document td JOIN teacher_master tm ON td.teacher_id = tm.id SET td.branch_id = tm.branch_id WHERE td.branch_id IS NULL AND tm.branch_id IS NOT NULL`,

    // Staff child tables -> from user_master.branch_id
    `UPDATE user_bank ub JOIN user_master um ON ub.user_id = um.id SET ub.branch_id = um.branch_id WHERE ub.branch_id IS NULL AND um.branch_id IS NOT NULL`,
    `UPDATE user_transport ut JOIN user_master um ON ut.user_id = um.id SET ut.branch_id = um.branch_id WHERE ut.branch_id IS NULL AND um.branch_id IS NOT NULL`,
    `UPDATE user_hostel uh JOIN user_master um ON uh.user_id = um.id SET uh.branch_id = um.branch_id WHERE uh.branch_id IS NULL AND um.branch_id IS NOT NULL`,
    `UPDATE user_document ud JOIN user_master um ON ud.user_id = um.id SET ud.branch_id = um.branch_id WHERE ud.branch_id IS NULL AND um.branch_id IS NOT NULL`,
    `UPDATE user_device_tokens udt JOIN user_master um ON udt.user_id = um.id SET udt.branch_id = um.branch_id WHERE udt.branch_id IS NULL AND um.branch_id IS NOT NULL`,

    // Fee sub-tables -> from parent fee tables
    `UPDATE fee_structure_components fsc JOIN fee_structures fs ON fsc.fee_structure_id = fs.id SET fsc.branch_id = fs.branch_id WHERE fsc.branch_id IS NULL AND fs.branch_id IS NOT NULL`,
    `UPDATE fee_invoice_items fii JOIN fee_invoices fi ON fii.invoice_id = fi.id SET fii.branch_id = fi.branch_id WHERE fii.branch_id IS NULL AND fi.branch_id IS NOT NULL`,

    // Notice message -> from notice
    `UPDATE notice_message nm JOIN notice n ON nm.notice_id = n.id SET nm.branch_id = n.branch_id WHERE nm.branch_id IS NULL AND n.branch_id IS NOT NULL`,

    // Bus operator -> from bus_master
    `UPDATE bus_to_operator bto JOIN bus_master bm ON bto.bus_id = bm.id SET bto.branch_id = bm.branch_id WHERE bto.branch_id IS NULL AND bm.branch_id IS NOT NULL`,

    // Exam results -> from exam_schedule
    `UPDATE exam_result er JOIN exam_schedule es ON er.exam_schedule_id = es.id SET er.branch_id = es.branch_id WHERE er.branch_id IS NULL AND es.branch_id IS NOT NULL`,
    `UPDATE exam_result_subject ers JOIN exam_result er ON ers.exam_result_id = er.id SET ers.branch_id = er.branch_id WHERE ers.branch_id IS NULL AND er.branch_id IS NOT NULL`,
    `UPDATE exam_attendance ea JOIN exam_schedule es ON ea.exam_schedule_id = es.id SET ea.branch_id = es.branch_id WHERE ea.branch_id IS NULL AND es.branch_id IS NOT NULL`,
    `UPDATE exam_master em JOIN exam_schedule es ON em.id = es.exam_id SET em.branch_id = es.branch_id WHERE em.branch_id IS NULL AND es.branch_id IS NOT NULL`,
    `UPDATE exam_subject_master esm JOIN exam_schedule es ON esm.id = es.exam_subject_id SET esm.branch_id = es.branch_id WHERE esm.branch_id IS NULL AND es.branch_id IS NOT NULL`,

    // Leave date -> from leaves
    `UPDATE leaves_date ld JOIN leaves l ON ld.leave_id = l.id SET ld.branch_id = l.branch_id WHERE ld.branch_id IS NULL AND l.branch_id IS NOT NULL`
  ];

  for (const q of backfillQueries) {
    try {
      const [res] = await pool.execute(q);
      if (res.affectedRows > 0) {
        console.log(`[BACKFILLED] ${res.affectedRows} rows via relationship query.`);
      }
    } catch (e) {
      console.warn(`[BACKFILL SKIP]:`, e.message);
    }
  }

  console.log('\n--- MIGRATION COMPLETED SUCCESSFULLY ---');
  process.exit(0);
}

migrate().catch(e => {
  console.error('Fatal migration error:', e);
  process.exit(1);
});
