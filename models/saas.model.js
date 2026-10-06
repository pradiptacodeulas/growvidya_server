const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');
const { saveBase64File } = require('../utils/file.util');

class SaasModel {
  /**
   * Get all active subscription plans
   */
  static async getActivePlans() {
    const query = `
      SELECT id, plan_name, plan_code, description, price, billing_cycle,
             free_trial_days, max_students, status, created_at
      FROM subscription_plans
      WHERE status = 1
      ORDER BY price ASC
    `;
    const [rows] = await pool.query(query);
    const plans = [];
    for (const row of rows) {
      const [items] = await pool.query(
        'SELECT id, item_name, item_code, description FROM subscription_items WHERE sub_id = ? AND status = 1 ORDER BY id ASC',
        [row.id]
      );
      // Map item codes to a features map for frontend backwards compatibility
      const featuresMap = {};
      (items || []).forEach(it => {
        if (it.item_code) featuresMap[it.item_code.toLowerCase()] = true;
      });

      plans.push({
        ...row,
        features: featuresMap,
        items: items || [],
      });
    }
    return plans;
  }

  /**
   * Check if a user / school is eligible to activate a free trial for a specific plan.
   * Prevents repeatedly claiming the same free trial dynamically from the backend.
   */
  static async checkTrialEligibility({ planId, email = null, schoolCode = null, phone = null, schoolId = null }) {
    const targetPlanId = parseInt(planId, 10);
    if (!targetPlanId) {
      return { is_eligible: false, reason: 'Invalid or missing plan ID.' };
    }

    const [planRows] = await pool.query(
      `SELECT id, plan_name, price, billing_cycle, free_trial_days FROM subscription_plans WHERE id = ? LIMIT 1`,
      [targetPlanId]
    );
    const plan = planRows[0];
    if (!plan) {
      return { is_eligible: false, reason: 'The requested plan was not found.' };
    }

    const freeTrialDays = parseInt(plan.free_trial_days, 10) || 0;
    if (freeTrialDays <= 0 && plan.billing_cycle !== 'trial') {
      return {
        is_eligible: false,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        free_trial_days: 0,
        reason: `The "${plan.plan_name}" plan does not offer a free trial.`,
      };
    }

    const cleanEmail = email ? email.trim().toLowerCase() : null;
    const cleanPhone = phone ? phone.trim() : null;
    const cleanCode = schoolCode ? schoolCode.trim().toUpperCase() : null;
    const cleanSchoolId = schoolId ? parseInt(schoolId, 10) : null;

    if (cleanEmail || cleanPhone || cleanCode || cleanSchoolId) {
      // 1. Check if school or user already has an active higher-tier plan (prohibiting downgrade)
      const [activeSubs] = await pool.query(
        `SELECT ss.id, ss.status, ss.plan_id, p.plan_name, p.price
         FROM school_subscriptions ss
         JOIN subscription_plans p ON ss.plan_id = p.id
         LEFT JOIN school_master sm ON ss.school_id = sm.id
         LEFT JOIN user_master um ON um.school_id = sm.id
         WHERE ss.status = 'active'
           AND ss.payment_gateway != 'free_trial'
           AND (
             (? IS NOT NULL AND LOWER(um.email) = ?)
             OR (? IS NOT NULL AND LOWER(sm.email) = ?)
             OR (? IS NOT NULL AND sm.phone_number = ?)
             OR (? IS NOT NULL AND sm.school_code = ?)
             OR (? IS NOT NULL AND ss.school_id = ?)
           )
         ORDER BY p.price DESC
         LIMIT 1`,
        [
          cleanEmail, cleanEmail,
          cleanEmail, cleanEmail,
          cleanPhone, cleanPhone,
          cleanCode, cleanCode,
          cleanSchoolId, cleanSchoolId,
        ]
      );

      if (activeSubs.length > 0) {
        const activeSub = activeSubs[0];
        const activePrice = parseFloat(activeSub.price || 0);
        const targetPrice = parseFloat(plan.price || 0);
        if (activePrice > 0 && targetPrice < activePrice) {
          return {
            is_eligible: false,
            is_downgrade: true,
            plan_id: plan.id,
            plan_name: plan.plan_name,
            current_plan_name: activeSub.plan_name,
            current_plan_price: activePrice,
            free_trial_days: freeTrialDays,
            reason: `Downgrading to a lower-tier plan is not permitted. You are currently subscribed to the "${activeSub.plan_name}" plan (₹${activePrice.toFixed(2)}). You may only remain on your current plan or move to an equal or higher-tier plan.`,
          };
        }
      }

      // 2. Check for any prior free trial subscriptions for this plan associated with this user or school
      const [existingTrial] = await pool.query(
        `SELECT ss.id, ss.status, ss.start_date, ss.end_date, ss.payment_gateway, ss.created_at
         FROM school_subscriptions ss
         LEFT JOIN school_master sm ON ss.school_id = sm.id
         LEFT JOIN user_master um ON um.school_id = sm.id
         WHERE ss.plan_id = ?
           AND (
             (ss.payment_gateway IN ('free_trial', 'trial'))
             OR (ss.status IN ('trial', 'expired'))
           )
           AND (
             (? IS NOT NULL AND LOWER(um.email) = ?)
             OR (? IS NOT NULL AND LOWER(sm.email) = ?)
             OR (? IS NOT NULL AND sm.phone_number = ?)
             OR (? IS NOT NULL AND sm.school_code = ?)
             OR (? IS NOT NULL AND ss.school_id = ?)
           )
         ORDER BY ss.id DESC
         LIMIT 1`,
        [
          targetPlanId,
          cleanEmail, cleanEmail,
          cleanEmail, cleanEmail,
          cleanPhone, cleanPhone,
          cleanCode, cleanCode,
          cleanSchoolId, cleanSchoolId,
        ]
      );

      if (existingTrial.length > 0) {
        const trialRecord = existingTrial[0];
        const isExpired = trialRecord.status === 'expired' || new Date(trialRecord.end_date) < new Date();
        return {
          is_eligible: false,
          plan_id: plan.id,
          plan_name: plan.plan_name,
          free_trial_days: freeTrialDays,
          trial_status: trialRecord.status,
          is_expired: isExpired,
          already_claimed: true,
          reason: isExpired
            ? `Your free trial for the "${plan.plan_name}" plan has expired. Free trials can only be activated once per plan. Please purchase a subscription to continue using this plan.`
            : `You have already activated or claimed a free trial for the "${plan.plan_name}" plan. Free trials can only be activated once per plan.`,
        };
      }
    }

    return {
      is_eligible: true,
      plan_id: plan.id,
      plan_name: plan.plan_name,
      free_trial_days: freeTrialDays,
      reason: `Eligible for a ${freeTrialDays}-day free trial of "${plan.plan_name}".`,
    };
  }

