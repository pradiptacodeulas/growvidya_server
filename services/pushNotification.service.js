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
  static async sendToDevice(
    deviceRecord,
    {
      title,
      body,
      data = {},
      category = 'general',
      school_id = null,
      branch_id = null,
      billable = true,
      skipPrecheck = false,
      skipWalletDebit = false,
      deferRecordLog = false,
      unitCostOverride = null,
    }
  ) {
    const { device_type, token, endpoint_hash, user_id, role } = deviceRecord;
    const resolvedSchoolId = Number(school_id || deviceRecord.school_id) || null;
    const resolvedBranchId = Number(branch_id || deviceRecord.branch_id) || null;
    const isBillable = Boolean(billable) && role !== 'saas_admin' && Boolean(resolvedSchoolId);

    // Deactivate legacy Expo push tokens before reserving wallet credits
    if (
      (device_type === 'android' || device_type === 'ios') &&
      typeof token === 'string' &&
      token.startsWith('ExponentPushToken')
    ) {
      console.warn(`[FCM Warning]: Deactivating legacy Expo token for user ${user_id} (${role})`);
      await DeviceTokenModel.deactivateToken(endpoint_hash).catch(() => {});
      return { success: false, channel: 'fcm', error: 'Legacy Expo token deactivated. App update required.' };
    }

    let reservedSingleCredit = false;
    let effectiveUnitCost = unitCostOverride;

    if (isBillable && !skipPrecheck && !skipWalletDebit) {
      const reservation = await NotificationRecordModel.reservePushCredits({
        schoolId: resolvedSchoolId,
        requestedUnits: 1,
        referenceNote: `Push (${category})`,
      });
      if (!reservation.allowed || reservation.reservedUnits < 1) {
        return {
          success: false,
          code: 'INSUFFICIENT_PUSH_CREDITS',
          error: 'Insufficient push notification credits in school wallet.',
          endpoint_hash,
        };
      }
      reservedSingleCredit = true;
      effectiveUnitCost = reservation.unitCost;
    }

    const refundSingleIfReserved = async () => {
      if (reservedSingleCredit) {
        await NotificationRecordModel.refundUnusedPushCredits({
          schoolId: resolvedSchoolId,
          refundUnits: 1,
          unitCost: effectiveUnitCost,
          referenceNote: `Refund failed push (${category})`,
        }).catch(() => {});
      }
    };

    const persistOrReturnRecord = async (recordPayload) => {
      if (deferRecordLog) {
        return recordPayload;
      }
      await NotificationRecordModel.logPush({
        ...recordPayload,
        skipWalletDebit: skipWalletDebit || reservedSingleCredit,
        unitCostOverride: effectiveUnitCost,
      }).catch((err) => console.error('[Push Log Error]:', err.message));
      return null;
    };

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
            : `${category}_${data.noticeId || data.eventId || data.holidayId || data.id || 'alert'}`);

        let resolvedUrl = data.url || data.path || '/';
        const normalizedRole = String(role || '').toLowerCase();
        if (data.type === 'notice' || category === 'notice') {
          if (normalizedRole === 'teacher') resolvedUrl = '/teacher/announcement/notice';
          else if (normalizedRole === 'student') resolvedUrl = '/student/notices';
          else if (normalizedRole === 'parent') resolvedUrl = '/parent/notices';
          else resolvedUrl = '/admin/announcement/notice';
        } else if (data.type === 'event' || category === 'event') {
          if (normalizedRole === 'teacher') resolvedUrl = '/teacher/announcement/event';
          else if (normalizedRole === 'student') resolvedUrl = '/student/events';
          else if (normalizedRole === 'parent') resolvedUrl = '/parent/events';
          else resolvedUrl = '/admin/announcement/event';
        } else if (data.type === 'holiday' || category === 'holiday') {
          if (normalizedRole === 'teacher') resolvedUrl = '/teacher/announcement/holiday';
          else if (normalizedRole === 'student') resolvedUrl = '/student/holidays';
          else if (normalizedRole === 'parent') resolvedUrl = '/parent/holidays';
          else resolvedUrl = '/admin/announcement/holiday';
        } else if (data.type === 'leave' || category === 'leave') {
          if (data.url) {
            resolvedUrl = data.url;
          } else if (normalizedRole === 'teacher') {
            resolvedUrl = '/teacher/leaves/my-leaves';
          } else {
            resolvedUrl = '/admin/leaves';
          }
        } else if (data.type === 'activity' || category === 'activity') {
          if (data.url) {
            resolvedUrl = data.url;
          } else if (normalizedRole === 'parent') {
            resolvedUrl = '/parent/activities';
          } else if (normalizedRole === 'student') {
            resolvedUrl = '/student/activities';
          } else if (normalizedRole === 'teacher') {
            resolvedUrl = '/teacher/students/activities';
          } else {
            resolvedUrl = '/admin/students/activities';
          }
        }

        const payload = JSON.stringify({
          title: title || 'Growvidya Alert',
          body: body || '',
          data: {
            ...data,
            tag: deterministicTag,
            category,
            url: resolvedUrl,
          },
          icon: '/favicon.png',
          badge: '/favicon.png',
          tag: deterministicTag,
          timestamp: Date.now(),
        });

        const pushResponse = await webpush.sendNotification(subscription, payload);

        const recordPayload = await persistOrReturnRecord({
          school_id: resolvedSchoolId,
          branch_id: resolvedBranchId,
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
          billable: isBillable,
        });

        return { success: true, channel: 'web', endpoint_hash, recordPayload };
      } catch (err) {
        console.warn(`[WebPush Error for user ${user_id} (${role})]:`, err.message);

        if (err.statusCode === 410 || err.statusCode === 404) {
          await DeviceTokenModel.deactivateToken(endpoint_hash).catch(() => {});
        }

        await refundSingleIfReserved();

        const recordPayload = await persistOrReturnRecord({
          school_id: resolvedSchoolId,
          branch_id: resolvedBranchId,
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
          billable: false,
        });

        return { success: false, channel: 'web', error: err.message, endpoint_hash, recordPayload };
      }
    }

    // 2. Mobile Push Notification (via Firebase Cloud Messaging)
    if (device_type === 'android' || device_type === 'ios') {
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
          await refundSingleIfReserved();
          const recordPayload = await persistOrReturnRecord({
            school_id: resolvedSchoolId,
            branch_id: resolvedBranchId,
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
            error_message: 'Firebase messaging not configured',
            billable: false,
          });
          return { success: false, channel: 'fcm', error: 'Firebase messaging not configured', recordPayload };
        }

        const messageId = await firebaseMessaging.send(fcmMessage);

        const recordPayload = await persistOrReturnRecord({
          school_id: resolvedSchoolId,
          branch_id: resolvedBranchId,
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
          billable: isBillable,
        });

        return { success: true, channel: 'fcm', messageId, recordPayload };
      } catch (err) {
        console.warn(`[FCM Send Error for user ${user_id}]:`, err.code, err.message);

        const isInvalid =
          err.code === 'messaging/registration-token-not-registered' ||
          err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/invalid-argument';

        if (isInvalid) {
          await DeviceTokenModel.deactivateToken(endpoint_hash).catch(() => {});
        }

        await refundSingleIfReserved();

        const recordPayload = await persistOrReturnRecord({
          school_id: resolvedSchoolId,
          branch_id: resolvedBranchId,
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
          billable: false,
        });

        return { success: false, channel: 'fcm', error: err.message, recordPayload };
      }
    }

    await refundSingleIfReserved();
    return { success: false, error: 'Unsupported device type: ' + device_type };
  }

  /**
   * Send push notification to all active devices of a specific user (Mobile & Web)
   */
  static async sendToUser({
    school_id = null,
    branch_id = null,
    user_id,
    role,
    title,
    body,
    data = {},
    category = 'general',
    excludeEndpointHash = null,
    billable = true,
  }) {
    if (!user_id || !role) return { success: false, error: 'User ID and Role are required' };

    const resolvedSchoolId = Number(school_id) || null;
    const isBillable = Boolean(billable) && String(role).toLowerCase() !== 'saas_admin' && Boolean(resolvedSchoolId);

    const activeDevices = await DeviceTokenModel.getActiveTokensForUser(user_id, role, resolvedSchoolId);
    if (!activeDevices || activeDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active device tokens found for user' };
    }

    const filteredDevices = excludeEndpointHash
      ? activeDevices.filter((d) => d.endpoint_hash !== excludeEndpointHash)
      : activeDevices;

    // Deduplicate by endpoint_hash or token and drop legacy Expo tokens before reserving credits
    const seenEndpoints = new Set();
    let uniqueDevices = [];
    for (const dev of filteredDevices) {
      if (
        (dev.device_type === 'android' || dev.device_type === 'ios') &&
        typeof dev.token === 'string' &&
        dev.token.startsWith('ExponentPushToken')
      ) {
        DeviceTokenModel.deactivateToken(dev.endpoint_hash).catch(() => {});
        continue;
      }
      const key = dev.endpoint_hash || dev.token;
      if (key && !seenEndpoints.has(key)) {
        seenEndpoints.add(key);
        uniqueDevices.push(dev);
      }
    }

    if (uniqueDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active device tokens found for user' };
    }

    // Prioritize mobile devices first if credits are constrained
    uniqueDevices.sort((a, b) => {
      const aMobile = a.device_type === 'android' || a.device_type === 'ios' ? 0 : 1;
      const bMobile = b.device_type === 'android' || b.device_type === 'ios' ? 0 : 1;
      return aMobile - bMobile;
    });

    const totalCandidateDevices = uniqueDevices.length;
    let reservation = null;
    let skippedForInsufficientCredits = 0;

    if (isBillable) {
      reservation = await NotificationRecordModel.reservePushCredits({
        schoolId: resolvedSchoolId,
        requestedUnits: totalCandidateDevices,
        referenceNote: `User push (${category})`,
      });
      if (!reservation.allowed || reservation.reservedUnits <= 0) {
        return {
          success: false,
          code: 'INSUFFICIENT_PUSH_CREDITS',
          sentCount: 0,
          message: 'Insufficient push notification credits in school wallet.',
        };
      }
      if (totalCandidateDevices > reservation.reservedUnits) {
        uniqueDevices = uniqueDevices.slice(0, reservation.reservedUnits);
        skippedForInsufficientCredits = totalCandidateDevices - uniqueDevices.length;
      }
    }

    const results = await Promise.allSettled(
      uniqueDevices.map((device) =>
        this.sendToDevice(device, {
          title,
          body,
          data,
          category,
          school_id: resolvedSchoolId,
          branch_id,
          billable: isBillable,
          skipPrecheck: true,
          skipWalletDebit: true,
          deferRecordLog: true,
          unitCostOverride: reservation?.unitCost ?? null,
        })
      )
    );

    const recordsToInsert = [];
    let successful = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value?.success) successful += 1;
        if (r.value?.recordPayload) recordsToInsert.push(r.value.recordPayload);
      }
    }

    if (recordsToInsert.length > 0) {
      await NotificationRecordModel.logPushBatch(recordsToInsert, {
        unitCostOverride: reservation?.unitCost ?? null,
      }).catch((err) => console.error('[Push Batch Log Error]:', err.message));
    }

    if (isBillable && reservation && reservation.reservedUnits > successful) {
      await NotificationRecordModel.refundUnusedPushCredits({
        schoolId: resolvedSchoolId,
        refundUnits: reservation.reservedUnits - successful,
        unitCost: reservation.unitCost,
        referenceNote: `Refund ${reservation.reservedUnits - successful} failed push unit(s) (${category})`,
      }).catch(() => {});
    }

    return {
      success: true,
      totalDevices: uniqueDevices.length,
      sentCount: successful,
      skippedForInsufficientCredits,
      lowCreditWarning:
        skippedForInsufficientCredits > 0
          ? `Delivered up to ${uniqueDevices.length} device(s) using available wallet balance; ${skippedForInsufficientCredits} device(s) skipped due to low push credits.`
          : null,
      details: results,
    };
  }

  /**
   * Send Web Push notifications to active SaaS Super Admins & permitted Sub-Admins
   */
  static async sendToSaasAdmins({
    targetAdminIds = null,
    includeSuperAdmins = true,
    school_id = null,
    title,
    body,
    data = {},
    category = 'support_ticket',
  }) {
    const activeDevices = await DeviceTokenModel.getActiveWebTokensForSaasAdmins(
      targetAdminIds,
      includeSuperAdmins
    );
    if (!activeDevices || activeDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active SaaS Admin web push tokens found' };
    }

    const seenEndpoints = new Set();
    const uniqueDevices = [];
    for (const dev of activeDevices) {
      const key = dev.endpoint_hash || dev.token;
      if (key && !seenEndpoints.has(key)) {
        seenEndpoints.add(key);
        uniqueDevices.push(dev);
      }
    }

    const results = await Promise.allSettled(
      uniqueDevices.map((device) =>
        this.sendToDevice(device, {
          title,
          body,
          data,
          category,
          school_id: Number(school_id) || null,
          billable: false,
          skipPrecheck: true,
          skipWalletDebit: true,
        })
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
   * Internal shared batch dispatcher:
   * - Performs 1 atomic FOR UPDATE wallet reservation up to available push_balance (mobile prioritized first)
   * - Dispatches WebPush + 500-token FCM multicast chunks concurrently
   * - Bulk-inserts notification_records in 1 batched operation
   * - Refunds any failed deliveries atomically back to school_notification_wallets
   */
  static async _dispatchBatchDevices(
    activeDevices,
    {
      resolvedSchoolId,
      branch_id = null,
      title,
      body,
      data = {},
      category = 'announcement',
      isBillable = true,
      emptyMessage = 'No valid active devices found',
    }
  ) {
    const seenWebEndpoints = new Set();
    let webDevices = [];
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
    let mobileTokens = [];
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

    const totalCandidateDevices = webDevices.length + mobileTokens.length;
    if (totalCandidateDevices === 0) {
      return { success: true, sentCount: 0, message: emptyMessage };
    }

    let reservation = null;
    let skippedForInsufficientCredits = 0;

    if (isBillable) {
      reservation = await NotificationRecordModel.reservePushCredits({
        schoolId: resolvedSchoolId,
        requestedUnits: totalCandidateDevices,
        referenceNote: `Broadcast push (${category})`,
      });
      if (!reservation.allowed || reservation.reservedUnits <= 0) {
        return {
          success: false,
          code: 'INSUFFICIENT_PUSH_CREDITS',
          sentCount: 0,
          message: 'Insufficient push notification credits in school wallet.',
        };
      }
      if (totalCandidateDevices > reservation.reservedUnits) {
        let remainingAllowance = reservation.reservedUnits;
        if (mobileTokens.length >= remainingAllowance) {
          mobileTokens = mobileTokens.slice(0, remainingAllowance);
          webDevices = [];
        } else {
          remainingAllowance -= mobileTokens.length;
          webDevices = webDevices.slice(0, remainingAllowance);
        }
        skippedForInsufficientCredits = totalCandidateDevices - (mobileTokens.length + webDevices.length);
      }
    }

    const webPromises = webDevices.map((device) =>
      this.sendToDevice(device, {
        title,
        body,
        data,
        category,
        school_id: resolvedSchoolId,
        branch_id,
        billable: isBillable,
        skipPrecheck: true,
        skipWalletDebit: true,
        deferRecordLog: true,
        unitCostOverride: reservation?.unitCost ?? null,
      })
    );

    const sanitizedData = sanitizeFcmData(data);
    sanitizedData.category = String(category);

    const mobileChunks = [];
    for (let i = 0; i < mobileTokens.length; i += 500) {
      mobileChunks.push(mobileTokens.slice(i, i + 500));
    }

    const mobilePromises = mobileChunks.map(async (tokensChunk) => {
      const chunkRecords = [];
      try {
        if (!firebaseMessaging) {
          for (const tok of tokensChunk) {
            const rec = mobileTokenToRecord.get(tok);
            chunkRecords.push({
              school_id: resolvedSchoolId,
              branch_id: Number(branch_id || rec?.branch_id) || null,
              recipient_device_token: tok,
              recipient_device_type: rec?.device_type || 'android',
              title,
              message: body,
              payload: data,
              recipient_role: rec?.role || 'other',
              recipient_id: rec?.user_id || null,
              category,
              status: 'failed',
              provider: 'fcm',
              error_message: 'Firebase messaging not configured',
              billable: false,
            });
          }
          return { success: false, successCount: 0, failureCount: tokensChunk.length, error: 'Firebase messaging not configured', chunkRecords };
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

        for (let idx = 0; idx < response.responses.length; idx++) {
          const resp = response.responses[idx];
          const tok = tokensChunk[idx];
          const rec = mobileTokenToRecord.get(tok);

          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/invalid-registration-token'
            ) {
              if (rec) {
                DeviceTokenModel.deactivateToken(rec.endpoint_hash).catch(() => {});
              }
            }
          }

          chunkRecords.push({
            school_id: resolvedSchoolId,
            branch_id: Number(branch_id || rec?.branch_id) || null,
            recipient_device_token: tok,
            recipient_device_type: rec?.device_type || 'android',
            title,
            message: body,
            payload: data,
            recipient_role: rec?.role || 'other',
            recipient_id: rec?.user_id || null,
            category,
            status: resp.success ? 'sent' : 'failed',
            provider: 'fcm',
            provider_message_id: resp.messageId || null,
            error_message: resp.error?.message || null,
            billable: resp.success && isBillable,
          });
        }

        return {
          success: true,
          successCount: response.successCount,
          failureCount: response.failureCount,
          chunkRecords,
        };
      } catch (err) {
        console.error('[FCM Multicast Chunk Error]:', err.message);
        for (const tok of tokensChunk) {
          const rec = mobileTokenToRecord.get(tok);
          chunkRecords.push({
            school_id: resolvedSchoolId,
            branch_id: Number(branch_id || rec?.branch_id) || null,
            recipient_device_token: tok,
            recipient_device_type: rec?.device_type || 'android',
            title,
            message: body,
            payload: data,
            recipient_role: rec?.role || 'other',
            recipient_id: rec?.user_id || null,
            category,
            status: 'failed',
            provider: 'fcm',
            error_message: err.message,
            billable: false,
          });
        }
        return { success: false, successCount: 0, failureCount: tokensChunk.length, error: err.message, chunkRecords };
      }
    });

    const [webResults, mobileResults] = await Promise.all([
      Promise.allSettled(webPromises),
      Promise.allSettled(mobilePromises),
    ]);

    const recordsToInsert = [];
    let webSentCount = 0;
    let mobileSentCount = 0;

    for (const r of webResults) {
      if (r.status === 'fulfilled') {
        if (r.value?.success) webSentCount += 1;
        if (r.value?.recordPayload) recordsToInsert.push(r.value.recordPayload);
      }
    }

    for (const r of mobileResults) {
      if (r.status === 'fulfilled') {
        mobileSentCount += Number(r.value?.successCount) || 0;
        if (Array.isArray(r.value?.chunkRecords)) {
          recordsToInsert.push(...r.value.chunkRecords);
        }
      }
    }

    if (recordsToInsert.length > 0) {
      await NotificationRecordModel.logPushBatch(recordsToInsert, {
        unitCostOverride: reservation?.unitCost ?? null,
      }).catch((err) => console.error('[Push Batch Log Error]:', err.message));
    }

    const sentCount = webSentCount + mobileSentCount;
    if (isBillable && reservation && reservation.reservedUnits > sentCount) {
      await NotificationRecordModel.refundUnusedPushCredits({
        schoolId: resolvedSchoolId,
        refundUnits: reservation.reservedUnits - sentCount,
        unitCost: reservation.unitCost,
        referenceNote: `Refund ${reservation.reservedUnits - sentCount} failed push unit(s) (${category})`,
      }).catch(() => {});
    }

    return {
      success: true,
      totalDevices: webDevices.length + mobileTokens.length,
      sentCount,
      skippedForInsufficientCredits,
      lowCreditWarning:
        skippedForInsufficientCredits > 0
          ? `Delivered to up to ${webDevices.length + mobileTokens.length} device(s) using available wallet balance; ${skippedForInsufficientCredits} device(s) skipped due to low push credits.`
          : null,
      webCount: webDevices.length,
      mobileCount: mobileTokens.length,
      webResults,
      mobileResults,
    };
  }

  /**
   * Broadcast push notification to school/branch (or optional target roles)
   */
  static async sendToRoles({
    roles = null,
    school_id = null,
    branch_id = null,
    title,
    body,
    data = {},
    category = 'announcement',
    billable = true,
  }) {
    const resolvedSchoolId = Number(school_id) || null;
    if (!resolvedSchoolId) return { success: false, error: 'Valid school_id is required' };
    const isBillable = Boolean(billable);

    const activeDevices = await DeviceTokenModel.getActiveTokensForRoles(roles, resolvedSchoolId, branch_id);
    if (!activeDevices || activeDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active devices found for target roles' };
    }

    return this._dispatchBatchDevices(activeDevices, {
      resolvedSchoolId,
      branch_id,
      title,
      body,
      data,
      category,
      isBillable,
      emptyMessage: 'No valid active devices found for target roles',
    });
  }

  /**
   * Broadcast push notification to targeted individual recipients ({ id, role })
   * Used for class/section targeted notices, specific staff, etc.
   */
  static async sendToTargetedRecipients({
    recipients = [],
    school_id = null,
    branch_id = null,
    title,
    body,
    data = {},
    category = 'announcement',
    billable = true,
  }) {
    if (!recipients || recipients.length === 0) {
      return { success: true, sentCount: 0, message: 'No recipients provided' };
    }

    const resolvedSchoolId = Number(school_id) || null;
    if (!resolvedSchoolId) return { success: false, error: 'Valid school_id is required' };
    const isBillable = Boolean(billable);

    const activeDevices = await DeviceTokenModel.getActiveTokensForTargetedRecipients(
      recipients,
      resolvedSchoolId,
      branch_id
    );
    if (!activeDevices || activeDevices.length === 0) {
      return { success: true, sentCount: 0, message: 'No active devices found for targeted recipients' };
    }

    return this._dispatchBatchDevices(activeDevices, {
      resolvedSchoolId,
      branch_id,
      title,
      body,
      data,
      category,
      isBillable,
      emptyMessage: 'No valid active devices found for targeted recipients',
    });
  }
}

module.exports = PushNotificationService;
