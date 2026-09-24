const SaasRoleModel = require('../models/saasRole.model');
const ApiResponse = require('../utils/api.response');

/**
 * Middleware factory to enforce module-level RBAC for SaaS Admin & Sub-Admin users.
 * 
 * Rules:
 * 1. Super Admin ('superadmin') has unrestricted bypass access to all modules and actions.
 * 2. Sub-Admin ('subadmin') access is strictly evaluated against the permissions assigned to their role.
 * 
 * @param {string} moduleKey - The key of the SaaS module (e.g. 'schools', 'subscriptions', 'coupons', 'roles', 'sub_admins')
 * @param {'can_view'|'can_add'|'can_edit'|'can_delete'|'can_manage'} action - The required action permission
 */
const checkPermission = (moduleKey, action = 'can_view') => {
  return async (req, res, next) => {
    try {
      if (!req.saasAdmin) {
        return ApiResponse.error(res, 'Authentication required. Please provide a valid Bearer token.', null, 401);
      }

      // 1. Super Admin bypass - full access by default
      if (req.saasAdmin.role === 'superadmin') {
        return next();
      }

      // 2. Sub Admin check
      if (!req.saasAdmin.role_id) {
        return ApiResponse.error(
          res,
          'Access denied. No administrative role is assigned to your account.',
          null,
          403
        );
      }

      const hasPermission = await SaasRoleModel.checkPermission(
        req.saasAdmin.role_id,
        moduleKey,
        action
      );

      if (!hasPermission) {
        return ApiResponse.error(
          res,
          `Access denied. You do not have '${action}' permission for the '${moduleKey}' module.`,
          null,
          403
        );
      }

      next();
    } catch (error) {
      console.error('saasPermissionMiddleware error:', error);
      return ApiResponse.error(res, 'Internal server error while evaluating permissions.', null, 500);
    }
  };
};

module.exports = { checkPermission };
