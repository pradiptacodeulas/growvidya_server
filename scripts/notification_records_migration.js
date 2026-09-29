const { pool } = require('../config/db.config');

async function runNotificationRecordsMigration() {
  try {
    console.log('--- Starting Notification Records Table Migration ---');

    // 1. Create notification_records table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_records (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL DEFAULT 1 COMMENT 'Reference to school / tenant',
        branch_id INT DEFAULT NULL COMMENT 'Reference to branch if multi-branch',
        channel ENUM('sms', 'push') NOT NULL COMMENT 'Notification channel: sms or push',
        category VARCHAR(50) NOT NULL DEFAULT 'general' COMMENT 'attendance, fees, exam, homework, announcement, alert, etc.',
        title VARCHAR(255) DEFAULT NULL COMMENT 'Notification title (header for push or template title)',
        message TEXT NOT NULL COMMENT 'Message text / body content',
        payload JSON DEFAULT NULL COMMENT 'JSON payload for push data (deep links, badges, action URLs)',
        recipient_role ENUM('student', 'parent', 'teacher', 'staff', 'admin', 'other') DEFAULT 'other' COMMENT 'Recipient role',
        recipient_id INT DEFAULT NULL COMMENT 'User/Entity ID of recipient',
        recipient_name VARCHAR(150) DEFAULT NULL COMMENT 'Recipient display name for quick lookup',
        recipient_phone VARCHAR(20) DEFAULT NULL COMMENT 'Phone number for SMS (+91XXXXXXXXXX)',
        recipient_device_token TEXT DEFAULT NULL COMMENT 'FCM device registration token or APNS token for push',
        recipient_device_type ENUM('android', 'ios', 'web', 'all', 'other') DEFAULT NULL COMMENT 'Target OS/platform',
        units_count INT NOT NULL DEFAULT 1 COMMENT 'SMS credit parts or push device count (default 1)',
        unit_cost DECIMAL(8, 4) NOT NULL DEFAULT 0.0000 COMMENT 'Per-unit rate in INR (₹0.20 for SMS, ₹0.01 for push)',
        total_cost DECIMAL(10, 4) NOT NULL DEFAULT 0.0000 COMMENT 'Total billable cost in INR (charged upon sent/delivered)',
        currency VARCHAR(5) NOT NULL DEFAULT 'INR' COMMENT 'Currency code (INR = ₹)',
        status ENUM('pending', 'queued', 'sent', 'delivered', 'failed', 'cancelled') NOT NULL DEFAULT 'pending' COMMENT 'Message status',
        provider VARCHAR(50) DEFAULT NULL COMMENT 'Provider/Gateway (e.g. fcm, twilio, fast2sms, msg91)',
        provider_message_id VARCHAR(255) DEFAULT NULL COMMENT 'Gateway transaction ID / FCM message ID',
        provider_response TEXT DEFAULT NULL COMMENT 'Raw gateway HTTP response or error payload',
        error_message TEXT DEFAULT NULL COMMENT 'Failure description if sending failed',
        dlt_template_id VARCHAR(100) DEFAULT NULL COMMENT 'TRAI DLT Template ID for Indian SMS compliance',
        dlt_entity_id VARCHAR(100) DEFAULT NULL COMMENT 'TRAI DLT Entity ID',
        sender_id INT DEFAULT NULL COMMENT 'User ID of sender/initiator',
        sender_role VARCHAR(50) DEFAULT 'system' COMMENT 'Role of sender (admin, teacher, system)',
        scheduled_at DATETIME DEFAULT NULL COMMENT 'Scheduled delivery time',
        sent_at DATETIME DEFAULT NULL COMMENT 'Timestamp when dispatched to gateway',
        delivered_at DATETIME DEFAULT NULL COMMENT 'Timestamp when delivered report received',
        read_at DATETIME DEFAULT NULL COMMENT 'Timestamp when push notification was opened/read',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_school_channel_status (school_id, channel, status),
        INDEX idx_channel_created (channel, created_at),
        INDEX idx_recipient (recipient_role, recipient_id),
        INDEX idx_recipient_phone (recipient_phone),
        INDEX idx_status (status),
        INDEX idx_provider_msg_id (provider_message_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Unified SMS and Push Notification Records with ₹0.20/SMS and ₹0.01/Push cost tracking';
    `);

    console.log('✓ notification_records table verified/created successfully.');

    // 2. Drop existing triggers if any, to allow clean re-runs
    await pool.query(`DROP TRIGGER IF EXISTS trg_notif_records_before_insert;`);
    await pool.query(`DROP TRIGGER IF EXISTS trg_notif_records_before_update;`);

    // 3. Create BEFORE INSERT trigger for automatic rate assignment and cost calculation
    await pool.query(`
      CREATE TRIGGER trg_notif_records_before_insert
      BEFORE INSERT ON notification_records
      FOR EACH ROW
      BEGIN
        -- Default unit_cost based on channel: SMS = ₹0.20, Push = ₹0.01
        IF NEW.unit_cost IS NULL OR NEW.unit_cost = 0.0000 THEN
          IF NEW.channel = 'sms' THEN
            SET NEW.unit_cost = 0.2000;
          ELSEIF NEW.channel = 'push' THEN
            SET NEW.unit_cost = 0.0100;
          END IF;
        END IF;

        -- Ensure minimum 1 unit
        IF NEW.units_count IS NULL OR NEW.units_count < 1 THEN
          SET NEW.units_count = 1;
        END IF;

        -- Calculate total cost if sent or delivered
        IF NEW.status IN ('sent', 'delivered') THEN
          SET NEW.total_cost = NEW.unit_cost * NEW.units_count;
          IF NEW.sent_at IS NULL THEN
            SET NEW.sent_at = NOW();
          END IF;
        ELSE
          SET NEW.total_cost = 0.0000;
        END IF;
      END;
    `);
    console.log('✓ trg_notif_records_before_insert trigger created.');

    // 4. Create BEFORE UPDATE trigger for automatic rate assignment and cost calculation
    await pool.query(`
      CREATE TRIGGER trg_notif_records_before_update
      BEFORE UPDATE ON notification_records
      FOR EACH ROW
      BEGIN
        -- Default unit_cost based on channel if unset: SMS = ₹0.20, Push = ₹0.01
        IF NEW.unit_cost IS NULL OR NEW.unit_cost = 0.0000 THEN
          IF NEW.channel = 'sms' THEN
            SET NEW.unit_cost = 0.2000;
          ELSEIF NEW.channel = 'push' THEN
            SET NEW.unit_cost = 0.0100;
          END IF;
        END IF;

        -- Ensure minimum 1 unit
        IF NEW.units_count IS NULL OR NEW.units_count < 1 THEN
          SET NEW.units_count = 1;
        END IF;

        -- Calculate total cost when status transitions to sent or delivered
        IF NEW.status IN ('sent', 'delivered') THEN
          SET NEW.total_cost = NEW.unit_cost * NEW.units_count;
          IF NEW.sent_at IS NULL AND OLD.status NOT IN ('sent', 'delivered') THEN
            SET NEW.sent_at = NOW();
          END IF;
        ELSEIF NEW.status NOT IN ('sent', 'delivered') THEN
          SET NEW.total_cost = 0.0000;
        END IF;
      END;
    `);
    console.log('✓ trg_notif_records_before_update trigger created.');

    // 5. Test inserting sample SMS and Push records to verify automatic cost calculation
    console.log('\n--- Testing automatic cost calculation on sample records ---');

    // Sample 1: Sent SMS (Expected: unit_cost = 0.2000, total_cost = 0.2000)
    const [smsRes] = await pool.query(`
      INSERT INTO notification_records (
        school_id, channel, category, title, message, recipient_role, recipient_name, recipient_phone, status
      ) VALUES (
        1, 'sms', 'attendance', 'Attendance Alert', 'Dear Parent, your child was marked present today.', 'parent', 'Ramesh Kumar', '+919876543210', 'sent'
      )
    `);

    // Sample 2: Sent Push Notification (Expected: unit_cost = 0.0100, total_cost = 0.0100)
    const [pushRes] = await pool.query(`
      INSERT INTO notification_records (
        school_id, channel, category, title, message, recipient_role, recipient_name, recipient_device_token, recipient_device_type, status
      ) VALUES (
        1, 'push', 'fee_reminder', 'Fee Reminder', 'Term 2 fees are due by 5th Oct.', 'parent', 'Priya Sharma', 'fcm_dummy_token_abc123', 'android', 'sent'
      )
    `);

    // Sample 3: Pending SMS updated to Sent (Expected: 0.0000 initially, then 0.2000 on sent)
    const [pendingRes] = await pool.query(`
      INSERT INTO notification_records (
        school_id, channel, category, message, recipient_phone, status
      ) VALUES (
        1, 'sms', 'exam', 'Exam schedule published.', '+919812345678', 'pending'
      )
    `);

    // Verify initial values
    const [inserted] = await pool.query(
      `SELECT id, channel, status, unit_cost, units_count, total_cost, currency, sent_at FROM notification_records WHERE id IN (?, ?, ?)`,
      [smsRes.insertId, pushRes.insertId, pendingRes.insertId]
    );
    console.log('Inserted verification records:');
    console.table(inserted);

    // Update pending SMS to sent
    await pool.query(`UPDATE notification_records SET status = 'sent' WHERE id = ?`, [pendingRes.insertId]);

    const [updated] = await pool.query(
      `SELECT id, channel, status, unit_cost, units_count, total_cost, currency, sent_at FROM notification_records WHERE id = ?`,
      [pendingRes.insertId]
    );
    console.log('Pending SMS after update to sent:');
    console.table(updated);

    // Clean up test records
    await pool.query(`DELETE FROM notification_records WHERE id IN (?, ?, ?)`, [
      smsRes.insertId,
      pushRes.insertId,
      pendingRes.insertId
    ]);
    console.log('✓ Cleaned up test sample records.');

    console.log('\n--- Notification Records Table Migration Completed Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runNotificationRecordsMigration();
