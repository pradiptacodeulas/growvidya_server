const ApiResponse = require('../utils/api.response');
const { hardDeleteFile } = require('../utils/file.util');

class UploadController {
  /**
   * Handle single file upload to Backblaze B2 (with Cloud Storage Quota enforcement)
   */
  static async uploadSingle(req, res, next) {
    try {
      if (!req.file || !req.file.filePath) {
        return ApiResponse.error(res, 'No file was uploaded.', null, 400);
      }

      const relativePath = req.file.filePath;
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const fileUrl = `${baseUrl}/${relativePath}`;

      return ApiResponse.success(res, 'File uploaded successfully.', {
        file_path: relativePath,
        file_name: req.file.originalname,
        saved_name: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle multiple files upload to Backblaze B2 (with Cloud Storage Quota enforcement)
   */
  static async uploadMultiple(req, res, next) {
    try {
      if (!req.files || req.files.length === 0) {
        return ApiResponse.error(res, 'No files were uploaded.', null, 400);
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;

      const uploadedFiles = req.files.map((file) => {
        const relativePath = file.filePath;
        return {
          file_path: relativePath,
          file_name: file.originalname,
          saved_name: file.filename,
          mimetype: file.mimetype,
          size: file.size,
          url: `${baseUrl}/${relativePath}`,
        };
      });

      return ApiResponse.success(res, 'Files uploaded successfully.', {
        files: uploadedFiles,
        count: uploadedFiles.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle permanent deletion of a file from Backblaze B2 and file_storage_ledger
   */
  static async deleteFile(req, res, next) {
    try {
      const filePath = req.body.file_path || req.query.file_path || req.body.path;
      if (!filePath) {
        return ApiResponse.error(res, 'File path is required for deletion.', null, 400);
      }

      const deleted = await hardDeleteFile(filePath);

      if (!deleted) {
        return ApiResponse.error(res, 'File not found or could not be deleted.', null, 404);
      }

      return ApiResponse.success(res, 'File permanently deleted from cloud storage.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = UploadController;
