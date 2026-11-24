const { pool } = require('../config/db.config');

class FooterSettingModel {
  static _tableInitialized = false;

  /**
   * Ensure the `saas_footer_settings` table exists without seeding any static or fallback data.
   */
  static async ensureTable() {
    if (FooterSettingModel._tableInitialized) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`saas_footer_settings\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`footer_text\` VARCHAR(500) NOT NULL,
        \`updated_by\` INT(11) DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    FooterSettingModel._tableInitialized = true;
  }

  /**
   * Retrieve the global platform footer setting configured by the SaaS Admin.
   * Returns null if not yet configured (no fallback or static data).
   */
  static async getCurrent() {
    await FooterSettingModel.ensureTable();

    const [rows] = await pool.query(
      `SELECT id, footer_text, updated_by, created_at, updated_at
       FROM saas_footer_settings
       ORDER BY id ASC
       LIMIT 1`
    );

    return rows[0] || null;
  }

  /**
   * Create or update the global platform footer setting.
   */
  static async upsert({ footer_text, updated_by = null }) {
    await FooterSettingModel.ensureTable();

    const cleanFooterText = footer_text !== undefined && footer_text !== null ? String(footer_text).trim() : '';

    if (!cleanFooterText) {
      const err = new Error('Footer text is required.');
      err.statusCode = 400;
      throw err;
    }

    if (cleanFooterText.length > 500) {
      const err = new Error('Footer text must not exceed 500 characters.');
      err.statusCode = 400;
      throw err;
    }

    const existing = await FooterSettingModel.getCurrent();

    if (existing) {
      await pool.query(
        `UPDATE saas_footer_settings
         SET footer_text = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [cleanFooterText, updated_by, existing.id]
      );
    } else {
      await pool.query(
        `INSERT INTO saas_footer_settings (id, footer_text, updated_by)
         VALUES (1, ?, ?)`,
        [cleanFooterText, updated_by]
      );
    }

    return await FooterSettingModel.getCurrent();
  }
}

module.exports = FooterSettingModel;
