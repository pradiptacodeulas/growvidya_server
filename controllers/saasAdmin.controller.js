const path = require('path');
const SaasAdminModel = require('../models/saasAdmin.model');
const SaasRoleModel = require('../models/saasRole.model');
const CouponModel = require('../models/coupon.model');
const SubscriptionItemModel = require('../models/subscriptionItem.model');
const ApiResponse = require('../utils/api.response');
const { generateToken } = require('../utils/jwt.util');
const { comparePassword } = require('../utils/password.util');

class SaasAdminController {
  // ========================================================
  // 1. AUTHENTICATION & PROFILE
  // ========================================================
  static async login(req, res, next) {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return ApiResponse.error(res, 'Email and password are required.', null, 400);
      }

      const user = await SaasAdminModel.findByEmail(email);
      if (!user) {
        return ApiResponse.error(res, 'Invalid email or password.', null, 401);
      }

      if (user.status !== 1) {
        return ApiResponse.error(res, 'Your SaaS Admin account has been deactivated. Please contact the administrator.', null, 403);
      }

      const isMatch = await comparePassword(password, user.password);
      if (!isMatch) {
        return ApiResponse.error(res, 'Invalid email or password.', null, 401);
      }

      // Generate token specifically for SaaSAdminPortal
      const token = generateToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        roleId: user.role_id || null,
        portalType: 'SaaSAdminPortal',
      });

      // Set cookie for browser sessions
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      };
      res.cookie('saas_admin_token', token, cookieOptions);
      res.cookie('growvidya_saas_admin_session', token, cookieOptions);

      return ApiResponse.success(res, 'Login successful.', {
        token,
        user: {
          id: user.id,
          first_name: user.first_name || null,
          last_name: user.last_name || null,
          gender: user.gender !== null && user.gender !== undefined ? Number(user.gender) : null,
          gender_id: user.gender !== null && user.gender !== undefined ? Number(user.gender) : null,
          gender_name: user.gender_name || null,
          profile_image: user.profile_image || null,
          phone_number: user.phone_number || null,
          email: user.email,
          role: user.role,
          role_id: user.role_id || null,
          role_name: user.role_name || null,
          status: user.status,
          permissions: user.permissions || [],
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getProfile(req, res, next) {
    try {
      const user = await SaasAdminModel.findById(req.saasAdmin.id);
      if (!user) {
        return ApiResponse.notFound(res, 'Admin user not found.');
      }
      return ApiResponse.success(res, 'Profile fetched successfully.', user);
    } catch (error) {
      next(error);
    }
  }

  static async getGenders(req, res, next) {
    try {
      const genders = await SaasAdminModel.getGenders();
      return ApiResponse.success(res, 'Genders retrieved successfully.', genders);
    } catch (error) {
      next(error);
    }
  }

  static async logout(req, res, next) {
    try {
      res.clearCookie('saas_admin_token');
      res.clearCookie('growvidya_saas_admin_session');
      return ApiResponse.success(res, 'Logged out successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req, res, next) {
    try {
      const body = req.body || {};
      let profile_image = body.profile_image;
      if (req.file) {
        const uploadRoot = path.join(__dirname, '../public/upload');
        let folderRel = '';
        if (req.file.destination) {
          folderRel = path.relative(uploadRoot, req.file.destination).replace(/\\/g, '/');
        }
        const cleanFolder = folderRel && folderRel !== '.' ? `${folderRel.replace(/^\/+|\/+$/g, '')}/` : '';
        profile_image = `/upload/${cleanFolder}${req.file.filename}`;
      }

      const { first_name, last_name, gender, gender_id, phone_number, email, name } = body;

      const hasFields =
        first_name !== undefined ||
        last_name !== undefined ||
        gender !== undefined ||
        gender_id !== undefined ||
        profile_image !== undefined ||
        phone_number !== undefined ||
        email !== undefined ||
        name !== undefined;

      if (!hasFields) {
        return ApiResponse.error(res, 'Request body is required and must contain at least one field to update.', null, 400);
      }

      if (first_name !== undefined && (!first_name || String(first_name).trim() === '')) {
        return ApiResponse.error(res, 'First name cannot be empty.', null, 400);
      }

      if (email !== undefined) {
        if (!email || !email.includes('@') || !email.includes('.')) {
          return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
        }
        if (email.toLowerCase().trim() !== req.saasAdmin.email.toLowerCase().trim()) {
          const existing = await SaasAdminModel.findByEmail(email);
          if (existing && existing.id !== req.saasAdmin.id) {
            return ApiResponse.error(res, 'This email address is already in use by another admin.', null, 400);
          }
        }
      }

      if (phone_number !== undefined && phone_number !== null && String(phone_number).trim() !== '') {
        const cleanPhone = String(phone_number).replace(/[\s\-\(\)]/g, '');
        if (!/^\+?[0-9]{7,15}$/.test(cleanPhone)) {
          return ApiResponse.error(res, 'Please provide a valid phone number (7 to 15 digits).', null, 400);
        }
      }

      const updated = await SaasAdminModel.updateProfile(req.saasAdmin.id, {
        first_name,
        last_name,
        gender,
        gender_id,
        profile_image,
        phone_number,
        email,
        name,
      });

      if (!updated) {
        return ApiResponse.error(res, 'No changes made or update failed.', null, 400);
      }

      const user = await SaasAdminModel.findById(req.saasAdmin.id);
      return ApiResponse.success(res, 'Profile updated successfully.', user);
    } catch (error) {
      if (error.statusCode === 400 || (error.message && error.message.includes('Invalid gender'))) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  // ========================================================
  // 2. DASHBOARD & ANALYTICS
  // ========================================================
  static async getDashboardStats(req, res, next) {
    try {
      const stats = await SaasAdminModel.getDashboardStats();
      return ApiResponse.success(res, 'Dashboard statistics fetched successfully.', stats);
    } catch (error) {
      next(error);
    }
  }

  // ========================================================
  // 3. SCHOOL MANAGEMENT
  // ========================================================
  static async getSchools(req, res, next) {
    try {
      const { search, status, subscriptionStatus, page, limit } = req.query;
      const result = await SaasAdminModel.getSchools({
        search,
        status,
        subscriptionStatus,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Schools retrieved successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  static async getSchoolById(req, res, next) {
    try {
      const { id } = req.params;
      const school = await SaasAdminModel.getSchoolById(id);
      if (!school) {
        return ApiResponse.notFound(res, 'School not found.');
      }
      return ApiResponse.success(res, 'School details fetched successfully.', school);
    } catch (error) {
      next(error);
    }
  }

  static async updateSchoolStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.error(res, 'Status must be 1 (active) or 0 (inactive).', null, 400);
      }

      const success = await SaasAdminModel.updateSchoolStatus(id, status);
      if (!success) {
        return ApiResponse.notFound(res, 'School not found or status already updated.');
      }

      return ApiResponse.success(res, `School status successfully updated to ${parseInt(status, 10) === 1 ? 'Active' : 'Inactive'}.`);
    } catch (error) {
      next(error);
    }
  }

  static async updateSchool(req, res, next) {
    try {
      const { id } = req.params;
      const success = await SaasAdminModel.updateSchool(id, req.body);
      if (!success) {
        return ApiResponse.error(res, 'Failed to update school or no changes made.', null, 400);
      }
      const updatedSchool = await SaasAdminModel.getSchoolById(id);
      return ApiResponse.success(res, 'School details updated successfully.', updatedSchool);
    } catch (error) {
      next(error);
    }
  }

  // ========================================================
  // 4. SUBSCRIPTION & PAYMENT VERIFICATION
  // ========================================================
  static async getSubscriptions(req, res, next) {
    try {
      const { search, status, paymentStatus, planId, page, limit } = req.query;
      const result = await SaasAdminModel.getSubscriptions({
        search,
        status,
        paymentStatus,
        planId,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Subscriptions retrieved successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  static async getSubscriptionById(req, res, next) {
    try {
      const { id } = req.params;
      const subscription = await SaasAdminModel.getSubscriptionById(id);
      if (!subscription) {
        return ApiResponse.notFound(res, 'Subscription record not found.');
      }
      return ApiResponse.success(res, 'Subscription details fetched successfully.', subscription);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Approve a school's pending subscription plan
   */
  static async approveSubscription(req, res, next) {
    try {
      const { id } = req.params;
      const { verificationNotes, startDate, endDate } = req.body;

      const existing = await SaasAdminModel.getSubscriptionById(id);
      if (!existing) {
        return ApiResponse.notFound(res, 'Subscription record not found.');
      }

      const approved = await SaasAdminModel.approveSubscription(id, {
        verifiedBy: req.saasAdmin?.id || null,
        verificationNotes,
        startDate,
        endDate,
      });

      return ApiResponse.success(
        res,
        `🎉 Plan "${approved.plan_name}" for ${approved.school_name} has been approved and is now active!`,
        approved
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reject a school's pending subscription plan
   */
  static async rejectSubscription(req, res, next) {
    try {
      const { id } = req.params;
      const { rejectionReason, notes } = req.body;

      const existing = await SaasAdminModel.getSubscriptionById(id);
      if (!existing) {
        return ApiResponse.notFound(res, 'Subscription record not found.');
      }

      const rejected = await SaasAdminModel.rejectSubscription(id, {
        verifiedBy: req.saasAdmin?.id || null,
        rejectionReason: rejectionReason || notes || 'Rejected by Super Admin',
      });

      return ApiResponse.success(
        res,
        `Plan request for ${rejected.school_name} has been rejected.`,
        rejected
      );
    } catch (error) {
      next(error);
    }
  }

  static async verifySubscriptionPayment(req, res, next) {
    try {
      const { id } = req.params;
      const { paymentStatus, status, verificationNotes, startDate, endDate } = req.body;

      if (!paymentStatus) {
        return ApiResponse.error(res, 'Payment status is required (completed, pending, or failed).', null, 400);
      }

      const existing = await SaasAdminModel.getSubscriptionById(id);
      if (!existing) {
        return ApiResponse.notFound(res, 'Subscription not found.');
      }

      const success = await SaasAdminModel.verifySubscriptionPayment(id, {
        paymentStatus,
        status: status || (paymentStatus === 'completed' ? 'active' : 'suspended'),
        verificationNotes: verificationNotes || '',
        verifiedBy: req.saasAdmin.id,
        startDate,
        endDate,
      });

      if (!success) {
        return ApiResponse.error(res, 'Failed to verify subscription payment.', null, 400);
      }

      const updated = await SaasAdminModel.getSubscriptionById(id);
      return ApiResponse.success(res, 'Subscription payment verification updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  static async updateSubscriptionStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !['trial', 'active', 'expired', 'suspended'].includes(status)) {
        return ApiResponse.error(res, 'Invalid status. Allowed: trial, active, expired, suspended.', null, 400);
      }

      const success = await SaasAdminModel.updateSubscriptionStatus(id, status);
      if (!success) {
        return ApiResponse.notFound(res, 'Subscription not found.');
      }

      return ApiResponse.success(res, `Subscription status updated to '${status}'.`);
    } catch (error) {
      next(error);
    }
  }

  static async extendSubscription(req, res, next) {
    try {
      const { id } = req.params;
      const { endDate, notes } = req.body;

      if (!endDate) {
        return ApiResponse.error(res, 'New expiry date (endDate) is required.', null, 400);
      }

      const success = await SaasAdminModel.extendSubscription(id, {
        endDate,
        notes,
        verifiedBy: req.saasAdmin.id,
      });

      if (!success) {
        return ApiResponse.notFound(res, 'Subscription not found.');
      }

      const updated = await SaasAdminModel.getSubscriptionById(id);
      return ApiResponse.success(res, 'Subscription expiry extended successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  // ========================================================
  // 5. PACKAGE / SUBSCRIPTION PLAN MANAGEMENT
  // ========================================================
  static async getPackages(req, res, next) {
    try {
      const { search, status } = req.query;
      const packages = await SaasAdminModel.getAllPackages({ search, status });
      return ApiResponse.success(res, 'Subscription packages retrieved successfully.', packages);
    } catch (error) {
      next(error);
    }
  }

  static async getPackageById(req, res, next) {
    try {
      const { id } = req.params;
      const pkg = await SaasAdminModel.getPackageById(id);
      if (!pkg) {
        return ApiResponse.notFound(res, 'Package not found.');
      }
      return ApiResponse.success(res, 'Package details fetched successfully.', pkg);
    } catch (error) {
      next(error);
    }
  }

  static async createPackage(req, res, next) {
    try {
      const { plan_name, plan_code, description, price, billing_cycle, free_trial_days, max_students, status, items } = req.body;

      if (!plan_name || plan_name.trim() === '') {
        return ApiResponse.error(res, 'Plan name is required.', null, 400);
      }

      if (price === undefined || price === null || isNaN(price)) {
        return ApiResponse.error(res, 'Valid plan price is required.', null, 400);
      }

      const newId = await SaasAdminModel.createPackage({
        plan_name,
        plan_code,
        description,
        price,
        billing_cycle,
        free_trial_days,
        max_students,
        status: status !== undefined ? status : 1,
        items: items || [],
      });

      const pkg = await SaasAdminModel.getPackageById(newId);
      return ApiResponse.created(res, 'Package created successfully.', pkg);
    } catch (error) {
      next(error);
    }
  }

  static async updatePackage(req, res, next) {
    try {
      const { id } = req.params;
      const pkg = await SaasAdminModel.getPackageById(id);
      if (!pkg) {
        return ApiResponse.notFound(res, 'Package not found.');
      }

      const success = await SaasAdminModel.updatePackage(id, req.body);
      if (!success) {
        return ApiResponse.error(res, 'No changes made or update failed.', null, 400);
      }

      const updated = await SaasAdminModel.getPackageById(id);
      return ApiResponse.success(res, 'Package updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  static async deletePackage(req, res, next) {
    try {
      const { id } = req.params;
      const pkg = await SaasAdminModel.getPackageById(id);
      if (!pkg) {
        return ApiResponse.notFound(res, 'Package not found.');
      }

      const result = await SaasAdminModel.deletePackage(id);
      if (result.softDeleted) {
        return ApiResponse.success(res, 'Package is in use by schools and has been deactivated (soft-deleted).');
      }
      return ApiResponse.success(res, 'Package deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async togglePackageStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.error(res, 'Status must be 0 or 1.', null, 400);
      }

      const success = await SaasAdminModel.togglePackageStatus(id, status);
      if (!success) {
        return ApiResponse.notFound(res, 'Package not found.');
      }

      return ApiResponse.success(res, `Package ${parseInt(status, 10) === 1 ? 'activated' : 'deactivated'} successfully.`);
    } catch (error) {
      next(error);
    }
  }

  // ========================================================
  // 5b. SUBSCRIPTION ITEMS / ADD-ONS MANAGEMENT
  // ========================================================
  static async getPackageItems(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.query;
      const items = await SubscriptionItemModel.getByPlanId(id, { status });
      return ApiResponse.success(res, 'Subscription items retrieved successfully.', items);
    } catch (error) {
      next(error);
    }
  }

  static async addPackageItem(req, res, next) {
    try {
      const { id } = req.params;
      const { item_name, item_code, item_type, price, quota_limit, unit, billing_type, description, status, display_order } = req.body;

      if (!item_name || !item_name.trim()) {
        return ApiResponse.error(res, 'Item name is required.', null, 400);
      }

      const newItemId = await SubscriptionItemModel.create({
        sub_id: id,
        item_name,
        item_code,
        item_type,
        price,
        quota_limit,
        unit,
        billing_type,
        description,
        status,
        display_order,
      });

      const newItem = await SubscriptionItemModel.getById(newItemId);
      return ApiResponse.created(res, 'Subscription item added successfully.', newItem);
    } catch (error) {
      next(error);
    }
  }

  static async updatePackageItem(req, res, next) {
    try {
      const { itemId } = req.params;
      const existing = await SubscriptionItemModel.getById(itemId);
      if (!existing) {
        return ApiResponse.notFound(res, 'Subscription item not found.');
      }

      await SubscriptionItemModel.update(itemId, req.body);
      const updated = await SubscriptionItemModel.getById(itemId);
      return ApiResponse.success(res, 'Subscription item updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  static async deletePackageItem(req, res, next) {
    try {
      const { itemId } = req.params;
      const existing = await SubscriptionItemModel.getById(itemId);
      if (!existing) {
        return ApiResponse.notFound(res, 'Subscription item not found.');
      }

      await SubscriptionItemModel.delete(itemId);
      return ApiResponse.success(res, 'Subscription item deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async togglePackageItemStatus(req, res, next) {
    try {
      const { itemId } = req.params;
      const { status } = req.body;

      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.error(res, 'Status must be 0 or 1.', null, 400);
      }

      const existing = await SubscriptionItemModel.getById(itemId);
      if (!existing) {
        return ApiResponse.notFound(res, 'Subscription item not found.');
      }

      await SubscriptionItemModel.toggleStatus(itemId, status);
      return ApiResponse.success(res, `Subscription item ${parseInt(status, 10) === 1 ? 'activated' : 'deactivated'} successfully.`);
    } catch (error) {
      next(error);
    }
  }

  // ========================================================
  static async getCoupons(req, res, next) {
    try {
      const { search, status, discount_type, discountType, page, limit, id, coupon_id, couponId, code } = req.query;

      // If specific coupon id or code is provided in query, body, or header, delegate to getCouponById
      const targetId =
        id ||
        coupon_id ||
        couponId ||
        code ||
        req.body?.id ||
        req.body?.coupon_id ||
        req.body?.code ||
        req.headers['x-coupon-id'];
      if (targetId && targetId !== ':id') {
        req.params.id = targetId;
        return SaasAdminController.getCouponById(req, res, next);
      }

      const result = await SaasAdminModel.getAllCoupons({
        search,
        status,
        discount_type: discount_type || discountType,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Coupons retrieved successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  static async getCouponById(req, res, next) {
    try {
      let { id } = req.params;

      // Fallback if id was passed as query or body parameter, or literal placeholder ':id'
      if (!id || id === ':id' || String(id).trim() === '') {
        id =
          req.query?.id ||
          req.query?.coupon_id ||
          req.query?.couponId ||
          req.query?.code ||
          req.body?.id ||
          req.body?.coupon_id ||
          req.body?.code ||
          req.headers['x-coupon-id'];
      }

      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.error(res, 'Coupon ID is required.', null, 400);
      }

      const trimmedId = String(id).trim();
      let coupon = null;
      if (/^\d+$/.test(trimmedId)) {
        coupon = await SaasAdminModel.getCouponById(Number(trimmedId));
      } else {
        coupon = await CouponModel.getByCode(trimmedId);
        if (coupon && coupon.id) {
          coupon = await SaasAdminModel.getCouponById(coupon.id);
        }
      }

      if (!coupon) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }
      return ApiResponse.success(res, 'Coupon details fetched successfully.', coupon);
    } catch (error) {
      next(error);
    }
  }

  static async createCoupon(req, res, next) {
    try {
      const {
        code,
        description,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        start_date,
        end_date,
        max_uses,
        status,
      } = req.body;

      if (!code || !code.trim()) {
        return ApiResponse.error(res, 'Coupon code is required.', null, 400);
      }

      if (!discount_value || isNaN(discount_value) || parseFloat(discount_value) <= 0) {
        return ApiResponse.error(res, 'Valid discount value is required.', null, 400);
      }

      if (discount_type && !['percentage', 'fixed'].includes(discount_type)) {
        return ApiResponse.error(res, 'Discount type must be percentage or fixed.', null, 400);
      }

      const newId = await SaasAdminModel.createCoupon({
        code,
        description,
        discount_type: discount_type || 'percentage',
        discount_value,
        min_order_amount,
        max_discount_amount,
        start_date,
        end_date,
        max_uses,
        status: status !== undefined ? status : 1,
      });

      const created = await SaasAdminModel.getCouponById(newId);
      return ApiResponse.created(res, 'Coupon created successfully.', created);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return ApiResponse.error(res, 'A coupon with this code already exists.', null, 400);
      }
      next(error);
    }
  }

  static async updateCoupon(req, res, next) {
    try {
      const { id } = req.params;
      const coupon = await SaasAdminModel.getCouponById(id);
      if (!coupon) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }

      const success = await SaasAdminModel.updateCoupon(id, req.body);
      if (!success) {
        return ApiResponse.error(res, 'No changes made or update failed.', null, 400);
      }

      const updated = await SaasAdminModel.getCouponById(id);
      return ApiResponse.success(res, 'Coupon updated successfully.', updated);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return ApiResponse.error(res, 'A coupon with this code already exists.', null, 400);
      }
      next(error);
    }
  }

  static async deleteCoupon(req, res, next) {
    try {
      const { id } = req.params;
      const coupon = await SaasAdminModel.getCouponById(id);
      if (!coupon) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }

      await SaasAdminModel.deleteCoupon(id);
      return ApiResponse.success(res, 'Coupon deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async toggleCouponStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.error(res, 'Status must be 0 or 1.', null, 400);
      }

      const success = await SaasAdminModel.toggleCouponStatus(id, status);
      if (!success) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }

      return ApiResponse.success(res, `Coupon ${parseInt(status, 10) === 1 ? 'activated' : 'deactivated'} successfully.`);
    } catch (error) {
      next(error);
    }
  }

  // ========================================================
  // 7. COUPON VALIDATION ENGINE
  // ========================================================
  static async validateCoupon(req, res, next) {
    try {
      const { code, amount, schoolId } = req.body;
      if (!code) {
        return ApiResponse.error(res, 'Coupon code is required.', null, 400);
      }

      const result = await SaasAdminModel.validateCoupon(code, amount || 0, schoolId);
      if (!result.valid) {
        return ApiResponse.error(res, result.message, null, 400);
      }

      return ApiResponse.success(res, result.message, result.coupon);
    } catch (error) {
      next(error);
    }
  }

  // ========================================================
  // 8. MODULES & ROLES MANAGEMENT
  // ========================================================
  static async getModules(req, res, next) {
    try {
      const modules = await SaasRoleModel.getModules();
      return ApiResponse.success(res, 'SaaS modules retrieved successfully.', modules);
    } catch (error) {
      next(error);
    }
  }

  static async getRoles(req, res, next) {
    try {
      const { search, status } = req.query;
      const roles = await SaasRoleModel.getAllRoles({ search, status });
      return ApiResponse.success(res, 'SaaS roles retrieved successfully.', roles);
    } catch (error) {
      next(error);
    }
  }

  static async getRoleById(req, res, next) {
    try {
      const { id } = req.params;
      const role = await SaasRoleModel.getRoleById(id);
      if (!role) {
        return ApiResponse.notFound(res, 'Role not found.');
      }
      return ApiResponse.success(res, 'Role details retrieved successfully.', role);
    } catch (error) {
      next(error);
    }
  }

  static async createRole(req, res, next) {
    try {
      const { role_name, description, permissions } = req.body;
      if (!role_name || !String(role_name).trim()) {
        return ApiResponse.error(res, 'Role name is required.', null, 400);
      }

      const role = await SaasRoleModel.createRole({
        role_name,
        description,
        permissions,
      });
      return ApiResponse.success(res, 'Role created successfully.', role, 201);
    } catch (error) {
      if (error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  static async updateRole(req, res, next) {
    try {
      const { id } = req.params;
      const { role_name, description, status, permissions } = req.body;

      const role = await SaasRoleModel.updateRole(id, {
        role_name,
        description,
        status,
        permissions,
      });
      if (!role) {
        return ApiResponse.notFound(res, 'Role not found.');
      }
      return ApiResponse.success(res, 'Role updated successfully.', role);
    } catch (error) {
      if (error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  static async deleteRole(req, res, next) {
    try {
      const { id } = req.params;
      const result = await SaasRoleModel.deleteRole(id);
      if (result.notFound) {
        return ApiResponse.notFound(res, 'Role not found.');
      }
      return ApiResponse.success(res, 'Role deleted successfully.');
    } catch (error) {
      if (error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  // ========================================================
  // 9. SUB ADMIN USERS MANAGEMENT
  // ========================================================
  static async getSubAdmins(req, res, next) {
    try {
      const { search, status, role_id, page, limit } = req.query;
      const result = await SaasRoleModel.getAllSubAdmins({
        search,
        status,
        role_id,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Sub-admin users retrieved successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  static async getSubAdminById(req, res, next) {
    try {
      const { id } = req.params;
      const subAdmin = await SaasRoleModel.getSubAdminById(id);
      if (!subAdmin) {
        return ApiResponse.notFound(res, 'Sub-admin user not found.');
      }
      return ApiResponse.success(res, 'Sub-admin details retrieved successfully.', subAdmin);
    } catch (error) {
      next(error);
    }
  }

  static async createSubAdmin(req, res, next) {
    try {
      const body = req.body || {};
      let profile_image = body.profile_image;
      if (req.file) {
        const uploadRoot = path.join(__dirname, '../public/upload');
        let folderRel = '';
        if (req.file.destination) {
          folderRel = path.relative(uploadRoot, req.file.destination).replace(/\\/g, '/');
        }
        const cleanFolder = folderRel && folderRel !== '.' ? `${folderRel.replace(/^\/+|\/+$/g, '')}/` : '';
        profile_image = `/upload/${cleanFolder}${req.file.filename}`;
      }

      const {
        first_name,
        last_name,
        email,
        password,
        gender,
        gender_id,
        phone_number,
        role_id,
        status,
      } = body;

      if (!first_name || !String(first_name).trim()) {
        return ApiResponse.error(res, 'First name is required.', null, 400);
      }
      if (!email || !email.includes('@') || !email.includes('.')) {
        return ApiResponse.error(res, 'A valid email address is required.', null, 400);
      }
      if (!password || password.length < 6) {
        return ApiResponse.error(res, 'Password is required and must be at least 6 characters.', null, 400);
      }
      if (!role_id) {
        return ApiResponse.error(res, 'A valid role_id is required.', null, 400);
      }

      if (phone_number && !/^\+?[0-9]{7,15}$/.test(String(phone_number).replace(/[\s\-\(\)]/g, ''))) {
        return ApiResponse.error(res, 'Please provide a valid phone number (7 to 15 digits).', null, 400);
      }

      const subAdmin = await SaasRoleModel.createSubAdmin({
        first_name,
        last_name,
        email,
        password,
        gender: gender_id !== undefined ? gender_id : gender,
        phone_number,
        profile_image,
        role_id,
        status,
      });

      return ApiResponse.success(res, 'Sub-admin user created successfully.', subAdmin, 201);
    } catch (error) {
      if (error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  static async updateSubAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const body = req.body || {};
      let profile_image = body.profile_image;
      if (req.file) {
        const uploadRoot = path.join(__dirname, '../public/upload');
        let folderRel = '';
        if (req.file.destination) {
          folderRel = path.relative(uploadRoot, req.file.destination).replace(/\\/g, '/');
        }
        const cleanFolder = folderRel && folderRel !== '.' ? `${folderRel.replace(/^\/+|\/+$/g, '')}/` : '';
        profile_image = `/upload/${cleanFolder}${req.file.filename}`;
      }

      const {
        first_name,
        last_name,
        email,
        password,
        gender,
        gender_id,
        phone_number,
        role_id,
        status,
      } = body;

      if (first_name !== undefined && String(first_name).trim() === '') {
        return ApiResponse.error(res, 'First name cannot be empty.', null, 400);
      }
      if (email !== undefined && (!email.includes('@') || !email.includes('.'))) {
        return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
      }
      if (password !== undefined && password && password.length < 6) {
        return ApiResponse.error(res, 'Password must be at least 6 characters long.', null, 400);
      }
      if (phone_number !== undefined && phone_number !== null && String(phone_number).trim() !== '') {
        if (!/^\+?[0-9]{7,15}$/.test(String(phone_number).replace(/[\s\-\(\)]/g, ''))) {
          return ApiResponse.error(res, 'Please provide a valid phone number (7 to 15 digits).', null, 400);
        }
      }

      const updated = await SaasRoleModel.updateSubAdmin(id, {
        first_name,
        last_name,
        email,
        password,
        gender,
        gender_id,
        phone_number,
        profile_image,
        role_id,
        status,
      });

      if (!updated) {
        return ApiResponse.notFound(res, 'Sub-admin user not found.');
      }

      return ApiResponse.success(res, 'Sub-admin user updated successfully.', updated);
    } catch (error) {
      if (error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  static async deleteSubAdmin(req, res, next) {
    try {
      const { id } = req.params;
      const result = await SaasRoleModel.deleteSubAdmin(id);
      if (result.notFound) {
        return ApiResponse.notFound(res, 'Sub-admin user not found.');
      }
      return ApiResponse.success(res, 'Sub-admin user deleted successfully.');
    } catch (error) {
      if (error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  static async toggleSubAdminStatus(req, res, next) {
    try {
      const { id } = req.params;
      const body = req.body || {};
      const { status } = body;
      if (status === undefined || (Number(status) !== 0 && Number(status) !== 1)) {
        return ApiResponse.error(res, 'Status must be 0 (inactive) or 1 (active).', null, 400);
      }

      const updated = await SaasRoleModel.toggleSubAdminStatus(id, status);
      if (!updated) {
        return ApiResponse.notFound(res, 'Sub-admin user not found.');
      }

      const user = await SaasRoleModel.getSubAdminById(id);
      return ApiResponse.success(res, `Sub-admin status updated to ${status == 1 ? 'active' : 'inactive'}.`, user);
    } catch (error) {
      if (error.statusCode === 400) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }
}

module.exports = SaasAdminController;
