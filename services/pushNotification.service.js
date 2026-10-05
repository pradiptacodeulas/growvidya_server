const webpush = require('web-push');
const { firebaseMessaging } = require('../config/firebase.config');
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

/**
 * Helper to ensure all values in FCM data dictionary are strings.
 * Firebase Cloud Messaging strictly rejects non-string values in the data payload.
 */
function sanitizeFcmData(data = {}) {
  const sanitized = {};
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && val !== null) {
      sanitized[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
    }
  }
  return sanitized;
}

class PushNotificationService {
  /**
   * Send a push notification to a single registered device (Web or Mobile via FCM)
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

    // 2. Mobile Push Notification (via Firebase Cloud Messaging)
    if (device_type === 'android' || device_type === 'ios') {
      // Deactivate legacy Expo push tokens that might still linger in DB
      if (typeof token === 'string' && token.startsWith('ExponentPushToken')) {
        console.warn(`[FCM Warning]: Deactivating legacy Expo token for user ${user_id} (${role})`);
        await DeviceTokenModel.deactivateToken(endpoint_hash).catch(() => {});
        return { success: false, channel: 'fcm', error: 'Legacy Expo token deactivated. App update required.' };
      }

      try {
        const sanitizedData = sanitizeFcmData(data);
        sanitizedData.category = String(category);

        const fcmMessage = {
          token,
          notification: {
            title: title || 'Growvidya Alert',
            body: body || '',
          },
          data: sanitizedData,
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'default',
              priority: 'high',
              defaultSound: true,
              defaultVibrateTimings: true,
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: data.badge !== undefined ? Number(data.badge) : 1,
                contentAvailable: true,
              },
            },
          },
        };

        if (!firebaseMessaging) {
          console.warn('[FCM Warning]: firebaseMessaging is not initialized on the server.');
          return { success: false, channel: 'fcm', error: 'Firebase messaging not configured' };
        }

        const messageId = await firebaseMessaging.send(fcmMessage);

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
          provider: 'fcm',
          provider_message_id: messageId || null,
        }).catch(() => {});

        return { success: true, channel: 'fcm', messageId };
      } catch (err) {
        console.warn(`[FCM Send Error for user ${user_id}]:`, err.code, err.message);

        // Deactivate unregistered or invalid registration tokens automatically
        const isInvalid =
          err.code === 'messaging/registration-token-not-registered' ||
          err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/invalid-argument';

        if (isInvalid) {
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
          provider: 'fcm',
          error_message: err.message,
        }).catch(() => {});

        return { success: false, channel: 'fcm', error: err.message };
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
    const mobileTokens = [];
    const mobileTokenToRecord = new Map();

    for (const d of activeDevices) {
      if (d.device_type === 'android' || d.device_type === 'ios') {
        if (typeof d.token === 'string' && d.token.startsWith('ExponentPushToken')) {
          // Deactivate legacy token
          DeviceTokenModel.deactivateToken(d.endpoint_hash).catch(() => {});
          continue;
        }

        if (d.token && !seenMobileTokens.has(d.token)) {
          seenMobileTokens.add(d.token);
          mobileTokens.push(d.token);
          mobileTokenToRecord.set(d.token, d);
        }
      }
    }

    // 1. Dispatch Web notifications concurrently
    const webPromises = webDevices.map((device) =>
      this.sendToDevice(device, { title, body, data, category, school_id })
    );

    // 2. Multicast mobile notifications via Firebase in chunks of 500 (FCM native limit)
    const sanitizedData = sanitizeFcmData(data);
    sanitizedData.category = String(category);

    const mobileChunks = [];
    for (let i = 0; i < mobileTokens.length; i += 500) {
      mobileChunks.push(mobileTokens.slice(i, i + 500));
    }

    const mobilePromises = mobileChunks.map(async (tokensChunk) => {
      try {
        if (!firebaseMessaging) {
          return { success: false, error: 'Firebase messaging not configured' };
        }
        const response = await firebaseMessaging.sendEachForMulticast({
          tokens: tokensChunk,
          notification: {
            title: title || 'Growvidya Announcement',
            body: body || '',
          },
          data: sanitizedData,
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'default',
              priority: 'high',
            },
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 },
            },
          },
        });

        // Cleanup dead tokens reported by FCM
        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const failedToken = tokensChunk[idx];
              const errorCode = resp.error?.code;
              if (
                errorCode === 'messaging/registration-token-not-registered' ||
                errorCode === 'messaging/invalid-registration-token'
              ) {
                const rec = mobileTokenToRecord.get(failedToken);
                if (rec) {
                  DeviceTokenModel.deactivateToken(rec.endpoint_hash).catch(() => {});
                }
              }
            }
          });
        }

        return {
          success: true,
          successCount: response.successCount,
          failureCount: response.failureCount,
        };
      } catch (err) {
        console.error('[FCM Multicast Chunk Error]:', err.message);
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
      mobileCount: mobileTokens.length,
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
    const mobileTokens = [];
    const mobileTokenToRecord = new Map();

    for (const d of activeDevices) {
      if (d.device_type === 'android' || d.device_type === 'ios') {
        if (typeof d.token === 'string' && d.token.startsWith('ExponentPushToken')) {
          DeviceTokenModel.deactivateToken(d.endpoint_hash).catch(() => {});
          continue;
        }

        if (d.token && !seenMobileTokens.has(d.token)) {
          seenMobileTokens.add(d.token);
          mobileTokens.push(d.token);
          mobileTokenToRecord.set(d.token, d);
        }
      }
    }

    // 1. Dispatch Web notifications concurrently
    const webPromises = webDevices.map((device) =>
      this.sendToDevice(device, { title, body, data, category, school_id })
    );

    // 2. Multicast mobile notifications via Firebase in chunks of 500
    const sanitizedData = sanitizeFcmData(data);
    sanitizedData.category = String(category);

    const mobileChunks = [];
    for (let i = 0; i < mobileTokens.length; i += 500) {
      mobileChunks.push(mobileTokens.slice(i, i + 500));
    }

    const mobilePromises = mobileChunks.map(async (tokensChunk) => {
      try {
        if (!firebaseMessaging) {
          return { success: false, error: 'Firebase messaging not configured' };
        }
        const response = await firebaseMessaging.sendEachForMulticast({
          tokens: tokensChunk,
          notification: {
            title: title || 'Growvidya Announcement',
            body: body || '',
          },
          data: sanitizedData,
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'default',
              priority: 'high',
            },
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 },
            },
          },
        });

        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const failedToken = tokensChunk[idx];
              const errorCode = resp.error?.code;
              if (
                errorCode === 'messaging/registration-token-not-registered' ||
                errorCode === 'messaging/invalid-registration-token'
              ) {
                const rec = mobileTokenToRecord.get(failedToken);
                if (rec) {
                  DeviceTokenModel.deactivateToken(rec.endpoint_hash).catch(() => {});
                }
              }
            }
          });
        }

        return {
          success: true,
          successCount: response.successCount,
          failureCount: response.failureCount,
        };
      } catch (err) {
        console.error('[FCM Targeted Chunk Error]:', err.message);
        return { success: false, error: err.message };
      }
    });

    const [webResults, mobileResults] = await Promise.all([
      Promise.allSettled(webPromises),
      Promise.allSettled(mobilePromises),
    ]);

    return {
      success: true,
      totalDevices: webDevices.length + mobileTokens.length,
      webCount: webDevices.length,
      mobileCount: mobileTokens.length,
      webResults,
      mobileResults,
    };
  }
}

module.exports = PushNotificationService;
