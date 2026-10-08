const { pool } = require('../config/db.config');

async function migrate() {
  try {
    // 1. Add registration_type to school_master if missing
    const [cols1] = await pool.query('SHOW COLUMNS FROM school_master LIKE "registration_type"');
    if (cols1.length === 0) {
      await pool.query(
        "ALTER TABLE `school_master` ADD COLUMN `registration_type` ENUM('single', 'multiple') NOT NULL DEFAULT 'single' AFTER `medium_of_instruction`"
      );
      console.log('Successfully added registration_type column to school_master.');
    } else {
      console.log('registration_type column already exists in school_master.');
    }

    // 2. Add storage_plan_id to school_subscriptions if missing
    const [cols2] = await pool.query('SHOW COLUMNS FROM school_subscriptions LIKE "storage_plan_id"');
    if (cols2.length === 0) {
      await pool.query(
        "ALTER TABLE `school_subscriptions` ADD COLUMN `storage_plan_id` INT(11) NULL DEFAULT NULL AFTER `plan_id`"
      );
      console.log('Successfully added storage_plan_id column to school_subscriptions.');
    } else {
      console.log('storage_plan_id column already exists in school_subscriptions.');
    }

    // Set School 1 to multiple since it has multiple branches
    await pool.query("UPDATE school_master SET registration_type = 'multiple' WHERE id = 1");
    console.log('School 1 updated to registration_type = multiple');

    const [schools] = await pool.query('SELECT id, school_name, registration_type FROM school_master');
    console.log('All schools:', schools);
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrate();
