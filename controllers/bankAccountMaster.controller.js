const BankAccountMasterModel = require('../models/bankAccountMaster.model');
const ApiResponse = require('../utils/api.response');

// Helper to extract bank account ID from params, query, or body
const extractBankAccountId = (req) => {
  let id = req.params?.id;
  if (!id || id === ':id' || String(id).trim() === '') {
    id = req.query?.id || req.query?.account_id || req.body?.id || req.body?.account_id;
  }
  if (!id || id === ':id' || String(id).trim() === '') {
    return null;
  }
  return String(id).trim();
};

const parseDefaultFlag = (val) => {
  if (val === true || val === 1 || val === '1') return 1;
  if (typeof val === 'string' && val.trim().toLowerCase() === 'true') return 1;
  return 0;
};

class BankAccountMasterController {
  /**
   * GET /bank-accounts
   * List all bank accounts (with optional ?search= & ?status=)
   */
  static async getAll(req, res, next) {
    try {
      const { search, status, id, account_id } = req.query;
      const targetId = id || account_id;
      if (targetId && targetId !== ':id') {
        req.params.id = targetId;
        return BankAccountMasterController.getById(req, res, next);
      }

      const accounts = await BankAccountMasterModel.getAll({ search, status });
      return ApiResponse.success(res, 'Bank accounts retrieved successfully.', accounts);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /bank-accounts/active
   * List only active accounts (used during checkout / subscription configuration)
   */
  static async getActive(req, res, next) {
    try {
      const { default_only, is_default } = req.query;
      const defaultOnly =
        default_only === 'true' ||
        default_only === '1' ||
        is_default === '1' ||
        is_default === 'true';
      const accounts = await BankAccountMasterModel.getActive({ defaultOnly });
      return ApiResponse.success(res, 'Active bank accounts retrieved successfully.', accounts);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /bank-accounts/:id
   * Get single bank account details
   */
  static async getById(req, res, next) {
    try {
      const id = extractBankAccountId(req);
      if (!id) {
        return ApiResponse.error(res, 'Bank account ID is required.', null, 400);
      }
      const account = await BankAccountMasterModel.getById(id);
      if (!account) {
        return ApiResponse.error(res, 'Bank account not found.', null, 404);
      }
      return ApiResponse.success(res, 'Bank account retrieved successfully.', account);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /bank-accounts
   * Create new official bank account (Super Admin)
   */
  static async create(req, res, next) {
    try {
      const {
        account_title,
        beneficiary_name,
        account_number,
        bank_name,
        branch_name,
        ifsc_code,
        account_type,
        upi_id,
        swift_code,
        instructions,
        qr_code_image,
        is_default,
        status,
      } = req.body;

      if (!account_title || !beneficiary_name || !account_number || !bank_name || !ifsc_code) {
        if (req.file && req.file.filePath) {
          const CloudStorageService = require('../services/cloudStorage.service');
          await CloudStorageService.deleteFile(req.file.filePath);
        }
        return ApiResponse.error(
          res,
          'Required fields: account_title, beneficiary_name, account_number, bank_name, and ifsc_code are mandatory.',
          null,
          400
        );
      }

      let finalQrImage = qr_code_image || null;
      if (req.file) {
        finalQrImage = req.file.filePath;
      } else if (finalQrImage && String(finalQrImage).startsWith('data:')) {
        const { saveBase64File } = require('../utils/file.util');
        finalQrImage = await saveBase64File(finalQrImage, 'bank_accounts', 'bank_qr', { skipQuotaCheck: true });
      }

      const newAccount = await BankAccountMasterModel.create({
        account_title: String(account_title).trim(),
        beneficiary_name: String(beneficiary_name).trim(),
        account_number: String(account_number).trim(),
        bank_name: String(bank_name).trim(),
        branch_name: branch_name ? String(branch_name).trim() : null,
        ifsc_code: String(ifsc_code).trim().toUpperCase(),
        account_type: account_type ? String(account_type).trim() : null,
        upi_id: upi_id ? String(upi_id).trim() : null,
        swift_code: swift_code ? String(swift_code).trim() : null,
        instructions: instructions ? String(instructions).trim() : null,
        qr_code_image: finalQrImage,
        is_default: parseDefaultFlag(is_default),
        status: status !== undefined ? (Number(status) === 2 ? 2 : 1) : 1,
      });

      return ApiResponse.success(res, 'Bank account created successfully.', newAccount, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /bank-accounts/:id
   * Update existing bank account (Super Admin)
   */
  static async update(req, res, next) {
    try {
      const id = extractBankAccountId(req);
      if (!id) {
        return ApiResponse.error(res, 'Valid bank account ID is required.', null, 400);
      }
      const existing = await BankAccountMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.error(res, 'Bank account not found.', null, 404);
      }

      const updateData = { ...req.body };
      if (updateData.is_default !== undefined) {
        updateData.is_default = parseDefaultFlag(updateData.is_default);
      }
      if (updateData.status !== undefined) {
        updateData.status = Number(updateData.status) === 2 ? 2 : 1;
      }

      if (req.file) {
        updateData.qr_code_image = req.file.filePath;
        if (existing.qr_code_image && existing.qr_code_image !== updateData.qr_code_image) {
          const CloudStorageService = require('../services/cloudStorage.service');
          await CloudStorageService.deleteFile(existing.qr_code_image);
        }
      } else if (updateData.qr_code_image && String(updateData.qr_code_image).startsWith('data:')) {
        const { saveBase64File } = require('../utils/file.util');
        updateData.qr_code_image = await saveBase64File(updateData.qr_code_image, 'bank_accounts', 'bank_qr', {
          skipQuotaCheck: true,
        });
        if (existing.qr_code_image && existing.qr_code_image !== updateData.qr_code_image) {
          const CloudStorageService = require('../services/cloudStorage.service');
          await CloudStorageService.deleteFile(existing.qr_code_image);
        }
      } else if (
        updateData.qr_code_image !== undefined &&
        (updateData.qr_code_image === null ||
          String(updateData.qr_code_image).trim() === '' ||
          updateData.qr_code_image === 'null')
      ) {
        updateData.qr_code_image = null;
        if (existing.qr_code_image) {
          const CloudStorageService = require('../services/cloudStorage.service');
          await CloudStorageService.deleteFile(existing.qr_code_image);
        }
      }
      if (updateData.ifsc_code) {
        updateData.ifsc_code = String(updateData.ifsc_code).trim().toUpperCase();
      }

      const updatedAccount = await BankAccountMasterModel.update(id, updateData);
      return ApiResponse.success(res, 'Bank account updated successfully.', updatedAccount);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /bank-accounts/:id
   * Delete bank account (Super Admin)
   */
  static async delete(req, res, next) {
    try {
      const id = extractBankAccountId(req);
      if (!id) {
        return ApiResponse.error(res, 'Valid bank account ID is required.', null, 400);
      }
      const existing = await BankAccountMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.error(res, 'Bank account not found.', null, 404);
      }

      const deleted = await BankAccountMasterModel.delete(id);
      if (!deleted) {
        return ApiResponse.error(res, 'Failed to delete bank account.', null, 400);
      }

      if (existing.qr_code_image) {
        const CloudStorageService = require('../services/cloudStorage.service');
        await CloudStorageService.deleteFile(existing.qr_code_image);
      }

      return ApiResponse.success(res, 'Bank account deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /bank-accounts/:id/status
   * Toggle active/inactive status (Super Admin)
   */
  static async toggleStatus(req, res, next) {
    try {
      const id = extractBankAccountId(req);
      if (!id) {
        return ApiResponse.error(res, 'Valid bank account ID is required.', null, 400);
      }
      const { status } = req.body;

      const existing = await BankAccountMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.error(res, 'Bank account not found.', null, 404);
      }

      const updated = await BankAccountMasterModel.toggleStatus(id, status);
      return ApiResponse.success(res, 'Bank account status updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /bank-accounts/:id/default
   * Set account as primary default (Super Admin)
   */
  static async setDefault(req, res, next) {
    try {
      const id = extractBankAccountId(req);
      if (!id) {
        return ApiResponse.error(res, 'Valid bank account ID is required.', null, 400);
      }
      const existing = await BankAccountMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.error(res, 'Bank account not found.', null, 404);
      }

      const updated = await BankAccountMasterModel.setDefault(id);
      return ApiResponse.success(res, 'Bank account marked as default successfully.', updated);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = BankAccountMasterController;
