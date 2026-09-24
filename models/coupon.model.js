const { pool } = require('../config/db.config');

class CouponModel {
  /**
   * Fetch paginated list of coupons with optional search and filters
   * @param {Object} options
   * @param {string} options.search - Keyword search on code or description
   * @param {number|string} options.status - Filter by status (0, 1, or 'all')
   * @param {string} options.discount_type - Filter by discount type ('percentage', 'fixed')
   * @param {number|string} options.page - Page number (default: 1)
   * @param {number|string} options.limit - Records per page (default: 10)
   */
  static async getAll({ search = '', status = '', discount_type = '', page = 1, limit = 10 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    let conditions = [];
    let params = [];

    if (status !== '' && status !== undefined && status !== 'all') {
      conditions.push('c.status = ?');
      params.push(parseInt(status, 10));
    }

    if (discount_type && discount_type !== 'all') {
      conditions.push('c.discount_type = ?');
      params.push(discount_type.trim().toLowerCase());
    }

    if (search && search.trim()) {
      conditions.push('(c.code LIKE ? OR c.description LIKE ?)');
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query for total matching records
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM coupons c
      ${where}
    `;
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    // Data query with subqueries for redemptions and total discount given
    const selectQuery = `
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_redemptions,
        (SELECT IFNULL(SUM(discount_amount), 0.00) FROM coupon_usages cu WHERE cu.coupon_id = c.id) AS total_discount_given
      FROM coupons c
      ${where}
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?
    `;
    const queryParams = [...params, limitNum, offset];
    const [coupons] = await pool.query(selectQuery, queryParams);

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      coupons,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    };
  }

  /**
   * Get coupon details by ID with usage history
   */
  static async getById(id) {
    const [rows] = await pool.query('SELECT * FROM coupons WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) return null;
    const coupon = rows[0];

    // Get usage history with school details
    const [usages] = await pool.query(
      `SELECT 
        cu.*, 
        s.school_name, 
        s.school_code, 
        ss.payment_status
       FROM coupon_usages cu
       JOIN school_master s ON cu.school_id = s.id
       LEFT JOIN school_subscriptions ss ON cu.subscription_id = ss.id
       WHERE cu.coupon_id = ?
       ORDER BY cu.id DESC`,
      [id]
    );
    coupon.usages = usages;
    return coupon;
  }

  /**
   * Get coupon by code
   */
  static async getByCode(code) {
    if (!code) return null;
    const [rows] = await pool.query('SELECT * FROM coupons WHERE code = ? LIMIT 1', [
      code.trim().toUpperCase(),
    ]);
    return rows[0] || null;
  }

  /**
   * Create a new coupon
   */
  static async create({
    code,
    description = '',
    discount_type = 'percentage',
    discount_value,
    min_order_amount = 0,
    max_discount_amount = null,
    start_date = null,
    end_date = null,
    max_uses = null,
    status = 1,
  }) {
    const [result] = await pool.query(
      `INSERT INTO coupons 
       (code, description, discount_type, discount_value, min_order_amount, max_discount_amount, start_date, end_date, max_uses, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        code.toUpperCase().trim(),
        description || '',
        discount_type,
        parseFloat(discount_value) || 0,
        parseFloat(min_order_amount) || 0,
        max_discount_amount ? parseFloat(max_discount_amount) : null,
        start_date || null,
        end_date || null,
        max_uses ? parseInt(max_uses, 10) : null,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );
    return result.insertId;
  }

  /**
   * Update an existing coupon
   */
  static async update(id, data) {
    const updates = [];
    const params = [];

    if (data.code !== undefined) {
      updates.push('code = ?');
      params.push(data.code.toUpperCase().trim());
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (data.discount_type !== undefined) {
      updates.push('discount_type = ?');
      params.push(data.discount_type);
    }
    if (data.discount_value !== undefined) {
      updates.push('discount_value = ?');
      params.push(parseFloat(data.discount_value) || 0);
    }
    if (data.min_order_amount !== undefined) {
      updates.push('min_order_amount = ?');
      params.push(parseFloat(data.min_order_amount) || 0);
    }
    if (data.max_discount_amount !== undefined) {
      updates.push('max_discount_amount = ?');
      params.push(data.max_discount_amount ? parseFloat(data.max_discount_amount) : null);
    }
    if (data.start_date !== undefined) {
      updates.push('start_date = ?');
      params.push(data.start_date || null);
    }
    if (data.end_date !== undefined) {
      updates.push('end_date = ?');
      params.push(data.end_date || null);
    }
    if (data.max_uses !== undefined) {
      updates.push('max_uses = ?');
      params.push(data.max_uses ? parseInt(data.max_uses, 10) : null);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(parseInt(data.status, 10));
    }

    if (updates.length === 0) return false;

    params.push(id);
    const query = `UPDATE coupons SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    const [result] = await pool.query(query, params);
    return result.affectedRows > 0;
  }

  /**
   * Delete a coupon
   */
  static async delete(id) {
    const [result] = await pool.query('DELETE FROM coupons WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  /**
   * Toggle status
   */
  static async toggleStatus(id, status) {
    const [result] = await pool.query(
      'UPDATE coupons SET status = ?, updated_at = NOW() WHERE id = ?',
      [parseInt(status, 10), id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Validate coupon eligibility and compute discount
   */
  static async validateCoupon(code, orderAmount, schoolId = null) {
    if (!code || !String(code).trim()) {
      return { valid: false, message: 'Please provide a coupon code.' };
    }

    const cleanCode = String(code).trim().toUpperCase();
    const amount = parseFloat(orderAmount) || 0;

    const [rows] = await pool.query('SELECT * FROM coupons WHERE code = ? LIMIT 1', [cleanCode]);
    if (rows.length === 0) {
      return { valid: false, message: 'Invalid coupon code.' };
    }

    const coupon = rows[0];

    if (coupon.status !== 1) {
      return { valid: false, message: 'This coupon is no longer active.' };
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (coupon.start_date) {
      const startStr = typeof coupon.start_date === 'string' ? coupon.start_date.slice(0, 10) : coupon.start_date.toISOString().slice(0, 10);
      if (todayStr < startStr) {
        return { valid: false, message: 'This coupon is not valid yet.' };
      }
    }

    if (coupon.end_date) {
      const endStr = typeof coupon.end_date === 'string' ? coupon.end_date.slice(0, 10) : coupon.end_date.toISOString().slice(0, 10);
      if (todayStr > endStr) {
        return { valid: false, message: 'This coupon has expired.' };
      }
    }

    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
      return { valid: false, message: 'This coupon has reached its maximum usage limit.' };
    }

    if (coupon.min_order_amount && amount < parseFloat(coupon.min_order_amount)) {
      return {
        valid: false,
        message: `Minimum order amount of ₹${parseFloat(coupon.min_order_amount).toFixed(2)} is required to use this coupon.`,
      };
    }

    // Calculate discount amount
    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (amount * parseFloat(coupon.discount_value)) / 100;
      if (coupon.max_discount_amount && discount > parseFloat(coupon.max_discount_amount)) {
        discount = parseFloat(coupon.max_discount_amount);
      }
    } else {
      // Fixed discount
      discount = parseFloat(coupon.discount_value);
    }

    // Discount cannot exceed order amount
    if (discount > amount) {
      discount = amount;
    }

    discount = Math.round(discount * 100) / 100;
    const finalPayable = Math.max(0, Math.round((amount - discount) * 100) / 100);

    return {
      valid: true,
      message: 'Coupon applied successfully!',
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discount_type,
        discountValue: parseFloat(coupon.discount_value),
        discountAmount: discount,
        originalAmount: amount,
        finalAmount: finalPayable,
      },
    };
  }

  /**
   * Record coupon redemption and increment usage count
   */
  static async recordCouponUsage(couponId, schoolId, subscriptionId, discountAmount) {
    await pool.query(
      'INSERT INTO coupon_usages (coupon_id, school_id, subscription_id, discount_amount, used_at) VALUES (?, ?, ?, ?, NOW())',
      [couponId, schoolId, subscriptionId, parseFloat(discountAmount) || 0]
    );
    await pool.query(
      'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?',
      [couponId]
    );
  }
}

module.exports = CouponModel;
