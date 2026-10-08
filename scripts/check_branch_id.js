const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db.config');

async function run() {
  const [tables] = await pool.execute('SHOW TABLES');
  const allTables = tables.map(t => Object.values(t)[0]);
  
  const tableColumns = {};
  for (const t of allTables) {
    const [cols] = await pool.execute('SHOW COLUMNS FROM ' + t);
    tableColumns[t] = cols.map(c => c.Field);
  }

  // 1. Identify all tables that have school_id but do NOT have branch_id
  const schoolTablesWithoutBranch = [];
  for (const t of allTables) {
    const cols = tableColumns[t] || [];
    if (cols.includes('school_id') && !cols.includes('branch_id')) {
      schoolTablesWithoutBranch.push(t);
    }
  }

  console.log(`\n=== 1. TABLES WITH school_id BUT NO branch_id (${schoolTablesWithoutBranch.length}) ===`);
  schoolTablesWithoutBranch.forEach(t => console.log('  - ' + t));

  // 2. Scan all models and controllers for table names
  const modelsDir = path.join(__dirname, '../models');
  const controllersDir = path.join(__dirname, '../controllers');

  const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));
  const controllerFiles = fs.readdirSync(controllersDir).filter(f => f.endsWith('.js'));

  console.log(`\n=== 2. SCANNING MODELS FOR REFERENCES TO THESE TABLES ===`);
  const tableUsage = {};

  for (const t of schoolTablesWithoutBranch) {
    tableUsage[t] = { models: [], controllers: [], insertMethods: [] };

    for (const mf of modelFiles) {
      const content = fs.readFileSync(path.join(modelsDir, mf), 'utf8');
      if (content.toLowerCase().includes(t.toLowerCase())) {
        tableUsage[t].models.push(mf);
        // Look for INSERT INTO <table>
        const insertRegex = new RegExp(`INSERT\\s+INTO\\s+[\`]?${t}[\`]?`, 'i');
        if (insertRegex.test(content)) {
          tableUsage[t].insertMethods.push(mf);
        }
      }
    }

    for (const cf of controllerFiles) {
      const content = fs.readFileSync(path.join(controllersDir, cf), 'utf8');
      if (content.toLowerCase().includes(t.toLowerCase())) {
        tableUsage[t].controllers.push(cf);
      }
    }
  }

  for (const [table, usage] of Object.entries(tableUsage)) {
    console.log(`\nTable: ${table}`);
    console.log(`  Models: ${usage.models.join(', ') || 'None'}`);
    console.log(`  Inserts in: ${usage.insertMethods.join(', ') || 'None'}`);
    console.log(`  Controllers: ${usage.controllers.join(', ') || 'None'}`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
