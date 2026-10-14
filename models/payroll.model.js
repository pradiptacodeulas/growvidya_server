const { pool } = require('../config/db.config');

class PayrollModel {
  static async getAllBeneficiaries(schoolId, { search, branchId = null } = {}) {
    let sql = `
      SELECT 
        bm.id,
        bm.school_id,
        bm.user_type,
        CASE 
          WHEN bm.user_type = 2 THEN 'Teacher'
          WHEN bm.user_type = 3 THEN 'Driver'
          ELSE 'Staff'
        END AS type_name,
        bm.employee_id,
        CASE 
          WHEN bm.user_type = 2 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          WHEN bm.user_type = 3 THEN CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS name,
        bm.basic_salary AS amount,
        CASE 
          WHEN bm.user_type = 2 THEN tb.bank_name
          WHEN bm.user_type = 3 THEN ob.bank_name
          ELSE ub.bank_name
        END AS bank_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_name
          WHEN bm.user_type = 3 THEN ob.account_name
          ELSE ub.account_name
        END AS account_holder_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_number
          WHEN bm.user_type = 3 THEN ob.account_number
          ELSE ub.account_number
        END AS account_number,
        CASE 
          WHEN bm.user_type = 2 THEN tb.ifsc_code
          WHEN bm.user_type = 3 THEN ob.ifsc_code
          ELSE ub.ifsc_code
        END AS ifsc_code,
        CASE 
          WHEN bm.user_type = 2 THEN tb.branch_name
          WHEN bm.user_type = 3 THEN ob.branch_name
          ELSE ub.branch_name
        END AS branch_name,
        bm.status
      FROM beneficiary_master bm
      LEFT JOIN teacher_master t ON bm.user_type = 2 AND bm.employee_id = t.id
      LEFT JOIN teacher_bank tb ON bm.user_type = 2 AND bm.employee_id = tb.teacher_id AND tb.status != 4
      LEFT JOIN operator_master op ON bm.user_type = 3 AND bm.employee_id = op.id AND op.type = 1
      LEFT JOIN operator_bank ob ON bm.user_type = 3 AND bm.employee_id = ob.operator_id AND ob.status != 4
      LEFT JOIN user_master u ON bm.user_type = 1 AND bm.employee_id = u.id
      LEFT JOIN user_bank ub ON bm.user_type = 1 AND bm.employee_id = ub.user_id AND ub.status != 4
      WHERE bm.status != 4 AND bm.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND (
        (bm.branch_id = ?) OR 
        (bm.branch_id IS NULL AND (
          (bm.user_type = 2 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR 
          (bm.user_type = 3 AND (op.branch_id = ? OR op.branch_id IS NULL)) OR 
          (bm.user_type != 2 AND bm.user_type != 3 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId), Number(branchId));
    }

    if (search && search.trim() !== '') {
      sql += ` AND (
        t.first_name LIKE ? OR t.last_name LIKE ? OR 
        op.first_name LIKE ? OR op.last_name LIKE ? OR 
        u.first_name LIKE ? OR u.last_name LIKE ? OR 
        tb.bank_name LIKE ? OR ob.bank_name LIKE ? OR ub.bank_name LIKE ?
      )`;
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q, q, q, q, q, q);
    }

    sql += ` ORDER BY bm.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getBeneficiaryById(schoolId, id, branchId = null) {
    let sql = `
      SELECT 
        bm.id,
        bm.school_id,
        bm.user_type,
        CASE 
          WHEN bm.user_type = 2 THEN 'Teacher'
          WHEN bm.user_type = 3 THEN 'Driver'
          ELSE 'Staff'
        END AS type_name,
        bm.employee_id,
        CASE 
          WHEN bm.user_type = 2 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          WHEN bm.user_type = 3 THEN CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS name,
        bm.basic_salary AS amount,
        CASE 
          WHEN bm.user_type = 2 THEN tb.bank_name
          WHEN bm.user_type = 3 THEN ob.bank_name
          ELSE ub.bank_name
        END AS bank_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_name
          WHEN bm.user_type = 3 THEN ob.account_name
          ELSE ub.account_name
        END AS account_holder_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_number
          WHEN bm.user_type = 3 THEN ob.account_number
          ELSE ub.account_number
        END AS account_number,
        CASE 
          WHEN bm.user_type = 2 THEN tb.ifsc_code
          WHEN bm.user_type = 3 THEN ob.ifsc_code
          ELSE ub.ifsc_code
        END AS ifsc_code,
        CASE 
          WHEN bm.user_type = 2 THEN tb.branch_name
          WHEN bm.user_type = 3 THEN ob.branch_name
          ELSE ub.branch_name
        END AS branch_name,
        bm.status
      FROM beneficiary_master bm
      LEFT JOIN teacher_master t ON bm.user_type = 2 AND bm.employee_id = t.id
      LEFT JOIN teacher_bank tb ON bm.user_type = 2 AND bm.employee_id = tb.teacher_id AND tb.status != 0
      LEFT JOIN operator_master op ON bm.user_type = 3 AND bm.employee_id = op.id AND op.type = 1
      LEFT JOIN operator_bank ob ON bm.user_type = 3 AND bm.employee_id = ob.operator_id AND ob.status != 0
      LEFT JOIN user_master u ON bm.user_type = 1 AND bm.employee_id = u.id
      LEFT JOIN user_bank ub ON bm.user_type = 1 AND bm.employee_id = ub.user_id AND ub.status != 0
      WHERE bm.id = ? AND bm.status != 0 AND bm.school_id = ?
    `;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (
        (bm.branch_id = ?) OR 
        (bm.branch_id IS NULL AND (
          (bm.user_type = 2 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR 
          (bm.user_type = 3 AND (op.branch_id = ? OR op.branch_id IS NULL)) OR 
          (bm.user_type != 2 AND bm.user_type != 3 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId), Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async getBeneficiaryByUserAndEmployee(schoolId, userType, employeeId, excludeId = null) {
    let sql = `SELECT id FROM beneficiary_master WHERE school_id = ? AND user_type = ? AND employee_id = ? AND status != 0`;
    const params = [schoolId, Number(userType), Number(employeeId)];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    sql += ` LIMIT 1`;
    const [rows] = await pool.query(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async createBeneficiary(schoolId, { branch_id = null, user_type, employee_id, basic_salary, bank_name, account_name, account_no, ifsc_code, branch_name, status = 1 }) {
    const sId = schoolId;
    const uType = Number(user_type) || 1;
    const empId = Number(employee_id);

    let resolvedBranchId = branch_id || branchId || null;
    if (!resolvedBranchId && empId) {
      if (uType === 2) {
        const [tm] = await pool.query('SELECT branch_id FROM teacher_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (tm.length && tm[0].branch_id) resolvedBranchId = tm[0].branch_id;
      } else if (uType === 3) {
        const [opm] = await pool.query('SELECT branch_id FROM operator_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (opm.length && opm[0].branch_id) resolvedBranchId = opm[0].branch_id;
      } else {
        const [um] = await pool.query('SELECT branch_id FROM user_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (um.length && um[0].branch_id) resolvedBranchId = um[0].branch_id;
      }
    }

    const [res] = await pool.query(
      `INSERT INTO beneficiary_master (school_id, branch_id, user_type, employee_id, basic_salary, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sId, resolvedBranchId, uType, empId, Number(basic_salary) || 0, status]
    );
    const beneficiaryId = res.insertId;

    // Sync bank details if provided
    if (bank_name || account_name || account_no || ifsc_code || branch_name) {
      if (uType === 2) {
        const [existing] = await pool.query(
          `SELECT id FROM teacher_bank WHERE teacher_id = ? AND school_id = ? LIMIT 1`,
          [empId, sId]
        );
        if (existing && existing.length > 0) {
          await pool.query(
            `UPDATE teacher_bank 
             SET bank_name = ?, account_name = ?, account_number = ?, ifsc_code = ?, branch_name = ?
             WHERE id = ?`,
            [bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '', existing[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO teacher_bank (school_id, branch_id, teacher_id, bank_name, account_name, account_number, ifsc_code, branch_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sId, resolvedBranchId, empId, bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '']
          );
        }
      } else if (uType === 3) {
        const [existing] = await pool.query(
          `SELECT id FROM operator_bank WHERE operator_id = ? AND school_id = ? LIMIT 1`,
          [empId, sId]
        );
        if (existing && existing.length > 0) {
          await pool.query(
            `UPDATE operator_bank 
             SET bank_name = ?, account_name = ?, account_number = ?, ifsc_code = ?, branch_name = ?
             WHERE id = ?`,
            [bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '', existing[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO operator_bank (school_id, branch_id, operator_id, bank_name, account_name, account_number, ifsc_code, branch_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sId, resolvedBranchId, empId, bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '']
          );
        }
      } else {
        const [existing] = await pool.query(
          `SELECT id FROM user_bank WHERE user_id = ? AND school_id = ? LIMIT 1`,
          [empId, sId]
        );
        if (existing && existing.length > 0) {
          await pool.query(
            `UPDATE user_bank 
             SET bank_name = ?, account_name = ?, account_number = ?, ifsc_code = ?, branch_name = ?
             WHERE id = ?`,
            [bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '', existing[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO user_bank (school_id, branch_id, user_id, bank_name, account_name, account_number, ifsc_code, branch_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sId, resolvedBranchId, empId, bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '']
          );
        }
      }
    }
    return beneficiaryId;
  }

  static async updateBeneficiary(schoolId, id, { user_type, employee_id, basic_salary, bank_name, account_name, account_no, ifsc_code, branch_name, status = 1, branch_id = null }, branchId = null) {
    const sId = schoolId;
    const uType = Number(user_type) || 1;
    const empId = Number(employee_id);

    let sql = `UPDATE beneficiary_master 
       SET user_type = ?, employee_id = ?, basic_salary = ?, status = ?`;
    const params = [uType, empId, Number(basic_salary) || 0, status];
    if (branch_id !== undefined && branch_id !== null) {
      sql += `, branch_id = ?`;
      params.push(Number(branch_id));
    }
    sql += ` WHERE id = ? AND school_id = ?`;
    params.push(id, sId);

    const effectiveBranchId = branchId || branch_id;
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    await pool.query(sql, params);

    let resolvedBranchId = effectiveBranchId || null;
    if (!resolvedBranchId && empId) {
      if (uType === 2) {
        const [tm] = await pool.query('SELECT branch_id FROM teacher_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (tm.length && tm[0].branch_id) resolvedBranchId = tm[0].branch_id;
      } else if (uType === 3) {
        const [opm] = await pool.query('SELECT branch_id FROM operator_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (opm.length && opm[0].branch_id) resolvedBranchId = opm[0].branch_id;
      } else {
        const [um] = await pool.query('SELECT branch_id FROM user_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (um.length && um[0].branch_id) resolvedBranchId = um[0].branch_id;
      }
    }

    // Sync bank details if provided
    if (bank_name || account_name || account_no || ifsc_code || branch_name) {
      if (uType === 2) {
        const [existing] = await pool.query(
          `SELECT id FROM teacher_bank WHERE teacher_id = ? AND school_id = ? LIMIT 1`,
          [empId, sId]
        );
        if (existing && existing.length > 0) {
          await pool.query(
            `UPDATE teacher_bank 
             SET bank_name = ?, account_name = ?, account_number = ?, ifsc_code = ?, branch_name = ?
             WHERE id = ?`,
            [bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '', existing[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO teacher_bank (school_id, branch_id, teacher_id, bank_name, account_name, account_number, ifsc_code, branch_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sId, resolvedBranchId, empId, bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '']
          );
        }
      } else if (uType === 3) {
        const [existing] = await pool.query(
          `SELECT id FROM operator_bank WHERE operator_id = ? AND school_id = ? LIMIT 1`,
          [empId, sId]
        );
        if (existing && existing.length > 0) {
          await pool.query(
            `UPDATE operator_bank 
             SET bank_name = ?, account_name = ?, account_number = ?, ifsc_code = ?, branch_name = ?
             WHERE id = ?`,
            [bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '', existing[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO operator_bank (school_id, branch_id, operator_id, bank_name, account_name, account_number, ifsc_code, branch_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sId, resolvedBranchId, empId, bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '']
          );
        }
      } else {
        const [existing] = await pool.query(
          `SELECT id FROM user_bank WHERE user_id = ? AND school_id = ? LIMIT 1`,
          [empId, sId]
        );
        if (existing && existing.length > 0) {
          await pool.query(
            `UPDATE user_bank 
             SET bank_name = ?, account_name = ?, account_number = ?, ifsc_code = ?, branch_name = ?
             WHERE id = ?`,
            [bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '', existing[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO user_bank (school_id, branch_id, user_id, bank_name, account_name, account_number, ifsc_code, branch_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [sId, resolvedBranchId, empId, bank_name || '', account_name || '', account_no || '', ifsc_code || '', branch_name || '']
          );
        }
      }
    }
    return true;
  }

  /**
   * Evaluate whether an employee has added their beneficiary or bank account details
   */
  static evaluateBeneficiaryEligibility(row) {
    const beneficiaryId = row.beneficiary_id ? Number(row.beneficiary_id) : null;
    const beneficiaryStatus = row.beneficiary_status !== undefined && row.beneficiary_status !== null ? Number(row.beneficiary_status) : 0;
    const bankName = String(row.bank_name || '').trim();
    const accountName = String(row.account_name || row.account_holder_name || '').trim();
    const accountNo = String(row.account_no || row.account_number || '').trim();
    const ifscCode = String(row.ifsc_code || '').trim();
    const branchName = String(row.branch_name || '').trim();

    const hasActiveBeneficiary = Boolean(beneficiaryId && beneficiaryStatus === 1);
    const hasBankDetails = Boolean(bankName && accountNo);

    const issues = [];
    if (!hasActiveBeneficiary && !hasBankDetails) {
      issues.push('Beneficiary or bank account details not added');
    }

    const isVerified = hasActiveBeneficiary || hasBankDetails;
    return {
      beneficiary_id: beneficiaryId,
      beneficiary_status: beneficiaryStatus,
      is_beneficiary_verified: isVerified,
      beneficiary_issues: issues,
      bank_name: bankName || null,
      account_name: accountName || null,
      account_no: accountNo || null,
      ifsc_code: ifscCode || null,
      branch_name: branchName || null,
    };
  }

  /**
   * Calculate leave-based salary deduction for an employee in a given month (YYYY-MM)
   * Checks organization leave policies (leave_master.is_paid, leave_master.no_leave) and employee leave records (leaves, leaves_date)
   */
  static async calculateEmployeeLeaveDeduction(schoolId, { user_type, employee_id, salary_month, basic_salary = 0 }) {
    const uType = Number(user_type) || 1;
    const empId = Number(employee_id);
    const baseSalary = Number(basic_salary) || 0;

    // Map payroll user_type (1=Staff, 2=Teacher, 3=Driver) to leaves.role (1=Teacher, 2=Staff, 3=Driver)
    const leaveRole = uType === 2 ? 1 : uType === 1 ? 2 : 3;

    // Parse target year & month from salary_month (YYYY-MM or YYYY-MM-DD)
    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth() + 1;
    if (salary_month && typeof salary_month === 'string') {
      const parts = salary_month.trim().split('-');
      if (parts.length >= 2) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!isNaN(y) && y > 1900 && !isNaN(m) && m >= 1 && m <= 12) {
          targetYear = y;
          targetMonth = m;
        }
      }
    }

    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate() || 30;
    const perDaySalary = baseSalary > 0 ? baseSalary / daysInMonth : 0;

    // 1. Fetch leave dates in the target month from leaves_date joined with leaves and leave_master
    const [dateLeaveRows] = await pool.query(
      `SELECT 
         l.id AS leave_application_id,
         l.leave_id,
         l.duration,
         l.status AS leave_status,
         ld.status AS date_status,
         DATE_FORMAT(ld.date, '%Y-%m-%d') AS leave_date,
         COALESCE(lm.leave_name, 'Leave') AS leave_name,
         COALESCE(lm.is_paid, 1) AS is_paid,
         COALESCE(lm.no_leave, 0) AS max_quota
       FROM leaves_date ld
       JOIN leaves l ON ld.staff_leave_id = l.id
       LEFT JOIN leave_master lm ON l.leave_id = lm.id
       WHERE l.school_id = ?
         AND l.role = ?
         AND l.staff_id = ?
         AND YEAR(ld.date) = ?
         AND MONTH(ld.date) = ?
         AND l.status IN (1, 2)
         AND ld.status IN (1, 2)
       ORDER BY ld.date ASC`,
      [schoolId, leaveRole, empId, targetYear, targetMonth]
    );

    // 2. Also check standalone leaves without leaves_date rows in the target month
    const [standaloneLeaveRows] = await pool.query(
      `SELECT 
         l.id AS leave_application_id,
         l.leave_id,
         l.duration,
         l.status AS leave_status,
         l.status AS date_status,
         DATE_FORMAT(l.created_at, '%Y-%m-%d') AS leave_date,
         COALESCE(lm.leave_name, 'Leave') AS leave_name,
         COALESCE(lm.is_paid, 1) AS is_paid,
         COALESCE(lm.no_leave, 0) AS max_quota
       FROM leaves l
       LEFT JOIN leave_master lm ON l.leave_id = lm.id
       WHERE l.school_id = ?
         AND l.role = ?
         AND l.staff_id = ?
         AND YEAR(l.created_at) = ?
         AND MONTH(l.created_at) = ?
         AND l.status IN (1, 2)
         AND NOT EXISTS (SELECT 1 FROM leaves_date ld WHERE ld.staff_leave_id = l.id)
       ORDER BY l.created_at ASC`,
      [schoolId, leaveRole, empId, targetYear, targetMonth]
    );

    const allMonthLeaveEntries = [...(dateLeaveRows || []), ...(standaloneLeaveRows || [])];

    // 3. For paid leave types (is_paid = 1) with a quota (max_quota > 0), check if cumulative usage prior to this month + this month exceeds quota
    const paidLeaveIdsInMonth = [
      ...new Set(
        allMonthLeaveEntries
          .filter((r) => Number(r.is_paid) === 1 && Number(r.max_quota) > 0 && r.leave_id)
          .map((r) => Number(r.leave_id))
      ),
    ];

    const priorUsedByLeaveType = {};
    const monthEndStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
    for (const leaveTypeId of paidLeaveIdsInMonth) {
      const [priorRows] = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN l.duration = 2 THEN 0.5 ELSE 1 END), 0) AS prior_days
         FROM leaves_date ld
         JOIN leaves l ON ld.staff_leave_id = l.id
         WHERE l.school_id = ?
           AND l.role = ?
           AND l.staff_id = ?
           AND l.leave_id = ?
           AND DATE(ld.date) < ?
           AND l.status = 2
           AND ld.status = 2`,
        [schoolId, leaveRole, empId, leaveTypeId, monthEndStr]
      );
      priorUsedByLeaveType[leaveTypeId] = Number(priorRows[0]?.prior_days || 0);
    }

    let unpaidLeaveDays = 0;
    let paidLeaveDays = 0;
    let primaryLeaveId = null;
    const runningPaidUsage = { ...priorUsedByLeaveType };
    const breakdownMap = {};

    for (const entry of allMonthLeaveEntries) {
      const dayWeight = Number(entry.duration) === 2 ? 0.5 : 1;
      const isPaidType = Number(entry.is_paid) === 1;
      const maxQuota = Number(entry.max_quota || 0);
      const lId = Number(entry.leave_id || 0);
      if (!primaryLeaveId && entry.leave_application_id) {
        primaryLeaveId = entry.leave_application_id;
      }

      let unpaidPortion = 0;
      let paidPortion = 0;
      let deductionReason = '';

      if (!isPaidType) {
        // Organization policy: Non-Paid leave type (is_paid = 0)
        unpaidPortion = dayWeight;
        deductionReason = 'Unpaid Leave Policy';
      } else if (maxQuota > 0) {
        // Paid leave type with quota limit: check if quota is exceeded
        const usedSoFar = runningPaidUsage[lId] || 0;
        const remainingQuota = Math.max(0, maxQuota - usedSoFar);
        if (dayWeight <= remainingQuota) {
          paidPortion = dayWeight;
        } else {
          paidPortion = remainingQuota;
          unpaidPortion = dayWeight - remainingQuota;
          deductionReason = `Exceeded Paid Quota (${maxQuota} days)`;
        }
        runningPaidUsage[lId] = usedSoFar + dayWeight;
      } else {
        paidPortion = dayWeight;
      }

      unpaidLeaveDays += unpaidPortion;
      paidLeaveDays += paidPortion;

      const key = `${lId}_${entry.leave_name}_${isPaidType ? 'paid' : 'unpaid'}`;
      if (!breakdownMap[key]) {
        breakdownMap[key] = {
          leave_id: lId || null,
          leave_application_id: entry.leave_application_id,
          leave_name: entry.leave_name,
          is_paid: isPaidType ? 1 : 0,
          total_days: 0,
          unpaid_days: 0,
          paid_days: 0,
          deduction_amount: 0,
          reason: deductionReason || (isPaidType ? 'Paid Leave' : 'Unpaid Leave'),
          dates: [],
        };
      }
      breakdownMap[key].total_days += dayWeight;
      breakdownMap[key].unpaid_days += unpaidPortion;
      breakdownMap[key].paid_days += paidPortion;
      if (entry.leave_date && !breakdownMap[key].dates.includes(entry.leave_date)) {
        breakdownMap[key].dates.push(entry.leave_date);
      }
    }

    const leaveBreakdown = Object.values(breakdownMap).map((item) => ({
      ...item,
      deduction_amount: Number((item.unpaid_days * perDaySalary).toFixed(2)),
    }));

    const rawDeduction = unpaidLeaveDays * perDaySalary;
    const leaveDeductionAmount = Number(Math.min(baseSalary, rawDeduction).toFixed(2));
    const netSalary = Number(Math.max(0, baseSalary - leaveDeductionAmount).toFixed(2));

    return {
      salary_month: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
      days_in_month: daysInMonth,
      per_day_salary: Number(perDaySalary.toFixed(2)),
      unpaid_leave_days: Number(unpaidLeaveDays),
      paid_leave_days: Number(paidLeaveDays),
      leave_deduction_amount: leaveDeductionAmount,
      net_salary_after_leave: netSalary,
      primary_leave_id: primaryLeaveId,
      leave_breakdown: leaveBreakdown,
    };
  }

  static async getEmployeesByType(schoolId, userType, branchId = null, salaryMonth = null) {
    const sId = schoolId;
    const uType = Number(userType) || 1;
    const targetMonth = salaryMonth || new Date().toISOString().slice(0, 7);

    let rows = [];
    if (uType === 2) {
      // Teachers (Active status = 1)
      let sql = `
        SELECT 
           t.id,
           2 AS user_type,
           'Teacher' AS type_name,
           t.teacher_id AS employee_code,
           CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')) AS name,
           t.branch_id,
           bm.id AS beneficiary_id,
           bm.status AS beneficiary_status,
           COALESCE(NULLIF(bm.basic_salary, 0), tp.basic_salary, 0) AS basic_salary,
           tb.bank_name,
           tb.account_name,
           tb.account_number AS account_no,
           tb.ifsc_code,
           tb.branch_name
         FROM teacher_master t
         LEFT JOIN (
           SELECT id, employee_id, basic_salary, status
           FROM beneficiary_master
           WHERE id IN (
             SELECT MAX(id) FROM beneficiary_master 
             WHERE school_id = ? AND user_type = 2 AND status != 0 AND status != 4 
             GROUP BY employee_id
           )
         ) bm ON bm.employee_id = t.id
         LEFT JOIN (
           SELECT teacher_id, basic_salary 
           FROM teacher_payroll 
           WHERE id IN (SELECT MAX(id) FROM teacher_payroll WHERE status != 0 AND status != 4 GROUP BY teacher_id)
         ) tp ON tp.teacher_id = t.id
         LEFT JOIN (
           SELECT teacher_id, bank_name, account_name, account_number, ifsc_code, branch_name
           FROM teacher_bank
           WHERE id IN (
             SELECT MAX(id) FROM teacher_bank
             WHERE school_id = ? AND status != 0 AND status != 4
             GROUP BY teacher_id
           )
         ) tb ON t.id = tb.teacher_id
         WHERE t.status = 1 AND t.school_id = ?
      `;
      const params = [sId, sId, sId];
      if (branchId) {
        sql += ` AND (t.branch_id = ? OR t.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY t.first_name ASC`;
      const [resRows] = await pool.query(sql, params);
      rows = resRows || [];
    } else if (uType === 3) {
      // Drivers from operator_master (type = 1, active status = 1)
      let sql = `
        SELECT 
           op.id,
           3 AS user_type,
           'Driver' AS type_name,
           CONCAT('DRV-', op.id) AS employee_code,
           CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS name,
           op.branch_id,
           bm.id AS beneficiary_id,
           bm.status AS beneficiary_status,
           IFNULL(bm.basic_salary, 0) AS basic_salary,
           ob.bank_name,
           ob.account_name,
           ob.account_number AS account_no,
           ob.ifsc_code,
           ob.branch_name
         FROM operator_master op
         LEFT JOIN (
           SELECT id, employee_id, basic_salary, status
           FROM beneficiary_master
           WHERE id IN (
             SELECT MAX(id) FROM beneficiary_master 
             WHERE school_id = ? AND user_type = 3 AND status != 0 AND status != 4 
             GROUP BY employee_id
           )
         ) bm ON bm.employee_id = op.id
         LEFT JOIN (
           SELECT operator_id, bank_name, account_name, account_number, ifsc_code, branch_name
           FROM operator_bank
           WHERE id IN (
             SELECT MAX(id) FROM operator_bank
             WHERE school_id = ? AND status != 0 AND status != 4
             GROUP BY operator_id
           )
         ) ob ON op.id = ob.operator_id
         WHERE op.type = 1 AND op.status = 1 AND op.school_id = ?
      `;
      const params = [sId, sId, sId];
      if (branchId) {
        sql += ` AND (op.branch_id = ? OR op.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY op.first_name ASC`;
      const [resRows] = await pool.query(sql, params);
      rows = resRows || [];
    } else {
      // Users / Staff (active status = 1)
      let sql = `
        SELECT 
           u.id,
           1 AS user_type,
           'Staff' AS type_name,
           CONCAT('STF-', u.id) AS employee_code,
           CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) AS name,
           u.branch_id,
           bm.id AS beneficiary_id,
           bm.status AS beneficiary_status,
           IFNULL(bm.basic_salary, 0) AS basic_salary,
           ub.bank_name,
           ub.account_name,
           ub.account_number AS account_no,
           ub.ifsc_code,
           ub.branch_name
         FROM user_master u
         LEFT JOIN (
           SELECT id, employee_id, basic_salary, status
           FROM beneficiary_master
           WHERE id IN (
             SELECT MAX(id) FROM beneficiary_master 
             WHERE school_id = ? AND user_type = 1 AND status != 0 AND status != 4 
             GROUP BY employee_id
           )
         ) bm ON bm.employee_id = u.id
         LEFT JOIN (
           SELECT user_id, bank_name, account_name, account_number, ifsc_code, branch_name
           FROM user_bank
           WHERE id IN (
             SELECT MAX(id) FROM user_bank
             WHERE school_id = ? AND status != 0 AND status != 4
             GROUP BY user_id
           )
         ) ub ON u.id = ub.user_id
         WHERE u.status = 1 AND u.school_id = ?
      `;
      const params = [sId, sId, sId];
      if (branchId) {
        sql += ` AND (u.branch_id = ? OR u.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY u.first_name ASC`;
      const [resRows] = await pool.query(sql, params);
      rows = resRows || [];
    }

    // Fetch existing salary records for the target month to track status per employee
    const [existingSalaries] = await pool.query(
      `SELECT id, user_type, employee_id, payment_status, transaction_id, payment_date, basic_salary, total_deductions, net_salary
       FROM employee_salary
       WHERE school_id = ? AND user_type = ? AND payment_date LIKE ?
       ORDER BY id DESC`,
      [sId, uType, `${targetMonth}%`]
    );
    const existingMap = {};
    for (const es of existingSalaries || []) {
      const key = `${es.user_type}_${es.employee_id}`;
      if (!existingMap[key]) {
        existingMap[key] = es;
      }
    }

    const enriched = [];
    for (const row of rows) {
      const eligibility = PayrollModel.evaluateBeneficiaryEligibility(row);
      const leaveInfo = await PayrollModel.calculateEmployeeLeaveDeduction(sId, {
        user_type: uType,
        employee_id: row.id,
        salary_month: targetMonth,
        basic_salary: row.basic_salary,
      });
      const existing = existingMap[`${uType}_${row.id}`] || null;

      enriched.push({
        ...row,
        ...eligibility,
        ...leaveInfo,
        existing_salary_id: existing ? existing.id : null,
        existing_payment_status: existing ? Number(existing.payment_status) : null,
        existing_transaction_id: existing ? existing.transaction_id : null,
        existing_payment_date: existing ? existing.payment_date : null,
        is_already_paid: existing ? Number(existing.payment_status) === 1 : false,
      });
    }

    return enriched;
  }

  /**
   * Fetch all employees (or filtered by user_type) with beneficiary validation, leave deduction calculation, and monthly payment status for Bulk Salary Payment
   */
  static async getBulkSalaryCandidates(schoolId, { salary_month, user_type = null, branchId = null, search = '' } = {}) {
    const targetMonth = (salary_month && String(salary_month).trim().slice(0, 7)) || new Date().toISOString().slice(0, 7);
    const typesToFetch = user_type && Number(user_type) > 0 ? [Number(user_type)] : [2, 1, 3];

    let allCandidates = [];
    for (const t of typesToFetch) {
      const list = await PayrollModel.getEmployeesByType(schoolId, t, branchId, targetMonth);
      allCandidates = allCandidates.concat(list);
    }

    if (search && String(search).trim() !== '') {
      const q = String(search).trim().toLowerCase();
      allCandidates = allCandidates.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.employee_code || '').toLowerCase().includes(q) ||
          (c.type_name || '').toLowerCase().includes(q) ||
          (c.bank_name || '').toLowerCase().includes(q) ||
          (c.account_no || '').toLowerCase().includes(q)
      );
    }

    return allCandidates;
  }

  static async createSalary(schoolId, { branch_id = null, user_type, employee_id, leave_id, basic_salary, total_deductions, net_salary, payment_date, transaction_id, slip, payment_status = 1 }) {
    const sId = schoolId;
    const uType = Number(user_type) || 1;
    const empId = Number(employee_id);

    // Validate beneficiary and bank account details before allowing salary payment
    const candidates = await PayrollModel.getEmployeesByType(sId, uType, null, (payment_date || '').slice(0, 7));
    const empRecord = candidates.find((c) => Number(c.id) === empId);
    if (!empRecord) {
      const err = new Error('Employee not found or is inactive.');
      err.statusCode = 404;
      throw err;
    }
    if (!empRecord.is_beneficiary_verified) {
      const err = new Error(
        `Cannot process salary for ${empRecord.name}: ${empRecord.beneficiary_issues.join(', ')}. Please add and verify beneficiary & bank details first.`
      );
      err.statusCode = 400;
      throw err;
    }

    let resolvedBranchId = branch_id || empRecord.branch_id || null;
    if (!resolvedBranchId) {
      const [mb] = await pool.query('SELECT id FROM branch_master WHERE school_id = ? ORDER BY id ASC LIMIT 1', [sId]);
      if (mb.length) resolvedBranchId = mb[0].id;
    }

    const finalLeaveId = leave_id ? Number(leave_id) : (empRecord.primary_leave_id || null);

    const [res] = await pool.query(
      `INSERT INTO employee_salary (school_id, branch_id, user_type, employee_id, leave_id, basic_salary, total_deductions, net_salary, payment_date, transaction_id, slip, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sId,
        resolvedBranchId,
        uType,
        empId,
        finalLeaveId,
        Number(basic_salary) || 0,
        Number(total_deductions) || 0,
        Number(net_salary) || 0,
        payment_date || new Date().toISOString().split('T')[0],
        transaction_id || '',
        slip || null,
        Number(payment_status) || 1,
      ]
    );
    return res.insertId;
  }

  /**
   * Process Bulk Salary Payments
   * - Validates each selected employee's beneficiary & bank details
   * - Prevents paying employees who are already paid (payment_status = 1) for the selected month
   * - Applies leave-based salary deductions + any reviewed additional deductions
   * - Updates existing Failed (3) or Pending (2) salary rows when retrying, or inserts new rows
   */
  static async processBulkSalary(schoolId, { salary_month, payment_date, payment_status = 1, transaction_prefix = '', employees = [], branch_id = null }) {
    const sId = Number(schoolId);
    const effectiveDate = payment_date || new Date().toISOString().split('T')[0];
    const targetMonth = (salary_month && String(salary_month).trim().slice(0, 7)) || effectiveDate.slice(0, 7);
    const targetStatus = [1, 2, 3].includes(Number(payment_status)) ? Number(payment_status) : 1;

    if (!Array.isArray(employees) || employees.length === 0) {
      const err = new Error('Please select at least one employee to process bulk salary.');
      err.statusCode = 400;
      throw err;
    }

    const allCandidates = await PayrollModel.getBulkSalaryCandidates(sId, {
      salary_month: targetMonth,
      branchId: null,
    });
    const candidateMap = {};
    for (const c of allCandidates) {
      candidateMap[`${c.user_type}_${c.id}`] = c;
    }

    const results = [];
    let successful = 0;
    let pending = 0;
    let failed = 0;
    let skippedAlreadyPaid = 0;

    const dateCompact = effectiveDate.replace(/-/g, '');
    const prefix = (transaction_prefix && String(transaction_prefix).trim()) || `SAL-${dateCompact}`;

    for (let i = 0; i < employees.length; i++) {
      const item = employees[i];
      const uType = Number(item.user_type);
      const empId = Number(item.employee_id || item.id);
      const key = `${uType}_${empId}`;
      const candidate = candidateMap[key];

      if (!candidate) {
        failed++;
        results.push({
          user_type: uType,
          employee_id: empId,
          name: item.name || `Employee #${empId}`,
          outcome: 'failed',
          payment_status: 3,
          message: 'Employee record not found or inactive.',
        });
        continue;
      }

      // 1. Prevent double-paying employees who are already Paid (status = 1) for this month
      if (candidate.is_already_paid && candidate.existing_payment_status === 1) {
        skippedAlreadyPaid++;
        results.push({
          user_type: uType,
          employee_id: empId,
          name: candidate.name,
          salary_id: candidate.existing_salary_id,
          outcome: 'skipped_already_paid',
          payment_status: 1,
          transaction_id: candidate.existing_transaction_id,
          message: 'Already paid for this salary period.',
        });
        continue;
      }

      let resolvedBranchId = branch_id || candidate.branch_id || null;
      if (!resolvedBranchId) {
        const [mb] = await pool.query('SELECT id FROM branch_master WHERE school_id = ? ORDER BY id ASC LIMIT 1', [sId]);
        if (mb.length) resolvedBranchId = mb[0].id;
      }

      const baseSalary =
        item.basic_salary !== undefined && item.basic_salary !== null && item.basic_salary !== ''
          ? Math.max(0, Number(item.basic_salary))
          : Number(candidate.basic_salary || 0);
      const daysInMonth = Number(candidate.days_in_month || 30);
      const unpaidDays = Number(candidate.unpaid_leave_days || 0);
      const leaveDeduction =
        baseSalary > 0 && unpaidDays > 0
          ? Number(Math.min(baseSalary, (baseSalary / daysInMonth) * unpaidDays).toFixed(2))
          : Number(candidate.leave_deduction_amount || 0);
      const additionalDeduction = Math.max(0, Number(item.additional_deductions || 0));
      const totalDeductions =
        item.total_deductions !== undefined && item.total_deductions !== null && item.total_deductions !== ''
          ? Math.max(leaveDeduction, Number(item.total_deductions))
          : Number((leaveDeduction + additionalDeduction).toFixed(2));
      const netSalary = Number(Math.max(0, baseSalary - totalDeductions).toFixed(2));
      const txId =
        (item.transaction_id && String(item.transaction_id).trim()) ||
        `${prefix}-${uType}${String(empId).padStart(3, '0')}-${String(Date.now()).slice(-4)}${i}`;

      // 2. Enforce Beneficiary & Bank Account Verification
      if (!candidate.is_beneficiary_verified) {
        failed++;
        const failReason = candidate.beneficiary_issues.join(', ');
        let failedSalaryId = candidate.existing_salary_id || null;
        if (failedSalaryId) {
          await pool.query(
            `UPDATE employee_salary
             SET basic_salary = ?, total_deductions = ?, net_salary = ?, payment_date = ?, payment_status = 3
             WHERE id = ? AND school_id = ?`,
            [baseSalary, totalDeductions, netSalary, effectiveDate, failedSalaryId, sId]
          );
        } else {
          const [ins] = await pool.query(
            `INSERT INTO employee_salary (school_id, branch_id, user_type, employee_id, leave_id, basic_salary, total_deductions, net_salary, payment_date, transaction_id, slip, payment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 3)`,
            [
              sId,
              resolvedBranchId,
              uType,
              empId,
              candidate.primary_leave_id || null,
              baseSalary,
              totalDeductions,
              netSalary,
              effectiveDate,
              txId,
            ]
          );
          failedSalaryId = ins.insertId;
        }

        results.push({
          user_type: uType,
          employee_id: empId,
          name: candidate.name,
          salary_id: failedSalaryId,
          outcome: 'failed',
          payment_status: 3,
          basic_salary: baseSalary,
          total_deductions: totalDeductions,
          net_salary: netSalary,
          message: `Beneficiary validation failed: ${failReason}`,
        });
        continue;
      }

      // 3. Process Payment (Insert or Update existing Pending/Failed record for this month)
      try {
        const rowPaymentStatus =
          item.payment_status && [1, 2, 3].includes(Number(item.payment_status))
            ? Number(item.payment_status)
            : targetStatus;

        let salaryId = candidate.existing_salary_id || null;
        if (salaryId) {
          await pool.query(
            `UPDATE employee_salary
             SET branch_id = ?, leave_id = ?, basic_salary = ?, total_deductions = ?, net_salary = ?, payment_date = ?, transaction_id = ?, payment_status = ?
             WHERE id = ? AND school_id = ?`,
            [
              resolvedBranchId,
              candidate.primary_leave_id || null,
              baseSalary,
              totalDeductions,
              netSalary,
              effectiveDate,
              txId,
              rowPaymentStatus,
              salaryId,
              sId,
            ]
          );
        } else {
          const [ins] = await pool.query(
            `INSERT INTO employee_salary (school_id, branch_id, user_type, employee_id, leave_id, basic_salary, total_deductions, net_salary, payment_date, transaction_id, slip, payment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
            [
              sId,
              resolvedBranchId,
              uType,
              empId,
              candidate.primary_leave_id || null,
              baseSalary,
              totalDeductions,
              netSalary,
              effectiveDate,
              txId,
              rowPaymentStatus,
            ]
          );
          salaryId = ins.insertId;
        }

        if (rowPaymentStatus === 1) successful++;
        else if (rowPaymentStatus === 2) pending++;
        else failed++;

        results.push({
          user_type: uType,
          employee_id: empId,
          name: candidate.name,
          type_name: candidate.type_name,
          salary_id: salaryId,
          outcome: rowPaymentStatus === 1 ? 'paid' : rowPaymentStatus === 2 ? 'pending' : 'failed',
          payment_status: rowPaymentStatus,
          basic_salary: baseSalary,
          unpaid_leave_days: candidate.unpaid_leave_days,
          leave_deduction_amount: leaveDeduction,
          total_deductions: totalDeductions,
          net_salary: netSalary,
          transaction_id: txId,
          payment_date: effectiveDate,
          message:
            rowPaymentStatus === 1
              ? 'Salary paid successfully.'
              : rowPaymentStatus === 2
              ? 'Salary recorded as pending.'
              : 'Salary payment marked as failed.',
        });
      } catch (dbErr) {
        failed++;
        results.push({
          user_type: uType,
          employee_id: empId,
          name: candidate.name,
          outcome: 'failed',
          payment_status: 3,
          message: dbErr.message || 'Database error while recording salary payment.',
        });
      }
    }

    return {
      summary: {
        total_requested: employees.length,
        successful,
        pending,
        failed,
        skipped_already_paid: skippedAlreadyPaid,
      },
      results,
    };
  }

  /**
   * Retry Failed (payment_status = 3) or Pending (payment_status = 2) Salary Payments
   * Never re-pays employees who have already been paid (payment_status = 1)
   */
  static async retryFailedSalaries(schoolId, { salary_ids = [], payment_date = null, branchId = null }) {
    const sId = Number(schoolId);
    const ids = (Array.isArray(salary_ids) ? salary_ids : [salary_ids])
      .map((id) => Number(id))
      .filter((id) => !isNaN(id) && id > 0);

    if (ids.length === 0) {
      const err = new Error('Please select at least one failed or pending salary record to retry.');
      err.statusCode = 400;
      throw err;
    }

    const placeholders = ids.map(() => '?').join(',');
    let sql = `SELECT * FROM employee_salary WHERE school_id = ? AND id IN (${placeholders})`;
    const params = [sId, ...ids];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);

    if (!rows || rows.length === 0) {
      const err = new Error('No matching salary records found.');
      err.statusCode = 404;
      throw err;
    }

    const effectiveDate = payment_date || new Date().toISOString().split('T')[0];
    const dateCompact = effectiveDate.replace(/-/g, '');
    const results = [];
    let retriedSuccess = 0;
    let stillFailed = 0;
    let skippedPaid = 0;

    for (let i = 0; i < rows.length; i++) {
      const sal = rows[i];
      if (Number(sal.payment_status) === 1) {
        skippedPaid++;
        results.push({
          salary_id: sal.id,
          user_type: sal.user_type,
          employee_id: sal.employee_id,
          outcome: 'skipped_already_paid',
          payment_status: 1,
          message: 'Salary is already marked as Paid.',
        });
        continue;
      }

      // Check if another record for the same employee in the same month is already Paid
      const salMonth = (sal.payment_date || effectiveDate).slice(0, 7);
      const [alreadyPaidRows] = await pool.query(
        `SELECT id, transaction_id FROM employee_salary
         WHERE school_id = ? AND user_type = ? AND employee_id = ? AND payment_date LIKE ? AND payment_status = 1 AND id != ?
         LIMIT 1`,
        [sId, sal.user_type, sal.employee_id, `${salMonth}%`, sal.id]
      );
      if (alreadyPaidRows && alreadyPaidRows.length > 0) {
        skippedPaid++;
        results.push({
          salary_id: sal.id,
          user_type: sal.user_type,
          employee_id: sal.employee_id,
          outcome: 'skipped_already_paid',
          payment_status: 1,
          message: `Employee was already paid in this month (Transaction: ${alreadyPaidRows[0].transaction_id}).`,
        });
        continue;
      }

      // Verify beneficiary & bank eligibility before retrying
      const candidates = await PayrollModel.getEmployeesByType(sId, sal.user_type, null, salMonth);
      const candidate = candidates.find((c) => Number(c.id) === Number(sal.employee_id));

      if (!candidate || !candidate.is_beneficiary_verified) {
        stillFailed++;
        const issues = candidate ? candidate.beneficiary_issues.join(', ') : 'Employee inactive or not found';
        results.push({
          salary_id: sal.id,
          user_type: sal.user_type,
          employee_id: sal.employee_id,
          name: candidate?.name || `Employee #${sal.employee_id}`,
          outcome: 'failed',
          payment_status: 3,
          message: `Retry failed: ${issues}`,
        });
        continue;
      }

      const baseSalary = Number(candidate.basic_salary || sal.basic_salary || 0);
      const leaveDeduction = Number(candidate.leave_deduction_amount || 0);
      const totalDeductions = Math.max(leaveDeduction, Number(sal.total_deductions || 0));
      const netSalary = Number(Math.max(0, baseSalary - totalDeductions).toFixed(2));
      const newTxId =
        sal.transaction_id && !String(sal.transaction_id).startsWith('FAIL')
          ? sal.transaction_id
          : `RETRY-${dateCompact}-${sal.user_type}${String(sal.employee_id).padStart(3, '0')}-${String(Date.now()).slice(-4)}${i}`;

      await pool.query(
        `UPDATE employee_salary
         SET basic_salary = ?, total_deductions = ?, net_salary = ?, payment_date = ?, transaction_id = ?, payment_status = 1
         WHERE id = ? AND school_id = ?`,
        [baseSalary, totalDeductions, netSalary, effectiveDate, newTxId, sal.id, sId]
      );

      retriedSuccess++;
      results.push({
        salary_id: sal.id,
        user_type: sal.user_type,
        employee_id: sal.employee_id,
        name: candidate.name,
        outcome: 'paid',
        payment_status: 1,
        basic_salary: baseSalary,
        total_deductions: totalDeductions,
        net_salary: netSalary,
        transaction_id: newTxId,
        payment_date: effectiveDate,
        message: 'Payment retried and completed successfully.',
      });
    }

    return {
      summary: {
        total_requested: rows.length,
        successful: retriedSuccess,
        failed: stillFailed,
        skipped_already_paid: skippedPaid,
      },
      results,
    };
  }

  static async deleteBeneficiary(schoolId, id, branchId = null) {
    let sql = `UPDATE beneficiary_master 
       SET status = 4
       WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    return true;
  }

  static async getAllSalaries(schoolId, { search, user_type, employee_id, payment_status, salary_month, branchId = null } = {}) {
    let sql = `
      SELECT 
        es.id,
        es.school_id,
        es.branch_id,
        es.user_type,
        CASE 
          WHEN es.user_type = 2 THEN 'Teacher'
          WHEN es.user_type = 3 THEN 'Driver'
          ELSE 'Staff'
        END AS type_name,
        es.employee_id,
        CASE 
          WHEN es.user_type = 2 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          WHEN es.user_type = 3 THEN CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS employee_name,
        CASE
          WHEN es.user_type = 2 THEN tb.bank_name
          WHEN es.user_type = 3 THEN ob.bank_name
          ELSE ub.bank_name
        END AS bank_name,
        CASE
          WHEN es.user_type = 2 THEN tb.account_number
          WHEN es.user_type = 3 THEN ob.account_number
          ELSE ub.account_number
        END AS account_no,
        CASE
          WHEN es.user_type = 2 THEN tb.ifsc_code
          WHEN es.user_type = 3 THEN ob.ifsc_code
          ELSE ub.ifsc_code
        END AS ifsc_code,
        es.leave_id,
        es.basic_salary,
        es.total_deductions,
        es.net_salary,
        es.payment_date,
        es.transaction_id,
        es.slip,
        es.payment_status,
        es.created_on
      FROM employee_salary es
      LEFT JOIN teacher_master t ON es.user_type = 2 AND es.employee_id = t.id
      LEFT JOIN operator_master op ON es.user_type = 3 AND es.employee_id = op.id AND op.type = 1
      LEFT JOIN user_master u ON es.user_type = 1 AND es.employee_id = u.id
      LEFT JOIN (
        SELECT teacher_id, bank_name, account_number, ifsc_code
        FROM teacher_bank
        WHERE id IN (SELECT MAX(id) FROM teacher_bank WHERE status != 0 AND status != 4 GROUP BY teacher_id)
      ) tb ON es.user_type = 2 AND es.employee_id = tb.teacher_id
      LEFT JOIN (
        SELECT operator_id, bank_name, account_number, ifsc_code
        FROM operator_bank
        WHERE id IN (SELECT MAX(id) FROM operator_bank WHERE status != 0 AND status != 4 GROUP BY operator_id)
      ) ob ON es.user_type = 3 AND es.employee_id = ob.operator_id
      LEFT JOIN (
        SELECT user_id, bank_name, account_number, ifsc_code
        FROM user_bank
        WHERE id IN (SELECT MAX(id) FROM user_bank WHERE status != 0 AND status != 4 GROUP BY user_id)
      ) ub ON es.user_type = 1 AND es.employee_id = ub.user_id
      WHERE es.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND (
        (es.branch_id = ?) OR
        (es.branch_id IS NULL AND (
          (es.user_type = 2 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR
          (es.user_type = 3 AND (op.branch_id = ? OR op.branch_id IS NULL)) OR
          (es.user_type != 2 AND es.user_type != 3 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId), Number(branchId));
    }

    if (user_type !== undefined && user_type !== null && user_type !== '') {
      sql += ` AND es.user_type = ?`;
      params.push(Number(user_type));
    }
    if (employee_id !== undefined && employee_id !== null && employee_id !== '') {
      sql += ` AND es.employee_id = ?`;
      params.push(Number(employee_id));
    }
    if (payment_status !== undefined && payment_status !== null && payment_status !== '') {
      sql += ` AND es.payment_status = ?`;
      params.push(Number(payment_status));
    }
    if (salary_month && String(salary_month).trim() !== '') {
      sql += ` AND es.payment_date LIKE ?`;
      params.push(`${String(salary_month).trim().slice(0, 7)}%`);
    }

    if (search && search.trim() !== '') {
      sql += ` AND (
        t.first_name LIKE ? OR t.last_name LIKE ? OR 
        op.first_name LIKE ? OR op.last_name LIKE ? OR 
        u.first_name LIKE ? OR u.last_name LIKE ? OR 
        es.transaction_id LIKE ?
      )`;
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q, q, q, q);
    }

    sql += ` ORDER BY es.payment_date DESC, es.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async updateSalaryStatus(schoolId, id, payment_status, branchId = null) {
    let sql = `UPDATE employee_salary 
       SET payment_status = ? 
       WHERE id = ? AND school_id = ?`;
    const params = [Number(payment_status), id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    return true;
  }
}

module.exports = PayrollModel;
