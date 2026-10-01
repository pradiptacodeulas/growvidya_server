const { pool } = require('../config/db.config');

async function migrate() {
  try {
    console.log('Altering school_subscriptions status column to support pending...');
    await pool.query(
      "ALTER TABLE school_subscriptions MODIFY COLUMN status ENUM('trial','active','expired','suspended','pending') DEFAULT 'pending'"
    );
    console.log('Successfully updated school_subscriptions.status to include pending!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
