const { pool } = require('../config/db.config');

class PayrollModel {
  static async getAllBeneficiaries(schoolId, { search, branchId = null } = {}) {
    let sql = `
      SELECT 
        bm.id,
        bm.school_id,
        bm.user_type,
        CASE WHEN bm.user_type = 2 THEN 'Teacher' ELSE 'User' END AS type_name,
        bm.employee_id,
        CASE 
          WHEN bm.user_type = 2 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS name,
        bm.basic_salary AS amount,
        CASE 
          WHEN bm.user_type = 2 THEN tb.bank_name
          ELSE ub.bank_name
        END AS bank_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_name
          ELSE ub.account_name
        END AS account_holder_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_number
          ELSE ub.account_number
        END AS account_number,
        CASE 
          WHEN bm.user_type = 2 THEN tb.ifsc_code
          ELSE ub.ifsc_code
        END AS ifsc_code,
        CASE 
          WHEN bm.user_type = 2 THEN tb.branch_name
          ELSE ub.branch_name
        END AS branch_name,
        bm.status
      FROM beneficiary_master bm
      LEFT JOIN teacher_master t ON bm.user_type = 2 AND bm.employee_id = t.id
      LEFT JOIN teacher_bank tb ON bm.user_type = 2 AND bm.employee_id = tb.teacher_id AND tb.status != 4
      LEFT JOIN user_master u ON bm.user_type != 2 AND bm.employee_id = u.id
      LEFT JOIN user_bank ub ON bm.user_type != 2 AND bm.employee_id = ub.user_id AND ub.status != 4
      WHERE bm.status != 4 AND bm.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND (
        (bm.branch_id = ?) OR 
        (bm.branch_id IS NULL AND (
          (bm.user_type = 2 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR 
          (bm.user_type != 2 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId));
    }

    if (search && search.trim() !== '') {
      sql += ` AND (
        t.first_name LIKE ? OR t.last_name LIKE ? OR 
        u.first_name LIKE ? OR u.last_name LIKE ? OR 
        tb.bank_name LIKE ? OR ub.bank_name LIKE ?
      )`;
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q, q, q);
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
        CASE WHEN bm.user_type = 2 THEN 'Teacher' ELSE 'User' END AS type_name,
        bm.employee_id,
        CASE 
          WHEN bm.user_type = 2 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS name,
        bm.basic_salary AS amount,
        CASE 
          WHEN bm.user_type = 2 THEN tb.bank_name
          ELSE ub.bank_name
        END AS bank_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_name
          ELSE ub.account_name
        END AS account_holder_name,
        CASE 
          WHEN bm.user_type = 2 THEN tb.account_number
          ELSE ub.account_number
        END AS account_number,
        CASE 
          WHEN bm.user_type = 2 THEN tb.ifsc_code
          ELSE ub.ifsc_code
        END AS ifsc_code,
        CASE 
          WHEN bm.user_type = 2 THEN tb.branch_name
          ELSE ub.branch_name
        END AS branch_name,
        bm.status
      FROM beneficiary_master bm
      LEFT JOIN teacher_master t ON bm.user_type = 2 AND bm.employee_id = t.id
      LEFT JOIN teacher_bank tb ON bm.user_type = 2 AND bm.employee_id = tb.teacher_id AND tb.status != 0
      LEFT JOIN user_master u ON bm.user_type != 2 AND bm.employee_id = u.id
      LEFT JOIN user_bank ub ON bm.user_type != 2 AND bm.employee_id = ub.user_id AND ub.status != 0
      WHERE bm.id = ? AND bm.status != 0 AND bm.school_id = ?
    `;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (
        (bm.branch_id = ?) OR 
        (bm.branch_id IS NULL AND (
          (bm.user_type = 2 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR 
          (bm.user_type != 2 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId));
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

  static async getEmployeesByType(schoolId, userType, branchId = null) {
    const sId = schoolId;
    const uType = Number(userType) || 1;

    if (uType === 2) {
      // Teachers
      let sql = `
        SELECT 
           t.id,
           CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')) AS name,
           IFNULL(bm.basic_salary, 0) AS basic_salary,
           tb.bank_name,
           tb.account_name,
           tb.account_number AS account_no,
           tb.ifsc_code,
           tb.branch_name
         FROM teacher_master t
         LEFT JOIN beneficiary_master bm ON bm.user_type = 2 AND bm.employee_id = t.id AND bm.status != 0
         LEFT JOIN teacher_bank tb ON t.id = tb.teacher_id AND tb.status != 0
         WHERE t.status != 0 AND t.school_id = ?
      `;
      const params = [sId];
      if (branchId) {
        sql += ` AND (t.branch_id = ? OR t.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY t.first_name ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } else {
      // Users / Staff
      let sql = `
        SELECT 
           u.id,
           CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) AS name,
           IFNULL(bm.basic_salary, 0) AS basic_salary,
           ub.bank_name,
           ub.account_name,
           ub.account_number AS account_no,
           ub.ifsc_code,
           ub.branch_name
         FROM user_master u
         LEFT JOIN beneficiary_master bm ON bm.user_type = 1 AND bm.employee_id = u.id AND bm.status != 0
         LEFT JOIN user_bank ub ON u.id = ub.user_id AND ub.status != 0
         WHERE u.status != 0 AND u.school_id = ?
      `;
      const params = [sId];
      if (branchId) {
        sql += ` AND (u.branch_id = ? OR u.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY u.first_name ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    }
  }

  static async createSalary(schoolId, { branch_id = null, user_type, employee_id, leave_id, basic_salary, total_deductions, net_salary, payment_date, transaction_id, slip, payment_status = 1 }) {
    const sId = schoolId;
    const uType = Number(user_type) || 1;
    const empId = Number(employee_id);

    let resolvedBranchId = branch_id;
    if (!resolvedBranchId) {
      if (uType === 2) {
        const [tm] = await pool.query('SELECT branch_id FROM teacher_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (tm.length && tm[0].branch_id) resolvedBranchId = tm[0].branch_id;
      } else {
        const [um] = await pool.query('SELECT branch_id FROM user_master WHERE id = ? AND school_id = ?', [empId, sId]);
        if (um.length && um[0].branch_id) resolvedBranchId = um[0].branch_id;
      }
    }
    if (!resolvedBranchId) {
      const [mb] = await pool.query('SELECT id FROM branch_master WHERE school_id = ? AND is_main = 1 LIMIT 1', [sId]);
      if (mb.length) resolvedBranchId = mb[0].id;
    }

    const [res] = await pool.query(
      `INSERT INTO employee_salary (school_id, branch_id, user_type, employee_id, leave_id, basic_salary, total_deductions, net_salary, payment_date, transaction_id, slip, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sId,
        resolvedBranchId,
        uType,
        empId,
        leave_id ? Number(leave_id) : null,
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

  static async getAllSalaries(schoolId, { search, user_type, employee_id, branchId = null } = {}) {
    let sql = `
      SELECT 
        es.id,
        es.school_id,
        es.user_type,
        CASE WHEN es.user_type = 2 THEN 'Teacher' ELSE 'User' END AS type_name,
        es.employee_id,
        CASE 
          WHEN es.user_type = 2 THEN CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, ''))
          ELSE CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, ''))
        END AS employee_name,
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
      LEFT JOIN user_master u ON es.user_type != 2 AND es.employee_id = u.id
      WHERE es.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND (
        (es.branch_id = ?) OR
        (es.branch_id IS NULL AND (
          (es.user_type = 2 AND (t.branch_id = ? OR t.branch_id IS NULL)) OR
          (es.user_type != 2 AND (u.branch_id = ? OR u.branch_id IS NULL))
        ))
      )`;
      params.push(Number(branchId), Number(branchId), Number(branchId));
    }

    if (user_type !== undefined && user_type !== null) {
      sql += ` AND es.user_type = ?`;
      params.push(Number(user_type));
    }
    if (employee_id !== undefined && employee_id !== null) {
      sql += ` AND es.employee_id = ?`;
      params.push(Number(employee_id));
    }

    if (search && search.trim() !== '') {
      sql += ` AND (
        t.first_name LIKE ? OR t.last_name LIKE ? OR 
        u.first_name LIKE ? OR u.last_name LIKE ? OR 
        es.transaction_id LIKE ?
      )`;
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q, q);
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
