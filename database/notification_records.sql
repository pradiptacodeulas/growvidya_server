-- ============================================================================
-- Table: notification_records
-- Description: Unified table to store SMS and Push Notification records with
--              automated cost tracking (₹0.20 per sent SMS, ₹0.01 per sent push).
-- Database: MariaDB / MySQL 5.7+ / 8.0+
-- ============================================================================

CREATE TABLE IF NOT EXISTS `notification_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `school_id` INT NOT NULL DEFAULT 1 COMMENT 'Reference to school / tenant',
  `branch_id` INT DEFAULT NULL COMMENT 'Reference to branch if multi-branch',
  `channel` ENUM('sms', 'push') NOT NULL COMMENT 'Notification channel: sms or push',
  `category` VARCHAR(50) NOT NULL DEFAULT 'general' COMMENT 'attendance, fees, exam, homework, announcement, alert, etc.',
  `title` VARCHAR(255) DEFAULT NULL COMMENT 'Notification title (header for push or template title)',
  `message` TEXT NOT NULL COMMENT 'Message text / body content',
  `payload` JSON DEFAULT NULL COMMENT 'JSON payload for push data (deep links, screen routes, action buttons)',
  `recipient_role` ENUM('student', 'parent', 'teacher', 'staff', 'admin', 'other') DEFAULT 'other' COMMENT 'Recipient role',
  `recipient_id` INT DEFAULT NULL COMMENT 'User/Entity ID of recipient',
  `recipient_name` VARCHAR(150) DEFAULT NULL COMMENT 'Recipient display name for quick lookup without joins',
  `recipient_phone` VARCHAR(20) DEFAULT NULL COMMENT 'Phone number for SMS (+91XXXXXXXXXX)',
  `recipient_device_token` TEXT DEFAULT NULL COMMENT 'FCM device registration token or APNS device token for push',
  `recipient_device_type` ENUM('android', 'ios', 'web', 'all', 'other') DEFAULT NULL COMMENT 'Target OS/platform',
  `units_count` INT NOT NULL DEFAULT 1 COMMENT 'SMS credit parts or push device count (default 1)',
  `unit_cost` DECIMAL(8, 4) NOT NULL DEFAULT 0.0000 COMMENT 'Per-unit rate in INR (₹0.20 for SMS, ₹0.01 for push)',
  `total_cost` DECIMAL(10, 4) NOT NULL DEFAULT 0.0000 COMMENT 'Total billable cost in INR (charged upon sent/delivered)',
  `currency` VARCHAR(5) NOT NULL DEFAULT 'INR' COMMENT 'Currency code (INR = ₹)',
  `status` ENUM('pending', 'queued', 'sent', 'delivered', 'failed', 'cancelled') NOT NULL DEFAULT 'pending' COMMENT 'Message status',
  `provider` VARCHAR(50) DEFAULT NULL COMMENT 'Provider/Gateway (e.g. fcm, twilio, fast2sms, msg91)',
  `provider_message_id` VARCHAR(255) DEFAULT NULL COMMENT 'Gateway transaction ID / FCM message ID',
  `provider_response` TEXT DEFAULT NULL COMMENT 'Raw gateway HTTP response or error payload',
  `error_message` TEXT DEFAULT NULL COMMENT 'Failure description if sending failed',
  `dlt_template_id` VARCHAR(100) DEFAULT NULL COMMENT 'TRAI DLT Template ID for Indian SMS compliance',
  `dlt_entity_id` VARCHAR(100) DEFAULT NULL COMMENT 'TRAI DLT Entity ID',
  `sender_id` INT DEFAULT NULL COMMENT 'User ID of sender/initiator',
  `sender_role` VARCHAR(50) DEFAULT 'system' COMMENT 'Role of sender (admin, teacher, system)',
  `scheduled_at` DATETIME DEFAULT NULL COMMENT 'Scheduled delivery time',
  `sent_at` DATETIME DEFAULT NULL COMMENT 'Timestamp when dispatched to gateway',
  `delivered_at` DATETIME DEFAULT NULL COMMENT 'Timestamp when delivered report received',
  `read_at` DATETIME DEFAULT NULL COMMENT 'Timestamp when push notification was opened/read',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_school_channel_status` (`school_id`, `channel`, `status`),
  INDEX `idx_channel_created` (`channel`, `created_at`),
  INDEX `idx_recipient` (`recipient_role`, `recipient_id`),
  INDEX `idx_recipient_phone` (`recipient_phone`),
  INDEX `idx_status` (`status`),
  INDEX `idx_provider_msg_id` (`provider_message_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Unified SMS and Push Notification Records with ₹0.20/SMS and ₹0.01/Push cost tracking';

-- ----------------------------------------------------------------------------
-- Triggers for Automatic Cost Tracking:
-- Per sent SMS = ₹0.2000
-- Per sent Push Notification = ₹0.0100
-- Failed or pending notifications incur ₹0.0000 cost.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS `trg_notif_records_before_insert`;
DELIMITER $$
CREATE TRIGGER `trg_notif_records_before_insert`
BEFORE INSERT ON `notification_records`
FOR EACH ROW
BEGIN
  -- Set default unit rate: SMS ₹0.20, Push ₹0.01
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
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS `trg_notif_records_before_update`;
DELIMITER $$
CREATE TRIGGER `trg_notif_records_before_update`
BEFORE UPDATE ON `notification_records`
FOR EACH ROW
BEGIN
  -- Set default unit rate if unset: SMS ₹0.20, Push ₹0.01
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
END$$
DELIMITER ;
