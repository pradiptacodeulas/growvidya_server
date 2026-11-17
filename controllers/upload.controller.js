const ApiResponse = require('../utils/api.response');

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
}

module.exports = UploadController;
