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

      if (!admin.password || admin.password.length < 6) {
        return ApiResponse.error(res, 'Password must be at least 6 characters.', null, 400);
      }

      const { pool } = require('../config/db.config');
      const [planRows] = await pool.query(
        'SELECT id, plan_name, price, billing_cycle FROM subscription_plans WHERE id = ? LIMIT 1',
        [parseInt(selectedPlanId, 10)]
      );
      const targetPlan = planRows[0];
      if (!targetPlan) {
        return ApiResponse.error(res, 'Selected subscription plan not found.', null, 404);
      }

      const isTrialMode = Boolean(is_trial !== undefined ? is_trial : isTrial) || targetPlan.billing_cycle === 'trial' || parseFloat(targetPlan.price) === 0;

      // Enforce strict Razorpay signature verification for all paid subscriptions
      if (!isTrialMode && parseFloat(targetPlan.price) > 0) {
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
        paymentGateway: payment_gateway || paymentGateway || 'dummy',
        paymentTransactionId: payment_transaction_id || paymentTransactionId,
        schoolData: school,
        academicYearData: academic_year || academicYear || {},
        adminData: admin,
        isTrial: is_trial !== undefined ? is_trial : Boolean(isTrial),
        couponCode: coupon_code || couponCode,
      });


      return ApiResponse.success(
        res,
        'School and Super Admin registered successfully! You can now log in.',
        result,
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

      if (parseFloat(plan.price) <= 0) {
        return ApiResponse.error(res, 'Cannot create payment order for a free or trial plan.', null, 400);
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

      let finalPrice = parseFloat(plan.price);
      let couponInfo = null;

      const couponCode = req.body.coupon_code || req.body.couponCode;
      if (couponCode && String(couponCode).trim()) {
        const SaasAdminModel = require('../models/saasAdmin.model');
        const validation = await SaasAdminModel.validateCoupon(couponCode, finalPrice);
        if (validation.valid) {
          finalPrice = validation.coupon.finalAmount;
          couponInfo = validation.coupon;
        } else {
          return ApiResponse.error(res, validation.message, null, 400);
        }
      }

      const amountInPaise = Math.round(finalPrice * 100);
      const receiptId = `REG_${Date.now()}`.slice(0, 40);

      const order = await razorpayInstance.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          plan_id: String(plan.id),
          plan_name: plan.plan_name,
          coupon_code: couponInfo ? couponInfo.code : null,
          original_price: String(plan.price),
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
        discount_amount: couponInfo ? couponInfo.discountAmount : 0,
        final_price: finalPrice,
        coupon: couponInfo,
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
}

module.exports = SaasController;
