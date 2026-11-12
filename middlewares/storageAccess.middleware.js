const path = require('path');
const { verifyToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');
const CloudStorageService = require('../services/cloudStorage.service');
const FileStorageLedgerModel = require('../models/fileStorageLedger.model');

const UPLOAD_ROUTE_PREFIXES = [
  '/upload/',
  '/api/v1/saas-admin/upload/',
  '/api/saas-admin/upload/',
  '/saas-admin/upload/',
  '/api/v1/upload/',
  '/api/upload/',
];

/**
 * Determine whether the incoming request targets an uploaded file route
 */
function isUploadFileRequest(rawPath = '') {
  const clean = String(rawPath || '').replace(/\\/g, '/');
  const lower = clean.toLowerCase();

  for (const prefix of UPLOAD_ROUTE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return true;
    }
  }

  // /vidya_assets/* (except /vidya_assets/images/* which is static UI icons in public/assets)
  if (lower.startsWith('/vidya_assets/') && !lower.startsWith('/vidya_assets/images/')) {
    return true;
  }

  return false;
}

/**
 * Extract JWT token from Authorization header, custom headers, query parameter, or cookies
 */
function extractAuthToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      const bearer = authHeader.substring(7).trim();
      if (bearer) return bearer;
    } else if (authHeader.trim()) {
      return authHeader.trim();
    }
  }

  const headerToken =
    req.headers['x-access-token'] ||
    req.headers['x-auth-token'] ||
    req.headers['token'] ||
    req.headers['auth-token'];
  if (headerToken && typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }

  const queryToken = req.query?.token || req.query?.auth_token;
  if (queryToken && typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }

  if (req.cookies || req.signedCookies) {
    const getCookie = (name) => req.cookies?.[name] || req.signedCookies?.[name];
    const cookieToken =
      getCookie('growvidya_saas_admin_session') ||
      getCookie('saas_admin_token') ||
      getCookie('growvidya_admin_session') ||
      getCookie(config.cookie?.name || 'growvidya_session') ||
      getCookie('growvidya_teacher_session') ||
      getCookie('growvidya_parent_session') ||
      getCookie('growvidya_student_session') ||
      getCookie('token') ||
      getCookie('session_token') ||
      null;

    if (cookieToken && typeof cookieToken === 'string' && cookieToken.trim()) {
      return cookieToken.trim();
    }
  }

  return null;
}

/**
 * Stream a Backblaze B2 object to the HTTP response
 */
async function streamFromB2(req, res, normalizedPath, preloadedLedgerRecord = null, isPublic = false) {
  try {
    const {
      stream,
      contentType,
      contentLength,
      etag,
      lastModified,
    } = await CloudStorageService.getObjectStream(normalizedPath, preloadedLedgerRecord);

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    if (contentLength !== undefined && contentLength !== null) {
      res.setHeader('Content-Length', String(contentLength));
    }
    if (etag) {
      res.setHeader('ETag', etag);
    }
    if (lastModified instanceof Date) {
      res.setHeader('Last-Modified', lastModified.toUTCString());
    }

    res.setHeader(
      'Cache-Control',
      isPublic ? 'public, max-age=86400' : 'private, no-transform, max-age=3600'
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'HEAD') {
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
      return res.status(200).end();
    }

    stream.on('error', (streamErr) => {
      console.error('[storageAccessMiddleware] B2 stream error:', streamErr.message);
      if (!res.headersSent) {
        ApiResponse.error(res, 'Error streaming file from cloud storage.', null, 500);
      } else {
        res.end();
      }
    });

    return stream.pipe(res);
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode || err?.statusCode;
    const code = err?.name || err?.Code || '';
    if (status === 404 || code === 'NoSuchKey' || code === 'NotFound') {
      return ApiResponse.error(res, 'File not found in cloud storage.', null, 404);
    }
    console.error('[storageAccessMiddleware] Error retrieving object from Backblaze B2:', err.message);
    return ApiResponse.error(res, err.message || 'Unable to retrieve file from cloud storage.', null, status || 500);
  }
}

/**
 * Authorized Backblaze B2 File Serving Gateway Middleware
 * - Serves whitelisted public assets (Attendance Machine catalog, RFID Card catalog, Bank QR catalog, School Logos)
 * - Enforces JWT authentication + school tenant isolation on all other uploaded files
 */
