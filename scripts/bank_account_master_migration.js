const { pool } = require('../config/db.config');

async function runBankAccountMasterMigration() {
  try {
    console.log('--- Starting Bank Account Master Migration ---');

    // 1. Create bank_account_master table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_account_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_title VARCHAR(150) NOT NULL COMMENT 'Display label e.g. Primary Operating Account, HDFC Current',
        beneficiary_name VARCHAR(200) NOT NULL COMMENT 'Legal entity / Account holder name',
        account_number VARCHAR(50) NOT NULL COMMENT 'Bank Account Number',
        bank_name VARCHAR(150) NOT NULL COMMENT 'Bank Name e.g. HDFC Bank, ICICI Bank',
        branch_name VARCHAR(150) DEFAULT NULL COMMENT 'Branch Name & Location',
        ifsc_code VARCHAR(30) NOT NULL COMMENT 'IFSC Code',
        account_type VARCHAR(50) DEFAULT 'Current' COMMENT 'Account Type e.g. Current, Savings',
        upi_id VARCHAR(100) DEFAULT NULL COMMENT 'UPI VPA handle e.g. billing@bank',
        swift_code VARCHAR(50) DEFAULT NULL COMMENT 'SWIFT / BIC Code for wire transfer',
        instructions TEXT DEFAULT NULL COMMENT 'Special instructions or notes for transferring institutions',
        qr_code_image VARCHAR(255) DEFAULT NULL COMMENT 'UPI / Payment QR code image URL',
        is_default TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Primary default account for subscription payments',
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bank_status (status),
        INDEX idx_bank_default (is_default)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ bank_account_master table verified/created.');

    // 2. Register SaaS module in saas_modules if table exists
    try {
      const [tableCheck] = await pool.query(`
        SELECT TABLE_NAME FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_modules'
      `);
      if (tableCheck.length > 0) {
        await pool.query(`
          INSERT INTO saas_modules (module_key, module_name, description, display_order, status)
          VALUES ('bank_accounts', 'Bank Accounts Master', 'Manage official platform bank accounts and payment transfer details', 11, 1)
          ON DUPLICATE KEY UPDATE 
            module_name = VALUES(module_name),
            description = VALUES(description),
            display_order = VALUES(display_order)
        `);
        console.log('✓ saas_modules updated with bank_accounts entry.');

        // Give Super Admin full permissions on bank_accounts
        const [superAdminRoles] = await pool.query(`
          SELECT id FROM saas_roles WHERE role_name = 'Super Admin' OR is_system = 1
        `);
        for (const role of superAdminRoles) {
          await pool.query(`
            INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
            VALUES (?, 'bank_accounts', 1, 1, 1, 1, 1)
            ON DUPLICATE KEY UPDATE 
              can_view = 1, can_add = 1, can_edit = 1, can_delete = 1, can_manage = 1
          `, [role.id]);
        }
        console.log('✓ Super Admin role permissions granted for bank_accounts.');
      }
    } catch (permErr) {
      console.warn('Note on saas_modules / permissions:', permErr.message);
    }

    console.log('--- Bank Account Master Migration Finished Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runBankAccountMasterMigration();
