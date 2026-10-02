const { pool } = require('../config/db.config');

async function migrate() {
  try {
    console.log('Checking subscription_plans for max_teachers column...');
    const [cols] = await pool.query("SHOW COLUMNS FROM subscription_plans LIKE 'max_teachers'");
    if (cols.length > 0) {
      console.log('Dropping max_teachers column from subscription_plans...');
      await pool.query("ALTER TABLE subscription_plans DROP COLUMN max_teachers");
      console.log('Successfully dropped max_teachers column from subscription_plans!');
    } else {
      console.log('max_teachers column does not exist in subscription_plans.');
    }

    const [subCols] = await pool.query("SHOW COLUMNS FROM school_subscriptions LIKE 'max_teachers'");
    if (subCols.length > 0) {
      console.log('Dropping max_teachers column from school_subscriptions...');
      await pool.query("ALTER TABLE school_subscriptions DROP COLUMN max_teachers");
      console.log('Successfully dropped max_teachers column from school_subscriptions!');
    }

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
