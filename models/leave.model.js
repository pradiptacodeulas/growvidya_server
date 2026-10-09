const { pool } = require('../config/db.config');

class LeaveModel {
  /**
   * Fetch all applied leaves with applicant details and status
   */
  static async getAllLeaves(schoolId, { name, role, date, status, branchId = null } = {}) {
    let sql = `
      SELECT 
        l.id,
        l.school_id,
        l.role,
        CASE 
          WHEN l.role = 1 THEN 'Teacher'
          WHEN l.role = 2 THEN 'User'
          ELSE 'Staff'
        END AS role_label,
        l.staff_id,
        l.leave_id,
        lm.leave_name,
        l.duration,
        CASE 
          WHEN l.duration = 1 THEN 'Full Day'
          WHEN l.duration = 2 THEN 'Half Day'
          WHEN l.duration = 3 THEN 'Multiple'
          ELSE 'Full Day'
        END AS duration_label,
        l.document,
        l.leave_reason,
        l.status AS leave_status,
        l.created_at,
        COALESCE(
          (SELECT MIN(ld.date) FROM leaves_date ld WHERE ld.staff_leave_id = l.id),
          DATE(l.created_at)
        ) AS leave_date,
        CASE
          WHEN l.role = 1 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS person_name,
        CASE
          WHEN l.role = 1 THEN t.gender
          ELSE u.gender
        END AS gender,
        CASE
          WHEN l.role = 1 THEN t.picture
          ELSE u.picture
        END AS person_picture
      FROM leaves l
      LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
      LEFT JOIN teacher_master t ON (l.role = 1 AND l.staff_id = t.id AND t.school_id = l.school_id)
      LEFT JOIN user_master u ON (l.role = 2 AND l.staff_id = u.id AND u.school_id = l.school_id)
      WHERE l.school_id = ? AND l.status != 4 AND l.status != 0
    `;

    const params = [schoolId];

    if (branchId) {
      sql += ` AND (
        (l.branch_id = ?) OR
        (l.branch_id IS NULL AND (
          (l.role = 1 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR
          (l.role = 2 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId));
    }

    if (role) {
      sql += ` AND l.role = ?`;
      params.push(Number(role));
    }
    if (status !== undefined && status !== '') {
      sql += ` AND l.status = ?`;
      params.push(Number(status));
    }
    if (name) {
      sql += ` AND (
        (l.role = 1 AND CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')) LIKE ?) OR
        (l.role = 2 AND CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) LIKE ?)
      )`;
      params.push(`%${name}%`, `%${name}%`);
    }
    if (date) {
      sql += ` AND (
        EXISTS (SELECT 1 FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.date = ?) OR
        DATE(l.created_at) = ?
      )`;
      params.push(date, date);
    }

    sql += ` ORDER BY l.id DESC`;

    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  /**
   * Get single leave details by ID
   */
  static async getLeaveById(schoolId, leaveId, branchId = null) {
    let sql = `
      SELECT 
        l.id,
        l.school_id,
        l.branch_id,
        l.role,
        l.staff_id,
        l.leave_id,
        lm.leave_name,
        l.duration,
        l.document,
        l.leave_reason,
        l.status,
        l.created_at,
        CASE
          WHEN l.role = 1 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS person_name,
        CASE
          WHEN l.role = 1 THEN t.gender
          ELSE u.gender
        END AS gender,
        CASE
          WHEN l.role = 1 THEN t.picture
          ELSE u.picture
        END AS person_picture
      FROM leaves l
      LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
      LEFT JOIN teacher_master t ON (l.role = 1 AND l.staff_id = t.id AND t.school_id = l.school_id)
      LEFT JOIN user_master u ON (l.role = 2 AND l.staff_id = u.id AND u.school_id = l.school_id)
      WHERE l.id = ? AND l.school_id = ?
    `;

    const params = [leaveId, schoolId];
    if (branchId) {
      sql += ` AND (
        (l.branch_id = ?) OR
        (l.branch_id IS NULL AND (
          (l.role = 1 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR
          (l.role = 2 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId));
    }

    const [rows] = await pool.query(sql, params);
    if (!rows || rows.length === 0) return null;

    const leave = rows[0];

    // Fetch associated dates
    const [dates] = await pool.query(
      `SELECT id, staff_leave_id, date, status FROM leaves_date WHERE staff_leave_id = ? ORDER BY date ASC`,
      [leaveId]
    );

    leave.dates = dates || [];

    // Fetch quota details for this staff member and leave type
    try {
      const quotaInfo = await LeaveModel.getStaffLeaveQuota(
        leave.school_id || schoolId,
        leave.role,
        leave.staff_id,
        leave.leave_id
      );
      leave.total_quota = quotaInfo.max_quota;
      leave.approved_days = quotaInfo.approved_days;
      leave.remaining_quota = quotaInfo.remaining_days;
      leave.is_quota_exceeded = quotaInfo.max_quota > 0 && quotaInfo.approved_days >= quotaInfo.max_quota;
    } catch (e) {
      leave.total_quota = 0;
      leave.approved_days = 0;
      leave.remaining_quota = 0;
      leave.is_quota_exceeded = false;
    }

    return leave;
  }

  /**
   * Get quota and usage for a specific staff member and leave type
   */
  static async getStaffLeaveQuota(schoolId, role, staffId, leaveId) {
    // 1. Get quota from leave_master
    const [typeRows] = await pool.query(
      `SELECT id, leave_name, no_leave FROM leave_master WHERE id = ? AND (school_id = ? OR ? IS NULL)`,
      [leaveId, schoolId, schoolId]
    );

    const leaveMaster = typeRows && typeRows.length > 0 ? typeRows[0] : null;
    const leaveName = leaveMaster?.leave_name || 'Leave';
    const maxQuota = Number(leaveMaster?.no_leave || 0);

    // 2. Calculate approved days
    // a) From leaves_date where ld.status = 2
    const [approvedRows] = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN l.duration = 2 THEN 0.5 ELSE 1 END), 0) AS approved_days
       FROM leaves_date ld
       JOIN leaves l ON ld.staff_leave_id = l.id
       WHERE (l.school_id = ? OR ? IS NULL)
         AND l.role = ?
         AND l.staff_id = ?
         AND l.leave_id = ?
         AND ld.status = 2
         AND l.status != 4 AND l.status != 0`,
      [schoolId, schoolId, Number(role), Number(staffId), Number(leaveId)]
    );

    // b) Plus any leaves with status = 2 that have NO rows in leaves_date (fallback)
    const [standaloneRows] = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN l.duration = 2 THEN 0.5 ELSE 1 END), 0) AS standalone_approved
       FROM leaves l
       WHERE (l.school_id = ? OR ? IS NULL)
         AND l.role = ?
         AND l.staff_id = ?
         AND l.leave_id = ?
         AND l.status = 2
         AND l.status != 4 AND l.status != 0
         AND NOT EXISTS (SELECT 1 FROM leaves_date ld WHERE ld.staff_leave_id = l.id)`,
      [schoolId, schoolId, Number(role), Number(staffId), Number(leaveId)]
    );

    const approvedDays = Number(approvedRows[0]?.approved_days || 0) + Number(standaloneRows[0]?.standalone_approved || 0);
    const remainingDays = Math.max(0, maxQuota - approvedDays);

    return {
      leave_name: leaveName,
      max_quota: maxQuota,
      approved_days: approvedDays,
      remaining_days: remainingDays,
      is_exhausted: maxQuota > 0 && approvedDays >= maxQuota,
    };
  }

