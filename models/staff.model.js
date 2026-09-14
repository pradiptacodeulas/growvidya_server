const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');
const { saveBase64File } = require('../utils/file.util');

class StaffModel {
  static async getAll(schoolId, { search = '', role = '', status = '', branchId = null, limit = 12, offset = 0 } = {}) {
    let sql = `
      SELECT 
        u.id,
        u.school_id,
        u.branch_id,
        bm.branch_name,
        bm.branch_code,
        u.first_name,
        u.last_name,
        CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) AS full_name,
        u.email,
        u.phone,
        u.gender,
        CASE 
          WHEN u.gender = 1 OR u.gender = '1' OR LOWER(CAST(u.gender AS CHAR)) = 'male' THEN 'Male'
          WHEN u.gender = 2 OR u.gender = '2' OR LOWER(CAST(u.gender AS CHAR)) = 'female' THEN 'Female'
          WHEN u.gender = 3 OR u.gender = '3' OR LOWER(CAST(u.gender AS CHAR)) IN ('other', 'others') THEN 'Others'
          ELSE COALESCE(g.gender, 'N/A')
        END AS gender_name,
        u.blood_group,
        bg.blood_group AS blood_group_name,
        u.picture,
        u.role AS role_id,
        u.admin_type,
        CASE 
          WHEN u.admin_type = 1 THEN 'Super Admin'
          ELSE COALESCE(r.role_name, 'Staff')
        END AS role_name,
        u.status,
        u.date AS created_on
      FROM user_master u
      LEFT JOIN branch_master bm ON u.branch_id = bm.id
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (u.gender = 1 OR u.gender = '1' OR LOWER(CAST(u.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (u.gender = 2 OR u.gender = '2' OR LOWER(CAST(u.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (u.gender = 3 OR u.gender = '3' OR LOWER(CAST(u.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN blood_group_master bg ON bg.id = u.blood_group
      WHERE u.school_id = ?
    `;

    const params = [schoolId];

    if (branchId) {
      sql += ` AND u.branch_id = ?`;
      params.push(Number(branchId));
    }

    if (status === '1') {
      sql += ` AND u.status = 1`;
    } else if (status === '2') {
      sql += ` AND u.status = 2`;
    } else {
      sql += ` AND u.status != 4`;
    }

    if (role) {
      sql += ` AND u.role = ?`;
      params.push(role);
    }

    if (search) {
      sql += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam);
    }

    // Grouping
    sql += ` GROUP BY u.id`;

    // Get Total Count
    const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS counted`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0] ? countRows[0].total : 0;

    // Add Sorting and Pagination
    sql += ` ORDER BY u.id DESC LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(sql, [...params, Number(limit), Number(offset)]);

