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
             max_students, max_teachers, features_json, status, created_at
      FROM subscription_plans
      WHERE status = 1
      ORDER BY price ASC
    `;
    const [rows] = await pool.query(query);
    return rows.map((row) => ({
      ...row,
      features: typeof row.features_json === 'string' ? JSON.parse(row.features_json) : (row.features_json || {}),
    }));
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
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Check if admin email already exists in user_master
      const adminEmail = (adminData.email || '').trim().toLowerCase();
      if (!adminEmail) {
        throw new Error('Admin Email is required.');
      }

      const [existingUser] = await connection.query(
        `SELECT id FROM user_master WHERE LOWER(email) = ? AND status != 4 LIMIT 1`,
        [adminEmail]
      );
      if (existingUser.length > 0) {
        throw new Error(`An account with the email "${adminEmail}" already exists. Please use a different admin email.`);
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

      // 5. Get plan details to calculate subscription duration
      let effectivePlanId = parseInt(planId, 10);
      const [planRows] = await connection.query(
        `SELECT id, plan_name, price, billing_cycle FROM subscription_plans WHERE id = ? LIMIT 1`,
        [effectivePlanId]
      );
      const plan = planRows[0];
      if (!plan) {
        throw new Error('Selected subscription plan not found.');
      }

      const isTrialMode = Boolean(isTrial) || plan.billing_cycle === 'trial' || parseFloat(plan.price) === 0;
      const finalAmount = isTrialMode ? 0 : (amountPaid !== undefined ? parseFloat(amountPaid) : parseFloat(plan.price));
      const finalTxnId = isTrialMode
        ? (paymentTransactionId || `TRIAL_14DAYS_${Date.now()}_${Math.floor(Math.random() * 10000)}`)
        : (paymentTransactionId || `PAY_DUMMY_${Date.now()}_${Math.floor(Math.random() * 10000)}`);
      const finalGateway = isTrialMode ? 'free_trial' : (paymentGateway || 'dummy');
      const subStatus = isTrialMode ? 'trial' : 'active';

      // Calculate subscription end date (14 days for trial, 1 year for annual, 30 days for monthly)
      const startDate = new Date();
      const endDate = new Date();
      if (isTrialMode) {
        endDate.setDate(endDate.getDate() + 14);
      } else if (plan.billing_cycle === 'monthly') {
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Insert into school_subscriptions
      const insertSubQuery = `
        INSERT INTO school_subscriptions (
          school_id, plan_id, amount_paid, payment_gateway,
          payment_transaction_id, payment_status, start_date, end_date, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, NOW())
      `;
      await connection.query(insertSubQuery, [
        schoolId,
        plan.id,
        finalAmount,
        finalGateway,
        finalTxnId,
        startDateStr,
        endDateStr,
        subStatus,
      ]);

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
      const insertAdminQuery = `
        INSERT INTO user_master (
          school_id, first_name, last_name, email, phone, password,
          gender, city, role, admin_type, status, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, NOW())
      `;
      await connection.query(insertAdminQuery, [
        schoolId,
        (adminData.first_name || 'Admin').trim(),
        (adminData.last_name || '').trim(),
        adminEmail,
        adminData.phone || null,
        hashedPassword,
        adminData.gender || 'Male',
        schoolData.city || null,
      ]);

      await connection.commit();

      return {
        schoolId,
        schoolName: schoolData.school_name,
        schoolCode,
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
}

module.exports = SaasModel;
