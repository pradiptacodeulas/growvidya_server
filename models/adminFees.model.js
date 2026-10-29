const { pool } = require('../config/db.config');

class AdminFeesModel {
  // =========================================================
  // 1. FEE COMPONENTS
  // =========================================================

  static async getAllComponents({ schoolId, branchId, status, search }) {
    let query = `
      SELECT 
        fc.id,
        fc.school_id,
        fc.branch_id,
        brm.branch_name,
        brm.branch_code,
        fc.name,
        fc.code,
        fc.tax_rate,
        fc.account_code,
        fc.description,
        fc.status,
        fc.created_at
      FROM fee_components fc
      LEFT JOIN branch_master brm ON brm.id = fc.branch_id
      WHERE fc.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      query += ` AND (fc.branch_id = ? OR fc.branch_id IS NULL)`;
      params.push(Number(branchId));
    }

    if (status !== undefined && status !== '') {
      query += ` AND fc.status = ?`;
      params.push(parseInt(status, 10));
    } else {
      query += ` AND fc.status != 4`;
    }

    if (search) {
      query += ` AND (fc.name LIKE ? OR fc.code LIKE ? OR fc.account_code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY fc.name ASC, fc.id ASC`;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async getComponentById(id, schoolId, branchId = null) {
    let query = `
      SELECT fc.*, brm.branch_name, brm.branch_code 
      FROM fee_components fc
      LEFT JOIN branch_master brm ON brm.id = fc.branch_id
      WHERE fc.id = ? AND fc.school_id = ? AND fc.status != 4
    `;
    const params = [id, schoolId];
    if (branchId) {
      query += ` AND (fc.branch_id = ? OR fc.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  static async createComponent({ schoolId, branchId, name, code, taxRate, accountCode, description, status }) {
    const resolvedBranchId = branchId ? Number(branchId) : null;
    const query = `
      INSERT INTO fee_components (school_id, branch_id, name, code, tax_rate, account_code, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [
      schoolId,
      resolvedBranchId,
      name,
      code || null,
      parseFloat(taxRate) || 0.0,
      accountCode || null,
      description || null,
      status !== undefined ? status : 1,
    ]);
    return result.insertId;
  }

  static async updateComponent(id, schoolId, { branchId, name, code, taxRate, accountCode, description, status }, currentBranchId = null) {
    let query = `UPDATE fee_components SET `;
    const updates = [];
    const params = [];

    if (branchId !== undefined) {
      updates.push('branch_id = ?');
      params.push(branchId ? Number(branchId) : null);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (code !== undefined) {
      updates.push('code = ?');
      params.push(code);
    }
    if (taxRate !== undefined) {
      updates.push('tax_rate = ?');
      params.push(parseFloat(taxRate) || 0.0);
    }
    if (accountCode !== undefined) {
      updates.push('account_code = ?');
      params.push(accountCode);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) return true;

    query += updates.join(', ') + ` WHERE id = ? AND school_id = ?`;
    params.push(id, schoolId);

    const effectiveBranchId = currentBranchId || (branchId !== undefined ? branchId : null);
    if (effectiveBranchId) {
      query += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    const [result] = await pool.query(query, params);
    return Boolean(result.affectedRows > 0 || (result.info && !result.info.includes('Rows matched: 0')));
  }

  static async deleteComponent(id, schoolId, branchId = null) {
    let query = `UPDATE fee_components SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      query += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 2. FEE STRUCTURES & COMPONENTS
  // =========================================================

  static async getAllStructures({ schoolId, branchId, academicYearId, status, search }) {
    let query = `
      SELECT 
        fs.id,
        fs.school_id,
        fs.branch_id,
        brm.branch_name,
        brm.branch_code,
        fs.name,
        fs.class_id,
        fs.section_id,
        fs.academic_year_id,
        fs.frequency,
        fs.start_month,
        fs.due_day,
        fs.grace_period_days,
        fs.late_fee_type,
        fs.late_fee_amount,
        fs.description,
        fs.status,
        fs.allow_partial_payment,
        fs.is_published,
        fs.generate_on_day,
        fs.created_at,
        ay.academic_year
      FROM fee_structures fs
      LEFT JOIN academic_year_master ay ON ay.id = fs.academic_year_id
      LEFT JOIN branch_master brm ON brm.id = fs.branch_id
      WHERE fs.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      query += ` AND fs.branch_id = ?`;
      params.push(Number(branchId));
    }
    if (academicYearId) {
      query += ` AND fs.academic_year_id = ?`;
      params.push(academicYearId);
    }
    if (status !== undefined && status !== '') {
      query += ` AND fs.status = ?`;
      params.push(parseInt(status, 10));
    } else {
      query += ` AND fs.status != 4`;
    }
    if (search) {
      query += ` AND (fs.name LIKE ? OR fs.frequency LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY fs.id DESC`;
    const [structures] = await pool.query(query, params);

    // Fetch classes lookup for mapping class_ids
    const [classes] = await pool.query(`SELECT id, class_name FROM class_master WHERE status != 4`);
    const classMap = {};
    classes.forEach((c) => {
      classMap[c.id] = c.class_name;
    });

    // Fetch structure components
    if (structures.length > 0) {
      const structIds = structures.map((s) => s.id);
      const [compRows] = await pool.query(
        `SELECT 
           fsc.id,
           fsc.fee_structure_id,
           fsc.fee_component_id,
           fsc.amount,
           fc.name AS component_name,
           fc.code AS component_code
         FROM fee_structure_components fsc
         LEFT JOIN fee_components fc ON fc.id = fsc.fee_component_id
         WHERE fsc.fee_structure_id IN (?)`,
        [structIds]
      );

      const compMap = {};
      compRows.forEach((c) => {
        if (!compMap[c.fee_structure_id]) {
          compMap[c.fee_structure_id] = [];
        }
        compMap[c.fee_structure_id].push(c);
      });

      structures.forEach((s) => {
        s.components = compMap[s.id] || [];
        s.total_amount = s.components.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

        // Map class names from comma-separated string
        if (s.class_id) {
          const cIds = String(s.class_id).split(',').map((id) => id.trim()).filter(Boolean);
          s.class_names = cIds.map((id) => classMap[id] || `Class ${id}`).join(', ');
          s.class_name = s.class_names;
          s.class_ids = cIds;
        } else {
          s.class_names = 'All Classes';
          s.class_name = 'All Classes';
          s.class_ids = [];
        }
      });
    }

    return structures;
  }

  static async getStructureById(id, schoolId, branchId = null) {
    let query = `
      SELECT 
        fs.*,
        brm.branch_name,
        brm.branch_code,
        ay.academic_year
      FROM fee_structures fs
      LEFT JOIN academic_year_master ay ON ay.id = fs.academic_year_id
      LEFT JOIN branch_master brm ON brm.id = fs.branch_id
      WHERE fs.id = ? AND fs.school_id = ? AND fs.status != 4
    `;
    const params = [id, schoolId];
    if (branchId) {
      query += ` AND (fs.branch_id = ? OR fs.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(query, params);
    if (rows.length === 0) return null;

    const structure = rows[0];

    // Get components
    const [components] = await pool.query(
      `SELECT 
         fsc.id,
         fsc.fee_structure_id,
         fsc.fee_component_id,
         fsc.amount,
         fc.name AS component_name,
         fc.code AS component_code
       FROM fee_structure_components fsc
       LEFT JOIN fee_components fc ON fc.id = fsc.fee_component_id
       WHERE fsc.fee_structure_id = ?`,
      [structure.id]
    );

    structure.components = components;
    structure.total_amount = components.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

    const classIds = structure.class_id
      ? String(structure.class_id).split(',').map((cid) => cid.trim()).filter(Boolean)
      : [];

    if (classIds.length > 0) {
      const [classes] = await pool.query(
        `SELECT id, class_name FROM class_master WHERE id IN (?) AND status != 4`,
        [classIds]
      );
      const classMap = {};
      classes.forEach((c) => {
        classMap[c.id] = c.class_name;
      });
      structure.class_names = classIds.map((cid) => classMap[cid] || `Class ${cid}`).join(', ');
      structure.class_name = structure.class_names;
    } else {
      structure.class_names = 'All Classes';
      structure.class_name = 'All Classes';
    }
    structure.class_ids = classIds;

    return structure;
  }

  static async saveStructure({
    id,
    schoolId,
    branchId,
    name,
    classIds,
    sectionId,
    academicYearId,
    frequency,
    start_month,
    dueDay,
    gracePeriodDays,
    lateFeeType,
    lateFeeAmount,
    allowPartialPayment,
    isPublished,
    generateOnDay,
    description,
    status,
    components,
    autoAllocate = true,
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const classIdStr = Array.isArray(classIds) ? classIds.join(',') : (classIds || '');

      let structureId = id;
      let effectivePublished = isPublished ? 1 : 0;
      if (id) {
        // Fetch current published status to guarantee published structures cannot be reverted to draft
        const [existingRows] = await connection.query(
          `SELECT is_published FROM fee_structures WHERE id = ? AND school_id = ? AND status != 4`,
          [id, schoolId]
        );
        const wasPublished = existingRows.length > 0 && Number(existingRows[0].is_published) === 1;
        effectivePublished = wasPublished ? 1 : (isPublished ? 1 : 0);

        // Update
        const updateQuery = `
          UPDATE fee_structures SET
            branch_id = COALESCE(?, branch_id),
            name = ?,
            class_id = ?,
            section_id = ?,
            academic_year_id = ?,
            frequency = ?,
            start_month = ?,
            due_day = ?,
            grace_period_days = ?,
            late_fee_type = ?,
            late_fee_amount = ?,
            allow_partial_payment = ?,
            is_published = ?,
            generate_on_day = ?,
            description = ?,
            status = ?
          WHERE id = ? AND school_id = ?
        `;
        await connection.query(updateQuery, [
          branchId ? Number(branchId) : null,
          name,
          classIdStr,
          sectionId || null,
          academicYearId || null,
          frequency,
          parseInt(start_month, 10) || 1,
          parseInt(dueDay, 10) || 10,
          parseInt(gracePeriodDays, 10) || 5,
          lateFeeType || '0',
          parseFloat(lateFeeAmount) || 0.0,
          allowPartialPayment ? 1 : 0,
          effectivePublished,
          parseInt(generateOnDay, 10) || 1,
          description || null,
          status !== undefined ? status : 1,
          id,
          schoolId,
        ]);

        // Delete existing components to re-insert
        await connection.query(`DELETE FROM fee_structure_components WHERE fee_structure_id = ?`, [id]);
      } else {
        // Insert
        const insertQuery = `
          INSERT INTO fee_structures (
            school_id, branch_id, name, class_id, section_id, academic_year_id, frequency, start_month,
            due_day, grace_period_days, late_fee_type, late_fee_amount,
            allow_partial_payment, is_published, generate_on_day, description, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        const [result] = await connection.query(insertQuery, [
          schoolId,
          branchId ? Number(branchId) : null,
          name,
          classIdStr,
          sectionId || null,
          academicYearId || null,
          frequency,
          parseInt(start_month, 10) || 1,
          parseInt(dueDay, 10) || 10,
          parseInt(gracePeriodDays, 10) || 5,
          lateFeeType || '0',
          parseFloat(lateFeeAmount) || 0.0,
          allowPartialPayment ? 1 : 0,
          isPublished !== undefined ? isPublished : 1,
          parseInt(generateOnDay, 10) || 1,
          description || null,
          status !== undefined ? status : 1,
        ]);
        structureId = result.insertId;
      }

      // Insert components
      if (Array.isArray(components) && components.length > 0) {
        for (const comp of components) {
          const compId = comp.fee_component_id || comp.component_id || comp.id;
          const amount = parseFloat(comp.amount) || 0;
          if (compId && amount >= 0) {
            await connection.query(
              `INSERT INTO fee_structure_components (branch_id, fee_structure_id, fee_component_id, amount, created_at)
               VALUES (?, ?, ?, ?, NOW())`,
              [branchId ? Number(branchId) : null, structureId, compId, amount]
            );
          }
        }
      }

      // Auto-assign fee structure to all active students in the target classes (Published structures only)
      let allocatedCount = 0;
      if (autoAllocate && Number(effectivePublished) === 1) {
        let targetClassIds = [];
        if (Array.isArray(classIds)) {
          targetClassIds = classIds.map((c) => String(c).trim()).filter(Boolean);
        } else if (typeof classIds === 'string' && classIds.trim()) {
          targetClassIds = classIds.split(',').map((c) => c.trim()).filter(Boolean);
        } else if (classIds) {
          targetClassIds = [String(classIds).trim()];
        }

        if (targetClassIds.length > 0) {
          let effectiveAcademicYearId = academicYearId;
          if (!effectiveAcademicYearId) {
            const [currentYearRows] = await connection.query(
              `SELECT id FROM academic_year_master WHERE school_id = ? AND is_current = 1 AND status = 1 LIMIT 1`,
              [schoolId]
            );
            effectiveAcademicYearId = currentYearRows[0]?.id || null;
          }

          let studentQuery = `
            SELECT sm.id
            FROM student_master sm
            WHERE sm.school_id = ? 
              AND sm.status = 1 
              AND (sm.status != 4 OR sm.status IS NULL)
              AND (
                sm.class IN (?) 
                OR sm.class IN (SELECT class_name FROM class_master WHERE id IN (?))
              )
          `;
          const studentQueryParams = [schoolId, targetClassIds, targetClassIds];

          if (branchId) {
            studentQuery += ` AND sm.branch_id = ?`;
            studentQueryParams.push(Number(branchId));
          }

          if (sectionId) {
            studentQuery += ` AND (sm.section = ? OR sm.section IN (SELECT section_name FROM section_master WHERE id = ?))`;
            studentQueryParams.push(sectionId, sectionId);
          }

          const [students] = await connection.query(studentQuery, studentQueryParams);

          if (students.length > 0) {
            const studentIds = students.map((s) => s.id);

            const [alreadyAllocated] = await connection.query(
              `SELECT student_id FROM student_fee_allocations 
               WHERE school_id = ? AND fee_structure_id = ? AND academic_year_id = ? AND status != 4 AND student_id IN (?)`,
              [schoolId, structureId, effectiveAcademicYearId, studentIds]
            );

            const allocatedSet = new Set(alreadyAllocated.map((r) => r.student_id));
            const toAllocateStudentIds = studentIds.filter((sid) => !allocatedSet.has(sid));

            if (toAllocateStudentIds.length > 0) {
              const now = new Date();
              const todayStr = now.toISOString().split('T')[0];
              const insertRows = toAllocateStudentIds.map((sid) => [
                schoolId,
                branchId ? Number(branchId) : null,
                sid,
                structureId,
                effectiveAcademicYearId,
                todayStr,
                1,
                allowPartialPayment ? 1 : 0,
                now,
              ]);

              await connection.query(
                `INSERT INTO student_fee_allocations (
                   school_id, branch_id, student_id, fee_structure_id, academic_year_id,
                   assigned_date, status, allow_partial_payment, created_at
                 ) VALUES ?`,
                [insertRows]
              );
              allocatedCount = toAllocateStudentIds.length;
            }
          }
        }
      }

      await connection.commit();
      return { id: structureId, allocatedCount };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async deleteStructure(id, schoolId, branchId = null) {
    let query = `UPDATE fee_structures SET status = 4 WHERE id = ? AND school_id = ? AND (is_published = 0 OR is_published IS NULL)`;
    const params = [id, schoolId];
    if (branchId) {
      query += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async togglePublishStructure(id, schoolId, targetStatus = null, branchId = null) {
    let checkQuery = `SELECT id, name, is_published, class_id, academic_year_id, branch_id, allow_partial_payment 
       FROM fee_structures 
       WHERE id = ? AND school_id = ? AND status != 4`;
    const checkParams = [id, schoolId];
    if (branchId) {
      checkQuery += ` AND (branch_id = ? OR branch_id IS NULL)`;
      checkParams.push(Number(branchId));
    }
    const [rows] = await pool.query(checkQuery, checkParams);
    if (rows.length === 0) return null;

    const current = rows[0];
    if (Number(current.is_published) === 1) {
      const isTryingToUnpublish =
        targetStatus === 0 ||
        targetStatus === '0' ||
        targetStatus === false ||
        targetStatus === null ||
        targetStatus === undefined;
      if (isTryingToUnpublish) {
        throw new Error('A published fee structure cannot be reverted to Draft. It must remain published.');
      }
      return {
        id: current.id,
        name: current.name,
        is_published: 1,
        allocatedCount: 0,
      };
    }

    const newStatus = 1;

    let updateQuery = `UPDATE fee_structures SET is_published = ? WHERE id = ? AND school_id = ?`;
    const updateParams = [newStatus, id, schoolId];
    if (branchId) {
      updateQuery += ` AND (branch_id = ? OR branch_id IS NULL)`;
      updateParams.push(Number(branchId));
    }
    await pool.query(updateQuery, updateParams);

    let allocatedCount = 0;
    if (newStatus === 1 && current.class_id) {
      try {
        const classIds = String(current.class_id).split(',').map((c) => c.trim()).filter(Boolean);
        if (classIds.length > 0) {
          let effectiveAcademicYearId = current.academic_year_id;
          if (!effectiveAcademicYearId) {
            const [currentYearRows] = await pool.query(
              `SELECT id FROM academic_year_master WHERE school_id = ? AND is_current = 1 AND status = 1 LIMIT 1`,
              [schoolId]
            );
            effectiveAcademicYearId = currentYearRows[0]?.id || null;
          }

          let studentQuery = `
            SELECT sm.id
            FROM student_master sm
            WHERE sm.school_id = ? 
              AND sm.status = 1 
              AND (sm.status != 4 OR sm.status IS NULL)
              AND (
                sm.class IN (?) 
                OR sm.class IN (SELECT class_name FROM class_master WHERE id IN (?))
              )
          `;
          const studentQueryParams = [schoolId, classIds, classIds];

          if (current.branch_id) {
            studentQuery += ` AND sm.branch_id = ?`;
            studentQueryParams.push(Number(current.branch_id));
          }

          const [students] = await pool.query(studentQuery, studentQueryParams);

          if (students.length > 0) {
            const studentIds = students.map((s) => s.id);
            const [alreadyAllocated] = await pool.query(
              `SELECT student_id FROM student_fee_allocations 
               WHERE school_id = ? AND fee_structure_id = ? AND academic_year_id = ? AND status != 4 AND student_id IN (?)`,
              [schoolId, id, effectiveAcademicYearId, studentIds]
            );

            const allocatedSet = new Set(alreadyAllocated.map((r) => r.student_id));
            const toAllocateStudentIds = studentIds.filter((sid) => !allocatedSet.has(sid));

            if (toAllocateStudentIds.length > 0) {
              const now = new Date();
              const todayStr = now.toISOString().split('T')[0];
              const resolvedBranchId = branchId ? Number(branchId) : (current.branch_id ? Number(current.branch_id) : null);
              const insertRows = toAllocateStudentIds.map((sid) => [
                schoolId,
                resolvedBranchId,
                sid,
                id,
                effectiveAcademicYearId,
                todayStr,
                1,
                current.allow_partial_payment ? 1 : 0,
                now,
              ]);

              await pool.query(
                `INSERT INTO student_fee_allocations (
                   school_id, branch_id, student_id, fee_structure_id, academic_year_id,
                   assigned_date, status, allow_partial_payment, created_at
                 ) VALUES ?`,
                [insertRows]
              );
              allocatedCount = toAllocateStudentIds.length;
            }
          }
        }
      } catch (allocErr) {
        console.error('Error auto-allocating on publish:', allocErr);
      }
    }

    return {
      id: current.id,
      name: current.name,
      is_published: newStatus,
      allocatedCount,
    };
  }

  static async updateStructureStatus(id, schoolId, status, branchId = null) {
    let query = `UPDATE fee_structures SET status = ? WHERE id = ? AND school_id = ? AND status != 4`;
    const params = [Number(status), id, schoolId];
    if (branchId) {
      query += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 3. STUDENT FEE ALLOCATIONS
  // =========================================================

  static async getAllocations({ schoolId, branchId, classId, sectionId, structureId, academicYearId, search, page, limit }) {
    let whereClause = `
      WHERE sfa.school_id = ?
        AND sfa.status != 4
    `;
    const params = [schoolId];

    if (branchId) {
      whereClause += ` AND (sm.branch_id = ? OR fs.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }
    if (classId) {
      whereClause += ` AND sm.class = ?`;
      params.push(classId);
    }
    if (sectionId) {
      whereClause += ` AND sm.section = ?`;
      params.push(sectionId);
    }
    if (structureId) {
      whereClause += ` AND sfa.fee_structure_id = ?`;
      params.push(structureId);
    }
    if (academicYearId) {
      whereClause += ` AND sfa.academic_year_id = ?`;
      params.push(academicYearId);
    }
    if (search) {
      whereClause += ` AND (sm.first_name LIKE ? OR sm.last_name LIKE ? OR sm.admission_number LIKE ? OR fs.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM student_fee_allocations sfa
      INNER JOIN student_master sm ON sm.id = sfa.student_id
      LEFT JOIN fee_structures fs ON fs.id = sfa.fee_structure_id
      ${whereClause}
    `;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    let query = `
      SELECT 
        sfa.id,
        sfa.school_id,
        sm.branch_id,
        brm.branch_name,
        brm.branch_code,
        sfa.student_id,
        sfa.fee_structure_id,
        sfa.academic_year_id,
        sfa.assigned_date,
        sfa.status,
        sfa.allow_partial_payment,
        sfa.created_at,
        sm.first_name,
        sm.last_name,
        sm.admission_number,
        sm.roll_number,
        sm.class AS class_id,
        cm.class_name,
        sec.section_name,
        fs.name AS structure_name,
        fs.frequency,
        ay.academic_year
      FROM student_fee_allocations sfa
      INNER JOIN student_master sm ON sm.id = sfa.student_id
      LEFT JOIN branch_master brm ON brm.id = sm.branch_id
      LEFT JOIN class_master cm ON cm.id = sm.class
      LEFT JOIN section_master sec ON sec.id = sm.section
      LEFT JOIN fee_structures fs ON fs.id = sfa.fee_structure_id
      LEFT JOIN academic_year_master ay ON ay.id = sfa.academic_year_id
      ${whereClause}
      ORDER BY sfa.id DESC
    `;

    const queryParams = [...params];
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum > 0 && limitNum > 0) {
      const offset = (pageNum - 1) * limitNum;
      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(limitNum, offset);
    }

    const [rows] = await pool.query(query, queryParams);
    return {
      allocations: rows,
      total,
      page: pageNum || 1,
      limit: limitNum || total || 10,
      totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 1,
    };
  }

  static async allocateStructureToStudents({
    schoolId,
    branchId,
    academicYearId,
    feeStructureId,
    studentIds,
    allowPartialPayment,
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Check if structure is published
      const [structRows] = await connection.query(
        `SELECT id, name, is_published, status, academic_year_id, branch_id FROM fee_structures WHERE id = ? AND school_id = ? AND status != 4`,
        [feeStructureId, schoolId]
      );
      if (structRows.length === 0) {
        throw new Error('Fee Structure not found.');
      }
      if (Number(structRows[0].is_published) !== 1) {
        throw new Error(`Cannot assign fee structure: "${structRows[0].name}" is in Draft mode. Fee structures must be published before students can be allocated.`);
      }

      let resolvedBranchId = branchId ? Number(branchId) : (structRows[0].branch_id ? Number(structRows[0].branch_id) : null);

      let resolvedYearId = academicYearId || structRows[0].academic_year_id || null;
      if (!resolvedYearId) {
        const [currentYearRows] = await connection.query(
          `SELECT id FROM academic_year_master WHERE school_id = ? AND is_current = 1 AND status = 1 LIMIT 1`,
          [schoolId]
        );
        resolvedYearId = currentYearRows[0]?.id || null;
      }

      let count = 0;
      for (const studentId of studentIds) {
        // Check if already allocated
        const [existing] = await connection.query(
          `SELECT id FROM student_fee_allocations 
           WHERE school_id = ? AND student_id = ? AND fee_structure_id = ? AND academic_year_id = ? AND status != 4`,
          [schoolId, studentId, feeStructureId, resolvedYearId]
        );

        if (existing.length === 0) {
          await connection.query(
            `INSERT INTO student_fee_allocations (
               school_id, branch_id, student_id, fee_structure_id, academic_year_id,
               assigned_date, status, allow_partial_payment, created_at
             ) VALUES (?, ?, ?, ?, ?, CURDATE(), 1, ?, NOW())`,
            [schoolId, resolvedBranchId, studentId, feeStructureId, resolvedYearId, allowPartialPayment ? 1 : 0]
          );
          count++;
        }
      }

      await connection.commit();
      return count;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async deleteAllocation(id, schoolId, branchId = null) {
    let query = `UPDATE student_fee_allocations SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      query += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 4. FEE INVOICES & GENERATION
  // =========================================================

  static async getAllInvoices({
    schoolId,
    branchId,
    classId,
    sectionId,
    structureId,
    academicYearId,
    status,
    studentId,
    search,
    page,
    limit,
  }) {
    let whereClause = `
      WHERE fi.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      whereClause += ` AND (fi.branch_id = ? OR sm.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }
    if (classId) {
      whereClause += ` AND fi.class_id = ?`;
      params.push(classId);
    }
    if (sectionId) {
      whereClause += ` AND fi.section_id = ?`;
      params.push(sectionId);
    }
    if (structureId) {
      whereClause += ` AND fi.fee_structure_id = ?`;
      params.push(structureId);
    }
    if (academicYearId) {
      whereClause += ` AND fi.academic_year_id = ?`;
      params.push(academicYearId);
    }
    if (studentId) {
      whereClause += ` AND fi.student_id = ?`;
      params.push(studentId);
    }
    if (status && status !== 'all') {
      whereClause += ` AND fi.status = ?`;
      params.push(status);
    }
    if (search) {
      whereClause += ` AND (fi.invoice_no LIKE ? OR sm.first_name LIKE ? OR sm.last_name LIKE ? OR sm.admission_number LIKE ? OR fi.title LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM fee_invoices fi
      INNER JOIN student_master sm ON sm.id = fi.student_id
      ${whereClause}
    `;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    let query = `
      SELECT 
        fi.id,
        fi.invoice_no,
        fi.school_id,
        COALESCE(fi.branch_id, sm.branch_id) AS branch_id,
        brm.branch_name,
        brm.branch_code,
        fi.student_id,
        fi.class_id,
        fi.section_id,
        fi.academic_year_id,
        fi.fee_structure_id,
        fi.title,
        fi.subtotal,
        fi.concession_amount,
        fi.late_fee_amount,
        fi.total_amount,
        fi.paid_amount,
        fi.due_amount,
        fi.issue_date,
        fi.due_date,
        fi.status,
        fi.notes,
        fi.allow_partial_payment,
        fi.created_at,
        sm.first_name,
        sm.last_name,
        sm.admission_number,
        sm.roll_number,
        cm.class_name,
        sec.section_name,
        fs.name AS structure_name,
        ay.academic_year
      FROM fee_invoices fi
      INNER JOIN student_master sm ON sm.id = fi.student_id
      LEFT JOIN branch_master brm ON brm.id = COALESCE(fi.branch_id, sm.branch_id)
      LEFT JOIN class_master cm ON cm.id = fi.class_id
      LEFT JOIN section_master sec ON sec.id = fi.section_id
      LEFT JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      LEFT JOIN academic_year_master ay ON ay.id = fi.academic_year_id
      ${whereClause}
      ORDER BY fi.id DESC
    `;

    const queryParams = [...params];
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum > 0 && limitNum > 0) {
      const offset = (pageNum - 1) * limitNum;
      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(limitNum, offset);
    }

    const [invoices] = await pool.query(query, queryParams);
    return {
      invoices,
      total,
      page: pageNum || 1,
      limit: limitNum || total || 10,
      totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 1,
    };
  }

  static async getInvoiceById(id, schoolId, branchId = null) {
    let query = `
      SELECT 
        fi.*,
        COALESCE(fi.branch_id, sm.branch_id) AS branch_id,
        brm.branch_name,
        brm.branch_code,
        sm.first_name,
        sm.last_name,
        sm.admission_number,
        sm.roll_number,
        sm.primary_contact_number,
        sm.email_address,
        cm.class_name,
        sec.section_name,
        fs.name AS structure_name,
        ay.academic_year,
        sch.school_name,
        sch.school_code,
        sch.school_logo,
        sch.address AS school_address,
        sch.phone_number AS school_phone,
        sch.email AS school_email,
        sch.affiliation_board
      FROM fee_invoices fi
      INNER JOIN student_master sm ON sm.id = fi.student_id
      LEFT JOIN school_master sch ON sch.id = fi.school_id
      LEFT JOIN branch_master brm ON brm.id = COALESCE(fi.branch_id, sm.branch_id)
      LEFT JOIN class_master cm ON cm.id = fi.class_id
      LEFT JOIN section_master sec ON sec.id = fi.section_id
      LEFT JOIN fee_structures fs ON fs.id = fi.fee_structure_id
      LEFT JOIN academic_year_master ay ON ay.id = fi.academic_year_id
      WHERE fi.id = ? AND fi.school_id = ?
    `;
    const params = [id, schoolId];
    if (branchId) {
      query += ` AND (fi.branch_id = ? OR sm.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }
    const [rows] = await pool.query(query, params);
    if (rows.length === 0) return null;

    const invoice = rows[0];

    // Fetch items
    const [items] = await pool.query(
      `SELECT * FROM fee_invoice_items WHERE invoice_id = ?`,
      [invoice.id]
    );
    invoice.items = items;

    // Fetch only verified / successful payments applied to this official invoice
    const [payments] = await pool.query(
      `SELECT * FROM fee_payments
       WHERE invoice_id = ?
         AND LOWER(TRIM(COALESCE(status, ''))) IN ('success', 'verified', 'paid', 'completed', '1')
       ORDER BY payment_date DESC, id DESC`,
      [invoice.id]
    );
    invoice.payments = payments;

    return invoice;
  }

  static normalizeFrequency(freq) {
    return String(freq || '').toLowerCase().replace(/[\s_-]/g, '');
  }

  static getIntervalExpr(freq) {
    const f = this.normalizeFrequency(freq);
    if (['annually', 'annual', 'yearly'].includes(f)) return 'INTERVAL 1 YEAR';
    if (['biannually', 'halfyearly', 'semiannually', 'semiannual'].includes(f)) return 'INTERVAL 6 MONTH';
    if (f === 'quarterly') return 'INTERVAL 3 MONTH';
    if (f === 'monthly') return 'INTERVAL 1 MONTH';
    return null;
  }

  static isOneTime(freq) {
    return this.normalizeFrequency(freq) === 'onetime';
  }

  static toLocalDateStr(dateInput) {
    if (!dateInput) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    const str = String(dateInput).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str;
    }
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return str.includes('T') ? str.split('T')[0] : str;
  }

  static async checkDuplicateInvoice({
    schoolId,
    branchId,
    feeStructureId,
    academicYearId,
    classId,
    sectionId,
    studentId,
    studentIds,
    issueDate,
  }) {
    if (!feeStructureId || !issueDate) {
      return { exists: false };
    }
    const effectiveIssueDate = this.toLocalDateStr(issueDate);

    // 1. Fetch fee structure info
    let structQuery = `SELECT id, name, frequency, start_month, due_day, grace_period_days, academic_year_id FROM fee_structures WHERE id = ? AND school_id = ?`;
    const structParams = [feeStructureId, schoolId];
    if (branchId) {
      structQuery += ` AND (branch_id = ? OR branch_id IS NULL)`;
      structParams.push(Number(branchId));
    }
    const [structRows] = await pool.query(structQuery, structParams);
    if (structRows.length === 0) {
      return { exists: false };
    }
    const structure = structRows[0];
    const frequency = structure.frequency;

    // 2. Identify target students
    let targetStudentIds = [];
    if (studentIds && Array.isArray(studentIds) && studentIds.length > 0) {
      targetStudentIds = studentIds.map((id) => Number(id)).filter(Boolean);
    } else if (studentIds && typeof studentIds === 'string' && studentIds.trim()) {
      targetStudentIds = studentIds.split(',').map((id) => Number(id.trim())).filter(Boolean);
    } else if (studentId) {
      targetStudentIds = [Number(studentId)];
    } else if (classId) {
      let stSql = `
        SELECT id FROM student_master 
        WHERE school_id = ? AND status = 1 AND (status != 4 OR status IS NULL)
          AND (class = ? OR class = (SELECT class_name FROM class_master WHERE id = ? LIMIT 1))
      `;
      const stParams = [schoolId, classId, classId];
      if (branchId) {
        stSql += ` AND branch_id = ?`;
        stParams.push(Number(branchId));
      }
      if (sectionId) {
        stSql += ` AND (section = ? OR section = (SELECT section_name FROM section_master WHERE id = ? LIMIT 1))`;
        stParams.push(sectionId, sectionId);
      }
      const [stRows] = await pool.query(stSql, stParams);
      targetStudentIds = stRows.map((r) => r.id);
    }

    if (targetStudentIds.length === 0) {
      return { exists: false, totalStudents: 0, alreadyInvoicedCount: 0, alreadyInvoicedStudentIds: [] };
    }

    // 3. Check for existing fee invoices for these students matching structure and issue_date interval
    const intervalExpr = this.getIntervalExpr(frequency);

    const nextAllowedSelect = intervalExpr
      ? `DATE_FORMAT(DATE_ADD(DATE(fi.issue_date), ${intervalExpr}), '%d/%m/%Y') AS next_allowed_date_str,
         DATE_FORMAT(DATE_SUB(DATE_ADD(DATE(fi.issue_date), ${intervalExpr}), INTERVAL 1 DAY), '%d/%m/%Y') AS period_end_date_str,`
      : `NULL AS next_allowed_date_str, NULL AS period_end_date_str,`;

    let checkQuery = `
      SELECT fi.id, fi.invoice_no, fi.student_id, fi.issue_date, fi.due_date, fi.total_amount,
             DATE_FORMAT(DATE(fi.issue_date), '%d/%m/%Y') AS issue_date_str,
             ${nextAllowedSelect}
             CONCAT(TRIM(IFNULL(sm.first_name, '')), ' ', TRIM(IFNULL(sm.last_name, ''))) AS student_name,
             sm.admission_number, sm.roll_number
      FROM fee_invoices fi
      LEFT JOIN student_master sm ON sm.id = fi.student_id
      WHERE fi.school_id = ?
        AND fi.fee_structure_id = ?
        AND fi.status != '4'
        AND fi.student_id IN (?)
    `;
    const checkParams = [schoolId, feeStructureId, targetStudentIds];

    if (branchId) {
      checkQuery += ` AND (fi.branch_id = ? OR fi.branch_id IS NULL)`;
      checkParams.push(Number(branchId));
    }

    if (this.isOneTime(frequency)) {
      // One-time fee: any existing active invoice for this structure and student is a duplicate
    } else if (intervalExpr) {
      checkQuery += `
        AND DATE(?) > DATE_SUB(DATE(fi.issue_date), ${intervalExpr})
        AND DATE(?) < DATE_ADD(DATE(fi.issue_date), ${intervalExpr})`;
      checkParams.push(effectiveIssueDate, effectiveIssueDate);
    } else {
      checkQuery += ` AND DATE(fi.issue_date) = DATE(?)`;
      checkParams.push(effectiveIssueDate);
    }

    checkQuery += ` ORDER BY fi.issue_date DESC, fi.id DESC`;

    const [existingRows] = await pool.query(checkQuery, checkParams);

    const alreadyInvoicedStudentIds = Array.from(new Set(existingRows.map((r) => r.student_id)));
    const alreadyInvoicedCount = alreadyInvoicedStudentIds.length;
    const totalStudents = targetStudentIds.length;
    const allAlreadyInvoiced = totalStudents > 0 && alreadyInvoicedCount >= totalStudents;

    if (alreadyInvoicedCount > 0) {
      const sample = existingRows[0];
      const sampleDateStr = sample.issue_date_str || (sample.issue_date ? new Date(sample.issue_date).toLocaleDateString('en-GB') : effectiveIssueDate);
      const nextAllowedStr = sample.next_allowed_date_str;
      const periodEndStr = sample.period_end_date_str;

      let message = '';
      if (allAlreadyInvoiced) {
        if (nextAllowedStr && periodEndStr) {
          message = `An ${structure.frequency} invoice for "${structure.name}" has already been generated for all selected student(s) on ${sampleDateStr} (valid up to ${periodEndStr}). Next invoice can only be generated from ${nextAllowedStr} onwards.`;
        } else {
          message = `An ${structure.frequency} invoice for "${structure.name}" has already been generated for all selected student(s) on ${sampleDateStr}. Duplicate generation is prevented.`;
        }
      } else {
        if (nextAllowedStr) {
          message = `${alreadyInvoicedCount} of ${totalStudents} student(s) already have an invoice for "${structure.name}" generated on ${sampleDateStr} (next eligible from ${nextAllowedStr}).`;
        } else {
          message = `${alreadyInvoicedCount} of ${totalStudents} student(s) already have an invoice for "${structure.name}" generated on ${sampleDateStr}.`;
        }
      }

      return {
        exists: allAlreadyInvoiced,
        alreadyInvoicedCount,
        totalStudents,
        alreadyInvoicedStudentIds,
        structureName: structure.name,
        frequency: structure.frequency,
        sampleDate: sampleDateStr,
        nextAllowedDate: nextAllowedStr || null,
        message,
        invoicedStudents: existingRows.map((r) => ({
          student_id: r.student_id,
          student_name: r.student_name,
          admission_number: r.admission_number,
          roll_number: r.roll_number,
          invoice_no: r.invoice_no,
          issue_date: r.issue_date,
        })),
      };
    }

    return {
      exists: false,
      alreadyInvoicedCount: 0,
      totalStudents,
      alreadyInvoicedStudentIds: [],
      structureName: structure.name,
      frequency: structure.frequency,
      message: '',
    };
  }

  static async generateInvoices({
    schoolId,
    branchId,
    academicYearId,
    classId,
    sectionId,
    studentId,
    studentIds,
    feeStructureId,
    title,
    issueDate,
    dueDate,
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Get structure and components
      let structQuery = `SELECT * FROM fee_structures WHERE id = ? AND school_id = ?`;
      const structParams = [feeStructureId, schoolId];
      if (branchId) {
        structQuery += ` AND (branch_id = ? OR branch_id IS NULL)`;
        structParams.push(Number(branchId));
      }
      const [structRows] = await connection.query(structQuery, structParams);
      if (structRows.length === 0) {
        throw new Error('Fee Structure not found.');
      }
      const structure = structRows[0];

      if (structure.status === 4) {
        throw new Error('Fee Structure has been deleted.');
      }

      if (Number(structure.is_published) !== 1) {
        throw new Error(
          `Cannot generate invoices: Fee Structure "${structure.name}" is in Draft mode. Fee structures must be published before invoices can be generated.`
        );
      }

      const effectiveIssueDate = this.toLocalDateStr(issueDate);

      const [components] = await connection.query(
        `SELECT fsc.*, fc.name AS component_name 
         FROM fee_structure_components fsc 
         LEFT JOIN fee_components fc ON fc.id = fsc.fee_component_id 
         WHERE fsc.fee_structure_id = ?`,
        [feeStructureId]
      );

      const subtotal = components.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
      const totalAmount = subtotal;

      // Calculate due date dynamically using explicit dueDate or issue_date + fee structure rules
      let finalDueDate = null;
      if (dueDate && String(dueDate).trim()) {
        finalDueDate = this.toLocalDateStr(dueDate);
      } else {
        const [issueYear, issueMonthOneBased, issueDay] = effectiveIssueDate.split('-').map(Number);
        const issueMonth = issueMonthOneBased - 1;
        const issueUtc = new Date(Date.UTC(issueYear, issueMonth, issueDay));
        const graceDays = Math.max(Number(structure.grace_period_days) || 0, 0);
        const rawDueDay = Number(structure.due_day) || 0;

        if (rawDueDay > 0) {
          const daysInIssueMonth = new Date(Date.UTC(issueYear, issueMonth + 1, 0)).getUTCDate();
          const dueDay = Math.min(Math.max(rawDueDay, 1), daysInIssueMonth);
          const targetDue = new Date(Date.UTC(issueYear, issueMonth, dueDay + graceDays));

          if (targetDue > issueUtc) {
            finalDueDate = targetDue.toISOString().split('T')[0];
          } else {
            const fallbackDue = new Date(Date.UTC(issueYear, issueMonth, issueDay + (graceDays > 0 ? graceDays : dueDay)));
            finalDueDate = fallbackDue.toISOString().split('T')[0];
          }
        } else {
          const fallbackDue = new Date(Date.UTC(issueYear, issueMonth, issueDay + graceDays));
          finalDueDate = fallbackDue.toISOString().split('T')[0];
        }
      }

      // 2. Identify target students
      let studentQuery = `
        SELECT id, class, section, branch_id 
        FROM student_master 
        WHERE school_id = ? AND status = 1 AND (status != 4 OR status IS NULL)
      `;
      const studentParams = [schoolId];

      if (branchId) {
        studentQuery += ` AND branch_id = ?`;
        studentParams.push(Number(branchId));
      }

      if (studentIds && Array.isArray(studentIds) && studentIds.length > 0) {
        studentQuery += ` AND id IN (?)`;
        studentParams.push(studentIds.map(Number));
      } else if (studentIds && typeof studentIds === 'string' && studentIds.trim()) {
        const parsedIds = studentIds.split(',').map((s) => Number(s.trim())).filter(Boolean);
        if (parsedIds.length > 0) {
          studentQuery += ` AND id IN (?)`;
          studentParams.push(parsedIds);
        }
      } else if (studentId) {
        studentQuery += ` AND id = ?`;
        studentParams.push(Number(studentId));
      } else {
        if (classId) {
          studentQuery += ` AND (class = ? OR class = (SELECT class_name FROM class_master WHERE id = ? LIMIT 1))`;
          studentParams.push(classId, classId);
        }
        if (sectionId) {
          studentQuery += ` AND (section = ? OR section = (SELECT section_name FROM section_master WHERE id = ? LIMIT 1))`;
          studentParams.push(sectionId, sectionId);
        }
      }

      const [targetStudents] = await connection.query(studentQuery, studentParams);
      if (targetStudents.length === 0) {
        throw new Error('No eligible students found to generate invoices.');
      }

      let generatedCount = 0;
      const frequency = structure.frequency;
      const targetYear = academicYearId || structure.academic_year_id || null;
      const intervalExpr = this.getIntervalExpr(frequency);

      for (const st of targetStudents) {
        // Prevent duplicate fee entries per student according to issue_date interval and frequency rules
        let studentDupSql = `
          SELECT id FROM fee_invoices 
          WHERE school_id = ? 
            AND student_id = ? 
            AND fee_structure_id = ? 
            AND status != '4'
        `;
        const studentDupParams = [schoolId, st.id, feeStructureId];

        if (branchId) {
          studentDupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
          studentDupParams.push(Number(branchId));
        }

        if (this.isOneTime(frequency)) {
          // One-time fee: any existing active invoice for this student and structure blocks duplicate generation
        } else if (intervalExpr) {
          studentDupSql += `
            AND DATE(?) > DATE_SUB(DATE(issue_date), ${intervalExpr})
            AND DATE(?) < DATE_ADD(DATE(issue_date), ${intervalExpr})`;
          studentDupParams.push(effectiveIssueDate, effectiveIssueDate);
        } else {
          studentDupSql += ` AND DATE(issue_date) = DATE(?)`;
          studentDupParams.push(effectiveIssueDate);
        }

        studentDupSql += ` LIMIT 1 FOR UPDATE`;
        const [studentExisting] = await connection.query(studentDupSql, studentDupParams);
        if (studentExisting.length > 0) {
          continue; // Skip student: already invoiced for this period
        }

        // Generate unique invoice number: INV-YYYYMMDD-RAND
        const randStr = Math.floor(1000 + Math.random() * 9000);
        const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const invoiceNo = `INV-${datePrefix}-${st.id}-${randStr}`;
        const invBranchId = st.branch_id || branchId || structure.branch_id || null;

        const [insRes] = await connection.query(
          `INSERT INTO fee_invoices (
             invoice_no, school_id, branch_id, student_id, class_id, section_id,
             academic_year_id, fee_structure_id, title, subtotal, concession_amount,
             late_fee_amount, total_amount, paid_amount, due_amount,
             issue_date, due_date, status, allow_partial_payment, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, 0.00, ?, 0.00, ?, ?, ?, 'Unpaid', ?, NOW())`,
          [
            invoiceNo,
            schoolId,
            invBranchId ? Number(invBranchId) : null,
            st.id,
            st.class,
            st.section || null,
            targetYear || null,
            feeStructureId,
            title || `${structure.name} - ${structure.frequency}`,
            subtotal,
            totalAmount,
            totalAmount,
            effectiveIssueDate,
            finalDueDate,
            structure.allow_partial_payment ? 1 : 0,
          ]
        );

        const invoiceId = insRes.insertId;

        // Insert invoice items
        for (const comp of components) {
          await connection.query(
            `INSERT INTO fee_invoice_items (branch_id, invoice_id, fee_component_id, component_name, amount)
             VALUES (?, ?, ?, ?, ?)`,
            [invBranchId ? Number(invBranchId) : null, invoiceId, comp.fee_component_id, comp.component_name || 'Fee Component', comp.amount]
          );
        }

        generatedCount++;
      }

      if (generatedCount === 0) {
        throw new Error(
          `Invoices for Fee Structure "${structure.name}" have already been generated for the selected student(s) within this year/period. Duplicate invoices cannot be created.`
        );
      }

      await connection.commit();
      return generatedCount;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async deleteInvoice(id, schoolId, branchId = null) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let invCheckSql = `SELECT id FROM fee_invoices WHERE id = ? AND school_id = ?`;
      const invCheckParams = [id, schoolId];
      if (branchId) {
        invCheckSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        invCheckParams.push(Number(branchId));
      }
      const [invRows] = await connection.query(invCheckSql, invCheckParams);
      if (invRows.length === 0) {
        await connection.rollback();
        return false;
      }

      await connection.query(`UPDATE fee_invoice_items SET status = 4 WHERE invoice_id = ?`, [id]);
      await connection.query(`UPDATE fee_payments SET status = 4 WHERE invoice_id = ?`, [id]);

      let updateSql = `UPDATE fee_invoices SET status = '4', updated_at = NOW() WHERE id = ? AND school_id = ?`;
      const updateParams = [id, schoolId];
      if (branchId) {
        updateSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        updateParams.push(Number(branchId));
      }
      const [res] = await connection.query(updateSql, updateParams);
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
  // 5. FEE PAYMENTS & COLLECTION STATS
  // =========================================================

  static async getCollectionStats(schoolId, branchId = null) {
    let paymentWhere = `WHERE fp.school_id = ?`;
    const payParams = [schoolId];
    if (branchId) {
      paymentWhere += ` AND (fp.branch_id = ? OR sm.branch_id = ?)`;
      payParams.push(Number(branchId), Number(branchId));
    }

    // Total collected
    const [collectedRes] = await pool.query(
      `SELECT COALESCE(SUM(fp.amount_paid), 0) AS total_collected 
       FROM fee_payments fp 
       LEFT JOIN student_master sm ON sm.id = fp.student_id 
       ${paymentWhere}`,
      payParams
    );

    let invWhere = `WHERE fi.school_id = ?`;
    const invParams = [schoolId];
    if (branchId) {
      invWhere += ` AND (fi.branch_id = ? OR sm.branch_id = ?)`;
      invParams.push(Number(branchId), Number(branchId));
    }

    // Total invoiced & pending dues
    const [invoiceRes] = await pool.query(
      `SELECT 
         COALESCE(SUM(fi.total_amount), 0) AS total_invoiced,
         COALESCE(SUM(fi.due_amount), 0) AS total_due,
         COUNT(fi.id) AS total_invoices,
         COUNT(CASE WHEN fi.status = 'Paid' THEN 1 END) AS paid_invoices,
         COUNT(CASE WHEN fi.status = 'Unpaid' THEN 1 END) AS unpaid_invoices,
         COUNT(CASE WHEN fi.status = 'Partial' THEN 1 END) AS partial_invoices,
         COUNT(CASE WHEN fi.status = 'Overdue' OR (fi.status = 'Unpaid' AND fi.due_date < CURDATE()) THEN 1 END) AS overdue_invoices
       FROM fee_invoices fi 
       LEFT JOIN student_master sm ON sm.id = fi.student_id 
       ${invWhere}`,
      invParams
    );

    // Today's collection
    const todayParams = [schoolId];
    let todayWhere = `WHERE fp.school_id = ? AND DATE(fp.payment_date) = CURDATE()`;
    if (branchId) {
      todayWhere += ` AND (fp.branch_id = ? OR sm.branch_id = ?)`;
      todayParams.push(Number(branchId), Number(branchId));
    }
    const [todayRes] = await pool.query(
      `SELECT COALESCE(SUM(fp.amount_paid), 0) AS today_collected 
       FROM fee_payments fp 
       LEFT JOIN student_master sm ON sm.id = fp.student_id 
       ${todayWhere}`,
      todayParams
    );

    // This month's collection
    const monthParams = [schoolId];
    let monthWhere = `WHERE fp.school_id = ? 
       AND MONTH(fp.payment_date) = MONTH(CURDATE()) 
       AND YEAR(fp.payment_date) = YEAR(CURDATE())`;
    if (branchId) {
      monthWhere += ` AND (fp.branch_id = ? OR sm.branch_id = ?)`;
      monthParams.push(Number(branchId), Number(branchId));
    }
    const [monthRes] = await pool.query(
      `SELECT COALESCE(SUM(fp.amount_paid), 0) AS month_collected 
       FROM fee_payments fp 
       LEFT JOIN student_master sm ON sm.id = fp.student_id 
       ${monthWhere}`,
      monthParams
    );

    return {
      totalCollected: parseFloat(collectedRes[0]?.total_collected || 0),
      totalInvoiced: parseFloat(invoiceRes[0]?.total_invoiced || 0),
      totalDue: parseFloat(invoiceRes[0]?.total_due || 0),
      todayCollected: parseFloat(todayRes[0]?.today_collected || 0),
      monthCollected: parseFloat(monthRes[0]?.month_collected || 0),
      invoiceCounts: invoiceRes[0] || {},
    };
  }

  static async getAllPayments({ schoolId, branchId = null, studentId, invoiceId, paymentMethod, status, dateFrom, dateTo, search }) {
    let query = `
      SELECT 
        fp.id,
        fp.txn_no,
        fp.receipt_no,
        fp.school_id,
        COALESCE(fp.branch_id, sm.branch_id) AS branch_id,
        brm.branch_name,
        brm.branch_code,
        fp.student_id,
        fp.invoice_id,
        fp.amount_paid,
        fp.late_fee_paid,
        fp.payment_method,
        fp.reference_no,
        fp.payment_date,
        fp.bank_name,
        fp.status,
        fp.bounced_penalty,
        fp.notes,
        fp.collected_by,
        fp.created_at,
        fp.receipt_file,
        sm.first_name,
        sm.last_name,
        sm.admission_number,
        sm.roll_number,
        cm.class_name,
        sec.section_name,
        fi.invoice_no,
        fi.title AS invoice_title,
        fi.total_amount AS invoice_total,
        fi.due_amount AS invoice_due,
        fi.status AS invoice_status
      FROM fee_payments fp
      INNER JOIN student_master sm ON sm.id = fp.student_id
      LEFT JOIN branch_master brm ON brm.id = COALESCE(fp.branch_id, sm.branch_id)
      LEFT JOIN class_master cm ON cm.id = sm.class
      LEFT JOIN section_master sec ON sec.id = sm.section
      LEFT JOIN fee_invoices fi ON fi.id = fp.invoice_id
      WHERE fp.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      query += ` AND (fp.branch_id = ? OR sm.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }
    if (studentId) {
      query += ` AND fp.student_id = ?`;
      params.push(studentId);
    }
    if (invoiceId) {
      query += ` AND fp.invoice_id = ?`;
      params.push(invoiceId);
    }
    if (paymentMethod) {
      query += ` AND fp.payment_method = ?`;
      params.push(paymentMethod);
    }
    if (status) {
      query += ` AND fp.status = ?`;
      params.push(status);
    }
    if (dateFrom) {
      query += ` AND fp.payment_date >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND fp.payment_date <= ?`;
      params.push(dateTo);
    }
    if (search) {
      query += ` AND (fp.receipt_no LIKE ? OR fp.txn_no LIKE ? OR sm.first_name LIKE ? OR sm.last_name LIKE ? OR sm.admission_number LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY fp.id DESC`;
    const [payments] = await pool.query(query, params);
    return payments;
  }

  static async getPaymentById(id, schoolId, branchId = null) {
    let query = `
      SELECT 
        fp.*,
        COALESCE(fp.branch_id, sm.branch_id) AS branch_id,
        brm.branch_name,
        brm.branch_code,
        brm.address AS branch_address,
        sch.school_name,
        sch.school_logo,
        sch.address AS school_address,
        sch.phone_number AS school_phone,
        sch.email AS school_email,
        sm.first_name,
        sm.last_name,
        sm.admission_number,
        sm.roll_number,
        sm.primary_contact_number,
        sm.email_address,
        cm.class_name,
        sec.section_name,
        fi.invoice_no,
        fi.title AS invoice_title,
        fi.total_amount AS invoice_total,
        fi.due_amount AS invoice_due,
        ay.academic_year
      FROM fee_payments fp
      INNER JOIN student_master sm ON sm.id = fp.student_id
      LEFT JOIN school_master sch ON sch.id = fp.school_id
      LEFT JOIN branch_master brm ON brm.id = COALESCE(fp.branch_id, sm.branch_id)
      LEFT JOIN class_master cm ON cm.id = sm.class
      LEFT JOIN section_master sec ON sec.id = sm.section
      LEFT JOIN fee_invoices fi ON fi.id = fp.invoice_id
      LEFT JOIN academic_year_master ay ON ay.id = fi.academic_year_id
      WHERE fp.id = ? AND fp.school_id = ?
    `;
    const params = [id, schoolId];
    if (branchId) {
      query += ` AND (fp.branch_id = ? OR sm.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }
    const [rows] = await pool.query(query, params);
    if (rows.length === 0) return null;

    const payment = rows[0];

    // Fetch invoice items breakdown
    if (payment.invoice_id) {
      const [items] = await pool.query(`SELECT * FROM fee_invoice_items WHERE invoice_id = ?`, [payment.invoice_id]);
      payment.items = items;
    } else {
      payment.items = [];
    }

    return payment;
  }

  /**
   * Fetches single or batch payment receipt data matching the ID Card data flow pattern
   */
  static async getReceiptData({ schoolId, branchId = null, paymentIds = [], paymentId = null, classId = null, sectionId = null }) {
    let ids = [];
    if (paymentId) {
      ids = [paymentId];
    } else if (Array.isArray(paymentIds) && paymentIds.length > 0) {
      ids = paymentIds.map((id) => parseInt(id, 10)).filter(Boolean);
    }

    let query = `
      SELECT 
        fp.*,
        COALESCE(fp.branch_id, sm.branch_id) AS branch_id,
        brm.branch_name,
        brm.branch_code,
        brm.address AS branch_address,
        sch.school_name,
        sch.school_logo,
        sch.address AS school_address,
        sch.phone_number AS school_phone,
        sch.email AS school_email,
        sm.first_name,
        sm.last_name,
        sm.admission_number,
        sm.roll_number,
        sm.primary_contact_number,
        sm.email_address,
        cm.class_name,
        sec.section_name,
        fi.invoice_no,
        fi.title AS invoice_title,
        fi.total_amount AS invoice_total,
        fi.due_amount AS invoice_due,
        ay.academic_year
      FROM fee_payments fp
      INNER JOIN student_master sm ON sm.id = fp.student_id
      LEFT JOIN school_master sch ON sch.id = fp.school_id
      LEFT JOIN branch_master brm ON brm.id = COALESCE(fp.branch_id, sm.branch_id)
      LEFT JOIN class_master cm ON cm.id = sm.class
      LEFT JOIN section_master sec ON sec.id = sm.section
      LEFT JOIN fee_invoices fi ON fi.id = fp.invoice_id
      LEFT JOIN academic_year_master ay ON ay.id = fi.academic_year_id
      WHERE fp.school_id = ?
    `;

    const params = [schoolId];

    if (branchId) {
      query += ` AND (fp.branch_id = ? OR sm.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }

    if (ids.length > 0) {
      query += ` AND fp.id IN (?)`;
      params.push(ids);
    }

    if (classId) {
      query += ` AND sm.class = ?`;
      params.push(classId);
    }

    if (sectionId) {
      query += ` AND sm.section = ?`;
      params.push(sectionId);
    }

    query += ` ORDER BY fp.payment_date DESC, fp.id DESC`;

    const [payments] = await pool.query(query, params);
    if (!payments || payments.length === 0) return [];

    // Fetch invoice items breakdown for all invoices in the batch
    const invoiceIds = [...new Set(payments.map((p) => p.invoice_id).filter(Boolean))];
    if (invoiceIds.length > 0) {
      const [items] = await pool.query(
        `SELECT * FROM fee_invoice_items WHERE invoice_id IN (?)`,
        [invoiceIds]
      );
      const itemsByInvoice = {};
      items.forEach((item) => {
        if (!itemsByInvoice[item.invoice_id]) itemsByInvoice[item.invoice_id] = [];
        itemsByInvoice[item.invoice_id].push(item);
      });
      payments.forEach((payment) => {
        payment.items = itemsByInvoice[payment.invoice_id] || [];
      });
    } else {
      payments.forEach((payment) => {
        payment.items = [];
      });
    }

    return payments;
  }

  static async recordPayment({
    schoolId,
    branchId,
    studentId,
    invoiceId,
    amountPaid,
    paymentMethod,
    paymentDate,
    referenceNo,
    bankName,
    lateFeePaid,
    notes,
    collectedBy,
    receiptFile,
    status = 'Success',
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Fetch invoice
      const [invRows] = await connection.query(
        `SELECT * FROM fee_invoices WHERE id = ? AND school_id = ?`,
        [invoiceId, schoolId]
      );
      if (invRows.length === 0) {
        throw new Error('Invoice not found.');
      }
      const invoice = invRows[0];

      const paidAmountNum = parseFloat(amountPaid) || 0;
      const lateFeeNum = parseFloat(lateFeePaid) || 0;

      // 2. Generate Receipt & Txn No
      const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randNum = Math.floor(1000 + Math.random() * 9000);
      const receiptNo = `REC-${datePrefix}-${randNum}`;
      const txnNo = `TXN-${datePrefix}-${randNum}`;
      const paymentBranchId = invoice.branch_id || branchId || null;
      const paymentStatus = status || 'Success';

      const [payRes] = await connection.query(
        `INSERT INTO fee_payments (
           txn_no, receipt_no, school_id, branch_id, student_id, invoice_id,
           amount_paid, late_fee_paid, payment_method, reference_no,
           payment_date, bank_name, status, notes, collected_by, receipt_file, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          txnNo,
          receiptNo,
          schoolId,
          paymentBranchId ? Number(paymentBranchId) : null,
          studentId || invoice.student_id,
          invoiceId,
          paidAmountNum,
          lateFeeNum,
          paymentMethod || 'Cash',
          referenceNo || null,
          paymentDate || new Date().toISOString().split('T')[0],
          bankName || null,
          paymentStatus,
          notes || null,
          collectedBy || null,
          receiptFile || null,
        ]
      );

      const paymentId = payRes.insertId;

      // 3. Update Invoice totals & status
      let newTotalPaid = parseFloat(invoice.paid_amount || 0);
      let newDueAmount = parseFloat(invoice.due_amount || 0);
      let newStatus = invoice.status;

      if (paymentStatus === 'Pending Verification') {
        newStatus = 'Pending Verification';
      } else {
        newTotalPaid = parseFloat(invoice.paid_amount || 0) + paidAmountNum;
        newDueAmount = Math.max(0, parseFloat(invoice.total_amount || 0) - newTotalPaid);
        newStatus = newDueAmount <= 0 ? 'Paid' : newTotalPaid > 0 ? 'Partial' : 'Unpaid';
      }

      await connection.query(
        `UPDATE fee_invoices SET 
           paid_amount = ?,
           due_amount = ?,
           status = ?
         WHERE id = ?`,
        [newTotalPaid, newDueAmount, newStatus, invoiceId]
      );

      await connection.commit();
      return {
        paymentId,
        receiptNo,
        txnNo,
        amountPaid: paidAmountNum,
        newDueAmount,
        newStatus,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Verify / Approve or Reject Fee Payment (Offline / Receipt Proof Verification)
   */
  static async verifyPayment({ paymentId, schoolId, branchId = null, action, rejectionReason, verifiedBy }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Fetch the payment record
      let paySql = `SELECT * FROM fee_payments WHERE id = ? AND school_id = ?`;
      const payParams = [paymentId, schoolId];
      if (branchId) {
        paySql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        payParams.push(Number(branchId));
      }
      const [payRows] = await connection.query(paySql, payParams);
      if (payRows.length === 0) {
        throw new Error('Fee payment record not found.');
      }
      const payment = payRows[0];

      if (payment.status !== 'Pending Verification' && payment.status !== 'pending') {
        throw new Error(`This payment has already been processed with status: ${payment.status}`);
      }

      const invoiceId = payment.invoice_id;
      let newPaymentStatus = 'Success';
      let updateNote = payment.notes || '';

      if (action === 'approve') {
        newPaymentStatus = 'Success';
        updateNote = updateNote ? `${updateNote} [Verified by Admin]` : 'Verified by Admin';
      } else if (action === 'reject') {
        newPaymentStatus = 'Rejected';
        const reasonStr = rejectionReason ? `: ${rejectionReason}` : '';
        updateNote = updateNote ? `${updateNote} [Rejected by Admin${reasonStr}]` : `Rejected by Admin${reasonStr}`;
      } else {
        throw new Error('Invalid verification action. Must be "approve" or "reject".');
      }

      // 2. Update the payment record
      await connection.query(
        `UPDATE fee_payments SET 
           status = ?, 
           notes = ?, 
           collected_by = COALESCE(?, collected_by)
         WHERE id = ?`,
        [newPaymentStatus, updateNote, verifiedBy || null, paymentId]
      );

      // 3. Recalculate Invoice totals and status if linked to an invoice
      let updatedInvoice = null;
      if (invoiceId) {
        const [invRows] = await connection.query(
          `SELECT * FROM fee_invoices WHERE id = ? AND school_id = ?`,
          [invoiceId, schoolId]
        );
        if (invRows.length > 0) {
          const invoice = invRows[0];

          // Calculate total verified paid amount from all successful payments for this invoice
          const [sumRows] = await connection.query(
            `SELECT COALESCE(SUM(amount_paid), 0) AS total_approved 
             FROM fee_payments 
             WHERE invoice_id = ? AND school_id = ? AND status IN ('Success', 'success', 'Verified')`,
            [invoiceId, schoolId]
          );
          const totalApproved = parseFloat(sumRows[0]?.total_approved || 0);

          // Check if there are any remaining pending verification payments
          const [pendingRows] = await connection.query(
            `SELECT COUNT(*) AS pending_count 
             FROM fee_payments 
             WHERE invoice_id = ? AND school_id = ? AND status IN ('Pending Verification', 'pending')`,
            [invoiceId, schoolId]
          );
          const pendingCount = parseInt(pendingRows[0]?.pending_count || 0, 10);

          const invoiceTotal = parseFloat(invoice.total_amount || 0);
          const newDue = Math.max(0, invoiceTotal - totalApproved);

          let newInvoiceStatus = 'Unpaid';
          if (pendingCount > 0) {
            newInvoiceStatus = 'Pending Verification';
          } else if (newDue <= 0) {
            newInvoiceStatus = 'Paid';
          } else if (totalApproved > 0) {
            newInvoiceStatus = 'Partial';
          } else {
            newInvoiceStatus = 'Unpaid';
          }

          await connection.query(
            `UPDATE fee_invoices SET 
               paid_amount = ?, 
               due_amount = ?, 
               status = ? 
             WHERE id = ?`,
            [totalApproved, newDue, newInvoiceStatus, invoiceId]
          );

          updatedInvoice = {
            id: invoiceId,
            paidAmount: totalApproved,
            dueAmount: newDue,
            status: newInvoiceStatus,
          };
        }
      }

      await connection.commit();
      return {
        paymentId,
        newStatus: newPaymentStatus,
        updatedInvoice,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = AdminFeesModel;
