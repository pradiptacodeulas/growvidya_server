const path = require('path');
const ApiResponse = require('../utils/api.response');

class UploadController {
  /**
   * Handle single file upload
   */
  static async uploadSingle(req, res, next) {
    try {
      if (!req.file) {
        return ApiResponse.error(res, 'No file was uploaded.', null, 400);
      }

      const uploadRoot = path.join(__dirname, '../public/upload');
      let folderRel = '';
      if (req.file.destination) {
        folderRel = path.relative(uploadRoot, req.file.destination).replace(/\\/g, '/');
      } else {
        const folder = (req.query.folder || req.body.folder || 'general')
          .replace(/[^a-zA-Z0-9_\-\/]/g, '')
          .replace(/^\/+|\/+$/g, '');
        folderRel = folder;
      }

      const cleanFolder = folderRel && folderRel !== '.' ? `${folderRel}/` : '';
      const relativePath = `upload/${cleanFolder}${req.file.filename}`;
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
   * Handle multiple files upload
   */
  static async uploadMultiple(req, res, next) {
    try {
      if (!req.files || req.files.length === 0) {
        return ApiResponse.error(res, 'No files were uploaded.', null, 400);
      }

      const uploadRoot = path.join(__dirname, '../public/upload');
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      const uploadedFiles = req.files.map((file) => {
        let folderRel = '';
        if (file.destination) {
          folderRel = path.relative(uploadRoot, file.destination).replace(/\\/g, '/');
        } else {
          const folder = (req.query.folder || req.body.folder || 'general')
            .replace(/[^a-zA-Z0-9_\-\/]/g, '')
            .replace(/^\/+|\/+$/g, '');
          folderRel = folder;
        }
        const cleanFolder = folderRel && folderRel !== '.' ? `${folderRel}/` : '';
        const relativePath = `upload/${cleanFolder}${file.filename}`;
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
   * Handle physical hard deletion of a file
   */
  static async deleteFile(req, res, next) {
    try {
      const filePath = req.body.file_path || req.query.file_path || req.body.path;
      if (!filePath) {
        return ApiResponse.error(res, 'File path is required for deletion.', null, 400);
      }

      const { hardDeleteFile } = require('../utils/file.util');
      const deleted = await hardDeleteFile(filePath);

      if (!deleted) {
        return ApiResponse.error(res, 'File not found or could not be physically deleted.', null, 404);
      }

      return ApiResponse.success(res, 'File permanently deleted from disk.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = UploadController;

