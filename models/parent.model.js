const { pool } = require('../config/db.config');
const { saveBase64File } = require('../utils/file.util');
const { hashPassword } = require('../utils/password.util');

class ParentModel {
  static async getAll(schoolId, { search = '', name = '', email = '', classId = '', sectionId = '', limit = 12, offset = 0 } = {}) {
    let sql = `
      SELECT 
        p.id,
        p.school_id,
        p.first_name,
        p.last_name,
        CONCAT(IFNULL(p.first_name, ''), ' ', IFNULL(p.last_name, '')) AS full_name,
        p.email,
        p.phone,
        p.occupation,
        p.relation,
        p.parent_type,
        p.picture,
        p.status,
        p.created_at,
        COUNT(DISTINCT stp.student_id) AS total_children
      FROM parent_master p
      LEFT JOIN student_to_parent stp ON (p.id = stp.father_id OR p.id = stp.mother_id OR p.id = stp.guardian_id)
      LEFT JOIN student_master s ON stp.student_id = s.id
      WHERE (p.school_id = ? OR ? IS NULL) AND p.status != 4
    `;

    const params = [schoolId, schoolId];

    if (search) {
      sql += ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam);
    }

    if (name) {
      sql += ` AND (p.first_name LIKE ? OR p.last_name LIKE ?)`;
      const nameParam = `%${name}%`;
      params.push(nameParam, nameParam);
    }

    if (email) {
      sql += ` AND p.email LIKE ?`;
      params.push(`%${email}%`);
    }

    if (classId) {
      sql += ` AND s.class = ?`;
      params.push(classId);
    }

    if (sectionId) {
      sql += ` AND s.section = ?`;
      params.push(sectionId);
    }

    sql += ` GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const [rows] = await pool.query(sql, params);

    // Get total count for pagination
    let countSql = `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM parent_master p
      LEFT JOIN student_to_parent stp ON (p.id = stp.father_id OR p.id = stp.mother_id OR p.id = stp.guardian_id)
      LEFT JOIN student_master s ON stp.student_id = s.id
      WHERE (p.school_id = ? OR ? IS NULL) AND p.status != 4
    `;
    const countParams = [schoolId, schoolId];

    if (search) {
      countSql += ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
      const searchParam = `%${search}%`;
      countParams.push(searchParam, searchParam, searchParam, searchParam);
    }

    if (name) {
      countSql += ` AND (p.first_name LIKE ? OR p.last_name LIKE ?)`;
      const nameParam = `%${name}%`;
      countParams.push(nameParam, nameParam);
    }

    if (email) {
      countSql += ` AND p.email LIKE ?`;
      params.push(`%${email}%`);
    }

    if (classId) {
      countSql += ` AND s.class = ?`;
      countParams.push(classId);
    }

    if (sectionId) {
      countSql += ` AND s.section = ?`;
      countParams.push(sectionId);
    }

    const [countRows] = await pool.query(countSql, countParams);
    const total = countRows[0]?.total || 0;

    return { parents: rows, total };
  }

  static async getById(id, schoolId) {
    const sql = `
      SELECT 
        p.*,
        CONCAT(IFNULL(p.first_name, ''), ' ', IFNULL(p.last_name, '')) AS full_name
      FROM parent_master p
      WHERE p.id = ? AND (p.school_id = ? OR ? IS NULL) AND p.status != 4
      LIMIT 1
    `;
    const [rows] = await pool.query(sql, [id, schoolId, schoolId]);
    if (!rows[0]) return null;

    const parent = rows[0];

    // Fetch linked children (students)
    const childrenSql = `
      SELECT 
        s.id AS student_id,
        s.id,
        s.admission_number,
        s.roll_number,
        s.first_name,
        s.last_name,
        CONCAT(s.first_name, ' ', s.last_name) AS full_name,
        COALESCE(g.gender, IF(s.gender = '1' OR s.gender = 1, 'Male', IF(s.gender = '2' OR s.gender = 2, 'Female', IF(s.gender = '3' OR s.gender = 3, 'Others', 'Male')))) AS gender,
        s.admission_date,
        s.created_at,
        s.status AS student_status,
        cm.class_name,
        s.class AS class_id,
        sec.section_name,
        s.section AS section_id,
        s.picture
      FROM student_to_parent stp
      JOIN student_master s ON stp.student_id = s.id
      LEFT JOIN gender_master g ON (s.gender != 0 AND (s.gender = g.id OR CAST(s.gender AS CHAR) = g.gender))
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sec ON s.section = sec.id
      WHERE (stp.father_id = ? OR stp.mother_id = ? OR stp.guardian_id = ?) 
        AND (s.school_id = ? OR ? IS NULL)
        AND s.status != 4 AND s.status != 0
      GROUP BY s.id
      ORDER BY s.id ASC
    `;
    const [children] = await pool.query(childrenSql, [id, id, id, schoolId, schoolId]);

    parent.children = children || [];
    return parent;
  }

  static async checkEmail(schoolId, email, excludeId = null) {
    if (!email || !String(email).trim()) return false;
    let sql = `SELECT id FROM parent_master WHERE email = ? AND school_id = ? AND status != 4`;
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
    let sql = `SELECT id FROM parent_master WHERE phone = ? AND school_id = ? AND status != 4`;
    const params = [String(phone).trim(), schoolId];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return rows.length > 0;
  }

  static async checkDuplicate(schoolId, { email, phone }, excludeId = null) {
    const isEmailDuplicate = email ? await ParentModel.checkEmail(schoolId, email, excludeId) : false;
    const isPhoneDuplicate = phone ? await ParentModel.checkPhone(schoolId, phone, excludeId) : false;
    return { isEmailDuplicate, isPhoneDuplicate };
  }

  static async create(schoolId, data) {
    const {
      first_name,
      last_name = '',
      email = null,
      phone = null,
      occupation = null,
      relation = 'Father',
      parent_type = 1,
      picture = null,
      status = 1,
    } = data;

    if (email && String(email).trim()) {
      const isEmailDup = await ParentModel.checkEmail(schoolId, email);
      if (isEmailDup) {
        const err = new Error('A parent with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (phone && String(phone).trim()) {
      const isPhoneDup = await ParentModel.checkPhone(schoolId, phone);
      if (isPhoneDup) {
        const err = new Error('A parent with this mobile number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    const savedPic = picture ? saveBase64File(picture, 'parent/profile', 'Parent-Profile') : null;

    // Use parent's phone number as the default password (fallback to 123456 if phone is missing)
    const plainPassword = data.password && String(data.password).trim()
      ? String(data.password).trim()
      : (phone && String(phone).trim() ? String(phone).trim() : '123456');
    const hashedPassword = await hashPassword(plainPassword);

    const sql = `
      INSERT INTO parent_master (
        school_id, first_name, last_name, email, phone, password,
        occupation, relation, parent_type, picture, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const [result] = await pool.query(sql, [
      schoolId,
      first_name,
      last_name,
      email,
      phone,
      hashedPassword,
      occupation,
      relation,
      parent_type,
      savedPic,
      status,
    ]);

    return result.insertId;
  }

