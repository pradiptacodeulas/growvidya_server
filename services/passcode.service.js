const crypto = require('crypto');
const { pool } = require('../config/db.config');
const { generateToken, verifyToken } = require('../utils/jwt.util');
const EmailService = require('./email.service');

class PasscodeService {
  /**
   * Generates a secure random 6-digit numeric OTP
   */
  static generatePasscode() {
    return String(crypto.randomInt(100000, 1000000));
  }

  /**
   * Mask an identifier for display
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
   * Mask an email address for display (alias for maskIdentifier)
   */
  static maskEmail(email) {
    return PasscodeService.maskIdentifier(email);
  }

  /**
   * Store the generated 6-digit OTP and expiry timestamp in the specified table (does not touch passcode column)
   */
  static async storePasscode(tableName, recordId, otpCode, expiresInMinutes = 10) {
    await pool.query(
      `UPDATE ${tableName}
       SET otp = ?, otp_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
       WHERE id = ?`,
      [otpCode, expiresInMinutes, recordId]
    );
    return true;
  }

  /**
   * Clear stored OTP and expiry timestamp (e.g., if email dispatch fails)
   */
  static async clearPasscode(tableName, recordId) {
    await pool.query(
      `UPDATE ${tableName}
       SET otp = NULL, otp_expires_at = NULL
       WHERE id = ?`,
      [recordId]
    );
    return true;
  }

  /**
   * Send the 6-digit Sign-In OTP email using the active Email Provider (Mailjet, Zoho Mail, or SMTP)
   */
  static async sendOtpEmail({ toEmail, toName, otpCode, portalName, expiresInMinutes = 10 }) {
    const cleanEmail = String(toEmail || '').trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      const err = new Error('No valid email address is registered for this account to receive the OTP.');
      err.statusCode = 400;
      throw err;
    }

    const subject = `${portalName ? `${portalName} — ` : ''}Your 6-Digit Sign-In OTP`;
    const text = `Hello ${toName || ''},\n\nYour 6-digit sign-in OTP is: ${otpCode}\n\nThis OTP is valid for ${expiresInMinutes} minutes. Do not share this code with anyone.\n\nDisclaimer: Please do not reply back to this mail.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 28px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 22px;">
          <img
            src="https://growvidya.in/vidya_assets/images/logo.png"
            alt="Growvidya"
            width="180"
            style="max-width: 180px; width: 180px; height: auto; display: inline-block; border: 0; outline: none; text-decoration: none;"
          />
        </div>
        <h2 style="margin-top: 0; color: #111827; font-size: 24px;">Sign-In Verification Code</h2>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Hello${toName ? ` <strong>${toName}</strong>` : ''}, use the following 6-digit OTP to complete your sign-in${portalName ? ` to <strong>${portalName}</strong>` : ''}:
        </p>
        <div style="background: #f3f4f6; padding: 18px; border-radius: 8px; text-align: center; margin: 22px 0;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 6px; color: #111827; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
          This code is valid for ${expiresInMinutes} minutes. If you did not request this code, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="color: #6b7280; font-size: 13px; margin-bottom: 0;">
          <strong>Disclaimer:</strong> This is an automated email. Please do not reply back to this mail.
        </p>
      </div>
    `;

