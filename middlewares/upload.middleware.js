const multer = require('multer');
const path = require('path');
const ApiResponse = require('../utils/api.response');
const CloudStorageService = require('../services/cloudStorage.service');

// Memory storage so files never touch local disk and stream directly to Backblaze B2
const memoryStorage = multer.memoryStorage();

// File filter (allow images, PDFs, Word docs, Excel, Text, CSV)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /jpeg|jpg|png|webp|svg|gif|pdf|doc|docx|txt|csv|xls|xlsx|ppt|pptx/;
  const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());

  if (extname) {
    return cb(null, true);
  }
  cb(new Error('Unsupported file format! Allowed: Images, PDF, DOC, DOCX, XLS, XLSX, CSV, TXT'));
};

const baseUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB max file size
  },
  fileFilter,
});

/**
 * Wrap a multer middleware so that once memory parsing succeeds,
 * files are uploaded to Backblaze B2 via CloudStorageService (with quota enforcement & ledger tracking).
 */
function wrapWithB2Upload(multerHandler, options = {}) {
  return (req, res, next) => {
    multerHandler(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return ApiResponse.badRequest(
              res,
              options.sizeLimitMessage || 'File size exceeds the maximum allowed limit.'
            );
          }
          return ApiResponse.badRequest(res, `Upload error: ${err.message}`);
        }
        return ApiResponse.badRequest(res, err.message || 'Invalid file upload.');
      }

      const uploadedPaths = [];
      try {
        const allowPlatformScope = Boolean(
          options.allowPlatformScope || req?.user?.portalType === 'SaaSAdminPortal' || req?.saasAdmin
        );
        const allowSupportTicketScope = Boolean(options.allowSupportTicketScope);

        // When SaaS SuperAdmin replies to a school's support ticket, resolve the ticket's school_id so the school can view the attachment
        let ticketSchoolIdOverride = undefined;
        if (allowSupportTicketScope) {
          const ctx = CloudStorageService.extractRequestContext(req);
          if (!ctx.schoolId && req?.params?.id && Number(req.params.id) > 0) {
            try {
              const { pool } = require('../config/db.config');
              const [tRows] = await pool.query(
                'SELECT school_id FROM support_tickets WHERE id = ? LIMIT 1',
                [Number(req.params.id)]
              );
              if (tRows && tRows[0]?.school_id) {
                ticketSchoolIdOverride = Number(tRows[0].school_id);
              }
            } catch (_) {}
          }
        }

        // 1. Single file in req.file
        if (req.file && req.file.buffer) {
          const folder =
            typeof options.resolveFolder === 'function'
              ? options.resolveFolder(req, req.file)
              : (options.folder || req.query?.folder || req.body?.folder || 'general');
          const prefix =
            typeof options.resolvePrefix === 'function'
              ? options.resolvePrefix(req, req.file)
              : (options.prefix || '');

          if (!options.deferB2Upload) {
            const uploaded = await CloudStorageService.uploadMulterFile(req, req.file, {
              folder,
              prefix,
              skipQuotaCheck: Boolean(options.skipQuotaCheck),
              allowPlatformScope,
              allowSupportTicketScope,
              ...(ticketSchoolIdOverride !== undefined ? { schoolId: ticketSchoolIdOverride } : {}),
            });
            uploadedPaths.push(uploaded.file_path);
          }
        }

        // 2. Array of files in req.files
        if (Array.isArray(req.files) && req.files.length > 0 && !options.deferB2Upload) {
          const folder =
            typeof options.resolveFolder === 'function'
              ? options.resolveFolder(req)
              : (options.folder || req.query?.folder || req.body?.folder || 'general');

          // Pre-check total incoming bytes against school quota before uploading batch
          const ctx = CloudStorageService.extractRequestContext(req);
          const isCompanyScoped = Boolean(allowPlatformScope || allowSupportTicketScope);

          if (!options.skipQuotaCheck && !isCompanyScoped && ctx.schoolId) {
            const StorageQuotaService = require('../services/storageQuota.service');
            const totalIncomingBytes = req.files.reduce((sum, f) => sum + (f.size || f.buffer?.length || 0), 0);
            const quota = await StorageQuotaService.checkUploadAllowed(ctx.schoolId, totalIncomingBytes);
            if (!quota.allowed) {
              return ApiResponse.error(
                res,
                `Cloud storage limit reached (${quota.usedFormatted} used of ${quota.allowedFormatted}). Purchase a Cloud Storage Add-on or upgrade your plan to upload more files.`,
                {
                  quota: {
                    allocatedBytes: quota.allocatedBytes,
                    allocatedFormatted: quota.allowedFormatted,
                    usedBytes: quota.usedBytes,
                    usedFormatted: quota.usedFormatted,
                    remainingBytes: quota.remainingBytes,
                    incomingBytes: totalIncomingBytes,
                  },
                },
                403
              );
            }
          }

          for (const file of req.files) {
            const uploaded = await CloudStorageService.uploadMulterFile(req, file, {
              folder,
              prefix: options.prefix || '',
              skipQuotaCheck: true, // Already checked above for the full batch
              allowPlatformScope,
              allowSupportTicketScope,
              ...(ticketSchoolIdOverride !== undefined ? { schoolId: ticketSchoolIdOverride } : {}),
            });
            uploadedPaths.push(uploaded.file_path);
          }
        }

        // 3. Object map of field arrays in req.files (multer.fields)
        if (req.files && !Array.isArray(req.files) && typeof req.files === 'object') {
          const allFieldFiles = Object.values(req.files).flat();
          if (allFieldFiles.length > 0 && !options.deferB2Upload) {
            for (const file of allFieldFiles) {
              const folder =
                typeof options.resolveFolder === 'function'
                  ? options.resolveFolder(req, file)
                  : (options.folder || req.query?.folder || req.body?.folder || 'general');
              const prefix =
                typeof options.resolvePrefix === 'function'
                  ? options.resolvePrefix(req, file)
                  : (options.prefix || '');

              const uploaded = await CloudStorageService.uploadMulterFile(req, file, {
                folder,
                prefix,
                skipQuotaCheck: Boolean(options.skipQuotaCheck),
                allowPlatformScope,
                allowSupportTicketScope,
                ...(ticketSchoolIdOverride !== undefined ? { schoolId: ticketSchoolIdOverride } : {}),
              });
              uploadedPaths.push(uploaded.file_path);
            }

            if (options.exposeSingleOnReqFile && !req.file) {
              req.file = allFieldFiles[0] || null;
            }
          }
        }

        return next();
      } catch (uploadErr) {
        // Roll back any files uploaded in this request if a multi-file upload failed midway
        for (const p of uploadedPaths) {
          await CloudStorageService.deleteFile(p);
        }
        const statusCode = uploadErr.statusCode || 500;
        return ApiResponse.error(
          res,
          uploadErr.message || 'Failed to upload file to cloud storage.',
          uploadErr.quota ? { quota: uploadErr.quota } : null,
          statusCode
        );
      }
    });
  };
}

