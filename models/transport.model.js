const { pool } = require('../config/db.config');

const parseStatus = (status) => {
  if (status === undefined || status === null || status === '' || status === 'null' || status === 'undefined' || status === 'all') {
    return null;
  }
  if (typeof status === 'string') {
    const s = status.trim().toLowerCase();
    if (s === 'active' || s === '1') return 1;
    if (s === 'inactive' || s === '2') return 2;
    if (s === 'deleted' || s === '4') return 4;
  }
  const n = Number(status);
  return isNaN(n) ? null : n;
};

class TransportModel {
  // ==========================================
  // 1. ROUTES (trans_route_master)
  // ==========================================

  static async getAllRoutes(schoolId, { search, status } = {}) {
    let sql = `
      SELECT 
        r.id,
        r.school_id,
        r.transport_route,
        r.bus_id,
        r.sort_order,
        r.status,
        r.fare,
        b.name AS vehicle_name,
        b.number_plate,
        b.seat AS vehicle_capacity
      FROM trans_route_master r
      LEFT JOIN bus_master b ON (r.bus_id = b.id AND b.status != 0)
      WHERE r.school_id = ?
    `;
    const params = [schoolId];

    const parsedStatus = parseStatus(status);
    if (parsedStatus !== null) {
      if (parsedStatus === 4) {
        sql += ` AND (r.status = 4 OR r.status = 2)`;
      } else {
        sql += ` AND r.status = ?`;
        params.push(parsedStatus);
      }
    } else {
      sql += ` AND (r.status != 0 AND r.status IS NOT NULL)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (r.transport_route LIKE ? OR b.name LIKE ? OR b.number_plate LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` ORDER BY r.sort_order ASC, r.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getRouteById(schoolId, id) {
    const [rows] = await pool.query(
      `SELECT 
        r.id,
        r.school_id,
        r.transport_route,
        r.bus_id,
        r.bus_id AS bus,
        r.sort_order,
        r.status,
        r.fare,
        b.name AS vehicle_name,
        b.name AS bus_name,
        b.number_plate,
        b.number_plate AS bus_number,
        b.seat AS bus_seat,
        b.color AS bus_color
       FROM trans_route_master r
       LEFT JOIN bus_master b ON r.bus_id = b.id
       WHERE r.id = ? AND r.school_id = ? AND r.status != 0`,
      [id, schoolId]
    );
    if (!rows || rows.length === 0) return null;
    const route = rows[0];

    if (route.bus_id) {
      const [ops] = await pool.query(
        `SELECT 
           bo.operator_id, 
           op.type,
           CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS full_name,
           op.phone,
           op.email,
           op.lisence_number
         FROM bus_to_operator bo
         JOIN operator_master op ON bo.operator_id = op.id
         WHERE bo.bus_id = ? AND bo.school_id = ? AND bo.status != 0 AND op.status != 0`,
        [route.bus_id, schoolId]
      );
      const driver = ops.find((o) => o.type === 1);
      const helpers = ops.filter((o) => o.type === 2);

      route.driver_id = driver ? String(driver.operator_id) : '';
      route.driver = driver ? String(driver.operator_id) : '';
      route.driver_name = driver ? driver.full_name.trim() : '';
      route.driver_phone = driver ? driver.phone : '';
      route.driver_license = driver ? driver.lisence_number : '';

      route.helpers = helpers.map((o) => String(o.operator_id));
      route.helper = helpers.map((o) => String(o.operator_id));
      route.helpers_details = helpers.map((h) => ({
        id: h.operator_id,
        name: h.full_name.trim(),
        phone: h.phone,
        email: h.email,
      }));
    }
    return route;
  }

  static async createRoute(schoolId, { transport_route, bus_id, bus, driver_id, driver, helpers, helper, fare, sort_order, status }) {
    const selectedBusId = bus_id || bus;
    const [res] = await pool.query(
      `INSERT INTO trans_route_master (school_id, transport_route, bus_id, fare, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        transport_route.trim(),
        selectedBusId ? Number(selectedBusId) : null,
        Number(fare || 0),
        Number(sort_order || 1),
        status !== undefined ? Number(status) : 1,
      ]
    );
    const routeId = res.insertId;

    if (selectedBusId) {
      const selectedDriverId = driver_id || driver;
      const helperList = helpers || helper || [];
      const helperArr = Array.isArray(helperList) ? helperList : [helperList].filter(Boolean);

      if (selectedDriverId || helperArr.length > 0) {
        await pool.query(
          `DELETE FROM bus_to_operator WHERE bus_id = ? AND school_id = ?`,
          [Number(selectedBusId), schoolId]
        );
        if (selectedDriverId) {
          await pool.query(
            `INSERT INTO bus_to_operator (school_id, bus_id, operator_id, status) VALUES (?, ?, ?, 1)`,
            [schoolId, Number(selectedBusId), Number(selectedDriverId)]
          );
        }
        for (const hid of helperArr) {
          if (hid) {
            await pool.query(
              `INSERT INTO bus_to_operator (school_id, bus_id, operator_id, status) VALUES (?, ?, ?, 1)`,
              [schoolId, Number(selectedBusId), Number(hid)]
            );
          }
        }
      }
    }
    return routeId;
  }

  static async updateRoute(schoolId, id, { transport_route, bus_id, bus, driver_id, driver, helpers, helper, fare, sort_order, status }) {
    const selectedBusId = bus_id || bus;
    await pool.query(
      `UPDATE trans_route_master 
       SET transport_route = ?, bus_id = ?, fare = ?, sort_order = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        transport_route.trim(),
        selectedBusId ? Number(selectedBusId) : null,
        Number(fare || 0),
        Number(sort_order || 1),
        status !== undefined ? Number(status) : 1,
        id,
        schoolId,
      ]
    );

    if (selectedBusId) {
      const selectedDriverId = driver_id || driver;
      const helperList = helpers || helper || [];
      const helperArr = Array.isArray(helperList) ? helperList : [helperList].filter(Boolean);

      if (selectedDriverId || helperArr.length > 0) {
        await pool.query(
          `DELETE FROM bus_to_operator WHERE bus_id = ? AND school_id = ?`,
          [Number(selectedBusId), schoolId]
        );
        if (selectedDriverId) {
          await pool.query(
            `INSERT INTO bus_to_operator (school_id, bus_id, operator_id, status) VALUES (?, ?, ?, 1)`,
            [schoolId, Number(selectedBusId), Number(selectedDriverId)]
          );
        }
        for (const hid of helperArr) {
          if (hid) {
            await pool.query(
              `INSERT INTO bus_to_operator (school_id, bus_id, operator_id, status) VALUES (?, ?, ?, 1)`,
              [schoolId, Number(selectedBusId), Number(hid)]
            );
          }
        }
      }
    }
    return true;
  }

  static async deleteRoute(schoolId, id) {
    await pool.query(
      `UPDATE trans_route_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  }

  // ==========================================
  // 2. VEHICLES / BUSES (bus_master)
  // ==========================================

  static async getAllVehicles(schoolId, { search, status } = {}) {
    let sql = `
      SELECT 
        b.id,
        b.school_id,
        b.name,
        b.number_plate,
        b.seat,
        b.color,
        b.status,
        MAX(IF(op.type = 1, op.id, NULL)) AS driver_id,
        NULLIF(TRIM(MAX(IF(op.type = 1, CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')), NULL))), '') AS driver_name,
        MAX(IF(op.type = 1, op.phone, NULL)) AS driver_phone
      FROM bus_master b
      LEFT JOIN bus_to_operator bo ON (b.id = bo.bus_id AND bo.school_id = ? AND bo.status != 0)
      LEFT JOIN operator_master op ON (bo.operator_id = op.id AND op.type = 1 AND op.status != 0)
      WHERE b.school_id = ?
    `;
    const params = [schoolId, schoolId];

    const parsedStatus = parseStatus(status);
    if (parsedStatus !== null) {
      if (parsedStatus === 4) {
        sql += ` AND (b.status = 4 OR b.status = 2)`;
      } else {
        sql += ` AND b.status = ?`;
        params.push(parsedStatus);
      }
    } else {
      sql += ` AND (b.status != 0 AND b.status IS NOT NULL)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (b.name LIKE ? OR b.number_plate LIKE ? OR b.color LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` GROUP BY b.id, b.school_id, b.name, b.number_plate, b.seat, b.color, b.status ORDER BY b.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getVehicleById(schoolId, id) {
    const [rows] = await pool.query(
      `SELECT 
        b.id,
        b.school_id,
        b.name,
        b.number_plate,
        b.seat,
        b.color,
        b.status,
        MAX(IF(op.type = 1, op.id, NULL)) AS driver_id,
        NULLIF(TRIM(MAX(IF(op.type = 1, CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')), NULL))), '') AS driver_name,
        MAX(IF(op.type = 1, op.phone, NULL)) AS driver_phone
       FROM bus_master b
       LEFT JOIN bus_to_operator bo ON (b.id = bo.bus_id AND bo.school_id = ? AND bo.status != 0)
       LEFT JOIN operator_master op ON (bo.operator_id = op.id AND op.type = 1 AND op.status != 0)
       WHERE b.id = ? AND b.school_id = ? AND b.status != 0
       GROUP BY b.id, b.school_id, b.name, b.number_plate, b.seat, b.color, b.status`,
      [schoolId, id, schoolId]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async createVehicle(schoolId, { name, number_plate, seat, color, driver_id, status }) {
    const [res] = await pool.query(
      `INSERT INTO bus_master (school_id, name, number_plate, seat, color, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        name.trim(),
        number_plate ? number_plate.trim() : '',
        Number(seat || 0),
        color ? color.trim() : '',
        status !== undefined ? Number(status) : 1,
      ]
    );
    const busId = res.insertId;

    if (driver_id) {
      await pool.query(
        `INSERT INTO bus_to_operator (school_id, bus_id, operator_id, status)
         VALUES (?, ?, ?, 1)`,
        [schoolId, busId, Number(driver_id)]
      );
    }
    return busId;
  }

  static async updateVehicle(schoolId, id, { name, number_plate, seat, color, driver_id, status }) {
    await pool.query(
      `UPDATE bus_master 
       SET name = ?, number_plate = ?, seat = ?, color = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        name.trim(),
        number_plate ? number_plate.trim() : '',
        Number(seat || 0),
        color ? color.trim() : '',
        status !== undefined ? Number(status) : 1,
        id,
        schoolId,
      ]
    );

    // Update driver association
    await pool.query(
      `DELETE FROM bus_to_operator WHERE bus_id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (driver_id) {
      await pool.query(
        `INSERT INTO bus_to_operator (school_id, bus_id, operator_id, status)
         VALUES (?, ?, ?, 1)`,
        [schoolId, id, Number(driver_id)]
      );
    }
    return true;
  }

  static async deleteVehicle(schoolId, id) {
    await pool.query(
      `UPDATE bus_master SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  }

  // ==========================================
  // 3. DRIVERS (operator_master with type = 1)
  // ==========================================

  static async getAllDrivers(schoolId, { search, status } = {}) {
    let sql = `
      SELECT 
        op.id,
        op.school_id,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS driver_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.picture,
        op.status,
        MAX(b.name) AS assigned_bus,
        MAX(b.number_plate) AS assigned_number_plate
      FROM operator_master op
      LEFT JOIN bus_to_operator bo ON (op.id = bo.operator_id AND bo.status != 0)
      LEFT JOIN bus_master b ON (bo.bus_id = b.id AND b.status != 0)
      WHERE op.school_id = ? AND op.type = 1
    `;
    const params = [schoolId];

    const parsedStatus = parseStatus(status);
    if (parsedStatus !== null) {
      if (parsedStatus === 4) {
        sql += ` AND (op.status = 4 OR op.status = 2)`;
      } else {
        sql += ` AND op.status = ?`;
        params.push(parsedStatus);
      }
    } else {
      sql += ` AND (op.status != 0 AND op.status IS NOT NULL)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) LIKE ? OR op.phone LIKE ? OR op.email LIKE ? OR op.lisence_number LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` GROUP BY op.id, op.school_id, op.first_name, op.last_name, op.email, op.phone, op.lisence_number, op.picture, op.status ORDER BY op.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getDriverById(schoolId, id) {
    const [rows] = await pool.query(
      `SELECT 
        op.id,
        op.school_id,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS driver_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.picture,
        op.status
       FROM operator_master op
       WHERE op.id = ? AND op.school_id = ? AND op.type = 1 AND op.status != 0`,
      [id, schoolId]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async checkDriverEmail(schoolId, email, excludeId = null) {
    if (!email || !String(email).trim()) return false;
    let sql = `SELECT id, type FROM operator_master WHERE school_id = ? AND LOWER(TRIM(email)) = LOWER(?) AND status != 0 AND status != 4`;
    const params = [schoolId, String(email).trim()];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return Boolean(rows && rows.length > 0);
  }

  static async checkDriverPhone(schoolId, phone, excludeId = null) {
    if (!phone || !String(phone).trim()) return false;
    const cleanPhone = String(phone).trim().replace(/[\s\-()]/g, '');
    let sql = `SELECT id, type FROM operator_master WHERE school_id = ? AND REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = ? AND status != 0 AND status != 4`;
    const params = [schoolId, cleanPhone];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return Boolean(rows && rows.length > 0);
  }

  static async checkDriverLicense(schoolId, licenseNumber, excludeId = null) {
    if (!licenseNumber || !String(licenseNumber).trim()) return false;
    const cleanLicense = String(licenseNumber).trim();
    let sql = `SELECT id, type FROM operator_master WHERE school_id = ? AND LOWER(TRIM(lisence_number)) = LOWER(?) AND status != 0 AND status != 4`;
    const params = [schoolId, cleanLicense];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return Boolean(rows && rows.length > 0);
  }

  static async checkDriverDuplicate(schoolId, { email, phone, license_number }, excludeId = null) {
    const isEmailDuplicate = email ? await TransportModel.checkDriverEmail(schoolId, email, excludeId) : false;
    const isPhoneDuplicate = phone ? await TransportModel.checkDriverPhone(schoolId, phone, excludeId) : false;
    const isLicenseDuplicate = license_number ? await TransportModel.checkDriverLicense(schoolId, license_number, excludeId) : false;
    return { isEmailDuplicate, isPhoneDuplicate, isLicenseDuplicate };
  }

  static async createDriver(schoolId, { first_name, last_name, email, phone, license_number, lisence_number, picture, status }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    const [res] = await pool.query(
      `INSERT INTO operator_master (school_id, first_name, last_name, email, phone, lisence_number, picture, type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        schoolId,
        first_name.trim(),
        last_name ? last_name.trim() : '',
        cleanEmail,
        cleanPhone,
        cleanLicense,
        picture || '',
        status !== undefined ? Number(status) : 1,
      ]
    );
    return res.insertId;
  }

  static async updateDriver(schoolId, id, { first_name, last_name, email, phone, license_number, lisence_number, picture, status }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    await pool.query(
      `UPDATE operator_master 
       SET first_name = ?, last_name = ?, email = ?, phone = ?, lisence_number = ?, picture = IFNULL(NULLIF(?, ''), picture), status = ?
       WHERE id = ? AND school_id = ? AND type = 1`,
      [
        first_name.trim(),
        last_name ? last_name.trim() : '',
        cleanEmail,
        cleanPhone,
        cleanLicense,
        picture || '',
        status !== undefined ? Number(status) : 1,
        id,
        schoolId,
      ]
    );
    return true;
  }

  static async deleteDriver(schoolId, id) {
    await pool.query(
      `UPDATE operator_master SET status = 4 WHERE id = ? AND school_id = ? AND type = 1`,
      [id, schoolId]
    );
    return true;
  }

  // ==========================================
  // 4. HELPERS (operator_master with type = 2)
  // ==========================================

  static async getAllHelpers(schoolId, { search, status } = {}) {
    let sql = `
      SELECT 
        op.id,
        op.school_id,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS helper_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.picture,
        op.status,
        MAX(b.name) AS assigned_bus,
        MAX(b.number_plate) AS assigned_number_plate
      FROM operator_master op
      LEFT JOIN bus_to_operator bo ON (op.id = bo.operator_id AND bo.status != 0)
      LEFT JOIN bus_master b ON (bo.bus_id = b.id AND b.status != 0)
      WHERE op.school_id = ? AND op.type = 2
    `;
    const params = [schoolId];

    const parsedStatus = parseStatus(status);
    if (parsedStatus !== null) {
      if (parsedStatus === 4) {
        sql += ` AND (op.status = 4 OR op.status = 2)`;
      } else {
        sql += ` AND op.status = ?`;
        params.push(parsedStatus);
      }
    } else {
      sql += ` AND (op.status != 0 AND op.status IS NOT NULL)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) LIKE ? OR op.phone LIKE ? OR op.email LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` GROUP BY op.id, op.school_id, op.first_name, op.last_name, op.email, op.phone, op.lisence_number, op.picture, op.status ORDER BY op.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getHelperById(schoolId, id) {
    const [rows] = await pool.query(
      `SELECT 
        op.id,
        op.school_id,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS helper_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.picture,
        op.status
       FROM operator_master op
       WHERE op.id = ? AND op.school_id = ? AND op.type = 2 AND op.status != 0`,
      [id, schoolId]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async checkHelperEmail(schoolId, email, excludeId = null) {
    if (!email || !String(email).trim()) return false;
    let sql = `SELECT id, type FROM operator_master WHERE school_id = ? AND LOWER(TRIM(email)) = LOWER(?) AND status != 0 AND status != 4`;
    const params = [schoolId, String(email).trim()];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return Boolean(rows && rows.length > 0);
  }

  static async checkHelperPhone(schoolId, phone, excludeId = null) {
    if (!phone || !String(phone).trim()) return false;
    const cleanPhone = String(phone).trim().replace(/[\s\-()]/g, '');
    let sql = `SELECT id, type FROM operator_master WHERE school_id = ? AND REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = ? AND status != 0 AND status != 4`;
    const params = [schoolId, cleanPhone];
    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    return Boolean(rows && rows.length > 0);
  }

  static async checkHelperDuplicate(schoolId, { email, phone }, excludeId = null) {
    const isEmailDuplicate = email ? await TransportModel.checkHelperEmail(schoolId, email, excludeId) : false;
    const isPhoneDuplicate = phone ? await TransportModel.checkHelperPhone(schoolId, phone, excludeId) : false;
    return { isEmailDuplicate, isPhoneDuplicate };
  }

  static async createHelper(schoolId, { first_name, last_name, email, phone, license_number, lisence_number, picture, status }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    const [res] = await pool.query(
      `INSERT INTO operator_master (school_id, first_name, last_name, email, phone, lisence_number, picture, type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?)`,
      [
        schoolId,
        first_name.trim(),
        last_name ? last_name.trim() : '',
        cleanEmail,
        cleanPhone,
        cleanLicense,
        picture || '',
        status !== undefined ? Number(status) : 1,
      ]
    );
    return res.insertId;
  }

  static async updateHelper(schoolId, id, { first_name, last_name, email, phone, license_number, lisence_number, picture, status }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    await pool.query(
      `UPDATE operator_master 
       SET first_name = ?, last_name = ?, email = ?, phone = ?, lisence_number = ?, picture = IFNULL(NULLIF(?, ''), picture), status = ?
       WHERE id = ? AND school_id = ? AND type = 2`,
      [
        first_name.trim(),
        last_name ? last_name.trim() : '',
        cleanEmail,
        cleanPhone,
        cleanLicense,
        picture || '',
        status !== undefined ? Number(status) : 1,
        id,
        schoolId,
      ]
    );
    return true;
  }

  static async deleteHelper(schoolId, id) {
    await pool.query(
      `UPDATE operator_master SET status = 4 WHERE id = ? AND school_id = ? AND type = 2`,
      [id, schoolId]
    );
    return true;
  }

  // ==========================================
  // 5. ASSIGN TRANSPORT (student_transport)
  // ==========================================

  static async getAllAllocations(schoolId, { search, route_id, class_id, section_id } = {}) {
    let sql = `
      SELECT 
        st.id,
        st.school_id,
        st.student_id,
        st.route AS route_id,
        st.vehicle_number AS vehicle_id,
        st.pickup_point,
        st.drop_point,
        st.status,
        st.created_at,
        CONCAT(IFNULL(s.first_name, ''), ' ', IFNULL(s.last_name, '')) AS student_name,
        s.admission_number,
        s.roll_number,
        s.gender AS student_gender,
        s.picture AS student_picture,
        c.class_name,
        sec.section_name,
        r.transport_route AS route_name,
        r.fare,
        b.name AS vehicle_name,
        b.number_plate
      FROM student_transport st
      LEFT JOIN student_master s ON st.student_id = s.id
      LEFT JOIN class_master c ON s.class = c.id
      LEFT JOIN section_master sec ON s.section = sec.id
      LEFT JOIN trans_route_master r ON st.route = r.id
      LEFT JOIN bus_master b ON st.vehicle_number = b.id
      WHERE st.school_id = ? AND st.status != 0
    `;
    const params = [schoolId];

    if (search) {
      sql += ` AND (CONCAT(IFNULL(s.first_name, ''), ' ', IFNULL(s.last_name, '')) LIKE ? OR s.admission_number LIKE ? OR st.pickup_point LIKE ? OR st.drop_point LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (route_id) {
      sql += ` AND st.route = ?`;
      params.push(Number(route_id));
    }
    if (class_id) {
      sql += ` AND s.class = ?`;
      params.push(Number(class_id));
    }
    if (section_id) {
      sql += ` AND s.section = ?`;
      params.push(Number(section_id));
    }

    sql += ` ORDER BY st.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getAllocateById(schoolId, id) {
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
        CONCAT(IFNULL(s.first_name, ''), ' ', IFNULL(s.last_name, '')) AS student_name,
        s.admission_number,
        r.transport_route AS route_name,
        b.name AS vehicle_name
       FROM student_transport st
       LEFT JOIN student_master s ON st.student_id = s.id
       LEFT JOIN trans_route_master r ON st.route = r.id
       LEFT JOIN bus_master b ON st.vehicle_number = b.id
       WHERE st.id = ? AND st.school_id = ? AND st.status != 0`,
      [id, schoolId]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async createAllocation(schoolId, { student_id, route, vehicle_number, pickup_point, drop_point, status }) {
    const [res] = await pool.query(
      `INSERT INTO student_transport (school_id, student_id, route, vehicle_number, pickup_point, drop_point, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        schoolId,
        Number(student_id),
        Number(route),
        vehicle_number ? Number(vehicle_number) : null,
        pickup_point ? pickup_point.trim() : '',
        drop_point ? drop_point.trim() : '',
        status !== undefined ? Number(status) : 1,
      ]
    );
    return res.insertId;
  }

  static async updateAllocation(schoolId, id, { student_id, route, vehicle_number, pickup_point, drop_point, status }) {
    await pool.query(
      `UPDATE student_transport 
       SET student_id = ?, route = ?, vehicle_number = ?, pickup_point = ?, drop_point = ?, status = ?
       WHERE id = ? AND school_id = ?`,
      [
        Number(student_id),
        Number(route),
        vehicle_number ? Number(vehicle_number) : null,
        pickup_point ? pickup_point.trim() : '',
        drop_point ? drop_point.trim() : '',
        status !== undefined ? Number(status) : 1,
        id,
        schoolId,
      ]
    );
    return true;
  }

  static async deleteAllocation(schoolId, id) {
    await pool.query(
      `UPDATE student_transport SET status = 4 WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  }
}

module.exports = TransportModel;
