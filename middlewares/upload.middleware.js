const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Root public upload directory
const UPLOAD_ROOT = path.join(__dirname, '../public/upload');

// Ensure root directory exists
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

// Allowed file extensions
const ALLOWED_EXTENSIONS = /jpeg|jpg|png|webp|svg|gif|pdf|doc|docx|txt|csv|xls|xlsx|ppt|pptx/i;
const ALLOWED_MIME_TYPES = /image\/(jpeg|jpg|png|webp|svg\+xml|gif)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation)|text\/plain|text\/csv/i;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const folderParam = req.query?.folder || req.body?.folder || 'general';
      const folder = String(folderParam)
        .replace(/[^a-zA-Z0-9_\-\/]/g, '')
        .replace(/^\/+|\/+$/g, '');

      const targetDir = path.join(UPLOAD_ROOT, folder || 'general');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      cb(null, targetDir);
    } catch (err) {
      cb(err, UPLOAD_ROOT);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .substring(0, 50);

    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e4);
    const uniqueFileName = `${baseName}-${timestamp}-${randomSuffix}${ext}`;
    cb(null, uniqueFileName);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const isValidExt = ALLOWED_EXTENSIONS.test(ext);
  const isValidMime = ALLOWED_MIME_TYPES.test(file.mimetype) || file.mimetype === 'application/octet-stream';

  if (isValidExt || isValidMime) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: .${ext}. Allowed formats: JPG, PNG, WEBP, SVG, PDF, DOC, DOCX, CSV, XLS.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max file size
  },
});

const uploadJpgOnly = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isJpg = ext === '.jpg' || ext === '.jpeg';
    const isJpgMime = file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg' || file.mimetype === 'application/octet-stream';
    if (isJpg && isJpgMime) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG/JPEG images (.jpg, .jpeg) are allowed for certificate borders.'));
    }
  },
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max file size
  },
});

// Dedicated storage for Attendance Machine images
const MACHINE_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'attendance_machines');
if (!fs.existsSync(MACHINE_UPLOAD_ROOT)) {
  fs.mkdirSync(MACHINE_UPLOAD_ROOT, { recursive: true });
}

const machineImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, MACHINE_UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .substring(0, 50);

    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e4);
    cb(null, `machine_${baseName}_${timestamp}_${randomSuffix}${ext}`);
  },
});

const uploadMachineImage = multer({
  storage: machineImageStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const isImage = /jpeg|jpg|png|webp|svg/i.test(ext);
    if (isImage) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: .${ext}. Only JPG, PNG, WEBP, and SVG are allowed for attendance machines.`));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

const machineImageMiddleware = (req, res, next) => {
  uploadMachineImage.fields([
    { name: 'machine_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: false,
        message: err.message,
        data: null,
      });
    }
    if (req.files) {
      req.file =
        req.files['machine_image']?.[0] ||
        req.files['image']?.[0] ||
        req.files['file']?.[0] ||
        null;
    }
    next();
  });
};

// Dedicated storage for Attendance RFID Card images
const RFID_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'rfid_cards');
if (!fs.existsSync(RFID_UPLOAD_ROOT)) {
  fs.mkdirSync(RFID_UPLOAD_ROOT, { recursive: true });
}

const rfidImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, RFID_UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .substring(0, 50);

    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e4);
    cb(null, `rfid_${baseName}_${timestamp}_${randomSuffix}${ext}`);
  },
});

const uploadRfidImage = multer({
  storage: rfidImageStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const isImage = /jpeg|jpg|png|webp|svg/i.test(ext);
    if (isImage) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: .${ext}. Only JPG, PNG, WEBP, and SVG are allowed for RFID cards.`));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

const rfidImageMiddleware = (req, res, next) => {
  uploadRfidImage.fields([
    { name: 'card_image', maxCount: 1 },
    { name: 'rfid_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: false,
        message: err.message,
        data: null,
      });
    }
    if (req.files) {
      req.file =
        req.files['card_image']?.[0] ||
        req.files['rfid_image']?.[0] ||
        req.files['image']?.[0] ||
        req.files['file']?.[0] ||
        null;
    }
    next();
  });
};

// Dedicated storage for Bank Account QR images
const BANK_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'bank_accounts');
if (!fs.existsSync(BANK_UPLOAD_ROOT)) {
  fs.mkdirSync(BANK_UPLOAD_ROOT, { recursive: true });
}

const bankImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, BANK_UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .substring(0, 50);

    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e4);
    cb(null, `bank_qr_${baseName}_${timestamp}_${randomSuffix}${ext}`);
  },
});

const uploadBankImage = multer({
  storage: bankImageStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const isImage = /jpeg|jpg|png|webp|svg/i.test(ext);
    if (isImage) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: .${ext}. Only JPG, PNG, WEBP, and SVG are allowed for bank QR codes.`));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const bankImageMiddleware = (req, res, next) => {
  uploadBankImage.fields([
    { name: 'qr_code_image', maxCount: 1 },
    { name: 'qr_code_file', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: false,
        message: err.message,
        data: null,
      });
    }
    if (req.files) {
      req.file =
        req.files['qr_code_image']?.[0] ||
        req.files['qr_code_file']?.[0] ||
        req.files['image']?.[0] ||
        req.files['file']?.[0] ||
        null;
    }
    next();
  });
};

// Dedicated storage for Bus/Vehicle images (1MB limit)
const BUS_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'buses');
if (!fs.existsSync(BUS_UPLOAD_ROOT)) {
  fs.mkdirSync(BUS_UPLOAD_ROOT, { recursive: true });
}

const busImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, BUS_UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .substring(0, 50);

    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e4);
    cb(null, `bus_${baseName}_${timestamp}_${randomSuffix}${ext}`);
  },
});

const uploadBusImage = multer({
  storage: busImageStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const isImage = /jpeg|jpg|png|webp|svg/i.test(ext);
    if (isImage) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid image type: .${ext}. Only JPG, PNG, WEBP, and SVG are allowed for bus images.`));
    }
  },
  limits: {
    fileSize: 1 * 1024 * 1024, // 1MB limit
  },
});

const busImageMiddleware = (req, res, next) => {
  uploadBusImage.fields([
    { name: 'bus_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: false,
          message: 'File size exceeds the 1 MB limit. Please upload an image under 1 MB.',
          data: null,
        });
      }
      return res.status(400).json({
        status: false,
        message: err.message,
        data: null,
      });
    }
    if (req.files) {
      req.file =
        req.files['bus_image']?.[0] ||
        req.files['image']?.[0] ||
        req.files['file']?.[0] ||
        null;
    }
    next();
  });
};

// Dedicated storage for Driver documents (100KB limit per document)
const DRIVER_DOCS_UPLOAD_ROOT = path.join(UPLOAD_ROOT, 'drivers', 'documents');
if (!fs.existsSync(DRIVER_DOCS_UPLOAD_ROOT)) {
  fs.mkdirSync(DRIVER_DOCS_UPLOAD_ROOT, { recursive: true });
}

const driverDocsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DRIVER_DOCS_UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .substring(0, 40);

    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e4);
    const prefix = file.fieldname === 'license_doc' || file.fieldname === 'lisence_doc' ? 'license' : 'idproof';
    cb(null, `${prefix}_${baseName}_${timestamp}_${randomSuffix}${ext}`);
  },
});

const uploadDriverDocs = multer({
  storage: driverDocsStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const isAllowed = /jpeg|jpg|png|webp|pdf/i.test(ext);
    if (isAllowed) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid document type: .${ext}. Only JPG, PNG, WEBP, and PDF files are allowed.`));
    }
  },
  limits: {
    fileSize: 100 * 1024, // 100 KB limit
  },
});

const driverDocsMiddleware = (req, res, next) => {
  uploadDriverDocs.fields([
    { name: 'license_doc', maxCount: 1 },
    { name: 'lisence_doc', maxCount: 1 },
    { name: 'id_proof_doc', maxCount: 1 },
    { name: 'id_proof_file', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: false,
          message: 'Document size exceeds the 100 KB limit. Please upload a file under 100 KB.',
          data: null,
        });
      }
      return res.status(400).json({
        status: false,
        message: err.message,
        data: null,
      });
    }
    next();
  });
};

module.exports = {
  upload,
  uploadJpgOnly,
  uploadMachineImage,
  machineImageMiddleware,
  uploadRfidImage,
  rfidImageMiddleware,
  uploadBankImage,
  bankImageMiddleware,
  uploadBusImage,
  busImageMiddleware,
  uploadDriverDocs,
  driverDocsMiddleware,
  UPLOAD_ROOT,
  MACHINE_UPLOAD_ROOT,
  RFID_UPLOAD_ROOT,
  BANK_UPLOAD_ROOT,
  BUS_UPLOAD_ROOT,
  DRIVER_DOCS_UPLOAD_ROOT,
};

