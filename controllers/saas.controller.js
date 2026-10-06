const SaasModel = require('../models/saas.model');
const ApiResponse = require('../utils/api.response');

class SaasController {
  /**
   * Get all active subscription plans for public selection
   */
  static async getPlans(req, res, next) {
    try {
      const plans = await SaasModel.getActivePlans();
      return ApiResponse.success(res, 'Subscription plans fetched successfully.', plans);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get public configuration catalog (notification_master, storage_master, etc.)
   */
  static async getConfigCatalog(req, res, next) {
    try {
      const SubscriptionModel = require('../models/subscription.model');
      const catalog = await SubscriptionModel.getConfigurationCatalog();
      return ApiResponse.success(res, 'Configuration catalog fetched successfully.', catalog);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check trial eligibility dynamically for a specific plan and user/school
   */
  static async checkTrialEligibility(req, res, next) {
    try {
      const planId = req.query.plan_id || req.body.plan_id || req.body.planId;
      const email = req.query.email || req.body.email || (req.user?.email || null);
      const schoolCode = req.query.school_code || req.body.school_code || req.body.schoolCode;
      const phone = req.query.phone || req.body.phone;
      const schoolId = req.query.school_id || req.body.school_id || req.body.schoolId || (req.user?.schoolId || req.user?.school_id || null);

      if (!planId) {
        return ApiResponse.error(res, 'Please provide a plan ID to check trial eligibility.', null, 400);
      }

      const eligibility = await SaasModel.checkTrialEligibility({
        planId,
        email,
        schoolCode,
        phone,
        schoolId,
      });

      return ApiResponse.success(res, eligibility.reason, eligibility);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check availability of admin email, phone or school email, phone
   */
  static async checkAvailability(req, res, next) {
    try {
      const {
        admin_email,
        adminEmail,
        admin_phone,
        adminPhone,
        school_email,
        schoolEmail,
        school_phone,
        schoolPhone,
      } = { ...req.query, ...req.body };

      const result = await SaasModel.checkAvailability({
        adminEmail: admin_email || adminEmail,
        adminPhone: admin_phone || adminPhone,
        schoolEmail: school_email || schoolEmail,
        schoolPhone: school_phone || schoolPhone,
      });

      return ApiResponse.success(res, result.available ? 'Information is available.' : result.message, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Register a new school along with plan & superadmin
   */
  static async registerSchool(req, res, next) {
    try {
      const {
        plan_id,
        planId,
        amount_paid,
        amountPaid,
        payment_gateway,
        paymentGateway,
        payment_transaction_id,
        paymentTransactionId,
        school,
        academic_year,
        academicYear,
        admin,
        is_trial,
        isTrial,
        coupon_code,
        couponCode,
      } = req.body;

      const selectedPlanId = plan_id || planId;
      if (!selectedPlanId) {
        return ApiResponse.error(res, 'Please select a subscription plan.', null, 400);
      }

      if (!school || !school.school_name || !school.school_name.trim()) {
        return ApiResponse.error(res, 'School Name is required.', null, 400);
      }

      if (!admin || !admin.email || !admin.email.trim()) {
        return ApiResponse.error(res, 'Super Admin Email is required.', null, 400);
      }

      if (!admin.phone || !admin.phone.trim()) {
        return ApiResponse.error(res, 'Super Admin Phone number is required.', null, 400);
      }

      if (!admin.password || admin.password.length < 6) {
        return ApiResponse.error(res, 'Password must be at least 6 characters.', null, 400);
      }

      // Check duplicate admin and school contact information before proceeding
      const availability = await SaasModel.checkAvailability({
        adminEmail: admin.email,
        adminPhone: admin.phone,
        schoolEmail: school.email,
        schoolPhone: school.phone_number,
      });

      if (!availability.available) {
        return ApiResponse.error(res, availability.message, { field: availability.field }, 400);
      }

      const { pool } = require('../config/db.config');
      const [planRows] = await pool.query(
        'SELECT id, plan_name, price, billing_cycle, free_trial_days FROM subscription_plans WHERE id = ? LIMIT 1',
        [parseInt(selectedPlanId, 10)]
      );
      const targetPlan = planRows[0];
      if (!targetPlan) {
        return ApiResponse.error(res, 'Selected subscription plan not found.', null, 404);
      }

      const isTrialRequested = Boolean(is_trial !== undefined ? is_trial : isTrial) || targetPlan.billing_cycle === 'trial';
      const freeTrialDays = parseInt(targetPlan.free_trial_days, 10) || 0;
      const isTrialMode = isTrialRequested || parseFloat(targetPlan.price) === 0;

      // Enforce trial eligibility and prevent repeated trial activations dynamically
      if (isTrialRequested) {
        const eligibility = await SaasModel.checkTrialEligibility({
          planId: targetPlan.id,
          email: admin.email,
          schoolCode: school.school_code,
          phone: school.phone_number || admin.phone,
        });

        if (!eligibility.is_eligible) {
          return ApiResponse.error(res, eligibility.reason, { eligibility }, 403);
        }
      }

      const finalPayableCheck = parseFloat(amount_paid !== undefined ? amount_paid : amountPaid || 0);

      // Enforce strict Razorpay signature verification for all paid subscriptions / add-on purchases
      if (finalPayableCheck > 0) {
        const orderId = req.body.razorpay_order_id || req.body.razorpayOrderId;
        const paymentId = payment_transaction_id || paymentTransactionId || req.body.razorpay_payment_id || req.body.razorpayPaymentId;
        const signature = req.body.razorpay_signature || req.body.razorpaySignature;

        if (!signature || !orderId || !paymentId) {
          return ApiResponse.error(
            res,
            'Payment verification details (Order ID, Payment ID, Signature) are required to activate a paid subscription plan.',
            null,
            400
          );
        }

        const { keySecret } = require('../config/razorpay.config');
        const crypto = require('crypto');
        const body = `${orderId}|${paymentId}`;
        const expectedSignature = crypto
          .createHmac('sha256', keySecret)
          .update(body.toString())
          .digest('hex');

        if (expectedSignature !== signature) {
          return ApiResponse.error(res, 'Invalid Razorpay payment signature detected. Payment verification failed.', null, 400);
        }
      }

      const result = await SaasModel.registerSchoolWithPlan({
        planId: selectedPlanId,
        amountPaid: amount_paid !== undefined ? amount_paid : amountPaid,
        paymentGateway: payment_gateway || paymentGateway || (finalPayableCheck > 0 ? 'razorpay' : 'free_trial'),
        paymentTransactionId: payment_transaction_id || paymentTransactionId,
        schoolData: school,
        academicYearData: academic_year || academicYear || {},
        adminData: admin,
        isTrial: is_trial !== undefined ? is_trial : Boolean(isTrial),
        couponCode: coupon_code || couponCode,
        storagePlanId: req.body.storage_plan_id || req.body.storagePlanId,
        storageQty: req.body.storage_qty || req.body.storageQty || 1,
        selectedMachines: req.body.selected_machines || req.body.selectedMachines || [],
        selectedCards: req.body.selected_cards || req.body.selectedCards || [],
        selectedNotifications: req.body.selected_notifications || req.body.selectedNotifications || [],
        shippingAddress: req.body.shipping_address || req.body.shippingAddress || school.address,
      });


      const { generateToken } = require('../utils/jwt.util');
      const handoverToken = generateToken(
        {
          schoolId: result.schoolId,
          email: result.adminEmail,
          type: 'onboarding_handover',
        },
        { expiresIn: '5m' }
      );

      return ApiResponse.success(
        res,
        'School and Super Admin registered successfully! You can now log in.',
        {
          ...result,
          handover_token: handoverToken,
        },
        201
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all active countries
   */
  static async getCountries(req, res, next) {
    try {
      const countries = await SaasModel.getCountries();
      return ApiResponse.success(res, 'Countries fetched successfully.', countries);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get states by country ID
   */
  static async getStates(req, res, next) {
    try {
      const { countryId } = req.params;
      const states = await SaasModel.getStates(countryId);
      return ApiResponse.success(res, 'States fetched successfully.', states);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get cities by state ID
   */
  static async getCities(req, res, next) {
    try {
      const { stateId } = req.params;
      const cities = await SaasModel.getCities(stateId);
      return ApiResponse.success(res, 'Cities fetched successfully.', cities);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all active genders
   */
  static async getGenders(req, res, next) {
    try {
      const genders = await SaasModel.getGenders();
      return ApiResponse.success(res, 'Genders fetched successfully.', genders);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create Razorpay Order for school registration with paid plan
   */
  static async createRegistrationOrder(req, res, next) {

    try {
      const { plan_id, planId } = req.body;
      const targetPlanId = plan_id || planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please select a plan to create an order.', null, 400);
      }

      const SubscriptionModel = require('../models/subscription.model');
      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan) {
        return ApiResponse.error(res, 'The selected subscription plan was not found.', null, 404);
      }

      // Check availability if admin or school details are provided before opening payment order
      const adminEmail = req.body.admin_email || req.body.adminEmail || (req.body.admin && req.body.admin.email);
      const adminPhone = req.body.admin_phone || req.body.adminPhone || (req.body.admin && req.body.admin.phone);
      const schoolEmail = req.body.school_email || req.body.schoolEmail || (req.body.school && req.body.school.email);
      const schoolPhone = req.body.school_phone || req.body.schoolPhone || (req.body.school && req.body.school.phone_number);

      if (adminEmail || adminPhone || schoolEmail || schoolPhone) {
        const availability = await SaasModel.checkAvailability({
          adminEmail,
          adminPhone,
          schoolEmail,
          schoolPhone,
        });
        if (!availability.available) {
          return ApiResponse.error(res, availability.message, { field: availability.field }, 400);
        }
      }

      const AdminSubscriptionController = require('./adminSubscription.controller');
      const calculateVerifiedTotal = AdminSubscriptionController.calculateVerifiedTotal;

      const isTrialReq = Boolean(req.body.is_trial !== undefined ? req.body.is_trial : req.body.isTrial);

      const { totalAmount, originalAmount, discountAmount, couponInfo, breakdown } = await calculateVerifiedTotal({
        plan,
        is_trial: isTrialReq,
        addon_ids: req.body.addon_ids || req.body.addonIds || [],
        storage_plan_id: req.body.storage_plan_id || req.body.storagePlanId || null,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        selected_machines: req.body.selected_machines || req.body.selectedMachines || [],
        selected_cards: req.body.selected_cards || req.body.selectedCards || [],
        selected_notifications: req.body.selected_notifications || req.body.selectedNotifications || [],
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: null,
      });

      if (totalAmount <= 0) {
        return ApiResponse.error(res, 'Cannot create payment order for an amount of ₹0. Please proceed with free trial activation.', null, 400);
      }

      const { razorpayInstance, keyId, keySecret } = require('../config/razorpay.config');
      if (!keyId || !keySecret || keyId === 'rzp_test_placeholder_key') {
        return ApiResponse.error(
          res,
          'Razorpay keys are not configured. Please set valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server .env file.',
          null,
          500
        );
      }

      const amountInPaise = Math.round(totalAmount * 100);
      const receiptId = `REG_${Date.now()}`.slice(0, 40);

      const order = await razorpayInstance.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          plan_id: String(plan.id),
          plan_name: plan.plan_name,
          coupon_code: couponInfo ? couponInfo.code : null,
          original_price: String(originalAmount),
          machines_count: String(breakdown.machines?.length || 0),
          cards_count: String(breakdown.cards?.length || 0),
        },
      });

      return ApiResponse.success(res, 'Registration payment order created successfully.', {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: keyId,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        price: plan.price,
        original_amount: originalAmount,
        discount_amount: discountAmount,
        total_amount: totalAmount,
        final_price: totalAmount,
        coupon: couponInfo,
        breakdown,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Validate coupon code for registration / plan purchase
   */
  static async validateCoupon(req, res, next) {
    try {
      const { code, amount } = req.body;
      if (!code) {
        return ApiResponse.error(res, 'Coupon code is required.', null, 400);
      }

      const SaasAdminModel = require('../models/saasAdmin.model');
      const result = await SaasAdminModel.validateCoupon(code, amount || 0);
      if (!result.valid) {
        return ApiResponse.error(res, result.message, null, 400);
      }

      return ApiResponse.success(res, result.message, result.coupon);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Exchange one-time onboarding handover token for full portal session
   */
  static async exchangeHandoverToken(req, res, next) {
    try {
      const { token } = req.body;
      if (!token) {
        return ApiResponse.error(res, 'Handover token is required.', null, 400);
      }

      const { verifyToken, generateToken } = require('../utils/jwt.util');
      const decoded = verifyToken(token);
      if (!decoded || decoded.type !== 'onboarding_handover' || !decoded.email) {
        return ApiResponse.error(res, 'Invalid or expired onboarding handover token.', null, 401);
      }

      const AdminUserModel = require('../models/adminUser.model');
      const SubscriptionModel = require('../models/subscription.model');
      const PermissionModel = require('../models/permission.model');
      const config = require('../config/app.config');

      const user = await AdminUserModel.findByEmail(decoded.email.trim());
      if (!user) {
        return ApiResponse.error(res, 'User record not found.', null, 404);
      }

      const adminType = Number(user.admin_type);
      const isSuperAdmin = adminType === 1 || user.role_name === 'Super Admin';
      const roleName = isSuperAdmin ? 'Super Admin' : (user.role_name || 'Staff');
      const permissions = isSuperAdmin ? {} : await PermissionModel.getUserPermissionMap(user.role_id);
      const sub = await SubscriptionModel.getSchoolSubscription(user.school_id);

      const tokenPayload = {
        userId: user.id,
        schoolId: user.school_id,
        schoolName: user.school_name,
        schoolLogo: user.school_logo,
        email: user.email,
        roleId: user.role_id,
        adminType: adminType,
        isSuperAdmin: Boolean(isSuperAdmin),
        roleName,
        portalType: 'AdminPortal',
      };

      const sessionToken = generateToken(tokenPayload);

      const cookieOptions = {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        maxAge: config.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000,
        path: '/',
      };

      const cookieName = config.cookie?.name || 'growvidya_session';
      res.cookie('growvidya_admin_session', sessionToken, cookieOptions);
      res.cookie(cookieName, sessionToken, cookieOptions);

      return ApiResponse.success(res, 'Authentication successful via onboarding handover.', {
        authType: 'hybrid (session + token)',
        token: sessionToken,
        user: {
          id: user.id,
          schoolId: user.school_id,
          schoolName: user.school_name || '',
          schoolLogo: user.school_logo || null,
          schoolFooter: user.school_footer || null,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          picture: user.picture,
          roleId: user.role_id,
          roleName,
          adminType: adminType,
          admin_type: adminType,
          isSuperAdmin: Boolean(isSuperAdmin),
          isTrial: Boolean(sub?.isTrial),
          isExpired: Boolean(sub?.isExpired),
          subscription: sub,
          permissions,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SaasController;
