const { pool } = require('../config/db.config');
const { getTodayIST } = require('../constants/subscriptionModules.constant');

/**
 * Dynamic School Cloud Storage Quota Service.
 * - Base storage comes from active subscription's `subscription_plans.included_storage_gb` (never hardcoded 5 GB).
 * - Expanded storage stacks all active `school_storage_orders` (`quantity * storage_capacity * factor_in_mb`).
 * - Enforces quota on file upload mutations.
 */
class StorageQuotaService {
  static formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b <= 0) return '0 MB';
    const tb = 1024 * 1024 * 1024 * 1024;
    const gb = 1024 * 1024 * 1024;
    const mb = 1024 * 1024;
    if (b >= tb) return `${(b / tb).toFixed(2).replace(/\.00$/, '')} TB`;
    if (b >= gb) return `${(b / gb).toFixed(2).replace(/\.00$/, '')} GB`;
    return `${(b / mb).toFixed(1)} MB`;
  }

  /**
   * Compute dynamic allocated storage in bytes & GB for a school
   */
  static async getSchoolStorageAllocation(schoolId) {
    const parsedSchoolId = parseInt(schoolId, 10);
    if (!parsedSchoolId) {
      return {
        allocatedBytes: 0,
        totalAllowedBytes: 0,
        allocatedFormatted: '0 GB',
        allowedFormatted: '0 GB',
        baseStorageGb: 0,
        addonStorageGb: 0,
        addonStorageMb: 0,
        totalAllowedGb: 0,
        planName: 'No Subscription',
        activeAddons: [],
      };
    }

    const todayStr = getTodayIST();

    // 1. Base storage from active/trial subscription plan
    const [subRows] = await pool.query(
      `SELECT s.id, s.plan_id, s.storage_plan_id, p.plan_name, p.included_storage_gb
       FROM school_subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.school_id = ?
         AND s.status IN ('active', 'trial')
         AND s.end_date >= ?
       ORDER BY CASE WHEN s.status = 'active' THEN 1 ELSE 2 END ASC, s.id DESC
       LIMIT 1`,
      [parsedSchoolId, todayStr]
    );

    const activeSub = subRows[0] || null;
    const baseStorageGb = activeSub ? Math.max(0, parseInt(activeSub.included_storage_gb, 10) || 0) : 0;
    const baseBytes = baseStorageGb * 1024 * 1024 * 1024;

    // 2. Active storage expansion orders from school_storage_orders
    const [orderRows] = await pool.query(
      `SELECT sso.id, sso.order_no, sso.storage_plan_id, sso.quantity, sso.start_date, sso.end_date,
              sm.plan_name, sm.storage_capacity, COALESCE(cu.factor_in_mb, 1024) AS factor_in_mb,
              COALESCE(cu.unit_code, 'GB') AS unit_code
       FROM school_storage_orders sso
       JOIN storage_master sm ON sso.storage_plan_id = sm.id
       LEFT JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
       WHERE sso.school_id = ?
         AND sso.order_status = 'active'
         AND (sso.end_date IS NULL OR sso.end_date >= ?)
       ORDER BY sso.id DESC`,
      [parsedSchoolId, todayStr]
    );

    let addonStorageMb = 0;
    const activeAddons = [];

    for (const ord of orderRows) {
      const qty = Math.max(1, parseInt(ord.quantity, 10) || 1);
      const capMb = (Number(ord.storage_capacity) || 0) * (Number(ord.factor_in_mb) || 1024) * qty;
      addonStorageMb += capMb;
      activeAddons.push({
        order_id: ord.id,
        order_no: ord.order_no,
        plan_name: ord.plan_name,
        quantity: qty,
        capacity_mb: capMb,
        capacity_gb: Number((capMb / 1024).toFixed(2)),
        end_date: ord.end_date,
      });
    }

    // Fallback if legacy activeSub.storage_plan_id exists without a school_storage_orders row
    if (orderRows.length === 0 && activeSub && activeSub.storage_plan_id) {
      const [legacyRows] = await pool.query(
        `SELECT sm.plan_name, sm.storage_capacity, COALESCE(cu.factor_in_mb, 1024) AS factor_in_mb
         FROM storage_master sm
         LEFT JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
         WHERE sm.id = ? LIMIT 1`,
        [activeSub.storage_plan_id]
      );
      if (legacyRows.length > 0) {
        const capMb = (Number(legacyRows[0].storage_capacity) || 0) * (Number(legacyRows[0].factor_in_mb) || 1024);
        addonStorageMb += capMb;
      }
    }

    const addonBytes = addonStorageMb * 1024 * 1024;
    const addonStorageGb = Number((addonStorageMb / 1024).toFixed(2));
    const allocatedBytes = baseBytes + addonBytes;
    const totalAllowedGb = Number((baseStorageGb + addonStorageGb).toFixed(2));
    const allocatedFormatted = StorageQuotaService.formatBytes(allocatedBytes);

    const labelParts = [`${baseStorageGb} GB Plan Included`];
    if (addonBytes > 0) {
      labelParts.push(`+${StorageQuotaService.formatBytes(addonBytes)} Expansion`);
    }

    return {
      allocatedBytes,
      totalAllowedBytes: allocatedBytes,
      allocatedFormatted,
      allowedFormatted: allocatedFormatted,
      baseStorageGb,
      addonStorageGb,
      addonStorageMb,
      totalAllowedGb,
      planName: labelParts.join(' '),
      activeAddons,
    };
  }

  /**
   * Alias returning allocation details (used by SubscriptionModel)
   */
  static async getAllocatedBytes(schoolId) {
    return await StorageQuotaService.getSchoolStorageAllocation(schoolId);
  }

  /**
   * Compute full Storage Quota (allocated + real used disk bytes) for UploadController & Subscription dashboard
   */
  static async getSchoolStorageQuota(schoolId) {
    const parsedSchoolId = parseInt(schoolId, 10);
    const SuperAdminModel = require('../models/superAdmin.model');
    const [allocation, usage] = await Promise.all([
      StorageQuotaService.getSchoolStorageAllocation(parsedSchoolId),
      parsedSchoolId ? SuperAdminModel.calculateRealStorage(parsedSchoolId) : Promise.resolve({ totalBytes: 0 }),
    ]);

    const usedBytes = Number(usage?.totalBytes) || 0;
    const usedFormatted = StorageQuotaService.formatBytes(usedBytes);
    const totalAllowedBytes = allocation.totalAllowedBytes || 0;
    const usagePercent =
      totalAllowedBytes > 0 ? Math.min(100, Number(((usedBytes / totalAllowedBytes) * 100).toFixed(1))) : 0;

    return {
      ...allocation,
      usedBytes,
      usedFormatted,
      usagePercent,
    };
  }

  /**
   * Verify if school has enough cloud storage remaining for an incoming upload
   */
  static async checkUploadAllowed(schoolId, incomingBytes = 0) {
    const parsedSchoolId = parseInt(schoolId, 10);
    if (!parsedSchoolId) return { allowed: true };

    const quota = await StorageQuotaService.getSchoolStorageQuota(parsedSchoolId);
    const projectedBytes = quota.usedBytes + Math.max(0, Number(incomingBytes) || 0);

    if (quota.totalAllowedBytes > 0 && projectedBytes > quota.totalAllowedBytes) {
      return {
        allowed: false,
        usedBytes: quota.usedBytes,
        usedFormatted: quota.usedFormatted,
        allocatedBytes: quota.totalAllowedBytes,
        allocatedFormatted: quota.allowedFormatted,
        message: `Cloud storage limit reached (${quota.usedFormatted} / ${quota.allowedFormatted}). Please purchase a Cloud Storage Expansion pack in Subscription & Billing.`,
      };
    }

    return {
      allowed: true,
      usedBytes: quota.usedBytes,
      allocatedBytes: quota.totalAllowedBytes,
      allocatedFormatted: quota.allowedFormatted,
    };
  }
}

module.exports = StorageQuotaService;
