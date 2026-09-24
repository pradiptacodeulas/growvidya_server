const CouponModel = require('../models/coupon.model');
const ApiResponse = require('../utils/api.response');

class CouponController {
  /**
   * GET /coupons
   * List paginated coupons with optional query filters
   * Query params: page, limit, search, status, discount_type
   */
  static async getCoupons(req, res, next) {
    try {
      const { search, status, discount_type, discountType, page, limit, id, coupon_id, couponId } = req.query;

      // If specific coupon id is provided in query or body, delegate to getCouponById
      const targetId = id || coupon_id || couponId || req.body?.id || req.body?.coupon_id;
      if (targetId && targetId !== ':id') {
        req.params.id = targetId;
        return CouponController.getCouponById(req, res, next);
      }

      const result = await CouponModel.getAll({
        search,
        status,
        discount_type: discount_type || discountType,
        page,
        limit,
      });

      return ApiResponse.success(res, 'Coupons retrieved successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /coupons/:id
   * Get single coupon with redemption history
   */
  static async getCouponById(req, res, next) {
    try {
      let { id } = req.params;

      // Fallback if id was passed as query or body parameter, or literal placeholder ':id'
      if (!id || id === ':id' || String(id).trim() === '') {
        id = req.query?.id || req.query?.coupon_id || req.query?.couponId || req.body?.id || req.body?.coupon_id;
      }

      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.badRequest(res, 'Coupon ID is required.');
      }

      const trimmedId = String(id).trim();
      let coupon = null;
      if (/^\d+$/.test(trimmedId)) {
        coupon = await CouponModel.getById(Number(trimmedId));
      } else {
        coupon = await CouponModel.getByCode(trimmedId);
        if (coupon && coupon.id) {
          coupon = await CouponModel.getById(coupon.id);
        }
      }

      if (!coupon) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }
      return ApiResponse.success(res, 'Coupon details fetched successfully.', coupon);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /coupons
   * Create a new coupon
   */
  static async createCoupon(req, res, next) {
    try {
      const {
        code,
        description,
        discount_type,
        discountType,
        discount_value,
        discountValue,
        min_order_amount,
        minOrderAmount,
        max_discount_amount,
        maxDiscountAmount,
        start_date,
        startDate,
        end_date,
        endDate,
        max_uses,
        maxUses,
        status,
      } = req.body;

      if (!code || !code.trim()) {
        return ApiResponse.badRequest(res, 'Coupon code is required.');
      }

      const discType = discount_type || discountType || 'percentage';
      if (discType !== 'percentage' && discType !== 'fixed') {
        return ApiResponse.badRequest(res, "discount_type must be either 'percentage' or 'fixed'.");
      }

      const discVal = discount_value !== undefined ? discount_value : discountValue;
      if (discVal === undefined || isNaN(discVal) || parseFloat(discVal) <= 0) {
        return ApiResponse.badRequest(res, 'A valid positive discount value is required.');
      }

      if (discType === 'percentage' && parseFloat(discVal) > 100) {
        return ApiResponse.badRequest(res, 'Percentage discount cannot exceed 100%.');
      }

      // Check for code uniqueness
      const existing = await CouponModel.getByCode(code);
      if (existing) {
        return ApiResponse.badRequest(res, `A coupon with code "${code.trim().toUpperCase()}" already exists.`);
      }

      const newId = await CouponModel.create({
        code,
        description: description || '',
        discount_type: discType,
        discount_value: discVal,
        min_order_amount: min_order_amount !== undefined ? min_order_amount : minOrderAmount,
        max_discount_amount: max_discount_amount !== undefined ? max_discount_amount : maxDiscountAmount,
        start_date: start_date || startDate,
        end_date: end_date || endDate,
        max_uses: max_uses !== undefined ? max_uses : maxUses,
        status: status !== undefined ? status : 1,
      });

      const created = await CouponModel.getById(newId);
      return ApiResponse.created(res, 'Coupon created successfully.', created);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /coupons/:id
   * Update an existing coupon
   */
  static async updateCoupon(req, res, next) {
    try {
      let { id } = req.params;
      if (!id || id === ':id' || String(id).trim() === '') {
        id = req.query?.id || req.query?.coupon_id || req.query?.couponId || req.body?.id || req.body?.coupon_id;
      }
      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.badRequest(res, 'Coupon ID is required.');
      }

      const existing = await CouponModel.getById(id);
      if (!existing) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }

      const {
        code,
        description,
        discount_type,
        discountType,
        discount_value,
        discountValue,
        min_order_amount,
        minOrderAmount,
        max_discount_amount,
        maxDiscountAmount,
        start_date,
        startDate,
        end_date,
        endDate,
        max_uses,
        maxUses,
        status,
      } = req.body;

      if (code && code.trim().toUpperCase() !== existing.code) {
        const duplicate = await CouponModel.getByCode(code);
        if (duplicate) {
          return ApiResponse.badRequest(res, `A coupon with code "${code.trim().toUpperCase()}" already exists.`);
        }
      }

      const updateData = {};
      if (code !== undefined) updateData.code = code;
      if (description !== undefined) updateData.description = description;
      if (discount_type !== undefined || discountType !== undefined) {
        updateData.discount_type = discount_type || discountType;
      }
      if (discount_value !== undefined || discountValue !== undefined) {
        updateData.discount_value = discount_value !== undefined ? discount_value : discountValue;
      }
      if (min_order_amount !== undefined || minOrderAmount !== undefined) {
        updateData.min_order_amount = min_order_amount !== undefined ? min_order_amount : minOrderAmount;
      }
      if (max_discount_amount !== undefined || maxDiscountAmount !== undefined) {
        updateData.max_discount_amount = max_discount_amount !== undefined ? max_discount_amount : maxDiscountAmount;
      }
      if (start_date !== undefined || startDate !== undefined) {
        updateData.start_date = start_date || startDate;
      }
      if (end_date !== undefined || endDate !== undefined) {
        updateData.end_date = end_date || endDate;
      }
      if (max_uses !== undefined || maxUses !== undefined) {
        updateData.max_uses = max_uses !== undefined ? max_uses : maxUses;
      }
      if (status !== undefined) updateData.status = status;

      const success = await CouponModel.update(id, updateData);
      if (!success) {
        return ApiResponse.badRequest(res, 'No changes made or update failed.');
      }

      const updated = await CouponModel.getById(id);
      return ApiResponse.success(res, 'Coupon updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /coupons/:id
   * Delete a coupon
   */
  static async deleteCoupon(req, res, next) {
    try {
      let { id } = req.params;
      if (!id || id === ':id' || String(id).trim() === '') {
        id = req.query?.id || req.query?.coupon_id || req.query?.couponId || req.body?.id || req.body?.coupon_id;
      }
      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.badRequest(res, 'Coupon ID is required.');
      }

      const existing = await CouponModel.getById(id);
      if (!existing) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }

      await CouponModel.delete(id);
      return ApiResponse.success(res, 'Coupon deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /coupons/:id/status
   * Toggle active/inactive status
   */
  static async toggleStatus(req, res, next) {
    try {
      let { id } = req.params;
      if (!id || id === ':id' || String(id).trim() === '') {
        id = req.query?.id || req.query?.coupon_id || req.query?.couponId || req.body?.id || req.body?.coupon_id;
      }
      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.badRequest(res, 'Coupon ID is required.');
      }

      const { status } = req.body;

      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.badRequest(res, 'Status must be 0 (inactive) or 1 (active).');
      }

      const success = await CouponModel.toggleStatus(id, status);
      if (!success) {
        return ApiResponse.notFound(res, 'Coupon not found.');
      }

      return ApiResponse.success(
        res,
        `Coupon ${parseInt(status, 10) === 1 ? 'activated' : 'deactivated'} successfully.`
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /coupons/validate
   * Validate a coupon against an order amount
   */
  static async validateCoupon(req, res, next) {
    try {
      const { code, order_amount, orderAmount } = req.body;
      const amount = order_amount !== undefined ? order_amount : orderAmount;

      const result = await CouponModel.validateCoupon(code, amount);
      if (!result.valid) {
        return ApiResponse.badRequest(res, result.message);
      }

      return ApiResponse.success(res, result.message, result.coupon);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = CouponController;
