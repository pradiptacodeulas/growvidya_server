const { pool } = require('../config/db.config');

async function runDeviceTokensMigration() {
  try {
    console.log('--- Starting User Device Tokens Table Migration ---');

    // Drop old empty table if exists or upgrade it
    await pool.query(`DROP TABLE IF EXISTS user_device_tokens;`);

    // Create modern user_device_tokens table
    await pool.query(`
      CREATE TABLE user_device_tokens (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL DEFAULT 1 COMMENT 'Reference to school / tenant',
        user_id INT NOT NULL COMMENT 'User ID within role (student_id, teacher_id, parent_id, user_id)',
        role ENUM('student', 'parent', 'teacher', 'admin', 'staff', 'other') NOT NULL COMMENT 'User role',
        device_type ENUM('web', 'android', 'ios') NOT NULL COMMENT 'Platform type',
        token TEXT NOT NULL COMMENT 'Expo Push Token or stringified Web PushSubscription',
        endpoint_hash VARCHAR(64) NOT NULL COMMENT 'SHA256 hash of token or webpush endpoint for fast lookup and uniqueness',
        device_name VARCHAR(150) DEFAULT NULL COMMENT 'Friendly device or browser name',
        user_agent VARCHAR(255) DEFAULT NULL COMMENT 'Client User-Agent header',
        is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = revoked/expired',
        last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_endpoint_hash (endpoint_hash),
        INDEX idx_user_role_active (user_id, role, is_active),
        INDEX idx_school_role_active (school_id, role, is_active),
        INDEX idx_device_type (device_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Multi-platform push notification device tokens (Web VAPID & Mobile Expo)';
    `);

    console.log('✓ user_device_tokens table verified/created successfully.');
    console.log('--- Migration Completed Successfully ---');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

runDeviceTokensMigration();
