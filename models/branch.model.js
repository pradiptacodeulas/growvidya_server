const { pool } = require('../config/db.config');

class BranchModel {
  /**
   * Initialize table and ensure core tables have branch_id column and default main branch
   */
  static async initTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS branch_master (
          id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
          school_id INT(11) NOT NULL DEFAULT 1,
          branch_name VARCHAR(255) NOT NULL,
          branch_code VARCHAR(50) NOT NULL,
          address TEXT DEFAULT NULL,
          country_id INT(11) DEFAULT NULL,
          state_id INT(11) DEFAULT NULL,
          city_id INT(11) DEFAULT NULL,
          pincode VARCHAR(20) DEFAULT NULL,
          phone VARCHAR(50) DEFAULT NULL,
          email VARCHAR(100) DEFAULT NULL,
          principal_name VARCHAR(150) DEFAULT NULL,
          is_main_branch TINYINT(1) NOT NULL DEFAULT 0,
          status INT(11) NOT NULL DEFAULT 1 COMMENT '1 = Active, 2 = Inactive, 4 = Deleted',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_branch_school (school_id, status),
          INDEX idx_branch_code (school_id, branch_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
      `);

      // 1. Seed a default "Main Campus" for any school in school_master that doesn't have any branches yet
      try {
        const [schoolsWithoutBranch] = await pool.query(`
          SELECT s.id, s.school_name, s.school_code, s.email, s.phone_number, s.address, s.country, s.state, s.city, s.postal_code 
          FROM school_master s
          LEFT JOIN branch_master b ON s.id = b.school_id
          WHERE b.id IS NULL
        `);

        for (const sch of schoolsWithoutBranch) {
          const code = (sch.school_code || 'MAIN').toUpperCase();
          await pool.query(
            `INSERT INTO branch_master (
              school_id, branch_name, branch_code, address, country_id, state_id, city_id,
              pincode, phone, email, is_main_branch, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
            [
              sch.id,
              `${sch.school_name || 'Growvidya School'} (Main Campus)`,
              code === 'MAIN' ? 'MAIN-01' : `${code}-MAIN`,
              sch.address || null,
              sch.country || null,
              sch.state || null,
              sch.city || null,
              sch.postal_code || null,
              sch.phone_number || null,
              sch.email || null,
            ]
          );
        }

        // Backfill country_id, state_id, city_id from school_master for any branches currently missing them
        await pool.query(`
          UPDATE branch_master b
          INNER JOIN school_master s ON b.school_id = s.id
          SET b.country_id = COALESCE(b.country_id, s.country),
              b.state_id = COALESCE(b.state_id, s.state),
              b.city_id = COALESCE(b.city_id, s.city),
              b.pincode = COALESCE(b.pincode, s.postal_code)
          WHERE b.country_id IS NULL OR b.state_id IS NULL OR b.city_id IS NULL
        `);
      } catch (seedErr) {
        console.warn('[BranchModel] Note during default branch seeding:', seedErr.message);
      }

      // 2. Helper to add branch_id column to existing core tables if missing
      const tablesToScope = [
        'student_master',
        'teacher_master',
        'staff_master',
        'class_master',
        'section_master',
        'user_master',
        'message',
        'fee_invoices',
        'fee_payments',
        'fee_structures',
        'fee_components',
        'student_attendance',
        'teacher_attendance',
        'user_master_attendance',
        'leaves',
        'notice',
        'student_activity',
      ];

      for (const tableName of tablesToScope) {
        try {
          const [cols] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
          const colNames = cols.map((c) => c.Field);

          if (!colNames.includes('branch_id')) {
            await pool.query(
              `ALTER TABLE \`${tableName}\` ADD COLUMN branch_id INT(11) NULL DEFAULT NULL AFTER school_id`
            );
            // Add index
            await pool.query(
              `ALTER TABLE \`${tableName}\` ADD INDEX idx_${tableName}_branch (school_id, branch_id)`
            );
          }

          // Backfill NULL branch_id to default main branch for that school
          await pool.query(`
            UPDATE \`${tableName}\` t
            INNER JOIN branch_master b ON t.school_id = b.school_id AND b.is_main_branch = 1
            SET t.branch_id = b.id
            WHERE t.branch_id IS NULL OR t.branch_id = 0
          `);
        } catch (colErr) {
          // Table might not exist in all installations
        }
      }