const upload = {
  single: (fieldName) =>
    wrapWithB2Upload(baseUpload.single(fieldName), {
      sizeLimitMessage: 'File size exceeds the 15 MB limit. Please upload a file under 15 MB.',
    }),
  array: (fieldName, maxCount = 10) =>
    wrapWithB2Upload(baseUpload.array(fieldName, maxCount), {
      sizeLimitMessage: 'File size exceeds the 15 MB limit. Please upload files under 15 MB each.',
    }),
  fields: (fieldsConfig) =>
    wrapWithB2Upload(baseUpload.fields(fieldsConfig), {
      sizeLimitMessage: 'File size exceeds the 15 MB limit.',
    }),
};

// Strict JPG-only upload for Certificate Borders (defers B2 upload until controller validates A4 portrait dimensions)
const jpgOnlyMulter = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB max file size
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const isJpg = (ext === '.jpg' || ext === '.jpeg') && (mime === 'image/jpeg' || mime === 'image/jpg');
    if (isJpg) {
      return cb(null, true);
    }
    cb(new Error('Only .jpg / .jpeg image files are allowed for Certificate Borders!'));
  },
});

const uploadJpgOnly = {
  single: (fieldName) =>
    wrapWithB2Upload(jpgOnlyMulter.single(fieldName), {
      deferB2Upload: true,
      sizeLimitMessage: 'File size exceeds the 15 MB limit.',
    }),
};

// Image-only filter (JPG, JPEG, PNG, WEBP, SVG, GIF)
const imageOnlyFilter = (req, file, cb) => {
  const allowedExtensions = /^\.(jpeg|jpg|png|webp|svg|gif)$/i;
  const allowedMimes = /^image\/(jpeg|jpg|png|webp|svg\+xml|gif)$/i;

  const isExtValid = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
  const isMimeValid = allowedMimes.test(file.mimetype);

  if (isExtValid && isMimeValid) {
    return cb(null, true);
  }
  cb(new Error('Invalid image format! Only JPG, JPEG, PNG, WEBP, SVG, and GIF images are allowed.'));
};

// ============================================================================
// Dedicated Attendance Machine Image Upload Middleware (10 MB, SaaS Platform)
// ============================================================================
const uploadMachineImageMulter = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageOnlyFilter,
});

