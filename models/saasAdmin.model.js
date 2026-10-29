const { pool } = require('../config/db.config');
const SubscriptionItemModel = require('./subscriptionItem.model');
const SaasRoleModel = require('./saasRole.model');
const CouponModel = require('./coupon.model');
const NotificationRecordModel = require('./notificationRecord.model');
const SubscriptionFulfillmentService = require('../services/subscriptionFulfillment.service');
const { parsePagination, buildPagination } = require('../utils/pagination.util');
const {
  BILLING_CYCLES,
  getBillingCycleMeta,
  addCycleDuration,
  getTodayIST,
} = require('../constants/subscriptionModules.constant');

function normalizePlanItems(items = []) {
  return (Array.isArray(items) ? items : []).filter(
    (it) => it && it.item_name && String(it.item_name).trim()
  );
}

function enrichPackageRow(pkg) {
  if (!pkg) return null;
  const featuresMap = {};

  if (pkg.features_json) {
    let parsed = pkg.features_json;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (_) {
        parsed = null;
      }
    }
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (k && Boolean(v)) featuresMap[String(k).toLowerCase()] = true;
      }
    }
  }

  for (const it of pkg.items || []) {
    if (it?.item_code && Number(it.status) === 1) {
      featuresMap[String(it.item_code).trim().toLowerCase()] = true;
    }
  }

  const sellingPrice = parseFloat(pkg.price) || 0;
  const rawOriginal =
    pkg.original_price !== null && pkg.original_price !== undefined && pkg.original_price !== ''
      ? parseFloat(pkg.original_price)
      : null;
  const validOriginal =
    rawOriginal !== null && !isNaN(rawOriginal) && rawOriginal > sellingPrice
      ? Number(rawOriginal.toFixed(2))
      : null;

  pkg.original_price = validOriginal;
  pkg.discount_amount = validOriginal ? Number((validOriginal - sellingPrice).toFixed(2)) : 0;
  pkg.discount_percent = validOriginal
    ? Math.round(((validOriginal - sellingPrice) / validOriginal) * 100)
    : 0;
  pkg.tier_rank = Number(pkg.tier_rank) || 1;
  pkg.included_storage_gb = Math.max(0, parseInt(pkg.included_storage_gb, 10) || 0);
  pkg.is_popular = Number(pkg.is_popular) === 1 ? 1 : 0;
  pkg.max_students = Number(pkg.max_students) || 0;
  pkg.max_teachers = 0;
  pkg.max_branches = 0;
  pkg.features = featuresMap;
  pkg.cycle_meta = getBillingCycleMeta(pkg.billing_cycle, pkg.free_trial_days);
  return pkg;
}

