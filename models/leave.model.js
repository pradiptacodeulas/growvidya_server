const { pool } = require('../config/db.config');
const { hardDeleteFile } = require('../utils/file.util');

class LeaveModel {
  /**
   * Fetch all applied leaves with applicant details, role designation, and accurate date/status counts
   */
  static async getAllLeaves(schoolId, { name, role, staff_id, date, status, branchId = null } = {}) {
    let sql = `
      SELECT 
        l.id,
        l.school_id,
        l.branch_id,
        l.role,
        CASE 
          WHEN l.role = 1 THEN 'Teacher'
          ELSE COALESCE(NULLIF(TRIM(r.role_name), ''), 'Staff')
        END AS role_label,
        r.role_name AS staff_role_name,
        l.staff_id,
        l.leave_id,
        lm.leave_name,
        COALESCE(lm.is_paid, 1) AS is_paid,
        l.duration,
        CASE 
          WHEN l.duration = 1 THEN 'Full Day'
          WHEN l.duration = 2 THEN 'Half Day'
          WHEN l.duration = 3 THEN 'Multiple'
          ELSE 'Full Day'
        END AS duration_label,
        l.document,
        l.leave_reason,
        COALESCE(
          (
            SELECT 
              CASE 
                WHEN COUNT(CASE WHEN ld.status = 1 THEN 1 END) > 0 THEN 1
                WHEN COUNT(CASE WHEN ld.status = 2 THEN 1 END) = COUNT(*) THEN 2
                WHEN COUNT(CASE WHEN ld.status = 3 THEN 1 END) = COUNT(*) THEN 3
                WHEN COUNT(CASE WHEN ld.status = 2 THEN 1 END) > 0 THEN 2
                ELSE MIN(ld.status)
              END
            FROM leaves_date ld 
            WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0
          ),
          l.status
        ) AS leave_status,
        (SELECT COUNT(*) FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0) AS total_dates_count,
        (SELECT COUNT(*) FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status = 2) AS approved_dates_count,
        (SELECT COUNT(*) FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status = 3) AS rejected_dates_count,
        (SELECT COUNT(*) FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status = 1) AS pending_dates_count,
        l.created_at,
        DATE_FORMAT(l.created_at, '%Y-%m-%d') AS created_date,
        COALESCE(
          (SELECT DATE_FORMAT(MIN(ld.date), '%Y-%m-%d') FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0),
          DATE_FORMAT(l.created_at, '%Y-%m-%d')
        ) AS leave_date,
        (SELECT GROUP_CONCAT(DATE_FORMAT(ld.date, '%Y-%m-%d') ORDER BY ld.date ASC SEPARATOR ',') 
         FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0) AS leave_dates_str,
        CASE
          WHEN l.role = 1 THEN TRIM(CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')))
          ELSE TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')))
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
      LEFT JOIN role_master r ON (l.role = 2 AND u.role = r.id)
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
    if (staff_id) {
      sql += ` AND l.staff_id = ?`;
      params.push(Number(staff_id));
    }
    if (status !== undefined && status !== '') {
      sql += ` AND COALESCE(
        (
          SELECT 
            CASE 
              WHEN COUNT(CASE WHEN ld.status = 1 THEN 1 END) > 0 THEN 1
              WHEN COUNT(CASE WHEN ld.status = 2 THEN 1 END) = COUNT(*) THEN 2
              WHEN COUNT(CASE WHEN ld.status = 3 THEN 1 END) = COUNT(*) THEN 3
              WHEN COUNT(CASE WHEN ld.status = 2 THEN 1 END) > 0 THEN 2
              ELSE MIN(ld.status)
            END
          FROM leaves_date ld 
          WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0
        ),
        l.status
      ) = ?`;
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
        EXISTS (SELECT 1 FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.date = ? AND ld.status != 4 AND ld.status != 0) OR
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
        CASE 
          WHEN l.role = 1 THEN 'Teacher'
          ELSE COALESCE(NULLIF(TRIM(r.role_name), ''), 'Staff')
        END AS role_label,
        r.role_name AS staff_role_name,
        l.staff_id,
        l.leave_id,
        lm.leave_name,
        COALESCE(lm.is_paid, 1) AS is_paid,
        l.duration,
        CASE 
          WHEN l.duration = 1 THEN 'Full Day'
          WHEN l.duration = 2 THEN 'Half Day'
          WHEN l.duration = 3 THEN 'Multiple'
          ELSE 'Full Day'
        END AS duration_label,
        l.document,
        l.leave_reason,
        l.status,
        COALESCE(
          (
            SELECT 
              CASE 
                WHEN COUNT(CASE WHEN ld.status = 1 THEN 1 END) > 0 THEN 1
                WHEN COUNT(CASE WHEN ld.status = 2 THEN 1 END) = COUNT(*) THEN 2
                WHEN COUNT(CASE WHEN ld.status = 3 THEN 1 END) = COUNT(*) THEN 3
                WHEN COUNT(CASE WHEN ld.status = 2 THEN 1 END) > 0 THEN 2
                ELSE MIN(ld.status)
              END
            FROM leaves_date ld 
            WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0
          ),
          l.status
        ) AS leave_status,
        l.created_at,
        DATE_FORMAT(l.created_at, '%Y-%m-%d') AS created_date,
        CASE
          WHEN l.role = 1 THEN TRIM(CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')))
          ELSE TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')))
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
      LEFT JOIN role_master r ON (l.role = 2 AND u.role = r.id)
      WHERE l.id = ? AND l.school_id = ? AND l.status != 4 AND l.status != 0
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

    // Fetch associated dates formatted as YYYY-MM-DD to prevent UTC timezone shifts
    const [dates] = await pool.query(
      `SELECT id, staff_leave_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, status
       FROM leaves_date
       WHERE staff_leave_id = ? AND status != 4 AND status != 0
       ORDER BY date ASC`,
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
      leave.pending_days = quotaInfo.pending_days;
      leave.used_days = quotaInfo.used_days;
      leave.remaining_quota = quotaInfo.remaining_days;
      leave.remaining_approval_quota = quotaInfo.remaining_approval_days;
      leave.is_quota_exceeded = quotaInfo.is_approval_exhausted;
      leave.is_exhausted = quotaInfo.is_exhausted;
    } catch (e) {
      leave.total_quota = 0;
      leave.approved_days = 0;
      leave.pending_days = 0;
      leave.used_days = 0;
      leave.remaining_quota = 0;
      leave.remaining_approval_quota = 0;
      leave.is_quota_exceeded = false;
      leave.is_exhausted = false;
    }

    return leave;
  }

  /**
   * Get quota and usage for a specific staff member and leave type.
   * Tracks both approved (status = 2) and pending (status = 1) leave days so users
   * cannot exceed their allowed leave limit or submit duplicate/excess requests.
   */
  static async getStaffLeaveQuota(schoolId, role, staffId, leaveId) {
    // 1. Get quota from leave_master
    const [typeRows] = await pool.query(
      `SELECT id, role, branch_id, status, leave_name, COALESCE(is_paid, 1) AS is_paid, no_leave
       FROM leave_master
       WHERE id = ? AND (school_id = ? OR ? IS NULL)`,
      [leaveId, schoolId, schoolId]
    );

    const leaveMaster = typeRows && typeRows.length > 0 ? typeRows[0] : null;
    const leaveName = leaveMaster?.leave_name || '';
    const isPaid = Number(leaveMaster?.is_paid !== undefined ? leaveMaster.is_paid : 1);
    const maxQuota = Number(leaveMaster?.no_leave || 0);

    // 2. Calculate approved days (status = 2) and pending days (status = 1)
    // a) From leaves_date
    const [dateQuotaRows] = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN ld.status = 2 THEN (CASE WHEN l.duration = 2 THEN 0.5 ELSE 1 END) ELSE 0 END), 0) AS approved_days,
         COALESCE(SUM(CASE WHEN ld.status = 1 AND l.status IN (1, 2) THEN (CASE WHEN l.duration = 2 THEN 0.5 ELSE 1 END) ELSE 0 END), 0) AS pending_days
       FROM leaves_date ld
       JOIN leaves l ON ld.staff_leave_id = l.id
       WHERE (l.school_id = ? OR ? IS NULL)
         AND l.role = ?
         AND l.staff_id = ?
         AND l.leave_id = ?
         AND l.status != 4 AND l.status != 0
         AND ld.status != 4 AND ld.status != 0`,
      [schoolId, schoolId, Number(role), Number(staffId), Number(leaveId)]
    );

