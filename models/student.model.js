const { pool } = require('../config/db.config');
const { saveBase64File, hardDeleteFile } = require('../utils/file.util');
const { hashPassword } = require('../utils/password.util');
const SubscriptionModel = require('./subscription.model');

class StudentModel {
  static async getAll(schoolId, { search = '', classId = '', sectionId = '', academicYear = '', academic_year = '', academicYearId = '', status = '', admissionDate = '', branchId = null, limit = 12, offset = 0 } = {}) {
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

    const targetAcademicYear = academicYear || academic_year || academicYearId;
    if (targetAcademicYear && String(targetAcademicYear).trim() && String(targetAcademicYear).toLowerCase() !== 'all') {
      const cleanYear = String(targetAcademicYear).trim();
      if (/^\d+$/.test(cleanYear)) {
        whereClauses.push('s.academic_year = ?');
        params.push(Number(cleanYear));
      } else {
        whereClauses.push('s.academic_year = (SELECT id FROM academic_year_master WHERE academic_year = ? AND school_id = ? LIMIT 1)');
        params.push(cleanYear, schoolId);
      }
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
        g.gender AS gender,
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
      LEFT JOIN gender_master g ON g.id = s.gender
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

  static async getById(id, schoolId, branchId = null) {
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
        g.gender AS gender_name,
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
      LEFT JOIN gender_master g ON g.id = s.gender
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
      WHERE s.id = ? AND s.school_id = ? ${branchId ? 'AND (s.branch_id = ? OR s.branch_id IS NULL)' : ''}
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, branchId ? [id, schoolId, Number(branchId)] : [id, schoolId]);
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

    // Fetch activities across current and previous academic session records of this student
    const [actRows] = await pool.execute(`
      SELECT 
        sa.id,
        sa.school_id,
        sa.student_id,
        sa.date,
        sa.activity_description,
        sa.created_at
      FROM student_activity sa
      WHERE (
        sa.student_id = ?
        OR (
          ? != '' AND sa.student_id IN (
            SELECT sm_hist.id FROM student_master sm_hist
            WHERE sm_hist.school_id = ?
              AND LOWER(TRIM(sm_hist.admission_number)) = LOWER(TRIM(?))
              AND sm_hist.status != 4
          )
        )
      )
      AND (sa.school_id = ? OR ? IS NULL)
      AND sa.status = 1
      ORDER BY sa.date DESC, sa.id DESC
    `, [
      id,
      student.admission_number ? String(student.admission_number).trim() : '',
      student.school_id,
      student.admission_number ? String(student.admission_number).trim() : '',
      student.school_id,
      student.school_id,
    ]);

    student.activities = actRows || [];

    // Fetch active siblings sharing the same father, mother, or guardian
    student.siblings = [];
    if (student.father_id || student.mother_id || student.guardian_id) {
      try {
        const [sibRows] = await pool.execute(
          `SELECT DISTINCT
             s.id,
             s.admission_number,
             s.roll_number,
             s.first_name,
             s.last_name,
             CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) AS full_name,
             s.gender,
             g.gender AS gender_name,
             s.picture,
             s.class AS class_id,
             cm.class_name,
             s.section AS section_id,
             sec.section_name
           FROM student_to_parent stp
           INNER JOIN student_master s ON stp.student_id = s.id
           LEFT JOIN class_master cm ON s.class = cm.id
           LEFT JOIN section_master sec ON s.section = sec.id
           LEFT JOIN gender_master g ON g.id = s.gender
           WHERE stp.school_id = ?
             AND stp.status = 1
             AND s.status = 1
             AND s.id != ?
             AND (s.admission_number IS NULL OR LOWER(TRIM(s.admission_number)) != LOWER(TRIM(?)))
             AND (
               (? IS NOT NULL AND stp.father_id = ?) OR
               (? IS NOT NULL AND stp.mother_id = ?) OR
               (? IS NOT NULL AND stp.guardian_id = ?)
             )
           ORDER BY s.first_name ASC`,
          [
            student.school_id,
            id,
            student.admission_number ? String(student.admission_number).trim() : '',
            student.father_id || null,
            student.father_id || null,
            student.mother_id || null,
            student.mother_id || null,
            student.guardian_id || null,
            student.guardian_id || null,
          ]
        );
        student.siblings = sibRows || [];
      } catch (_) {
        student.siblings = [];
      }
    }

    // Fetch promotion history for this student across academic years
    student.promotion_history = [];
    try {
      const [promoRows] = await pool.execute(
        `SELECT 
           sph.*,
           fay.academic_year AS from_academic_year_name,
           tay.academic_year AS to_academic_year_name,
           fcm.class_name AS from_class_name,
           tcm.class_name AS to_class_name,
           fsec.section_name AS from_section_name,
           tsec.section_name AS to_section_name
         FROM student_promotion_history sph
         LEFT JOIN academic_year_master fay ON sph.from_academic_year = fay.id
         LEFT JOIN academic_year_master tay ON sph.to_academic_year = tay.id
         LEFT JOIN class_master fcm ON sph.from_class_id = fcm.id
         LEFT JOIN class_master tcm ON sph.to_class_id = tcm.id
         LEFT JOIN section_master fsec ON sph.from_section_id = fsec.id
         LEFT JOIN section_master tsec ON sph.to_section_id = tsec.id
         WHERE sph.school_id = ?
           AND (
             sph.student_id = ?
             OR sph.new_student_id = ?
             OR (
               ? != '' AND sph.student_id IN (
                 SELECT sm_p.id FROM student_master sm_p
                 WHERE sm_p.school_id = ? AND LOWER(TRIM(sm_p.admission_number)) = LOWER(TRIM(?))
               )
             )
           )
         ORDER BY sph.id DESC`,
        [
          student.school_id,
          id,
          id,
          student.admission_number ? String(student.admission_number).trim() : '',
          student.school_id,
          student.admission_number ? String(student.admission_number).trim() : '',
        ]
      );
      student.promotion_history = promoRows || [];
    } catch (_) {
      student.promotion_history = [];
    }

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

  static async addActivity(studentId, schoolId, activities, branchId = null) {
    if (!Array.isArray(activities) || activities.length === 0) return true;
    let resolvedBranchId = branchId ? Number(branchId) : null;
    if (!resolvedBranchId) {
      try {
        const [st] = await pool.query('SELECT branch_id FROM student_master WHERE id = ? LIMIT 1', [studentId]);
        if (st && st[0]?.branch_id) resolvedBranchId = st[0].branch_id;
      } catch (e) {}
    }
    for (const act of activities) {
      if (act.date && act.activity_description) {
        await pool.execute(
          `INSERT INTO student_activity (school_id, branch_id, student_id, date, activity_description, status) VALUES (?, ?, ?, ?, ?, 1)`,
          [schoolId, resolvedBranchId, studentId, act.date, act.activity_description]
        );
      }
    }
    return true;
  }

  static async bulkAddActivities(schoolId, entries = [], branchId = null) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { insertedCount: 0, studentIds: [] };
    }

    const validEntries = entries
      .map((e) => ({
        student_id: Number(e.student_id || e.studentId),
        date: String(e.date || '').split('T')[0].trim(),
        activity_description: String(e.activity_description || e.description || '').trim(),
      }))
      .filter((e) => e.student_id > 0 && e.date && e.activity_description);

    if (validEntries.length === 0) {
      return { insertedCount: 0, studentIds: [] };
    }

    const uniqueStudentIds = [...new Set(validEntries.map((e) => e.student_id))];
    const studentBranchMap = new Map();
    try {
      const [stRows] = await pool.query(
        `SELECT id, branch_id FROM student_master WHERE school_id = ? AND status != 4 AND id IN (${uniqueStudentIds.map(() => '?').join(',')})`,
        [schoolId, ...uniqueStudentIds]
      );
      for (const r of stRows || []) {
        studentBranchMap.set(Number(r.id), r.branch_id ? Number(r.branch_id) : null);
      }
    } catch (e) {}

    const defaultBranchId = branchId && branchId !== 'all' ? Number(branchId) : null;
    const values = [];
    const placeholders = [];

    for (const item of validEntries) {
      const resolvedBranch = studentBranchMap.get(item.student_id) || defaultBranchId || null;
      placeholders.push('(?, ?, ?, ?, ?, 1)');
      values.push(schoolId, resolvedBranch, item.student_id, item.date, item.activity_description);
    }

    const [result] = await pool.query(
      `INSERT INTO student_activity (school_id, branch_id, student_id, date, activity_description, status) VALUES ${placeholders.join(', ')}`,
      values
    );

    return {
      insertedCount: result?.affectedRows || validEntries.length,
      studentIds: uniqueStudentIds,
      entries: validEntries,
    };
  }

