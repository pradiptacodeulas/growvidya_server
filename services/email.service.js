const https = require('https');
const nodemailer = require('nodemailer');
const EmailCredentialModel = require('../models/emailCredential.model');

const PROVIDER_DISPLAY_LABELS = {
  mailjet: 'Mailjet API',
  zoho: 'Zoho Mail',
  smtp: 'SMTP Server',
};

class EmailService {
  /**
   * Send an email via Mailjet v3.1 Send API
   */
  static async _sendViaMailjet(creds, { to, toName, subject, text, html, attachments = [] }) {
    const authHeader = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64');
    const mailjetAttachments =
      Array.isArray(attachments) && attachments.length > 0
        ? attachments
            .filter((a) => a && a.filename && a.content)
            .map((a) => ({
              ContentType: a.contentType || 'application/pdf',
              Filename: a.filename,
              Base64Content: Buffer.isBuffer(a.content)
                ? a.content.toString('base64')
                : Buffer.from(String(a.content)).toString('base64'),
            }))
        : undefined;

    const payload = JSON.stringify({
      Messages: [
        {
          From: {
            Email: creds.fromEmail,
            Name: creds.fromName || 'Growvidya',
          },
          To: [
            {
              Email: to,
              Name: toName || to,
            },
          ],
          Subject: subject,
          TextPart: text || '',
          HTMLPart: html || `<p>${text || ''}</p>`,
          ...(mailjetAttachments && mailjetAttachments.length > 0
            ? { Attachments: mailjetAttachments }
            : {}),
        },
      ],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.mailjet.com',
          port: 443,
          path: '/v3.1/send',
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 15000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            let parsed = null;
            try {
              parsed = JSON.parse(body);
            } catch (_) {}

            if (res.statusCode >= 200 && res.statusCode < 300) {
              const msgStatus = parsed?.Messages?.[0]?.Status;
              if (msgStatus === 'error') {
                const errMsg =
                  parsed?.Messages?.[0]?.Errors?.[0]?.ErrorMessage ||
                  'Mailjet API returned an error.';
                const err = new Error(errMsg);
                err.statusCode = 400;
                return reject(err);
              }
              return resolve({
                provider: 'mailjet',
                status: msgStatus || 'success',
                response: parsed,
              });
            }

            const errMessage =
              parsed?.ErrorMessage ||
              parsed?.Messages?.[0]?.Errors?.[0]?.ErrorMessage ||
              `Mailjet API failed with HTTP ${res.statusCode}`;
            const err = new Error(errMessage);
            err.statusCode = 400;
            return reject(err);
          });
        }
      );

      req.on('error', (err) => {
        const customErr = new Error(`Mailjet connection error: ${err.message}`);
        customErr.statusCode = 400;
        reject(customErr);
      });

      req.on('timeout', () => {
        req.destroy();
        const customErr = new Error('Mailjet request timed out.');
        customErr.statusCode = 400;
        reject(customErr);
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Send an email via Zoho Mail or Custom SMTP using Nodemailer
   */
  static async _sendViaSmtp(creds, { to, subject, text, html, attachments = [] }) {
    const isZoho = creds.provider === 'zoho';
    const defaultPort = isZoho ? 465 : 587;
    const port = Number(creds.smtpPort) || defaultPort;
    const isSsl = creds.smtpEncryption === 'ssl' || port === 465;
    const isNone = creds.smtpEncryption === 'none';

    const transporter = nodemailer.createTransport({
      host: creds.smtpHost,
      port,
      secure: isSsl,
      ignoreTLS: isNone,
      requireTLS: creds.smtpEncryption === 'tls' && !isSsl,
      auth: {
        user: creds.smtpUsername,
        pass: creds.smtpPassword,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    });

    try {
      const info = await transporter.sendMail({
        from: `"${creds.fromName || 'Growvidya'}" <${creds.fromEmail}>`,
        to,
        subject,
        text: text || '',
        html: html || `<p>${text || ''}</p>`,
        ...(Array.isArray(attachments) && attachments.length > 0 ? { attachments } : {}),
      });

      return {
        provider: creds.provider || 'smtp',
        messageId: info.messageId,
        response: info.response,
      };
    } catch (err) {
      const label = isZoho ? 'Zoho Mail' : 'SMTP';
      const customErr = new Error(`${label} error: ${err.message}`);
      customErr.statusCode = 400;
      throw customErr;
    }
  }

  /**
   * Dynamically send an email using the single active Default provider (Mailjet, Zoho Mail, or SMTP),
   * or a specific credential ID if provided.
   */
  static async sendEmail({ to, toName, subject, text, html, attachments = [], credentialId = null }) {
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())) {
      const err = new Error('A valid recipient email address is required.');
      err.statusCode = 400;
      throw err;
    }

    const creds = await EmailCredentialModel.getActiveCredentials(credentialId);
    if (!creds) {
      const err = new Error(
        'No active email delivery provider (Mailjet, Zoho Mail, or SMTP) is configured and enabled in Super Admin Settings.'
      );
      err.statusCode = 400;
      throw err;
    }

    if (creds.provider === 'mailjet') {
      return await EmailService._sendViaMailjet(creds, {
        to: String(to).trim(),
        toName,
        subject,
        text,
        html,
        attachments,
      });
    }

    return await EmailService._sendViaSmtp(creds, {
      to: String(to).trim(),
      subject,
      text,
      html,
      attachments,
    });
  }

  /**
   * Send a test email to verify a Mailjet, Zoho Mail, or SMTP configuration
   */
  static async sendTestEmail({ toEmail, credentialId = null }) {
    const cleanEmail = String(toEmail || '').trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      const err = new Error('Please provide a valid recipient email address for the test email.');
      err.statusCode = 400;
      throw err;
    }

    const creds = await EmailCredentialModel.getActiveCredentials(credentialId);
    if (!creds) {
      const err = new Error('Selected email configuration was not found or has incomplete credentials.');
      err.statusCode = 400;
      throw err;
    }

    const providerLabel = PROVIDER_DISPLAY_LABELS[creds.provider] || 'SMTP Server';
    const subject = `Growvidya — ${providerLabel} Configuration Test`;
    const text = `Hello,\n\nThis is a test email from Growvidya Super Admin Portal sent via ${providerLabel} (${creds.fromEmail}).\n\nYour ${providerLabel} email configuration is working properly!`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="margin-top: 0; color: #111827;">Growvidya Email Configuration Verified</h2>
        <p style="color: #374151; font-size: 14px; line-height: 1.6;">
          This is a test email sent from the <strong>Growvidya Super Admin Portal</strong> using your dynamic <strong>${providerLabel}</strong> configuration.
        </p>
        <div style="background: #f9fafb; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #4b5563; margin: 16px 0;">
          <div><strong>Provider:</strong> ${providerLabel}</div>
          <div><strong>Sender:</strong> ${creds.fromName} &lt;${creds.fromEmail}&gt;</div>
          <div><strong>Active OTP &amp; Email Sender:</strong> ${creds.isDefault ? 'Yes (Active Default)' : 'No'}</div>
        </div>
        <p style="color: #6b7280; font-size: 12px; margin-bottom: 0;">
          Sent at ${new Date().toUTCString()}
        </p>
      </div>
    `;

    return await EmailService.sendEmail({
      to: cleanEmail,
      subject,
      text,
      html,
      credentialId: creds.id,
    });
  }
}

module.exports = EmailService;
