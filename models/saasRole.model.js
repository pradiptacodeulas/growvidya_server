const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');

class SaasRoleModel {
  /**
   * Generate URL-safe slug from role name
   */
  static slugify(text = '') {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // ========================================================
  // 1. MODULES & EFFECTIVE PERMISSION RESOLUTION
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

  /**
   * Resolve effective module permissions for a given SaaS admin/sub-admin user
   */
  static async resolveEffectivePermissions(user) {
    if (!user) return [];

    const modules = await SaasRoleModel.getModules();
    if (modules.length === 0) return [];

    // 1. Super Admin user always has full permissions on all active modules
    if (user.role === 'superadmin') {
      return modules.map(m => ({
        module_key: m.module_key,
        module_name: m.module_name,
        can_view: 1,
        can_add: 1,
        can_edit: 1,
        can_delete: 1,
        can_manage: 1,
      }));
    }

    // 2. Sub-Admin user must have an active assigned role
    if (!user.role_id) {
      return [];
    }

    const [roleRows] = await pool.query(
      'SELECT id, role_name, is_system, status FROM saas_roles WHERE id = ? LIMIT 1',
      [user.role_id]
    );

    // If role was deleted or deactivated, user receives zero permissions immediately
    if (roleRows.length === 0 || Number(roleRows[0].status) !== 1) {
      return [];
    }

    const role = roleRows[0];

    // If assigned role is a system role, grant full permissions
    if (Number(role.is_system) === 1) {
      return modules.map(m => ({
        module_key: m.module_key,
        module_name: m.module_name,
        can_view: 1,
        can_add: 1,
        can_edit: 1,
        can_delete: 1,
        can_manage: 1,
      }));
    }

    // Fetch role permissions from saas_role_permissions
    const [permRows] = await pool.query(
      'SELECT module_key, can_view, can_add, can_edit, can_delete, can_manage FROM saas_role_permissions WHERE role_id = ?',
      [user.role_id]
    );
    const permMap = {};
    for (const p of permRows) {
      permMap[p.module_key] = p;
    }

    return modules.map(m => {
      const p = permMap[m.module_key];
      const canAdd = p && Number(p.can_add) === 1 ? 1 : 0;
      const canEdit = p && Number(p.can_edit) === 1 ? 1 : 0;
      const canDelete = p && Number(p.can_delete) === 1 ? 1 : 0;
      const canManage = p && Number(p.can_manage) === 1 ? 1 : 0;
      const canView = (p && Number(p.can_view) === 1) || canAdd || canEdit || canDelete || canManage ? 1 : 0;
      return {
        module_key: m.module_key,
        module_name: m.module_name,
        can_view: canView,
        can_add: canAdd,
        can_edit: canEdit,
        can_delete: canDelete,
        can_manage: canManage,
      };
    });
  }

  // ========================================================
  // 2. ROLES MANAGEMENT
  // ========================================================
  /**
   * List all SaaS roles with assigned user count
   */
  static async getAllRoles({ search = '', status = '' } = {}) {
    let conditions = ['r.status IN (1, 2)'];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('r.status = ?');
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      conditions.push('(r.role_name LIKE ? OR r.slug LIKE ? OR r.description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        r.id,
        r.role_name,
        r.slug,
        r.description,
        r.is_system,
        r.status,
        r.created_at,
        r.updated_at,
        (SELECT COUNT(*) FROM saas_admin_users sau WHERE sau.role_id = r.id AND sau.status IN (1, 2)) AS assigned_users_count,
        CASE
          WHEN r.is_system = 1 THEN (SELECT COUNT(*) FROM saas_modules sm WHERE sm.status = 1)
          ELSE (
            SELECT COUNT(*) 
            FROM saas_role_permissions srp
            JOIN saas_modules sm ON srp.module_key = sm.module_key AND sm.status = 1
            WHERE srp.role_id = r.id AND (srp.can_view = 1 OR srp.can_add = 1 OR srp.can_edit = 1 OR srp.can_delete = 1 OR srp.can_manage = 1)
          )
        END AS active_modules_count
      FROM saas_roles r
      ${where}
      ORDER BY r.is_system DESC, r.id ASC
    `;

    const [roles] = await pool.query(query, params);
    return roles.map(r => ({
      ...r,
      slug: r.slug || SaasRoleModel.slugify(r.role_name),
      assigned_users_count: Number(r.assigned_users_count || 0),
      active_modules_count: Number(r.active_modules_count || 0),
    }));
  }

  /**
   * Get role by ID with all module permissions
   */
  static async getRoleById(id) {
    const [roles] = await pool.query('SELECT * FROM saas_roles WHERE id = ? AND status IN (1, 2) LIMIT 1', [id]);
    if (roles.length === 0) return null;

    const role = roles[0];
    role.slug = role.slug || SaasRoleModel.slugify(role.role_name);

    // Fetch all active modules
    const modules = await SaasRoleModel.getModules();

    // Fetch existing permissions for this role
    const [perms] = await pool.query('SELECT * FROM saas_role_permissions WHERE role_id = ?', [id]);
    const permMap = {};
    perms.forEach(p => {
      permMap[p.module_key] = p;
    });

    const isSystem = Number(role.is_system) === 1;

    // Merge modules with permissions so each module has an entry
    role.permissions = modules.map(m => {
      if (isSystem) {
        return {
          module_key: m.module_key,
          module_name: m.module_name,
          description: m.description,
          can_view: 1,
          can_add: 1,
          can_edit: 1,
          can_delete: 1,
          can_manage: 1,
        };
      }
      const p = permMap[m.module_key];
      const canAdd = p && Number(p.can_add) === 1 ? 1 : 0;
      const canEdit = p && Number(p.can_edit) === 1 ? 1 : 0;
      const canDelete = p && Number(p.can_delete) === 1 ? 1 : 0;
      const canManage = p && Number(p.can_manage) === 1 ? 1 : 0;
      const canView = (p && Number(p.can_view) === 1) || canAdd || canEdit || canDelete || canManage ? 1 : 0;
      return {
        module_key: m.module_key,
        module_name: m.module_name,
        description: m.description,
        can_view: canView,
        can_add: canAdd,
        can_edit: canEdit,
        can_delete: canDelete,
        can_manage: canManage,
      };
    });

    // Count assigned users
    const [userCount] = await pool.query(
      'SELECT COUNT(*) AS total FROM saas_admin_users WHERE role_id = ? AND status IN (1, 2)',
      [id]
    );
    role.assigned_users_count = Number(userCount[0]?.total || 0);
    role.active_modules_count = role.permissions.filter(
      p => p.can_view === 1 || p.can_add === 1 || p.can_edit === 1 || p.can_delete === 1 || p.can_manage === 1
    ).length;

    return role;
  }

  /**
   * Create a new SaaS role with permissions inside a database transaction
   */
  static async createRole({ role_name, slug, description = '', status = 1, permissions = [] }) {
    const trimmedName = String(role_name || '').trim();
    if (!trimmedName) {
      const err = new Error('Role name is required.');
      err.statusCode = 400;
      throw err;
    }

    const roleSlug = slug && String(slug).trim()
      ? SaasRoleModel.slugify(slug)
      : SaasRoleModel.slugify(trimmedName);

    if (!roleSlug) {
      const err = new Error('Role name must contain valid alphanumeric characters.');
      err.statusCode = 400;
      throw err;
    }

    // Check unique role name or slug
    const [existing] = await pool.query(
      'SELECT id, role_name, slug FROM saas_roles WHERE (LOWER(role_name) = LOWER(?) OR (slug IS NOT NULL AND LOWER(slug) = LOWER(?))) AND status != 4 LIMIT 1',
      [trimmedName, roleSlug]
    );
    if (existing.length > 0) {
      const err = new Error(`A role with name '${trimmedName}' or slug '${roleSlug}' already exists.`);
      err.statusCode = 400;
      throw err;
    }

    const modules = await SaasRoleModel.getModules();
    const validModuleKeys = new Set(modules.map(m => m.module_key));

    // Validate supplied permissions if any
    if (Array.isArray(permissions)) {
      for (const p of permissions) {
        if (p && p.module_key && !validModuleKeys.has(p.module_key)) {
          const err = new Error(`Invalid module_key '${p.module_key}'.`);
          err.statusCode = 400;
          throw err;
        }
      }
    }

    const permInputMap = {};
    if (Array.isArray(permissions)) {
      for (const p of permissions) {
        if (p && p.module_key && validModuleKeys.has(p.module_key)) {
          permInputMap[p.module_key] = p;
        }
      }
    }

    const roleStatus = status !== undefined && Number(status) === 2 ? 2 : 1;
    const connection = await pool.getConnection();
    let roleId;

    try {
      await connection.beginTransaction();

      const [res] = await connection.query(
        'INSERT INTO saas_roles (role_name, slug, description, is_system, status) VALUES (?, ?, ?, 0, ?)',
        [trimmedName, roleSlug, description ? String(description).trim() : null, roleStatus]
      );
      roleId = res.insertId;

      for (const m of modules) {
        const p = permInputMap[m.module_key] || {};
        const canAdd = p.can_add ? 1 : 0;
        const canEdit = p.can_edit ? 1 : 0;
        const canDelete = p.can_delete ? 1 : 0;
        const canManage = p.can_manage ? 1 : 0;
        const canView = p.can_view || canAdd || canEdit || canDelete || canManage ? 1 : 0;

        await connection.query(`
          INSERT INTO saas_role_permissions 
            (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            can_view = VALUES(can_view),
            can_add = VALUES(can_add),
            can_edit = VALUES(can_edit),
            can_delete = VALUES(can_delete),
            can_manage = VALUES(can_manage)
        `, [roleId, m.module_key, canView, canAdd, canEdit, canDelete, canManage]);
      }

      await connection.commit();
    } catch (txError) {
      await connection.rollback();
      throw txError;
    } finally {
      connection.release();
    }

    return await SaasRoleModel.getRoleById(roleId);
  }

  /**
   * Update role details and permissions inside a database transaction
   */
  static async updateRole(id, { role_name, slug, description, status, permissions }) {
    const role = await SaasRoleModel.getRoleById(id);
    if (!role) return null;

    const isSystem = Number(role.is_system) === 1;
    const updates = [];
    const params = [];

    if (role_name !== undefined && String(role_name).trim()) {
      const trimmedName = String(role_name).trim();
      if (isSystem && trimmedName.toLowerCase() !== role.role_name.toLowerCase()) {
        const err = new Error('Protected system role names cannot be renamed.');
        err.statusCode = 400;
        throw err;
      }

      const [existing] = await pool.query(
        'SELECT id FROM saas_roles WHERE LOWER(role_name) = LOWER(?) AND id != ? AND status != 4 LIMIT 1',
        [trimmedName, id]
      );
      if (existing.length > 0) {
        const err = new Error(`A role with name '${trimmedName}' already exists.`);
        err.statusCode = 400;
        throw err;
      }

      updates.push('role_name = ?');
      params.push(trimmedName);

      if (!isSystem) {
        const nextSlug = slug && String(slug).trim()
          ? SaasRoleModel.slugify(slug)
          : SaasRoleModel.slugify(trimmedName);
        if (nextSlug) {
          const [slugCheck] = await pool.query(
            'SELECT id FROM saas_roles WHERE LOWER(slug) = LOWER(?) AND id != ? AND status != 4 LIMIT 1',
            [nextSlug, id]
          );
          if (slugCheck.length > 0) {
            const err = new Error(`A role with slug '${nextSlug}' already exists.`);
            err.statusCode = 400;
            throw err;
          }
          updates.push('slug = ?');
          params.push(nextSlug);
        }
      }
    } else if (slug !== undefined && String(slug).trim() && !isSystem) {
      const nextSlug = SaasRoleModel.slugify(slug);
      const [slugCheck] = await pool.query(
        'SELECT id FROM saas_roles WHERE LOWER(slug) = LOWER(?) AND id != ? AND status != 4 LIMIT 1',
        [nextSlug, id]
      );
      if (slugCheck.length > 0) {
        const err = new Error(`A role with slug '${nextSlug}' already exists.`);
        err.statusCode = 400;
        throw err;
      }
      updates.push('slug = ?');
      params.push(nextSlug);
    }

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? String(description).trim() : null);
    }

    if (status !== undefined) {
      if (isSystem && Number(status) !== 1) {
        const err = new Error('System roles cannot be deactivated.');
        err.statusCode = 400;
        throw err;
      }
      updates.push('status = ?');
      params.push(Number(status) === 2 ? 2 : 1);
    }

    const modules = await SaasRoleModel.getModules();
    const validModuleKeys = new Set(modules.map(m => m.module_key));

    if (Array.isArray(permissions)) {
      for (const p of permissions) {
        if (p && p.module_key && !validModuleKeys.has(p.module_key)) {
          const err = new Error(`Invalid module_key '${p.module_key}'.`);
          err.statusCode = 400;
          throw err;
        }
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      if (updates.length > 0) {
        params.push(id);
        await connection.query(
          `UPDATE saas_roles SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND status != 4`,
          params
        );
      }

      if (Array.isArray(permissions) && !isSystem) {
        const permInputMap = {};
        for (const p of permissions) {
          if (p && p.module_key && validModuleKeys.has(p.module_key)) {
            permInputMap[p.module_key] = p;
          }
        }

        for (const m of modules) {
          const p = permInputMap[m.module_key];
          if (!p) continue;
          const canAdd = p.can_add ? 1 : 0;
          const canEdit = p.can_edit ? 1 : 0;
          const canDelete = p.can_delete ? 1 : 0;
          const canManage = p.can_manage ? 1 : 0;
          const canView = p.can_view || canAdd || canEdit || canDelete || canManage ? 1 : 0;

          await connection.query(`
            INSERT INTO saas_role_permissions 
              (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              can_view = VALUES(can_view),
              can_add = VALUES(can_add),
              can_edit = VALUES(can_edit),
              can_delete = VALUES(can_delete),
              can_manage = VALUES(can_manage)
          `, [id, m.module_key, canView, canAdd, canEdit, canDelete, canManage]);
        }
      }

      await connection.commit();
    } catch (txError) {
      await connection.rollback();
      throw txError;
    } finally {
      connection.release();
    }

    return await SaasRoleModel.getRoleById(id);
  }

  /**
   * Toggle role active/inactive status (1 = Active, 2 = Inactive)
   */
  static async toggleRoleStatus(id, status) {
    const role = await SaasRoleModel.getRoleById(id);
    if (!role) return null;

    if (Number(role.is_system) === 1 && Number(status) !== 1) {
      const err = new Error('Protected system roles cannot be deactivated.');
      err.statusCode = 400;
      throw err;
    }

    const nextStatus = Number(status) === 1 ? 1 : 2;
    await pool.query(
      'UPDATE saas_roles SET status = ?, updated_at = NOW() WHERE id = ? AND status != 4',
      [nextStatus, id]
    );

    return await SaasRoleModel.getRoleById(id);
  }

  /**
   * Soft delete a role (status = 4; cannot delete system roles or roles in use)
   */
  static async deleteRole(id) {
    const role = await SaasRoleModel.getRoleById(id);
    if (!role) return { notFound: true };

    if (Number(role.is_system) === 1) {
      const err = new Error('Protected system roles cannot be deleted.');
      err.statusCode = 400;
      throw err;
    }

    // Check if any admin user has this role
    const [assigned] = await pool.query(
      'SELECT COUNT(*) AS total FROM saas_admin_users WHERE role_id = ? AND status IN (1, 2)',
      [id]
    );
    if (assigned[0]?.total > 0) {
      const err = new Error(`Cannot delete role '${role.role_name}' because it is assigned to ${assigned[0].total} admin user(s). Reassign them first.`);
      err.statusCode = 400;
      throw err;
    }

    const [res] = await pool.query(
      'UPDATE saas_roles SET status = 4, updated_at = NOW() WHERE id = ? AND status != 4',
      [id]
    );
    return { success: res.affectedRows > 0 };
  }

  /**
   * Normalize an RBAC action to the database permission column
   */
  static normalizeAction(action) {
    switch (action) {
      case 'can_view':
      case 'view':
        return 'can_view';
      case 'can_add':
      case 'create':
      case 'add':
        return 'can_add';
      case 'can_edit':
      case 'edit':
      case 'update':
        return 'can_edit';
      case 'can_delete':
      case 'delete':
        return 'can_delete';
      case 'can_manage':
      case 'manage':
      case 'approve':
        return 'can_manage';
      default:
        return 'can_view';
    }
  }

  /**
   * Check if role has specific permission on module(s)
   * @param {number} roleId
   * @param {string|string[]} moduleKey - Single module key, array of module keys, or dot notation ('payment_gateway.view')
   * @param {string|string[]} action - Action permission ('can_view', 'can_edit', 'update', etc.)
   */
  static async checkPermission(roleId, moduleKey, action = 'can_view') {
    if (!roleId || !moduleKey) return false;

    // Check if role exists and is active
    const [roleRows] = await pool.query('SELECT is_system, status FROM saas_roles WHERE id = ? LIMIT 1', [roleId]);
    if (roleRows.length === 0 || Number(roleRows[0].status) !== 1) return false;

    // System role has all permissions
    if (Number(roleRows[0].is_system) === 1) return true;

    // Support dot-notation if passed e.g. 'payment_gateway.view' or 'payment_gateway.update'
    if (typeof moduleKey === 'string' && moduleKey.includes('.')) {
      const [modPart, actPart] = moduleKey.split('.');
      return SaasRoleModel.checkPermission(roleId, modPart, actPart);
    }

    const rawKeys = (Array.isArray(moduleKey) ? moduleKey : [moduleKey]).filter(Boolean);
    if (rawKeys.length === 0) return false;

    // Expand module keys for aliases (e.g. email_delivery <-> email_settings)
    const moduleKeysSet = new Set(rawKeys);
    for (const k of rawKeys) {
      if (k === 'email_delivery') moduleKeysSet.add('email_settings');
      if (k === 'email_settings') moduleKeysSet.add('email_delivery');
    }
    const moduleKeys = Array.from(moduleKeysSet);

    const rawActions = Array.isArray(action) ? action : [action];
    const normalizedActions = Array.from(new Set(rawActions.map(a => SaasRoleModel.normalizeAction(a))));

    const placeholders = moduleKeys.map(() => '?').join(', ');
    const [permRows] = await pool.query(
      `SELECT srp.module_key, srp.can_view, srp.can_add, srp.can_edit, srp.can_delete, srp.can_manage
       FROM saas_role_permissions srp
       JOIN saas_modules sm ON srp.module_key = sm.module_key
       WHERE srp.role_id = ? AND srp.module_key IN (${placeholders})`,
      [roleId, ...moduleKeys]
    );

    if (permRows.length === 0) return false;

    for (const row of permRows) {
      for (const act of normalizedActions) {
        if (act === 'can_view') {
          if (
            Number(row.can_view) === 1 ||
            Number(row.can_add) === 1 ||
            Number(row.can_edit) === 1 ||
            Number(row.can_delete) === 1 ||
            Number(row.can_manage) === 1
          ) {
            return true;
          }
        } else if (act === 'can_edit') {
          // Update / edit permission: user must have can_edit = 1 or can_manage = 1 or can_add = 1
          if (Number(row.can_edit) === 1 || Number(row.can_manage) === 1 || Number(row.can_add) === 1) {
            return true;
          }
        } else if (Number(row[act]) === 1) {
          return true;
        }
      }
    }

    return false;
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

    let conditions = ["sau.role = 'subadmin'", 'sau.status IN (1, 2)'];
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
      conditions.push('(sau.first_name LIKE ? OR sau.last_name LIKE ? OR sau.email LIKE ? OR sau.phone_number LIKE ? OR sr.role_name LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM saas_admin_users sau
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id AND sr.status IN (1, 2)
      ${where}
    `;
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
        sr.status AS role_status,
        sau.status,
        sau.created_at,
        sau.updated_at
      FROM saas_admin_users sau
      LEFT JOIN gender_master gm ON sau.gender = gm.id
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id AND sr.status IN (1, 2)
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
   * Get single sub-admin by ID with full effective role permissions
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
        sr.status AS role_status,
        sau.status,
        sau.created_at,
        sau.updated_at
      FROM saas_admin_users sau
      LEFT JOIN gender_master gm ON sau.gender = gm.id
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id AND sr.status IN (1, 2)
      WHERE sau.id = ? AND sau.role = 'subadmin' AND sau.status IN (1, 2)
      LIMIT 1
    `, [id]);

    if (rows.length === 0) return null;
    const subAdmin = rows[0];
    subAdmin.permissions = await SaasRoleModel.resolveEffectivePermissions(subAdmin);
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
    actor = null,
  }) {
    if (!first_name || !email || !password || !role_id) {
      const err = new Error('First name, email, password, and role_id are required.');
      err.statusCode = 400;
      throw err;
    }

    // Check role exists and is active
    const [roleRows] = await pool.query('SELECT id, role_name, is_system, status FROM saas_roles WHERE id = ? LIMIT 1', [role_id]);
    if (roleRows.length === 0 || Number(roleRows[0].status) !== 1) {
      const err = new Error(`Role ID ${role_id} does not exist or is inactive.`);
      err.statusCode = 400;
      throw err;
    }

    // Prevent non-superadmin from assigning protected Super Admin system role
    if (Number(roleRows[0].is_system) === 1 && actor && actor.role !== 'superadmin') {
      const err = new Error('Only a Super Admin can assign a protected system role.');
      err.statusCode = 403;
      throw err;
    }

    // Check unique email
    const [existing] = await pool.query(
      'SELECT id FROM saas_admin_users WHERE LOWER(email) = LOWER(?) AND status != 4 LIMIT 1',
      [email.trim()]
    );
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
      imagePath = await saveBase64File(imagePath, 'admin/profile_pic', 'SubAdmin', {
        skipQuotaCheck: true,
      });
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
      status !== undefined ? (parseInt(status, 10) === 2 ? 2 : 1) : 1,
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
    actor = null,
  }) {
    // Check if subadmin exists
    const [existing] = await pool.query(
      'SELECT * FROM saas_admin_users WHERE id = ? AND role = "subadmin" AND status IN (1, 2) LIMIT 1',
      [id]
    );
    if (existing.length === 0) {
      return null;
    }

    const targetUser = existing[0];

    // Prevent a sub-admin from escalating their own role or changing their own account status via sub-admin management
    if (actor && Number(actor.id) === Number(id) && actor.role !== 'superadmin') {
      if (role_id !== undefined && Number(role_id) !== Number(targetUser.role_id)) {
        const err = new Error('You cannot change your own assigned role.');
        err.statusCode = 403;
        throw err;
      }
      if (status !== undefined && Number(status) !== Number(targetUser.status)) {
        const err = new Error('You cannot change your own account status.');
        err.statusCode = 403;
        throw err;
      }
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
        'SELECT id FROM saas_admin_users WHERE LOWER(email) = ? AND id != ? AND status != 4 LIMIT 1',
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
        imagePath = await saveBase64File(imagePath, 'admin/profile_pic', 'SubAdmin', {
          skipQuotaCheck: true,
        });
      }
      updates.push('profile_image = ?');
      params.push(imagePath || null);
    }

    if (role_id !== undefined) {
      const [roleCheck] = await pool.query('SELECT id, is_system, status FROM saas_roles WHERE id = ? LIMIT 1', [role_id]);
      if (roleCheck.length === 0 || Number(roleCheck[0].status) !== 1) {
        const err = new Error(`Role ID ${role_id} does not exist or is inactive.`);
        err.statusCode = 400;
        throw err;
      }
      if (Number(roleCheck[0].is_system) === 1 && actor && actor.role !== 'superadmin') {
        const err = new Error('Only a Super Admin can assign a protected system role.');
        err.statusCode = 403;
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
      await pool.query(`UPDATE saas_admin_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND status != 4`, params);
    }

    return await SaasRoleModel.getSubAdminById(id);
  }

  /**
   * Soft delete sub-admin user (status = 4)
   */
  static async deleteSubAdmin(id, actor = null) {
    const [existing] = await pool.query('SELECT id, role FROM saas_admin_users WHERE id = ? AND status != 4 LIMIT 1', [id]);
    if (existing.length === 0) return { notFound: true };

    if (existing[0].role !== 'subadmin') {
      const err = new Error('Super Admin users cannot be deleted.');
      err.statusCode = 400;
      throw err;
    }

    if (actor && Number(actor.id) === Number(id)) {
      const err = new Error('You cannot delete your own account.');
      err.statusCode = 400;
      throw err;
    }

    const [res] = await pool.query(
      'UPDATE saas_admin_users SET status = 4, updated_at = NOW() WHERE id = ? AND status != 4',
      [id]
    );
    return { success: res.affectedRows > 0 };
  }

  /**
   * Toggle sub-admin active/inactive status (1 = Active, 2 = Inactive)
   */
  static async toggleSubAdminStatus(id, status, actor = null) {
    const [existing] = await pool.query('SELECT id, role FROM saas_admin_users WHERE id = ? AND status != 4 LIMIT 1', [id]);
    if (existing.length === 0) return null;

    if (existing[0].role !== 'subadmin') {
      const err = new Error('Cannot change status of Super Admin account.');
      err.statusCode = 400;
      throw err;
    }

    if (actor && Number(actor.id) === Number(id)) {
      const err = new Error('You cannot deactivate your own account.');
      err.statusCode = 400;
      throw err;
    }

    const [res] = await pool.query(
      'UPDATE saas_admin_users SET status = ?, updated_at = NOW() WHERE id = ? AND status != 4',
      [parseInt(status, 10), id]
    );
    return res.affectedRows > 0;
  }
}

module.exports = SaasRoleModel;