  /**
   * Apply / Create Leave
   */
  static async createLeave(schoolId, { role, staff_id, leave_id, duration, document, leave_reason, dates = [], branch_id = null }) {
    let resolvedBranchId = branch_id ? Number(branch_id) : null;
    if (!resolvedBranchId) {
      try {
        if (Number(role) === 1) {
          const [t] = await pool.query('SELECT branch_id FROM teacher_master WHERE id = ? LIMIT 1', [staff_id]);
          if (t && t[0]?.branch_id) resolvedBranchId = t[0].branch_id;
        } else {
          const [u] = await pool.query('SELECT branch_id FROM user_master WHERE id = ? LIMIT 1', [staff_id]);
          if (u && u[0]?.branch_id) resolvedBranchId = u[0].branch_id;
        }
      } catch (_) {}
    }

    const [result] = await pool.query(
      `INSERT INTO leaves (school_id, branch_id, role, staff_id, leave_id, duration, document, leave_reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        schoolId,
        resolvedBranchId,
        Number(role),
        Number(staff_id),
        Number(leave_id),
        Number(duration),
        document || null,
        leave_reason || '',
      ]
    );

    const leaveId = result.insertId;

    // Insert date breakdown
    if (Array.isArray(dates) && dates.length > 0) {
      for (const d of dates) {
        if (d) {
          await pool.query(
            `INSERT INTO leaves_date (school_id, branch_id, staff_leave_id, date, status)
             VALUES (?, ?, ?, ?, 1)`,
            [schoolId, resolvedBranchId, leaveId, d]
          );
        }
      }
    }

    return leaveId;
  }

  /**
   * Update Overall Leave Status (1=Pending, 2=Approved, 3=Rejected)
   */
  static async updateLeaveStatus(schoolId, leaveId, status, branchId = null) {
    const targetStatus = Number(status);

    let checkSql = `SELECT l.id, l.school_id, l.role, l.staff_id, l.leave_id, l.duration, l.status, l.branch_id
         FROM leaves l
         WHERE l.id = ? AND (l.school_id = ? OR ? IS NULL)`;
    const checkParams = [leaveId, schoolId, schoolId];
    if (branchId) {
      checkSql += ` AND (l.branch_id = ? OR l.branch_id IS NULL)`;
      checkParams.push(Number(branchId));
    }
    const [leaveRows] = await pool.query(checkSql, checkParams);

    if (!leaveRows || leaveRows.length === 0) {
      const err = new Error('Leave record not found.');
      err.statusCode = 404;
      throw err;
    }

    const leaveRecord = leaveRows[0];

    if (targetStatus === 2) {
      // Find dates that are not yet approved
      const [nonApprovedDates] = await pool.query(
        `SELECT id, status FROM leaves_date WHERE staff_leave_id = ? AND status != 2`,
        [leaveId]
      );

      const dayWeight = Number(leaveRecord.duration) === 2 ? 0.5 : 1;
      const additionalDays = nonApprovedDates && nonApprovedDates.length > 0 
        ? nonApprovedDates.length * dayWeight 
        : (Number(leaveRecord.status) !== 2 ? dayWeight : 0);

      if (additionalDays > 0) {
        const quota = await LeaveModel.getStaffLeaveQuota(
          leaveRecord.school_id || schoolId,
          leaveRecord.role,
          leaveRecord.staff_id,
          leaveRecord.leave_id
        );

        if (quota.max_quota > 0 && (quota.approved_days + additionalDays) > quota.max_quota) {
          const err = new Error(
            `Cannot approve leave: Approving ${additionalDays} day(s) would exceed the maximum quota of ${quota.max_quota} day(s) for "${quota.leave_name}". (Already approved: ${quota.approved_days} day(s), Available: ${quota.remaining_days} day(s)).`
          );
          err.statusCode = 400;
          throw err;
        }
      }
    }

    let updateSql = `UPDATE leaves SET status = ? WHERE id = ? AND (school_id = ? OR ? IS NULL)`;
    const updateParams = [targetStatus, leaveId, schoolId, schoolId];
    if (branchId) {
      updateSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      updateParams.push(Number(branchId));
    }
    await pool.query(updateSql, updateParams);

    // Also update all dates for this leave request
    await pool.query(
      `UPDATE leaves_date SET status = ? WHERE staff_leave_id = ? AND (school_id = ? OR ? IS NULL)`,
      [targetStatus, leaveId, schoolId, schoolId]
    );

    return true;
  }

  /**
   * Update Single Leave Date Status
   */
  static async updateLeaveDateStatus(schoolId, leaveDateId, status, branchId = null) {
    const targetStatus = Number(status);

    let dateSql = `SELECT ld.id, ld.staff_leave_id, ld.status AS date_status,
                l.school_id, l.role, l.staff_id, l.leave_id, l.duration, l.branch_id
         FROM leaves_date ld
         JOIN leaves l ON ld.staff_leave_id = l.id
         WHERE ld.id = ? AND (ld.school_id = ? OR ? IS NULL)`;
    const dateParams = [leaveDateId, schoolId, schoolId];
    if (branchId) {
      dateSql += ` AND (l.branch_id = ? OR l.branch_id IS NULL)`;
      dateParams.push(Number(branchId));
    }
    const [dateRows] = await pool.query(dateSql, dateParams);

    if (!dateRows || dateRows.length === 0) {
      const err = new Error('Leave date record not found.');
      err.statusCode = 404;
      throw err;
    }

    const dateRecord = dateRows[0];

    // If approving, enforce quota restriction
    if (targetStatus === 2) {
      // If not already approved, check if adding this date exceeds quota
      if (Number(dateRecord.date_status) !== 2) {
        const dateWeight = Number(dateRecord.duration) === 2 ? 0.5 : 1;
        const quota = await LeaveModel.getStaffLeaveQuota(
          dateRecord.school_id || schoolId,
          dateRecord.role,
          dateRecord.staff_id,
          dateRecord.leave_id
        );

        if (quota.max_quota > 0 && (quota.approved_days + dateWeight) > quota.max_quota) {
          const err = new Error(
            `Cannot approve leave date: Maximum quota of ${quota.max_quota} days for "${quota.leave_name}" has already been reached. (Already approved: ${quota.approved_days} day(s), Quota: ${quota.max_quota} day(s)).`
          );
          err.statusCode = 400;
          throw err;
        }
      }
    }

    await pool.query(
      `UPDATE leaves_date SET status = ? WHERE id = ? AND (school_id = ? OR ? IS NULL)`,
      [targetStatus, leaveDateId, schoolId, schoolId]
    );

    // Check if dates have been decided and sync parent leave status
    const [row] = await pool.query(`SELECT staff_leave_id FROM leaves_date WHERE id = ?`, [leaveDateId]);
    if (row && row.length > 0) {
      const leaveId = row[0].staff_leave_id;
      const [allDates] = await pool.query(`SELECT status FROM leaves_date WHERE staff_leave_id = ?`, [leaveId]);

      if (allDates && allDates.length > 0) {
        if (allDates.every((d) => Number(d.status) === 2)) {
          await pool.query(`UPDATE leaves SET status = 2 WHERE id = ? AND (school_id = ? OR ? IS NULL)`, [leaveId, schoolId, schoolId]);
        } else if (allDates.every((d) => Number(d.status) === 3)) {
          await pool.query(`UPDATE leaves SET status = 3 WHERE id = ? AND (school_id = ? OR ? IS NULL)`, [leaveId, schoolId, schoolId]);
        } else if (allDates.some((d) => Number(d.status) === 2)) {
          await pool.query(`UPDATE leaves SET status = 2 WHERE id = ? AND (school_id = ? OR ? IS NULL)`, [leaveId, schoolId, schoolId]);
        } else if (allDates.some((d) => Number(d.status) === 1)) {
          await pool.query(`UPDATE leaves SET status = 1 WHERE id = ? AND (school_id = ? OR ? IS NULL)`, [leaveId, schoolId, schoolId]);
        }
      }
    }

    return true;
  }

  /**
   * Get Leave Types (from leave_master)
   */
  static async getLeaveTypes(schoolId, role = null, branchId = null) {
    let sql = `
      SELECT 
        lm.id, 
        lm.school_id, 
        lm.branch_id,
        bm.branch_name,
        bm.branch_code,
        lm.role, 
        CASE WHEN lm.role = 1 THEN 'Teacher' ELSE 'User' END AS role_label,
        lm.leave_name, 
        lm.need_document, 
        lm.no_leave, 
        lm.sort_order, 
        lm.status 
      FROM leave_master lm
      LEFT JOIN branch_master bm ON lm.branch_id = bm.id
      WHERE lm.school_id = ? AND lm.status != 4 AND lm.status != 0
    `;
    const params = [schoolId];

    if (branchId && branchId !== 'all') {
      sql += ` AND (lm.branch_id = ? OR lm.branch_id IS NULL)`;
      params.push(Number(branchId));
    }

    if (role) {
      sql += ` AND lm.role = ?`;
      params.push(Number(role));
    }

    sql += ` ORDER BY lm.role ASC, lm.sort_order ASC, lm.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  /**
   * Get Staff/Teachers options based on role
   */
  static async getStaffByRole(schoolId, role, branchId = null) {
    if (Number(role) === 1) {
      // Teachers
      let sql = `SELECT id, teacher_id AS code, CONCAT(IFNULL(first_name, ''), ' ', IFNULL(last_name, '')) AS name, picture, gender
         FROM teacher_master
         WHERE school_id = ? AND status != 0 AND status != 4`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY first_name ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } else {
      // Users / Staff
      let sql = `SELECT id, CONCAT(IFNULL(first_name, ''), ' ', IFNULL(last_name, '')) AS name, picture, gender
         FROM user_master
         WHERE school_id = ? AND status != 0 AND status != 4`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY first_name ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    }
  }

  /**
   * Get Leave Type by ID
   */
  static async getLeaveTypeById(schoolId, id, branchId = null) {
    let sql = `
      SELECT 
        lm.id, 
        lm.school_id, 
        lm.branch_id,
        bm.branch_name,
        bm.branch_code,
        lm.role, 
        lm.leave_name, 
        lm.need_document, 
        lm.no_leave, 
        lm.sort_order, 
        lm.status 
      FROM leave_master lm
      LEFT JOIN branch_master bm ON lm.branch_id = bm.id
      WHERE lm.id = ? AND lm.school_id = ? AND lm.status != 4 AND lm.status != 0
    `;
    const params = [id, schoolId];
    if (branchId && branchId !== 'all') {
      sql += ` AND (lm.branch_id = ? OR lm.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` LIMIT 1`;
    const [rows] = await pool.query(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create Leave Type Master (Single or Batch)
   */
  static async createLeaveType(schoolId, data, branchId = null) {
    let finalBranchId = (data.branch_id && data.branch_id !== 'all')
      ? Number(data.branch_id)
      : ((data.branchId && data.branchId !== 'all') ? Number(data.branchId) : ((branchId && branchId !== 'all') ? Number(branchId) : null));

    if (!finalBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC, id ASC LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) finalBranchId = mainB[0].id;
      } catch (e) {}
    }

    const checkDuplicate = async (leaveName, roleVal) => {
      if (!leaveName || !String(leaveName).trim()) return;
      let dupSql = `SELECT id FROM leave_master WHERE school_id = ? AND role = ? AND LOWER(TRIM(leave_name)) = LOWER(TRIM(?)) AND status != 4 AND status != 0`;
      const dupParams = [schoolId, Number(roleVal), String(leaveName).trim()];
      if (finalBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(finalBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A leave assignment named "${leaveName}" already exists for this role in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    };

    if (Array.isArray(data.leaveRows) && data.leaveRows.length > 0) {
      const role = Number(data.role || 1);
      for (const row of data.leaveRows) {
        if (row.leave_name && row.leave_name.trim()) {
          await checkDuplicate(row.leave_name, role);
        }
      }

      const ids = [];
      for (const row of data.leaveRows) {
        if (row.leave_name && row.leave_name.trim()) {
          const [res] = await pool.query(
            `INSERT INTO leave_master (school_id, branch_id, role, leave_name, need_document, no_leave, sort_order, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              schoolId,
              finalBranchId,
              role,
              row.leave_name.trim(),
              Number(row.need_document || 0),
              Number(row.no_leave || 1),
              Number(row.sort_order || 1),
              row.status !== undefined ? Number(row.status) : 1,
            ]
          );
          ids.push(res.insertId);
        }
      }
      return ids;
    } else {
      const { role, leave_name, need_document, no_leave, sort_order, status } = data;
      await checkDuplicate(leave_name, Number(role || 1));

      const [res] = await pool.query(
        `INSERT INTO leave_master (school_id, branch_id, role, leave_name, need_document, no_leave, sort_order, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          finalBranchId,
          Number(role || 1),
          leave_name ? String(leave_name).trim() : '',
          Number(need_document || 0),
          Number(no_leave || 0),
          Number(sort_order || 1),
          status !== undefined ? Number(status) : 1,
        ]
      );
      return res.insertId;
    }
  }

  /**
   * Update Leave Type Master
   */
  static async updateLeaveType(schoolId, id, { role, leave_name, need_document, no_leave, sort_order, status, branch_id = null }, branchId = null) {
    let targetBranchId = (branch_id && branch_id !== 'all')
      ? Number(branch_id)
      : ((branchId && branchId !== 'all') ? Number(branchId) : null);

    // Branch-aware duplicate check on update
    if (leave_name && String(leave_name).trim()) {
      let dupSql = `SELECT id FROM leave_master WHERE school_id = ? AND role = ? AND LOWER(TRIM(leave_name)) = LOWER(TRIM(?)) AND id != ? AND status != 4 AND status != 0`;
      const dupParams = [schoolId, Number(role || 1), String(leave_name).trim(), id];
      if (targetBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(targetBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another leave assignment named "${leave_name}" already exists for this role in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE leave_master SET role = ?, leave_name = ?, need_document = ?, no_leave = ?, sort_order = ?, status = ?`;
    const params = [
      Number(role || 1),
      leave_name ? String(leave_name).trim() : '',
      Number(need_document || 0),
      Number(no_leave || 0),
      Number(sort_order || 1),
      status !== undefined ? Number(status) : 1,
    ];
    if (targetBranchId) {
      sql += `, branch_id = ?`;
      params.push(targetBranchId);
    }
    sql += ` WHERE id = ? AND school_id = ?`;
    params.push(id, schoolId);

    if (branchId && branchId !== 'all') {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }

    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete / Soft Delete Leave Type Master (status = 4)
   */
  static async deleteLeaveType(schoolId, id, branchId = null) {
    let sql = `UPDATE leave_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId && branchId !== 'all') {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete / Soft Delete Applied Leave (status = 4)
   */
  static async deleteLeave(schoolId, id, branchId = null) {
    let sql = `UPDATE leaves SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    await pool.query(
      `UPDATE leaves_date SET status = 4 WHERE staff_leave_id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  }
}

module.exports = LeaveModel;
