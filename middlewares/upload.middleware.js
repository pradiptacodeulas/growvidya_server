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

module.exports = {
  upload,
  uploadJpgOnly,
  uploadMachineImage,
  machineImageMiddleware,
  uploadRfidImage,
  rfidImageMiddleware,
  UPLOAD_ROOT,
  MACHINE_UPLOAD_ROOT,
  RFID_UPLOAD_ROOT,
};