class SaasAdminModel {
  // ========================================================
  // 1. AUTHENTICATION & ADMIN USERS
  // ========================================================
  static async findByEmail(email) {
    const [rows] = await pool.query(
      `SELECT 
        sau.*, 
        sau.gender AS gender_id, 
        gm.gender AS gender_name,
        sr.status AS role_status,
        COALESCE(sr.role_name, IF(sau.role = 'superadmin', 'Super Admin', 'Sub Admin')) AS role_name
      FROM saas_admin_users sau 
      LEFT JOIN gender_master gm ON sau.gender = gm.id 
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id
      WHERE sau.email = ? 
      LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    if (rows.length === 0) return null;
    const user = rows[0];
    user.permissions = await SaasRoleModel.resolveEffectivePermissions(user);
    return user;
  }

  static async findById(id) {
    const [rows] = await pool.query(
      `SELECT 
        sau.id, 
        sau.first_name, 
        sau.last_name, 
        sau.gender, 
        sau.gender AS gender_id, 
        gm.gender AS gender_name, 
        sau.profile_image, 
        sau.phone_number, 
        sau.email, 
        sau.role, 
        sau.role_id,
        COALESCE(sr.role_name, IF(sau.role = 'superadmin', 'Super Admin', 'Sub Admin')) AS role_name,
        sau.status, 
        sau.created_at, 
        sau.updated_at 
      FROM saas_admin_users sau 
      LEFT JOIN gender_master gm ON sau.gender = gm.id 
      LEFT JOIN saas_roles sr ON sau.role_id = sr.id
      WHERE sau.id = ? 
      LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return null;
    const user = rows[0];
    user.permissions = await SaasRoleModel.resolveEffectivePermissions(user);
    return user;
  }

  static async getGenders() {
    const [rows] = await pool.query(
      'SELECT id, gender, gender AS name FROM gender_master ORDER BY id ASC'
    );
    return rows;
  }

  static async updateProfile(id, { first_name, last_name, gender, gender_id, profile_image, phone_number, email, name }) {
    const updates = [];
    const params = [];

    let fName = first_name;
    let lName = last_name;
    if (fName === undefined && lName === undefined && name !== undefined) {
      const parts = String(name).trim().split(/\s+/);
      fName = parts[0] || '';
      lName = parts.slice(1).join(' ') || '';
    }

    if (fName !== undefined) {
      updates.push('first_name = ?');
      params.push(fName ? String(fName).trim() : null);
    }

    if (lName !== undefined) {
      updates.push('last_name = ?');
      params.push(lName ? String(lName).trim() : null);
    }

    const genderInput = gender_id !== undefined ? gender_id : gender;
    if (genderInput !== undefined) {
      let resolvedGenderId = null;
      if (genderInput !== null && String(genderInput).trim() !== '') {
        const rawStr = String(genderInput).trim();
        if (/^\d+$/.test(rawStr)) {
          const [gmRows] = await pool.query('SELECT id, gender FROM gender_master WHERE id = ? LIMIT 1', [Number(rawStr)]);
          if (gmRows.length === 0) {
            const err = new Error(`Invalid gender ID '${genderInput}'. Please provide a valid ID from gender_master.`);
            err.statusCode = 400;
            throw err;
          }
          resolvedGenderId = gmRows[0].id;
        } else {
          const [gmRows] = await pool.query(
            'SELECT id, gender FROM gender_master WHERE LOWER(gender) = LOWER(?) OR (LOWER(?) = "other" AND LOWER(gender) = "others") LIMIT 1',
            [rawStr, rawStr]
          );
          if (gmRows.length === 0) {
            const err = new Error(`Invalid gender '${genderInput}'. Please provide a valid gender ID or name from gender_master.`);
            err.statusCode = 400;
            throw err;
          }
          resolvedGenderId = gmRows[0].id;
        }
      }
      updates.push('gender = ?');
      params.push(resolvedGenderId);
    }

    if (profile_image !== undefined) {
      let imagePath = profile_image;
      if (imagePath && imagePath.startsWith('data:')) {
        const { saveBase64File } = require('../utils/file.util');
        imagePath = saveBase64File(imagePath, 'admin/profile_pic', 'SaasAdmin');
      }
      updates.push('profile_image = ?');
      params.push(imagePath || null);
    }

    if (phone_number !== undefined) {
      updates.push('phone_number = ?');
      params.push(phone_number ? String(phone_number).trim() : null);
    }

    if (email !== undefined && email.trim()) {
      updates.push('email = ?');
      params.push(String(email).toLowerCase().trim());
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE saas_admin_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 2. DASHBOARD & ANALYTICS (Zero Double-Counting!)
  // ========================================================
  static async getDashboardStats() {
    const [
      [schoolRows],
      [subRows],
      [planRows],
      [couponRows],
      [storageRows],
      [machineRows],
      [rfidRows],
      [bankRows],
      [storageOrderRows],
      [machineOrderRows],
      [rfidOrderRows],
      [notifCreditRows],
      [ticketSummaryRows],
      [planDistRows],
      [monthlySubRows],
      [monthlyStorageRows],
      [monthlyMachineRows],
      [monthlyRfidRows],
      [monthlyNotifRows],
      [monthlySchoolRows],
      [recentSchools],
      [pendingSubs],
      [recentTickets],
    ] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) AS total_schools,
          COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_schools,
          COALESCE(SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END), 0) AS inactive_schools,
          COALESCE(SUM(CASE WHEN YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN 1 ELSE 0 END), 0) AS this_month_schools
        FROM school_master
      `),

      // Software subscription revenue uses plan_amount when linked to payment_order_id so bundled add-ons are NEVER double-counted!
      pool.query(`
        SELECT 
          COUNT(*) AS total_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END), 0) AS trial_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expired_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended_subscriptions,
          COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_payments,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN (CASE WHEN payment_order_id IS NOT NULL THEN plan_amount ELSE amount_paid END) ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN (CASE WHEN payment_order_id IS NOT NULL THEN plan_amount ELSE amount_paid END) ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN discount_amount ELSE 0 END), 0) AS total_discount
        FROM school_subscriptions
      `),

      pool.query(`
        SELECT COUNT(*) AS total_packages, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_packages
        FROM subscription_plans
      `),

      pool.query(`
        SELECT 
          COUNT(*) AS total_coupons,
          COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_coupons,
          COALESCE(SUM(used_count), 0) AS total_usages
        FROM coupons
      `),

      pool.query(`
        SELECT COUNT(*) AS total_storage, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_storage
        FROM storage_master
      `),

      pool.query(`
        SELECT COUNT(*) AS total_machines, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_machines
        FROM attendance_machine_master
      `),

      pool.query(`
        SELECT COUNT(*) AS total_rfid, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_rfid
        FROM rfid_card_master
      `),

      pool.query(`
        SELECT COUNT(*) AS total_banks, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_banks
        FROM bank_account_master
      `),

      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(quantity), 0) AS total_quantity,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') THEN total_amount ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN order_status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
          COALESCE(SUM(CASE WHEN order_status = 'expired' THEN 1 ELSE 0 END), 0) AS expired_count,
          COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM school_storage_orders
      `),

      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(quantity), 0) AS total_quantity,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') THEN total_amount ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN order_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN order_status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
          COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count,
          COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM school_attendance_machines
      `),

      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(quantity), 0) AS total_quantity,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') THEN total_amount ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN order_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN order_status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
          COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count,
          COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM school_rfid_orders
      `),

      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN total_amount ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN entry_type = 'credit' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN total_amount ELSE 0 END), 0) AS this_month_revenue
        FROM school_notification_ledger
      `),

      pool.query(`
        SELECT
          COUNT(*) AS total_tickets,
          COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open_tickets,
          COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_tickets,
          COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved_tickets,
          COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed_tickets,
          COALESCE(SUM(CASE WHEN status IN ('open', 'in_progress') AND priority IN ('urgent', 'high') THEN 1 ELSE 0 END), 0) AS urgent_open_tickets,
          COALESCE(SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END), 0) AS priority_urgent,
          COALESCE(SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END), 0) AS priority_high,
          COALESCE(SUM(CASE WHEN priority = 'medium' THEN 1 ELSE 0 END), 0) AS priority_medium,
          COALESCE(SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END), 0) AS priority_low
        FROM support_tickets
      `),

      pool.query(`
        SELECT
          sp.id,
          sp.plan_name,
          sp.plan_code,
          sp.billing_cycle,
          sp.tier_rank,
          sp.price,
          COUNT(ss.id) AS total_subscribers,
          COALESCE(SUM(CASE WHEN ss.status = 'active' THEN 1 ELSE 0 END), 0) AS active_subscribers,
          COALESCE(SUM(CASE WHEN ss.payment_status = 'completed' THEN (CASE WHEN ss.payment_order_id IS NOT NULL THEN ss.plan_amount ELSE ss.amount_paid END) ELSE 0 END), 0) AS total_revenue
        FROM subscription_plans sp
        LEFT JOIN school_subscriptions ss ON ss.plan_id = sp.id AND ss.status != 'rejected'
        GROUP BY sp.id, sp.plan_name, sp.plan_code, sp.billing_cycle, sp.tier_rank, sp.price
        ORDER BY total_revenue DESC, total_subscribers DESC, sp.id ASC
      `),

      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COUNT(*) AS sub_count,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN (CASE WHEN payment_order_id IS NOT NULL THEN plan_amount ELSE amount_paid END) ELSE 0 END), 0) AS revenue
        FROM school_subscriptions
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') THEN total_amount ELSE 0 END), 0) AS revenue
        FROM school_storage_orders
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') THEN total_amount ELSE 0 END), 0) AS revenue
        FROM school_attendance_machines
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COALESCE(SUM(CASE WHEN order_status NOT IN ('cancelled', 'pending') THEN total_amount ELSE 0 END), 0) AS revenue
        FROM school_rfid_orders
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN total_amount ELSE 0 END), 0) AS revenue
        FROM school_notification_ledger
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COUNT(*) AS new_schools
        FROM school_master
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      pool.query(`
        SELECT 
          s.id, s.school_name, s.school_code, s.email, s.phone_number, s.status, s.created_at,
          ss.status AS subscription_status, ss.payment_status, sp.plan_name
        FROM school_master s
        LEFT JOIN school_subscriptions ss ON ss.id = (
          SELECT id FROM school_subscriptions
          WHERE school_id = s.id AND status NOT IN ('rejected', 'superseded')
          ORDER BY FIELD(status, 'active', 'trial', 'suspended', 'expired', 'pending'), id DESC
          LIMIT 1
        )
        LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
        ORDER BY s.id DESC
        LIMIT 5
      `),

      pool.query(`
        SELECT 
          ss.*, s.school_name, s.school_code, s.email AS school_email, sp.plan_name, sp.price AS plan_price
        FROM school_subscriptions ss
        JOIN school_master s ON ss.school_id = s.id
        LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
        WHERE ss.status = 'pending'
        ORDER BY ss.id DESC
        LIMIT 5
      `),

      pool.query(`
        SELECT
          st.id,
          st.ticket_number,
          st.subject,
          st.category,
          st.priority,
          st.status,
          st.created_at,
          s.school_name,
          s.school_code
        FROM support_tickets st
        LEFT JOIN school_master s ON st.school_id = s.id
        ORDER BY
          CASE WHEN st.status IN ('open', 'in_progress') THEN 0 ELSE 1 END ASC,
          st.id DESC
        LIMIT 5
      `),
    ]);

    const subscriptionRevenue = parseFloat(subRows[0]?.total_revenue || 0);
    const thisMonthSubscriptionRevenue = parseFloat(subRows[0]?.this_month_revenue || 0);
    const storageRevenue = parseFloat(storageOrderRows[0]?.total_revenue || 0);
    const thisMonthStorageRevenue = parseFloat(storageOrderRows[0]?.this_month_revenue || 0);
    const machineRevenue = parseFloat(machineOrderRows[0]?.total_revenue || 0);
    const thisMonthMachineRevenue = parseFloat(machineOrderRows[0]?.this_month_revenue || 0);
    const rfidRevenue = parseFloat(rfidOrderRows[0]?.total_revenue || 0);
    const thisMonthRfidRevenue = parseFloat(rfidOrderRows[0]?.this_month_revenue || 0);
    const notificationRevenue = parseFloat(notifCreditRows[0]?.total_revenue || 0);
    const thisMonthNotificationRevenue = parseFloat(notifCreditRows[0]?.this_month_revenue || 0);

    const addonRevenue = storageRevenue + machineRevenue + rfidRevenue + notificationRevenue;
    const totalPlatformRevenue = subscriptionRevenue + addonRevenue;
    const thisMonthPlatformRevenue =
      thisMonthSubscriptionRevenue +
      thisMonthStorageRevenue +
      thisMonthMachineRevenue +
      thisMonthRfidRevenue +
      thisMonthNotificationRevenue;

    const subByMonth = new Map(monthlySubRows.map((r) => [r.ym, r]));
    const storageByMonth = new Map(monthlyStorageRows.map((r) => [r.ym, r]));
    const machineByMonth = new Map(monthlyMachineRows.map((r) => [r.ym, r]));
    const rfidByMonth = new Map(monthlyRfidRows.map((r) => [r.ym, r]));
    const notifByMonth = new Map(monthlyNotifRows.map((r) => [r.ym, r]));
    const schoolByMonth = new Map(monthlySchoolRows.map((r) => [r.ym, r]));

    const monthlyTrends = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

      const subRev = parseFloat(subByMonth.get(ym)?.revenue || 0);
      const storRev = parseFloat(storageByMonth.get(ym)?.revenue || 0);
      const machRev = parseFloat(machineByMonth.get(ym)?.revenue || 0);
      const rfidRev = parseFloat(rfidByMonth.get(ym)?.revenue || 0);
      const notRev = parseFloat(notifByMonth.get(ym)?.revenue || 0);
      const addRev = storRev + machRev + rfidRev + notRev;

      monthlyTrends.push({
        monthKey: ym,
        label,
        subscriptionRevenue: subRev,
        addonRevenue: addRev,
        totalRevenue: subRev + addRev,
        newSchools: Number(schoolByMonth.get(ym)?.new_schools || 0),
        newSubscriptions: Number(subByMonth.get(ym)?.sub_count || 0),
      });
    }

    return {
      schools: {
        total: Number(schoolRows[0]?.total_schools || 0),
        active: Number(schoolRows[0]?.active_schools || 0),
        inactive: Number(schoolRows[0]?.inactive_schools || 0),
        thisMonth: Number(schoolRows[0]?.this_month_schools || 0),
      },
      subscriptions: {
        total: Number(subRows[0]?.total_subscriptions || 0),
        active: Number(subRows[0]?.active_subscriptions || 0),
        trial: Number(subRows[0]?.trial_subscriptions || 0),
        pending: Number(subRows[0]?.pending_subscriptions || 0),
        expired: Number(subRows[0]?.expired_subscriptions || 0),
        suspended: Number(subRows[0]?.suspended_subscriptions || 0),
        pendingPayments: Number(subRows[0]?.pending_payments || 0),
        totalRevenue: subscriptionRevenue,
        thisMonthRevenue: thisMonthSubscriptionRevenue,
        totalDiscount: parseFloat(subRows[0]?.total_discount || 0),
      },
      revenueSummary: {
        totalPlatformRevenue,
        thisMonthPlatformRevenue,
        subscriptionRevenue,
        addonRevenue,
        storageRevenue,
        machineRevenue,
        rfidRevenue,
        notificationRevenue,
      },
      addonBuyers: {
        storage: {
          totalOrders: Number(storageOrderRows[0]?.total_orders || 0),
          totalQuantity: Number(storageOrderRows[0]?.total_quantity || 0),
          totalRevenue: storageRevenue,
          pendingCount: Number(storageOrderRows[0]?.pending_count || 0),
          activeCount: Number(storageOrderRows[0]?.active_count || 0),
          expiredCount: Number(storageOrderRows[0]?.expired_count || 0),
          cancelledCount: Number(storageOrderRows[0]?.cancelled_count || 0),
        },
        attendanceMachines: {
          totalOrders: Number(machineOrderRows[0]?.total_orders || 0),
          totalQuantity: Number(machineOrderRows[0]?.total_quantity || 0),
          totalRevenue: machineRevenue,
          pendingCount: Number(machineOrderRows[0]?.pending_count || 0),
          approvedCount: Number(machineOrderRows[0]?.approved_count || 0),
          dispatchedCount: Number(machineOrderRows[0]?.dispatched_count || 0),
          deliveredCount: Number(machineOrderRows[0]?.delivered_count || 0),
          cancelledCount: Number(machineOrderRows[0]?.cancelled_count || 0),
        },
        rfidCards: {
          totalOrders: Number(rfidOrderRows[0]?.total_orders || 0),
          totalQuantity: Number(rfidOrderRows[0]?.total_quantity || 0),
          totalRevenue: rfidRevenue,
          pendingCount: Number(rfidOrderRows[0]?.pending_count || 0),
          approvedCount: Number(rfidOrderRows[0]?.approved_count || 0),
          dispatchedCount: Number(rfidOrderRows[0]?.dispatched_count || 0),
          deliveredCount: Number(rfidOrderRows[0]?.delivered_count || 0),
          cancelledCount: Number(rfidOrderRows[0]?.cancelled_count || 0),
        },
      },
      supportTickets: {
        total: Number(ticketSummaryRows[0]?.total_tickets || 0),
        open: Number(ticketSummaryRows[0]?.open_tickets || 0),
        inProgress: Number(ticketSummaryRows[0]?.in_progress_tickets || 0),
        resolved: Number(ticketSummaryRows[0]?.resolved_tickets || 0),
        closed: Number(ticketSummaryRows[0]?.closed_tickets || 0),
        urgentOpen: Number(ticketSummaryRows[0]?.urgent_open_tickets || 0),
        priorities: {
          urgent: Number(ticketSummaryRows[0]?.priority_urgent || 0),
          high: Number(ticketSummaryRows[0]?.priority_high || 0),
          medium: Number(ticketSummaryRows[0]?.priority_medium || 0),
          low: Number(ticketSummaryRows[0]?.priority_low || 0),
        },
      },
      planDistribution: planDistRows.map((p) => ({
        id: p.id,
        plan_name: p.plan_name,
        plan_code: p.plan_code,
        billing_cycle: p.billing_cycle,
        tier_rank: Number(p.tier_rank) || 1,
        price: parseFloat(p.price || 0),
        total_subscribers: Number(p.total_subscribers || 0),
        active_subscribers: Number(p.active_subscribers || 0),
        total_revenue: parseFloat(p.total_revenue || 0),
      })),
      monthlyTrends,
      packages: {
        total: Number(planRows[0]?.total_packages || 0),
        active: Number(planRows[0]?.active_packages || 0),
      },
      coupons: {
        total: Number(couponRows[0]?.total_coupons || 0),
        active: Number(couponRows[0]?.active_coupons || 0),
        totalUsages: Number(couponRows[0]?.total_usages || 0),
      },
      storagePlans: {
        total: Number(storageRows[0]?.total_storage || 0),
        active: Number(storageRows[0]?.active_storage || 0),
      },
      attendanceMachines: {
        total: Number(machineRows[0]?.total_machines || 0),
        active: Number(machineRows[0]?.active_machines || 0),
      },
      rfidCards: {
        total: Number(rfidRows[0]?.total_rfid || 0),
        active: Number(rfidRows[0]?.active_rfid || 0),
      },
      bankAccounts: {
        total: Number(bankRows[0]?.total_banks || 0),
        active: Number(bankRows[0]?.active_banks || 0),
      },
      recentSchools,
      pendingSubscriptions: pendingSubs,
      recentTickets,
    };
  }

  // ========================================================
  // 3. SCHOOL MANAGEMENT
  // ========================================================
  static async getSchools({ search = '', status = '', subscriptionStatus = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = [];
    const params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      whereConditions.push('s.status = ?');
      params.push(parseInt(status, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereConditions.push('(s.school_name LIKE ? OR s.school_code LIKE ? OR s.email LIKE ? OR s.phone_number LIKE ?)');
      params.push(term, term, term, term);
    }

    if (subscriptionStatus && subscriptionStatus !== 'all') {
      whereConditions.push('latest_sub.status = ?');
      params.push(subscriptionStatus);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Prioritize active/trial subscription over pending/rejected rows per school
    const prioritizedSubJoin = `
      LEFT JOIN school_subscriptions latest_sub ON latest_sub.id = (
        SELECT ss_inner.id
        FROM school_subscriptions ss_inner
        WHERE ss_inner.school_id = s.id
          AND ss_inner.status != 'superseded'
        ORDER BY FIELD(ss_inner.status, 'active', 'trial', 'suspended', 'expired', 'pending', 'rejected'), ss_inner.id DESC
        LIMIT 1
      )
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM school_master s
      ${prioritizedSubJoin}
      ${whereClause}
    `;

    const selectQuery = `
      SELECT 
        s.*,
        latest_sub.id AS current_subscription_id,
        latest_sub.plan_id,
        latest_sub.status AS subscription_status,
        latest_sub.payment_status,
        latest_sub.amount_paid,
        latest_sub.plan_amount,
        latest_sub.addons_amount,
        latest_sub.invoice_no,
        latest_sub.start_date AS subscription_start,
        latest_sub.end_date AS subscription_end,
        sp.plan_name,
        sp.billing_cycle,
        sp.tier_rank,
        (SELECT COUNT(*) FROM student_master sm WHERE sm.school_id = s.id AND sm.status != 4) AS student_count,
        (SELECT COUNT(*) FROM user_master um WHERE um.school_id = s.id AND um.role = 2 AND um.status = 1) AS teacher_count,
        (SELECT COUNT(*) FROM branch_master bm WHERE bm.school_id = s.id AND bm.status = 1) AS branch_count
      FROM school_master s
      ${prioritizedSubJoin}
      LEFT JOIN subscription_plans sp ON latest_sub.plan_id = sp.id
      ${whereClause}
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const queryParams = [...params, limitNum, offset];
    const [schools] = await pool.query(selectQuery, queryParams);

    return {
      schools,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  static async getSchoolById(id) {
    const [rows] = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM student_master sm WHERE sm.school_id = s.id AND sm.status != 4) AS total_students,
              (SELECT COUNT(*) FROM user_master um WHERE um.school_id = s.id AND um.role = 2 AND um.status = 1) AS total_teachers,
              (SELECT COUNT(*) FROM class_master cm WHERE cm.school_id = s.id AND cm.status = 1) AS total_classes,
              (SELECT COUNT(*) FROM branch_master bm WHERE bm.school_id = s.id AND bm.status = 1) AS total_branches
       FROM school_master s
       WHERE s.id = ? LIMIT 1`,
      [id]
    );

    if (rows.length === 0) return null;
    const school = rows[0];

    const [adminRows] = await pool.query(
      'SELECT id, first_name, last_name, email, phone, status, date AS created_at, date FROM user_master WHERE school_id = ? AND admin_type = 1 LIMIT 1',
      [id]
    );
    school.admin_user = adminRows[0] || null;

    const [branches] = await pool.query(
      'SELECT * FROM branch_master WHERE school_id = ? ORDER BY id ASC',
      [id]
    );
    school.branches = branches;

    const [subs] = await pool.query(
      `SELECT ss.*, sp.plan_name, sp.plan_code, sp.price AS plan_price, sp.billing_cycle, sp.tier_rank,
              c.code AS coupon_code, c.discount_type AS coupon_discount_type,
              CONCAT_WS(' ', sau.first_name, sau.last_name) AS verified_by_name
       FROM school_subscriptions ss
       LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
       LEFT JOIN coupons c ON ss.coupon_id = c.id
       LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
       WHERE ss.school_id = ?
       ORDER BY ss.id DESC`,
      [id]
    );
    school.subscriptions = subs;
    school.current_subscription =
      subs.find((r) => r.status === 'active' || r.status === 'trial') ||
      subs.find((r) => r.status !== 'rejected' && r.status !== 'superseded') ||
      subs[0] ||
      null;

    const [walletRows] = await pool.query(
      'SELECT * FROM school_notification_wallets WHERE school_id = ? LIMIT 1',
      [id]
    );
    school.notification_wallet = walletRows[0] || {
      sms_balance: 0,
      push_balance: 0,
      total_sms_purchased: 0,
      total_sms_used: 0,
      total_push_purchased: 0,
      total_push_used: 0,
    };

    const [auditLogs] = await pool.query(
      'SELECT * FROM subscription_audit_logs WHERE school_id = ? ORDER BY id DESC LIMIT 30',
      [id]
    );
    school.subscription_audit_logs = auditLogs || [];

    return school;
  }

  static async updateSchoolStatus(id, status) {
    const numStatus = parseInt(status, 10) === 1 ? 1 : 0;
    const [result] = await pool.query(
      'UPDATE school_master SET status = ?, updated_at = NOW() WHERE id = ?',
      [numStatus, id]
    );
    await pool.query(
      'UPDATE user_master SET status = ? WHERE school_id = ? AND admin_type = 1',
      [numStatus, id]
    );
    return result.affectedRows > 0;
  }

  static async updateSchool(id, data) {
    const allowed = [
      'school_name', 'school_code', 'phone_number', 'email', 'website',
      'address', 'postal_code', 'established_year', 'school_type',
      'affiliation_board', 'medium_of_instruction', 'status'
    ];

    const updates = [];
    const params = [];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key]);
      }
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE school_master SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 4. SUBSCRIPTION & PAYMENT VERIFICATION
  // ========================================================
  static async getSubscriptions({ search = '', status = '', paymentStatus = '', planId = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = [];
    const params = [];

    if (status && status !== 'all') {
      whereConditions.push('ss.status = ?');
      params.push(status);
    } else {
      // Hide historical superseded rows in default view unless explicitly filtered
      whereConditions.push("ss.status != 'superseded'");
    }

    if (paymentStatus && paymentStatus !== 'all') {
      whereConditions.push('ss.payment_status = ?');
      params.push(paymentStatus);
    }

    if (planId && planId !== 'all') {
      whereConditions.push('ss.plan_id = ?');
      params.push(parseInt(planId, 10));
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereConditions.push('(s.school_name LIKE ? OR s.school_code LIKE ? OR ss.payment_transaction_id LIKE ? OR ss.invoice_no LIKE ? OR c.code LIKE ?)');
      params.push(term, term, term, term, term);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
      LEFT JOIN coupons c ON ss.coupon_id = c.id
      ${whereClause}
    `;

    const selectQuery = `
      SELECT 
        ss.*,
        s.school_name,
        s.school_code,
        s.email AS school_email,
        s.phone_number AS school_phone,
        sp.plan_name,
        sp.plan_code,
        sp.tier_rank,
        sp.included_storage_gb,
        sp.price AS plan_price,
        sp.billing_cycle,
        o.order_no,
        c.code AS coupon_code,
        c.discount_type AS coupon_discount_type,
        CONCAT_WS(' ', sau.first_name, sau.last_name) AS verified_by_name
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
      LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
      LEFT JOIN subscription_payment_orders o ON ss.payment_order_id = o.id
      LEFT JOIN coupons c ON ss.coupon_id = c.id
      LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
      ${whereClause}
      ORDER BY FIELD(ss.status, 'pending', 'active', 'trial', 'expired', 'suspended', 'rejected', 'superseded'), ss.id DESC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const queryParams = [...params, limitNum, offset];
    const [subscriptions] = await pool.query(selectQuery, queryParams);

    const [countsResult] = await pool.query(`
      SELECT 
        SUM(CASE WHEN ss.status != 'superseded' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN ss.status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN ss.status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN ss.status = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN ss.status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
        SUM(CASE WHEN ss.status = 'trial' THEN 1 ELSE 0 END) AS trial,
        SUM(CASE WHEN ss.status = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
    `);
    const counts = countsResult[0] || {};

    return {
      subscriptions,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      counts: {
        total: Number(counts.total || 0),
        pending: Number(counts.pending || 0),
        active: Number(counts.active || 0),
        expired: Number(counts.expired || 0),
        suspended: Number(counts.suspended || 0),
        trial: Number(counts.trial || 0),
        rejected: Number(counts.rejected || 0),
      },
    };
  }

  static async getSubscriptionById(id) {
    const [rows] = await pool.query(
      `SELECT ss.*,
              s.school_name, s.school_code, s.email AS school_email, s.phone_number AS school_phone, s.address AS school_address,
              sp.plan_name, sp.plan_code, sp.tier_rank, sp.included_storage_gb, sp.price AS plan_price, sp.billing_cycle, sp.max_students,
              o.order_no,
              c.code AS coupon_code, c.discount_type AS coupon_discount_type, c.discount_value AS coupon_discount_val,
              CONCAT_WS(' ', sau.first_name, sau.last_name) AS verified_by_name
       FROM school_subscriptions ss
       JOIN school_master s ON ss.school_id = s.id
       LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
       LEFT JOIN subscription_payment_orders o ON ss.payment_order_id = o.id
       LEFT JOIN coupons c ON ss.coupon_id = c.id
       LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
       WHERE ss.id = ? LIMIT 1`,
      [id]
    );
    if (!rows[0]) return null;
    const sub = rows[0];

    if (sub.payment_order_id) {
      sub.order_details = await SubscriptionFulfillmentService.getOrderWithInvoice(sub.payment_order_id);
    } else {
      sub.order_details = null;
    }

    const [auditLogs] = await pool.query(
      'SELECT * FROM subscription_audit_logs WHERE subscription_id = ? OR (school_id = ? AND subscription_id IS NULL) ORDER BY id DESC LIMIT 20',
      [sub.id, sub.school_id]
    );
    sub.audit_logs = auditLogs || [];

    return sub;
  }

  /**
   * Approve a pending Offline Bank Transfer subscription (and atomically activate all bundled add-ons, SMS wallet, date stacking & Zero-GST Invoice)
   */
  static async approveSubscription(id, { verifiedBy = null, verificationNotes = '', startDate = null, endDate = null } = {}) {
    const [subRows] = await pool.query(
      `SELECT ss.*, sp.billing_cycle, sp.plan_name, sp.free_trial_days
       FROM school_subscriptions ss
       JOIN subscription_plans sp ON ss.plan_id = sp.id
       WHERE ss.id = ? LIMIT 1`,
      [id]
    );

    if (subRows.length === 0) {
      throw new Error('Subscription record not found.');
    }

    const sub = subRows[0];
    const schoolId = sub.school_id;
    const notes = verificationNotes || `Approved by Super Admin on ${getTodayIST()}`;

    if (sub.payment_order_id) {
      await SubscriptionFulfillmentService.fulfillPaidOrder({
        orderId: sub.payment_order_id,
        actorType: 'saas_super_admin',
        actorId: verifiedBy,
        verificationNotes: notes,
      });

      if (startDate || endDate) {
        const dateUpdates = [];
        const dateParams = [];
        if (startDate) {
          dateUpdates.push('start_date = ?');
          dateParams.push(startDate);
        }
        if (endDate) {
          dateUpdates.push('end_date = ?');
          dateParams.push(endDate);
        }
        dateParams.push(id);
        await pool.query(
          `UPDATE school_subscriptions SET ${dateUpdates.join(', ')} WHERE id = ?`,
          dateParams
        );
      }
    } else {
      // Legacy fallback for rows created prior to subscription_payment_orders
      const todayStr = getTodayIST();
      const startStr = startDate || todayStr;
      const endStr = endDate || addCycleDuration(startStr, sub.billing_cycle, sub.free_trial_days);

      await pool.query(
        "UPDATE school_subscriptions SET status = 'superseded', superseded_by_id = ? WHERE school_id = ? AND id != ? AND status IN ('active', 'trial')",
        [id, schoolId, id]
      );

      await pool.query(
        `UPDATE school_subscriptions SET
          status = 'active',
          payment_status = 'completed',
          start_date = ?,
          end_date = ?,
          verified_by = ?,
          verified_at = NOW(),
          verification_notes = ?
         WHERE id = ?`,
        [startStr, endStr, verifiedBy, notes, id]
      );

      if (sub.coupon_id && parseFloat(sub.discount_amount) > 0) {
        try {
          const [cuExists] = await pool.query('SELECT id FROM coupon_usages WHERE subscription_id = ? LIMIT 1', [id]);
          if (cuExists.length === 0) {
            await CouponModel.recordCouponUsage(sub.coupon_id, schoolId, id, sub.discount_amount);
          }
        } catch (_) {}
      }
    }

    await pool.query('UPDATE school_master SET status = 1, updated_at = NOW() WHERE id = ?', [schoolId]);
    await pool.query('UPDATE user_master SET status = 1 WHERE school_id = ? AND admin_type = 1', [schoolId]);

    return await this.getSubscriptionById(id);
  }

  /**
   * Reject a pending Offline Bank Transfer subscription without suspending any existing active subscription!
   */
  static async rejectSubscription(id, { verifiedBy = null, rejectionReason = '' } = {}) {
    await SubscriptionFulfillmentService.rejectOfflineSubscription({
      subscriptionId: id,
      adminId: verifiedBy,
      reason: rejectionReason,
    });
    return await this.getSubscriptionById(id);
  }

  static async verifySubscriptionPayment(id, { paymentStatus = 'completed', status = 'active', verificationNotes = '', verifiedBy = null, startDate = null, endDate = null }) {
    if (status === 'active' && paymentStatus === 'completed') {
      const approved = await this.approveSubscription(id, {
        verifiedBy,
        verificationNotes,
        startDate,
        endDate,
      });
      return Boolean(approved);
    }

    if (paymentStatus === 'failed' || status === 'rejected') {
      await this.rejectSubscription(id, {
        verifiedBy,
        rejectionReason: verificationNotes || 'Payment verification failed',
      });
      return true;
    }

    let query = `
      UPDATE school_subscriptions SET
        payment_status = ?,
        status = ?,
        verification_notes = ?,
        verified_by = ?,
        verified_at = NOW()
    `;
    const params = [paymentStatus, status, verificationNotes, verifiedBy];

    if (startDate) {
      query += ', start_date = ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ', end_date = ?';
      params.push(endDate);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  static async updateSubscriptionStatus(id, status, notes = '', verifiedBy = null) {
    const [rows] = await pool.query('SELECT school_id, end_date, status AS prev_status FROM school_subscriptions WHERE id = ?', [id]);
    const sub = rows[0] || null;
    if (!sub) return false;

    let query = 'UPDATE school_subscriptions SET status = ?';
    const params = [status];

    if (notes) {
      query += ', verification_notes = CONCAT(IFNULL(verification_notes, ""), "\n[Status Update] ", ?)';
      params.push(notes);
    }
    if (verifiedBy) {
      query += ', verified_by = ?, verified_at = NOW()';
      params.push(verifiedBy);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const [result] = await pool.query(query, params);

    if (result.affectedRows > 0) {
      if (status === 'active') {
        await pool.query(
          "UPDATE school_subscriptions SET status = 'superseded', superseded_by_id = ? WHERE school_id = ? AND id != ? AND status IN ('active', 'trial')",
          [id, sub.school_id, id]
        );
        await pool.query('UPDATE school_master SET status = 1, updated_at = NOW() WHERE id = ?', [sub.school_id]);
        await pool.query('UPDATE user_master SET status = 1 WHERE school_id = ? AND admin_type = 1', [sub.school_id]);
      } else if (status === 'suspended') {
        await pool.query(
          "UPDATE school_subscriptions SET status = 'suspended' WHERE school_id = ? AND id != ? AND status IN ('active', 'trial')",
          [sub.school_id, id]
        );
      }

      await pool.query(
        `INSERT INTO subscription_audit_logs
           (school_id, subscription_id, actor_type, actor_id, action, previous_state_json, new_state_json, reason)
         VALUES (?, ?, 'saas_super_admin', ?, 'STATUS_UPDATED', ?, ?, ?)`,
        [
          sub.school_id,
          id,
          verifiedBy || null,
          JSON.stringify({ status: sub.prev_status }),
          JSON.stringify({ status }),
          notes || `Status changed to ${status}`,
        ]
      );
    }

    return result.affectedRows > 0;
  }

  static async extendSubscription(id, { endDate, notes = '', verifiedBy = null }) {
    const [rows] = await pool.query('SELECT school_id, end_date, status FROM school_subscriptions WHERE id = ? LIMIT 1', [id]);
    const sub = rows[0] || null;
    if (!sub) return false;

    let query = 'UPDATE school_subscriptions SET end_date = ?, status = "active"';
    const params = [endDate];

    if (notes) {
      query += ', verification_notes = CONCAT(IFNULL(verification_notes, ""), "\n[Extension] ", ?)';
      params.push(notes);
    }
    if (verifiedBy) {
      query += ', verified_by = ?, verified_at = NOW()';
      params.push(verifiedBy);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const [result] = await pool.query(query, params);
    if (result.affectedRows > 0) {
      await pool.query(
        `INSERT INTO subscription_audit_logs
           (school_id, subscription_id, actor_type, actor_id, action, previous_state_json, new_state_json, reason)
         VALUES (?, ?, 'saas_super_admin', ?, 'EXPIRY_EXTENDED', ?, ?, ?)`,
        [
          sub.school_id,
          id,
          verifiedBy || null,
          JSON.stringify({ end_date: sub.end_date, status: sub.status }),
          JSON.stringify({ end_date: endDate, status: 'active' }),
          notes || `Extended to ${endDate}`,
        ]
      );
    }
    return result.affectedRows > 0;
  }

  /**
   * Super Admin Manual Plan Assignment / Enterprise Override
   */
  static async manualAssignPlan({ schoolId, planId, customEndDate = null, amountPaid = 0, reason = '', adminId = null }) {
    const assigned = await SubscriptionFulfillmentService.manualAssignPlan({
      schoolId,
      planId,
      customEndDate,
      amountPaid,
      reason: reason || 'Manual plan assignment by SaaS Super Admin',
      adminId,
    });

    await pool.query('UPDATE school_master SET status = 1, updated_at = NOW() WHERE id = ?', [schoolId]);
    await pool.query('UPDATE user_master SET status = 1 WHERE school_id = ? AND admin_type = 1', [schoolId]);

    return await this.getSubscriptionById(assigned.subscriptionId);
  }

  // ========================================================
  // 5. PACKAGE / SUBSCRIPTION PLAN MANAGEMENT
  // ========================================================
  static async getAllPackages({ search = '', status = '', billing_cycle = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    const conditions = [];
    const params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('status = ?');
      params.push(parseInt(status, 10));
    }

    if (billing_cycle && billing_cycle !== 'all') {
      conditions.push('billing_cycle = ?');
      params.push(billing_cycle.trim());
    }

    if (search && search.trim()) {
      conditions.push('(plan_name LIKE ? OR plan_code LIKE ? OR description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT sp.*,
             (SELECT COUNT(*) FROM school_subscriptions ss WHERE ss.plan_id = sp.id AND ss.status != 'rejected') AS subscriber_count,
             (SELECT COUNT(*) FROM subscription_items si WHERE si.sub_id = sp.id AND si.status = 1) AS items_count
      FROM subscription_plans sp
      ${where}
      ORDER BY sp.tier_rank ASC, sp.price ASC, sp.id ASC
      LIMIT ? OFFSET ?
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM subscription_plans sp ${where}`;

    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(query, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      SaasAdminModel.getPackageCounts(),
    ]);

    for (const pkg of rows) pkg.items = [];
    if (rows.length > 0) {
      const ids = rows.map((pkg) => pkg.id);
      const [items] = await pool.query(
        'SELECT * FROM subscription_items WHERE sub_id IN (?) ORDER BY FIELD(item_type, "module", "feature"), id ASC',
        [ids]
      );
      const itemsByPackage = new Map();
      for (const item of items) {
        const key = String(item.sub_id);
        if (!itemsByPackage.has(key)) itemsByPackage.set(key, []);
        itemsByPackage.get(key).push(item);
      }
      for (const pkg of rows) {
        pkg.items = itemsByPackage.get(String(pkg.id)) || [];
        enrichPackageRow(pkg);
      }
    }

    return {
      packages: rows,
      pagination: buildPagination(countRow.total, pageNum, pageSize),
      counts,
      meta: {
        billing_cycles: Object.values(BILLING_CYCLES),
      },
    };
  }

  static async getPackageCounts() {
    const [[[planRow]], [[itemRow]]] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active
        FROM subscription_plans
      `),
      pool.query(`
        SELECT
          COUNT(*) AS total_items,
          COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_items
        FROM subscription_items
      `),
    ]);
    const total = Number(planRow.total) || 0;
    const active = Number(planRow.active) || 0;
    return {
      total,
      active,
      inactive: total - active,
      total_items: Number(itemRow.total_items) || 0,
      active_items: Number(itemRow.active_items) || 0,
    };
  }

  static async getPackageById(id) {
    const [rows] = await pool.query(
      `SELECT sp.*,
              (SELECT COUNT(*) FROM school_subscriptions ss WHERE ss.plan_id = sp.id AND ss.status != 'rejected') AS subscriber_count
       FROM subscription_plans sp
       WHERE sp.id = ? LIMIT 1`,
      [id]
    );
    if (!rows[0]) return null;
    const pkg = rows[0];
    const [items] = await pool.query(
      'SELECT * FROM subscription_items WHERE sub_id = ? ORDER BY FIELD(item_type, "module", "feature"), id ASC',
      [id]
    );
    pkg.items = items || [];
    return enrichPackageRow(pkg);
  }

  static async createPackage({
    plan_name,
    plan_code,
    plan_group,
    tier_rank = 1,
    description,
    price,
    original_price = null,
    billing_cycle = 'annual',
    free_trial_days = 0,
    max_students = 0,
    included_storage_gb = 0,
    is_popular = 0,
    status = 1,
    items = [],
  }) {
    const normalizedCycle = BILLING_CYCLES[String(billing_cycle || 'annual').toLowerCase()]
      ? String(billing_cycle).toLowerCase()
      : 'annual';

    const cleanCode = (plan_code || plan_name.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim();
    const cleanGroup = (
      plan_group ||
      plan_name
        .toLowerCase()
        .replace(/\b(monthly|quarterly|half[\s_-]*yearly|annual|yearly|trial|plan|package)\b/gi, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') ||
      cleanCode
    ).trim();

    const parsedPrice = parseFloat(price) || 0;
    const rawOriginal =
      original_price !== null && original_price !== undefined && original_price !== ''
        ? parseFloat(original_price)
        : null;
    const normalizedOriginalPrice =
      rawOriginal !== null && !isNaN(rawOriginal) && rawOriginal > parsedPrice
        ? Number(rawOriginal.toFixed(2))
        : null;

    const mergedItems = normalizePlanItems(items);

    const [result] = await pool.query(
      `INSERT INTO subscription_plans
         (plan_name, plan_code, plan_group, tier_rank, description, price, original_price, billing_cycle, free_trial_days, max_students, max_teachers, included_storage_gb, is_popular, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW())`,
      [
        plan_name.trim(),
        cleanCode,
        cleanGroup,
        Math.max(1, parseInt(tier_rank, 10) || 1),
        description || '',
        parsedPrice,
        normalizedOriginalPrice,
        normalizedCycle,
        Math.max(0, parseInt(free_trial_days, 10) || 0),
        Math.max(0, parseInt(max_students, 10) || 0),
        Math.max(0, parseInt(included_storage_gb, 10) || 0),
        Number(is_popular) ? 1 : 0,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    const newId = result.insertId;

    if (mergedItems.length > 0) {
      await SubscriptionItemModel.syncItemsForPlan(newId, mergedItems);
    }

    return newId;
  }

  static async updatePackage(id, data = {}) {
    const {
      plan_name,
      plan_code,
      plan_group,
      tier_rank,
      description,
      price,
      original_price,
      billing_cycle,
      free_trial_days,
      max_students,
      included_storage_gb,
      is_popular,
      status,
      items,
    } = data;

    const updates = ['max_teachers = 0'];
    const params = [];

    if (plan_name !== undefined) { updates.push('plan_name = ?'); params.push(plan_name.trim()); }
    if (plan_code !== undefined) { updates.push('plan_code = ?'); params.push(plan_code.trim()); }
    if (plan_group !== undefined) { updates.push('plan_group = ?'); params.push(String(plan_group).trim()); }
    if (tier_rank !== undefined) { updates.push('tier_rank = ?'); params.push(Math.max(1, parseInt(tier_rank, 10) || 1)); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (price !== undefined) { updates.push('price = ?'); params.push(parseFloat(price) || 0); }
    if (original_price !== undefined) {
      let normalizedOriginal = null;
      if (original_price !== null && original_price !== '') {
        const parsedOrig = parseFloat(original_price);
        let comparePrice = price !== undefined ? parseFloat(price) || 0 : null;
        if (comparePrice === null) {
          const [[existingRow]] = await pool.query('SELECT price FROM subscription_plans WHERE id = ? LIMIT 1', [id]);
          comparePrice = parseFloat(existingRow?.price) || 0;
        }
        if (!isNaN(parsedOrig) && parsedOrig > comparePrice) {
          normalizedOriginal = Number(parsedOrig.toFixed(2));
        }
      }
      updates.push('original_price = ?');
      params.push(normalizedOriginal);
    }
    if (billing_cycle !== undefined) {
      const normalizedCycle = BILLING_CYCLES[String(billing_cycle).toLowerCase()]
        ? String(billing_cycle).toLowerCase()
        : 'annual';
      updates.push('billing_cycle = ?');
      params.push(normalizedCycle);
    }
    if (free_trial_days !== undefined) { updates.push('free_trial_days = ?'); params.push(Math.max(0, parseInt(free_trial_days, 10) || 0)); }
    if (max_students !== undefined) { updates.push('max_students = ?'); params.push(Math.max(0, parseInt(max_students, 10) || 0)); }
    if (included_storage_gb !== undefined) { updates.push('included_storage_gb = ?'); params.push(Math.max(0, parseInt(included_storage_gb, 10) || 0)); }
    if (is_popular !== undefined) { updates.push('is_popular = ?'); params.push(Number(is_popular) ? 1 : 0); }
    if (status !== undefined) { updates.push('status = ?'); params.push(parseInt(status, 10)); }

    const shouldSyncItems = items !== undefined;
    const mergedItemsToSync = shouldSyncItems ? normalizePlanItems(items) : [];

    if (updates.length > 0) {
      params.push(id);
      await pool.query(`UPDATE subscription_plans SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    if (shouldSyncItems) {
      await SubscriptionItemModel.syncItemsForPlan(id, mergedItemsToSync);
    }

    return true;
  }

  static async deletePackage(id) {
    const [inUse] = await pool.query('SELECT id FROM school_subscriptions WHERE plan_id = ? LIMIT 1', [id]);
    const [inOrders] = await pool.query('SELECT id FROM subscription_payment_orders WHERE plan_id = ? LIMIT 1', [id]);
    if (inUse.length > 0 || inOrders.length > 0) {
      const [res] = await pool.query('UPDATE subscription_plans SET status = 0 WHERE id = ?', [id]);
      return { softDeleted: true, affectedRows: res.affectedRows };
    }
    await pool.query('DELETE FROM subscription_items WHERE sub_id = ?', [id]);
    const [res] = await pool.query('DELETE FROM subscription_plans WHERE id = ?', [id]);
    return { hardDeleted: true, affectedRows: res.affectedRows };
  }

  static async togglePackageStatus(id, status) {
    const [result] = await pool.query('UPDATE subscription_plans SET status = ? WHERE id = ?', [parseInt(status, 10), id]);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 6. NOTIFICATION CREDIT PRICING SETTINGS
  // ========================================================
  static async getNotificationPricing() {
    const [rows] = await pool.query(
      'SELECT * FROM notification_pricing_master ORDER BY id ASC'
    );
    return rows || [];
  }

  static async updateNotificationPricing(items = []) {
    if (!Array.isArray(items)) return await this.getNotificationPricing();

    for (const entry of items) {
      const ch = String(entry.channel || '').toLowerCase();
      if (!['sms', 'push'].includes(ch)) continue;

      const unitPrice = Math.max(0, parseFloat(entry.unit_price) || 0);
      const minQty = Math.max(1, parseInt(entry.min_qty, 10) || 1);
      const packName = entry.pack_name ? String(entry.pack_name).trim() : (ch === 'sms' ? 'SMS Notification Credits' : 'Push Notification Credits');
      const desc = entry.description !== undefined ? String(entry.description || '') : null;
      const status = entry.status !== undefined ? (Number(entry.status) ? 1 : 0) : 1;

      await pool.query(
        `INSERT INTO notification_pricing_master (channel, pack_name, unit_price, min_qty, description, status)
         VALUES (?, ?, ?, ?, COALESCE(?, ''), ?)
         ON DUPLICATE KEY UPDATE
           pack_name = VALUES(pack_name),
           unit_price = VALUES(unit_price),
           min_qty = VALUES(min_qty),
           description = COALESCE(?, description),
           status = VALUES(status)`,
        [ch, packName, unitPrice, minQty, desc, status, desc]
      );
    }

    NotificationRecordModel.invalidateRateCache();
    return await this.getNotificationPricing();
  }

  // ========================================================
  // 7. COUPON MANAGEMENT (Delegates to CouponModel)
  // ========================================================
  static async getAllCoupons(options = {}) {
    return await CouponModel.getAll(options);
  }

  static async getCouponById(id) {
    return await CouponModel.getById(id);
  }

  static async createCoupon(data) {
    return await CouponModel.create(data);
  }

  static async updateCoupon(id, data) {
    return await CouponModel.update(id, data);
  }

  static async deleteCoupon(id) {
    return await CouponModel.delete(id);
  }

  static async toggleCouponStatus(id, status) {
    return await CouponModel.toggleStatus(id, status);
  }

  static async validateCoupon(code, orderAmount, schoolId = null, options = {}) {
    return await CouponModel.validateCoupon(code, orderAmount, schoolId, options);
  }

  static async recordCouponUsage(couponId, schoolId, subscriptionId, discountAmount) {
    return await CouponModel.recordCouponUsage(couponId, schoolId, subscriptionId, discountAmount);
  }
}

module.exports = SaasAdminModel;