  static async getActivitiesList(
    schoolId,
    {
      branchId = null,
      classId = '',
      sectionId = '',
      search = '',
      date = '',
      fromDate = '',
      toDate = '',
      studentId = '',
      page = 1,
      limit = 20,
    } = {}
  ) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const whereClauses = ['sa.school_id = ?', 'sa.status = 1', 's.status != 4'];
    const params = [schoolId];

    if (branchId && branchId !== 'all') {
      whereClauses.push('(sa.branch_id = ? OR s.branch_id = ?)');
      params.push(Number(branchId), Number(branchId));
    }

    if (studentId) {
      whereClauses.push(`(
        sa.student_id = ?
        OR sa.student_id IN (
          SELECT sm_act.id FROM student_master sm_act
          WHERE sm_act.school_id = ?
            AND sm_act.status != 4
            AND sm_act.admission_number IS NOT NULL
            AND TRIM(sm_act.admission_number) != ''
            AND LOWER(TRIM(sm_act.admission_number)) = (
              SELECT LOWER(TRIM(sm_curr.admission_number))
              FROM student_master sm_curr
              WHERE sm_curr.id = ? LIMIT 1
            )
        )
      )`);
      params.push(Number(studentId), schoolId, Number(studentId));
    }

    if (classId) {
      whereClauses.push('(s.class = ? OR s.class = (SELECT class_name FROM class_master WHERE id = ? LIMIT 1))');
      params.push(classId, classId);
    }

    if (sectionId) {
      whereClauses.push('(s.section = ? OR s.section = (SELECT section_name FROM section_master WHERE id = ? LIMIT 1))');
      params.push(sectionId, sectionId);
    }

    if (date) {
      whereClauses.push('DATE(sa.date) = ?');
      params.push(String(date).split('T')[0]);
    } else {
      if (fromDate) {
        whereClauses.push('DATE(sa.date) >= ?');
        params.push(String(fromDate).split('T')[0]);
      }
      if (toDate) {
        whereClauses.push('DATE(sa.date) <= ?');
        params.push(String(toDate).split('T')[0]);
      }
    }

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      whereClauses.push(`(
        sa.activity_description LIKE ? OR
        s.first_name LIKE ? OR
        s.last_name LIKE ? OR
        CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) LIKE ? OR
        s.admission_number LIKE ? OR
        s.roll_number LIKE ?
      )`);
      params.push(term, term, term, term, term, term);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const countSql = `
      SELECT COUNT(sa.id) AS total
      FROM student_activity sa
      INNER JOIN student_master s ON sa.student_id = s.id
      ${whereSql}
    `;
    const [countRows] = await pool.query(countSql, params);
    const total = Number(countRows?.[0]?.total || 0);

