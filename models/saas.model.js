const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');
const { saveBase64File } = require('../utils/file.util');
const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');
const SubscriptionAlertService = require('../services/subscriptionAlert.service');
const {
  getBillingCycleMeta,
  getTodayIST,
} = require('../constants/subscriptionModules.constant');

function buildPlanFeaturesMap(planFeaturesJson = null, items = []) {
  const featuresMap = {};

  if (planFeaturesJson) {
    let parsed = planFeaturesJson;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (_) {
        parsed = null;
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (k && Boolean(v)) featuresMap[String(k).toLowerCase()] = true;
      }
    }
  }

  for (const it of items || []) {
    if (it?.item_code) {
      const lower = String(it.item_code).trim().toLowerCase();
      featuresMap[lower] = true;
    }
  }
  return featuresMap;
}

class SaasModel {
  /**
   * Get all active subscription plans dynamically from DB (including all 5 billing cycles, tier_rank, storage & gated modules)
   */
  static async getActivePlans() {
    const query = `
      SELECT id, plan_name, plan_code, plan_group, tier_rank, description, price, original_price, billing_cycle,
             free_trial_days, max_students, included_storage_gb, is_popular, features_json, status, created_at
      FROM subscription_plans
      WHERE status = 1
      ORDER BY tier_rank ASC, price ASC
    `;
    const [rows] = await pool.query(query);
    const plans = [];

    for (const row of rows) {
      const [items] = await pool.query(
        'SELECT id, item_name, item_code, item_type, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY FIELD(item_type, "module", "feature"), id ASC',
        [row.id]
      );

      const featuresMap = buildPlanFeaturesMap(row.features_json, items || []);
      const sellingPrice = parseFloat(row.price) || 0;
      const rawOrig =
        row.original_price !== null && row.original_price !== undefined && row.original_price !== ''
          ? parseFloat(row.original_price)
          : null;
      const validOrig =
        rawOrig !== null && !isNaN(rawOrig) && rawOrig > sellingPrice
          ? Number(rawOrig.toFixed(2))
          : null;

      plans.push({
        ...row,
        original_price: validOrig,
        discount_amount: validOrig ? Number((validOrig - sellingPrice).toFixed(2)) : 0,
        discount_percent: validOrig
          ? Math.round(((validOrig - sellingPrice) / validOrig) * 100)
          : 0,
        tier_rank: Number(row.tier_rank) || 1,
        included_storage_gb: Math.max(0, parseInt(row.included_storage_gb, 10) || 0),
        is_popular: Number(row.is_popular) === 1 ? 1 : 0,
        max_students: Number(row.max_students) || 0,
        max_teachers: 0, // Unlimited teachers on all plans
        max_branches: 0, // Unlimited branches on all plans
        cycle_meta: getBillingCycleMeta(row.billing_cycle, row.free_trial_days),
        features: featuresMap,
        items: items || [],
      });
    }
    return plans;
  }

