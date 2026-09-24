const { pool } = require('../config/db.config');
const bcrypt = require('bcryptjs');

async function runMigration() {
  try {
    console.log('Running SaaS Admin database migrations...');

    // 1. saas_admin_users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saas_admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        first_name VARCHAR(100) DEFAULT NULL,
        last_name VARCHAR(100) DEFAULT NULL,
        gender INT DEFAULT NULL,
        profile_image VARCHAR(255) DEFAULT NULL,
        phone_number VARCHAR(30) DEFAULT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'superadmin',
        status TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_saas_admin_users_gender FOREIGN KEY (gender) REFERENCES gender_master(id) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure gender column is INT and references gender_master if table already existed
    try {
      await pool.query(`
        UPDATE saas_admin_users
        SET gender = CASE 
          WHEN LOWER(TRIM(gender)) = 'male' OR gender = '1' THEN '1'
          WHEN LOWER(TRIM(gender)) = 'female' OR gender = '2' THEN '2'
          WHEN LOWER(TRIM(gender)) IN ('other', 'others') OR gender = '3' THEN '3'
          ELSE NULL
        END
        WHERE gender IS NOT NULL AND gender REGEXP '^[a-zA-Z]+$'
      `);
      await pool.query('ALTER TABLE saas_admin_users MODIFY COLUMN gender INT DEFAULT NULL');
      const [fks] = await pool.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.TABLE_CONSTRAINTS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'saas_admin_users' 
          AND CONSTRAINT_NAME = 'fk_saas_admin_users_gender'
      `);
      if (fks.length === 0) {
        await pool.query('ALTER TABLE saas_admin_users ADD CONSTRAINT fk_saas_admin_users_gender FOREIGN KEY (gender) REFERENCES gender_master(id) ON DELETE SET NULL ON UPDATE CASCADE');
      }
    } catch (e) {
      // Column or constraint may already be up to date
    }
    console.log('saas_admin_users table verified.');

    // 1b. saas_roles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saas_roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role_name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        is_system TINYINT(1) NOT NULL DEFAULT 0,
        status TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 1c. saas_modules table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saas_modules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        module_key VARCHAR(50) NOT NULL UNIQUE,
        module_name VARCHAR(100) NOT NULL,
        description VARCHAR(255) DEFAULT NULL,
        display_order INT DEFAULT 0,
        status TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 1d. saas_role_permissions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saas_role_permissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role_id INT NOT NULL,
        module_key VARCHAR(50) NOT NULL,
        can_view TINYINT(1) NOT NULL DEFAULT 0,
        can_add TINYINT(1) NOT NULL DEFAULT 0,
        can_edit TINYINT(1) NOT NULL DEFAULT 0,
        can_delete TINYINT(1) NOT NULL DEFAULT 0,
        can_manage TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_saas_role_perm_role FOREIGN KEY (role_id) REFERENCES saas_roles(id) ON DELETE CASCADE,
        UNIQUE KEY uq_saas_role_module (role_id, module_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Add role_id to saas_admin_users if missing
    try {
      const [cols] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_admin_users' AND COLUMN_NAME = 'role_id'
      `);
      if (cols.length === 0) {
        await pool.query('ALTER TABLE saas_admin_users ADD COLUMN role_id INT DEFAULT NULL AFTER role');
        await pool.query('ALTER TABLE saas_admin_users ADD CONSTRAINT fk_saas_admin_users_role FOREIGN KEY (role_id) REFERENCES saas_roles(id) ON DELETE SET NULL ON UPDATE CASCADE');
        console.log('Added role_id to saas_admin_users.');
      }
    } catch (e) {
      // Constraint or column may already exist
    }

    // Seed default SaaS modules
    const modules = [
      { key: 'dashboard', name: 'Dashboard & Analytics', desc: 'Overview metrics, registration statistics, revenue', order: 1 },
      { key: 'schools', name: 'School Management', desc: 'Registered schools, approvals, school status', order: 2 },
      { key: 'subscriptions', name: 'Subscriptions & Payments', desc: 'School subscriptions, manual payment verification, extensions', order: 3 },
      { key: 'packages', name: 'Packages & Plans', desc: 'Subscription pricing tiers, features, plan limits', order: 4 },
      { key: 'coupons', name: 'Coupon Management', desc: 'Promo codes, discounts, redemption limits', order: 5 },
      { key: 'storage_plans', name: 'Storage Plans', desc: 'Storage add-on packages and capacity units', order: 6 },
      { key: 'roles', name: 'Roles & Permissions', desc: 'Manage SaaS roles and granular module permissions', order: 7 },
      { key: 'sub_admins', name: 'Sub Admin Users', desc: 'Manage sub-admin staff accounts and role assignments', order: 8 },
    ];

    for (const m of modules) {
      await pool.query(`
        INSERT INTO saas_modules (module_key, module_name, description, display_order, status)
        VALUES (?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE module_name = VALUES(module_name), description = VALUES(description), display_order = VALUES(display_order)
      `, [m.key, m.name, m.desc, m.order]);
    }

    // Seed default Super Admin system role
    const [superAdminRole] = await pool.query('SELECT id FROM saas_roles WHERE role_name = ?', ['Super Admin']);
    let superAdminRoleId;
    if (superAdminRole.length === 0) {
      const [res] = await pool.query(
        'INSERT INTO saas_roles (role_name, description, is_system, status) VALUES (?, ?, 1, 1)',
        ['Super Admin', 'Full unrestricted platform access to all modules and settings']
      );
      superAdminRoleId = res.insertId;
    } else {
      superAdminRoleId = superAdminRole[0].id;
    }

    // Ensure Super Admin has all permissions on all modules
    for (const m of modules) {
      await pool.query(`
        INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
        VALUES (?, ?, 1, 1, 1, 1, 1)
        ON DUPLICATE KEY UPDATE can_view = 1, can_add = 1, can_edit = 1, can_delete = 1, can_manage = 1
      `, [superAdminRoleId, m.key]);
    }

    // Seed default Operations Manager role (Sub Admin template)
    const [opsRole] = await pool.query('SELECT id FROM saas_roles WHERE role_name = ?', ['Operations Manager']);
    let opsRoleId;
    if (opsRole.length === 0) {
      const [res] = await pool.query(
        'INSERT INTO saas_roles (role_name, description, is_system, status) VALUES (?, ?, 0, 1)',
        ['Operations Manager', 'Can manage schools, subscriptions, coupons, and storage plans']
      );
      opsRoleId = res.insertId;

      const opsPerms = [
        { key: 'dashboard', view: 1, add: 0, edit: 0, del: 0, manage: 0 },
        { key: 'schools', view: 1, add: 1, edit: 1, del: 0, manage: 1 },
        { key: 'subscriptions', view: 1, add: 1, edit: 1, del: 0, manage: 1 },
        { key: 'packages', view: 1, add: 0, edit: 0, del: 0, manage: 0 },
        { key: 'coupons', view: 1, add: 1, edit: 1, del: 1, manage: 1 },
        { key: 'storage_plans', view: 1, add: 0, edit: 0, del: 0, manage: 0 },
        { key: 'roles', view: 0, add: 0, edit: 0, del: 0, manage: 0 },
        { key: 'sub_admins', view: 0, add: 0, edit: 0, del: 0, manage: 0 },
      ];
      for (const p of opsPerms) {
        await pool.query(`
          INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_add = VALUES(can_add), can_edit = VALUES(can_edit), can_delete = VALUES(can_delete), can_manage = VALUES(can_manage)
        `, [opsRoleId, p.key, p.view, p.add, p.edit, p.del, p.manage]);
      }
    }

    // Seed default SaaS Super Admin if none exists
    const [existingAdmin] = await pool.query('SELECT id FROM saas_admin_users WHERE email = ?', ['superadmin@growvidya.com']);
    if (existingAdmin.length === 0) {
      const hashedPass = await bcrypt.hash('Admin@1234', 10);
      await pool.query(
        'INSERT INTO saas_admin_users (first_name, last_name, email, password, role, role_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['Super', 'Administrator', 'superadmin@growvidya.com', hashedPass, 'superadmin', superAdminRoleId, 1]
      );
      console.log('Default super admin created: superadmin@growvidya.com / Admin@1234');
    } else {
      await pool.query(
        'UPDATE saas_admin_users SET role_id = ? WHERE id = ? AND (role_id IS NULL OR role_id = 0)',
        [superAdminRoleId, existingAdmin[0].id]
      );
      console.log('Default super admin already exists and linked to Super Admin role.');
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

    // 4. capacity_unit_master
    await pool.query(`
      CREATE TABLE IF NOT EXISTS capacity_unit_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        unit_name VARCHAR(50) NOT NULL,
        unit_code VARCHAR(20) NOT NULL UNIQUE,
        factor_in_mb BIGINT UNSIGNED NOT NULL DEFAULT 1024,
        status TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_unit_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('capacity_unit_master table verified.');

    // Seed default capacity units if none exist
    const [existingUnits] = await pool.query('SELECT id FROM capacity_unit_master LIMIT 1');
    if (existingUnits.length === 0) {
      await pool.query(`
        INSERT INTO capacity_unit_master (unit_name, unit_code, factor_in_mb, status)
        VALUES 
          ('Megabyte', 'MB', 1, 1),
          ('Gigabyte', 'GB', 1024, 1),
          ('Terabyte', 'TB', 1048576, 1)
      `);
      console.log('Default capacity units seeded (MB, GB, TB).');
    }

    // 5. storage_master
    await pool.query(`
      CREATE TABLE IF NOT EXISTS storage_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        plan_name VARCHAR(100) NOT NULL,
        storage_capacity INT NOT NULL COMMENT 'Storage capacity value',
        capacity_unit_id INT NOT NULL COMMENT 'Foreign key to capacity_unit_master.id',
        monthly_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        annual_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        description TEXT DEFAULT NULL,
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_storage_status (status),
        INDEX idx_storage_capacity (storage_capacity),
        CONSTRAINT fk_storage_capacity_unit FOREIGN KEY (capacity_unit_id) 
          REFERENCES capacity_unit_master(id) ON UPDATE CASCADE ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('storage_master table verified.');

    // 6. Alter school_subscriptions to add coupon and verification columns if missing
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
