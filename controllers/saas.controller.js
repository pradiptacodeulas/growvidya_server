const crypto = require('crypto');
const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');
const { saveBase64File } = require('../utils/file.util');
const SaasModel = require('../models/saas.model');
const SubscriptionModel = require('../models/subscription.model');
const CouponModel = require('../models/coupon.model');
const FooterSettingModel = require('../models/footerSetting.model');
const SubscriptionPolicyService = require('../services/subscriptionPolicy.service');
const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');
const ApiResponse = require('../utils/api.response');
const { getRazorpayConfig } = require('../config/razorpay.config');
const PasscodeService = require('../services/passcode.service');
const { generateToken, verifyToken } = require('../utils/jwt.util');

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
   * GET /api/v1/saas/footer
   * Get global platform footer setting configured by SaaS Admin
   */
  static async getFooterSetting(req, res, next) {
    try {
      const setting = await FooterSettingModel.getCurrent();
      return ApiResponse.success(
        res,
        'Footer setting fetched successfully.',
        setting
          ? {
              id: setting.id,
              footer_text: setting.footer_text,
              updated_at: setting.updated_at,
            }
          : null
      );
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
   * Ensure onboarding_email_otps table exists for pre-registration email OTP verification
   */
  static async _ensureRegistrationOtpTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onboarding_email_otps (
        email VARCHAR(255) NOT NULL PRIMARY KEY,
        otp VARCHAR(16) DEFAULT NULL,
        otp_expires_at DATETIME DEFAULT NULL,
        verified_at DATETIME DEFAULT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Validate that the admin email has been verified via OTP
   */
  static async _isEmailOtpVerified(rawEmail, verificationToken = null) {
    const cleanEmail = String(rawEmail || '').trim().toLowerCase();
    if (!cleanEmail) return false;

    if (verificationToken && typeof verificationToken === 'string') {
      const decoded = verifyToken(verificationToken.trim());
      if (
        decoded &&
        decoded.purpose === 'saas_registration_email_verified' &&
        String(decoded.email || '').trim().toLowerCase() === cleanEmail
      ) {
        return true;
      }
    }

    await SaasController._ensureRegistrationOtpTable();
    const [rows] = await pool.query(
      `SELECT email FROM onboarding_email_otps
       WHERE email = ?
         AND verified_at IS NOT NULL
         AND verified_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
       LIMIT 1`,
      [cleanEmail]
    );
    return rows.length > 0;
  }

  /**
   * POST /api/v1/saas/send-registration-otp
   * Sends a 6-digit verification OTP to the Super Admin email before completing registration
   */
  static async sendRegistrationOtp(req, res, next) {
    try {
      const rawEmail = req.body.email || req.body.admin_email || req.body.adminEmail;
      const firstName = String(req.body.first_name || req.body.firstName || '').trim();
      const cleanEmail = String(rawEmail || '').trim().toLowerCase();

      if (!cleanEmail) {
        return ApiResponse.error(res, 'Login email address is required.', null, 400);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return ApiResponse.error(res, 'Please enter a valid email address.', null, 400);
      }

      const availability = await SaasModel.checkAvailability({ adminEmail: cleanEmail });
      if (!availability.available) {
        return ApiResponse.error(res, availability.message, { field: availability.field }, 400);
      }

      await SaasController._ensureRegistrationOtpTable();

      const otpCode = PasscodeService.generatePasscode();
      const expiresInMinutes = 10;

      await pool.query(
        `INSERT INTO onboarding_email_otps (email, otp, otp_expires_at, verified_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL)
         ON DUPLICATE KEY UPDATE
           otp = VALUES(otp),
           otp_expires_at = VALUES(otp_expires_at),
           verified_at = NULL`,
        [cleanEmail, otpCode, expiresInMinutes]
      );

      try {
        await PasscodeService.sendOtpEmail({
          toEmail: cleanEmail,
          toName: firstName || cleanEmail,
          otpCode,
          portalName: 'Growvidya School Registration',
          expiresInMinutes,
        });
      } catch (emailErr) {
        await pool
          .query('UPDATE onboarding_email_otps SET otp = NULL, otp_expires_at = NULL WHERE email = ?', [cleanEmail])
          .catch(() => {});
        return ApiResponse.error(
          res,
          emailErr.message || 'Unable to send verification OTP email at the moment. Please try again.',
          null,
          emailErr.statusCode || 502
        );
      }

      return ApiResponse.success(res, `A 6-digit verification OTP has been sent to ${cleanEmail}.`, {
        email: cleanEmail,
        maskedEmail: PasscodeService.maskEmail(cleanEmail),
        expiresInMinutes,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/saas/verify-registration-otp
   * Verifies the 6-digit OTP for the Super Admin registration email
   */
  static async verifyRegistrationOtp(req, res, next) {
    try {
      const rawEmail = req.body.email || req.body.admin_email || req.body.adminEmail;
      const otpInput = String(req.body.otp || req.body.code || '').trim();
      const cleanEmail = String(rawEmail || '').trim().toLowerCase();

      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
      }
      if (!otpInput || !/^\d{6}$/.test(otpInput)) {
        return ApiResponse.error(res, 'Please enter a valid 6-digit OTP.', null, 400);
      }

      await SaasController._ensureRegistrationOtpTable();

      const [rows] = await pool.query(
        `SELECT email, otp, otp_expires_at,
                (otp_expires_at IS NOT NULL AND otp_expires_at >= NOW()) AS is_valid_time
         FROM onboarding_email_otps
         WHERE email = ?
         LIMIT 1`,
        [cleanEmail]
      );

      const record = rows[0] || null;
      if (!record || !record.otp) {
        return ApiResponse.error(res, 'No active OTP found for this email. Please click Send OTP first.', null, 400);
      }
      if (!record.is_valid_time) {
        return ApiResponse.error(res, 'OTP has expired. Please resend a new 6-digit OTP.', null, 400);
      }
      if (String(record.otp).trim() !== otpInput) {
        return ApiResponse.error(res, 'Invalid 6-digit OTP. Please check the code and try again.', null, 400);
      }

      await pool.query(
        `UPDATE onboarding_email_otps
         SET otp = NULL, otp_expires_at = NULL, verified_at = NOW()
         WHERE email = ?`,
        [cleanEmail]
      );

      const emailVerificationToken = generateToken(
        {
          purpose: 'saas_registration_email_verified',
          email: cleanEmail,
        },
        { expiresIn: '2h' }
      );

      return ApiResponse.success(res, 'Email address verified successfully.', {
        verified: true,
        email: cleanEmail,
        email_verification_token: emailVerificationToken,
      });
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
      const emailVerificationToken =
        req.body.email_verification_token ||
        req.body.emailVerificationToken ||
        req.body.admin?.email_verification_token ||
        null;

      if (adminEmail) {
        const isEmailVerified = await SaasController._isEmailOtpVerified(adminEmail, emailVerificationToken);
        if (!isEmailVerified) {
          return ApiResponse.error(
            res,
            'Please verify your Super Admin email address via OTP before proceeding with registration.',
            { field: 'admin_email', code: 'EMAIL_OTP_VERIFICATION_REQUIRED' },
            400
          );
        }
      }

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
        storage_billing_cycle:
          req.body.storage_billing_cycle ||
          (String(plan.billing_cycle || '').toLowerCase() !== 'trial' ? plan.billing_cycle : null),
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

      // Build pre-hashed onboarding registration snapshot so Razorpay webhooks can auto-provision the school if browser disconnects
      let onboardingRegistrationSnapshot = null;
      if (req.body.school && req.body.school.school_name && req.body.admin && req.body.admin.email) {
        const rawSchool = { ...req.body.school };
        if (rawSchool.school_logo && String(rawSchool.school_logo).startsWith('data:')) {
          rawSchool.school_logo = await saveBase64File(rawSchool.school_logo, 'school', 'Logo', {
            skipQuotaCheck: true,
          });
        }
        const rawAdmin = { ...req.body.admin };
        if (rawAdmin.picture && String(rawAdmin.picture).startsWith('data:')) {
          rawAdmin.picture = await saveBase64File(rawAdmin.picture, 'staff', 'Admin', {
            skipQuotaCheck: true,
          });
        }
        const passwordHash = rawAdmin.password
          ? await hashPassword(String(rawAdmin.password))
          : rawAdmin.password_hash || null;
        delete rawAdmin.password;
        if (passwordHash) {
          rawAdmin.password_hash = passwordHash;
        }
        onboardingRegistrationSnapshot = {
          is_trial: isTrialReq,
          school: rawSchool,
          academic_year: req.body.academic_year || req.body.academicYear || {},
          admin: rawAdmin,
        };
      }

      const extraMetadataPayload = {
        school_name: schoolName,
        email: adminEmail || schoolEmail,
        phone: adminPhone || schoolPhone,
        ...(onboardingRegistrationSnapshot
          ? { onboarding_registration: onboardingRegistrationSnapshot }
          : {}),
      };

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
          extraMetadata: extraMetadataPayload,
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
        extraMetadata: extraMetadataPayload,
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
      if (!admin.password && !admin.password_hash) {
        return ApiResponse.error(res, 'Password is required.', null, 400);
      }
      if (admin.password && admin.password.length < 6) {
        return ApiResponse.error(res, 'Password must be at least 6 characters.', null, 400);
      }

      const targetPlan = await SubscriptionModel.getPlanById(selectedPlanId);
      if (!targetPlan || Number(targetPlan.status) !== 1) {
        return ApiResponse.error(res, 'Selected subscription plan not found or is inactive.', null, 404);
      }

      const isTrialRequested =
        Boolean(req.body.is_trial !== undefined ? req.body.is_trial : req.body.isTrial) ||
        String(targetPlan.billing_cycle).toLowerCase() === 'trial';

      let paymentOrderId = req.body.payment_order_id || req.body.paymentOrderId || null;
      const razorpayOrderId = req.body.razorpay_order_id || req.body.razorpayOrderId || null;
      const existingOrderNo = req.body.order_no || req.body.orderNo || null;

      // Check if the referenced payment order was already auto-provisioned by a Razorpay webhook
      let preProvisionedOrder = null;
      if (razorpayOrderId || existingOrderNo || paymentOrderId) {
        preProvisionedOrder = await SubscriptionFulfillmentService.getOrderWithInvoice(
          razorpayOrderId || existingOrderNo || paymentOrderId
        );
      }
      const isAlreadyProvisionedByWebhook = Boolean(
        preProvisionedOrder && preProvisionedOrder.status === 'paid' && preProvisionedOrder.school_id
      );

      if (!isAlreadyProvisionedByWebhook) {
        const emailVerificationToken =
          req.body.email_verification_token ||
          req.body.emailVerificationToken ||
          admin.email_verification_token ||
          null;
        const isEmailVerified = await SaasController._isEmailOtpVerified(admin.email, emailVerificationToken);
        if (!isEmailVerified) {
          return ApiResponse.error(
            res,
            'Please verify your Super Admin email address via OTP before completing registration.',
            { field: 'admin_email', code: 'EMAIL_OTP_VERIFICATION_REQUIRED' },
            400
          );
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
      }

      // Compute authoritative server-side payable total (NEVER trust client `amount_paid`!)
      const verifiedCalc = await SubscriptionPolicyService.calculateVerifiedCheckout({
        plan: targetPlan,
        is_trial: isTrialRequested,
        is_addon_only: false,
        storage_plan_id: req.body.storage_plan_id || req.body.storagePlanId || null,
        storage_qty: req.body.storage_qty || req.body.storageQty || 1,
        storage_billing_cycle:
          req.body.storage_billing_cycle ||
          (String(targetPlan.billing_cycle || '').toLowerCase() !== 'trial' ? targetPlan.billing_cycle : null),
        selected_machines: req.body.selected_machines || req.body.selectedMachines || [],
        selected_cards: req.body.selected_cards || req.body.selectedCards || [],
        selected_notifications: req.body.selected_notifications || req.body.selectedNotifications || [],
        coupon_code: req.body.coupon_code || req.body.couponCode || null,
        school_id: isAlreadyProvisionedByWebhook ? preProvisionedOrder.school_id : null,
        email: isAlreadyProvisionedByWebhook ? null : admin.email,
        phone: isAlreadyProvisionedByWebhook ? null : admin.phone,
        exclude_order_id: preProvisionedOrder ? preProvisionedOrder.id : null,
      });

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

        const persistedOrder = preProvisionedOrder || (await SubscriptionFulfillmentService.getOrderWithInvoice(razorpayOrderId));
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

        const persistedPaise = Math.round((parseFloat(persistedOrder.grand_total) || 0) * 100);
        const expectedPaise = Math.round(verifiedCalc.grandTotal * 100);
        if (persistedPaise !== expectedPaise) {
          return ApiResponse.error(
            res,
            'Order amount mismatch detected between verified payment order and registration request.',
            { code: 'AMOUNT_MISMATCH' },
            400
          );
        }

        if (razorpayConfig.razorpayInstance?.orders?.fetch) {
          try {
            const remoteOrder = await razorpayConfig.razorpayInstance.orders.fetch(razorpayOrderId);
            const remoteCurrency = String(remoteOrder?.currency || 'INR').toUpperCase();
            if (remoteOrder && (Number(remoteOrder.amount) !== persistedPaise || remoteCurrency !== 'INR')) {
              return ApiResponse.error(
                res,
                'Gateway order amount or currency mismatch detected during verification.',
                { code: 'AMOUNT_MISMATCH' },
                400
              );
            }
          } catch (_) {
            // Transient gateway fetch error; HMAC signature + DB-bound order_id already verified
          }
        }

        paymentOrderId = persistedOrder.id;
      } else {
        // ₹0 total (pure Free Trial with no paid add-ons OR 100%-Discount Coupon)
        if (existingOrderNo) {
          const existingZero = preProvisionedOrder || (await SubscriptionFulfillmentService.getOrderWithInvoice(existingOrderNo));
          if (
            existingZero &&
            parseFloat(existingZero.grand_total) <= 0 &&
            Number(existingZero.plan_id) === Number(targetPlan.id)
          ) {
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
      const handoverJti = crypto.randomBytes(16).toString('hex');
      if (result.orderNo) {
        try {
          const [ordRows] = await pool.query(
            'SELECT id, payload_snapshot_json FROM subscription_payment_orders WHERE order_no = ? AND school_id = ? LIMIT 1',
            [result.orderNo, result.schoolId]
          );
          if (ordRows.length > 0) {
            let snap = {};
            try {
              snap = ordRows[0].payload_snapshot_json ? JSON.parse(ordRows[0].payload_snapshot_json) : {};
            } catch (_) {}
            snap.extra = {
              ...(snap.extra || {}),
              handover_jti: handoverJti,
              handover_consumed_at: null,
            };
            await pool.query(
              'UPDATE subscription_payment_orders SET payload_snapshot_json = ? WHERE id = ?',
              [JSON.stringify(snap), ordRows[0].id]
            );
          }
        } catch (_) {}
      }

      const handoverToken = generateToken(
        {
          schoolId: result.schoolId,
          userId: result.adminUserId,
          email: result.adminEmail,
          orderNo: result.orderNo || null,
          jti: handoverJti,
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
      const orderNo = String(req.body.order_no || req.body.orderNo || '').trim() || null;
      const razorpayOrderId = String(req.body.razorpay_order_id || req.body.razorpayOrderId || '').trim() || null;

      if (!orderNo && !razorpayOrderId) {
        return ApiResponse.error(res, 'Valid onboarding order reference is required.', null, 400);
      }

      if (orderNo && !/^ORD-\d{8}-\d{6}$/.test(orderNo)) {
        return ApiResponse.error(res, 'Invalid onboarding order reference format.', null, 400);
      }

      if (razorpayOrderId && !/^order_[A-Za-z0-9]+$/.test(razorpayOrderId)) {
        return ApiResponse.error(res, 'Invalid gateway order reference format.', null, 400);
      }

      const recorded = await SubscriptionFulfillmentService.recordPaymentFailure({
        orderNo,
        razorpayOrderId,
        razorpayPaymentId: req.body.razorpay_payment_id || req.body.razorpayPaymentId || null,
        failureCode: req.body.error_code || req.body.failure_code || 'PAYMENT_FAILED',
        failureReason: req.body.error_description || req.body.failure_reason || 'Payment failed or cancelled at gateway.',
        publicOnboardingOnly: true,
      });

      if (!recorded) {
        return ApiResponse.error(res, 'Onboarding order reference not found or cannot be updated.', null, 404);
      }

      return ApiResponse.success(res, 'Onboarding payment failure recorded.', recorded);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/saas/orders/:orderNo
   * Retrieves order & Zero-GST Printable Receipt strictly for Onboarding Payment Success & Payment Failed pages
   */
  static async getPublicOrderDetails(req, res, next) {
    try {
      const orderNo = String(req.params.orderNo || '').trim();
      // Strictly restrict public lookups to non-sequential onboarding order_no (ORD-YYYYMMDD-XXXXXX) or Razorpay order_id (order_...)
      if (!orderNo || !/^(ORD-\d{8}-\d{6}|order_[A-Za-z0-9]+)$/.test(orderNo)) {
        return ApiResponse.error(res, 'Valid onboarding order reference number is required.', null, 400);
      }

      const order = await SubscriptionFulfillmentService.getOrderWithInvoice(orderNo, null, {
        publicOnboardingOnly: true,
      });
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
      if (!decoded || decoded.type !== 'onboarding_handover' || !decoded.email || !decoded.schoolId) {
        return ApiResponse.error(res, 'Invalid or expired onboarding handover token.', null, 401);
      }

      // Enforce strictly single-use handover token via row lock on the onboarding order
      if (decoded.orderNo || decoded.schoolId) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [orderRows] = await conn.query(
            `SELECT id, payload_snapshot_json
             FROM subscription_payment_orders
             WHERE school_id = ?
               AND (? IS NULL OR order_no = ?)
             ORDER BY id DESC
             LIMIT 1 FOR UPDATE`,
            [decoded.schoolId, decoded.orderNo || null, decoded.orderNo || null]
          );
          if (orderRows.length > 0) {
            let snap = {};
            try {
              snap = orderRows[0].payload_snapshot_json
                ? JSON.parse(orderRows[0].payload_snapshot_json)
                : {};
            } catch (_) {}
            const extra = snap.extra || {};
            if (
              extra.handover_consumed_at ||
              (extra.handover_jti && decoded.jti && extra.handover_jti !== decoded.jti)
            ) {
              await conn.rollback();
              return ApiResponse.error(
                res,
                'This onboarding handover token has already been used. Please log in with your credentials.',
                null,
                401
              );
            }
            snap.extra = {
              ...extra,
              handover_consumed_at: new Date().toISOString(),
            };
            await conn.query(
              'UPDATE subscription_payment_orders SET payload_snapshot_json = ? WHERE id = ?',
              [JSON.stringify(snap), orderRows[0].id]
            );
          }
          await conn.commit();
        } catch (lockErr) {
          await conn.rollback();
          throw lockErr;
        } finally {
          conn.release();
        }
      }

      const AdminUserModel = require('../models/adminUser.model');
      const PermissionModel = require('../models/permission.model');
      const config = require('../config/app.config');

      const user = await AdminUserModel.findByEmail(decoded.email.trim(), decoded.schoolId);
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
        branchId: user.branch_id || null,
        branchName: user.branch_name || null,
        branchCode: user.branch_code || null,
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
          registrationType: user.registration_type || 'single',
          branchId: user.branch_id || null,
          branch_id: user.branch_id || null,
          branchName: user.branch_name || null,
          branchCode: user.branch_code || null,
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