  /**
   * Check if a user / school is eligible to activate a free trial.
   * Enforces STRICT ONE-TRIAL-EVER across ALL plans (not per-plan) and blocks trial claims for existing paid subscribers.
   */
  static async checkTrialEligibility(
    { planId, email = null, schoolCode = null, phone = null, schoolId = null },
    connection = null
  ) {
    const db = connection || pool;
    const targetPlanId = parseInt(planId, 10);
    if (!targetPlanId) {
      return { is_eligible: false, reason: 'Invalid or missing plan ID.' };
    }

    const [planRows] = await db.query(
      'SELECT id, plan_name, price, billing_cycle, tier_rank, free_trial_days FROM subscription_plans WHERE id = ? AND status = 1 LIMIT 1',
      [targetPlanId]
    );
    const plan = planRows[0];
    if (!plan) {
      return { is_eligible: false, reason: 'The requested plan was not found or is inactive.' };
    }

    const freeTrialDays = parseInt(plan.free_trial_days, 10) || 0;
    if (freeTrialDays <= 0) {
      return {
        is_eligible: false,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        free_trial_days: 0,
        reason: `The "${plan.plan_name}" plan does not include a free trial.`,
      };
    }

    const effectiveTrialDays = freeTrialDays;
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanPhone = phone ? String(phone).trim() : null;
    const phoneDigits = cleanPhone ? cleanPhone.replace(/[^0-9]/g, '') : '';
    const phoneLast10 = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;
    const cleanCode = schoolCode ? String(schoolCode).trim().toUpperCase() : null;
    const cleanSchoolId = schoolId ? parseInt(schoolId, 10) : null;

    if (cleanEmail || phoneLast10 || cleanPhone || cleanCode || cleanSchoolId) {
      // Check ANY prior subscription (paid OR trial across ANY plan!) associated with this email, phone, school code, or school ID
      const [priorSubs] = await db.query(
        `SELECT ss.id, ss.status, ss.action_type, ss.start_date, ss.end_date, ss.payment_gateway,
                p.plan_name, p.billing_cycle, p.tier_rank, p.price
         FROM school_subscriptions ss
         JOIN subscription_plans p ON ss.plan_id = p.id
         LEFT JOIN school_master sm ON ss.school_id = sm.id
         LEFT JOIN user_master um ON um.school_id = sm.id
         WHERE ss.status != 'rejected'
           AND (
             (? IS NOT NULL AND LOWER(um.email) = ?)
             OR (? IS NOT NULL AND LOWER(sm.email) = ?)
             OR (? IS NOT NULL AND (sm.phone_number = ? OR um.phone = ?))
             OR (? IS NOT NULL AND (
                  RIGHT(REPLACE(REPLACE(REPLACE(COALESCE(sm.phone_number, ''), ' ', ''), '-', ''), '+', ''), 10) = ?
                  OR RIGHT(REPLACE(REPLACE(REPLACE(COALESCE(um.phone, ''), ' ', ''), '-', ''), '+', ''), 10) = ?
                ))
             OR (? IS NOT NULL AND sm.school_code = ?)
             OR (? IS NOT NULL AND ss.school_id = ?)
           )
         ORDER BY ss.id DESC
         LIMIT 5`,
        [
          cleanEmail, cleanEmail,
          cleanEmail, cleanEmail,
          cleanPhone, cleanPhone, cleanPhone,
          phoneLast10, phoneLast10, phoneLast10,
          cleanCode, cleanCode,
          cleanSchoolId, cleanSchoolId,
        ]
      );

      if (priorSubs.length > 0) {
        const paidRecord = priorSubs.find(
          (r) =>
            r.status !== 'trial' &&
            String(r.billing_cycle || '').toLowerCase() !== 'trial' &&
            r.payment_gateway !== 'free_trial'
        );

        if (paidRecord) {
          return {
            is_eligible: false,
            is_downgrade: true,
            already_claimed: true,
            plan_id: plan.id,
            plan_name: plan.plan_name,
            current_plan_name: paidRecord.plan_name,
            free_trial_days: effectiveTrialDays,
            reason: `Free trials are only available once for new schools. An existing subscription ("${paidRecord.plan_name}") is already associated with these credentials.`,
          };
        }

        const trialRecord = priorSubs[0];
        const todayStr = getTodayIST();
        const endStr = trialRecord.end_date ? new Date(trialRecord.end_date).toISOString().slice(0, 10) : '';
        const isExpired = trialRecord.status === 'expired' || (endStr && endStr < todayStr);

        return {
          is_eligible: false,
          already_claimed: true,
          plan_id: plan.id,
          plan_name: plan.plan_name,
          free_trial_days: effectiveTrialDays,
          trial_status: trialRecord.status,
          is_expired: isExpired,
          reason: isExpired
            ? `A free trial ("${trialRecord.plan_name}") was already used for this school/account and has expired. Free trials can only be claimed once—please choose a paid plan to continue.`
            : `A free trial ("${trialRecord.plan_name}") has already been claimed for this school/account. Free trials can only be activated once.`,
        };
      }
    }

    return {
      is_eligible: true,
      plan_id: plan.id,
      plan_name: plan.plan_name,
      free_trial_days: effectiveTrialDays,
      reason: `Eligible for a ${effectiveTrialDays}-day free trial of "${plan.plan_name}".`,
    };
  }

