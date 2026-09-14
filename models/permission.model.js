const { pool } = require('../config/db.config');

const permissionCache = new Map();

class PermissionModel {
  static clearPermissionCache(roleId) {
    if (roleId) {
      permissionCache.delete(Number(roleId));
    } else {
      permissionCache.clear();
    }
  }
  // =========================================================
  // 1. ROLES MANAGEMENT
  // =========================================================

  static async getAllRoles(schoolId) {
    const query = `
      SELECT 
        r.id,
        r.school_id,
        r.role_name,
        r.created_on,
        r.status,
        COUNT(u.id) AS user_count
      FROM role_master r
      LEFT JOIN user_master u ON u.role = r.id AND u.status = 1
      WHERE r.school_id = ?
        AND (r.status = 1 OR r.status IS NULL)
        AND LOWER(TRIM(r.role_name)) != 'super admin'
      GROUP BY r.id, r.school_id, r.role_name, r.created_on, r.status
      ORDER BY r.id ASC
    `;
    const [rows] = await pool.query(query, [schoolId]);
    return rows;
  }

  static async getRoleById(roleId) {
    const query = `
      SELECT id, school_id, role_name, created_on, status
      FROM role_master
      WHERE id = ? AND (status = 1 OR status IS NULL)
    `;
    const params = [roleId];
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  static async insertRole({ schoolId, roleName }) {
    const query = `
      INSERT INTO role_master (school_id, role_name, status, created_on)
      VALUES (?, ?, 1, NOW())
    `;
    const [result] = await pool.query(query, [schoolId, roleName]);
    return result.insertId;
  }

  static async updateRole(roleId, { roleName, status }, schoolId = null) {
    let query = `UPDATE role_master SET role_name = ?`;
    const params = [roleName];

    if (status !== undefined) {
      query += `, status = ?`;
      params.push(status);
    }

    query += ` WHERE id = ?`;
    params.push(roleId);

    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [result] = await pool.query(query, params);
    this.clearPermissionCache(roleId);
    return result.affectedRows > 0;
  }

  static async deleteRole(roleId, schoolId = null) {
    // Soft delete role by updating status = 4
    let query = `UPDATE role_master SET status = 4 WHERE id = ?`;
    const params = [roleId];
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }
    const [result] = await pool.query(query, params);
    this.clearPermissionCache(roleId);
    return result.affectedRows > 0;
  }

  // =========================================================
  // 2. MODULES & PERMISSIONS MANAGEMENT
  // =========================================================

  /**
   * Returns list of all defined application modules
   */
  static async getAllDefinedModules() {
    // Standard application modules grouped by sections
    const standardModules = [
      // Academic
      'academic/classes',
      'academic/sections',
      'academic/subject',
      'academic/syllabus',
      'academic/material',
      'academic/routine',
      'academic/assignment',
      'academic/assignmenttype',
      'academic/days',
      'academic/period',
      'academic/shift',
      'academic/house',
      'academic/year',
      'academic/documentType',

      // Ward
      'ward/students',
      'ward/parents',

      // Staff
      'staff/teachers',
      'staff/users',

      // Attendance
      'attendance/student',
      'attendance/teacher',
      'attendance/staff',

      // Leaves
      'leaves/leaveapply',
      'leaves/leaveassign',

      // Transport
      'transport/route',
      'transport/bus',
      'transport/driver',
      'transport/helper',

      // Examination
      'examination/exam',
      'examination/examtype',
      'examination/examschedule',
      'examination/examsubject',
      'examination/examAttendance',
      'examination/examResult',
      'examination/gradeSettings',

      // Fees Management
      'feesmanagement/structures',
      'feesmanagement/components',
      'feesmanagement/allocations',
      'feesmanagement/invoices',
      'feesmanagement/payments',

      // Hostel
      'hostel/hostelList',
      'hostel/hostelRooms',

      // Announcements
      'announcement/notice',
      'announcement/event',
      'announcement/holiday',

      // Certificate & Records
      'certificate/category',
      'certificate/template',
      'certificate/certificatecreate',
      'records/idcard',
      'records/admitcard',
      'records/marksheet',
      'records/certificate',
      'records/transfercertificate',

      // Reports
      'report/classReport',
      'report/studentReport',
      'report/attendanceReport',
      'report/calendarReport',

      // Settings & Permissions
      'permissions/permission',
      'settings/general',
      'settings/miscManagement',
      'settings/salarydatesettings',
      'languages/language'
    ];

    // Query any extra modules from the database
    const [dbRows] = await pool.query(`SELECT DISTINCT module FROM permission WHERE module IS NOT NULL AND module != ''`);
    const allSet = new Set([...standardModules, ...dbRows.map(r => r.module)]);
    return Array.from(allSet);
  }

  static async getPermissionsByRoleId(roleId) {
    const query = `
      SELECT 
        p.id,
        p.role_id,
        p.module,
        p.view_access,
        p.add_access,
        p.edit_access,
        p.delete_access,
        r.role_name
      FROM permission p
      LEFT JOIN role_master r ON r.id = p.role_id
      WHERE p.role_id = ?
    `;
    const [rows] = await pool.query(query, [roleId]);
    return rows;
  }

  static async saveRolePermissions(roleId, permissionsList) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Delete existing permissions for this role
      await connection.query(`DELETE FROM permission WHERE role_id = ?`, [roleId]);

      // Bulk insert new permissions
      if (permissionsList && permissionsList.length > 0) {
        const values = permissionsList.map((p) => [
          roleId,
          p.module,
          p.view_access ? 1 : 0,
          p.add_access ? 1 : 0,
          p.edit_access ? 1 : 0,
          p.delete_access ? 1 : 0,
        ]);

        const insertQuery = `
          INSERT INTO permission (role_id, module, view_access, add_access, edit_access, delete_access)
          VALUES ?
        `;
        await connection.query(insertQuery, [values]);
      }

      await connection.commit();
      PermissionModel.clearPermissionCache(roleId);
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getUserPermissionMap(roleId) {
    if (!roleId) return {};

    const numRoleId = Number(roleId);
    if (permissionCache.has(numRoleId)) {
      return permissionCache.get(numRoleId);
    }

    const query = `
      SELECT module, view_access, add_access, edit_access, delete_access
      FROM permission
      WHERE role_id = ?
    `;
    const [rows] = await pool.query(query, [numRoleId]);

    const permMap = {};
    rows.forEach((r) => {
      permMap[r.module] = {
        view: Boolean(Number(r.view_access)),
        add: Boolean(Number(r.add_access)),
        edit: Boolean(Number(r.edit_access)),
        delete: Boolean(Number(r.delete_access)),
      };
    });

    permissionCache.set(numRoleId, permMap);
    return permMap;
  }
}

module.exports = PermissionModel;
