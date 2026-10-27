const DeviceTokenModel = require('../models/deviceToken.model');

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
      const { token, device_type, device_name } = req.body || {};

      if (!token) {
        return res.status(400).json({ success: false, message: 'Push token is required' });
      }

      if (!device_type || !['web', 'android', 'ios'].includes(String(device_type).toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: 'Valid device_type is required (web, android, ios)',
        });
      }

      const userAgent = req.headers['user-agent'] || null;

      // 1. SaaS Super Admin / Sub-Admin portal request
      if (req.saasAdmin && req.saasAdmin.id) {
        const result = await DeviceTokenModel.registerToken({
          school_id: 0,
          branch_id: null,
          user_id: Number(req.saasAdmin.id),
          role: 'saas_admin',
          device_type: String(device_type).toLowerCase(),
          token,
          device_name: device_name || null,
          user_agent: userAgent,
        });

        return res.status(200).json({
          success: true,
          message: 'SaaS Admin Web Push token registered successfully',
          endpointHash: result.endpointHash,
        });
      }

      // 2. School Portal (Admin / Teacher / Parent / Student) request
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
      const { token, endpointHash } = req.body || {};

      if (req.saasAdmin && req.saasAdmin.id) {
        await DeviceTokenModel.unregisterToken({
          user_id: Number(req.saasAdmin.id),
          role: 'saas_admin',
          token: token || null,
          endpoint_hash: endpointHash || null,
        });

        return res.status(200).json({
          success: true,
          message: 'SaaS Admin Web Push token revoked successfully',
        });
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
}

module.exports = NotificationController;
