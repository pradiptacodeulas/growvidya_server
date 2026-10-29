const SubscriptionModel = require('../models/subscription.model');
const { verifyToken } = require('../utils/jwt.util');
const config = require('../config/app.config');

/**
 * Subscription Guard Middleware (Fail-Closed)
 * Enforces active / trial subscription state across Admin, Teacher, Parent, and Student portals.
 * - Keeps active schools working without interruption even while an offline renewal/upgrade is pending review.
 * - Protects write operations to `/api/v1/upload` while keeping GET/HEAD static asset reads exempt.
 * - Serves role-appropriate messages to non-admin portals (Teacher, Parent, Student).
 */
async function subscriptionGuard(req, res, next) {
  try {
    const urlPath = req.originalUrl || (req.baseUrl + req.path);
    const method = String(req.method || 'GET').toUpperCase();

    // Static asset reads (GET / HEAD) remain exempt so logos/avatars render on billing/lockout screens
    if (
      (method === 'GET' || method === 'HEAD') &&
      (urlPath.includes('/upload/') || urlPath.includes('/vidya_assets') || urlPath.includes('/assets/'))
    ) {
      return next();
    }

    const exemptPatterns = [
      '/api/health',
      '/api/v1/admin/auth',
      '/api/v1/teacher/auth',
      '/api/v1/parent/auth',
      '/api/v1/student/auth',
      '/api/v1/admin/subscription',
      '/api/v1/admin/support-tickets',
      '/api/v1/notifications',
      '/api/notifications',
      '/api/v1/webhooks',
      '/api/webhooks',
      '/api/v1/school/config',
      '/api/v1/saas',
      '/api/saas',
      '/coupons',
      '/v1/coupons',
      '/api/v1/coupons',
      '/api/v1/storage-plans/active',
      '/api/v1/storage-plans/units',
      '/api/v1/attendance-machines/active',
      '/api/v1/rfid-cards/active',
    ];

    if (exemptPatterns.some((pattern) => urlPath.includes(pattern))) {
      return next();
    }

    if (req.user?.portalType === 'SaaSAdminPortal') {
      return next();
    }

    let schoolId = req.user?.school_id || req.user?.schoolId;

    if (!schoolId) {
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
        if (decoded?.portalType === 'SaaSAdminPortal') {
          req.user = decoded;
          return next();
        }
        if (decoded?.schoolId || decoded?.school_id) {
          schoolId = Number(decoded.schoolId || decoded.school_id);
          req.user = decoded;
        }
      }
    }

    if (!schoolId) {
      // Unauthenticated request — let downstream auth middleware issue 401
      return next();
    }

    const isNonAdminPortal =
      urlPath.includes('/v1/teacher/') ||
      urlPath.includes('/v1/parent/') ||
      urlPath.includes('/v1/student/') ||
      ['teacher', 'parent', 'student'].includes(
        String(req.user?.role || req.user?.userType || '').toLowerCase()
      );

    const memberPausedMessage =
      'School portal services are temporarily paused. Please contact your School Administration.';

    const sub = await SubscriptionModel.getSchoolSubscription(schoolId);

    // Fail-closed if an authenticated school tenant has no subscription record
    if (!sub) {
      return res.status(402).json({
        status: false,
        code: 'SUBSCRIPTION_REQUIRED',
        message: isNonAdminPortal
          ? memberPausedMessage
          : 'No active subscription found for your school. Please select a subscription plan to continue.',
        data: {
          school_id: schoolId,
          portal_role: isNonAdminPortal ? 'member' : 'admin',
          upgrade_required: !isNonAdminPortal,
        },
      });
    }

    req.subscription = sub;

    // 1. Offline Bank Transfer awaiting review (ONLY locks when school has NO active/trial subscription)
    if (sub.liveStatus === 'pending' || (sub.status === 'pending' && !sub.isTrial)) {
      return res.status(403).json({
        status: false,
        code: 'SUBSCRIPTION_PENDING_APPROVAL',
        message: isNonAdminPortal
          ? memberPausedMessage
          : `Your offline bank transfer for "${sub.plan_name}" is currently under Super Admin verification. Portal modules will unlock automatically once approved.`,
        data: {
          subscription_id: sub.subscription_id,
          school_id: sub.school_id,
          plan_name: sub.plan_name,
          portal_role: isNonAdminPortal ? 'member' : 'admin',
          is_pending: true,
          status: 'pending',
        },
      });
    }

    // 2. Suspended by Platform Super Admin
    if (sub.status === 'suspended' || sub.liveStatus === 'suspended') {
      return res.status(403).json({
        status: false,
        code: 'SUBSCRIPTION_SUSPENDED',
        message: isNonAdminPortal
          ? memberPausedMessage
          : `Your school subscription ("${sub.plan_name}") is currently suspended. Please contact platform support or visit Subscription & Billing.`,
        data: {
          subscription_id: sub.subscription_id,
          school_id: sub.school_id,
          plan_name: sub.plan_name,
          portal_role: isNonAdminPortal ? 'member' : 'admin',
          is_suspended: true,
          status: 'suspended',
        },
      });
    }

    // 3. Rejected offline subscription with no fallback active plan
    if (sub.status === 'rejected' || sub.liveStatus === 'rejected') {
      return res.status(402).json({
        status: false,
        code: 'SUBSCRIPTION_REJECTED',
        message: isNonAdminPortal
          ? memberPausedMessage
          : `Your last offline payment submission for "${sub.plan_name}" could not be verified. Please complete your subscription in Subscription & Billing.`,
        data: {
          subscription_id: sub.subscription_id,
          school_id: sub.school_id,
          plan_name: sub.plan_name,
          portal_role: isNonAdminPortal ? 'member' : 'admin',
          is_rejected: true,
          upgrade_required: !isNonAdminPortal,
        },
      });
    }

    // 4. Expired trial or paid subscription
    if (sub.isExpired || sub.liveStatus === 'expired') {
      return res.status(402).json({
        status: false,
        code: 'SUBSCRIPTION_EXPIRED',
        message: isNonAdminPortal
          ? memberPausedMessage
          : `Your school subscription for "${sub.plan_name}" has expired. Please renew or upgrade your plan in Subscription & Billing to resume operations.`,
        data: {
          subscription_id: sub.subscription_id,
          school_id: sub.school_id,
          plan_name: sub.plan_name,
          days_left: 0,
          portal_role: isNonAdminPortal ? 'member' : 'admin',
          is_expired: true,
          upgrade_required: !isNonAdminPortal,
        },
      });
    }

    return next();
  } catch (error) {
    console.error('[Subscription Guard Error]:', error.message);
    return res.status(503).json({
      status: false,
      code: 'SUBSCRIPTION_CHECK_UNAVAILABLE',
      message: 'Temporary error verifying subscription status. Please try again.',
    });
  }
}

module.exports = subscriptionGuard;