      // Synchronize attendance and invoice records to their respective student's/teacher's branch
      try {
        await pool.query(`
          UPDATE student_attendance sa
          INNER JOIN student_master sm ON sa.student_id = sm.id
          SET sa.branch_id = sm.branch_id
          WHERE sm.branch_id IS NOT NULL AND sa.branch_id != sm.branch_id
        `);
      } catch (syncErr) {}

      try {
        await pool.query(`
          UPDATE fee_invoices fi
          INNER JOIN student_master sm ON fi.student_id = sm.id
          SET fi.branch_id = sm.branch_id
          WHERE sm.branch_id IS NOT NULL AND (fi.branch_id IS NULL OR fi.branch_id != sm.branch_id)
        `);
      } catch (syncErr) {}

      try {
        await pool.query(`
          UPDATE teacher_attendance ta
          INNER JOIN teacher_master tm ON ta.teacher_id = tm.id
          SET ta.branch_id = tm.branch_id
          WHERE tm.branch_id IS NOT NULL AND ta.branch_id != tm.branch_id
        `);
      } catch (syncErr) {}
    } catch (err) {
      console.error('[BranchModel] Error initializing branch_master schema:', err.message);
    }
  }

  /**
   * Get all branches for a school
   */
  static async getAllBranches({ school_id = 1, status = null }) {
    let sql = `
      SELECT 
        b.id,
        b.school_id,
        b.branch_name,
        b.branch_code,
        b.address,
        b.country_id,
        b.state_id,
        b.city_id,
        co.name AS country,
        s.state AS state,
        ct.name AS city,
        b.pincode,
        b.phone,
        b.email,
        b.principal_name,
        b.is_main_branch,
        b.status,
        b.created_at,
        b.updated_at
      FROM branch_master b
      LEFT JOIN countries co ON b.country_id = co.id
      LEFT JOIN states s ON b.state_id = s.id_state
      LEFT JOIN cities ct ON b.city_id = ct.id
      WHERE b.school_id = ?
    `;

    const params = [Number(school_id) || 1];

    if (status !== null && status !== undefined && status !== '') {
      sql += ` AND b.status = ?`;
      params.push(Number(status));
    } else {
      sql += ` AND b.status IN (1, 2)`;
    }

    sql += ` ORDER BY b.is_main_branch DESC, b.branch_name ASC`;

    const [rows] = await pool.query(sql, params);
    return rows;
  }

  /**
   * Get single branch by ID
   */
  static async getBranchById(id, school_id = 1) {
    const sql = `
      SELECT 
        b.id,
        b.school_id,
        b.branch_name,
        b.branch_code,
        b.address,
        b.country_id,
        b.state_id,
        b.city_id,
        co.name AS country,
        s.state AS state,
        ct.name AS city,
        b.pincode,
        b.phone,
        b.email,
        b.principal_name,
        b.is_main_branch,
        b.status,
        b.created_at,
        b.updated_at
      FROM branch_master b
      LEFT JOIN countries co ON b.country_id = co.id
      LEFT JOIN states s ON b.state_id = s.id_state
      LEFT JOIN cities ct ON b.city_id = ct.id
      WHERE b.id = ? AND b.school_id = ?
      LIMIT 1
    `;
    const [rows] = await pool.query(sql, [Number(id), Number(school_id) || 1]);
    return rows[0] || null;
  }

  /**
   * Create a new branch
   */
  static async createBranch({
    school_id = 1,
    branch_name,
    branch_code,
    address = null,
    country_id = null,
    state_id = null,
    city_id = null,
    pincode = null,
    phone = null,
    email = null,
    principal_name = null,
    is_main_branch = 0,
    status = 1,
  }) {
    // If setting as main branch, reset other branches
    if (Number(is_main_branch) === 1) {
      await pool.execute(
        `UPDATE branch_master SET is_main_branch = 0 WHERE school_id = ?`,
        [Number(school_id) || 1]
      );
    }

    const sql = `
      INSERT INTO branch_master (
        school_id, branch_name, branch_code, address, country_id, state_id, city_id,
        pincode, phone, email, principal_name, is_main_branch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.execute(sql, [
      Number(school_id) || 1,
      String(branch_name).trim(),
      String(branch_code).trim().toUpperCase(),
      address || null,
      country_id !== undefined && country_id !== null && country_id !== '' ? Number(country_id) : null,
      state_id !== undefined && state_id !== null && state_id !== '' ? Number(state_id) : null,
      city_id !== undefined && city_id !== null && city_id !== '' ? Number(city_id) : null,
      pincode || null,
      phone || null,
      email || null,
      principal_name || null,
      Number(is_main_branch) === 1 ? 1 : 0,
      status !== undefined ? Number(status) : 1,
    ]);

    return {
      id: result.insertId,
      school_id: Number(school_id) || 1,
      branch_name,
      branch_code: String(branch_code).trim().toUpperCase(),
      country_id: country_id ? Number(country_id) : null,
      state_id: state_id ? Number(state_id) : null,
      city_id: city_id ? Number(city_id) : null,
      is_main_branch: Number(is_main_branch) === 1 ? 1 : 0,
      status: status !== undefined ? Number(status) : 1,
    };
  }

  /**
   * Update an existing branch
   */
  static async updateBranch(id, school_id = 1, data = {}) {
    const {
      branch_name,
      branch_code,
      address,
      country_id,
      state_id,
      city_id,
      pincode,
      phone,
      email,
      principal_name,
      is_main_branch,
      status,
    } = data;

    // If setting as main branch, demote all others for this school
    if (Number(is_main_branch) === 1) {
      await pool.execute(
        `UPDATE branch_master SET is_main_branch = 0 WHERE school_id = ? AND id != ?`,
        [Number(school_id) || 1, Number(id)]
      );
    }

    const sql = `
      UPDATE branch_master
      SET 
        branch_name = COALESCE(?, branch_name),
        branch_code = COALESCE(?, branch_code),
        address = COALESCE(?, address),
        country_id = COALESCE(?, country_id),
        state_id = COALESCE(?, state_id),
        city_id = COALESCE(?, city_id),
        pincode = COALESCE(?, pincode),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        principal_name = COALESCE(?, principal_name),
        is_main_branch = COALESCE(?, is_main_branch),
        status = COALESCE(?, status)
      WHERE id = ? AND school_id = ?
    `;

    const [result] = await pool.execute(sql, [
      branch_name ? String(branch_name).trim() : null,
      branch_code ? String(branch_code).trim().toUpperCase() : null,
      address !== undefined ? address : null,
      country_id !== undefined ? (country_id ? Number(country_id) : null) : null,
      state_id !== undefined ? (state_id ? Number(state_id) : null) : null,
      city_id !== undefined ? (city_id ? Number(city_id) : null) : null,
      pincode !== undefined ? pincode : null,
      phone !== undefined ? phone : null,
      email !== undefined ? email : null,
      principal_name !== undefined ? principal_name : null,
      is_main_branch !== undefined ? (Number(is_main_branch) === 1 ? 1 : 0) : null,
      status !== undefined ? Number(status) : null,
      Number(id),
      Number(school_id) || 1,
    ]);

    return result.affectedRows > 0;
  }

  /**
   * Set a branch as the main campus
   */
  static async setMainBranch(id, school_id = 1) {
    await pool.execute(`UPDATE branch_master SET is_main_branch = 0 WHERE school_id = ?`, [
      Number(school_id) || 1,
    ]);
    const [result] = await pool.execute(
      `UPDATE branch_master SET is_main_branch = 1 WHERE id = ? AND school_id = ?`,
      [Number(id), Number(school_id) || 1]
    );
    return result.affectedRows > 0;
  }

  /**
   * Soft delete a branch with safety check (sets status = 4)
   */
  static async deleteBranch(id, school_id = 1) {
    const parsedId = Number(id);
    const parsedSchoolId = Number(school_id) || 1;

    // Check if it's the main branch
    const branch = await BranchModel.getBranchById(parsedId, parsedSchoolId);
    if (!branch) {
      throw new Error('Branch not found.');
    }
    if (branch.is_main_branch === 1) {
      throw new Error('Cannot delete the primary/main campus. Please assign another main campus first.');
    }

    // Check if students exist in this branch
    try {
      const [students] = await pool.query(
        `SELECT COUNT(*) AS total FROM student_master WHERE school_id = ? AND branch_id = ? AND (status = 1 OR status = '1')`,
        [parsedSchoolId, parsedId]
      );
      if (students[0]?.total > 0) {
        throw new Error(
          `Cannot delete branch: ${students[0].total} active student(s) are enrolled in this branch. Transfer them first.`
        );
      }
    } catch (e) {
      if (e.message.includes('Cannot delete branch')) throw e;
    }

    // Check if teachers exist in this branch
    try {
      const [teachers] = await pool.query(
        `SELECT COUNT(*) AS total FROM teacher_master WHERE school_id = ? AND branch_id = ? AND status = 1`,
        [parsedSchoolId, parsedId]
      );
      if (teachers[0]?.total > 0) {
        throw new Error(
          `Cannot delete branch: ${teachers[0].total} active teacher(s) are assigned to this branch.`
        );
      }
    } catch (e) {
      if (e.message.includes('Cannot delete branch')) throw e;
    }

    // Soft delete: update status to 4 (Deleted)
    const [result] = await pool.execute(
      `UPDATE branch_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [parsedId, parsedSchoolId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Get branches summary with student, teacher, and class counts for dashboard/reporting
   */
  static async getBranchesSummary(school_id = 1) {
    const parsedSchoolId = Number(school_id) || 1;

    const [branches] = await pool.query(
      `SELECT 
        b.id,
        b.branch_name,
        b.branch_code,
        b.address,
        b.country_id,
        b.state_id,
        b.city_id,
        co.name AS country,
        s.state AS state,
        ct.name AS city,
        b.pincode,
        b.phone,
        b.email,
        b.principal_name,
        b.is_main_branch,
        b.status,
        b.created_at,
        COALESCE(st.student_count, 0) AS student_count,
        COALESCE(t.teacher_count, 0) AS teacher_count,
        COALESCE(c.class_count, 0) AS class_count
      FROM branch_master b
      LEFT JOIN countries co ON b.country_id = co.id
      LEFT JOIN states s ON b.state_id = s.id_state
      LEFT JOIN cities ct ON b.city_id = ct.id
      LEFT JOIN (
        SELECT branch_id, COUNT(*) AS student_count 
        FROM student_master 
        WHERE school_id = ? AND (status = 1 OR status = '1')
        GROUP BY branch_id
      ) st ON b.id = st.branch_id
      LEFT JOIN (
        SELECT branch_id, COUNT(*) AS teacher_count 
        FROM teacher_master 
        WHERE school_id = ? AND status = 1
        GROUP BY branch_id
      ) t ON b.id = t.branch_id
      LEFT JOIN (
        SELECT branch_id, COUNT(*) AS class_count 
        FROM class_master 
        WHERE school_id = ? AND status = 1
        GROUP BY branch_id
      ) c ON b.id = c.branch_id
      WHERE b.school_id = ? AND b.status IN (1, 2)
      ORDER BY b.is_main_branch DESC, b.branch_name ASC`,
      [parsedSchoolId, parsedSchoolId, parsedSchoolId, parsedSchoolId]
    );

    return branches;
  }

  /**
   * Get all active countries from countries table
   */
  static async getCountries() {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, name AS country_name, shortname AS country_code, phonecode AS phone_code 
         FROM countries 
         WHERE status = 1 OR status IS NULL 
         ORDER BY name ASC`
      );
      return rows;
    } catch (err) {
      console.error('[BranchModel.getCountries] Error:', err.message);
      return [];
    }
  }

  /**
   * Get states for a country from states table
   */
  static async getStates(countryId) {
    if (!countryId) return [];
    try {
      const sql = `
        SELECT s.id_state AS id, s.state, s.state AS name, s.country_id
        FROM states s
        WHERE (s.is_active = 1 OR s.is_active IS NULL)
          AND s.country_id = ?
        ORDER BY s.state ASC
      `;
      const [rows] = await pool.query(sql, [Number(countryId)]);
      return rows;
    } catch (err) {
      console.error('[BranchModel.getStates] Error:', err.message);
      return [];
    }
  }

  /**
   * Get cities for a state from cities table
   */
  static async getCities(stateId) {
    if (!stateId) return [];
    try {
      const sql = `
        SELECT id, name, name AS city, state_id
        FROM cities
        WHERE state_id = ?
        ORDER BY name ASC
      `;
      const [rows] = await pool.query(sql, [Number(stateId)]);
      return rows;
    } catch (err) {
      console.error('[BranchModel.getCities] Error:', err.message);
      return [];
    }
  }
}

module.exports = BranchModel;
