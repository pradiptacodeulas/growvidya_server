const { pool } = require('../config/db.config');

class AdminUserModel {
  static async findByEmail(email) {
    const sql = `
      SELECT 
        u.id, 
        u.school_id, 
        sm.school_name,
        sm.school_logo,
        sm.footer AS school_footer,
        u.first_name, 
        u.last_name, 
        u.email, 
        u.phone, 
        u.password, 
        u.picture, 
        u.role AS role_id, 
        u.admin_type, 
        u.status, 
        CASE 
          WHEN u.admin_type = 1 THEN 'Super Admin'
          ELSE COALESCE(r.role_name, 'Staff')
        END AS role_name
      FROM user_master u
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN school_master sm ON u.school_id = sm.id
      WHERE u.email = ? AND u.status = 1
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [email]);
    return rows[0] || null;
  }

  static async findById(id) {
    const sql = `
      SELECT 
        u.id, 
        u.school_id, 
        sm.school_name,
        sm.school_logo,
        sm.footer AS school_footer,
        u.first_name, 
        u.last_name, 
        u.email, 
        u.phone, 
        u.picture, 
        u.role AS role_id, 
        u.admin_type, 
        u.status, 
        CASE 
          WHEN u.admin_type = 1 THEN 'Super Admin'
          ELSE COALESCE(r.role_name, 'Staff')
        END AS role_name
      FROM user_master u
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN school_master sm ON u.school_id = sm.id
      WHERE u.id = ? AND u.status = 1
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
  }
}

module.exports = AdminUserModel;