    return await EmailService.sendEmail({
      to: cleanEmail,
      toName: toName || cleanEmail,
      subject,
      text,
      html,
    });
  }

  /**
   * Send the 6-digit Forgot Password OTP email using the active Email Provider (Mailjet, Zoho Mail, or SMTP)
   */
  static async sendForgotPasswordOtpEmail({ toEmail, toName, otpCode, portalName, expiresInMinutes = 10 }) {
    const cleanEmail = String(toEmail || '').trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      const err = new Error('No valid email address is registered for this account to receive the password reset OTP.');
      err.statusCode = 400;
      throw err;
    }

    const subject = `${portalName ? `${portalName} — ` : ''}Your 6-Digit Password Reset OTP`;
    const text = `Hello ${toName || ''},\n\nWe received a request to reset your password${portalName ? ` for ${portalName}` : ''}.\n\nYour 6-digit password reset OTP is: ${otpCode}\n\nThis OTP is valid for ${expiresInMinutes} minutes. Do not share this code with anyone.\n\nIf you did not request a password reset, please ignore this email.\n\nDisclaimer: Please do not reply back to this mail.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 28px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 22px;">
          <img
            src="https://growvidya.in/vidya_assets/images/logo.png"
            alt="Growvidya"
            width="180"
            style="max-width: 180px; width: 180px; height: auto; display: inline-block; border: 0; outline: none; text-decoration: none;"
          />
        </div>
        <h2 style="margin-top: 0; color: #111827; font-size: 24px;">Password Reset Verification Code</h2>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Hello${toName ? ` <strong>${toName}</strong>` : ''}, use the following 6-digit OTP to verify your identity and reset your password${portalName ? ` for <strong>${portalName}</strong>` : ''}:
        </p>
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 18px; border-radius: 8px; text-align: center; margin: 22px 0;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 6px; color: #1e3a8a; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
          This code is valid for ${expiresInMinutes} minutes. If you did not request a password reset, your account remains secure and you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
        <p style="color: #6b7280; font-size: 13px; margin-bottom: 0;">
          <strong>Disclaimer:</strong> This is an automated email. Please do not reply back to this mail.
        </p>
      </div>
    `;

    return await EmailService.sendEmail({
      to: cleanEmail,
      toName: toName || cleanEmail,
      subject,
      text,
      html,
    });
  }

  /**
   * Send a 6-digit OTP email for sensitive administrative actions (e.g. Permanent Branch Deletion)
   */
  static async sendActionOtpEmail({ toEmail, toName, otpCode, actionTitle, actionWarning, expiresInMinutes = 10 }) {
    const cleanEmail = String(toEmail || '').trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      const err = new Error('No valid email address is registered for this account to receive the OTP.');
      err.statusCode = 400;
      throw err;
    }

    const title = actionTitle || 'Security Verification Code';
    const subject = `Growvidya — ${title} (6-Digit OTP)`;
    const text = `Hello ${toName || ''},\n\n${actionWarning || 'Please use the verification code below to confirm your action.'}\n\nYour 6-digit confirmation OTP is: ${otpCode}\n\nThis OTP is valid for ${expiresInMinutes} minutes. Do not share this code with anyone.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 28px; border: 1px solid #fecaca; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 22px;">
          <img
            src="https://growvidya.in/vidya_assets/images/logo.png"
            alt="Growvidya"
            width="180"
            style="max-width: 180px; width: 180px; height: auto; display: inline-block; border: 0; outline: none; text-decoration: none;"
          />
        </div>
        <h2 style="margin-top: 0; color: #b91c1c; font-size: 22px;">${title}</h2>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          Hello${toName ? ` <strong>${toName}</strong>` : ''},<br/>
          ${actionWarning || 'Use the following 6-digit OTP to confirm your action:'}
        </p>
        <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 18px; border-radius: 8px; text-align: center; margin: 22px 0;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 6px; color: #991b1b; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin-bottom: 16px;">
          This code is valid for ${expiresInMinutes} minutes. If you did not initiate this request, please change your account password immediately.
        </p>
      </div>
    `;

    return await EmailService.sendEmail({
      to: cleanEmail,
      toName: toName || cleanEmail,
      subject,
      text,
      html,
    });
  }

  /**
   * Verify the 6-digit OTP against the otp column and check otp_expires_at (does not use passcode column)
   */
  static async verifyPasscode(tableName, recordId, inputOtp) {
    const [rows] = await pool.query(
      `SELECT id, otp, otp_expires_at,
              (otp_expires_at IS NOT NULL AND otp_expires_at >= NOW()) AS is_valid_time
       FROM ${tableName}
       WHERE id = ?`,
      [recordId]
    );

    const record = rows && rows.length > 0 ? rows[0] : null;
    if (!record) {
      const msg = 'Account not found or inactive.';
      return { valid: false, message: msg, reason: msg };
    }

    if (!record.otp) {
      const msg = 'No active OTP request found. Please request a new code.';
      return { valid: false, message: msg, reason: msg };
    }

    if (!record.is_valid_time) {
      const msg = 'OTP has expired. Please request a new 6-digit code.';
      return { valid: false, message: msg, reason: msg };
    }

    const cleanInput = String(inputOtp || '').trim();
    if (String(record.otp).trim() !== cleanInput) {
      const msg = 'Invalid 6-digit OTP. Please try again.';
      return { valid: false, message: msg, reason: msg };
    }

    await pool.query(
      `UPDATE ${tableName} SET otp = NULL, otp_expires_at = NULL WHERE id = ?`,
      [recordId]
    );

    return { valid: true };
  }

  /**
   * Issue a short-lived (10-minute) signed JWT token after verifying a Forgot Password OTP
   */
  static issuePasswordResetToken({ userId, portalType, identifier }) {
    return generateToken(
      {
        purpose: 'password_reset',
        userId: Number(userId),
        portalType,
        identifier: String(identifier || '').trim(),
      },
      { expiresIn: '10m' }
    );
  }

  /**
   * Verify a Forgot Password resetToken for a specific portalType
   */
  static verifyPasswordResetToken(resetToken, expectedPortalType) {
    if (!resetToken || typeof resetToken !== 'string') {
      return { valid: false, message: 'Password reset session token is missing. Please verify your OTP again.' };
    }
    const decoded = verifyToken(resetToken.trim());
    if (!decoded || decoded.purpose !== 'password_reset' || decoded.portalType !== expectedPortalType || !decoded.userId) {
      return {
        valid: false,
        message: 'Your password reset session has expired or is invalid. Please request a new OTP.',
      };
    }
    return { valid: true, payload: decoded };
  }
}

module.exports = PasscodeService;
