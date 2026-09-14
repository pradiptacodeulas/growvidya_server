const { pool } = require('../config/db.config');

class AttendanceModel {
  /**
   * Helper to format academic year into standard year range (e.g. '2025 - 2026')
   */
  static formatAcademicYearRange(row) {
    if (!row) return '';
    let startY = null;
    let endY = null;
    if (row.start_date) {
      const match = String(row.start_date).match(/^(\d{4})/);
      if (match) startY = parseInt(match[1], 10);
    }
    if (row.end_date) {
      const match = String(row.end_date).match(/^(\d{4})/);
      if (match) endY = parseInt(match[1], 10);
    }
    if (!startY && row.academic_year) {
      const match = String(row.academic_year).match(/^(\d{4})/);
      if (match) startY = parseInt(match[1], 10);
    }
    if (startY) {
      if (endY && endY > startY) {
        return `${startY} - ${endY}`;
      }
      return `${startY} - ${startY + 1}`;
    }
    return row.academic_year || String(row.id);
  }

  /**
   * Fetch meta options for Attendance (Classes, Sections, Academic Years)
   */
  static async getMetaOptions(schoolId, teacherId = null) {
    let classSql = `SELECT id, class_name FROM class_master c WHERE c.school_id = ? AND c.status = 1`;
    const classParams = [schoolId];
    if (teacherId) {
      classSql += ` AND EXISTS (SELECT 1 FROM teacher_class_assign tca WHERE tca.teacher_id = ? AND tca.class_id = c.id AND tca.status = 1)`;
      classParams.push(teacherId);
    }
    classSql += ` ORDER BY c.sort_order ASC, c.id ASC`;

    const [classes] = await pool.query(classSql, classParams);

    const [sections] = await pool.query(
      `SELECT id, class_id, section_name FROM section_master WHERE school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
      [schoolId]
    );

    const [academicYears] = await pool.query(
      `SELECT id, academic_year, start_date, end_date, is_current FROM academic_year_master WHERE school_id = ? AND status = 1 ORDER BY id ASC`,
      [schoolId]
    );

    const formattedYears = (academicYears || []).map((ay) => ({
      ...ay,
      academic_year: AttendanceModel.formatAcademicYearRange(ay),
      raw_academic_year: ay.academic_year,
      name: AttendanceModel.formatAcademicYearRange(ay),
    }));

    return {
      classes: classes || [],
      sections: sections || [],
      academicYears: formattedYears || [],
    };
  }

  /* =========================================================================
   * 1. STUDENT ATTENDANCE
   * ========================================================================= */

  /**
   * Get Student Attendance Log list for a specific class, section, date, and academic year
   */
  static async getStudentAttendanceList(schoolId, { class_id, section_id, academic_year, date, branch_id = null, page = 1, limit = 10, search = '' }) {
    const formattedDate = String(date || '').split('T')[0].trim();
    const joinConditions = [
      `sa.student_id = s.id`,
      `(sa.date = ? OR DATE(sa.date) = ?)`,
      `sa.status = 1`,
      `sa.attendance IS NOT NULL`,
    ];
    const joinParams = [formattedDate, formattedDate];

    const whereConditions = [
      `s.school_id = ?`,
      `s.status = 1`,
    ];
    const whereParams = [schoolId];

    if (branch_id) {
      whereConditions.push(`s.branch_id = ?`);
      whereParams.push(Number(branch_id));
    }

    if (class_id) {
      whereConditions.push(`s.class = ?`);
      whereParams.push(class_id);
    }
    if (section_id) {
      whereConditions.push(`s.section = ?`);
      whereParams.push(section_id);
    }
    if (academic_year) {
      whereConditions.push(`sa.academic_year = ?`);
      whereParams.push(academic_year);
    }
    if (search) {
      whereConditions.push(
        `(s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_number LIKE ? OR s.roll_number LIKE ? OR CONCAT(IFNULL(s.first_name, ''), ' ', IFNULL(s.last_name, '')) LIKE ?)`
      );
      const searchWildcard = `%${search}%`;
      whereParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard);
    }

    const baseFrom = `
      FROM student_master s
      INNER JOIN student_attendance sa ON (${joinConditions.join(' AND ')})
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sm ON s.section = sm.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (s.gender = 1 OR s.gender = '1' OR LOWER(CAST(s.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (s.gender = 2 OR s.gender = '2' OR LOWER(CAST(s.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (s.gender = 3 OR s.gender = '3' OR LOWER(CAST(s.gender AS CHAR)) IN ('other', 'others')))
      )
      WHERE ${whereConditions.join(' AND ')}
    `;

    const countParams = [...joinParams, ...whereParams];
    const countSql = `SELECT COUNT(DISTINCT s.id) AS total ${baseFrom}`;
    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0]?.total || 0;

    let sql = `
      SELECT 
        s.id AS student_id,
        s.admission_number,
        s.roll_number,
        s.first_name,
        s.last_name,
        CONCAT(IFNULL(s.first_name, ''), ' ', IFNULL(s.last_name, '')) AS full_name,
        s.gender,
        COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', 'Others'))) AS gender_name,
        s.picture,
        s.class AS class_id,
        cm.class_name,
        s.section AS section_id,
        sm.section_name,
        sa.id AS attendance_id,
        sa.attendance,
        CASE 
          WHEN sa.attendance = 1 THEN 'Present'
          WHEN sa.attendance = 2 THEN 'Late'
          WHEN sa.attendance = 0 THEN 'Absent'
          WHEN sa.attendance = 3 THEN 'Halfday'
          ELSE 'Not Marked'
        END AS attendance_status_label,
        sa.notes,
        sa.date AS attendance_date
      ${baseFrom}
      ORDER BY s.roll_number ASC, s.first_name ASC
    `;

    const dataParams = [...joinParams, ...whereParams];
    const parsedLimit = Number(limit);
    const parsedPage = Number(page) || 1;
    if (parsedLimit > 0) {
      const offset = (parsedPage - 1) * parsedLimit;
      sql += ` LIMIT ? OFFSET ?`;
      dataParams.push(parsedLimit, offset);
    }

    const [rows] = await pool.query(sql, dataParams);
    return {
      students: rows || [],
      total,
      page: parsedPage,
      limit: parsedLimit > 0 ? parsedLimit : total,
      totalPages: parsedLimit > 0 ? Math.ceil(total / parsedLimit) || 1 : 1,
    };
  }

  /**
   * Get Students roster ready to mark attendance for a specific date with pagination & search
   */
  static async getStudentsForAttendance(schoolId, { class_id, section_id, academic_year, date, branch_id = null, page = 1, limit = 10, search = '' }) {
    const formattedDate = String(date || '').split('T')[0].trim();
    const joinConditions = [
      `sa.student_id = s.id`,
      `(sa.date = ? OR DATE(sa.date) = ?)`,
      `sa.status = 1`,
    ];
    const joinParams = [formattedDate, formattedDate];
    if (academic_year) {
      joinConditions.push(`sa.academic_year = ?`);
      joinParams.push(academic_year);
    }

    const whereConditions = [
      `s.school_id = ?`,
      `s.status = 1`,
    ];
    const whereParams = [schoolId];

    if (branch_id) {
      whereConditions.push(`s.branch_id = ?`);
      whereParams.push(Number(branch_id));
    }

    if (class_id) {
      whereConditions.push(`s.class = ?`);
      whereParams.push(class_id);
    }
    if (section_id) {
      whereConditions.push(`s.section = ?`);
      whereParams.push(section_id);
    }
    if (search) {
      whereConditions.push(
        `(s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_number LIKE ? OR s.roll_number LIKE ? OR CONCAT(IFNULL(s.first_name, ''), ' ', IFNULL(s.last_name, '')) LIKE ?)`
      );
      const searchWildcard = `%${search}%`;
      whereParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard);
    }

    const baseFrom = `
      FROM student_master s
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sm ON s.section = sm.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (s.gender = 1 OR s.gender = '1' OR LOWER(CAST(s.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (s.gender = 2 OR s.gender = '2' OR LOWER(CAST(s.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (s.gender = 3 OR s.gender = '3' OR LOWER(CAST(s.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN student_attendance sa ON (${joinConditions.join(' AND ')})
      WHERE ${whereConditions.join(' AND ')}
    `;

    const countParams = [...joinParams, ...whereParams];
    const countSql = `SELECT COUNT(DISTINCT s.id) AS total ${baseFrom}`;
    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0]?.total || 0;

    let sql = `
      SELECT 
        s.id,
        s.id AS student_id,
        s.admission_number,
        s.roll_number,
        s.first_name,
        s.last_name,
        s.gender,
        COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', 'Others'))) AS gender_name,
        s.picture,
        s.class AS class_id,
        cm.class_name,
        s.section AS section_id,
        sm.section_name,
        sa.attendance,
        sa.notes
      ${baseFrom}
      ORDER BY s.roll_number ASC, s.first_name ASC
    `;

    const dataParams = [...joinParams, ...whereParams];
    const parsedLimit = Number(limit);
    const parsedPage = Number(page) || 1;
    if (parsedLimit > 0) {
      const offset = (parsedPage - 1) * parsedLimit;
      sql += ` LIMIT ? OFFSET ?`;
      dataParams.push(parsedLimit, offset);
    }

    const [rows] = await pool.query(sql, dataParams);
    return {
      students: rows || [],
      total,
      page: parsedPage,
      limit: parsedLimit > 0 ? parsedLimit : total,
      totalPages: parsedLimit > 0 ? Math.ceil(total / parsedLimit) || 1 : 1,
    };
  }

  /**
   * Helper to get server current date string in YYYY-MM-DD format
   */
  static getTodayDateStr() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Validate that attendance date is strictly the current date (no past date modification)
   */
  static validateAttendanceDate(attendanceDate, entityType = 'student') {
    const formattedDate = String(attendanceDate || '').split('T')[0].trim();
    const todayStr = AttendanceModel.getTodayDateStr();

    if (!formattedDate) {
      const err = new Error('Attendance date is required.');
      err.statusCode = 400;
      throw err;
    }

    if (formattedDate < todayStr) {
      const err = new Error(
        `Previous ${entityType} attendance cannot be modified. Only current date (${todayStr}) attendance can be marked or updated.`
      );
      err.statusCode = 403;
      throw err;
    }

    if (formattedDate > todayStr) {
      const err = new Error('Future date attendance cannot be submitted.');
      err.statusCode = 400;
      throw err;
    }

    return formattedDate;
  }

  /**
   * Batch Save / Upsert Student Attendance
   */
  static async saveStudentAttendance(schoolId, { attendanceDate, academic_year, attendanceRecords = [], branch_id = null }) {
    const validDate = AttendanceModel.validateAttendanceDate(attendanceDate, 'student');

    for (const record of attendanceRecords) {
      const studentId = record.student_id;
      const attendance = record.attendance !== undefined ? Number(record.attendance) : 1;
      const notes = record.notes || '';

      // Resolve branch_id from student if not provided
      let recBranchId = branch_id ? Number(branch_id) : null;
      if (!recBranchId) {
        try {
          const [stRow] = await pool.query(`SELECT branch_id FROM student_master WHERE id = ? LIMIT 1`, [studentId]);
          if (stRow && stRow[0]?.branch_id) recBranchId = stRow[0].branch_id;
        } catch (e) {}
      }

      // Check existing record
      const [existing] = await pool.query(
        `SELECT id FROM student_attendance WHERE student_id = ? AND date = ? AND school_id = ?`,
        [studentId, validDate, schoolId]
      );

      if (existing && existing.length > 0) {
        await pool.query(
          `UPDATE student_attendance SET attendance = ?, notes = ?, academic_year = ?, branch_id = COALESCE(?, branch_id) WHERE id = ?`,
          [attendance, notes, academic_year || null, recBranchId, existing[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO student_attendance (school_id, branch_id, student_id, attendance, academic_year, notes, date, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [schoolId, recBranchId, studentId, attendance, academic_year || null, notes, validDate]
        );
      }
    }
    return true;
  }

  /* =========================================================================
   * 2. TEACHER ATTENDANCE
   * ========================================================================= */

  /**
   * Get Teacher Attendance Log list for a specific date
   */
  static async getTeacherAttendanceList(schoolId, { date, branch_id = null, page = 1, limit = 10, search = '' }) {
    const formattedDate = String(date || '').split('T')[0].trim();
    const joinConditions = [
      `ta.teacher_id = t.id`,
      `(ta.date = ? OR DATE(ta.date) = ?)`,
      `ta.status = 1`,
      `ta.attendance IS NOT NULL`,
    ];
    const joinParams = [formattedDate, formattedDate];

    const whereConditions = [
      `t.school_id = ?`,
      `t.status = 1`,
    ];
    const whereParams = [schoolId];

    if (branch_id) {
      whereConditions.push(`t.branch_id = ?`);
      whereParams.push(Number(branch_id));
    }

    if (search) {
      whereConditions.push(
        `(t.first_name LIKE ? OR t.last_name LIKE ? OR t.teacher_id LIKE ? OR t.email_address LIKE ? OR t.primary_contact_number LIKE ? OR CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')) LIKE ?)`
      );
      const searchWildcard = `%${search}%`;
      whereParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard);
    }

    const baseFrom = `
      FROM teacher_master t
      INNER JOIN teacher_attendance ta ON (${joinConditions.join(' AND ')})
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (t.gender = 1 OR t.gender = '1' OR LOWER(CAST(t.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (t.gender = 2 OR t.gender = '2' OR LOWER(CAST(t.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (t.gender = 3 OR t.gender = 3 OR LOWER(CAST(t.gender AS CHAR)) IN ('other', 'others')))
      )
      WHERE ${whereConditions.join(' AND ')}
    `;

    const countParams = [...joinParams, ...whereParams];
    const countSql = `SELECT COUNT(DISTINCT t.id) AS total ${baseFrom}`;
    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0]?.total || 0;

    let sql = `
      SELECT 
        t.id AS teacher_id,
        t.teacher_id AS teacher_code,
        t.first_name,
        t.last_name,
        CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')) AS full_name,
        t.email_address AS email,
        t.primary_contact_number AS phone_number,
        t.gender,
        COALESCE(g.gender, IF(t.gender = '1', 'Male', IF(t.gender = '2', 'Female', 'Others'))) AS gender_name,
        t.picture,
        ta.id AS attendance_id,
        ta.attendance,
        CASE 
          WHEN ta.attendance = 1 THEN 'Present'
          WHEN ta.attendance = 2 THEN 'Late'
          WHEN ta.attendance = 0 THEN 'Absent'
          WHEN ta.attendance = 3 THEN 'Halfday'
          ELSE 'Not Marked'
        END AS attendance_status_label,
        ta.notes,
        ta.date AS attendance_date
      ${baseFrom}
      ORDER BY t.id ASC
    `;

    const dataParams = [...joinParams, ...whereParams];
    const parsedLimit = Number(limit);
    const parsedPage = Number(page) || 1;
    if (parsedLimit > 0) {
      const offset = (parsedPage - 1) * parsedLimit;
      sql += ` LIMIT ? OFFSET ?`;
      dataParams.push(parsedLimit, offset);
    }

    const [rows] = await pool.query(sql, dataParams);
    return {
      teachers: rows || [],
      total,
      page: parsedPage,
      limit: parsedLimit > 0 ? parsedLimit : total,
      totalPages: parsedLimit > 0 ? Math.ceil(total / parsedLimit) || 1 : 1,
    };
  }

  /**
   * Get Teachers roster ready to mark attendance for a specific date
   */
  static async getTeachersForAttendance(schoolId, { date, branch_id = null, page = 1, limit = 10, search = '' }) {
    const formattedDate = String(date || '').split('T')[0].trim();
    const joinConditions = [
      `ta.teacher_id = t.id`,
      `(ta.date = ? OR DATE(ta.date) = ?)`,
      `ta.status = 1`,
    ];
    const joinParams = [formattedDate, formattedDate];

    const whereConditions = [
      `t.school_id = ?`,
      `t.status = 1`,
    ];
    const whereParams = [schoolId];

    if (branch_id) {
      whereConditions.push(`t.branch_id = ?`);
      whereParams.push(Number(branch_id));
    }

    if (search) {
      whereConditions.push(
        `(t.first_name LIKE ? OR t.last_name LIKE ? OR t.teacher_id LIKE ? OR t.email_address LIKE ? OR t.primary_contact_number LIKE ? OR CONCAT(IFNULL(t.first_name, ''), ' ', IFNULL(t.last_name, '')) LIKE ?)`
      );
      const searchWildcard = `%${search}%`;
      whereParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard);
    }

    const baseFrom = `
      FROM teacher_master t
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (t.gender = 1 OR t.gender = '1' OR LOWER(CAST(t.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (t.gender = 2 OR t.gender = '2' OR LOWER(CAST(t.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (t.gender = 3 OR t.gender = 3 OR LOWER(CAST(t.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN class_master cm ON t.class = cm.id
      LEFT JOIN section_master sm ON t.section = sm.id
      LEFT JOIN teacher_attendance ta ON (${joinConditions.join(' AND ')})
      WHERE ${whereConditions.join(' AND ')}
    `;

    const countParams = [...joinParams, ...whereParams];
    const countSql = `SELECT COUNT(DISTINCT t.id) AS total ${baseFrom}`;
    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0]?.total || 0;

    let sql = `
      SELECT 
        t.id,
        t.id AS teacher_id,
        t.teacher_id AS teacher_code,
        t.first_name,
        t.last_name,
        t.email_address AS email,
        t.primary_contact_number AS phone_number,
        t.gender,
        COALESCE(g.gender, IF(t.gender = '1', 'Male', IF(t.gender = '2', 'Female', 'Others'))) AS gender_name,
        t.picture,
        cm.class_name,
        sm.section_name,
        ta.attendance,
        ta.notes
      ${baseFrom}
      ORDER BY t.id ASC
    `;

    const dataParams = [...joinParams, ...whereParams];
    const parsedLimit = Number(limit);
    const parsedPage = Number(page) || 1;
    if (parsedLimit > 0) {
      const offset = (parsedPage - 1) * parsedLimit;
      sql += ` LIMIT ? OFFSET ?`;
      dataParams.push(parsedLimit, offset);
    }

    const [rows] = await pool.query(sql, dataParams);
    return {
      teachers: rows || [],
      total,
      page: parsedPage,
      limit: parsedLimit > 0 ? parsedLimit : total,
      totalPages: parsedLimit > 0 ? Math.ceil(total / parsedLimit) || 1 : 1,
    };
  }

  /**
   * Batch Save / Upsert Teacher Attendance
   */
  static async saveTeacherAttendance(schoolId, { attendanceDate, attendanceRecords = [], branch_id = null }) {
    const validDate = AttendanceModel.validateAttendanceDate(attendanceDate, 'teacher');

    for (const record of attendanceRecords) {
      const teacherId = record.teacher_id;
      const attendance = record.attendance !== undefined ? Number(record.attendance) : 1;
      const notes = record.notes || '';

      let recBranchId = branch_id ? Number(branch_id) : null;
      if (!recBranchId) {
        try {
          const [tm] = await pool.query(`SELECT branch_id FROM teacher_master WHERE id = ? LIMIT 1`, [teacherId]);
          if (tm && tm[0]?.branch_id) recBranchId = tm[0].branch_id;
        } catch (e) {}
      }

      const [existing] = await pool.query(
        `SELECT id FROM teacher_attendance WHERE teacher_id = ? AND date = ? AND school_id = ?`,
        [teacherId, validDate, schoolId]
      );

      if (existing && existing.length > 0) {
        await pool.query(
          `UPDATE teacher_attendance SET attendance = ?, notes = ?, branch_id = COALESCE(?, branch_id) WHERE id = ?`,
          [attendance, notes, recBranchId, existing[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO teacher_attendance (school_id, branch_id, teacher_id, attendance, notes, date, status)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [schoolId, recBranchId, teacherId, attendance, notes, validDate]
        );
      }
    }
    return true;
  }

  /* =========================================================================
   * 3. STAFF ATTENDANCE
   * ========================================================================= */

  /**
   * Get Staff Attendance Log list for a specific date
   */
  static async getStaffAttendanceList(schoolId, { date, branch_id = null, page = 1, limit = 10, search = '' }) {
    const formattedDate = String(date || '').split('T')[0].trim();
    const joinConditions = [
      `uma.user_master_id = u.id`,
      `(uma.date = ? OR DATE(uma.date) = ?)`,
      `uma.status = 1`,
      `uma.attendance IS NOT NULL`,
    ];
    const joinParams = [formattedDate, formattedDate];

    const whereConditions = [
      `u.school_id = ?`,
      `u.status = 1`,
    ];
    const whereParams = [schoolId];

    if (branch_id) {
      whereConditions.push(`u.branch_id = ?`);
      whereParams.push(Number(branch_id));
    }

    if (search) {
      whereConditions.push(
        `(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR r.role_name LIKE ? OR CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) LIKE ?)`
      );
      const searchWildcard = `%${search}%`;
      whereParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard);
    }

    const baseFrom = `
      FROM user_master u
      INNER JOIN user_master_attendance uma ON (${joinConditions.join(' AND ')})
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (u.gender = 1 OR u.gender = '1' OR LOWER(CAST(u.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (u.gender = 2 OR u.gender = '2' OR LOWER(CAST(u.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (u.gender = 3 OR u.gender = 3 OR LOWER(CAST(u.gender AS CHAR)) IN ('other', 'others')))
      )
      WHERE ${whereConditions.join(' AND ')}
    `;

    const countParams = [...joinParams, ...whereParams];
    const countSql = `SELECT COUNT(DISTINCT u.id) AS total ${baseFrom}`;
    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0]?.total || 0;

    let sql = `
      SELECT 
        u.id AS user_id,
        u.first_name,
        u.last_name,
        CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) AS full_name,
        u.email,
        u.phone,
        u.gender,
        COALESCE(g.gender, IF(u.gender = '1', 'Male', IF(u.gender = '2', 'Female', 'Others'))) AS gender_name,
        u.picture,
        CASE 
          WHEN u.admin_type = 1 THEN 'Super Admin'
          ELSE COALESCE(r.role_name, 'Staff')
        END AS role_name,
        uma.id AS attendance_id,
        uma.attendance,
        CASE 
          WHEN uma.attendance = 1 THEN 'Present'
          WHEN uma.attendance = 2 THEN 'Late'
          WHEN uma.attendance = 0 THEN 'Absent'
          WHEN uma.attendance = 3 THEN 'Halfday'
          ELSE 'Not Marked'
        END AS attendance_status_label,
        uma.notes,
        uma.date AS attendance_date
      ${baseFrom}
      ORDER BY u.id ASC
    `;

    const dataParams = [...joinParams, ...whereParams];
    const parsedLimit = Number(limit);
    const parsedPage = Number(page) || 1;
    if (parsedLimit > 0) {
      const offset = (parsedPage - 1) * parsedLimit;
      sql += ` LIMIT ? OFFSET ?`;
      dataParams.push(parsedLimit, offset);
    }

    const [rows] = await pool.query(sql, dataParams);
    return {
      staffs: rows || [],
      total,
      page: parsedPage,
      limit: parsedLimit > 0 ? parsedLimit : total,
      totalPages: parsedLimit > 0 ? Math.ceil(total / parsedLimit) || 1 : 1,
    };
  }

  /**
   * Get Staff roster ready to mark attendance for a specific date
   */
  static async getStaffForAttendance(schoolId, { date, branch_id = null, page = 1, limit = 10, search = '' }) {
    const formattedDate = String(date || '').split('T')[0].trim();
    const joinConditions = [
      `uma.user_master_id = u.id`,
      `(uma.date = ? OR DATE(uma.date) = ?)`,
      `uma.status = 1`,
    ];
    const joinParams = [formattedDate, formattedDate];

    const whereConditions = [
      `u.school_id = ?`,
      `u.status = 1`,
    ];
    const whereParams = [schoolId];

    if (branch_id) {
      whereConditions.push(`u.branch_id = ?`);
      whereParams.push(Number(branch_id));
    }

    if (search) {
      whereConditions.push(
        `(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR r.role_name LIKE ? OR CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) LIKE ?)`
      );
      const searchWildcard = `%${search}%`;
      whereParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard, searchWildcard);
    }

    const baseFrom = `
      FROM user_master u
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (u.gender = 1 OR u.gender = '1' OR LOWER(CAST(u.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (u.gender = 2 OR u.gender = '2' OR LOWER(CAST(u.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (u.gender = 3 OR u.gender = '3' OR LOWER(CAST(u.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN user_master_attendance uma ON (${joinConditions.join(' AND ')})
      WHERE ${whereConditions.join(' AND ')}
    `;

    const countParams = [...joinParams, ...whereParams];
    const countSql = `SELECT COUNT(DISTINCT u.id) AS total ${baseFrom}`;
    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0]?.total || 0;

    let sql = `
      SELECT 
        u.id,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        u.gender,
        COALESCE(g.gender, IF(u.gender = '1', 'Male', IF(u.gender = '2', 'Female', 'Others'))) AS gender_name,
        u.picture,
        CASE 
          WHEN u.admin_type = 1 THEN 'Super Admin'
          ELSE COALESCE(r.role_name, 'Staff')
        END AS role_name,
        uma.attendance,
        uma.notes
      ${baseFrom}
      ORDER BY u.id ASC
    `;

    const dataParams = [...joinParams, ...whereParams];
    const parsedLimit = Number(limit);
    const parsedPage = Number(page) || 1;
    if (parsedLimit > 0) {
      const offset = (parsedPage - 1) * parsedLimit;
      sql += ` LIMIT ? OFFSET ?`;
      dataParams.push(parsedLimit, offset);
    }

    const [rows] = await pool.query(sql, dataParams);
    return {
      staffs: rows || [],
      total,
      page: parsedPage,
      limit: parsedLimit > 0 ? parsedLimit : total,
      totalPages: parsedLimit > 0 ? Math.ceil(total / parsedLimit) || 1 : 1,
    };
  }

  /**
   * Batch Save / Upsert Staff Attendance
   */
  static async saveStaffAttendance(schoolId, { attendanceDate, attendanceRecords = [], branch_id = null }) {
    const validDate = AttendanceModel.validateAttendanceDate(attendanceDate, 'staff');

    for (const record of attendanceRecords) {
      const userId = record.user_id;
      const attendance = record.attendance !== undefined ? Number(record.attendance) : 1;
      const notes = record.notes || '';

      let recBranchId = branch_id ? Number(branch_id) : null;
      if (!recBranchId) {
        try {
          const [um] = await pool.query(`SELECT branch_id FROM user_master WHERE id = ? LIMIT 1`, [userId]);
          if (um && um[0]?.branch_id) recBranchId = um[0].branch_id;
        } catch (e) {}
      }

      const [existing] = await pool.query(
        `SELECT id FROM user_master_attendance WHERE user_master_id = ? AND date = ? AND school_id = ?`,
        [userId, validDate, schoolId]
      );

      if (existing && existing.length > 0) {
        await pool.query(
          `UPDATE user_master_attendance SET attendance = ?, notes = ?, branch_id = COALESCE(?, branch_id) WHERE id = ?`,
          [attendance, notes, recBranchId, existing[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO user_master_attendance (school_id, branch_id, user_master_id, attendance, notes, date, status)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [schoolId, recBranchId, userId, attendance, notes, validDate]
        );
      }
    }
    return true;
  }
}

module.exports = AttendanceModel;
