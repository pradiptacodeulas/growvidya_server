const { pool } = require('../config/db.config');

class AdminIdCardModel {
  /**
   * Fetch school branding info
   */
  static async getSchoolInfo(schoolId) {
    const [rows] = await pool.query(
      `SELECT 
        id, 
        school_name, 
        school_name AS school_title, 
        school_code, 
        school_logo, 
        address, 
        city, 
        state, 
        postal_code, 
        phone_number AS phone, 
        email, 
        website, 
        affiliation_board 
       FROM school_master 
       WHERE id = ?`,
      [schoolId]
    );
    return rows[0] || null;
  }

  /**
   * Fetch Blood Group Dictionary
   */
  static async getBloodGroupMap() {
    try {
      const [rows] = await pool.query('SELECT id, blood_group FROM blood_group_master');
      const map = {};
      rows.forEach((r) => {
        map[String(r.id)] = r.blood_group;
        map[r.blood_group] = r.blood_group;
      });
      return map;
    } catch {
      return {};
    }
  }

  /**
   * Fetch Student ID Card Data
   */
  static async getStudentIdCardData({
    schoolId,
    studentIds = [],
    classId = null,
    sectionId = null,
    academicYearId = null,
  }) {
    const school = await AdminIdCardModel.getSchoolInfo(schoolId);

    // Resolve academic year label
    let academicYearLabel = '';
    if (academicYearId) {
      const [yRows] = await pool.query(
        `SELECT academic_year, start_date, end_date FROM academic_year_master WHERE id = ? AND school_id = ?`,
        [academicYearId, schoolId]
      );
      if (yRows.length > 0) {
        academicYearLabel = yRows[0].academic_year;
      }
    }
    if (!academicYearLabel) {
      const [curYearRows] = await pool.query(
        `SELECT academic_year FROM academic_year_master WHERE school_id = ? ORDER BY is_current DESC, id DESC LIMIT 1`,
        [schoolId]
      );
      if (curYearRows.length > 0) {
        academicYearLabel = curYearRows[0].academic_year;
      }
    }

    let query = `
      SELECT 
        s.id,
        s.school_id,
        s.first_name,
        s.last_name,
        s.admission_number,
        s.roll_number,
        s.gender,
        s.blood_group,
        bg.blood_group AS blood_group_name,
        s.primary_contact_number,
        s.date_of_birth,
        s.picture,
        s.class AS class_id,
        s.section AS section_id,
        c.class_name,
        sec.section_name,
        CONCAT(COALESCE(pf.first_name, ''), ' ', COALESCE(pf.last_name, '')) AS father_name,
        ay.academic_year
      FROM student_master s
      LEFT JOIN class_master c ON c.id = s.class
      LEFT JOIN section_master sec ON sec.id = s.section
      LEFT JOIN student_to_parent stp ON stp.student_id = s.id
      LEFT JOIN parent_master pf ON pf.id = stp.father_id
      LEFT JOIN academic_year_master ay ON ay.id = s.academic_year
      LEFT JOIN blood_group_master bg ON bg.id = s.blood_group
      WHERE s.school_id = ? AND (s.status = '1' OR s.status = 1)
    `;

    const params = [schoolId];

    if (Array.isArray(studentIds) && studentIds.length > 0) {
      const placeholders = studentIds.map(() => '?').join(',');
      query += ` AND s.id IN (${placeholders})`;
      params.push(...studentIds);
    } else {
      if (classId) {
        query += ` AND s.class = ?`;
        params.push(classId);
      }
      if (sectionId) {
        query += ` AND s.section = ?`;
        params.push(sectionId);
      }
    }

    query += ` GROUP BY s.id ORDER BY s.roll_number ASC, s.first_name ASC`;

    const [rows] = await pool.query(query, params);
    const bgMap = await AdminIdCardModel.getBloodGroupMap();

    return rows.map((student) => {
      const bg = student.blood_group_name || bgMap[String(student.blood_group)] || student.blood_group || '';
      return {
        candidate: {
          ...student,
          blood_group: String(bg).match(/^\d+$/) ? (bgMap[String(bg)] || '—') : (bg || '—'),
        },
        school,
        academic_year: student.academic_year || academicYearLabel,
      };
    });
  }

  /**
   * Fetch Teacher ID Card Data
   */
  static async getTeacherIdCardData({ schoolId, teacherIds = [] }) {
    const school = await AdminIdCardModel.getSchoolInfo(schoolId);

    let query = `
      SELECT 
        t.id,
        t.school_id,
        t.teacher_id,
        t.first_name,
        t.last_name,
        t.gender,
        t.primary_contact_number,
        t.email_address,
        t.blood_group,
        bg.blood_group AS blood_group_name,
        COALESCE(t.date_of_joining, t.created_on) AS date_of_joining,
        t.created_on,
        t.date_of_birth,
        t.qualification,
        t.subject,
        t.picture,
        t.status
      FROM teacher_master t
      LEFT JOIN blood_group_master bg ON bg.id = t.blood_group
      WHERE t.school_id = ? AND (t.status = '1' OR t.status = 1)
    `;
    const params = [schoolId];

    if (Array.isArray(teacherIds) && teacherIds.length > 0) {
      const placeholders = teacherIds.map(() => '?').join(',');
      query += ` AND t.id IN (${placeholders})`;
      params.push(...teacherIds);
    }

    query += ` ORDER BY t.first_name ASC, t.id ASC`;

    const [rows] = await pool.query(query, params);
    const bgMap = await AdminIdCardModel.getBloodGroupMap();

    return rows.map((teacher) => {
      const bg = teacher.blood_group_name || bgMap[String(teacher.blood_group)] || teacher.blood_group || '';
      return {
        candidate: {
          ...teacher,
          blood_group: String(bg).match(/^\d+$/) ? (bgMap[String(bg)] || '—') : (bg || '—'),
        },
        school,
      };
    });
  }

  /**
   * Fetch Staff ID Card Data
   */
  static async getStaffIdCardData({ schoolId, staffIds = [], roleId = null }) {
    const school = await AdminIdCardModel.getSchoolInfo(schoolId);

    let query = `
      SELECT 
        u.id,
        u.school_id,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        u.gender,
        u.blood_group,
        bg.blood_group AS blood_group_name,
        u.picture,
        u.role,
        r.role_name
      FROM user_master u
      LEFT JOIN role_master r ON r.id = u.role
      LEFT JOIN blood_group_master bg ON bg.id = u.blood_group
      WHERE u.school_id = ? AND u.status = 1
    `;
    const params = [schoolId];

    if (Array.isArray(staffIds) && staffIds.length > 0) {
      const placeholders = staffIds.map(() => '?').join(',');
      query += ` AND u.id IN (${placeholders})`;
      params.push(...staffIds);
    } else if (roleId) {
      query += ` AND u.role = ?`;
      params.push(roleId);
    }

    query += ` ORDER BY u.first_name ASC, u.id ASC`;

    const [rows] = await pool.query(query, params);
    const bgMap = await AdminIdCardModel.getBloodGroupMap();

    return rows.map((staff) => {
      const bg = staff.blood_group_name || bgMap[String(staff.blood_group)] || staff.blood_group || '';
      return {
        candidate: {
          ...staff,
          blood_group: String(bg).match(/^\d+$/) ? (bgMap[String(bg)] || '—') : (bg || '—'),
        },
        school,
      };
    });
  }
}

module.exports = AdminIdCardModel;
