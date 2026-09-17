const fs = require('fs');
const path = require('path');
const { UPLOAD_ROOT } = require('../middlewares/upload.middleware');

/**
 * Saves a base64 encoded data string into a physical file on the disk
 * @param {string} base64Data - e.g. "data:image/png;base64,iVBORw..." or raw base64
 * @param {string} subFolder - e.g. "student/student_pic" or "student/attachment"
 * @param {string} prefix - e.g. "Profile" or "Doc"
 * @returns {string|null} - Relative file path e.g. "upload/student/student_pic/Profile-178923.png"
 */
function saveBase64File(base64Data, subFolder = 'general', prefix = 'file') {
  if (!base64Data || typeof base64Data !== 'string') return base64Data;

  // If it's a dead browser blob URL, return null
  if (base64Data.startsWith('blob:')) {
    return null;
  }

  // If it's already a relative or absolute path / URL, return as is
  if (!base64Data.startsWith('data:')) {
    return base64Data;
  }

  try {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return base64Data;
    }

    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    // Determine file extension from mime
    let ext = '.png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
    else if (mimeType.includes('webp')) ext = '.webp';
    else if (mimeType.includes('svg')) ext = '.svg';
    else if (mimeType.includes('pdf')) ext = '.pdf';
    else if (mimeType.includes('msword')) ext = '.doc';
    else if (mimeType.includes('wordprocessingml')) ext = '.docx';
    else if (mimeType.includes('sheet') || mimeType.includes('excel')) ext = '.xlsx';

    const safeFolder = subFolder.replace(/[^a-zA-Z0-9_\-\/]/g, '').replace(/^\/+|\/+$/g, '');
    const targetDir = path.join(UPLOAD_ROOT, safeFolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileName = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e4)}${ext}`;
    const fullPath = path.join(targetDir, fileName);

    fs.writeFileSync(fullPath, buffer);

    // Return relative path standard across system e.g. "upload/student/student_pic/Profile-123.jpg"
    return `upload/${safeFolder ? safeFolder + '/' : ''}${fileName}`;
  } catch (err) {
    console.error('[saveBase64File] Error writing file to disk:', err.message);
    return base64Data;
  }
}

/**
 * Safely hard deletes a physical file from the disk
 * Guarded against path traversal attacks (must reside inside UPLOAD_ROOT)
 * @param {string} relPath - e.g. "upload/student/student_pic/Profile-123.jpg"
 * @returns {Promise<boolean>}
 */
async function hardDeleteFile(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;

  // Ignore http/https external URLs or dead blob links
  if (relPath.startsWith('http://') || relPath.startsWith('https://') || relPath.startsWith('blob:')) {
    return false;
  }

  try {
    const cleanPath = relPath.replace(/^public[\\/]/, '').replace(/^upload[\\/]/, '').replace(/^[\\/]+/, '');
    const fullPath = path.resolve(UPLOAD_ROOT, cleanPath);

    // Path traversal guard: must be strictly inside UPLOAD_ROOT
    if (!fullPath.startsWith(path.resolve(UPLOAD_ROOT))) {
      console.warn('[hardDeleteFile] Attempted path traversal blocked:', relPath);
      return false;
    }

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      await fs.promises.unlink(fullPath);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[hardDeleteFile] Error unlinking physical file:', err.message);
    return false;
  }
}

/**
 * Calculates the raw byte size of a base64 encoded data string without memory allocation
 * @param {string} base64Data - e.g. "data:image/png;base64,iVBORw..."
 * @returns {number} byte length (0 if invalid or not base64)
 */
function getBase64FileSize(base64Data) {
  if (!base64Data || typeof base64Data !== 'string' || !base64Data.startsWith('data:')) {
    return 0;
  }
  const commaIndex = base64Data.indexOf(',');
  if (commaIndex === -1) return 0;
  const base64Str = base64Data.slice(commaIndex + 1);
  return Buffer.byteLength(base64Str, 'base64');
}

module.exports = {
  saveBase64File,
  hardDeleteFile,
  getBase64FileSize,
};