const machineImageMiddleware = wrapWithB2Upload(
  uploadMachineImageMulter.fields([
    { name: 'machine_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  {
    folder: 'attendance_machines',
    prefix: 'machine',
    skipQuotaCheck: true,
    allowPlatformScope: true,
    exposeSingleOnReqFile: true,
    sizeLimitMessage: 'Image size exceeds the 10 MB limit. Please upload a smaller image.',
  }
);

// ============================================================================
// Dedicated RFID Card Image Upload Middleware (10 MB, SaaS Platform)
// ============================================================================
const uploadRfidImageMulter = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageOnlyFilter,
});

const rfidImageMiddleware = wrapWithB2Upload(
  uploadRfidImageMulter.fields([
    { name: 'card_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  {
    folder: 'rfid_cards',
    prefix: 'rfid',
    skipQuotaCheck: true,
    allowPlatformScope: true,
    exposeSingleOnReqFile: true,
    sizeLimitMessage: 'Image size exceeds the 10 MB limit. Please upload a smaller image.',
  }
);

// ============================================================================
// Dedicated Bank Account / QR Code Image Upload Middleware (10 MB, SaaS Platform)
// ============================================================================
const uploadBankImageMulter = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageOnlyFilter,
});

const bankImageMiddleware = wrapWithB2Upload(
  uploadBankImageMulter.fields([
    { name: 'qr_code_image', maxCount: 1 },
    { name: 'qr_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  {
    folder: 'bank_accounts',
    prefix: 'bank_qr',
    skipQuotaCheck: true,
    allowPlatformScope: true,
    exposeSingleOnReqFile: true,
    sizeLimitMessage: 'QR code image size exceeds the 10 MB limit. Please upload a smaller image.',
  }
);

// ============================================================================
// Dedicated Bus Image Upload Middleware (1 MB Max, School Quota Tracked)
// ============================================================================
const uploadBusImageMulter = multer({
  storage: memoryStorage,
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: imageOnlyFilter,
});

const busImageMiddleware = wrapWithB2Upload(
  uploadBusImageMulter.fields([
    { name: 'bus_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  {
    folder: 'buses',
    prefix: 'bus',
    exposeSingleOnReqFile: true,
    sizeLimitMessage: 'File size exceeds the 1 MB limit. Please upload an image under 1 MB.',
  }
);

// ============================================================================
// Dedicated Driver & Helper Document Upload Middleware (100 KB Max, School Quota Tracked)
// ============================================================================
const driverDocsFilter = (req, file, cb) => {
  const allowedExtensions = /^\.(jpeg|jpg|png|webp|pdf)$/i;
  const allowedMimes = /^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/i;

  const isExtValid = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
  const isMimeValid = allowedMimes.test(file.mimetype);

  if (isExtValid && isMimeValid) {
    return cb(null, true);
  }
  cb(new Error('Invalid document format! Only JPG, JPEG, PNG, WEBP, and PDF files are allowed.'));
};

const uploadDriverDocsMulter = multer({
  storage: memoryStorage,
  limits: { fileSize: 100 * 1024 },
  fileFilter: driverDocsFilter,
});

const driverDocsMiddleware = wrapWithB2Upload(
  uploadDriverDocsMulter.fields([
    { name: 'license_doc', maxCount: 1 },
    { name: 'id_proof_doc', maxCount: 1 },
  ]),
  {
    folder: 'drivers/documents',
    resolvePrefix: (req, file) => (file.fieldname === 'license_doc' ? 'license' : 'idproof'),
    sizeLimitMessage: 'Document size exceeds the 100 KB limit. Please upload a file under 100 KB.',
  }
);

// ============================================================================
// Dedicated Support Ticket Attachment Upload Middleware (10 MB Max)
// ============================================================================
const supportTicketFilter = (req, file, cb) => {
  const allowedExtensions = /^\.(jpeg|jpg|png|webp|gif|pdf|doc|docx|txt|csv|xls|xlsx)$/i;
  const isExtValid = allowedExtensions.test(path.extname(file.originalname).toLowerCase());

  if (isExtValid) {
    return cb(null, true);
  }
  cb(new Error('Invalid attachment format! Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX, CSV, TXT.'));
};

const uploadSupportTicketAttachmentMulter = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: supportTicketFilter,
});

const supportTicketAttachmentMiddleware = wrapWithB2Upload(
  uploadSupportTicketAttachmentMulter.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  {
    folder: 'support_tickets',
    prefix: 'ticket',
    skipQuotaCheck: true,
    allowSupportTicketScope: true,
    exposeSingleOnReqFile: true,
    sizeLimitMessage: 'Attachment size exceeds the 10 MB limit. Please upload a smaller file.',
  }
);

module.exports = {
  upload,
  uploadJpgOnly,
  machineImageMiddleware,
  rfidImageMiddleware,
  bankImageMiddleware,
  busImageMiddleware,
  driverDocsMiddleware,
  supportTicketAttachmentMiddleware,
};