  /**
   * Check if email or phone is already registered for admin or school
   */
  static async checkAvailability({ adminEmail = null, adminPhone = null, schoolEmail = null, schoolPhone = null }) {
    if (adminEmail && adminEmail.trim()) {
      const cleanEmail = adminEmail.trim().toLowerCase();
      const [userRows] = await pool.query(
        'SELECT id FROM user_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1',
        [cleanEmail]
      );
      if (userRows.length > 0) {
        return {
          available: false,
          field: 'admin_email',
          message: `An account with the email "${cleanEmail}" already exists. Please use a different admin email.`,
        };
      }
    }

    if (adminPhone && adminPhone.trim()) {
      const cleanPhone = adminPhone.trim();
      const adminDigits = cleanPhone.replace(/[^0-9]/g, '');
      const adminLast10 = adminDigits.length >= 10 ? adminDigits.slice(-10) : adminDigits;
      const [phoneRows] = await pool.query(
        `SELECT id FROM user_master 
         WHERE phone IS NOT NULL AND phone != '' 
           AND (phone = ? OR (LENGTH(?) >= 10 AND RIGHT(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), 10) = ?))
           AND status != 4 
         LIMIT 1`,
        [cleanPhone, cleanPhone, adminLast10]
      );
      if (phoneRows.length > 0) {
        return {
          available: false,
          field: 'admin_phone',
          message: `An account with the phone number "${cleanPhone}" already exists. Please use a different admin phone number.`,
        };
      }
    }

    if (schoolEmail && schoolEmail.trim()) {
      const cleanSchoolEmail = schoolEmail.trim().toLowerCase();
      const [schoolEmailRows] = await pool.query(
        'SELECT id FROM school_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1',
        [cleanSchoolEmail]
      );
      if (schoolEmailRows.length > 0) {
        return {
          available: false,
          field: 'school_email',
          message: `A school with the email "${cleanSchoolEmail}" is already registered. Please use a different school email.`,
        };
      }
    }

    if (schoolPhone && schoolPhone.trim()) {
      const cleanSchoolPhone = schoolPhone.trim();
      const schoolDigits = cleanSchoolPhone.replace(/[^0-9]/g, '');
      const schoolLast10 = schoolDigits.length >= 10 ? schoolDigits.slice(-10) : schoolDigits;
      const [schoolPhoneRows] = await pool.query(
        `SELECT id FROM school_master 
         WHERE phone_number IS NOT NULL AND phone_number != '' 
           AND (phone_number = ? OR (LENGTH(?) >= 10 AND RIGHT(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '+', ''), 10) = ?))
           AND status != 4 
         LIMIT 1`,
        [cleanSchoolPhone, cleanSchoolPhone, schoolLast10]
      );
      if (schoolPhoneRows.length > 0) {
        return {
          available: false,
          field: 'school_phone',
          message: `A school with the helpline phone number "${cleanSchoolPhone}" is already registered. Please use a different school phone number.`,
        };
      }
    }

    return { available: true };
  }

