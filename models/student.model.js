const { pool } = require('../config/db.config');
const { saveBase64File } = require('../utils/file.util');
const { hashPassword } = require('../utils/password.util');

class StudentModel {
  static async getAll(schoolId, { search = '', classId = '', sectionId = '', status = '', admissionDate = '', branchId = null, limit = 12, offset = 0 } = {}) {
    let whereClauses = ['s.school_id = ?', 's.status != 4'];
    const params = [schoolId];

    if (branchId) {
      whereClauses.push('s.branch_id = ?');
      params.push(Number(branchId));
    }

    if (String(status) === '1') {
      whereClauses.push('s.status = 1');
    } else if (String(status) === '2') {
      whereClauses.push('s.status = 2');
    }

    if (classId) {
      whereClauses.push('(s.class = ? OR s.class = (SELECT class_name FROM class_master WHERE id = ? LIMIT 1))');
      params.push(classId, classId);
    }

    if (sectionId) {
      whereClauses.push('(s.section = ? OR s.section = (SELECT section_name FROM section_master WHERE id = ? LIMIT 1))');
      params.push(sectionId, sectionId);
    }

    if (admissionDate) {
      whereClauses.push('DATE(s.admission_date) = ?');
      params.push(admissionDate);
    }

    if (search && String(search).trim()) {
      const rawSearch = String(search).trim();
      const cleanSearch = rawSearch.replace(/[\s\-_/\\()]+/g, '');
      const searchParam = `%${rawSearch}%`;
      const compactParam = `%${cleanSearch}%`;
      const words = rawSearch.split(/\s+/).filter(Boolean);

      const conditions = [
        's.first_name LIKE ?',
        's.last_name LIKE ?',
        "CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) LIKE ?",
        "CONCAT(TRIM(IFNULL(s.last_name, '')), ' ', TRIM(IFNULL(s.first_name, ''))) LIKE ?",
        "REPLACE(CONCAT(IFNULL(s.first_name, ''), IFNULL(s.last_name, '')), ' ', '') LIKE ?",
        's.admission_number LIKE ?',
        's.roll_number LIKE ?',
        'CAST(s.id AS CHAR) = ?',
        'CAST(s.id AS CHAR) LIKE ?',
      ];
      const searchParams = [
        searchParam,
        searchParam,
        searchParam,
        searchParam,
        compactParam,
        searchParam,
        searchParam,
        rawSearch,
        searchParam,
      ];

      if (rawSearch.includes('@')) {
        conditions.push('s.email_address LIKE ?');
        searchParams.push(searchParam);
      }

      const phoneDigits = rawSearch.replace(/\D/g, '');
      if (phoneDigits.length >= 3) {
        conditions.push("REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(s.primary_contact_number, ''), '-', ''), ' ', ''), '+', ''), '(', '') LIKE ?");
        searchParams.push(`%${phoneDigits}%`);
      }

      if (words.length > 1) {
        const wordConditions = words.map(() => `(
          s.first_name LIKE ? OR 
          s.last_name LIKE ? OR 
          CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) LIKE ? OR 
          CONCAT(TRIM(IFNULL(s.last_name, '')), ' ', TRIM(IFNULL(s.first_name, ''))) LIKE ? OR
          s.admission_number LIKE ? OR 
          s.roll_number LIKE ? OR 
          CAST(s.id AS CHAR) = ? OR
          s.primary_contact_number LIKE ?
        )`);
        const wordParams = [];
        words.forEach((w) => {
          const wp = `%${w}%`;
          wordParams.push(wp, wp, wp, wp, wp, wp, w, wp);
        });
        whereClauses.push(`((${conditions.join(' OR ')}) OR (${wordConditions.join(' AND ')}))`);
        params.push(...searchParams, ...wordParams);
      } else {
        whereClauses.push(`(${conditions.join(' OR ')})`);
        params.push(...searchParams);
      }
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT 
        s.id,
        s.school_id,
        s.admission_number,
        s.admission_date,
        s.roll_number,
        s.first_name,
        s.last_name,
        CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) AS full_name,
        s.class AS class_id,
        cm.class_name,
        s.section AS section_id,
        sec.section_name,
        s.academic_year AS academic_year_id,
        aym.start_date AS academic_year_start_date,
        aym.end_date AS academic_year_end_date,
        CASE 
          WHEN aym.academic_year LIKE '%-%' THEN aym.academic_year
          WHEN aym.start_date IS NOT NULL AND aym.end_date IS NOT NULL AND YEAR(aym.end_date) > YEAR(aym.start_date)
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.end_date))
          WHEN aym.start_date IS NOT NULL 
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.start_date) + 1)
          WHEN aym.academic_year REGEXP '^[0-9]{4}$' 
            THEN CONCAT(aym.academic_year, ' - ', CAST(aym.academic_year AS UNSIGNED) + 1)
          ELSE COALESCE(aym.academic_year, s.academic_year)
        END AS academic_year_name,
        CASE 
          WHEN aym.academic_year LIKE '%-%' THEN aym.academic_year
          WHEN aym.start_date IS NOT NULL AND aym.end_date IS NOT NULL AND YEAR(aym.end_date) > YEAR(aym.start_date)
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.end_date))
          WHEN aym.start_date IS NOT NULL 
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.start_date) + 1)
          WHEN aym.academic_year REGEXP '^[0-9]{4}$' 
            THEN CONCAT(aym.academic_year, ' - ', CAST(aym.academic_year AS UNSIGNED) + 1)
          ELSE COALESCE(aym.academic_year, s.academic_year)
        END AS academic_year_range,
        COALESCE(g.gender, IF(s.gender = '1', 'Male', IF(s.gender = '2', 'Female', IF(s.gender = '3', 'Others', s.gender))), 'Male') AS gender,
        s.date_of_birth,
        s.primary_contact_number,
        s.email_address,
        s.status,
        s.picture,
        s.branch_id,
        brm.branch_name,
        brm.branch_code,
        p.id AS parent_id,
        CONCAT(TRIM(IFNULL(p.first_name, '')), ' ', TRIM(IFNULL(p.last_name, ''))) AS parent_name,
        p.phone AS parent_phone
      FROM student_master s
      LEFT JOIN branch_master brm ON s.branch_id = brm.id
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sec ON s.section = sec.id
      LEFT JOIN academic_year_master aym ON (s.academic_year = aym.id OR s.academic_year = aym.academic_year)
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (s.gender = 1 OR s.gender = '1' OR LOWER(CAST(s.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (s.gender = 2 OR s.gender = '2' OR LOWER(CAST(s.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (s.gender = 3 OR s.gender = '3' OR LOWER(CAST(s.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN student_to_parent stp ON s.id = stp.student_id
      LEFT JOIN parent_master p ON (stp.father_id = p.id OR stp.guardian_id = p.id)
      ${whereString}
      GROUP BY s.id 
      ORDER BY s.id DESC 
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM student_master s
      LEFT JOIN student_to_parent stp ON s.id = stp.student_id
      LEFT JOIN parent_master p ON (stp.father_id = p.id OR stp.guardian_id = p.id)
      ${whereString}
    `;

    const queryParams = [...params, Number(limit), Number(offset)];
    const [rows] = await pool.query(sql, queryParams);
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0]?.total || 0;

    try {
      const AcademicModel = require('./academic.model');
      (rows || []).forEach((st) => {
        const formatted = AcademicModel.formatYearRange({
          id: st.academic_year_id,
          academic_year: st.academic_year_name || st.academic_year,
          start_date: st.academic_year_start_date,
          end_date: st.academic_year_end_date,
        });
        if (formatted) {
          st.academic_year_name = formatted;
          st.academic_year_range = formatted;
          st.academic_year_display = formatted;
        }
      });
    } catch (e) {}

    return { students: rows || [], total };
  }

  static async getById(id, schoolId) {
    const sql = `
      SELECT 
        s.*,
        s.class AS class_id,
        s.section AS section_id,
        s.gender AS gender_id,
        s.blood_group AS blood_group_id,
        s.house AS house_id,
        s.religion AS religion_id,
        s.category AS category_id,
        s.mother_tongue AS mother_tongue_id,
        s.academic_year AS academic_year_id,
        aym.start_date AS academic_year_start_date,
        aym.end_date AS academic_year_end_date,
        CASE 
          WHEN aym.academic_year LIKE '%-%' THEN aym.academic_year
          WHEN aym.start_date IS NOT NULL AND aym.end_date IS NOT NULL AND YEAR(aym.end_date) > YEAR(aym.start_date)
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.end_date))
          WHEN aym.start_date IS NOT NULL 
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.start_date) + 1)
          WHEN aym.academic_year REGEXP '^[0-9]{4}$' 
            THEN CONCAT(aym.academic_year, ' - ', CAST(aym.academic_year AS UNSIGNED) + 1)
          ELSE COALESCE(aym.academic_year, s.academic_year)
        END AS academic_year_name,
        CASE 
          WHEN aym.academic_year LIKE '%-%' THEN aym.academic_year
          WHEN aym.start_date IS NOT NULL AND aym.end_date IS NOT NULL AND YEAR(aym.end_date) > YEAR(aym.start_date)
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.end_date))
          WHEN aym.start_date IS NOT NULL 
            THEN CONCAT(YEAR(aym.start_date), ' - ', YEAR(aym.start_date) + 1)
          WHEN aym.academic_year REGEXP '^[0-9]{4}$' 
            THEN CONCAT(aym.academic_year, ' - ', CAST(aym.academic_year AS UNSIGNED) + 1)
          ELSE COALESCE(aym.academic_year, s.academic_year)
        END AS academic_year_range,
        CONCAT(IFNULL(s.first_name, ''), ' ', IFNULL(s.last_name, '')) AS full_name,
        COALESCE(g.gender, IF(s.gender = 1 OR s.gender = '1', 'Male', IF(s.gender = 2 OR s.gender = '2', 'Female', IF(s.gender = 3 OR s.gender = '3', 'Others', s.gender))), 'Male') AS gender_name,
        COALESCE(bg.blood_group, s.blood_group) AS blood_group_name,
        COALESCE(rm.religion, s.religion) AS religion_name,
        COALESCE(scm.category, s.category) AS category_name,
        COALESCE(hm.house_name, s.house) AS house_name,
        COALESCE(mtm.mother_tongue, s.mother_tongue) AS mother_tongue_name,
        cm.class_name,
        sec.section_name,
        f.id AS father_id,
        f.first_name AS father_first_name,
        f.last_name AS father_last_name,
        CONCAT(IFNULL(f.first_name, ''), ' ', IFNULL(f.last_name, '')) AS father_name,
        f.phone AS father_phone,
        f.email AS father_email,
        f.occupation AS father_occupation,
        f.picture AS father_picture,
        fa.country AS father_country,
        fa.state AS father_state,
        fa.city AS father_city,
        fa.postal_code AS father_postal_code,
        fa.address1 AS father_address_1,
        fa.address2 AS father_address_2,
        COALESCE(
          NULLIF(CONCAT_WS(', ',
            NULLIF(TRIM(fa.address1), ''),
            NULLIF(TRIM(fa.address2), ''),
            NULLIF(TRIM(fcit.name), ''),
            NULLIF(TRIM(fst.state), ''),
            CASE WHEN TRIM(IFNULL(fco.name, '')) != '' OR TRIM(IFNULL(fa.postal_code, '')) != ''
                 THEN CONCAT_WS('-', NULLIF(TRIM(fco.name), ''), NULLIF(TRIM(fa.postal_code), ''))
                 ELSE NULL END
          ), ''),
          ''
        ) AS father_address,
        f.relation AS father_relation,
        m.id AS mother_id,
        m.first_name AS mother_first_name,
        m.last_name AS mother_last_name,
        CONCAT(IFNULL(m.first_name, ''), ' ', IFNULL(m.last_name, '')) AS mother_name,
        m.phone AS mother_phone,
        m.email AS mother_email,
        m.occupation AS mother_occupation,
        m.picture AS mother_picture,
        ma.country AS mother_country,
        ma.state AS mother_state,
        ma.city AS mother_city,
        ma.postal_code AS mother_postal_code,
        ma.address1 AS mother_address_1,
        ma.address2 AS mother_address_2,
        COALESCE(
          NULLIF(CONCAT_WS(', ',
            NULLIF(TRIM(ma.address1), ''),
            NULLIF(TRIM(ma.address2), ''),
            NULLIF(TRIM(mcit.name), ''),
            NULLIF(TRIM(mst.state), ''),
            CASE WHEN TRIM(IFNULL(mco.name, '')) != '' OR TRIM(IFNULL(ma.postal_code, '')) != ''
                 THEN CONCAT_WS('-', NULLIF(TRIM(mco.name), ''), NULLIF(TRIM(ma.postal_code), ''))
                 ELSE NULL END
          ), ''),
          ''
        ) AS mother_address,
        stp.guardian_id,
        CASE 
          WHEN stp.guardian_id IS NOT NULL AND stp.guardian_id = stp.mother_id THEN '2'
          WHEN stp.guardian_id IS NOT NULL AND stp.guardian_id = stp.father_id THEN '1'
          WHEN stp.guardian_id IS NOT NULL AND og.id IS NOT NULL THEN '3'
          ELSE '1'
        END AS guardian_relation,
        og.id AS other_guardian_id,
        og.first_name AS other_guardian_first_name,
        og.last_name AS other_guardian_last_name,
        CONCAT(IFNULL(og.first_name, ''), ' ', IFNULL(og.last_name, '')) AS other_guardian_name,
        og.phone AS other_guardian_phone,
        og.email AS other_guardian_email,
        og.occupation AS other_guardian_occupation,
        og.relation AS other_guardian_relation,
        og.picture AS other_guardian_picture,
        p.id AS parent_id,
        CONCAT(IFNULL(p.first_name, ''), ' ', IFNULL(p.last_name, '')) AS parent_name,
        p.email AS parent_email,
        p.phone AS parent_phone,
        p.relation AS parent_relation,
        st.route AS route,
        st.route AS route_id,
        trm.transport_route,
        bm.name AS bus_name,
        COALESCE(bm.number_plate, tvm.vehicle_number, st.vehicle_number) AS vehicle_number,
        st.pickup_point,
        st.drop_point,
        sh.hostel_name AS hostel_name_id,
        sh.room_number AS room_number_id,
        hnm.hostel_name,
        COALESCE(hrm.room_number, sh.room_number) AS room_number,
        brm.branch_name,
        brm.branch_code
      FROM student_master s
      LEFT JOIN branch_master brm ON s.branch_id = brm.id
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sec ON s.section = sec.id
      LEFT JOIN house_master hm ON (s.house = hm.id OR s.house = hm.house_name)
      LEFT JOIN gender_master g ON (
        (g.id = 1 AND (s.gender = 1 OR s.gender = '1' OR LOWER(CAST(s.gender AS CHAR)) = 'male')) OR
        (g.id = 2 AND (s.gender = 2 OR s.gender = '2' OR LOWER(CAST(s.gender AS CHAR)) = 'female')) OR
        (g.id = 3 AND (s.gender = 3 OR s.gender = '3' OR LOWER(CAST(s.gender AS CHAR)) IN ('other', 'others')))
      )
      LEFT JOIN blood_group_master bg ON (s.blood_group = bg.id OR s.blood_group = bg.blood_group)
      LEFT JOIN religion_master rm ON (s.religion = rm.id OR s.religion = rm.religion)
      LEFT JOIN student_category_master scm ON (s.category = scm.id OR s.category = scm.category)
      LEFT JOIN mother_tongue_master mtm ON (s.mother_tongue = mtm.id OR s.mother_tongue = mtm.mother_tongue)
      LEFT JOIN student_to_parent stp ON s.id = stp.student_id
      LEFT JOIN parent_master f ON stp.father_id = f.id
      LEFT JOIN parent_master_address fa ON (f.id = fa.parent_id AND (fa.parent_type = 1 OR fa.parent_type IS NULL))
      LEFT JOIN cities fcit ON fa.city = fcit.id
      LEFT JOIN states fst ON fa.state = fst.id_state
      LEFT JOIN countries fco ON fa.country = fco.id
      LEFT JOIN parent_master m ON stp.mother_id = m.id
      LEFT JOIN parent_master_address ma ON (m.id = ma.parent_id AND (ma.parent_type = 2 OR ma.parent_type IS NULL))
      LEFT JOIN cities mcit ON ma.city = mcit.id
      LEFT JOIN states mst ON ma.state = mst.id_state
      LEFT JOIN countries mco ON ma.country = mco.id
      LEFT JOIN parent_master og ON (stp.guardian_id = og.id AND (stp.guardian_id != stp.father_id OR stp.father_id IS NULL) AND (stp.guardian_id != stp.mother_id OR stp.mother_id IS NULL))
      LEFT JOIN parent_master p ON (stp.guardian_id = p.id OR stp.father_id = p.id OR stp.mother_id = p.id)
      LEFT JOIN student_transport st ON (s.id = st.student_id AND st.status != 0)
      LEFT JOIN trans_route_master trm ON st.route = trm.id
      LEFT JOIN bus_master bm ON trm.bus_id = bm.id
      LEFT JOIN trans_vehicle_master tvm ON st.vehicle_number = tvm.id
      LEFT JOIN student_hostel sh ON (s.id = sh.student_id AND sh.status != 0)
      LEFT JOIN hostel_name_master hnm ON sh.hostel_name = hnm.id
      LEFT JOIN hostel_room_master hrm ON sh.room_number = hrm.id
      LEFT JOIN academic_year_master aym ON (s.academic_year = aym.id OR s.academic_year = aym.academic_year)
      WHERE s.id = ? AND s.school_id = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [id, schoolId]);
    const student = rows[0];
    if (!student) return null;

    student.father_info = {
      father_first_name: student.father_first_name || '',
      father_last_name: student.father_last_name || '',
      father_phone: student.father_phone || '',
      father_email: student.father_email || '',
      father_occupation: student.father_occupation || '',
      father_picture: student.father_picture || '',
      father_country: student.father_country ? String(student.father_country) : '',
      father_state: student.father_state ? String(student.father_state) : '',
      father_city: student.father_city ? String(student.father_city) : '',
      father_postal_code: student.father_postal_code || '',
      father_address_1: student.father_address_1 || '',
      father_address_2: student.father_address_2 || '',
    };

    student.mother_info = {
      mother_first_name: student.mother_first_name || '',
      mother_last_name: student.mother_last_name || '',
      mother_phone: student.mother_phone || '',
      mother_email: student.mother_email || '',
      mother_occupation: student.mother_occupation || '',
      mother_picture: student.mother_picture || '',
      mother_country: student.mother_country ? String(student.mother_country) : '',
      mother_state: student.mother_state ? String(student.mother_state) : '',
      mother_city: student.mother_city ? String(student.mother_city) : '',
      mother_postal_code: student.mother_postal_code || '',
      mother_address_1: student.mother_address_1 || '',
      mother_address_2: student.mother_address_2 || '',
    };

    student.other_guardian_info = {
      first_name: student.other_guardian_first_name || '',
      last_name: student.other_guardian_last_name || '',
      phone: student.other_guardian_phone || '',
      email: student.other_guardian_email || '',
      occupation: student.other_guardian_occupation || '',
      relation: student.other_guardian_relation || '',
      picture: student.other_guardian_picture || '',
    };

    // Fetch student address records
    const [addrRows] = await pool.execute(
      `SELECT 
        sa.*,
        co.name AS country_name,
        st.state AS state_name,
        cit.name AS city_name
       FROM student_address sa
       LEFT JOIN countries co ON sa.country = co.id
       LEFT JOIN states st ON sa.state = st.id_state
       LEFT JOIN cities cit ON sa.city = cit.id
       WHERE sa.student_id = ? 
       ORDER BY sa.address_type ASC`,
      [id]
    );
    if (addrRows && addrRows.length > 0) {
      const currentAddr = addrRows.find((a) => a.address_type === 1) || addrRows[0];
      const permAddr = addrRows.find((a) => a.address_type === 2) || currentAddr;

      const formatAddr = (a) => {
        if (!a) return '';
        const parts = [
          a.address1,
          a.address2,
          a.city_name,
          a.state_name,
          a.country_name ? `${a.country_name}${a.postal_code ? ' - ' + a.postal_code : ''}` : a.postal_code,
        ].filter((p) => p && String(p).trim() !== '');
        return parts.join(', ');
      };

      student.current_address = {
        current_country: currentAddr.country ? String(currentAddr.country) : '',
        country: currentAddr.country,
        country_name: currentAddr.country_name || '',
        current_state: currentAddr.state ? String(currentAddr.state) : '',
        state: currentAddr.state,
        state_name: currentAddr.state_name || '',
        current_city: currentAddr.city ? String(currentAddr.city) : '',
        city: currentAddr.city,
        city_name: currentAddr.city_name || '',
        current_postal_code: currentAddr.postal_code || '',
        postal_code: currentAddr.postal_code || '',
        current_address_1: currentAddr.address1 || '',
        address1: currentAddr.address1 || '',
        current_address_2: currentAddr.address2 || '',
        address2: currentAddr.address2 || '',
        formatted_address: formatAddr(currentAddr),
      };

      student.permanent_address = {
        permanent_country: permAddr.country ? String(permAddr.country) : '',
        country: permAddr.country,
        country_name: permAddr.country_name || '',
        permanent_state: permAddr.state ? String(permAddr.state) : '',
        state: permAddr.state,
        state_name: permAddr.state_name || '',
        permanent_city: permAddr.city ? String(permAddr.city) : '',
        city: permAddr.city,
        city_name: permAddr.city_name || '',
        permanent_postal_code: permAddr.postal_code || '',
        postal_code: permAddr.postal_code || '',
        permanent_address_1: permAddr.address1 || '',
        address1: permAddr.address1 || '',
        permanent_address_2: permAddr.address2 || '',
        address2: permAddr.address2 || '',
        formatted_address: formatAddr(permAddr),
      };

      student.address = student.current_address.formatted_address || student.current_address.address1 || '';
      student.same_permanent = currentAddr.same_permanent === 1;
    } else {
      student.current_address = null;
      student.permanent_address = null;
      student.address = '';
      student.same_permanent = true;
    }

    // Fetch uploaded documents
    const [docRows] = await pool.execute(`
      SELECT 
        sd.id,
        sd.document_type,
        dtm.document_type_name,
        sd.attachments,
        sd.file_name
      FROM student_document sd
      LEFT JOIN document_type_master dtm ON sd.document_type = dtm.id
      WHERE sd.student_id = ? AND sd.status != 0
    `, [id]);

    student.documents = (docRows || []).map((doc) => {
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


    // Fetch medical history
    const [medRows] = await pool.execute(`
      SELECT 
        smh.id,
        smh.medical_condition,
        IF(smh.medical_condition = 1, 'Good', IF(smh.medical_condition = 2, 'Bad', 'Other')) AS condition_name,
        smh.description,
        DATE_FORMAT(smh.medical_time, '%d-%m-%Y') AS medical_time,
        smh.is_informed
      FROM student_medical_history smh
      WHERE smh.student_id = ? AND smh.status != 0
      ORDER BY smh.medical_time DESC
    `, [id]);

    student.medical_history = medRows || [];

    // Fetch previous school details
    const [prevSchoolRows] = await pool.execute(
      `SELECT * FROM previous_school_address WHERE student_id = ? ORDER BY id DESC LIMIT 1`,
      [id]
    );
    if (prevSchoolRows && prevSchoolRows.length > 0) {
      const ps = prevSchoolRows[0];
      student.previous_school_info = {
        previous_school_name: ps.school_name || '',
        school_name: ps.school_name || '',
        prev_school_country: ps.country || '',
        country: ps.country || '',
        prev_school_state: ps.state || '',
        state: ps.state || '',
        prev_school_city: ps.city || '',
        city: ps.city || '',
        prev_school_postal_code: ps.postal_code || '',
        postal_code: ps.postal_code || '',
        prev_school_address_1: ps.address1 || '',
        address1: ps.address1 || '',
        prev_school_address_2: ps.address2 || '',
        address2: ps.address2 || '',
      };
      student.previous_school = student.previous_school_info;
    } else {
      student.previous_school_info = null;
      student.previous_school = null;
    }

    // Fetch activities
    const [actRows] = await pool.execute(`
      SELECT 
        sa.id,
        sa.school_id,
        sa.student_id,
        sa.date,
        sa.activity_description,
        sa.created_at
      FROM student_activity sa
      WHERE sa.student_id = ? AND (sa.school_id = ? OR ? IS NULL) AND sa.status = 1
      ORDER BY sa.date DESC, sa.id DESC
    `, [id, student.school_id, student.school_id]);

    student.activities = actRows || [];

    try {
      const AcademicModel = require('./academic.model');
      const formatted = AcademicModel.formatYearRange({
        id: student.academic_year_id,
        academic_year: student.academic_year_name || student.academic_year,
        start_date: student.academic_year_start_date,
        end_date: student.academic_year_end_date,
      });
      if (formatted) {
        student.academic_year_name = formatted;
        student.academic_year_range = formatted;
        student.academic_year_display = formatted;
      }
    } catch (e) {}

    return student;
  }

  static async addActivity(studentId, schoolId, activities) {
    if (!Array.isArray(activities) || activities.length === 0) return true;
    for (const act of activities) {
      if (act.date && act.activity_description) {
        await pool.execute(
          `INSERT INTO student_activity (school_id, student_id, date, activity_description, status) VALUES (?, ?, ?, ?, 1)`,
          [schoolId, studentId, act.date, act.activity_description]
        );
      }
    }
    return true;
  }

  static async deleteActivity(activityId, schoolId) {
    const [result] = await pool.execute(
      `UPDATE student_activity SET status = 4 WHERE id = ? AND school_id = ?`,
      [activityId, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async checkDuplicateEmail(schoolId, email, excludeStudentId = null) {
    if (!email || !String(email).trim()) return null;
    const cleanEmail = String(email).trim().toLowerCase();

    let query = `
      SELECT id, first_name, last_name, admission_number 
      FROM student_master 
      WHERE school_id = ? 
        AND LOWER(TRIM(email_address)) = ? 
        AND status != 4
    `;
    const params = [schoolId, cleanEmail];

    if (excludeStudentId) {
      query += ` AND id != ?`;
      params.push(excludeStudentId);
    }

    query += ` LIMIT 1`;

    const [rows] = await pool.execute(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  static async create(data) {
    if (data.email_address && String(data.email_address).trim()) {
      const existing = await StudentModel.checkDuplicateEmail(data.school_id, data.email_address);
      if (existing) {
        const err = new Error('A student with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    // Default student password is MD5 of student's Date of Birth (or explicit password if provided)
    let defaultPlainPassword = '123456';
    if (data.password && String(data.password).trim()) {
      defaultPlainPassword = String(data.password).trim();
    } else if (data.date_of_birth && String(data.date_of_birth).trim()) {
      defaultPlainPassword = String(data.date_of_birth).trim();
    }
    const studentHashedPassword = await hashPassword(defaultPlainPassword);

    // Resolve branch_id if provided or default to main branch for the school
    let branchId = data.branch_id ? Number(data.branch_id) : null;
    if (!branchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND is_main_branch = 1 LIMIT 1`,
          [data.school_id]
        );
        if (mainB && mainB.length > 0) branchId = mainB[0].id;
      } catch (bErr) {}
    }

    const sql = `
      INSERT INTO student_master (
        school_id, branch_id, academic_year, admission_number, admission_date, roll_number,
        first_name, last_name, class, section, gender, date_of_birth,
        password, primary_contact_number, email_address, blood_group, house, religion, category,
        caste, mother_tongue, language_known, status, picture
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `;
    const savedStudentPic = data.picture ? saveBase64File(data.picture, 'student/student_pic', 'Profile') : null;

    const [result] = await pool.execute(sql, [
      data.school_id,
      branchId,
      data.academic_year || null,
      data.admission_number || null,
      data.admission_date || new Date().toISOString().slice(0, 10),
      data.roll_number || null,
      data.first_name,
      data.last_name || '',
      data.class_id,
      data.section_id || null,
      data.gender || 'Male',
      data.date_of_birth || null,
      studentHashedPassword,
      data.primary_contact_number || null,
      data.email_address || null,
      data.blood_group || null,
      data.house || null,
      data.religion || null,
      data.category || null,
      data.caste || null,
      data.mother_tongue || null,
      data.language_known || null,
      savedStudentPic,
    ]);

    const studentId = result.insertId;

    if (data.transport_required === '1' && data.transport_info && data.transport_info.route) {
      try {
        await pool.execute(
          `INSERT INTO student_transport (school_id, student_id, route, vehicle_number, pickup_point, drop_point, status)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [
            data.school_id,
            studentId,
            data.transport_info.route || null,
            data.transport_info.vehicle_number || 0,
            data.transport_info.pickup_point || '',
            data.transport_info.drop_point || '',
          ]
        );
      } catch (transportErr) {
        console.error('[StudentModel.create] Error saving student_transport:', transportErr.message);
      }
    }

    if (data.hostel_required === '1' && data.hostel_info && data.hostel_info.hostel_name) {
      try {
        await pool.execute(
          `INSERT INTO student_hostel (school_id, student_id, hostel_name, room_number, academic_year, status)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [
            data.school_id,
            studentId,
            data.hostel_info.hostel_name || null,
            data.hostel_info.hostel_room || null,
            data.academic_year || 1,
          ]
        );
      } catch (hostelErr) {
        console.error('[StudentModel.create] Error saving student_hostel:', hostelErr.message);
      }
    }

    if (data.medical_history && Array.isArray(data.medical_history) && data.medical_history.length > 0) {
      try {
        for (const med of data.medical_history) {
          let medTime = null;
          if (med.medical_time) {
            const str = String(med.medical_time).trim();
            const dmy = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
            const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (dmy) {
              medTime = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')} 00:00:00`;
            } else if (ymd) {
              medTime = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')} 00:00:00`;
            }
          }
          await pool.execute(
            `INSERT INTO student_medical_history (school_id, student_id, medical_condition, description, medical_time, is_informed, status)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [
              data.school_id,
              studentId,
              med.medical_condition || 1,
              med.description || '',
              medTime,
              med.is_informed ? 1 : 0,
            ]
          );
        }
      } catch (medErr) {
        console.error('[StudentModel.create] Error saving student_medical_history:', medErr.message);
      }
    }

    const prevSchool = data.previous_school_info || data.prev_school_info;
    if (prevSchool && (prevSchool.previous_school_name || prevSchool.school_name)) {
      try {
        await pool.execute(
          `INSERT INTO previous_school_address (school_id, student_id, school_name, address1, address2, country, state, city, postal_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            data.school_id,
            studentId,
            prevSchool.previous_school_name || prevSchool.school_name || '',
            prevSchool.prev_school_address_1 || prevSchool.address1 || '',
            prevSchool.prev_school_address_2 || prevSchool.address2 || '',
            prevSchool.prev_school_country || prevSchool.country || null,
            prevSchool.prev_school_state || prevSchool.state || null,
            prevSchool.prev_school_city || prevSchool.city || null,
            prevSchool.prev_school_postal_code || prevSchool.postal_code || '',
          ]
        );
      } catch (psErr) {
        console.error('[StudentModel.create] Error saving previous_school_address:', psErr.message);
      }
    }

    // Save student documents
    if (data.documents && Array.isArray(data.documents) && data.documents.length > 0) {
      try {
        for (const doc of data.documents) {
          if (!doc.document_type && !doc.file_name && !doc.attachments && !doc.file_url) continue;
          const rawDoc = doc.attachments || doc.file_url || doc.file_name || '';
          const savedDocPath = saveBase64File(rawDoc, 'student/attachment', 'Attachment');
          await pool.execute(
            `INSERT INTO student_document (school_id, student_id, document_type, attachments, file_name, status, created_at)
             VALUES (?, ?, ?, ?, ?, 1, NOW())`,
            [
              data.school_id,
              studentId,
              doc.document_type || 1,
              savedDocPath,
              doc.file_name || 'document.pdf',
            ]
          );
        }
      } catch (docErr) {
        console.error('[StudentModel.create] Error saving student_document:', docErr.message);
      }
    }

    // Sync parents and guardians
    await StudentModel.syncParents(studentId, data.school_id, data);

    // Sync student addresses
    await StudentModel.syncAddresses(studentId, data.school_id, data);

    return studentId;
  }

  static async update(id, schoolId, data) {
    if (data.email_address && String(data.email_address).trim()) {
      const existing = await StudentModel.checkDuplicateEmail(schoolId, data.email_address, id);
      if (existing) {
        const err = new Error('A student with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    const savedStudentPic = data.picture !== undefined ? (data.picture ? saveBase64File(data.picture, 'student/student_pic', 'Profile') : null) : undefined;

    const sql = `
      UPDATE student_master SET
        branch_id = COALESCE(?, branch_id),
        academic_year = ?,
        admission_number = ?,
        admission_date = ?,
        roll_number = ?,
        first_name = ?,
        last_name = ?,
        class = ?,
        section = ?,
        gender = ?,
        date_of_birth = ?,
        primary_contact_number = ?,
        email_address = ?,
        blood_group = ?,
        house = ?,
        religion = ?,
        category = ?,
        caste = ?,
        mother_tongue = ?,
        language_known = ?,
        status = ?,
        picture = COALESCE(?, picture)
      WHERE id = ? AND school_id = ?
    `;
    const [result] = await pool.execute(sql, [
      data.branch_id || null,
      data.academic_year || null,
      data.admission_number || null,
      data.admission_date || null,
      data.roll_number || null,
      data.first_name,
      data.last_name || '',
      data.class_id,
      data.section_id || null,
      data.gender || 'Male',
      data.date_of_birth || null,
      data.primary_contact_number || null,
      data.email_address || null,
      data.blood_group || null,
      data.house || null,
      data.religion || null,
      data.category || null,
      data.caste || null,
      data.mother_tongue || null,
      data.language_known || null,
      data.status ?? 1,
      savedStudentPic !== undefined ? savedStudentPic : null,
      id,
      schoolId,
    ]);

    // Handle Transport update
    if (data.transport_required === '1' && data.transport_info && data.transport_info.route) {
      try {
        const [existingTransport] = await pool.execute(
          `SELECT id FROM student_transport WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
        if (existingTransport.length > 0) {
          await pool.execute(
            `UPDATE student_transport SET route = ?, pickup_point = ?, drop_point = ?, status = 1 WHERE id = ?`,
            [data.transport_info.route, data.transport_info.pickup_point || '', data.transport_info.drop_point || '', existingTransport[0].id]
          );
        } else {
          await pool.execute(
            `INSERT INTO student_transport (school_id, student_id, route, vehicle_number, pickup_point, drop_point, status) VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [schoolId, id, data.transport_info.route, 0, data.transport_info.pickup_point || '', data.transport_info.drop_point || '']
          );
        }
      } catch (transportErr) {
        console.error('[StudentModel.update] Error updating student_transport:', transportErr.message);
      }
    } else if (data.transport_required === '0') {
      try {
        await pool.execute(
          `UPDATE student_transport SET status = 4 WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
      } catch (transportErr) {
        // ignore
      }
    }

    // Handle Hostel update
    if (data.hostel_required === '1' && data.hostel_info && data.hostel_info.hostel_name) {
      try {
        const [existingHostel] = await pool.execute(
          `SELECT id FROM student_hostel WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
        if (existingHostel.length > 0) {
          await pool.execute(
            `UPDATE student_hostel SET hostel_name = ?, room_number = ?, status = 1 WHERE id = ?`,
            [data.hostel_info.hostel_name, data.hostel_info.hostel_room || null, existingHostel[0].id]
          );
        } else {
          await pool.execute(
            `INSERT INTO student_hostel (school_id, student_id, hostel_name, room_number, academic_year, status) VALUES (?, ?, ?, ?, ?, 1)`,
            [schoolId, id, data.hostel_info.hostel_name, data.hostel_info.hostel_room || null, data.academic_year || 1]
          );
        }
      } catch (hostelErr) {
        console.error('[StudentModel.update] Error updating student_hostel:', hostelErr.message);
      }
    } else if (data.hostel_required === '0') {
      try {
        await pool.execute(
          `UPDATE student_hostel SET status = 4 WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
      } catch (hostelErr) {
        // ignore
      }
    }
    // Handle Medical History update
    if (data.medical_history && Array.isArray(data.medical_history)) {
      try {
        await pool.execute(`DELETE FROM student_medical_history WHERE student_id = ? AND school_id = ?`, [id, schoolId]);
        for (const med of data.medical_history) {
          let medTime = null;
          if (med.medical_time) {
            const str = String(med.medical_time).trim();
            const dmy = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
            const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (dmy) {
              medTime = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')} 00:00:00`;
            } else if (ymd) {
              medTime = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')} 00:00:00`;
            }
          }
          await pool.execute(
            `INSERT INTO student_medical_history (school_id, student_id, medical_condition, description, medical_time, is_informed, status)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [
              schoolId,
              id,
              med.medical_condition || 1,
              med.description || '',
              medTime,
              med.is_informed ? 1 : 0,
            ]
          );
        }
      } catch (medErr) {
        console.error('[StudentModel.update] Error updating student_medical_history:', medErr.message);
      }
    }

    // Handle Previous School update
    const prevSchool = data.previous_school_info || data.prev_school_info;
    if (prevSchool) {
      try {
        const [existingPs] = await pool.execute(
          `SELECT id FROM previous_school_address WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
        if (existingPs.length > 0) {
          await pool.execute(
            `UPDATE previous_school_address SET
              school_name = ?,
              address1 = ?,
              address2 = ?,
              country = ?,
              state = ?,
              city = ?,
              postal_code = ?
             WHERE id = ?`,
            [
              prevSchool.previous_school_name || prevSchool.school_name || '',
              prevSchool.prev_school_address_1 || prevSchool.address1 || '',
              prevSchool.prev_school_address_2 || prevSchool.address2 || '',
              prevSchool.prev_school_country || prevSchool.country || null,
              prevSchool.prev_school_state || prevSchool.state || null,
              prevSchool.prev_school_city || prevSchool.city || null,
              prevSchool.prev_school_postal_code || prevSchool.postal_code || '',
              existingPs[0].id,
            ]
          );
        } else if (prevSchool.previous_school_name || prevSchool.school_name) {
          await pool.execute(
            `INSERT INTO previous_school_address (school_id, student_id, school_name, address1, address2, country, state, city, postal_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              schoolId,
              id,
              prevSchool.previous_school_name || prevSchool.school_name || '',
              prevSchool.prev_school_address_1 || prevSchool.address1 || '',
              prevSchool.prev_school_address_2 || prevSchool.address2 || '',
              prevSchool.prev_school_country || prevSchool.country || null,
              prevSchool.prev_school_state || prevSchool.state || null,
              prevSchool.prev_school_city || prevSchool.city || null,
              prevSchool.prev_school_postal_code || prevSchool.postal_code || '',
            ]
          );
        }
      } catch (psErr) {
        console.error('[StudentModel.update] Error updating previous_school_address:', psErr.message);
      }
    }

    // Update student documents if provided
    if (data.documents && Array.isArray(data.documents)) {
      try {
        await pool.execute(
          `DELETE FROM student_document WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
        for (const doc of data.documents) {
          if (!doc.document_type && !doc.file_name && !doc.attachments && !doc.file_url) continue;
          const rawDoc = doc.attachments || doc.file_url || doc.file_name || '';
          const savedDocPath = saveBase64File(rawDoc, 'student/attachment', 'Attachment');
          await pool.execute(
            `INSERT INTO student_document (school_id, student_id, document_type, attachments, file_name, status, created_at)
             VALUES (?, ?, ?, ?, ?, 1, NOW())`,
            [
              schoolId,
              id,
              doc.document_type || 1,
              savedDocPath,
              doc.file_name || 'document.pdf',
            ]
          );
        }
      } catch (docErr) {
        console.error('[StudentModel.update] Error updating student_document:', docErr.message);
      }
    }

    // Update parents and guardians
    await StudentModel.syncParents(id, schoolId, data);

    // Update student addresses
    await StudentModel.syncAddresses(id, schoolId, data);

    return true;
  }

  static async syncParents(studentId, schoolId, data) {
    try {
      let fatherId = null;
      let motherId = null;
      let guardianId = null;

      // Check existing student_to_parent record
      const [stpRows] = await pool.execute(
        `SELECT * FROM student_to_parent WHERE student_id = ? AND school_id = ?`,
        [studentId, schoolId]
      );
      const existingStp = stpRows[0] || null;

      // 1. Father
      const fInfo = data.father_info || {};
      const fFirst = fInfo.father_first_name || data.father_first_name || (data.father_name ? data.father_name.split(' ')[0] : '');
      const fLast = fInfo.father_last_name || data.father_last_name || (data.father_name ? data.father_name.split(' ').slice(1).join(' ') : '');
      const fPhone = fInfo.father_phone || data.father_phone || null;
      const fEmail = fInfo.father_email || data.father_email || null;
      const fOcc = fInfo.father_occupation || data.father_occupation || null;
      const fPic = fInfo.father_picture || data.father_picture || null;
      const fatherPic = fPic ? saveBase64File(fPic, 'parent/profile', 'Parent-Profile') : null;

      if (fFirst || fPhone || fEmail) {
        if (existingStp && existingStp.father_id) {
          fatherId = existingStp.father_id;
          let updateSql = `UPDATE parent_master SET first_name = ?, last_name = ?, phone = ?, email = ?, occupation = ?`;
          const params = [fFirst, fLast, fPhone, fEmail, fOcc];
          if (fatherPic) {
            updateSql += `, picture = ?`;
            params.push(fatherPic);
          }
          updateSql += ` WHERE id = ? AND school_id = ?`;
          params.push(fatherId, schoolId);
          await pool.execute(updateSql, params);

          // Update father address
          const [faRows] = await pool.execute(`SELECT id FROM parent_master_address WHERE parent_id = ? AND (parent_type = 1 OR parent_type IS NULL)`, [fatherId]);
          const fCountry = fInfo.father_country || data.father_country || null;
          const fState = fInfo.father_state || data.father_state || null;
          const fCity = fInfo.father_city || data.father_city || null;
          const fPostal = fInfo.father_postal_code || data.father_postal_code || '';
          const fAddr1 = fInfo.father_address_1 || data.father_address_1 || '';
          const fAddr2 = fInfo.father_address_2 || data.father_address_2 || '';

          if (faRows.length > 0) {
            await pool.execute(
              `UPDATE parent_master_address SET country = ?, state = ?, city = ?, postal_code = ?, address1 = ?, address2 = ? WHERE id = ?`,
              [fCountry, fState, fCity, fPostal, fAddr1, fAddr2, faRows[0].id]
            );
          } else {
            await pool.execute(
              `INSERT INTO parent_master_address (school_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, fatherId, fCountry, fState, fCity, fPostal, fAddr1, fAddr2]
            );
          }
        } else {
          // Check if parent already exists in parent_master by phone or email
          let existingParentId = null;
          if (fPhone || fEmail) {
            const [match] = await pool.execute(
              `SELECT id FROM parent_master WHERE school_id = ? AND ((phone = ? AND ? != '') OR (email = ? AND ? != '')) AND status != 4 LIMIT 1`,
              [schoolId, fPhone || '', fPhone || '', fEmail || '', fEmail || '']
            );
            if (match && match.length > 0) {
              existingParentId = match[0].id;
            }
          }

          if (existingParentId) {
            fatherId = existingParentId;
            let updateSql = `UPDATE parent_master SET first_name = ?, last_name = ?, occupation = ?`;
            const params = [fFirst, fLast, fOcc];
            if (fatherPic) {
              updateSql += `, picture = ?`;
              params.push(fatherPic);
            }
            updateSql += ` WHERE id = ? AND school_id = ?`;
            params.push(fatherId, schoolId);
            await pool.execute(updateSql, params);
          } else {
            const fPlainPass = (fPhone && String(fPhone).trim()) ? String(fPhone).trim() : '123456';
            const hashedFatherPass = await hashPassword(fPlainPass);
            const [fRes] = await pool.execute(
              `INSERT INTO parent_master (school_id, first_name, last_name, phone, email, occupation, relation, parent_type, picture, password, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'Father', 1, ?, ?, 1, NOW())`,
              [schoolId, fFirst, fLast, fPhone, fEmail, fOcc, fatherPic, hashedFatherPass]
            );
            fatherId = fRes.insertId;
            const fCountry = fInfo.father_country || data.father_country || null;
            const fState = fInfo.father_state || data.father_state || null;
            const fCity = fInfo.father_city || data.father_city || null;
            const fPostal = fInfo.father_postal_code || data.father_postal_code || '';
            const fAddr1 = fInfo.father_address_1 || data.father_address_1 || '';
            const fAddr2 = fInfo.father_address_2 || data.father_address_2 || '';
            await pool.execute(
              `INSERT INTO parent_master_address (school_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, fatherId, fCountry, fState, fCity, fPostal, fAddr1, fAddr2]
            );
          }
        }
      } else if (existingStp) {
        fatherId = existingStp.father_id;
      }

      // 2. Mother
      const mInfo = data.mother_info || {};
      const mFirst = mInfo.mother_first_name || data.mother_first_name || (data.mother_name ? data.mother_name.split(' ')[0] : '');
      const mLast = mInfo.mother_last_name || data.mother_last_name || (data.mother_name ? data.mother_name.split(' ').slice(1).join(' ') : '');
      const mPhone = mInfo.mother_phone || data.mother_phone || null;
      const mEmail = mInfo.mother_email || data.mother_email || null;
      const mOcc = mInfo.mother_occupation || data.mother_occupation || null;
      const mPic = mInfo.mother_picture || data.mother_picture || null;
      const motherPic = mPic ? saveBase64File(mPic, 'parent/profile', 'Parent-Profile') : null;

      if (mFirst || mPhone || mEmail) {
        if (existingStp && existingStp.mother_id) {
          motherId = existingStp.mother_id;
          let updateSql = `UPDATE parent_master SET first_name = ?, last_name = ?, phone = ?, email = ?, occupation = ?`;
          const params = [mFirst, mLast, mPhone, mEmail, mOcc];
          if (motherPic) {
            updateSql += `, picture = ?`;
            params.push(motherPic);
          }
          updateSql += ` WHERE id = ? AND school_id = ?`;
          params.push(motherId, schoolId);
          await pool.execute(updateSql, params);

          // Update mother address
          const [maRows] = await pool.execute(`SELECT id FROM parent_master_address WHERE parent_id = ? AND (parent_type = 2 OR parent_type IS NULL)`, [motherId]);
          const mCountry = mInfo.mother_country || data.mother_country || null;
          const mState = mInfo.mother_state || data.mother_state || null;
          const mCity = mInfo.mother_city || data.mother_city || null;
          const mPostal = mInfo.mother_postal_code || data.mother_postal_code || '';
          const mAddr1 = mInfo.mother_address_1 || data.mother_address_1 || '';
          const mAddr2 = mInfo.mother_address_2 || data.mother_address_2 || '';

          if (maRows.length > 0) {
            await pool.execute(
              `UPDATE parent_master_address SET country = ?, state = ?, city = ?, postal_code = ?, address1 = ?, address2 = ? WHERE id = ?`,
              [mCountry, mState, mCity, mPostal, mAddr1, mAddr2, maRows[0].id]
            );
          } else {
            await pool.execute(
              `INSERT INTO parent_master_address (school_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, motherId, mCountry, mState, mCity, mPostal, mAddr1, mAddr2]
            );
          }
        } else {
          // Check if parent already exists in parent_master by phone or email
          let existingMotherId = null;
          if (mPhone || mEmail) {
            const [match] = await pool.execute(
              `SELECT id FROM parent_master WHERE school_id = ? AND ((phone = ? AND ? != '') OR (email = ? AND ? != '')) AND status != 4 LIMIT 1`,
              [schoolId, mPhone || '', mPhone || '', mEmail || '', mEmail || '']
            );
            if (match && match.length > 0) {
              existingMotherId = match[0].id;
            }
          }

          if (existingMotherId) {
            motherId = existingMotherId;
            let updateSql = `UPDATE parent_master SET first_name = ?, last_name = ?, occupation = ?`;
            const params = [mFirst, mLast, mOcc];
            if (motherPic) {
              updateSql += `, picture = ?`;
              params.push(motherPic);
            }
            updateSql += ` WHERE id = ? AND school_id = ?`;
            params.push(motherId, schoolId);
            await pool.execute(updateSql, params);
          } else {
            const mPlainPass = (mPhone && String(mPhone).trim()) ? String(mPhone).trim() : '123456';
            const hashedMotherPass = await hashPassword(mPlainPass);
            const [mRes] = await pool.execute(
              `INSERT INTO parent_master (school_id, first_name, last_name, phone, email, occupation, relation, parent_type, picture, password, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'Mother', 2, ?, ?, 1, NOW())`,
              [schoolId, mFirst, mLast, mPhone, mEmail, mOcc, motherPic, hashedMotherPass]
            );
            motherId = mRes.insertId;
            const mCountry = mInfo.mother_country || data.mother_country || null;
            const mState = mInfo.mother_state || data.mother_state || null;
            const mCity = mInfo.mother_city || data.mother_city || null;
            const mPostal = mInfo.mother_postal_code || data.mother_postal_code || '';
            const mAddr1 = mInfo.mother_address_1 || data.mother_address_1 || '';
            const mAddr2 = mInfo.mother_address_2 || data.mother_address_2 || '';
            await pool.execute(
              `INSERT INTO parent_master_address (school_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, motherId, mCountry, mState, mCity, mPostal, mAddr1, mAddr2]
            );
          }
        }
      } else if (existingStp) {
        motherId = existingStp.mother_id;
      }

      // 3. Guardian
      const gRel = String(data.guardian_relation || '1');
      if (gRel === '1') {
        guardianId = fatherId;
      } else if (gRel === '2') {
        guardianId = motherId;
      } else if (gRel === '3') {
        const ogInfo = data.other_guardian_info || {};
        if (existingStp && existingStp.guardian_id && existingStp.guardian_id !== existingStp.father_id && existingStp.guardian_id !== existingStp.mother_id) {
          guardianId = existingStp.guardian_id;
          await pool.execute(
            `UPDATE parent_master SET first_name = ?, last_name = ?, phone = ?, email = ?, occupation = ?, relation = ? WHERE id = ? AND school_id = ?`,
            [ogInfo.first_name || '', ogInfo.last_name || '', ogInfo.phone || null, ogInfo.email || null, ogInfo.occupation || null, ogInfo.relation || 'Guardian', guardianId, schoolId]
          );
        } else if (ogInfo.first_name || ogInfo.phone) {
          let existingGuardianId = null;
          if (ogInfo.phone || ogInfo.email) {
            const [match] = await pool.execute(
              `SELECT id FROM parent_master WHERE school_id = ? AND ((phone = ? AND ? != '') OR (email = ? AND ? != '')) AND status != 4 LIMIT 1`,
              [schoolId, ogInfo.phone || '', ogInfo.phone || '', ogInfo.email || '', ogInfo.email || '']
            );
            if (match && match.length > 0) {
              existingGuardianId = match[0].id;
            }
          }

          if (existingGuardianId) {
            guardianId = existingGuardianId;
          } else {
            const gPlainPass = (ogInfo.phone && String(ogInfo.phone).trim()) ? String(ogInfo.phone).trim() : '123456';
            const hashedGuardianPass = await hashPassword(gPlainPass);
            const [gRes] = await pool.execute(
              `INSERT INTO parent_master (school_id, first_name, last_name, phone, email, occupation, relation, parent_type, password, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 3, ?, 1, NOW())`,
              [schoolId, ogInfo.first_name || '', ogInfo.last_name || '', ogInfo.phone || null, ogInfo.email || null, ogInfo.occupation || null, ogInfo.relation || 'Guardian', hashedGuardianPass]
            );
            guardianId = gRes.insertId;
          }
        }
      }

      if (!guardianId) guardianId = fatherId || motherId || null;

      // 4. Upsert student_to_parent
      if (fatherId || motherId || guardianId) {
        if (existingStp) {
          await pool.execute(
            `UPDATE student_to_parent SET father_id = ?, mother_id = ?, guardian_id = ?, status = 1 WHERE id = ?`,
            [fatherId, motherId, guardianId, existingStp.id]
          );
        } else {
          await pool.execute(
            `INSERT INTO student_to_parent (school_id, student_id, father_id, mother_id, guardian_id, status)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [schoolId, studentId, fatherId, motherId, guardianId]
          );
        }
      }
    } catch (parentErr) {
      console.error('[StudentModel.syncParents] Error syncing parent records:', parentErr.message);
    }
  }

  static async syncAddresses(studentId, schoolId, data) {
    try {
      const cAddr = data.current_address || {};
      const samePerm = (data.same_permanent === true || data.same_permanent === 1 || data.same_permanent === '1') ? 1 : 0;
      const pAddr = samePerm ? cAddr : (data.permanent_address || {});

      const cCountry = cAddr.current_country || cAddr.country || null;
      const cState = cAddr.current_state || cAddr.state || null;
      const cCity = cAddr.current_city || cAddr.city || null;
      const cPostal = cAddr.current_postal_code || cAddr.postal_code || '';
      const cAddr1 = cAddr.current_address_1 || cAddr.address1 || '';
      const cAddr2 = cAddr.current_address_2 || cAddr.address2 || '';

      const pCountry = pAddr.permanent_country || pAddr.country || cCountry;
      const pState = pAddr.permanent_state || pAddr.state || cState;
      const pCity = pAddr.permanent_city || pAddr.city || cCity;
      const pPostal = pAddr.permanent_postal_code || pAddr.postal_code || cPostal;
      const pAddr1 = pAddr.permanent_address_1 || pAddr.address1 || cAddr1;
      const pAddr2 = pAddr.permanent_address_2 || pAddr.address2 || cAddr2;

      // Delete existing student addresses
      await pool.execute(
        `DELETE FROM student_address WHERE student_id = ? AND school_id = ?`,
        [studentId, schoolId]
      );

      // Insert Current Address (address_type = 1)
      if (cCountry || cState || cCity || cAddr1 || cPostal) {
        await pool.execute(
          `INSERT INTO student_address (school_id, student_id, address_type, same_permanent, country, state, city, postal_code, address1, address2, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [schoolId, studentId, samePerm, cCountry, cState, cCity, cPostal, cAddr1, cAddr2]
        );
      }

      // Insert Permanent Address (address_type = 2)
      if (pCountry || pState || pCity || pAddr1 || pPostal) {
        await pool.execute(
          `INSERT INTO student_address (school_id, student_id, address_type, same_permanent, country, state, city, postal_code, address1, address2, created_at)
           VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [schoolId, studentId, samePerm, pCountry, pState, pCity, pPostal, pAddr1, pAddr2]
        );
      }
    } catch (addrErr) {
      console.error('[StudentModel.syncAddresses] Error saving student_address:', addrErr.message);
    }
  }

  static async delete(id, schoolId) {
    const sql = `UPDATE student_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const [result] = await pool.execute(sql, [id, schoolId]);

    // Cascade soft delete to student associations
    try {
      await pool.execute(
        `UPDATE student_to_parent SET status = 4 WHERE student_id = ? AND school_id = ?`,
        [id, schoolId]
      );
      await pool.execute(
        `UPDATE student_transport SET status = 4 WHERE student_id = ? AND school_id = ?`,
        [id, schoolId]
      );
      await pool.execute(
        `UPDATE student_hostel SET status = 4 WHERE student_id = ? AND school_id = ?`,
        [id, schoolId]
      );
      await pool.execute(
        `UPDATE student_fee_allocations SET status = 4 WHERE student_id = ? AND school_id = ?`,
        [id, schoolId]
      );
    } catch (cascadeErr) {
      console.error('[StudentModel.delete] Error cascading soft delete:', cascadeErr.message);
    }

    return result.affectedRows > 0;
  }
}

module.exports = StudentModel;
