const bcrypt = require('bcryptjs');
const { pool } = require('../config/db.config');
const BranchModel = require('../models/branch.model');
const PasscodeService = require('../services/passcode.service');
const ApiResponse = require('../utils/api.response');
const { hasGeoFields, normalizeBranchLocation } = require('../utils/branchLocation.util');

class BranchController {
  /**
   * Helper to get schoolId from req.user
   */
  static getSchoolId(req) {
    const schoolId = Number(req.user?.schoolId || req.user?.school_id);
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }
    return schoolId;
  }

  /**
   * Get all branches for current user's school
   */
  static async getBranches(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { status } = req.query;

      const branches = await BranchModel.getAllBranches({
        school_id: schoolId,
        status: status !== undefined ? status : null,
      });

      return ApiResponse.success(res, 'Branches retrieved successfully.', branches);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get branch summary with statistics
   */
  static async getBranchesSummary(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const summary = await BranchModel.getBranchesSummary(schoolId);
      return ApiResponse.success(res, 'Branches summary retrieved successfully.', summary);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get list of staff candidates for branch head
   */
  static async getBranchHeadCandidates(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const candidates = await BranchModel.getBranchHeadCandidates(schoolId);
      return ApiResponse.success(res, 'Branch head candidates retrieved.', candidates);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single branch details by ID
   */
  static async getBranchById(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      const branch = await BranchModel.getBranchById(Number(id), schoolId);
      if (!branch) {
        return ApiResponse.error(res, 'Branch not found.', null, 404);
      }

      return ApiResponse.success(res, 'Branch details retrieved.', branch);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new branch
   */
  static async createBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const {
        branch_name,
        branch_code,
        head_user_id,
        address,
        country_id,
        state_id,
        city_id,
        pincode,
        phone,
        email,
        principal_name,
        is_main_branch,
        status,
      } = req.body;

      if (!branch_name || !branch_code) {
        return ApiResponse.error(res, 'Branch name and branch code are required.', null, 400);
      }

      // Check if branch code already exists for this school
      const existing = await BranchModel.getAllBranches({ school_id: schoolId });
      const duplicateCode = existing.some(
        (b) => b.branch_code?.toLowerCase() === String(branch_code).trim().toLowerCase()
      );
      if (duplicateCode) {
        return ApiResponse.error(res, `Branch code "${branch_code}" is already in use in this school.`, null, 400);
      }

      // Validate attendance location (geofence) fields
      let geo = null;
      if (hasGeoFields(req.body)) {
        const { value, error } = normalizeBranchLocation(req.body);
        if (error) {
          return ApiResponse.error(res, error, null, 400);
        }
        geo = value;
      }

      const newBranch = await BranchModel.createBranch({
        school_id: schoolId,
        branch_name,
        branch_code,
        head_user_id,
        address,
        country_id,
        state_id,
        city_id,
        pincode,
        phone,
        email,
        principal_name,
        is_main_branch,
        status,
      });

      if (geo && newBranch?.id) {
        await BranchModel.updateAttendanceLocation(newBranch.id, schoolId, geo);
        Object.assign(newBranch, geo);
      }

      return ApiResponse.success(res, 'Branch created successfully.', newBranch, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update an existing branch
   */
  static async updateBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      const existing = await BranchModel.getBranchById(Number(id), schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Branch not found.', null, 404);
      }

      // If branch_code is being changed, check for duplicate
      if (req.body.branch_code && req.body.branch_code.trim().toUpperCase() !== existing.branch_code) {
        const allBranches = await BranchModel.getAllBranches({ school_id: schoolId });
        const duplicate = allBranches.some(
          (b) =>
            b.id !== Number(id) &&
            b.branch_code?.toLowerCase() === req.body.branch_code.trim().toLowerCase()
        );
        if (duplicate) {
          return ApiResponse.error(
            res,
            `Branch code "${req.body.branch_code}" is already in use by another branch.`,
            null,
            400
          );
        }
      }

      // Validate attendance location (geofence) fields before any write
      let geo = null;
      if (hasGeoFields(req.body)) {
        const { value, error } = normalizeBranchLocation(req.body, existing);
        if (error) {
          return ApiResponse.error(res, error, null, 400);
        }
        geo = value;
      }

      await BranchModel.updateBranch(Number(id), schoolId, req.body);
      if (geo) {
        await BranchModel.updateAttendanceLocation(Number(id), schoolId, geo);
      }
      const updated = await BranchModel.getBranchById(Number(id), schoolId);

      return ApiResponse.success(res, 'Branch updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update only the attendance location (geofence) of a branch
   * PATCH /admin/branches/:id/attendance-location
   */
  static async updateAttendanceLocation(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      const existing = await BranchModel.getBranchById(Number(id), schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Branch not found.', null, 404);
      }

      const { value, error } = normalizeBranchLocation(req.body || {}, existing);
      if (error) {
        return ApiResponse.error(res, error, null, 400);
      }

      await BranchModel.updateAttendanceLocation(Number(id), schoolId, value);
      const updated = await BranchModel.getBranchById(Number(id), schoolId);

      return ApiResponse.success(res, 'Attendance location updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Set a branch as the main campus
   */
  static async setMainBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const { id } = req.params;

      const success = await BranchModel.setMainBranch(Number(id), schoolId);
      if (!success) {
        return ApiResponse.error(res, 'Failed to set main branch.', null, 400);
      }

      return ApiResponse.success(res, 'Primary main branch updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Step 2 of Branch Deletion: Verify School Super Admin password and send 6-digit OTP
   * POST /api/v1/admin/branches/:id/request-delete-otp
   */
  static async requestDeleteBranchOtp(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const userId = Number(req.user?.id || req.user?.userId);
      const { id } = req.params;
      const { password } = req.body || {};

      if (!password || !String(password).trim()) {
        return ApiResponse.error(res, 'Please enter your Super Admin account password to continue.', null, 400);
      }

      // Strictly verify the caller is the School Super Admin (admin_type = 1) in DB
      const [userRows] = await pool.query(
        'SELECT id, first_name, last_name, email, password, admin_type, status FROM user_master WHERE id = ? AND school_id = ? AND status = 1 LIMIT 1',
        [userId, schoolId]
      );
      const superAdmin = userRows[0];
      if (!superAdmin || Number(superAdmin.admin_type) !== 1) {
        return ApiResponse.error(
          res,
          'Only the School Super Admin is authorized to permanently delete a branch.',
          null,
          403
        );
      }

      const branch = await BranchModel.getBranchById(Number(id), schoolId);
      if (!branch || Number(branch.status) === 4) {
        return ApiResponse.error(res, 'Branch not found.', null, 404);
      }
      if (Number(branch.is_main_branch) === 1) {
        return ApiResponse.error(
          res,
          'Cannot delete the primary/main campus. Please designate another campus as the main branch first.',
          null,
          400
        );
      }

      const isPasswordValid = await bcrypt.compare(String(password), String(superAdmin.password || ''));
      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Incorrect password. Please enter your valid Super Admin password.', null, 401);
      }

      if (!superAdmin.email || !String(superAdmin.email).trim()) {
        return ApiResponse.error(
          res,
          'No email address is registered on your Super Admin profile to receive the confirmation OTP.',
          null,
          400
        );
      }

      const otpMode = await PasscodeService.getOtpMode();
      const isTest = otpMode === 'test';
      const otpCode = PasscodeService.generatePasscode();
      const expiresInMinutes = 10;

      await PasscodeService.storePasscode('user_master', superAdmin.id, otpCode, expiresInMinutes);

      const fullName = `${superAdmin.first_name || ''} ${superAdmin.last_name || ''}`.trim() || 'Super Admin';
      const maskedEmail = PasscodeService.maskIdentifier(superAdmin.email);

      if (!isTest) {
        await PasscodeService.sendActionOtpEmail({
          toEmail: superAdmin.email,
          toName: fullName,
          otpCode,
          actionTitle: `Confirm Permanent Deletion of "${branch.branch_name}"`,
          actionWarning: `You requested to permanently delete the branch "${branch.branch_name}" (${branch.branch_code}) along with all its students, teachers, classes, and campus records. Enter the 6-digit OTP below to confirm:`,
          expiresInMinutes,
        });

        return ApiResponse.success(
          res,
          `Password verified. A 6-digit confirmation OTP has been sent to ${maskedEmail}.`,
          {
            otpMode: 'production',
            maskedEmail,
            expiresInMinutes,
          }
        );
      }

      return ApiResponse.success(
        res,
        'Password verified. A 6-digit confirmation OTP has been generated.',
        {
          otpMode: 'test',
          maskedEmail,
          expiresInMinutes,
          testPasscode: otpCode,
        }
      );
    } catch (error) {
      return ApiResponse.error(res, error.message || 'Failed to send branch deletion OTP.', null, 400);
    }
  }

  /**
   * Step 3 of Branch Deletion: Verify 6-digit OTP and permanently delete branch + all its data
   * DELETE /api/v1/admin/branches/:id
   */
  static async deleteBranch(req, res, next) {
    try {
      const schoolId = BranchController.getSchoolId(req);
      const userId = Number(req.user?.id || req.user?.userId);
      const { id } = req.params;
      const otp = req.body?.otp || req.body?.passcode || req.query?.otp;

      // Strictly verify the caller is the School Super Admin (admin_type = 1) in DB
      const [userRows] = await pool.query(
        'SELECT id, admin_type, status FROM user_master WHERE id = ? AND school_id = ? AND status = 1 LIMIT 1',
        [userId, schoolId]
      );
      const superAdmin = userRows[0];
      if (!superAdmin || Number(superAdmin.admin_type) !== 1) {
        return ApiResponse.error(
          res,
          'Only the School Super Admin is authorized to permanently delete a branch.',
          null,
          403
        );
      }

      if (!otp || !String(otp).trim()) {
        return ApiResponse.error(
          res,
          'A valid 6-digit confirmation OTP is required to delete this branch.',
          null,
          400
        );
      }

      const verifyResult = await PasscodeService.verifyPasscode('user_master', superAdmin.id, otp);
      if (!verifyResult.valid) {
        return ApiResponse.error(res, verifyResult.message || 'Invalid or expired OTP.', null, 400);
      }

      await BranchModel.deleteBranch(Number(id), schoolId);
      return ApiResponse.success(
        res,
        'Branch and all associated students, teachers, classes, and campus records have been permanently deleted.'
      );
    } catch (error) {
      return ApiResponse.error(res, error.message || 'Failed to delete branch.', null, 400);
    }
  }

  /**
   * Get countries list from countries table
   */
  static async getCountries(req, res, next) {
    try {
      const countries = await BranchModel.getCountries();
      return ApiResponse.success(res, 'Countries retrieved successfully.', countries);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get states list for country
   */
  static async getStates(req, res, next) {
    try {
      const countryId = req.query.country_id || req.query.countryId;
      const states = await BranchModel.getStates(countryId);
      return ApiResponse.success(res, 'States retrieved successfully.', states);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get cities list for state
   */
  static async getCities(req, res, next) {
    try {
      const stateId = req.query.state_id || req.query.stateId;
      const cities = await BranchModel.getCities(stateId);
      return ApiResponse.success(res, 'Cities retrieved successfully.', cities);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = BranchController;
