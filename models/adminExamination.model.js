const { pool } = require('../config/db.config');

class AdminExaminationModel {
  // =========================================================
  // HELPER: GET CURRENT ACADEMIC YEAR ID
  // =========================================================
  static async getCurrentAcademicYearId(schoolId, examId) {
    try {
      if (examId) {
        const [ex] = await pool.query(
          `SELECT academic_year FROM exam_master WHERE id = ? AND school_id = ?`,
          [examId, schoolId]
        );
        if (ex.length > 0 && ex[0].academic_year) {
          return parseInt(ex[0].academic_year, 10);
        }
      }
      const [rows] = await pool.query(
        `SELECT id FROM academic_year_master 
         WHERE school_id = ?
           AND is_current = 1 
           AND (status != 4 OR status IS NULL) 
         ORDER BY id DESC LIMIT 1`,
        [schoolId]
      );
      if (rows.length > 0 && rows[0].id) {
        return rows[0].id;
      }
      const [fallback] = await pool.query(
        `SELECT id FROM academic_year_master 
         WHERE school_id = ?
           AND (status != 4 OR status IS NULL) 
         ORDER BY id DESC LIMIT 1`,
        [schoolId]
      );
      if (fallback.length > 0 && fallback[0].id) {
        return fallback[0].id;
      }
    } catch (e) {
      console.error('Error fetching current academic year:', e);
    }
    return null;
  }

  // =========================================================
  // 1. GRADE SETTINGS
  // =========================================================