  /**
   * Check if email or phone is already registered for admin or school
   */
  static async checkAvailability({ adminEmail = null, adminPhone = null, schoolEmail = null, schoolPhone = null }) {
    if (adminEmail && adminEmail.trim()) {
      const cleanEmail = adminEmail.trim().toLowerCase();
      const [userRows] = await pool.query(
        `SELECT id FROM user_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1`,
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
        `SELECT id FROM school_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1`,
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
   * Register a new school with chosen plan and create the first Super Admin user.
   * All operations are executed atomically in a single transaction.
   */
  static async registerSchoolWithPlan({
    planId,
    amountPaid,
    paymentGateway = 'dummy',
    paymentTransactionId = null,
    schoolData = {},
    academicYearData = {},
    adminData = {},
    isTrial = false,
    couponCode = null,
    storagePlanId = null,
    storageQty = 1,
    selectedMachines = [],
    selectedCards = [],
    selectedNotifications = [],
    shippingAddress = null,
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Check if admin email already exists in user_master
      const adminEmail = (adminData.email || '').trim().toLowerCase();
      if (!adminEmail) {
        const err = new Error('Admin Email is required.');
        err.statusCode = 400;
        throw err;
      }

      const [existingUser] = await connection.query(
        `SELECT id FROM user_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1`,
        [adminEmail]
      );
      if (existingUser.length > 0) {
        const err = new Error(`An account with the email "${adminEmail}" already exists. Please use a different admin email.`);
        err.statusCode = 400;
        throw err;
      }

      // Check if admin phone already exists in user_master
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

      // Check if school email already exists in school_master
      const effectiveSchoolEmail = (schoolData.email || adminEmail).trim().toLowerCase();
      if (effectiveSchoolEmail) {
        const [existingSchoolEmail] = await connection.query(
          `SELECT id FROM school_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1`,
          [effectiveSchoolEmail]
        );
        if (existingSchoolEmail.length > 0) {
          const err = new Error(`A school with the email "${effectiveSchoolEmail}" is already registered. Please use a different school email.`);
          err.statusCode = 400;
          throw err;
        }
      }

      // Check if school helpline phone already exists in school_master
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

      // 2. Process School Logo if uploaded as base64
      let logoPath = schoolData.school_logo || null;
      if (logoPath && logoPath.startsWith('data:')) {
        logoPath = saveBase64File(logoPath, 'school', 'Logo');
      }

      // 3. Generate clean School Code if not provided
      let schoolCode = (schoolData.school_code || '').trim().toUpperCase();
      if (!schoolCode) {
        const cleanName = (schoolData.school_name || 'SCH').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
        schoolCode = `${cleanName}-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      // Check if school_code already exists, if so generate a unique suffix
      const [existingCode] = await connection.query(
        `SELECT id FROM school_master WHERE school_code = ? LIMIT 1`,
        [schoolCode]
      );
      if (existingCode.length > 0) {
        schoolCode = `${schoolCode}-${Date.now().toString().slice(-4)}`;
      }

      // 4. Insert into school_master (ALL columns)
      const schoolName = (schoolData.school_name || '').trim();
      const currentYear = new Date().getFullYear();
      const defaultFooter = `Copyright © ${currentYear} ${schoolName} - School Management System`;
      const footerText = (schoolData.footer || '').trim() || defaultFooter;

      const countryId = schoolData.country && !isNaN(schoolData.country) ? parseInt(schoolData.country, 10) : 101;
      const stateId = schoolData.state && !isNaN(schoolData.state) ? parseInt(schoolData.state, 10) : null;
      const cityId = schoolData.city && !isNaN(schoolData.city) ? parseInt(schoolData.city, 10) : null;

      const insertSchoolQuery = `
        INSERT INTO school_master (
          school_name, school_code, school_logo, address, city, state, country,
          postal_code, phone_number, email, website, established_year,
          school_type, affiliation_board, medium_of_instruction, footer, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
      `;
      const [schoolResult] = await connection.query(insertSchoolQuery, [
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
        footerText,
      ]);
      const schoolId = schoolResult.insertId;

      // Seed default weekends for the newly created school (Saturday: 6, Sunday: 7)
      try {
        await connection.query(
          `INSERT INTO weekends (school_id, weekends) VALUES (?, 6), (?, 7)`,
          [schoolId, schoolId]
        );
      } catch (weekendErr) {
        console.warn('Could not insert default weekends:', weekendErr.message);
      }

      // 4b. Create default Main Campus branch for the new school
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

      // 5. Get plan details to calculate subscription duration
      let effectivePlanId = parseInt(planId, 10);
      const [planRows] = await connection.query(
        `SELECT id, plan_name, price, billing_cycle, free_trial_days FROM subscription_plans WHERE id = ? LIMIT 1`,
        [effectivePlanId]
      );
      const plan = planRows[0];
      if (!plan) {
        throw new Error('Selected subscription plan not found.');
      }

      const isTrialMode = Boolean(isTrial) || plan.billing_cycle === 'trial' || parseFloat(plan.price) === 0;

      // Enforce trial eligibility dynamically from the backend
      if (isTrialMode) {
        const eligibility = await SaasModel.checkTrialEligibility({
          planId: effectivePlanId,
          email: adminEmail,
          schoolCode: schoolData.school_code,
          phone: schoolData.phone_number || adminData.phone,
        });
        if (!eligibility.is_eligible) {
          throw new Error(eligibility.reason || 'You are not eligible for a free trial on this plan.');
        }
      }

      const AdminSubscriptionController = require('../controllers/adminSubscription.controller');
      const calculateVerifiedTotal = AdminSubscriptionController.calculateVerifiedTotal;

      const { totalAmount, originalAmount, discountAmount, couponInfo, breakdown } = await calculateVerifiedTotal({
        plan,
        is_trial: isTrialMode,
        storage_plan_id: storagePlanId,
        storage_qty: storageQty,
        selected_machines: selectedMachines,
        selected_cards: selectedCards,
        selected_notifications: selectedNotifications,
        coupon_code: couponCode,
        school_id: null,
      });

      const couponId = couponInfo?.id || null;
      const finalAmount = amountPaid !== undefined ? parseFloat(amountPaid) : totalAmount;
      const trialDays = plan.free_trial_days !== undefined && plan.free_trial_days !== null ? parseInt(plan.free_trial_days, 10) : 0;
      const finalTxnId = isTrialMode
        ? (paymentTransactionId || `TRIAL_${trialDays > 0 ? trialDays : 14}D_${Date.now()}_${Math.floor(Math.random() * 10000)}`)
        : (paymentTransactionId || `REG_REQ_${Date.now()}_${Math.floor(Math.random() * 10000)}`);
      const finalGateway = isTrialMode ? 'free_trial' : (paymentGateway || 'registration');
      const subStatus = isTrialMode ? 'trial' : (paymentTransactionId ? 'active' : 'pending');
      const paymentStatus = isTrialMode ? 'completed' : (paymentTransactionId ? 'completed' : 'pending');

      // Calculate subscription end date (dynamic trial days from backend, 1 year for annual, 30 days for monthly)
      const startDate = new Date();
      const endDate = new Date();
      if (isTrialMode) {
        if (trialDays <= 0 && plan.billing_cycle !== 'trial') {
          throw new Error(`The selected plan "${plan.plan_name}" does not offer a free trial.`);
        }
        endDate.setDate(endDate.getDate() + (trialDays > 0 ? trialDays : 14));
      } else {
        if (plan.billing_cycle === 'monthly') {
          endDate.setMonth(endDate.getMonth() + 1);
        } else {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }
        // BONUS: If the plan has free_trial_days, add those bonus days to the paid subscription period!
        if (trialDays > 0) {
          endDate.setDate(endDate.getDate() + trialDays);
        }
      }

      const formatDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const startDateStr = formatDate(startDate);
      const endDateStr = formatDate(endDate);

      // Insert into school_subscriptions (active immediately for free trials, pending for manual review of paid plans)
      const insertSubQuery = `
        INSERT INTO school_subscriptions (
          school_id, plan_id, coupon_id, original_amount, discount_amount,
          amount_paid, payment_gateway, payment_transaction_id, payment_status,
          start_date, end_date, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      const [subResult] = await connection.query(insertSubQuery, [
        schoolId,
        plan.id,
        couponId,
        originalAmount,
        discountAmount,
        finalAmount,
        finalGateway,
        finalTxnId,
        paymentStatus,
        startDateStr,
        endDateStr,
        subStatus,
      ]);
      const subscriptionId = subResult.insertId;

      if (couponId && discountAmount > 0) {
        await connection.query(
          'INSERT INTO coupon_usages (coupon_id, school_id, subscription_id, discount_amount, used_at) VALUES (?, ?, ?, ?, NOW())',
          [couponId, schoolId, subscriptionId, discountAmount]
        );
        await connection.query(
          'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?',
          [couponId]
        );
      }

      // 5b. Record RFID card purchase order in school_rfid_orders if cards were ordered
      if (breakdown.cards && breakdown.cards.length > 0) {
        for (const card of breakdown.cards) {
          try {
            const orderNo = `RFID_${schoolId}_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
            await connection.query(
              `INSERT INTO school_rfid_orders 
               (order_no, school_id, rfid_card_id, quantity, unit_price, total_amount, order_status, shipping_address, remarks, created_at, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'Ordered during school onboarding registration', NOW(), NOW())`,
              [orderNo, schoolId, card.id, card.quantity, card.unit_price, card.total_price, shippingAddress || schoolData.address || 'Main School Campus']
            );
          } catch (rfidErr) {
            console.error('Failed to log school_rfid_orders during onboarding:', rfidErr.message);
          }
        }
      }

      // 5c. Record attendance machines in school_attendance_machines if machines were ordered
      if (breakdown.machines && breakdown.machines.length > 0) {
        for (const machine of breakdown.machines) {
          try {
            for (let i = 0; i < machine.quantity; i++) {
              const serialNo = `DEV_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
              await connection.query(
                `INSERT INTO school_attendance_machines 
                 (school_id, branch_id, machine_master_id, device_serial_number, device_location, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'Main School Gate - Scheduled Onboarding Setup', 0, NOW(), NOW())`,
                [schoolId, mainBranchId, machine.id, serialNo]
              );
            }
          } catch (mErr) {
            console.error('Failed to register school_attendance_machines during onboarding:', mErr.message);
          }
        }
      }

      // 6. Insert initial academic year
      const yearName = (academicYearData.academic_year || `${new Date().getFullYear()} - ${new Date().getFullYear() + 1}`).trim();
      const yearStart = academicYearData.start_date || `${new Date().getFullYear()}-04-01`;
      const yearEnd = academicYearData.end_date || `${new Date().getFullYear() + 1}-03-31`;

      const insertYearQuery = `
        INSERT INTO academic_year_master (
          school_id, academic_year, start_date, end_date, is_current, status
        ) VALUES (?, ?, ?, ?, 1, 1)
      `;
      await connection.query(insertYearQuery, [schoolId, yearName, yearStart, yearEnd]);

      // 7. Insert Super Admin into user_master
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

      const insertAdminQuery = `
        INSERT INTO user_master (
          school_id, branch_id, first_name, last_name, email, phone, password,
          gender, picture, country_id, state_id, city, role, admin_type, status, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW())
      `;
      await connection.query(insertAdminQuery, [
        schoolId,
        mainBranchId,
        (adminData.first_name || 'Admin').trim(),
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
      ]);

      await connection.commit();

      return {
        schoolId,
        schoolName: schoolData.school_name,
        schoolCode,
        branchId: mainBranchId,
        adminEmail,
        planName: plan.plan_name,
        transactionId: finalTxnId,
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
      `SELECT id, name, shortname, phonecode FROM countries WHERE status = 1 OR status IS NULL ORDER BY name ASC`
    );
    return rows;
  }

  /**
   * Fetch states by country ID
   */
  static async getStates(countryId) {
    const [rows] = await pool.query(
      `SELECT id_state AS id, state AS name FROM states WHERE country_id = ? AND (is_active = 1 OR is_active IS NULL) ORDER BY state ASC`,
      [countryId]
    );
    return rows;
  }

  /**
   * Fetch cities by state ID
   */
  static async getCities(stateId) {
    const [rows] = await pool.query(
      `SELECT id, name FROM cities WHERE state_id = ? ORDER BY name ASC`,
      [stateId]
    );
    return rows;
  }

  /**
   * Fetch all genders from gender_master
   */
  static async getGenders() {
    const [rows] = await pool.query(
      `SELECT id, gender FROM gender_master ORDER BY id ASC`
    );
    return rows;
  }
}

module.exports = SaasModel;
