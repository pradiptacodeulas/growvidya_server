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
  static async getAcademicYears(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, school_id, academic_year, start_date, end_date, is_current, status 
         FROM academic_year_master 
         WHERE school_id = ? AND (status != 4 OR status IS NULL) 
         ORDER BY id ASC`,
        [schoolId]
      );
      if (rows && rows.length > 0) {
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

  static async getAcademicYearById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, school_id, academic_year, start_date, end_date, is_current, status 
         FROM academic_year_master 
         WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL) LIMIT 1`,
        [id, schoolId]
      );
      if (rows && rows.length > 0) {
        return {
          ...rows[0],
          name: AcademicModel.formatYearTitle(rows[0]),
        };
      }
      return null;
    } catch (e) {
      console.error('Error in getAcademicYearById:', e.message);
      return null;
    }
  }

  static async createAcademicYear(schoolId, { name, academic_year, start_date, end_date, is_current = 0, status = 1 }) {
    const yearVal = academic_year || name;
    const isCurr = Number(is_current) === 1 ? 1 : 0;
    if (isCurr === 1) {
      await pool.query(
        `UPDATE academic_year_master SET is_current = 0 WHERE school_id = ?`,
        [schoolId]
      );
    }
    const [result] = await pool.query(
      `INSERT INTO academic_year_master (school_id, academic_year, start_date, end_date, is_current, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, yearVal, start_date, end_date, isCurr, Number(status)]
    );
    return result.insertId;
  }

  static async updateAcademicYear(id, schoolId, { name, academic_year, start_date, end_date, is_current = 0, status = 1 }) {
    const yearVal = academic_year || name;
    const isCurr = Number(is_current) === 1 ? 1 : 0;
    if (isCurr === 1) {
      await pool.query(
        `UPDATE academic_year_master SET is_current = 0 WHERE school_id = ? AND id != ?`,
        [schoolId, id]
      );
    }
    const [result] = await pool.query(
      `UPDATE academic_year_master SET academic_year = ?, start_date = ?, end_date = ?, is_current = ?, status = ? WHERE id = ? AND school_id = ?`,
      [yearVal, start_date, end_date, isCurr, Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteAcademicYear(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE academic_year_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== CLASSES ====================
  // Filter classes strictly by teacher_class_assign for teachers, status = 1
  static async getClasses(schoolId, activeOnly = false, teacherId = null, branchId = null) {
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
    if (branchId) {
      sql += ` AND (c.branch_id = ? OR c.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    if (teacherId) {
      sql += ` AND EXISTS (
        SELECT 1 FROM teacher_class_assign tca 
        WHERE tca.teacher_id = ? AND tca.class_id = c.id AND tca.status = 1
      )`;
      params.push(teacherId);
    }
    sql += ` ORDER BY c.sort_order ASC, c.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getClassById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT c.*, bm.branch_name, bm.branch_code, s.shift_name FROM class_master c 
       LEFT JOIN branch_master bm ON c.branch_id = bm.id
       LEFT JOIN shift_master s ON c.shift_id = s.id 
       WHERE c.id = ? AND c.school_id = ? LIMIT 1`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createClass(schoolId, { class_name, shift_id = null, sort_order = 0, status = 1, branch_id = null }) {
    let resolvedBranchId = branch_id ? Number(branch_id) : null;
    if (!resolvedBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND is_main_branch = 1 LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) resolvedBranchId = mainB[0].id;
      } catch (e) {}
    }
    const [result] = await pool.query(
      `INSERT INTO class_master (school_id, branch_id, shift_id, class_name, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, shift_id, class_name, sort_order, status]
    );
    return result.insertId;
  }

  static async updateClass(id, schoolId, { class_name, shift_id, sort_order, status, branch_id = null }) {
    const [result] = await pool.query(
      `UPDATE class_master SET class_name = ?, shift_id = ?, sort_order = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`,
      [class_name, shift_id, sort_order, status, branch_id || null, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteClass(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE class_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== SECTIONS ====================
  static async getSections(schoolId, classId = null, activeOnly = false, status = null, branchId = null) {
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
    if (branchId) {
      sql += ` AND (sec.branch_id = ? OR sec.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    if (classId) {
      sql += ` AND sec.class_id = ?`;
      params.push(classId);
    }
    sql += ` ORDER BY sec.sort_order ASC, sec.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getSectionById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT sec.*, bm.branch_name, bm.branch_code, c.class_name 
         FROM section_master sec
         LEFT JOIN branch_master bm ON sec.branch_id = bm.id
         LEFT JOIN class_master c ON sec.class_id = c.id
         WHERE sec.id = ? AND sec.school_id = ? AND sec.status != 4 LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSectionById:', e.message);
      return null;
    }
  }

  static async createSection(schoolId, { class_id, section_name, capacity = 40, note = '', sort_order = 1, status = 1, branch_id = null }) {
    let resolvedBranchId = branch_id ? Number(branch_id) : null;
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
    const [result] = await pool.query(
      `INSERT INTO section_master (school_id, branch_id, class_id, section_name, capacity, note, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, class_id, section_name, Number(capacity) || 0, note || '', Number(sort_order) || 1, Number(status)]
    );
    return result.insertId;
  }

  static async updateSection(id, schoolId, { class_id, section_name, capacity, note, sort_order, status }) {
    const [result] = await pool.query(
      `UPDATE section_master SET class_id = ?, section_name = ?, capacity = ?, note = ?, sort_order = ?, status = ? WHERE id = ? AND school_id = ?`,
      [class_id, section_name, Number(capacity) || 0, note || '', Number(sort_order) || 0, Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteSection(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE section_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== SUBJECTS ====================
  // Filter subjects strictly by teacher_class_assign for teachers, status = 1
  static async getSubjects(schoolId, classId = null, activeOnly = false, teacherId = null) {
    let sql = `SELECT sm.*, cm.class_name 
               FROM subject_master sm
               LEFT JOIN class_master cm ON sm.class_id = cm.id
               WHERE sm.school_id = ?`;
    const params = [schoolId];

    if (activeOnly) {
      sql += ` AND sm.status = 1`;
    } else {
      sql += ` AND (sm.status != 4 OR sm.status IS NULL)`;
    }

    if (classId) {
      sql += ` AND sm.class_id = ?`;
      params.push(classId);
    }

    if (teacherId) {
      sql += ` AND EXISTS (
        SELECT 1 FROM teacher_class_assign tca 
        WHERE tca.teacher_id = ? AND tca.subject_id = sm.id AND tca.status = 1
        ${classId ? 'AND tca.class_id = ?' : ''}
      )`;
      params.push(teacherId);
      if (classId) {
        params.push(classId);
      }
    }

    sql += ` ORDER BY sm.sort_order ASC, sm.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getSubjectById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT sm.*, cm.class_name 
         FROM subject_master sm 
         LEFT JOIN class_master cm ON sm.class_id = cm.id 
         WHERE sm.id = ? AND sm.school_id = ? AND (sm.status != 4 OR sm.status IS NULL) LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSubjectById:', e.message);
      return null;
    }
  }

  static async createSubject(schoolId, { class_id = null, subject_name, sort_order = 1, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO subject_master (school_id, class_id, subject_name, sort_order, status) VALUES (?, ?, ?, ?, ?)`,
      [schoolId, class_id ? Number(class_id) : null, subject_name, Number(sort_order) || 0, Number(status)]
    );
    return result.insertId;
  }

  static async updateSubject(id, schoolId, { class_id, subject_name, sort_order = 1, status = 1 }) {
    const [result] = await pool.query(
      `UPDATE subject_master SET class_id = ?, subject_name = ?, sort_order = ?, status = ? WHERE id = ? AND school_id = ?`,
      [class_id ? Number(class_id) : null, subject_name, Number(sort_order) || 0, Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteSubject(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE subject_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== SHIFTS ====================
  static async getShifts(schoolId, activeOnly = false) {
    let sql = `SELECT * FROM shift_master WHERE school_id = ?`;
    const params = [schoolId];
    if (activeOnly) {
      sql += ` AND status = 1`;
    } else {
      sql += ` AND (status != 4 OR status IS NULL)`;
    }
    sql += ` ORDER BY id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getShiftById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM shift_master WHERE id = ? AND school_id = ? LIMIT 1`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createShift(schoolId, { shift_name, start_time = null, end_time = null, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO shift_master (school_id, shift_name, start_time, end_time, status) VALUES (?, ?, ?, ?, ?)`,
      [schoolId, shift_name, start_time, end_time, status]
    );
    return result.insertId;
  }

  static async updateShift(id, schoolId, { shift_name, start_time, end_time, status = 1 }) {
    const [result] = await pool.query(
      `UPDATE shift_master SET shift_name = ?, start_time = ?, end_time = ?, status = ? WHERE id = ? AND school_id = ?`,
      [shift_name, start_time, end_time, status, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteShift(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE shift_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== HOUSES ====================
  static async getHouses(schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM house_master WHERE school_id = ? AND (status != 4 OR status IS NULL) ORDER BY sort_order ASC, id ASC`,
      [schoolId]
    );
    return rows;
  }

  static async getHouseById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM house_master WHERE id = ? AND school_id = ? AND status != 4 LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getHouseById:', e.message);
      return null;
    }
  }

  static async createHouse(schoolId, { house_name, sort_order = 1, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO house_master (school_id, house_name, sort_order, status) VALUES (?, ?, ?, ?)`,
      [schoolId, house_name, Number(sort_order) || 1, Number(status)]
    );
    return result.insertId;
  }

  static async updateHouse(id, schoolId, { house_name, sort_order = 1, status = 1 }) {
    const [result] = await pool.query(
      `UPDATE house_master SET house_name = ?, sort_order = ?, status = ? WHERE id = ? AND school_id = ?`,
      [house_name, Number(sort_order) || 1, Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteHouse(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE house_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== PERIODS ====================
  static async getPeriods(schoolId) {
    const [rows] = await pool.query(
      `SELECT p.*, s.shift_name 
       FROM period_master p 
       LEFT JOIN shift_master s ON p.shift_id = s.id 
       WHERE p.school_id = ? AND (p.status != 4 OR p.status IS NULL) 
       ORDER BY p.id ASC`,
      [schoolId]
    );
    return rows;
  }

  static async getPeriodById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT p.*, s.shift_name 
         FROM period_master p 
         LEFT JOIN shift_master s ON p.shift_id = s.id 
         WHERE p.id = ? AND p.school_id = ? AND p.status != 4 LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getPeriodById:', e.message);
      return null;
    }
  }

  static async createPeriod(schoolId, { shift_id = null, period_name, start_time = null, end_time = null, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO period_master (school_id, shift_id, period_name, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, shift_id ? Number(shift_id) : null, period_name, start_time, end_time, Number(status)]
    );
    return result.insertId;
  }

  static async updatePeriod(id, schoolId, { shift_id = null, period_name, start_time, end_time, status }) {
    const [result] = await pool.query(
      `UPDATE period_master SET shift_id = ?, period_name = ?, start_time = ?, end_time = ?, status = ? WHERE id = ? AND school_id = ?`,
      [shift_id ? Number(shift_id) : null, period_name, start_time, end_time, Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deletePeriod(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE period_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
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

  static async getTransportRoutes(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, school_id, transport_route, bus_id, sort_order, status, fare 
         FROM trans_route_master 
         WHERE school_id = ? 
           AND status != 4 
         ORDER BY id DESC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getTransportRoutes:', e.message);
      return [];
    }
  }

  static async getHostels(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, school_id, hostel_name, sort_order, status, hostel_fee 
         FROM hostel_name_master 
         WHERE status != 4 AND school_id = ? 
         ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error fetching hostels:', e.message);
      return [];
    }
  }

  static async getHostelRooms(hostelId, schoolId) {
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

  static async getDocumentTypes(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, school_id, document_type_name, status 
         FROM document_type_master 
         WHERE school_id = ? AND (status != 4 OR status IS NULL) 
         ORDER BY id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getDocumentTypes:', e.message);
      return [];
    }
  }

  static async getDocumentTypeById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, school_id, document_type_name, status 
         FROM document_type_master 
         WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL) LIMIT 1`,
        [id, schoolId]
      );
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

  static async getStudentMasters(schoolId) {
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
      AcademicModel.getAcademicYears(schoolId),
      AcademicModel.getClasses(schoolId),
      AcademicModel.getGenders(),
      AcademicModel.getBloodGroups(),
      AcademicModel.getHouses(schoolId),
      AcademicModel.getReligions(schoolId),
      AcademicModel.getCategories(schoolId),
      AcademicModel.getMotherTongues(schoolId),
      AcademicModel.getCountries(),
      AcademicModel.getTransportRoutes(schoolId),
      AcademicModel.getHostels(schoolId),
      AcademicModel.getDocumentTypes(schoolId),
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

  static async getNextRollNumber(schoolId, classId, sectionId) {
    try {
      const [rows] = await pool.query(
        `SELECT MAX(CAST(roll_number AS UNSIGNED)) AS max_roll FROM student_master WHERE school_id = ? AND class = ? AND section = ? AND status != 0`,
        [schoolId, classId, sectionId]
      );
      const maxRoll = rows[0]?.max_roll || 0;
      return Number(maxRoll) + 1;
    } catch (e) {
      return 1;
    }
  }

  // ==================== DAYS ====================
  static async getDays(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM days_master WHERE school_id = ? AND status != 4 ORDER BY id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error fetching days:', e.message);
      return [];
    }
  }

  static async getDayById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM days_master WHERE id = ? AND school_id = ? AND status != 4`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error fetching day by id:', e.message);
      return null;
    }
  }

  static async createDay(schoolId, { day_name, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO days_master (school_id, day_name, status) VALUES (?, ?, ?)`,
      [schoolId, day_name, Number(status)]
    );
    return result.insertId;
  }

  static async updateDay(id, schoolId, { day_name, status }) {
    const [result] = await pool.query(
      `UPDATE days_master SET day_name = ?, status = ? WHERE id = ? AND school_id = ?`,
      [day_name, Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteDay(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE days_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== DOCUMENT TYPES ====================
  static async createDocumentType(schoolId, { document_type_name, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO document_type_master (school_id, document_type_name, status) VALUES (?, ?, ?)`,
      [schoolId, document_type_name, Number(status)]
    );
    return result.insertId;
  }

  static async updateDocumentType(id, schoolId, { document_type_name, status = 1 }) {
    const [result] = await pool.query(
      `UPDATE document_type_master SET document_type_name = ?, status = ? WHERE id = ? AND school_id = ?`,
      [document_type_name, Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteDocumentType(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE document_type_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== ROUTINES ====================
  static async getRoutines(schoolId, { classId, sectionId, day, teacherId } = {}) {
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

  static async createRoutine(schoolId, { class_id, section_id, day, period_id, teacher_id, subject_id, shift_id }) {
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
      `INSERT INTO routine (school_id, class_id, section_id, day, period_id, teacher_id, subject_id, shift_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [schoolId, class_id, section_id, day, period_id, teacher_id || null, subject_id, finalShiftId || null]
    );
    return result.insertId;
  }

  static async updateRoutine(id, schoolId, { class_id, section_id, day, period_id, teacher_id, subject_id, shift_id }) {
    let finalShiftId = shift_id;
    if (!finalShiftId && period_id) {
      const [perRows] = await pool.query(`SELECT shift_id FROM period_master WHERE id = ?`, [period_id]);
      if (perRows.length > 0 && perRows[0].shift_id) {
        finalShiftId = perRows[0].shift_id;
      }
    }
    const [result] = await pool.query(
      `UPDATE routine SET class_id = ?, section_id = ?, day = ?, period_id = ?, teacher_id = ?, subject_id = ?, shift_id = ?, updated_at = NOW()
       WHERE id = ? AND school_id = ?`,
      [class_id, section_id, day, period_id, teacher_id || null, subject_id, finalShiftId || null, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteRoutine(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE routine SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== CLASS ASSIGNED TEACHERS (teacher_class_assign & teacher_master) ====================
  static async getClassAssignedTeachers(schoolId, { classId, subjectId } = {}) {
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
        ) AS combined
        WHERE 1=1
      `;
      const params = [
        schoolId, classId || null, classId || null,
        schoolId, classId || null, classId || null
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
  static async getSyllabusList(schoolId, { academic_year, academic_year_id, class_id, classId, subject_id, subjectId, status, search, page = 1, limit = 10 } = {}) {
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

  static async getSyllabusById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT s.*, 
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
          AND (s.status != 4 OR s.status IS NULL)
        LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSyllabusById:', e.message);
      return null;
    }
  }

  static async createSyllabus(schoolId, { academic_year, class_id, subject_id, lession, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO syllabus (school_id, academic_year, class_id, subject_id, lession, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [schoolId, academic_year, class_id, subject_id, lession, status || 1]
    );
    return result.insertId;
  }

  static async updateSyllabus(id, schoolId, { academic_year, class_id, subject_id, lession, status }) {
    const [result] = await pool.query(
      `UPDATE syllabus 
       SET academic_year = COALESCE(?, academic_year),
           class_id = COALESCE(?, class_id),
           subject_id = COALESCE(?, subject_id),
           lession = ?,
           status = ?
       WHERE id = ? AND school_id = ?`,
      [academic_year || null, class_id || null, subject_id || null, lession, status, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async updateSyllabusStatus(id, schoolId, status) {
    const [result] = await pool.query(
      `UPDATE syllabus 
       SET status = ?
       WHERE id = ? AND school_id = ?`,
      [Number(status), id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteSyllabus(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE syllabus SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async getLessons(schoolId, { classId, subjectId } = {}) {
    try {
      let sql = `
        SELECT lm.*, cm.class_name, sm.subject_name
        FROM lession_master lm
        LEFT JOIN class_master cm ON cm.id = lm.class_id
        LEFT JOIN subject_master sm ON sm.id = lm.subject_id
        WHERE lm.school_id = ? AND (lm.status != 4 OR lm.status IS NULL)
      `;
      const params = [schoolId];
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

  static async createLesson(schoolId, { class_id, subject_id, lession_name, lession_description }) {
    const [result] = await pool.query(
      `INSERT INTO lession_master (school_id, class_id, subject_id, lession_name, lession_description, status)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [schoolId, class_id, subject_id, lession_name, lession_description || '']
    );
    return result.insertId;
  }

  static async deleteLesson(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE lession_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== ASSIGNMENTS ====================
  static async getAssignmentTypes(schoolId, { search, status, page = 1, limit = 10 } = {}) {
    try {
      let baseSql = `
        FROM assignment_types
        WHERE school_id = ?
      `;
      const params = [schoolId];

      if (status) {
        baseSql += ` AND status = ?`;
        params.push(status);
      }

      if (search && String(search).trim()) {
        baseSql += ` AND type_name LIKE ?`;
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
        SELECT * ${baseSql}
        ORDER BY id ASC
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

  static async getAssignmentTypeById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM assignment_types WHERE id = ? AND school_id = ? LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getAssignmentTypeById:', e.message);
      return null;
    }
  }

  static async createAssignmentType(schoolId, { type_name, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO assignment_types (school_id, type_name, status, created_on) VALUES (?, ?, ?, NOW())`,
      [schoolId, type_name, status || 1]
    );
    return result.insertId;
  }

  static async updateAssignmentType(id, schoolId, { type_name, status }) {
    const [result] = await pool.query(
      `UPDATE assignment_types 
       SET type_name = COALESCE(?, type_name),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`,
      [type_name || null, status !== undefined ? status : null, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async getAssignments(schoolId, { classId, class_id, sectionId, section_id, subjectId, subject_id, assignmentTypeId, assignment_type_id, search, status, page, limit } = {}) {
    try {
      const cId = classId || class_id;
      const sId = sectionId || section_id;
      const subId = subjectId || subject_id;
      const atId = assignmentTypeId || assignment_type_id;

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
                 (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count
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
               (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count
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

  static async getAssignmentById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT a.*, at.type_name, cm.class_name, sec.section_name, sm.subject_name,
                (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count
         FROM assignments a
         LEFT JOIN assignment_types at ON at.id = a.assignment_type_id
         LEFT JOIN class_master cm ON cm.id = a.class_id
         LEFT JOIN section_master sec ON sec.id = a.section_id
         LEFT JOIN subject_master sm ON sm.id = a.subject_id
         WHERE a.id = ? AND a.school_id = ?
         LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getAssignmentById:', e.message);
      return null;
    }
  }

  static async getAssignmentQuestions(assignmentId, schoolId) {
    try {
      const [questions] = await pool.query(
        `SELECT * FROM assignment_questions 
         WHERE assignment_id = ? AND school_id = ? AND (status != 4 OR status IS NULL)
         ORDER BY id ASC`,
        [assignmentId, schoolId]
      );

      if (questions.length === 0) return [];

      const questionIds = questions.map((q) => q.id);
      const [answers] = await pool.query(
        `SELECT * FROM assignment_answers 
         WHERE question_id IN (?) AND school_id = ? AND (status != 4 OR status IS NULL)
         ORDER BY id ASC`,
        [questionIds, schoolId]
      );

      return questions.map((q) => ({
        ...q,
        answers: answers.filter((ans) => ans.question_id === q.id),
      }));
    } catch (e) {
      console.error('Error in getAssignmentQuestions:', e.message);
      return [];
    }
  }

  static async publishAssignment(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE assignments SET is_published = 1 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async createAssignment(schoolId, { assignment_type_id, title, class_id, section_id, subject_id, assigned_date, due_date, is_published = 0, questions = [] }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO assignments (school_id, assignment_type_id, title, class_id, section_id, subject_id, assigned_date, due_date, status, is_published, created_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
        [schoolId, assignment_type_id || null, title, class_id, section_id || null, subject_id, assigned_date || new Date().toISOString().split('T')[0], due_date, is_published]
      );
      const assignmentId = result.insertId;

      if (Array.isArray(questions) && questions.length > 0) {
        for (const q of questions) {
          const qText = q.question || q.title || '';
          if (!qText.trim()) continue;

          const [qResult] = await connection.query(
            `INSERT INTO assignment_questions (school_id, assignment_id, question, status, created_at)
             VALUES (?, ?, ?, 1, NOW())`,
            [schoolId, assignmentId, qText]
          );
          const questionId = qResult.insertId;

          const answers = Array.isArray(q.answers) ? q.answers : Array.isArray(q.options) ? q.options : [];
          for (let i = 0; i < answers.length; i++) {
            const ans = answers[i];
            const ansText = typeof ans === 'string' ? ans : (ans.answer || ans.text || '');
            if (!ansText.trim()) continue;

            const isCorrect = (typeof ans === 'object' && Number(ans.is_correct) === 1) || (Number(q.correct_answer) === i) ? 1 : 0;
            await connection.query(
              `INSERT INTO assignment_answers (school_id, question_id, answer, is_correct, status, created_at)
               VALUES (?, ?, ?, ?, 1, NOW())`,
              [schoolId, questionId, ansText, isCorrect]
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

  static async updateAssignment(id, schoolId, { assignment_type_id, title, class_id, section_id, subject_id, assigned_date, due_date, is_published = 0, questions }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE assignments 
         SET assignment_type_id = COALESCE(?, assignment_type_id),
             title = COALESCE(?, title),
             assigned_date = COALESCE(?, assigned_date),
             due_date = COALESCE(?, due_date),
             is_published = COALESCE(?, is_published)
         WHERE id = ? AND school_id = ?`,
        [assignment_type_id, title, assigned_date, due_date, is_published, id, schoolId]
      );

      if (Array.isArray(questions)) {
        // Soft delete old questions and answers
        const [oldQuestions] = await connection.query(
          `SELECT id FROM assignment_questions WHERE assignment_id = ? AND school_id = ?`,
          [id, schoolId]
        );
        if (oldQuestions.length > 0) {
          const oldQIds = oldQuestions.map(q => q.id);
          await connection.query(
            `UPDATE assignment_answers SET status = 4 WHERE question_id IN (?)`,
            [oldQIds]
          );
          await connection.query(
            `UPDATE assignment_questions SET status = 4 WHERE id IN (?)`,
            [oldQIds]
          );
        }

        // Insert updated questions and answers
        for (const q of questions) {
          const qText = q.question || q.title || '';
          if (!qText.trim()) continue;

          const [qResult] = await connection.query(
            `INSERT INTO assignment_questions (school_id, assignment_id, question, status, created_at)
             VALUES (?, ?, ?, 1, NOW())`,
            [schoolId, id, qText]
          );
          const questionId = qResult.insertId;

          const answers = Array.isArray(q.answers) ? q.answers : Array.isArray(q.options) ? q.options : [];
          for (let i = 0; i < answers.length; i++) {
            const ans = answers[i];
            const ansText = typeof ans === 'string' ? ans : (ans.answer || ans.text || '');
            if (!ansText.trim()) continue;

            const isCorrect = (typeof ans === 'object' && Number(ans.is_correct) === 1) || (Number(q.correct_answer) === i) ? 1 : 0;
            await connection.query(
              `INSERT INTO assignment_answers (school_id, question_id, answer, is_correct, status, created_at)
               VALUES (?, ?, ?, ?, 1, NOW())`,
              [schoolId, questionId, ansText, isCorrect]
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

  static async deleteAssignment(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE assignments SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ==================== STUDY MATERIALS ====================
  static async getMaterialTypes(schoolId, { search, status, page = 1, limit = 100 } = {}) {
    try {
      let baseSql = `FROM material_types WHERE (school_id = ? OR school_id IS NULL OR ? IS NULL)`;
      const params = [schoolId, schoolId];
      if (status) {
        baseSql += ` AND status = ?`;
        params.push(status);
      } else {
        baseSql += ` AND status != 4`;
      }
      if (search && String(search).trim()) {
        baseSql += ` AND (material_type_name LIKE ? OR description LIKE ?)`;
        params.push(`%${String(search).trim()}%`, `%${String(search).trim()}%`);
      }
      const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      const numLimit = Math.max(1, Number(limit) || 100);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `SELECT * ${baseSql} ORDER BY display_order ASC, id ASC LIMIT ? OFFSET ?`;
      const [rows] = await pool.query(dataSql, [...params, numLimit, offset]);

      return {
        material_types: rows || [],
        total,
        page: numPage,
        limit: numLimit,
        totalPages: Math.ceil(total / numLimit) || 1
      };
    } catch (e) {
      console.error('Error in getMaterialTypes:', e.message);
      return {
        material_types: [],
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 1
      };
    }
  }

  static async getMaterialTypeById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM material_types WHERE id = ? AND (school_id = ? OR school_id IS NULL OR ? IS NULL) LIMIT 1`,
        [id, schoolId, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getMaterialTypeById:', e.message);
      return null;
    }
  }

  static async createMaterialType(schoolId, { material_type_name, description = '', display_order = 0, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO material_types (school_id, material_type_name, description, display_order, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
      [schoolId, material_type_name, description, display_order || 0, status || 1]
    );
    return result.insertId;
  }

  static async updateMaterialType(id, schoolId, { material_type_name, description, display_order, status }) {
    const [result] = await pool.query(
      `UPDATE material_types 
       SET material_type_name = COALESCE(?, material_type_name),
           description = COALESCE(?, description),
           display_order = COALESCE(?, display_order),
           status = COALESCE(?, status)
       WHERE id = ? AND (school_id = ? OR school_id IS NULL OR ? IS NULL)`,
      [material_type_name || null, description !== undefined ? description : null, display_order !== undefined ? display_order : null, status !== undefined ? status : null, id, schoolId, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteMaterialType(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE material_types SET status = 4 WHERE id = ? AND (school_id = ? OR school_id IS NULL OR ? IS NULL)`,
      [id, schoolId, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async getStudyMaterials(schoolId, { academic_year_id, class_id, section_id, subject_id, material_type_id, status, search, uploaded_by, uploader_type, page = 1, limit = 10 } = {}) {
    try {
      let whereClauses = [
        'sm.school_id = ?',
        '(sm.status != 4 OR sm.status IS NULL)'
      ];
      const params = [schoolId];

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
          'aym.academic_year LIKE ?'
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
        LEFT JOIN user_master um ON um.id = sm.uploaded_by AND (sm.uploader_type = 'admin' OR sm.uploader_type IS NULL)
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
          cm.class_name,
          sec.section_name,
          sub.subject_name,
          mt.material_type_name,
          aym.academic_year AS academic_year_code,
          CASE
            WHEN sm.uploader_type = 'admin'
            THEN CONCAT(IFNULL(um.first_name, ''), ' ', IFNULL(um.last_name, ''))
            WHEN sm.uploader_type = 'teacher'
            THEN CONCAT(IFNULL(tm.first_name, ''), ' ', IFNULL(tm.last_name, ''))
            ELSE IFNULL(um.first_name, 'Admin')
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
        totalPages: Math.ceil(total / numLimit) || 1
      };
    } catch (e) {
      console.error('Error in getStudyMaterials:', e.message);
      return {
        study_materials: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1
      };
    }
  }

  static async getStudyMaterialById(id, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT sm.*, cm.class_name, sec.section_name, sub.subject_name, mt.material_type_name, aym.academic_year AS academic_year_code
         FROM study_materials sm
         LEFT JOIN class_master cm ON cm.id = sm.class_id
         LEFT JOIN section_master sec ON sec.id = sm.section_id
         LEFT JOIN subject_master sub ON sub.id = sm.subject_id
         LEFT JOIN material_types mt ON mt.id = sm.material_type_id
         LEFT JOIN academic_year_master aym ON aym.id = sm.academic_year_id
         WHERE sm.id = ? AND sm.school_id = ?
         LIMIT 1`,
        [id, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getStudyMaterialById:', e.message);
      return null;
    }
  }

  static async createStudyMaterial(schoolId, data, userId) {
    const {
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
      status = 1
    } = data;

    const formattedPublishDate = publish_date || new Date().toISOString().slice(0, 10);

    const [result] = await pool.query(
      `INSERT INTO study_materials (
        school_id, academic_year_id, class_id, section_id, subject_id, material_type_id,
        title, chapter, description, attachment, attachment_original_name, attachment_size,
        attachment_extension, publish_date, expiry_date, allow_download, display_order, status,
        uploaded_by, uploader_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', NOW())`,
      [
        schoolId,
        academic_year_id || null,
        class_id,
        section_id || null,
        subject_id,
        material_type_id,
        title,
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
        userId || 1
      ]
    );
    return result.insertId;
  }

  static async updateStudyMaterial(id, schoolId, data) {
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
      status
    } = data;

    const [result] = await pool.query(
      `UPDATE study_materials 
       SET academic_year_id = COALESCE(?, academic_year_id),
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
       WHERE id = ? AND school_id = ?`,
      [
        academic_year_id || null,
        class_id || null,
        section_id !== undefined ? (section_id || null) : null,
        subject_id || null,
        material_type_id || null,
        title || null,
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
        schoolId
      ]
    );
    return result.affectedRows > 0;
  }

  static async toggleStudyMaterialStatus(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT status FROM study_materials WHERE id = ? AND school_id = ? LIMIT 1`,
      [id, schoolId]
    );
    if (rows.length === 0) return null;
    const newStatus = Number(rows[0].status) === 1 ? 2 : 1;
    await pool.query(
      `UPDATE study_materials SET status = ? WHERE id = ? AND school_id = ?`,
      [newStatus, id, schoolId]
    );
    return newStatus;
  }

  static async deleteStudyMaterial(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE study_materials SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = AcademicModel;