  static async getAllGrades(schoolId, status) {
    let query = `
      SELECT 
        id,
        school_id,
        grade_name,
        min_percentage,
        max_percentage,
        status,
        created_on
      FROM grade_settings
      WHERE school_id = ?
    `;
    const params = [schoolId];

    if (status !== undefined && status !== null && status !== '') {
      query += ` AND status = ?`;
      params.push(status);
    } else {
      query += ` AND status != 4`;
    }

    query += ` ORDER BY min_percentage DESC`;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async getGradeById(id, schoolId) {
    let query = `
      SELECT id, school_id, grade_name, min_percentage, max_percentage, status, created_on
      FROM grade_settings
      WHERE id = ?
    `;
    const params = [id];
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  static async createGrade({ schoolId, gradeName, minPercentage, maxPercentage, status }) {
    const query = `
      INSERT INTO grade_settings (school_id, grade_name, min_percentage, max_percentage, status, created_on)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [
      schoolId,
      gradeName,
      minPercentage,
      maxPercentage,
      status !== undefined ? status : 1,
    ]);
    return result.insertId;
  }

  static async updateGrade(id, { gradeName, minPercentage, maxPercentage, status, schoolId }) {
    let query = `UPDATE grade_settings SET `;
    const params = [];
    const updates = [];

    if (gradeName !== undefined) {
      updates.push('grade_name = ?');
      params.push(gradeName);
    }
    if (minPercentage !== undefined) {
      updates.push('min_percentage = ?');
      params.push(minPercentage);
    }
    if (maxPercentage !== undefined) {
      updates.push('max_percentage = ?');
      params.push(maxPercentage);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) return false;

    query += updates.join(', ') + ' WHERE id = ?';
    params.push(id);

    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async deleteGrade(id, schoolId) {
    let query = `UPDATE grade_settings SET status = 4 WHERE id = ?`;
    const params = [id];
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 2. EXAM MASTER
  // =========================================================

  static async getAllExams(schoolId, academicYear, status) {
    let query = `
      SELECT 
        e.id,
        e.school_id,
        e.academic_year,
        e.exam AS exam_name,
        e.status,
        e.created_on,
        ay.academic_year AS academic_year_name,
        (SELECT COUNT(DISTINCT class_id) FROM exam_schedule WHERE exam_id = e.id) AS classes_count,
        (SELECT COUNT(id) FROM exam_schedule WHERE exam_id = e.id) AS schedules_count
      FROM exam_master e
      LEFT JOIN academic_year_master ay ON ay.id = e.academic_year
      WHERE e.school_id = ?
    `;
    const params = [schoolId];

    if (status !== undefined && status !== null && status !== '') {
      query += ` AND e.status = ?`;
      params.push(parseInt(status, 10));
    } else {
      query += ` AND (e.status != 4 OR e.status IS NULL)`;
    }

    if (academicYear) {
      query += ` AND e.academic_year = ?`;
      params.push(academicYear);
    }

    query += ` ORDER BY e.id DESC`;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async getExamById(id, schoolId) {
    let query = `
      SELECT 
        e.id,
        e.school_id,
        e.academic_year,
        e.exam AS exam_name,
        e.status,
        e.created_on,
        ay.academic_year AS academic_year_name
      FROM exam_master e
      LEFT JOIN academic_year_master ay ON ay.id = e.academic_year
      WHERE e.id = ? AND (e.status != 4 OR e.status IS NULL)
    `;
    const params = [id];
    if (schoolId) {
      query += ` AND e.school_id = ?`;
      params.push(schoolId);
    }
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  static async createExam({ schoolId, academicYear, examName, status }) {
    let resolvedYear = academicYear ? parseInt(academicYear, 10) : null;
    if (!resolvedYear) {
      resolvedYear = await AdminExaminationModel.getCurrentAcademicYearId(schoolId);
    }
    const query = `
      INSERT INTO exam_master (school_id, academic_year, exam, status, created_on)
      VALUES (?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [
      schoolId,
      resolvedYear,
      examName,
      status !== undefined ? parseInt(status, 10) : 1,
    ]);
    return result.insertId;
  }

  static async updateExam(id, { academicYear, examName, status, schoolId }) {
    let query = `UPDATE exam_master SET `;
    const params = [];
    const updates = [];

    if (academicYear !== undefined) {
      updates.push('academic_year = ?');
      params.push(academicYear);
    }
    if (examName !== undefined) {
      updates.push('exam = ?');
      params.push(examName);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (updates.length === 0) return false;

    query += updates.join(', ') + ' WHERE id = ?';
    params.push(id);

    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async deleteExam(id, schoolId) {
    // Check if student marks are recorded for this exam
    let marksQuery = `SELECT id FROM exam_result WHERE exam_id = ? AND status != 4`;
    const marksParams = [id];
    if (schoolId) {
      marksQuery += ` AND school_id = ?`;
      marksParams.push(schoolId);
    }
    marksQuery += ` LIMIT 1`;
    const [hasMarks] = await pool.query(marksQuery, marksParams);
    if (hasMarks.length > 0) {
      const err = new Error('Cannot delete this exam because student marks have already been recorded for it.');
      err.statusCode = 400;
      throw err;
    }

    let query = `UPDATE exam_master SET status = 4 WHERE id = ?`;
    const params = [id];
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 3. EXAM TYPES (Theory, Practical, Assessment, Viva, etc.)
  // =========================================================

  static async getAllExamTypes(schoolId, examId, status) {
    let query = `
      SELECT 
        et.id,
        et.school_id,
        et.academic_year,
        et.exam_id,
        et.exam_type,
        et.sort_order,
        et.status,
        et.created_at,
        e.exam AS exam_name
      FROM exam_type_master et
      LEFT JOIN exam_master e ON e.id = et.exam_id
      WHERE et.school_id = ?
    `;
    const params = [schoolId];

    if (status !== undefined && status !== null && status !== '') {
      query += ` AND et.status = ?`;
      params.push(status);
    } else {
      query += ` AND et.status != 4`;
    }

    if (examId) {
      query += ` AND et.exam_id = ?`;
      params.push(examId);
    }

    query += ` ORDER BY et.sort_order ASC, et.id ASC`;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async getExamTypeById(id, schoolId) {
    let query = `
      SELECT 
        et.id,
        et.school_id,
        et.academic_year,
        et.exam_id,
        et.exam_type,
        et.sort_order,
        et.status,
        et.created_at,
        e.exam AS exam_name
      FROM exam_type_master et
      LEFT JOIN exam_master e ON e.id = et.exam_id
      WHERE et.id = ?
    `;
    const params = [id];
    if (schoolId) {
      query += ` AND et.school_id = ?`;
      params.push(schoolId);
    }
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  static async createExamType({ schoolId, academicYear, examId, examType, sortOrder, status }) {
    let resolvedYear = academicYear ? parseInt(academicYear, 10) : null;
    if (!resolvedYear) {
      resolvedYear = await AdminExaminationModel.getCurrentAcademicYearId(schoolId, examId);
    }
    const query = `
      INSERT INTO exam_type_master (school_id, academic_year, exam_id, exam_type, sort_order, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [
      schoolId,
      resolvedYear,
      examId,
      examType,
      sortOrder || 1,
      status !== undefined ? status : 1,
    ]);
    return result.insertId;
  }

  static async updateExamType(id, { academicYear, examId, examType, sortOrder, status, schoolId }) {
    let query = `UPDATE exam_type_master SET `;
    const params = [];
    const updates = [];

    if (academicYear !== undefined) {
      updates.push('academic_year = ?');
      params.push(academicYear);
    }
    if (examId !== undefined) {
      updates.push('exam_id = ?');
      params.push(examId);
    }
    if (examType !== undefined) {
      updates.push('exam_type = ?');
      params.push(examType);
    }
    if (sortOrder !== undefined) {
      updates.push('sort_order = ?');
      params.push(sortOrder);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) return false;

    query += updates.join(', ') + ' WHERE id = ?';
    params.push(id);

    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async deleteExamType(id, schoolId) {
    // Check if this exam type is used in student results
    const [usedInMarks] = await pool.query(
      `SELECT ers.id FROM exam_result_subject ers
       JOIN exam_result er ON er.id = ers.exam_result_id
       WHERE ers.exam_type_id = ? AND ers.status != 4 AND er.status != 4
       LIMIT 1`,
      [id]
    );
    if (usedInMarks.length > 0) {
      const err = new Error('Cannot delete this exam type because student results have already been recorded with it.');
      err.statusCode = 400;
      throw err;
    }

    let query = `UPDATE exam_type_master SET status = 4 WHERE id = ?`;
    const params = [id];
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 4. EXAM SUBJECTS & MARKS CONFIGURATION
  // =========================================================

  static async getExamSubjectsList(schoolId, examId, classId) {
    let query = `
      SELECT 
        esm.id,
        esm.school_id,
        esm.exam_id,
        esm.class_id,
        esm.status,
        esm.created_at,
        e.exam AS exam_name,
        c.class_name,
        COUNT(DISTINCT esmarks.subject_id) AS subjects_count,
        COALESCE(SUM(esmarks.mark), 0) AS total_max_marks
      FROM exam_subject_master esm
      LEFT JOIN exam_master e ON e.id = esm.exam_id
      LEFT JOIN class_master c ON c.id = esm.class_id
      LEFT JOIN exam_subject_marks esmarks ON esmarks.exam_subject_id = esm.id AND esmarks.status != 4
      WHERE esm.school_id = ?
        AND esm.status != 4
    `;
    const params = [schoolId];

    if (examId) {
      query += ` AND esm.exam_id = ?`;
      params.push(examId);
    }
    if (classId) {
      query += ` AND esm.class_id = ?`;
      params.push(classId);
    }

    query += `
      GROUP BY esm.id, esm.school_id, esm.exam_id, esm.class_id, esm.status, esm.created_at, e.exam, c.class_name
      ORDER BY esm.id DESC
    `;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async isExamPatternLocked({ schoolId, examId, classId }) {
    if (!schoolId || !examId || !classId) {
      return { isLocked: false, lockReason: null };
    }

    // 1. Check if student marks are already recorded for this exam and class
    const [results] = await pool.query(
      `SELECT id FROM exam_result 
       WHERE school_id = ? AND exam_id = ? AND class_id = ? AND status != 4 
       LIMIT 1`,
      [schoolId, examId, classId]
    );
    if (results.length > 0) {
      return {
        isLocked: true,
        lockReason: 'Student marks have already been recorded for this exam and class.',
      };
    }

    // 2. Check if student attendance is already marked for this exam and class
    const [attendance] = await pool.query(
      `SELECT id FROM exam_attendance 
       WHERE school_id = ? AND exam_id = ? AND class_id = ? AND status != 4 
       LIMIT 1`,
      [schoolId, examId, classId]
    );
    if (attendance.length > 0) {
      return {
        isLocked: true,
        lockReason: 'Exam attendance has already been recorded for this exam and class.',
      };
    }

    // 3. Check if exam schedule has already taken place or been completed
    const [schedules] = await pool.query(
      `SELECT id, date, status FROM exam_schedule 
       WHERE school_id = ? AND exam_id = ? AND class_id = ? AND (status != 4 OR status IS NULL)
         AND (status = 2 OR date < CURDATE() OR (date = CURDATE() AND end_time <= CURTIME()))
       LIMIT 1`,
      [schoolId, examId, classId]
    );
    if (schedules.length > 0) {
      return {
        isLocked: true,
        lockReason: 'The exam schedule for this class has already taken place or been marked completed.',
      };
    }

    return { isLocked: false, lockReason: null };
  }

  static async getTeacherAssignedSubjectIds({ schoolId, teacherId, classId }) {
    if (!teacherId || !classId) return [];
    try {
      const sql = `
        SELECT DISTINCT COALESCE(sm_target.id, tca.subject_id) AS subject_id 
        FROM teacher_class_assign tca 
        LEFT JOIN subject_master sm_assigned ON sm_assigned.id = tca.subject_id 
        LEFT JOIN subject_master sm_target ON (
          sm_target.id = tca.subject_id 
          OR (LOWER(TRIM(sm_target.subject_name)) = LOWER(TRIM(sm_assigned.subject_name)) 
              AND sm_target.class_id = tca.class_id 
              AND sm_target.status = 1)
        ) 
        WHERE tca.school_id = ? 
          AND tca.teacher_id = ? 
          AND tca.class_id = ? 
          AND tca.status = 1
      `;
      const [rows] = await pool.query(sql, [schoolId, teacherId, classId]);
      return rows.map((r) => Number(r.subject_id)).filter(Boolean);
    } catch (e) {
      console.error('Error in getTeacherAssignedSubjectIds:', e.message);
      return [];
    }
  }

  static async getExamSubjectConfig({ schoolId, examId, classId, configuredOnly = false, teacherId = null }) {
    const lockStatus = await AdminExaminationModel.isExamPatternLocked({ schoolId, examId, classId });

    // 1. Get existing exam_subject_master if exists
    const [existingMaster] = await pool.query(
      `SELECT id, status FROM exam_subject_master 
       WHERE school_id = ? 
         AND exam_id = ? 
         AND class_id = ? 
         AND status != 4 
       LIMIT 1`,
      [schoolId, examId, classId]
    );

    const masterId = existingMaster.length > 0 ? existingMaster[0].id : null;
    const masterStatus = existingMaster.length > 0 ? existingMaster[0].status : null;
    const isMasterActive = masterStatus === 1;

    let configuredMarks = [];
    if (masterId && isMasterActive) {
      const [marks] = await pool.query(
        `SELECT subject_id, exam_type_id, mark, mark AS full_mark, is_check 
         FROM exam_subject_marks 
         WHERE exam_subject_id = ? AND status != 4`,
        [masterId]
      );
      configuredMarks = marks;
    }

    // If configuredOnly is requested and no active exam_subject_master or no marks found
    if (configuredOnly && (!masterId || !isMasterActive || configuredMarks.length === 0)) {
      return {
        examSubjectMasterId: masterId,
        status: masterStatus,
        hasConfig: false,
        isLocked: lockStatus.isLocked,
        lockReason: lockStatus.lockReason,
        subjects: [],
        examTypes: [],
        configuredMarks: [],
      };
    }

    // 2. Get subjects
    let subjects = [];
    if (configuredOnly && masterId) {
      const [confSubs] = await pool.query(
        `SELECT DISTINCT sm.id AS subject_id, sm.subject_name 
         FROM subject_master sm
         JOIN exam_subject_marks esm_marks ON esm_marks.subject_id = sm.id
         WHERE esm_marks.exam_subject_id = ? 
           AND esm_marks.status != 4 
           AND (esm_marks.is_check = 1 OR esm_marks.mark > 0)
           AND sm.school_id = ?
           AND sm.class_id = ?
           AND sm.status = 1
           AND sm.status != 4
         ORDER BY sm.sort_order ASC, sm.id ASC`,
        [masterId, schoolId, classId]
      );
      subjects = confSubs || [];
    } else {
      // For Add / Edit screen: strictly load active (status = 1) subjects for this specific class
      const [allSubs] = await pool.query(
        `SELECT id AS subject_id, subject_name 
         FROM subject_master 
         WHERE school_id = ? 
           AND class_id = ?
           AND status = 1
           AND status != 4
         ORDER BY sort_order ASC, id ASC`,
        [schoolId, classId]
      );
      subjects = allSubs || [];
    }

    // 3. Get exam types for this exam
    let examTypeQuery = `
      SELECT id AS exam_type_id, exam_type, sort_order 
      FROM exam_type_master 
      WHERE school_id = ? 
        AND status = 1
        AND status != 4
    `;
    const examTypeParams = [schoolId];
    if (examId) {
      examTypeQuery += ` AND (exam_id = ? OR exam_id IS NULL OR exam_id = 0)`;
      examTypeParams.push(examId);
    }
    examTypeQuery += ` ORDER BY sort_order ASC, id ASC`;
    let [examTypes] = await pool.query(examTypeQuery, examTypeParams);

    if (!examTypes || examTypes.length === 0) {
      const [fallbackTypes] = await pool.query(
        `SELECT id AS exam_type_id, exam_type, sort_order FROM exam_type_master WHERE school_id = ? AND status = 1 AND status != 4 ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      examTypes = fallbackTypes || [];
    }

    // Attach full mark for each exam type from configuredMarks
    const examTypesWithMarks = examTypes.map((et) => {
      const foundMark = configuredMarks.find((cm) => cm.exam_type_id === et.exam_type_id && cm.mark > 0);
      return {
        ...et,
        mark: foundMark ? foundMark.mark : (et.mark || null),
      };
    });

    let assignedSubjectIds = null;
    if (teacherId) {
      assignedSubjectIds = await AdminExaminationModel.getTeacherAssignedSubjectIds({
        schoolId,
        teacherId,
        classId,
      });
    }

    const taggedSubjects = subjects.map((sub) => ({
      ...sub,
      isEditable: teacherId ? assignedSubjectIds.includes(Number(sub.subject_id)) : true,
    }));

    return {
      examSubjectMasterId: masterId,
      status: masterStatus,
      hasConfig: isMasterActive && configuredMarks.length > 0 && subjects.length > 0,
      isLocked: lockStatus.isLocked,
      lockReason: lockStatus.lockReason,
      subjects: taggedSubjects,
      examTypes: examTypesWithMarks,
      configuredMarks,
      assignedSubjectIds: teacherId ? assignedSubjectIds : null,
      isTeacherUser: Boolean(teacherId),
    };
  }

  static async saveExamSubjectConfig({ schoolId, examId, classId, items }) {
    // Security check: Lock pattern if exam is conducted / marks recorded
    const lockStatus = await AdminExaminationModel.isExamPatternLocked({ schoolId, examId, classId });
    if (lockStatus.isLocked) {
      const err = new Error(`This exam pattern is locked and cannot be modified: ${lockStatus.lockReason}`);
      err.statusCode = 400;
      throw err;
    }

    // Filter valid marks (must be checked and mark > 0)
    const validItems = (items || []).filter(
      (it) =>
        (it.isCheck === 1 || it.is_check === 1 || it.isCheck === true || it.is_check === true) &&
        (parseInt(it.mark, 10) > 0)
    );

    if (validItems.length === 0) {
      const err = new Error('Cannot configure exam subjects without marks. Please specify marks greater than 0 for at least one subject.');
      err.statusCode = 400;
      throw err;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Get or create exam_subject_master
      const [existing] = await connection.query(
        `SELECT id FROM exam_subject_master WHERE exam_id = ? AND class_id = ? AND school_id = ?`,
        [examId, classId, schoolId]
      );

      let examSubjectId;
      if (existing.length > 0) {
        examSubjectId = existing[0].id;
        await connection.query(`UPDATE exam_subject_master SET status = 1 WHERE id = ?`, [examSubjectId]);
      } else {
        const [ins] = await connection.query(
          `INSERT INTO exam_subject_master (school_id, exam_id, class_id, status, created_at) VALUES (?, ?, ?, 1, NOW())`,
          [schoolId, examId, classId]
        );
        examSubjectId = ins.insertId;
      }

      // 2. Delete existing exam_subject_marks
      await connection.query(`DELETE FROM exam_subject_marks WHERE exam_subject_id = ?`, [examSubjectId]);

      // 3. Bulk insert new configured marks
      const values = validItems.map((it) => [
        schoolId,
        examSubjectId,
        it.subjectId || it.subject_id,
        1,
        it.examTypeId || it.exam_type_id,
        parseInt(it.mark, 10),
        1,
        new Date(),
      ]);

      const insertQuery = `
        INSERT INTO exam_subject_marks (school_id, exam_subject_id, subject_id, is_check, exam_type_id, mark, status, created_on)
        VALUES ?
      `;
      await connection.query(insertQuery, [values]);

      await connection.commit();
      return examSubjectId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async deleteExamSubject(id, schoolId = null) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Security check: Lock pattern if exam is conducted / marks recorded
      let checkQuery = `SELECT school_id, exam_id, class_id FROM exam_subject_master WHERE id = ?`;
      const checkParams = [id];
      if (schoolId) {
        checkQuery += ` AND school_id = ?`;
        checkParams.push(schoolId);
      }
      const [existing] = await connection.query(checkQuery, checkParams);
      if (existing.length > 0) {
        const lockStatus = await AdminExaminationModel.isExamPatternLocked({
          schoolId: existing[0].school_id,
          examId: existing[0].exam_id,
          classId: existing[0].class_id,
        });
        if (lockStatus.isLocked) {
          const err = new Error(`Cannot delete this exam configuration: ${lockStatus.lockReason}`);
          err.statusCode = 400;
          throw err;
        }
      }

      await connection.query(`UPDATE exam_subject_marks SET status = 4 WHERE exam_subject_id = ?`, [id]);
      const [res] = await connection.query(`UPDATE exam_subject_master SET status = 4 WHERE id = ?`, [id]);
      await connection.commit();
      return res.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // =========================================================
  // 5. EXAM SCHEDULES
  // =========================================================

  static async getExamSchedules({ schoolId, examId, classId, subjectId, academicYearId, teacherId, assignedOnly = false }) {
    let query = `
      SELECT 
        es.id,
        es.school_id,
        es.academic_year_id,
        es.exam_id,
        es.class_id,
        es.subject_id,
        es.date,
        es.start_time,
        es.end_time,
        es.status,
        es.created_on,
        e.exam AS exam_name,
        e.academic_year AS exam_academic_year,
        c.class_name,
        s.subject_name,
        ay.academic_year AS academic_year_name
      FROM exam_schedule es
      LEFT JOIN exam_master e ON e.id = es.exam_id
      LEFT JOIN class_master c ON c.id = es.class_id
      LEFT JOIN subject_master s ON s.id = es.subject_id
      LEFT JOIN academic_year_master ay ON ay.id = COALESCE(NULLIF(es.academic_year_id, 0), e.academic_year)
      WHERE es.school_id = ?
        AND (es.status != 4 OR es.status IS NULL)
    `;
    const params = [schoolId];

    if (examId) {
      query += ` AND es.exam_id = ?`;
      params.push(examId);
    }
    if (classId) {
      query += ` AND es.class_id = ?`;
      params.push(classId);
    }
    if (subjectId) {
      query += ` AND es.subject_id = ?`;
      params.push(subjectId);
    }
    if (academicYearId) {
      query += ` AND (es.academic_year_id = ? OR (es.academic_year_id IS NULL AND e.academic_year = ?) OR (es.academic_year_id = 0 AND e.academic_year = ?))`;
      params.push(academicYearId, academicYearId, academicYearId);
    }

    query += ` GROUP BY es.id ORDER BY es.date ASC, es.start_time ASC, es.id ASC`;
    const [rows] = await pool.query(query, params);

    if (teacherId && classId) {
      const assignedSubjectIds = await AdminExaminationModel.getTeacherAssignedSubjectIds({
        schoolId,
        teacherId,
        classId,
      });

      let mappedRows = rows.map((row) => ({
        ...row,
        isEditable: assignedSubjectIds.includes(Number(row.subject_id)),
      }));

      if (assignedOnly) {
        mappedRows = mappedRows.filter((row) => row.isEditable);
      }

      return mappedRows;
    }

    if (teacherId && !classId && assignedOnly) {
      const [assignRows] = await pool.query(
        `SELECT DISTINCT subject_id, class_id FROM teacher_class_assign WHERE school_id = ? AND teacher_id = ? AND status = 1`,
        [schoolId, teacherId]
      );
      const assignedMap = new Set(assignRows.map((r) => `${r.class_id}_${r.subject_id}`));
      return rows
        .filter((row) => assignedMap.has(`${row.class_id}_${row.subject_id}`))
        .map((row) => ({ ...row, isEditable: true }));
    }

    return rows.map((row) => ({
      ...row,
      isEditable: true,
    }));
  }

  static async getExamScheduleById(id, schoolId) {
    let query = `
      SELECT 
        es.id,
        es.school_id,
        es.academic_year_id,
        es.exam_id,
        es.class_id,
        es.subject_id,
        es.date,
        es.start_time,
        es.end_time,
        es.status,
        es.created_on,
        e.exam AS exam_name,
        c.class_name,
        s.subject_name
      FROM exam_schedule es
      LEFT JOIN exam_master e ON e.id = es.exam_id
      LEFT JOIN class_master c ON c.id = es.class_id
      LEFT JOIN subject_master s ON s.id = es.subject_id
      WHERE es.id = ? AND (es.status != 4 OR es.status IS NULL)
    `;
    const params = [id];
    if (schoolId) {
      query += ` AND es.school_id = ?`;
      params.push(schoolId);
    }
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  static async createExamSchedule({
    schoolId,
    academicYearId,
    examId,
    classId,
    subjectId,
    date,
    startTime,
    endTime,
    status,
  }) {
    let resolvedYear = academicYearId ? parseInt(academicYearId, 10) : null;
    if (!resolvedYear) {
      resolvedYear = await AdminExaminationModel.getCurrentAcademicYearId(schoolId, examId);
    }
    const query = `
      INSERT INTO exam_schedule (school_id, academic_year_id, exam_id, class_id, subject_id, date, start_time, end_time, status, created_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [
      schoolId,
      resolvedYear,
      examId,
      classId,
      subjectId,
      date,
      startTime,
      endTime,
      status !== undefined ? status : 1,
    ]);
    return result.insertId;
  }

  static async updateExamSchedule(id, {
    academicYearId,
    examId,
    classId,
    subjectId,
    date,
    startTime,
    endTime,
    status,
    schoolId,
  }) {
    let query = `UPDATE exam_schedule SET `;
    const params = [];
    const updates = [];

    if (academicYearId !== undefined) {
      updates.push('academic_year_id = ?');
      params.push(academicYearId);
    }
    if (examId !== undefined) {
      updates.push('exam_id = ?');
      params.push(examId);
    }
    if (classId !== undefined) {
      updates.push('class_id = ?');
      params.push(classId);
    }
    if (subjectId !== undefined) {
      updates.push('subject_id = ?');
      params.push(subjectId);
    }
    if (date !== undefined) {
      updates.push('date = ?');
      params.push(date);
    }
    if (startTime !== undefined) {
      updates.push('start_time = ?');
      params.push(startTime);
    }
    if (endTime !== undefined) {
      updates.push('end_time = ?');
      params.push(endTime);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) return false;

    query += updates.join(', ') + ' WHERE id = ?';
    params.push(id);

    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async deleteExamSchedule(id, schoolId) {
    let query = `UPDATE exam_schedule SET status = 4 WHERE id = ?`;
    const params = [id];
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 5. EXAM ATTENDANCE
  // =========================================================

  static async getStudentsForExamAttendance({ schoolId, examId, classId, sectionId, subjectId, examScheduleId, academicYearId, roster, page = 1, limit = 10, search, teacherId }) {
    // 1. Query existing attendance records for this exam & class (and subject if provided)
    let attQuery = `
      SELECT 
        ea.id AS attendance_id,
        ea.student_id,
        ea.subject_id,
        ea.attendance_status,
        sm.admission_number AS admission_no,
        sm.roll_number AS roll_no,
        sm.first_name,
        sm.last_name,
        cm.class_name,
        sec.section_name,
        sub_master.subject_name
      FROM exam_attendance ea
      LEFT JOIN student_master sm ON sm.id = ea.student_id
      LEFT JOIN class_master cm ON cm.id = ea.class_id
      LEFT JOIN section_master sec ON sec.id = sm.section
      LEFT JOIN subject_master sub_master ON sub_master.id = ea.subject_id
      WHERE ea.status != 4
        AND ea.school_id = ?
        AND ea.exam_id = ?
        AND ea.class_id = ?
    `;
    const attParams = [schoolId, examId, classId];
    if (academicYearId) {
      attQuery += ` AND (ea.academic_year_id = ? OR (ea.academic_year_id IS NULL AND EXISTS (SELECT 1 FROM exam_master em WHERE em.id = ea.exam_id AND em.academic_year = ?)))`;
      attParams.push(academicYearId, academicYearId);
    }
    if (subjectId) {
      attQuery += ` AND ea.subject_id = ?`;
      attParams.push(subjectId);
    }
    if (sectionId) {
      attQuery += ` AND sm.section = ?`;
      attParams.push(sectionId);
    }
    if (search && String(search).trim()) {
      const sp = `%${String(search).trim()}%`;
      attQuery += ` AND (sm.first_name LIKE ? OR sm.last_name LIKE ? OR CONCAT(sm.first_name, ' ', sm.last_name) LIKE ? OR sm.admission_number LIKE ? OR sm.roll_number LIKE ?)`;
      attParams.push(sp, sp, sp, sp, sp);
    }
    attQuery += ` ORDER BY sec.sort_order ASC, sec.section_name ASC, CAST(sm.roll_number AS UNSIGNED) ASC, sm.first_name ASC`;
    const [attRows] = await pool.query(attQuery, attParams);

    const hasAttendance = attRows.length > 0;

    // 2. If roster is requested (e.g. for AddExamAttendance marking form)
    if (roster) {
      // First verify that an active exam schedule exists for this exam, class (and subject if provided)
      let schedQuery = `
        SELECT id, subject_id, date, start_time, end_time 
        FROM exam_schedule 
        WHERE school_id = ? AND exam_id = ? AND class_id = ? AND (status != 4 OR status IS NULL)
      `;
      const schedParams = [schoolId, examId, classId];
      if (academicYearId) {
        schedQuery += ` AND (academic_year_id = ? OR academic_year_id = 0 OR academic_year_id IS NULL)`;
        schedParams.push(academicYearId);
      }
      if (subjectId) {
        schedQuery += ` AND subject_id = ?`;
        schedParams.push(subjectId);
      }
      if (examScheduleId) {
        schedQuery += ` AND id = ?`;
        schedParams.push(examScheduleId);
      }
      schedQuery += ` ORDER BY id ASC`;
      const [scheduleRows] = await pool.query(schedQuery, schedParams);

      if (!scheduleRows || scheduleRows.length === 0) {
        return {
          subjects: [],
          students: [],
          rawAttendance: [],
          hasAttendance: false,
          isLocked: false,
          hasSchedule: false,
          examSchedule: null,
          message: 'No active exam schedule found for the selected exam, class, and subject.',
        };
      }

      let studentQuery = `
        SELECT 
          s.id AS student_id,
          s.school_id,
          s.first_name,
          s.last_name,
          s.admission_number AS admission_no,
          s.roll_number AS roll_no,
          s.class AS class_id,
          s.section AS section_id,
          c.class_name,
          sec.section_name
        FROM student_master s
        LEFT JOIN class_master c ON c.id = s.class
        LEFT JOIN section_master sec ON sec.id = s.section
        WHERE s.school_id = ?
          AND s.class = ?
          AND s.status = 1
      `;
      const studentParams = [schoolId, classId];
      if (sectionId) {
        studentQuery += ` AND s.section = ?`;
        studentParams.push(sectionId);
      }
      studentQuery += ` ORDER BY sec.sort_order ASC, sec.section_name ASC, CAST(s.roll_number AS UNSIGNED) ASC, s.first_name ASC`;
      const [students] = await pool.query(studentQuery, studentParams);

      const studentAttMap = {};
      attRows.forEach((row) => {
        studentAttMap[row.student_id] = row.attendance_status;
      });

      const studentsWithAttendance = students.map((st) => ({
        ...st,
        attendance_status: studentAttMap[st.student_id] !== undefined ? studentAttMap[st.student_id] : null,
        subjectAttendance: studentAttMap[st.student_id] !== undefined ? { [subjectId]: studentAttMap[st.student_id] } : {},
      }));

      let isSubjectEditable = true;
      if (teacherId && classId && subjectId) {
        const assignedSubjectIds = await AdminExaminationModel.getTeacherAssignedSubjectIds({
          schoolId,
          teacherId,
          classId,
        });
        isSubjectEditable = assignedSubjectIds.includes(Number(subjectId));
      }

      return {
        subjects: [],
        students: studentsWithAttendance,
        rawAttendance: attRows,
        hasAttendance,
        isLocked: hasAttendance,
        hasSchedule: true,
        examSchedule: scheduleRows[0] || null,
        isSubjectEditable,
        isTeacherUser: Boolean(teacherId),
      };
    }

    // 3. For ExamAttendance view table: return existing records matrix if attendance exists
    if (hasAttendance) {
      // Query all distinct subjects for this exam & class so all column headers exist
      let subQuery = `
        SELECT DISTINCT ea.subject_id, sub.subject_name 
        FROM exam_attendance ea 
        LEFT JOIN subject_master sub ON sub.id = ea.subject_id 
        WHERE ea.status != 4 AND ea.school_id = ? AND ea.exam_id = ? AND ea.class_id = ?
      `;
      const subParams = [schoolId, examId, classId];
      if (academicYearId) {
        subQuery += ` AND (ea.academic_year_id = ? OR (ea.academic_year_id IS NULL AND EXISTS (SELECT 1 FROM exam_master em WHERE em.id = ea.exam_id AND em.academic_year = ?)))`;
        subParams.push(academicYearId, academicYearId);
      }
      subQuery += ` ORDER BY ea.subject_id ASC`;
      const [allExamSubjects] = await pool.query(subQuery, subParams);

      const subjectMap = {};
      if (allExamSubjects && allExamSubjects.length > 0) {
        allExamSubjects.forEach((sub) => {
          subjectMap[sub.subject_id] = {
            subject_id: sub.subject_id,
            subject_name: sub.subject_name || `Subject #${sub.subject_id}`,
          };
        });
      }

      const studentMap = {};

      attRows.forEach((row) => {
        if (row.subject_id && !subjectMap[row.subject_id]) {
          subjectMap[row.subject_id] = {
            subject_id: row.subject_id,
            subject_name: row.subject_name || `Subject #${row.subject_id}`,
          };
        }

        if (!studentMap[row.student_id]) {
          studentMap[row.student_id] = {
            student_id: row.student_id,
            admission_no: row.admission_no || '',
            roll_no: row.roll_no || '',
            first_name: row.first_name || '',
            last_name: row.last_name || '',
            class_name: row.class_name || '',
            attendance_status: row.attendance_status,
            subjectAttendance: {},
          };
        }

        studentMap[row.student_id].subjectAttendance[row.subject_id] = row.attendance_status;
      });

      const allStudents = Object.values(studentMap);
      const total = allStudents.length;
      const numLimit = Math.max(1, Number(limit) || 10);
      const numPage = Math.max(1, Number(page) || 1);
      const totalPages = Math.ceil(total / numLimit) || 1;
      const offset = (numPage - 1) * numLimit;
      const paginatedStudents = allStudents.slice(offset, offset + numLimit);

      return {
        subjects: Object.values(subjectMap),
        students: paginatedStudents,
        rawAttendance: attRows,
        hasAttendance: true,
        isLocked: true,
        total,
        page: numPage,
        limit: numLimit,
        totalPages,
      };
    }

    // Default: return empty data if no attendance records exist
    return {
      subjects: [],
      students: [],
      rawAttendance: [],
      hasAttendance: false,
      isLocked: false,
      total: 0,
      page: Number(page) || 1,
      limit: Number(limit) || 10,
      totalPages: 1,
    };
  }

  static async saveExamAttendanceBatch({
    schoolId,
    academicYearId,
    examId,
    classId,
    sectionId,
    subjectId,
    examScheduleId,
    records,
    userRole = '',
    isTeacher = false,
    isAdminOrSchool = null,
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      if (!subjectId) {
        throw new Error('Subject ID is required to save exam attendance.');
      }

      // 1. Resolve academic_year_id
      let resolvedYearId = academicYearId ? parseInt(academicYearId, 10) : null;
      if (!resolvedYearId) {
        resolvedYearId = await AdminExaminationModel.getCurrentAcademicYearId(schoolId, examId);
      }

      // 2. Fetch exam_schedule_id and date directly from exam_schedule table
      let resolvedScheduleId = examScheduleId ? parseInt(examScheduleId, 10) : null;
      let scheduleDate = null;

      let [schedRows] = await connection.query(
        resolvedScheduleId
          ? `SELECT id, date FROM exam_schedule WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL) LIMIT 1`
          : `SELECT id, date FROM exam_schedule 
             WHERE school_id = ?
               AND exam_id = ? 
               AND class_id = ? 
               AND subject_id = ? 
               AND (academic_year_id = ? OR academic_year_id = 0 OR academic_year_id IS NULL)
               AND (status != 4 OR status IS NULL)
             ORDER BY id DESC LIMIT 1`,
        resolvedScheduleId ? [resolvedScheduleId, schoolId] : [schoolId, examId, classId, subjectId, resolvedYearId]
      );

      if (!schedRows || schedRows.length === 0) {
        const [fallbackRows] = await connection.query(
          `SELECT id, date FROM exam_schedule 
           WHERE school_id = ?
             AND exam_id = ? 
             AND class_id = ? 
             AND subject_id = ? 
             AND (status != 4 OR status IS NULL)
           ORDER BY id DESC LIMIT 1`,
          [schoolId, examId, classId, subjectId]
        );
        schedRows = fallbackRows;
      }

      if (schedRows && schedRows.length > 0) {
        resolvedScheduleId = schedRows[0].id;
        scheduleDate = schedRows[0].date;
      }

      if (!resolvedScheduleId) {
        await connection.rollback();
        const err = new Error('Cannot save attendance: No active exam schedule found for this exam, class, and subject. Please schedule the exam first.');
        err.statusCode = 400;
        throw err;
      }

      // 3. Role-Based Date Validation:
      // School Administration (Super Admin, Admin, School Staff) can record or update attendance at any time.
      // Teachers can record attendance for their exams; past exams cannot be altered by teachers without admin intervention.
      const normalizedRole = String(userRole || '').toLowerCase().trim();
      const resolvedIsAdmin =
        isAdminOrSchool !== null
          ? Boolean(isAdminOrSchool)
          : (!isTeacher ||
             normalizedRole.includes('admin') ||
             normalizedRole === 'school' ||
             normalizedRole === 'super admin' ||
             normalizedRole === 'staff');

      if (!resolvedIsAdmin && scheduleDate) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        let examDateStr = '';
        if (typeof scheduleDate === 'string') {
          examDateStr = scheduleDate.slice(0, 10);
        } else if (scheduleDate instanceof Date) {
          const ey = scheduleDate.getFullYear();
          const em = String(scheduleDate.getMonth() + 1).padStart(2, '0');
          const ed = String(scheduleDate.getDate()).padStart(2, '0');
          examDateStr = `${ey}-${em}-${ed}`;
        }

        if (examDateStr && todayStr > examDateStr) {
          await connection.rollback();
          const err = new Error(
            `Attendance Locked: The scheduled exam date (${examDateStr}) has passed. Staff and teachers cannot alter past exam attendance. Please contact the school administration for any corrections.`
          );
          err.statusCode = 403;
          throw err;
        }
      }

      // 4. Upsert attendance records for each submitted student (safe for multi-section and updates)
      for (const rec of records) {
        const { studentId, attendanceStatus } = rec;
        const statusVal = attendanceStatus !== undefined && attendanceStatus !== null ? attendanceStatus : 1;

        // Check if attendance already exists for this specific student, exam, and subject
        const [existingStudentAtt] = await connection.query(
          `SELECT id FROM exam_attendance 
           WHERE school_id = ?
             AND exam_id = ?
             AND class_id = ?
             AND subject_id = ?
             AND student_id = ?
             AND status != 4
           LIMIT 1`,
          [schoolId, examId, classId, subjectId, studentId]
        );

        if (existingStudentAtt && existingStudentAtt.length > 0) {
          // Update existing record
          await connection.query(
            `UPDATE exam_attendance 
             SET attendance_status = ?, exam_schedule_id = ?, academic_year_id = ?
             WHERE id = ?`,
            [statusVal, resolvedScheduleId, resolvedYearId || 1, existingStudentAtt[0].id]
          );
        } else {
          // Insert new record
          await connection.query(
            `INSERT INTO exam_attendance (school_id, exam_id, class_id, academic_year_id, student_id, subject_id, exam_schedule_id, attendance_status, status, created_on)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
            [
              schoolId,
              examId,
              classId,
              resolvedYearId || 1,
              studentId,
              subjectId,
              resolvedScheduleId,
              statusVal,
            ]
          );
        }
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // =========================================================
  // 6. EXAM RESULTS & MARKS
  // =========================================================

  static async getExamResultsList({ schoolId, examId, classId, sectionId, academicYearId }) {
    let query = `
      SELECT 
        er.id,
        er.school_id,
        er.academic_year_id,
        er.student_id,
        er.exam_id,
        er.class_id,
        er.status,
        er.created_on,
        s.first_name,
        s.last_name,
        s.admission_number AS admission_no,
        s.roll_number AS roll_no,
        c.class_name,
        sec.section_name,
        e.exam AS exam_name
      FROM exam_result er
      LEFT JOIN student_master s ON s.id = er.student_id
      LEFT JOIN class_master c ON c.id = er.class_id
      LEFT JOIN section_master sec ON sec.id = s.section
      LEFT JOIN exam_master e ON e.id = er.exam_id
      WHERE er.school_id = ?
        AND er.status != 4
    `;
    const params = [schoolId];

    if (examId) {
      query += ` AND er.exam_id = ?`;
      params.push(examId);
    }
    if (classId) {
      query += ` AND er.class_id = ?`;
      params.push(classId);
    }
    if (sectionId) {
      query += ` AND s.section = ?`;
      params.push(sectionId);
    }
    if (academicYearId) {
      query += ` AND er.academic_year_id = ?`;
      params.push(academicYearId);
    }

    query += ` ORDER BY s.roll_number ASC, s.first_name ASC`;
    const [results] = await pool.query(query, params);

    if (results.length === 0) {
      return { subjects: [], results: [] };
    }

    const resultIds = results.map((r) => r.id);
    const [marksRows] = await pool.query(
      `SELECT 
         ers.id,
         ers.exam_result_id,
         ers.subject_id,
         ers.exam_type_id,
         ers.marks,
         ers.grade_id,
         sub.subject_name,
         g.grade_name
       FROM exam_result_subject ers
       LEFT JOIN subject_master sub ON sub.id = ers.subject_id
       LEFT JOIN grade_settings g ON g.id = ers.grade_id
       WHERE ers.exam_result_id IN (?) AND ers.status != 4`,
      [resultIds]
    );

    const subjectsMap = {};

    if (classId) {
      const [classSubs] = await pool.query(
        `SELECT id AS subject_id, subject_name FROM subject_master WHERE class_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [classId]
      );
      classSubs.forEach((s) => {
        subjectsMap[s.subject_id] = {
          subject_id: s.subject_id,
          subject_name: s.subject_name,
          max_marks: 100,
        };
      });
    }

    // Check configured subject marks
    if (examId && classId) {
      try {
        const [configMarks] = await pool.query(
          `SELECT esm_marks.subject_id, COALESCE(SUM(esm_marks.mark), 100) AS subject_max_mark
           FROM exam_subject_master esm
           JOIN exam_subject_marks esm_marks ON esm_marks.exam_subject_id = esm.id AND esm_marks.status != 4 AND esm_marks.is_check = 1
           WHERE esm.school_id = ?
             AND esm.exam_id = ? AND esm.class_id = ? AND esm.status != 4
           GROUP BY esm_marks.subject_id`,
          [schoolId, examId, classId]
        );
        configMarks.forEach((cm) => {
          if (subjectsMap[cm.subject_id]) {
            subjectsMap[cm.subject_id].max_marks = parseFloat(cm.subject_max_mark) || 100;
          }
        });
      } catch (err) {
        console.error('Error fetching configured max marks:', err);
      }
    }

    marksRows.forEach((m) => {
      if (m.subject_id && !subjectsMap[m.subject_id]) {
        subjectsMap[m.subject_id] = {
          subject_id: m.subject_id,
          subject_name: m.subject_name || `Subject #${m.subject_id}`,
          max_marks: 100,
        };
      }
    });

    const subjectsList = Object.values(subjectsMap);
    const totalPossibleMaxMarks = subjectsList.reduce((acc, sub) => acc + (parseFloat(sub.max_marks) || 100), 0);

    const resultsWithMarks = results.map((r) => {
      const studentMarks = marksRows.filter((m) => m.exam_result_id === r.id);
      const subjectTotals = {};
      let overallTotal = 0;

      studentMarks.forEach((m) => {
        if (!subjectTotals[m.subject_id]) {
          subjectTotals[m.subject_id] = {
            total_marks: 0,
            grade_name: m.grade_name || '',
          };
        }
        subjectTotals[m.subject_id].total_marks += parseFloat(m.marks) || 0;
        if (m.grade_name) {
          subjectTotals[m.subject_id].grade_name = m.grade_name;
        }
        overallTotal += parseFloat(m.marks) || 0;
      });

      const maxMarks = totalPossibleMaxMarks > 0 ? totalPossibleMaxMarks : (subjectsList.length * 100 || 100);
      const percentage = maxMarks > 0 ? Number(((overallTotal / maxMarks) * 100).toFixed(1)) : 0;
      const isPass = percentage >= 33;

      return {
        ...r,
        subjectMarks: studentMarks,
        subjectTotals,
        total_marks_obtained: overallTotal,
        grandTotal: overallTotal,
        maxMarks: maxMarks,
        percentage: percentage,
        result_status: isPass ? 'Pass' : 'Fail',
        subjects_evaluated: Object.keys(subjectTotals).length,
      };
    });

    return {
      subjects: subjectsList,
      results: resultsWithMarks,
    };
  }

  static async getStudentMarksheet({ studentId, examId }) {
    // 1. Get student & exam meta
    const metaQuery = `
      SELECT 
        s.id AS student_id,
        s.first_name,
        s.last_name,
        s.admission_number AS admission_no,
        s.roll_number AS roll_no,
        s.date_of_birth AS dob,
        s.gender,
        c.class_name,
        sec.section_name,
        e.id AS exam_id,
        e.exam AS exam_name,
        er.id AS exam_result_id
      FROM student_master s
      LEFT JOIN class_master c ON c.id = s.class
      LEFT JOIN section_master sec ON sec.id = s.section
      LEFT JOIN exam_result er ON er.student_id = s.id AND er.exam_id = ?
      LEFT JOIN exam_master e ON e.id = ?
      WHERE s.id = ?
    `;
    const [metaRows] = await pool.query(metaQuery, [examId, examId, studentId]);
    if (metaRows.length === 0) return null;

    const studentInfo = metaRows[0];

    // 2. Get subject-wise marks breakdown
    let subjectMarks = [];
    if (studentInfo.exam_result_id) {
      const marksQuery = `
        SELECT 
          ers.id,
          ers.subject_id,
          ers.exam_type_id,
          ers.marks,
          ers.grade_id,
          sub.subject_name,
          et.exam_type,
          g.grade_name
        FROM exam_result_subject ers
        LEFT JOIN subject_master sub ON sub.id = ers.subject_id
        LEFT JOIN exam_type_master et ON et.id = ers.exam_type_id
        LEFT JOIN grade_settings g ON g.id = ers.grade_id
        WHERE ers.exam_result_id = ?
        ORDER BY sub.subject_name ASC, et.sort_order ASC
      `;
      const [mRows] = await pool.query(marksQuery, [studentInfo.exam_result_id]);
      subjectMarks = mRows;
    }

    // 3. Get subject-wise exam attendance for this student and exam
    const [attendanceRows] = await pool.query(
      `SELECT subject_id, attendance_status
       FROM exam_attendance
       WHERE student_id = ? AND exam_id = ? AND status != 4`,
      [studentId, examId]
    );

    const attendanceMap = {};
    for (const r of attendanceRows) {
      attendanceMap[r.subject_id] = Number(r.attendance_status);
    }

    return {
      student: studentInfo,
      marks: subjectMarks,
      attendance: attendanceMap,
    };
  }

  static async saveStudentMarksBatch({ schoolId, academicYearId, examId, classId, studentMarksList }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let resolvedYearId = academicYearId ? parseInt(academicYearId, 10) : null;
      if (!resolvedYearId) {
        resolvedYearId = await AdminExaminationModel.getCurrentAcademicYearId(schoolId, examId);
      }

      // Fetch all grades for automatic grade assignment
      const [grades] = await connection.query(`
        SELECT id, grade_name, min_percentage, max_percentage 
        FROM grade_settings 
        WHERE status != 0 
        ORDER BY min_percentage DESC
      `);

      for (const item of studentMarksList) {
        const { studentId, marksPerSubject } = item;

        // 1. Get or create exam_result record
        let examResultId;
        const [existingResult] = await connection.query(
          `SELECT id FROM exam_result WHERE exam_id = ? AND student_id = ?`,
          [examId, studentId]
        );

        if (existingResult.length > 0) {
          examResultId = existingResult[0].id;
        } else {
          const [insResult] = await connection.query(
            `INSERT INTO exam_result (school_id, academic_year_id, student_id, exam_id, class_id, status, created_on)
             VALUES (?, ?, ?, ?, ?, 1, NOW())`,
            [schoolId, resolvedYearId, studentId, examId, classId]
          );
          examResultId = insResult.insertId;
        }

        // 2. Fetch already recorded marks for this exam_result to prevent modification
        const [existingMarksRows] = await connection.query(
          `SELECT subject_id, exam_type_id FROM exam_result_subject WHERE exam_result_id = ? AND status != 4`,
          [examResultId]
        );
        const existingKeySet = new Set(
          existingMarksRows.map((r) => `${r.subject_id}_${r.exam_type_id || 'null'}`)
        );

        // 3. Insert ONLY new subject marks
        if (Array.isArray(marksPerSubject) && marksPerSubject.length > 0) {
          for (const sm of marksPerSubject) {
            const key = `${sm.subjectId}_${sm.examTypeId || 'null'}`;
            if (existingKeySet.has(key)) {
              // Already submitted mark cannot be modified
              continue;
            }

            const marksVal = parseFloat(sm.marks) || 0;
            const maxMarks = parseFloat(sm.maxMarks) || 100;
            const percentage = (marksVal / maxMarks) * 100;

            // Determine grade
            let matchedGradeId = sm.gradeId || null;
            if (!matchedGradeId) {
              for (const g of grades) {
                if (percentage >= g.min_percentage && percentage <= g.max_percentage) {
                  matchedGradeId = g.id;
                  break;
                }
              }
            }

            await connection.query(
              `INSERT INTO exam_result_subject (school_id, exam_result_id, subject_id, exam_type_id, marks, grade_id, status, created_on)
               VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
              [
                schoolId,
                examResultId,
                sm.subjectId,
                sm.examTypeId || null,
                marksVal,
                matchedGradeId,
              ]
            );
          }
        }
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // =========================================================
  // 7. MARKSHEET STUDENTS PAGINATED
  // =========================================================

  static async getMarksheetStudentsPaginated({
    schoolId = 1,
    academicYearId = null,
    classId = null,
    sectionId = null,
    search = '',
    page = 1,
    limit = 10,
  }) {
    const p = parseInt(page, 10) || 1;
    const l = parseInt(limit, 10) || 10;
    const offset = (p - 1) * l;

    let whereClause = `WHERE s.school_id = ? AND s.status = 1`;
    const params = [schoolId];

    if (academicYearId) {
      whereClause += ` AND (s.academic_year = ? OR s.academic_year IS NULL)`;
      params.push(academicYearId);
    }
    if (classId) {
      whereClause += ` AND s.class = ?`;
      params.push(classId);
    }
    if (sectionId) {
      whereClause += ` AND s.section = ?`;
      params.push(sectionId);
    }
    if (search && search.trim()) {
      whereClause += ` AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_number LIKE ? OR s.roll_number LIKE ? OR s.primary_contact_number LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT s.id) AS total FROM student_master s ${whereClause}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const dataParams = [academicYearId, academicYearId, ...params, l, offset];
    const [rows] = await pool.query(
      `SELECT 
        s.id,
        s.first_name,
        s.last_name,
        s.admission_number,
        s.roll_number,
        s.date_of_birth,
        s.gender,
        s.picture,
        s.primary_contact_number,
        s.email_address,
        s.class AS class_id,
        s.section AS section_id,
        c.class_name,
        sec.section_name,
        CONCAT(COALESCE(pf.first_name, ''), ' ', COALESCE(pf.last_name, '')) AS father_name,
        IF(COUNT(DISTINCT er.id) > 0, 1, 0) AS has_marksheet
       FROM student_master s
       LEFT JOIN class_master c ON c.id = s.class
       LEFT JOIN section_master sec ON sec.id = s.section
       LEFT JOIN student_to_parent stp ON stp.student_id = s.id
       LEFT JOIN parent_master pf ON pf.id = stp.father_id
       LEFT JOIN exam_result er ON er.student_id = s.id AND (er.academic_year_id = ? OR ? IS NULL) AND er.status = 1
       ${whereClause}
       GROUP BY s.id
       ORDER BY s.roll_number ASC, s.first_name ASC
       LIMIT ? OFFSET ?`,
      dataParams
    );

    return {
      students: rows,
      pagination: {
        total,
        page: p,
        limit: l,
        totalPages: Math.ceil(total / l) || 1,
      },
    };
  }

  // =========================================================
  // 8. A4 PORTRAIT MARKSHEET DATA (MULTI-TERM & SINGLE-TERM)
  // =========================================================

  static async getMarksheetDataForPdf({
    schoolId,
    studentIds = [],
    classId = null,
    sectionId = null,
    academicYearId = null,
  }) {
    if (!schoolId) return [];

    // 1. Fetch School Information
    const [schoolRows] = await pool.query(
      `SELECT 
        id, 
        school_name AS school_title, 
        school_code, 
        school_logo, 
        address, 
        city, 
        state, 
        country, 
        postal_code, 
        phone_number AS phone, 
        email, 
        website, 
        affiliation_board 
       FROM school_master 
       WHERE id = ?`,
      [schoolId]
    );
    const school = schoolRows[0] || null;

    // 2. Fetch Academic Year Info
    let sessionLabel = '';
    if (academicYearId) {
      const [yearRows] = await pool.query(
        `SELECT id, academic_year, start_date, end_date FROM academic_year_master WHERE id = ? AND school_id = ?`,
        [academicYearId, schoolId]
      );
      if (yearRows.length > 0) {
        const yr = yearRows[0];
        if (yr.start_date && yr.end_date) {
          const sYr = new Date(yr.start_date).getFullYear();
          const eYr = new Date(yr.end_date).getFullYear();
          sessionLabel = sYr === eYr ? `${sYr}-${sYr + 1}` : `${sYr}-${eYr}`;
        } else if (yr.academic_year) {
          const ayStr = String(yr.academic_year).trim();
          const singleYear = ayStr.match(/^(\d{4})$/);
          if (singleYear) {
            const y = parseInt(singleYear[1], 10);
            sessionLabel = `${y}-${y + 1}`;
          } else {
            sessionLabel = ayStr.replace(/\s+/g, '');
          }
        }
      }
    }
    if (!sessionLabel) {
      const [defaultYearRows] = await pool.query(
        `SELECT id, academic_year, start_date, end_date FROM academic_year_master WHERE school_id = ? ORDER BY id DESC LIMIT 1`,
        [schoolId]
      );
      if (defaultYearRows.length > 0) {
        const yr = defaultYearRows[0];
        if (yr.start_date && yr.end_date) {
          const sYr = new Date(yr.start_date).getFullYear();
          const eYr = new Date(yr.end_date).getFullYear();
          sessionLabel = sYr === eYr ? `${sYr}-${sYr + 1}` : `${sYr}-${eYr}`;
        } else if (yr.academic_year) {
          const ayStr = String(yr.academic_year).trim();
          const singleYear = ayStr.match(/^(\d{4})$/);
          if (singleYear) {
            const y = parseInt(singleYear[1], 10);
            sessionLabel = `${y}-${y + 1}`;
          } else {
            sessionLabel = ayStr.replace(/\s+/g, '');
          }
        }
      }
    }

    // 3. Fetch All Exams (Terms) & Exam Types for this Academic Year
    let examQuery = `SELECT id, exam AS exam_name FROM exam_master WHERE school_id = ? AND (status != 4 OR status IS NULL)`;
    const examParams = [schoolId];
    if (academicYearId) {
      examQuery += ` AND (academic_year = ? OR academic_year IS NULL)`;
      examParams.push(academicYearId);
    }
    examQuery += ` ORDER BY id ASC`;
    const [examRows] = await pool.query(examQuery, examParams);

    let typeQuery = `SELECT id, exam_id, exam_type, sort_order FROM exam_type_master WHERE school_id = ? AND (status != 4 OR status IS NULL)`;
    const typeParams = [schoolId];
    if (academicYearId) {
      typeQuery += ` AND (academic_year = ? OR academic_year IS NULL)`;
      typeParams.push(academicYearId);
    }
    typeQuery += ` ORDER BY sort_order ASC, id ASC`;
    const [examTypeRows] = await pool.query(typeQuery, typeParams);

    const termDefinitions = examRows.map((ex) => {
      const typesForExam = examTypeRows
        .filter((et) => et.exam_id === ex.id)
        .map((et) => et.exam_type);
      return {
        id: ex.id,
        name: ex.exam_name,
        exam_types: typesForExam,
      };
    });

    // 4. Fetch Grading Settings
    const [gradeRows] = await pool.query(
      `SELECT id, grade_name, min_percentage, max_percentage 
       FROM grade_settings 
       WHERE school_id = ? AND status != 0 
       ORDER BY min_percentage DESC`,
      [schoolId]
    );
    const grades = gradeRows.length > 0 ? gradeRows : undefined;

    // 5. Fetch Students with Father's Name
    let studentList = [];
    if (Array.isArray(studentIds) && studentIds.length > 0) {
      const placeholders = studentIds.map(() => '?').join(',');
      const [sRows] = await pool.query(
        `SELECT 
          s.id,
          s.first_name,
          s.last_name,
          s.admission_number AS admission_no,
          s.roll_number AS roll_no,
          s.date_of_birth AS dob,
          s.gender,
          s.picture,
          s.class AS class_id,
          s.section AS section_id,
          c.class_name,
          sec.section_name,
          CONCAT(COALESCE(pf.first_name, ''), ' ', COALESCE(pf.last_name, '')) AS father_name
         FROM student_master s
         LEFT JOIN class_master c ON c.id = s.class
         LEFT JOIN section_master sec ON sec.id = s.section
         LEFT JOIN student_to_parent stp ON stp.student_id = s.id
         LEFT JOIN parent_master pf ON pf.id = stp.father_id
         WHERE s.id IN (${placeholders}) AND s.school_id = ?
         GROUP BY s.id`,
        [...studentIds, schoolId]
      );
      studentList = sRows;
    } else if (classId) {
      let q = `SELECT 
          s.id,
          s.first_name,
          s.last_name,
          s.admission_number AS admission_no,
          s.roll_number AS roll_no,
          s.date_of_birth AS dob,
          s.gender,
          s.picture,
          s.class AS class_id,
          s.section AS section_id,
          c.class_name,
          sec.section_name,
          CONCAT(COALESCE(pf.first_name, ''), ' ', COALESCE(pf.last_name, '')) AS father_name
         FROM student_master s
         LEFT JOIN class_master c ON c.id = s.class
         LEFT JOIN section_master sec ON sec.id = s.section
         LEFT JOIN student_to_parent stp ON stp.student_id = s.id
         LEFT JOIN parent_master pf ON pf.id = stp.father_id
         WHERE s.class = ? AND s.school_id = ? AND s.status = 1`;
      const p = [classId, schoolId];
      if (sectionId) {
        q += ` AND s.section = ?`;
        p.push(sectionId);
      }
      q += ` GROUP BY s.id ORDER BY s.roll_number ASC, s.first_name ASC`;
      const [sRows] = await pool.query(q, p);
      studentList = sRows;
    }

    if (studentList.length === 0) {
      return [];
    }

    // 6. Build Multi-Term marksheet records for each student
    const resultList = [];
    for (const student of studentList) {
      const studentClassId = student.class_id || classId;
      if (!studentClassId) continue;

      // Fetch subjects for this class
      const [classSubs] = await pool.query(
        `SELECT id, subject_name FROM subject_master WHERE class_id = ? AND school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [studentClassId, schoolId]
      );

      // Fetch all exam marks for this student
      let resultQuery = `
        SELECT 
          er.exam_id,
          ers.subject_id,
          ers.exam_type_id,
          ers.marks,
          sub.subject_name,
          et.exam_type
        FROM exam_result er
        JOIN exam_result_subject ers ON ers.exam_result_id = er.id
        JOIN subject_master sub ON sub.id = ers.subject_id
        LEFT JOIN exam_type_master et ON et.id = ers.exam_type_id
        WHERE er.student_id = ? AND ers.status != 4
      `;
      const rParams = [student.id];
      if (academicYearId) {
        resultQuery += ` AND er.academic_year_id = ?`;
        rParams.push(academicYearId);
      }

      const [resultRows] = await pool.query(resultQuery, rParams);

      if (studentIds && studentIds.length === 1 && resultRows.length === 0) {
        // Student has no exam results entered
        continue;
      }

      // Fetch configured Full Marks for this class
      const [fmRows] = await pool.query(
        `SELECT esm.exam_id, es.subject_id, es.exam_type_id, et.exam_type, es.mark
         FROM exam_subject_master esm
         JOIN exam_subject_marks es ON es.exam_subject_id = esm.id
         LEFT JOIN exam_type_master et ON et.id = es.exam_type_id
         WHERE esm.class_id = ? AND esm.school_id = ? AND (esm.status != 4 OR esm.status IS NULL)`,
        [studentClassId, schoolId]
      );

      // Filter to ONLY terms where data is available for this student
      const availableTermIds = [...new Set(resultRows.map((r) => r.exam_id))];
      let availableTerms = termDefinitions.filter((t) => availableTermIds.includes(t.id));
      if (availableTerms.length === 0 && termDefinitions.length > 0) {
        // Fallback to first term if no marks yet for batch
        availableTerms = [termDefinitions[0]];
      }

      const subMap = {};
      classSubs.forEach((cs) => {
        subMap[cs.id] = {
          subject_id: cs.id,
          subject_name: cs.subject_name,
          terms: {},
          grandTotal: 0,
          grandFullMarks: 0,
        };

        availableTerms.forEach((term) => {
          const fullMarksBreakdown = term.exam_types.map((type) => {
            const foundFm = fmRows.find(
              (f) => f.exam_id === term.id && f.subject_id === cs.id && f.exam_type === type
            );
            return foundFm && foundFm.mark ? Number(foundFm.mark) : (type === 'Theory' ? 70 : (type === 'Practical' ? 20 : 10));
          });
          const termFullMarks = fullMarksBreakdown.reduce((a, b) => a + b, 0) || 100;

          subMap[cs.id].terms[term.name] = {
            marks: term.exam_types.map(() => null),
            fullMarks: fullMarksBreakdown,
            termFullMarks: termFullMarks,
            termTotal: 0,
            termGrade: '-',
          };
        });
      });

      resultRows.forEach((r) => {
        const sId = r.subject_id;
        const termObj = availableTerms.find((t) => t.id === r.exam_id);
        if (termObj && subMap[sId] && subMap[sId].terms[termObj.name]) {
          const typeIdx = termObj.exam_types.indexOf(r.exam_type);
          if (typeIdx !== -1) {
            subMap[sId].terms[termObj.name].marks[typeIdx] = Number(r.marks);
          }
        }
      });

      // Compute term totals, percentages, grades, and grand totals
      Object.values(subMap).forEach((sub) => {
        availableTerms.forEach((term) => {
          const tData = sub.terms[term.name];
          if (tData) {
            const validMarks = tData.marks.filter((m) => m !== null && m !== undefined);
            const sum = validMarks.reduce((a, b) => a + Number(b), 0);
            tData.termTotal = sum;
            const pct = tData.termFullMarks > 0 ? (sum / tData.termFullMarks) * 100 : 0;
            tData.termGrade = validMarks.length > 0 ? AdminExaminationModel.computeGrade(pct, grades) : '-';

            sub.grandTotal += sum;
            sub.grandFullMarks += tData.termFullMarks;
          }
        });

        sub.overallPercentage = sub.grandFullMarks > 0 ? Math.round((sub.grandTotal / sub.grandFullMarks) * 1000) / 10 : 0;
        sub.finalGrade = AdminExaminationModel.computeGrade(sub.overallPercentage, grades);
      });

      resultList.push({
        student,
        school,
        exam: {
          academic_year: sessionLabel,
        },
        terms: availableTerms,
        subjects: Object.values(subMap),
        grades,
      });
    }

    return resultList;
  }

  // =========================================================
  // 9. A4 PORTRAIT ADMIT CARD DATA
  // =========================================================
  static async getAdmitCardDataForPdf({
    schoolId,
    studentIds = [],
    classId = null,
    sectionId = null,
    academicYearId = null,
    examId = null,
  }) {
    // 1. Fetch School Info
    const [schoolRows] = await pool.query(
      `SELECT id, school_name, school_name AS school_title, school_code, affiliation_board,
              address, city, state, postal_code, phone_number AS phone, email, school_logo
       FROM school_master
       WHERE id = ?`,
      [schoolId]
    );
    const school = schoolRows[0] || null;

    // 2. Fetch Academic Year Info
    let sessionLabel = '';
    if (academicYearId) {
      const [yearRows] = await pool.query(
        `SELECT id, academic_year, start_date, end_date FROM academic_year_master WHERE id = ? AND school_id = ?`,
        [academicYearId, schoolId]
      );
      if (yearRows.length > 0) {
        const yr = yearRows[0];
        if (yr.start_date && yr.end_date) {
          const sYr = new Date(yr.start_date).getFullYear();
          const eYr = new Date(yr.end_date).getFullYear();
          sessionLabel = sYr === eYr ? `${sYr}-${sYr + 1}` : `${sYr}-${eYr}`;
        } else if (yr.academic_year) {
          const ayStr = String(yr.academic_year).trim();
          const singleYear = ayStr.match(/^(\d{4})$/);
          if (singleYear) {
            const y = parseInt(singleYear[1], 10);
            sessionLabel = `${y}-${y + 1}`;
          } else {
            sessionLabel = ayStr.replace(/\s+/g, '');
          }
        }
      }
    }
    if (!sessionLabel) {
      const [defaultYearRows] = await pool.query(
        `SELECT id, academic_year, start_date, end_date FROM academic_year_master WHERE school_id = ? ORDER BY id DESC LIMIT 1`,
        [schoolId]
      );
      if (defaultYearRows.length > 0) {
        const yr = defaultYearRows[0];
        if (yr.start_date && yr.end_date) {
          const sYr = new Date(yr.start_date).getFullYear();
          const eYr = new Date(yr.end_date).getFullYear();
          sessionLabel = sYr === eYr ? `${sYr}-${sYr + 1}` : `${sYr}-${eYr}`;
        } else if (yr.academic_year) {
          const ayStr = String(yr.academic_year).trim();
          const singleYear = ayStr.match(/^(\d{4})$/);
          if (singleYear) {
            const y = parseInt(singleYear[1], 10);
            sessionLabel = `${y}-${y + 1}`;
          } else {
            sessionLabel = ayStr.replace(/\s+/g, '');
          }
        }
      }
    }

    // 3. Fetch Exam Info
    let examName = 'Annual Examination';
    let targetExamId = examId;
    if (targetExamId) {
      const [examRows] = await pool.query(
        `SELECT id, exam AS exam_name FROM exam_master WHERE id = ? AND school_id = ?`,
        [targetExamId, schoolId]
      );
      if (examRows.length > 0) {
        examName = examRows[0].exam_name || examName;
      }
    } else {
      const [latestExamRows] = await pool.query(
        `SELECT id, exam AS exam_name FROM exam_master WHERE school_id = ? AND (status != 4 OR status IS NULL) ORDER BY id DESC LIMIT 1`,
        [schoolId]
      );
      if (latestExamRows.length > 0) {
        targetExamId = latestExamRows[0].id;
        examName = latestExamRows[0].exam_name || examName;
      }
    }

    // 4. Fetch Students
    let studentList = [];
    if (Array.isArray(studentIds) && studentIds.length > 0) {
      const placeholders = studentIds.map(() => '?').join(',');
      const [sRows] = await pool.query(
        `SELECT 
          s.id,
          s.first_name,
          s.last_name,
          s.admission_number AS admission_no,
          s.roll_number AS roll_no,
          s.date_of_birth AS dob,
          s.gender,
          s.picture,
          s.class AS class_id,
          s.section AS section_id,
          c.class_name,
          sec.section_name,
          CONCAT(COALESCE(pf.first_name, ''), ' ', COALESCE(pf.last_name, '')) AS father_name
         FROM student_master s
         LEFT JOIN class_master c ON c.id = s.class
         LEFT JOIN section_master sec ON sec.id = s.section
         LEFT JOIN student_to_parent stp ON stp.student_id = s.id
         LEFT JOIN parent_master pf ON pf.id = stp.father_id
         WHERE s.id IN (${placeholders}) AND s.school_id = ?
         GROUP BY s.id
         ORDER BY s.roll_number ASC, s.first_name ASC`,
        [...studentIds, schoolId]
      );
      studentList = sRows;
    } else if (classId) {
      let q = `SELECT 
          s.id,
          s.first_name,
          s.last_name,
          s.admission_number AS admission_no,
          s.roll_number AS roll_no,
          s.date_of_birth AS dob,
          s.gender,
          s.picture,
          s.class AS class_id,
          s.section AS section_id,
          c.class_name,
          sec.section_name,
          CONCAT(COALESCE(pf.first_name, ''), ' ', COALESCE(pf.last_name, '')) AS father_name
         FROM student_master s
         LEFT JOIN class_master c ON c.id = s.class
         LEFT JOIN section_master sec ON sec.id = s.section
         LEFT JOIN student_to_parent stp ON stp.student_id = s.id
         LEFT JOIN parent_master pf ON pf.id = stp.father_id
         WHERE s.class = ? AND s.school_id = ? AND (s.status = '1' OR s.status = 1)`;
      const qParams = [classId, schoolId];
      if (sectionId) {
        q += ` AND s.section = ?`;
        qParams.push(sectionId);
      }
      q += ` GROUP BY s.id ORDER BY s.roll_number ASC, s.first_name ASC`;
      const [sRows] = await pool.query(q, qParams);
      studentList = sRows;
    }

    // 5. Build Admit Card item for each student
    const resultList = [];
    for (const student of studentList) {
      const studentClassId = student.class_id || classId;

      // Fetch Exam Schedules for this student's class and target exam
      let scheduleQuery = `
        SELECT es.id, es.date, es.start_time, es.end_time, sub.subject_name
        FROM exam_schedule es
        JOIN subject_master sub ON sub.id = es.subject_id
        WHERE es.school_id = ? AND es.class_id = ? AND (es.status != 4 OR es.status IS NULL)
      `;
      const sParams = [schoolId, studentClassId];
      if (targetExamId) {
        scheduleQuery += ` AND es.exam_id = ?`;
        sParams.push(targetExamId);
      }
      scheduleQuery += ` ORDER BY es.date ASC, es.start_time ASC`;
      const [schedules] = await pool.query(scheduleQuery, sParams);

      resultList.push({
        student,
        school,
        exam: {
          id: targetExamId,
          exam_name: examName,
          academic_year: sessionLabel,
        },
        schedules,
        issueDate: new Date(),
      });
    }

    return resultList;
  }

  static computeGrade(pct, grades = []) {
    if (pct === null || pct === undefined || isNaN(pct)) return '-';
    const val = Math.round(Number(pct) * 10) / 10;
    for (const g of grades) {
      const min = Number(g.min_percentage ?? g.min_mark ?? 0);
      const max = Number(g.max_percentage ?? g.max_mark ?? 100);
      if (val >= min && val <= max) {
        return g.grade_name || g.grade || 'A';
      }
    }
    if (val >= 90) return 'A+';
    if (val >= 80) return 'A';
    if (val >= 70) return 'B+';
    if (val >= 60) return 'B';
    if (val >= 50) return 'C+';
    if (val >= 40) return 'C';
    if (val >= 33) return 'D';
    return 'E';
  }
}

module.exports = AdminExaminationModel;
