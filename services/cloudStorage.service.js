const crypto = require('crypto');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const FileStorageLedgerModel = require('../models/fileStorageLedger.model');
const StorageQuotaService = require('./storageQuota.service');

class CloudStorageService {
  static _s3Client = null;
  static _s3ConfigSignature = null;

  /**
   * Read and validate Backblaze B2 configuration strictly from environment variables (no fallbacks)
   */
  static getB2Config() {
    const endpointRaw = (process.env.B2_ENDPOINT || '').trim();
    const region = (process.env.B2_REGION || '').trim();
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();
    const keyId = (process.env.B2_KEY_ID || '').trim();
    const applicationKey = (process.env.B2_APPLICATION_KEY || '').trim();

    const missing = [];
    if (!endpointRaw) missing.push('B2_ENDPOINT');
    if (!region) missing.push('B2_REGION');
    if (!bucketName) missing.push('B2_BUCKET_NAME');
    if (!keyId) missing.push('B2_KEY_ID');
    if (!applicationKey) missing.push('B2_APPLICATION_KEY');

    if (missing.length > 0) {
      const err = new Error(
        `Backblaze B2 Cloud Storage is not configured. Missing environment variables: ${missing.join(', ')}`
      );
      err.statusCode = 500;
      throw err;
    }

    const endpoint = /^https?:\/\//i.test(endpointRaw) ? endpointRaw : `https://${endpointRaw}`;

    return {
      endpoint,
      region,
      bucketName,
      keyId,
      applicationKey,
    };
  }

  /**
   * Get or initialize singleton S3Client for Backblaze B2
   */
  static getS3Client() {
    const cfg = CloudStorageService.getB2Config();
    const sig = `${cfg.endpoint}|${cfg.region}|${cfg.bucketName}|${cfg.keyId}|${cfg.applicationKey}`;

    if (!CloudStorageService._s3Client || CloudStorageService._s3ConfigSignature !== sig) {
      CloudStorageService._s3Client = new S3Client({
        endpoint: cfg.endpoint,
        region: cfg.region,
        credentials: {
          accessKeyId: cfg.keyId,
          secretAccessKey: cfg.applicationKey,
        },
        forcePathStyle: true,
      });
      CloudStorageService._s3ConfigSignature = sig;
    }

    return { client: CloudStorageService._s3Client, bucketName: cfg.bucketName };
  }

