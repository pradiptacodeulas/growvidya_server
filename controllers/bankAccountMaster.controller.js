const BankAccountMasterModel = require('../models/bankAccountMaster.model');
const ApiResponse = require('../utils/api.response');

class BankAccountMasterController {
  /**
   * GET /bank-accounts
   * List all bank accounts (with optional ?search= & ?status=)
   */
  static async getAll(req, res, next) {
    try {
      const { search, status } = req.query;
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
      const accounts = await BankAccountMasterModel.getActive();
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
      const { id } = req.params;
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
        return ApiResponse.error(
          res,
          'Required fields: account_title, beneficiary_name, account_number, bank_name, and ifsc_code are mandatory.',
          null,
          400
        );
      }

      const newAccount = await BankAccountMasterModel.create({
        account_title: String(account_title).trim(),
        beneficiary_name: String(beneficiary_name).trim(),
        account_number: String(account_number).trim(),
        bank_name: String(bank_name).trim(),
        branch_name: branch_name ? String(branch_name).trim() : null,
        ifsc_code: String(ifsc_code).trim().toUpperCase(),
        account_type: account_type ? String(account_type).trim() : 'Current',
        upi_id: upi_id ? String(upi_id).trim() : null,
        swift_code: swift_code ? String(swift_code).trim() : null,
        instructions: instructions ? String(instructions).trim() : null,
        qr_code_image: qr_code_image || null,
        is_default: is_default ? 1 : 0,
        status: status !== undefined ? (Number(status) ? 1 : 0) : 1,
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
      const { id } = req.params;
      const existing = await BankAccountMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.error(res, 'Bank account not found.', null, 404);
      }

      const updateData = { ...req.body };
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
      const { id } = req.params;
      const existing = await BankAccountMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.error(res, 'Bank account not found.', null, 404);
      }

      const deleted = await BankAccountMasterModel.delete(id);
      if (!deleted) {
        return ApiResponse.error(res, 'Failed to delete bank account.', null, 400);
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
      const { id } = req.params;
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
      const { id } = req.params;
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
