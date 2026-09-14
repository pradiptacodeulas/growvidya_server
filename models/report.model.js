const { pool } = require('../config/db.config');

class ReportModel {
  /**
   * Fetches dropdown options (academic years, shifts, classes, sections) for reports
   */
  static async getFilterOptions(schoolId) {
    // 1. Academic Years
    const [years] = await pool.query(
      `SELECT id, academic_year, start_date, end_date, is_current 
       FROM academic_year_master 
       WHERE school_id = ? AND (status = 1 OR status IS NULL) 
       ORDER BY is_current DESC, id ASC`,
      [schoolId]
    );

    // 2. Shifts
    const [shifts] = await pool.query(
      `SELECT id, shift_name, start_time, end_time 
       FROM shift_master 
       WHERE school_id = ? AND status = 1 
       ORDER BY id ASC`,
      [schoolId]
    );

    // 3. Classes with Shift ID
    const [classes] = await pool.query(
      `SELECT id, shift_id, class_name, sort_order 
       FROM class_master 
       WHERE school_id = ? AND status = 1 
       ORDER BY sort_order ASC, id ASC`,
      [schoolId]
    );

    // 4. Sections with Class ID
    const [sections] = await pool.query(
      `SELECT id, class_id, section_name, capacity 
       FROM section_master 
       WHERE school_id = ? AND status = 1 
       ORDER BY sort_order ASC, id ASC`,
      [schoolId]
    );

    return {
      academicYears: years.map((y) => {
        let startY = null;
        let endY = null;
        if (y.start_date) {
          const match = String(y.start_date).match(/^(\d{4})/);
          if (match) startY = parseInt(match[1], 10);
        }
        if (y.end_date) {
          const match = String(y.end_date).match(/^(\d{4})/);
          if (match) endY = parseInt(match[1], 10);
        }
        if (!startY && y.academic_year) {
          const match = String(y.academic_year).match(/^(\d{4})/);
          if (match) startY = parseInt(match[1], 10);
        }
        const label = startY
          ? (endY && endY > startY ? `${startY} - ${endY}` : `${startY} - ${startY + 1}`)
          : (y.academic_year || String(y.id));

        return {
          id: y.id,
          label,
          academic_year: label,
          name: label,
          start_date: y.start_date,
          end_date: y.end_date,
          rawYear: y.academic_year,
          isCurrent: y.is_current === 1,
          is_current: y.is_current,
        };
      }),
      shifts: shifts.map((s) => ({
        id: s.id,
        shift_name: s.shift_name.trim(),
      })),
      classes: classes.map((c) => ({
        id: c.id,
        shift_id: c.shift_id,
        class_name: c.class_name,
      })),
      sections: sections.map((sec) => ({
        id: sec.id,
        class_id: sec.class_id,
        section_name: sec.section_name,
      })),
    };
  }

