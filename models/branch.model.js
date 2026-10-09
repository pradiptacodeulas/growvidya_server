const { pool } = require('../config/db.config');
const PermissionModel = require('./permission.model');

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
          head_user_id INT(11) DEFAULT NULL,
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
          INDEX idx_branch_code (school_id, branch_code),
          INDEX idx_branch_head (head_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
      `);

      // Ensure branch_master has head_user_id column
      try {
        const [bCols] = await pool.query(`SHOW COLUMNS FROM \`branch_master\``);
        const bColNames = bCols.map((c) => c.Field);
        if (!bColNames.includes('head_user_id')) {
          await pool.query(
            `ALTER TABLE \`branch_master\` ADD COLUMN head_user_id INT(11) NULL DEFAULT NULL AFTER branch_code, ADD INDEX idx_branch_head (head_user_id)`
          );
        }
      } catch (headErr) {}

      // Ensure core tables have branch_id column if missing
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
        'student_certificate',
        'trans_route_master',
        'bus_master',
        'hostel_name_master',
        'hostel_room_master',
        'exam_schedule',
        'beneficiary_master',
        'employee_salary',
        'routine',
        'syllabus',
        'assignments',
        'study_materials',
        'student_transport',
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

      // Ensure shared master / config tables have branch_id column (allowing NULL for school-wide defaults)
      const sharedMasterTables = [
        'shift_master',
        'period_master',
        'house_master',
        'days_master',
        'event',
        'holiday',
        'operator_master',
        'certificate_template',
        'certificate_category',
        'settings_salary_date',
      ];

      for (const tableName of sharedMasterTables) {
        try {
          const [cols] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
          const colNames = cols.map((c) => c.Field);

          if (!colNames.includes('branch_id')) {
            await pool.query(
              `ALTER TABLE \`${tableName}\` ADD COLUMN branch_id INT(11) NULL DEFAULT NULL AFTER school_id`
            );
            await pool.query(
              `ALTER TABLE \`${tableName}\` ADD INDEX idx_${tableName}_branch (school_id, branch_id)`
            );
          }
        } catch (masterErr) {
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

      // Synchronize main branches missing head_user_id with the school's superadmin user
      try {
        await pool.query(`
          UPDATE branch_master bm
          INNER JOIN user_master um ON um.school_id = bm.school_id AND um.admin_type = 1
          SET bm.head_user_id = um.id, bm.updated_at = NOW()
          WHERE bm.is_main_branch = 1 AND bm.head_user_id IS NULL
        `);
      } catch (headSyncErr) {}

      // Synchronize any user records having mismatched/cross-school branch_id to their school's main branch
      try {
        await pool.query(`
          UPDATE user_master u
          LEFT JOIN branch_master bm ON u.branch_id = bm.id
          JOIN (
            SELECT school_id, id AS main_branch_id
            FROM branch_master
            WHERE is_main_branch = 1
          ) mb ON mb.school_id = u.school_id
          SET u.branch_id = mb.main_branch_id
          WHERE u.branch_id IS NOT NULL AND (bm.school_id IS NULL OR bm.school_id != u.school_id)
        `);
      } catch (userBranchSyncErr) {}
    } catch (err) {
      console.error('[BranchModel] Error initializing branch_master schema:', err.message);
    }
  }

  /**
   * Get all branches for a school
   */
  static async getAllBranches({ school_id, status = null }) {
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

    let sql = `
      SELECT 
        b.id,
        b.school_id,
        b.branch_name,
        b.branch_code,
        b.head_user_id,
        u.admin_type AS head_admin_type,
        NULLIF(TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))), '') AS head_name,
        u.email AS head_email,
        u.phone AS head_phone,
        u.picture AS head_picture,
        r.role_name AS head_role,
        COALESCE(NULLIF(TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))), ''), b.principal_name) AS principal_name,
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
        b.is_main_branch,
        b.status,
        b.created_at,
        b.updated_at
      FROM branch_master b
      LEFT JOIN user_master u ON b.head_user_id = u.id
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN countries co ON b.country_id = co.id
      LEFT JOIN states s ON b.state_id = s.id_state
      LEFT JOIN cities ct ON b.city_id = ct.id
      WHERE b.school_id = ?
    `;

    const params = [parsedSchoolId];

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
  static async getBranchById(id, school_id) {
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

    const sql = `
      SELECT 
        b.id,
        b.school_id,
        b.branch_name,
        b.branch_code,
        b.head_user_id,
        u.admin_type AS head_admin_type,
        NULLIF(TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))), '') AS head_name,
        u.email AS head_email,
        u.phone AS head_phone,
        u.picture AS head_picture,
        r.role_name AS head_role,
        COALESCE(NULLIF(TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))), ''), b.principal_name) AS principal_name,
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
        b.is_main_branch,
        b.status,
        b.created_at,
        b.updated_at
      FROM branch_master b
      LEFT JOIN user_master u ON b.head_user_id = u.id
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN countries co ON b.country_id = co.id
      LEFT JOIN states s ON b.state_id = s.id_state
      LEFT JOIN cities ct ON b.city_id = ct.id
      WHERE b.id = ? AND b.school_id = ?
      LIMIT 1
    `;
    const [rows] = await pool.query(sql, [Number(id), parsedSchoolId]);
    return rows[0] || null;
  }

  /**
   * Create a new branch
   */
  static async createBranch({
    school_id,
    branch_name,
    branch_code,
    head_user_id = null,
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
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

    const resolvedHeadUserId = head_user_id ? Number(head_user_id) : null;
    let resolvedPrincipalName = principal_name;
    if (!resolvedPrincipalName && resolvedHeadUserId) {
      try {
        const [uRows] = await pool.query(
          'SELECT CONCAT(IFNULL(first_name, ""), " ", IFNULL(last_name, "")) AS name FROM user_master WHERE id = ?',
          [resolvedHeadUserId]
        );
        if (uRows[0]?.name?.trim()) resolvedPrincipalName = uRows[0].name.trim();
      } catch (_) {}
    }

    // If setting as main branch, reset other branches
    if (Number(is_main_branch) === 1) {
      await pool.execute(
        `UPDATE branch_master SET is_main_branch = 0 WHERE school_id = ?`,
        [parsedSchoolId]
      );
    }

    const sql = `
      INSERT INTO branch_master (
        school_id, branch_name, branch_code, head_user_id, address, country_id, state_id, city_id,
        pincode, phone, email, principal_name, is_main_branch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.execute(sql, [
      parsedSchoolId,
      String(branch_name).trim(),
      String(branch_code).trim().toUpperCase(),
      resolvedHeadUserId,
      address || null,
      country_id !== undefined && country_id !== null && country_id !== '' ? Number(country_id) : null,
      state_id !== undefined && state_id !== null && state_id !== '' ? Number(state_id) : null,
      city_id !== undefined && city_id !== null && city_id !== '' ? Number(city_id) : null,
      pincode || null,
      phone || null,
      email || null,
      resolvedPrincipalName || null,
      Number(is_main_branch) === 1 ? 1 : 0,
      status !== undefined ? Number(status) : 1,
    ]);

    // Assign head user's branch_id and assign Branch Head role in user_master
    if (resolvedHeadUserId) {
      try {
        const branchHeadRoleId = await PermissionModel.ensureBranchHeadRole(parsedSchoolId);
        await pool.query(
          'UPDATE user_master SET branch_id = ?, role = ?, admin_type = 2 WHERE id = ? AND school_id = ?',
          [result.insertId, branchHeadRoleId, resolvedHeadUserId, parsedSchoolId]
        );
      } catch (headErr) {
        console.error('[BranchModel] Error assigning branch head role:', headErr.message);
      }
    }

    return {
      id: result.insertId,
      school_id: parsedSchoolId,
      branch_name,
      branch_code: String(branch_code).trim().toUpperCase(),
      head_user_id: resolvedHeadUserId,
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
  static async updateBranch(id, school_id, data = {}) {
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

    const {
      branch_name,
      branch_code,
      head_user_id,
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
        [parsedSchoolId, Number(id)]
      );
    }

    const updates = [];
    const params = [];

    if (branch_name !== undefined) {
      updates.push('branch_name = ?');
      params.push(String(branch_name).trim());
    }
    if (branch_code !== undefined) {
      updates.push('branch_code = ?');
      params.push(String(branch_code).trim().toUpperCase());
    }
    if (head_user_id !== undefined) {
      const resolvedHead = head_user_id ? Number(head_user_id) : null;
      updates.push('head_user_id = ?');
      params.push(resolvedHead);

      // Handle Head User assignment and revert previous head
      try {
        const branchHeadRoleId = await PermissionModel.ensureBranchHeadRole(parsedSchoolId);

        const [oldRows] = await pool.query(
          'SELECT head_user_id FROM branch_master WHERE id = ? AND school_id = ?',
          [Number(id), parsedSchoolId]
        );
        const oldHeadUserId = oldRows[0]?.head_user_id ? Number(oldRows[0].head_user_id) : null;

        if (oldHeadUserId && oldHeadUserId !== resolvedHead) {
          // Revert old head's role if they were assigned the Branch Head role
          const [fallbackRoles] = await pool.query(
            `SELECT id FROM role_master WHERE (school_id = ? OR school_id IS NULL) AND LOWER(TRIM(role_name)) != 'branch head' AND (status = 1 OR status IS NULL) ORDER BY id ASC LIMIT 1`,
            [parsedSchoolId]
          );
          const fallbackRoleId = fallbackRoles[0]?.id || 2;
          await pool.query(
            'UPDATE user_master SET role = ?, admin_type = 2 WHERE id = ? AND school_id = ? AND role = ?',
            [fallbackRoleId, oldHeadUserId, parsedSchoolId, branchHeadRoleId]
          );
        }

        if (resolvedHead) {
          // Assign Branch Head role and lock to this branch
          await pool.query(
            'UPDATE user_master SET branch_id = ?, role = ?, admin_type = 2 WHERE id = ? AND school_id = ?',
            [Number(id), branchHeadRoleId, resolvedHead, parsedSchoolId]
          );
        }
      } catch (headErr) {
        console.error('[BranchModel] Error updating head user roles:', headErr.message);
      }
    }
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(address || null);
    }
    if (country_id !== undefined) {
      updates.push('country_id = ?');
      params.push(country_id ? Number(country_id) : null);
    }
    if (state_id !== undefined) {
      updates.push('state_id = ?');
      params.push(state_id ? Number(state_id) : null);
    }
    if (city_id !== undefined) {
      updates.push('city_id = ?');
      params.push(city_id ? Number(city_id) : null);
    }
    if (pincode !== undefined) {
      updates.push('pincode = ?');
      params.push(pincode || null);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone || null);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email || null);
    }
    if (principal_name !== undefined) {
      updates.push('principal_name = ?');
      params.push(principal_name || null);
    } else if (head_user_id) {
      try {
        const [uRows] = await pool.query(
          'SELECT CONCAT(IFNULL(first_name, ""), " ", IFNULL(last_name, "")) AS name FROM user_master WHERE id = ?',
          [Number(head_user_id)]
        );
        if (uRows[0]?.name?.trim()) {
          updates.push('principal_name = ?');
          params.push(uRows[0].name.trim());
        }
      } catch (_) {}
    }
    if (is_main_branch !== undefined) {
      updates.push('is_main_branch = ?');
      params.push(Number(is_main_branch) === 1 ? 1 : 0);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(Number(status));
    }

    if (updates.length === 0) return true;

    const sql = `UPDATE branch_master SET ${updates.join(', ')} WHERE id = ? AND school_id = ?`;
    params.push(Number(id), parsedSchoolId);

    const [result] = await pool.execute(sql, params);
    return result.affectedRows > 0;
  }

  /**
   * Get active staff users who can be assigned as branch heads
   */
  static async getBranchHeadCandidates(school_id) {
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

    const sql = `
      SELECT 
        u.id,
        u.school_id,
        u.branch_id,
        bm.branch_name,
        u.first_name,
        u.last_name,
        CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) AS full_name,
        u.email,
        u.phone,
        u.picture,
        u.admin_type,
        r.role_name
      FROM user_master u
      LEFT JOIN branch_master bm ON u.branch_id = bm.id
      LEFT JOIN role_master r ON u.role = r.id
      WHERE u.school_id = ? AND u.status = 1 AND (u.admin_type IS NULL OR u.admin_type != 1)
      ORDER BY u.first_name ASC, u.last_name ASC
    `;
    const [rows] = await pool.query(sql, [parsedSchoolId]);
    return rows;
  }

  /**
   * Set a branch as the main campus
   */
  static async setMainBranch(id, school_id) {
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

    await pool.execute(`UPDATE branch_master SET is_main_branch = 0 WHERE school_id = ?`, [
      parsedSchoolId,
    ]);
    const [result] = await pool.execute(
      `UPDATE branch_master SET is_main_branch = 1 WHERE id = ? AND school_id = ?`,
      [Number(id), parsedSchoolId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Soft delete a branch with safety check (sets status = 4)
   */
  static async deleteBranch(id, school_id) {
    const parsedId = Number(id);
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

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

    // Revert head user role back if assigned
    if (branch.head_user_id) {
      try {
        const branchHeadRoleId = await PermissionModel.ensureBranchHeadRole(parsedSchoolId);
        const [fallbackRoles] = await pool.query(
          `SELECT id FROM role_master WHERE (school_id = ? OR school_id IS NULL) AND LOWER(TRIM(role_name)) != 'branch head' AND (status = 1 OR status IS NULL) ORDER BY id ASC LIMIT 1`,
          [parsedSchoolId]
        );
        const fallbackRoleId = fallbackRoles[0]?.id || 2;
        await pool.query(
          'UPDATE user_master SET role = ?, admin_type = 2 WHERE id = ? AND school_id = ? AND role = ?',
          [fallbackRoleId, branch.head_user_id, parsedSchoolId, branchHeadRoleId]
        );
      } catch (_) {}
    }

    return result.affectedRows > 0;
  }

  /**
   * Get branches summary with student, teacher, and class counts for dashboard/reporting
   */
  static async getBranchesSummary(school_id) {
    const parsedSchoolId = Number(school_id);
    if (!parsedSchoolId) {
      throw new Error('Valid school_id is required.');
    }

    const [branches] = await pool.query(
      `SELECT 
        b.id,
        b.branch_name,
        b.branch_code,
        b.head_user_id,
        u.admin_type AS head_admin_type,
        NULLIF(TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))), '') AS head_name,
        u.email AS head_email,
        u.phone AS head_phone,
        u.picture AS head_picture,
        r.role_name AS head_role,
        COALESCE(NULLIF(TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))), ''), b.principal_name) AS principal_name,
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
        b.is_main_branch,
        b.status,
        b.created_at,
        COALESCE(st.student_count, 0) AS student_count,
        COALESCE(t.teacher_count, 0) AS teacher_count,
        COALESCE(c.class_count, 0) AS class_count
      FROM branch_master b
      LEFT JOIN user_master u ON b.head_user_id = u.id
      LEFT JOIN role_master r ON u.role = r.id
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
