const crypto = require('crypto');
const { pool } = require('../config/db.config');
const appConfig = require('../config/app.config');

const ENCRYPTION_PREFIX = 'enc:v1:';
const MASKED_SECRET = '••••••••••••••••';
const VALID_PROVIDERS = ['mailjet', 'zoho', 'smtp'];
const VALID_ENCRYPTIONS = ['tls', 'ssl', 'none'];

const PROVIDER_LABELS = {
  mailjet: 'Mailjet',
  zoho: 'Zoho Mail',
  smtp: 'SMTP',
};

/**
 * Derive a 32-byte key for AES-256-GCM encryption at rest
 */
function getEncryptionKey() {
  const secretMaterial = `${appConfig.jwt?.secret || ''}:${appConfig.cookie?.secret || ''}:growvidya_email_cred_key`;
  return crypto.createHash('sha256').update(secretMaterial).digest();
}

/**
 * Encrypt plain-text secret using AES-256-GCM
 */
function encryptSecret(plainText) {
  if (!plainText) return null;
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

function createValidationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function getProviderLabel(provider) {
  return PROVIDER_LABELS[String(provider || '').toLowerCase()] || 'Email Provider';
}

class EmailCredentialModel {
  static _initialized = false;

  /**
   * Idempotent schema initializer: ensures email_credentials supports ('mailjet', 'zoho', 'smtp')
   * and removes obsolete otp_mode column if present.
   */
  static async initTable() {
    if (EmailCredentialModel._initialized) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS \`email_credentials\` (
          \`id\` INT(11) NOT NULL AUTO_INCREMENT,
          \`provider\` ENUM('mailjet','zoho','smtp') NOT NULL COMMENT 'Email provider: mailjet, zoho, or smtp',
          \`from_name\` VARCHAR(150) NOT NULL COMMENT 'Sender display name',
          \`from_email\` VARCHAR(150) NOT NULL COMMENT 'Sender email address',
          \`api_key\` VARCHAR(255) DEFAULT NULL COMMENT 'Mailjet API Key (Public Key)',
          \`api_secret\` TEXT DEFAULT NULL COMMENT 'AES-256-GCM encrypted Mailjet Secret Key',
          \`smtp_host\` VARCHAR(255) DEFAULT NULL COMMENT 'SMTP / Zoho server hostname',
          \`smtp_port\` INT(11) DEFAULT 587 COMMENT 'SMTP / Zoho server port (587, 465, 25)',
          \`smtp_username\` VARCHAR(255) DEFAULT NULL COMMENT 'SMTP / Zoho authentication username',
          \`smtp_password\` TEXT DEFAULT NULL COMMENT 'AES-256-GCM encrypted SMTP / Zoho password',
          \`smtp_encryption\` ENUM('tls','ssl','none') NOT NULL DEFAULT 'tls' COMMENT 'Encryption protocol',
          \`is_default\` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = Active default email provider',
          \`status\` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Active, 2 = Inactive, 4 = Deleted',
          \`created_on\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_email_provider\` (\`provider\`),
          KEY \`idx_email_default\` (\`is_default\`, \`status\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      const [cols] = await pool.query(`SHOW COLUMNS FROM \`email_credentials\``);
      const colMap = new Map(cols.map((c) => [c.Field, c]));

      const providerCol = colMap.get('provider');
      if (providerCol && !String(providerCol.Type || '').toLowerCase().includes("'zoho'")) {
        await pool.query(`
          ALTER TABLE \`email_credentials\`
          MODIFY COLUMN \`provider\` ENUM('mailjet','zoho','smtp') NOT NULL COMMENT 'Email provider: mailjet, zoho, or smtp'
        `);
      }

      if (colMap.has('otp_mode')) {
        await pool.query(`ALTER TABLE \`email_credentials\` DROP COLUMN \`otp_mode\``);
      }

      EmailCredentialModel._initialized = true;
    } catch (err) {
      console.error('[EmailCredentialModel] Schema init error:', err.message);
    }
  }

  /**
   * Validate Mailjet, Zoho Mail, or SMTP payload
   */
  static validatePayload(data, { requireSecret = true } = {}) {
    const provider = String(data.provider || '').trim().toLowerCase();
    if (!VALID_PROVIDERS.includes(provider)) {
      throw createValidationError('Provider must be "mailjet", "zoho", or "smtp".');
    }

    const from_name = String(data.from_name ?? data.fromName ?? '').trim();
    const from_email = String(data.from_email ?? data.fromEmail ?? '').trim();

    if (!from_name) {
      throw createValidationError('Sender "From Name" is required.');
    }

    if (!from_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from_email)) {
      throw createValidationError('A valid "From Email" address is required.');
    }

    if (provider === 'mailjet') {
      const api_key = String(data.api_key ?? data.apiKey ?? '').trim();
      const rawSecret = data.api_secret ?? data.apiSecret;
      const api_secret = rawSecret !== undefined && rawSecret !== null ? String(rawSecret).trim() : '';

      if (!api_key) {
        throw createValidationError('Mailjet API Key is required.');
      }
      if (api_key.length < 8 || api_key.length > 128 || /\s/.test(api_key)) {
        throw createValidationError('Mailjet API Key must be between 8 and 128 characters without spaces.');
      }

      if (requireSecret || api_secret !== '') {
        if (!api_secret) {
          throw createValidationError('Mailjet Secret Key is required.');
        }
        if (api_secret.includes('•') || api_secret === MASKED_SECRET) {
          throw createValidationError('Please provide a valid Mailjet Secret Key instead of a masked value.');
        }
        if (api_secret.length < 8 || api_secret.length > 128 || /\s/.test(api_secret)) {
          throw createValidationError('Mailjet Secret Key must be between 8 and 128 characters without spaces.');
        }
      }

      return {
        provider: 'mailjet',
        from_name,
        from_email,
        api_key,
        api_secret: api_secret || null,
        smtp_host: null,
        smtp_port: null,
        smtp_username: null,
        smtp_password: null,
        smtp_encryption: 'tls',
      };
    }

    if (provider === 'zoho') {
      const smtp_host = String(data.smtp_host ?? data.smtpHost ?? 'smtp.zoho.in').trim().toLowerCase();
      const smtp_port = Number(data.smtp_port ?? data.smtpPort ?? 465);
      const smtp_username = String(data.smtp_username ?? data.smtpUsername ?? from_email).trim();
      const rawPassword = data.smtp_password ?? data.smtpPassword;
      const smtp_password = rawPassword !== undefined && rawPassword !== null ? String(rawPassword).trim() : '';
      const defaultEnc = smtp_port === 465 ? 'ssl' : 'tls';
      const smtp_encryption = String(data.smtp_encryption ?? data.smtpEncryption ?? defaultEnc).trim().toLowerCase();

      if (!smtp_host) {
        throw createValidationError('Zoho SMTP Host is required (e.g., smtp.zoho.in or smtp.zoho.com).');
      }

      if (!Number.isInteger(smtp_port) || smtp_port < 1 || smtp_port > 65535) {
        throw createValidationError('Zoho SMTP Port must be a valid port number between 1 and 65535.');
      }

      if (!smtp_username) {
        throw createValidationError('Zoho Mail Username / Email is required.');
      }

      if (!VALID_ENCRYPTIONS.includes(smtp_encryption)) {
        throw createValidationError('Zoho Encryption must be "ssl" or "tls".');
      }

      if (requireSecret || smtp_password !== '') {
        if (!smtp_password) {
          throw createValidationError('Zoho Mail Password / App Password is required.');
        }
        if (smtp_password.includes('•') || smtp_password === MASKED_SECRET) {
          throw createValidationError('Please provide a valid Zoho App Password instead of a masked value.');
        }
      }

      return {
        provider: 'zoho',
        from_name,
        from_email,
        api_key: null,
        api_secret: null,
        smtp_host,
        smtp_port,
        smtp_username,
        smtp_password: smtp_password || null,
        smtp_encryption,
      };
    }

    // Custom SMTP validation
    const smtp_host = String(data.smtp_host ?? data.smtpHost ?? '').trim();
    const smtp_port = Number(data.smtp_port ?? data.smtpPort ?? 587);
    const smtp_username = String(data.smtp_username ?? data.smtpUsername ?? '').trim();
    const rawPassword = data.smtp_password ?? data.smtpPassword;
    const smtp_password = rawPassword !== undefined && rawPassword !== null ? String(rawPassword).trim() : '';
    const smtp_encryption = String(data.smtp_encryption ?? data.smtpEncryption ?? 'tls').trim().toLowerCase();

    if (!smtp_host) {
      throw createValidationError('SMTP Host is required (e.g., smtp.gmail.com).');
    }

    if (!Number.isInteger(smtp_port) || smtp_port < 1 || smtp_port > 65535) {
      throw createValidationError('SMTP Port must be a valid port number between 1 and 65535.');
    }

    if (!smtp_username) {
      throw createValidationError('SMTP Username is required.');
    }

    if (!VALID_ENCRYPTIONS.includes(smtp_encryption)) {
      throw createValidationError('SMTP Encryption must be "tls", "ssl", or "none".');
    }

    if (requireSecret || smtp_password !== '') {
      if (!smtp_password) {
        throw createValidationError('SMTP Password is required.');
      }
      if (smtp_password.includes('•') || smtp_password === MASKED_SECRET) {
        throw createValidationError('Please provide a valid SMTP Password instead of a masked value.');
      }
    }

    return {
      provider: 'smtp',
      from_name,
      from_email,
      api_key: null,
      api_secret: null,
      smtp_host,
      smtp_port,
      smtp_username,
      smtp_password: smtp_password || null,
      smtp_encryption,
    };
  }

  /**
   * Sanitize database record so secrets/passwords are NEVER returned in plain text
   */
  static sanitizeRecord(row) {
    if (!row) return null;
    const isMailjet = row.provider === 'mailjet';
    const isZoho = row.provider === 'zoho';
    const defaultPort = isZoho ? 465 : 587;
    const defaultEnc = isZoho ? 'ssl' : 'tls';

    return {
      id: row.id,
      provider: row.provider,
      from_name: row.from_name || '',
      from_email: row.from_email || '',
      api_key: isMailjet ? (row.api_key || '') : null,
      api_secret: null,
      api_secret_masked: isMailjet && row.api_secret ? MASKED_SECRET : null,
      has_api_secret: Boolean(isMailjet && row.api_secret),
      smtp_host: !isMailjet ? (row.smtp_host || (isZoho ? 'smtp.zoho.in' : '')) : null,
      smtp_port: !isMailjet ? (row.smtp_port ? Number(row.smtp_port) : defaultPort) : null,
      smtp_username: !isMailjet ? (row.smtp_username || '') : null,
      smtp_password: null,
      smtp_password_masked: !isMailjet && row.smtp_password ? MASKED_SECRET : null,
      has_smtp_password: Boolean(!isMailjet && row.smtp_password),
      smtp_encryption: !isMailjet ? (row.smtp_encryption || defaultEnc) : null,
      is_default: Number(row.is_default) === 1 ? 1 : 0,
      status: row.status !== undefined && row.status !== null ? Number(row.status) : 1,
      created_on: row.created_on,
      created_at: row.created_on,
      updated_at: row.updated_at || row.created_on,
    };
  }

  /**
   * Retrieve all configured email providers (Mailjet, Zoho Mail & SMTP)
   */
  static async getAll() {
    await EmailCredentialModel.initTable();
    const [rows] = await pool.query(
      `SELECT * FROM email_credentials WHERE status IN (1, 2) ORDER BY is_default DESC, FIELD(provider, 'mailjet', 'zoho', 'smtp'), id ASC`
    );
    return rows.map((r) => EmailCredentialModel.sanitizeRecord(r));
  }

  /**
   * Retrieve a specific email provider configuration by ID
   */
  static async getById(id) {
    await EmailCredentialModel.initTable();
    const [rows] = await pool.query(
      `SELECT * FROM email_credentials WHERE id = ? AND status IN (1, 2) LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? EmailCredentialModel.sanitizeRecord(rows[0]) : null;
  }

  /**
   * Retrieve a specific email provider configuration by provider name ('mailjet' | 'zoho' | 'smtp')
   */
  static async getByProvider(provider) {
    await EmailCredentialModel.initTable();
    const [rows] = await pool.query(
      `SELECT * FROM email_credentials WHERE provider = ? AND status IN (1, 2) LIMIT 1`,
      [String(provider).toLowerCase()]
    );
    return rows.length > 0 ? EmailCredentialModel.sanitizeRecord(rows[0]) : null;
  }

  /**
   * Create or replace credentials for a provider ('mailjet', 'zoho', or 'smtp')
   */
  static async save(data) {
    await EmailCredentialModel.initTable();

    const [existingRows] = await pool.query(
      `SELECT * FROM email_credentials WHERE provider = ? LIMIT 1`,
      [String(data.provider || '').trim().toLowerCase()]
    );
    const existing = existingRows[0] || null;
    const isExistingActiveRecord = existing && Number(existing.status) !== 4;

    const hasIncomingSecret = Boolean(
      (data.api_secret && String(data.api_secret).trim() !== '') ||
      (data.apiSecret && String(data.apiSecret).trim() !== '') ||
      (data.smtp_password && String(data.smtp_password).trim() !== '') ||
      (data.smtpPassword && String(data.smtpPassword).trim() !== '')
    );

    const validated = EmailCredentialModel.validatePayload(data, {
      requireSecret: !isExistingActiveRecord || hasIncomingSecret,
    });

    const normalizedStatus =
      data.status !== undefined && data.status !== null
        ? Number(data.status) === 2
          ? 2
          : 1
        : isExistingActiveRecord && Number(existing.status) === 2
          ? 2
          : 1;

    // Check if any default exists at all
    const [defaultRows] = await pool.query(
      `SELECT id FROM email_credentials WHERE is_default = 1 AND status = 1 LIMIT 1`
    );
    const hasAnyDefault = defaultRows.length > 0;

    let normalizedDefault =
      data.is_default !== undefined && data.is_default !== null
        ? Number(data.is_default) === 1
          ? 1
          : 0
        : isExistingActiveRecord
          ? Number(existing.is_default)
          : hasAnyDefault
            ? 0
            : 1;

    // If setting as default, ensure status is active
    const finalStatus = normalizedDefault === 1 ? 1 : normalizedStatus;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (normalizedDefault === 1) {
        await conn.query(`UPDATE email_credentials SET is_default = 0`);
      }

      let targetId;
      if (existing) {
        targetId = existing.id;
        const encryptedApiSecret =
          validated.provider === 'mailjet'
            ? validated.api_secret
              ? encryptSecret(validated.api_secret)
              : existing.api_secret
            : null;

        const encryptedSmtpPassword =
          validated.provider === 'smtp' || validated.provider === 'zoho'
            ? validated.smtp_password
              ? encryptSecret(validated.smtp_password)
              : existing.smtp_password
            : null;

        await conn.query(
          `UPDATE email_credentials
           SET from_name = ?, from_email = ?, api_key = ?, api_secret = ?,
               smtp_host = ?, smtp_port = ?, smtp_username = ?, smtp_password = ?,
               smtp_encryption = ?, is_default = ?, status = ?, updated_at = NOW()
           WHERE id = ?`,
          [
            validated.from_name,
            validated.from_email,
            validated.api_key,
            encryptedApiSecret,
            validated.smtp_host,
            validated.smtp_port,
            validated.smtp_username,
            encryptedSmtpPassword,
            validated.smtp_encryption,
            normalizedDefault,
            finalStatus,
            targetId,
          ]
        );
      } else {
        const encryptedApiSecret =
          validated.provider === 'mailjet' ? encryptSecret(validated.api_secret) : null;
        const encryptedSmtpPassword =
          validated.provider === 'smtp' || validated.provider === 'zoho'
            ? encryptSecret(validated.smtp_password)
            : null;

        const [result] = await conn.query(
          `INSERT INTO email_credentials
           (provider, from_name, from_email, api_key, api_secret, smtp_host, smtp_port, smtp_username, smtp_password, smtp_encryption, is_default, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            validated.provider,
            validated.from_name,
            validated.from_email,
            validated.api_key,
            encryptedApiSecret,
            validated.smtp_host,
            validated.smtp_port,
            validated.smtp_username,
            encryptedSmtpPassword,
            validated.smtp_encryption,
            normalizedDefault,
            finalStatus,
          ]
        );
        targetId = result.insertId;
      }

      await conn.commit();
      return await EmailCredentialModel.getById(targetId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Update an existing email credential configuration by ID
   */
  static async update(id, data) {
    await EmailCredentialModel.initTable();
    const [rows] = await pool.query(`SELECT * FROM email_credentials WHERE id = ? AND status IN (1, 2) LIMIT 1`, [id]);
    if (rows.length === 0) return null;

    const existing = rows[0];
    return await EmailCredentialModel.save({
      ...data,
      provider: data.provider || existing.provider,
    });
  }

  /**
   * Set a specific provider record by ID as the single Active Default (and unset the others)
   */
  static async setDefault(id) {
    await EmailCredentialModel.initTable();
    const [rows] = await pool.query(`SELECT * FROM email_credentials WHERE id = ? AND status IN (1, 2) LIMIT 1`, [id]);
    if (rows.length === 0) return null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`UPDATE email_credentials SET is_default = 0`);
      await conn.query(
        `UPDATE email_credentials SET is_default = 1, status = 1, updated_at = NOW() WHERE id = ?`,
        [id]
      );
      await conn.commit();
      return await EmailCredentialModel.getById(id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Switch the active OTP & email delivery provider using the 3-option switch ('mailjet' | 'zoho' | 'smtp')
   */
  static async setActiveProviderByType(provider) {
    await EmailCredentialModel.initTable();
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    if (!VALID_PROVIDERS.includes(normalizedProvider)) {
      throw createValidationError('Active OTP delivery provider must be "mailjet", "zoho", or "smtp".');
    }

    const label = getProviderLabel(normalizedProvider);
    const [rows] = await pool.query(
      `SELECT * FROM email_credentials WHERE provider = ? AND status IN (1, 2) LIMIT 1`,
      [normalizedProvider]
    );
    if (rows.length === 0) {
      throw createValidationError(
        `Please configure ${label} credentials first before selecting it as the active OTP & email provider.`
      );
    }

    const targetRow = rows[0];
    const verifiedCreds = await EmailCredentialModel.getActiveCredentials(targetRow.id);
    if (!verifiedCreds) {
      throw createValidationError(
        `${label} credentials are incomplete. Please edit and save valid credentials before activating.`
      );
    }

    return await EmailCredentialModel.setDefault(targetRow.id);
  }

  /**
   * Toggle status (Active = 1, Inactive = 2)
   */
  static async toggleStatus(id, status) {
    await EmailCredentialModel.initTable();
    const [rows] = await pool.query(`SELECT * FROM email_credentials WHERE id = ? AND status IN (1, 2) LIMIT 1`, [id]);
    if (rows.length === 0) return null;

    const normalizedStatus = Number(status) === 2 ? 2 : 1;
    // If deactivating the default provider, unset is_default on it
    const nextDefault = normalizedStatus === 2 ? 0 : Number(rows[0].is_default);

    await pool.query(
      `UPDATE email_credentials SET status = ?, is_default = ?, updated_at = NOW() WHERE id = ? AND status != 4`,
      [normalizedStatus, nextDefault, id]
    );

    return await EmailCredentialModel.getById(id);
  }

  /**
   * Soft delete an email credential record (status = 4)
   */
  static async delete(id) {
    await EmailCredentialModel.initTable();
    const [res] = await pool.query(
      `UPDATE email_credentials SET status = 4, is_default = 0, updated_at = NOW() WHERE id = ? AND status != 4`,
      [id]
    );
    return res.affectedRows > 0;
  }

  /**
   * INTERNAL SERVER ONLY: Fetch decrypted credentials for the active Default provider (or specific ID for testing).
   * Never expose the return value of this method in any API response.
   */
  static async getActiveCredentials(specificId = null) {
    await EmailCredentialModel.initTable();
    let rows;
    if (specificId) {
      [rows] = await pool.query(`SELECT * FROM email_credentials WHERE id = ? AND status IN (1, 2) LIMIT 1`, [specificId]);
    } else {
      [rows] = await pool.query(
        `SELECT * FROM email_credentials
         WHERE status = 1 AND is_default = 1
         ORDER BY id DESC
         LIMIT 1`
      );
    }

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    try {
      if (row.provider === 'mailjet') {
        const decryptedSecret = decryptSecret(row.api_secret);
        if (!row.api_key || !decryptedSecret) return null;
        return {
          id: row.id,
          provider: 'mailjet',
          fromName: row.from_name,
          fromEmail: row.from_email,
          apiKey: row.api_key,
          apiSecret: decryptedSecret,
          isDefault: Number(row.is_default) === 1,
          status: Number(row.status),
        };
      }

      if (row.provider === 'zoho' || row.provider === 'smtp') {
        const isZoho = row.provider === 'zoho';
        const decryptedPassword = decryptSecret(row.smtp_password);
        const host = row.smtp_host || (isZoho ? 'smtp.zoho.in' : '');
        if (!host || !row.smtp_username || !decryptedPassword) return null;
        return {
          id: row.id,
          provider: row.provider,
          fromName: row.from_name,
          fromEmail: row.from_email,
          smtpHost: host,
          smtpPort: Number(row.smtp_port) || (isZoho ? 465 : 587),
          smtpUsername: row.smtp_username,
          smtpPassword: decryptedPassword,
          smtpEncryption: row.smtp_encryption || (isZoho ? 'ssl' : 'tls'),
          isDefault: Number(row.is_default) === 1,
          status: Number(row.status),
        };
      }

      return null;
    } catch (err) {
      console.error('[EmailCredentialModel] Failed to decrypt credentials:', err.message);
      return null;
    }
  }
}

EmailCredentialModel.getProviderLabel = getProviderLabel;
module.exports = EmailCredentialModel;
