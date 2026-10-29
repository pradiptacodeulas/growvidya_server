const crypto = require('crypto');
const { pool } = require('../config/db.config');
const appConfig = require('../config/app.config');

const ENCRYPTION_PREFIX = 'enc:v1:';
const MASKED_SECRET = '••••••••••••••••';

/**
 * Derive a 32-byte key for AES-256-GCM encryption at rest
 */
function getEncryptionKey() {
  const secretMaterial = `${appConfig.jwt?.secret || ''}:${appConfig.cookie?.secret || ''}:growvidya_razorpay_cred_key`;
  return crypto.createHash('sha256').update(secretMaterial).digest();
}

/**
 * Encrypt plain-text secret using AES-256-GCM
 */
function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt stored secret (supports AES-256-GCM encrypted values)
 */
function decryptSecret(storedValue) {
  if (!storedValue || typeof storedValue !== 'string') {
    return null;
  }
  if (!storedValue.startsWith(ENCRYPTION_PREFIX)) {
    return storedValue;
  }
  const payload = storedValue.slice(ENCRYPTION_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format.');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

class RazorpayCredentialModel {
  static _initialized = false;

  /**
   * Ensure payment_credentials table has all required columns for dynamic Razorpay credentials
   */
  static async initTable() {
    if (RazorpayCredentialModel._initialized) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payment_credentials (
          id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
          method VARCHAR(255) DEFAULT 'razorpay',
          key_id VARCHAR(255) DEFAULT NULL,
          key_secret TEXT DEFAULT NULL,
          webhook_secret TEXT DEFAULT NULL,
          status INT(11) DEFAULT 1,
          created_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
      `);

      const [cols] = await pool.query(`SHOW COLUMNS FROM \`payment_credentials\``);
      const colNames = cols.map((c) => c.Field);

      if (!colNames.includes('key_id')) {
        await pool.query(
          `ALTER TABLE \`payment_credentials\` ADD COLUMN \`key_id\` VARCHAR(255) DEFAULT NULL AFTER \`method\``
        );
      }

      if (!colNames.includes('key_secret')) {
        await pool.query(
          `ALTER TABLE \`payment_credentials\` ADD COLUMN \`key_secret\` TEXT DEFAULT NULL AFTER \`key_id\``
        );
      }

      if (!colNames.includes('webhook_secret')) {
        await pool.query(
          `ALTER TABLE \`payment_credentials\` ADD COLUMN \`webhook_secret\` TEXT DEFAULT NULL AFTER \`key_secret\``
        );
      }

      if (colNames.includes('description')) {
        await pool.query(
          `ALTER TABLE \`payment_credentials\` DROP COLUMN \`description\``
        );
      }

      if (!colNames.includes('updated_at')) {
        await pool.query(
          `ALTER TABLE \`payment_credentials\` ADD COLUMN \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER \`created_on\``
        );
      }

      RazorpayCredentialModel._initialized = true;
    } catch (err) {
      console.error('[RazorpayCredentialModel] Table initialization error:', err.message);
    }
  }

  /**
   * Validate key_id and key_secret format and security constraints
   */
  static validateCredentials({ key_id, key_secret, requireSecret = true }) {
    const cleanKeyId = key_id !== undefined && key_id !== null ? String(key_id).trim() : '';
    const cleanKeySecret = key_secret !== undefined && key_secret !== null ? String(key_secret).trim() : '';

    if (!cleanKeyId) {
      const err = new Error('Razorpay Key ID is required.');
      err.statusCode = 400;
      throw err;
    }

    if (!/^rzp_(test|live)_[A-Za-z0-9]{8,64}$/.test(cleanKeyId)) {
      const err = new Error(
        'Invalid Razorpay Key ID format. It must start with "rzp_test_" or "rzp_live_" followed by alphanumeric characters.'
      );
      err.statusCode = 400;
      throw err;
    }

    if (requireSecret || cleanKeySecret !== '') {
      if (!cleanKeySecret) {
        const err = new Error('Razorpay Key Secret is required.');
        err.statusCode = 400;
        throw err;
      }

      if (cleanKeySecret.includes('•') || cleanKeySecret === MASKED_SECRET) {
        const err = new Error('Please provide a valid Razorpay Key Secret instead of a masked value.');
        err.statusCode = 400;
        throw err;
      }

      if (cleanKeySecret.length < 8 || cleanKeySecret.length > 128 || /\s/.test(cleanKeySecret)) {
        const err = new Error(
          'Invalid Razorpay Key Secret format. It must be between 8 and 128 characters without spaces.'
        );
        err.statusCode = 400;
        throw err;
      }

      if (cleanKeySecret === cleanKeyId) {
        const err = new Error('Razorpay Key Secret cannot be identical to the Key ID.');
        err.statusCode = 400;
        throw err;
      }
    }

    return {
      key_id: cleanKeyId,
      key_secret: cleanKeySecret || null,
    };
  }

  /**
   * Sanitize database row so key_secret is NEVER exposed in plain text
   */
  static sanitizeRecord(row) {
    if (!row) return null;
    const keyId = row.key_id || '';
    const mode = keyId.startsWith('rzp_live_') ? 'live' : 'test';
    return {
      id: row.id,
      method: row.method || 'razorpay',
      key_id: keyId,
      key_secret_masked: row.key_secret ? MASKED_SECRET : null,
      has_key_secret: Boolean(row.key_secret),
      webhook_secret_masked: row.webhook_secret ? MASKED_SECRET : null,
      has_webhook_secret: Boolean(row.webhook_secret),
      mode,
      status: row.status !== undefined && row.status !== null ? Number(row.status) : 1,
      created_on: row.created_on,
      created_at: row.created_on,
      updated_at: row.updated_at || row.created_on,
    };
  }

  /**
   * Retrieve the current Razorpay credentials (sanitized for API/UI)
   */
  static async getCurrent() {
    await RazorpayCredentialModel.initTable();
    const [rows] = await pool.query(
      `SELECT id, method, key_id, key_secret, webhook_secret, status, created_on, updated_at
       FROM payment_credentials
       WHERE method = 'razorpay'
       ORDER BY status DESC, id DESC
       LIMIT 1`
    );
    return rows.length > 0 ? RazorpayCredentialModel.sanitizeRecord(rows[0]) : null;
  }

  /**
   * Retrieve all Razorpay credentials (sanitized for API/UI)
   */
  static async getAll() {
    await RazorpayCredentialModel.initTable();
    const [rows] = await pool.query(
      `SELECT id, method, key_id, key_secret, webhook_secret, status, created_on, updated_at
       FROM payment_credentials
       WHERE method = 'razorpay'
       ORDER BY status DESC, id DESC`
    );
    return rows.map((r) => RazorpayCredentialModel.sanitizeRecord(r));
  }

  /**
   * Retrieve a specific Razorpay credential by ID (sanitized for API/UI)
   */
  static async getById(id) {
    await RazorpayCredentialModel.initTable();
    const [rows] = await pool.query(
      `SELECT id, method, key_id, key_secret, webhook_secret, status, created_on, updated_at
       FROM payment_credentials
       WHERE id = ? AND method = 'razorpay'
       LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? RazorpayCredentialModel.sanitizeRecord(rows[0]) : null;
  }

  /**
   * Create or replace Razorpay credentials
   */
  static async create({ key_id, key_secret, webhook_secret, status = 1 }) {
    await RazorpayCredentialModel.initTable();

    const validated = RazorpayCredentialModel.validateCredentials({
      key_id,
      key_secret,
      requireSecret: true,
    });

    const cleanWebhook =
      webhook_secret !== undefined &&
      webhook_secret !== null &&
      String(webhook_secret).trim() !== '' &&
      !String(webhook_secret).includes('•')
        ? String(webhook_secret).trim()
        : null;

    const encryptedSecret = encryptSecret(validated.key_secret);
    const encryptedWebhook = cleanWebhook ? encryptSecret(cleanWebhook) : null;
    const normalizedStatus = status !== undefined && status !== null ? (Number(status) === 0 ? 0 : 1) : 1;

    // Check if a Razorpay credential record already exists; if so, update it
    const [existing] = await pool.query(
      `SELECT id, webhook_secret FROM payment_credentials WHERE method = 'razorpay' ORDER BY id DESC LIMIT 1`
    );

    if (existing.length > 0) {
      const targetId = existing[0].id;
      const nextWebhook = encryptedWebhook !== null ? encryptedWebhook : existing[0].webhook_secret;
      await pool.query(
        `UPDATE payment_credentials
         SET key_id = ?, key_secret = ?, webhook_secret = ?, status = ?, updated_at = NOW()
         WHERE id = ?`,
        [validated.key_id, encryptedSecret, nextWebhook, normalizedStatus, targetId]
      );
      await pool.query(
        `DELETE FROM payment_credentials WHERE method = 'razorpay' AND id != ?`,
        [targetId]
      );
      return await RazorpayCredentialModel.getById(targetId);
    }

    const [result] = await pool.query(
      `INSERT INTO payment_credentials (method, key_id, key_secret, webhook_secret, status)
       VALUES ('razorpay', ?, ?, ?, ?)`,
      [validated.key_id, encryptedSecret, encryptedWebhook, normalizedStatus]
    );

    return await RazorpayCredentialModel.getById(result.insertId);
  }

  /**
   * Update existing Razorpay credentials
   */
  static async update(id, { key_id, key_secret, webhook_secret, clear_webhook_secret = false, status }) {
    await RazorpayCredentialModel.initTable();

    let targetRow = null;
    if (id) {
      const [rows] = await pool.query(
        `SELECT * FROM payment_credentials WHERE id = ? AND method = 'razorpay' LIMIT 1`,
        [id]
      );
      targetRow = rows[0] || null;
    } else {
      const [rows] = await pool.query(
        `SELECT * FROM payment_credentials WHERE method = 'razorpay' ORDER BY id DESC LIMIT 1`
      );
      targetRow = rows[0] || null;
    }

    if (!targetRow) {
      return null;
    }

    const nextKeyId = key_id !== undefined ? key_id : targetRow.key_id;
    const hasNewSecret =
      key_secret !== undefined &&
      key_secret !== null &&
      String(key_secret).trim() !== '';

    const validated = RazorpayCredentialModel.validateCredentials({
      key_id: nextKeyId,
      key_secret: hasNewSecret ? key_secret : undefined,
      requireSecret: false,
    });

    const updates = ['key_id = ?'];
    const params = [validated.key_id];

    if (hasNewSecret) {
      updates.push('key_secret = ?');
      params.push(encryptSecret(validated.key_secret));
    }

    if (clear_webhook_secret) {
      updates.push('webhook_secret = NULL');
    } else if (
      webhook_secret !== undefined &&
      webhook_secret !== null &&
      String(webhook_secret).trim() !== '' &&
      !String(webhook_secret).includes('•')
    ) {
      updates.push('webhook_secret = ?');
      params.push(encryptSecret(String(webhook_secret).trim()));
    }

    if (status !== undefined && status !== null) {
      updates.push('status = ?');
      params.push(Number(status) === 0 ? 0 : 1);
    }

    params.push(targetRow.id);

    await pool.query(
      `UPDATE payment_credentials SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    return await RazorpayCredentialModel.getById(targetRow.id);
  }

  /**
   * Delete Razorpay credentials
   */
  static async delete(id = null) {
    await RazorpayCredentialModel.initTable();

    if (id) {
      const [res] = await pool.query(
        `DELETE FROM payment_credentials WHERE id = ? AND method = 'razorpay'`,
        [id]
      );
      return res.affectedRows > 0;
    }

    const [res] = await pool.query(`DELETE FROM payment_credentials WHERE method = 'razorpay'`);
    return res.affectedRows > 0;
  }

  /**
   * INTERNAL SERVER ONLY: Fetch active decrypted credentials from database for Razorpay operations.
   * Never expose the return value of this method in any API response.
   */
  static async getActiveCredentials() {
    await RazorpayCredentialModel.initTable();

    const [rows] = await pool.query(
      `SELECT id, key_id, key_secret, webhook_secret, status
       FROM payment_credentials
       WHERE method = 'razorpay' AND status = 1
       ORDER BY id DESC
       LIMIT 1`
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    if (!row.key_id || !row.key_secret) {
      return null;
    }

    try {
      const decryptedSecret = decryptSecret(row.key_secret);
      let decryptedWebhookSecret = null;
      if (row.webhook_secret) {
        try {
          decryptedWebhookSecret = decryptSecret(row.webhook_secret);
        } catch (_) {
          decryptedWebhookSecret = null;
        }
      }
      const validated = RazorpayCredentialModel.validateCredentials({
        key_id: row.key_id,
        key_secret: decryptedSecret,
        requireSecret: true,
      });

      return {
        id: row.id,
        keyId: validated.key_id,
        keySecret: validated.key_secret,
        webhookSecret: decryptedWebhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || null,
      };
    } catch (_) {
      return null;
    }
  }
}

module.exports = RazorpayCredentialModel;
