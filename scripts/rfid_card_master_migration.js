const { pool } = require('../config/db.config');

async function runRfidCardMasterMigration() {
  try {
    console.log('--- Starting RFID Card Master Migration ---');

    // 1. Create rfid_card_master table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rfid_card_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        card_name VARCHAR(150) NOT NULL COMMENT 'e.g. Mifare 1K Smart Card, EM4100 Proximity Card',
        card_code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Unique SKU/Model e.g. RFID-MF-1K',
        card_type VARCHAR(50) NOT NULL DEFAULT 'pvc_card' COMMENT 'pvc_card, keyfob, wristband, sticker',
        frequency VARCHAR(50) DEFAULT NULL COMMENT 'e.g. 13.56 MHz, 125 kHz, 860-960 MHz',
        read_range VARCHAR(50) DEFAULT NULL COMMENT 'e.g. 2-5 cm, 1-3 meters',
        unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Per-card price in INR',
        min_order_qty INT NOT NULL DEFAULT 1 COMMENT 'Minimum order quantity',
        card_image VARCHAR(255) DEFAULT NULL COMMENT 'Image/preview URL',
        description TEXT DEFAULT NULL,
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_rfid_card_status (status),
        INDEX idx_rfid_card_type (card_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ rfid_card_master table verified/created.');

    // 2. Create school_rfid_orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_rfid_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(50) NOT NULL UNIQUE,
        school_id INT NOT NULL,
        rfid_card_id INT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        order_status ENUM('pending', 'approved', 'dispatched', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
        shipping_address TEXT DEFAULT NULL,
        remarks TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_school_rfid_order (school_id),
        INDEX idx_rfid_order_status (order_status),
        CONSTRAINT fk_school_rfid_orders_card FOREIGN KEY (rfid_card_id) REFERENCES rfid_card_master(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ school_rfid_orders table verified/created.');

    // 3. Register SaaS module in saas_modules if saas_modules exists
    try {
      const [tableCheck] = await pool.query(`
        SELECT TABLE_NAME FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_modules'
      `);
      if (tableCheck.length > 0) {
        await pool.query(`
          INSERT INTO saas_modules (module_key, module_name, description, display_order, status)
          VALUES ('rfid_cards', 'RFID Cards Master', 'Manage RFID card types, hardware specifications, and unit pricing', 9, 1)
          ON DUPLICATE KEY UPDATE 
            module_name = VALUES(module_name),
            description = VALUES(description),
            display_order = VALUES(display_order)
        `);
        console.log('✓ saas_modules updated with rfid_cards entry.');

        // Give Super Admin full permissions on rfid_cards
        const [superAdminRoles] = await pool.query(`
          SELECT id FROM saas_roles WHERE role_name = 'Super Admin' OR is_system = 1
        `);
        for (const role of superAdminRoles) {
          await pool.query(`
            INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
            VALUES (?, 'rfid_cards', 1, 1, 1, 1, 1)
            ON DUPLICATE KEY UPDATE 
              can_view = 1, can_add = 1, can_edit = 1, can_delete = 1, can_manage = 1
          `, [role.id]);
        }
        console.log('✓ Super Admin role permissions granted for rfid_cards.');
      }
    } catch (permErr) {
      console.warn('Note on saas_modules / permissions:', permErr.message);
    }

    // 4. Seed initial default RFID Card records if empty
    const [existing] = await pool.query('SELECT COUNT(*) AS count FROM rfid_card_master');
    if (existing[0].count === 0) {
      console.log('Seeding standard RFID Card inventory types...');
      const defaultCards = [
        [
          'Mifare Classic 1K PVC Card',
          'RFID-MF-1K',
          'pvc_card',
          '13.56 MHz',
          'Up to 5 cm',
          35.00,
          50,
          'High frequency ISO14443A card, ideal for student/staff smart attendance and library tracking with printable PVC surface.',
          1
        ],
        [
          'EM4100 125kHz Proximity Card',
          'RFID-EM-125K',
          'pvc_card',
          '125 kHz',
          'Up to 8 cm',
          25.00,
          50,
          'Standard low frequency read-only contactless card, cost-effective for turnstiles and school gate attendance.',
          1
        ],
        [
          'NFC / RFID Smart Keyfob',
          'RFID-FOB-1356',
          'keyfob',
          '13.56 MHz',
          'Up to 3 cm',
          40.00,
          25,
          'Durable ABS waterproof keyfob, compact and portable for teachers, bus drivers, and staff attendance.',
          1
        ],
        [
          'UHF Long-Range Windshield RFID Tag',
          'RFID-UHF-GEN2',
          'sticker',
          '860-960 MHz',
          'Up to 6 meters',
          50.00,
          20,
          'EPC Gen 2 long-range UHF tag designed for school bus and transport fleet automated barrier tracking.',
          1
        ],
        [
          'RFID Silicone Wristband',
          'RFID-WB-SIL',
          'wristband',
          '13.56 MHz',
          'Up to 4 cm',
          65.00,
          50,
          'Comfortable waterproof silicone wristband, perfect for primary/kindergarten students and sports events.',
          1
        ]
      ];

      for (const card of defaultCards) {
        await pool.query(
          `INSERT INTO rfid_card_master 
           (card_name, card_code, card_type, frequency, read_range, unit_price, min_order_qty, description, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          card
        );
      }
      console.log('✓ Default RFID cards successfully seeded.');
    } else {
      console.log(`rfid_card_master already contains ${existing[0].count} records.`);
    }

    const [rows] = await pool.query('SELECT id, card_name, card_code, card_type, unit_price, status FROM rfid_card_master');
    console.table(rows);

    console.log('--- Migration Completed Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runRfidCardMasterMigration();
