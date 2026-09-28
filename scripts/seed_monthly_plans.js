const { pool } = require('../config/db.config');

async function seedMonthlyPlans() {
  try {
    const monthlyPlans = [
      {
        plan_name: 'Starter Plan',
        plan_code: 'starter_monthly',
        description: 'Ideal for small schools and preschools getting started with monthly billing.',
        price: 299.00,
        billing_cycle: 'monthly',
        max_students: 300,
        max_teachers: 25,
        items: [
          { item_name: 'Push Notifications', item_code: 'PUSH_NOTIF', item_type: 'included', price: 0.00, quota_limit: 1000, unit: 'notifications' },
          { item_name: 'Email Notifications', item_code: 'EMAIL_ALERTS', item_type: 'included', price: 0.00, quota_limit: null, unit: 'messages' },
          { item_name: 'SMS Gateway Pack (500 SMS)', item_code: 'SMS_PACK_500', item_type: 'addon', price: 150.00, quota_limit: 500, unit: 'messages' },
          { item_name: 'RFID Attendance Module', item_code: 'RFID_MODULE', item_type: 'addon', price: 499.00, quota_limit: 1, unit: 'license' }
        ]
      },
      {
        plan_name: 'Growth Plan (Most Popular)',
        plan_code: 'growth_monthly',
        description: 'Comprehensive management suite for growing K-12 schools with transport and fees.',
        price: 599.00,
        billing_cycle: 'monthly',
        max_students: 1000,
        max_teachers: 60,
        items: [
          { item_name: 'Push Notifications', item_code: 'PUSH_NOTIF', item_type: 'included', price: 0.00, quota_limit: 5000, unit: 'notifications' },
          { item_name: 'Email Notifications', item_code: 'EMAIL_ALERTS', item_type: 'included', price: 0.00, quota_limit: null, unit: 'messages' },
          { item_name: 'SMS Gateway Pack (1,000 SMS)', item_code: 'SMS_PACK_1K', item_type: 'included', price: 0.00, quota_limit: 1000, unit: 'messages' },
          { item_name: 'RFID Attendance Module', item_code: 'RFID_MODULE', item_type: 'included', price: 0.00, quota_limit: 1, unit: 'license' },
          { item_name: 'Cloud Storage 50GB', item_code: 'STORAGE_50GB', item_type: 'addon', price: 299.00, quota_limit: 50, unit: 'gb' }
        ]
      },
      {
        plan_name: 'Enterprise Plan',
        plan_code: 'enterprise_monthly',
        description: 'Full institutional suite with unlimited students, full payroll, hostel, and priority support.',
        price: 999.00,
        billing_cycle: 'monthly',
        max_students: 0,
        max_teachers: 0,
        items: [
          { item_name: 'Push Notifications', item_code: 'PUSH_NOTIF', item_type: 'included', price: 0.00, quota_limit: null, unit: 'notifications' },
          { item_name: 'Email Notifications', item_code: 'EMAIL_ALERTS', item_type: 'included', price: 0.00, quota_limit: null, unit: 'messages' },
          { item_name: 'SMS Gateway Pack (2,500 SMS)', item_code: 'SMS_PACK_2500', item_type: 'included', price: 0.00, quota_limit: 2500, unit: 'messages' },
          { item_name: 'RFID Attendance Module', item_code: 'RFID_MODULE', item_type: 'included', price: 0.00, quota_limit: 1, unit: 'license' },
          { item_name: 'Biometric & Turnstile Integration', item_code: 'BIOMETRIC_INTEG', item_type: 'included', price: 0.00, quota_limit: 1, unit: 'license' },
          { item_name: 'Cloud Storage 100GB', item_code: 'STORAGE_100GB', item_type: 'included', price: 0.00, quota_limit: 100, unit: 'gb' },
          { item_name: 'Custom School Domain & White-labeling', item_code: 'CUSTOM_DOMAIN', item_type: 'addon', price: 999.00, quota_limit: 1, unit: 'license' }
        ]
      }
    ];

    for (const p of monthlyPlans) {
      const [existing] = await pool.query('SELECT id FROM subscription_plans WHERE plan_code = ?', [p.plan_code]);
      let planId;
      if (existing.length === 0) {
        const [res] = await pool.query(
          'INSERT INTO subscription_plans (plan_name, plan_code, description, price, billing_cycle, max_students, max_teachers, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())',
          [p.plan_name, p.plan_code, p.description, p.price, p.billing_cycle, p.max_students, p.max_teachers]
        );
        planId = res.insertId;
        console.log('✓ Inserted monthly plan:', p.plan_name, 'ID:', planId);
      } else {
        planId = existing[0].id;
        console.log('Plan already exists:', p.plan_name, 'ID:', planId);
      }

      // Insert items
      for (let i = 0; i < p.items.length; i++) {
        const it = p.items[i];
        const [itemExist] = await pool.query('SELECT id FROM subscription_items WHERE sub_id = ? AND item_code = ?', [planId, it.item_code]);
        if (itemExist.length === 0) {
          await pool.query(
            'INSERT INTO subscription_items (sub_id, item_name, item_code, item_type, price, quota_limit, unit, billing_type, status, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, "recurring", 1, ?)',
            [planId, it.item_name, it.item_code, it.item_type, it.price, it.quota_limit, it.unit, i + 1]
          );
        }
      }
    }

    const [all] = await pool.query('SELECT id, plan_name, plan_code, price, billing_cycle FROM subscription_plans WHERE status = 1');
    console.table(all);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding monthly plans:', err);
    process.exit(1);
  }
}

seedMonthlyPlans();