  static async update(id, schoolId, data) {
    const {
      first_name,
      last_name = '',
      email = null,
      phone = null,
      occupation = null,
      relation = 'Father',
      parent_type = 1,
      picture = undefined,
      status = 1,
    } = data;

    if (email && String(email).trim()) {
      const isEmailDup = await ParentModel.checkEmail(schoolId, email, id);
      if (isEmailDup) {
        const err = new Error('A parent with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (phone && String(phone).trim()) {
      const isPhoneDup = await ParentModel.checkPhone(schoolId, phone, id);
      if (isPhoneDup) {
        const err = new Error('A parent with this mobile number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `
      UPDATE parent_master SET
        first_name = ?,
        last_name = ?,
        email = ?,
        phone = ?,
        occupation = ?,
        relation = ?,
        parent_type = ?,
        status = ?
    `;

    const params = [
      first_name,
      last_name,
      email,
      phone,
      occupation,
      relation,
      parent_type,
      status,
    ];

    if (data.password && String(data.password).trim()) {
      const hashedPassword = await hashPassword(String(data.password).trim());
      sql += `, password = ?`;
      params.push(hashedPassword);
    }

    if (picture !== undefined) {
      const savedPic = picture ? saveBase64File(picture, 'parent/profile', 'Parent-Profile') : null;
      sql += `, picture = ?`;
      params.push(savedPic);
    }

    sql += ` WHERE id = ? AND (school_id = ? OR ? IS NULL)`;
    params.push(id, schoolId, schoolId);

    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async delete(id, schoolId) {
    const sql = `UPDATE parent_master SET status = 4 WHERE id = ? AND (school_id = ? OR ? IS NULL)`;
    const [result] = await pool.query(sql, [id, schoolId, schoolId]);

    // Also soft-delete parent-child associations
    try {
      await pool.query(
        `UPDATE student_to_parent SET status = 4 WHERE (father_id = ? OR mother_id = ? OR guardian_id = ?) AND (school_id = ? OR ? IS NULL)`,
        [id, id, id, schoolId, schoolId]
      );
    } catch (e) {
      console.error('Error soft-deleting student_to_parent links:', e.message);
    }

    return result.affectedRows > 0;
  }

  static async linkStudentToParent(schoolId, { student_id, father_id = null, mother_id = null, guardian_id = null }) {
    const [existing] = await pool.query(
      `SELECT id FROM student_to_parent WHERE student_id = ? AND (school_id = ? OR ? IS NULL)`,
      [student_id, schoolId, schoolId]
    );

    if (existing.length > 0) {
      const [result] = await pool.query(
        `UPDATE student_to_parent SET father_id = ?, mother_id = ?, guardian_id = ? WHERE student_id = ? AND (school_id = ? OR ? IS NULL)`,
        [father_id, mother_id, guardian_id, student_id, schoolId, schoolId]
      );
      return result.affectedRows > 0;
    } else {
      const [result] = await pool.query(
        `INSERT INTO student_to_parent (school_id, student_id, father_id, mother_id, guardian_id, status) VALUES (?, ?, ?, ?, ?, 1)`,
        [schoolId, student_id, father_id, mother_id, guardian_id]
      );
      return result.insertId;
    }
  }

  // ==========================================
  // PARENT AUTH & PORTAL METHODS
  // ==========================================

  static async findByLoginIdentifier(identifier) {
    const trimmed = String(identifier || '').trim();
    if (!trimmed) return null;

    const sql = `
      SELECT 
        p.*,
        sch.school_name,
        sch.school_logo,
        sch.address AS school_address,
        sch.phone_number AS school_phone,
        sch.email AS school_email
      FROM parent_master p
      LEFT JOIN school_master sch ON p.school_id = sch.id
      WHERE (p.email = ? OR p.phone = ? OR CAST(p.id AS CHAR) = ?)
        AND p.status != 0
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [trimmed, trimmed, trimmed]);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async findAuthProfileById(parentId) {
    const sql = `
      SELECT 
        p.*,
        sch.school_name,
        sch.school_logo,
        sch.address AS school_address,
        sch.phone_number AS school_phone,
        sch.email AS school_email
      FROM parent_master p
      LEFT JOIN school_master sch ON p.school_id = sch.id
      WHERE p.id = ? AND p.status != 0
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [parentId]);
    if (!rows || rows.length === 0) return null;
    const parent = rows[0];

    // Fetch Address Details
    try {
      const [addrRows] = await pool.query(
        `SELECT pa.*, co.name AS country_name, st.state AS state_name, cit.name AS city_name
         FROM parent_master_address pa
         LEFT JOIN countries co ON pa.country = co.id
         LEFT JOIN states st ON pa.state = st.id_state
         LEFT JOIN cities cit ON pa.city = cit.id
         WHERE pa.parent_id = ?
         ORDER BY pa.id DESC LIMIT 1`,
        [parentId]
      );
      if (addrRows && addrRows.length > 0) {
        parent.address_info = addrRows[0];
        parent.address1 = addrRows[0].address1 || '';
        parent.address2 = addrRows[0].address2 || '';
        parent.country = addrRows[0].country || null;
        parent.country_name = addrRows[0].country_name || '';
        parent.state = addrRows[0].state || null;
        parent.state_name = addrRows[0].state_name || '';
        parent.city = addrRows[0].city || null;
        parent.city_name = addrRows[0].city_name || '';
        parent.postal_code = addrRows[0].postal_code || '';
      }
    } catch (e) {
      console.error('Error fetching parent address in findAuthProfileById:', e.message);
    }

    // Fetch Children
    parent.children = await this.getChildrenByParentId(parentId, parent.school_id);

    return parent;
  }

  static async getChildrenByParentId(parentId, schoolId) {
    const childrenSql = `
      SELECT 
        s.id AS student_id,
        s.id,
        s.admission_number,
        s.roll_number,
        s.first_name,
        s.last_name,
        CONCAT(s.first_name, ' ', s.last_name) AS full_name,
        COALESCE(g.gender, IF(s.gender = '1' OR s.gender = 1, 'Male', IF(s.gender = '2' OR s.gender = 2, 'Female', IF(s.gender = '3' OR s.gender = 3, 'Others', 'Male')))) AS gender,
        s.admission_date,
        s.date_of_birth,
        s.blood_group,
        s.status AS student_status,
        cm.class_name,
        s.class AS class_id,
        sec.section_name,
        s.section AS section_id,
        s.picture
      FROM student_to_parent stp
      JOIN student_master s ON stp.student_id = s.id
      LEFT JOIN gender_master g ON (s.gender != 0 AND (s.gender = g.id OR CAST(s.gender AS CHAR) = g.gender))
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sec ON s.section = sec.id
      WHERE (stp.father_id = ? OR stp.mother_id = ? OR stp.guardian_id = ?) 
        AND (s.school_id = ? OR ? IS NULL)
        AND s.status != 0
      GROUP BY s.id
      ORDER BY s.id ASC
    `;
    const [children] = await pool.query(childrenSql, [parentId, parentId, parentId, schoolId, schoolId]);
    return children || [];
  }

  static async getChildFullProfile(studentId, schoolId) {
    const sql = `
      SELECT 
        s.*,
        CONCAT(s.first_name, ' ', s.last_name) AS full_name,
        cm.class_name,
        sec.section_name,
        COALESCE(g.gender, IF(s.gender = '1' OR s.gender = 1, 'Male', IF(s.gender = '2' OR s.gender = 2, 'Female', IF(s.gender = '3' OR s.gender = 3, 'Others', 'Male')))) AS gender_name,
        COALESCE(bg.blood_group, s.blood_group) AS blood_group_name,
        COALESCE(r.religion, s.religion) AS religion_name,
        COALESCE(c.category, s.category) AS category_name,
        sch.school_name,
        sch.school_logo
      FROM student_master s
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sec ON s.section = sec.id
      LEFT JOIN gender_master g ON (s.gender != 0 AND (s.gender = g.id OR CAST(s.gender AS CHAR) = g.gender))
      LEFT JOIN blood_group_master bg ON (s.blood_group = bg.id OR s.blood_group = bg.blood_group)
      LEFT JOIN religion_master r ON s.religion = r.id
      LEFT JOIN student_category_master c ON s.category = c.id
      LEFT JOIN school_master sch ON s.school_id = sch.id
      WHERE s.id = ? AND (s.school_id = ? OR ? IS NULL) AND s.status != 0
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [studentId, schoolId, schoolId]);
    if (!rows || rows.length === 0) return null;
    const student = rows[0];

    // Fetch Student Address
    try {
      const [addrRows] = await pool.query(
        `SELECT sa.*, co.name AS country_name, st.state AS state_name, cit.name AS city_name
         FROM student_address sa
         LEFT JOIN countries co ON sa.country = co.id
         LEFT JOIN states st ON sa.state = st.id_state
         LEFT JOIN cities cit ON sa.city = cit.id
         WHERE sa.student_id = ?
         ORDER BY sa.id DESC LIMIT 1`,
        [studentId]
      );
      if (addrRows && addrRows.length > 0) {
        student.address_info = addrRows[0];
      }
    } catch (e) {
      console.error('Error fetching student address in getChildFullProfile:', e.message);
    }

    return student;
  }

  static async getChildAttendance(studentId, schoolId, { month, year } = {}) {
    let sql = `
      SELECT 
        sa.id,
        sa.school_id,
        sa.student_id,
        sa.attendance,
        sa.date,
        sa.notes,
        sa.academic_year,
        sa.status
      FROM student_attendance sa
      WHERE sa.student_id = ? AND (sa.school_id = ? OR ? IS NULL) AND sa.status != 0
    `;
    const params = [studentId, schoolId, schoolId];

    if (month && year) {
      sql += ` AND MONTH(sa.date) = ? AND YEAR(sa.date) = ?`;
      params.push(Number(month), Number(year));
    } else if (year) {
      sql += ` AND YEAR(sa.date) = ?`;
      params.push(Number(year));
    }

    sql += ` ORDER BY sa.date DESC`;
    const [rows] = await pool.query(sql, params);

    // Calculate Summary
    let present = 0;
    let absent = 0;
    let late = 0;
    let halfday = 0;
    for (const r of rows) {
      const val = String(r.attendance).toLowerCase();
      if (val === '1' || val === 'present' || val === 'p') present++;
      else if (val === '0' || val === 'absent' || val === 'a') absent++;
      else if (val === '2' || val === 'late' || val === 'l') late++;
      else if (val === '3' || val === 'halfday' || val === 'half_day' || val === 'hd') halfday++;
    }
    const total = rows.length;
    const percentage = total > 0 ? Math.round(((present + late * 0.5 + halfday * 0.5) / total) * 100) : 100;

    return {
      records: rows || [],
      summary: {
        total,
        present,
        absent,
        late,
        halfday,
        percentage,
      },
    };
  }

  static async getChildFees(studentId, schoolId) {
    try {
      // 1. Fee Invoices (Only generated invoices from published structures are visible to students)
      const [dueRows] = await pool.query(
        `SELECT 
          fi.*,
          fs.name AS fee_structure_name,
          cm.class_name,
          sec.section_name,
          aym.academic_year
         FROM fee_invoices fi
         LEFT JOIN fee_structures fs ON fi.fee_structure_id = fs.id
         LEFT JOIN class_master cm ON fi.class_id = cm.id
         LEFT JOIN section_master sec ON fi.section_id = sec.id
         LEFT JOIN academic_year_master aym ON fi.academic_year_id = aym.id
         WHERE fi.student_id = ? 
           AND fi.school_id = ? 
           AND fi.status != '4'
           AND (fi.fee_structure_id IS NULL OR (fs.is_published = 1 AND fs.status != 4))
         ORDER BY fi.due_date ASC, fi.id DESC`,
        [studentId, schoolId]
      );

      // Fetch invoice items for each invoice
      for (const inv of dueRows || []) {
        const [items] = await pool.query(
          `SELECT id, invoice_id, fee_component_id, component_name, amount 
           FROM fee_invoice_items 
           WHERE invoice_id = ?`,
          [inv.id]
        );
        inv.items = items || [];
      }

      // 2. Paid Fees Receipts
      const [paidRows] = await pool.query(
        `SELECT 
          fp.*,
          fp.amount_paid AS amount,
          fp.payment_method AS payment_mode_name,
          fi.title AS invoice_title,
          fi.title AS fee_title,
          fi.invoice_no
         FROM fee_payments fp
         LEFT JOIN fee_invoices fi ON fp.invoice_id = fi.id
         LEFT JOIN fee_structures fs ON fi.fee_structure_id = fs.id
         WHERE fp.student_id = ? 
           AND fp.school_id = ? 
           AND (fp.status = 'success' OR fp.status = 'Success')
           AND (fi.id IS NULL OR (fi.status != '4' AND (fi.fee_structure_id IS NULL OR (fs.is_published = 1 AND fs.status != 4))))
         ORDER BY fp.payment_date DESC, fp.id DESC`,
        [studentId, schoolId]
      );

      for (const pay of paidRows || []) {
        if (pay.invoice_id) {
          const [items] = await pool.query(
            `SELECT id, invoice_id, fee_component_id, component_name, amount 
             FROM fee_invoice_items 
             WHERE invoice_id = ?`,
            [pay.invoice_id]
          );
          pay.items = items || [];
        } else {
          pay.items = [];
        }
      }

      let totalOutstandingDue = 0;
      let totalDueThisMonth = 0;
      let totalPaid = 0;

      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      (dueRows || []).forEach((d) => {
        const due = parseFloat(d.due_amount || 0);
        if (d.status !== 'paid' && d.status !== 'Paid' && due > 0) {
          totalOutstandingDue += due;
          if (d.due_date) {
            const dueDate = new Date(d.due_date);
            if (dueDate.getMonth() === currentMonth && dueDate.getFullYear() === currentYear) {
              totalDueThisMonth += due;
            }
          }
        }
      });

      if (totalDueThisMonth === 0 && totalOutstandingDue > 0) {
        totalDueThisMonth = totalOutstandingDue;
      }

      (paidRows || []).forEach((p) => {
        totalPaid += parseFloat(p.amount_paid || p.amount || 0);
      });

      return {
        invoices: dueRows || [],
        dueFees: (dueRows || []).filter((d) => d.status !== 'paid' && d.status !== 'Paid' && parseFloat(d.due_amount || 0) > 0),
        paidFees: paidRows || [],
        summary: {
          totalDue: totalOutstandingDue,
          totalOutstandingDue,
          totalDueThisMonth,
          totalPaid,
          totalAmount: totalOutstandingDue + totalPaid,
        },
      };
    } catch (e) {
      console.error('Error fetching child fees:', e);
      return { invoices: [], dueFees: [], paidFees: [], summary: { totalDue: 0, totalOutstandingDue: 0, totalDueThisMonth: 0, totalPaid: 0, totalAmount: 0 } };
    }
  }

  static async getChildExamResults(studentId, schoolId) {
    try {
      // Fetch grade settings for the school for accurate grade calculations
      const [gradeSettings] = await pool.query(
        `SELECT id, grade_name, min_percentage, max_percentage 
         FROM grade_settings 
         WHERE (school_id = ? OR ? IS NULL) AND status = 1 
         ORDER BY min_percentage DESC`,
        [schoolId, schoolId]
      );

      const computeGrade = (pct) => {
        const val = Number(pct);
        for (const g of gradeSettings || []) {
          if (val >= Number(g.min_percentage) && val <= Number(g.max_percentage)) {
            return g.grade_name;
          }
        }
        return '-';
      };

      const [results] = await pool.query(
        `SELECT 
          er.id AS exam_result_id,
          er.exam_id,
          er.class_id,
          em.exam AS exam_name,
          ay.academic_year
         FROM exam_result er
         LEFT JOIN exam_master em ON er.exam_id = em.id
         LEFT JOIN academic_year_master ay ON er.academic_year_id = ay.id
         WHERE er.student_id = ? AND (er.school_id = ? OR ? IS NULL) AND er.status != 4
         ORDER BY er.id DESC`,
        [studentId, schoolId, schoolId]
      );

      const examMarks = [];
      for (const res of results || []) {
        const [marks] = await pool.query(
          `SELECT 
            ers.id,
            ers.exam_result_id,
            ers.subject_id,
            ers.exam_type_id,
            ers.marks,
            ers.grade_id,
            sm.subject_name,
            etm.exam_type AS exam_type_name,
            g.grade_name,
            COALESCE(esm_marks.mark, 0) AS max_marks
           FROM exam_result_subject ers
           LEFT JOIN subject_master sm ON ers.subject_id = sm.id
           LEFT JOIN exam_type_master etm ON ers.exam_type_id = etm.id
           LEFT JOIN grade_settings g ON ers.grade_id = g.id
           LEFT JOIN exam_subject_master esm ON esm.exam_id = ? AND esm.class_id = ? AND (esm.school_id = ? OR ? IS NULL) AND esm.status != 4
           LEFT JOIN exam_subject_marks esm_marks ON esm_marks.exam_subject_id = esm.id 
             AND esm_marks.subject_id = ers.subject_id 
             AND esm_marks.exam_type_id = ers.exam_type_id 
             AND esm_marks.status != 4
           WHERE ers.exam_result_id = ? AND ers.status != 4
           ORDER BY sm.sort_order ASC, sm.subject_name ASC, etm.sort_order ASC, etm.id ASC`,
          [res.exam_id, res.class_id, schoolId, schoolId, res.exam_result_id]
        );

        const subjectsMap = {};
        const examTypeNamesSet = new Set();
        let totalMarks = 0;
        let obtainedMarks = 0;

        for (const m of marks || []) {
          const sId = m.subject_id;
          const typeName = m.exam_type_name || 'Theory';
          examTypeNamesSet.add(typeName);

          if (!subjectsMap[sId]) {
            subjectsMap[sId] = {
              subject_id: sId,
              subject_name: m.subject_name || `Subject #${sId}`,
              grade_name: m.grade_name || '',
              obtained: 0,
              full_marks: 0,
              practical: null,
              assessment: null,
              theory: null,
              marks_by_type: {},
            };
          }

          const markVal = parseFloat(m.marks || 0);
          const maxVal = parseFloat(m.max_marks || 0);

          subjectsMap[sId].marks_by_type[typeName] = markVal;
          subjectsMap[sId].obtained += markVal;
          subjectsMap[sId].full_marks += maxVal;

          const lowerType = typeName.toLowerCase();
          if (lowerType.includes('pract')) {
            subjectsMap[sId].practical = markVal;
          } else if (lowerType.includes('assess') || lowerType.includes('asses')) {
            subjectsMap[sId].assessment = markVal;
          } else if (lowerType.includes('theor') || lowerType.includes('written')) {
            subjectsMap[sId].theory = markVal;
          }

          if (m.grade_name && !subjectsMap[sId].grade_name) {
            subjectsMap[sId].grade_name = m.grade_name;
          }

          obtainedMarks += markVal;
        }

        // If subject full_marks is 0 (not configured in exam_subject_marks), fallback to 100
        for (const sId in subjectsMap) {
          if (subjectsMap[sId].full_marks <= 0) {
            subjectsMap[sId].full_marks = 100;
          }
          const subPct = Math.round((subjectsMap[sId].obtained / subjectsMap[sId].full_marks) * 100);
          if (!subjectsMap[sId].grade_name || subjectsMap[sId].grade_name === '-') {
            subjectsMap[sId].grade_name = computeGrade(subPct);
          }
          if (subjectsMap[sId].theory === null && subjectsMap[sId].practical === null && subjectsMap[sId].assessment === null) {
            subjectsMap[sId].theory = subjectsMap[sId].obtained;
          }
          totalMarks += subjectsMap[sId].full_marks;
        }

        const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100) : 0;
        const overallGrade = computeGrade(percentage);

        examMarks.push({
          ...res,
          marks: marks || [],
          subjects: Object.values(subjectsMap),
          exam_types: Array.from(examTypeNamesSet),
          totalMarks,
          obtainedMarks,
          percentage,
          overallGrade,
        });
      }

      return examMarks;
    } catch (e) {
      console.error('Error fetching child exam results:', e);
      return [];
    }
  }

  static async getChildStudyMaterials(studentId, schoolId, classId) {
    try {
      const [materials] = await pool.query(
        `SELECT 
          sm.id,
          sm.school_id,
          sm.academic_year_id,
          sm.class_id,
          sm.section_id,
          sm.subject_id,
          sm.material_type_id,
          sm.title,
          sm.description,
          sm.chapter,
          sm.attachment,
          sm.attachment AS file_path,
          sm.attachment_original_name,
          sm.attachment_extension,
          sm.attachment_extension AS file_type,
          sm.attachment_size,
          sm.attachment_size AS file_size,
          sm.publish_date,
          sm.allow_download,
          sm.status,
          sm.created_at,
          sm.updated_at,
          sub.subject_name,
          cm.class_name,
          sec.section_name,
          mt.material_type_name
         FROM study_materials sm
         LEFT JOIN subject_master sub ON sm.subject_id = sub.id
         LEFT JOIN class_master cm ON sm.class_id = cm.id
         LEFT JOIN section_master sec ON sm.section_id = sec.id
         LEFT JOIN material_types mt ON sm.material_type_id = mt.id
         WHERE (sm.class_id = ? OR sm.class_id IS NULL OR ? IS NULL) 
           AND (sm.school_id = ? OR ? IS NULL) 
           AND sm.status = 1
         ORDER BY sm.id DESC`,
        [classId, classId, schoolId, schoolId]
      );
      return materials || [];
    } catch (e) {
      console.error('Error fetching child study materials:', e);
      return [];
    }
  }

  static async getChildActivities(studentId, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, school_id, student_id, date, activity_description, status, created_at
         FROM student_activity
         WHERE student_id = ? AND (school_id = ? OR ? IS NULL) AND status != 4 AND status != 0
         ORDER BY date DESC, id DESC`,
        [studentId, schoolId, schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error fetching child activities:', e);
      return [];
    }
  }

  static async getChildTimetable(studentId, schoolId, classId, sectionId) {
    try {
      const AcademicModel = require('./academic.model');
      return await AcademicModel.getRoutines(schoolId, { classId, sectionId });
    } catch (e) {
      console.error('Error fetching child timetable:', e);
      return [];
    }
  }

  static async getChildTransport(studentId, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          st.id,
          st.school_id,
          st.student_id,
          st.route AS route_id,
          st.vehicle_number AS vehicle_id,
          st.pickup_point,
          st.drop_point,
          st.status,
          st.created_at,
          tr.transport_route,
          tr.transport_route AS route_name,
          tr.fare,
          tr.fare AS monthly_fee,
          bm.name AS bus_name,
          bm.name AS vehicle_name,
          bm.number_plate,
          COALESCE(bm.number_plate, tv.vehicle_number, CASE WHEN st.vehicle_number > 0 THEN st.vehicle_number ELSE NULL END) AS vehicle_number,
          bm.seat,
          bm.color
         FROM student_transport st
         LEFT JOIN trans_route_master tr ON st.route = tr.id
         LEFT JOIN bus_master bm ON (bm.id = tr.bus_id OR (st.vehicle_number > 0 AND bm.id = st.vehicle_number))
         LEFT JOIN trans_vehicle_master tv ON (st.vehicle_number > 0 AND st.vehicle_number = tv.id)
         WHERE st.student_id = ? AND (st.school_id = ? OR ? IS NULL) AND (st.status = 1 OR (st.status != 0 AND st.status != 4))
         LIMIT 1`,
        [studentId, schoolId, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error fetching child transport:', e);
      return null;
    }
  }

  static async getChildHostel(studentId, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          sh.id,
          sh.school_id,
          sh.student_id,
          sh.hostel_name AS hostel_id,
          sh.room_number AS room_id,
          sh.academic_year,
          sh.status,
          sh.created_at,
          hn.hostel_name,
          hn.hostel_fee,
          rm.room_number
         FROM student_hostel sh
         LEFT JOIN hostel_name_master hn ON sh.hostel_name = hn.id
         LEFT JOIN hostel_room_master rm ON (sh.room_number = rm.id OR sh.room_number = rm.room_number)
         WHERE sh.student_id = ? AND (sh.school_id = ? OR ? IS NULL) AND sh.status = 1 AND sh.hostel_name > 0
         LIMIT 1`,
        [studentId, schoolId, schoolId]
      );
      return rows[0] || null;
    } catch (e) {
      console.error('Error fetching child hostel:', e);
      return null;
    }
  }

  static async getChildMedical(studentId, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          smh.id,
          smh.school_id,
          smh.student_id,
          smh.medical_condition,
          CASE smh.medical_condition
            WHEN 1 THEN 'Good'
            WHEN 2 THEN 'Bad'
            WHEN 3 THEN 'Other'
            ELSE 'Good'
          END AS condition_name,
          CASE smh.medical_condition
            WHEN 1 THEN 'Good'
            WHEN 2 THEN 'Bad'
            WHEN 3 THEN 'Other'
            ELSE 'Good'
          END AS \`condition\`,
          CASE smh.medical_condition
            WHEN 1 THEN 'General Health (Fit)'
            WHEN 2 THEN 'Medical Attention / Illness'
            WHEN 3 THEN 'Other Medical Condition'
            ELSE 'General Health Checkup'
          END AS illness,
          smh.description,
          smh.description AS notes,
          smh.description AS remarks,
          smh.medical_time,
          smh.medical_time AS checkup_date,
          DATE_FORMAT(smh.medical_time, '%d-%m-%Y') AS formatted_medical_date,
          smh.is_informed,
          CASE smh.is_informed
            WHEN 1 THEN 'Informed'
            ELSE 'Not Informed'
          END AS informed_status,
          smh.status,
          smh.created_at,
          smh.updated_at
         FROM student_medical_history smh
         WHERE smh.student_id = ? AND (smh.school_id = ? OR ? IS NULL) AND smh.status != 0 AND smh.status != 4
         ORDER BY smh.medical_time DESC, smh.id DESC`,
        [studentId, schoolId, schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error fetching child medical history:', e);
      return [];
    }
  }

  static async getChildDocuments(studentId, schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT 
          sd.id,
          sd.school_id,
          sd.student_id,
          sd.document_type,
          sd.attachments,
          sd.file_name,
          sd.status,
          sd.created_at,
          dtm.document_type_name
         FROM student_document sd
         LEFT JOIN document_type_master dtm ON sd.document_type = dtm.id
         WHERE sd.student_id = ? AND (sd.school_id = ? OR ? IS NULL) AND sd.status != 0 AND sd.status != 4
         ORDER BY sd.id DESC`,
        [studentId, schoolId, schoolId]
      );

      return (rows || []).map((doc) => {
        let attachment = (doc.attachments || '').trim();
        let fileUrl = '';
        if (attachment) {
          if (attachment.startsWith('http://') || attachment.startsWith('https://') || attachment.startsWith('data:')) {
            fileUrl = attachment;
          } else {
            const clean = attachment.replace(/^\//, '');
            if (clean.startsWith('upload/')) {
              fileUrl = `/${clean}`;
            } else if (clean.startsWith('student/')) {
              fileUrl = `/upload/${clean}`;
            } else {
              fileUrl = `/upload/student/attachment/${clean}`;
            }
          }
        }
        return {
          ...doc,
          file_url: fileUrl,
        };
      });
    } catch (e) {
      console.error('Error fetching child documents:', e);
      return [];
    }
  }

  static async updateParentProfile(parentId, schoolId, data) {
    const {
      first_name,
      last_name,
      phone,
      email,
      occupation,
      picture,
      password,
      address1,
      address2,
      country,
      state,
      city,
      postal_code,
    } = data;

    if (email && String(email).trim()) {
      const isEmailDup = await ParentModel.checkEmail(schoolId, email, parentId);
      if (isEmailDup) {
        const err = new Error('A parent with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (phone && String(phone).trim()) {
      const isPhoneDup = await ParentModel.checkPhone(schoolId, phone, parentId);
      if (isPhoneDup) {
        const err = new Error('A parent with this mobile number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    const updates = [];
    const params = [];

    if (first_name !== undefined) {
      updates.push('first_name = ?');
      params.push(first_name);
    }
    if (last_name !== undefined) {
      updates.push('last_name = ?');
      params.push(last_name);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email);
    }
    if (occupation !== undefined) {
      updates.push('occupation = ?');
      params.push(occupation);
    }
    if (picture !== undefined) {
      updates.push('picture = ?');
      params.push(picture);
    }
    if (password) {
      updates.push('password = ?');
      params.push(password);
    }

    if (updates.length > 0) {
      params.push(parentId);
      await pool.query(`UPDATE parent_master SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Sync Address into parent_master_address
    if (
      address1 !== undefined ||
      address2 !== undefined ||
      country !== undefined ||
      state !== undefined ||
      city !== undefined ||
      postal_code !== undefined
    ) {
      const [addrExists] = await pool.query(
        `SELECT id FROM parent_master_address WHERE parent_id = ? ORDER BY id DESC LIMIT 1`,
        [parentId]
      );

      if (addrExists && addrRowsHasId(addrExists)) {
        await pool.query(
          `UPDATE parent_master_address SET 
            address1 = COALESCE(?, address1),
            address2 = COALESCE(?, address2),
            country = COALESCE(?, country),
            state = COALESCE(?, state),
            city = COALESCE(?, city),
            postal_code = COALESCE(?, postal_code)
           WHERE id = ?`,
          [
            address1 || null,
            address2 || null,
            country || null,
            state || null,
            city || null,
            postal_code || null,
            addrExists[0].id,
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO parent_master_address (school_id, parent_id, country, state, city, postal_code, address1, address2, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            schoolId,
            parentId,
            country || null,
            state || null,
            city || null,
            postal_code || null,
            address1 || null,
            address2 || null,
          ]
        );
      }
    }

    return await this.findAuthProfileById(parentId);
  }

  static async updateChildProfile(studentId, schoolId, parentId, data) {
    try {
      const updates = [];
      const params = [];

      const {
        first_name,
        last_name,
        gender,
        date_of_birth,
        blood_group,
        primary_contact_number,
        email_address,
        religion,
        caste,
        category,
        mother_tongue,
        language_known,
        languages_known,
        picture,
      } = data;

      if (first_name !== undefined) {
        updates.push('first_name = ?');
        params.push(first_name ? String(first_name).trim() : '');
      }
      if (last_name !== undefined) {
        updates.push('last_name = ?');
        params.push(last_name ? String(last_name).trim() : '');
      }
      if (gender !== undefined) {
        updates.push('gender = ?');
        params.push(gender);
      }
      if (date_of_birth !== undefined) {
        let formattedDob = date_of_birth;
        if (date_of_birth) {
          const d = new Date(date_of_birth);
          if (!isNaN(d.getTime())) {
            formattedDob = d.toISOString().split('T')[0];
          }
        }
        updates.push('date_of_birth = ?');
        params.push(formattedDob || null);
      }
      if (blood_group !== undefined) {
        updates.push('blood_group = ?');
        params.push(blood_group || null);
      }
      if (primary_contact_number !== undefined) {
        updates.push('primary_contact_number = ?');
        params.push(primary_contact_number || null);
      }
      if (email_address !== undefined) {
        updates.push('email_address = ?');
        params.push(email_address || null);
      }
      if (religion !== undefined) {
        updates.push('religion = ?');
        params.push(religion || null);
      }
      if (caste !== undefined) {
        updates.push('caste = ?');
        params.push(caste || null);
      }
      if (category !== undefined) {
        updates.push('category = ?');
        params.push(category || null);
      }
      if (mother_tongue !== undefined) {
        updates.push('mother_tongue = ?');
        params.push(mother_tongue || null);
      }
      if (language_known !== undefined || languages_known !== undefined) {
        updates.push('language_known = ?');
        params.push(language_known || languages_known || null);
      }
      if (picture !== undefined && picture) {
        if (String(picture).startsWith('data:image')) {
          const savedPic = saveBase64File(picture, 'student/student_pic', 'Profile');
          if (savedPic) {
            updates.push('picture = ?');
            params.push(savedPic);
          }
        } else {
          updates.push('picture = ?');
          params.push(picture);
        }
      }

      if (updates.length > 0) {
        params.push(studentId);
        params.push(schoolId);
        params.push(schoolId);
        await pool.query(
          `UPDATE student_master SET ${updates.join(', ')} WHERE id = ? AND (school_id = ? OR ? IS NULL)`,
          params
        );
      }

      return await ParentModel.getChildFullProfile(studentId, schoolId);
    } catch (e) {
      console.error('Error in updateChildProfile:', e);
      throw e;
    }
  }
}

function addrRowsHasId(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows[0]?.id;
}

module.exports = ParentModel;
