const { pool } = require('../config/db.config');

async function runSubscriptionItemsMigration() {
  try {
    console.log('--- Starting Subscription Plans & Items Migration ---');

    // 1. Ensure subscription_plans table exists and has updated_at column
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        plan_name VARCHAR(100) NOT NULL,
        plan_code VARCHAR(50) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        billing_cycle ENUM('monthly', 'quarterly', 'half_yearly', 'annual', 'trial') NOT NULL DEFAULT 'annual',
        max_students INT NOT NULL DEFAULT 0,
        max_teachers INT NOT NULL DEFAULT 0,
        status TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sub_plan_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure features_json is dropped if table existed previously
    try {
      const [colCheck] = await pool.query(`
        SELECT COLUMN_NAME FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_plans' AND COLUMN_NAME = 'features_json'
      `);
      if (colCheck.length > 0) {
        await pool.query('ALTER TABLE subscription_plans DROP COLUMN features_json');
        console.log('✓ Dropped obsolete features_json column from subscription_plans.');
      }
    } catch (e) {
      // Ignore error
    }

    // 2. Seed initial subscription plans if empty
    const [existingPlans] = await pool.query('SELECT COUNT(*) AS count FROM subscription_plans');
    if (existingPlans[0].count === 0) {
      console.log('Seeding initial default subscription plans...');
      const plans = [
        [
          1,
          'Starter Plan',
          'starter_annual',
          'Ideal for small schools and preschools getting started with digital school management.',
          2999.00,
          'annual',
          300,
          25,
          JSON.stringify({ attendance: true, routine: true, students: true, teachers: true, parents: true, basic_fees: true, certificates: true, transport: true, hostel: true, payroll: true }),
          1
        ],
        [
          2,
          'Growth Plan (Most Popular)',
          'growth_annual',
          'Comprehensive management suite for growing K-12 schools with transport and fee structures.',
          5999.00,
          'annual',
          1000,
          60,
          JSON.stringify({ attendance: true, routine: true, students: true, teachers: true, parents: true, advanced_fees: true, certificates: true, transport: true, examinations: true, hostel: true, payroll: true }),
          1
        ],
        [
          3,
          'Enterprise Plan',
          'enterprise_annual',
          'Full institutional suite with unlimited students, full payroll, hostel, transport, and priority support.',
          9999.00,
          'annual',
          0,
          0,
          JSON.stringify({ attendance: true, routine: true, students: true, teachers: true, parents: true, advanced_fees: true, certificates: true, transport: true, examinations: true, hostel: true, payroll: true, priority_support: true }),
          1
        ],
        [
          4,
          '14-Day Free Trial',
          'free_trial_14d',
          'Test the full platform with your teachers and staff free for 14 days. No payment required.',
          0.00,
          'trial',
          150,
          20,
          JSON.stringify({ attendance: true, routine: true, students: true, teachers: true, parents: true, basic_fees: true, certificates: true, transport: false, hostel: false, payroll: false }),
          1
        ]
      ];

      for (const p of plans) {
        await pool.query(
          `INSERT INTO subscription_plans 
           (id, plan_name, plan_code, description, price, billing_cycle, max_students, max_teachers, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[9]]
        );
      }
      console.log('✓ Seeded 4 subscription plans successfully.');
    } else {
      console.log(`subscription_plans already has ${existingPlans[0].count} records.`);
    }

    // 3. Create subscription_items child table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sub_id INT NOT NULL COMMENT 'FK referencing subscription_plans.id',
        item_name VARCHAR(150) NOT NULL COMMENT 'e.g. SMS Notifications, Push Notifications, RFID Module',
        item_code VARCHAR(50) DEFAULT NULL COMMENT 'e.g. SMS_ALERTS, PUSH_NOTIF, EMAIL_SVC, RFID_MODULE',
        item_type ENUM('included', 'addon', 'usage_based') NOT NULL DEFAULT 'included' 
          COMMENT 'included = bundled in base plan; addon = optional paid extra; usage_based = per unit',
        price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Item price in INR (0.00 if included)',
        quota_limit INT DEFAULT NULL COMMENT 'Volume limit (e.g. 5000 SMS), NULL for unlimited',
        unit VARCHAR(50) DEFAULT NULL COMMENT 'e.g. messages, credits, gb, licenses, flat',
        billing_type ENUM('recurring', 'one_time', 'per_unit') NOT NULL DEFAULT 'recurring',
        description VARCHAR(255) DEFAULT NULL,
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        display_order INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sub_item_plan (sub_id),
        INDEX idx_sub_item_status (status),
        CONSTRAINT fk_subscription_items_plan FOREIGN KEY (sub_id) 
          REFERENCES subscription_plans (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ subscription_items table verified/created.');

    // 4. Seed initial subscription items for plans if empty
    const [existingItems] = await pool.query('SELECT COUNT(*) AS count FROM subscription_items');
    if (existingItems[0].count === 0) {
      console.log('Seeding initial items and add-ons for subscription plans...');
      const items = [
        // Plan 1: Starter Plan (id: 1)
        [1, 'Push Notifications', 'PUSH_NOTIF', 'included', 0.00, 10000, 'notifications', 'recurring', 'In-app push notifications for student attendance and notices', 1, 1],
        [1, 'Email Notifications', 'EMAIL_ALERTS', 'included', 0.00, null, 'messages', 'recurring', 'Automated email alerts for report cards and fee receipts', 1, 2],
        [1, 'SMS Gateway Pack (5,000 SMS)', 'SMS_PACK_5K', 'addon', 1200.00, 5000, 'messages', 'recurring', 'DLT-registered transactional SMS alerts for parents', 1, 3],
        [1, 'RFID Attendance Module', 'RFID_MODULE', 'addon', 4999.00, 1, 'license', 'recurring', 'Automated RFID card tap tracking with gate reader integration', 1, 4],

        // Plan 2: Growth Plan (id: 2)
        [2, 'Push Notifications', 'PUSH_NOTIF', 'included', 0.00, 50000, 'notifications', 'recurring', 'High-speed instant push notifications for mobile app', 1, 1],
        [2, 'Email Notifications', 'EMAIL_ALERTS', 'included', 0.00, null, 'messages', 'recurring', 'Unlimited automated email notifications', 1, 2],
        [2, 'SMS Gateway Pack (10,000 SMS)', 'SMS_PACK_10K', 'included', 0.00, 10000, 'messages', 'recurring', '10,000 included transactional SMS credits per year', 1, 3],
        [2, 'RFID Attendance Module', 'RFID_MODULE', 'included', 0.00, 1, 'license', 'recurring', 'Full RFID card management and automated gate attendance', 1, 4],
        [2, 'Cloud Backup & 100GB Storage', 'STORAGE_100GB', 'addon', 1999.00, 100, 'gb', 'recurring', '100 GB expanded cloud storage for documents & marksheets', 1, 5],

        // Plan 3: Enterprise Plan (id: 3)
        [3, 'Push Notifications', 'PUSH_NOTIF', 'included', 0.00, null, 'notifications', 'recurring', 'Unlimited push notifications for all mobile app users', 1, 1],
        [3, 'Email Notifications', 'EMAIL_ALERTS', 'included', 0.00, null, 'messages', 'recurring', 'Unlimited email notifications and newsletter dispatches', 1, 2],
        [3, 'SMS Gateway Pack (25,000 SMS)', 'SMS_PACK_25K', 'included', 0.00, 25000, 'messages', 'recurring', '25,000 included transactional SMS credits', 1, 3],
        [3, 'RFID Attendance Module', 'RFID_MODULE', 'included', 0.00, 1, 'license', 'recurring', 'Unlimited RFID card management for students and staff', 1, 4],
        [3, 'Biometric & Turnstile Integration', 'BIOMETRIC_INTEG', 'included', 0.00, 1, 'license', 'recurring', 'Direct integration with biometric fingerprint & face terminals', 1, 5],
        [3, 'Cloud Backup & 250GB Storage', 'STORAGE_250GB', 'included', 0.00, 250, 'gb', 'recurring', '250 GB high-speed cloud document storage', 1, 6],
        [3, 'Custom School Domain & White-labeling', 'CUSTOM_DOMAIN', 'addon', 7500.00, 1, 'license', 'one_time', 'Custom portal domain (portal.yourschool.com) with branding', 1, 7],

        // Plan 4: 14-Day Free Trial (id: 4)
        [4, 'Push Notifications', 'PUSH_NOTIF', 'included', 0.00, 1000, 'notifications', 'recurring', '1,000 trial push notifications for demo testing', 1, 1],
        [4, 'Email Notifications', 'EMAIL_ALERTS', 'included', 0.00, 500, 'messages', 'recurring', '500 trial email alerts', 1, 2],
        [4, 'SMS Notification Pack', 'SMS_TRIAL_PACK', 'addon', 500.00, 500, 'messages', 'one_time', 'Optional 500 SMS credits during trial period', 1, 3]
      ];

      for (const item of items) {
        await pool.query(
          `INSERT INTO subscription_items 
           (sub_id, item_name, item_code, item_type, price, quota_limit, unit, billing_type, description, status, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          item
        );
      }
      console.log('✓ Seeded subscription items for all plans successfully.');
    } else {
      console.log(`subscription_items already contains ${existingItems[0].count} records.`);
    }

    const [allPlans] = await pool.query('SELECT id, plan_name, plan_code, price, billing_cycle, max_students, status FROM subscription_plans');
    console.log('--- Current Subscription Plans ---');
    console.table(allPlans);

    const [allItems] = await pool.query('SELECT id, sub_id, item_name, item_code, item_type, price, quota_limit, unit, status FROM subscription_items');
    console.log('--- Current Subscription Items ---');
    console.table(allItems);

    console.log('--- Subscription Plans & Items Migration Completed Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runSubscriptionItemsMigration();
