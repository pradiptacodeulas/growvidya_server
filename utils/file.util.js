const CloudStorageService = require('../services/cloudStorage.service');

/**
 * Uploads a Base64-encoded data URI directly to Backblaze B2 and records it in file_storage_ledger.
 * @param {string} base64Data - e.g. "data:image/png;base64,iVBORw..." or existing relative path
 * @param {string} subFolder - e.g. "student/student_pic" or "student/attachment"
 * @param {string} prefix - e.g. "Profile" or "Doc"
 * @param {object} context - { schoolId, branchId, uploadedBy, uploaderRole, skipQuotaCheck }
 * @returns {Promise<string|null>} - Relative file path e.g. "upload/schools/14/branches/1/student/student_pic/Profile-178923.png"
 */
async function saveBase64File(base64Data, subFolder = 'general', prefix = 'file', context = {}) {
  if (!base64Data || typeof base64Data !== 'string') return base64Data;
  if (base64Data.startsWith('blob:')) return null;
  if (!base64Data.startsWith('data:')) return base64Data;

  return await CloudStorageService.uploadBase64(base64Data, subFolder, prefix, context);
}

/**
 * Deletes a file from Backblaze B2 and marks it deleted in file_storage_ledger.
 * @param {string} relPath
 * @param {object} options - { schoolId, allowPlatformDelete }
 * @returns {Promise<boolean>}
 */
async function hardDeleteFile(relPath, options = {}) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (relPath.startsWith('http://') || relPath.startsWith('https://') || relPath.startsWith('blob:')) {
    return false;
  }

  return await CloudStorageService.deleteFile(relPath, options);
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
