const webpush = require('web-push');
const { Expo } = require('expo-server-sdk');
const DeviceTokenModel = require('../models/deviceToken.model');
const NotificationRecordModel = require('../models/notificationRecord.model');

// Initialize Web Push with VAPID credentials
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@growvidya.in',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Initialize Expo Push SDK
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  useFcmV1: true,
});

class PushNotificationService {
  /**
   * Send a push notification to a single registered device (Web or Mobile)
   */
  static async sendToDevice(deviceRecord, { title, body, data = {}, category = 'general', school_id = 1 }) {
    const { device_type, token, endpoint_hash, user_id, role } = deviceRecord;

    // 1. Web Push Notification (via W3C Web Push & VAPID)
    if (device_type === 'web') {
      try {
        let subscription = token;
        if (typeof subscription === 'string') {
          subscription = JSON.parse(subscription);
        }

        const deterministicTag =
          data.tag ||
          (category === 'chat' || data.type === 'chat'
            ? `chat_${data.senderRole || 'role'}_${data.senderId || 'user'}`
            : `${category}_${data.noticeId || data.id || 'alert'}`);

        const payload = JSON.stringify({
          title: title || 'Growvidya Alert',
          body: body || '',
          data: {
            ...data,
            tag: deterministicTag,
            category,
            url: data.url || data.path || '/',
          },
          icon: '/favicon.png',
          badge: '/favicon.png',
          tag: deterministicTag,
          timestamp: Date.now(),
        });

        const pushResponse = await webpush.sendNotification(subscription, payload);

        // Log record to notification_records
        await NotificationRecordModel.logPush({
          school_id: school_id || deviceRecord.school_id || 1,
          recipient_device_token: endpoint_hash,
          recipient_device_type: 'web',
          title,
          message: body,
          payload: data,
          recipient_role: role,
          recipient_id: user_id,
          category,
          status: 'sent',
          provider: 'webpush',
          provider_message_id: pushResponse?.headers?.['location'] || null,
        }).catch((err) => console.error('[Push Log Error]:', err.message));

        return { success: true, channel: 'web', endpoint_hash };
      } catch (err) {
        console.warn(`[WebPush Error for user ${user_id} (${role})]:`, err.message);

        // If subscription is 410 Gone or 404 Not Found, automatically deactivate the token
        if (err.statusCode === 410 || err.statusCode === 404) {
          await DeviceTokenModel.deactivateToken(endpoint_hash).catch(() => {});
        }

        await NotificationRecordModel.logPush({
          school_id: school_id || deviceRecord.school_id || 1,
          recipient_device_token: endpoint_hash,
          recipient_device_type: 'web',
          title,
          message: body,
          payload: data,
          recipient_role: role,
          recipient_id: user_id,
          category,
          status: 'failed',
          provider: 'webpush',
          error_message: err.message,
        }).catch(() => {});

        return { success: false, channel: 'web', error: err.message, endpoint_hash };
      }
    }

    // 2. Mobile Push Notification (via Expo Push Server SDK -> APNs / FCM)
    if (device_type === 'android' || device_type === 'ios' || Expo.isExpoPushToken(token)) {
      if (!Expo.isExpoPushToken(token)) {
        console.warn(`[Expo Warning]: Push token ${token} is not a valid Expo push token`);
        return { success: false, channel: 'expo', error: 'Invalid Expo push token' };
      }

      try {
        const message = {
          to: token,
          sound: 'default',
          title: title || 'Growvidya Alert',
          body: body || '',
          data: { ...data, category },
          priority: 'high',
          channelId: 'default',
          badge: data.badge !== undefined ? Number(data.badge) : 1,
        };

        const tickets = await expo.sendPushNotificationsAsync([message]);
        const ticket = tickets[0] || {};

        if (ticket.status === 'error') {
          console.warn(`[Expo Ticket Error for user ${user_id}]:`, ticket.message, ticket.details?.error);

          if (ticket.details?.error === 'DeviceNotRegistered') {
            await DeviceTokenModel.deactivateToken(endpoint_hash).catch(() => {});
          }

          await NotificationRecordModel.logPush({
            school_id: school_id || deviceRecord.school_id || 1,
            recipient_device_token: token,
            recipient_device_type: device_type,
            title,
            message: body,
            payload: data,
            recipient_role: role,
            recipient_id: user_id,
            category,
            status: 'failed',
            provider: 'expo',
            error_message: ticket.message,
          }).catch(() => {});

          return { success: false, channel: 'expo', error: ticket.message };
        }

        await NotificationRecordModel.logPush({
          school_id: school_id || deviceRecord.school_id || 1,
          recipient_device_token: token,
          recipient_device_type: device_type,
          title,
          message: body,
          payload: data,
          recipient_role: role,
          recipient_id: user_id,
          category,
          status: 'sent',
          provider: 'expo',
          provider_message_id: ticket.id || null,
        }).catch(() => {});

        return { success: true, channel: 'expo', ticketId: ticket.id };
      } catch (err) {
        console.error(`[Expo Send Error for user ${user_id}]:`, err.message);
        return { success: false, channel: 'expo', error: err.message };
      }
    }

    return { success: false, error: 'Unsupported device type: ' + device_type };
  }