  /**
   * Fetches Class Report data for students enrolled in specified academic year, shift, class, and section
   */
  static async getClassReport(
    schoolId,
    { academicYearId = '', shiftId = '', classId = '', sectionId = '', search = '', limit = 10, offset = 0 }
  ) {
    let whereConditions = [`s.school_id = ?`, `s.status = 1`];
    let queryParams = [schoolId];

    if (academicYearId) {
      whereConditions.push(`(COALESCE(scl.academic_year, s.academic_year) = ? OR ay.academic_year = ?)`);
      queryParams.push(academicYearId, academicYearId);
    }

    if (shiftId) {
      whereConditions.push(`cm.shift_id = ?`);
      queryParams.push(shiftId);
    }

    if (classId) {
      whereConditions.push(`(COALESCE(scl.class_id, s.class) = ? OR cm.class_name = ?)`);
      queryParams.push(classId, classId);
    }

    if (sectionId) {
      whereConditions.push(`(COALESCE(scl.section_id, s.section) = ? OR sec.section_name = ?)`);
      queryParams.push(sectionId, sectionId);
    }

    if (search) {
      const searchParam = `%${String(search).trim()}%`;
      whereConditions.push(
        `(s.first_name LIKE ? OR s.last_name LIKE ? OR CONCAT(s.first_name, ' ', s.last_name) LIKE ? OR s.admission_number LIKE ? OR COALESCE(scl.roll_number, s.roll_number) LIKE ? OR s.primary_contact_number LIKE ? OR s.email_address LIKE ?)`
      );
      queryParams.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Main student records query
    const sql = `
      SELECT 
        s.id AS student_id,
        s.admission_number,
        s.first_name,
        s.last_name,
        CONCAT(COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, '')) AS full_name,
        s.picture,
        COALESCE(s.primary_contact_number, '') AS phone,
        COALESCE(s.email_address, '') AS email,
        COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', s.gender)), 'Male') AS gender,
        s.status,
        COALESCE(scl.roll_number, s.roll_number, '') AS roll_number,
        COALESCE(scl.academic_year, s.academic_year) AS academic_year_id,
        COALESCE(scl.class_id, cm.id, s.class) AS class_id,
        COALESCE(scl.section_id, sec.id, s.section) AS section_id,
        cm.class_name,
        cm.shift_id,
        sh.shift_name,
        sec.section_name,
        ay.academic_year,
        ay.start_date,
        ay.end_date,
        '' AS marks
      FROM student_master s
      LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
      LEFT JOIN class_master cm ON (cm.id = COALESCE(scl.class_id, s.class) OR cm.class_name = COALESCE(scl.class_id, s.class))
      LEFT JOIN shift_master sh ON cm.shift_id = sh.id
      LEFT JOIN section_master sec ON (sec.id = COALESCE(scl.section_id, s.section) OR sec.section_name = COALESCE(scl.section_id, s.section))
      LEFT JOIN academic_year_master ay ON (ay.id = COALESCE(scl.academic_year, s.academic_year) OR ay.academic_year = COALESCE(scl.academic_year, s.academic_year))
      LEFT JOIN gender_master g ON (s.gender != 0 AND (s.gender = g.id OR CAST(s.gender AS CHAR) = g.gender))
      ${whereClause}
      GROUP BY s.id
      ORDER BY COALESCE(scl.roll_number, s.roll_number) ASC, s.first_name ASC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM student_master s
      LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
      LEFT JOIN class_master cm ON (cm.id = COALESCE(scl.class_id, s.class) OR cm.class_name = COALESCE(scl.class_id, s.class))
      LEFT JOIN shift_master sh ON cm.shift_id = sh.id
      LEFT JOIN section_master sec ON (sec.id = COALESCE(scl.section_id, s.section) OR sec.section_name = COALESCE(scl.section_id, s.section))
      LEFT JOIN academic_year_master ay ON (ay.id = COALESCE(scl.academic_year, s.academic_year) OR ay.academic_year = COALESCE(scl.academic_year, s.academic_year))
      ${whereClause}
    `;

    const [students] = await pool.query(sql, [...queryParams, Number(limit), Number(offset)]);
    const [countResult] = await pool.query(countSql, queryParams);
    const total = countResult[0]?.total || 0;

    // Fetch summary labels for the selected filters
    let summary = {
      academicYear: '—',
      shift: '—',
      className: '—',
      sectionName: '—',
      totalStudents: total,
    };

    if (academicYearId) {
      const [yRow] = await pool.query(
        `SELECT academic_year, start_date, end_date FROM academic_year_master WHERE id = ? AND school_id = ?`,
        [academicYearId, schoolId]
      );
      if (yRow.length > 0) {
        if (yRow[0].start_date && yRow[0].end_date) {
          const s = new Date(yRow[0].start_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          const e = new Date(yRow[0].end_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          summary.academicYear = `${s} - ${e}`;
        } else {
          summary.academicYear = yRow[0].academic_year;
        }
      }
    }

    if (shiftId) {
      const [shRow] = await pool.query(
        `SELECT shift_name FROM shift_master WHERE id = ? AND school_id = ?`,
        [shiftId, schoolId]
      );
      if (shRow.length > 0) {
        summary.shift = shRow[0].shift_name.trim();
      }
    }

    if (classId) {
      const [cRow] = await pool.query(
        `SELECT class_name FROM class_master WHERE id = ? AND school_id = ?`,
        [classId, schoolId]
      );
      if (cRow.length > 0) {
        summary.className = cRow[0].class_name;
      }
    }

    if (sectionId) {
      const [secRow] = await pool.query(
        `SELECT section_name FROM section_master WHERE id = ? AND school_id = ?`,
        [sectionId, schoolId]
      );
      if (secRow.length > 0) {
        summary.sectionName = secRow[0].section_name;
      }
    }

    return {
      students,
      total,
      summary,
    };
  }

  /**
   * Fetches Student Report data with parent info, dates, and contacts
   */
  static async getStudentReport(
    schoolId,
    { academicYearId = '', shiftId = '', classId = '', sectionId = '', search = '', limit = 10, offset = 0 }
  ) {
    let whereConditions = [`s.school_id = ?`, `s.status = 1`];
    let queryParams = [schoolId];

    if (academicYearId) {
      whereConditions.push(`(COALESCE(scl.academic_year, s.academic_year) = ? OR ay.academic_year = ?)`);
      queryParams.push(academicYearId, academicYearId);
    }

    if (shiftId) {
      whereConditions.push(`cm.shift_id = ?`);
      queryParams.push(shiftId);
    }

    if (classId) {
      whereConditions.push(`(COALESCE(scl.class_id, s.class) = ? OR cm.class_name = ?)`);
      queryParams.push(classId, classId);
    }

    if (sectionId) {
      whereConditions.push(`(COALESCE(scl.section_id, s.section) = ? OR sec.section_name = ?)`);
      queryParams.push(sectionId, sectionId);
    }

    if (search) {
      const searchParam = `%${String(search).trim()}%`;
      whereConditions.push(
        `(s.first_name LIKE ? OR s.last_name LIKE ? OR CONCAT(s.first_name, ' ', s.last_name) LIKE ? OR s.admission_number LIKE ? OR COALESCE(scl.roll_number, s.roll_number) LIKE ? OR s.primary_contact_number LIKE ? OR s.email_address LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)`
      );
      queryParams.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const sql = `
      SELECT 
        s.id AS student_id,
        s.admission_number,
        s.admission_date,
        s.date_of_birth,
        s.first_name,
        s.last_name,
        CONCAT(COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, '')) AS full_name,
        s.picture,
        COALESCE(s.primary_contact_number, '') AS phone,
        COALESCE(s.email_address, '') AS email,
        COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', s.gender)), 'Male') AS gender,
        s.status,
        COALESCE(scl.roll_number, s.roll_number, '') AS roll_number,
        COALESCE(scl.academic_year, s.academic_year) AS academic_year_id,
        COALESCE(scl.class_id, cm.id, s.class) AS class_id,
        COALESCE(scl.section_id, sec.id, s.section) AS section_id,
        cm.class_name,
        cm.shift_id,
        sh.shift_name,
        sec.section_name,
        ay.academic_year,
        ay.start_date,
        ay.end_date,
        CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) AS parent_name,
        COALESCE(p.phone, '') AS parent_phone
      FROM student_master s
      LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
      LEFT JOIN class_master cm ON (cm.id = COALESCE(scl.class_id, s.class) OR cm.class_name = COALESCE(scl.class_id, s.class))
      LEFT JOIN shift_master sh ON cm.shift_id = sh.id
      LEFT JOIN section_master sec ON (sec.id = COALESCE(scl.section_id, s.section) OR sec.section_name = COALESCE(scl.section_id, s.section))
      LEFT JOIN academic_year_master ay ON (ay.id = COALESCE(scl.academic_year, s.academic_year) OR ay.academic_year = COALESCE(scl.academic_year, s.academic_year))
      LEFT JOIN gender_master g ON (s.gender != 0 AND (s.gender = g.id OR CAST(s.gender AS CHAR) = g.gender))
      LEFT JOIN student_to_parent stp ON s.id = stp.student_id
      LEFT JOIN parent_master p ON (stp.father_id = p.id OR stp.guardian_id = p.id)
      ${whereClause}
      GROUP BY s.id
      ORDER BY COALESCE(scl.roll_number, s.roll_number) ASC, s.first_name ASC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM student_master s
      LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
      LEFT JOIN class_master cm ON (cm.id = COALESCE(scl.class_id, s.class) OR cm.class_name = COALESCE(scl.class_id, s.class))
      LEFT JOIN shift_master sh ON cm.shift_id = sh.id
      LEFT JOIN section_master sec ON (sec.id = COALESCE(scl.section_id, s.section) OR sec.section_name = COALESCE(scl.section_id, s.section))
      LEFT JOIN academic_year_master ay ON (ay.id = COALESCE(scl.academic_year, s.academic_year) OR ay.academic_year = COALESCE(scl.academic_year, s.academic_year))
      LEFT JOIN student_to_parent stp ON s.id = stp.student_id
      LEFT JOIN parent_master p ON (stp.father_id = p.id OR stp.guardian_id = p.id)
      ${whereClause}
    `;

    const [students] = await pool.query(sql, [...queryParams, Number(limit), Number(offset)]);
    const [countResult] = await pool.query(countSql, queryParams);
    const total = countResult[0]?.total || 0;

    let summary = {
      academicYear: '—',
      shift: '—',
      className: '—',
      sectionName: '—',
      totalStudents: total,
    };

    if (academicYearId) {
      const [yRow] = await pool.query(
        `SELECT academic_year, start_date, end_date FROM academic_year_master WHERE id = ? AND school_id = ?`,
        [academicYearId, schoolId]
      );
      if (yRow.length > 0) {
        if (yRow[0].start_date && yRow[0].end_date) {
          const s = new Date(yRow[0].start_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          const e = new Date(yRow[0].end_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          summary.academicYear = `${s} - ${e}`;
        } else {
          summary.academicYear = yRow[0].academic_year;
        }
      }
    }

    if (shiftId) {
      const [shRow] = await pool.query(
        `SELECT shift_name FROM shift_master WHERE id = ? AND school_id = ?`,
        [shiftId, schoolId]
      );
      if (shRow.length > 0) {
        summary.shift = shRow[0].shift_name.trim();
      }
    }

    if (classId) {
      const [cRow] = await pool.query(
        `SELECT class_name FROM class_master WHERE id = ? AND school_id = ?`,
        [classId, schoolId]
      );
      if (cRow.length > 0) {
        summary.className = cRow[0].class_name;
      }
    }

    if (sectionId) {
      const [secRow] = await pool.query(
        `SELECT section_name FROM section_master WHERE id = ? AND school_id = ?`,
        [sectionId, schoolId]
      );
      if (secRow.length > 0) {
        summary.sectionName = secRow[0].section_name;
      }
    }

    return {
      students,
      total,
      summary,
    };
  }

  /**
   * Fetches Monthly Attendance Report for Students, Teachers, or Staff
   */
  static async getAttendanceReport(
    schoolId,
    {
      type = 'student',
      academicYearId = '',
      shiftId = '',
      classId = '',
      sectionId = '',
      month = new Date().getMonth() + 1,
      year = new Date().getFullYear(),
      search = '',
      limit = 10,
      offset = 0,
    }
  ) {
    const numMonth = Number(month) || new Date().getMonth() + 1;
    const numYear = Number(year) || new Date().getFullYear();
    const daysInMonth = new Date(numYear, numMonth, 0).getDate();
    const startDate = `${numYear}-${String(numMonth).padStart(2, '0')}-01`;
    const endDate = `${numYear}-${String(numMonth).padStart(2, '0')}-${daysInMonth}`;

    const startDateTime = `${startDate} 00:00:00`;
    const endDateTime = `${endDate} 23:59:59`;

    // Days metadata for the month header
    const daysMeta = [];
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(numYear, numMonth - 1, d);
      daysMeta.push({
        dayNumber: d,
        dayString: String(d).padStart(2, '0'),
        dayOfWeek: dayNames[dateObj.getDay()],
        fullDate: `${numYear}-${String(numMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      });
    }

    let entities = [];
    let total = 0;

    if (type === 'teacher') {
      // 1. Teachers
      let whereConditions = [`t.school_id = ?`, `t.status = 1`];
      let queryParams = [schoolId];

      if (search) {
        const searchParam = `%${String(search).trim()}%`;
        whereConditions.push(
          `(t.first_name LIKE ? OR t.last_name LIKE ? OR CONCAT(t.first_name, ' ', t.last_name) LIKE ? OR t.primary_contact_number LIKE ? OR t.teacher_id LIKE ?)`
        );
        queryParams.push(searchParam, searchParam, searchParam, searchParam, searchParam);
      }

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      const sql = `
        SELECT 
          t.id AS entity_id,
          t.first_name,
          t.last_name,
          CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, '')) AS full_name,
          t.picture,
          COALESCE(t.primary_contact_number, '') AS phone,
          COALESCE(t.email_address, '') AS email,
          t.teacher_id,
          t.status
        FROM teacher_master t
        ${whereClause}
        ORDER BY t.first_name ASC
        LIMIT ? OFFSET ?
      `;

      const countSql = `SELECT COUNT(*) AS total FROM teacher_master t ${whereClause}`;
      const [rows] = await pool.query(sql, [...queryParams, Number(limit), Number(offset)]);
      const [cRows] = await pool.query(countSql, queryParams);
      total = cRows[0]?.total || 0;

      // Fetch attendance records for these teachers in the month
      if (rows.length > 0) {
        const teacherIds = rows.map((r) => r.entity_id);
        const placeholders = teacherIds.map(() => '?').join(',');
        const [attRecords] = await pool.query(
          `SELECT teacher_id AS entity_id, attendance, DAY(date) AS day_num 
           FROM teacher_attendance 
           WHERE school_id = ? AND teacher_id IN (${placeholders}) AND date BETWEEN ? AND ?`,
          [schoolId, ...teacherIds, startDateTime, endDateTime]
        );

        const attMap = {};
        for (const rec of attRecords) {
          if (!attMap[rec.entity_id]) attMap[rec.entity_id] = {};
          attMap[rec.entity_id][rec.day_num] = rec.attendance;
        }

        entities = rows.map((teacher) => {
          const tAtt = attMap[teacher.entity_id] || {};
          let p = 0, l = 0, a = 0, h = 0, f = 0;
          const days = {};

          for (let d = 1; d <= daysInMonth; d++) {
            const rawVal = tAtt[d];
            let status = '-';
            if (rawVal === 1 || rawVal === '1') {
              status = 'P';
              p++;
            } else if (rawVal === 2 || rawVal === '2') {
              status = 'L';
              l++;
            } else if (rawVal === 0 || rawVal === '0') {
              status = 'A';
              a++;
            } else if (rawVal === 3 || rawVal === '3') {
              status = 'H';
              h++;
            } else if (rawVal === 4 || rawVal === '4' || rawVal === 5 || rawVal === '5') {
              status = 'F';
              f++;
            }
            days[d] = status;
          }

          const recordedDays = p + l + a + h + f;
          const percentage = recordedDays > 0 ? Math.round(((p + l * 0.5 + h * 0.5) / recordedDays) * 100) : 0;

          return {
            id: teacher.entity_id,
            name: teacher.full_name,
            picture: teacher.picture,
            phone: teacher.phone,
            email: teacher.email,
            status: teacher.status,
            p,
            l,
            a,
            h,
            f,
            percentage,
            days,
          };
        });
      }
    } else if (type === 'user' || type === 'staff') {
      // 2. Staff / Users
      let whereConditions = [`u.school_id = ?`, `u.status = 1`];
      let queryParams = [schoolId];

      if (search) {
        const searchParam = `%${String(search).trim()}%`;
        whereConditions.push(`(u.first_name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.first_name, ' ', u.last_name) LIKE ? OR u.phone LIKE ?)`);
        queryParams.push(searchParam, searchParam, searchParam, searchParam);
      }

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      const sql = `
        SELECT 
          u.id AS entity_id,
          u.first_name,
          u.last_name,
          CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS full_name,
          u.picture,
          u.phone,
          u.email,
          u.status
        FROM user_master u
        ${whereClause}
        ORDER BY u.first_name ASC
        LIMIT ? OFFSET ?
      `;

      const countSql = `SELECT COUNT(*) AS total FROM user_master u ${whereClause}`;
      const [rows] = await pool.query(sql, [...queryParams, Number(limit), Number(offset)]);
      const [cRows] = await pool.query(countSql, queryParams);
      total = cRows[0]?.total || 0;

      // Fetch attendance records for staff
      if (rows.length > 0) {
        const userIds = rows.map((r) => r.entity_id);
        const placeholders = userIds.map(() => '?').join(',');
        const [attRecords] = await pool.query(
          `SELECT user_master_id AS entity_id, attendance, DAY(date) AS day_num 
           FROM user_master_attendance 
           WHERE school_id = ? AND user_master_id IN (${placeholders}) AND date BETWEEN ? AND ?`,
          [schoolId, ...userIds, startDateTime, endDateTime]
        );

        const attMap = {};
        for (const rec of attRecords) {
          if (!attMap[rec.entity_id]) attMap[rec.entity_id] = {};
          attMap[rec.entity_id][rec.day_num] = rec.attendance;
        }

        entities = rows.map((staff) => {
          const sAtt = attMap[staff.entity_id] || {};
          let p = 0, l = 0, a = 0, h = 0, f = 0;
          const days = {};

          for (let d = 1; d <= daysInMonth; d++) {
            const rawVal = sAtt[d];
            let status = '-';
            if (rawVal === 1 || rawVal === '1') {
              status = 'P';
              p++;
            } else if (rawVal === 2 || rawVal === '2') {
              status = 'L';
              l++;
            } else if (rawVal === 0 || rawVal === '0') {
              status = 'A';
              a++;
            } else if (rawVal === 3 || rawVal === '3') {
              status = 'H';
              h++;
            } else if (rawVal === 4 || rawVal === '4' || rawVal === 5 || rawVal === '5') {
              status = 'F';
              f++;
            }
            days[d] = status;
          }

          const recordedDays = p + l + a + h + f;
          const percentage = recordedDays > 0 ? Math.round(((p + l * 0.5 + h * 0.5) / recordedDays) * 100) : 0;

          return {
            id: staff.entity_id,
            name: staff.full_name,
            picture: staff.picture,
            phone: staff.phone,
            email: staff.email,
            status: staff.status,
            p,
            l,
            a,
            h,
            f,
            percentage,
            days,
          };
        });
      }
    } else {
      // 3. Students (default)
      let whereConditions = [`s.school_id = ?`, `s.status = 1`];
      let queryParams = [schoolId];

      if (academicYearId) {
        whereConditions.push(`(COALESCE(scl.academic_year, s.academic_year) = ? OR ay.academic_year = ?)`);
        queryParams.push(academicYearId, academicYearId);
      }

      if (shiftId) {
        whereConditions.push(`cm.shift_id = ?`);
        queryParams.push(shiftId);
      }

      if (classId) {
        whereConditions.push(`(COALESCE(scl.class_id, s.class) = ? OR cm.class_name = ?)`);
        queryParams.push(classId, classId);
      }

      if (sectionId) {
        whereConditions.push(`(COALESCE(scl.section_id, s.section) = ? OR sec.section_name = ?)`);
        queryParams.push(sectionId, sectionId);
      }

      if (search) {
        const searchParam = `%${String(search).trim()}%`;
        whereConditions.push(`(s.first_name LIKE ? OR s.last_name LIKE ? OR CONCAT(s.first_name, ' ', s.last_name) LIKE ? OR s.admission_number LIKE ? OR COALESCE(scl.roll_number, s.roll_number) LIKE ?)`);
        queryParams.push(searchParam, searchParam, searchParam, searchParam, searchParam);
      }

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      const sql = `
        SELECT 
          s.id AS entity_id,
          s.admission_number,
          s.first_name,
          s.last_name,
          CONCAT(COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, '')) AS full_name,
          s.picture,
          s.status,
          COALESCE(scl.roll_number, s.roll_number, '') AS roll_number,
          cm.class_name,
          sec.section_name
        FROM student_master s
        LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
        LEFT JOIN class_master cm ON (cm.id = COALESCE(scl.class_id, s.class) OR cm.class_name = COALESCE(scl.class_id, s.class))
        LEFT JOIN section_master sec ON (sec.id = COALESCE(scl.section_id, s.section) OR sec.section_name = COALESCE(scl.section_id, s.section))
        LEFT JOIN academic_year_master ay ON (ay.id = COALESCE(scl.academic_year, s.academic_year) OR ay.academic_year = COALESCE(scl.academic_year, s.academic_year))
        ${whereClause}
        GROUP BY s.id
        ORDER BY COALESCE(scl.roll_number, s.roll_number) ASC, s.first_name ASC
        LIMIT ? OFFSET ?
      `;

      const countSql = `
        SELECT COUNT(DISTINCT s.id) AS total
        FROM student_master s
        LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
        LEFT JOIN class_master cm ON (cm.id = COALESCE(scl.class_id, s.class) OR cm.class_name = COALESCE(scl.class_id, s.class))
        LEFT JOIN section_master sec ON (sec.id = COALESCE(scl.section_id, s.section) OR sec.section_name = COALESCE(scl.section_id, s.section))
        LEFT JOIN academic_year_master ay ON (ay.id = COALESCE(scl.academic_year, s.academic_year) OR ay.academic_year = COALESCE(scl.academic_year, s.academic_year))
        ${whereClause}
      `;

      const [rows] = await pool.query(sql, [...queryParams, Number(limit), Number(offset)]);
      const [cRows] = await pool.query(countSql, queryParams);
      total = cRows[0]?.total || 0;

      // Fetch attendance records for students in this month
      if (rows.length > 0) {
        const studentIds = rows.map((r) => r.entity_id);
        const placeholders = studentIds.map(() => '?').join(',');
        const [attRecords] = await pool.query(
          `SELECT student_id AS entity_id, attendance, DAY(date) AS day_num 
           FROM student_attendance 
           WHERE school_id = ? AND student_id IN (${placeholders}) AND date BETWEEN ? AND ?`,
          [schoolId, ...studentIds, startDateTime, endDateTime]
        );

        const attMap = {};
        for (const rec of attRecords) {
          if (!attMap[rec.entity_id]) attMap[rec.entity_id] = {};
          attMap[rec.entity_id][rec.day_num] = rec.attendance;
        }

        entities = rows.map((student) => {
          const sAtt = attMap[student.entity_id] || {};
          let p = 0, l = 0, a = 0, h = 0, f = 0;
          const days = {};

          for (let d = 1; d <= daysInMonth; d++) {
            const rawVal = sAtt[d];
            let status = '-';
            if (rawVal === 1 || rawVal === '1') {
              status = 'P';
              p++;
            } else if (rawVal === 2 || rawVal === '2') {
              status = 'L';
              l++;
            } else if (rawVal === 0 || rawVal === '0') {
              status = 'A';
              a++;
            } else if (rawVal === 3 || rawVal === '3') {
              status = 'H';
              h++;
            } else if (rawVal === 4 || rawVal === '4' || rawVal === 5 || rawVal === '5') {
              status = 'F';
              f++;
            }
            days[d] = status;
          }

          const recordedDays = p + l + a + h + f;
          const percentage = recordedDays > 0 ? Math.round(((p + l * 0.5 + h * 0.5) / recordedDays) * 100) : 0;

          return {
            id: student.entity_id,
            admissionNumber: student.admission_number,
            rollNumber: student.roll_number,
            name: student.full_name,
            picture: student.picture,
            className: student.class_name,
            sectionName: student.section_name,
            status: student.status,
            p,
            l,
            a,
            h,
            f,
            percentage,
            days,
          };
        });
      }
    }

    return {
      type,
      month: numMonth,
      year: numYear,
      daysInMonth,
      daysMeta,
      entities,
      total,
    };
  }

  /**
   * Fetches Calendar Events (School Events, Holidays, Exam Schedules) for Calendar Report
   */
  static async getCalendarReportEvents(schoolId, { startDate = '', endDate = '', year = '', month = '' }) {
    let sDate = startDate;
    let eDate = endDate;

    if (!sDate || !eDate) {
      const y = Number(year) || new Date().getFullYear();
      const m = Number(month) || new Date().getMonth() + 1;
      const days = new Date(y, m, 0).getDate();
      sDate = `${y}-${String(m).padStart(2, '0')}-01 00:00:00`;
      eDate = `${y}-${String(m).padStart(2, '0')}-${days} 23:59:59`;
    }

    const events = [];

    // 1. School Events
    try {
      const [evList] = await pool.query(
        `SELECT id, title, from_date, to_date, details 
         FROM event 
         WHERE school_id = ? AND status = 1 
           AND ((from_date BETWEEN ? AND ?) OR (to_date BETWEEN ? AND ?) OR (from_date <= ? AND to_date >= ?))`,
        [schoolId, sDate, eDate, sDate, eDate, sDate, eDate]
      );
      for (const ev of evList) {
        events.push({
          id: `event-${ev.id}`,
          title: ev.title,
          start: ev.from_date,
          end: ev.to_date,
          details: ev.details,
          type: 'event',
          className: 'bg-primary-transparent border-primary text-primary',
          badgeColor: 'bg-primary',
        });
      }
    } catch (e) {
      console.error('Error fetching school events:', e);
    }

    // 2. Holidays
    try {
      const [holList] = await pool.query(
        `SELECT id, title, from_date, to_date, details 
         FROM holiday 
         WHERE school_id = ? AND status = 1 
           AND ((from_date BETWEEN ? AND ?) OR (to_date BETWEEN ? AND ?) OR (from_date <= ? AND to_date >= ?))`,
        [schoolId, sDate, eDate, sDate, eDate, sDate, eDate]
      );
      for (const hol of holList) {
        events.push({
          id: `holiday-${hol.id}`,
          title: hol.title,
          start: hol.from_date,
          end: hol.to_date,
          details: hol.details,
          type: 'holiday',
          className: 'bg-danger-transparent border-danger text-danger',
          badgeColor: 'bg-danger',
        });
      }
    } catch (e) {
      console.error('Error fetching holidays:', e);
    }

    // 3. Exam Schedules
    try {
      const [examList] = await pool.query(
        `SELECT es.id, em.exam, cm.class_name, sub.subject_name, es.date, es.start_time, es.end_time
         FROM exam_schedule es
         JOIN exam_master em ON es.exam_id = em.id
         LEFT JOIN class_master cm ON es.class_id = cm.id
         LEFT JOIN subject_master sub ON es.subject_id = sub.id
         WHERE es.school_id = ? AND es.status = 1 AND es.date BETWEEN ? AND ?`,
        [schoolId, sDate.substring(0, 10), eDate.substring(0, 10)]
      );
      for (const ex of examList) {
        const title = `${ex.exam || 'Exam'}: ${ex.subject_name || 'Subject'} (${ex.class_name ? 'Class ' + ex.class_name : ''})`;
        const startTime = ex.start_time ? ` ${ex.start_time}` : ' 09:00:00';
        const endTime = ex.end_time ? ` ${ex.end_time}` : ' 12:00:00';
        events.push({
          id: `exam-${ex.id}`,
          title,
          start: `${ex.date}${startTime}`,
          end: `${ex.date}${endTime}`,
          details: `Exam: ${ex.exam || ''} | Subject: ${ex.subject_name || ''} | Class: ${ex.class_name || ''} | Time: ${ex.start_time || ''} - ${ex.end_time || ''}`,
          type: 'exam',
          className: 'bg-warning-transparent border-warning text-warning',
          badgeColor: 'bg-warning',
        });
      }
    } catch (e) {
      console.error('Error fetching exam schedule:', e);
    }

    return events;
  }
}

module.exports = ReportModel;
