const DeviceTokenModel = require('../models/deviceToken.model');
const PushNotificationService = require('../services/pushNotification.service');

class NotificationController {
  /**
   * Return the public VAPID key for browser PushManager subscription
   */
  static async getVapidPublicKey(req, res) {
    try {
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      if (!publicKey) {
        return res.status(500).json({
          success: false,
          message: 'VAPID public key is not configured on the server.',
        });
      }
      return res.status(200).json({
        success: true,
        vapidPublicKey: publicKey,
      });
    } catch (err) {
      console.error('[getVapidPublicKey Error]:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Register or update an active device push token (Web or Mobile)
   */
  static async registerDeviceToken(req, res) {
    try {
      const { token, device_type, device_name } = req.body;

      if (!token) {
        return res.status(400).json({ success: false, message: 'Push token is required' });
      }

      if (!device_type || !['web', 'android', 'ios'].includes(String(device_type).toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: 'Valid device_type is required (web, android, ios)',
        });
      }

      // Extract user info from authenticated request
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return res.status(401).json({ success: false, message: 'Authentication required: school ID missing.' });
      }
      let role = 'admin';
      const rawRole = String(req.user?.roleName || req.user?.role || req.user?.portalType || '').toLowerCase();
      if (rawRole.includes('student')) role = 'student';
      else if (rawRole.includes('parent')) role = 'parent';
      else if (rawRole.includes('teacher')) role = 'teacher';
      else role = 'admin';

      const userId = Number(
        req.user?.userId ||
        req.user?.studentId ||
        req.user?.teacherId ||
        req.user?.parentId ||
        req.user?.id
      );

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unable to resolve authenticated user ID' });
      }

      const userAgent = req.headers['user-agent'] || null;

      const branchId = req.user?.branch_id || req.user?.branchId || req.branchId || null;

      const result = await DeviceTokenModel.registerToken({
        school_id: schoolId,
        branch_id: branchId,
        user_id: userId,
        role,
        device_type: String(device_type).toLowerCase(),
        token,
        device_name: device_name || null,
        user_agent: userAgent,
      });

      return res.status(200).json({
        success: true,
        message: 'Device token registered successfully',
        endpointHash: result.endpointHash,
      });
    } catch (err) {
      console.error('[registerDeviceToken Error]:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
    }
  }

  /**
   * Revoke device token on logout
   */
  static async unregisterDeviceToken(req, res) {
    try {
      const { token, endpointHash } = req.body;

      let role = 'admin';
      const rawRole = String(req.user?.roleName || req.user?.role || req.user?.portalType || '').toLowerCase();
      if (rawRole.includes('student')) role = 'student';
      else if (rawRole.includes('parent')) role = 'parent';
      else if (rawRole.includes('teacher')) role = 'teacher';
      else role = 'admin';

      const userId = Number(
        req.user?.userId ||
        req.user?.studentId ||
        req.user?.teacherId ||
        req.user?.parentId ||
        req.user?.id
      );

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unable to resolve authenticated user ID' });
      }

      await DeviceTokenModel.unregisterToken({
        user_id: userId,
        role,
        token: token || null,
        endpoint_hash: endpointHash || null,
      });

      return res.status(200).json({
        success: true,
        message: 'Device token revoked successfully',
      });
    } catch (err) {
      console.error('[unregisterDeviceToken Error]:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
    }
  }

  /**
   * Send a test push notification to the authenticated user's registered devices
   */
  static async testSendNotification(req, res) {
    try {
      const { title, body } = req.body;
      if (!title || !body) {
        return res.status(400).json({ success: false, message: 'Title and body are required.' });
      }

      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return res.status(401).json({ success: false, message: 'Authentication required: school ID missing.' });
      }
      const rawRole = (req.user?.roleName || req.user?.role || req.user?.portalType || '').toLowerCase();
      let role = 'other';
      if (rawRole.includes('student')) role = 'student';
      else if (rawRole.includes('parent')) role = 'parent';
      else if (rawRole.includes('teacher')) role = 'teacher';
      else if (rawRole.includes('admin') || rawRole.includes('saas')) role = 'admin';

      const userId = Number(
        req.user?.userId ||
        req.user?.studentId ||
        req.user?.teacherId ||
        req.user?.parentId ||
        req.user?.id
      );

      const result = await PushNotificationService.sendToUser({
        school_id: schoolId,
        user_id: userId,
        role,
        title,
        body,
        data: { test: true, timestamp: Date.now() },
        category: 'test',
      });

      return res.status(200).json(result);
    } catch (err) {
      console.error('[testSendNotification Error]:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
    }
  }
}

module.exports = NotificationController;
