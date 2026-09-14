const { verifyToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');

/**
 * Universal Authentication Middleware
 * Supports:
 * 1. Mobile Apps / API Clients: via 'Authorization: Bearer <token>' header
 * 2. Web Browser Clients: via HTTP-Only session cookies ('growvidya_session' / 'token')
 */
function authMiddleware(req, res, next) {
  try {
    let token = null;
    let authSource = 'none';

    // 1. Mobile & REST API Clients: Check HTTP Authorization Header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
      authSource = 'bearer_header';
    }
    // 2. Query param token (useful for direct file downloads and previews)
    else if (req.query?.token) {
      token = req.query.token;
      authSource = 'query_token';
    }
    // 3. Web Browser Sessions: Check Cookies (unsigned & signed cookies)
    else if (req.cookies || req.signedCookies) {
      const getCookie = (name) => req.cookies?.[name] || req.signedCookies?.[name];
      const url = (req.baseUrl || '') + (req.path || '') + (req.originalUrl || '');

      const isTeacherPortal = url.includes('/v1/teacher/') || url.includes('/teacheraccount');
      const isParentPortal = url.includes('/v1/parent/') || url.includes('/parentchild') || url.includes('/parentaccount');
      const isStudentPortal = url.includes('/v1/student/') || url.includes('/studentaccount');
      const isAdminPortal = url.includes('/v1/admin/') || url.includes('/admin/');

      if (isAdminPortal) {
        token = getCookie('growvidya_admin_session') || getCookie(config.cookie?.name || 'growvidya_session');
      } else if (isTeacherPortal) {
        token = getCookie('growvidya_teacher_session');
      } else if (isParentPortal) {
        token = getCookie('growvidya_parent_session');
      } else if (isStudentPortal) {
        token = getCookie('growvidya_student_session');
      }

      if (!token) {
        token =
          getCookie('growvidya_admin_session') ||
          getCookie(config.cookie?.name || 'growvidya_session') ||
          getCookie('growvidya_teacher_session') ||
          getCookie('growvidya_parent_session') ||
          getCookie('growvidya_student_session') ||
          getCookie('token') ||
          getCookie('session_token') ||
          null;
      }
      if (token) {
        authSource = 'session_cookie';
      }
    }

    if (!token) {
      return ApiResponse.error(
        res,
        'Access denied. Authentication required. Please provide a Bearer token or sign in to establish a session.',
        null,
        401
      );
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return ApiResponse.error(res, 'Invalid or expired authentication session/token.', null, 401);
    }

    // Attach decoded user payload and authentication source to request
    req.user = decoded;
    if (req.user) {
      if (req.user.schoolId && !req.user.school_id) {
        req.user.school_id = req.user.schoolId;
      } else if (req.user.school_id && !req.user.schoolId) {
        req.user.schoolId = req.user.school_id;
      }

      // Normalize userId and id so both styles work seamlessly across models/controllers
      if (req.user.userId && !req.user.id) {
        req.user.id = req.user.userId;
      } else if (req.user.id && !req.user.userId) {
        req.user.userId = req.user.id;
      }

      // Branch Context Scoping: check header, query, or token
      const branchFromHeader = req.headers['x-branch-id'] || req.headers['x-branch'];
      const branchFromQuery = req.query?.branch_id;
      const rawBranch = branchFromHeader !== undefined ? branchFromHeader : branchFromQuery;

      let activeBranchId = null;
      if (rawBranch !== undefined && rawBranch !== null) {
        if (rawBranch === 'all' || rawBranch === '0' || rawBranch === '' || rawBranch === 0) {
          activeBranchId = null; // Consolidated school-wide view
        } else {
          activeBranchId = Number(rawBranch) || null;
        }
      } else {
        // Non-admin roles (e.g. branch teacher/student/staff) stay pinned to their assigned branch
        const roleStr = String(req.user.roleName || req.user.role || '').toLowerCase();
        const isAdmin = roleStr.includes('admin') || req.user.role === 1 || req.user.admin_type === 1;
        if (!isAdmin) {
          activeBranchId = Number(req.user.branchId || req.user.branch_id) || null;
        } else {
          activeBranchId = null; // Admin defaults to all branches when header is omitted
        }
      }
      req.user.branch_id = activeBranchId;
      req.user.branchId = activeBranchId;
      req.branchId = activeBranchId;
    }
    req.authSource = authSource;

    next();
  } catch (error) {
    return ApiResponse.error(res, 'Authentication failed.', error.message, 401);
  }
}

module.exports = authMiddleware;

