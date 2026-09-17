const ApiResponse = require('../utils/api.response');
const PermissionModel = require('../models/permission.model');

const VALID_ACTIONS = ['view', 'add', 'edit', 'delete'];

function rbacMiddleware(...args) {
  let allowedRoles = [];
  let targetModule = null;
  let targetAction = null;

  // Pattern A: rbacMiddleware('academic/classes', 'view') or rbacMiddleware(['feesmanagement/components', 'feesmanagement/structures'], 'view')
  if (
    args.length === 2 &&
    (typeof args[0] === 'string' || Array.isArray(args[0])) &&
    VALID_ACTIONS.includes(String(args[1]).toLowerCase())
  ) {
    targetModule = args[0];
    targetAction = String(args[1]).toLowerCase();
  }
  // Pattern B: rbacMiddleware(['Admin', 'Super Admin', 'Teacher'], 'examination/gradeSettings', 'view')
  else if (
    args.length >= 3 &&
    (typeof args[1] === 'string' || Array.isArray(args[1])) &&
    VALID_ACTIONS.includes(String(args[2]).toLowerCase())
  ) {
    allowedRoles = Array.isArray(args[0]) ? args[0] : [args[0]];
    targetModule = args[1];
    targetAction = String(args[2]).toLowerCase();
  }
  // Pattern C: rbacMiddleware(['Admin', 'Super Admin']) or rbacMiddleware('Super Admin', 'Admin')
  else if (args.length === 1 && Array.isArray(args[0])) {
    allowedRoles = args[0];
  } else {
    allowedRoles = args.flat().filter(Boolean);
  }

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return ApiResponse.error(res, 'Unauthorized access.', null, 401);
      }

      const userRole = String(req.user.roleName || req.user.userType || req.user.role || '').trim();
      const adminType = Number(req.user.adminType ?? req.user.admin_type);
      const roleId = Number(req.user.roleId ?? req.user.role_id);
      const portalType = req.user.portalType;

      // 1. Super Admin (admin_type = 1 or roleName = 'Super Admin' / 'superadmin') always has full unrestricted access
      const uRoleLower = userRole.toLowerCase();
      const isSuperAdmin =
        Boolean(req.user.isSuperAdmin) ||
        adminType === 1 ||
        uRoleLower === 'super admin' ||
        uRoleLower === 'superadmin';

      if (isSuperAdmin) {
        return next();
      }

      // 2. If allowedRoles is specified, verify portal or role first
      if (allowedRoles && allowedRoles.length > 0) {
        const hasRole = allowedRoles.some((r) => {
          const rLower = String(r).toLowerCase().trim();
          const uLower = userRole.toLowerCase().trim();
          return (
            rLower === uLower ||
            (rLower === 'admin' && (adminType === 2 || portalType === 'AdminPortal' || Boolean(roleId) || uLower.includes('admin') || uLower.includes('staff'))) ||
            (rLower === 'teacher' && (portalType === 'TeacherPortal' || uLower === 'teacher')) ||
            (rLower === 'parent' && (portalType === 'ParentPortal' || uLower === 'parent')) ||
            (rLower === 'student' && (portalType === 'StudentPortal' || uLower === 'student'))
          );
        });

        if (!hasRole) {
          return ApiResponse.error(
            res,
            `Forbidden. Access restricted to roles: ${allowedRoles.join(', ')}. Your role is '${userRole}'.`,
            null,
            403
          );
        }

        // If Teacher, Parent, or Student is permitted and this is their portal, let them through
        // (Teacher/Parent specific class/child filters are enforced in the respective controllers)
        if (
          userRole.toLowerCase() === 'teacher' ||
          portalType === 'TeacherPortal' ||
          userRole.toLowerCase() === 'parent' ||
          portalType === 'ParentPortal' ||
          userRole.toLowerCase() === 'student' ||
          portalType === 'StudentPortal'
        ) {
          return next();
        }
      }

      // 3. Module & Action Permission Check for Admin/Staff portal users
      if (targetModule && targetAction) {
        if (!roleId) {
          const modDisplay = Array.isArray(targetModule) ? targetModule.join(', ') : targetModule;
          return ApiResponse.error(
            res,
            `Access Denied: No role assigned to verify permission for ${modDisplay}.`,
            null,
            403
          );
        }

        const permMap = await PermissionModel.getUserPermissionMap(roleId);
        const modulesToCheck = Array.isArray(targetModule) ? targetModule : [targetModule];

        const hasPermission = modulesToCheck.some((mod) => {
          const modulePerms = permMap[mod];
          return modulePerms && modulePerms[targetAction];
        });

        if (!hasPermission) {
          return ApiResponse.error(
            res,
            `Access Denied: You do not have permission to ${targetAction} in ${modulesToCheck.join(' or ')}.`,
            null,
            403
          );
        }
      }

      return next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = rbacMiddleware;
