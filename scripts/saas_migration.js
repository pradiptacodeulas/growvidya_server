const { pool } = require('../config/db.config');
const bcrypt = require('bcryptjs');

async function runMigration() {
  try {
    console.log('Running SaaS Admin database migrations...');

    // 1. saas_admin_users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saas_admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'superadmin',
        status TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('saas_admin_users table verified.');

    // Seed default SaaS Super Admin if none exists
    const [existingAdmin] = await pool.query('SELECT id FROM saas_admin_users WHERE email = ?', ['superadmin@growvidya.com']);
    if (existingAdmin.length === 0) {
      const hashedPass = await bcrypt.hash('Admin@1234', 10);
      await pool.query(
        'INSERT INTO saas_admin_users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
        ['GrowVidya Master Admin', 'superadmin@growvidya.com', hashedPass, 'superadmin', 1]
      );
      console.log('Default super admin created: superadmin@growvidya.com / Admin@1234');
    } else {
      console.log('Default super admin already exists.');
    }

    // 2. coupons
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        discount_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
        discount_value DECIMAL(10,2) NOT NULL,
        min_order_amount DECIMAL(10,2) DEFAULT 0.00,
        max_discount_amount DECIMAL(10,2) DEFAULT NULL,
        start_date DATE DEFAULT NULL,
        end_date DATE DEFAULT NULL,
        max_uses INT DEFAULT NULL,
        used_count INT DEFAULT 0,
        status TINYINT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('coupons table verified.');

    // Seed sample coupons
    const [existingCoupon] = await pool.query('SELECT id FROM coupons WHERE code = ?', ['WELCOME50']);
    if (existingCoupon.length === 0) {
      await pool.query(
        `INSERT INTO coupons (code, description, discount_type, discount_value, min_order_amount, max_discount_amount, start_date, end_date, max_uses, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['WELCOME50', 'Welcome 50% discount on first school registration', 'percentage', 50.00, 1000.00, 5000.00, '2026-01-01', '2027-12-31', 100, 1]
      );
      await pool.query(
        `INSERT INTO coupons (code, description, discount_type, discount_value, min_order_amount, start_date, end_date, max_uses, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['FLAT2000', 'Flat Rs. 2000 off on any annual package', 'fixed', 2000.00, 5000.00, '2026-01-01', '2027-12-31', 50, 1]
      );
      console.log('Sample coupons created: WELCOME50, FLAT2000');
    }

    // 3. coupon_usages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupon_usages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        coupon_id INT NOT NULL,
        school_id INT NOT NULL,
        subscription_id INT DEFAULT NULL,
        discount_amount DECIMAL(10,2) NOT NULL,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_coupon (coupon_id),
        INDEX idx_school (school_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('coupon_usages table verified.');

    // 4. Alter school_subscriptions to add coupon and verification columns if missing
    const [subCols] = await pool.query('DESCRIBE school_subscriptions');
    const colNames = subCols.map(c => c.Field);

    if (!colNames.includes('coupon_id')) {
      await pool.query('ALTER TABLE school_subscriptions ADD COLUMN coupon_id INT DEFAULT NULL AFTER payment_transaction_id');
      console.log('Added coupon_id to school_subscriptions.');
    }
    if (!colNames.includes('discount_amount')) {
      await pool.query('ALTER TABLE school_subscriptions ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0.00 AFTER coupon_id');
      console.log('Added discount_amount to school_subscriptions.');
    }
    if (!colNames.includes('original_amount')) {
      await pool.query('ALTER TABLE school_subscriptions ADD COLUMN original_amount DECIMAL(10,2) DEFAULT NULL AFTER discount_amount');
      console.log('Added original_amount to school_subscriptions.');
    }
    if (!colNames.includes('verification_notes')) {
      await pool.query('ALTER TABLE school_subscriptions ADD COLUMN verification_notes TEXT DEFAULT NULL AFTER status');
      console.log('Added verification_notes to school_subscriptions.');
    }
    if (!colNames.includes('verified_by')) {
      await pool.query('ALTER TABLE school_subscriptions ADD COLUMN verified_by INT DEFAULT NULL AFTER verification_notes');
      console.log('Added verified_by to school_subscriptions.');
    }
    if (!colNames.includes('verified_at')) {
      await pool.query('ALTER TABLE school_subscriptions ADD COLUMN verified_at DATETIME DEFAULT NULL AFTER verified_by');
      console.log('Added verified_at to school_subscriptions.');
    }

    console.log('All migrations executed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

runMigration();
