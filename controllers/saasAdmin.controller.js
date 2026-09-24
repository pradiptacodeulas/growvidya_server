const SaasAdminModel = require('../models/saasAdmin.model');
const ApiResponse = require('../utils/api.response');
const { generateToken } = require('../utils/jwt.util');
const { comparePassword } = require('../utils/password.util');

class SaasAdminController {
  // ========================================================
  // 1. AUTHENTICATION & PROFILE
  // ========================================================
  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

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
          gender: user.gender || null,
          profile_image: user.profile_image || null,
          phone_number: user.phone_number || null,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
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
      const { first_name, last_name, gender, profile_image, phone_number, name, email, password } = req.body;

      if (email && !email.includes('@')) {
        return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
      }

      if (email && email.toLowerCase().trim() !== req.saasAdmin.email.toLowerCase().trim()) {
        const existing = await SaasAdminModel.findByEmail(email);
        if (existing && existing.id !== req.saasAdmin.id) {
          return ApiResponse.error(res, 'This email address is already in use by another admin.', null, 400);
        }
      }

      const updated = await SaasAdminModel.updateProfile(req.saasAdmin.id, {
        first_name,
        last_name,
        gender,
        profile_image,
        phone_number,
        name,
        email,
        password,
      });

      if (!updated) {
        return ApiResponse.error(res, 'No changes made or update failed.', null, 400);
      }

      const user = await SaasAdminModel.findById(req.saasAdmin.id);
      return ApiResponse.success(res, 'Profile updated successfully.', user);
    } catch (error) {
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
      const { plan_name, plan_code, description, price, billing_cycle, max_students, max_teachers, features_json, status } = req.body;

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
        max_students,
        max_teachers,
        features_json,
        status: status !== undefined ? status : 1,
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
  // 6. COUPON MANAGEMENT
  // ========================================================
  static async getCoupons(req, res, next) {
    try {
      const { search, status } = req.query;
      const coupons = await SaasAdminModel.getAllCoupons({ search, status });
      return ApiResponse.success(res, 'Coupons retrieved successfully.', coupons);
    } catch (error) {
      next(error);
    }
  }

  static async getCouponById(req, res, next) {
    try {
      const { id } = req.params;
      const coupon = await SaasAdminModel.getCouponById(id);
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
}

module.exports = SaasAdminController;
