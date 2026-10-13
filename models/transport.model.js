const { pool } = require('../config/db.config');
const { hardDeleteFile } = require('../utils/file.util');

/**
 * Normalizes input status for database storage.
 * Active: 1
 * Inactive: 2 (if input is 2, '2', 0, '0', 'inactive', 'deactive', or 4/'4' on create/update)
 * Soft-deleted: 4 (handled via delete methods)
 */
const normalizeStatusForSave = (status, defaultStatus = 1) => {
  if (status === undefined || status === null || status === '') {
    return defaultStatus;
  }
  if (typeof status === 'string') {
    const s = status.trim().toLowerCase();
    if (s === 'active' || s === '1') return 1;
    if (s === 'inactive' || s === '2' || s === '0' || s === 'deactive' || s === '4') return 2;
  }
  const n = Number(status);
  if (n === 1) return 1;
  if (n === 2 || n === 0 || n === 4) return 2;
  return defaultStatus;
};

/**
 * Normalizes status filter query parameter.
 * Returns:
 *  1: filter for Active (status = 1)
 *  2: filter for Inactive (status = 2)
 *  4: explicitly requested deleted (should return empty)
 *  null: default (exclude soft-deleted status = 4 and 0)
 */
const parseStatusForFilter = (status) => {
  if (status === undefined || status === null || status === '' || status === 'null' || status === 'undefined' || status === 'all') {
    return null;
  }
  if (typeof status === 'string') {
    const s = status.trim().toLowerCase();
    if (s === 'active' || s === '1') return 1;
    if (s === 'inactive' || s === '2' || s === '0' || s === 'deactive') return 2;
    if (s === 'deleted' || s === '4') return 4;
  }
  const n = Number(status);
  if (n === 1) return 1;
  if (n === 2 || n === 0) return 2;
  if (n === 4) return 4;
  return null;
};

class TransportModel {
  // ==========================================
  // 1. ROUTES (trans_route_master)
  // ==========================================

  static async getAllRoutes(schoolId, { search, status, branchId = null } = {}) {
    let sql = `
      SELECT 
        r.id,
        r.school_id,
        r.branch_id,
        r.transport_route,
        r.bus_id,
        r.sort_order,
        r.status,
        r.fare,
        b.name AS vehicle_name,
        b.number_plate,
        b.seat AS vehicle_capacity
      FROM trans_route_master r
      LEFT JOIN bus_master b ON (r.bus_id = b.id AND b.status != 4 AND b.status != 0)
      WHERE r.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND r.branch_id = ?`;
      params.push(Number(branchId));
    }

