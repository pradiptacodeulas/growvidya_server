const { pool } = require('../config/db.config');

async function migrateCapacityUnit() {
  try {
    console.log('--- Starting Capacity Unit Master Migration ---');

    // 1. Create capacity_unit_master table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS capacity_unit_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        unit_name VARCHAR(50) NOT NULL COMMENT 'e.g., Gigabyte, Terabyte, Megabyte',
        unit_code VARCHAR(20) NOT NULL UNIQUE COMMENT 'e.g., GB, TB, MB',
        factor_in_mb BIGINT UNSIGNED NOT NULL DEFAULT 1024 COMMENT 'Value in MB for mathematical conversion',
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_unit_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('capacity_unit_master table verified/created.');

    // 2. Seed initial units (MB, GB, TB)
    const initialUnits = [
      ['Megabyte', 'MB', 1],
      ['Gigabyte', 'GB', 1024],
      ['Terabyte', 'TB', 1048576],
    ];

    for (const [name, code, factor] of initialUnits) {
      const [existing] = await pool.query('SELECT id FROM capacity_unit_master WHERE unit_code = ?', [code]);
      if (existing.length === 0) {
        await pool.query(
          'INSERT INTO capacity_unit_master (unit_name, unit_code, factor_in_mb, status) VALUES (?, ?, ?, 1)',
          [name, code, factor]
        );
        console.log(`Seeded unit: ${code} (${name})`);
      }
    }

    // Get default GB id
    const [gbRow] = await pool.query('SELECT id FROM capacity_unit_master WHERE unit_code = "GB" LIMIT 1');
    const defaultGbId = gbRow[0].id;

    // 3. Inspect storage_master columns
    const [cols] = await pool.query('DESCRIBE storage_master');
    const colNames = cols.map(c => c.Field);

    // Add capacity_unit_id if missing
    if (!colNames.includes('capacity_unit_id')) {
      await pool.query('ALTER TABLE storage_master ADD COLUMN capacity_unit_id INT DEFAULT NULL AFTER storage_capacity');
      console.log('Added column capacity_unit_id to storage_master.');
    }

    // Populate capacity_unit_id from existing capacity_unit varchar if present
    if (colNames.includes('capacity_unit')) {
      await pool.query(`
        UPDATE storage_master sm
        JOIN capacity_unit_master cu ON sm.capacity_unit = cu.unit_code
        SET sm.capacity_unit_id = cu.id
      `);
      // Fallback any remaining nulls to GB
      await pool.query('UPDATE storage_master SET capacity_unit_id = ? WHERE capacity_unit_id IS NULL', [defaultGbId]);
      console.log('Populated capacity_unit_id from capacity_unit values.');

      // Drop old capacity_unit VARCHAR column
      await pool.query('ALTER TABLE storage_master DROP COLUMN capacity_unit');
      console.log('Dropped legacy capacity_unit VARCHAR column from storage_master.');
    } else {
      await pool.query('UPDATE storage_master SET capacity_unit_id = ? WHERE capacity_unit_id IS NULL', [defaultGbId]);
    }

    // Set capacity_unit_id to NOT NULL
    await pool.query('ALTER TABLE storage_master MODIFY COLUMN capacity_unit_id INT NOT NULL');
    console.log('Updated capacity_unit_id to NOT NULL.');

    // Add foreign key constraint if not already exists
    const [fkRows] = await pool.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_NAME = 'storage_master' AND CONSTRAINT_NAME = 'fk_storage_capacity_unit'
    `);

    if (fkRows.length === 0) {
      await pool.query(`
        ALTER TABLE storage_master
        ADD CONSTRAINT fk_storage_capacity_unit
        FOREIGN KEY (capacity_unit_id) REFERENCES capacity_unit_master(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;
      `);
      console.log('Added foreign key constraint fk_storage_capacity_unit.');
    }

    // Verify resulting structure and data
    console.log('\n--- Capacity Unit Master Records ---');
    const [units] = await pool.query('SELECT * FROM capacity_unit_master');
    console.table(units);

    console.log('\n--- Storage Master with Foreign Key ---');
    const [plans] = await pool.query(`
      SELECT sm.id, sm.plan_name, sm.storage_capacity, sm.capacity_unit_id,
             cu.unit_code, cu.unit_name, sm.monthly_price, sm.annual_price, sm.status
      FROM storage_master sm
      JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
    `);
    console.table(plans);

    console.log('\nMigration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateCapacityUnit();
