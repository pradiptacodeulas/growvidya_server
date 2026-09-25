const { pool } = require('../config/db.config');

class AttendanceMachineMasterModel {
  /**
   * Fetch all attendance machines (with search, status, machine_type, brand filters)
   */
  static async getAll({ search = '', status = '', machine_type = '', brand = '' } = {}) {
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (machine_type && machine_type.trim()) {
      conditions.push('machine_type = ?');
      params.push(machine_type.trim());
    }

    if (brand && brand.trim()) {
      conditions.push('brand = ?');
      params.push(brand.trim());
    }

    if (search && search.trim()) {
      conditions.push('(machine_name LIKE ? OR model_number LIKE ? OR brand LIKE ? OR connectivity LIKE ? OR specifications LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT 
        id,
        machine_name,
        model_number,
        brand,
        machine_type,
        connectivity,
        user_capacity,
        log_capacity,
        push_protocol,
        unit_price,
        amc_price,
        machine_image,
        specifications,
        status,
        created_at,
        updated_at
      FROM attendance_machine_master
      ${where}
      ORDER BY id DESC
    `;

    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Fetch only active attendance machines
   */
  static async getActive() {
    const [rows] = await pool.query(`
      SELECT 
        id,
        machine_name,
        model_number,
        brand,
        machine_type,
        connectivity,
        user_capacity,
        log_capacity,
        push_protocol,
        unit_price,
        amc_price,
        machine_image,
        specifications,
        status,
        created_at
      FROM attendance_machine_master
      WHERE status = 1
      ORDER BY machine_name ASC
    `);
    return rows;
  }

  /**
   * Get single machine by ID
   */
  static async getById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM attendance_machine_master WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Get single machine by model_number
   */
  static async getByModelNumber(modelNumber) {
    if (!modelNumber) return null;
    const [rows] = await pool.query(
      'SELECT * FROM attendance_machine_master WHERE model_number = ? LIMIT 1',
      [modelNumber.trim()]
    );
    return rows[0] || null;
  }

  /**
   * Create a new attendance machine item
   */
  static async create({
    machine_name,
    model_number,
    brand,
    machine_type = 'hybrid',
    connectivity = 'LAN, Wi-Fi',
    user_capacity = 1000,
    log_capacity = 100000,
    push_protocol = 'Cloud Push',
    unit_price = 0,
    amc_price = 0,
    machine_image = null,
    specifications = null,
    status = 1,
  }) {
    const [result] = await pool.query(
      `INSERT INTO attendance_machine_master 
       (machine_name, model_number, brand, machine_type, connectivity, user_capacity, log_capacity, push_protocol, unit_price, amc_price, machine_image, specifications, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        machine_name.trim(),
        model_number.trim().toUpperCase(),
        brand.trim(),
        machine_type || 'hybrid',
        connectivity ? connectivity.trim() : 'LAN, Wi-Fi',
        parseInt(user_capacity, 10) || 1000,
        parseInt(log_capacity, 10) || 100000,
        push_protocol ? push_protocol.trim() : 'Cloud Push',
        parseFloat(unit_price) || 0.00,
        parseFloat(amc_price) || 0.00,
        machine_image || null,
        specifications || '',
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update an attendance machine item
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.machine_name !== undefined) {
      updates.push('machine_name = ?');
      params.push(data.machine_name.trim());
    }
    if (data.model_number !== undefined) {
      updates.push('model_number = ?');
      params.push(data.model_number.trim().toUpperCase());
    }
    if (data.brand !== undefined) {
      updates.push('brand = ?');
      params.push(data.brand.trim());
    }
    if (data.machine_type !== undefined) {
      updates.push('machine_type = ?');
      params.push(data.machine_type);
    }
    if (data.connectivity !== undefined) {
      updates.push('connectivity = ?');
      params.push(data.connectivity ? data.connectivity.trim() : null);
    }
    if (data.user_capacity !== undefined) {
      updates.push('user_capacity = ?');
      params.push(parseInt(data.user_capacity, 10) || 0);
    }
    if (data.log_capacity !== undefined) {
      updates.push('log_capacity = ?');
      params.push(parseInt(data.log_capacity, 10) || 0);
    }
    if (data.push_protocol !== undefined) {
      updates.push('push_protocol = ?');
      params.push(data.push_protocol ? data.push_protocol.trim() : null);
    }
    if (data.unit_price !== undefined) {
      updates.push('unit_price = ?');
      params.push(parseFloat(data.unit_price) || 0);
    }
    if (data.amc_price !== undefined) {
      updates.push('amc_price = ?');
      params.push(parseFloat(data.amc_price) || 0);
    }
    if (data.machine_image !== undefined) {
      updates.push('machine_image = ?');
      params.push(data.machine_image);
    }
    if (data.specifications !== undefined) {
      updates.push('specifications = ?');
      params.push(data.specifications);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(data.status, 10));
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE attendance_machine_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete an attendance machine
   */
  static async delete(id) {
    // Check if machine is linked to any schools
    const [schoolMachines] = await pool.query(
      'SELECT COUNT(*) AS count FROM school_attendance_machines WHERE machine_master_id = ?',
      [id]
    );
    if (schoolMachines[0].count > 0) {
      throw new Error('Cannot delete this machine model because it is assigned to school campuses. Please deactivate it instead.');
    }

    const [result] = await pool.query('DELETE FROM attendance_machine_master WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle status
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE attendance_machine_master SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }
}

module.exports = AttendanceMachineMasterModel;
