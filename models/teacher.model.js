const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');

const parsePostalCode = (val) => {
  if (val === null || val === undefined || val === '') return null;
  const cleaned = String(val).replace(/\D/g, '');
  return cleaned ? parseInt(cleaned, 10) : null;
};

class TeacherModel {
  static async getAllTeachers(schoolId, { search = '', email = '', status = '', branchId = null, limit = 12, offset = 0 } = {}) {
    let sql = `
      SELECT t.*, 
        bm.branch_name, bm.branch_code,
        c.class_name, sec.section_name, 
        COALESCE(g.gender, IF(t.gender = '2' OR t.gender = 2, 'Female', IF(t.gender = '3' OR t.gender = 3, 'Others', 'Male'))) AS gender_name,
        (
          SELECT GROUP_CONCAT(DISTINCT cm.class_name ORDER BY cm.id ASC SEPARATOR ', ')
          FROM teacher_class_assign tca
          JOIN class_master cm ON tca.class_id = cm.id
          WHERE tca.teacher_id = t.id AND (tca.status = 1 OR tca.status = '1') AND cm.status != 4
        ) AS assigned_classes,
        (
          SELECT GROUP_CONCAT(DISTINCT sm.subject_name ORDER BY sm.id ASC SEPARATOR ', ')
          FROM teacher_class_assign tca
          JOIN subject_master sm ON tca.subject_id = sm.id
          WHERE tca.teacher_id = t.id AND (tca.status = 1 OR tca.status = '1') AND sm.status != 4
        ) AS assigned_subjects,
        COALESCE(sub.subject_name, (
          SELECT sm.subject_name FROM teacher_class_assign tca 
          JOIN subject_master sm ON tca.subject_id = sm.id 
          WHERE tca.teacher_id = t.id AND tca.status != 4 AND sm.status != 4
          ORDER BY tca.id ASC LIMIT 1
        )) AS subject_name 
      FROM teacher_master t
      LEFT JOIN branch_master bm ON t.branch_id = bm.id
      LEFT JOIN class_master c ON t.class = c.id
      LEFT JOIN section_master sec ON t.section = sec.id
      LEFT JOIN subject_master sub ON t.subject = sub.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (t.gender = '1' OR t.gender = 1 OR LOWER(CAST(t.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (t.gender = '2' OR t.gender = 2 OR LOWER(CAST(t.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (t.gender = '3' OR t.gender = 3 OR LOWER(CAST(t.gender AS CHAR)) IN ('other', 'others')))
      )
      WHERE t.school_id = ? AND t.status != 4
    `;

    const params = [schoolId];

    if (branchId) {
      sql += ` AND t.branch_id = ?`;
      params.push(Number(branchId));
    }

    if (String(status) === '1') {
      sql += ` AND t.status = 1`;
    } else if (String(status) === '2' || String(status).toLowerCase() === 'inactive') {
      sql += ` AND t.status = 2`;
    }

    if (search) {
      const trimmedSearch = search.trim();
      const searchParam = `%${trimmedSearch}%`;
      const searchClean = trimmedSearch.replace(/[\s\-+()]+/g, '');
      const searchCleanParam = `%${searchClean}%`;
      const words = trimmedSearch.split(/\s+/).filter(Boolean);

      const baseConditions = [
        `t.first_name LIKE ?`,
        `t.last_name LIKE ?`,
        `CONCAT(TRIM(COALESCE(t.first_name, '')), ' ', TRIM(COALESCE(t.last_name, ''))) LIKE ?`,
        `CONCAT(TRIM(COALESCE(t.last_name, '')), ' ', TRIM(COALESCE(t.first_name, ''))) LIKE ?`,
        `CONCAT(REPLACE(COALESCE(t.first_name, ''), ' ', ''), REPLACE(COALESCE(t.last_name, ''), ' ', '')) LIKE ?`,
        `t.teacher_id LIKE ?`,
        `t.primary_contact_number LIKE ?`,
        `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(t.primary_contact_number, ''), ' ', ''), '-', ''), '+', ''), '(', '') LIKE ?`,
        `t.email_address LIKE ?`,
        `c.class_name LIKE ?`,
        `sec.section_name LIKE ?`,
        `sub.subject_name LIKE ?`
      ];

      params.push(
        searchParam,
        searchParam,
        searchParam,
        searchParam,
        searchCleanParam,
        searchParam,
        searchParam,
        searchCleanParam,
        searchParam,
        searchParam,
        searchParam,
        searchParam
      );

      const numOnly = trimmedSearch.replace(/^(CPS|#|ID)0*/i, '');
      if (numOnly && /^\d+$/.test(numOnly)) {
        baseConditions.push(`CAST(t.id AS CHAR) = ?`);
        params.push(numOnly);
      }

      if (words.length > 1) {
        const wordClauses = words.map(() => `(
          t.first_name LIKE ? 
          OR t.last_name LIKE ? 
          OR t.teacher_id LIKE ? 
          OR t.email_address LIKE ? 
          OR t.primary_contact_number LIKE ?
          OR c.class_name LIKE ?
          OR sec.section_name LIKE ?
          OR sub.subject_name LIKE ?
        )`);
        sql += ` AND (${baseConditions.join(' OR ')} OR (${wordClauses.join(' AND ')}))`;
        for (const w of words) {
          const wp = `%${w}%`;
          params.push(wp, wp, wp, wp, wp, wp, wp, wp);
        }
      } else {
        sql += ` AND (${baseConditions.join(' OR ')})`;
      }
    }

    if (email) {
      sql += ` AND t.email_address LIKE ?`;
      params.push(`%${email.trim()}%`);
    }

    // Direct count query
    let countSql = `
      SELECT COUNT(*) AS total
      FROM teacher_master t
      LEFT JOIN class_master c ON t.class = c.id
      LEFT JOIN section_master sec ON t.section = sec.id
      LEFT JOIN subject_master sub ON t.subject = sub.id
      WHERE t.school_id = ? AND t.status != 4
    `;
    const countParams = [schoolId];

    if (String(status) === '1') {
      countSql += ` AND t.status = 1`;
    } else if (String(status) === '2' || String(status).toLowerCase() === 'inactive') {
      countSql += ` AND t.status = 2`;
    }

    if (search) {
      const trimmedSearch = search.trim();
      const searchParam = `%${trimmedSearch}%`;
      const searchClean = trimmedSearch.replace(/[\s\-+()]+/g, '');
      const searchCleanParam = `%${searchClean}%`;
      const words = trimmedSearch.split(/\s+/).filter(Boolean);

      const baseConditions = [
        `t.first_name LIKE ?`,
        `t.last_name LIKE ?`,
        `CONCAT(TRIM(COALESCE(t.first_name, '')), ' ', TRIM(COALESCE(t.last_name, ''))) LIKE ?`,
        `CONCAT(TRIM(COALESCE(t.last_name, '')), ' ', TRIM(COALESCE(t.first_name, ''))) LIKE ?`,
        `CONCAT(REPLACE(COALESCE(t.first_name, ''), ' ', ''), REPLACE(COALESCE(t.last_name, ''), ' ', '')) LIKE ?`,
        `t.teacher_id LIKE ?`,
        `t.primary_contact_number LIKE ?`,
        `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(t.primary_contact_number, ''), ' ', ''), '-', ''), '+', ''), '(', '') LIKE ?`,
        `t.email_address LIKE ?`,
        `c.class_name LIKE ?`,
        `sec.section_name LIKE ?`,
        `sub.subject_name LIKE ?`
      ];

      countParams.push(
        searchParam,
        searchParam,
        searchParam,
        searchParam,
        searchCleanParam,
        searchParam,
        searchParam,
        searchCleanParam,
        searchParam,
        searchParam,
        searchParam,
        searchParam
      );

      const numOnly = trimmedSearch.replace(/^(CPS|#|ID)0*/i, '');
      if (numOnly && /^\d+$/.test(numOnly)) {
        baseConditions.push(`CAST(t.id AS CHAR) = ?`);
        countParams.push(numOnly);
      }

      if (words.length > 1) {
        const wordClauses = words.map(() => `(
          t.first_name LIKE ? 
          OR t.last_name LIKE ? 
          OR t.teacher_id LIKE ? 
          OR t.email_address LIKE ? 
          OR t.primary_contact_number LIKE ?
          OR c.class_name LIKE ?
          OR sec.section_name LIKE ?
          OR sub.subject_name LIKE ?
        )`);
        countSql += ` AND (${baseConditions.join(' OR ')} OR (${wordClauses.join(' AND ')}))`;
        for (const w of words) {
          const wp = `%${w}%`;
          countParams.push(wp, wp, wp, wp, wp, wp, wp, wp);
        }
      } else {
        countSql += ` AND (${baseConditions.join(' OR ')})`;
      }
    }

    if (email) {
      countSql += ` AND t.email_address LIKE ?`;
      countParams.push(`%${email.trim()}%`);
    }

    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0] ? countRows[0].total : 0;

    sql += ` ORDER BY t.id DESC LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(sql, [...params, Number(limit), Number(offset)]);

    const teacherIds = (rows || []).map((r) => r.id);
    let classAssignMap = {};
    if (teacherIds.length > 0) {
      try {
        const [assignRows] = await pool.query(
          `SELECT tca.*, cm.class_name, sm.subject_name
           FROM teacher_class_assign tca
           LEFT JOIN class_master cm ON tca.class_id = cm.id
           LEFT JOIN subject_master sm ON tca.subject_id = sm.id
           WHERE tca.teacher_id IN (?) AND (tca.status = 1 OR tca.status = '1') AND (cm.status IS NULL OR cm.status != 4)
           ORDER BY tca.id ASC`,
          [teacherIds]
        );
        for (const a of assignRows) {
          if (!classAssignMap[a.teacher_id]) {
            classAssignMap[a.teacher_id] = [];
          }
          classAssignMap[a.teacher_id].push(a);
        }
      } catch (err) {
        console.warn('Could not fetch class assignments for teachers:', err);
      }
    }

    const teachers = (rows || []).map((t) => {
      const rawGender = t.gender;
      const genderId = (rawGender === '2' || rawGender === 2 || String(rawGender).toLowerCase().includes('fem'))
        ? 2
        : (rawGender === '3' || rawGender === 3 || String(rawGender).toLowerCase().includes('oth'))
        ? 3
        : 1;

      const myAssignments = classAssignMap[t.id] || [];
      const distinctClasses = [...new Set(myAssignments.map((a) => a.class_name).filter(Boolean))];
      const assignedClassesStr = distinctClasses.length > 0
        ? distinctClasses.join(', ')
        : (t.assigned_classes || t.class_name || '');

      return {
        ...t,
        gender_id: genderId,
        gender: genderId,
        gender_name: genderId === 2 ? 'Female' : genderId === 3 ? 'Others' : 'Male',
        class_assignments: myAssignments,
        assigned_classes: assignedClassesStr,
        assigned_classes_list: distinctClasses.length > 0 ? distinctClasses : (t.class_name ? [t.class_name] : []),
      };
    });

    return { teachers, total };
  }

  static async getTeacherById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT 
        t.*,
        bm.branch_name,
        bm.branch_code,
        c.class_name,
        sec.section_name,
        COALESCE(sub.subject_name, (
          SELECT sm.subject_name FROM teacher_class_assign tca 
          JOIN subject_master sm ON tca.subject_id = sm.id 
          WHERE tca.teacher_id = t.id AND tca.status != 4 AND sm.status != 4
          ORDER BY tca.id ASC LIMIT 1
        )) AS subject_name,
        COALESCE(g.gender, IF(t.gender = '2' OR t.gender = 2, 'Female', IF(t.gender = '3' OR t.gender = 3, 'Others', 'Male'))) AS gender_name,
        COALESCE(bg.blood_group, 'N/A') AS blood_group_name,
        COALESCE(mm.marital_status, IF(t.marital_status = '1' OR t.marital_status = 1, 'Single', IF(t.marital_status = '2' OR t.marital_status = 2, 'Married', 'N/A'))) AS marital_status_name
       FROM teacher_master t
       LEFT JOIN branch_master bm ON t.branch_id = bm.id
       LEFT JOIN class_master c ON t.class = c.id
       LEFT JOIN section_master sec ON t.section = sec.id
       LEFT JOIN subject_master sub ON t.subject = sub.id
       LEFT JOIN gender_master g ON (
         (g.id = 1 AND (t.gender = '1' OR t.gender = 1 OR LOWER(CAST(t.gender AS CHAR)) = 'male')) OR
         (g.id = 2 AND (t.gender = '2' OR t.gender = 2 OR LOWER(CAST(t.gender AS CHAR)) = 'female')) OR
         (g.id = 3 AND (t.gender = '3' OR t.gender = 3 OR LOWER(CAST(t.gender AS CHAR)) IN ('other', 'others')))
       )
        LEFT JOIN blood_group_master bg ON (
          t.blood_group = bg.id OR
          CAST(t.blood_group AS CHAR) = CAST(bg.id AS CHAR) OR
          (t.blood_group NOT IN ('0', 0, '') AND CAST(t.blood_group AS CHAR) COLLATE utf8mb4_unicode_ci = bg.blood_group)
        )
        LEFT JOIN marital_master mm ON (
          t.marital_status = mm.id OR
          CAST(t.marital_status AS CHAR) = CAST(mm.id AS CHAR) OR
          (t.marital_status NOT IN ('0', 0, '') AND CAST(t.marital_status AS CHAR) COLLATE utf8mb4_unicode_ci = mm.marital_status)
        )
       WHERE t.id = ? AND t.school_id = ? AND t.status != 4
       LIMIT 1`,
      [id, schoolId]
    );
    const teacher = rows[0] || null;
    if (!teacher) return null;

    const rawGender = teacher.gender;
    const genderId = (rawGender === '2' || rawGender === 2 || String(rawGender).toLowerCase().includes('fem'))
      ? 2
      : (rawGender === '3' || rawGender === 3 || String(rawGender).toLowerCase().includes('oth'))
      ? 3
      : 1;
    teacher.gender_id = genderId;
    teacher.gender = genderId;
    teacher.gender_name = genderId === 2 ? 'Female' : genderId === 3 ? 'Others' : 'Male';

    // Fetch Address Details
    try {
      const [addrRows] = await pool.query(
        `SELECT ta.*, co.name AS country_name, st.state AS state_name, cit.name AS city_name
         FROM teacher_address ta
         LEFT JOIN countries co ON ta.country = co.id
         LEFT JOIN states st ON ta.state = st.id_state
         LEFT JOIN cities cit ON ta.city = cit.id
         WHERE ta.teacher_id = ? AND ta.school_id = ?
         ORDER BY ta.id DESC LIMIT 1`,
        [id, schoolId]
      );
      teacher.address_info = addrRows[0] || null;
    } catch {
      teacher.address_info = null;
    }

    // Fetch Bank Details
    try {
      const [bankRows] = await pool.query(
        `SELECT * FROM teacher_bank WHERE teacher_id = ? AND school_id = ? LIMIT 1`,
        [id, schoolId]
      );
      teacher.bank_info = bankRows[0] || null;
    } catch {
      teacher.bank_info = null;
    }

    // Fetch Payroll & Work Details
    try {
      const [payrollRows] = await pool.query(
        `SELECT tp.*, sm.shift_name, ctm.contract_type AS contract_type_name
         FROM teacher_payroll tp
         LEFT JOIN shift_master sm ON tp.work_shift = sm.id
         LEFT JOIN contract_type_master ctm ON tp.contract_type = ctm.id
         WHERE tp.teacher_id = ? AND tp.school_id = ?
         ORDER BY tp.id DESC LIMIT 1`,
        [id, schoolId]
      );
      teacher.payroll_info = payrollRows[0] || null;
    } catch {
      teacher.payroll_info = null;
    }

    // Fetch Class Assignments
    try {
      const [classAssignRows] = await pool.query(
        `SELECT tca.*, cm.class_name, sm.subject_name
         FROM teacher_class_assign tca
         LEFT JOIN class_master cm ON tca.class_id = cm.id
         LEFT JOIN subject_master sm ON tca.subject_id = sm.id
         WHERE tca.teacher_id = ? AND tca.school_id = ? AND (tca.status = 1 OR tca.status = '1') AND (cm.status IS NULL OR cm.status != 4)
         ORDER BY tca.id ASC`,
        [id, schoolId]
      );
      teacher.class_assignments = classAssignRows || [];
      const distinctClasses = [...new Set((classAssignRows || []).map((a) => a.class_name).filter(Boolean))];
      teacher.assigned_classes = distinctClasses.length > 0 ? distinctClasses.join(', ') : (teacher.class_name || '');
      teacher.assigned_classes_list = distinctClasses.length > 0 ? distinctClasses : (teacher.class_name ? [teacher.class_name] : []);
    } catch {
      teacher.class_assignments = [];
      teacher.assigned_classes = teacher.class_name || '';
      teacher.assigned_classes_list = teacher.class_name ? [teacher.class_name] : [];
    }

    // Fetch Social Media Links
    try {
      const [socialRows] = await pool.query(
        `SELECT * FROM teacher_social_link WHERE teacher_id = ? AND school_id = ? LIMIT 1`,
        [id, schoolId]
      );
      teacher.social_info = socialRows[0] || null;
    } catch {
      teacher.social_info = null;
    }

    // Fetch Uploaded Documents
    try {
      const [docRows] = await pool.query(
        `SELECT td.*, dtm.document_type_name
         FROM teacher_document td
         LEFT JOIN document_type_master dtm ON td.document_type = dtm.id
         WHERE td.teacher_id = ? AND td.status != 0`,
        [id]
      );
      teacher.documents = (docRows || []).map((doc) => {
        let attachment = (doc.attachments || '').trim();
        let fileUrl = '';
        if (attachment) {
          if (attachment.startsWith('http://') || attachment.startsWith('https://') || attachment.startsWith('data:')) {
            fileUrl = attachment;
          } else {
            const clean = attachment.replace(/^\//, '');
            if (clean.startsWith('upload/')) {
              fileUrl = `/${clean}`;
            } else if (clean.startsWith('teacher/')) {
              fileUrl = `/upload/${clean}`;
            } else {
              fileUrl = `/upload/teacher/attachment/${clean}`;
            }
          }
        }
        return {
          ...doc,
          file_url: fileUrl,
        };
      });
    } catch {
      teacher.documents = [];
    }

    // Fetch Transport Details
    try {
      const [transRows] = await pool.query(
        `SELECT tt.*, trm.transport_route, bm.name AS bus_name, COALESCE(bm.number_plate, tt.vehicle_number) AS bus_number
         FROM teacher_transport tt
         LEFT JOIN trans_route_master trm ON tt.route = trm.id
         LEFT JOIN bus_master bm ON trm.bus_id = bm.id
         WHERE tt.teacher_id = ? AND tt.school_id = ?
         LIMIT 1`,
        [id, schoolId]
      );
      teacher.transport_info = transRows[0] || null;
    } catch {
      teacher.transport_info = null;
    }

    // Fetch Hostel Details
    try {
      const [hostelRows] = await pool.query(
        `SELECT th.*, hnm.hostel_name AS hostel_name_label, hrm.room_number AS room_number_name
         FROM teacher_hostel th
         LEFT JOIN hostel_name_master hnm ON th.hostel_name = hnm.id
         LEFT JOIN hostel_room_master hrm ON th.room_number = hrm.id
         WHERE th.teacher_id = ? AND th.school_id = ?
         LIMIT 1`,
        [id, schoolId]
      );
      teacher.hostel_info = hostelRows[0] || null;
    } catch {
      teacher.hostel_info = null;
    }

    // Fetch Leave Types & Quotas (Role 1 = Teacher)
    try {
      const [leaveMasters] = await pool.query(
        `SELECT * FROM leave_master WHERE (school_id = ? OR ? IS NULL) AND role = 1 AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [teacher.school_id, teacher.school_id]
      );

      const [usedLeaves] = await pool.query(
        `SELECT l.leave_id, COUNT(ld.id) AS used_count, SUM(l.duration) AS total_duration
         FROM leaves l
         LEFT JOIN leaves_date ld ON ld.staff_leave_id = l.id
         WHERE l.staff_id = ? AND (l.school_id = ? OR ? IS NULL) AND l.role = 1 AND l.status = 1
         GROUP BY l.leave_id`,
        [id, teacher.school_id, teacher.school_id]
      );

      const usedMap = {};
      (usedLeaves || []).forEach((u) => {
        usedMap[u.leave_id] = Number(u.used_count || u.total_duration || 0);
      });

      teacher.leave_types = (leaveMasters || []).map((lm) => {
        const used = usedMap[lm.id] || 0;
        const total = Number(lm.no_leave || 0);
        const available = Math.max(0, total - used);
        return {
          id: lm.id,
          leave_name: lm.leave_name,
          total_leaves: total,
          used_leaves: used,
          available_leaves: available,
        };
      });
    } catch {
      teacher.leave_types = [];
    }

    // Fetch Applied Leaves List
    try {
      const [leaveRows] = await pool.query(
        `SELECT l.*, lm.leave_name
         FROM leaves l
         LEFT JOIN leave_master lm ON l.leave_id = lm.id
         WHERE (l.staff_id = ? OR l.staff_id = ?) AND l.role = 1
         ORDER BY l.id DESC LIMIT 50`,
        [id, teacher.teacher_id || '']
      );

      const formattedLeaves = [];
      for (const l of leaveRows || []) {
        const [dateRows] = await pool.query(
          `SELECT * FROM leaves_date WHERE staff_leave_id = ? ORDER BY date ASC`,
          [l.id]
        );
        const dates = dateRows || [];
        const firstDate = dates.length > 0 ? dates[0].date : l.created_at;
        const lastDate = dates.length > 0 ? dates[dates.length - 1].date : l.created_at;

        formattedLeaves.push({
          ...l,
          first_leave_date: firstDate,
          last_leave_date: lastDate,
          all_leave_date: dates.map((d) => ({
            id: d.id,
            date: d.date,
            status: Number(d.status),
          })),
        });
      }
      teacher.leave_history = formattedLeaves;
    } catch {
      teacher.leave_history = [];
    }

    // Fetch Attendance Records & Aggregate Stats
    try {
      const [attRows] = await pool.query(
        `SELECT * FROM teacher_attendance 
         WHERE (teacher_id = ? OR teacher_id = ?) 
         ORDER BY date DESC`,
        [id, teacher.teacher_id || '']
      );

      let totalPresent = 0;
      let totalAbsent = 0;
      let halfDay = 0;
      let late = 0;
      let lastUpdated = null;

      // matrix[day 1..31][month 1..12]
      const matrix = {};
      for (let d = 1; d <= 31; d++) {
        matrix[d] = {};
      }

      (attRows || []).forEach((row) => {
        if (!lastUpdated && row.date) {
          lastUpdated = row.date;
        }

        const attCode = Number(row.attendance);
        if (attCode === 1) totalPresent++;
        else if (attCode === 0) totalAbsent++;
        else if (attCode === 2) late++;
        else if (attCode === 3) halfDay++;

        if (row.date) {
          try {
            const dt = new Date(row.date);
            if (!isNaN(dt.getTime())) {
              const m = dt.getMonth() + 1; // 1 - 12
              const d = dt.getDate();      // 1 - 31
              matrix[d][m] = attCode;
            }
          } catch {}
        }
      });

      teacher.attendance_summary = {
        total_present: totalPresent,
        total_absent: totalAbsent,
        half_day: halfDay,
        late: late,
        last_updated: lastUpdated,
      };
      teacher.attendance_matrix = matrix;
    } catch {
      teacher.attendance_summary = {
        total_present: 0,
        total_absent: 0,
        half_day: 0,
        late: 0,
        last_updated: null,
      };
      teacher.attendance_matrix = {};
    }

    // Fetch Routine Schedule (Time Table)
    try {
      const [allDays] = await pool.query(
        `SELECT * FROM days_master WHERE status = 1 ORDER BY id ASC`
      );

      const [routineRows] = await pool.query(
        `SELECT r.*, cm.class_name, sm.section_name, pm.period_name, pm.start_time, pm.end_time, subm.subject_name
         FROM routine r
         LEFT JOIN class_master cm ON cm.id = r.class_id
         LEFT JOIN section_master sm ON sm.id = r.section_id
         LEFT JOIN period_master pm ON pm.id = r.period_id
         LEFT JOIN subject_master subm ON subm.id = r.subject_id
         WHERE (r.teacher_id = ? OR r.teacher_id = ?) AND (r.status != 0)
         ORDER BY r.day ASC, pm.id ASC`,
        [id, teacher.teacher_id || '']
      );

      const formatTime12 = (timeStr) => {
        if (!timeStr) return '';
        const parts = String(timeStr).split(':');
        let h = parseInt(parts[0], 10);
        const mm = parts[1] || '00';
        if (isNaN(h)) return timeStr;
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        return `${String(h).padStart(2, '0')}:${mm} ${ampm}`;
      };

      teacher.routine_schedule = (allDays || []).map((day) => {
        const dayClasses = (routineRows || [])
          .filter((r) => Number(r.day) === Number(day.id))
          .map((r) => ({
            id: r.id,
            period_name: r.period_name || '1st Period',
            class_name: r.class_name || '',
            section_name: r.section_name || '',
            subject_name: r.subject_name || '',
            start_time: r.start_time,
            end_time: r.end_time,
            time_range:
              r.start_time && r.end_time
                ? `${formatTime12(r.start_time)} - ${formatTime12(r.end_time)}`
                : '',
          }));

        return {
          day_id: day.id,
          day_name: day.day_name,
          classes: dayClasses,
        };
      });
    } catch {
      teacher.routine_schedule = [];
    }

    return teacher;
  }

  static async getTeacherOptions(schoolId) {
    try {
      const [academicYears] = await pool.query(
        `SELECT id, start_date, end_date, is_current FROM academic_year_master WHERE status = 1 AND school_id = ? ORDER BY id DESC`,
        [schoolId]
      );
      const [classes] = await pool.query(
        `SELECT id, class_name FROM class_master WHERE status = 1 AND school_id = ? ORDER BY id ASC`,
        [schoolId]
      );
      const [genders] = await pool.query(`SELECT id, gender FROM gender_master`);
      const [bloodGroups] = await pool.query(`SELECT id, blood_group FROM blood_group_master`);
      const [maritalStatuses] = await pool.query(`SELECT id, marital_status FROM marital_master WHERE status = 1`);
      const [contractTypes] = await pool.query(`SELECT id, contract_type FROM contract_type_master`);
      const [workShifts] = await pool.query(`SELECT id, shift_name FROM shift_master WHERE status = 1 AND school_id = ?`, [schoolId]);
      const [transportRoutes] = await pool.query(
        `SELECT id, transport_route FROM trans_route_master WHERE status = 1 AND school_id = ?`,
        [schoolId]
      );
      const [hostels] = await pool.query(
        `SELECT id, hostel_name FROM hostel_name_master WHERE status = 1 AND school_id = ?`,
        [schoolId]
      );
      const [documentTypes] = await pool.query(
        `SELECT id, document_type_name FROM document_type_master WHERE school_id = ?`,
        [schoolId]
      );
      const [countries] = await pool.query(`SELECT id, name, name AS country, name AS country_name, shortname, phonecode FROM countries WHERE status = 1 OR status IS NULL ORDER BY name ASC`);

      return {
        academic_years: academicYears || [],
        classes: classes || [],
        genders: genders || [],
        blood_groups: bloodGroups || [],
        marital_statuses: maritalStatuses || [],
        contract_types: contractTypes || [],
        work_shifts: workShifts || [],
        transport_routes: transportRoutes || [],
        hostels: hostels || [],
        document_types: documentTypes || [],
        countries: countries || [],
      };
    } catch (error) {
      console.error('Error fetching teacher options:', error);
      throw error;
    }
  }

  static async checkEmail(schoolId, email, excludeId = null) {
    if (!email || !String(email).trim()) return false;
    let sql = `SELECT id FROM teacher_master WHERE email_address = ? AND school_id = ? AND status != 4`;
    const params = [String(email).trim(), schoolId];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return rows.length > 0;
  }

  static async checkPhone(schoolId, phone, excludeId = null) {
    if (!phone || !String(phone).trim()) return false;
    let sql = `SELECT id FROM teacher_master WHERE primary_contact_number = ? AND school_id = ? AND status != 4`;
    const params = [String(phone).trim(), schoolId];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return rows.length > 0;
  }

  static async checkDuplicate(schoolId, { email, phone }, excludeId = null) {
    const isEmailDuplicate = email ? await TeacherModel.checkEmail(schoolId, email, excludeId) : false;
    const isPhoneDuplicate = phone ? await TeacherModel.checkPhone(schoolId, phone, excludeId) : false;
    return { isEmailDuplicate, isPhoneDuplicate };
  }

  static async createTeacher(schoolId, data) {
    const {
      picture,
      academic_year,
      teacher_id,
      first_name,
      last_name,
      class_id,
      section_id,
      subject,
      subject_id,
      gender = 1,
      primary_contact_number,
      email_address,
      blood_group,
      date_of_joining,
      father_name,
      mother_name,
      date_of_birth,
      marital_status,
      language_known,
      qualification,
      work_experience,
      previous_school_name,
      previous_school_address,
      previous_school_phone,
      pan_number,
      status = 1,
      notes,
      take_attendance = 2,
      password,
      // Address
      current_address,
      permanent_address,
      same_permanent = 1,
      // Class Assign
      class_assignments = [],
      // Payroll
      payroll,
      // Bank
      bank,
      // Transport
      transport,
      // Hostel
      hostel,
      // Social
      social,
      // Documents
      documents = [],
    } = data;

    const primarySubject = subject || subject_id || (class_assignments && class_assignments[0]?.subject_id ? class_assignments[0].subject_id : null);

    if (email_address && String(email_address).trim()) {
      const isEmailDup = await TeacherModel.checkEmail(schoolId, email_address);
      if (isEmailDup) {
        const err = new Error('A teacher with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (primary_contact_number && String(primary_contact_number).trim()) {
      const isPhoneDup = await TeacherModel.checkPhone(schoolId, primary_contact_number);
      if (isPhoneDup) {
        const err = new Error('A teacher with this mobile number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    const hashedPassword = password ? await hashPassword(password) : null;

    // Resolve branch_id if provided or default to main branch for the school
    let branchId = data.branch_id ? Number(data.branch_id) : null;
    if (!branchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND is_main_branch = 1 LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) branchId = mainB[0].id;
      } catch (bErr) {}
    }

    const [result] = await pool.query(
      `INSERT INTO teacher_master 
       (school_id, branch_id, picture, academic_year, teacher_id, first_name, last_name, class, section, subject,
        gender, primary_contact_number, email_address, blood_group, date_of_joining, father_name, mother_name,
        date_of_birth, marital_status, language_known, qualification, work_experience, previous_school_name, 
        previous_school_address, previous_school_phone, pan_number, status, notes, 
        take_attendance, password, created_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        schoolId,
        branchId,
        picture || null,
        academic_year || null,
        teacher_id || `TCH${Math.floor(100000 + Math.random() * 900000)}`,
        first_name,
        last_name,
        class_id || null,
        section_id || null,
        primarySubject || null,
        gender,
        primary_contact_number,
        email_address,
        blood_group || null,
        date_of_joining || null,
        father_name || null,
        mother_name || null,
        date_of_birth || null,
        marital_status || null,
        language_known || null,
        qualification || 'B.Ed',
        work_experience || null,
        previous_school_name || null,
        previous_school_address || null,
        previous_school_phone || null,
        pan_number || null,
        status,
        notes || null,
        take_attendance,
        hashedPassword,
      ]
    );
    const newId = result.insertId;

    // 1. Insert Address
    if (current_address) {
      try {
        await pool.query(
          `INSERT INTO teacher_address 
           (school_id, teacher_id, address1, address2, country, state, city, postal_code, same_permanent, address_type, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
          [
            schoolId,
            newId,
            current_address.address1 || '',
            current_address.address2 || '',
            current_address.country || null,
            current_address.state || null,
            current_address.city || null,
            parsePostalCode(current_address.postal_code),
            same_permanent ? 1 : 0,
          ]
        );

        if (!same_permanent && permanent_address) {
          await pool.query(
            `INSERT INTO teacher_address 
             (school_id, teacher_id, address1, address2, country, state, city, postal_code, same_permanent, address_type, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 2, 2)`,
            [
              schoolId,
              newId,
              permanent_address.address1 || '',
              permanent_address.address2 || '',
              permanent_address.country || null,
              permanent_address.state || null,
              permanent_address.city || null,
              parsePostalCode(permanent_address.postal_code),
            ]
          );
        }
      } catch (addrErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_address:', addrErr.message);
      }
    }

    // 2. Insert Class Assignments
    if (Array.isArray(class_assignments) && class_assignments.length > 0) {
      try {
        const assignStatus = Number(status) === 2 ? 4 : 1;
        for (const item of class_assignments) {
          if (item.class_id) {
            await pool.query(
              `INSERT INTO teacher_class_assign (school_id, teacher_id, class_id, subject_id, academic_year, status)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [schoolId, newId, item.class_id, item.subject_id || 0, academic_year || null, assignStatus]
            );
          }
        }
      } catch (assignErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_class_assign:', assignErr.message);
      }
    }

    // 3. Insert Payroll
    if (payroll && (payroll.epf_no || payroll.basic_salary || payroll.contract_type)) {
      try {
        await pool.query(
          `INSERT INTO teacher_payroll 
           (school_id, teacher_id, academic_year, epf_no, basic_salary, contract_type, work_shift, work_location, date_of_leaving, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            schoolId,
            newId,
            academic_year || null,
            payroll.epf_no || '',
            payroll.basic_salary || 0,
            payroll.contract_type || null,
            payroll.work_shift || null,
            payroll.work_location || '',
            payroll.date_of_leaving ? new Date(payroll.date_of_leaving) : null,
          ]
        );
      } catch (payrollErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_payroll:', payrollErr.message);
      }
    }

    // 4. Insert Bank Account
    if (bank && (bank.account_name || bank.account_number || bank.bank_name)) {
      try {
        await pool.query(
          `INSERT INTO teacher_bank 
           (school_id, teacher_id, academic_year, account_name, account_number, bank_name, ifsc_code, branch_name, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            schoolId,
            newId,
            academic_year || null,
            bank.account_name || '',
            bank.account_number || '',
            bank.bank_name || '',
            bank.ifsc_code || '',
            bank.branch_name || '',
          ]
        );
      } catch (bankErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_bank:', bankErr.message);
      }
    }

    // 5. Insert Transport
    if (transport && transport.route) {
      try {
        await pool.query(
          `INSERT INTO teacher_transport 
           (school_id, teacher_id, academic_year, route, vehicle_number, pickup_point, drop_point, staus)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            schoolId,
            newId,
            academic_year || null,
            transport.route,
            transport.vehicle_number || 0,
            transport.pickup_point || '',
            transport.drop_point || '',
          ]
        );
      } catch (transErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_transport:', transErr.message);
      }
    }

    // 6. Insert Hostel
    if (hostel && hostel.hostel_name) {
      try {
        await pool.query(
          `INSERT INTO teacher_hostel 
           (school_id, teacher_id, academic_year, hostel_name, room_number, status)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [
            schoolId,
            newId,
            academic_year || null,
            hostel.hostel_name,
            hostel.room_number || null,
          ]
        );
      } catch (hostelErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_hostel:', hostelErr.message);
      }
    }

    // 7. Insert Social Links
    if (social) {
      try {
        await pool.query(
          `INSERT INTO teacher_social_link 
           (school_id, teacher_id, academic_year, facebook_link, instagram_link, linkedin_link, youtube_link, twitter_link, staus)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            schoolId,
            newId,
            academic_year || null,
            social.facebook_link || '',
            social.instagram_link || '',
            social.linkedin_link || '',
            social.youtube_link || '',
            social.twitter_link || '',
          ]
        );
      } catch (socialErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_social_link:', socialErr.message);
      }
    }

    // 8. Insert Documents
    if (Array.isArray(documents) && documents.length > 0) {
      try {
        for (const doc of documents) {
          if (doc.document_type || doc.attachments) {
            await pool.query(
              `INSERT INTO teacher_document 
               (school_id, teacher_id, document_type, academic_year, file_name, attachments, status)
               VALUES (?, ?, ?, ?, ?, ?, 1)`,
              [
                schoolId,
                newId,
                doc.document_type || 1,
                academic_year || null,
                doc.file_name || 'Document.pdf',
                doc.attachments || '',
              ]
            );
          }
        }
      } catch (docErr) {
        console.error('[TeacherModel.createTeacher] Error saving teacher_document:', docErr.message);
      }
    }

    return newId;
  }

  static async updateTeacher(id, schoolId, data) {
    const [existingRows] = await pool.query(
      `SELECT * FROM teacher_master WHERE id = ? AND school_id = ? LIMIT 1`,
      [id, schoolId]
    );
    if (!existingRows || existingRows.length === 0) return false;
    const existing = existingRows[0];

    const newStatus = data.status !== undefined ? Number(data.status) : existing.status;
    const isInactive = newStatus === 2 || newStatus === 0;

    const rawGender = data.gender !== undefined ? data.gender : existing.gender;
    let normalizedGender = 1;
    if (rawGender === '2' || rawGender === 2 || String(rawGender).toLowerCase().includes('fem')) {
      normalizedGender = 2;
    } else if (rawGender === '3' || rawGender === 3 || String(rawGender).toLowerCase().includes('oth')) {
      normalizedGender = 3;
    } else {
      normalizedGender = 1;
    }

    const academic_year = data.academic_year !== undefined ? data.academic_year : existing.academic_year;
    const teacher_id = data.teacher_id !== undefined ? data.teacher_id : existing.teacher_id;
    const first_name = data.first_name !== undefined ? data.first_name : existing.first_name;
    const last_name = data.last_name !== undefined ? data.last_name : existing.last_name;
    const class_id = data.class_id !== undefined ? data.class_id : (data.class !== undefined ? data.class : existing.class);
    const section_id = data.section_id !== undefined ? data.section_id : (data.section !== undefined ? data.section : (data.section_student !== undefined ? data.section_student : existing.section));
    const subject = data.subject !== undefined ? data.subject : (data.subject_id !== undefined ? data.subject_id : existing.subject);
    const primary_contact_number = data.primary_contact_number !== undefined ? data.primary_contact_number : existing.primary_contact_number;
    const email_address = data.email_address !== undefined ? data.email_address : existing.email_address;
    const blood_group = data.blood_group !== undefined ? data.blood_group : existing.blood_group;
    const date_of_joining = data.date_of_joining !== undefined ? data.date_of_joining : existing.date_of_joining;
    const father_name = data.father_name !== undefined ? data.father_name : existing.father_name;
    const mother_name = data.mother_name !== undefined ? data.mother_name : existing.mother_name;
    const date_of_birth = data.date_of_birth !== undefined ? data.date_of_birth : existing.date_of_birth;
    const marital_status = data.marital_status !== undefined ? data.marital_status : existing.marital_status;
    const language_known = data.language_known !== undefined ? data.language_known : existing.language_known;
    const qualification = data.qualification !== undefined ? data.qualification : existing.qualification;
    const work_experience = data.work_experience !== undefined ? data.work_experience : existing.work_experience;
    const previous_school_name = data.previous_school_name !== undefined ? data.previous_school_name : existing.previous_school_name;
    const previous_school_address = data.previous_school_address !== undefined ? data.previous_school_address : existing.previous_school_address;
    const previous_school_phone = data.previous_school_phone !== undefined ? data.previous_school_phone : existing.previous_school_phone;
    const pan_number = data.pan_number !== undefined ? data.pan_number : existing.pan_number;
    const notes = data.notes !== undefined ? data.notes : existing.notes;
    const take_attendance = data.take_attendance !== undefined 
      ? Number(data.take_attendance) 
      : (existing.take_attendance !== undefined ? Number(existing.take_attendance) : 2);
    const primarySubject = subject || existing.subject || (data.class_assignments && data.class_assignments[0]?.subject_id ? data.class_assignments[0].subject_id : null);

    if (email_address && String(email_address).trim()) {
      const isEmailDup = await TeacherModel.checkEmail(schoolId, email_address, id);
      if (isEmailDup) {
        const err = new Error('A teacher with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (primary_contact_number && String(primary_contact_number).trim()) {
      const isPhoneDup = await TeacherModel.checkPhone(schoolId, primary_contact_number, id);
      if (isPhoneDup) {
        const err = new Error('A teacher with this mobile number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    let updateSql = `
      UPDATE teacher_master SET 
        branch_id = COALESCE(?, branch_id),
        academic_year = ?, teacher_id = ?, first_name = ?, last_name = ?, class = ?, section = ?, subject = ?,
        gender = ?, primary_contact_number = ?, email_address = ?, blood_group = ?, 
        date_of_joining = ?, father_name = ?, mother_name = ?, date_of_birth = ?,
        marital_status = ?, language_known = ?, qualification = ?, work_experience = ?, previous_school_name = ?, 
        previous_school_address = ?, previous_school_phone = ?, pan_number = ?, status = ?, notes = ?, 
        take_attendance = ?`;

    const params = [
      data.branch_id || null,
      academic_year || null,
      teacher_id,
      first_name,
      last_name,
      class_id || null,
      section_id || null,
      primarySubject || null,
      normalizedGender,
      primary_contact_number,
      email_address,
      blood_group || null,
      date_of_joining || null,
      father_name || null,
      mother_name || null,
      date_of_birth || null,
      marital_status || null,
      language_known || null,
      qualification || 'B.Ed',
      work_experience || null,
      previous_school_name || null,
      previous_school_address || null,
      previous_school_phone || null,
      pan_number || null,
      newStatus,
      notes || null,
      take_attendance !== undefined ? take_attendance : 2,
    ];

    if (data.picture) {
      updateSql += `, picture = ?`;
      params.push(data.picture);
    }
    if (data.password) {
      updateSql += `, password = ?`;
      params.push(await hashPassword(data.password));
    }

    updateSql += ` WHERE id = ? AND school_id = ?`;
    params.push(id, schoolId);

    await pool.query(updateSql, params);

    // 1. Update Address (only if current_address is provided)
    if (data.current_address) {
      try {
        await pool.query(`DELETE FROM teacher_address WHERE teacher_id = ?`, [id]);

        await pool.query(
          `INSERT INTO teacher_address 
           (school_id, teacher_id, address1, address2, country, state, city, postal_code, same_permanent, address_type, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
          [
            schoolId,
            id,
            data.current_address.address1 || '',
            data.current_address.address2 || '',
            data.current_address.country || null,
            data.current_address.state || null,
            data.current_address.city || null,
            parsePostalCode(data.current_address.postal_code),
            data.same_permanent ? 1 : 0,
          ]
        );

        if (!data.same_permanent && data.permanent_address) {
          await pool.query(
            `INSERT INTO teacher_address 
             (school_id, teacher_id, address1, address2, country, state, city, postal_code, same_permanent, address_type, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 2, 2)`,
            [
              schoolId,
              id,
              data.permanent_address.address1 || '',
              data.permanent_address.address2 || '',
              data.permanent_address.country || null,
              data.permanent_address.state || null,
              data.permanent_address.city || null,
              parsePostalCode(data.permanent_address.postal_code),
            ]
          );
        }
      } catch (addrErr) {
        console.error('[TeacherModel.updateTeacher] Error saving teacher_address:', addrErr.message);
      }
    }

    // 2. Class Assignments Update Handling
    try {
      if (data.class_assignments !== undefined && Array.isArray(data.class_assignments)) {
        // Soft delete previous assignments (status = 4)
        await pool.query(
          `UPDATE teacher_class_assign SET status = 4 WHERE teacher_id = ? AND school_id = ?`,
          [id, schoolId]
        );

        const assignStatus = isInactive ? 2 : 1;
        for (const item of data.class_assignments) {
          if (item.class_id) {
            await pool.query(
              `INSERT INTO teacher_class_assign (school_id, teacher_id, class_id, subject_id, academic_year, status)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [schoolId, id, item.class_id, item.subject_id || 0, academic_year || null, assignStatus]
            );
          }
        }
      } else {
        // Partial update / status toggle:
        if (isInactive) {
          await pool.query(
            `UPDATE teacher_class_assign SET status = 2 WHERE teacher_id = ? AND school_id = ?`,
            [id, schoolId]
          );
        } else {
          await pool.query(
            `UPDATE teacher_class_assign SET status = 1 WHERE teacher_id = ? AND school_id = ?`,
            [id, schoolId]
          );
        }
      }
    } catch (assignErr) {
      console.error('[TeacherModel.updateTeacher] Error updating teacher_class_assign:', assignErr.message);
    }

    // 3. Update Payroll (only if payroll provided)
    if (data.payroll) {
      try {
        await pool.query(`DELETE FROM teacher_payroll WHERE teacher_id = ?`, [id]);
        if (data.payroll.epf_no || data.payroll.basic_salary || data.payroll.contract_type) {
          await pool.query(
            `INSERT INTO teacher_payroll 
             (school_id, teacher_id, academic_year, epf_no, basic_salary, contract_type, work_shift, work_location, date_of_leaving, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              schoolId,
              id,
              academic_year || null,
              data.payroll.epf_no || '',
              data.payroll.basic_salary || 0,
              data.payroll.contract_type || null,
              data.payroll.work_shift || null,
              data.payroll.work_location || '',
              data.payroll.date_of_leaving ? new Date(data.payroll.date_of_leaving) : null,
            ]
          );
        }
      } catch (payrollErr) {
        console.error('[TeacherModel.updateTeacher] Error saving teacher_payroll:', payrollErr.message);
      }
    }

    // 4. Update Bank Account (only if bank provided)
    const bankPayload = data.bank || data.bank_account;
    if (bankPayload) {
      try {
        await pool.query(`DELETE FROM teacher_bank WHERE teacher_id = ?`, [id]);
        if (bankPayload.account_name || bankPayload.account_number || bankPayload.bank_name) {
          await pool.query(
            `INSERT INTO teacher_bank 
             (school_id, teacher_id, academic_year, account_name, account_number, bank_name, ifsc_code, branch_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              schoolId,
              id,
              academic_year || null,
              bankPayload.account_name || '',
              bankPayload.account_number || '',
              bankPayload.bank_name || '',
              bankPayload.ifsc_code || '',
              bankPayload.branch_name || '',
            ]
          );
        }
      } catch (bankErr) {
        console.error('[TeacherModel.updateTeacher] Error saving teacher_bank:', bankErr.message);
      }
    }

    // 5. Update Transport (only if transport provided)
    if (data.transport) {
      try {
        await pool.query(`DELETE FROM teacher_transport WHERE teacher_id = ?`, [id]);
        if (data.transport.route) {
          await pool.query(
            `INSERT INTO teacher_transport 
             (school_id, teacher_id, academic_year, route, vehicle_number, pickup_point, drop_point, staus)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              schoolId,
              id,
              academic_year || null,
              data.transport.route,
              data.transport.vehicle_number || 0,
              data.transport.pickup_point || '',
              data.transport.drop_point || '',
            ]
          );
        }
      } catch (transErr) {
        console.error('[TeacherModel.updateTeacher] Error saving teacher_transport:', transErr.message);
      }
    }

    // 6. Update Hostel (only if hostel provided)
    if (data.hostel) {
      try {
        await pool.query(`DELETE FROM teacher_hostel WHERE teacher_id = ?`, [id]);
        if (data.hostel.hostel_name) {
          await pool.query(
            `INSERT INTO teacher_hostel 
             (school_id, teacher_id, academic_year, hostel_name, room_number, status)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [
              schoolId,
              id,
              academic_year || null,
              data.hostel.hostel_name,
              data.hostel.room_number || null,
            ]
          );
        }
      } catch (hostelErr) {
        console.error('[TeacherModel.updateTeacher] Error saving teacher_hostel:', hostelErr.message);
      }
    }

    // 7. Update Social Links (only if social provided)
    if (data.social) {
      try {
        await pool.query(`DELETE FROM teacher_social_link WHERE teacher_id = ?`, [id]);
        await pool.query(
          `INSERT INTO teacher_social_link 
           (school_id, teacher_id, academic_year, facebook_link, instagram_link, linkedin_link, youtube_link, twitter_link, staus)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            schoolId,
            id,
            academic_year || null,
            data.social.facebook_link || '',
            data.social.instagram_link || '',
            data.social.linkedin_link || '',
            data.social.youtube_link || '',
            data.social.twitter_link || '',
          ]
        );
      } catch (socialErr) {
        console.error('[TeacherModel.updateTeacher] Error saving teacher_social_link:', socialErr.message);
      }
    }

    // 8. Update Documents (only if documents provided)
    if (data.documents !== undefined && Array.isArray(data.documents)) {
      try {
        await pool.query(`DELETE FROM teacher_document WHERE teacher_id = ?`, [id]);
        for (const doc of data.documents) {
          if (doc.document_type || doc.attachments) {
            await pool.query(
              `INSERT INTO teacher_document 
               (school_id, teacher_id, document_type, academic_year, file_name, attachments, status)
               VALUES (?, ?, ?, ?, ?, ?, 1)`,
              [
                schoolId,
                id,
                doc.document_type || 1,
                academic_year || null,
                doc.file_name || 'Document.pdf',
                doc.attachments || '',
              ]
            );
          }
        }
      } catch (docErr) {
        console.error('[TeacherModel.updateTeacher] Error saving teacher_document:', docErr.message);
      }
    }

    return true;
  }

  static async findByLoginIdentifier(identifier) {
    const trimmed = String(identifier || '').trim();
    if (!trimmed) return null;

    const sql = `
      SELECT 
        t.*,
        COALESCE(c.class_name, (
          SELECT cm.class_name FROM teacher_class_assign tca 
          JOIN class_master cm ON tca.class_id = cm.id 
          WHERE tca.teacher_id = t.id AND tca.status != 4 AND cm.status != 4
          ORDER BY tca.id ASC LIMIT 1
        )) AS class_name,
        sec.section_name,
        COALESCE(sub.subject_name, (
          SELECT sm.subject_name FROM teacher_class_assign tca 
          JOIN subject_master sm ON tca.subject_id = sm.id 
          WHERE tca.teacher_id = t.id AND tca.status != 4 AND sm.status != 4
          ORDER BY tca.id ASC LIMIT 1
        )) AS subject_name,
        COALESCE(bg.blood_group, t.blood_group) AS blood_group_name,
        COALESCE(mm.marital_status, IF(t.marital_status = '1' OR t.marital_status = 1, 'Single', IF(t.marital_status = '2' OR t.marital_status = 2, 'Married', t.marital_status))) AS marital_status_name,
        sch.school_name,
        sch.school_logo,
        sch.address AS school_address,
        sch.phone_number AS school_phone,
        sch.email AS school_email
      FROM teacher_master t
      LEFT JOIN class_master c ON t.class = c.id
      LEFT JOIN section_master sec ON t.section = sec.id
      LEFT JOIN subject_master sub ON t.subject = sub.id
      LEFT JOIN school_master sch ON t.school_id = sch.id
      LEFT JOIN blood_group_master bg ON (
        t.blood_group = bg.id OR
        CAST(t.blood_group AS CHAR) = CAST(bg.id AS CHAR) OR
        (t.blood_group NOT IN ('0', 0, '') AND CAST(t.blood_group AS CHAR) COLLATE utf8mb4_unicode_ci = bg.blood_group)
      )
      LEFT JOIN marital_master mm ON (
        t.marital_status = mm.id OR
        CAST(t.marital_status AS CHAR) = CAST(mm.id AS CHAR) OR
        (t.marital_status NOT IN ('0', 0, '') AND CAST(t.marital_status AS CHAR) COLLATE utf8mb4_unicode_ci = mm.marital_status)
      )
      WHERE (t.email_address = ? OR t.teacher_id = ? OR t.primary_contact_number = ?)
        AND t.status != 4
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [trimmed, trimmed, trimmed]);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async findAuthProfileById(teacherId) {
    const sql = `
      SELECT 
        t.*,
        COALESCE(c.class_name, (
          SELECT cm.class_name FROM teacher_class_assign tca 
          JOIN class_master cm ON tca.class_id = cm.id 
          WHERE tca.teacher_id = t.id AND tca.status != 4 AND cm.status != 4
          ORDER BY tca.id ASC LIMIT 1
        )) AS class_name,
        sec.section_name,
        COALESCE(sub.subject_name, (
          SELECT sm.subject_name FROM teacher_class_assign tca 
          JOIN subject_master sm ON tca.subject_id = sm.id 
          WHERE tca.teacher_id = t.id AND tca.status != 4 AND sm.status != 4
          ORDER BY tca.id ASC LIMIT 1
        )) AS subject_name,
        COALESCE(bg.blood_group, t.blood_group) AS blood_group_name,
        COALESCE(mm.marital_status, IF(t.marital_status = '1' OR t.marital_status = 1, 'Single', IF(t.marital_status = '2' OR t.marital_status = 2, 'Married', t.marital_status))) AS marital_status_name,
        sch.school_name,
        sch.school_logo,
        sch.address AS school_address,
        sch.phone_number AS school_phone,
        sch.email AS school_email
      FROM teacher_master t
      LEFT JOIN class_master c ON t.class = c.id
      LEFT JOIN section_master sec ON t.section = sec.id
      LEFT JOIN subject_master sub ON t.subject = sub.id
      LEFT JOIN school_master sch ON t.school_id = sch.id
      LEFT JOIN blood_group_master bg ON (
        t.blood_group = bg.id OR
        CAST(t.blood_group AS CHAR) = CAST(bg.id AS CHAR) OR
        (t.blood_group NOT IN ('0', 0, '') AND CAST(t.blood_group AS CHAR) COLLATE utf8mb4_unicode_ci = bg.blood_group)
      )
      LEFT JOIN marital_master mm ON (
        t.marital_status = mm.id OR
        CAST(t.marital_status AS CHAR) = CAST(mm.id AS CHAR) OR
        (t.marital_status NOT IN ('0', 0, '') AND CAST(t.marital_status AS CHAR) COLLATE utf8mb4_unicode_ci = mm.marital_status)
      )
      WHERE t.id = ? AND t.status != 4
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [teacherId]);
    if (!rows || rows.length === 0) return null;
    const teacher = rows[0];

    // Fetch Address Details
    try {
      const [addrRows] = await pool.query(
        `SELECT ta.*, co.name AS country_name, st.state AS state_name, cit.name AS city_name
         FROM teacher_address ta
         LEFT JOIN countries co ON ta.country = co.id
         LEFT JOIN states st ON ta.state = st.id_state
         LEFT JOIN cities cit ON ta.city = cit.id
         WHERE ta.teacher_id = ?
         ORDER BY ta.id DESC LIMIT 1`,
        [teacherId]
      );
      if (addrRows && addrRows.length > 0) {
        teacher.address_info = addrRows[0];
        teacher.address1 = addrRows[0].address1 || teacher.address1 || '';
        teacher.address2 = addrRows[0].address2 || '';
        teacher.country = addrRows[0].country || null;
        teacher.country_name = addrRows[0].country_name || '';
        teacher.state = addrRows[0].state || null;
        teacher.state_name = addrRows[0].state_name || '';
        teacher.city = addrRows[0].city || null;
        teacher.city_name = addrRows[0].city_name || '';
        teacher.postal_code = addrRows[0].postal_code || '';
      }
    } catch (e) {
      console.error('Error fetching teacher address in findAuthProfileById:', e.message);
    }

    // Fetch Class Assignments from teacher_class_assign
    try {
      const [tcaRows] = await pool.query(
        `SELECT tca.*, cm.class_name, sm.subject_name
         FROM teacher_class_assign tca
         LEFT JOIN class_master cm ON tca.class_id = cm.id
         LEFT JOIN subject_master sm ON tca.subject_id = sm.id
         WHERE tca.teacher_id = ? AND tca.status != 4
         ORDER BY tca.id ASC`,
        [teacherId]
      );

      if (tcaRows && tcaRows.length > 0) {
        teacher.class_assignments = tcaRows;
        const uniqueClasses = tcaRows.map((r) => r.class_name).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
        if (uniqueClasses.length > 0) {
          teacher.class_name = uniqueClasses.join(', ');
        }
        const uniqueSubjects = tcaRows.map((r) => r.subject_name).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
        if (uniqueSubjects.length > 0) {
          teacher.subject_name = uniqueSubjects.join(', ');
        }
      }
    } catch (e) {
      console.error('Error fetching teacher class assignments in findAuthProfileById:', e.message);
    }

    return teacher;
  }

  static async deleteTeacher(id, schoolId) {
    const [result] = await pool.query(
      `UPDATE teacher_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );

    // Also soft-delete teacher class assignments
    try {
      await pool.query(
        `UPDATE teacher_class_assign SET status = 4 WHERE teacher_id = ? AND school_id = ?`,
        [id, schoolId]
      );
    } catch (e) {
      console.error('Error soft-deleting teacher class assignments:', e.message);
    }

    return result.affectedRows > 0;
  }
}

module.exports = TeacherModel;