  /**
   * Register a new school, Main Campus branch, initial Academic Year, Super Admin user,
   * and atomically fulfill the bound `subscription_payment_orders` record inside a SINGLE DB transaction.
   */
  static async registerSchoolWithPlan({
    planId,
    paymentOrderId,
    razorpayOrderId = null,
    razorpayPaymentId = null,
    schoolData = {},
    academicYearData = {},
    adminData = {},
    isTrial = false,
  }) {
    const connection = await pool.getConnection();
    let postCommitAlert = null;

    try {
      await connection.beginTransaction();

      // 1. Re-verify uniqueness inside transaction
      const adminEmail = (adminData.email || '').trim().toLowerCase();
      if (!adminEmail) {
        const err = new Error('Admin Email is required.');
        err.statusCode = 400;
        throw err;
      }

      const [existingUser] = await connection.query(
        'SELECT id FROM user_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1',
        [adminEmail]
      );
      if (existingUser.length > 0) {
        const err = new Error(`An account with the email "${adminEmail}" already exists. Please use a different admin email.`);
        err.statusCode = 400;
        throw err;
      }

      const adminPhone = (adminData.phone || '').trim();
      if (adminPhone) {
        const adminDigits = adminPhone.replace(/[^0-9]/g, '');
        const adminLast10 = adminDigits.length >= 10 ? adminDigits.slice(-10) : adminDigits;
        const [existingPhone] = await connection.query(
          `SELECT id FROM user_master 
           WHERE phone IS NOT NULL AND phone != '' 
             AND (phone = ? OR (LENGTH(?) >= 10 AND RIGHT(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), 10) = ?))
             AND status != 4 
           LIMIT 1`,
          [adminPhone, adminPhone, adminLast10]
        );
        if (existingPhone.length > 0) {
          const err = new Error(`An account with the phone number "${adminPhone}" already exists. Please use a different admin phone number.`);
          err.statusCode = 400;
          throw err;
        }
      }

      const effectiveSchoolEmail = (schoolData.email || adminEmail).trim().toLowerCase();
      if (effectiveSchoolEmail) {
        const [existingSchoolEmail] = await connection.query(
          'SELECT id FROM school_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1',
          [effectiveSchoolEmail]
        );
        if (existingSchoolEmail.length > 0) {
          const err = new Error(`A school with the email "${effectiveSchoolEmail}" is already registered. Please use a different school email.`);
          err.statusCode = 400;
          throw err;
        }
      }

      const schoolPhone = (schoolData.phone_number || '').trim();
      if (schoolPhone) {
        const schoolDigits = schoolPhone.replace(/[^0-9]/g, '');
        const schoolLast10 = schoolDigits.length >= 10 ? schoolDigits.slice(-10) : schoolDigits;
        const [existingSchoolPhone] = await connection.query(
          `SELECT id FROM school_master 
           WHERE phone_number IS NOT NULL AND phone_number != '' 
             AND (phone_number = ? OR (LENGTH(?) >= 10 AND RIGHT(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '+', ''), 10) = ?))
             AND status != 4 
           LIMIT 1`,
          [schoolPhone, schoolPhone, schoolLast10]
        );
        if (existingSchoolPhone.length > 0) {
          const err = new Error(`A school with the helpline phone number "${schoolPhone}" is already registered. Please use a different school phone number.`);
          err.statusCode = 400;
          throw err;
        }
      }

      // 2. Re-verify trial eligibility inside transaction before inserting anything
      if (isTrial) {
        const eligibility = await SaasModel.checkTrialEligibility(
          {
            planId,
            email: adminEmail,
            schoolCode: schoolData.school_code,
            phone: schoolPhone || adminPhone,
          },
          connection
        );
        if (!eligibility.is_eligible) {
          const err = new Error(eligibility.reason || 'Not eligible for a free trial.');
          err.statusCode = 403;
          throw err;
        }
      }

      // 3. Lock and verify the server-bound payment order BEFORE creating the school
      //    (prevents replaying a paid Razorpay order across two school registrations!)
      const [orderLockRows] = await connection.query(
        `SELECT * FROM subscription_payment_orders
         WHERE ${paymentOrderId ? 'id = ?' : 'razorpay_order_id = ?'}
         LIMIT 1 FOR UPDATE`,
        [paymentOrderId || razorpayOrderId]
      );
      if (orderLockRows.length === 0) {
        const err = new Error('Checkout order record was not found. Please re-initiate payment from the review step.');
        err.statusCode = 404;
        throw err;
      }

      const lockedOrder = orderLockRows[0];
      if (lockedOrder.status === 'paid' || lockedOrder.school_id) {
        const err = new Error('This payment order has already been redeemed for a school registration.');
        err.statusCode = 409;
        throw err;
      }
      if (Number(lockedOrder.plan_id) !== Number(planId)) {
        const err = new Error('Plan mismatch detected between payment order and registration request.');
        err.statusCode = 400;
        throw err;
      }

      // 4. Process School Logo if uploaded as base64
      let logoPath = schoolData.school_logo || null;
      if (logoPath && logoPath.startsWith('data:')) {
        logoPath = saveBase64File(logoPath, 'school', 'Logo');
      }

      // 5. Generate unique School Code
      let schoolCode = (schoolData.school_code || '').trim().toUpperCase();
      if (!schoolCode) {
        const cleanName = (schoolData.school_name || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
        schoolCode = cleanName ? `${cleanName}-${Math.floor(1000 + Math.random() * 9000)}` : `${Math.floor(100000 + Math.random() * 900000)}`;
      }
      const [existingCode] = await connection.query(
        'SELECT id FROM school_master WHERE school_code = ? LIMIT 1',
        [schoolCode]
      );
      if (existingCode.length > 0) {
        schoolCode = `${schoolCode}-${Date.now().toString().slice(-4)}`;
      }

      // 6. Insert into school_master
      const schoolName = (schoolData.school_name || '').trim();
      const currentYear = new Date().getFullYear();
      const defaultFooter = `Copyright © ${currentYear} ${schoolName} - School Management System`;
      const footerText = (schoolData.footer || '').trim() || defaultFooter;

      const countryId = schoolData.country && !isNaN(schoolData.country) ? parseInt(schoolData.country, 10) : 101;
      const stateId = schoolData.state && !isNaN(schoolData.state) ? parseInt(schoolData.state, 10) : null;
      const cityId = schoolData.city && !isNaN(schoolData.city) ? parseInt(schoolData.city, 10) : null;
      const regType = (schoolData.registration_type === 'multiple' || schoolData.registrationType === 'multiple') ? 'multiple' : 'single';

      const [schoolResult] = await connection.query(
        `INSERT INTO school_master (
          school_name, school_code, school_logo, address, city, state, country,
          postal_code, phone_number, email, website, established_year,
          school_type, affiliation_board, medium_of_instruction, registration_type, footer, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [
          schoolName,
          schoolCode,
          logoPath,
          schoolData.address || null,
          cityId,
          stateId,
          countryId,
          schoolData.postal_code || null,
          schoolData.phone_number || null,
          schoolData.email || adminEmail,
          schoolData.website || null,
          schoolData.established_year ? String(schoolData.established_year) : null,
          (schoolData.school_type || '').trim() || null,
          (schoolData.affiliation_board || '').trim() || null,
          (schoolData.medium_of_instruction || '').trim() || null,
          regType,
          footerText,
        ]
      );
      const schoolId = schoolResult.insertId;

      // 7. Create Main Campus branch
      const cleanBranchCode = (schoolCode || 'MAIN').toUpperCase();
      const branchCode = cleanBranchCode === 'MAIN' ? 'MAIN-01' : `${cleanBranchCode}-MAIN`;
      const [branchResult] = await connection.query(
        `INSERT INTO branch_master (
          school_id, branch_name, branch_code, address, country_id, state_id, city_id,
          pincode, phone, email, is_main_branch, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`,
        [
          schoolId,
          `${schoolName} (Main Campus)`,
          branchCode,
          schoolData.address || null,
          countryId,
          stateId,
          cityId,
          schoolData.postal_code || null,
          schoolData.phone_number || null,
          schoolData.email || adminEmail,
        ]
      );
      const mainBranchId = branchResult.insertId;

      try {
        await connection.query(
          'INSERT INTO weekends (school_id, branch_id, weekends) VALUES (?, ?, 6), (?, ?, 7)',
          [schoolId, mainBranchId, schoolId, mainBranchId]
        );
      } catch (_) {}

      // 8. Insert initial Academic Year
      const yearName = (academicYearData.academic_year || `${currentYear} - ${currentYear + 1}`).trim();
      const yearStart = academicYearData.start_date || `${currentYear}-04-01`;
      const yearEnd = academicYearData.end_date || `${currentYear + 1}-03-31`;

      await connection.query(
        `INSERT INTO academic_year_master (
          school_id, branch_id, academic_year, start_date, end_date, is_current, status
        ) VALUES (?, ?, ?, ?, ?, 1, 1)`,
        [schoolId, mainBranchId, yearName, yearStart, yearEnd]
      );

      // 9. Insert School Super Admin into user_master
      const hashedPassword = await hashPassword(adminData.password);
      let adminPicturePath = adminData.picture || null;
      if (adminPicturePath && adminPicturePath.startsWith('data:')) {
        adminPicturePath = saveBase64File(adminPicturePath, 'staff', 'Admin');
      }

      const genderId = (adminData.gender !== undefined && adminData.gender !== null && !isNaN(adminData.gender))
        ? parseInt(adminData.gender, 10)
        : 1;
      const adminCountryId = (adminData.country_id !== undefined && adminData.country_id !== null && !isNaN(adminData.country_id))
        ? parseInt(adminData.country_id, 10)
        : countryId;
      const adminStateId = (adminData.state_id !== undefined && adminData.state_id !== null && !isNaN(adminData.state_id))
        ? parseInt(adminData.state_id, 10)
        : stateId;
      const adminCityId = (adminData.city !== undefined && adminData.city !== null && !isNaN(adminData.city))
        ? parseInt(adminData.city, 10)
        : cityId;
      const adminRole = (adminData.role !== undefined && adminData.role !== null && !isNaN(adminData.role))
        ? parseInt(adminData.role, 10)
        : 0;

      const [adminResult] = await connection.query(
        `INSERT INTO user_master (
          school_id, branch_id, first_name, last_name, email, phone, password,
          gender, picture, country_id, state_id, city, role, admin_type, status, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW())`,
        [
          schoolId,
          mainBranchId,
          (adminData.first_name || '').trim(),
          (adminData.last_name || '').trim(),
          adminEmail,
          adminData.phone || null,
          hashedPassword,
          genderId,
          adminPicturePath,
          adminCountryId,
          adminStateId,
          adminCityId,
          adminRole,
        ]
      );
      const adminUserId = adminResult.insertId;

      if (adminUserId && mainBranchId) {
        await connection.query(
          'UPDATE branch_master SET head_user_id = ?, updated_at = NOW() WHERE id = ? AND school_id = ?',
          [adminUserId, mainBranchId, schoolId]
        );
      }

      // 10. Atomically fulfill subscription + storage + hardware + RFID + SMS/Push wallet + Zero-GST Invoice!
      const fulfilled = await SubscriptionFulfillmentService.fulfillPaidOrder({
        orderId: lockedOrder.id,
        razorpayPaymentId: razorpayPaymentId || null,
        schoolIdOverride: schoolId,
        actorType: 'onboarding',
        actorId: adminUserId,
        verificationNotes: isTrial
          ? (lockedOrder.grand_total > 0 ? 'Free trial activated with paid add-ons on onboarding' : 'Free trial activated on onboarding')
          : 'Activated immediately on verified onboarding checkout',
        externalConnection: connection,
      });

      // Ensure branch_id is populated on any onboarding attendance machines
      await connection.query(
        'UPDATE school_attendance_machines SET branch_id = COALESCE(branch_id, ?) WHERE school_id = ? AND payment_order_id = ?',
        [mainBranchId, schoolId, lockedOrder.id]
      );

      await connection.commit();

      if (fulfilled.grandTotal > 0) {
        postCommitAlert = {
          schoolId,
          planName: fulfilled.planName,
          invoiceNo: fulfilled.invoiceNo,
          amountPaid: fulfilled.grandTotal,
          startDate: fulfilled.startDate,
          endDate: fulfilled.endDate,
        };
        setImmediate(() => {
          SubscriptionAlertService.sendPaymentSuccessAlert(postCommitAlert).catch(() => {});
        });
      }

      return {
        schoolId,
        schoolName: schoolData.school_name,
        schoolCode,
        branchId: mainBranchId,
        adminUserId,
        adminEmail,
        subscriptionId: fulfilled.subscriptionId,
        orderNo: fulfilled.orderNo,
        invoiceNo: fulfilled.invoiceNo,
        planName: fulfilled.planName,
        startDate: fulfilled.startDate,
        endDate: fulfilled.endDate,
        amountPaid: fulfilled.grandTotal,
        taxAmount: 0,
        status: isTrial ? 'trial' : 'active',
        transactionId: razorpayPaymentId || fulfilled.orderNo,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Fetch all active countries
   */
  static async getCountries() {
    const [rows] = await pool.query(
      'SELECT id, name, shortname, phonecode FROM countries WHERE status = 1 OR status IS NULL ORDER BY name ASC'
    );
    return rows;
  }

  /**
   * Fetch states by country ID
   */
  static async getStates(countryId) {
    const [rows] = await pool.query(
      'SELECT id_state AS id, state AS name FROM states WHERE country_id = ? AND (is_active = 1 OR is_active IS NULL) ORDER BY state ASC',
      [countryId]
    );
    return rows;
  }

  /**
   * Fetch cities by state ID
   */
  static async getCities(stateId) {
    const [rows] = await pool.query(
      'SELECT id, name FROM cities WHERE state_id = ? ORDER BY name ASC',
      [stateId]
    );
    return rows;
  }

  /**
   * Fetch all genders from gender_master
   */
  static async getGenders() {
    const [rows] = await pool.query(
      'SELECT id, gender FROM gender_master ORDER BY id ASC'
    );
    return rows;
  }
}

module.exports = SaasModel;