    // b) Plus any leaves that have NO rows in leaves_date (fallback)
    const [standaloneRows] = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN l.status = 2 THEN (CASE WHEN l.duration = 2 THEN 0.5 ELSE 1 END) ELSE 0 END), 0) AS standalone_approved,
         COALESCE(SUM(CASE WHEN l.status = 1 THEN (CASE WHEN l.duration = 2 THEN 0.5 ELSE 1 END) ELSE 0 END), 0) AS standalone_pending
       FROM leaves l
       WHERE (l.school_id = ? OR ? IS NULL)
         AND l.role = ?
         AND l.staff_id = ?
         AND l.leave_id = ?
         AND l.status IN (1, 2)
         AND NOT EXISTS (SELECT 1 FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0)`,
      [schoolId, schoolId, Number(role), Number(staffId), Number(leaveId)]
    );

    const approvedDays =
      Number(dateQuotaRows[0]?.approved_days || 0) +
      Number(standaloneRows[0]?.standalone_approved || 0);
    const pendingDays =
      Number(dateQuotaRows[0]?.pending_days || 0) +
      Number(standaloneRows[0]?.standalone_pending || 0);
    const usedDays = approvedDays + pendingDays;

    const remainingDays = Math.max(0, maxQuota - usedDays);
    const remainingApprovalDays = Math.max(0, maxQuota - approvedDays);

    return {
      leave_exists: Boolean(leaveMaster),
      leave_status: Number(leaveMaster?.status || 0),
      leave_role: Number(leaveMaster?.role || 0),
      leave_branch_id: leaveMaster?.branch_id || null,
      leave_name: leaveName,
      is_paid: isPaid,
      max_quota: maxQuota,
      approved_days: approvedDays,
      pending_days: pendingDays,
      used_days: usedDays,
      remaining_days: remainingDays,
      remaining_approval_days: remainingApprovalDays,
      is_exhausted: maxQuota > 0 && usedDays >= maxQuota,
      is_approval_exhausted: maxQuota > 0 && approvedDays >= maxQuota,
    };
  }

  /**
   * Check for duplicate leave applications on the requested dates.
   * Prevents applying for leave on any date where the applicant already has an active (pending/approved) leave.
   * Returns { hasDuplicate: boolean, duplicates: Array<{ leave_date, leave_name, leave_id, leave_status }> }
   */
  static async checkDuplicateLeave(schoolId, { role, staff_id, dates = [] }) {
    if (!Array.isArray(dates) || dates.length === 0) {
      return { hasDuplicate: false, duplicates: [] };
    }

    const normalizedDates = [...new Set(dates.map((d) => String(d).split('T')[0]).filter(Boolean))];
    if (normalizedDates.length === 0) {
      return { hasDuplicate: false, duplicates: [] };
    }

    const placeholders = normalizedDates.map(() => '?').join(',');

    // 1) Check existing active dates in leaves_date
    const sql = `
      SELECT 
        DATE_FORMAT(ld.date, '%Y-%m-%d') AS leave_date,
        lm.leave_name,
        l.id AS leave_id,
        l.status AS leave_status,
        ld.status AS date_status
      FROM leaves_date ld
      JOIN leaves l ON ld.staff_leave_id = l.id
      LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
      WHERE (l.school_id = ? OR ? IS NULL)
        AND l.role = ?
        AND l.staff_id = ?
        AND DATE(ld.date) IN (${placeholders})
        AND l.status IN (1, 2)
        AND ld.status IN (1, 2)
      ORDER BY ld.date ASC
    `;

    const params = [schoolId, schoolId, Number(role), Number(staff_id), ...normalizedDates];
    const [rows] = await pool.query(sql, params);

    // 2) Check any standalone leaves without leaves_date rows
    const fallbackSql = `
      SELECT 
        DATE_FORMAT(l.created_at, '%Y-%m-%d') AS leave_date,
        lm.leave_name,
        l.id AS leave_id,
        l.status AS leave_status,
        l.status AS date_status
      FROM leaves l
      LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
      WHERE (l.school_id = ? OR ? IS NULL)
        AND l.role = ?
        AND l.staff_id = ?
        AND DATE(l.created_at) IN (${placeholders})
        AND l.status IN (1, 2)
        AND NOT EXISTS (SELECT 1 FROM leaves_date ld WHERE ld.staff_leave_id = l.id AND ld.status != 4 AND ld.status != 0)
      ORDER BY l.created_at ASC
    `;
    const [fallbackRows] = await pool.query(fallbackSql, params);

    const allDuplicates = [...(rows || []), ...(fallbackRows || [])];
    return {
      hasDuplicate: allDuplicates.length > 0,
      duplicates: allDuplicates,
    };
  }

  /**
   * Apply / Create Leave
   */
  static async createLeave(schoolId, { role, staff_id, leave_id, duration, document, leave_reason, dates = [], branch_id = null }) {
    const uniqueDates = [...new Set((dates || []).map((d) => String(d).split('T')[0]).filter(Boolean))].sort();

    // Enforce quota validation before inserting
    const quota = await LeaveModel.getStaffLeaveQuota(schoolId, Number(role), Number(staff_id), Number(leave_id));
    if (!quota.leave_exists || quota.leave_status !== 1) {
      const err = new Error('Selected leave type is invalid or inactive.');
      err.statusCode = 400;
      throw err;
    }

    if (quota.max_quota > 0) {
      let requestedDays = 1;
      if (Number(duration) === 2) {
        requestedDays = 0.5;
      } else if (Number(duration) === 3 && uniqueDates.length > 0) {
        requestedDays = uniqueDates.length;
      }

      if (quota.used_days >= quota.max_quota || quota.remaining_days <= 0) {
        const err = new Error(
          `Cannot apply for leave: The allowed limit of ${quota.max_quota} day(s) for "${quota.leave_name}" has already been used (Approved: ${quota.approved_days}, Pending: ${quota.pending_days}, Remaining: 0).`
        );
        err.statusCode = 400;
        throw err;
      }

      if ((quota.used_days + requestedDays) > quota.max_quota) {
        const err = new Error(
          `Cannot apply for leave: Requested duration (${requestedDays} day(s)) exceeds the remaining leave balance of ${quota.remaining_days} day(s) for "${quota.leave_name}" (Allowed Limit: ${quota.max_quota}, Used/Applied: ${quota.used_days}, Remaining: ${quota.remaining_days}).`
        );
        err.statusCode = 400;
        throw err;
      }
    }

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
    if (uniqueDates.length > 0) {
      for (const d of uniqueDates) {
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
   * Returns applicant and leave decision details for notification dispatch.
   */
  static async updateLeaveStatus(schoolId, leaveId, status, branchId = null) {
    const targetStatus = Number(status);

    let checkSql = `
      SELECT 
        l.id,
        l.school_id,
        l.role,
        l.staff_id,
        l.leave_id,
        lm.leave_name,
        l.duration,
        l.status,
        l.branch_id,
        DATE_FORMAT(l.created_at, '%Y-%m-%d') AS created_date,
        CASE
          WHEN l.role = 1 THEN TRIM(CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')))
          ELSE TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')))
        END AS person_name
      FROM leaves l
      LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
      LEFT JOIN teacher_master t ON (l.role = 1 AND l.staff_id = t.id AND t.school_id = l.school_id)
      LEFT JOIN user_master u ON (l.role = 2 AND l.staff_id = u.id AND u.school_id = l.school_id)
      WHERE l.id = ? AND (l.school_id = ? OR ? IS NULL) AND l.status != 4 AND l.status != 0
    `;
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
        `SELECT id, status FROM leaves_date WHERE staff_leave_id = ? AND status != 2 AND status != 4 AND status != 0`,
        [leaveId]
      );

      const dayWeight = Number(leaveRecord.duration) === 2 ? 0.5 : 1;
      const additionalDays =
        nonApprovedDates && nonApprovedDates.length > 0
          ? nonApprovedDates.length * dayWeight
          : Number(leaveRecord.status) !== 2
          ? dayWeight
          : 0;

      if (additionalDays > 0) {
        const quota = await LeaveModel.getStaffLeaveQuota(
          leaveRecord.school_id || schoolId,
          leaveRecord.role,
          leaveRecord.staff_id,
          leaveRecord.leave_id
        );

        if (quota.max_quota > 0 && (quota.approved_days + additionalDays) > quota.max_quota) {
          const err = new Error(
            `Cannot approve leave: Approving ${additionalDays} day(s) would exceed the maximum quota of ${quota.max_quota} day(s) for "${quota.leave_name}". (Already approved: ${quota.approved_days} day(s), Available for approval: ${quota.remaining_approval_days} day(s)).`
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

    // Also update all active dates for this leave request
    await pool.query(
      `UPDATE leaves_date SET status = ? WHERE staff_leave_id = ? AND (school_id = ? OR ? IS NULL) AND status != 4 AND status != 0`,
      [targetStatus, leaveId, schoolId, schoolId]
    );

    const [dateRows] = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date FROM leaves_date WHERE staff_leave_id = ? AND status != 4 AND status != 0 ORDER BY date ASC`,
      [leaveId]
    );
    const dateStrings = (dateRows || []).map((r) => r.date).filter(Boolean);

    return {
      leaveId: Number(leaveRecord.id),
      school_id: leaveRecord.school_id || schoolId,
      branch_id: leaveRecord.branch_id || branchId,
      role: Number(leaveRecord.role),
      staff_id: Number(leaveRecord.staff_id),
      leave_id: Number(leaveRecord.leave_id),
      leave_name: leaveRecord.leave_name || '',
      duration: Number(leaveRecord.duration),
      status: targetStatus,
      previousStatus: Number(leaveRecord.status),
      overallStatus: targetStatus,
      person_name: (leaveRecord.person_name || '').trim(),
      dates: dateStrings.length > 0 ? dateStrings : [leaveRecord.created_date].filter(Boolean),
    };
  }

  /**
   * Update Single Leave Date Status
   * Returns applicant and date decision details for notification dispatch.
   */
  static async updateLeaveDateStatus(schoolId, leaveDateId, status, branchId = null) {
    const targetStatus = Number(status);

    let dateSql = `
      SELECT 
        ld.id,
        ld.staff_leave_id,
        DATE_FORMAT(ld.date, '%Y-%m-%d') AS formatted_date,
        ld.status AS date_status,
        l.school_id,
        l.role,
        l.staff_id,
        l.leave_id,
        lm.leave_name,
        l.duration,
        l.branch_id,
        CASE
          WHEN l.role = 1 THEN TRIM(CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')))
          ELSE TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')))
        END AS person_name
      FROM leaves_date ld
      JOIN leaves l ON ld.staff_leave_id = l.id
      LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
      LEFT JOIN teacher_master t ON (l.role = 1 AND l.staff_id = t.id AND t.school_id = l.school_id)
      LEFT JOIN user_master u ON (l.role = 2 AND l.staff_id = u.id AND u.school_id = l.school_id)
      WHERE ld.id = ? AND (ld.school_id = ? OR ? IS NULL) AND ld.status != 4 AND ld.status != 0
    `;
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
            `Cannot approve leave date: Maximum quota of ${quota.max_quota} day(s) for "${quota.leave_name}" has already been reached. (Already approved: ${quota.approved_days} day(s), Available for approval: ${quota.remaining_approval_days} day(s)).`
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

    const leaveId = dateRecord.staff_leave_id;
    let overallStatus = targetStatus;
    let totalDates = 1;
    let approvedDates = targetStatus === 2 ? 1 : 0;
    let rejectedDates = targetStatus === 3 ? 1 : 0;
    let pendingDates = targetStatus === 1 ? 1 : 0;

    // Check all dates for this leave and sync parent leave status accurately
    const [allDates] = await pool.query(
      `SELECT status FROM leaves_date WHERE staff_leave_id = ? AND status != 4 AND status != 0`,
      [leaveId]
    );

    if (allDates && allDates.length > 0) {
      totalDates = allDates.length;
      approvedDates = allDates.filter((d) => Number(d.status) === 2).length;
      rejectedDates = allDates.filter((d) => Number(d.status) === 3).length;
      pendingDates = allDates.filter((d) => Number(d.status) === 1).length;

      if (pendingDates > 0) {
        overallStatus = 1;
      } else if (rejectedDates === totalDates) {
        overallStatus = 3;
      } else if (approvedDates > 0) {
        overallStatus = 2;
      } else {
        overallStatus = 1;
      }

      await pool.query(
        `UPDATE leaves SET status = ? WHERE id = ? AND (school_id = ? OR ? IS NULL)`,
        [overallStatus, leaveId, schoolId, schoolId]
      );
    }

    return {
      leaveId: Number(leaveId),
      leaveDateId: Number(leaveDateId),
      date: dateRecord.formatted_date,
      school_id: dateRecord.school_id || schoolId,
      branch_id: dateRecord.branch_id || branchId,
      role: Number(dateRecord.role),
      staff_id: Number(dateRecord.staff_id),
      leave_id: Number(dateRecord.leave_id),
      leave_name: dateRecord.leave_name || '',
      duration: Number(dateRecord.duration),
      status: targetStatus,
      previousStatus: Number(dateRecord.date_status),
      overallStatus,
      person_name: (dateRecord.person_name || '').trim(),
      totalDates,
      approvedDates,
      rejectedDates,
      pendingDates,
    };
  }

  /**
   * Get Leave Types (from leave_master)
   * When staffId is provided, filters by the staff member's branch and enriches each type
   * with the staff member's used/approved/pending/remaining leave balance.
   */
  static async getLeaveTypes(schoolId, role = null, branchId = null, { staffId = null, activeOnly = false } = {}) {
    let effectiveBranchId = branchId && branchId !== 'all' ? Number(branchId) : null;

    if (staffId) {
      try {
        if (Number(role) === 1) {
          const [tRows] = await pool.query(
            'SELECT branch_id FROM teacher_master WHERE id = ? AND (school_id = ? OR ? IS NULL) LIMIT 1',
            [Number(staffId), schoolId, schoolId]
          );
          if (tRows && tRows[0]?.branch_id) {
            effectiveBranchId = Number(tRows[0].branch_id);
          }
        } else if (Number(role) === 2) {
          const [uRows] = await pool.query(
            'SELECT branch_id FROM user_master WHERE id = ? AND (school_id = ? OR ? IS NULL) LIMIT 1',
            [Number(staffId), schoolId, schoolId]
          );
          if (uRows && uRows[0]?.branch_id) {
            effectiveBranchId = Number(uRows[0].branch_id);
          }
        }
      } catch (_) {}
    }

    let sql = `
      SELECT 
        lm.id, 
        lm.school_id, 
        lm.branch_id,
        bm.branch_name,
        bm.branch_code,
        lm.role, 
        CASE WHEN lm.role = 1 THEN 'Teacher' ELSE 'Staff' END AS role_label,
        lm.leave_name, 
        lm.need_document, 
        COALESCE(lm.is_paid, 1) AS is_paid,
        lm.no_leave, 
        lm.sort_order, 
        lm.status 
      FROM leave_master lm
      LEFT JOIN branch_master bm ON lm.branch_id = bm.id
      WHERE lm.school_id = ? AND lm.status != 4 AND lm.status != 0
    `;
    const params = [schoolId];

    if (activeOnly || staffId) {
      sql += ` AND lm.status = 1`;
    }

    if (effectiveBranchId) {
      sql += ` AND (lm.branch_id = ? OR lm.branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    if (role) {
      sql += ` AND lm.role = ?`;
      params.push(Number(role));
    }

    sql += ` ORDER BY lm.role ASC, lm.sort_order ASC, lm.id ASC`;
    const [rows] = await pool.query(sql, params);
    const list = rows || [];

    if (!staffId) {
      return list;
    }

    const enriched = await Promise.all(
      list.map(async (t) => {
        const quota = await LeaveModel.getStaffLeaveQuota(
          schoolId,
          Number(role || t.role || 1),
          Number(staffId),
          t.id
        );
        return {
          ...t,
          max_quota: quota.max_quota,
          approved_leaves: quota.approved_days,
          pending_leaves: quota.pending_days,
          used_leaves: quota.used_days,
          remaining_leaves: quota.remaining_days,
          is_exhausted: quota.is_exhausted,
        };
      })
    );

    return enriched;
  }

  /**
   * Get Staff/Teachers options based on role
   */
  static async getStaffByRole(schoolId, role, branchId = null) {
    if (Number(role) === 1) {
      // Teachers: show only active (status = 1)
      let sql = `
        SELECT 
          id,
          branch_id,
          teacher_id AS code,
          TRIM(CONCAT(IFNULL(first_name, ''), ' ', IFNULL(last_name, ''))) AS name,
          'Teacher' AS role_name,
          picture,
          gender,
          status
        FROM teacher_master
        WHERE school_id = ? AND status = 1
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY first_name ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } else {
      // Staff (user_master joined with role_master): show only active (status = 1)
      let sql = `
        SELECT 
          u.id,
          u.branch_id,
          TRIM(CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))) AS name,
          r.role_name,
          u.picture,
          u.gender,
          u.status
        FROM user_master u
        LEFT JOIN role_master r ON u.role = r.id
        WHERE u.school_id = ? AND u.status = 1
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (u.branch_id = ? OR u.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY u.first_name ASC`;
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
        CASE WHEN lm.role = 1 THEN 'Teacher' ELSE 'Staff' END AS role_label,
        lm.leave_name, 
        lm.need_document, 
        COALESCE(lm.is_paid, 1) AS is_paid,
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
            `INSERT INTO leave_master (school_id, branch_id, role, leave_name, need_document, is_paid, no_leave, sort_order, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              schoolId,
              finalBranchId,
              role,
              row.leave_name.trim(),
              Number(row.need_document || 0),
              row.is_paid !== undefined ? Number(row.is_paid) : 1,
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
      const { role, leave_name, need_document, is_paid, no_leave, sort_order, status } = data;
      await checkDuplicate(leave_name, Number(role || 1));

      const [res] = await pool.query(
        `INSERT INTO leave_master (school_id, branch_id, role, leave_name, need_document, is_paid, no_leave, sort_order, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          finalBranchId,
          Number(role || 1),
          leave_name ? String(leave_name).trim() : '',
          Number(need_document || 0),
          is_paid !== undefined ? Number(is_paid) : 1,
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
  static async updateLeaveType(schoolId, id, { role, leave_name, need_document, is_paid, no_leave, sort_order, status, branch_id = null }, branchId = null) {
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

    let sql = `UPDATE leave_master SET role = ?, leave_name = ?, need_document = ?, is_paid = ?, no_leave = ?, sort_order = ?, status = ?`;
    const params = [
      Number(role || 1),
      leave_name ? String(leave_name).trim() : '',
      Number(need_document || 0),
      is_paid !== undefined ? Number(is_paid) : 1,
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
   * Delete / Soft Delete Applied Leave (status = 4) and clean up B2 document
   */
  static async deleteLeave(schoolId, id, branchId = null) {
    let selectSql = `SELECT id, document FROM leaves WHERE id = ? AND school_id = ? AND status != 4`;
    const selectParams = [id, schoolId];
    if (branchId) {
      selectSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      selectParams.push(Number(branchId));
    }
    const [existingRows] = await pool.query(selectSql + ' LIMIT 1', selectParams);
    const oldDocument = existingRows?.[0]?.document || null;

    let sql = `UPDATE leaves SET status = 4, document = NULL WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [delResult] = await pool.query(sql, params);
    await pool.query(
      `UPDATE leaves_date SET status = 4 WHERE staff_leave_id = ? AND school_id = ?`,
      [id, schoolId]
    );

    if (delResult.affectedRows > 0 && oldDocument) {
      await hardDeleteFile(oldDocument, { schoolId: Number(schoolId) }).catch((err) =>
        console.error('[LeaveModel.deleteLeave] Error deleting B2 leave document:', err.message)
      );
    }

    return true;
  }
}

module.exports = LeaveModel;
