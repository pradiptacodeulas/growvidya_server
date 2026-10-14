const { pool } = require('../config/db.config');

class AcademicModel {
  /**
   * Helper to format academic year into standard year range (e.g. '2025 - 2026')
   */
  static formatYearRange(year) {
    if (!year) return '';
    let startY = null;
    let endY = null;
    if (year.start_date) {
      const match = String(year.start_date).match(/^(\d{4})/);
      if (match) startY = parseInt(match[1], 10);
    }
    if (year.end_date) {
      const match = String(year.end_date).match(/^(\d{4})/);
      if (match) endY = parseInt(match[1], 10);
    }
    if (!startY && year.academic_year) {
      const match = String(year.academic_year).match(/^(\d{4})/);
      if (match) startY = parseInt(match[1], 10);
    }
    if (startY) {
      if (endY && endY > startY) {
        return `${startY} - ${endY}`;
      }
      return `${startY} - ${startY + 1}`;
    }
    return year.academic_year || (year.id ? `Year ${year.id}` : '');
  }

  // Helper to format academic year display name (e.g. 'January 2026 - November 2026')
  static formatYearTitle(year) {
    if (!year) return '';
    if (year.start_date && year.end_date) {
      const parseMonthYear = (dateStr) => {
        if (!dateStr) return '';
        const match = String(dateStr).match(/^(\d{4})-(\d{1,2})/);
        if (match) {
          const y = match[1];
          const m = parseInt(match[2], 10) - 1;
          const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
          ];
          if (m >= 0 && m < 12) return `${monthNames[m]} ${y}`;
        }
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
        }
        return dateStr;
      };
      const start = parseMonthYear(year.start_date);
      const end = parseMonthYear(year.end_date);
      if (start && end) {
        return `${start} - ${end}`;
      }
    }
    return AcademicModel.formatYearRange(year);
  }

  // ==================== ACADEMIC YEARS ====================
  static parseBranchId(branchId) {
    if (
      branchId !== null &&
      branchId !== undefined &&
      branchId !== '' &&
      branchId !== 'all' &&
      branchId !== '0' &&
      branchId !== 0 &&
      !isNaN(Number(branchId)) &&
      Number(branchId) > 0
    ) {
      return Number(branchId);
    }
    return null;
  }

  static async resolveDefaultBranchId(schoolId, branchId = null) {
    const parsed = AcademicModel.parseBranchId(branchId);
    if (parsed) return parsed;
    try {
      const [rows] = await pool.query(
        `SELECT id FROM branch_master WHERE school_id = ? AND status != 4 ORDER BY is_main_branch DESC, id ASC LIMIT 1`,
        [schoolId]
      );
      if (rows && rows.length > 0) return Number(rows[0].id);
    } catch (e) {}
    return null;
  }

  static async getAcademicYears(schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);

      let sql = `SELECT id, school_id, branch_id, academic_year, start_date, end_date, is_current, status 
         FROM academic_year_master 
         WHERE school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [schoolId];
      if (cleanBranchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(cleanBranchId);
      }
      sql += ` ORDER BY id ASC`;
      const [rows] = await pool.query(sql, params);
      if (rows && rows.length > 0) {
        // Ensure at least one academic year is marked as is_current = 1 in the active scope
        const hasCurrent = rows.some((r) => Number(r.is_current) === 1);
        if (!hasCurrent) {
          const fallbackRow = rows.find((r) => Number(r.status) === 1) || rows[0];
          if (fallbackRow) {
            await pool.query(
              `UPDATE academic_year_master SET is_current = 1 WHERE id = ? AND school_id = ?`,
              [fallbackRow.id, schoolId]
            );
            fallbackRow.is_current = 1;
          }
        } else if (cleanBranchId) {
          // If multiple rows in the same branch scope are marked current, keep only the latest one marked current
          const currentRows = rows.filter((r) => Number(r.is_current) === 1);
          if (currentRows.length > 1) {
            const keepRow = currentRows[currentRows.length - 1];
            for (const r of currentRows) {
              if (r.id !== keepRow.id) {
                await pool.query(
                  `UPDATE academic_year_master SET is_current = 0 WHERE id = ? AND school_id = ?`,
                  [r.id, schoolId]
                );
                r.is_current = 0;
              }
            }
          }
        }

        return rows.map((r) => {
          const isCurrent = Number(r.is_current) === 1;
          const range = AcademicModel.formatYearRange(r);
          const displayName = isCurrent ? `${range} (current)` : range;
          return {
            ...r,
            academic_year: displayName,
            raw_academic_year: r.academic_year,
            name: displayName,
            title: displayName,
            is_current: isCurrent ? 1 : 0,
            isCurrent: isCurrent,
          };
        });
      }
      return [];
    } catch (e) {
      console.error('Error in getAcademicYears:', e.message);
      return [];
    }
  }

  static async getAcademicYearById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);

      let sql = `SELECT id, school_id, branch_id, academic_year, start_date, end_date, is_current, status 
         FROM academic_year_master 
         WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      if (rows && rows.length > 0) {
        return {
          ...rows[0],
          raw_academic_year: rows[0].academic_year,
          name: AcademicModel.formatYearTitle(rows[0]),
        };
      }
      return null;
    } catch (e) {
      console.error('Error in getAcademicYearById:', e.message);
      return null;
    }
  }

  static async createAcademicYear(schoolId, { name, academic_year, start_date, end_date, is_current = 0, status = 1, branch_id = null }) {
    const yearVal = String(academic_year || name || '').replace(/\s*\(current\)\s*$/i, '').trim();
    let isCurr = Number(is_current) === 1 || is_current === true || is_current === '1' ? 1 : 0;
    const branchVal = await AcademicModel.resolveDefaultBranchId(schoolId, branch_id);

    // Check if there is any existing current academic year in this school/branch scope
    let checkSql = `SELECT id FROM academic_year_master WHERE school_id = ? AND is_current = 1 AND (status != 4 OR status IS NULL)`;
    const checkParams = [schoolId];
    if (branchVal) {
      checkSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      checkParams.push(branchVal);
    } else {
      checkSql += ` AND branch_id IS NULL`;
    }
    checkSql += ` LIMIT 1`;
    const [existingCurrent] = await pool.query(checkSql, checkParams);

    if (isCurr === 0 && (!existingCurrent || existingCurrent.length === 0)) {
      const err = new Error('At least one academic year must be marked as current.');
      err.statusCode = 400;
      throw err;
    }

    if (isCurr === 1) {
      let resetSql = `UPDATE academic_year_master SET is_current = 0 WHERE school_id = ?`;
      const resetParams = [schoolId];
      if (branchVal) {
        resetSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        resetParams.push(branchVal);
      } else {
        resetSql += ` AND branch_id IS NULL`;
      }
      await pool.query(resetSql, resetParams);
    }

    const [result] = await pool.query(
      `INSERT INTO academic_year_master (school_id, branch_id, academic_year, start_date, end_date, is_current, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, branchVal, yearVal, start_date, end_date, isCurr, Number(status)]
    );
    return result.insertId;
  }

  static async updateAcademicYear(id, schoolId, { name, academic_year, start_date, end_date, is_current = 0, status = 1, branch_id }, reqBranchId = null) {
    // Load the existing record to verify ownership and determine branch scope
    const filterBranch = AcademicModel.parseBranchId(reqBranchId);
    let existingSql = `SELECT id, school_id, branch_id, academic_year, start_date, end_date, is_current, status
                       FROM academic_year_master
                       WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const existingParams = [id, schoolId];
    if (filterBranch) {
      existingSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      existingParams.push(filterBranch);
    }
    existingSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(existingSql, existingParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }
    const existing = existingRows[0];

    const rawYearInput = academic_year !== undefined ? academic_year : (name !== undefined ? name : existing.academic_year);
    const yearVal = String(rawYearInput || '').replace(/\s*\(current\)\s*$/i, '').trim();
    const startDateVal = start_date !== undefined ? start_date : existing.start_date;
    const endDateVal = end_date !== undefined ? end_date : existing.end_date;
    const statusVal = status !== undefined ? Number(status) : Number(existing.status);
    const isCurr = Number(is_current) === 1 || is_current === true || is_current === '1' ? 1 : 0;

    const parsedBodyBranch = branch_id !== undefined ? AcademicModel.parseBranchId(branch_id) : undefined;
    const effectiveBranchId =
      parsedBodyBranch !== undefined
        ? parsedBodyBranch
        : AcademicModel.parseBranchId(existing.branch_id) || filterBranch;

    // Check if any OTHER academic year in this school/branch scope has is_current = 1
    let otherCurrSql = `SELECT id FROM academic_year_master WHERE school_id = ? AND id != ? AND is_current = 1 AND (status != 4 OR status IS NULL)`;
    const otherCurrParams = [schoolId, id];
    if (effectiveBranchId) {
      otherCurrSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      otherCurrParams.push(effectiveBranchId);
    } else {
      otherCurrSql += ` AND branch_id IS NULL`;
    }
    otherCurrSql += ` LIMIT 1`;
    const [otherCurrentRows] = await pool.query(otherCurrSql, otherCurrParams);
    const hasOtherCurrent = otherCurrentRows && otherCurrentRows.length > 0;

    if (isCurr === 0 && (Number(existing.is_current) === 1 || !hasOtherCurrent)) {
      const err = new Error(
        'At least one academic year must remain marked as current. Please select another academic year as current instead of unchecking this one.'
      );
      err.statusCode = 400;
      throw err;
    }

    if (isCurr === 1) {
      let resetSql = `UPDATE academic_year_master SET is_current = 0 WHERE school_id = ? AND id != ?`;
      const resetParams = [schoolId, id];
      if (effectiveBranchId) {
        resetSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        resetParams.push(effectiveBranchId);
      } else {
        resetSql += ` AND branch_id IS NULL`;
      }
      await pool.query(resetSql, resetParams);
    }

    let updateSql = `UPDATE academic_year_master SET academic_year = ?, start_date = ?, end_date = ?, is_current = ?, status = ?`;
    const updateParams = [yearVal, startDateVal, endDateVal, isCurr, statusVal];
    if (parsedBodyBranch !== undefined) {
      updateSql += `, branch_id = ?`;
      updateParams.push(parsedBodyBranch);
    }
    updateSql += ` WHERE id = ? AND school_id = ?`;
    updateParams.push(id, schoolId);
    const [result] = await pool.query(updateSql, updateParams);
    return result.affectedRows > 0;
  }

  static async deleteAcademicYear(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    // Check if the academic year is current (is_current = 1)
    let checkSql = `SELECT id, is_current, academic_year FROM academic_year_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const checkParams = [id, schoolId];
    if (cleanBranchId) {
      checkSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      checkParams.push(cleanBranchId);
    }
    checkSql += ` LIMIT 1`;
    const [rows] = await pool.query(checkSql, checkParams);
    if (!rows || rows.length === 0) {
      return false;
    }
    if (Number(rows[0].is_current) === 1) {
      const err = new Error('Current academic year cannot be deleted.');
      err.statusCode = 400;
      throw err;
    }

    let sql = `UPDATE academic_year_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== CLASSES ====================
  // Filter classes strictly by teacher_class_assign for teachers, status = 1
  static async getClasses(schoolId, activeOnly = false, teacherId = null, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `SELECT c.*, bm.branch_name, bm.branch_code, s.shift_name FROM class_master c 
       LEFT JOIN branch_master bm ON c.branch_id = bm.id
       LEFT JOIN shift_master s ON c.shift_id = s.id 
       WHERE c.school_id = ?`;
    const params = [schoolId];
    if (activeOnly) {
      sql += ` AND c.status = 1`;
    } else {
      sql += ` AND (c.status != 4 OR c.status IS NULL)`;
    }
    if (cleanBranchId) {
      sql += ` AND c.branch_id = ?`;
      params.push(cleanBranchId);
    }
    if (teacherId) {
      sql += ` AND (
        EXISTS (
          SELECT 1 FROM teacher_class_assign tca 
          WHERE tca.teacher_id = ? AND tca.class_id = c.id AND tca.school_id = c.school_id AND tca.status = 1
        )
        OR EXISTS (
          SELECT 1 FROM teacher_master tm
          WHERE tm.id = ? AND tm.class = c.id AND tm.school_id = c.school_id AND tm.status = 1
        )
      )`;
      params.push(teacherId, teacherId);
    }
    sql += ` ORDER BY c.sort_order ASC, c.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getClassById(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `SELECT c.*, bm.branch_name, bm.branch_code, s.shift_name FROM class_master c 
       LEFT JOIN branch_master bm ON c.branch_id = bm.id
       LEFT JOIN shift_master s ON c.shift_id = s.id 
       WHERE c.id = ? AND c.school_id = ? AND (c.status != 4 OR c.status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND c.branch_id = ?`;
      params.push(cleanBranchId);
    }
    sql += ` LIMIT 1`;
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  }

  static async createClass(schoolId, { class_name, shift_id = null, sort_order = 0, status = 1, branch_id = null }) {
    let resolvedBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : null;
    if (!resolvedBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC, id ASC LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) resolvedBranchId = mainB[0].id;
      } catch (e) {}
    }

    // Branch-aware duplicate check: class_name within this school and branch
    if (class_name && String(class_name).trim()) {
      let dupSql = `SELECT id FROM class_master WHERE school_id = ? AND LOWER(TRIM(class_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(class_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A class named "${class_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO class_master (school_id, branch_id, shift_id, class_name, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, shift_id, class_name, sort_order, status]
    );
    return result.insertId;
  }

  static async updateClass(id, schoolId, { class_name, shift_id, sort_order, status, branch_id = null }, branchId = null) {
    let targetBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : ((branchId && branchId !== 'all') ? Number(branchId) : null);

    // Branch-aware duplicate check on update
    if (class_name && String(class_name).trim()) {
      let dupSql = `SELECT id FROM class_master WHERE school_id = ? AND LOWER(TRIM(class_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(class_name).trim(), id];
      if (targetBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(targetBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another class named "${class_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE class_master SET class_name = ?, shift_id = ?, sort_order = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [class_name, shift_id, sort_order, status, branch_id || null, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteClass(id, schoolId, branchId = null) {
    let sql = `UPDATE class_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== SECTIONS ====================
  static async getSections(schoolId, classId = null, activeOnly = false, status = null, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `SELECT sec.*, bm.branch_name, bm.branch_code, c.class_name FROM section_master sec
       LEFT JOIN branch_master bm ON sec.branch_id = bm.id
       LEFT JOIN class_master c ON sec.class_id = c.id
       WHERE sec.school_id = ?`;
    const params = [schoolId];
    if (status !== null && status !== undefined && status !== '') {
      sql += ` AND sec.status = ?`;
      params.push(Number(status));
    } else if (activeOnly) {
      sql += ` AND sec.status = 1`;
    } else {
      sql += ` AND (sec.status != 4 OR sec.status IS NULL)`;
    }
    if (cleanBranchId) {
      sql += ` AND COALESCE(sec.branch_id, c.branch_id) = ?`;
      params.push(cleanBranchId);
    }
    if (classId) {
      sql += ` AND sec.class_id = ?`;
      params.push(classId);
    }
    if (teacherId) {
      sql += ` AND (
        EXISTS (
          SELECT 1 FROM teacher_class_assign tca
          WHERE tca.teacher_id = ? AND tca.class_id = sec.class_id AND tca.school_id = sec.school_id AND tca.status = 1
        )
        OR EXISTS (
          SELECT 1 FROM teacher_master tm
          WHERE tm.id = ? AND tm.class = sec.class_id AND tm.school_id = sec.school_id AND tm.status = 1
        )
      )`;
      params.push(teacherId, teacherId);
    }
    sql += ` ORDER BY sec.sort_order ASC, sec.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getSectionById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT sec.*, bm.branch_name, bm.branch_code, c.class_name 
         FROM section_master sec
         LEFT JOIN branch_master bm ON sec.branch_id = bm.id
         LEFT JOIN class_master c ON sec.class_id = c.id
         WHERE sec.id = ? AND sec.school_id = ? AND (sec.status != 4 OR sec.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND COALESCE(sec.branch_id, c.branch_id) = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSectionById:', e.message);
      return null;
    }
  }

  static async createSection(schoolId, { class_id, section_name, capacity = 40, note = '', sort_order = 1, status = 1, branch_id = null }) {
    let resolvedBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : null;
    if (!resolvedBranchId && class_id) {
      try {
        const [cls] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ? LIMIT 1`, [class_id]);
        if (cls && cls[0]?.branch_id) resolvedBranchId = cls[0].branch_id;
      } catch (e) {}
    }
    if (!resolvedBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND is_main_branch = 1 LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) resolvedBranchId = mainB[0].id;
      } catch (e) {}
    }

    // Branch-aware duplicate check: section_name within same class and branch
    if (section_name && String(section_name).trim()) {
      let dupSql = `SELECT id FROM section_master WHERE school_id = ? AND class_id = ? AND LOWER(TRIM(section_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, class_id, String(section_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A section named "${section_name}" already exists for this class in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO section_master (school_id, branch_id, class_id, section_name, capacity, note, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, class_id, section_name, Number(capacity) || 0, note || '', Number(sort_order) || 1, Number(status)]
    );
    return result.insertId;
  }

  static async updateSection(id, schoolId, { class_id, section_name, capacity, note, sort_order, status, branch_id = null }, branchId = null) {
    let targetBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : ((branchId && branchId !== 'all') ? Number(branchId) : null);

    // Branch-aware duplicate check on update
    if (section_name && String(section_name).trim() && class_id) {
      let dupSql = `SELECT id FROM section_master WHERE school_id = ? AND class_id = ? AND LOWER(TRIM(section_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, class_id, String(section_name).trim(), id];
      if (targetBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(targetBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another section named "${section_name}" already exists for this class in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE section_master SET class_id = ?, section_name = ?, capacity = ?, note = ?, sort_order = ?, status = ? WHERE id = ? AND school_id = ?`;
    const params = [class_id, section_name, Number(capacity) || 0, note || '', Number(sort_order) || 0, Number(status), id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteSection(id, schoolId, branchId = null) {
    let sql = `UPDATE section_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== SUBJECTS ====================
  // Filter subjects strictly by teacher_class_assign for teachers, status = 1
  static async getSubjects(schoolId, classId = null, activeOnly = false, teacherId = null, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `SELECT sm.*, cm.class_name, bm.branch_name, bm.branch_code 
               FROM subject_master sm
               LEFT JOIN class_master cm ON sm.class_id = cm.id
               LEFT JOIN branch_master bm ON COALESCE(sm.branch_id, cm.branch_id) = bm.id
               WHERE sm.school_id = ?`;
    const params = [schoolId];

    if (activeOnly) {
      sql += ` AND sm.status = 1`;
    } else {
      sql += ` AND (sm.status != 4 OR sm.status IS NULL)`;
    }

    if (cleanBranchId) {
      sql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
      params.push(cleanBranchId);
    }

    if (classId) {
      sql += ` AND sm.class_id = ?`;
      params.push(classId);
    }

    if (teacherId) {
      sql += ` AND (
        EXISTS (
          SELECT 1 FROM teacher_class_assign tca 
          WHERE tca.teacher_id = ? AND tca.subject_id = sm.id AND tca.school_id = sm.school_id AND tca.status = 1
          ${classId ? 'AND tca.class_id = ?' : ''}
        )
        OR EXISTS (
          SELECT 1 FROM teacher_master tm
          WHERE tm.id = ? AND tm.subject = sm.id AND tm.school_id = sm.school_id AND tm.status = 1
          ${classId ? 'AND (tm.class = ? OR sm.class_id = ?)' : ''}
        )
      )`;
      params.push(teacherId);
      if (classId) {
        params.push(classId);
      }
      params.push(teacherId);
      if (classId) {
        params.push(classId, classId);
      }
    }

    sql += ` ORDER BY sm.sort_order ASC, sm.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getSubjectById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT sm.*, cm.class_name, bm.branch_name, bm.branch_code 
         FROM subject_master sm 
         LEFT JOIN class_master cm ON sm.class_id = cm.id 
         LEFT JOIN branch_master bm ON COALESCE(sm.branch_id, cm.branch_id) = bm.id
         WHERE sm.id = ? AND sm.school_id = ? AND (sm.status != 4 OR sm.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSubjectById:', e.message);
      return null;
    }
  }

  static async createSubject(schoolId, { class_id = null, class_ids = null, subject_name, sort_order = 1, status = 1, branch_id = null }) {
    const targetClasses = Array.isArray(class_ids) && class_ids.length > 0
      ? class_ids
      : Array.isArray(class_id) && class_id.length > 0
      ? class_id
      : [class_id];

    const insertedIds = [];
    let lastError = null;

    for (const cId of targetClasses) {
      let resolvedBranchId = branch_id ? Number(branch_id) : null;
      if (!resolvedBranchId && cId) {
        try {
          const [cls] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ? LIMIT 1`, [cId]);
          if (cls && cls[0]?.branch_id) resolvedBranchId = cls[0].branch_id;
        } catch (e) {}
      }

      // Branch-aware duplicate check: subject_name within branch and class
      if (subject_name && String(subject_name).trim()) {
        let dupSql = `SELECT id FROM subject_master WHERE school_id = ? AND LOWER(TRIM(subject_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
        const dupParams = [schoolId, String(subject_name).trim()];
        if (cId) {
          dupSql += ` AND class_id = ?`;
          dupParams.push(cId);
        }
        if (resolvedBranchId) {
          dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
          dupParams.push(resolvedBranchId);
        }
        dupSql += ` LIMIT 1`;
        const [existing] = await pool.query(dupSql, dupParams);
        if (existing && existing.length > 0) {
          const err = new Error(`A subject named "${subject_name}" already exists for this class.`);
          err.statusCode = 400;
          if (targetClasses.length === 1) throw err;
          lastError = err;
          continue;
        }
      }

      const [result] = await pool.query(
        `INSERT INTO subject_master (school_id, branch_id, class_id, subject_name, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [schoolId, resolvedBranchId, cId ? Number(cId) : null, subject_name, Number(sort_order) || 0, Number(status)]
      );
      insertedIds.push(result.insertId);
    }

    if (insertedIds.length === 0 && lastError) {
      throw lastError;
    }

    return insertedIds[0] || null;
  }

  static async updateSubject(id, schoolId, { class_id, subject_name, sort_order = 1, status = 1, branch_id = null }, branchId = null) {
    const targetBranchId = branch_id ? Number(branch_id) : (branchId ? Number(branchId) : null);

    // Branch-aware duplicate check on update
    if (subject_name && String(subject_name).trim()) {
      let dupSql = `SELECT id FROM subject_master WHERE school_id = ? AND LOWER(TRIM(subject_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(subject_name).trim(), id];
      if (class_id) {
        dupSql += ` AND class_id = ?`;
        dupParams.push(class_id);
      }
      if (targetBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(targetBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another subject named "${subject_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE subject_master SET class_id = ?, subject_name = ?, sort_order = ?, status = ?`;
    const params = [class_id ? Number(class_id) : null, subject_name, Number(sort_order) || 0, Number(status)];
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

  static async deleteSubject(id, schoolId, branchId = null) {
    let sql = `UPDATE subject_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== SHIFTS ====================
  static async getShifts(schoolId, activeOnly = false, branchId = null) {
    let sql = `SELECT s.*, bm.branch_name, bm.branch_code 
               FROM shift_master s 
               LEFT JOIN branch_master bm ON s.branch_id = bm.id 
               WHERE s.school_id = ?`;
    const params = [schoolId];
    if (activeOnly) {
      sql += ` AND s.status = 1`;
    } else {
      sql += ` AND (s.status != 4 OR s.status IS NULL)`;
    }
    if (branchId) {
      sql += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` ORDER BY s.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getShiftById(id, schoolId, branchId = null) {
    let sql = `SELECT s.*, bm.branch_name, bm.branch_code 
       FROM shift_master s 
       LEFT JOIN branch_master bm ON s.branch_id = bm.id 
       WHERE s.id = ? AND s.school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` LIMIT 1`;
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  }

  static async createShift(schoolId, { branch_id = null, shift_name, start_time = null, end_time = null, status = 1 }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;

    if (shift_name && String(shift_name).trim()) {
      let dupSql = `SELECT id FROM shift_master WHERE school_id = ? AND LOWER(TRIM(shift_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(shift_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A shift named "${shift_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO shift_master (school_id, branch_id, shift_name, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, shift_name, start_time, end_time, status]
    );
    return result.insertId;
  }

  static async updateShift(id, schoolId, { branch_id, shift_name, start_time, end_time, status = 1 }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    if (shift_name && String(shift_name).trim()) {
      let dupSql = `SELECT id FROM shift_master WHERE school_id = ? AND LOWER(TRIM(shift_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(shift_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another shift named "${shift_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE shift_master SET shift_name = ?, start_time = ?, end_time = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [shift_name, start_time, end_time, status, resolvedBranchId, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteShift(id, schoolId, branchId = null) {
    let sql = `UPDATE shift_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== HOUSES ====================
  static async getHouses(schoolId, branchId = null) {
    let sql = `SELECT h.*, bm.branch_name, bm.branch_code 
               FROM house_master h 
               LEFT JOIN branch_master bm ON h.branch_id = bm.id 
               WHERE h.school_id = ? AND (h.status != 4 OR h.status IS NULL)`;
    const params = [schoolId];
    if (branchId) {
      sql += ` AND (h.branch_id = ? OR h.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` ORDER BY h.sort_order ASC, h.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getHouseById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT h.*, bm.branch_name, bm.branch_code 
         FROM house_master h 
         LEFT JOIN branch_master bm ON h.branch_id = bm.id 
         WHERE h.id = ? AND h.school_id = ? AND h.status != 4`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (h.branch_id = ? OR h.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getHouseById:', e.message);
      return null;
    }
  }

  static async createHouse(schoolId, { branch_id = null, house_name, sort_order = 1, status = 1 }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;

    if (house_name && String(house_name).trim()) {
      let dupSql = `SELECT id FROM house_master WHERE school_id = ? AND LOWER(TRIM(house_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(house_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A house named "${house_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO house_master (school_id, branch_id, house_name, sort_order, status) VALUES (?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, house_name, Number(sort_order) || 1, Number(status)]
    );
    return result.insertId;
  }

  static async updateHouse(id, schoolId, { branch_id, house_name, sort_order = 1, status = 1 }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    if (house_name && String(house_name).trim()) {
      let dupSql = `SELECT id FROM house_master WHERE school_id = ? AND LOWER(TRIM(house_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(house_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another house named "${house_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE house_master SET house_name = ?, sort_order = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [house_name, Number(sort_order) || 1, Number(status), resolvedBranchId, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteHouse(id, schoolId, branchId = null) {
    let sql = `UPDATE house_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== PERIODS ====================
  static async getPeriods(schoolId, branchId = null) {
    let sql = `SELECT p.*, bm.branch_name, bm.branch_code, s.shift_name 
       FROM period_master p 
       LEFT JOIN branch_master bm ON p.branch_id = bm.id 
       LEFT JOIN shift_master s ON p.shift_id = s.id 
       WHERE p.school_id = ? AND (p.status != 4 OR p.status IS NULL)`;
    const params = [schoolId];
    if (branchId) {
      sql += ` AND (p.branch_id = ? OR p.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` ORDER BY p.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getPeriodById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT p.*, bm.branch_name, bm.branch_code, s.shift_name 
         FROM period_master p 
         LEFT JOIN branch_master bm ON p.branch_id = bm.id 
         LEFT JOIN shift_master s ON p.shift_id = s.id 
         WHERE p.id = ? AND p.school_id = ? AND p.status != 4`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (p.branch_id = ? OR p.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getPeriodById:', e.message);
      return null;
    }
  }

  static async createPeriod(schoolId, { branch_id = null, shift_id = null, period_name, start_time = null, end_time = null, status = 1 }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;

    if (period_name && String(period_name).trim()) {
      let dupSql = `SELECT id FROM period_master WHERE school_id = ? AND LOWER(TRIM(period_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(period_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A period named "${period_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO period_master (school_id, branch_id, shift_id, period_name, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, shift_id ? Number(shift_id) : null, period_name, start_time, end_time, Number(status)]
    );
    return result.insertId;
  }

  static async updatePeriod(id, schoolId, { branch_id, shift_id = null, period_name, start_time, end_time, status }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    if (period_name && String(period_name).trim()) {
      let dupSql = `SELECT id FROM period_master WHERE school_id = ? AND LOWER(TRIM(period_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(period_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another period named "${period_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE period_master SET shift_id = ?, period_name = ?, start_time = ?, end_time = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [shift_id ? Number(shift_id) : null, period_name, start_time, end_time, Number(status), resolvedBranchId, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deletePeriod(id, schoolId, branchId = null) {
    let sql = `UPDATE period_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== LOOKUPS FOR ADD STUDENT ====================
  static async getCountries() {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, name AS country, name AS country_name, shortname, phonecode 
         FROM countries 
         WHERE (status != 4 AND status != 0) OR status IS NULL OR status = 1 
         ORDER BY name ASC`
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getCountries:', e.message);
      return [];
    }
  }

  static async getStates(countryId) {
    try {
      let sql = `SELECT id_state AS id, state, state AS name, country_id FROM states WHERE (is_active = 1 OR is_active IS NULL)`;
      const params = [];
      if (countryId) {
        sql += ` AND country_id = ?`;
        params.push(countryId);
      }
      sql += ` ORDER BY state ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getStates:', e.message);
      return [];
    }
  }

  static async getCities(stateId) {
    try {
      if (!stateId) return [];
      const sql = `SELECT id, name, name AS city, state_id FROM cities WHERE state_id = ? ORDER BY name ASC`;
      const [rows] = await pool.query(sql, [stateId]);
      return rows || [];
    } catch (e) {
      console.error('[AcademicModel.getCities] Error:', e.message);
      return [];
    }
  }

  static async getTransportRoutes(schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, transport_route, bus_id, sort_order, status, fare 
         FROM trans_route_master 
         WHERE school_id = ? 
           AND status != 4`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY id DESC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getTransportRoutes:', e.message);
      return [];
    }
  }

  static async getHostels(schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, hostel_name, sort_order, status, hostel_fee 
         FROM hostel_name_master 
         WHERE status != 4 AND school_id = ?`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY sort_order ASC, id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error fetching hostels:', e.message);
      return [];
    }
  }

  static async getHostelRooms(hostelId, schoolId, branchId = null) {
    try {
      let sql = `
        SELECT 
          hrm.id, 
          hrm.hostel_id, 
          hrm.room_number, 
          hrm.status,
          hrm.sort_order,
          hnm.hostel_name
        FROM hostel_room_master hrm
        LEFT JOIN hostel_name_master hnm ON hrm.hostel_id = hnm.id
        WHERE hrm.status != 4
      `;
      const params = [];
      if (schoolId) {
        sql += ` AND hrm.school_id = ?`;
        params.push(schoolId);
      }
      if (branchId) {
        sql += ` AND (hrm.branch_id = ? OR hrm.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      if (hostelId) {
        sql += ` AND (hrm.hostel_id = ? OR hnm.hostel_name = ?)`;
        params.push(hostelId, hostelId);
      }
      sql += ` ORDER BY hrm.sort_order ASC, hrm.room_number ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getHostelRooms:', e.message);
      return [];
    }
  }

  static async getDocumentTypes(schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, document_type_name, status 
         FROM document_type_master 
         WHERE school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getDocumentTypes:', e.message);
      return [];
    }
  }

  static async getDocumentTypeById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, document_type_name, status 
         FROM document_type_master 
         WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getDocumentTypeById:', e.message);
      return null;
    }
  }

  static async getGenders() {
    try {
      const [rows] = await pool.query(`SELECT id, gender FROM gender_master ORDER BY id ASC`);
      return rows || [];
    } catch (e) {
      console.error('Error in getGenders:', e.message);
      return [];
    }
  }

  static async getBloodGroups() {
    try {
      const [rows] = await pool.query(`SELECT id, blood_group, blood_group AS name FROM blood_group_master ORDER BY id ASC`);
      return rows || [];
    } catch (e) {
      console.error('Error in getBloodGroups:', e.message);
      return [];
    }
  }

  static async getMaritalStatuses() {
    try {
      const [rows] = await pool.query(
        `SELECT id, marital_status, marital_status AS name FROM marital_master WHERE (status = 1 OR status IS NULL) ORDER BY id ASC`
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getMaritalStatuses:', e.message);
      return [];
    }
  }

  static async getReligions(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, religion, status FROM religion_master WHERE school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getReligions:', e.message);
      return [];
    }
  }

  static async getCategories(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, category, status FROM student_category_master WHERE school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getCategories:', e.message);
      return [];
    }
  }

  static async getMotherTongues(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, mother_tongue, status FROM mother_tongue_master WHERE school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getMotherTongues:', e.message);
      return [];
    }
  }

  static async getStudentMasters(schoolId, branchId = null) {
    const [
      academicYears,
      classes,
      genders,
      bloodGroups,
      houses,
      religions,
      categories,
      motherTongues,
      countries,
      transportRoutes,
      hostels,
      documentTypes,
    ] = await Promise.all([
      AcademicModel.getAcademicYears(schoolId, branchId),
      AcademicModel.getClasses(schoolId, false, null, branchId),
      AcademicModel.getGenders(),
      AcademicModel.getBloodGroups(),
      AcademicModel.getHouses(schoolId, branchId),
      AcademicModel.getReligions(schoolId),
      AcademicModel.getCategories(schoolId),
      AcademicModel.getMotherTongues(schoolId),
      AcademicModel.getCountries(),
      AcademicModel.getTransportRoutes(schoolId, branchId),
      AcademicModel.getHostels(schoolId, branchId),
      AcademicModel.getDocumentTypes(schoolId, branchId),
    ]);

    return {
      academicYears,
      classes,
      genders,
      bloodGroups,
      houses,
      religions,
      categories,
      motherTongues,
      countries,
      transportRoutes,
      hostels,
      documentTypes,
    };
  }

  static async getNextRollNumber(schoolId, classId, sectionId, branchId = null) {
    try {
      let sql = `SELECT MAX(CAST(roll_number AS UNSIGNED)) AS max_roll FROM student_master WHERE school_id = ? AND class = ? AND section = ? AND status != 0`;
      const params = [schoolId, classId, sectionId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      const [rows] = await pool.query(sql, params);
      const maxRoll = rows[0]?.max_roll || 0;
      return Number(maxRoll) + 1;
    } catch (e) {
      return 1;
    }
  }

  // ==================== DAYS ====================
  static async getDays(schoolId, branchId = null) {
    try {
      let sql = `
        SELECT d.*, bm.branch_name, bm.branch_code 
        FROM days_master d
        LEFT JOIN branch_master bm ON d.branch_id = bm.id
        WHERE d.school_id = ? AND (d.status != 4 OR d.status IS NULL)
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (d.branch_id = ? OR d.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY d.id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error fetching days:', e.message);
      return [];
    }
  }

  static async getDayById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT d.*, bm.branch_name, bm.branch_code 
         FROM days_master d 
         LEFT JOIN branch_master bm ON d.branch_id = bm.id 
         WHERE d.id = ? AND d.school_id = ? AND (d.status != 4 OR d.status IS NULL)`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (d.branch_id = ? OR d.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error fetching day by id:', e.message);
      return null;
    }
  }

  static async createDay(schoolId, { day_name, branch_id = null, status = 1 }) {
    let resolvedBranchId = branch_id !== undefined && branch_id !== null && branch_id !== '' ? Number(branch_id) : null;
    if (!resolvedBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) resolvedBranchId = mainB[0].id;
      } catch (e) {}
    }

    if (day_name && String(day_name).trim()) {
      let dupSql = `SELECT id FROM days_master WHERE school_id = ? AND LOWER(TRIM(day_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(day_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A day named "${day_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO days_master (school_id, branch_id, day_name, status) VALUES (?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, day_name, Number(status)]
    );
    return result.insertId;
  }

  static async updateDay(id, schoolId, { day_name, branch_id, status }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id !== null && branch_id !== '' ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    if (day_name && String(day_name).trim()) {
      let dupSql = `SELECT id FROM days_master WHERE school_id = ? AND LOWER(TRIM(day_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(day_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another day named "${day_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const updates = [];
    const params = [];

    if (day_name !== undefined) {
      updates.push('day_name = ?');
      params.push(day_name);
    }
    if (branch_id !== undefined) {
      updates.push('branch_id = ?');
      params.push(branch_id !== null && branch_id !== '' ? Number(branch_id) : null);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(Number(status));
    }

    if (updates.length === 0) return true;

    params.push(id, schoolId);
    let sql = `UPDATE days_master SET ${updates.join(', ')} WHERE id = ? AND school_id = ?`;
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteDay(id, schoolId, branchId = null) {
    let sql = `UPDATE days_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== DOCUMENT TYPES ====================
  static async createDocumentType(schoolId, { document_type_name, status = 1, branch_id = null }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;

    if (document_type_name && String(document_type_name).trim()) {
      let dupSql = `SELECT id FROM document_type_master WHERE school_id = ? AND LOWER(TRIM(document_type_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(document_type_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A document type named "${document_type_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO document_type_master (school_id, branch_id, document_type_name, status) VALUES (?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, document_type_name, Number(status)]
    );
    return result.insertId;
  }

  static async updateDocumentType(id, schoolId, { document_type_name, status = 1, branch_id = null }, branchId = null) {
    const resolvedBranchId = branch_id ? Number(branch_id) : (branchId ? Number(branchId) : null);

    if (document_type_name && String(document_type_name).trim()) {
      let dupSql = `SELECT id FROM document_type_master WHERE school_id = ? AND LOWER(TRIM(document_type_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(document_type_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another document type named "${document_type_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE document_type_master SET document_type_name = ?, status = ? WHERE id = ? AND school_id = ?`;
    const params = [document_type_name, Number(status), id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteDocumentType(id, schoolId, branchId = null) {
    let sql = `UPDATE document_type_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== ROUTINES ====================
  static async getRoutines(schoolId, { classId, sectionId, day, teacherId, branchId = null } = {}) {
    try {
      let sql = `
        SELECT r.*, cm.class_name, sec.section_name, sm.subject_name, 
               CONCAT(TRIM(IFNULL(tm.first_name, '')), ' ', IFNULL(TRIM(tm.last_name), '')) AS teacher_name, 
               tm.picture AS teacher_picture,
               pm.period_name, pm.start_time, pm.end_time,
               shm.shift_name,
               dm.day_name
        FROM routine r
        LEFT JOIN class_master cm ON cm.id = r.class_id
        LEFT JOIN section_master sec ON sec.id = r.section_id
        LEFT JOIN subject_master sm ON sm.id = r.subject_id
        LEFT JOIN teacher_master tm ON tm.id = r.teacher_id
        LEFT JOIN period_master pm ON pm.id = r.period_id
        LEFT JOIN days_master dm ON dm.id = r.day
        LEFT JOIN shift_master shm ON shm.id = r.shift_id
        WHERE r.school_id = ?
        AND (r.status != 4 OR r.status IS NULL)
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (r.branch_id = ? OR cm.branch_id = ?)`;
        params.push(Number(branchId), Number(branchId));
      }
      if (classId) {
        sql += ` AND r.class_id = ?`;
        params.push(classId);
      }
      if (sectionId) {
        sql += ` AND r.section_id = ?`;
        params.push(sectionId);
      }
      if (day) {
        sql += ` AND r.day = ?`;
        params.push(day);
      }
      if (teacherId) {
        sql += ` AND r.teacher_id = ?`;
        params.push(teacherId);
      }
      sql += ` ORDER BY r.day ASC, pm.start_time ASC, r.id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      console.error('Error in getRoutines:', e.message);
      return [];
    }
  }

  static async checkRoutineConflicts(schoolId, { routineId = null, class_id, section_id, day, period_id, teacher_id }) {
    // 1. Check if this Class and Section already has a scheduled routine for this day and period
    if (class_id && section_id && day && period_id) {
      let slotSql = `
        SELECT r.id, sm.subject_name, pm.period_name
        FROM routine r
        LEFT JOIN subject_master sm ON sm.id = r.subject_id
        LEFT JOIN period_master pm ON pm.id = r.period_id
        WHERE r.school_id = ?
          AND r.class_id = ?
          AND r.section_id = ?
          AND r.day = ?
          AND r.period_id = ?
          AND (r.status != 4 OR r.status IS NULL)
      `;
      const slotParams = [schoolId, class_id, section_id, day, period_id];
      if (routineId) {
        slotSql += ` AND r.id != ?`;
        slotParams.push(routineId);
      }
      slotSql += ` LIMIT 1`;
      const [existingSlots] = await pool.query(slotSql, slotParams);
      if (existingSlots.length > 0) {
        const slot = existingSlots[0];
        const subName = slot.subject_name ? `"${slot.subject_name}"` : 'a subject';
        const perName = slot.period_name ? ` (${slot.period_name})` : '';
        const err = new Error(`Conflict: This class and section already has ${subName} scheduled for this period${perName}.`);
        err.statusCode = 409;
        err.status = 409;
        throw err;
      }
    }

    // 2. Check if the teacher is already assigned to another class/section with overlapping time on the same day
    if (teacher_id && day && period_id) {
      const [targetPerRows] = await pool.query(
        `SELECT start_time, end_time, period_name FROM period_master WHERE id = ?`,
        [period_id]
      );
      const targetPer = targetPerRows[0] || null;
      const targetStart = targetPer?.start_time || null;
      const targetEnd = targetPer?.end_time || null;

      let teacherSql = `
        SELECT 
          r.id,
          cm.class_name,
          sec.section_name,
          sm.subject_name,
          pm.period_name,
          TIME_FORMAT(pm.start_time, '%H:%i') AS start_time,
          TIME_FORMAT(pm.end_time, '%H:%i') AS end_time,
          CONCAT(TRIM(IFNULL(tm.first_name, '')), ' ', IFNULL(TRIM(tm.last_name), '')) AS teacher_name
        FROM routine r
        JOIN period_master pm ON pm.id = r.period_id
        LEFT JOIN class_master cm ON cm.id = r.class_id
        LEFT JOIN section_master sec ON sec.id = r.section_id
        LEFT JOIN subject_master sm ON sm.id = r.subject_id
        LEFT JOIN teacher_master tm ON tm.id = r.teacher_id
        WHERE r.school_id = ?
          AND r.day = ?
          AND r.teacher_id = ?
          AND (r.status != 4 OR r.status IS NULL)
      `;
      const teacherParams = [schoolId, day, teacher_id];

      if (targetStart && targetEnd) {
        teacherSql += ` AND (
          (pm.start_time IS NOT NULL AND pm.end_time IS NOT NULL AND ? < pm.end_time AND ? > pm.start_time)
          OR r.period_id = ?
        )`;
        teacherParams.push(targetStart, targetEnd, period_id);
      } else {
        teacherSql += ` AND r.period_id = ?`;
        teacherParams.push(period_id);
      }

      if (routineId) {
        teacherSql += ` AND r.id != ?`;
        teacherParams.push(routineId);
      }
      teacherSql += ` LIMIT 1`;

      const [conflicts] = await pool.query(teacherSql, teacherParams);
      if (conflicts.length > 0) {
        const c = conflicts[0];
        const teacherName = c.teacher_name?.trim() || 'This teacher';
        const className = c.class_name || 'another class';
        const sectionName = c.section_name ? ` - Section ${c.section_name}` : '';
        const timeRange = (c.start_time && c.end_time) ? ` (${c.start_time} - ${c.end_time})` : '';
        const periodName = c.period_name ? ` during ${c.period_name}` : '';
        const err = new Error(
          `Conflict: Teacher ${teacherName} is already scheduled in ${className}${sectionName}${periodName}${timeRange}.`
        );
        err.statusCode = 409;
        err.status = 409;
        throw err;
      }
    }
  }

  static async createRoutine(schoolId, { branch_id = null, class_id, section_id, day, period_id, teacher_id, subject_id, shift_id }) {
    await AcademicModel.checkRoutineConflicts(schoolId, {
      class_id,
      section_id,
      day,
      period_id,
      teacher_id,
    });

    let resolvedBranchId = branch_id;
    if (!resolvedBranchId && class_id) {
      const [cm] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ?`, [class_id]);
      if (cm.length && cm[0].branch_id) resolvedBranchId = cm[0].branch_id;
    }
    if (!resolvedBranchId) {
      const [mb] = await pool.query(`SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC LIMIT 1`, [schoolId]);
      if (mb.length) resolvedBranchId = mb[0].id;
    }

    let finalShiftId = shift_id;
    if (!finalShiftId && period_id) {
      const [perRows] = await pool.query(`SELECT shift_id FROM period_master WHERE id = ?`, [period_id]);
      if (perRows.length > 0 && perRows[0].shift_id) {
        finalShiftId = perRows[0].shift_id;
      }
    }
    if (!finalShiftId && class_id) {
      const [clsRows] = await pool.query(`SELECT shift_id FROM class_master WHERE id = ?`, [class_id]);
      if (clsRows.length > 0 && clsRows[0].shift_id) {
        finalShiftId = clsRows[0].shift_id;
      }
    }
    const [result] = await pool.query(
      `INSERT INTO routine (school_id, branch_id, class_id, section_id, day, period_id, teacher_id, subject_id, shift_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [schoolId, resolvedBranchId, class_id, section_id, day, period_id, teacher_id || null, subject_id, finalShiftId || null]
    );
    return result.insertId;
  }

  static async updateRoutine(id, schoolId, { class_id, section_id, day, period_id, teacher_id, subject_id, shift_id }) {
    const [existing] = await pool.query(`SELECT * FROM routine WHERE id = ? AND school_id = ?`, [id, schoolId]);
    if (existing.length === 0) return false;
    const current = existing[0];

    const finalClassId = class_id !== undefined ? class_id : current.class_id;
    const finalSectionId = section_id !== undefined ? section_id : current.section_id;
    const finalDay = day !== undefined ? day : current.day;
    const finalPeriodId = period_id !== undefined ? period_id : current.period_id;
    const finalTeacherId = teacher_id !== undefined ? teacher_id : current.teacher_id;
    const finalSubjectId = subject_id !== undefined ? subject_id : current.subject_id;

    await AcademicModel.checkRoutineConflicts(schoolId, {
      routineId: id,
      class_id: finalClassId,
      section_id: finalSectionId,
      day: finalDay,
      period_id: finalPeriodId,
      teacher_id: finalTeacherId,
    });

    let finalShiftId = shift_id;
    if (!finalShiftId && finalPeriodId) {
      const [perRows] = await pool.query(`SELECT shift_id FROM period_master WHERE id = ?`, [finalPeriodId]);
      if (perRows.length > 0 && perRows[0].shift_id) {
        finalShiftId = perRows[0].shift_id;
      }
    }
    const [result] = await pool.query(
      `UPDATE routine SET class_id = ?, section_id = ?, day = ?, period_id = ?, teacher_id = ?, subject_id = ?, shift_id = ?, updated_at = NOW()
       WHERE id = ? AND school_id = ?`,
      [finalClassId, finalSectionId, finalDay, finalPeriodId, finalTeacherId || null, finalSubjectId, finalShiftId || null, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteRoutine(id, schoolId, branchId = null) {
    let sql = `UPDATE routine SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND branch_id = ?`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== CLASS ASSIGNED TEACHERS (teacher_class_assign & teacher_master) ====================
  static async getClassAssignedTeachers(schoolId, { classId, subjectId, branchId = null } = {}) {
    try {
      let sql = `
        SELECT * FROM (
          SELECT DISTINCT 
            tm.id, 
            tm.first_name, 
            tm.last_name, 
            CONCAT(TRIM(tm.first_name), ' ', IFNULL(TRIM(tm.last_name), '')) AS full_name,
            tm.teacher_id AS teacher_code,
            tm.picture,
            tca.class_id, 
            tca.subject_id,
            sm.subject_name
          FROM teacher_class_assign tca
          JOIN teacher_master tm ON tca.teacher_id = tm.id
          LEFT JOIN subject_master sm ON sm.id = tca.subject_id
          WHERE tca.school_id = ?
            AND tca.status = 1 
            AND tm.status = 1
            AND (? IS NULL OR tca.class_id = ?)
            ${branchId ? 'AND tm.branch_id = ?' : ''}

          UNION

          SELECT DISTINCT
            tm.id, 
            tm.first_name, 
            tm.last_name, 
            CONCAT(TRIM(tm.first_name), ' ', IFNULL(TRIM(tm.last_name), '')) AS full_name,
            tm.teacher_id AS teacher_code,
            tm.picture,
            tm.class AS class_id, 
            tm.subject AS subject_id,
            sm.subject_name
          FROM teacher_master tm
          LEFT JOIN subject_master sm ON sm.id = tm.subject
          WHERE tm.school_id = ?
            AND tm.status = 1
            AND (? IS NULL OR tm.class = ?)
            ${branchId ? 'AND tm.branch_id = ?' : ''}
        ) AS combined
        WHERE 1=1
      `;
      const params = [
        schoolId, classId || null, classId || null,
        ...(branchId ? [Number(branchId)] : []),
        schoolId, classId || null, classId || null,
        ...(branchId ? [Number(branchId)] : []),
      ];

      if (subjectId) {
        sql += ` AND (
          subject_id = ? 
          OR LOWER(subject_name) = (SELECT LOWER(subject_name) FROM subject_master WHERE id = ? LIMIT 1)
        )`;
        params.push(subjectId, subjectId);
      }

      sql += ` ORDER BY first_name ASC, last_name ASC`;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      console.error('Error in getClassAssignedTeachers:', e.message);
      return [];
    }
  }

  // ==================== LESSONS / SYLLABUS ====================
  static async getSyllabusList(schoolId, { academic_year, academic_year_id, class_id, classId, subject_id, subjectId, status, search, page = 1, limit = 10, branchId = null } = {}) {
    try {
      let baseSql = `
        FROM syllabus s
        LEFT JOIN class_master cm ON cm.id = s.class_id
        LEFT JOIN subject_master sm ON sm.id = s.subject_id
        LEFT JOIN academic_year_master aym ON aym.id = s.academic_year
        WHERE s.school_id = ?
          AND (s.status != 4 OR s.status IS NULL)
      `;
      const params = [schoolId];

      if (branchId) {
        baseSql += ` AND (s.branch_id = ? OR cm.branch_id = ?)`;
        params.push(Number(branchId), Number(branchId));
      }

      const effectiveYear = academic_year || academic_year_id;
      if (effectiveYear) {
        baseSql += ` AND s.academic_year = ?`;
        params.push(effectiveYear);
      }

      const effectiveClass = class_id || classId;
      if (effectiveClass) {
        baseSql += ` AND s.class_id = ?`;
        params.push(effectiveClass);
      }

      const effectiveSubject = subject_id || subjectId;
      if (effectiveSubject) {
        baseSql += ` AND s.subject_id = ?`;
        params.push(effectiveSubject);
      }

      if (status !== undefined && status !== null && String(status).trim() !== '' && String(status).trim() !== '0' && String(status).toLowerCase() !== 'all') {
        baseSql += ` AND s.status = ?`;
        params.push(Number(status));
      }

      if (search && String(search).trim()) {
        baseSql += ` AND (s.lession LIKE ? OR sm.subject_name LIKE ? OR cm.class_name LIKE ?)`;
        const searchParam = `%${String(search).trim()}%`;
        params.push(searchParam, searchParam, searchParam);
      }

      // 1. Total Count Query
      const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      // 2. Data Query with LIMIT & OFFSET
      const numLimit = Math.max(1, Number(limit) || 10);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `
        SELECT s.*, 
          cm.class_name, 
          sm.subject_name,
          aym.academic_year AS academic_year_code,
          CONCAT(DATE_FORMAT(aym.start_date, '%M %Y'), ' - ', DATE_FORMAT(aym.end_date, '%M %Y')) AS academic_year_name
        ${baseSql}
        ORDER BY s.id ASC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...params, numLimit, offset];
      const [rows] = await pool.query(dataSql, dataParams);

      const totalPages = Math.ceil(total / numLimit) || 1;

      return {
        syllabus: rows,
        total,
        page: numPage,
        limit: numLimit,
        totalPages,
      };
    } catch (e) {
      console.error('Error in getSyllabusList:', e.message);
      return { syllabus: [], total: 0, page: 1, limit: 10, totalPages: 1 };
    }
  }

  static async getSyllabusById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT s.*, 
          cm.class_name, 
          sm.subject_name,
          aym.academic_year AS academic_year_code,
          CONCAT(DATE_FORMAT(aym.start_date, '%M %Y'), ' - ', DATE_FORMAT(aym.end_date, '%M %Y')) AS academic_year_name
        FROM syllabus s
        LEFT JOIN class_master cm ON cm.id = s.class_id
        LEFT JOIN subject_master sm ON sm.id = s.subject_id
        LEFT JOIN academic_year_master aym ON aym.id = s.academic_year
        WHERE s.id = ? 
          AND s.school_id = ?
          AND (s.status != 4 OR s.status IS NULL)`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSyllabusById:', e.message);
      return null;
    }
  }

  static async createSyllabus(schoolId, { branch_id = null, academic_year, class_id, subject_id, lession, status = 1 }) {
    let resolvedBranchId = branch_id;
    if (!resolvedBranchId && class_id) {
      const [cm] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ?`, [class_id]);
      if (cm.length && cm[0].branch_id) resolvedBranchId = cm[0].branch_id;
    }
    if (!resolvedBranchId) {
      const [mb] = await pool.query(`SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC LIMIT 1`, [schoolId]);
      if (mb.length) resolvedBranchId = mb[0].id;
    }

    const [result] = await pool.query(
      `INSERT INTO syllabus (school_id, branch_id, academic_year, class_id, subject_id, lession, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [schoolId, resolvedBranchId, academic_year, class_id, subject_id, lession, status || 1]
    );
    return result.insertId;
  }

  static async updateSyllabus(id, schoolId, { academic_year, class_id, subject_id, lession, status, branch_id = null }, branchId = null) {
    let sql = `UPDATE syllabus 
       SET academic_year = COALESCE(?, academic_year),
           class_id = COALESCE(?, class_id),
           subject_id = COALESCE(?, subject_id),
           lession = ?,
           status = ?
       WHERE id = ? AND school_id = ?`;
    const params = [academic_year || null, class_id || null, subject_id || null, lession, status, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async updateSyllabusStatus(id, schoolId, status, branchId = null) {
    let sql = `UPDATE syllabus SET status = ? WHERE id = ? AND school_id = ?`;
    const params = [Number(status), id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteSyllabus(id, schoolId, branchId = null) {
    let sql = `UPDATE syllabus SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND branch_id = ?`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async getLessons(schoolId, { classId, subjectId, branchId = null } = {}) {
    try {
      let sql = `
        SELECT lm.*, cm.class_name, sm.subject_name
        FROM lession_master lm
        LEFT JOIN class_master cm ON cm.id = lm.class_id
        LEFT JOIN subject_master sm ON sm.id = lm.subject_id
        WHERE lm.school_id = ? AND (lm.status != 4 OR lm.status IS NULL)
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (cm.branch_id = ? OR cm.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      if (classId) {
        sql += ` AND lm.class_id = ?`;
        params.push(classId);
      }
      if (subjectId) {
        sql += ` AND lm.subject_id = ?`;
        params.push(subjectId);
      }
      sql += ` ORDER BY lm.id DESC`;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      return [];
    }
  }

  static async createLesson(schoolId, { class_id, subject_id, lession_name, lession_description, branch_id = null }) {
    const [result] = await pool.query(
      `INSERT INTO lession_master (school_id, branch_id, class_id, subject_id, lession_name, lession_description, status)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [schoolId, branch_id ? Number(branch_id) : null, class_id, subject_id, lession_name, lession_description || '']
    );
    return result.insertId;
  }

  static async deleteLesson(id, schoolId, branchId = null) {
    let sql = `UPDATE lession_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== ASSIGNMENTS ====================
  static async getAssignmentTypes(schoolId, options = {}) {
    try {
      const normalizedOpts =
        typeof options === 'boolean'
          ? { status: options ? 1 : undefined, limit: 100 }
          : options || {};
      const { search, status, page = 1, limit = 10, branchId = null, branch_id = null } = normalizedOpts;
      const cleanBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);

      let baseSql = `
        FROM assignment_types at
        LEFT JOIN branch_master bm ON at.branch_id = bm.id
        WHERE at.school_id = ?
      `;
      const params = [schoolId];

      if (cleanBranchId) {
        baseSql += ` AND at.branch_id = ?`;
        params.push(cleanBranchId);
      }

      if (status !== undefined && status !== null && String(status).trim() !== '') {
        baseSql += ` AND at.status = ?`;
        params.push(Number(status));
      } else {
        baseSql += ` AND (at.status != 4 OR at.status IS NULL)`;
      }

      if (search && String(search).trim()) {
        baseSql += ` AND at.type_name LIKE ?`;
        params.push(`%${String(search).trim()}%`);
      }

      // 1. Count query
      const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      // 2. Data query
      const numLimit = Math.max(1, Number(limit) || 10);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `
        SELECT at.*, bm.branch_name, bm.branch_code ${baseSql}
        ORDER BY at.id ASC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...params, numLimit, offset];
      const [rows] = await pool.query(dataSql, dataParams);

      const totalPages = Math.ceil(total / numLimit) || 1;

      return {
        assignment_types: rows || [],
        total,
        page: numPage,
        limit: numLimit,
        totalPages,
      };
    } catch (e) {
      console.error('Error in getAssignmentTypes:', e.message);
      return {
        assignment_types: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
    }
  }

  static async getAssignmentTypeById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT at.*, bm.branch_name, bm.branch_code
        FROM assignment_types at
        LEFT JOIN branch_master bm ON at.branch_id = bm.id
        WHERE at.id = ? AND at.school_id = ? AND (at.status != 4 OR at.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND at.branch_id = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getAssignmentTypeById:', e.message);
      return null;
    }
  }

  static async createAssignmentType(schoolId, { type_name, status = 1, branch_id = null, branchId = null }) {
    const cleanName = String(type_name || '').trim();
    if (!cleanName) {
      const err = new Error('Assignment type name is required.');
      err.statusCode = 400;
      throw err;
    }

    const resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId, branch_id ?? branchId);

    let dupSql = `SELECT id FROM assignment_types WHERE school_id = ? AND LOWER(TRIM(type_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
    const dupParams = [schoolId, cleanName];
    if (resolvedBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(resolvedBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    dupSql += ` LIMIT 1`;
    const [existing] = await pool.query(dupSql, dupParams);
    if (existing && existing.length > 0) {
      const err = new Error(`An assignment type named "${cleanName}" already exists in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    const [result] = await pool.query(
      `INSERT INTO assignment_types (school_id, branch_id, type_name, status, created_on) VALUES (?, ?, ?, ?, NOW())`,
      [schoolId, resolvedBranchId, cleanName, status || 1]
    );
    return result.insertId;
  }

  static async updateAssignmentType(id, schoolId, { type_name, status, branch_id = null }, branchId = null) {
    const filterBranch = AcademicModel.parseBranchId(branchId);

    let checkSql = `SELECT id, branch_id, type_name FROM assignment_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const checkParams = [id, schoolId];
    if (filterBranch) {
      checkSql += ` AND branch_id = ?`;
      checkParams.push(filterBranch);
    }
    checkSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(checkSql, checkParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }

    const targetBranchId = AcademicModel.parseBranchId(branch_id) || filterBranch || AcademicModel.parseBranchId(existingRows[0].branch_id);

    if (type_name && String(type_name).trim()) {
      const cleanName = String(type_name).trim();
      let dupSql = `SELECT id FROM assignment_types WHERE school_id = ? AND LOWER(TRIM(type_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, cleanName, id];
      if (targetBranchId) {
        dupSql += ` AND branch_id = ?`;
        dupParams.push(targetBranchId);
      } else {
        dupSql += ` AND branch_id IS NULL`;
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another assignment type named "${cleanName}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE assignment_types 
       SET type_name = COALESCE(?, type_name),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`;
    const params = [type_name ? String(type_name).trim() : null, status !== undefined ? status : null, id, schoolId];
    if (filterBranch) {
      sql += ` AND branch_id = ?`;
      params.push(filterBranch);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteAssignmentType(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `UPDATE assignment_types SET status = 4 WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  /**
   * Validates that class_id, section_id, subject_id, and assignment_type_id
   * belong to the specified school_id and branch_id (and teacher assignments if teacherId is provided),
   * and enforces branch-scoped duplicate validation on assignments.
   */
  static async validateAssignmentRelations(schoolId, branchId, data, teacherId = null, excludeAssignmentId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    const {
      assignment_type_id,
      title,
      class_id,
      section_id,
      subject_id,
    } = data;

    if (!title || !String(title).trim()) {
      const err = new Error('Assignment title is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!class_id) {
      const err = new Error('Class is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!subject_id) {
      const err = new Error('Subject is required.');
      err.statusCode = 400;
      throw err;
    }

    // 1. Validate Class belongs to school and branch
    let clsSql = `SELECT id, branch_id, class_name FROM class_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const clsParams = [class_id, schoolId];
    if (cleanBranchId) {
      clsSql += ` AND branch_id = ?`;
      clsParams.push(cleanBranchId);
    }
    clsSql += ` LIMIT 1`;
    const [clsRows] = await pool.query(clsSql, clsParams);
    if (!clsRows || clsRows.length === 0) {
      const err = new Error('Selected class does not belong to the authorized school and branch.');
      err.statusCode = 400;
      throw err;
    }

    const effectiveBranchId = cleanBranchId || AcademicModel.parseBranchId(clsRows[0].branch_id);

    // If teacherId is provided, verify teacher belongs to this school/branch and is assigned to this class
    if (teacherId) {
      let tSql = `SELECT id, branch_id, class, subject FROM teacher_master WHERE id = ? AND school_id = ? AND status != 4`;
      const tParams = [teacherId, schoolId];
      if (effectiveBranchId) {
        tSql += ` AND branch_id = ?`;
        tParams.push(effectiveBranchId);
      }
      tSql += ` LIMIT 1`;
      const [tRows] = await pool.query(tSql, tParams);
      if (!tRows || tRows.length === 0) {
        const err = new Error('Teacher does not belong to the authorized school and branch.');
        err.statusCode = 403;
        throw err;
      }

      const [tcaCountRows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND status = 1`,
        [teacherId, schoolId]
      );
      const hasClassAssignments = (tcaCountRows?.[0]?.cnt || 0) > 0;
      if (hasClassAssignments) {
        const [assignedCls] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id]
        );
        const isPrimaryClass = Number(tRows[0].class) === Number(class_id);
        if ((!assignedCls || assignedCls.length === 0) && !isPrimaryClass) {
          const err = new Error('You are not assigned to the selected class in your branch.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 2. Validate Section (if provided) belongs to school, branch, and class
    if (section_id !== undefined && section_id !== null && String(section_id).trim() !== '' && Number(section_id) > 0) {
      let secSql = `SELECT sec.id FROM section_master sec
        LEFT JOIN class_master cm ON sec.class_id = cm.id
        WHERE sec.id = ? AND sec.school_id = ? AND sec.class_id = ? AND (sec.status != 4 OR sec.status IS NULL)`;
      const secParams = [section_id, schoolId, class_id];
      if (effectiveBranchId) {
        secSql += ` AND COALESCE(sec.branch_id, cm.branch_id) = ?`;
        secParams.push(effectiveBranchId);
      }
      secSql += ` LIMIT 1`;
      const [secRows] = await pool.query(secSql, secParams);
      if (!secRows || secRows.length === 0) {
        const err = new Error('Selected section does not belong to the selected class and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 3. Validate Subject belongs to school, branch, and class
    let subSql = `SELECT sm.id FROM subject_master sm
      LEFT JOIN class_master cm ON sm.class_id = cm.id
      WHERE sm.id = ? AND sm.school_id = ? AND (sm.class_id = ? OR sm.class_id IS NULL) AND (sm.status != 4 OR sm.status IS NULL)`;
    const subParams = [subject_id, schoolId, class_id];
    if (effectiveBranchId) {
      subSql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
      subParams.push(effectiveBranchId);
    }
    subSql += ` LIMIT 1`;
    const [subRows] = await pool.query(subSql, subParams);
    if (!subRows || subRows.length === 0) {
      const err = new Error('Selected subject does not belong to the selected class and branch.');
      err.statusCode = 400;
      throw err;
    }

    // If teacherId is provided and teacher has subject assignments for this class, verify subject assignment
    if (teacherId) {
      const [tcaSubCount] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id > 0 AND status = 1`,
        [teacherId, schoolId, class_id]
      );
      if ((tcaSubCount?.[0]?.cnt || 0) > 0) {
        const [assignedSub] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id, subject_id]
        );
        if (!assignedSub || assignedSub.length === 0) {
          const err = new Error('You are not assigned to teach the selected subject for this class.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 4. Validate Assignment Type (if provided) belongs to school and branch
    if (assignment_type_id !== undefined && assignment_type_id !== null && String(assignment_type_id).trim() !== '' && Number(assignment_type_id) > 0) {
      let atSql = `SELECT id FROM assignment_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const atParams = [assignment_type_id, schoolId];
      if (effectiveBranchId) {
        atSql += ` AND branch_id = ?`;
        atParams.push(effectiveBranchId);
      }
      atSql += ` LIMIT 1`;
      const [atRows] = await pool.query(atSql, atParams);
      if (!atRows || atRows.length === 0) {
        const err = new Error('Selected assignment type does not belong to the authorized school and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 5. Branch-scoped duplicate check (same title + class + section + subject within the same school and branch)
    let dupSql = `SELECT id FROM assignments
      WHERE school_id = ?
        AND class_id = ?
        AND subject_id = ?
        AND COALESCE(section_id, 0) = COALESCE(?, 0)
        AND LOWER(TRIM(title)) = LOWER(TRIM(?))
        AND (status != 4 OR status IS NULL)`;
    const dupParams = [
      schoolId,
      class_id,
      subject_id,
      section_id && Number(section_id) > 0 ? Number(section_id) : 0,
      String(title).trim(),
    ];
    if (effectiveBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(effectiveBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    if (excludeAssignmentId) {
      dupSql += ` AND id != ?`;
      dupParams.push(excludeAssignmentId);
    }
    dupSql += ` LIMIT 1`;
    const [dupRows] = await pool.query(dupSql, dupParams);
    if (dupRows && dupRows.length > 0) {
      const err = new Error(`An assignment titled "${String(title).trim()}" already exists for this class, section, and subject in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    return effectiveBranchId;
  }

  static async getAssignments(schoolId, { classId, class_id, sectionId, section_id, subjectId, subject_id, assignmentTypeId, assignment_type_id, search, status, page, limit, branchId = null, branch_id = null, teacherId = null } = {}) {
    try {
      const cId = classId || class_id;
      const sId = sectionId || section_id;
      const subId = subjectId || subject_id;
      const atId = assignmentTypeId || assignment_type_id;
      const cleanBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);

      let baseSql = `
        FROM assignments a
        LEFT JOIN assignment_types at ON at.id = a.assignment_type_id
        LEFT JOIN class_master cm ON cm.id = a.class_id
        LEFT JOIN section_master sec ON sec.id = a.section_id
        LEFT JOIN subject_master sm ON sm.id = a.subject_id
        WHERE a.school_id = ?
          AND (a.status != 4 OR a.status IS NULL)
      `;
      const params = [schoolId];

      if (cleanBranchId) {
        baseSql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
        params.push(cleanBranchId);
      }

      if (teacherId) {
        baseSql += ` AND (
          EXISTS (
            SELECT 1 FROM teacher_class_assign tca
            WHERE tca.teacher_id = ? AND tca.school_id = a.school_id AND tca.class_id = a.class_id AND tca.status = 1
          )
          OR EXISTS (
            SELECT 1 FROM teacher_master tm
            WHERE tm.id = ? AND tm.school_id = a.school_id AND tm.class = a.class_id AND tm.status != 4
          )
        )`;
        params.push(Number(teacherId), Number(teacherId));
      }

      if (cId) {
        baseSql += ` AND a.class_id = ?`;
        params.push(cId);
      }
      if (sId) {
        baseSql += ` AND a.section_id = ?`;
        params.push(sId);
      }
      if (subId) {
        baseSql += ` AND a.subject_id = ?`;
        params.push(subId);
      }
      if (atId) {
        baseSql += ` AND a.assignment_type_id = ?`;
        params.push(atId);
      }
      if (status !== undefined && status !== '') {
        baseSql += ` AND a.status = ?`;
        params.push(status);
      }
      if (search && String(search).trim()) {
        baseSql += ` AND (a.title LIKE ? OR at.type_name LIKE ?)`;
        params.push(`%${String(search).trim()}%`, `%${String(search).trim()}%`);
      }

      // If pagination requested
      if (page && limit) {
        const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
        const [countRows] = await pool.query(countSql, params);
        const total = countRows[0]?.total || 0;

        const numLimit = Math.max(1, Number(limit) || 10);
        const numPage = Math.max(1, Number(page) || 1);
        const offset = (numPage - 1) * numLimit;

        const dataSql = `
          SELECT a.*, at.type_name, cm.class_name, sec.section_name, sm.subject_name,
                 (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND aq.school_id = a.school_id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count
          ${baseSql}
          ORDER BY a.id DESC
          LIMIT ? OFFSET ?
        `;
        const dataParams = [...params, numLimit, offset];
        const [rows] = await pool.query(dataSql, dataParams);
        const totalPages = Math.ceil(total / numLimit) || 1;

        return {
          assignments: rows,
          total,
          page: numPage,
          limit: numLimit,
          totalPages,
        };
      }

      const sql = `
        SELECT a.*, at.type_name, cm.class_name, sec.section_name, sm.subject_name,
               (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND aq.school_id = a.school_id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count
        ${baseSql}
        ORDER BY a.id DESC
      `;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      console.error('Error in getAssignments:', e.message);
      return [];
    }
  }

  static async getAssignmentById(id, schoolId, branchId = null, teacherId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT a.*, at.type_name, cm.class_name, sec.section_name, sm.subject_name,
                (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND aq.school_id = a.school_id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count
         FROM assignments a
         LEFT JOIN assignment_types at ON at.id = a.assignment_type_id
         LEFT JOIN class_master cm ON cm.id = a.class_id
         LEFT JOIN section_master sec ON sec.id = a.section_id
         LEFT JOIN subject_master sm ON sm.id = a.subject_id
         WHERE a.id = ? AND a.school_id = ? AND (a.status != 4 OR a.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
        params.push(cleanBranchId);
      }
      if (teacherId) {
        sql += ` AND (
          EXISTS (
            SELECT 1 FROM teacher_class_assign tca
            WHERE tca.teacher_id = ? AND tca.school_id = a.school_id AND tca.class_id = a.class_id AND tca.status = 1
          )
          OR EXISTS (
            SELECT 1 FROM teacher_master tm
            WHERE tm.id = ? AND tm.school_id = a.school_id AND tm.class = a.class_id AND tm.status != 4
          )
        )`;
        params.push(Number(teacherId), Number(teacherId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getAssignmentById:', e.message);
      return null;
    }
  }

  static async getAssignmentQuestions(assignmentId, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);

      // Verify parent assignment belongs to school and branch
      let asgSql = `SELECT a.id, COALESCE(a.branch_id, cm.branch_id) AS branch_id
        FROM assignments a
        LEFT JOIN class_master cm ON cm.id = a.class_id
        WHERE a.id = ? AND a.school_id = ? AND (a.status != 4 OR a.status IS NULL)`;
      const asgParams = [assignmentId, schoolId];
      if (cleanBranchId) {
        asgSql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
        asgParams.push(cleanBranchId);
      }
      asgSql += ` LIMIT 1`;
      const [asgRows] = await pool.query(asgSql, asgParams);
      if (!asgRows || asgRows.length === 0) {
        return [];
      }

      let sql = `SELECT * FROM assignment_questions 
         WHERE assignment_id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [assignmentId, schoolId];
      if (cleanBranchId) {
        sql += ` AND branch_id = ?`;
        params.push(cleanBranchId);
      }
      sql += ` ORDER BY id ASC`;
      const [questions] = await pool.query(sql, params);

      if (questions.length === 0) return [];

      const questionIds = questions.map((q) => q.id);
      let ansSql = `SELECT * FROM assignment_answers 
         WHERE question_id IN (?) AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const ansParams = [questionIds, schoolId];
      if (cleanBranchId) {
        ansSql += ` AND branch_id = ?`;
        ansParams.push(cleanBranchId);
      }
      ansSql += ` ORDER BY id ASC`;
      const [answers] = await pool.query(ansSql, ansParams);

      return questions.map((q) => ({
        ...q,
        answers: answers.filter((ans) => ans.question_id === q.id),
      }));
    } catch (e) {
      console.error('Error in getAssignmentQuestions:', e.message);
      return [];
    }
  }

  static async publishAssignment(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `UPDATE assignments SET is_published = 1 WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async createAssignment(schoolId, data, branchId = null, teacherId = null) {
    const {
      branch_id = null,
      assignment_type_id,
      title,
      class_id,
      section_id,
      subject_id,
      assigned_date,
      due_date,
      is_published = 0,
      questions = [],
    } = data || {};

    const requestedBranchId = AcademicModel.parseBranchId(branch_id ?? branchId);
    const validatedBranchId = await AcademicModel.validateAssignmentRelations(
      schoolId,
      requestedBranchId,
      { assignment_type_id, title, class_id, section_id, subject_id },
      teacherId,
      null
    );
    const resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId, validatedBranchId || requestedBranchId);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO assignments (school_id, branch_id, assignment_type_id, title, class_id, section_id, subject_id, assigned_date, due_date, status, is_published, created_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
        [
          schoolId,
          resolvedBranchId,
          assignment_type_id || null,
          String(title).trim(),
          class_id,
          section_id || null,
          subject_id,
          assigned_date || new Date().toISOString().split('T')[0],
          due_date,
          is_published,
        ]
      );
      const assignmentId = result.insertId;

      if (Array.isArray(questions) && questions.length > 0) {
        for (const q of questions) {
          const qText = q.question || q.title || '';
          if (!qText.trim()) continue;

          const [qResult] = await connection.query(
            `INSERT INTO assignment_questions (school_id, branch_id, assignment_id, question, status, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())`,
            [schoolId, resolvedBranchId, assignmentId, qText.trim()]
          );
          const questionId = qResult.insertId;

          const answers = Array.isArray(q.answers) ? q.answers : Array.isArray(q.options) ? q.options : [];
          for (let i = 0; i < answers.length; i++) {
            const ans = answers[i];
            const ansText = typeof ans === 'string' ? ans : (ans.answer || ans.text || '');
            if (!ansText.trim()) continue;

            const isCorrect = (typeof ans === 'object' && Number(ans.is_correct) === 1) || (Number(q.correct_answer) === i) ? 1 : 0;
            await connection.query(
              `INSERT INTO assignment_answers (school_id, branch_id, question_id, answer, is_correct, status, created_at)
               VALUES (?, ?, ?, ?, ?, 1, NOW())`,
              [schoolId, resolvedBranchId, questionId, ansText.trim(), isCorrect]
            );
          }
        }
      }

      await connection.commit();
      return assignmentId;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async updateAssignment(id, schoolId, data, branchId = null, teacherId = null) {
    const {
      assignment_type_id,
      title,
      class_id,
      section_id,
      subject_id,
      assigned_date,
      due_date,
      is_published,
      questions,
    } = data || {};
    const filterBranch = AcademicModel.parseBranchId(branchId);

    // 1. Verify existing assignment belongs to school and branch
    let checkSql = `SELECT a.*, COALESCE(a.branch_id, cm.branch_id) AS resolved_branch_id
      FROM assignments a
      LEFT JOIN class_master cm ON cm.id = a.class_id
      WHERE a.id = ? AND a.school_id = ? AND (a.status != 4 OR a.status IS NULL)`;
    const checkParams = [id, schoolId];
    if (filterBranch) {
      checkSql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
      checkParams.push(filterBranch);
    }
    checkSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(checkSql, checkParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }
    const existing = existingRows[0];
    const targetBranchId = filterBranch || AcademicModel.parseBranchId(existing.resolved_branch_id);

    // 2. Validate relations and branch-scoped duplicate check
    const mergedData = {
      assignment_type_id: assignment_type_id !== undefined ? assignment_type_id : existing.assignment_type_id,
      title: title !== undefined ? title : existing.title,
      class_id: class_id !== undefined ? class_id : existing.class_id,
      section_id: section_id !== undefined ? section_id : existing.section_id,
      subject_id: subject_id !== undefined ? subject_id : existing.subject_id,
    };
    const validatedBranchId = await AcademicModel.validateAssignmentRelations(
      schoolId,
      targetBranchId,
      mergedData,
      teacherId,
      id
    );
    const resolvedBranchId = validatedBranchId || targetBranchId;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let sql = `UPDATE assignments 
         SET assignment_type_id = COALESCE(?, assignment_type_id),
             title = COALESCE(?, title),
             class_id = COALESCE(?, class_id),
             section_id = COALESCE(?, section_id),
             subject_id = COALESCE(?, subject_id),
             assigned_date = COALESCE(?, assigned_date),
             due_date = COALESCE(?, due_date),
             is_published = COALESCE(?, is_published),
             branch_id = COALESCE(?, branch_id)
         WHERE id = ? AND school_id = ?`;
      const params = [
        assignment_type_id || null,
        title ? String(title).trim() : null,
        class_id || null,
        section_id || null,
        subject_id || null,
        assigned_date || null,
        due_date || null,
        is_published !== undefined ? is_published : null,
        resolvedBranchId || null,
        id,
        schoolId,
      ];
      if (filterBranch) {
        sql += ` AND branch_id = ?`;
        params.push(filterBranch);
      }
      const [updateResult] = await connection.query(sql, params);
      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return false;
      }

      if (Array.isArray(questions)) {
        // Soft delete old questions and answers scoped to school and branch
        let oldQSql = `SELECT id FROM assignment_questions WHERE assignment_id = ? AND school_id = ?`;
        const oldQParams = [id, schoolId];
        if (resolvedBranchId) {
          oldQSql += ` AND branch_id = ?`;
          oldQParams.push(resolvedBranchId);
        }
        const [oldQuestions] = await connection.query(oldQSql, oldQParams);
        if (oldQuestions.length > 0) {
          const oldQIds = oldQuestions.map((q) => q.id);
          await connection.query(
            `UPDATE assignment_answers SET status = 4 WHERE question_id IN (?) AND school_id = ?`,
            [oldQIds, schoolId]
          );
          await connection.query(
            `UPDATE assignment_questions SET status = 4 WHERE id IN (?) AND school_id = ?`,
            [oldQIds, schoolId]
          );
        }

        // Insert updated questions and answers
        for (const q of questions) {
          const qText = q.question || q.title || '';
          if (!qText.trim()) continue;

          const [qResult] = await connection.query(
            `INSERT INTO assignment_questions (school_id, branch_id, assignment_id, question, status, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())`,
            [schoolId, resolvedBranchId, id, qText.trim()]
          );
          const questionId = qResult.insertId;

          const answers = Array.isArray(q.answers) ? q.answers : Array.isArray(q.options) ? q.options : [];
          for (let i = 0; i < answers.length; i++) {
            const ans = answers[i];
            const ansText = typeof ans === 'string' ? ans : (ans.answer || ans.text || '');
            if (!ansText.trim()) continue;

            const isCorrect = (typeof ans === 'object' && Number(ans.is_correct) === 1) || (Number(q.correct_answer) === i) ? 1 : 0;
            await connection.query(
              `INSERT INTO assignment_answers (school_id, branch_id, question_id, answer, is_correct, status, created_at)
               VALUES (?, ?, ?, ?, ?, 1, NOW())`,
              [schoolId, resolvedBranchId, questionId, ansText.trim(), isCorrect]
            );
          }
        }
      }

      await connection.commit();
      return true;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async deleteAssignment(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `UPDATE assignments SET status = 4 WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    if (result.affectedRows > 0) {
      // Also soft-delete child questions and answers scoped to school and branch
      const [qRows] = await pool.query(
        `SELECT id FROM assignment_questions WHERE assignment_id = ? AND school_id = ?`,
        [id, schoolId]
      );
      if (qRows.length > 0) {
        const qIds = qRows.map((q) => q.id);
        await pool.query(`UPDATE assignment_answers SET status = 4 WHERE question_id IN (?) AND school_id = ?`, [qIds, schoolId]);
        await pool.query(`UPDATE assignment_questions SET status = 4 WHERE id IN (?) AND school_id = ?`, [qIds, schoolId]);
      }
    }
    return result.affectedRows > 0;
  }

  // ==================== STUDY MATERIALS ====================
  static async getMaterialTypes(schoolId, { search, status, page = 1, limit = 100, branchId = null, branch_id = null } = {}) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);
      let baseSql = `FROM material_types mt
        LEFT JOIN branch_master bm ON mt.branch_id = bm.id
        WHERE mt.school_id = ?`;
      const params = [schoolId];

      if (cleanBranchId) {
        baseSql += ` AND mt.branch_id = ?`;
        params.push(cleanBranchId);
      }

      if (status !== undefined && status !== null && String(status).trim() !== '') {
        baseSql += ` AND mt.status = ?`;
        params.push(Number(status));
      } else {
        baseSql += ` AND (mt.status != 4 OR mt.status IS NULL)`;
      }

      if (search && String(search).trim()) {
        baseSql += ` AND (mt.material_type_name LIKE ? OR mt.description LIKE ?)`;
        params.push(`%${String(search).trim()}%`, `%${String(search).trim()}%`);
      }

      const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      const numLimit = Math.max(1, Number(limit) || 100);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `SELECT mt.*, bm.branch_name, bm.branch_code ${baseSql} ORDER BY mt.display_order ASC, mt.id ASC LIMIT ? OFFSET ?`;
      const [rows] = await pool.query(dataSql, [...params, numLimit, offset]);

      return {
        material_types: rows || [],
        total,
        page: numPage,
        limit: numLimit,
        totalPages: Math.ceil(total / numLimit) || 1,
      };
    } catch (e) {
      console.error('Error in getMaterialTypes:', e.message);
      return {
        material_types: [],
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 1,
      };
    }
  }

  static async getMaterialTypeById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT mt.*, bm.branch_name, bm.branch_code
         FROM material_types mt
         LEFT JOIN branch_master bm ON mt.branch_id = bm.id
         WHERE mt.id = ? AND mt.school_id = ? AND (mt.status != 4 OR mt.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND mt.branch_id = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getMaterialTypeById:', e.message);
      return null;
    }
  }

  static async createMaterialType(schoolId, { material_type_name, description = '', display_order = 0, status = 1, branch_id = null, branchId = null }) {
    const cleanName = String(material_type_name || '').trim();
    if (!cleanName) {
      const err = new Error('Material type name is required.');
      err.statusCode = 400;
      throw err;
    }

    const resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId, branch_id ?? branchId);

    // Branch-scoped duplicate check
    let dupSql = `SELECT id FROM material_types WHERE school_id = ? AND LOWER(TRIM(material_type_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
    const dupParams = [schoolId, cleanName];
    if (resolvedBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(resolvedBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    dupSql += ` LIMIT 1`;
    const [existing] = await pool.query(dupSql, dupParams);
    if (existing && existing.length > 0) {
      const err = new Error(`A material type named "${cleanName}" already exists in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    const [result] = await pool.query(
      `INSERT INTO material_types (school_id, branch_id, material_type_name, description, display_order, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [schoolId, resolvedBranchId, cleanName, description || '', display_order || 0, status !== undefined ? Number(status) : 1]
    );
    return result.insertId;
  }

  static async updateMaterialType(id, schoolId, { material_type_name, description, display_order, status, branch_id = null }, branchId = null) {
    const filterBranch = AcademicModel.parseBranchId(branchId);

    // Verify existing material type belongs to this school and branch
    let checkSql = `SELECT id, branch_id, material_type_name FROM material_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const checkParams = [id, schoolId];
    if (filterBranch) {
      checkSql += ` AND branch_id = ?`;
      checkParams.push(filterBranch);
    }
    checkSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(checkSql, checkParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }
    const existingRow = existingRows[0];
    const targetBranchId = AcademicModel.parseBranchId(branch_id) || filterBranch || AcademicModel.parseBranchId(existingRow.branch_id);

    if (material_type_name && String(material_type_name).trim()) {
      const cleanName = String(material_type_name).trim();
      let dupSql = `SELECT id FROM material_types WHERE school_id = ? AND LOWER(TRIM(material_type_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, cleanName, id];
      if (targetBranchId) {
        dupSql += ` AND branch_id = ?`;
        dupParams.push(targetBranchId);
      } else {
        dupSql += ` AND branch_id IS NULL`;
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another material type named "${cleanName}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE material_types 
       SET material_type_name = COALESCE(?, material_type_name),
           description = COALESCE(?, description),
           display_order = COALESCE(?, display_order),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`;
    const params = [
      material_type_name ? String(material_type_name).trim() : null,
      description !== undefined ? description : null,
      display_order !== undefined ? display_order : null,
      status !== undefined ? status : null,
      id,
      schoolId,
    ];
    if (filterBranch) {
      sql += ` AND branch_id = ?`;
      params.push(filterBranch);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteMaterialType(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `UPDATE material_types SET status = 4 WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  /**
   * Validates that class_id, section_id, subject_id, material_type_id, academic_year_id
   * belong to the specified school_id and branch_id (and teacher assignments if teacherId is provided),
   * and enforces branch-scoped duplicate validation on study_materials.
   */
  static async validateStudyMaterialRelations(schoolId, branchId, data, teacherId = null, excludeMaterialId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    const {
      academic_year_id,
      class_id,
      section_id,
      subject_id,
      material_type_id,
      title,
    } = data;

    if (!title || !String(title).trim()) {
      const err = new Error('Study material title is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!class_id) {
      const err = new Error('Class is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!subject_id) {
      const err = new Error('Subject is required.');
      err.statusCode = 400;
      throw err;
    }

    // 1. Validate Class belongs to school and branch
    let clsSql = `SELECT id, branch_id, class_name FROM class_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const clsParams = [class_id, schoolId];
    if (cleanBranchId) {
      clsSql += ` AND branch_id = ?`;
      clsParams.push(cleanBranchId);
    }
    clsSql += ` LIMIT 1`;
    const [clsRows] = await pool.query(clsSql, clsParams);
    if (!clsRows || clsRows.length === 0) {
      const err = new Error('Selected class does not belong to the authorized school and branch.');
      err.statusCode = 400;
      throw err;
    }

    const effectiveBranchId = cleanBranchId || AcademicModel.parseBranchId(clsRows[0].branch_id);

    // If teacherId is provided, verify teacher belongs to this school/branch and is assigned to this class
    if (teacherId) {
      let tSql = `SELECT id, branch_id, class, subject FROM teacher_master WHERE id = ? AND school_id = ? AND status != 4`;
      const tParams = [teacherId, schoolId];
      if (effectiveBranchId) {
        tSql += ` AND branch_id = ?`;
        tParams.push(effectiveBranchId);
      }
      tSql += ` LIMIT 1`;
      const [tRows] = await pool.query(tSql, tParams);
      if (!tRows || tRows.length === 0) {
        const err = new Error('Teacher does not belong to the authorized school and branch.');
        err.statusCode = 403;
        throw err;
      }

      const [tcaCountRows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND status = 1`,
        [teacherId, schoolId]
      );
      const hasClassAssignments = (tcaCountRows?.[0]?.cnt || 0) > 0;
      if (hasClassAssignments) {
        const [assignedCls] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id]
        );
        const isPrimaryClass = Number(tRows[0].class) === Number(class_id);
        if ((!assignedCls || assignedCls.length === 0) && !isPrimaryClass) {
          const err = new Error('You are not assigned to the selected class in your branch.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 2. Validate Section (if provided) belongs to school, branch, and class
    if (section_id !== undefined && section_id !== null && String(section_id).trim() !== '' && Number(section_id) > 0) {
      let secSql = `SELECT sec.id FROM section_master sec
        LEFT JOIN class_master cm ON sec.class_id = cm.id
        WHERE sec.id = ? AND sec.school_id = ? AND sec.class_id = ? AND (sec.status != 4 OR sec.status IS NULL)`;
      const secParams = [section_id, schoolId, class_id];
      if (effectiveBranchId) {
        secSql += ` AND COALESCE(sec.branch_id, cm.branch_id) = ?`;
        secParams.push(effectiveBranchId);
      }
      secSql += ` LIMIT 1`;
      const [secRows] = await pool.query(secSql, secParams);
      if (!secRows || secRows.length === 0) {
        const err = new Error('Selected section does not belong to the selected class and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 3. Validate Subject belongs to school, branch, and class
    let subSql = `SELECT sm.id FROM subject_master sm
      LEFT JOIN class_master cm ON sm.class_id = cm.id
      WHERE sm.id = ? AND sm.school_id = ? AND (sm.class_id = ? OR sm.class_id IS NULL) AND (sm.status != 4 OR sm.status IS NULL)`;
    const subParams = [subject_id, schoolId, class_id];
    if (effectiveBranchId) {
      subSql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
      subParams.push(effectiveBranchId);
    }
    subSql += ` LIMIT 1`;
    const [subRows] = await pool.query(subSql, subParams);
    if (!subRows || subRows.length === 0) {
      const err = new Error('Selected subject does not belong to the selected class and branch.');
      err.statusCode = 400;
      throw err;
    }

    // If teacherId is provided and teacher has subject assignments for this class, verify subject assignment
    if (teacherId) {
      const [tcaSubCount] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id > 0 AND status = 1`,
        [teacherId, schoolId, class_id]
      );
      if ((tcaSubCount?.[0]?.cnt || 0) > 0) {
        const [assignedSub] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id, subject_id]
        );
        if (!assignedSub || assignedSub.length === 0) {
          const err = new Error('You are not assigned to teach the selected subject for this class.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 4. Validate Material Type (if provided) belongs to school and branch
    if (material_type_id !== undefined && material_type_id !== null && String(material_type_id).trim() !== '' && Number(material_type_id) > 0) {
      let mtSql = `SELECT id FROM material_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const mtParams = [material_type_id, schoolId];
      if (effectiveBranchId) {
        mtSql += ` AND branch_id = ?`;
        mtParams.push(effectiveBranchId);
      }
      mtSql += ` LIMIT 1`;
      const [mtRows] = await pool.query(mtSql, mtParams);
      if (!mtRows || mtRows.length === 0) {
        const err = new Error('Selected material type does not belong to the authorized school and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 5. Validate Academic Year (if provided) belongs to school and branch
    if (academic_year_id !== undefined && academic_year_id !== null && String(academic_year_id).trim() !== '' && Number(academic_year_id) > 0) {
      let aySql = `SELECT id FROM academic_year_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const ayParams = [academic_year_id, schoolId];
      if (effectiveBranchId) {
        aySql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        ayParams.push(effectiveBranchId);
      }
      aySql += ` LIMIT 1`;
      const [ayRows] = await pool.query(aySql, ayParams);
      if (!ayRows || ayRows.length === 0) {
        const err = new Error('Selected academic year does not belong to the authorized school and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 6. Branch-scoped duplicate check (same title + class + section + subject within the same school and branch)
    let dupSql = `SELECT id FROM study_materials
      WHERE school_id = ?
        AND class_id = ?
        AND subject_id = ?
        AND COALESCE(section_id, 0) = COALESCE(?, 0)
        AND LOWER(TRIM(title)) = LOWER(TRIM(?))
        AND (status != 4 OR status IS NULL)`;
    const dupParams = [
      schoolId,
      class_id,
      subject_id,
      section_id && Number(section_id) > 0 ? Number(section_id) : 0,
      String(title).trim(),
    ];
    if (effectiveBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(effectiveBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    if (excludeMaterialId) {
      dupSql += ` AND id != ?`;
      dupParams.push(excludeMaterialId);
    }
    dupSql += ` LIMIT 1`;
    const [dupRows] = await pool.query(dupSql, dupParams);
    if (dupRows && dupRows.length > 0) {
      const err = new Error(`A study material titled "${String(title).trim()}" already exists for this class and subject in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    return effectiveBranchId;
  }

  static async getStudyMaterials(schoolId, { academic_year_id, class_id, section_id, subject_id, material_type_id, status, search, uploaded_by, uploader_type, teacherId = null, page = 1, limit = 10, branchId = null, branch_id = null } = {}) {
    try {
      let whereClauses = [
        'sm.school_id = ?',
        '(sm.status != 4 OR sm.status IS NULL)',
      ];
      const params = [schoolId];

      const effectiveBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);
      if (effectiveBranchId) {
        whereClauses.push('COALESCE(sm.branch_id, cm.branch_id) = ?');
        params.push(effectiveBranchId);
      }

      // If requested by a teacher in Teacher Portal, enforce teacher's assigned classes/permissions within the branch
      if (teacherId) {
        whereClauses.push(`(
          (sm.uploaded_by = ? AND sm.uploader_type = 'teacher')
          OR EXISTS (
            SELECT 1 FROM teacher_class_assign tca
            WHERE tca.teacher_id = ? AND tca.school_id = sm.school_id AND tca.class_id = sm.class_id AND tca.status = 1
          )
          OR EXISTS (
            SELECT 1 FROM teacher_master tm_cls
            WHERE tm_cls.id = ? AND tm_cls.school_id = sm.school_id AND tm_cls.class = sm.class_id AND tm_cls.status = 1
          )
          OR NOT EXISTS (
            SELECT 1 FROM teacher_class_assign tca_any
            WHERE tca_any.teacher_id = ? AND tca_any.school_id = sm.school_id AND tca_any.status = 1
          )
        )`);
        params.push(teacherId, teacherId, teacherId, teacherId);
      }

      const isValidVal = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== 'undefined' && String(v).trim() !== 'null';

      if (isValidVal(academic_year_id)) {
        whereClauses.push('sm.academic_year_id = ?');
        params.push(academic_year_id);
      }
      if (isValidVal(class_id)) {
        whereClauses.push('sm.class_id = ?');
        params.push(class_id);
      }
      if (isValidVal(section_id)) {
        whereClauses.push('(sm.section_id = ? OR sm.section_id = 0 OR sm.section_id IS NULL)');
        params.push(section_id);
      }
      if (isValidVal(subject_id)) {
        whereClauses.push('sm.subject_id = ?');
        params.push(subject_id);
      }
      if (isValidVal(material_type_id)) {
        whereClauses.push('sm.material_type_id = ?');
        params.push(material_type_id);
      }
      if (isValidVal(uploaded_by)) {
        whereClauses.push('sm.uploaded_by = ?');
        params.push(uploaded_by);
      }
      if (isValidVal(uploader_type)) {
        whereClauses.push('sm.uploader_type = ?');
        params.push(uploader_type);
      }
      if (isValidVal(status)) {
        if (Number(status) === 1) {
          whereClauses.push('sm.status = 1');
        } else if (Number(status) === 2) {
          whereClauses.push('(sm.status = 2 OR sm.status = 0)');
        }
      }
      if (isValidVal(search)) {
        const rawSearch = String(search).trim();
        const searchParam = `%${rawSearch}%`;
        const words = rawSearch.split(/\s+/).filter(Boolean);

        const conditions = [
          'sm.title LIKE ?',
          'sm.description LIKE ?',
          'sm.chapter LIKE ?',
          'sub.subject_name LIKE ?',
          'cm.class_name LIKE ?',
          'mt.material_type_name LIKE ?',
          'aym.academic_year LIKE ?',
        ];
        const searchParams = [searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam];

        if (words.length > 1) {
          const wordConditions = words.map(() => `(
            sm.title LIKE ? OR 
            sm.description LIKE ? OR 
            sm.chapter LIKE ? OR 
            sub.subject_name LIKE ? OR 
            cm.class_name LIKE ? OR 
            mt.material_type_name LIKE ? OR
            aym.academic_year LIKE ?
          )`);
          const wordParams = [];
          words.forEach((w) => {
            const wp = `%${w}%`;
            wordParams.push(wp, wp, wp, wp, wp, wp, wp);
          });
          whereClauses.push(`((${conditions.join(' OR ')}) OR (${wordConditions.join(' AND ')}))`);
          params.push(...searchParams, ...wordParams);
        } else {
          whereClauses.push(`(${conditions.join(' OR ')})`);
          params.push(...searchParams);
        }
      }

      const whereString = `WHERE ${whereClauses.join(' AND ')}`;

      const baseFrom = `
        FROM study_materials sm
        LEFT JOIN class_master cm ON cm.id = sm.class_id
        LEFT JOIN section_master sec ON sec.id = sm.section_id
        LEFT JOIN subject_master sub ON sub.id = sm.subject_id
        LEFT JOIN material_types mt ON mt.id = sm.material_type_id
        LEFT JOIN academic_year_master aym ON aym.id = sm.academic_year_id
        LEFT JOIN branch_master bm ON bm.id = COALESCE(sm.branch_id, cm.branch_id)
        LEFT JOIN user_master um ON um.id = sm.uploaded_by AND (sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin')
        LEFT JOIN teacher_master tm ON tm.id = sm.uploaded_by AND sm.uploader_type = 'teacher'
        ${whereString}
      `;

      const countSql = `SELECT COUNT(*) AS total ${baseFrom}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      const numLimit = Math.max(1, Number(limit) || 10);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `
        SELECT 
          sm.*,
          COALESCE(sm.branch_id, cm.branch_id) AS branch_id,
          cm.class_name,
          sec.section_name,
          sub.subject_name,
          mt.material_type_name,
          aym.academic_year AS academic_year_code,
          bm.branch_name,
          bm.branch_code,
          CASE
            WHEN sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin'
            THEN NULLIF(TRIM(CONCAT(IFNULL(um.first_name, ''), ' ', IFNULL(um.last_name, ''))), '')
            WHEN sm.uploader_type = 'teacher'
            THEN NULLIF(TRIM(CONCAT(IFNULL(tm.first_name, ''), ' ', IFNULL(tm.last_name, ''))), '')
            ELSE NULL
          END AS uploaded_by_name
        ${baseFrom}
        ORDER BY sm.id DESC
        LIMIT ? OFFSET ?
      `;
      const [rows] = await pool.query(dataSql, [...params, numLimit, offset]);

      return {
        study_materials: rows || [],
        total,
        page: numPage,
        limit: numLimit,
        totalPages: Math.ceil(total / numLimit) || 1,
      };
    } catch (e) {
      console.error('Error in getStudyMaterials:', e.message);
      return {
        study_materials: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
    }
  }

  static async getStudyMaterialById(id, schoolId, branchId = null) {
    try {
      const effectiveBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT sm.*, COALESCE(sm.branch_id, cm.branch_id) AS branch_id, cm.class_name, sec.section_name, sub.subject_name, mt.material_type_name, aym.academic_year AS academic_year_code, bm.branch_name, bm.branch_code,
         CASE
           WHEN sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin'
           THEN NULLIF(TRIM(CONCAT(IFNULL(um.first_name, ''), ' ', IFNULL(um.last_name, ''))), '')
           WHEN sm.uploader_type = 'teacher'
           THEN NULLIF(TRIM(CONCAT(IFNULL(tm.first_name, ''), ' ', IFNULL(tm.last_name, ''))), '')
           ELSE NULL
         END AS uploaded_by_name
         FROM study_materials sm
         LEFT JOIN class_master cm ON cm.id = sm.class_id
         LEFT JOIN section_master sec ON sec.id = sm.section_id
         LEFT JOIN subject_master sub ON sub.id = sm.subject_id
         LEFT JOIN material_types mt ON mt.id = sm.material_type_id
         LEFT JOIN academic_year_master aym ON aym.id = sm.academic_year_id
         LEFT JOIN branch_master bm ON bm.id = COALESCE(sm.branch_id, cm.branch_id)
         LEFT JOIN user_master um ON um.id = sm.uploaded_by AND (sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin')
         LEFT JOIN teacher_master tm ON tm.id = sm.uploaded_by AND sm.uploader_type = 'teacher'
         WHERE sm.id = ? AND sm.school_id = ? AND (sm.status != 4 OR sm.status IS NULL)`;
      const params = [id, schoolId];
      if (effectiveBranchId) {
        sql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
        params.push(effectiveBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getStudyMaterialById:', e.message);
      return null;
    }
  }

  static async createStudyMaterial(schoolId, data, userId) {
    const {
      branch_id,
      branchId,
      uploader_type,
      academic_year_id,
      class_id,
      section_id,
      subject_id,
      material_type_id,
      title,
      chapter = '',
      description = '',
      attachment = '',
      attachment_original_name = '',
      attachment_size = 0,
      attachment_extension = '',
      publish_date = null,
      expiry_date = null,
      allow_download = 1,
      display_order = 0,
      status = 1,
    } = data;

    let resolvedBranchId = AcademicModel.parseBranchId(branch_id ?? branchId);
    if (!resolvedBranchId && class_id) {
      const [cm] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ? AND school_id = ? LIMIT 1`, [class_id, schoolId]);
      if (cm.length && cm[0].branch_id) resolvedBranchId = Number(cm[0].branch_id);
    }
    if (!resolvedBranchId) {
      resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId);
    }

    let resolvedAcademicYearId = academic_year_id || null;
    if (!resolvedAcademicYearId) {
      const [ayRows] = await pool.query(
        `SELECT id FROM academic_year_master WHERE school_id = ? AND (branch_id = ? OR branch_id IS NULL) AND (status != 4 OR status IS NULL) ORDER BY is_current DESC, id DESC LIMIT 1`,
        [schoolId, resolvedBranchId]
      );
      if (ayRows && ayRows.length > 0) {
        resolvedAcademicYearId = ayRows[0].id;
      }
    }

    const teacherIdForValidation = uploader_type === 'teacher' ? userId : null;
    resolvedBranchId = await AcademicModel.validateStudyMaterialRelations(
      schoolId,
      resolvedBranchId,
      {
        academic_year_id: resolvedAcademicYearId,
        class_id,
        section_id,
        subject_id,
        material_type_id,
        title,
      },
      teacherIdForValidation,
      null
    );

    const formattedPublishDate = publish_date || new Date().toISOString().slice(0, 10);

    const [result] = await pool.query(
      `INSERT INTO study_materials (
        school_id, branch_id, academic_year_id, class_id, section_id, subject_id, material_type_id,
        title, chapter, description, attachment, attachment_original_name, attachment_size,
        attachment_extension, publish_date, expiry_date, allow_download, display_order, status,
        uploaded_by, uploader_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        schoolId,
        resolvedBranchId,
        resolvedAcademicYearId,
        class_id,
        section_id && Number(section_id) > 0 ? Number(section_id) : null,
        subject_id,
        material_type_id || null,
        String(title).trim(),
        chapter || null,
        description || null,
        attachment || null,
        attachment_original_name || null,
        attachment_size || null,
        attachment_extension || null,
        formattedPublishDate,
        expiry_date || null,
        allow_download !== undefined ? allow_download : 1,
        display_order || 0,
        status !== undefined ? Number(status) : 1,
        userId || null,
        uploader_type || null,
      ]
    );
    return result.insertId;
  }

  static async updateStudyMaterial(id, schoolId, data, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    const existing = await AcademicModel.getStudyMaterialById(id, schoolId, cleanBranchId);
    if (!existing) {
      return false;
    }

    if (teacherId) {
      if (existing.uploader_type !== 'teacher' || Number(existing.uploaded_by) !== Number(teacherId)) {
        const err = new Error('You are only authorized to update study materials uploaded by yourself.');
        err.statusCode = 403;
        throw err;
      }
    }

    const {
      academic_year_id,
      class_id,
      section_id,
      subject_id,
      material_type_id,
      title,
      chapter,
      description,
      attachment,
      attachment_original_name,
      attachment_size,
      attachment_extension,
      publish_date,
      expiry_date,
      allow_download,
      display_order,
      status,
    } = data;

    const mergedAcademicYearId = academic_year_id !== undefined ? academic_year_id : existing.academic_year_id;
    const mergedClassId = class_id !== undefined ? class_id : existing.class_id;
    const mergedSectionId = section_id !== undefined ? (section_id || null) : existing.section_id;
    const mergedSubjectId = subject_id !== undefined ? subject_id : existing.subject_id;
    const mergedMaterialTypeId = material_type_id !== undefined ? material_type_id : existing.material_type_id;
    const mergedTitle = title !== undefined ? String(title).trim() : existing.title;
    const targetBranchId = cleanBranchId || AcademicModel.parseBranchId(existing.branch_id);

    await AcademicModel.validateStudyMaterialRelations(
      schoolId,
      targetBranchId,
      {
        academic_year_id: mergedAcademicYearId,
        class_id: mergedClassId,
        section_id: mergedSectionId,
        subject_id: mergedSubjectId,
        material_type_id: mergedMaterialTypeId,
        title: mergedTitle,
      },
      teacherId,
      id
    );

    let sql = `UPDATE study_materials 
       SET branch_id = COALESCE(?, branch_id),
           academic_year_id = COALESCE(?, academic_year_id),
           class_id = COALESCE(?, class_id),
           section_id = ?,
           subject_id = COALESCE(?, subject_id),
           material_type_id = COALESCE(?, material_type_id),
           title = COALESCE(?, title),
           chapter = COALESCE(?, chapter),
           description = COALESCE(?, description),
           attachment = COALESCE(?, attachment),
           attachment_original_name = COALESCE(?, attachment_original_name),
           attachment_size = COALESCE(?, attachment_size),
           attachment_extension = COALESCE(?, attachment_extension),
           publish_date = COALESCE(?, publish_date),
           expiry_date = COALESCE(?, expiry_date),
           allow_download = COALESCE(?, allow_download),
           display_order = COALESCE(?, display_order),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`;
    const params = [
      targetBranchId || null,
      academic_year_id || null,
      class_id || null,
      mergedSectionId && Number(mergedSectionId) > 0 ? Number(mergedSectionId) : null,
      subject_id || null,
      material_type_id || null,
      title ? String(title).trim() : null,
      chapter !== undefined ? chapter : null,
      description !== undefined ? description : null,
      attachment !== undefined ? attachment : null,
      attachment_original_name !== undefined ? attachment_original_name : null,
      attachment_size !== undefined ? attachment_size : null,
      attachment_extension !== undefined ? attachment_extension : null,
      publish_date !== undefined ? publish_date : null,
      expiry_date !== undefined ? expiry_date : null,
      allow_download !== undefined ? allow_download : null,
      display_order !== undefined ? display_order : null,
      status !== undefined ? status : null,
      id,
      schoolId,
    ];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async toggleStudyMaterialStatus(id, schoolId, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let selectSql = `SELECT id, status, uploaded_by, uploader_type FROM study_materials WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const selectParams = [id, schoolId];
    if (cleanBranchId) {
      selectSql += ` AND branch_id = ?`;
      selectParams.push(cleanBranchId);
    }
    selectSql += ` LIMIT 1`;
    const [rows] = await pool.query(selectSql, selectParams);
    if (rows.length === 0) return null;

    if (teacherId) {
      if (rows[0].uploader_type !== 'teacher' || Number(rows[0].uploaded_by) !== Number(teacherId)) {
        const err = new Error('You are only authorized to change the status of study materials uploaded by yourself.');
        err.statusCode = 403;
        throw err;
      }
    }

    const newStatus = Number(rows[0].status) === 1 ? 2 : 1;
    let updateSql = `UPDATE study_materials SET status = ? WHERE id = ? AND school_id = ?`;
    const updateParams = [newStatus, id, schoolId];
    if (cleanBranchId) {
      updateSql += ` AND branch_id = ?`;
      updateParams.push(cleanBranchId);
    }
    await pool.query(updateSql, updateParams);
    return newStatus;
  }

  static async deleteStudyMaterial(id, schoolId, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let selectSql = `SELECT id, uploaded_by, uploader_type FROM study_materials WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const selectParams = [id, schoolId];
    if (cleanBranchId) {
      selectSql += ` AND branch_id = ?`;
      selectParams.push(cleanBranchId);
    }
    selectSql += ` LIMIT 1`;
    const [rows] = await pool.query(selectSql, selectParams);
    if (!rows || rows.length === 0) return false;

    if (teacherId) {
      if (rows[0].uploader_type !== 'teacher' || Number(rows[0].uploaded_by) !== Number(teacherId)) {
        const err = new Error('You are only authorized to delete study materials uploaded by yourself.');
        err.statusCode = 403;
        throw err;
      }
    }

    let sql = `UPDATE study_materials SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }
}

module.exports = AcademicModel;