    const dataSql = `
      SELECT 
        sa.id,
        sa.school_id,
        sa.branch_id,
        sa.student_id,
        DATE_FORMAT(sa.date, '%Y-%m-%d') AS date,
        sa.activity_description,
        sa.status,
        sa.created_at,
        s.admission_number,
        s.roll_number,
        s.first_name,
        s.last_name,
        CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) AS full_name,
        s.picture,
        s.status AS student_status,
        s.class AS class_id,
        cm.class_name,
        s.section AS section_id,
        sec.section_name,
        g.gender AS gender
      FROM student_activity sa
      INNER JOIN student_master s ON sa.student_id = s.id
      LEFT JOIN class_master cm ON s.class = cm.id
      LEFT JOIN section_master sec ON s.section = sec.id
      LEFT JOIN gender_master g ON g.id = s.gender
      ${whereSql}
      ORDER BY sa.date DESC, sa.id DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataSql, [...params, safeLimit, offset]);

    return {
      activities: rows || [],
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  static async updateActivity(activityId, schoolId, { date, activity_description }, branchId = null) {
    let sql = `UPDATE student_activity SET date = ?, activity_description = ? WHERE id = ? AND school_id = ? AND status = 1`;
    const params = [String(date).split('T')[0], String(activity_description).trim(), activityId, schoolId];
    if (branchId && branchId !== 'all') {
      sql += ` AND branch_id = ?`;
      params.push(Number(branchId));
    }
    const [result] = await pool.execute(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteActivity(activityId, schoolId, branchId = null) {
    let sql = `UPDATE student_activity SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [activityId, schoolId];
    if (branchId) {
      sql += ` AND branch_id = ?`;
      params.push(Number(branchId));
    }
    const [result] = await pool.execute(sql, params);
    return result.affectedRows > 0;
  }

  static async resolveBranchId(schoolId, branchId = null) {
    if (branchId && branchId !== 'all' && branchId !== '0' && !isNaN(Number(branchId)) && Number(branchId) > 0) {
      return Number(branchId);
    }
    if (!schoolId) return null;
    try {
      const [rows] = await pool.query(
        'SELECT id FROM branch_master WHERE school_id = ? AND status != 4 ORDER BY is_main_branch DESC, id ASC LIMIT 1',
        [schoolId]
      );
      if (rows && rows.length > 0 && rows[0].id) {
        return Number(rows[0].id);
      }
    } catch (e) {}
    return null;
  }

  static async isMainBranch(schoolId, branchId) {
    if (!schoolId || !branchId) return true;
    try {
      const [rows] = await pool.query(
        'SELECT id, is_main_branch FROM branch_master WHERE school_id = ? AND status != 4 ORDER BY is_main_branch DESC, id ASC LIMIT 1',
        [schoolId]
      );
      if (rows && rows.length > 0) {
        return Number(rows[0].id) === Number(branchId);
      }
    } catch (e) {}
    return false;
  }

  static async checkDuplicateEmail(schoolId, email, excludeStudentId = null, branchId = null) {
    if (!email || !String(email).trim()) return null;
    const cleanEmail = String(email).trim().toLowerCase();
    const targetBranchId = await StudentModel.resolveBranchId(schoolId, branchId);

    let query = `
      SELECT id, first_name, last_name, admission_number, branch_id 
      FROM student_master 
      WHERE school_id = ? 
        AND LOWER(TRIM(email_address)) = ? 
        AND status = 1
    `;
    const params = [schoolId, cleanEmail];

    if (targetBranchId) {
      const isMain = await StudentModel.isMainBranch(schoolId, targetBranchId);
      if (isMain) {
        query += ` AND (branch_id = ? OR branch_id IS NULL)`;
      } else {
        query += ` AND branch_id = ?`;
      }
      params.push(Number(targetBranchId));
    }

    if (excludeStudentId) {
      let cleanExcludeId = excludeStudentId;
      if (typeof cleanExcludeId === 'string' && !/^\d+$/.test(cleanExcludeId)) {
        try {
          const decoded = Buffer.from(cleanExcludeId, 'base64').toString('utf-8');
          if (/^\d+$/.test(decoded)) cleanExcludeId = decoded;
        } catch (e) {}
      }
      query += ` AND id != ? AND (admission_number IS NULL OR LOWER(TRIM(admission_number)) != COALESCE((SELECT LOWER(TRIM(sm_ex.admission_number)) FROM student_master sm_ex WHERE sm_ex.id = ? LIMIT 1), ''))`;
      params.push(cleanExcludeId, cleanExcludeId);
    }

    query += ` LIMIT 1`;

    const [rows] = await pool.execute(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  static async checkDuplicateAdmissionNumber(schoolId, admissionNumber, excludeStudentId = null, branchId = null) {
    if (!admissionNumber || !String(admissionNumber).trim()) return null;
    const cleanNum = String(admissionNumber).trim().toLowerCase();

    let query = `
      SELECT id, first_name, last_name, admission_number, branch_id 
      FROM student_master 
      WHERE school_id = ? 
        AND LOWER(TRIM(admission_number)) = ? 
        AND status = 1
    `;
    const params = [schoolId, cleanNum];

    if (excludeStudentId) {
      let cleanExcludeId = excludeStudentId;
      if (typeof cleanExcludeId === 'string' && !/^\d+$/.test(cleanExcludeId)) {
        try {
          const decoded = Buffer.from(cleanExcludeId, 'base64').toString('utf-8');
          if (/^\d+$/.test(decoded)) cleanExcludeId = decoded;
        } catch (e) {}
      }
      query += ` AND id != ? AND LOWER(TRIM(admission_number)) != COALESCE((SELECT LOWER(TRIM(sm_ex.admission_number)) FROM student_master sm_ex WHERE sm_ex.id = ? LIMIT 1), '')`;
      params.push(cleanExcludeId, cleanExcludeId);
    }

    query += ` LIMIT 1`;

    const [rows] = await pool.execute(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  static async create(data) {
    const branchId = await StudentModel.resolveBranchId(data.school_id, data.branch_id || data.branchId);
    if (data.email_address && String(data.email_address).trim()) {
      const existing = await StudentModel.checkDuplicateEmail(data.school_id, data.email_address, null, branchId);
      if (existing) {
        const err = new Error('A student with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }
    if (data.admission_number && String(data.admission_number).trim()) {
      const existingAdm = await StudentModel.checkDuplicateAdmissionNumber(data.school_id, data.admission_number, null, branchId);
      if (existingAdm) {
        const err = new Error('A student with this admission number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    // Student password from explicit password or date_of_birth or contact number
    let defaultPlainPassword = null;
    if (data.password && String(data.password).trim()) {
      defaultPlainPassword = String(data.password).trim();
    } else if (data.date_of_birth && String(data.date_of_birth).trim()) {
      defaultPlainPassword = String(data.date_of_birth).trim();
    } else if (data.primary_contact_number && String(data.primary_contact_number).trim()) {
      defaultPlainPassword = String(data.primary_contact_number).trim();
    }
    const studentHashedPassword = defaultPlainPassword ? await hashPassword(defaultPlainPassword) : null;

    const sql = `
      INSERT INTO student_master (
        school_id, branch_id, academic_year, admission_number, admission_date, roll_number,
        first_name, last_name, class, section, gender, date_of_birth,
        password, primary_contact_number, email_address, blood_group, house, religion, category,
        caste, mother_tongue, language_known, status, picture
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    // Pre-check student seat quota BEFORE uploading profile photo to Backblaze B2 so full-quota requests never orphan B2 files
    const preQuotaCheck = await SubscriptionModel.checkQuota(data.school_id, 'students');
    if (!preQuotaCheck.allowed) {
      const quotaErr = new Error(preQuotaCheck.message);
      quotaErr.statusCode = 403;
      quotaErr.code = 'STUDENT_QUOTA_EXCEEDED';
      quotaErr.quota = preQuotaCheck;
      throw quotaErr;
    }

    const savedStudentPic = data.picture
      ? await saveBase64File(data.picture, 'student/student_pic', 'Profile', {
          schoolId: data.school_id,
          branchId,
        })
      : null;

    let studentId = null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Enforce student seat-cap atomically with FOR UPDATE lock on active subscription
      const quotaCheck = await SubscriptionModel.checkQuota(data.school_id, 'students', {
        connection: conn,
        forUpdate: true,
      });
      if (!quotaCheck.allowed) {
        const quotaErr = new Error(quotaCheck.message);
        quotaErr.statusCode = 403;
        quotaErr.code = 'STUDENT_QUOTA_EXCEEDED';
        quotaErr.quota = quotaCheck;
        throw quotaErr;
      }

      const [result] = await conn.execute(sql, [
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
        data.gender || null,
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
        Number(data.status) === 2 ? 2 : 1,
        savedStudentPic,
      ]);

      studentId = result.insertId;
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      if (savedStudentPic) {
        await hardDeleteFile(savedStudentPic, { schoolId: data.school_id }).catch(() => {});
      }
      throw txErr;
    } finally {
      conn.release();
    }

    if (data.transport_required === '1' && data.transport_info && data.transport_info.route) {
      try {
        await pool.execute(
          `INSERT INTO student_transport (school_id, branch_id, student_id, route, vehicle_number, pickup_point, drop_point, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            data.school_id,
            branchId,
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
          `INSERT INTO student_hostel (school_id, branch_id, student_id, hostel_name, room_number, academic_year, status)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [
            data.school_id,
            branchId,
            studentId,
            data.hostel_info.hostel_name || null,
            data.hostel_info.hostel_room || null,
            data.academic_year || null,
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
            `INSERT INTO student_medical_history (school_id, branch_id, student_id, medical_condition, description, medical_time, is_informed, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              data.school_id,
              branchId,
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
          `INSERT INTO previous_school_address (school_id, branch_id, student_id, school_name, address1, address2, country, state, city, postal_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            data.school_id,
            branchId,
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
      const newlyUploadedDocPaths = [];
      try {
        for (const doc of data.documents) {
          if (!doc.document_type && !doc.file_name && !doc.attachments && !doc.file_url) continue;
          const rawDoc = doc.attachments || doc.file_url || doc.file_name || '';
          const isBase64Upload = typeof rawDoc === 'string' && rawDoc.startsWith('data:');
          const savedDocPath = await saveBase64File(rawDoc, 'student/attachment', 'Attachment', {
            schoolId: data.school_id,
            branchId,
          });
          if (isBase64Upload && savedDocPath) {
            newlyUploadedDocPaths.push(savedDocPath);
          }
          await pool.execute(
            `INSERT INTO student_document (school_id, branch_id, student_id, document_type, attachments, file_name, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
            [
              data.school_id,
              branchId,
              studentId,
              doc.document_type || 1,
              savedDocPath,
              doc.file_name || null,
            ]
          );
        }
      } catch (docErr) {
        if (docErr.statusCode === 403 || docErr.quota) {
          for (const p of newlyUploadedDocPaths) {
            await hardDeleteFile(p, { schoolId: data.school_id }).catch(() => {});
          }
          throw docErr;
        }
        console.error('[StudentModel.create] Error saving student_document:', docErr.message);
      }
    }

    // Sync parents and guardians
    await StudentModel.syncParents(studentId, data.school_id, data);

    // Sync student addresses
    await StudentModel.syncAddresses(studentId, data.school_id, data, branchId);

    return studentId;
  }

  static async update(id, schoolId, data, branchId = null) {
    let resolvedBranchId = branchId || data.branch_id || data.branchId || null;
    let oldStudentPic = null;
    let oldStudentStatus = null;
    try {
      const [stRow] = await pool.query(
        'SELECT branch_id, picture, status FROM student_master WHERE id = ? AND school_id = ? LIMIT 1',
        [id, schoolId]
      );
      if (stRow && stRow.length > 0) {
        if (!resolvedBranchId && stRow[0].branch_id) {
          resolvedBranchId = stRow[0].branch_id;
        }
        oldStudentPic = stRow[0].picture || null;
        oldStudentStatus = Number(stRow[0].status);
      }
    } catch (e) {}
    resolvedBranchId = await StudentModel.resolveBranchId(schoolId, resolvedBranchId);

    if (data.email_address && String(data.email_address).trim()) {
      const existing = await StudentModel.checkDuplicateEmail(schoolId, data.email_address, id, resolvedBranchId);
      if (existing) {
        const err = new Error('A student with this email address already exists.');
        err.statusCode = 400;
        throw err;
      }
    }
    if (data.admission_number && String(data.admission_number).trim()) {
      const existingAdm = await StudentModel.checkDuplicateAdmissionNumber(schoolId, data.admission_number, id, resolvedBranchId);
      if (existingAdm) {
        const err = new Error('A student with this admission number already exists.');
        err.statusCode = 400;
        throw err;
      }
    }

    const savedStudentPic =
      data.picture !== undefined
        ? data.picture
          ? await saveBase64File(data.picture, 'student/student_pic', 'Profile', {
              schoolId,
              branchId: resolvedBranchId,
            })
          : null
        : undefined;

    let sql = `
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
    const updateParams = [
      data.branch_id || null,
      data.academic_year || null,
      data.admission_number || null,
      data.admission_date || null,
      data.roll_number || null,
      data.first_name,
      data.last_name || '',
      data.class_id,
      data.section_id || null,
      data.gender || null,
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
      Number(data.status) === 2 ? 2 : 1,
      savedStudentPic !== undefined ? savedStudentPic : null,
      id,
      schoolId,
    ];

    if (resolvedBranchId) {
      sql += ' AND (branch_id = ? OR branch_id IS NULL)';
      updateParams.push(Number(resolvedBranchId));
    }

    let result;
    if (oldStudentStatus === 4) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const quotaCheck = await SubscriptionModel.checkQuota(schoolId, 'students', {
          connection: conn,
          forUpdate: true,
        });
        if (!quotaCheck.allowed) {
          const quotaErr = new Error(quotaCheck.message);
          quotaErr.statusCode = 403;
          quotaErr.code = 'STUDENT_QUOTA_EXCEEDED';
          quotaErr.quota = quotaCheck;
          throw quotaErr;
        }
        [result] = await conn.execute(sql, updateParams);
        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        if (savedStudentPic && savedStudentPic !== oldStudentPic) {
          await hardDeleteFile(savedStudentPic, { schoolId }).catch(() => {});
        }
        throw txErr;
      } finally {
        conn.release();
      }
    } else {
      [result] = await pool.execute(sql, updateParams);
    }

    if (result.affectedRows > 0 && savedStudentPic && oldStudentPic && oldStudentPic !== savedStudentPic) {
      await hardDeleteFile(oldStudentPic, { schoolId });
    }

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
          let studentBranchId = data.branch_id || data.branchId || null;
          if (!studentBranchId) {
            try {
              const [stRow] = await pool.query('SELECT branch_id FROM student_master WHERE id = ? LIMIT 1', [id]);
              if (stRow.length && stRow[0].branch_id) studentBranchId = stRow[0].branch_id;
            } catch (e) {}
          }
          await pool.execute(
            `INSERT INTO student_transport (school_id, branch_id, student_id, route, vehicle_number, pickup_point, drop_point, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [schoolId, studentBranchId, id, data.transport_info.route, 0, data.transport_info.pickup_point || '', data.transport_info.drop_point || '']
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

    let studentBranchId = data.branch_id || data.branchId || null;
    if (!studentBranchId) {
      try {
        const [stRow] = await pool.query('SELECT branch_id FROM student_master WHERE id = ? LIMIT 1', [id]);
        if (stRow.length && stRow[0].branch_id) studentBranchId = stRow[0].branch_id;
      } catch (e) {}
    }
    if (studentBranchId) data.branch_id = studentBranchId;

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
            `INSERT INTO student_hostel (school_id, branch_id, student_id, hostel_name, room_number, academic_year, status) VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [schoolId, studentBranchId, id, data.hostel_info.hostel_name, data.hostel_info.hostel_room || null, data.academic_year || null]
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
            `INSERT INTO student_medical_history (school_id, branch_id, student_id, medical_condition, description, medical_time, is_informed, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              schoolId,
              studentBranchId,
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
            `INSERT INTO previous_school_address (school_id, branch_id, student_id, school_name, address1, address2, country, state, city, postal_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              schoolId,
              studentBranchId,
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

    // Update student documents if provided (upload all new B2 files BEFORE deleting existing DB rows)
    if (data.documents && Array.isArray(data.documents)) {
      const newlyUploadedDocPaths = [];
      try {
        const [oldDocRows] = await pool.execute(
          `SELECT attachments FROM student_document WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
        const oldDocPaths = (oldDocRows || []).map((r) => (r.attachments || '').trim()).filter(Boolean);
        const keptDocPaths = new Set();
        const preparedDocs = [];

        for (const doc of data.documents) {
          if (!doc.document_type && !doc.file_name && !doc.attachments && !doc.file_url) continue;
          const rawDoc = doc.attachments || doc.file_url || doc.file_name || '';
          const isBase64Upload = typeof rawDoc === 'string' && rawDoc.startsWith('data:');
          const savedDocPath = await saveBase64File(rawDoc, 'student/attachment', 'Attachment', {
            schoolId,
            branchId: studentBranchId,
          });
          if (isBase64Upload && savedDocPath) {
            newlyUploadedDocPaths.push(savedDocPath);
          }
          if (savedDocPath) keptDocPaths.add(savedDocPath.trim());
          preparedDocs.push({
            document_type: doc.document_type || 1,
            attachments: savedDocPath,
            file_name: doc.file_name || null,
          });
        }

        const docConn = await pool.getConnection();
        try {
          await docConn.beginTransaction();
          await docConn.execute(
            `DELETE FROM student_document WHERE student_id = ? AND school_id = ?`,
            [id, schoolId]
          );
          for (const pDoc of preparedDocs) {
            await docConn.execute(
              `INSERT INTO student_document (school_id, branch_id, student_id, document_type, attachments, file_name, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
              [
                schoolId,
                studentBranchId,
                id,
                pDoc.document_type,
                pDoc.attachments,
                pDoc.file_name,
              ]
            );
          }
          await docConn.commit();
        } catch (dbErr) {
          await docConn.rollback();
          throw dbErr;
        } finally {
          docConn.release();
        }

        for (const oldPath of oldDocPaths) {
          if (!keptDocPaths.has(oldPath)) {
            await hardDeleteFile(oldPath, { schoolId });
          }
        }
      } catch (docErr) {
        for (const p of newlyUploadedDocPaths) {
          await hardDeleteFile(p, { schoolId }).catch(() => {});
        }
        if (docErr.statusCode === 403 || docErr.quota) {
          throw docErr;
        }
        console.error('[StudentModel.update] Error updating student_document:', docErr.message);
      }
    }

    // Update parents and guardians
    await StudentModel.syncParents(id, schoolId, data);

    // Update student addresses
    await StudentModel.syncAddresses(id, schoolId, data, studentBranchId);

    return true;
  }

  static async syncParents(studentId, schoolId, data) {
    try {
      let fatherId = null;
      let motherId = null;
      let guardianId = null;

      let studentBranchId = data.branch_id || data.branchId || null;
      if (!studentBranchId) {
        try {
          const [stRow] = await pool.query('SELECT branch_id FROM student_master WHERE id = ? LIMIT 1', [studentId]);
          if (stRow.length && stRow[0].branch_id) studentBranchId = stRow[0].branch_id;
        } catch (e) {}
      }

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
      const fatherPic = fPic
        ? await saveBase64File(fPic, 'parent/profile', 'Parent-Profile', {
            schoolId,
            branchId: studentBranchId,
          })
        : null;

      if (fFirst || fPhone || fEmail) {
        if (existingStp && existingStp.father_id) {
          fatherId = existingStp.father_id;
          let oldFatherPic = null;
          if (fatherPic) {
            const [fpRows] = await pool.query('SELECT picture FROM parent_master WHERE id = ? AND school_id = ? LIMIT 1', [fatherId, schoolId]);
            oldFatherPic = fpRows?.[0]?.picture || null;
          }
          let updateSql = `UPDATE parent_master SET first_name = ?, last_name = ?, phone = ?, email = ?, occupation = ?`;
          const params = [fFirst, fLast, fPhone, fEmail, fOcc];
          if (fatherPic) {
            updateSql += `, picture = ?`;
            params.push(fatherPic);
          }
          updateSql += ` WHERE id = ? AND school_id = ?`;
          params.push(fatherId, schoolId);
          await pool.execute(updateSql, params);
          if (fatherPic && oldFatherPic && oldFatherPic !== fatherPic) {
            await hardDeleteFile(oldFatherPic, { schoolId });
          }

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
              `INSERT INTO parent_master_address (school_id, branch_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, studentBranchId, fatherId, fCountry, fState, fCity, fPostal, fAddr1, fAddr2]
            );
          }
        } else {
          // Check if parent ID was passed or parent already exists in parent_master by phone or email
          let existingParentId = fInfo.father_id || data.father_id || null;
          if (!existingParentId && (fPhone || fEmail)) {
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
            const fPlainPass = (fPhone && String(fPhone).trim()) ? String(fPhone).trim() : null;
            const hashedFatherPass = fPlainPass ? await hashPassword(fPlainPass) : null;
            const [fRes] = await pool.execute(
              `INSERT INTO parent_master (school_id, branch_id, first_name, last_name, phone, email, occupation, relation, parent_type, picture, password, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'Father', 1, ?, ?, 1, NOW())`,
              [schoolId, studentBranchId, fFirst, fLast, fPhone, fEmail, fOcc, fatherPic, hashedFatherPass]
            );
            fatherId = fRes.insertId;
            const fCountry = fInfo.father_country || data.father_country || null;
            const fState = fInfo.father_state || data.father_state || null;
            const fCity = fInfo.father_city || data.father_city || null;
            const fPostal = fInfo.father_postal_code || data.father_postal_code || '';
            const fAddr1 = fInfo.father_address_1 || data.father_address_1 || '';
            const fAddr2 = fInfo.father_address_2 || data.father_address_2 || '';
            await pool.execute(
              `INSERT INTO parent_master_address (school_id, branch_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, studentBranchId, fatherId, fCountry, fState, fCity, fPostal, fAddr1, fAddr2]
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
      const motherPic = mPic
        ? await saveBase64File(mPic, 'parent/profile', 'Parent-Profile', {
            schoolId,
            branchId: studentBranchId,
          })
        : null;

      if (mFirst || mPhone || mEmail) {
        if (existingStp && existingStp.mother_id) {
          motherId = existingStp.mother_id;
          let oldMotherPic = null;
          if (motherPic) {
            const [mpRows] = await pool.query('SELECT picture FROM parent_master WHERE id = ? AND school_id = ? LIMIT 1', [motherId, schoolId]);
            oldMotherPic = mpRows?.[0]?.picture || null;
          }
          let updateSql = `UPDATE parent_master SET first_name = ?, last_name = ?, phone = ?, email = ?, occupation = ?`;
          const params = [mFirst, mLast, mPhone, mEmail, mOcc];
          if (motherPic) {
            updateSql += `, picture = ?`;
            params.push(motherPic);
          }
          updateSql += ` WHERE id = ? AND school_id = ?`;
          params.push(motherId, schoolId);
          await pool.execute(updateSql, params);
          if (motherPic && oldMotherPic && oldMotherPic !== motherPic) {
            await hardDeleteFile(oldMotherPic, { schoolId });
          }

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
              `INSERT INTO parent_master_address (school_id, branch_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, studentBranchId, motherId, mCountry, mState, mCity, mPostal, mAddr1, mAddr2]
            );
          }
        } else {
          // Check if mother ID was passed or parent already exists in parent_master by phone or email
          let existingMotherId = mInfo.mother_id || data.mother_id || null;
          if (!existingMotherId && (mPhone || mEmail)) {
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
            const mPlainPass = (mPhone && String(mPhone).trim()) ? String(mPhone).trim() : null;
            const hashedMotherPass = mPlainPass ? await hashPassword(mPlainPass) : null;
            const [mRes] = await pool.execute(
              `INSERT INTO parent_master (school_id, branch_id, first_name, last_name, phone, email, occupation, relation, parent_type, picture, password, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'Mother', 2, ?, ?, 1, NOW())`,
              [schoolId, studentBranchId, mFirst, mLast, mPhone, mEmail, mOcc, motherPic, hashedMotherPass]
            );
            motherId = mRes.insertId;
            const mCountry = mInfo.mother_country || data.mother_country || null;
            const mState = mInfo.mother_state || data.mother_state || null;
            const mCity = mInfo.mother_city || data.mother_city || null;
            const mPostal = mInfo.mother_postal_code || data.mother_postal_code || '';
            const mAddr1 = mInfo.mother_address_1 || data.mother_address_1 || '';
            const mAddr2 = mInfo.mother_address_2 || data.mother_address_2 || '';
            await pool.execute(
              `INSERT INTO parent_master_address (school_id, branch_id, parent_id, parent_type, country, state, city, postal_code, address1, address2, created_at)
               VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?, ?, NOW())`,
              [schoolId, studentBranchId, motherId, mCountry, mState, mCity, mPostal, mAddr1, mAddr2]
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
            const gPlainPass = (ogInfo.phone && String(ogInfo.phone).trim()) ? String(ogInfo.phone).trim() : null;
            const hashedGuardianPass = gPlainPass ? await hashPassword(gPlainPass) : null;
            const [gRes] = await pool.execute(
              `INSERT INTO parent_master (school_id, branch_id, first_name, last_name, phone, email, occupation, relation, parent_type, password, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 3, ?, 1, NOW())`,
              [schoolId, studentBranchId, ogInfo.first_name || '', ogInfo.last_name || '', ogInfo.phone || null, ogInfo.email || null, ogInfo.occupation || null, ogInfo.relation || 'Guardian', hashedGuardianPass]
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
            `UPDATE student_to_parent SET father_id = ?, mother_id = ?, guardian_id = ?, branch_id = COALESCE(branch_id, ?), status = 1 WHERE id = ?`,
            [fatherId, motherId, guardianId, studentBranchId ? Number(studentBranchId) : null, existingStp.id]
          );
        } else {
          await pool.execute(
            `INSERT INTO student_to_parent (school_id, branch_id, student_id, father_id, mother_id, guardian_id, status)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [schoolId, studentBranchId ? Number(studentBranchId) : null, studentId, fatherId, motherId, guardianId]
          );
        }
      }
    } catch (parentErr) {
      console.error('[StudentModel.syncParents] Error syncing parent records:', parentErr.message);
    }
  }

  static async syncAddresses(studentId, schoolId, data, branchId = null) {
    try {
      let studentBranchId = branchId || data.branch_id || data.branchId || null;
      if (!studentBranchId) {
        try {
          const [stRow] = await pool.query('SELECT branch_id FROM student_master WHERE id = ? LIMIT 1', [studentId]);
          if (stRow.length && stRow[0].branch_id) studentBranchId = stRow[0].branch_id;
        } catch (e) {}
      }

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
          `INSERT INTO student_address (school_id, branch_id, student_id, address_type, same_permanent, country, state, city, postal_code, address1, address2, created_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [schoolId, studentBranchId ? Number(studentBranchId) : null, studentId, samePerm, cCountry, cState, cCity, cPostal, cAddr1, cAddr2]
        );
      }

      // Insert Permanent Address (address_type = 2)
      if (pCountry || pState || pCity || pAddr1 || pPostal) {
        await pool.execute(
          `INSERT INTO student_address (school_id, branch_id, student_id, address_type, same_permanent, country, state, city, postal_code, address1, address2, created_at)
           VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [schoolId, studentBranchId ? Number(studentBranchId) : null, studentId, samePerm, pCountry, pState, pCity, pPostal, pAddr1, pAddr2]
        );
      }
    } catch (addrErr) {
      console.error('[StudentModel.syncAddresses] Error saving student_address:', addrErr.message);
    }
  }

  static async delete(id, schoolId, branchId = null) {
    let linkedParentIds = [];
    let oldStudentPic = null;
    let oldDocPaths = [];

    try {
      let stSql = `SELECT picture FROM student_master WHERE id = ? AND school_id = ? AND status != 4`;
      const stParams = [id, schoolId];
      if (branchId) {
        stSql += ` AND branch_id = ?`;
        stParams.push(Number(branchId));
      }
      const [stRows] = await pool.execute(stSql + ' LIMIT 1', stParams);
      oldStudentPic = stRows?.[0]?.picture || null;

      const [docRows] = await pool.execute(
        `SELECT attachments FROM student_document WHERE student_id = ? AND school_id = ? AND status != 4`,
        [id, schoolId]
      );
      oldDocPaths = (docRows || []).map((r) => (r.attachments || '').trim()).filter(Boolean);
    } catch (_) {}

    try {
      const [stpRows] = await pool.execute(
        `SELECT father_id, mother_id, guardian_id FROM student_to_parent WHERE student_id = ? AND school_id = ? AND status != 4`,
        [id, schoolId]
      );
      const idSet = new Set();
      (stpRows || []).forEach((row) => {
        if (row.father_id) idSet.add(Number(row.father_id));
        if (row.mother_id) idSet.add(Number(row.mother_id));
        if (row.guardian_id) idSet.add(Number(row.guardian_id));
      });
      linkedParentIds = Array.from(idSet);
    } catch (stpErr) {
      console.error('[StudentModel.delete] Error fetching linked parent IDs:', stpErr.message);
    }

    let sql = `UPDATE student_master SET status = 4, picture = NULL WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND branch_id = ?`;
      params.push(Number(branchId));
    }
    const [result] = await pool.execute(sql, params);

    if (result.affectedRows > 0) {
      try {
        await pool.execute(
          `UPDATE student_document SET status = 4, attachments = '' WHERE student_id = ? AND school_id = ?`,
          [id, schoolId]
        );
      } catch (_) {}

      if (oldStudentPic) {
        const [picRefs] = await pool.execute(
          `SELECT COUNT(*) AS cnt FROM student_master WHERE school_id = ? AND id != ? AND status != 4 AND picture = ?`,
          [schoolId, id, oldStudentPic]
        ).catch(() => [[{ cnt: 0 }]]);
        if (Number(picRefs?.[0]?.cnt || 0) === 0) {
          await hardDeleteFile(oldStudentPic, { schoolId: Number(schoolId) }).catch(() => {});
        }
      }
      for (const docPath of oldDocPaths) {
        const [docRefs] = await pool.execute(
          `SELECT COUNT(*) AS cnt FROM student_document WHERE school_id = ? AND student_id != ? AND status != 4 AND attachments = ?`,
          [schoolId, id, docPath]
        ).catch(() => [[{ cnt: 0 }]]);
        if (Number(docRefs?.[0]?.cnt || 0) === 0) {
          await hardDeleteFile(docPath, { schoolId: Number(schoolId) }).catch(() => {});
        }
      }
    }

    // Cascade soft delete to student associations
    try {
      const cascadeBranchClause = branchId ? ' AND (branch_id = ? OR branch_id IS NULL)' : '';
      const cascadeParams = branchId ? [id, schoolId, Number(branchId)] : [id, schoolId];
      await pool.execute(
        `UPDATE student_to_parent SET status = 4 WHERE student_id = ? AND school_id = ?${cascadeBranchClause}`,
        cascadeParams
      );
      await pool.execute(
        `UPDATE student_transport SET status = 4 WHERE student_id = ? AND school_id = ?${cascadeBranchClause}`,
        cascadeParams
      );
      await pool.execute(
        `UPDATE student_hostel SET status = 4 WHERE student_id = ? AND school_id = ?${cascadeBranchClause}`,
        cascadeParams
      );
      await pool.execute(
        `UPDATE student_fee_allocations SET status = 4 WHERE student_id = ? AND school_id = ?${cascadeBranchClause}`,
        cascadeParams
      );

      // Soft delete parent only if they have no other non-deleted children
      for (const parentId of linkedParentIds) {
        const [remainingRows] = await pool.execute(
          `SELECT COUNT(DISTINCT s.id) AS remaining_children
           FROM student_to_parent stp
           JOIN student_master s ON stp.student_id = s.id
           WHERE (stp.father_id = ? OR stp.mother_id = ? OR stp.guardian_id = ?)
             AND stp.status != 4
             AND s.status != 4`,
          [parentId, parentId, parentId]
        );
        if (Number(remainingRows[0]?.remaining_children || 0) === 0) {
          const [pPicRows] = await pool.execute(
            `SELECT picture FROM parent_master WHERE id = ? AND school_id = ? LIMIT 1`,
            [parentId, schoolId]
          );
          const oldParentPic = pPicRows?.[0]?.picture || null;
          await pool.execute(
            `UPDATE parent_master SET status = 4, picture = NULL WHERE id = ? AND school_id = ?`,
            [parentId, schoolId]
          );
          if (oldParentPic) {
            await hardDeleteFile(oldParentPic, { schoolId: Number(schoolId) }).catch(() => {});
          }
        }
      }
    } catch (cascadeErr) {
      console.error('[StudentModel.delete] Error cascading soft delete:', cascadeErr.message);
    }

    return result.affectedRows > 0;
  }

  static async promoteStudents(
    schoolId,
    { toAcademicYear, toClassId = null, toSectionId = null, students = [], promotedBy = null, branchId = null }
  ) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(`
        CREATE TABLE IF NOT EXISTS student_promotion_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          school_id INT NOT NULL,
          branch_id INT DEFAULT NULL,
          student_id INT NOT NULL,
          new_student_id INT DEFAULT NULL,
          from_academic_year INT DEFAULT NULL,
          from_class_id INT DEFAULT NULL,
          from_section_id INT DEFAULT NULL,
          from_roll_number VARCHAR(100) DEFAULT NULL,
          to_academic_year INT NOT NULL,
          to_class_id INT DEFAULT NULL,
          to_section_id INT DEFAULT NULL,
          to_roll_number VARCHAR(100) DEFAULT NULL,
          promotion_status VARCHAR(50) NOT NULL DEFAULT 'promoted',
          promoted_by INT DEFAULT NULL,
          promoted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const [sphCols] = await connection.query(`SHOW COLUMNS FROM student_promotion_history LIKE 'new_student_id'`);
      if (!sphCols || sphCols.length === 0) {
        await connection.query(`ALTER TABLE student_promotion_history ADD COLUMN new_student_id INT DEFAULT NULL AFTER student_id`);
      }
      try {
        await connection.query(`ALTER TABLE student_promotion_history MODIFY COLUMN to_class_id INT DEFAULT NULL`);
      } catch (_) {}

      let promotedCount = 0;

      for (const item of students) {
        const studentId = Number(item.student_id);
        if (!studentId) continue;

        let fetchSql = `SELECT * FROM student_master WHERE id = ? AND school_id = ? AND status = 1`;
        const fetchParams = [studentId, schoolId];
        if (branchId && branchId !== 'all') {
          fetchSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
          fetchParams.push(Number(branchId));
        }
        fetchSql += ` LIMIT 1 FOR UPDATE`;

        const [rows] = await connection.query(fetchSql, fetchParams);
        if (!rows || rows.length === 0) continue;

        const current = rows[0];
        const nextAcademicYear = Number(toAcademicYear);

        // Prevent promoting to the same academic year
        if (Number(current.academic_year) === nextAcademicYear) continue;

        const statusAction = String(item.promotion_status || 'promoted').toLowerCase();
        const newRollNumber =
          item.roll_number !== undefined && item.roll_number !== null && String(item.roll_number).trim() !== ''
            ? String(item.roll_number).trim()
            : current.roll_number;

        const itemSectionId = item.to_section_id ?? item.toSectionId ?? toSectionId;
        let nextClassId = toClassId ? Number(toClassId) : null;
        let nextSectionId = itemSectionId ? Number(itemSectionId) : null;

        if (statusAction === 'detained') {
          nextClassId = Number(current.class);
          nextSectionId = itemSectionId ? Number(itemSectionId) : (current.section ? Number(current.section) : null);
        } else if (statusAction === 'graduated') {
          nextClassId = null;
          nextSectionId = null;
        }

        // 1. Mark the previous academic year student record as Inactive (status = 2)
        await connection.query(
          `UPDATE student_master
           SET status = 2
           WHERE id = ? AND school_id = ?`,
          [studentId, schoolId]
        );

        let newStudentId = null;

        if (statusAction === 'graduated') {
          // Deactivate transport, hostel, and old fee allocations for graduated students
          await connection.query(
            `UPDATE student_transport SET status = 2 WHERE student_id = ? AND school_id = ? AND status = 1`,
            [studentId, schoolId]
          );
          await connection.query(
            `UPDATE student_hostel SET status = 2 WHERE student_id = ? AND school_id = ? AND status = 1`,
            [studentId, schoolId]
          );
          await connection.query(
            `UPDATE student_fee_allocations SET status = 2 WHERE student_id = ? AND school_id = ? AND status = 1`,
            [studentId, schoolId]
          ).catch(() => {});
        } else {
          // Check if a record for this student in the target academic year already exists
          let existingTargetRows = [];
          if (current.admission_number) {
            [existingTargetRows] = await connection.query(
              `SELECT id, status FROM student_master
               WHERE school_id = ? AND LOWER(TRIM(admission_number)) = LOWER(TRIM(?))
                 AND academic_year = ? AND status != 4
               LIMIT 1`,
              [schoolId, current.admission_number, nextAcademicYear]
            );
          }

          if (existingTargetRows && existingTargetRows.length > 0) {
            newStudentId = Number(existingTargetRows[0].id);
            await connection.query(
              `UPDATE student_master
               SET class = ?, section = ?, roll_number = ?, status = 1
               WHERE id = ? AND school_id = ?`,
              [nextClassId, nextSectionId, newRollNumber, newStudentId, schoolId]
            );
          } else {
            // 2. Create the student's record for the new academic year with status = 1 (Active)
            const [insertRes] = await connection.query(
              `INSERT INTO student_master (
                 school_id, branch_id, academic_year, admission_number, admission_date, roll_number,
                 first_name, last_name, class, section, gender, date_of_birth, password,
                 blood_group, house, religion, category, primary_contact_number, email_address,
                 caste, mother_tongue, language_known, status, picture,
                 has_siblings, has_transport, has_hostel, hostel_required, transport_required, passcode
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
              [
                schoolId,
                current.branch_id || null,
                nextAcademicYear,
                current.admission_number,
                current.admission_date,
                newRollNumber,
                current.first_name,
                current.last_name,
                nextClassId,
                nextSectionId,
                current.gender,
                current.date_of_birth,
                current.password,
                current.blood_group,
                current.house,
                current.religion,
                current.category,
                current.primary_contact_number,
                current.email_address,
                current.caste,
                current.mother_tongue,
                current.language_known,
                current.picture,
                current.has_siblings || 0,
                current.has_transport || 0,
                current.has_hostel || 0,
                current.hostel_required || 0,
                current.transport_required || 0,
                current.passcode || null,
              ]
            );
            newStudentId = insertRes.insertId;
          }

          // Sync child tables if not already present for newStudentId
          const [existingParentLink] = await connection.query(
            `SELECT id FROM student_to_parent WHERE student_id = ? AND school_id = ? AND status != 4 LIMIT 1`,
            [newStudentId, schoolId]
          );
          if (!existingParentLink || existingParentLink.length === 0) {
            await connection.query(
              `INSERT INTO student_to_parent (school_id, branch_id, student_id, father_id, mother_id, guardian_id, status)
               SELECT school_id, branch_id, ?, father_id, mother_id, guardian_id, 1
               FROM student_to_parent
               WHERE student_id = ? AND school_id = ? AND status != 4`,
              [newStudentId, studentId, schoolId]
            );
          }

          const [existingAddr] = await connection.query(
            `SELECT id FROM student_address WHERE student_id = ? AND school_id = ? LIMIT 1`,
            [newStudentId, schoolId]
          );
          if (!existingAddr || existingAddr.length === 0) {
            await connection.query(
              `INSERT INTO student_address (school_id, branch_id, student_id, address_type, same_permanent, country, state, city, postal_code, address1, address2, created_at)
               SELECT school_id, branch_id, ?, address_type, same_permanent, country, state, city, postal_code, address1, address2, NOW()
               FROM student_address
               WHERE student_id = ? AND school_id = ?`,
              [newStudentId, studentId, schoolId]
            );
          }

          const [existingTrans] = await connection.query(
            `SELECT id FROM student_transport WHERE student_id = ? AND school_id = ? AND status = 1 LIMIT 1`,
            [newStudentId, schoolId]
          );
          if (!existingTrans || existingTrans.length === 0) {
            await connection.query(
              `INSERT INTO student_transport (school_id, branch_id, student_id, route, vehicle_number, pickup_point, drop_point, status)
               SELECT school_id, branch_id, ?, route, vehicle_number, pickup_point, drop_point, 1
               FROM student_transport
               WHERE student_id = ? AND school_id = ? AND status = 1`,
              [newStudentId, studentId, schoolId]
            );
          }

          const [existingHostel] = await connection.query(
            `SELECT id FROM student_hostel WHERE student_id = ? AND school_id = ? AND status = 1 LIMIT 1`,
            [newStudentId, schoolId]
          );
          if (!existingHostel || existingHostel.length === 0) {
            await connection.query(
              `INSERT INTO student_hostel (school_id, branch_id, student_id, hostel_name, room_number, academic_year, status)
               SELECT school_id, branch_id, ?, hostel_name, room_number, ?, 1
               FROM student_hostel
               WHERE student_id = ? AND school_id = ? AND status = 1`,
              [newStudentId, nextAcademicYear, studentId, schoolId]
            );
          }

          const [existingMed] = await connection.query(
            `SELECT id FROM student_medical_history WHERE student_id = ? AND school_id = ? AND status = 1 LIMIT 1`,
            [newStudentId, schoolId]
          );
          if (!existingMed || existingMed.length === 0) {
            await connection.query(
              `INSERT INTO student_medical_history (school_id, branch_id, student_id, medical_condition, description, medical_time, is_informed, status)
               SELECT school_id, branch_id, ?, medical_condition, description, medical_time, is_informed, status
               FROM student_medical_history
               WHERE student_id = ? AND school_id = ? AND status = 1`,
              [newStudentId, studentId, schoolId]
            );
          }

          const [existingPrevSchool] = await connection.query(
            `SELECT id FROM previous_school_address WHERE student_id = ? AND school_id = ? LIMIT 1`,
            [newStudentId, schoolId]
          );
          if (!existingPrevSchool || existingPrevSchool.length === 0) {
            await connection.query(
              `INSERT INTO previous_school_address (school_id, branch_id, student_id, school_name, address1, address2, country, state, city, postal_code)
               SELECT school_id, branch_id, ?, school_name, address1, address2, country, state, city, postal_code
               FROM previous_school_address
               WHERE student_id = ? AND school_id = ?`,
              [newStudentId, studentId, schoolId]
            );
          }

          const [existingDocs] = await connection.query(
            `SELECT id FROM student_document WHERE student_id = ? AND school_id = ? AND status != 4 LIMIT 1`,
            [newStudentId, schoolId]
          );
          if (!existingDocs || existingDocs.length === 0) {
            await connection.query(
              `INSERT INTO student_document (school_id, branch_id, student_id, document_type, file_name, attachments, status)
               SELECT school_id, branch_id, ?, document_type, file_name, attachments, status
               FROM student_document
               WHERE student_id = ? AND school_id = ? AND status != 4`,
              [newStudentId, studentId, schoolId]
            );
          }

          // Deactivate old relational rows on the previous academic year's studentId so they do not duplicate
          await connection.query(
            `UPDATE student_to_parent SET status = 2 WHERE student_id = ? AND school_id = ? AND status = 1`,
            [studentId, schoolId]
          );
          await connection.query(
            `UPDATE student_transport SET status = 2 WHERE student_id = ? AND school_id = ? AND status = 1`,
            [studentId, schoolId]
          );
          await connection.query(
            `UPDATE student_hostel SET status = 2 WHERE student_id = ? AND school_id = ? AND status = 1`,
            [studentId, schoolId]
          );
          await connection.query(
            `UPDATE student_fee_allocations SET status = 2 WHERE student_id = ? AND school_id = ? AND status = 1`,
            [studentId, schoolId]
          ).catch(() => {});

          // Migrate student push tokens and chat messages to newStudentId
          await connection.query(
            `UPDATE user_device_tokens SET user_id = ? WHERE user_id = ? AND role = 'student' AND school_id = ?`,
            [newStudentId, studentId, schoolId]
          ).catch(() => {});
          await connection.query(
            `UPDATE message SET sender_id = ? WHERE sender_id = ? AND sender_role = 'student' AND school_id = ?`,
            [newStudentId, studentId, schoolId]
          ).catch(() => {});
          await connection.query(
            `UPDATE message SET receiver_id = ? WHERE receiver_id = ? AND receiver_role = 'student' AND school_id = ?`,
            [newStudentId, studentId, schoolId]
          ).catch(() => {});

          // Auto-allocate active fee structures for the target class and academic year if any exist
          if (nextClassId && nextAcademicYear) {
            try {
              const [structures] = await connection.query(
                `SELECT id, total_amount, branch_id
                 FROM fee_structures
                 WHERE school_id = ? AND academic_year_id = ? AND class_id = ? AND status = 1`,
                [schoolId, nextAcademicYear, nextClassId]
              );
              for (const fs of structures || []) {
                const [existingAlloc] = await connection.query(
                  `SELECT id FROM student_fee_allocations
                   WHERE school_id = ? AND student_id = ? AND fee_structure_id = ? AND status != 4
                   LIMIT 1`,
                  [schoolId, newStudentId, fs.id]
                );
                if (!existingAlloc || existingAlloc.length === 0) {
                  await connection.query(
                    `INSERT INTO student_fee_allocations (
                       school_id, branch_id, student_id, fee_structure_id, academic_year_id,
                       total_amount, discount_amount, net_payable, status
                     ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1)`,
                    [
                      schoolId,
                      current.branch_id || fs.branch_id || null,
                      newStudentId,
                      fs.id,
                      nextAcademicYear,
                      Number(fs.total_amount || 0),
                      Number(fs.total_amount || 0),
                    ]
                  );
                }
              }
            } catch (_) {}
          }
        }

        await connection.query(
          `INSERT INTO student_promotion_history (
             school_id, branch_id, student_id, new_student_id,
             from_academic_year, from_class_id, from_section_id, from_roll_number,
             to_academic_year, to_class_id, to_section_id, to_roll_number,
             promotion_status, promoted_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            schoolId,
            current.branch_id || null,
            studentId,
            newStudentId,
            current.academic_year ? Number(current.academic_year) : null,
            current.class ? Number(current.class) : null,
            current.section ? Number(current.section) : null,
            current.roll_number || null,
            nextAcademicYear,
            nextClassId,
            nextSectionId,
            statusAction === 'graduated' ? null : newRollNumber,
            statusAction,
            promotedBy ? Number(promotedBy) : null,
          ]
        );

        promotedCount += 1;
      }

      await connection.commit();
      return { promotedCount };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getPromotionHistory(schoolId, { branchId = null, fromAcademicYear = '', toAcademicYear = '', classId = '' } = {}) {
    try {
      let sql = `
        SELECT 
          sph.*,
          s.admission_number,
          s.first_name,
          s.last_name,
          CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) AS full_name,
          s.picture,
          fay.academic_year AS from_academic_year_name,
          tay.academic_year AS to_academic_year_name,
          fcm.class_name AS from_class_name,
          tcm.class_name AS to_class_name,
          fsec.section_name AS from_section_name,
          tsec.section_name AS to_section_name
        FROM student_promotion_history sph
        INNER JOIN student_master s ON sph.student_id = s.id
        LEFT JOIN academic_year_master fay ON sph.from_academic_year = fay.id
        LEFT JOIN academic_year_master tay ON sph.to_academic_year = tay.id
        LEFT JOIN class_master fcm ON sph.from_class_id = fcm.id
        LEFT JOIN class_master tcm ON sph.to_class_id = tcm.id
        LEFT JOIN section_master fsec ON sph.from_section_id = fsec.id
        LEFT JOIN section_master tsec ON sph.to_section_id = tsec.id
        WHERE sph.school_id = ?
      `;
      const params = [schoolId];

      if (branchId && branchId !== 'all') {
        sql += ` AND (sph.branch_id = ? OR s.branch_id = ?)`;
        params.push(Number(branchId), Number(branchId));
      }
      if (fromAcademicYear) {
        sql += ` AND sph.from_academic_year = ?`;
        params.push(Number(fromAcademicYear));
      }
      if (toAcademicYear) {
        sql += ` AND sph.to_academic_year = ?`;
        params.push(Number(toAcademicYear));
      }
      if (classId) {
        sql += ` AND (sph.from_class_id = ? OR sph.to_class_id = ?)`;
        params.push(Number(classId), Number(classId));
      }

      sql += ` ORDER BY sph.id DESC LIMIT 500`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (_) {
      return [];
    }
  }
}

module.exports = StudentModel;
