const crypto = require('crypto');
const SaasModel = require('../models/saas.model');
const SubscriptionModel = require('../models/subscription.model');
const CouponModel = require('../models/coupon.model');
const SubscriptionPolicyService = require('../services/subscriptionPolicy.service');
const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');
const ApiResponse = require('../utils/api.response');
const { getRazorpayConfig } = require('../config/razorpay.config');

function verifyRazorpaySignature(orderId, paymentId, signature, keySecret) {
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const receivedBuf = Buffer.from(String(signature || ''), 'utf8');
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

class SaasController {
  /**
   * GET /api/v1/saas/plans
   * Get all active subscription plans dynamically from DB
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
   * GET /api/v1/saas/config-catalog
   * Get public configuration catalog (storage_master, machines, rfid, notification_pricing_master)
   */
  static async getConfigCatalog(req, res, next) {
    try {
      const catalog = await SubscriptionModel.getConfigurationCatalog();
      return ApiResponse.success(res, 'Configuration catalog fetched successfully.', catalog);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET / POST /api/v1/saas/trial-eligibility
   * Enforces strict one-trial-ever across ALL plans dynamically
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
   * GET / POST /api/v1/saas/check-availability
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
   * POST /api/v1/saas/create-order
   * Creates a server-bound `subscription_payment_orders` checkout intent (Zero GST)
   * and initializes Razorpay order when grandTotal > 0 (or returns zero_amount_ready for 100% coupon / pure free trial).
   */
  static async createRegistrationOrder(req, res, next) {
    try {
      const targetPlanId = req.body.plan_id || req.body.planId;
      if (!targetPlanId) {
        return ApiResponse.error(res, 'Please select a plan to create an order.', null, 400);
      }

      const plan = await SubscriptionModel.getPlanById(targetPlanId);
      if (!plan || Number(plan.status) !== 1) {
        return ApiResponse.error(res, 'The selected subscription plan was not found or is inactive.', null, 404);
      }

      const adminEmail = req.body.admin_email || req.body.adminEmail || req.body.admin?.email || null;
      const adminPhone = req.body.admin_phone || req.body.adminPhone || req.body.admin?.phone || null;
      const schoolEmail = req.body.school_email || req.body.schoolEmail || req.body.school?.email || null;
      const schoolPhone = req.body.school_phone || req.body.schoolPhone || req.body.school?.phone_number || null;
      const schoolName = req.body.school_name || req.body.schoolName || req.body.school?.school_name || null;

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

      const isTrialReq =
        Boolean(req.body.is_trial !== undefined ? req.body.is_trial : req.body.isTrial) ||
        String(plan.billing_cycle).toLowerCase() === 'trial';

      if (isTrialReq) {
        const eligibility = await SaasModel.checkTrialEligibility({
          planId: plan.id,
          email: adminEmail || schoolEmail,
          schoolCode: req.body.school?.school_code || null,
          phone: schoolPhone || adminPhone,
        });
        if (!eligibility.is_eligible) {
          return ApiResponse.error(res, eligibility.reason, { eligibility }, 403);
        }
      }

      const verifiedCalc = await SubscriptionPolicyService.calculateVerifiedCheckout({
        plan,
        is_trial: isTrialReq,
        is_addon_only: false,
        storage_plan_id: req.body.storage_plan_id || req.body.storagePlanId || null,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        storage_billing_cycle: req.body.storage_billing_cycle || (isTrialReq ? 'annual' : plan.billing_cycle),
        selected_machines: req.body.selected_machines || req.body.selectedMachines || [],
        selected_cards: req.body.selected_cards || req.body.selectedCards || [],
        selected_notifications: req.body.selected_notifications || req.body.selectedNotifications || [],
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: null,
        email: adminEmail || schoolEmail,
        phone: adminPhone || schoolPhone,
      });

      const shippingAddress =
        req.body.shipping_address ||
        req.body.shippingAddress ||
        req.body.school?.address ||
        'Onboarding Address Pending';

      const orderType = isTrialReq ? 'trial_with_addons' : 'onboarding';
      const actionType = isTrialReq ? 'trial' : 'onboarding';

      // Handle ₹0 total (e.g., 100% coupon discount or pure free trial) cleanly without failing!
      if (verifiedCalc.grandTotal <= 0) {
        const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
          schoolId: null,
          orderType,
          actionType,
          plan,
          verifiedCalc,
          paymentMethod: isTrialReq ? 'free_trial' : 'coupon_100',
          shippingAddress,
          extraMetadata: {
            school_name: schoolName,
            email: adminEmail || schoolEmail,
            phone: adminPhone || schoolPhone,
          },
        });

        return ApiResponse.success(res, 'Zero-amount checkout order prepared for instant activation.', {
          zero_amount_ready: true,
          order_id: null,
          order_no: orderIntent.orderNo,
          payment_order_id: orderIntent.orderId,
          amount: 0,
          currency: 'INR',
          plan_id: plan.id,
          plan_name: plan.plan_name,
          price: plan.price,
          original_amount: verifiedCalc.subtotalAmount,
          discount_amount: verifiedCalc.discountAmount,
          tax_amount: 0,
          total_amount: 0,
          final_price: 0,
          coupon: verifiedCalc.couponInfo,
          breakdown: verifiedCalc.breakdown,
        });
      }

      const razorpayConfig = await getRazorpayConfig();
      if (!razorpayConfig?.razorpayInstance || !razorpayConfig.keyId || !razorpayConfig.keySecret) {
        return ApiResponse.error(
          res,
          'Online payment gateway is currently unavailable. Razorpay credentials are not configured in Settings.',
          null,
          503
        );
      }

      const amountInPaise = Math.round(verifiedCalc.grandTotal * 100);
      const receiptId = `REG_${Date.now()}`.slice(0, 40);

      let rzpOrder;
      try {
        rzpOrder = await razorpayConfig.razorpayInstance.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: receiptId,
          notes: {
            plan_id: String(plan.id),
            plan_name: plan.plan_name,
            is_trial: String(isTrialReq),
            coupon_code: verifiedCalc.couponInfo?.code || '',
            original_price: String(verifiedCalc.subtotalAmount),
          },
        });
      } catch (rzpErr) {
        return ApiResponse.error(
          res,
          'Failed to initialize payment order with Razorpay. Please check Payment Gateway Settings.',
          null,
          502
        );
      }

      const orderIntent = await SubscriptionFulfillmentService.createOrderIntent({
        schoolId: null,
        orderType,
        actionType,
        plan,
        verifiedCalc,
        paymentMethod: 'razorpay',
        razorpayOrderId: rzpOrder.id,
        shippingAddress,
        extraMetadata: {
          school_name: schoolName,
          email: adminEmail || schoolEmail,
          phone: adminPhone || schoolPhone,
        },
      });

      return ApiResponse.success(res, 'Registration payment order created successfully.', {
        zero_amount_ready: false,
        order_id: rzpOrder.id,
        order_no: orderIntent.orderNo,
        payment_order_id: orderIntent.orderId,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency || 'INR',
        key_id: razorpayConfig.keyId,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        price: plan.price,
        original_amount: verifiedCalc.subtotalAmount,
        discount_amount: verifiedCalc.discountAmount,
        tax_amount: 0,
        total_amount: verifiedCalc.grandTotal,
        final_price: verifiedCalc.grandTotal,
        coupon: verifiedCalc.couponInfo,
        breakdown: verifiedCalc.breakdown,
      });
    } catch (error) {
      if (error.statusCode) {
        return ApiResponse.error(res, error.message, { code: error.code || null }, error.statusCode);
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/saas/register-school (and /register)
   * Strictly verifies server-calculated grandTotal & Razorpay signature against `subscription_payment_orders`
   * (eliminating client `amount_paid: 0` bypass and plan-swap tampering) and activates immediately!
   */
  static async registerSchool(req, res, next) {
    try {
      const selectedPlanId = req.body.plan_id || req.body.planId;
      const school = req.body.school;
      const admin = req.body.admin;

      if (!selectedPlanId) {
        return ApiResponse.error(res, 'Please select a subscription plan.', null, 400);
      }
      if (!school || !school.school_name || !school.school_name.trim()) {
        return ApiResponse.error(res, 'School Name is required.', null, 400);
      }

      const rawRegType = school.registration_type ?? school.registrationType;
      if (rawRegType !== undefined && rawRegType !== null && rawRegType !== '') {
        const normalizedRegType = String(rawRegType).trim().toLowerCase();
        if (normalizedRegType !== 'single' && normalizedRegType !== 'multiple') {
          return ApiResponse.error(res, "Invalid registration type. Allowed values are 'single' or 'multiple'.", null, 400);
        }
        school.registration_type = normalizedRegType;
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

      const availability = await SaasModel.checkAvailability({
        adminEmail: admin.email,
        adminPhone: admin.phone,
        schoolEmail: school.email,
        schoolPhone: school.phone_number,
      });
      if (!availability.available) {
        return ApiResponse.error(res, availability.message, { field: availability.field }, 400);
      }

      const targetPlan = await SubscriptionModel.getPlanById(selectedPlanId);
      if (!targetPlan || Number(targetPlan.status) !== 1) {
        return ApiResponse.error(res, 'Selected subscription plan not found or is inactive.', null, 404);
      }

      const isTrialRequested =
        Boolean(req.body.is_trial !== undefined ? req.body.is_trial : req.body.isTrial) ||
        String(targetPlan.billing_cycle).toLowerCase() === 'trial';

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

      // Compute authoritative server-side payable total (NEVER trust client `amount_paid`!)
      const verifiedCalc = await SubscriptionPolicyService.calculateVerifiedCheckout({
        plan: targetPlan,
        is_trial: isTrialRequested,
        is_addon_only: false,
        storage_plan_id: req.body.storage_plan_id || req.body.storagePlanId || null,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        storage_billing_cycle: req.body.storage_billing_cycle || (isTrialRequested ? 'annual' : targetPlan.billing_cycle),
        selected_machines: req.body.selected_machines || req.body.selectedMachines || [],
        selected_cards: req.body.selected_cards || req.body.selectedCards || [],
        selected_notifications: req.body.selected_notifications || req.body.selectedNotifications || [],
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: null,
        email: admin.email,
        phone: admin.phone,
      });

      let paymentOrderId = req.body.payment_order_id || req.body.paymentOrderId || null;
      const razorpayOrderId = req.body.razorpay_order_id || req.body.razorpayOrderId || null;
      const razorpayPaymentId =
        req.body.razorpay_payment_id ||
        req.body.razorpayPaymentId ||
        req.body.payment_transaction_id ||
        req.body.paymentTransactionId ||
        null;
      const razorpaySignature = req.body.razorpay_signature || req.body.razorpaySignature || null;

      if (verifiedCalc.grandTotal > 0) {
        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
          return ApiResponse.error(
            res,
            'Verified Razorpay payment details (Order ID, Payment ID, Signature) are required to activate this purchase.',
            { code: 'PAYMENT_VERIFICATION_REQUIRED' },
            400
          );
        }

        const razorpayConfig = await getRazorpayConfig();
        if (!razorpayConfig?.keySecret) {
          return ApiResponse.error(
            res,
            'Payment verification is unavailable because Razorpay credentials are not configured.',
            null,
            503
          );
        }

        if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, razorpayConfig.keySecret)) {
          return ApiResponse.error(
            res,
            'Invalid Razorpay payment signature detected. Payment verification failed.',
            { code: 'INVALID_PAYMENT_SIGNATURE' },
            400
          );
        }

        const persistedOrder = await SubscriptionFulfillmentService.getOrderWithInvoice(razorpayOrderId);
        if (!persistedOrder) {
          return ApiResponse.error(
            res,
            'Checkout order record not found. Please contact support with your payment reference.',
            { code: 'ORDER_NOT_FOUND' },
            404
          );
        }

        if (Number(persistedOrder.plan_id) !== Number(targetPlan.id)) {
          return ApiResponse.error(
            res,
            'Plan mismatch detected between verified payment order and registration request.',
            { code: 'PLAN_MISMATCH' },
            400
          );
        }

        paymentOrderId = persistedOrder.id;
      } else {
        // ₹0 total (pure Free Trial with no paid add-ons OR 100%-Discount Coupon)
        const existingOrderNo = req.body.order_no || req.body.orderNo || null;
        if (existingOrderNo) {
          const existingZero = await SubscriptionFulfillmentService.getOrderWithInvoice(existingOrderNo);
          if (existingZero && existingZero.grand_total <= 0 && !existingZero.school_id) {
            paymentOrderId = existingZero.id;
          }
        }

        if (!paymentOrderId) {
          const zeroIntent = await SubscriptionFulfillmentService.createOrderIntent({
            schoolId: null,
            orderType: isTrialRequested ? 'trial_with_addons' : 'onboarding',
            actionType: isTrialRequested ? 'trial' : 'onboarding',
            plan: targetPlan,
            verifiedCalc,
            paymentMethod: isTrialRequested ? 'free_trial' : 'coupon_100',
            shippingAddress: req.body.shipping_address || req.body.shippingAddress || school.address || null,
            extraMetadata: {
              school_name: school.school_name,
              email: admin.email,
              phone: admin.phone,
            },
          });
          paymentOrderId = zeroIntent.orderId;
        }
      }

      const result = await SaasModel.registerSchoolWithPlan({
        planId: targetPlan.id,
        paymentOrderId,
        razorpayOrderId,
        razorpayPaymentId,
        schoolData: school,
        academicYearData: req.body.academic_year || req.body.academicYear || {},
        adminData: admin,
        isTrial: isTrialRequested,
      });

      const { generateToken } = require('../utils/jwt.util');
      const handoverToken = generateToken(
        {
          schoolId: result.schoolId,
          email: result.adminEmail,
          type: 'onboarding_handover',
        },
        { expiresIn: '15m' }
      );

      const orderDetails = await SubscriptionFulfillmentService.getOrderWithInvoice(result.orderNo, result.schoolId);

      return ApiResponse.success(
        res,
        'School and Super Admin registered successfully! Your account is active.',
        {
          ...result,
          order_no: result.orderNo,
          invoice_no: result.invoiceNo,
          order: orderDetails,
          handover_token: handoverToken,
        },
        201
      );
    } catch (error) {
      if (error.statusCode) {
        return ApiResponse.error(res, error.message, { code: error.code || null }, error.statusCode);
      }
      next(error);
    }
  }

  /**
   * POST /api/v1/saas/validate-coupon
   * Validates coupon against scoped eligible subtotal & onboarding email/phone limits
   */
  static async validateCoupon(req, res, next) {
    try {
      const { code, amount, plan_amount, storage_amount, email, phone, check_only, checkOnly } = req.body;
      if (!code || !String(code).trim()) {
        return ApiResponse.error(res, 'Coupon code is required.', null, 400);
      }

      const options = {
        email: email || null,
        phone: phone || null,
        checkOnly: Boolean(check_only || checkOnly),
      };
      if (plan_amount !== undefined) options.planAmount = parseFloat(plan_amount) || 0;
      if (storage_amount !== undefined) options.storageAmount = parseFloat(storage_amount) || 0;

      const result = await CouponModel.validateCoupon(code, parseFloat(amount) || 0, null, options);
      if (!result.valid) {
        return ApiResponse.error(res, result.message, null, 400);
      }

      return ApiResponse.success(res, result.message, result.coupon);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/saas/remove-coupon
   * Releases an unredeemed applied coupon count when removed by the user before checkout
   */
  static async removeCoupon(req, res, next) {
    try {
      const { code } = req.body;
      if (code && String(code).trim()) {
        await CouponModel.decrementAppliedCount(code);
      }
      return ApiResponse.success(res, 'Coupon removed.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/saas/record-payment-failure
   */
  static async recordPaymentFailure(req, res, next) {
    try {
      const recorded = await SubscriptionFulfillmentService.recordPaymentFailure({
        orderNo: req.body.order_no || req.body.orderNo || null,
        razorpayOrderId: req.body.razorpay_order_id || req.body.razorpayOrderId || null,
        razorpayPaymentId: req.body.razorpay_payment_id || req.body.razorpayPaymentId || null,
        failureCode: req.body.error_code || req.body.failure_code || 'PAYMENT_FAILED',
        failureReason: req.body.error_description || req.body.failure_reason || 'Payment failed or cancelled at gateway.',
      });
      return ApiResponse.success(res, 'Onboarding payment failure recorded.', recorded);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/saas/orders/:orderNo
   * Retrieves order & Zero-GST Printable Receipt for Onboarding Payment Success & Payment Failed pages
   */
  static async getPublicOrderDetails(req, res, next) {
    try {
      const orderNo = String(req.params.orderNo || '').trim();
      // Only allow lookup by non-guessable order_no (ORD-...), razorpay_order_id (order_...), or invoice_no (INV-...)
      if (!orderNo || /^\d+$/.test(orderNo)) {
        return ApiResponse.error(res, 'Valid order reference number is required.', null, 400);
      }

      const order = await SubscriptionFulfillmentService.getOrderWithInvoice(orderNo);
      if (!order) {
        return ApiResponse.error(res, 'Order reference not found.', null, 404);
      }

      return ApiResponse.success(res, 'Order details retrieved successfully.', order);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/saas/locations/countries
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
   * GET /api/v1/saas/locations/states/:countryId
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
   * GET /api/v1/saas/locations/cities/:stateId
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
   * GET /api/v1/saas/genders
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
   * POST /api/v1/saas/auth/exchange-handover
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
      const PermissionModel = require('../models/permission.model');
      const config = require('../config/app.config');

      const user = await AdminUserModel.findByEmail(decoded.email.trim());
      if (!user) {
        return ApiResponse.error(res, 'User record not found.', null, 404);
      }

      const adminType = Number(user.admin_type);
      const isSuperAdmin = adminType === 1 || user.role_name === 'Super Admin';
      const roleName = isSuperAdmin ? 'Super Admin' : (user.role_name || null);
      const permissions = isSuperAdmin ? {} : await PermissionModel.getUserPermissionMap(user.role_id);
      const sub = await SubscriptionModel.getSchoolSubscription(user.school_id);

      const tokenPayload = {
        userId: user.id,
        schoolId: user.school_id,
        schoolName: user.school_name,
        schoolLogo: user.school_logo,
        registrationType: user.registration_type || 'single',
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
          registrationType: user.registration_type || 'single',
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
