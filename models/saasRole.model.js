const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');

const DEFAULT_SAAS_MODULES = [
  { key: 'dashboard', name: 'Dashboard & Analytics', desc: 'Overview metrics, registration statistics, and revenue insights', order: 1 },
  { key: 'schools', name: 'School Management', desc: 'Registered schools, approvals, and school account status', order: 2 },
  { key: 'subscriptions', name: 'Subscriptions & Payments', desc: 'School subscriptions, manual payment verification, and extensions', order: 3 },
  { key: 'packages', name: 'Packages & Pricing', desc: 'Subscription pricing tiers, package items, features, and plan limits', order: 4 },
  { key: 'attendance_machines', name: 'Attendance Machines', desc: 'Biometric and RFID attendance hardware catalog and pricing', order: 5 },
  { key: 'rfid_cards', name: 'RFID Cards', desc: 'Smart RFID card inventory, pricing, and specifications', order: 6 },
  { key: 'storage_plans', name: 'Storage Plans', desc: 'Cloud storage add-on packages and capacity units', order: 7 },
  { key: 'coupons', name: 'Coupons & Discounts', desc: 'Promo codes, discounts, and redemption limits', order: 8 },
  { key: 'bank_accounts', name: 'Bank Accounts', desc: 'Platform bank accounts and UPI/QR payment details', order: 9 },
  { key: 'roles', name: 'Roles & Permissions', desc: 'Manage SaaS roles and granular module permissions', order: 10 },
  { key: 'sub_admins', name: 'Users & Sub-Admins', desc: 'Manage sub-admin staff accounts and role assignments', order: 11 },
  { key: 'settings', name: 'Settings & Payment Gateway', desc: 'Platform settings and Razorpay payment gateway credentials', order: 12 },
];

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

  /**
   * Initialize and verify RBAC tables, columns, and default SaaS modules
   */
  static async initTable() {
    try {
      // 1. Ensure saas_roles table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS saas_roles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          role_name VARCHAR(100) NOT NULL UNIQUE,
          slug VARCHAR(100) DEFAULT NULL,
          description TEXT DEFAULT NULL,
          is_system TINYINT(1) NOT NULL DEFAULT 0,
          status TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Ensure slug column exists on saas_roles
      const [roleCols] = await pool.query(`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saas_roles' AND COLUMN_NAME = 'slug'
      `);
      if (roleCols.length === 0) {
        await pool.query('ALTER TABLE saas_roles ADD COLUMN slug VARCHAR(100) DEFAULT NULL AFTER role_name');
      }

      // Backfill missing slugs on existing roles
      const [existingRoles] = await pool.query('SELECT id, role_name, slug FROM saas_roles');
      for (const r of existingRoles) {
        if (!r.slug) {
          const generatedSlug = SaasRoleModel.slugify(r.role_name);
          await pool.query('UPDATE saas_roles SET slug = ? WHERE id = ?', [generatedSlug, r.id]);
        }
      }

      // 2. Ensure saas_modules table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS saas_modules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          module_key VARCHAR(50) NOT NULL UNIQUE,
          module_name VARCHAR(100) NOT NULL,
          description VARCHAR(255) DEFAULT NULL,
          display_order INT DEFAULT 0,
          status TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 3. Ensure saas_role_permissions table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS saas_role_permissions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          role_id INT NOT NULL,
          module_key VARCHAR(50) NOT NULL,
          can_view TINYINT(1) NOT NULL DEFAULT 0,
          can_add TINYINT(1) NOT NULL DEFAULT 0,
          can_edit TINYINT(1) NOT NULL DEFAULT 0,
          can_delete TINYINT(1) NOT NULL DEFAULT 0,
          can_manage TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_saas_role_perm_role FOREIGN KEY (role_id) REFERENCES saas_roles(id) ON DELETE CASCADE,
          UNIQUE KEY uq_saas_role_module (role_id, module_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 4. Upsert all 12 SaaS modules
      for (const m of DEFAULT_SAAS_MODULES) {
        await pool.query(`
          INSERT INTO saas_modules (module_key, module_name, description, display_order, status)
          VALUES (?, ?, ?, ?, 1)
          ON DUPLICATE KEY UPDATE
            module_name = VALUES(module_name),
            description = VALUES(description),
            display_order = VALUES(display_order),
            status = 1
        `, [m.key, m.name, m.desc, m.order]);
      }

      // 5. Ensure Super Admin system role exists and has full permissions on all modules
      const [superAdminRows] = await pool.query('SELECT id FROM saas_roles WHERE is_system = 1 OR LOWER(role_name) = "super admin" ORDER BY is_system DESC, id ASC LIMIT 1');
      let superAdminRoleId;
      if (superAdminRows.length === 0) {
        const [ins] = await pool.query(
          'INSERT INTO saas_roles (role_name, slug, description, is_system, status) VALUES (?, ?, ?, 1, 1)',
          ['Super Admin', 'super_admin', 'Full unrestricted platform access to all modules and settings']
        );
        superAdminRoleId = ins.insertId;
      } else {
        superAdminRoleId = superAdminRows[0].id;
        await pool.query('UPDATE saas_roles SET is_system = 1, status = 1, slug = COALESCE(slug, "super_admin") WHERE id = ?', [superAdminRoleId]);
      }

      for (const m of DEFAULT_SAAS_MODULES) {
        await pool.query(`
          INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
          VALUES (?, ?, 1, 1, 1, 1, 1)
          ON DUPLICATE KEY UPDATE
            can_view = 1, can_add = 1, can_edit = 1, can_delete = 1, can_manage = 1
        `, [superAdminRoleId, m.key]);
      }

      // 6. Ensure all existing non-system roles have rows for every module (defaulting missing rows to 0)
      const [nonSystemRoles] = await pool.query('SELECT id FROM saas_roles WHERE is_system = 0');
      for (const roleRow of nonSystemRoles) {
        for (const m of DEFAULT_SAAS_MODULES) {
          await pool.query(`
            INSERT IGNORE INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage)
            VALUES (?, ?, 0, 0, 0, 0, 0)
          `, [roleRow.id, m.key]);
        }
      }

      // 7. Ensure superadmin users have role_id linked to Super Admin role
      await pool.query(
        'UPDATE saas_admin_users SET role_id = ? WHERE role = "superadmin" AND (role_id IS NULL OR role_id = 0)',
        [superAdminRoleId]
      );
    } catch (error) {
      console.error('SaasRoleModel.initTable error:', error.message);
    }
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
    let conditions = [];
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
        (SELECT COUNT(*) FROM saas_admin_users sau WHERE sau.role_id = r.id) AS assigned_users_count,
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
    const [roles] = await pool.query('SELECT * FROM saas_roles WHERE id = ? LIMIT 1', [id]);
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
    const [userCount] = await pool.query('SELECT COUNT(*) AS total FROM saas_admin_users WHERE role_id = ?', [id]);
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
      'SELECT id, role_name, slug FROM saas_roles WHERE LOWER(role_name) = LOWER(?) OR (slug IS NOT NULL AND LOWER(slug) = LOWER(?)) LIMIT 1',
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

    const roleStatus = status !== undefined && Number(status) === 0 ? 0 : 1;
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

      if (!isSystem) {
        const nextSlug = slug && String(slug).trim()
          ? SaasRoleModel.slugify(slug)
          : SaasRoleModel.slugify(trimmedName);
        if (nextSlug) {
          const [slugCheck] = await pool.query(
            'SELECT id FROM saas_roles WHERE LOWER(slug) = LOWER(?) AND id != ? LIMIT 1',
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
        'SELECT id FROM saas_roles WHERE LOWER(slug) = LOWER(?) AND id != ? LIMIT 1',
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
      params.push(Number(status) === 0 ? 0 : 1);
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
          `UPDATE saas_roles SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
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
   * Toggle role active/inactive status
   */
  static async toggleRoleStatus(id, status) {
    const role = await SaasRoleModel.getRoleById(id);
    if (!role) return null;

    if (Number(role.is_system) === 1 && Number(status) !== 1) {
      const err = new Error('Protected system roles cannot be deactivated.');
      err.statusCode = 400;
      throw err;
    }

    const nextStatus = Number(status) === 1 ? 1 : 0;
    await pool.query(
      'UPDATE saas_roles SET status = ?, updated_at = NOW() WHERE id = ?',
      [nextStatus, id]
    );

    return await SaasRoleModel.getRoleById(id);
  }

  /**
   * Delete a role (cannot delete system roles or roles in use)
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
   * Check if role has specific permission on module(s)
   * @param {number} roleId
   * @param {string|string[]} moduleKey - Single module key or array of module keys (OR logic)
   * @param {string|string[]} action - Single action or array of actions (OR logic)
   */
  static async checkPermission(roleId, moduleKey, action = 'can_view') {
    if (!roleId || !moduleKey) return false;

    // Check if role exists and is active
    const [roleRows] = await pool.query('SELECT is_system, status FROM saas_roles WHERE id = ? LIMIT 1', [roleId]);
    if (roleRows.length === 0 || Number(roleRows[0].status) !== 1) return false;

    // System role has all permissions
    if (Number(roleRows[0].is_system) === 1) return true;

    const moduleKeys = (Array.isArray(moduleKey) ? moduleKey : [moduleKey]).filter(Boolean);
    if (moduleKeys.length === 0) return false;

    const allowedActions = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_manage'];
    const rawActions = Array.isArray(action) ? action : [action];
    const validActions = rawActions.filter(a => allowedActions.includes(a));
    if (validActions.length === 0) {
      validActions.push('can_view');
    }

    const placeholders = moduleKeys.map(() => '?').join(', ');
    const [permRows] = await pool.query(
      `SELECT srp.module_key, srp.can_view, srp.can_add, srp.can_edit, srp.can_delete, srp.can_manage
       FROM saas_role_permissions srp
       JOIN saas_modules sm ON srp.module_key = sm.module_key AND sm.status = 1
       WHERE srp.role_id = ? AND srp.module_key IN (${placeholders})`,
      [roleId, ...moduleKeys]
    );

    if (permRows.length === 0) return false;

    for (const row of permRows) {
      for (const act of validActions) {
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
      conditions.push('(sau.first_name LIKE ? OR sau.last_name LIKE ? OR sau.email LIKE ? OR sau.phone_number LIKE ? OR sr.role_name LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM saas_admin_users sau
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id
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
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id
      WHERE sau.id = ? AND sau.role = 'subadmin'
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
    actor = null,
  }) {
    // Check if subadmin exists
    const [existing] = await pool.query('SELECT * FROM saas_admin_users WHERE id = ? AND role = "subadmin" LIMIT 1', [id]);
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
      await pool.query(`UPDATE saas_admin_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    }

    return await SaasRoleModel.getSubAdminById(id);
  }

  /**
   * Delete sub-admin user
   */
  static async deleteSubAdmin(id, actor = null) {
    const [existing] = await pool.query('SELECT id, role FROM saas_admin_users WHERE id = ? LIMIT 1', [id]);
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

    const [res] = await pool.query('DELETE FROM saas_admin_users WHERE id = ?', [id]);
    return { success: res.affectedRows > 0 };
  }

  /**
   * Toggle sub-admin active/inactive status
   */
  static async toggleSubAdminStatus(id, status, actor = null) {
    const [existing] = await pool.query('SELECT id, role FROM saas_admin_users WHERE id = ? LIMIT 1', [id]);
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
      'UPDATE saas_admin_users SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return res.affectedRows > 0;
  }
}

SaasRoleModel.DEFAULT_SAAS_MODULES = DEFAULT_SAAS_MODULES;

module.exports = SaasRoleModel;