    const parsedStatus = parseStatusForFilter(status);
    if (parsedStatus === 1) {
      sql += ` AND r.status = 1`;
    } else if (parsedStatus === 2) {
      sql += ` AND (r.status = 2 OR r.status = 0)`;
    } else if (parsedStatus === 4) {
      sql += ` AND 1 = 0`; // Never send soft-deleted items
    } else {
      sql += ` AND (r.status = 1 OR r.status = 2)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (r.transport_route LIKE ? OR b.name LIKE ? OR b.number_plate LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` ORDER BY r.sort_order ASC, r.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getRouteById(schoolId, id, branchId = null) {
    let sql = `SELECT 
        r.id,
        r.school_id,
        r.branch_id,
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
       LEFT JOIN bus_master b ON (r.bus_id = b.id AND b.status != 4 AND b.status != 0)
       WHERE r.id = ? AND r.school_id = ? AND r.status != 4 AND r.status != 0`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (r.branch_id = ? OR r.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
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
         WHERE bo.bus_id = ? AND bo.school_id = ? AND bo.status != 4 AND bo.status != 0 AND op.status != 4 AND op.status != 0`,
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

  static async createRoute(schoolId, { branch_id = null, transport_route, bus_id, bus, driver_id, driver, helpers, helper, fare, sort_order, status }) {
    const selectedBusId = bus_id || bus;
    let resolvedBranchId = branch_id ? Number(branch_id) : null;
    if (!resolvedBranchId && selectedBusId) {
      try {
        const [bRow] = await pool.query('SELECT branch_id FROM bus_master WHERE id = ? AND school_id = ? LIMIT 1', [Number(selectedBusId), schoolId]);
        if (bRow.length && bRow[0].branch_id) resolvedBranchId = bRow[0].branch_id;
      } catch (e) {}
    }
    const normalizedStatus = normalizeStatusForSave(status, 1);
    const [res] = await pool.query(
      `INSERT INTO trans_route_master (school_id, branch_id, transport_route, bus_id, fare, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        resolvedBranchId,
        transport_route.trim(),
        selectedBusId ? Number(selectedBusId) : null,
        Number(fare || 0),
        Number(sort_order || 1),
        normalizedStatus,
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
            `INSERT INTO bus_to_operator (school_id, branch_id, bus_id, operator_id, status) VALUES (?, ?, ?, ?, 1)`,
            [schoolId, resolvedBranchId, Number(selectedBusId), Number(selectedDriverId)]
          );
        }
        for (const hid of helperArr) {
          if (hid) {
            await pool.query(
              `INSERT INTO bus_to_operator (school_id, branch_id, bus_id, operator_id, status) VALUES (?, ?, ?, ?, 1)`,
              [schoolId, resolvedBranchId, Number(selectedBusId), Number(hid)]
            );
          }
        }
      }
    }
    return routeId;
  }

  static async updateRoute(schoolId, id, { transport_route, bus_id, bus, driver_id, driver, helpers, helper, fare, sort_order, status, branch_id }, branchId = null) {
    const selectedBusId = bus_id || bus;
    const normalizedStatus = normalizeStatusForSave(status, 1);
    let sql = `UPDATE trans_route_master 
       SET transport_route = ?, bus_id = ?, fare = ?, sort_order = ?, status = ?`;
    const params = [
      transport_route.trim(),
      selectedBusId ? Number(selectedBusId) : null,
      Number(fare || 0),
      Number(sort_order || 1),
      normalizedStatus,
    ];
    if (branch_id !== undefined) {
      sql += `, branch_id = ?`;
      params.push(branch_id ? Number(branch_id) : null);
    }
    sql += ` WHERE id = ? AND school_id = ? AND status != 4`;
    params.push(id, schoolId);

    const effectiveBranchId = branchId || (branch_id !== undefined ? branch_id : null);
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    await pool.query(sql, params);

    if (selectedBusId) {
      let routeBranchId = effectiveBranchId ? Number(effectiveBranchId) : null;
      if (!routeBranchId) {
        try {
          const [rRow] = await pool.query('SELECT branch_id FROM trans_route_master WHERE id = ? AND school_id = ? LIMIT 1', [id, schoolId]);
          if (rRow.length && rRow[0].branch_id) routeBranchId = rRow[0].branch_id;
        } catch (e) {}
      }
      if (!routeBranchId) {
        try {
          const [bRow] = await pool.query('SELECT branch_id FROM bus_master WHERE id = ? AND school_id = ? LIMIT 1', [Number(selectedBusId), schoolId]);
          if (bRow.length && bRow[0].branch_id) routeBranchId = bRow[0].branch_id;
        } catch (e) {}
      }
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
            `INSERT INTO bus_to_operator (school_id, branch_id, bus_id, operator_id, status) VALUES (?, ?, ?, ?, 1)`,
            [schoolId, routeBranchId, Number(selectedBusId), Number(selectedDriverId)]
          );
        }
        for (const hid of helperArr) {
          if (hid) {
            await pool.query(
              `INSERT INTO bus_to_operator (school_id, branch_id, bus_id, operator_id, status) VALUES (?, ?, ?, ?, 1)`,
              [schoolId, routeBranchId, Number(selectedBusId), Number(hid)]
            );
          }
        }
      }
    }
    return true;
  }

  static async deleteRoute(schoolId, id, branchId = null) {
    let sql = `UPDATE trans_route_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    return true;
  }

  // ==========================================
  // 2. VEHICLES / BUSES (bus_master)
  // ==========================================

  static async getAllVehicles(schoolId, { search, status, branchId = null } = {}) {
    let sql = `
      SELECT 
        b.id,
        b.school_id,
        b.branch_id,
        b.name,
        b.number_plate,
        b.seat,
        b.color,
        b.image,
        b.status,
        MAX(IF(op.type = 1, op.id, NULL)) AS driver_id,
        NULLIF(TRIM(MAX(IF(op.type = 1, CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')), NULL))), '') AS driver_name,
        MAX(IF(op.type = 1, op.phone, NULL)) AS driver_phone
      FROM bus_master b
      LEFT JOIN bus_to_operator bo ON (b.id = bo.bus_id AND bo.school_id = ? AND bo.status != 4 AND bo.status != 0)
      LEFT JOIN operator_master op ON (bo.operator_id = op.id AND op.type = 1 AND op.status != 4 AND op.status != 0)
      WHERE b.school_id = ?
    `;
    const params = [schoolId, schoolId];

    if (branchId) {
      sql += ` AND b.branch_id = ?`;
      params.push(Number(branchId));
    }

    const parsedStatus = parseStatusForFilter(status);
    if (parsedStatus === 1) {
      sql += ` AND b.status = 1`;
    } else if (parsedStatus === 2) {
      sql += ` AND (b.status = 2 OR b.status = 0)`;
    } else if (parsedStatus === 4) {
      sql += ` AND 1 = 0`; // Never send soft-deleted items
    } else {
      sql += ` AND (b.status = 1 OR b.status = 2)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (b.name LIKE ? OR b.number_plate LIKE ? OR b.color LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` GROUP BY b.id, b.school_id, b.name, b.number_plate, b.seat, b.color, b.image, b.status ORDER BY b.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getVehicleById(schoolId, id, branchId = null) {
    let sql = `SELECT 
        b.id,
        b.school_id,
        b.branch_id,
        b.name,
        b.number_plate,
        b.seat,
        b.color,
        b.image,
        b.status,
        MAX(IF(op.type = 1, op.id, NULL)) AS driver_id,
        NULLIF(TRIM(MAX(IF(op.type = 1, CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')), NULL))), '') AS driver_name,
        MAX(IF(op.type = 1, op.phone, NULL)) AS driver_phone
       FROM bus_master b
       LEFT JOIN bus_to_operator bo ON (b.id = bo.bus_id AND bo.school_id = ? AND bo.status != 4 AND bo.status != 0)
       LEFT JOIN operator_master op ON (bo.operator_id = op.id AND op.type = 1 AND op.status != 4 AND op.status != 0)
       WHERE b.id = ? AND b.school_id = ? AND b.status != 4 AND b.status != 0`;
    const params = [schoolId, id, schoolId];
    if (branchId) {
      sql += ` AND (b.branch_id = ? OR b.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` GROUP BY b.id, b.school_id, b.branch_id, b.name, b.number_plate, b.seat, b.color, b.image, b.status`;

    const [rows] = await pool.query(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async createVehicle(schoolId, { branch_id = null, name, number_plate, seat, color, driver_id, status, image = null }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;
    const normalizedStatus = normalizeStatusForSave(status, 1);
    const [res] = await pool.query(
      `INSERT INTO bus_master (school_id, branch_id, name, number_plate, seat, color, image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        resolvedBranchId,
        name.trim(),
        number_plate ? number_plate.trim() : '',
        Number(seat || 0),
        color ? color.trim() : '',
        image || null,
        normalizedStatus,
      ]
    );
    const busId = res.insertId;

    if (driver_id) {
      await pool.query(
        `INSERT INTO bus_to_operator (school_id, branch_id, bus_id, operator_id, status)
         VALUES (?, ?, ?, ?, 1)`,
        [schoolId, resolvedBranchId, busId, Number(driver_id)]
      );
    }
    return busId;
  }

  static async updateVehicle(schoolId, id, { name, number_plate, seat, color, driver_id, status, branch_id, image }, branchId = null) {
    const normalizedStatus = normalizeStatusForSave(status, 1);

    if (image !== undefined) {
      try {
        const [oldRows] = await pool.query('SELECT image FROM bus_master WHERE id = ? AND school_id = ? LIMIT 1', [id, schoolId]);
        const oldImage = oldRows[0]?.image;
        if (oldImage && oldImage !== image) {
          await hardDeleteFile(oldImage);
        }
      } catch (e) {
        console.error('Error removing old bus image on update:', e);
      }
    }

    let sql = `UPDATE bus_master 
       SET name = ?, number_plate = ?, seat = ?, color = ?, status = ?`;
    const params = [
      name.trim(),
      number_plate ? number_plate.trim() : '',
      Number(seat || 0),
      color ? color.trim() : '',
      normalizedStatus,
    ];
    if (image !== undefined) {
      sql += `, image = ?`;
      params.push(image || null);
    }
    if (branch_id !== undefined) {
      sql += `, branch_id = ?`;
      params.push(branch_id ? Number(branch_id) : null);
    }
    sql += ` WHERE id = ? AND school_id = ? AND status != 4`;
    params.push(id, schoolId);

    const effectiveBranchId = branchId || (branch_id !== undefined ? branch_id : null);
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    await pool.query(sql, params);

    let busBranchId = effectiveBranchId ? Number(effectiveBranchId) : null;
    if (!busBranchId) {
      try {
        const [bRow] = await pool.query('SELECT branch_id FROM bus_master WHERE id = ? AND school_id = ? LIMIT 1', [id, schoolId]);
        if (bRow.length && bRow[0].branch_id) busBranchId = bRow[0].branch_id;
      } catch (e) {}
    }

    // Update driver association
    await pool.query(
      `DELETE FROM bus_to_operator WHERE bus_id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (driver_id) {
      await pool.query(
        `INSERT INTO bus_to_operator (school_id, branch_id, bus_id, operator_id, status)
         VALUES (?, ?, ?, ?, 1)`,
        [schoolId, busBranchId, id, Number(driver_id)]
      );
    }
    return true;
  }

  static async deleteVehicle(schoolId, id, branchId = null) {
    try {
      const [oldRows] = await pool.query('SELECT image FROM bus_master WHERE id = ? AND school_id = ? LIMIT 1', [id, schoolId]);
      if (oldRows[0]?.image) {
        await hardDeleteFile(oldRows[0].image);
      }
    } catch (e) {
      console.error('Error removing bus image on delete:', e);
    }

    let sql = `UPDATE bus_master SET status = 4, image = NULL WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);

    // Also soft-delete operator mapping
    await pool.query(
      `UPDATE bus_to_operator SET status = 4 WHERE bus_id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  }

  // ==========================================
  // 3. DRIVERS (operator_master with type = 1)
  // ==========================================

  static async getAllDrivers(schoolId, { search, status, branchId = null } = {}) {
    let sql = `
      SELECT 
        op.id,
        op.school_id,
        op.branch_id,
        bm.branch_name,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS driver_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.lisence_doc,
        op.id_proof_type,
        op.id_proof_number,
        op.id_proof_doc,
        op.picture,
        op.status,
        MAX(b.name) AS assigned_bus,
        MAX(b.number_plate) AS assigned_number_plate
      FROM operator_master op
      LEFT JOIN branch_master bm ON op.branch_id = bm.id
      LEFT JOIN bus_to_operator bo ON (op.id = bo.operator_id AND bo.status != 4 AND bo.status != 0)
      LEFT JOIN bus_master b ON (bo.bus_id = b.id AND b.status != 4 AND b.status != 0)
      WHERE op.school_id = ? AND op.type = 1
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND (op.branch_id = ? OR op.branch_id IS NULL OR b.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }

    const parsedStatus = parseStatusForFilter(status);
    if (parsedStatus === 1) {
      sql += ` AND op.status = 1`;
    } else if (parsedStatus === 2) {
      sql += ` AND (op.status = 2 OR op.status = 0)`;
    } else if (parsedStatus === 4) {
      sql += ` AND 1 = 0`; // Never send soft-deleted items
    } else {
      sql += ` AND (op.status = 1 OR op.status = 2)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) LIKE ? OR op.phone LIKE ? OR op.email LIKE ? OR op.lisence_number LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` GROUP BY op.id, op.school_id, op.branch_id, bm.branch_name, op.first_name, op.last_name, op.email, op.phone, op.lisence_number, op.lisence_doc, op.id_proof_type, op.id_proof_number, op.id_proof_doc, op.picture, op.status ORDER BY op.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getDriverById(schoolId, id, branchId = null) {
    let sql = `SELECT 
        op.id,
        op.school_id,
        op.branch_id,
        bm.branch_name,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS driver_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.lisence_doc,
        op.id_proof_type,
        op.id_proof_number,
        op.id_proof_doc,
        op.picture,
        op.status
       FROM operator_master op
       LEFT JOIN branch_master bm ON op.branch_id = bm.id
       WHERE op.id = ? AND op.school_id = ? AND op.type = 1 AND op.status != 4 AND op.status != 0`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (op.branch_id = ? OR op.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
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

  static async createDriver(schoolId, {
    branch_id = null,
    first_name,
    last_name,
    email,
    phone,
    license_number,
    lisence_number,
    license_doc,
    lisence_doc,
    id_proof_type,
    id_proof_number,
    id_proof_doc,
    picture,
    status
  }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    const resolvedLicenseDoc = license_doc || lisence_doc || null;
    const resolvedIdProofType = id_proof_type ? String(id_proof_type).trim() : null;
    const resolvedIdProofNumber = id_proof_number ? String(id_proof_number).trim() : null;
    const resolvedIdProofDoc = id_proof_doc || null;
    const resolvedBranchId = branch_id ? Number(branch_id) : null;
    const normalizedStatus = normalizeStatusForSave(status, 1);
    const [res] = await pool.query(
      `INSERT INTO operator_master (
        school_id, branch_id, first_name, last_name, email, phone, 
        lisence_number, lisence_doc, id_proof_type, id_proof_number, id_proof_doc, 
        picture, type, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        schoolId,
        resolvedBranchId,
        first_name.trim(),
        last_name ? last_name.trim() : '',
        cleanEmail,
        cleanPhone,
        cleanLicense,
        resolvedLicenseDoc,
        resolvedIdProofType,
        resolvedIdProofNumber,
        resolvedIdProofDoc,
        picture || '',
        normalizedStatus,
      ]
    );
    return res.insertId;
  }

  static async updateDriver(schoolId, id, {
    branch_id,
    first_name,
    last_name,
    email,
    phone,
    license_number,
    lisence_number,
    license_doc,
    lisence_doc,
    id_proof_type,
    id_proof_number,
    id_proof_doc,
    remove_license_doc,
    remove_id_proof_doc,
    picture,
    status
  }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : null;
    const normalizedStatus = normalizeStatusForSave(status, 1);

    // Fetch existing driver to handle file replacement/deletion
    const [existing] = await pool.query(
      `SELECT lisence_doc, id_proof_doc FROM operator_master WHERE id = ? AND school_id = ? AND type = 1`,
      [id, schoolId]
    );
    const currentDoc = existing?.[0] || {};

    let finalLicenseDoc = currentDoc.lisence_doc || null;
    const newLicenseDoc = license_doc !== undefined ? license_doc : lisence_doc;
    if (newLicenseDoc) {
      if (currentDoc.lisence_doc && currentDoc.lisence_doc !== newLicenseDoc) {
        hardDeleteFile(currentDoc.lisence_doc);
      }
      finalLicenseDoc = newLicenseDoc;
    } else if (remove_license_doc === true || remove_license_doc === 'true') {
      if (currentDoc.lisence_doc) {
        hardDeleteFile(currentDoc.lisence_doc);
      }
      finalLicenseDoc = null;
    }

    let finalIdProofDoc = currentDoc.id_proof_doc || null;
    if (id_proof_doc) {
      if (currentDoc.id_proof_doc && currentDoc.id_proof_doc !== id_proof_doc) {
        hardDeleteFile(currentDoc.id_proof_doc);
      }
      finalIdProofDoc = id_proof_doc;
    } else if (remove_id_proof_doc === true || remove_id_proof_doc === 'true') {
      if (currentDoc.id_proof_doc) {
        hardDeleteFile(currentDoc.id_proof_doc);
      }
      finalIdProofDoc = null;
    }

    const resolvedIdProofType = id_proof_type !== undefined ? (id_proof_type ? String(id_proof_type).trim() : null) : undefined;
    const resolvedIdProofNumber = id_proof_number !== undefined ? (id_proof_number ? String(id_proof_number).trim() : null) : undefined;

    let updateSql = `UPDATE operator_master 
       SET first_name = ?, last_name = ?, email = ?, phone = ?, lisence_number = ?, 
           lisence_doc = ?, id_proof_doc = ?,
           picture = IFNULL(NULLIF(?, ''), picture), status = ?, branch_id = COALESCE(?, branch_id)`;
    const updateParams = [
      first_name.trim(),
      last_name ? last_name.trim() : '',
      cleanEmail,
      cleanPhone,
      cleanLicense,
      finalLicenseDoc,
      finalIdProofDoc,
      picture || '',
      normalizedStatus,
      resolvedBranchId,
    ];

    if (resolvedIdProofType !== undefined) {
      updateSql += `, id_proof_type = ?`;
      updateParams.push(resolvedIdProofType);
    }
    if (resolvedIdProofNumber !== undefined) {
      updateSql += `, id_proof_number = ?`;
      updateParams.push(resolvedIdProofNumber);
    }

    updateSql += ` WHERE id = ? AND school_id = ? AND type = 1 AND status != 4`;
    updateParams.push(id, schoolId);

    await pool.query(updateSql, updateParams);
    return true;
  }

  static async deleteDriver(schoolId, id, branchId = null) {
    const [existing] = await pool.query(
      `SELECT lisence_doc, id_proof_doc FROM operator_master WHERE id = ? AND school_id = ? AND type = 1`,
      [id, schoolId]
    );
    if (existing && existing.length > 0) {
      if (existing[0].lisence_doc) hardDeleteFile(existing[0].lisence_doc);
      if (existing[0].id_proof_doc) hardDeleteFile(existing[0].id_proof_doc);
    }

    let sql = `UPDATE operator_master SET status = 4, lisence_doc = NULL, id_proof_doc = NULL WHERE id = ? AND school_id = ? AND type = 1`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);

    // Also soft-delete operator mapping
    await pool.query(
      `UPDATE bus_to_operator SET status = 4 WHERE operator_id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  }

  // ==========================================
  // 4. HELPERS (operator_master with type = 2)
  // ==========================================

  static async getAllHelpers(schoolId, { search, status, branchId = null } = {}) {
    let sql = `
      SELECT 
        op.id,
        op.school_id,
        op.branch_id,
        bm.branch_name,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS helper_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.id_proof_type,
        op.id_proof_number,
        op.id_proof_doc,
        op.picture,
        op.status,
        MAX(b.name) AS assigned_bus,
        MAX(b.number_plate) AS assigned_number_plate
      FROM operator_master op
      LEFT JOIN branch_master bm ON op.branch_id = bm.id
      LEFT JOIN bus_to_operator bo ON (op.id = bo.operator_id AND bo.status != 4 AND bo.status != 0)
      LEFT JOIN bus_master b ON (bo.bus_id = b.id AND b.status != 4 AND b.status != 0)
      WHERE op.school_id = ? AND op.type = 2
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND (op.branch_id = ? OR op.branch_id IS NULL OR b.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }

    const parsedStatus = parseStatusForFilter(status);
    if (parsedStatus === 1) {
      sql += ` AND op.status = 1`;
    } else if (parsedStatus === 2) {
      sql += ` AND (op.status = 2 OR op.status = 0)`;
    } else if (parsedStatus === 4) {
      sql += ` AND 1 = 0`; // Never send soft-deleted items
    } else {
      sql += ` AND (op.status = 1 OR op.status = 2)`;
    }

    if (search && search.trim() !== '') {
      sql += ` AND (CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) LIKE ? OR op.phone LIKE ? OR op.email LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ` GROUP BY op.id, op.school_id, op.branch_id, bm.branch_name, op.first_name, op.last_name, op.email, op.phone, op.lisence_number, op.id_proof_type, op.id_proof_number, op.id_proof_doc, op.picture, op.status ORDER BY op.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows || [];
  }

  static async getHelperById(schoolId, id, branchId = null) {
    let sql = `SELECT 
        op.id,
        op.school_id,
        op.branch_id,
        bm.branch_name,
        op.first_name,
        op.last_name,
        CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')) AS helper_name,
        op.email,
        op.phone,
        op.lisence_number AS license_number,
        op.id_proof_type,
        op.id_proof_number,
        op.id_proof_doc,
        op.picture,
        op.status
       FROM operator_master op
       LEFT JOIN branch_master bm ON op.branch_id = bm.id
       WHERE op.id = ? AND op.school_id = ? AND op.type = 2 AND op.status != 4 AND op.status != 0`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (op.branch_id = ? OR op.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
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

  static async createHelper(schoolId, {
    branch_id = null,
    first_name,
    last_name,
    email,
    phone,
    license_number,
    lisence_number,
    id_proof_type,
    id_proof_number,
    id_proof_doc,
    picture,
    status
  }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    const resolvedIdProofType = id_proof_type ? String(id_proof_type).trim() : null;
    const resolvedIdProofNumber = id_proof_number ? String(id_proof_number).trim() : null;
    const resolvedIdProofDoc = id_proof_doc || null;
    const resolvedBranchId = branch_id ? Number(branch_id) : null;
    const normalizedStatus = normalizeStatusForSave(status, 1);
    const [res] = await pool.query(
      `INSERT INTO operator_master (
        school_id, branch_id, first_name, last_name, email, phone, 
        lisence_number, id_proof_type, id_proof_number, id_proof_doc, 
        picture, type, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?)`,
      [
        schoolId,
        resolvedBranchId,
        first_name.trim(),
        last_name ? last_name.trim() : '',
        cleanEmail,
        cleanPhone,
        cleanLicense,
        resolvedIdProofType,
        resolvedIdProofNumber,
        resolvedIdProofDoc,
        picture || '',
        normalizedStatus,
      ]
    );
    return res.insertId;
  }

  static async updateHelper(schoolId, id, {
    branch_id,
    first_name,
    last_name,
    email,
    phone,
    license_number,
    lisence_number,
    id_proof_type,
    id_proof_number,
    id_proof_doc,
    remove_id_proof_doc,
    picture,
    status
  }) {
    const cleanEmail = email && String(email).trim() ? String(email).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : '';
    const cleanLicense = (license_number || lisence_number || '').trim() || null;
    const normalizedStatus = normalizeStatusForSave(status, 1);

    // Fetch existing helper to handle file replacement/deletion
    const [existing] = await pool.query(
      `SELECT id_proof_doc FROM operator_master WHERE id = ? AND school_id = ? AND type = 2`,
      [id, schoolId]
    );
    const currentDoc = existing?.[0] || {};

    let finalIdProofDoc = currentDoc.id_proof_doc || null;
    if (id_proof_doc) {
      if (currentDoc.id_proof_doc && currentDoc.id_proof_doc !== id_proof_doc) {
        hardDeleteFile(currentDoc.id_proof_doc);
      }
      finalIdProofDoc = id_proof_doc;
    } else if (remove_id_proof_doc === true || remove_id_proof_doc === 'true') {
      if (currentDoc.id_proof_doc) {
        hardDeleteFile(currentDoc.id_proof_doc);
      }
      finalIdProofDoc = null;
    }

    const resolvedIdProofType = id_proof_type !== undefined ? (id_proof_type ? String(id_proof_type).trim() : null) : undefined;
    const resolvedIdProofNumber = id_proof_number !== undefined ? (id_proof_number ? String(id_proof_number).trim() : null) : undefined;

    let sql = `UPDATE operator_master 
       SET first_name = ?, last_name = ?, email = ?, phone = ?, lisence_number = ?, 
           id_proof_doc = ?,
           picture = IFNULL(NULLIF(?, ''), picture), status = ?`;
    const params = [
      first_name.trim(),
      last_name ? last_name.trim() : '',
      cleanEmail,
      cleanPhone,
      cleanLicense,
      finalIdProofDoc,
      picture || '',
      normalizedStatus,
    ];

    if (resolvedIdProofType !== undefined) {
      sql += `, id_proof_type = ?`;
      params.push(resolvedIdProofType);
    }
    if (resolvedIdProofNumber !== undefined) {
      sql += `, id_proof_number = ?`;
      params.push(resolvedIdProofNumber);
    }
    if (branch_id !== undefined) {
      sql += `, branch_id = ?`;
      params.push(branch_id ? Number(branch_id) : null);
    }
    sql += ` WHERE id = ? AND school_id = ? AND type = 2 AND status != 4`;
    params.push(id, schoolId);

    await pool.query(sql, params);
    return true;
  }

  static async deleteHelper(schoolId, id, branchId = null) {
    const [existing] = await pool.query(
      `SELECT id_proof_doc FROM operator_master WHERE id = ? AND school_id = ? AND type = 2`,
      [id, schoolId]
    );
    if (existing && existing.length > 0 && existing[0].id_proof_doc) {
      hardDeleteFile(existing[0].id_proof_doc);
    }

    let sql = `UPDATE operator_master SET status = 4, id_proof_doc = NULL WHERE id = ? AND school_id = ? AND type = 2`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);

    // Also soft-delete operator mapping
    await pool.query(
      `UPDATE bus_to_operator SET status = 4 WHERE operator_id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return true;
  }

  // ==========================================
  // 5. ASSIGN TRANSPORT (student_transport)
  // ==========================================

  static async getAllAllocations(schoolId, { search, route_id, class_id, section_id, status, branchId = null } = {}) {
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
      LEFT JOIN student_master s ON (st.student_id = s.id AND (s.status != 4 OR s.status IS NULL))
      LEFT JOIN class_master c ON s.class = c.id
      LEFT JOIN section_master sec ON s.section = sec.id
      LEFT JOIN trans_route_master r ON (st.route = r.id AND (r.status != 4 OR r.status IS NULL))
      LEFT JOIN bus_master b ON (st.vehicle_number = b.id AND (b.status != 4 OR b.status IS NULL))
      WHERE st.school_id = ?
    `;
    const params = [schoolId];

    if (branchId) {
      sql += ` AND (s.branch_id = ? OR r.branch_id = ?)`;
      params.push(Number(branchId), Number(branchId));
    }

    const parsedStatus = parseStatusForFilter(status);
    if (parsedStatus === 1) {
      sql += ` AND st.status = 1`;
    } else if (parsedStatus === 2) {
      sql += ` AND (st.status = 2 OR st.status = 0)`;
    } else if (parsedStatus === 4) {
      sql += ` AND 1 = 0`; // Never send soft-deleted items
    } else {
      sql += ` AND (st.status = 1 OR st.status = 2)`;
    }

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

  static async getAllocateById(schoolId, id, branchId = null) {
    let sql = `SELECT 
        st.id,
        st.school_id,
        st.branch_id,
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
       WHERE st.id = ? AND st.school_id = ? AND st.status != 4 AND st.status != 0`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (st.branch_id = ? OR s.branch_id = ? OR r.branch_id = ? OR st.branch_id IS NULL)`;
      params.push(Number(branchId), Number(branchId), Number(branchId));
    }
    const [rows] = await pool.query(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  static async createAllocation(schoolId, { branch_id = null, student_id, route, vehicle_number, pickup_point, drop_point, status }) {
    let resolvedBranchId = branch_id ? Number(branch_id) : null;
    if (!resolvedBranchId && student_id) {
      const [sm] = await pool.query('SELECT branch_id FROM student_master WHERE id = ? AND school_id = ?', [student_id, schoolId]);
      if (sm.length && sm[0].branch_id) resolvedBranchId = sm[0].branch_id;
    }
    const normalizedStatus = normalizeStatusForSave(status, 1);
    const [res] = await pool.query(
      `INSERT INTO student_transport (school_id, branch_id, student_id, route, vehicle_number, pickup_point, drop_point, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        schoolId,
        resolvedBranchId,
        Number(student_id),
        Number(route),
        vehicle_number ? Number(vehicle_number) : null,
        pickup_point ? pickup_point.trim() : '',
        drop_point ? drop_point.trim() : '',
        normalizedStatus,
      ]
    );
    return res.insertId;
  }

  static async updateAllocation(schoolId, id, { branch_id, student_id, route, vehicle_number, pickup_point, drop_point, status }, branchId = null) {
    const normalizedStatus = normalizeStatusForSave(status, 1);
    let sql = `UPDATE student_transport 
       SET student_id = ?, route = ?, vehicle_number = ?, pickup_point = ?, drop_point = ?, status = ?`;
    const params = [
      Number(student_id),
      Number(route),
      vehicle_number ? Number(vehicle_number) : null,
      pickup_point ? pickup_point.trim() : '',
      drop_point ? drop_point.trim() : '',
      normalizedStatus,
    ];
    if (branch_id !== undefined) {
      sql += `, branch_id = ?`;
      params.push(branch_id ? Number(branch_id) : null);
    }
    sql += ` WHERE id = ? AND school_id = ? AND status != 4`;
    params.push(id, schoolId);

    const effectiveBranchId = branchId || (branch_id !== undefined ? branch_id : null);
    if (effectiveBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(effectiveBranchId));
    }

    await pool.query(sql, params);
    return true;
  }

  static async deleteAllocation(schoolId, id, branchId = null) {
    let sql = `UPDATE student_transport SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    await pool.query(sql, params);
    return true;
  }
}

module.exports = TransportModel;