  /**
   * Clean a folder string and remove redundant prefixes
   */
  static sanitizeFolder(rawFolder = 'general') {
    const cleaned = String(rawFolder || 'general')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^public\/upload\/?/i, '')
      .replace(/^upload\/?/i, '')
      .replace(/\.\./g, '')
      .replace(/^\/+|\/+$/g, '');
    return cleaned || 'general';
  }

  /**
   * Map folder to canonical storage ledger category
   */
  static classifyCategory(folder = 'general') {
    const f = CloudStorageService.sanitizeFolder(folder).toLowerCase();

    if (f.includes('study_material')) return 'study_material';
    if (f.includes('student/attachment') || f.includes('student_doc')) return 'student_doc';
    if (f.includes('teacher/attachment') || f.includes('teacher_doc')) return 'teacher_doc';
    if (f.includes('staff/documents') || f.includes('staff_doc')) return 'staff_doc';
    if (f.includes('drivers/documents') || f.includes('driver_doc')) return 'driver_doc';
    if (f === 'buses' || f.includes('buses')) return 'bus_image';
    if (f === 'template' || f.includes('certificate')) return 'certificate_border';
    if (f.includes('leave')) return 'leave_attachment';
    if (f.includes('fees') || f.includes('payroll') || f.includes('salary')) return 'fee_receipt';
    if (f.includes('messages') || f.includes('chat')) return 'chat_attachment';
    if (f === 'schools' || f === 'school' || f.includes('school_logo')) return 'school_branding';
    if (f.includes('support_tickets')) return 'support_ticket';
    if (
      f.includes('attendance_machines') ||
      f.includes('rfid_cards') ||
      f.includes('bank_accounts') ||
      f.includes('admin/profile_pic')
    ) {
      return 'platform_asset';
    }
    if (
      f.includes('student_pic') ||
      f.includes('profile') ||
      f === 'student' ||
      f === 'students' ||
      f === 'teacher' ||
      f === 'teachers' ||
      f === 'staff' ||
      f === 'parent'
    ) {
      return 'profile_pic';
    }
    return 'general';
  }

  /**
   * Check if a folder belongs to SaaS Platform catalog/admin rather than a school tenant
   */
  static isPlatformFolder(folder = '') {
    const f = CloudStorageService.sanitizeFolder(folder).toLowerCase();
    return (
      f.startsWith('attendance_machines') ||
      f.startsWith('rfid_cards') ||
      f.startsWith('bank_accounts') ||
      f.startsWith('admin/profile_pic')
    );
  }

  /**
   * Check if a normalized file path is whitelisted for pre-login public access:
   * ONLY SaaS Catalog images (attendance_machines, rfid_cards, bank_accounts) and School Logos (schools, school)
   */
  static isPubliclyAccessiblePath(rawPath) {
    const normalized = FileStorageLedgerModel.normalizeFilePath(rawPath).toLowerCase();
    if (!normalized) return false;

    // 1. SaaS Hardware & Bank Catalog images
    if (
      normalized.includes('/attendance_machines/') ||
      normalized.includes('/rfid_cards/') ||
      normalized.includes('/bank_accounts/')
    ) {
      return true;
    }

    // 2. School Logos (upload/schools/... or upload/school/... or upload/platform/schools/... or upload/schools/{id}/branches/{b}/school(s)/...)
    if (
      /^upload\/(platform\/)?schools?\/[^/]+\.[a-z0-9]+$/i.test(normalized) ||
      /\/branches\/\d+\/schools?\/[^/]+\.[a-z0-9]+$/i.test(normalized)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Extract user / tenant context from an Express request
   */
  static extractRequestContext(req, overrides = {}) {
    const user = req?.user || {};
    const isPlatformAdmin = Boolean(
      user.portalType === 'SaaSAdminPortal' || req?.saasAdmin
    );
    const roleRaw = String(
      overrides.uploaderRole ||
      user.roleName ||
      user.role_name ||
      user.role ||
      (isPlatformAdmin ? 'saas_admin' : user.isSuperAdmin ? 'super_admin' : '')
    ).toLowerCase();

    const rawSchoolId =
      overrides.schoolId !== undefined
        ? overrides.schoolId
        : isPlatformAdmin
          ? (req?.body?.school_id ?? req?.query?.school_id ?? null)
          : (user.school_id ?? user.schoolId ?? null);

    const rawBranchId =
      overrides.branchId !== undefined
        ? overrides.branchId
        : (req?.branchId ?? req?.body?.branch_id ?? req?.query?.branch_id ?? user.branch_id ?? user.branchId ?? null);

    const rawUserId =
      overrides.uploadedBy !== undefined
        ? overrides.uploadedBy
        : (req?.saasAdmin?.id ?? user.id ?? user.userId ?? user.teacherId ?? user.studentId ?? user.parentId ?? null);

    const schoolId = rawSchoolId && Number(rawSchoolId) > 0 ? Number(rawSchoolId) : null;
    const branchId = rawBranchId && Number(rawBranchId) > 0 ? Number(rawBranchId) : null;
    const uploadedBy = rawUserId && Number(rawUserId) > 0 ? Number(rawUserId) : null;

    return {
      schoolId,
      branchId,
      uploadedBy,
      uploaderRole: roleRaw || null,
      isPlatformAdmin,
    };
  }

  /**
   * Build deterministic, collision-free Backblaze B2 object key and application file_path
   */
  static buildObjectKey({
    schoolId = null,
    branchId = null,
    folder = 'general',
    originalName = 'file',
    prefix = '',
    customExt = '',
    allowPlatformScope = false,
    allowSupportTicketScope = false,
  }) {
    const cleanFolder = CloudStorageService.sanitizeFolder(folder);
    const parsedExt = (customExt || path.extname(originalName || '') || '.bin').toLowerCase();
    const rawBase = prefix
      ? `${prefix}_${path.basename(originalName || 'file', path.extname(originalName || ''))}`
      : path.basename(originalName || 'file', path.extname(originalName || ''));

    const safeBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50) || 'file';
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const savedName = `${safeBase}-${uniqueSuffix}${parsedExt}`;

    let subKey = '';
    if (allowSupportTicketScope) {
      const scope = schoolId && Number(schoolId) > 0 ? `school_${Number(schoolId)}` : 'platform';
      subKey = `platform/support_tickets/${scope}/${savedName}`;
    } else if (allowPlatformScope || !schoolId || Number(schoolId) <= 0) {
      subKey = `platform/${cleanFolder}/${savedName}`;
    } else {
      const sId = Number(schoolId);
      const bId = branchId && Number(branchId) > 0 ? Number(branchId) : 0;
      subKey = `schools/${sId}/branches/${bId}/${cleanFolder}/${savedName}`;
    }

    const b2Key = `growvidya/${subKey}`;
    const filePath = `upload/${subKey}`;
    return {
      b2Key,
      filePath,
      savedName,
      cleanFolder,
    };
  }

  /**
   * Upload a Buffer to Backblaze B2, enforcing school storage quota and recording in file_storage_ledger
   */
  static async uploadBuffer({
    buffer,
    mimeType = 'application/octet-stream',
    originalName = 'file',
    sizeBytes = 0,
    folder = 'general',
    prefix = '',
    customExt = '',
    schoolId = null,
    branchId = null,
    uploadedBy = null,
    uploaderRole = null,
    skipQuotaCheck = false,
    allowPlatformScope = false,
    allowSupportTicketScope = false,
  }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      const err = new Error('Invalid or empty file buffer.');
      err.statusCode = 400;
      throw err;
    }

    const actualSize = Number(sizeBytes) > 0 ? Number(sizeBytes) : buffer.length;
    const cleanFolder = CloudStorageService.sanitizeFolder(folder);
    const lowerFolder = cleanFolder.toLowerCase();

    if (!allowPlatformScope && !allowSupportTicketScope) {
      if (
        CloudStorageService.isPlatformFolder(cleanFolder) ||
        lowerFolder === 'support_tickets' ||
        lowerFolder.startsWith('support_tickets/') ||
        lowerFolder === 'platform' ||
        lowerFolder.startsWith('platform/')
      ) {
        const err = new Error('Access denied: Reserved platform folder cannot be used for school uploads.');
        err.statusCode = 403;
        throw err;
      }
    }

    const category = allowSupportTicketScope
      ? 'support_ticket'
      : allowPlatformScope
        ? 'platform_asset'
        : CloudStorageService.classifyCategory(cleanFolder);
    const isCompanyScoped = Boolean(allowPlatformScope || allowSupportTicketScope);

    // Enforce school cloud storage quota before uploading to Backblaze B2
    if (!skipQuotaCheck && !isCompanyScoped && schoolId && Number(schoolId) > 0) {
      const quota = await StorageQuotaService.checkUploadAllowed(Number(schoolId), actualSize);
      if (!quota.allowed) {
        const err = new Error(
          `Cloud storage limit reached (${quota.usedFormatted} used of ${quota.allowedFormatted}). Purchase a Cloud Storage Add-on or upgrade your plan to upload more files.`
        );
        err.statusCode = 403;
        err.quota = {
          allocatedBytes: quota.allocatedBytes,
          allocatedFormatted: quota.allowedFormatted,
          usedBytes: quota.usedBytes,
          usedFormatted: quota.usedFormatted,
          remainingBytes: quota.remainingBytes,
          incomingBytes: actualSize,
        };
        throw err;
      }
    }

    const { client, bucketName } = CloudStorageService.getS3Client();
    const { b2Key, filePath, savedName } = CloudStorageService.buildObjectKey({
      schoolId: allowPlatformScope && !allowSupportTicketScope ? null : schoolId,
      branchId: isCompanyScoped ? null : branchId,
      folder: cleanFolder,
      originalName,
      prefix,
      customExt,
      allowPlatformScope,
      allowSupportTicketScope,
    });

    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: b2Key,
        Body: buffer,
        ContentType: mimeType || 'application/octet-stream',
        ContentLength: actualSize,
      })
    );

    // Company/Platform & Support Ticket assets are tracked with schoolId = NULL so 0 bytes count against school storage
    await FileStorageLedgerModel.recordUpload({
      schoolId: isCompanyScoped ? null : schoolId,
      branchId: isCompanyScoped ? null : branchId,
      category,
      filePath,
      b2Key,
      originalName: originalName || savedName,
      mimeType: mimeType || 'application/octet-stream',
      sizeBytes: actualSize,
      uploadedBy,
      uploaderRole,
    });

    return {
      file_name: originalName || savedName,
      saved_name: savedName,
      file_path: filePath,
      b2_key: b2Key,
      mimetype: mimeType || 'application/octet-stream',
      size: actualSize,
      category,
    };
  }

  /**
   * Upload a multer memoryStorage file object and mutate file properties for downstream controllers
   */
  static async uploadMulterFile(req, file, options = {}) {
    if (!file || !file.buffer) {
      const err = new Error('No file buffer found on request.');
      err.statusCode = 400;
      throw err;
    }

    const ctx = CloudStorageService.extractRequestContext(req, options);
    const folder = options.folder || req?.query?.folder || req?.body?.folder || 'general';
    const allowPlatformScope = Boolean(options.allowPlatformScope || ctx.isPlatformAdmin);
    const allowSupportTicketScope = Boolean(options.allowSupportTicketScope);

    const uploaded = await CloudStorageService.uploadBuffer({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      sizeBytes: file.size || file.buffer.length,
      folder,
      prefix: options.prefix || '',
      schoolId: ctx.schoolId,
      branchId: ctx.branchId,
      uploadedBy: ctx.uploadedBy,
      uploaderRole: ctx.uploaderRole,
      skipQuotaCheck: Boolean(options.skipQuotaCheck),
      allowPlatformScope,
      allowSupportTicketScope,
    });

    file.filename = uploaded.saved_name;
    file.filePath = uploaded.file_path;
    file.b2Key = uploaded.b2_key;

    return uploaded;
  }

  /**
   * Decode and upload a Base64 Data-URI string to Backblaze B2
   */
  static async uploadBase64(base64Data, subFolder = 'general', prefix = 'file', context = {}) {
    if (!base64Data || typeof base64Data !== 'string') return null;
    const trimmed = base64Data.trim();

    if (!trimmed.startsWith('data:')) {
      return trimmed.replace(/^\/+/, '');
    }

    const matches = trimmed.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return null;
    }

    const mimeType = matches[1].toLowerCase();
    const base64Payload = matches[2];
    const buffer = Buffer.from(base64Payload, 'base64');

    let ext = '.jpg';
    if (mimeType.includes('png')) ext = '.png';
    else if (mimeType.includes('webp')) ext = '.webp';
    else if (mimeType.includes('gif')) ext = '.gif';
    else if (mimeType.includes('svg')) ext = '.svg';
    else if (mimeType.includes('pdf')) ext = '.pdf';
    else if (mimeType.includes('msword') || mimeType.includes('wordprocessingml')) ext = '.docx';

    const uploaded = await CloudStorageService.uploadBuffer({
      buffer,
      mimeType,
      originalName: `${prefix}${ext}`,
      sizeBytes: buffer.length,
      folder: subFolder,
      prefix,
      customExt: ext,
      schoolId: context.schoolId ?? null,
      branchId: context.branchId ?? null,
      uploadedBy: context.uploadedBy ?? null,
      uploaderRole: context.uploaderRole ?? null,
      skipQuotaCheck: Boolean(context.skipQuotaCheck),
      allowPlatformScope: Boolean(context.allowPlatformScope),
      allowSupportTicketScope: Boolean(context.allowSupportTicketScope),
    });

    return uploaded.file_path;
  }

  /**
   * Delete a file from Backblaze B2 and mark it deleted in file_storage_ledger
   * Enforces strict schoolId tenant isolation when options.schoolId is provided.
   */
  static async deleteFile(rawPath, options = {}) {
    if (!rawPath || typeof rawPath !== 'string') return false;
    const trimmed = rawPath.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return false;
    }

    const normalizedPath = FileStorageLedgerModel.normalizeFilePath(trimmed);
    if (!normalizedPath || normalizedPath === 'upload' || normalizedPath === 'upload/') {
      return false;
    }

    const lowerFilename = path.basename(normalizedPath).toLowerCase();
    if (
      normalizedPath.toLowerCase().includes('/template/') &&
      (lowerFilename.startsWith('certificate_0') || lowerFilename.startsWith('default'))
    ) {
      return false;
    }

    const callerSchoolId = options?.schoolId && Number(options.schoolId) > 0 ? Number(options.schoolId) : null;
    const existingLedger = await FileStorageLedgerModel.getByFilePath(normalizedPath);

    if (callerSchoolId) {
      if (
        normalizedPath.toLowerCase().startsWith('upload/platform/') ||
        normalizedPath.toLowerCase().startsWith('upload/support_tickets/') ||
        (existingLedger && (existingLedger.category === 'platform_asset' || existingLedger.category === 'support_ticket'))
      ) {
        return false;
      }

      if (existingLedger && existingLedger.school_id && Number(existingLedger.school_id) !== callerSchoolId) {
        return false;
      }

      const schoolPathMatch = normalizedPath.match(/^upload\/schools\/(\d+)\//i);
      if (schoolPathMatch && Number(schoolPathMatch[1]) !== callerSchoolId) {
        return false;
      }
    }

    const ledgerRow = await FileStorageLedgerModel.markDeletedByPath(normalizedPath);
    const rawSubKey = normalizedPath.replace(/^upload\/+/, '');
    const b2Key = ledgerRow?.b2_key || (rawSubKey.startsWith('growvidya/') ? rawSubKey : `growvidya/${rawSubKey}`);

    if (!b2Key) return false;

    try {
      const { client, bucketName } = CloudStorageService.getS3Client();
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: b2Key,
        })
      );
      return true;
    } catch (err) {
      console.error('[CloudStorageService.deleteFile] Error deleting object from Backblaze B2:', err.message);
      return Boolean(ledgerRow);
    }
  }

  /**
   * Retrieve a readable stream and metadata from Backblaze B2 for a stored file path
   */
  static async getObjectStream(rawPath, preloadedLedgerRecord = null) {
    const normalizedPath = FileStorageLedgerModel.normalizeFilePath(rawPath);
    if (!normalizedPath) {
      const err = new Error('Invalid file path.');
      err.statusCode = 400;
      throw err;
    }

    const ledgerRecord = preloadedLedgerRecord || (await FileStorageLedgerModel.getByFilePath(normalizedPath));
    const rawSubKey = normalizedPath.replace(/^upload\/+/, '');
    const b2Key = ledgerRecord?.b2_key || (rawSubKey.startsWith('growvidya/') ? rawSubKey : `growvidya/${rawSubKey}`);

    if (!b2Key) {
      const err = new Error('File not found.');
      err.statusCode = 404;
      throw err;
    }

    const { client, bucketName } = CloudStorageService.getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: b2Key,
      })
    );

    return {
      stream: response.Body,
      contentType: ledgerRecord?.mime_type || response.ContentType || 'application/octet-stream',
      contentLength: ledgerRecord?.size_bytes || response.ContentLength || undefined,
      etag: response.ETag,
      lastModified: response.LastModified,
      originalName: ledgerRecord?.original_name || path.basename(b2Key),
      ledgerRecord,
    };
  }

  /**
   * Retrieve a file's complete Buffer and MIME type from Backblaze B2 (for PDF generation, etc.)
   */
  static async getFileBuffer(rawPath) {
    const { stream, contentType, originalName, ledgerRecord } = await CloudStorageService.getObjectStream(rawPath);
    if (typeof stream.transformToByteArray === 'function') {
      const byteArray = await stream.transformToByteArray();
      return {
        buffer: Buffer.from(byteArray),
        mimeType: contentType,
        originalName,
        ledgerRecord,
      };
    }

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      mimeType: contentType,
      originalName,
      ledgerRecord,
    };
  }
}

module.exports = CloudStorageService;
