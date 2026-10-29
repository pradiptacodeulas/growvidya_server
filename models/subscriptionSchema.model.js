const { pool } = require('../config/db.config');
const { getCycleMonths } = require('../constants/subscriptionModules.constant');

/**
 * Idempotent Schema Initializer for Production SaaS Subscriptions, Add-ons,
 * Immutable Checkout Orders, Invoices (Zero GST), Notification Wallets,
 * Audit Logs, and Optional Super-Admin Communication Settings.
 */
class SubscriptionSchemaModel {
  static _initialized = false;

  static async _getColumnMap(tableName) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
    const map = new Map();
    for (const c of cols) {
      map.set(c.Field, c);
    }
    return map;
  }

  static async initTable() {
    if (SubscriptionSchemaModel._initialized) return;

    try {
      // 1. Upgrade subscription_plans
      await SubscriptionSchemaModel._upgradeSubscriptionPlans();

      // 2. Upgrade subscription_items
      await SubscriptionSchemaModel._upgradeSubscriptionItems();

      // 3. Upgrade school_subscriptions
      await SubscriptionSchemaModel._upgradeSchoolSubscriptions();

      // 4. Upgrade coupons (coupon scope protection)
      await SubscriptionSchemaModel._upgradeCoupons();

      // 5. Create subscription_payment_orders (immutable server-side order & zero-GST invoice table)
      await SubscriptionSchemaModel._initPaymentOrdersTable();

      // 6. Link add-on order tables to payment_order_id
      await SubscriptionSchemaModel._upgradeAddonOrderTables();

      // 7. Create notification_pricing_master & school_notification_wallets + ledger
      await SubscriptionSchemaModel._initNotificationPricingAndWallets();

      // 8. Create saas_communication_settings (Super Admin On/Off toggles for SMTP/Mailjet & SMS)
      await SubscriptionSchemaModel._initCommunicationSettings();

      // 9. Create subscription_audit_logs & subscription_reminder_logs
      await SubscriptionSchemaModel._initAuditAndReminderTables();

      SubscriptionSchemaModel._initialized = true;
    } catch (error) {
      console.error('[SubscriptionSchemaModel] Schema initialization error:', error.message);
    }
  }

  static async _upgradeSubscriptionPlans() {
    const cols = await SubscriptionSchemaModel._getColumnMap('subscription_plans');

    // Expand billing_cycle enum to support all 5 cycles
    const cycleType = String(cols.get('billing_cycle')?.Type || '').toLowerCase();
    if (!cycleType.includes('quarterly') || !cycleType.includes('half_yearly')) {
      await pool.query(`
        ALTER TABLE \`subscription_plans\`
        MODIFY COLUMN \`billing_cycle\` ENUM('trial','monthly','quarterly','half_yearly','annual') NOT NULL DEFAULT 'annual'
      `);
    }

    const alterParts = [];
    if (!cols.has('tier_rank')) {
      alterParts.push('ADD COLUMN `tier_rank` INT(11) NOT NULL DEFAULT 1 AFTER `plan_code`');
    }
    if (!cols.has('plan_group')) {
      alterParts.push('ADD COLUMN `plan_group` VARCHAR(50) DEFAULT NULL AFTER `plan_code`');
    }
    if (!cols.has('original_price')) {
      alterParts.push('ADD COLUMN `original_price` DECIMAL(10,2) DEFAULT NULL AFTER `price`');
    }
    if (!cols.has('included_storage_gb')) {
      alterParts.push('ADD COLUMN `included_storage_gb` INT(11) NOT NULL DEFAULT 0 AFTER `max_students`');
    }
    if (!cols.has('max_teachers')) {
      alterParts.push('ADD COLUMN `max_teachers` INT(11) NOT NULL DEFAULT 0 AFTER `max_students`');
    }
    if (!cols.has('is_popular')) {
      alterParts.push('ADD COLUMN `is_popular` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`');
    }
    if (!cols.has('features_json')) {
      alterParts.push('ADD COLUMN `features_json` LONGTEXT DEFAULT NULL');
    }

    if (alterParts.length > 0) {
      await pool.query(`ALTER TABLE \`subscription_plans\` ${alterParts.join(', ')}`);
    }

    // Backfill plan_group and deterministic tier_rank dynamically from existing DB plans
    const [plans] = await pool.query(
      'SELECT id, plan_name, plan_code, price, billing_cycle, tier_rank, plan_group, is_popular FROM subscription_plans ORDER BY id ASC'
    );

    if (plans.length > 0) {
      const stripCycleSuffix = (code) =>
        String(code || '')
          .toLowerCase()
          .trim()
          .replace(/_(monthly|quarterly|half_yearly|annual|trial)$/i, '') || 'tier';

      // Set plan_group where missing & tier_rank = 0 for trial plans
      for (const p of plans) {
        const computedGroup = p.plan_group && p.plan_group.trim()
          ? p.plan_group.trim().toLowerCase()
          : stripCycleSuffix(p.plan_code || p.plan_name);

        if (p.billing_cycle === 'trial') {
          if (Number(p.tier_rank) !== 0 || p.plan_group !== computedGroup) {
            await pool.query(
              'UPDATE subscription_plans SET tier_rank = 0, plan_group = ? WHERE id = ?',
              [computedGroup, p.id]
            );
          }
        } else if (!p.plan_group || !p.plan_group.trim()) {
          await pool.query(
            'UPDATE subscription_plans SET plan_group = ? WHERE id = ?',
            [computedGroup, p.id]
          );
          p.plan_group = computedGroup;
        }
      }

      // If paid plans have not yet been ranked (all paid plans have tier_rank = 1 across >1 distinct groups), auto-rank by normalized monthly rate
      const paidPlans = plans.filter((p) => p.billing_cycle !== 'trial');
      const distinctPaidRanks = new Set(paidPlans.map((p) => Number(p.tier_rank)));
      const groupMinMonthlyPrice = new Map();

      for (const p of paidPlans) {
        const grp = (p.plan_group || stripCycleSuffix(p.plan_code || p.plan_name)).toLowerCase();
        const months = Math.max(1, getCycleMonths(p.billing_cycle));
        const monthlyEq = (parseFloat(p.price) || 0) / months;
        if (!groupMinMonthlyPrice.has(grp) || monthlyEq < groupMinMonthlyPrice.get(grp)) {
          groupMinMonthlyPrice.set(grp, monthlyEq);
        }
      }

      if (distinctPaidRanks.size <= 1 && groupMinMonthlyPrice.size > 1) {
        const sortedGroups = [...groupMinMonthlyPrice.entries()]
          .sort((a, b) => a[1] - b[1])
          .map(([grp]) => grp);

        for (let idx = 0; idx < sortedGroups.length; idx++) {
          const rank = idx + 1;
          await pool.query(
            `UPDATE subscription_plans SET tier_rank = ? WHERE plan_group = ? AND billing_cycle != 'trial'`,
            [rank, sortedGroups[idx]]
          );
        }
      }
    }
  }

  static async _upgradeSubscriptionItems() {
    const cols = await SubscriptionSchemaModel._getColumnMap('subscription_items');
    if (!cols.has('item_type')) {
      await pool.query(`
        ALTER TABLE \`subscription_items\`
        ADD COLUMN \`item_type\` ENUM('module','feature') NOT NULL DEFAULT 'feature' AFTER \`item_code\`
      `);
      await pool.query(`
        UPDATE \`subscription_items\`
        SET \`item_type\` = 'module'
        WHERE UPPER(COALESCE(\`item_code\`, '')) IN ('TRANSPORT', 'HOSTEL', 'PAYROLL')
      `);
    }
  }

  static async _upgradeSchoolSubscriptions() {
    const cols = await SubscriptionSchemaModel._getColumnMap('school_subscriptions');

    const statusType = String(cols.get('status')?.Type || '').toLowerCase();
    if (!statusType.includes('rejected') || !statusType.includes('superseded')) {
      await pool.query(`
        ALTER TABLE \`school_subscriptions\`
        MODIFY COLUMN \`status\` ENUM('trial','active','expired','suspended','pending','rejected','superseded') DEFAULT 'pending'
      `);
    }

    const alterParts = [];
    if (!cols.has('action_type')) {
      alterParts.push("ADD COLUMN `action_type` ENUM('onboarding','trial','renewal','upgrade','manual_override') NOT NULL DEFAULT 'onboarding' AFTER `storage_plan_id`");
    }
    if (!cols.has('plan_amount')) {
      alterParts.push('ADD COLUMN `plan_amount` DECIMAL(10,2) DEFAULT NULL AFTER `action_type`');
    }
    if (!cols.has('addons_amount')) {
      alterParts.push('ADD COLUMN `addons_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `plan_amount`');
    }
    if (!cols.has('payment_order_id')) {
      alterParts.push('ADD COLUMN `payment_order_id` INT(11) DEFAULT NULL AFTER `payment_transaction_id`');
    }
    if (!cols.has('invoice_no')) {
      alterParts.push('ADD COLUMN `invoice_no` VARCHAR(60) DEFAULT NULL AFTER `payment_order_id`');
    }
    if (!cols.has('superseded_by_id')) {
      alterParts.push('ADD COLUMN `superseded_by_id` INT(11) DEFAULT NULL AFTER `verified_at`');
    }

    if (alterParts.length > 0) {
      await pool.query(`ALTER TABLE \`school_subscriptions\` ${alterParts.join(', ')}`);
    }

    // Remove legacy 'dummy' default on payment_gateway
    if (String(cols.get('payment_gateway')?.Default || '').toLowerCase() === 'dummy') {
      await pool.query(`
        ALTER TABLE \`school_subscriptions\`
        MODIFY COLUMN \`payment_gateway\` VARCHAR(50) DEFAULT 'razorpay'
      `);
    }

    // Backfill plan_amount and invoice_no for historical paid subscriptions
    await pool.query(`
      UPDATE \`school_subscriptions\`
      SET \`plan_amount\` = \`amount_paid\`
      WHERE \`plan_amount\` IS NULL
    `);

    await pool.query(`
      UPDATE \`school_subscriptions\`
      SET \`invoice_no\` = CONCAT('INV-', YEAR(\`created_at\`), '-', LPAD(\`id\`, 5, '0'))
      WHERE \`invoice_no\` IS NULL
        AND \`payment_status\` = 'completed'
        AND \`amount_paid\` > 0
    `);
  }

  static async _upgradeCoupons() {
    try {
      const cols = await SubscriptionSchemaModel._getColumnMap('coupons');
      if (!cols.has('applicable_scope')) {
        await pool.query(`
          ALTER TABLE \`coupons\`
          ADD COLUMN \`applicable_scope\` ENUM('plan_only','software_and_storage','all') NOT NULL DEFAULT 'plan_only' AFTER \`discount_value\`
        `);
      }
    } catch (_) {
      // coupons table initialized by CouponModel.initTable()
    }
  }

  static async _initPaymentOrdersTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`subscription_payment_orders\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`order_no\` VARCHAR(60) NOT NULL,
        \`invoice_no\` VARCHAR(60) DEFAULT NULL,
        \`school_id\` INT(11) DEFAULT NULL,
        \`order_type\` ENUM('onboarding','trial_with_addons','renewal','upgrade','addon_only','manual_override') NOT NULL DEFAULT 'renewal',
        \`action_type\` ENUM('onboarding','trial','renewal','upgrade','addon_only','manual_override') NOT NULL DEFAULT 'renewal',
        \`plan_id\` INT(11) DEFAULT NULL,
        \`billing_cycle\` VARCHAR(30) DEFAULT NULL,
        \`plan_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`storage_plan_id\` INT(11) DEFAULT NULL,
        \`storage_qty\` INT(11) NOT NULL DEFAULT 0,
        \`storage_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`machines_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`rfid_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`notifications_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`subtotal_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`coupon_id\` INT(11) DEFAULT NULL,
        \`coupon_code\` VARCHAR(60) DEFAULT NULL,
        \`discount_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`grand_total\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`currency\` VARCHAR(10) NOT NULL DEFAULT 'INR',
        \`payment_method\` ENUM('razorpay','bank_transfer','free_trial','coupon_100','super_admin_manual') NOT NULL DEFAULT 'razorpay',
        \`razorpay_order_id\` VARCHAR(120) DEFAULT NULL,
        \`razorpay_payment_id\` VARCHAR(120) DEFAULT NULL,
        \`utr_number\` VARCHAR(150) DEFAULT NULL,
        \`shipping_address\` TEXT DEFAULT NULL,
        \`payload_snapshot_json\` LONGTEXT DEFAULT NULL,
        \`status\` ENUM('created','pending_verification','paid','failed','rejected','expired') NOT NULL DEFAULT 'created',
        \`failure_code\` VARCHAR(100) DEFAULT NULL,
        \`failure_reason\` TEXT DEFAULT NULL,
        \`activated_subscription_id\` INT(11) DEFAULT NULL,
        \`verified_by\` INT(11) DEFAULT NULL,
        \`verification_notes\` TEXT DEFAULT NULL,
        \`paid_at\` DATETIME DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_sub_order_no\` (\`order_no\`),
        UNIQUE KEY \`uq_sub_rzp_order\` (\`razorpay_order_id\`),
        KEY \`idx_sub_order_school\` (\`school_id\`, \`status\`),
        KEY \`idx_sub_order_invoice\` (\`invoice_no\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  static async _upgradeAddonOrderTables() {
    const addonTables = [
      'school_storage_orders',
      'school_attendance_machines',
      'school_rfid_orders',
    ];
    for (const table of addonTables) {
      try {
        const cols = await SubscriptionSchemaModel._getColumnMap(table);
        if (!cols.has('payment_order_id')) {
          await pool.query(
            `ALTER TABLE \`${table}\` ADD COLUMN \`payment_order_id\` INT(11) DEFAULT NULL AFTER \`school_id\``
          );
        }
      } catch (_) {}
    }
  }

  static async _initNotificationPricingAndWallets() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`notification_pricing_master\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`channel\` ENUM('sms','push') NOT NULL,
        \`pack_name\` VARCHAR(150) NOT NULL,
        \`unit_price\` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
        \`min_qty\` INT(11) NOT NULL DEFAULT 1,
        \`description\` VARCHAR(255) DEFAULT NULL,
        \`status\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_notif_pricing_channel\` (\`channel\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migrate existing legacy notification_master rows if notification_pricing_master is empty (no hardcoded rates)
    const [[countRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM notification_pricing_master');
    if ((Number(countRow?.cnt) || 0) === 0) {
      try {
        const [legacyRows] = await pool.query(
          'SELECT type, cost, message FROM notification_master WHERE cost > 0 ORDER BY id ASC'
        );
        for (const r of legacyRows) {
          const ch = String(r.type || '').toLowerCase();
          if ((ch === 'sms' || ch === 'push') && parseFloat(r.cost) > 0) {
            await pool.query(
              `INSERT IGNORE INTO notification_pricing_master (channel, pack_name, unit_price, min_qty, description, status)
               VALUES (?, ?, ?, 1, ?, 1)`,
              [
                ch,
                ch === 'sms' ? 'SMS Notification Credits' : 'Push Notification Credits',
                parseFloat(r.cost),
                r.message || '',
              ]
            );
          }
        }
      } catch (_) {}
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`school_notification_wallets\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`school_id\` INT(11) NOT NULL,
        \`sms_balance\` INT(11) NOT NULL DEFAULT 0,
        \`push_balance\` INT(11) NOT NULL DEFAULT 0,
        \`total_sms_purchased\` INT(11) NOT NULL DEFAULT 0,
        \`total_push_purchased\` INT(11) NOT NULL DEFAULT 0,
        \`total_sms_used\` INT(11) NOT NULL DEFAULT 0,
        \`total_push_used\` INT(11) NOT NULL DEFAULT 0,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_wallet_school\` (\`school_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`school_notification_ledger\` (
        \`id\` BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        \`school_id\` INT(11) NOT NULL,
        \`channel\` ENUM('sms','push') NOT NULL,
        \`entry_type\` ENUM('credit','debit','adjustment') NOT NULL,
        \`units\` INT(11) NOT NULL,
        \`balance_after\` INT(11) NOT NULL DEFAULT 0,
        \`unit_price\` DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
        \`total_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`payment_order_id\` INT(11) DEFAULT NULL,
        \`reference_note\` VARCHAR(255) DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_notif_ledger_school\` (\`school_id\`, \`channel\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  static async _initCommunicationSettings() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`saas_communication_settings\` (
        \`id\` INT(11) NOT NULL PRIMARY KEY,
        \`email_alerts_enabled\` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Super Admin toggle: 1 = Send subscription emails via active Mailjet/SMTP, 0 = Off',
        \`sms_alerts_enabled\` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Super Admin toggle: 1 = Send subscription SMS alerts, 0 = Off',
        \`notify_on_payment_success\` TINYINT(1) NOT NULL DEFAULT 1,
        \`notify_on_offline_decision\` TINYINT(1) NOT NULL DEFAULT 1,
        \`notify_on_expiry_reminder\` TINYINT(1) NOT NULL DEFAULT 1,
        \`sms_provider\` VARCHAR(50) DEFAULT NULL,
        \`sms_api_key_encrypted\` TEXT DEFAULT NULL,
        \`sms_sender_id\` VARCHAR(30) DEFAULT NULL,
        \`updated_by\` INT(11) DEFAULT NULL,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      INSERT IGNORE INTO \`saas_communication_settings\`
      (\`id\`, \`email_alerts_enabled\`, \`sms_alerts_enabled\`, \`notify_on_payment_success\`, \`notify_on_offline_decision\`, \`notify_on_expiry_reminder\`)
      VALUES (1, 0, 0, 1, 1, 1)
    `);
  }

  static async _initAuditAndReminderTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`subscription_audit_logs\` (
        \`id\` BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        \`school_id\` INT(11) NOT NULL,
        \`subscription_id\` INT(11) DEFAULT NULL,
        \`payment_order_id\` INT(11) DEFAULT NULL,
        \`actor_type\` ENUM('school_admin','saas_super_admin','webhook','system_cron','onboarding') NOT NULL DEFAULT 'school_admin',
        \`actor_id\` INT(11) DEFAULT NULL,
        \`action\` VARCHAR(80) NOT NULL,
        \`previous_state_json\` LONGTEXT DEFAULT NULL,
        \`new_state_json\` LONGTEXT DEFAULT NULL,
        \`reason\` TEXT DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_sub_audit_school\` (\`school_id\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`subscription_reminder_logs\` (
        \`id\` BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        \`school_id\` INT(11) NOT NULL,
        \`subscription_id\` INT(11) NOT NULL,
        \`milestone_days\` INT(11) NOT NULL COMMENT '15, 7, 3, 1, or 0',
        \`channel\` ENUM('email','sms') NOT NULL,
        \`status\` ENUM('sent','skipped','failed') NOT NULL DEFAULT 'sent',
        \`detail\` VARCHAR(255) DEFAULT NULL,
        \`sent_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_sub_reminder_once\` (\`subscription_id\`, \`milestone_days\`, \`channel\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
}

module.exports = SubscriptionSchemaModel;
