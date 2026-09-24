const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');

class SaasRoleModel {
  // ========================================================
  // 1. MODULES
  // ========================================================
  /**
   * Fetch all active SaaS modules
   */
  static async getModules() {
    const [rows] = await pool.query(`
      SELECT id, module_key, module_name, description, display_order, status
      FROM saas_modules
      WHERE status = 1
      ORDER BY display_order ASC, id ASC
    `);
    return rows;
  }

  // ========================================================
  // 2. ROLES MANAGEMENT
  // ========================================================
  /**
   * List all SaaS roles with assigned user count
   */
  static async getAllRoles({ search = '', status = '' } = {}) {
    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('r.status = ?');
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      conditions.push('(r.role_name LIKE ? OR r.description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        r.id,
        r.role_name,
        r.description,
        r.is_system,
        r.status,
        r.created_at,
        r.updated_at,
        (SELECT COUNT(*) FROM saas_admin_users sau WHERE sau.role_id = r.id) AS assigned_users_count,
        (
          SELECT COUNT(*) 
          FROM saas_role_permissions srp 
          WHERE srp.role_id = r.id AND (srp.can_view = 1 OR srp.can_add = 1 OR srp.can_edit = 1 OR srp.can_delete = 1 OR srp.can_manage = 1)
        ) AS active_modules_count
      FROM saas_roles r
      ${where}
      ORDER BY r.is_system DESC, r.id ASC
    `;

    const [roles] = await pool.query(query, params);
    return roles;
  }

  /**
   * Get role by ID with all module permissions
   */
  static async getRoleById(id) {
    const [roles] = await pool.query('SELECT * FROM saas_roles WHERE id = ? LIMIT 1', [id]);
    if (roles.length === 0) return null;

    const role = roles[0];

    // Fetch all active modules
    const modules = await SaasRoleModel.getModules();

    // Fetch existing permissions for this role
    const [perms] = await pool.query('SELECT * FROM saas_role_permissions WHERE role_id = ?', [id]);
    const permMap = {};
    perms.forEach(p => {
      permMap[p.module_key] = p;
    });

    // Merge modules with permissions so each module has an entry
    role.permissions = modules.map(m => {
      const p = permMap[m.module_key];
      return {
        module_key: m.module_key,
        module_name: m.module_name,
        description: m.description,
        can_view: p ? Number(p.can_view) : 0,
        can_add: p ? Number(p.can_add) : 0,
        can_edit: p ? Number(p.can_edit) : 0,
        can_delete: p ? Number(p.can_delete) : 0,
        can_manage: p ? Number(p.can_manage) : 0,
      };
    });

    // Count assigned users
    const [userCount] = await pool.query('SELECT COUNT(*) AS total FROM saas_admin_users WHERE role_id = ?', [id]);
    role.assigned_users_count = userCount[0]?.total || 0;

    return role;
  }

  /**
   * Create a new SaaS role with permissions
   */
  static async createRole({ role_name, description = '', permissions = [] }) {
    const trimmedName = String(role_name).trim();

    // Check unique role name
    const [existing] = await pool.query('SELECT id FROM saas_roles WHERE LOWER(role_name) = LOWER(?) LIMIT 1', [trimmedName]);
    if (existing.length > 0) {
      const err = new Error(`A role with name '${trimmedName}' already exists.`);
      err.statusCode = 400;
      throw err;
    }

    const [res] = await pool.query(
      'INSERT INTO saas_roles (role_name, description, is_system, status) VALUES (?, ?, 0, 1)',
      [trimmedName, description ? String(description).trim() : null]
    );

    const roleId = res.insertId;

    // Insert permissions
    if (Array.isArray(permissions) && permissions.length > 0) {
      for (const p of permissions) {
        if (!p.module_key) continue;
        await pool.query(`
          INSERT INTO saas_role_permissions 
            (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            can_view = VALUES(can_view),
            can_add = VALUES(can_add),
            can_edit = VALUES(can_edit),
            can_delete = VALUES(can_delete),
            can_manage = VALUES(can_manage)
        `, [
          roleId,
          p.module_key,
          p.can_view ? 1 : 0,
          p.can_add ? 1 : 0,
          p.can_edit ? 1 : 0,
          p.can_delete ? 1 : 0,
          p.can_manage ? 1 : 0,
        ]);
      }
    }

    return await SaasRoleModel.getRoleById(roleId);
  }

  /**
   * Update role details and permissions
   */
  static async updateRole(id, { role_name, description, status, permissions }) {
    const role = await SaasRoleModel.getRoleById(id);
    if (!role) return null;

    const updates = [];
    const params = [];

    if (role_name !== undefined && String(role_name).trim()) {
      const trimmedName = String(role_name).trim();
      // If system role, cannot change name
      if (role.is_system && trimmedName !== role.role_name) {
        const err = new Error('System role names cannot be renamed.');
        err.statusCode = 400;
        throw err;
      }

      // Check unique
      const [existing] = await pool.query(
        'SELECT id FROM saas_roles WHERE LOWER(role_name) = LOWER(?) AND id != ? LIMIT 1',
        [trimmedName, id]
      );
      if (existing.length > 0) {
        const err = new Error(`A role with name '${trimmedName}' already exists.`);
        err.statusCode = 400;
        throw err;
      }

      updates.push('role_name = ?');
      params.push(trimmedName);
    }

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? String(description).trim() : null);
    }

    if (status !== undefined) {
      if (role.is_system && Number(status) !== 1) {
        const err = new Error('System roles cannot be deactivated.');
        err.statusCode = 400;
        throw err;
      }
      updates.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (updates.length > 0) {
      params.push(id);
      await pool.query(`UPDATE saas_roles SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    }

    // Update permissions if provided
    if (Array.isArray(permissions)) {
      for (const p of permissions) {
        if (!p.module_key) continue;
        await pool.query(`
          INSERT INTO saas_role_permissions 
            (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            can_view = VALUES(can_view),
            can_add = VALUES(can_add),
            can_edit = VALUES(can_edit),
            can_delete = VALUES(can_delete),
            can_manage = VALUES(can_manage)
        `, [
          id,
          p.module_key,
          p.can_view ? 1 : 0,
          p.can_add ? 1 : 0,
          p.can_edit ? 1 : 0,
          p.can_delete ? 1 : 0,
          p.can_manage ? 1 : 0,
        ]);
      }
    }

    return await SaasRoleModel.getRoleById(id);
  }

  /**
   * Delete a role (cannot delete system roles or roles in use)
   */
  static async deleteRole(id) {
    const role = await SaasRoleModel.getRoleById(id);
    if (!role) return { notFound: true };

    if (role.is_system) {
      const err = new Error('System roles cannot be deleted.');
      err.statusCode = 400;
      throw err;
    }

    // Check if any admin user has this role
    const [assigned] = await pool.query('SELECT COUNT(*) AS total FROM saas_admin_users WHERE role_id = ?', [id]);
    if (assigned[0]?.total > 0) {
      const err = new Error(`Cannot delete role '${role.role_name}' because it is assigned to ${assigned[0].total} admin user(s). Reassign them first.`);
      err.statusCode = 400;
      throw err;
    }

    // Foreign key deletes from saas_role_permissions CASCADE
    const [res] = await pool.query('DELETE FROM saas_roles WHERE id = ?', [id]);
    return { success: res.affectedRows > 0 };
  }

  /**
   * Check if role has specific permission on module
   */
  static async checkPermission(roleId, moduleKey, action = 'can_view') {
    if (!roleId || !moduleKey) return false;

    // Check if role is active
    const [roleRows] = await pool.query('SELECT is_system, status FROM saas_roles WHERE id = ? LIMIT 1', [roleId]);
    if (roleRows.length === 0 || roleRows[0].status !== 1) return false;

    // System role has all permissions
    if (roleRows[0].is_system === 1) return true;

    // Valid actions
    const allowedActions = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_manage'];
    const col = allowedActions.includes(action) ? action : 'can_view';

    const [permRows] = await pool.query(
      `SELECT ${col} FROM saas_role_permissions WHERE role_id = ? AND module_key = ? LIMIT 1`,
      [roleId, moduleKey]
    );

    if (permRows.length === 0) return false;
    return Boolean(permRows[0][col] === 1);
  }

  // ========================================================
  // 3. SUB ADMIN USERS MANAGEMENT
  // ========================================================
  /**
   * List paginated sub-admin users
   */
  static async getAllSubAdmins({ search = '', status = '', role_id = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    let conditions = ["sau.role = 'subadmin'"];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('sau.status = ?');
      params.push(parseInt(status, 10));
    }

    if (role_id && role_id !== 'all') {
      conditions.push('sau.role_id = ?');
      params.push(parseInt(role_id, 10));
    }

    if (search && search.trim()) {
      conditions.push('(sau.first_name LIKE ? OR sau.last_name LIKE ? OR sau.email LIKE ? OR sau.phone_number LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countQuery = `SELECT COUNT(*) AS total FROM saas_admin_users sau ${where}`;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const selectQuery = `
      SELECT 
        sau.id,
        sau.first_name,
        sau.last_name,
        sau.gender,
        sau.gender AS gender_id,
        gm.gender AS gender_name,
        sau.profile_image,
        sau.phone_number,
        sau.email,
        sau.role,
        sau.role_id,
        sr.role_name,
        sau.status,
        sau.created_at,
        sau.updated_at
      FROM saas_admin_users sau
      LEFT JOIN gender_master gm ON sau.gender = gm.id
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id
      ${where}
      ORDER BY sau.id DESC
      LIMIT ? OFFSET ?
    `;

    const [subAdmins] = await pool.query(selectQuery, [...params, limitNum, offset]);
    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      sub_admins: subAdmins,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    };
  }

  /**
   * Get single sub-admin by ID with full role permissions
   */
  static async getSubAdminById(id) {
    const [rows] = await pool.query(`
      SELECT 
        sau.id,
        sau.first_name,
        sau.last_name,
        sau.gender,
        sau.gender AS gender_id,
        gm.gender AS gender_name,
        sau.profile_image,
        sau.phone_number,
        sau.email,
        sau.role,
        sau.role_id,
        sr.role_name,
        sr.description AS role_description,
        sau.status,
        sau.created_at,
        sau.updated_at
      FROM saas_admin_users sau
      LEFT JOIN gender_master gm ON sau.gender = gm.id
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id
      WHERE sau.id = ? AND sau.role = 'subadmin'
      LIMIT 1
    `, [id]);

    if (rows.length === 0) return null;
    const subAdmin = rows[0];

    // Fetch assigned permissions
    if (subAdmin.role_id) {
      const [perms] = await pool.query(`
        SELECT 
          srp.module_key, 
          sm.module_name,
          srp.can_view, 
          srp.can_add, 
          srp.can_edit, 
          srp.can_delete, 
          srp.can_manage
        FROM saas_role_permissions srp
        JOIN saas_modules sm ON srp.module_key = sm.module_key
        WHERE srp.role_id = ?
        ORDER BY sm.display_order ASC
      `, [subAdmin.role_id]);
      subAdmin.permissions = perms;
    } else {
      subAdmin.permissions = [];
    }

    return subAdmin;
  }

  /**
   * Create a new Sub Admin user
   */
  static async createSubAdmin({
    first_name,
    last_name = '',
    email,
    password,
    gender = null,
    phone_number = null,
    profile_image = null,
    role_id,
    status = 1,
  }) {
    if (!first_name || !email || !password || !role_id) {
      const err = new Error('First name, email, password, and role_id are required.');
      err.statusCode = 400;
      throw err;
    }

    // Check role exists
    const [roleRows] = await pool.query('SELECT id, role_name, is_system FROM saas_roles WHERE id = ? AND status = 1 LIMIT 1', [role_id]);
    if (roleRows.length === 0) {
      const err = new Error(`Role ID ${role_id} does not exist or is inactive.`);
      err.statusCode = 400;
      throw err;
    }

    // Check unique email
    const [existing] = await pool.query('SELECT id FROM saas_admin_users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email.trim()]);
    if (existing.length > 0) {
      const err = new Error(`An admin user with email '${email.trim()}' already exists.`);
      err.statusCode = 400;
      throw err;
    }

    // Validate gender ID against gender_master if provided
    let resolvedGenderId = null;
    if (gender !== null && gender !== undefined && String(gender).trim() !== '') {
      const str = String(gender).trim();
      if (/^\d+$/.test(str)) {
        const [gm] = await pool.query('SELECT id FROM gender_master WHERE id = ? LIMIT 1', [Number(str)]);
        if (gm.length === 0) {
          const err = new Error(`Invalid gender ID '${gender}'. Must be an existing ID in gender_master.`);
          err.statusCode = 400;
          throw err;
        }
        resolvedGenderId = gm[0].id;
      } else {
        const [gm] = await pool.query(
          'SELECT id FROM gender_master WHERE LOWER(gender) = LOWER(?) OR (LOWER(?) = "other" AND LOWER(gender) = "others") LIMIT 1',
          [str, str]
        );
        if (gm.length === 0) {
          const err = new Error(`Invalid gender '${gender}'. Must match a valid entry in gender_master.`);
          err.statusCode = 400;
          throw err;
        }
        resolvedGenderId = gm[0].id;
      }
    }

    // Handle profile image if base64
    let imagePath = profile_image;
    if (imagePath && imagePath.startsWith('data:')) {
      const { saveBase64File } = require('../utils/file.util');
      imagePath = saveBase64File(imagePath, 'admin/profile_pic', 'SubAdmin');
    }

    const hashedPassword = await hashPassword(password);

    const [res] = await pool.query(`
      INSERT INTO saas_admin_users 
        (first_name, last_name, email, password, gender, phone_number, profile_image, role, role_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'subadmin', ?, ?)
    `, [
      String(first_name).trim(),
      last_name ? String(last_name).trim() : null,
      String(email).toLowerCase().trim(),
      hashedPassword,
      resolvedGenderId,
      phone_number ? String(phone_number).trim() : null,
      imagePath || null,
      Number(role_id),
      status !== undefined ? parseInt(status, 10) : 1,
    ]);

    return await SaasRoleModel.getSubAdminById(res.insertId);
  }

  /**
   * Update sub-admin user details
   */
  static async updateSubAdmin(id, {
    first_name,
    last_name,
    email,
    password,
    gender,
    gender_id,
    phone_number,
    profile_image,
    role_id,
    status,
  }) {
    // Check if subadmin exists
    const [existing] = await pool.query('SELECT * FROM saas_admin_users WHERE id = ? AND role = "subadmin" LIMIT 1', [id]);
    if (existing.length === 0) {
      return null;
    }

    const updates = [];
    const params = [];

    if (first_name !== undefined) {
      if (!first_name || !String(first_name).trim()) {
        const err = new Error('First name cannot be empty.');
        err.statusCode = 400;
        throw err;
      }
      updates.push('first_name = ?');
      params.push(String(first_name).trim());
    }

    if (last_name !== undefined) {
      updates.push('last_name = ?');
      params.push(last_name ? String(last_name).trim() : null);
    }

    if (email !== undefined && String(email).trim()) {
      const cleanEmail = String(email).toLowerCase().trim();
      if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
        const err = new Error('Please provide a valid email address.');
        err.statusCode = 400;
        throw err;
      }
      // Check unique
      const [emailCheck] = await pool.query(
        'SELECT id FROM saas_admin_users WHERE LOWER(email) = ? AND id != ? LIMIT 1',
        [cleanEmail, id]
      );
      if (emailCheck.length > 0) {
        const err = new Error(`Email '${cleanEmail}' is already in use by another admin user.`);
        err.statusCode = 400;
        throw err;
      }
      updates.push('email = ?');
      params.push(cleanEmail);
    }

    if (password && password.length >= 6) {
      const hashed = await hashPassword(password);
      updates.push('password = ?');
      params.push(hashed);
    }

    // Gender field stores gender ID from gender_master
    const genderInput = gender_id !== undefined ? gender_id : gender;
    if (genderInput !== undefined) {
      let resolvedGenderId = null;
      if (genderInput !== null && String(genderInput).trim() !== '') {
        const str = String(genderInput).trim();
        if (/^\d+$/.test(str)) {
          const [gm] = await pool.query('SELECT id FROM gender_master WHERE id = ? LIMIT 1', [Number(str)]);
          if (gm.length === 0) {
            const err = new Error(`Invalid gender ID '${genderInput}'. Must be an existing ID in gender_master.`);
            err.statusCode = 400;
            throw err;
          }
          resolvedGenderId = gm[0].id;
        } else {
          const [gm] = await pool.query(
            'SELECT id FROM gender_master WHERE LOWER(gender) = LOWER(?) OR (LOWER(?) = "other" AND LOWER(gender) = "others") LIMIT 1',
            [str, str]
          );
          if (gm.length === 0) {
            const err = new Error(`Invalid gender '${genderInput}'. Must match a valid entry in gender_master.`);
            err.statusCode = 400;
            throw err;
          }
          resolvedGenderId = gm[0].id;
        }
      }
      updates.push('gender = ?');
      params.push(resolvedGenderId);
    }

    if (phone_number !== undefined) {
      updates.push('phone_number = ?');
      params.push(phone_number ? String(phone_number).trim() : null);
    }

    if (profile_image !== undefined) {
      let imagePath = profile_image;
      if (imagePath && imagePath.startsWith('data:')) {
        const { saveBase64File } = require('../utils/file.util');
        imagePath = saveBase64File(imagePath, 'admin/profile_pic', 'SubAdmin');
      }
      updates.push('profile_image = ?');
      params.push(imagePath || null);
    }

    if (role_id !== undefined) {
      const [roleCheck] = await pool.query('SELECT id FROM saas_roles WHERE id = ? AND status = 1 LIMIT 1', [role_id]);
      if (roleCheck.length === 0) {
        const err = new Error(`Role ID ${role_id} does not exist or is inactive.`);
        err.statusCode = 400;
        throw err;
      }
      updates.push('role_id = ?');
      params.push(Number(role_id));
    }

    if (status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (updates.length > 0) {
      params.push(id);
      await pool.query(`UPDATE saas_admin_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    }

    return await SaasRoleModel.getSubAdminById(id);
  }

  /**
   * Delete sub-admin user
   */
  static async deleteSubAdmin(id) {
    const [existing] = await pool.query('SELECT id, role FROM saas_admin_users WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) return { notFound: true };

    if (existing[0].role !== 'subadmin') {
      const err = new Error('Super Admin users cannot be deleted.');
      err.statusCode = 400;
      throw err;
    }

    const [res] = await pool.query('DELETE FROM saas_admin_users WHERE id = ?', [id]);
    return { success: res.affectedRows > 0 };
  }

  /**
   * Toggle sub-admin active/inactive status
   */
  static async toggleSubAdminStatus(id, status) {
    const [existing] = await pool.query('SELECT id, role FROM saas_admin_users WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) return null;

    if (existing[0].role !== 'subadmin') {
      const err = new Error('Cannot change status of Super Admin account.');
      err.statusCode = 400;
      throw err;
    }

    const [res] = await pool.query(
      'UPDATE saas_admin_users SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return res.affectedRows > 0;
  }
}

module.exports = SaasRoleModel;
