const { pool } = require('../config/db.config');

async function run() {
  try {
    const [res] = await pool.query(
      "UPDATE user_device_tokens SET is_active = 0 WHERE role = 'parent' AND token LIKE 'ExponentPushToken%'"
    );
    console.log('Legacy Expo parent tokens deactivated count:', res.affectedRows);
  } catch (err) {
    console.warn('Database note:', err.message);
  }
  process.exit(0);
}

run();