  /**
   * Send push notification to all active devices of a specific user (Mobile & Web)
   */
  static async sendToUser({
    school_id = 1,
    user_id,
    role,
    title,
    body,
    data = {},
    category = 'general',
    excludeEndpointHash = null,
  }) {
    if (!user_id || !role) return { success: false, error: 'User ID and Role are required' };

    const activeDevices = await DeviceTokenModel.getActiveTokensForUser(user_id, role, school_id);
    if (!activeDevices || activeDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active device tokens found for user' };
    }

    const filteredDevices = excludeEndpointHash
      ? activeDevices.filter((d) => d.endpoint_hash !== excludeEndpointHash)
      : activeDevices;

    // Deduplicate by endpoint_hash or token to ensure each physical device receives only 1 notification
    const seenEndpoints = new Set();
    const uniqueDevices = [];
    for (const dev of filteredDevices) {
      const key = dev.endpoint_hash || dev.token;
      if (key && !seenEndpoints.has(key)) {
        seenEndpoints.add(key);
        uniqueDevices.push(dev);
      }
    }

    const results = await Promise.allSettled(
      uniqueDevices.map((device) =>
        this.sendToDevice(device, { title, body, data, category, school_id })
      )
    );

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
    return {
      success: true,
      totalDevices: uniqueDevices.length,
      sentCount: successful,
      details: results,
    };
  }

  /**
   * Broadcast push notification to target roles (e.g. notices, school announcements)
   */
  static async sendToRoles({
    roles = [],
    school_id = 1,
    title,
    body,
    data = {},
    category = 'announcement',
  }) {
    if (!roles || roles.length === 0) return { success: false, error: 'Target roles required' };

    const activeDevices = await DeviceTokenModel.getActiveTokensForRoles(roles, school_id);
    if (!activeDevices || activeDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active devices found for target roles' };
    }

    // Separate web devices and mobile devices with endpoint deduplication
    const seenWebEndpoints = new Set();
    const webDevices = [];
    for (const d of activeDevices) {
      if (d.device_type === 'web') {
        const key = d.endpoint_hash || d.token;
        if (key && !seenWebEndpoints.has(key)) {
          seenWebEndpoints.add(key);
          webDevices.push(d);
        }
      }
    }

    const seenMobileTokens = new Set();
    const mobileDevices = [];
    for (const d of activeDevices) {
      if ((d.device_type === 'android' || d.device_type === 'ios') && Expo.isExpoPushToken(d.token)) {
        if (!seenMobileTokens.has(d.token)) {
          seenMobileTokens.add(d.token);
          mobileDevices.push(d);
        }
      }
    }

    // 1. Dispatch Web notifications concurrently (in manageable batches)
    const webPromises = webDevices.map((device) =>
      this.sendToDevice(device, { title, body, data, category, school_id })
    );

    // 2. Chunk mobile notifications via Expo chunking
    const mobileMessages = mobileDevices.map((device) => ({
      to: device.token,
      sound: 'default',
      title: title || 'Growvidya Announcement',
      body: body || '',
      data: { ...data, category },
      priority: 'high',
      channelId: 'default',
    }));

    const chunks = expo.chunkPushNotifications(mobileMessages);
    const mobilePromises = chunks.map(async (chunk) => {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        return { success: true, ticketsCount: tickets.length };
      } catch (err) {
        console.error('[Expo Chunk Error]:', err.message);
        return { success: false, error: err.message };
      }
    });

