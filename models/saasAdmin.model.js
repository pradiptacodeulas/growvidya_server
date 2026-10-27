const { pool } = require('../config/db.config');
const { hashPassword } = require('../utils/password.util');
const SubscriptionItemModel = require('./subscriptionItem.model');
const SaasRoleModel = require('./saasRole.model');
const CouponModel = require('./coupon.model');
const { parsePagination, buildPagination } = require('../utils/pagination.util');

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

    // Fetch permissions
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

    // Fetch permissions
    user.permissions = await SaasRoleModel.resolveEffectivePermissions(user);

    return user;
  }

  /**
   * Fetch all genders from gender_master
   */
  static async getGenders() {
    const [rows] = await pool.query(
      'SELECT id, gender, gender AS name FROM gender_master ORDER BY id ASC'
    );
    return rows;
  }

  static async updateProfile(id, { first_name, last_name, gender, gender_id, profile_image, phone_number, email, name }) {
    const updates = [];
    const params = [];

    // Fallback if client sends 'name' instead of first_name / last_name
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

    // Gender field stores the gender ID referencing gender_master(id)
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
  // 2. DASHBOARD & ANALYTICS
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
      [ticketSummaryRows],
      [planDistRows],
      [monthlySubRows],
      [monthlyStorageRows],
      [monthlyMachineRows],
      [monthlyRfidRows],
      [monthlySchoolRows],
      [recentSchools],
      [pendingSubs],
      [recentTickets],
    ] = await Promise.all([
      // 1. School counts
      pool.query(`
        SELECT 
          COUNT(*) AS total_schools,
          COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_schools,
          COALESCE(SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END), 0) AS inactive_schools,
          COALESCE(SUM(CASE WHEN YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN 1 ELSE 0 END), 0) AS this_month_schools
        FROM school_master
      `),

      // 2. Subscription & Payment counts
      pool.query(`
        SELECT 
          COUNT(*) AS total_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END), 0) AS trial_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expired_subscriptions,
          COALESCE(SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended_subscriptions,
          COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_payments,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN amount_paid ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN amount_paid ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN discount_amount ELSE 0 END), 0) AS total_discount
        FROM school_subscriptions
      `),

      // 3. Package count
      pool.query(`
        SELECT COUNT(*) AS total_packages, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_packages
        FROM subscription_plans
      `),

      // 4. Coupon count & usages
      pool.query(`
        SELECT 
          COUNT(*) AS total_coupons,
          COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_coupons,
          COALESCE(SUM(used_count), 0) AS total_usages
        FROM coupons
      `),

      // 5. Storage plans count
      pool.query(`
        SELECT COUNT(*) AS total_storage, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_storage
        FROM storage_master
      `),

      // 6. Attendance machines count
      pool.query(`
        SELECT COUNT(*) AS total_machines, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_machines
        FROM attendance_machine_master
      `),

      // 7. RFID cards count
      pool.query(`
        SELECT COUNT(*) AS total_rfid, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_rfid
        FROM rfid_card_master
      `),

      // 8. Bank accounts count
      pool.query(`
        SELECT COUNT(*) AS total_banks, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) AS active_banks
        FROM bank_account_master
      `),

      // 9. Storage buyer orders summary
      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(quantity), 0) AS total_quantity,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN order_status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
          COALESCE(SUM(CASE WHEN order_status = 'expired' THEN 1 ELSE 0 END), 0) AS expired_count,
          COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM school_storage_orders
      `),

      // 10. Attendance machine buyer orders summary
      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(quantity), 0) AS total_quantity,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN order_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN order_status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
          COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count,
          COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM school_attendance_machines
      `),

      // 11. RFID card buyer orders summary
      pool.query(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(quantity), 0) AS total_quantity,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS total_revenue,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
          COALESCE(SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN order_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN order_status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
          COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count,
          COALESCE(SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM school_rfid_orders
      `),

      // 12. Support tickets summary
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

      // 13. Plan-wise subscriber and revenue distribution
      pool.query(`
        SELECT
          sp.id,
          sp.plan_name,
          sp.plan_code,
          sp.billing_cycle,
          sp.price,
          COUNT(ss.id) AS total_subscribers,
          COALESCE(SUM(CASE WHEN ss.status = 'active' THEN 1 ELSE 0 END), 0) AS active_subscribers,
          COALESCE(SUM(CASE WHEN ss.payment_status = 'completed' THEN ss.amount_paid ELSE 0 END), 0) AS total_revenue
        FROM subscription_plans sp
        LEFT JOIN school_subscriptions ss ON ss.plan_id = sp.id
        GROUP BY sp.id, sp.plan_name, sp.plan_code, sp.billing_cycle, sp.price
        ORDER BY total_revenue DESC, total_subscribers DESC, sp.id ASC
      `),

      // 14. Monthly subscription revenue & count (last 6 months)
      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COUNT(*) AS sub_count,
          COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN amount_paid ELSE 0 END), 0) AS revenue
        FROM school_subscriptions
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      // 15. Monthly storage order revenue (last 6 months)
      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS revenue
        FROM school_storage_orders
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      // 16. Monthly attendance machine order revenue (last 6 months)
      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS revenue
        FROM school_attendance_machines
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      // 17. Monthly RFID order revenue (last 6 months)
      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COALESCE(SUM(CASE WHEN order_status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS revenue
        FROM school_rfid_orders
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      // 18. Monthly school registrations (last 6 months)
      pool.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m') AS ym,
          COUNT(*) AS new_schools
        FROM school_master
        WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      `),

      // 19. Recent registered schools (latest 5)
      pool.query(`
        SELECT 
          s.id, s.school_name, s.school_code, s.email, s.phone_number, s.status, s.created_at,
          ss.status AS subscription_status, ss.payment_status, sp.plan_name
        FROM school_master s
        LEFT JOIN school_subscriptions ss ON ss.id = (
          SELECT id FROM school_subscriptions WHERE school_id = s.id ORDER BY id DESC LIMIT 1
        )
        LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
        ORDER BY s.id DESC
        LIMIT 5
      `),

      // 20. Pending approval / payment subscriptions (latest 5)
      pool.query(`
        SELECT 
          ss.*, s.school_name, s.school_code, s.email AS school_email, sp.plan_name, sp.price AS plan_price
        FROM school_subscriptions ss
        JOIN school_master s ON ss.school_id = s.id
        LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
        WHERE ss.status = 'pending' OR ss.payment_status = 'pending'
        ORDER BY ss.id DESC
        LIMIT 5
      `),

      // 21. Recent open / in-progress support tickets (latest 5)
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

    const addonRevenue = storageRevenue + machineRevenue + rfidRevenue;
    const totalPlatformRevenue = subscriptionRevenue + addonRevenue;
    const thisMonthPlatformRevenue =
      thisMonthSubscriptionRevenue + thisMonthStorageRevenue + thisMonthMachineRevenue + thisMonthRfidRevenue;

    // Build chronological last 6 calendar months from real SQL rows
    const subByMonth = new Map(monthlySubRows.map((r) => [r.ym, r]));
    const storageByMonth = new Map(monthlyStorageRows.map((r) => [r.ym, r]));
    const machineByMonth = new Map(monthlyMachineRows.map((r) => [r.ym, r]));
    const rfidByMonth = new Map(monthlyRfidRows.map((r) => [r.ym, r]));
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
      const addRev = storRev + machRev + rfidRev;

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

    let whereConditions = [];
    let params = [];

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

    const countQuery = `
      SELECT COUNT(DISTINCT s.id) AS total
      FROM school_master s
      LEFT JOIN (
        SELECT ss1.* FROM school_subscriptions ss1
        INNER JOIN (
          SELECT school_id, MAX(id) AS max_id FROM school_subscriptions GROUP BY school_id
        ) ss2 ON ss1.id = ss2.max_id
      ) latest_sub ON s.id = latest_sub.school_id
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
        latest_sub.start_date AS subscription_start,
        latest_sub.end_date AS subscription_end,
        sp.plan_name,
        sp.billing_cycle,
        (SELECT COUNT(*) FROM student_master sm WHERE sm.school_id = s.id AND sm.status != 4) AS student_count,
        (SELECT COUNT(*) FROM user_master um WHERE um.school_id = s.id AND um.role = 2 AND um.status = 1) AS teacher_count,
        (SELECT COUNT(*) FROM branch_master bm WHERE bm.school_id = s.id AND bm.status = 1) AS branch_count
      FROM school_master s
      LEFT JOIN (
        SELECT ss1.* FROM school_subscriptions ss1
        INNER JOIN (
          SELECT school_id, MAX(id) AS max_id FROM school_subscriptions GROUP BY school_id
        ) ss2 ON ss1.id = ss2.max_id
      ) latest_sub ON s.id = latest_sub.school_id
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

    // Get school superadmin account
    const [adminRows] = await pool.query(
      'SELECT id, first_name, last_name, email, phone, status, date AS created_at, date FROM user_master WHERE school_id = ? AND admin_type = 1 LIMIT 1',
      [id]
    );
    school.admin_user = adminRows[0] || null;

    // Get branches
    const [branches] = await pool.query(
      'SELECT * FROM branch_master WHERE school_id = ? ORDER BY id ASC',
      [id]
    );
    school.branches = branches;

    // Get full subscription history
    const [subs] = await pool.query(
      `SELECT ss.*, sp.plan_name, sp.plan_code, sp.price AS plan_price, sp.billing_cycle,
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
    school.current_subscription = subs[0] || null;

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

    let whereConditions = [];
    let params = [];

    if (status && status !== 'all') {
      whereConditions.push('ss.status = ?');
      params.push(status);
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
      whereConditions.push('(s.school_name LIKE ? OR s.school_code LIKE ? OR ss.payment_transaction_id LIKE ? OR c.code LIKE ?)');
      params.push(term, term, term, term);
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
        sp.price AS plan_price,
        sp.billing_cycle,
        c.code AS coupon_code,
        c.discount_type AS coupon_discount_type,
        CONCAT_WS(' ', sau.first_name, sau.last_name) AS verified_by_name
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
      LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
      LEFT JOIN coupons c ON ss.coupon_id = c.id
      LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
      ${whereClause}
      ORDER BY ss.id DESC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    const queryParams = [...params, limitNum, offset];
    const [subscriptions] = await pool.query(selectQuery, queryParams);

    // Live status counts strictly from database
    const [countsResult] = await pool.query(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN ss.status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN ss.status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN ss.status = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN ss.status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
        SUM(CASE WHEN ss.status = 'trial' THEN 1 ELSE 0 END) AS trial
      FROM school_subscriptions ss
      JOIN school_master s ON ss.school_id = s.id
    `);
    const counts = countsResult[0] || { total: 0, pending: 0, active: 0, expired: 0, suspended: 0, trial: 0 };

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
      },
    };
  }

  static async getSubscriptionById(id) {
    const [rows] = await pool.query(
      `SELECT ss.*,
              s.school_name, s.school_code, s.email AS school_email, s.phone_number AS school_phone, s.address AS school_address,
              sp.plan_name, sp.plan_code, sp.price AS plan_price, sp.billing_cycle, sp.max_students,
              c.code AS coupon_code, c.discount_type AS coupon_discount_type, c.discount_value AS coupon_discount_val,
              CONCAT_WS(' ', sau.first_name, sau.last_name) AS verified_by_name
       FROM school_subscriptions ss
       JOIN school_master s ON ss.school_id = s.id
       LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
       LEFT JOIN coupons c ON ss.coupon_id = c.id
       LEFT JOIN saas_admin_users sau ON ss.verified_by = sau.id
       WHERE ss.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Approve a plan for a school.
   * Activates the subscription, sets start/end dates, activates school & admin user,
   * and expires any previous active subscription so the approved plan is now active.
   */
  static async approveSubscription(id, { verifiedBy = null, verificationNotes = '', startDate = null, endDate = null } = {}) {
    const [subRows] = await pool.query(
      `SELECT ss.*, sp.billing_cycle, sp.plan_name 
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

    // Determine start and end dates
    const effectiveStart = startDate ? new Date(startDate) : new Date();
    const effectiveEnd = endDate ? new Date(endDate) : new Date(effectiveStart);

    if (!endDate) {
      if (sub.billing_cycle === 'monthly') {
        effectiveEnd.setMonth(effectiveEnd.getMonth() + 1);
      } else if (sub.billing_cycle === 'trial') {
        effectiveEnd.setDate(effectiveEnd.getDate() + 14);
      } else {
        effectiveEnd.setFullYear(effectiveEnd.getFullYear() + 1);
      }
    }

    const startStr = effectiveStart.toISOString().split('T')[0];
    const endStr = effectiveEnd.toISOString().split('T')[0];
    const notes = verificationNotes || `Approved by Super Admin on ${new Date().toLocaleDateString()}`;

    // 1. Expire any OTHER active or trial subscriptions for this school
    await pool.query(
      "UPDATE school_subscriptions SET status = 'expired' WHERE school_id = ? AND id != ? AND status IN ('active', 'trial')",
      [schoolId, id]
    );

    // 2. Activate this subscription
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

    // 3. Ensure the school is active
    await pool.query('UPDATE school_master SET status = 1, updated_at = NOW() WHERE id = ?', [schoolId]);

    // 4. Ensure school superadmin user is active
    await pool.query('UPDATE user_master SET status = 1 WHERE school_id = ? AND admin_type = 1', [schoolId]);

    // 5. If coupon used, record usage
    if (sub.coupon_id && parseFloat(sub.discount_amount) > 0) {
      try {
        const CouponModel = require('./coupon.model');
        const [cuExists] = await pool.query('SELECT id FROM coupon_usages WHERE subscription_id = ? LIMIT 1', [id]);
        if (cuExists.length === 0) {
          await CouponModel.recordCouponUsage(sub.coupon_id, schoolId, id, sub.discount_amount);
        }
      } catch (cErr) {
        console.error('Failed to log coupon_usages on admin approval:', cErr.message);
      }
    }

    return await this.getSubscriptionById(id);
  }

  /**
   * Reject a pending subscription request
   */
  static async rejectSubscription(id, { verifiedBy = null, rejectionReason = '' } = {}) {
    const reason = rejectionReason || '';
    await pool.query(
      `UPDATE school_subscriptions SET
        status = 'suspended',
        payment_status = 'failed',
        verified_by = ?,
        verified_at = NOW(),
        verification_notes = CONCAT(IFNULL(verification_notes, ''), '\n[Rejected]: ', ?)
       WHERE id = ?`,
      [verifiedBy, reason, id]
    );
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
    let sub = null;
    if (status === 'active' || status === 'suspended') {
      const [rows] = await pool.query('SELECT school_id, end_date FROM school_subscriptions WHERE id = ?', [id]);
      sub = rows[0] || null;
    }

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

    if (result.affectedRows > 0 && sub) {
      if (status === 'active') {
        // Expire any other active or trial subscriptions for this school to prevent duplicates
        await pool.query(
          "UPDATE school_subscriptions SET status = 'expired' WHERE school_id = ? AND id != ? AND status IN ('active', 'trial')",
          [sub.school_id, id]
        );
        // Ensure school and admin user are active
        await pool.query('UPDATE school_master SET status = 1, updated_at = NOW() WHERE id = ?', [sub.school_id]);
        await pool.query('UPDATE user_master SET status = 1 WHERE school_id = ? AND admin_type = 1', [sub.school_id]);
      } else if (status === 'suspended') {
        // Suspend any other active or trial subscriptions for this school and mark school/admin inactive
        await pool.query(
          "UPDATE school_subscriptions SET status = 'suspended' WHERE school_id = ? AND id != ? AND status IN ('active', 'trial')",
          [sub.school_id, id]
        );
        await pool.query('UPDATE school_master SET status = 0, updated_at = NOW() WHERE id = ?', [sub.school_id]);
        await pool.query('UPDATE user_master SET status = 0 WHERE school_id = ? AND admin_type = 1', [sub.school_id]);
      }
    }

    return result.affectedRows > 0;
  }

  static async extendSubscription(id, { endDate, notes = '', verifiedBy = null }) {
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
    return result.affectedRows > 0;
  }

  // ========================================================
  // 5. PACKAGE / SUBSCRIPTION PLAN MANAGEMENT
  // ========================================================
  static async getAllPackages({ search = '', status = '', billing_cycle = '', page, limit } = {}) {
    const { page: pageNum, limit: pageSize, offset } = parsePagination({ page, limit });
    let conditions = [];
    let params = [];

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
             (SELECT COUNT(*) FROM school_subscriptions ss WHERE ss.plan_id = sp.id) AS subscriber_count,
             (SELECT COUNT(*) FROM subscription_items si WHERE si.sub_id = sp.id AND si.status = 1) AS items_count
      FROM subscription_plans sp
      ${where}
      ORDER BY sp.id ASC
      LIMIT ? OFFSET ?
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM subscription_plans sp ${where}`;

    const [[rows], [[countRow]], counts] = await Promise.all([
      pool.query(query, [...params, pageSize, offset]),
      pool.query(countQuery, params),
      SaasAdminModel.getPackageCounts(),
    ]);

    // Attach items for every package on this page with a single query (avoids N+1)
    for (const pkg of rows) pkg.items = [];
    if (rows.length > 0) {
      const ids = rows.map((pkg) => pkg.id);
      const [items] = await pool.query(
        'SELECT * FROM subscription_items WHERE sub_id IN (?) ORDER BY id ASC',
        [ids]
      );
      const itemsByPackage = new Map();
      for (const item of items) {
        const key = String(item.sub_id);
        if (!itemsByPackage.has(key)) itemsByPackage.set(key, []);
        itemsByPackage.get(key).push(item);
      }
      for (const pkg of rows) pkg.items = itemsByPackage.get(String(pkg.id)) || [];
    }

    return {
      packages: rows,
      pagination: buildPagination(countRow.total, pageNum, pageSize),
      counts,
    };
  }

  /**
   * Global (unfiltered) package + package item counts for summary metric cards
   */
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
              (SELECT COUNT(*) FROM school_subscriptions ss WHERE ss.plan_id = sp.id) AS subscriber_count
       FROM subscription_plans sp
       WHERE sp.id = ? LIMIT 1`,
      [id]
    );
    if (!rows[0]) return null;
    const pkg = rows[0];
    const [items] = await pool.query(
      'SELECT * FROM subscription_items WHERE sub_id = ? ORDER BY id ASC',
      [id]
    );
    pkg.items = items || [];
    return pkg;
  }

  static async createPackage({ plan_name, plan_code, description, price, billing_cycle = 'annual', free_trial_days = 0, max_students = 0, status = 1, items = [] }) {
    const [result] = await pool.query(
      `INSERT INTO subscription_plans (plan_name, plan_code, description, price, billing_cycle, free_trial_days, max_students, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        plan_name.trim(),
        (plan_code || plan_name.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim(),
        description || '',
        parseFloat(price) || 0,
        billing_cycle,
        parseInt(free_trial_days, 10) || 0,
        parseInt(max_students, 10) || 0,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    const newId = result.insertId;

    if (Array.isArray(items) && items.length > 0) {
      await SubscriptionItemModel.syncItemsForPlan(newId, items);
    }

    return newId;
  }

  static async updatePackage(id, { plan_name, plan_code, description, price, billing_cycle, free_trial_days, max_students, status, items }) {
    const updates = [];
    const params = [];

    if (plan_name !== undefined) { updates.push('plan_name = ?'); params.push(plan_name.trim()); }
    if (plan_code !== undefined) { updates.push('plan_code = ?'); params.push(plan_code.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (price !== undefined) { updates.push('price = ?'); params.push(parseFloat(price) || 0); }
    if (billing_cycle !== undefined) { updates.push('billing_cycle = ?'); params.push(billing_cycle); }
    if (free_trial_days !== undefined) { updates.push('free_trial_days = ?'); params.push(parseInt(free_trial_days, 10) || 0); }
    if (max_students !== undefined) { updates.push('max_students = ?'); params.push(parseInt(max_students, 10) || 0); }
    if (status !== undefined) { updates.push('status = ?'); params.push(parseInt(status, 10)); }

    if (updates.length > 0) {
      params.push(id);
      const query = `UPDATE subscription_plans SET ${updates.join(', ')} WHERE id = ?`;
      await pool.query(query, params);
    }

    if (items !== undefined && Array.isArray(items)) {
      await SubscriptionItemModel.syncItemsForPlan(id, items);
    }

    return true;
  }

  static async deletePackage(id) {
    // Check if in use by any subscription
    const [inUse] = await pool.query('SELECT id FROM school_subscriptions WHERE plan_id = ? LIMIT 1', [id]);
    if (inUse.length > 0) {
      // Soft-delete by setting status = 0
      const [res] = await pool.query('UPDATE subscription_plans SET status = 0 WHERE id = ?', [id]);
      return { softDeleted: true, affectedRows: res.affectedRows };
    }
    const [res] = await pool.query('DELETE FROM subscription_plans WHERE id = ?', [id]);
    return { hardDeleted: true, affectedRows: res.affectedRows };
  }

  static async togglePackageStatus(id, status) {
    const [result] = await pool.query('UPDATE subscription_plans SET status = ? WHERE id = ?', [parseInt(status, 10), id]);
    return result.affectedRows > 0;
  }

  // ========================================================
  // 6. COUPON MANAGEMENT (Delegates to CouponModel)
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

  // ========================================================
  // 7. COUPON VALIDATION & USAGE ENGINE
  // ========================================================
  static async validateCoupon(code, orderAmount, schoolId = null) {
    return await CouponModel.validateCoupon(code, orderAmount, schoolId);
  }

  static async recordCouponUsage(couponId, schoolId, subscriptionId, discountAmount) {
    return await CouponModel.recordCouponUsage(couponId, schoolId, subscriptionId, discountAmount);
  }
}

module.exports = SaasAdminModel;