    return { staff: rows || [], total };
  }

  static async getById(id, schoolId) {
    const sql = `
      SELECT 
        u.id,
        u.school_id,
        u.branch_id,
        bm.branch_name,
        bm.branch_code,
        u.first_name,
        u.last_name,
        CONCAT(IFNULL(u.first_name, ''), ' ', IFNULL(u.last_name, '')) AS full_name,
        u.email,
        u.phone,
        u.gender,
        CASE 
          WHEN u.gender = 1 OR u.gender = '1' OR LOWER(CAST(u.gender AS CHAR)) = 'male' THEN 'Male'
          WHEN u.gender = 2 OR u.gender = '2' OR LOWER(CAST(u.gender AS CHAR)) = 'female' THEN 'Female'
          WHEN u.gender = 3 OR u.gender = '3' OR LOWER(CAST(u.gender AS CHAR)) IN ('other', 'others') THEN 'Others'
          ELSE COALESCE(g.gender, 'N/A')
        END AS gender_name,
        u.blood_group,
        bg.blood_group AS blood_group_name,
        u.picture,
        u.role AS role_id,
        u.admin_type,
        CASE 
          WHEN u.admin_type = 1 THEN 'Super Admin'
          ELSE COALESCE(r.role_name, 'Staff')
        END AS role_name,
        u.country_id,
        c.name AS country_name,
        u.state_id,
        s.state AS state_name,
        u.city,
        COALESCE(ci.name, u.city) AS city_name,
        u.status,
        u.date AS created_on
      FROM user_master u
      LEFT JOIN branch_master bm ON u.branch_id = bm.id
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN countries c ON u.country_id = c.id
      LEFT JOIN states s ON u.state_id = s.id_state
      LEFT JOIN cities ci ON (u.city = ci.id OR u.city = ci.name)
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (u.gender = 1 OR u.gender = '1' OR LOWER(CAST(u.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (u.gender = 2 OR u.gender = '2' OR LOWER(CAST(u.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (u.gender = 3 OR u.gender = '3' OR LOWER(CAST(u.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN blood_group_master bg ON bg.id = u.blood_group
      WHERE u.id = ? AND u.school_id = ?
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [id, schoolId]);
    const staffMember = rows[0];
    if (!staffMember) return null;

    // Fetch Bank Details
    try {
      const [bankRows] = await pool.query(
        `SELECT * FROM user_bank WHERE user_id = ? AND status != 0 LIMIT 1`,
        [id]
      );
      staffMember.bank_details = bankRows[0] || null;
    } catch {
      staffMember.bank_details = null;
    }

    // Fetch Transport Details
    try {
      const [transRows] = await pool.query(
        `SELECT ut.*, tr.transport_route AS route_name, tv.vehicle_number AS vehicle_name
         FROM user_transport ut
         LEFT JOIN trans_route_master tr ON ut.route = tr.id
         LEFT JOIN trans_vehicle_master tv ON ut.vehicle_number = tv.id
         WHERE ut.user_id = ? AND ut.staus != 0
         LIMIT 1`,
        [id]
      );
      staffMember.transport_details = transRows[0] || null;
    } catch {
      staffMember.transport_details = null;
    }

    // Fetch Hostel Details
    try {
      const [hostelRows] = await pool.query(
        `SELECT uh.*, hn.hostel_name AS hostel_label, hr.room_number AS room_label
         FROM user_hostel uh
         LEFT JOIN hostel_name_master hn ON uh.hostel_name = hn.id
         LEFT JOIN hostel_room_master hr ON uh.room_number = hr.id
         WHERE uh.user_id = ? AND uh.status != 0
         LIMIT 1`,
        [id]
      );
      staffMember.hostel_details = hostelRows[0] || null;
    } catch {
      staffMember.hostel_details = null;
    }

    // Fetch Documents
    try {
      const [docRows] = await pool.query(
        `SELECT ud.*, dtm.document_type_name
         FROM user_document ud
         LEFT JOIN document_type_master dtm ON ud.document_type = dtm.id
         WHERE ud.user_id = ? AND ud.status != 0`,
        [id]
      );
      staffMember.documents = docRows || [];
    } catch {
      staffMember.documents = [];
    }

    return staffMember;
  }

  static async checkEmail(schoolId, email, excludeId = null) {
    if (!email || !String(email).trim()) return false;
    let sql = `SELECT id FROM user_master WHERE email = ? AND school_id = ? AND status != 4`;
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
    let sql = `SELECT id FROM user_master WHERE phone = ? AND school_id = ? AND status != 4`;
    const params = [String(phone).trim(), schoolId];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return rows.length > 0;
  }

  static async checkDuplicate(schoolId, { email, phone }, excludeId = null) {
    const isEmailDuplicate = email ? await StaffModel.checkEmail(schoolId, email, excludeId) : false;
    const isPhoneDuplicate = phone ? await StaffModel.checkPhone(schoolId, phone, excludeId) : false;
    return { isEmailDuplicate, isPhoneDuplicate };
  }

  static async create(schoolId, data) {
    const trimmedEmail = data.email && String(data.email).trim() ? String(data.email).trim() : null;
    const trimmedPhone = data.phone && String(data.phone).trim() ? String(data.phone).trim() : null;

    if (trimmedEmail) {
      const isEmailDup = await StaffModel.checkEmail(schoolId, trimmedEmail);
      if (isEmailDup) {
        const err = new Error('A staff member with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (trimmedPhone) {
      const isPhoneDup = await StaffModel.checkPhone(schoolId, trimmedPhone);
      if (isPhoneDup) {
        const err = new Error('A staff member with this mobile number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    let picturePath = null;
    if (data.picture && data.picture.startsWith('data:image')) {
      picturePath = saveBase64File(data.picture, 'public/upload/staff');
    } else if (data.picture && !data.picture.startsWith('data:')) {
      picturePath = data.picture;
    }

    const hashedPassword = data.password ? await hashPassword(data.password) : await hashPassword('123456');

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

    const sql = `
      INSERT INTO user_master (
        school_id, branch_id, first_name, last_name, email, phone, password, gender,
        blood_group, picture, country_id, state_id, city, role, admin_type, status, date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const params = [
      schoolId,
      branchId,
      data.first_name || '',
      data.last_name || '',
      trimmedEmail,
      trimmedPhone,
      hashedPassword,
      data.gender || '1',
      data.blood_group || null,
      picturePath,
      data.country_id || null,
      data.state_id || null,
      data.city || null,
      data.role || 6,
      data.admin_type || 0,
      data.status !== undefined ? data.status : 1,
    ];

    const [result] = await pool.query(sql, params);
    const userId = result.insertId;

    // 1. Bank
    if (data.account_name || data.account_number || data.bank_name || data.ifsc_code || data.branch_name) {
      try {
        await pool.query(
          `INSERT INTO user_bank (school_id, user_id, account_name, account_number, bank_name, ifsc_code, branch_name, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
          [
            schoolId,
            userId,
            data.account_name || `${data.first_name} ${data.last_name}`,
            data.account_number || '',
            data.bank_name || '',
            data.ifsc_code || '',
            data.branch_name || '',
          ]
        );
      } catch (err) {
        console.error('Error inserting user_bank:', err);
      }
    }

    // 2. Transport
    if (data.route || data.vehicle_number || data.pickup_point || data.drop_point) {
      try {
        await pool.query(
          `INSERT INTO user_transport (school_id, user_id, route, vehicle_number, pickup_point, drop_point, staus, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
          [
            schoolId,
            userId,
            data.route || null,
            data.vehicle_number || null,
            data.pickup_point || '',
            data.drop_point || '',
          ]
        );
      } catch (err) {
        console.error('Error inserting user_transport:', err);
      }
    }

    // 3. Hostel
    if (data.hostel_name || data.room_no || data.room_number) {
      try {
        await pool.query(
          `INSERT INTO user_hostel (school_id, user_id, hostel_name, room_number, status, created_at)
           VALUES (?, ?, ?, ?, 1, NOW())`,
          [
            schoolId,
            userId,
            data.hostel_name || null,
            data.room_no || data.room_number || null,
          ]
        );
      } catch (err) {
        console.error('Error inserting user_hostel:', err);
      }
    }

    // 4. Documents
    if (Array.isArray(data.documents) && data.documents.length > 0) {
      for (const doc of data.documents) {
        let docPath = null;
        if (doc.file && doc.file.startsWith('data:')) {
          docPath = saveBase64File(doc.file, 'public/upload/staff/documents');
        } else if (doc.file) {
          docPath = doc.file;
        }

        try {
          await pool.query(
            `INSERT INTO user_document (school_id, user_id, document_type, attachments, status, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())`,
            [
              schoolId,
              userId,
              doc.document_type || null,
              docPath || doc.attachments || doc.file_name || '',
            ]
          );
        } catch (err) {
          console.error('Error inserting user_document:', err);
        }
      }
    }

    return this.getById(userId, schoolId);
  }

  static async update(id, schoolId, data) {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const trimmedEmail = data.email !== undefined
      ? (data.email && String(data.email).trim() ? String(data.email).trim() : null)
      : existing.email;
    const trimmedPhone = data.phone !== undefined
      ? (data.phone && String(data.phone).trim() ? String(data.phone).trim() : null)
      : existing.phone;

    if (trimmedEmail) {
      const isEmailDup = await StaffModel.checkEmail(schoolId, trimmedEmail, id);
      if (isEmailDup) {
        const err = new Error('A staff member with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (trimmedPhone) {
      const isPhoneDup = await StaffModel.checkPhone(schoolId, trimmedPhone, id);
      if (isPhoneDup) {
        const err = new Error('A staff member with this mobile number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    let picturePath = existing.picture;
    if (data.picture && data.picture.startsWith('data:image')) {
      picturePath = saveBase64File(data.picture, 'public/upload/staff');
    } else if (data.picture && !data.picture.startsWith('data:')) {
      picturePath = data.picture;
    }

    let updatePasswordClause = '';
    const params = [
      data.first_name !== undefined ? data.first_name : existing.first_name,
      data.last_name !== undefined ? data.last_name : existing.last_name,
      trimmedEmail,
      trimmedPhone,
      data.gender !== undefined ? data.gender : existing.gender,
      data.blood_group !== undefined ? (data.blood_group || null) : existing.blood_group,
      picturePath,
      data.role !== undefined ? data.role : existing.role_id,
      data.country_id !== undefined ? data.country_id : existing.country_id,
      data.state_id !== undefined ? data.state_id : existing.state_id,
      data.city !== undefined ? data.city : existing.city,
      data.status !== undefined ? data.status : existing.status,
      data.branch_id || null,
    ];

    if (data.password && String(data.password).trim() !== '') {
      const hashed = await hashPassword(data.password);
      updatePasswordClause = `, password = ?`;
      params.push(hashed);
    }

    params.push(id, schoolId);

    const sql = `
      UPDATE user_master SET
        first_name = ?,
        last_name = ?,
        email = ?,
        phone = ?,
        gender = ?,
        blood_group = ?,
        picture = ?,
        role = ?,
        country_id = ?,
        state_id = ?,
        city = ?,
        status = ?,
        branch_id = COALESCE(?, branch_id)
        ${updatePasswordClause}
      WHERE id = ? AND school_id = ?
    `;

    await pool.query(sql, params);

    // 1. Bank
    if (data.account_number !== undefined || data.bank_name !== undefined || data.account_name !== undefined) {
      try {
        const [existingBank] = await pool.query(`SELECT id FROM user_bank WHERE user_id = ?`, [id]);
        if (existingBank && existingBank.length > 0) {
          await pool.query(
            `UPDATE user_bank SET
              account_name = ?, account_number = ?, bank_name = ?, ifsc_code = ?, branch_name = ?, updated_at = NOW()
             WHERE user_id = ?`,
            [
              data.account_name || `${data.first_name || existing.first_name} ${data.last_name || existing.last_name}`,
              data.account_number || '',
              data.bank_name || '',
              data.ifsc_code || '',
              data.branch_name || '',
              id,
            ]
          );
        } else if (data.account_number || data.bank_name || data.account_name) {
          await pool.query(
            `INSERT INTO user_bank (school_id, user_id, account_name, account_number, bank_name, ifsc_code, branch_name, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
            [
              schoolId,
              id,
              data.account_name || `${data.first_name || existing.first_name} ${data.last_name || existing.last_name}`,
              data.account_number || '',
              data.bank_name || '',
              data.ifsc_code || '',
              data.branch_name || '',
            ]
          );
        }
      } catch (err) {
        console.error('Error updating user_bank:', err);
      }
    }

    // 2. Transport
    if (data.route !== undefined || data.vehicle_number !== undefined || data.pickup_point !== undefined || data.drop_point !== undefined) {
      try {
        const [existingTrans] = await pool.query(`SELECT id FROM user_transport WHERE user_id = ?`, [id]);
        if (existingTrans && existingTrans.length > 0) {
          await pool.query(
            `UPDATE user_transport SET route = ?, vehicle_number = ?, pickup_point = ?, drop_point = ?, updated_at = NOW() WHERE user_id = ?`,
            [data.route || null, data.vehicle_number || null, data.pickup_point || '', data.drop_point || '', id]
          );
        } else if (data.route || data.vehicle_number || data.pickup_point || data.drop_point) {
          await pool.query(
            `INSERT INTO user_transport (school_id, user_id, route, vehicle_number, pickup_point, drop_point, staus, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
            [schoolId, id, data.route || null, data.vehicle_number || null, data.pickup_point || '', data.drop_point || '']
          );
        }
      } catch (err) {
        console.error('Error updating user_transport:', err);
      }
    }

    // 3. Hostel
    if (data.hostel_name !== undefined || data.room_no !== undefined || data.room_number !== undefined) {
      try {
        const [existingHostel] = await pool.query(`SELECT id FROM user_hostel WHERE user_id = ?`, [id]);
        if (existingHostel && existingHostel.length > 0) {
          await pool.query(
            `UPDATE user_hostel SET hostel_name = ?, room_number = ?, updated_at = NOW() WHERE user_id = ?`,
            [data.hostel_name || null, data.room_no || data.room_number || null, id]
          );
        } else if (data.hostel_name || data.room_no || data.room_number) {
          await pool.query(
            `INSERT INTO user_hostel (school_id, user_id, hostel_name, room_number, status, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())`,
            [schoolId, id, data.hostel_name || null, data.room_no || data.room_number || null]
          );
        }
      } catch (err) {
        console.error('Error updating user_hostel:', err);
      }
    }

    // 4. Handle Deleted Documents
    if (Array.isArray(data.deleted_documents) && data.deleted_documents.length > 0) {
      for (const docId of data.deleted_documents) {
        try {
          await pool.query(`UPDATE user_document SET status = 4 WHERE id = ? AND user_id = ?`, [docId, id]);
        } catch (err) {
          console.error('Error deleting user_document:', err);
        }
      }
    }

    // 5. Handle New Documents
    if (Array.isArray(data.documents) && data.documents.length > 0) {
      for (const doc of data.documents) {
        if (!doc.id) {
          try {
            await pool.query(
              `INSERT INTO user_document (school_id, user_id, document_type, attachments, status, created_at)
               VALUES (?, ?, ?, ?, 1, NOW())`,
              [schoolId, id, doc.document_type || null, doc.attachments || doc.file_name || '']
            );
          } catch (err) {
            console.error('Error inserting new user_document:', err);
          }
        }
      }
    }

    return this.getById(id, schoolId);
  }

  static async delete(id, schoolId) {
    // Prevent deletion of primary Super Admin accounts
    const [userRows] = await pool.query(
      `SELECT admin_type FROM user_master WHERE id = ? AND school_id = ? LIMIT 1`,
      [id, schoolId]
    );
    if (!userRows || userRows.length === 0) {
      return false;
    }
    if (Number(userRows[0].admin_type) === 1) {
      throw new Error('Primary Super Admin accounts cannot be deleted.');
    }

    const [result] = await pool.query(
      `UPDATE user_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );

    // Also soft-delete user documents
    try {
      await pool.query(
        `UPDATE user_document SET status = 4 WHERE user_id = ? AND school_id = ?`,
        [id, schoolId]
      );
    } catch (e) {
      console.error('Error soft-deleting user_document:', e.message);
    }

    return result.affectedRows > 0;
  }

  static async getRoles(schoolId) {
    const [rows] = await pool.query(
      `SELECT id, role_name, status FROM role_master WHERE school_id = ? AND status != 4 AND LOWER(TRIM(role_name)) != 'super admin' ORDER BY id ASC`,
      [schoolId]
    );
    return rows || [];
  }

  static async getOptions(schoolId) {
    const [roles] = await pool.query(
      `SELECT id, role_name, status FROM role_master WHERE school_id = ? AND status != 4 AND LOWER(TRIM(role_name)) != 'super admin' ORDER BY id ASC`,
      [schoolId]
    );

    const [countries] = await pool.query(
      `SELECT id, name, name AS country, name AS country_name, shortname, phonecode FROM countries WHERE status = 1 OR status IS NULL ORDER BY name ASC`
    );

    const [routes] = await pool.query(
      `SELECT id, transport_route, fare FROM trans_route_master WHERE school_id = ? AND status = 1 ORDER BY transport_route ASC`,
      [schoolId]
    );

    const [vehicles] = await pool.query(
      `SELECT id, vehicle_number FROM trans_vehicle_master WHERE school_id = ? AND status = 1 ORDER BY vehicle_number ASC`,
      [schoolId]
    );

    const [hostels] = await pool.query(
      `SELECT id, hostel_name, hostel_fee FROM hostel_name_master WHERE school_id = ? AND status = 1 ORDER BY hostel_name ASC`,
      [schoolId]
    );

    const [documentTypes] = await pool.query(
      `SELECT id, document_type_name FROM document_type_master WHERE school_id = ? AND status = 1 ORDER BY document_type_name ASC`,
      [schoolId]
    );

    const [bloodGroups] = await pool.query(
      `SELECT id, blood_group, blood_group AS name FROM blood_group_master ORDER BY id ASC`
    );

    return {
      roles: roles || [],
      countries: countries || [],
      routes: routes || [],
      vehicles: vehicles || [],
      hostels: hostels || [],
      documentTypes: documentTypes || [],
      bloodGroups: bloodGroups || [],
    };
  }

  static async getStates(countryId) {
    const [rows] = await pool.query(
      `SELECT id_state AS id, state AS name, country_id FROM states WHERE country_id = ? ORDER BY state ASC`,
      [countryId]
    );
    return rows || [];
  }

  static async getCities(stateId) {
    const [rows] = await pool.query(
      `SELECT id, name, state_id FROM cities WHERE state_id = ? ORDER BY name ASC`,
      [stateId]
    );
    return rows || [];
  }

  static async getRooms(hostelId, schoolId) {
    const [rows] = await pool.query(
      `SELECT id, room_number, hostel_id FROM hostel_room_master WHERE hostel_id = ? AND school_id = ? AND status = 1 ORDER BY room_number ASC`,
      [hostelId, schoolId]
    );
    return rows || [];
  }
}

module.exports = StaffModel;
