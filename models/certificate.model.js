const { pool } = require('../config/db.config');

class CertificateModel {
  // ================= CATEGORIES =================
  static async getAllCategories(schoolId, { search = '', status = null } = {}) {
    let sql = `
      SELECT * FROM certificate_category 
      WHERE school_id = ? AND status != 4
    `;
    const params = [schoolId];

    if (search && search.trim()) {
      sql += ` AND category_name LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    if (status !== null && status !== undefined && status !== '') {
      sql += ` AND status = ?`;
      params.push(Number(status));
    }

    sql += ` ORDER BY sort_order ASC, id DESC`;

    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getCategoryById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT * FROM certificate_category WHERE id = ? AND school_id = ? AND status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async getCategoryByName(categoryName, schoolId, excludeId = null) {
    let sql = `SELECT * FROM certificate_category WHERE LOWER(TRIM(category_name)) = LOWER(TRIM(?)) AND school_id = ? AND status != 4`;
    const params = [categoryName, schoolId];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  }

  static async createCategory({ school_id = 1, category_name, sort_order = 0, status = 1, created_by = null }) {
    const [result] = await pool.query(
      `INSERT INTO certificate_category (school_id, category_name, sort_order, status, created_by, created_at, modify_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [school_id, category_name, sort_order || 0, status || 1, created_by]
    );
    return result.insertId;
  }

  static async updateCategory(id, school_id, { category_name, sort_order, status, modify_by = null }) {
    const [result] = await pool.query(
      `UPDATE certificate_category 
       SET category_name = COALESCE(?, category_name),
           sort_order = COALESCE(?, sort_order),
           status = COALESCE(?, status),
           modify_by = ?,
           modify_at = NOW()
       WHERE id = ? AND school_id = ?`,
      [category_name, sort_order, status, modify_by, id, school_id]
    );
    return result.affectedRows > 0;
  }

  static async deleteCategory(id, school_id) {
    const [result] = await pool.query(
      `UPDATE certificate_category SET status = 4, modify_at = NOW() WHERE id = ? AND school_id = ?`,
      [id, school_id]
    );
    return result.affectedRows > 0;
  }

  // ================= TEMPLATES =================
  static async getAllTemplates(schoolId, { categoryId = null, search = '', status = null } = {}) {
    let sql = `
      SELECT t.*, c.category_name 
      FROM certificate_template t
      LEFT JOIN certificate_category c ON t.certificate_category = c.id
      WHERE t.school_id = ? AND t.status != 4
    `;
    const params = [schoolId];

    if (categoryId) {
      sql += ` AND t.certificate_category = ?`;
      params.push(categoryId);
    }

    if (search && search.trim()) {
      sql += ` AND (t.template_name LIKE ? OR t.certificate_heading LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status !== null && status !== undefined && status !== '') {
      sql += ` AND t.status = ?`;
      params.push(Number(status));
    }

    sql += ` ORDER BY t.id DESC`;

    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getTemplateById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT t.*, c.category_name 
       FROM certificate_template t
       LEFT JOIN certificate_category c ON t.certificate_category = c.id
       WHERE t.id = ? AND t.school_id = ? AND t.status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createTemplate({
    school_id = 1,
    certificate_category,
    template_name,
    certificate_heading,
    short_description = '',
    description,
    border = '1',
    certified_by = 'Principal',
    status = 1,
    created_by = null,
  }) {
    const [result] = await pool.query(
      `INSERT INTO certificate_template 
       (school_id, certificate_category, template_name, certificate_heading, short_description, description, border, certified_by, status, created_by, created_at, modify_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        school_id,
        certificate_category,
        template_name,
        certificate_heading,
        short_description || '',
        description,
        border || '1',
        certified_by || 'Principal',
        status || 1,
        created_by,
      ]
    );
    return result.insertId;
  }

  static async updateTemplate(
    id,
    school_id,
    {
      certificate_category,
      template_name,
      certificate_heading,
      short_description,
      description,
      border,
      certified_by,
      status,
      modify_by = null,
    }
  ) {
    const [result] = await pool.query(
      `UPDATE certificate_template 
       SET certificate_category = COALESCE(?, certificate_category),
           template_name = COALESCE(?, template_name),
           certificate_heading = COALESCE(?, certificate_heading),
           short_description = COALESCE(?, short_description),
           description = COALESCE(?, description),
           border = COALESCE(?, border),
           certified_by = COALESCE(?, certified_by),
           status = COALESCE(?, status),
           modify_by = ?,
           modify_at = NOW()
       WHERE id = ? AND school_id = ?`,
      [
        certificate_category,
        template_name,
        certificate_heading,
        short_description,
        description,
        border,
        certified_by,
        status,
        modify_by,
        id,
        school_id,
      ]
    );
    return result.affectedRows > 0;
  }

  static async deleteTemplate(id, school_id) {
    const [result] = await pool.query(
      `UPDATE certificate_template SET status = 4, modify_at = NOW() WHERE id = ? AND school_id = ?`,
      [id, school_id]
    );
    return result.affectedRows > 0;
  }

  // ================= BORDERS =================
  static async getAllBorders(schoolId = 1, { search = '', status = null, page = null, limit = null } = {}) {
    let sql = `
      SELECT * FROM certificate_border_master 
      WHERE school_id = ? AND status != 4
    `;
    const params = [schoolId];

    if (search && search.trim()) {
      sql += ` AND image LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    if (status !== null && status !== undefined && status !== '') {
      sql += ` AND status = ?`;
      params.push(Number(status));
    }

    sql += ` ORDER BY id DESC`;

    if (page && limit) {
      const offset = (page - 1) * limit;
      const countSql = `
        SELECT COUNT(*) as total FROM certificate_border_master 
        WHERE school_id = ? AND status != 4
        ${search && search.trim() ? ' AND image LIKE ?' : ''}
        ${status !== null && status !== undefined && status !== '' ? ' AND status = ?' : ''}
      `;
      const countParams = [schoolId];
      if (search && search.trim()) countParams.push(`%${search.trim()}%`);
      if (status !== null && status !== undefined && status !== '') countParams.push(Number(status));

      const [countResult] = await pool.query(countSql, countParams);
      const total = countResult[0]?.total || 0;

      sql += ` LIMIT ? OFFSET ?`;
      params.push(Number(limit), Number(offset));

      const [rows] = await pool.query(sql, params);
      return {
        borders: rows,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getBorderById(id, schoolId = 1) {
    const [rows] = await pool.query(
      `SELECT * FROM certificate_border_master WHERE id = ? AND school_id = ? AND status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createBorder({ school_id = 1, image, status = 1 }) {
    const [result] = await pool.query(
      `INSERT INTO certificate_border_master (school_id, image, status, created_on)
       VALUES (?, ?, ?, NOW())`,
      [school_id, image, status]
    );
    return result.insertId;
  }

  static async updateBorder(id, schoolId = 1, { image, status }) {
    const [result] = await pool.query(
      `UPDATE certificate_border_master 
       SET image = COALESCE(?, image),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`,
      [image, status, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteBorder(id, schoolId = 1) {
    const [result] = await pool.query(
      `UPDATE certificate_border_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return result.affectedRows > 0;
  }

  // ================= ISSUED CERTIFICATES (CERTIFICATE CREATE) =================
  static async getAllIssuedCertificates(
    schoolId,
    { classId = null, sectionId = null, academicYear = null, studentId = null, categoryId = null, templateId = null, search = '', page = null, limit = null } = {}
  ) {
    let baseWhere = ` WHERE sc.school_id = ? AND sc.status != 4`;
    const params = [schoolId];

    if (classId) {
      baseWhere += ` AND (scl.class_id = ? OR s.class = ?)`;
      params.push(classId, classId);
    }
    if (sectionId) {
      baseWhere += ` AND (scl.section_id = ? OR s.section = ?)`;
      params.push(sectionId, sectionId);
    }
    if (academicYear) {
      baseWhere += ` AND scl.academic_year = ?`;
      params.push(academicYear);
    }
    if (studentId) {
      baseWhere += ` AND sc.student_id = ?`;
      params.push(studentId);
    }
    if (categoryId) {
      baseWhere += ` AND sc.certificate_category_id = ?`;
      params.push(categoryId);
    }
    if (templateId) {
      baseWhere += ` AND sc.certificate_template_id = ?`;
      params.push(templateId);
    }
    if (search && search.trim()) {
      baseWhere += ` AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_number LIKE ? OR s.primary_contact_number LIKE ? OR s.email_address LIKE ? OR ct.template_name LIKE ? OR cat.category_name LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    const joinClause = `
      FROM student_certificate sc
      LEFT JOIN student_master s ON sc.student_id = s.id
      LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
      LEFT JOIN class_master cm ON COALESCE(scl.class_id, s.class) = cm.id
      LEFT JOIN section_master sec ON COALESCE(scl.section_id, s.section) = sec.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (s.gender = 1 OR s.gender = '1' OR LOWER(CAST(s.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (s.gender = 2 OR s.gender = '2' OR LOWER(CAST(s.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (s.gender = 3 OR s.gender = '3' OR LOWER(CAST(s.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN student_to_parent stp ON s.id = stp.student_id
      LEFT JOIN parent_master p ON (stp.father_id = p.id OR stp.guardian_id = p.id)
      LEFT JOIN certificate_category cat ON sc.certificate_category_id = cat.id
      LEFT JOIN certificate_template ct ON sc.certificate_template_id = ct.id
    `;

    if (page !== null && limit !== null) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (pageNum - 1) * limitNum;

      const countSql = `SELECT COUNT(DISTINCT sc.id) as total ${joinClause} ${baseWhere}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      let selectSql = `
        SELECT sc.*, 
               s.first_name, s.last_name, s.admission_number, s.date_of_birth,
               COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', s.gender)), 'Male') AS gender,
               CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) AS guardian_name,
               COALESCE(s.primary_contact_number, p.phone) AS primary_contact_number,
               s.email_address, s.picture,
               COALESCE(scl.roll_number, s.roll_number) AS roll_number, scl.class_id, scl.section_id, scl.academic_year,
               cm.class_name, sec.section_name,
               cat.category_name,
               ct.template_name, ct.certificate_heading, ct.certified_by, ct.border
        ${joinClause}
        ${baseWhere}
        ORDER BY sc.id DESC
        LIMIT ? OFFSET ?
      `;

      const [rows] = await pool.query(selectSql, [...params, limitNum, offset]);
      return {
        data: rows,
        pagination: {
          totalRecords: total,
          totalPages: Math.ceil(total / limitNum) || 1,
          currentPage: pageNum,
          limit: limitNum,
        },
      };
    }

    let sql = `
      SELECT sc.*, 
             s.first_name, s.last_name, s.admission_number, s.date_of_birth,
             COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', s.gender)), 'Male') AS gender,
             CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) AS guardian_name,
             COALESCE(s.primary_contact_number, p.phone) AS primary_contact_number,
             s.email_address, s.picture,
             COALESCE(scl.roll_number, s.roll_number) AS roll_number, scl.class_id, scl.section_id, scl.academic_year,
             cm.class_name, sec.section_name,
             cat.category_name,
             ct.template_name, ct.certificate_heading, ct.certified_by, ct.border
      ${joinClause}
      ${baseWhere}
      ORDER BY sc.id DESC
    `;

    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getIssuedCertificateById(id, schoolId) {
    const [rows] = await pool.query(
      `SELECT sc.*, 
             s.first_name, s.last_name, s.admission_number, s.date_of_birth,
             COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', s.gender)), 'Male') AS gender,
             CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) AS guardian_name,
             COALESCE(s.primary_contact_number, p.phone) AS primary_contact_number,
             s.email_address, s.picture,
             COALESCE(scl.roll_number, s.roll_number) AS roll_number, scl.class_id, scl.section_id, scl.academic_year,
             cm.class_name, sec.section_name,
             cat.category_name,
             ct.template_name, ct.certificate_heading, ct.certified_by, ct.border,
             sch.school_name, sch.school_code, sch.address as school_address, sch.email as school_email, sch.phone_number as school_phone, sch.school_logo, sch.affiliation_board
      FROM student_certificate sc
      LEFT JOIN student_master s ON sc.student_id = s.id
      LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
      LEFT JOIN class_master cm ON COALESCE(scl.class_id, s.class) = cm.id
      LEFT JOIN section_master sec ON COALESCE(scl.section_id, s.section) = sec.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (s.gender = 1 OR s.gender = '1' OR LOWER(CAST(s.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (s.gender = 2 OR s.gender = '2' OR LOWER(CAST(s.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (s.gender = 3 OR s.gender = '3' OR LOWER(CAST(s.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN student_to_parent stp ON s.id = stp.student_id
      LEFT JOIN parent_master p ON (stp.father_id = p.id OR stp.guardian_id = p.id)
      LEFT JOIN certificate_category cat ON sc.certificate_category_id = cat.id
      LEFT JOIN certificate_template ct ON sc.certificate_template_id = ct.id
      LEFT JOIN school_master sch ON sc.school_id = sch.id
      WHERE sc.id = ? AND sc.school_id = ? AND sc.status != 4`,
      [id, schoolId]
    );
    return rows[0] || null;
  }

  static async createIssuedCertificate({
    school_id = 1,
    certificate_category_id,
    certificate_template_id,
    student_id,
    certificate_date,
    certificate_description,
    status = 1,
    created_by = null,
  }) {
    const [result] = await pool.query(
      `INSERT INTO student_certificate 
       (school_id, certificate_category_id, certificate_template_id, student_id, certificate_date, certificate_description, status, created_by, created_at, modify_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        school_id,
        certificate_category_id,
        certificate_template_id,
        student_id,
        certificate_date,
        certificate_description,
        status || 1,
        created_by,
      ]
    );
    return result.insertId;
  }

  static async deleteIssuedCertificate(id, school_id) {
    const [result] = await pool.query(
      `UPDATE student_certificate SET status = 4, modify_at = NOW() WHERE id = ? AND school_id = ?`,
      [id, school_id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = CertificateModel;
