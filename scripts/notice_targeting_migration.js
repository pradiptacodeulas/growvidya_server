const { pool } = require('../config/db.config');

async function runNoticeTargetingMigration() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM notice LIKE 'target_type'");
    if (cols.length === 0) {
      await pool.query(`
        ALTER TABLE notice
          ADD COLUMN target_type ENUM('all', 'class_section', 'specific_users') NOT NULL DEFAULT 'all' AFTER status,
          ADD COLUMN target_classes JSON NULL AFTER target_type,
          ADD COLUMN target_sections JSON NULL AFTER target_classes,
          ADD COLUMN target_roles JSON NULL AFTER target_sections,
          ADD COLUMN target_user_ids JSON NULL AFTER target_roles
      `);
      console.log('[Notice Migration]: Successfully added targeting columns to notice table.');
    } else {
      console.log('[Notice Migration]: Targeting columns already exist in notice table.');
    }
  } catch (err) {
    console.error('[Notice Migration Error]:', err.message);
  }
}

module.exports = runNoticeTargetingMigration;

if (require.main === module) {
  runNoticeTargetingMigration().then(() => process.exit(0));
}
