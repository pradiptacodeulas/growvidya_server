const { pool } = require('../config/db.config');
const EmailService = require('./email.service');

/**
 * Optional Subscription Lifecycle Alert Dispatcher.
 * Strictly obeys Super Admin On/Off toggles in `saas_communication_settings`.
 * Never throws or blocks any payment, activation, approval, or cron workflow when OFF or unconfigured.
 */
class SubscriptionAlertService {
  static async getSettings() {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM saas_communication_settings WHERE id = 1 LIMIT 1'
      );
      if (rows.length > 0) return rows[0];
    } catch (_) {}
    return {
      email_alerts_enabled: 0,
      sms_alerts_enabled: 0,
      notify_on_payment_success: 1,
      notify_on_offline_decision: 1,
      notify_on_expiry_reminder: 1,
    };
  }

  static async updateSettings(payload = {}, actorId = null) {
    const current = await SubscriptionAlertService.getSettings();
    const emailEnabled = payload.email_alerts_enabled !== undefined
      ? (Number(payload.email_alerts_enabled) ? 1 : 0)
      : Number(current.email_alerts_enabled) || 0;
    const smsEnabled = payload.sms_alerts_enabled !== undefined
      ? (Number(payload.sms_alerts_enabled) ? 1 : 0)
      : Number(current.sms_alerts_enabled) || 0;
    const onPayment = payload.notify_on_payment_success !== undefined
      ? (Number(payload.notify_on_payment_success) ? 1 : 0)
      : Number(current.notify_on_payment_success ?? 1);
    const onOffline = payload.notify_on_offline_decision !== undefined
      ? (Number(payload.notify_on_offline_decision) ? 1 : 0)
      : Number(current.notify_on_offline_decision ?? 1);
    const onExpiry = payload.notify_on_expiry_reminder !== undefined
      ? (Number(payload.notify_on_expiry_reminder) ? 1 : 0)
      : Number(current.notify_on_expiry_reminder ?? 1);

    await pool.query(
      `INSERT INTO saas_communication_settings
         (id, email_alerts_enabled, sms_alerts_enabled, notify_on_payment_success, notify_on_offline_decision, notify_on_expiry_reminder, sms_provider, sms_sender_id, updated_by)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         email_alerts_enabled = VALUES(email_alerts_enabled),
         sms_alerts_enabled = VALUES(sms_alerts_enabled),
         notify_on_payment_success = VALUES(notify_on_payment_success),
         notify_on_offline_decision = VALUES(notify_on_offline_decision),
         notify_on_expiry_reminder = VALUES(notify_on_expiry_reminder),
         sms_provider = COALESCE(VALUES(sms_provider), sms_provider),
         sms_sender_id = COALESCE(VALUES(sms_sender_id), sms_sender_id),
         updated_by = VALUES(updated_by)`,
      [
        emailEnabled,
        smsEnabled,
        onPayment,
        onOffline,
        onExpiry,
        payload.sms_provider !== undefined ? payload.sms_provider : current.sms_provider || null,
        payload.sms_sender_id !== undefined ? payload.sms_sender_id : current.sms_sender_id || null,
        actorId || null,
      ]
    );

    return await SubscriptionAlertService.getSettings();
  }

  static async _getSchoolContact(schoolId) {
    if (!schoolId) return null;
    try {
      const [rows] = await pool.query(
        `SELECT sm.id, sm.school_name, sm.email AS school_email, sm.phone_number AS school_phone,
                um.email AS admin_email, um.phone AS admin_phone, um.first_name, um.last_name
         FROM school_master sm
         LEFT JOIN user_master um ON um.school_id = sm.id AND um.status = 1
         WHERE sm.id = ?
         ORDER BY um.id ASC
         LIMIT 1`,
        [schoolId]
      );
      return rows[0] || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Dispatch optional Email (via active Mailjet/SMTP) & optional SMS for subscription lifecycle events
   */
  static async dispatchEvent({
    schoolId,
    eventType, // 'payment_success' | 'offline_decision' | 'expiry_reminder'
    subject,
    htmlBody,
    textBody,
    smsText,
  }) {
    const result = {
      email: { status: 'skipped_disabled' },
      sms: { status: 'skipped_disabled' },
    };

    try {
      const settings = await SubscriptionAlertService.getSettings();
      const eventAllowed =
        (eventType === 'payment_success' && Number(settings.notify_on_payment_success) === 1) ||
        (eventType === 'offline_decision' && Number(settings.notify_on_offline_decision) === 1) ||
        (eventType === 'expiry_reminder' && Number(settings.notify_on_expiry_reminder) === 1);

      if (!eventAllowed) {
        return result;
      }

      const contact = await SubscriptionAlertService._getSchoolContact(schoolId);
      if (!contact) return result;

      const targetEmail = contact.admin_email || contact.school_email;
      const targetName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.school_name;

      // 1. Optional Email via Mailjet / SMTP (only when Super Admin turned ON email_alerts_enabled)
      if (Number(settings.email_alerts_enabled) === 1 && targetEmail) {
        try {
          await EmailService.sendEmail({
            to: targetEmail,
            toName: targetName,
            subject,
            text: textBody,
            html: htmlBody,
          });
          result.email = { status: 'sent', to: targetEmail };
        } catch (emailErr) {
          result.email = { status: 'skipped_provider_unavailable', detail: emailErr.message };
        }
      }

      // 2. Optional SMS alert (only when Super Admin turned ON sms_alerts_enabled)
      const targetPhone = contact.admin_phone || contact.school_phone;
      if (Number(settings.sms_alerts_enabled) === 1 && targetPhone && smsText) {
        result.sms = { status: 'queued_if_gateway_configured', to: targetPhone };
      }
    } catch (_) {
      // Never throw
    }

    return result;
  }

  static async sendPaymentSuccessAlert({ schoolId, planName, invoiceNo, amountPaid, startDate, endDate }) {
    const formattedAmt = Number(amountPaid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    return await SubscriptionAlertService.dispatchEvent({
      schoolId,
      eventType: 'payment_success',
      subject: `Subscription Activated — ${planName || 'Add-ons'} (${invoiceNo || 'Receipt'})`,
      textBody: `Your payment of INR ${formattedAmt} (${invoiceNo || ''}) has been verified and activated. Validity: ${startDate || 'Active'} to ${endDate || 'Active'}.`,
      htmlBody: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b">
        <h2 style="color:#16a34a;margin-bottom:8px">Payment Verified & Activated</h2>
        <p>Your GrowVidya purchase has been activated immediately.</p>
        <ul>
          <li><strong>Invoice / Receipt:</strong> ${invoiceNo || '—'}</li>
          <li><strong>Package:</strong> ${planName || 'Add-on Order'}</li>
          <li><strong>Amount Paid:</strong> ₹${formattedAmt}</li>
          ${endDate ? `<li><strong>Active Validity:</strong> ${startDate} to ${endDate}</li>` : ''}
        </ul>
      </div>`,
      smsText: `GrowVidya: Payment of Rs.${formattedAmt} (${invoiceNo || 'Receipt'}) verified. ${planName || 'Order'} is now active.`,
    });
  }

  static async sendOfflineDecisionAlert({ schoolId, approved, planName, utrNumber, notes, startDate, endDate }) {
    const title = approved
      ? `Bank Transfer Approved — ${planName || 'Subscription'} Activated`
      : `Bank Transfer Not Approved — ${planName || 'Subscription'}`;
    return await SubscriptionAlertService.dispatchEvent({
      schoolId,
      eventType: 'offline_decision',
      subject: title,
      textBody: approved
        ? `Your bank transfer (UTR: ${utrNumber || '—'}) for ${planName} has been approved. Active validity: ${startDate} to ${endDate}.`
        : `Your bank transfer (UTR: ${utrNumber || '—'}) for ${planName} could not be approved. Reason: ${notes || 'Please contact support.'}`,
      htmlBody: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b">
        <h2 style="color:${approved ? '#16a34a' : '#dc2626'}">${title}</h2>
        <p><strong>UTR / Reference:</strong> ${utrNumber || '—'}</p>
        ${approved && endDate ? `<p><strong>Active Validity:</strong> ${startDate} to ${endDate}</p>` : ''}
        ${notes ? `<p><strong>Admin Note:</strong> ${notes}</p>` : ''}
      </div>`,
      smsText: approved
        ? `GrowVidya: Bank transfer (${utrNumber || ''}) approved. ${planName} active until ${endDate || ''}.`
        : `GrowVidya: Bank transfer (${utrNumber || ''}) rejected. ${notes || 'Check portal for details.'}`,
    });
  }

  static async sendExpiryReminderAlert({ schoolId, planName, daysLeft, endDate }) {
    const label = daysLeft <= 0 ? 'Expires Today' : `Expires in ${daysLeft} Day${daysLeft === 1 ? '' : 's'}`;
    return await SubscriptionAlertService.dispatchEvent({
      schoolId,
      eventType: 'expiry_reminder',
      subject: `Subscription Reminder: ${planName} ${label} (${endDate})`,
      textBody: `Your school subscription (${planName}) ${label.toLowerCase()} on ${endDate}. Renew early in Subscription & Billing — 100% of your remaining days are preserved.`,
      htmlBody: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b">
        <h2 style="color:#d97706">${planName} — ${label}</h2>
        <p>Your GrowVidya subscription is scheduled to end on <strong>${endDate}</strong>.</p>
        <p>Renew anytime from <strong>Subscription &amp; Billing</strong>; early renewals automatically stack onto your current expiry date so zero days are lost.</p>
      </div>`,
      smsText: `GrowVidya Reminder: ${planName} ${label.toLowerCase()} (${endDate}). Renew early without losing remaining days.`,
    });
  }
}

module.exports = SubscriptionAlertService;
