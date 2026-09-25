const { pool } = require('../config/db.config');

async function runAttendanceMachineMasterMigration() {
  try {
    console.log('--- Starting Attendance Machine Master Migration ---');

    // 1. Create attendance_machine_master table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_machine_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        machine_name VARCHAR(150) NOT NULL COMMENT 'e.g. ZKTeco MB20, eSSL K90 Pro',
        model_number VARCHAR(60) NOT NULL UNIQUE COMMENT 'Unique hardware model/SKU',
        brand VARCHAR(100) NOT NULL COMMENT 'e.g. ZKTeco, eSSL, Realtime, Mantra',
        machine_type ENUM('fingerprint', 'face_recognition', 'rfid_card', 'hybrid', 'turnstile') NOT NULL DEFAULT 'hybrid',
        connectivity VARCHAR(100) DEFAULT 'LAN, Wi-Fi' COMMENT 'e.g. Wi-Fi, LAN, 4G SIM, USB',
        user_capacity INT DEFAULT 1000 COMMENT 'Max registered faces/fingerprints/cards',
        log_capacity INT DEFAULT 100000 COMMENT 'Max stored attendance punch records',
        push_protocol VARCHAR(50) DEFAULT 'Cloud Push' COMMENT 'e.g. ADMS, MQTT, REST Webhook',
        unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Hardware cost in INR',
        amc_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Optional annual maintenance/support cost',
        machine_image VARCHAR(255) DEFAULT NULL COMMENT 'Product thumbnail/image',
        specifications TEXT DEFAULT NULL COMMENT 'Technical datasheet, display size, battery backup',
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_machine_status (status),
        INDEX idx_machine_type (machine_type),
        INDEX idx_machine_brand (brand)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ attendance_machine_master table verified/created.');

    // 2. Create school_attendance_machines table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_attendance_machines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL COMMENT 'References school_master.id',
        branch_id INT DEFAULT NULL COMMENT 'References branch_master.id',
        machine_master_id INT NOT NULL COMMENT 'References attendance_machine_master.id',
        device_serial_number VARCHAR(100) NOT NULL COMMENT 'Unique device serial from sticker/box',
        device_location VARCHAR(100) DEFAULT 'Main Gate' COMMENT 'e.g. Main Gate, Staff Room, Library',
        ip_address VARCHAR(50) DEFAULT NULL,
        port INT DEFAULT 4370,
        status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Online/Active, 0 = Offline/Disabled',
        last_sync_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_school_device_serial (school_id, device_serial_number),
        INDEX idx_school_machine (school_id),
        CONSTRAINT fk_school_device_master FOREIGN KEY (machine_master_id) 
          REFERENCES attendance_machine_master (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ school_attendance_machines table verified/created.');

    // 3. Register SaaS module in saas_modules
    try {
      const [tableCheck] = await pool.query(`
        SELECT TABLE_NAME FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_modules'
      `);
      if (tableCheck.length > 0) {
        await pool.query(`
          INSERT INTO saas_modules (module_key, module_name, description, display_order, status)
          VALUES ('attendance_machines', 'Attendance Machines Master', 'Manage biometric, face recognition, and RFID attendance hardware models', 10, 1)
          ON DUPLICATE KEY UPDATE 
            module_name = VALUES(module_name),
            description = VALUES(description),
            display_order = VALUES(display_order)
        `);
        console.log('✓ saas_modules updated with attendance_machines entry.');

        // Give Super Admin full permissions on attendance_machines
        const [superAdminRoles] = await pool.query(`
          SELECT id FROM saas_roles WHERE role_name = 'Super Admin' OR is_system = 1
        `);
        for (const role of superAdminRoles) {
          await pool.query(`
            INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
            VALUES (?, 'attendance_machines', 1, 1, 1, 1, 1)
            ON DUPLICATE KEY UPDATE 
              can_view = 1, can_add = 1, can_edit = 1, can_delete = 1, can_manage = 1
          `, [role.id]);
        }
        console.log('✓ Super Admin role permissions granted for attendance_machines.');
      }
    } catch (permErr) {
      console.warn('Note on saas_modules / permissions:', permErr.message);
    }

    // 4. Seed initial default Attendance Machine models if empty
    const [existing] = await pool.query('SELECT COUNT(*) AS count FROM attendance_machine_master');
    if (existing[0].count === 0) {
      console.log('Seeding standard attendance machine models...');
      const defaultMachines = [
        [
          'ZKTeco MB20 Face & Fingerprint Terminal',
          'ZK-MB20-PRO',
          'ZKTeco',
          'hybrid',
          'Wi-Fi, LAN, USB',
          1000,
          100000,
          'ADMS / Cloud Push',
          14500.00,
          1200.00,
          'Visible light facial recognition with biometric fingerprint and RFID verification. 2.8-inch TFT screen with multi-language voice prompt.',
          1
        ],
        [
          'eSSL K90 Pro Biometric Attendance Machine',
          'ESSL-K90-PRO',
          'eSSL',
          'hybrid',
          'LAN, Wi-Fi, USB',
          800,
          100000,
          'Cloud Push SDK',
          9800.00,
          999.00,
          'Cost-effective fingerprint and RFID smart card time attendance terminal with 2.8-inch color display and built-in battery backup.',
          1
        ],
        [
          'Realtime T52 AI Dynamic Face Terminal',
          'RT-T52-AI',
          'Realtime',
          'face_recognition',
          'Wi-Fi, LAN, 4G SIM',
          3000,
          200000,
          'HTTP Push / REST API',
          22500.00,
          1800.00,
          'Dynamic anti-spoofing live face detection scanner with 5-inch IPS touch screen. Fast 0.2s matching speed from up to 2 meters distance.',
          1
        ],
        [
          'Mantra MFSTAB Smart Android Biometric Terminal',
          'MANTRA-MFSTAB',
          'Mantra',
          'fingerprint',
          'Wi-Fi, 4G SIM, Bluetooth, LAN',
          5000,
          250000,
          'REST API Webhook',
          17900.00,
          1500.00,
          'STQC certified 7-inch Android biometric tablet with optical fingerprint scanner, GPS, and rear camera for school bus and mobile attendance.',
          1
        ],
        [
          'ZKTeco TS2000 Pro Flap Barrier Turnstile RFID Reader',
          'ZK-TS2000-PRO',
          'ZKTeco',
          'turnstile',
          'TCP/IP, RS485, Relay Output',
          10000,
          500000,
          'Cloud Controller Protocol',
          65000.00,
          5000.00,
          'Stainless steel SUS304 tripod turnstile gate integrated with dual-sided RFID readers and emergency drop-arm function.',
          1
        ]
      ];

      for (const machine of defaultMachines) {
        await pool.query(
          `INSERT INTO attendance_machine_master 
           (machine_name, model_number, brand, machine_type, connectivity, user_capacity, log_capacity, push_protocol, unit_price, amc_price, specifications, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          machine
        );
      }
      console.log('✓ Default attendance machines successfully seeded.');
    } else {
      console.log(`attendance_machine_master already contains ${existing[0].count} records.`);
    }

    const [rows] = await pool.query('SELECT id, machine_name, model_number, brand, machine_type, unit_price, status FROM attendance_machine_master');
    console.table(rows);

    console.log('--- Migration Completed Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runAttendanceMachineMasterMigration();
