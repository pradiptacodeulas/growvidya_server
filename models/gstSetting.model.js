const { pool } = require('../config/db.config');

class GstSettingModel {
  static _tableInitialized = false;

  /**
   * Ensure the `saas_gst_settings` table exists without seeding any static or fallback data.
   */
  static async ensureTable() {
    if (GstSettingModel._tableInitialized) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`saas_gst_settings\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`is_gst_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
        \`gst_percentage\` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        \`cgst_percentage\` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        \`sgst_percentage\` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        \`igst_percentage\` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        \`home_country_id\` INT(11) DEFAULT NULL,
        \`home_state_id\` INT(11) DEFAULT NULL,
        \`home_state_name\` VARCHAR(100) DEFAULT NULL,
        \`company_legal_name\` VARCHAR(200) DEFAULT NULL,
        \`company_gstin\` VARCHAR(25) DEFAULT NULL,
        \`company_address\` TEXT DEFAULT NULL,
        \`company_phone\` VARCHAR(30) DEFAULT NULL,
        \`company_email\` VARCHAR(150) DEFAULT NULL,
        \`hsn_sac_code\` VARCHAR(30) DEFAULT NULL,
        \`updated_by\` INT(11) DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    GstSettingModel._tableInitialized = true;
  }

  /**
   * Retrieve the global platform GST configuration set by the SaaS Admin.
   * Returns null if not yet configured (no fallback or static data).
   */
  static async getCurrent(connection = null) {
    await GstSettingModel.ensureTable();
    const db = connection || pool;

    const [rows] = await db.query(
      `SELECT g.*,
              s.state AS resolved_state_name,
              c.name AS resolved_country_name
       FROM saas_gst_settings g
       LEFT JOIN states s ON g.home_state_id = s.id_state
       LEFT JOIN countries c ON g.home_country_id = c.id
       ORDER BY g.id ASC
       LIMIT 1`
    );

    if (!rows[0]) return null;
    const row = rows[0];

    return {
      id: row.id,
      is_gst_enabled: Number(row.is_gst_enabled) === 1 ? 1 : 0,
      gst_percentage: parseFloat(row.gst_percentage) || 0,
      cgst_percentage: parseFloat(row.cgst_percentage) || 0,
      sgst_percentage: parseFloat(row.sgst_percentage) || 0,
      igst_percentage: parseFloat(row.igst_percentage) || 0,
      home_country_id: row.home_country_id ? Number(row.home_country_id) : null,
      home_country_name: row.resolved_country_name || null,
      home_state_id: row.home_state_id ? Number(row.home_state_id) : null,
      home_state_name: row.resolved_state_name || row.home_state_name || null,
      company_legal_name: row.company_legal_name || null,
      company_gstin: row.company_gstin || null,
      company_address: row.company_address || null,
      company_phone: row.company_phone || null,
      company_email: row.company_email || null,
      hsn_sac_code: row.hsn_sac_code || null,
      updated_by: row.updated_by || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Create or update the global platform GST configuration.
   */
  static async upsert(payload = {}, updatedBy = null) {
    await GstSettingModel.ensureTable();

    const isGstEnabled = Number(payload.is_gst_enabled ?? payload.isGstEnabled) === 1 ? 1 : 0;
    const gstPercentage = Math.max(0, parseFloat(payload.gst_percentage ?? payload.gstPercentage) || 0);

    if (gstPercentage > 100) {
      const err = new Error('GST percentage cannot exceed 100%.');
      err.statusCode = 400;
      throw err;
    }

    const halfRate = Math.round((gstPercentage / 2) * 100) / 100;
    const cgstPercentage =
      payload.cgst_percentage !== undefined && payload.cgst_percentage !== null && payload.cgst_percentage !== ''
        ? Math.max(0, parseFloat(payload.cgst_percentage) || 0)
        : halfRate;
    const sgstPercentage =
      payload.sgst_percentage !== undefined && payload.sgst_percentage !== null && payload.sgst_percentage !== ''
        ? Math.max(0, parseFloat(payload.sgst_percentage) || 0)
        : Math.round((gstPercentage - cgstPercentage) * 100) / 100;
    const igstPercentage =
      payload.igst_percentage !== undefined && payload.igst_percentage !== null && payload.igst_percentage !== ''
        ? Math.max(0, parseFloat(payload.igst_percentage) || 0)
        : gstPercentage;

    const homeCountryId = payload.home_country_id ? parseInt(payload.home_country_id, 10) || null : null;
    const homeStateId = payload.home_state_id ? parseInt(payload.home_state_id, 10) || null : null;

    if (isGstEnabled === 1 && !homeStateId) {
      const err = new Error('Home State (Place of Origin, e.g. West Bengal) is required when GST is enabled.');
      err.statusCode = 400;
      throw err;
    }

    let homeStateName = payload.home_state_name ? String(payload.home_state_name).trim() : null;
    if (homeStateId) {
      const [stRows] = await pool.query(
        'SELECT state FROM states WHERE id_state = ? LIMIT 1',
        [homeStateId]
      );
      if (stRows[0]?.state) {
        homeStateName = stRows[0].state;
      }
    }

    const companyLegalName = payload.company_legal_name ? String(payload.company_legal_name).trim() : null;
    const companyGstin = payload.company_gstin ? String(payload.company_gstin).trim().toUpperCase() : null;
    const companyAddress = payload.company_address ? String(payload.company_address).trim() : null;
    const companyPhone = payload.company_phone ? String(payload.company_phone).trim() : null;
    const companyEmail = payload.company_email ? String(payload.company_email).trim() : null;
    const hsnSacCode = payload.hsn_sac_code ? String(payload.hsn_sac_code).trim() : null;

    const existing = await GstSettingModel.getCurrent();

    if (existing) {
      await pool.query(
        `UPDATE saas_gst_settings
         SET is_gst_enabled = ?,
             gst_percentage = ?,
             cgst_percentage = ?,
             sgst_percentage = ?,
             igst_percentage = ?,
             home_country_id = ?,
             home_state_id = ?,
             home_state_name = ?,
             company_legal_name = ?,
             company_gstin = ?,
             company_address = ?,
             company_phone = ?,
             company_email = ?,
             hsn_sac_code = ?,
             updated_by = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          isGstEnabled,
          gstPercentage,
          cgstPercentage,
          sgstPercentage,
          igstPercentage,
          homeCountryId,
          homeStateId,
          homeStateName,
          companyLegalName,
          companyGstin,
          companyAddress,
          companyPhone,
          companyEmail,
          hsnSacCode,
          updatedBy,
          existing.id,
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO saas_gst_settings (
           id, is_gst_enabled, gst_percentage, cgst_percentage, sgst_percentage, igst_percentage,
           home_country_id, home_state_id, home_state_name,
           company_legal_name, company_gstin, company_address, company_phone, company_email, hsn_sac_code,
           updated_by
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          isGstEnabled,
          gstPercentage,
          cgstPercentage,
          sgstPercentage,
          igstPercentage,
          homeCountryId,
          homeStateId,
          homeStateName,
          companyLegalName,
          companyGstin,
          companyAddress,
          companyPhone,
          companyEmail,
          hsnSacCode,
          updatedBy,
        ]
      );
    }

    return await GstSettingModel.getCurrent();
  }

  /**
   * Resolve a school's state ID and state name from school_id or explicit state_id.
   */
  static async resolveBillingState({ schoolId = null, stateId = null, stateName = null, connection = null } = {}) {
    const db = connection || pool;
    let resolvedStateId = stateId ? parseInt(stateId, 10) || null : null;
    let resolvedStateName = stateName ? String(stateName).trim() : null;

    if (!resolvedStateId && schoolId) {
      const [schRows] = await db.query(
        `SELECT sm.state, s.state AS state_name
         FROM school_master sm
         LEFT JOIN states s ON sm.state = s.id_state
         WHERE sm.id = ?
         LIMIT 1`,
        [parseInt(schoolId, 10)]
      );
      if (schRows[0]) {
        resolvedStateId = schRows[0].state ? parseInt(schRows[0].state, 10) || null : null;
        resolvedStateName = schRows[0].state_name || resolvedStateName;
      }
    }

    if (resolvedStateId && !resolvedStateName) {
      const [stRows] = await db.query(
        'SELECT state FROM states WHERE id_state = ? LIMIT 1',
        [resolvedStateId]
      );
      if (stRows[0]?.state) {
        resolvedStateName = stRows[0].state;
      }
    }

    return {
      billing_state_id: resolvedStateId,
      billing_state_name: resolvedStateName,
    };
  }

  /**
   * Compute Post-Coupon GST breakdown (CGST + SGST inside home_state_id [West Bengal] vs IGST outside).
   */
  static async calculateTax({
    taxableAmount = 0,
    schoolId = null,
    stateId = null,
    stateName = null,
    connection = null,
  } = {}) {
    const cleanTaxable = Math.max(0, Math.round((parseFloat(taxableAmount) || 0) * 100) / 100);
    const setting = await GstSettingModel.getCurrent(connection);
    const { billing_state_id, billing_state_name } = await GstSettingModel.resolveBillingState({
      schoolId,
      stateId,
      stateName,
      connection,
    });

    if (!setting || Number(setting.is_gst_enabled) !== 1 || Number(setting.gst_percentage) <= 0 || cleanTaxable <= 0) {
      return {
        is_gst_enabled: Boolean(setting && Number(setting.is_gst_enabled) === 1),
        tax_type: 'none',
        billing_state_id,
        billing_state_name,
        home_state_id: setting?.home_state_id || null,
        home_state_name: setting?.home_state_name || null,
        taxable_amount: cleanTaxable,
        gst_percentage: setting ? parseFloat(setting.gst_percentage) || 0 : 0,
        cgst_percentage: 0,
        cgst_amount: 0,
        sgst_percentage: 0,
        sgst_amount: 0,
        igst_percentage: 0,
        igst_amount: 0,
        tax_percentage: 0,
        tax_amount: 0,
      };
    }

    const homeStateId = setting.home_state_id ? Number(setting.home_state_id) : null;
    const homeStateNameNorm = (setting.home_state_name || '').trim().toLowerCase().replace(/\s+/g, '');
    const billingStateNameNorm = (billing_state_name || '').trim().toLowerCase().replace(/\s+/g, '');

    const isIntraState = Boolean(
      (homeStateId && billing_state_id && Number(billing_state_id) === homeStateId) ||
      (homeStateNameNorm && billingStateNameNorm && homeStateNameNorm === billingStateNameNorm)
    );

    if (isIntraState) {
      const cgstRate = parseFloat(setting.cgst_percentage) || Math.round((parseFloat(setting.gst_percentage) / 2) * 100) / 100;
      const sgstRate = parseFloat(setting.sgst_percentage) || Math.round((parseFloat(setting.gst_percentage) - cgstRate) * 100) / 100;
      const cgstAmount = Math.round(cleanTaxable * (cgstRate / 100) * 100) / 100;
      const sgstAmount = Math.round(cleanTaxable * (sgstRate / 100) * 100) / 100;
      const totalTax = Math.round((cgstAmount + sgstAmount) * 100) / 100;

      return {
        is_gst_enabled: true,
        tax_type: 'intra_state',
        billing_state_id,
        billing_state_name,
        home_state_id: homeStateId,
        home_state_name: setting.home_state_name || null,
        taxable_amount: cleanTaxable,
        gst_percentage: parseFloat(setting.gst_percentage) || 0,
        cgst_percentage: cgstRate,
        cgst_amount: cgstAmount,
        sgst_percentage: sgstRate,
        sgst_amount: sgstAmount,
        igst_percentage: 0,
        igst_amount: 0,
        tax_percentage: Math.round((cgstRate + sgstRate) * 100) / 100,
        tax_amount: totalTax,
      };
    }

    const igstRate = parseFloat(setting.igst_percentage) || parseFloat(setting.gst_percentage) || 0;
    const igstAmount = Math.round(cleanTaxable * (igstRate / 100) * 100) / 100;

    return {
      is_gst_enabled: true,
      tax_type: 'inter_state',
      billing_state_id,
      billing_state_name,
      home_state_id: homeStateId,
      home_state_name: setting.home_state_name || null,
      taxable_amount: cleanTaxable,
      gst_percentage: parseFloat(setting.gst_percentage) || 0,
      cgst_percentage: 0,
      cgst_amount: 0,
      sgst_percentage: 0,
      sgst_amount: 0,
      igst_percentage: igstRate,
      igst_amount: igstAmount,
      tax_percentage: igstRate,
      tax_amount: igstAmount,
    };
  }
}

module.exports = GstSettingModel;
