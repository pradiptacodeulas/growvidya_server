const { pool } = require('../config/db.config');
const fs = require('fs');
const path = require('path');

async function inspectSchema() {
  try {
    const [dbRows] = await pool.query('SELECT DATABASE() as db');
    const dbName = dbRows[0].db;
    console.log('Connected to database:', dbName);

    const [tables] = await pool.query(
      `SELECT TABLE_NAME, TABLE_ROWS 
       FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = ? 
       ORDER BY TABLE_NAME`,
      [dbName]
    );

    console.log('Total tables:', tables.length);

    const [columns] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [dbName]
    );

    const tableMap = {};
    for (const t of tables) {
      tableMap[t.TABLE_NAME] = {
        name: t.TABLE_NAME,
        approxRows: t.TABLE_ROWS,
        columns: [],
        hasSchoolId: false,
        hasBranchId: false
      };
    }

    for (const col of columns) {
      if (tableMap[col.TABLE_NAME]) {
        tableMap[col.TABLE_NAME].columns.push(col);
        if (col.COLUMN_NAME === 'school_id') tableMap[col.TABLE_NAME].hasSchoolId = true;
        if (col.COLUMN_NAME === 'branch_id') tableMap[col.TABLE_NAME].hasBranchId = true;
      }
    }

    const [indexes] = await pool.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [dbName]
    );

    const outPath = path.resolve(__dirname, '../../schema_audit.json');
    fs.writeFileSync(outPath, JSON.stringify({ tables: tableMap, indexes }, null, 2));
    console.log('Successfully written schema_audit.json to', outPath);

    // Summary output
    const withBoth = [];
    const withSchoolOnly = [];
    const withBranchOnly = [];
    const withNeither = [];

    for (const t of Object.values(tableMap)) {
      if (t.hasSchoolId && t.hasBranchId) withBoth.push(t.name);
      else if (t.hasSchoolId && !t.hasBranchId) withSchoolOnly.push(t.name);
      else if (!t.hasSchoolId && t.hasBranchId) withBranchOnly.push(t.name);
      else withNeither.push(t.name);
    }

    console.log('\n--- TABLES WITH BOTH school_id AND branch_id (' + withBoth.length + ') ---');
    console.log(withBoth.join(', '));

    console.log('\n--- TABLES WITH school_id ONLY (' + withSchoolOnly.length + ') ---');
    console.log(withSchoolOnly.join(', '));

    console.log('\n--- TABLES WITH branch_id ONLY (' + withBranchOnly.length + ') ---');
    console.log(withBranchOnly.join(', '));

    console.log('\n--- TABLES WITH NEITHER (' + withNeither.length + ') ---');
    console.log(withNeither.join(', '));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

inspectSchema();
