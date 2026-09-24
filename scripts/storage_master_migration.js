const { pool } = require('../config/db.config');

async function createStorageMasterTable() {
  try {
    console.log('Creating storage_master table...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS storage_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        plan_name VARCHAR(100) NOT NULL,
        storage_capacity INT NOT NULL COMMENT 'Capacity quantity (e.g. 50, 100, 250, 500, 1024)',
        capacity_unit VARCHAR(10) NOT NULL DEFAULT 'GB' COMMENT 'Unit of storage (e.g. GB, TB, MB)',
        monthly_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Monthly price in INR',
        annual_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Annual price in INR',
        description TEXT DEFAULT NULL,
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_storage_status (status),
        INDEX idx_storage_capacity (storage_capacity)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('storage_master table verified/created successfully.');

    // Check if initial storage plans exist; if not, seed default tiers
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM storage_master');
    if (rows[0].count === 0) {
      console.log('Seeding initial storage master plans...');
      const plans = [
        ['50 GB Plan', 50, 'GB', 299.00, 2999.00, '50 GB additional cloud storage for documents, backups, and multimedia', 1],
        ['100 GB Plan', 100, 'GB', 499.00, 4999.00, '100 GB high-speed cloud storage for medium schools', 1],
        ['250 GB Plan', 250, 'GB', 999.00, 9999.00, '250 GB expanded cloud storage for large institutions', 1],
        ['500 GB Plan', 500, 'GB', 1799.00, 17999.00, '500 GB enterprise-grade cloud storage', 1],
        ['1 TB Plan', 1024, 'GB', 2999.00, 29999.00, '1 TB maximum enterprise storage plan', 1],
      ];

      for (const plan of plans) {
        await pool.query(
          `INSERT INTO storage_master (plan_name, storage_capacity, capacity_unit, monthly_price, annual_price, description, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          plan
        );
      }
      console.log('Initial storage plans seeded successfully.');
    } else {
      console.log(`storage_master already has ${rows[0].count} plans.`);
    }

    const [allPlans] = await pool.query('SELECT * FROM storage_master');
    console.log('Current storage plans:');
    console.table(allPlans);

    process.exit(0);
  } catch (error) {
    console.error('Error creating storage_master table:', error);
    process.exit(1);
  }
}

createStorageMasterTable();
