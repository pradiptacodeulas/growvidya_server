const crypto = require('crypto');
const { pool } = require('../config/db.config');
const { hashPassword, comparePassword } = require('../utils/password.util');

class PasscodeService {
  /**
   * Generates a secure random 6-digit numeric passcode
   */
  static generatePasscode() {
    return String(crypto.randomInt(100000, 1000000));
  }

  /**
   * Check if test mode is enabled (default true unless explicitly set to 'false')
   */
  static isTestMode() {
    return process.env.PASSCODE_TEST_MODE !== 'false';
  }

  /**
   * Mask an identifier for display (e.g. 98****3210 or j***@domain.com)
   */
  static maskIdentifier(identifier) {
    if (!identifier) return '';
    const clean = String(identifier).trim();
    if (clean.includes('@')) {
      const [user, domain] = clean.split('@');
      if (user.length <= 2) return `${user[0]}***@${domain}`;
      return `${user[0]}***${user[user.length - 1]}@${domain}`;
    }
    if (/^\d+$/.test(clean) && clean.length >= 10) {
      return `${clean.slice(0, 2)}******${clean.slice(-2)}`;
    }
    if (clean.length > 4) {
      return `${clean.slice(0, 2)}***${clean.slice(-2)}`;
    }
    return clean;
  }

  /**
   * Store the generated passcode in the specified table
   */
  static async storePasscode(tableName, recordId, passcode, expiresInMinutes = 10) {
    try {
      const hashedPasscode = await hashPassword(passcode);
      await pool.query(
        `UPDATE ${tableName} 
         SET otp = ?, passcode = ?, otp_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
         WHERE id = ?`,
        [passcode, hashedPasscode, expiresInMinutes, recordId]
      );
      return true;
    } catch (error) {
      console.error(`[PasscodeService.storePasscode Error - ${tableName}]:`, error.message);
      throw error;
    }
  }

  /**
   * Verify the 6-digit passcode against DB records and check expiry
   */
  static async verifyPasscode(tableName, recordId, inputPasscode) {
    try {
      const [rows] = await pool.query(
        `SELECT id, otp, passcode, otp_expires_at,
                (otp_expires_at IS NOT NULL AND otp_expires_at >= NOW()) AS is_valid_time
         FROM ${tableName}
         WHERE id = ?`,
        [recordId]
      );

      const record = rows && rows.length > 0 ? rows[0] : null;
      if (!record) {
        return { valid: false, message: 'Account not found or inactive.' };
      }

      if (!record.otp && !record.passcode) {
        return { valid: false, message: 'No active passcode request found. Please request a new code.' };
      }

      if (!record.is_valid_time) {
        return { valid: false, message: 'Passcode has expired. Please request a new 6-digit code.' };
      }

      const cleanInput = String(inputPasscode || '').trim();
      let isMatch = false;

      // 1. Direct comparison against plain OTP stored in DB
      if (record.otp && String(record.otp).trim() === cleanInput) {
        isMatch = true;
      }

      // 2. Fallback: bcrypt comparison against passcode column
      if (!isMatch && record.passcode) {
        isMatch = await comparePassword(cleanInput, record.passcode);
      }

      if (!isMatch) {
        return { valid: false, message: 'Invalid 6-digit passcode. Please try again.' };
      }

      // Invalidate the passcode to prevent replay attacks
      await pool.query(
        `UPDATE ${tableName} SET otp = NULL, otp_expires_at = NULL WHERE id = ?`,
        [recordId]
      );

      return { valid: true };
    } catch (error) {
      console.error(`[PasscodeService.verifyPasscode Error - ${tableName}]:`, error.message);
      throw error;
    }
  }
}

module.exports = PasscodeService;
