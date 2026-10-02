const { pool } = require('../config/db.config');

async function migrate() {
  try {
    console.log('Checking subscription_plans table schema...');
    const [cols] = await pool.query("SHOW COLUMNS FROM subscription_plans LIKE 'free_trial_days'");
    if (cols.length === 0) {
      console.log('Adding free_trial_days column to subscription_plans...');
      await pool.query(
        "ALTER TABLE subscription_plans ADD COLUMN free_trial_days INT NOT NULL DEFAULT 0 AFTER billing_cycle"
      );
      console.log('Successfully added free_trial_days to subscription_plans!');
    } else {
      console.log('free_trial_days column already exists in subscription_plans.');
    }

    console.log('Modifying subscription_items.description to TEXT...');
    await pool.query(
      "ALTER TABLE subscription_items MODIFY COLUMN description TEXT DEFAULT NULL"
    );
    console.log('Successfully modified subscription_items.description to TEXT!');

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
