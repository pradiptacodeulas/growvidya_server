const path = require('path');
const fs = require('fs');
const authMiddleware = require('./auth.middleware');
const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

const UPLOAD_ROOT = path.join(__dirname, '../public/upload');
const TEMPLATE_DIR = path.join(UPLOAD_ROOT, 'template');

// Ensure the directory exists
if (!fs.existsSync(TEMPLATE_DIR)) {
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
}

/**
 * Middleware to intercept and restrict access to certificate templates & border images.
 * Restricts arbitrary public access:
 * - Unauthenticated requests -> 401 Unauthorized
 * - Cross-school unauthorized access -> 403 Forbidden
 * - Authenticated school user -> 200 OK (safely serves the file with private cache headers)
 * - Super admin -> 200 OK
 * - Built-in default templates (e.g. certificate_01, certificate_02) -> 200 OK for any authenticated user
 */
const protectCertificateFiles = async (req, res, next) => {
  // Only intercept GET / HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const rawPath = (req.path || '').replace(/\\/g, '/');
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(rawPath).toLowerCase();
  } catch (_) {
    decodedPath = rawPath.toLowerCase();
  }

  // Intercept any request targeting the /template/ directory within uploads
  const isTemplateRequest =
    decodedPath.includes('/template/') ||
    decodedPath.endsWith('/template') ||
    decodedPath.includes('upload/template');

  if (!isTemplateRequest) {
    return next();
  }

  // Extract the filename requested
  const rawFilename = path.basename(rawPath);
  let filename = rawFilename;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch (_) {}

  if (!filename || filename === '.' || filename === '/' || filename.toLowerCase() === 'template') {
    return ApiResponse.error(res, 'File not specified.', null, 400);
  }

  // Prevent directory traversal attacks
  const targetFilePath = path.resolve(TEMPLATE_DIR, filename);
  if (!targetFilePath.startsWith(TEMPLATE_DIR + path.sep)) {
    return ApiResponse.error(res, 'Access denied.', null, 403);
  }

  // Check if the file physically exists on disk
  if (!fs.existsSync(targetFilePath)) {
    return ApiResponse.error(res, 'Certificate file not found.', null, 404);
  }

  // Authenticate the request via authMiddleware (Bearer header, ?token= param, or session cookies)
  return authMiddleware(req, res, async () => {
    try {
      const user = req.user;
      if (!user) {
        return ApiResponse.error(res, 'Authentication required to access certificate assets.', null, 401);
      }

      const schoolId = user.school_id || user.schoolId;
      const adminType = Number(user.adminType ?? user.admin_type);
      const roleStr = String(user.roleName || user.role_name || user.role || '').toLowerCase();
      const isSuperAdmin =
        Boolean(user.isSuperAdmin) ||
        adminType === 1 ||
        roleStr === 'super admin' ||
        roleStr === 'superadmin' ||
        Number(schoolId) === 0;

      // 1. Super Admins have universal access across all schools
      if (isSuperAdmin) {
        return serveSecureFile(res, targetFilePath);
      }

      // 2. Built-in system default templates (e.g. certificate_01-a4..., default-...)
      // Accessible to any authenticated school user
      const lowerFilename = filename.toLowerCase();
      const isSystemDefault =
        lowerFilename.startsWith('certificate_0') ||
        lowerFilename.startsWith('default') ||
        lowerFilename.includes('certificate_01') ||
        lowerFilename.includes('certificate_02') ||
        lowerFilename.includes('certificate_03') ||
        lowerFilename.includes('certificate_04');

      if (isSystemDefault) {
        return serveSecureFile(res, targetFilePath);
      }

      // 3. Custom school-uploaded border / template:
      // Verify against certificate_border_master in the database
      const [rows] = await pool.query(
        `SELECT id, school_id FROM certificate_border_master WHERE (image LIKE ? OR image = ?) AND status != 4 LIMIT 1`,
        [`%${filename}%`, filename]
      );

      if (rows && rows.length > 0) {
        const borderRecord = rows[0];
        // If border belongs to a specific school and caller is from a different school -> 403 Forbidden
        if (borderRecord.school_id && Number(borderRecord.school_id) !== Number(schoolId)) {
          return ApiResponse.error(res, 'Access denied: You do not have permission to view this certificate asset.', null, 403);
        }
      } else {
        // If file is not in database and not a system default:
        // Non-superadmin cannot access unassociated custom files
        return ApiResponse.error(res, 'Access denied: Certificate asset not authorized.', null, 403);
      }

      // Authorized school user: serve securely
      return serveSecureFile(res, targetFilePath);
    } catch (err) {
      console.error('[protectCertificateFiles] Error validating certificate file access:', err);
      return ApiResponse.error(res, 'Internal server error validating certificate asset access.', null, 500);
    }
  });
};

function serveSecureFile(res, filePath) {
  res.setHeader('Cache-Control', 'private, no-transform, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(filePath);
}

module.exports = {
  protectCertificateFiles,
};
