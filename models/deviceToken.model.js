const { pool } = require('../config/db.config');
const crypto = require('crypto');

class DeviceTokenModel {
  /**
   * Helper to compute a consistent SHA-256 hash for a token or web push subscription endpoint
   */
  static computeHash(tokenInput) {
    let raw = '';
    if (typeof tokenInput === 'string') {
      try {
        const parsed = JSON.parse(tokenInput);
        raw = parsed.endpoint || tokenInput;
      } catch {
        raw = tokenInput;
      }
    } else if (tokenInput && typeof tokenInput === 'object') {
      raw = tokenInput.endpoint || JSON.stringify(tokenInput);
    }
    return crypto.createHash('sha256').update(String(raw).trim()).digest('hex');
  }

  /**
   * Register or update a device token (upserts based on unique endpoint_hash)
   */
  static async registerToken({
    school_id,
    user_id,
    role,
    branch_id = null,
    device_type,
    token,
    device_name = null,
    user_agent = null,
  }) {
    if (!school_id || !user_id || !role || !device_type || !token) {
      throw new Error('school_id, user_id, role, device_type, and token are required.');
    }

    const tokenStr = typeof token === 'object' ? JSON.stringify(token) : String(token).trim();
    const endpointHash = this.computeHash(token);
    const normalizedRole = String(role).toLowerCase();
    const normalizedDeviceType = String(device_type).toLowerCase();

    let resolvedBranchId = branch_id ? Number(branch_id) : null;
    if (!resolvedBranchId && user_id && school_id) {
      if (normalizedRole === 'student') {
        try {
          const [sRow] = await pool.query('SELECT branch_id FROM student_master WHERE id = ? AND school_id = ? LIMIT 1', [user_id, school_id]);
          if (sRow.length && sRow[0].branch_id) resolvedBranchId = sRow[0].branch_id;
        } catch (e) {}
      } else if (normalizedRole === 'teacher') {
        try {
          const [tRow] = await pool.query('SELECT branch_id FROM teacher_master WHERE id = ? AND school_id = ? LIMIT 1', [user_id, school_id]);
          if (tRow.length && tRow[0].branch_id) resolvedBranchId = tRow[0].branch_id;
        } catch (e) {}
      } else if (normalizedRole === 'parent') {
        try {
          const [pRow] = await pool.query('SELECT branch_id FROM parent_master WHERE id = ? AND school_id = ? LIMIT 1', [user_id, school_id]);
          if (pRow.length && pRow[0].branch_id) resolvedBranchId = pRow[0].branch_id;
        } catch (e) {}
      } else {
        try {
          const [uRow] = await pool.query('SELECT branch_id FROM user_master WHERE id = ? AND school_id = ? LIMIT 1', [user_id, school_id]);
          if (uRow.length && uRow[0].branch_id) resolvedBranchId = uRow[0].branch_id;
        } catch (e) {}
      }
    }

    // Deactivate any other user session registered on this physical browser endpoint
    await pool.query(
      `UPDATE user_device_tokens 
       SET is_active = 0 
       WHERE endpoint_hash = ? AND (user_id != ? OR role != ?)`,
      [endpointHash, user_id, normalizedRole]
    );

    const query = `
      INSERT INTO user_device_tokens (
        school_id, branch_id, user_id, role, device_type, token, endpoint_hash,
        device_name, user_agent, is_active, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        school_id = VALUES(school_id),
        branch_id = COALESCE(VALUES(branch_id), branch_id),
        device_type = VALUES(device_type),
        token = VALUES(token),
        device_name = COALESCE(VALUES(device_name), device_name),
        user_agent = COALESCE(VALUES(user_agent), user_agent),
        is_active = 1,
        last_used_at = CURRENT_TIMESTAMP
    `;

    const [result] = await pool.query(query, [
      school_id,
      resolvedBranchId,
      user_id,
      normalizedRole,
      normalizedDeviceType,
      tokenStr,
      endpointHash,
      device_name,
      user_agent ? String(user_agent).substring(0, 255) : null,
    ]);

    return { success: true, endpointHash, affectedRows: result.affectedRows };
  }

  /**
   * Revoke/deactivate a token on user logout
   */
  static async unregisterToken({ user_id, role, token = null, endpoint_hash = null }) {
    let hash = endpoint_hash;
    if (!hash && token) {
      hash = this.computeHash(token);
    }

    if (hash) {
      const query = `
        UPDATE user_device_tokens
        SET is_active = 0
        WHERE endpoint_hash = ? AND user_id = ? AND role = ?
      `;
      const [result] = await pool.query(query, [hash, user_id, String(role).toLowerCase()]);
      return { success: true, affectedRows: result.affectedRows };
    }

    // Fallback: unregister all tokens for user on this role
    const query = `
      UPDATE user_device_tokens
      SET is_active = 0
      WHERE user_id = ? AND role = ?
    `;
    const [result] = await pool.query(query, [user_id, String(role).toLowerCase()]);
    return { success: true, affectedRows: result.affectedRows };
  }

  /**
   * Fetch all active device tokens for a specific user
   */
  static async getActiveTokensForUser(userId, role, schoolId = null) {
    let query = `
      SELECT id, school_id, user_id, role, device_type, token, endpoint_hash, device_name, last_used_at
      FROM user_device_tokens
      WHERE user_id = ? AND role = ? AND is_active = 1
    `;
    const params = [userId, String(role).toLowerCase()];

    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Fetch all active device tokens for a list of target roles (e.g. broadcast notice)
   */
  static async getActiveTokensForRoles(roles = [], schoolId = null) {
    if (!roles || roles.length === 0) return [];

    const normalizedRoles = roles.map((r) => String(r).toLowerCase());
    const placeholders = normalizedRoles.map(() => '?').join(',');

    let query = `
      SELECT id, school_id, user_id, role, device_type, token, endpoint_hash, device_name, last_used_at
      FROM user_device_tokens
      WHERE role IN (${placeholders}) AND is_active = 1
    `;
    const params = [...normalizedRoles];

    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Fetch active device tokens for a targeted list of recipients ({ id, role })
   */
  static async getActiveTokensForTargetedRecipients(recipients = [], schoolId = null) {
    if (!recipients || recipients.length === 0) return [];

    const roleMap = {};
    for (const r of recipients) {
      const role = String(r.role).toLowerCase();
      const id = Number(r.id);
      if (role && id) {
        if (!roleMap[role]) roleMap[role] = new Set();
        roleMap[role].add(id);
      }
    }

    const roles = Object.keys(roleMap);
    if (roles.length === 0) return [];

    const clauses = [];
    const params = [];
    for (const role of roles) {
      const ids = Array.from(roleMap[role]);
      clauses.push(`(role = ? AND user_id IN (${ids.map(() => '?').join(',')}))`);
      params.push(role, ...ids);
    }

    let query = `
      SELECT id, school_id, user_id, role, device_type, token, endpoint_hash, device_name, last_used_at
      FROM user_device_tokens
      WHERE is_active = 1 AND (${clauses.join(' OR ')})
    `;
    if (schoolId) {
      query += ` AND school_id = ?`;
      params.push(schoolId);
    }

    const [rows] = await pool.query(query, params);
    return rows;
  }

  /**
   * Deactivate an expired or invalid token reported by push gateways (FCM/Expo/WebPush 410)
   */
  static async deactivateToken(endpointHash) {
    if (!endpointHash) return;
    await pool.query(
      `UPDATE user_device_tokens SET is_active = 0 WHERE endpoint_hash = ?`,
      [endpointHash]
    );
  }
}

module.exports = DeviceTokenModel;