    const [webResults, mobileResults] = await Promise.all([
      Promise.allSettled(webPromises),
      Promise.allSettled(mobilePromises),
    ]);

    return {
      success: true,
      totalDevices: activeDevices.length,
      webCount: webDevices.length,
      mobileCount: mobileDevices.length,
      webResults,
      mobileResults,
    };
  }

  /**
   * Broadcast push notification to targeted individual recipients ({ id, role })
   * Used for class/section targeted notices, specific staff, etc.
   */
  static async sendToTargetedRecipients({
    recipients = [],
    school_id = 1,
    title,
    body,
    data = {},
    category = 'announcement',
  }) {
    if (!recipients || recipients.length === 0) {
      return { success: true, sentCount: 0, message: 'No recipients provided' };
    }

    const activeDevices = await DeviceTokenModel.getActiveTokensForTargetedRecipients(recipients, school_id);
    if (!activeDevices || activeDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active devices found for targeted recipients' };
    }

    // Separate web devices and mobile devices with endpoint deduplication
    const seenWebEndpoints = new Set();
    const webDevices = [];
    for (const d of activeDevices) {
      if (d.device_type === 'web') {
        const key = d.endpoint_hash || d.token;
        if (key && !seenWebEndpoints.has(key)) {
          seenWebEndpoints.add(key);
          webDevices.push(d);
        }
      }
    }

    const seenMobileTokens = new Set();
    const mobileDevices = [];
    for (const d of activeDevices) {
      if ((d.device_type === 'android' || d.device_type === 'ios') && Expo.isExpoPushToken(d.token)) {
        if (!seenMobileTokens.has(d.token)) {
          seenMobileTokens.add(d.token);
          mobileDevices.push(d);
        }
      }
    }

    // 1. Dispatch Web notifications concurrently
    const webPromises = webDevices.map((device) =>
      this.sendToDevice(device, { title, body, data, category, school_id })
    );

    // 2. Chunk mobile notifications via Expo chunking
    const mobileMessages = mobileDevices.map((device) => ({
      to: device.token,
      sound: 'default',
      title: title || 'Growvidya Announcement',
      body: body || '',
      data: { ...data, category },
      priority: 'high',
      channelId: 'default',
    }));

    const chunks = expo.chunkPushNotifications(mobileMessages);
    const mobilePromises = chunks.map(async (chunk) => {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        return { success: true, ticketsCount: tickets.length };
      } catch (err) {
        console.error('[Expo Targeted Chunk Error]:', err.message);
        return { success: false, error: err.message };
      }
    });

    const [webResults, mobileResults] = await Promise.all([
      Promise.allSettled(webPromises),
      Promise.allSettled(mobilePromises),
    ]);

    return {
      success: true,
      totalDevices: webDevices.length + mobileDevices.length,
      webCount: webDevices.length,
      mobileCount: mobileDevices.length,
      webResults,
      mobileResults,
    };
  }
}

module.exports = PushNotificationService;
