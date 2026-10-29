const { pool } = require('../config/db.config');
const SubscriptionAlertService = require('../services/subscriptionAlert.service');
const { getTodayIST } = require('../constants/subscriptionModules.constant');

const REMINDER_MILESTONES = [15, 7, 3, 1, 0];
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

class SubscriptionLifecycleJob {
  static _intervalRef = null;
  static _isRunning = false;

  /**
   * Execute a single idempotent pass of subscription & add-on lifecycle maintenance:
   * 1. Mark overdue `school_subscriptions` ('active' / 'trial' with end_date < today IST) as 'expired'.
   * 2. Mark overdue `school_storage_orders` ('active' with end_date < today IST) as 'expired'.
   * 3. Mark abandoned `subscription_payment_orders` ('created' older than 24h) as 'expired'.
   * 4. Send deduplicated expiry reminders (15, 7, 3, 1, 0 days) strictly honoring Super Admin On/Off toggles.
   */
  static async runOnce() {
    if (SubscriptionLifecycleJob._isRunning) {
      return;
    }
    SubscriptionLifecycleJob._isRunning = true;

    try {
      const todayStr = getTodayIST();

      // 1. Expire overdue software subscriptions
      await pool.query(
        `UPDATE school_subscriptions
         SET status = 'expired'
         WHERE status IN ('active', 'trial')
           AND DATE(end_date) < ?`,
        [todayStr]
      );

      // 2. Expire overdue recurring cloud storage add-on orders
      await pool.query(
        `UPDATE school_storage_orders
         SET order_status = 'expired',
             updated_at = NOW()
         WHERE order_status = 'active'
           AND end_date IS NOT NULL
           AND DATE(end_date) < ?`,
        [todayStr]
      );

      // 3. Expire stale abandoned Razorpay order intents (> 24 hours old)
      await pool.query(
        `UPDATE subscription_payment_orders
         SET status = 'expired'
         WHERE status = 'created'
           AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      );

      // 4. Dispatch deduplicated expiry reminders if Super Admin enabled reminders
      const settings = await SubscriptionAlertService.getSettings();
      const anyChannelEnabled =
        Number(settings.notify_on_expiry_reminder) === 1 &&
        (Number(settings.email_alerts_enabled) === 1 || Number(settings.sms_alerts_enabled) === 1);

      if (anyChannelEnabled) {
        const placeholders = REMINDER_MILESTONES.map(() => '?').join(', ');
        const [dueSubs] = await pool.query(
          `SELECT ss.id AS subscription_id,
                  ss.school_id,
                  ss.status,
                  DATE_FORMAT(ss.end_date, '%Y-%m-%d') AS end_date_str,
                  DATEDIFF(DATE(ss.end_date), ?) AS days_left,
                  sp.plan_name
           FROM school_subscriptions ss
           JOIN subscription_plans sp ON ss.plan_id = sp.id
           WHERE ss.status IN ('active', 'trial')
             AND DATEDIFF(DATE(ss.end_date), ?) IN (${placeholders})`,
          [todayStr, todayStr, ...REMINDER_MILESTONES]
        );

        for (const sub of dueSubs) {
          const milestone = Number(sub.days_left);
          const channelsToCheck = [];
          if (Number(settings.email_alerts_enabled) === 1) channelsToCheck.push('email');
          if (Number(settings.sms_alerts_enabled) === 1) channelsToCheck.push('sms');
          if (channelsToCheck.length === 0) continue;

          const [existingLogs] = await pool.query(
            `SELECT channel FROM subscription_reminder_logs
             WHERE subscription_id = ? AND milestone_days = ?`,
            [sub.subscription_id, milestone]
          );
          const alreadyLogged = new Set(existingLogs.map((r) => r.channel));
          const pendingChannels = channelsToCheck.filter((ch) => !alreadyLogged.has(ch));
          if (pendingChannels.length === 0) continue;

          const dispatchRes = await SubscriptionAlertService.sendExpiryReminderAlert({
            schoolId: sub.school_id,
            planName: sub.plan_name,
            daysLeft: milestone,
            endDate: sub.end_date_str,
          });

          for (const ch of pendingChannels) {
            const chOutcome = dispatchRes?.[ch] || { status: 'skipped' };
            const normalizedStatus =
              chOutcome.status === 'sent' || chOutcome.status === 'queued_if_gateway_configured'
                ? 'sent'
                : 'skipped';
            await pool.query(
              `INSERT IGNORE INTO subscription_reminder_logs
                 (school_id, subscription_id, milestone_days, channel, status, detail)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                sub.school_id,
                sub.subscription_id,
                milestone,
                ch,
                normalizedStatus,
                String(chOutcome.detail || chOutcome.status || '').slice(0, 250),
              ]
            );
          }
        }
      }
    } catch (err) {
      console.error('[SubscriptionLifecycleJob Error]:', err.message);
    } finally {
      SubscriptionLifecycleJob._isRunning = false;
    }
  }

  /**
   * Start background lifecycle job (runs once at boot and every 6 hours thereafter)
   */
  static start() {
    if (SubscriptionLifecycleJob._intervalRef) {
      return;
    }

    setImmediate(() => {
      SubscriptionLifecycleJob.runOnce().catch(() => {});
    });

    SubscriptionLifecycleJob._intervalRef = setInterval(() => {
      SubscriptionLifecycleJob.runOnce().catch(() => {});
    }, SIX_HOURS_MS);

    if (typeof SubscriptionLifecycleJob._intervalRef.unref === 'function') {
      SubscriptionLifecycleJob._intervalRef.unref();
    }
  }

  static stop() {
    if (SubscriptionLifecycleJob._intervalRef) {
      clearInterval(SubscriptionLifecycleJob._intervalRef);
      SubscriptionLifecycleJob._intervalRef = null;
    }
  }
}

module.exports = SubscriptionLifecycleJob;