async function storageAccessMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  if (!isUploadFileRequest(req.path)) {
    return next();
  }

  const normalizedPath = FileStorageLedgerModel.normalizeFilePath(req.path);
  if (
    !normalizedPath ||
    normalizedPath === 'upload' ||
    normalizedPath === 'upload/' ||
    normalizedPath.includes('..')
  ) {
    return ApiResponse.error(res, 'Invalid file path.', null, 400);
  }

  try {
    // 1. Whitelisted Public Assets (SaaS Hardware/Bank Catalog & School Logos)
    if (CloudStorageService.isPubliclyAccessiblePath(normalizedPath)) {
      return await streamFromB2(req, res, normalizedPath, null, true);
    }

    // 2. All Other Uploaded Files Require Valid Authentication
    const token = extractAuthToken(req);
    if (!token) {
      return ApiResponse.error(
        res,
        'Authentication required to access this file. Please sign in or provide a valid token.',
        null,
        401
      );
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return ApiResponse.error(res, 'Invalid or expired authentication token.', null, 401);
    }

    // 3. SaaS Admin Portal User Verification
    if (decoded.portalType === 'SaaSAdminPortal') {
      const adminId = decoded.userId || decoded.id;
      const [adminRows] = await pool.query(
        `SELECT id, status FROM saas_admin_users WHERE id = ? AND status = 1 LIMIT 1`,
        [adminId]
      );
      if (!adminRows || adminRows.length === 0) {
        return ApiResponse.error(res, 'Access denied. SaaS Admin account is inactive or not found.', null, 403);
      }

      const ledgerRecord = await FileStorageLedgerModel.getByFilePath(normalizedPath);
      return await streamFromB2(req, res, normalizedPath, ledgerRecord, false);
    }

    // 4. School Portal User Verification & Tenant Isolation
    const callerSchoolId = Number(decoded.school_id ?? decoded.schoolId) || 0;
    const adminType = Number(decoded.adminType ?? decoded.admin_type);
    const roleStr = String(decoded.roleName || decoded.role_name || decoded.role || '').toLowerCase();
    const isPlatformSuperAdmin =
      callerSchoolId === 0 &&
      (Boolean(decoded.isSuperAdmin) ||
        adminType === 1 ||
        roleStr === 'super admin' ||
        roleStr === 'superadmin');

    if (callerSchoolId > 0) {
      const [schoolRows] = await pool.query(
        'SELECT status FROM school_master WHERE id = ? LIMIT 1',
        [callerSchoolId]
      );
      if (schoolRows.length > 0 && Number(schoolRows[0].status) !== 1) {
        return ApiResponse.error(
          res,
          'Your school account is currently inactive. File access is disabled.',
          null,
          403
        );
      }
    } else if (!isPlatformSuperAdmin) {
      return ApiResponse.error(res, 'Access denied: Invalid school context in authentication token.', null, 403);
    }

    const ledgerRecord = await FileStorageLedgerModel.getByFilePath(normalizedPath);

    if (!isPlatformSuperAdmin) {
      const lowerPath = normalizedPath.toLowerCase();

      // Block school users from accessing SaaS Admin profile pictures
      if (
        lowerPath.includes('/admin/profile_pic/') ||
        (ledgerRecord && ledgerRecord.category === 'platform_asset')
      ) {
        return ApiResponse.error(res, 'Access denied: Platform admin assets are restricted.', null, 403);
      }

      // Check 1: Ledger school_id ownership
      if (ledgerRecord && ledgerRecord.school_id && Number(ledgerRecord.school_id) > 0) {
        if (Number(ledgerRecord.school_id) !== callerSchoolId) {
          return ApiResponse.error(
            res,
            'Access denied: You do not have permission to access another school\'s file.',
            null,
            403
          );
        }
      }

      // Check 2: Path-embedded school_id (upload/schools/{schoolId}/... or upload/support_tickets/school_{schoolId}/...)
      const schoolPathMatch = normalizedPath.match(/^upload\/schools\/(\d+)\//i);
      if (schoolPathMatch && Number(schoolPathMatch[1]) !== callerSchoolId) {
        return ApiResponse.error(
          res,
          'Access denied: You do not have permission to access another school\'s file.',
          null,
          403
        );
      }

      const ticketPathMatch = normalizedPath.match(/^upload\/support_tickets\/school_(\d+)\//i);
      if (ticketPathMatch && Number(ticketPathMatch[1]) !== callerSchoolId) {
        return ApiResponse.error(
          res,
          'Access denied: You do not have permission to access another school\'s support attachment.',
          null,
          403
        );
      }

      // Check 3: Certificate border / template files (/template/)
      if (lowerPath.includes('/template/')) {
        const filename = path.basename(normalizedPath);
        const lowerFilename = filename.toLowerCase();
        const isSystemDefault =
          lowerFilename.startsWith('certificate_0') ||
          lowerFilename.startsWith('default') ||
          lowerFilename.includes('certificate_01') ||
          lowerFilename.includes('certificate_02') ||
          lowerFilename.includes('certificate_03') ||
          lowerFilename.includes('certificate_04');

        if (!isSystemDefault && (!ledgerRecord || !ledgerRecord.school_id)) {
          const [borderRows] = await pool.query(
            `SELECT id, school_id FROM certificate_border_master WHERE (image LIKE ? OR image = ?) AND status != 4 LIMIT 1`,
            [`%${filename}%`, filename]
          );
          if (!borderRows || borderRows.length === 0) {
            return ApiResponse.error(res, 'Access denied: Certificate asset not authorized.', null, 403);
          }
          if (borderRows[0].school_id && Number(borderRows[0].school_id) !== callerSchoolId) {
            return ApiResponse.error(
              res,
              'Access denied: You do not have permission to view this certificate asset.',
              null,
              403
            );
          }
        }
      }
    }

    // 5. Stream Authorized File from Backblaze B2
    return await streamFromB2(req, res, normalizedPath, ledgerRecord, false);
  } catch (err) {
    console.error('[storageAccessMiddleware] Unexpected error:', err);
    return ApiResponse.error(res, 'Internal server error while verifying file access.', null, 500);
  }
}

module.exports = storageAccessMiddleware;
