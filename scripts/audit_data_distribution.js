const { pool } = require('../config/db.config');
const fs = require('fs');

async function auditData() {
  const audit = JSON.parse(fs.readFileSync('../schema_audit.json', 'utf8'));
  const tablesWithBoth = [];

  for (const [name, t] of Object.entries(audit.tables)) {
    if (t.hasSchoolId && t.hasBranchId) {
      tablesWithBoth.push(name);
    }
  }

  console.log(`Checking data in ${tablesWithBoth.length} tables with school_id and branch_id...`);

  const report = [];

  for (const table of tablesWithBoth) {
    try {
      const [rows] = await pool.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN school_id IS NOT NULL THEN 1 ELSE 0 END) as with_school,
          SUM(CASE WHEN branch_id IS NOT NULL AND branch_id > 0 THEN 1 ELSE 0 END) as with_branch,
          SUM(CASE WHEN branch_id IS NULL OR branch_id = 0 THEN 1 ELSE 0 END) as null_or_zero_branch
        FROM \`${table}\`
      `);
      const r = rows[0];
      if (Number(r.total) > 0) {
        report.push({
          table,
          total: Number(r.total),
          with_school: Number(r.with_school),
          with_branch: Number(r.with_branch),
          null_or_zero_branch: Number(r.null_or_zero_branch)
        });
      }
    } catch (e) {
      console.error(`Error on table ${table}:`, e.message);
    }
  }

  console.table(report);
  await pool.end();
}

auditData();
