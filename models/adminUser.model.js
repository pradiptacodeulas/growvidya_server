const { pool } = require('../config/db.config');

class AdminUserModel {
  static async findByEmail(email, schoolId = null) {
    const hasSchoolFilter = schoolId !== null && schoolId !== undefined && !isNaN(Number(schoolId));
    const sql = `
      SELECT 
        u.id, 
        u.school_id, 
        u.branch_id,
        bm.branch_name,
        bm.branch_code,
        sm.school_name,
        sm.school_logo,
        sm.registration_type,
        sm.status AS school_status,
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
          ELSE r.role_name
        END AS role_name
      FROM user_master u
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN school_master sm ON u.school_id = sm.id
      LEFT JOIN branch_master bm ON u.branch_id = bm.id
      WHERE u.email = ?${hasSchoolFilter ? ' AND u.school_id = ?' : ''} AND u.status != 4
      ORDER BY CASE WHEN u.status = 1 THEN 0 ELSE 1 END, u.id ASC
      LIMIT 1
    `;
    const params = hasSchoolFilter ? [email, Number(schoolId)] : [email];
    const [rows] = await pool.execute(sql, params);
    return rows[0] || null;
  }

  static async findByLoginIdentifier(identifier) {
    const cleanIdent = String(identifier || '').trim();
    if (!cleanIdent) return null;
    const sql = `
      SELECT 
        u.id, 
        u.school_id, 
        u.branch_id,
        bm.branch_name,
        bm.branch_code,
        sm.school_name,
        sm.school_logo,
        sm.registration_type,
        sm.status AS school_status,
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
          ELSE r.role_name
        END AS role_name
      FROM user_master u
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN school_master sm ON u.school_id = sm.id
      LEFT JOIN branch_master bm ON u.branch_id = bm.id
      WHERE u.email = ? AND u.status != 4
      ORDER BY CASE WHEN u.status = 1 THEN 0 ELSE 1 END, u.id ASC
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [cleanIdent]);
    return rows[0] || null;
  }

  static async findById(id) {
    const sql = `
      SELECT 
        u.id, 
        u.school_id, 
        u.branch_id,
        bm.branch_name,
        bm.branch_code,
        sm.school_name,
        sm.school_logo,
        sm.registration_type,
        sm.status AS school_status,
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
          ELSE r.role_name
        END AS role_name
      FROM user_master u
      LEFT JOIN role_master r ON u.role = r.id
      LEFT JOIN school_master sm ON u.school_id = sm.id
      LEFT JOIN branch_master bm ON u.branch_id = bm.id
      WHERE u.id = ? AND u.status = 1
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
  }
}

module.exports = AdminUserModel;
