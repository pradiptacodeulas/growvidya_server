const SubscriptionModel = require('../models/subscription.model');
const { verifyToken } = require('../utils/jwt.util');
const config = require('../config/app.config');

/**
 * Subscription Guard Middleware
 * Automatically tracks and disables features if the 14-day free trial or subscription has expired.
 */
async function subscriptionGuard(req, res, next) {
  try {
    // Check if the route is explicitly exempt from subscription enforcement
    const urlPath = req.originalUrl || (req.baseUrl + req.path);
    const exemptPatterns = [
      '/api/health',
      '/api/v1/admin/auth',
      '/api/v1/teacher/auth',
      '/api/v1/parent/auth',
      '/api/v1/student/auth',
      '/api/v1/admin/subscription',
      '/api/v1/webhooks',
      '/api/webhooks',
      '/api/v1/school/config',
      '/api/v1/saas',
      '/api/saas',
      '/upload',
      '/vidya_assets',
    ];

    if (exemptPatterns.some((pattern) => urlPath.includes(pattern))) {
      return next();
    }

    let schoolId = req.user?.school_id || req.user?.schoolId;

    if (!schoolId) {
      // Attempt extraction from token header or portal-specific cookies
      let token = null;
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
      } else if (req.query?.token) {
        token = req.query.token;
      } else if (req.cookies || req.signedCookies) {
        const getCookie = (name) => req.cookies?.[name] || req.signedCookies?.[name];
        const currentUrl = (req.baseUrl || '') + (req.path || '') + (req.originalUrl || '');

        const isTeacherPortal = currentUrl.includes('/v1/teacher/') || currentUrl.includes('/teacheraccount');
        const isParentPortal = currentUrl.includes('/v1/parent/') || currentUrl.includes('/parentchild') || currentUrl.includes('/parentaccount');
        const isStudentPortal = currentUrl.includes('/v1/student/') || currentUrl.includes('/studentaccount');
        const isAdminPortal = currentUrl.includes('/v1/admin/') || currentUrl.includes('/admin/');

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
      }

      if (token) {
        const decoded = verifyToken(token);
        if (decoded?.schoolId || decoded?.school_id) {
          schoolId = Number(decoded.schoolId || decoded.school_id);
          req.user = decoded;
        }
      }
    }

    if (!schoolId) {
      // If we cannot identify a school (e.g. unauthenticated request), allow downstream auth middleware to handle 401
      return next();
    }

    const sub = await SubscriptionModel.getSchoolSubscription(schoolId);
    if (!sub) {
      return next();
    }

    req.subscription = sub;

    // If subscription / trial has expired, block access with 402 Payment Required
    if (sub.isExpired || sub.liveStatus === 'expired') {
      return res.status(402).json({
        status: false,
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Your school subscription or 14-day free trial has expired. Operations are temporarily locked. Please contact your administrator or renew your subscription.',
        data: {
          subscription_id: sub.subscription_id,
          school_id: sub.school_id,
          plan_name: sub.plan_name,
          days_left: 0,
          is_expired: true,
          upgrade_required: true,
        },
      });
    }

    next();
  } catch (error) {
    console.error('[Subscription Guard Error]:', error.message);
    next();
  }
}

module.exports = subscriptionGuard;

