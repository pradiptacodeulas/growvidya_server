const PermissionModel = require('../models/permission.model');
const ApiResponse = require('../utils/api.response');

class AdminPermissionController {
  // ==========================================
  // 1. ROLES
  // ==========================================

  static async getAllRoles(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const roles = await PermissionModel.getAllRoles(schoolId);
      return ApiResponse.success(res, 'Roles fetched successfully.', { roles });
    } catch (error) {
      next(error);
    }
  }

  static async getRolePermissions(req, res, next) {
    try {
      const { roleId } = req.params;
      const adminType = Number(req.user?.adminType ?? req.user?.admin_type);
      const isSuperAdmin = Boolean(req.user?.isSuperAdmin) || adminType === 1 || req.user?.roleName === 'Super Admin';
      const schoolId = isSuperAdmin ? null : req.user?.schoolId;

      const role = await PermissionModel.getRoleById(roleId, schoolId);
      if (!role) {
        return ApiResponse.error(res, 'Role not found.', null, 404);
      }

      const allModules = await PermissionModel.getAllDefinedModules();
      const existingPermissions = await PermissionModel.getPermissionsByRoleId(roleId);

      const isSuperAdminRole = Boolean(
        role.is_system_role ||
        String(role.role_name || '').toLowerCase().trim() === 'super admin' ||
        Number(role.id) === 1
      );

      // Create a fast lookup map for exact permissions stored in the database
      const permissionMap = {};
      existingPermissions.forEach((p) => {
        permissionMap[p.module] = {
          add_access: Boolean(Number(p.add_access)),
          view_access: Boolean(Number(p.view_access)),
          edit_access: Boolean(Number(p.edit_access)),
          delete_access: Boolean(Number(p.delete_access)),
        };
      });

      // Group modules by section with their actual database values (or full access if Super Admin)
      const grouped = {};
      allModules.forEach((mod) => {
        let section = 'General';
        let name = mod;
        if (mod.includes('/')) {
          const parts = mod.split('/');
          section = parts[0];
          name = parts.slice(1).join('/');
        }

        // Format section title
        const sectionTitle = section.charAt(0).toUpperCase() + section.slice(1);

        if (!grouped[sectionTitle]) {
          grouped[sectionTitle] = [];
        }

        const perm = isSuperAdminRole
          ? {
              add_access: true,
              view_access: true,
              edit_access: true,
              delete_access: true,
            }
          : permissionMap[mod] || {
              add_access: false,
              view_access: false,
              edit_access: false,
              delete_access: false,
            };

        grouped[sectionTitle].push({
          fullModule: mod,
          name: name,
          ...perm,
        });
      });

      return ApiResponse.success(res, 'Role permissions retrieved.', {
        role: {
          ...role,
          is_system_role: isSuperAdminRole,
        },
        groupedModules: grouped,
        rawPermissions: existingPermissions,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getAllModules(req, res, next) {
    try {
      const allModules = await PermissionModel.getAllDefinedModules();

      const grouped = {};
      allModules.forEach((mod) => {
        let section = 'General';
        let name = mod;
        if (mod.includes('/')) {
          const parts = mod.split('/');
          section = parts[0];
          name = parts.slice(1).join('/');
        }

        const sectionTitle = section.charAt(0).toUpperCase() + section.slice(1);
        if (!grouped[sectionTitle]) {
          grouped[sectionTitle] = [];
        }

        grouped[sectionTitle].push({
          fullModule: mod,
          name: name,
          add_access: false,
          view_access: false,
          edit_access: false,
          delete_access: false,
        });
      });

      return ApiResponse.success(res, 'System modules retrieved.', {
        groupedModules: grouped,
        totalModules: allModules.length,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // 2. SAVE ROLE & PERMISSION MATRIX
  // ==========================================

  static async saveRoleAndPermissions(req, res, next) {
    try {
      const adminType = Number(req.user?.adminType ?? req.user?.admin_type);
      const isSuperAdmin = Boolean(req.user?.isSuperAdmin) || adminType === 1 || req.user?.roleName === 'Super Admin';
      const schoolId = req.user?.schoolId;
      const { roleId, role_name, permissions } = req.body;

      if (!role_name || !role_name.trim()) {
        return ApiResponse.error(res, 'Role name is required.', null, 400);
      }

      const trimmedName = role_name.trim();

      // Guard 1: Prevent creating or renaming a role to 'Super Admin'
      if (trimmedName.toLowerCase() === 'super admin') {
        return ApiResponse.error(
          res,
          'The role name "Super Admin" is reserved for the system and cannot be modified.',
          null,
          403
        );
      }

      let activeRoleId = roleId;

      if (activeRoleId) {
        // Guard 2: Prevent modifying existing Super Admin role
        const targetRole = await PermissionModel.getRoleById(activeRoleId);
        if (
          targetRole &&
          (targetRole.is_system_role ||
            String(targetRole.role_name || '').toLowerCase().trim() === 'super admin' ||
            Number(targetRole.id) === 1)
        ) {
          return ApiResponse.error(
            res,
            'The Super Admin role is protected and its permissions cannot be modified.',
            null,
            403
          );
        }

        // Update existing role
        await PermissionModel.updateRole(activeRoleId, { roleName: trimmedName }, isSuperAdmin ? null : schoolId);
      } else {
        // Create new role
        activeRoleId = await PermissionModel.insertRole({
          schoolId: schoolId || 1,
          roleName: trimmedName,
        });
      }

      // Save permissions list
      if (Array.isArray(permissions)) {
        await PermissionModel.saveRolePermissions(activeRoleId, permissions);
      }

      return ApiResponse.success(res, 'Role and permissions saved successfully.', {
        roleId: activeRoleId,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // 3. DELETE ROLE
  // ==========================================

  static async deleteRole(req, res, next) {
    try {
      const { roleId } = req.params;
      const adminType = Number(req.user?.adminType ?? req.user?.admin_type);
      const isSuperAdmin = Boolean(req.user?.isSuperAdmin) || adminType === 1 || req.user?.roleName === 'Super Admin';
      const schoolId = isSuperAdmin ? null : req.user?.schoolId;

      const role = await PermissionModel.getRoleById(roleId, schoolId);

      if (!role) {
        return ApiResponse.error(res, 'Role not found.', null, 404);
      }

      // Guard: Super Admin role cannot be deleted
      if (
        role.is_system_role ||
        String(role.role_name || '').toLowerCase().trim() === 'super admin' ||
        Number(role.id) === 1
      ) {
        return ApiResponse.error(
          res,
          'The Super Admin role is system-protected and cannot be deleted.',
          null,
          403
        );
      }

      await PermissionModel.deleteRole(roleId, schoolId);
      return ApiResponse.success(res, 'Role soft-deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // 4. CURRENT LOGGED IN USER PERMISSIONS
  // ==========================================

  static async getMyPermissions(req, res, next) {
    try {
      const roleId = req.user.roleId;
      const roleName = req.user.roleName || req.user.userType || 'Staff';
      const adminType = Number(req.user.adminType ?? req.user.admin_type);

      const isSuperAdmin =
        Boolean(req.user.isSuperAdmin) ||
        adminType === 1 ||
        roleName === 'Super Admin';

      if (isSuperAdmin) {
        return ApiResponse.success(res, 'Super Admin permissions.', {
          isSuperAdmin: true,
          roleName: 'Super Admin',
          permissions: {},
        });
      }

      const permMap = roleId ? await PermissionModel.getUserPermissionMap(roleId) : {};
      return ApiResponse.success(res, 'User permissions retrieved.', {
        isSuperAdmin: false,
        roleName,
        roleId,
        permissions: permMap,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminPermissionController;
