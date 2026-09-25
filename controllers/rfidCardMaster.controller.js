const RfidCardMasterModel = require('../models/rfidCardMaster.model');
const ApiResponse = require('../utils/api.response');

class RfidCardMasterController {
  /**
   * GET /rfid-cards
   * List all RFID cards (supports ?search=, ?status=, ?card_type=)
   */
  static async getAll(req, res, next) {
    try {
      const { search, status, card_type, id, card_id } = req.query;

      const targetId = id || card_id;
      if (targetId && targetId !== ':id') {
        req.params.id = targetId;
        return RfidCardMasterController.getById(req, res, next);
      }

      const cards = await RfidCardMasterModel.getAll({ search, status, card_type });
      return ApiResponse.success(res, 'RFID cards retrieved successfully.', cards);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /rfid-cards/active
   * List active RFID cards
   */
  static async getActive(req, res, next) {
    try {
      const cards = await RfidCardMasterModel.getActive();
      return ApiResponse.success(res, 'Active RFID cards retrieved successfully.', cards);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /rfid-cards/:id
   * Get single RFID card by ID or code
   */
  static async getById(req, res, next) {
    try {
      let { id } = req.params;

      if (!id || id === ':id' || String(id).trim() === '') {
        id = req.query?.id || req.body?.id;
      }

      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.badRequest(res, 'RFID card ID is required.');
      }

      const trimmedId = String(id).trim();
      let card = null;

      if (/^\d+$/.test(trimmedId)) {
        card = await RfidCardMasterModel.getById(Number(trimmedId));
      } else {
        card = await RfidCardMasterModel.getByCode(trimmedId);
      }

      if (!card) {
        return ApiResponse.notFound(res, 'RFID card not found.');
      }

      return ApiResponse.success(res, 'RFID card fetched successfully.', card);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /rfid-cards
   * Create a new RFID Card item
   */
  static async create(req, res, next) {
    try {
      const {
        card_name,
        cardName,
        card_code,
        cardCode,
        card_type,
        cardType,
        frequency,
        read_range,
        readRange,
        unit_price,
        unitPrice,
        min_order_qty,
        minOrderQty,
        card_image,
        cardImage,
        description,
        status,
      } = req.body;

      const name = card_name || cardName;
      const code = card_code || cardCode;
      const type = card_type || cardType || 'pvc_card';
      const freq = frequency;
      const range = read_range || readRange;
      const price = unit_price !== undefined ? unit_price : unitPrice;
      const moq = min_order_qty !== undefined ? min_order_qty : minOrderQty;
      const image = card_image || cardImage;

      if (!name || !name.trim()) {
        return ApiResponse.badRequest(res, 'Card name is required.');
      }

      if (!code || !code.trim()) {
        return ApiResponse.badRequest(res, 'Card code / SKU is required.');
      }

      // Check unique card code
      const existing = await RfidCardMasterModel.getByCode(code);
      if (existing) {
        return ApiResponse.badRequest(res, `A card with code "${code.trim().toUpperCase()}" already exists.`);
      }

      if (price === undefined || price === null || isNaN(price) || parseFloat(price) < 0) {
        return ApiResponse.badRequest(res, 'A valid unit price is required.');
      }

      const newId = await RfidCardMasterModel.create({
        card_name: name,
        card_code: code,
        card_type: type,
        frequency: freq,
        read_range: range,
        unit_price: price,
        min_order_qty: moq !== undefined ? moq : 1,
        card_image: image,
        description: description || '',
        status: status !== undefined ? status : 1,
      });

      const newCard = await RfidCardMasterModel.getById(newId);
      return ApiResponse.created(res, 'RFID card created successfully.', newCard);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /rfid-cards/:id
   * Update an RFID Card item
   */
  static async update(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || !/^\d+$/.test(id)) {
        return ApiResponse.badRequest(res, 'Valid RFID card ID is required.');
      }

      const existing = await RfidCardMasterModel.getById(Number(id));
      if (!existing) {
        return ApiResponse.notFound(res, 'RFID card not found.');
      }

      const {
        card_name,
        cardName,
        card_code,
        cardCode,
        card_type,
        cardType,
        frequency,
        read_range,
        readRange,
        unit_price,
        unitPrice,
        min_order_qty,
        minOrderQty,
        card_image,
        cardImage,
        description,
        status,
      } = req.body;

      const updateData = {};

      if (card_name !== undefined || cardName !== undefined) {
        const val = card_name !== undefined ? card_name : cardName;
        if (!val || !val.trim()) return ApiResponse.badRequest(res, 'Card name cannot be empty.');
        updateData.card_name = val;
      }

      if (card_code !== undefined || cardCode !== undefined) {
        const val = card_code !== undefined ? card_code : cardCode;
        if (!val || !val.trim()) return ApiResponse.badRequest(res, 'Card code cannot be empty.');
        // Verify not duplicate of another card
        const duplicate = await RfidCardMasterModel.getByCode(val);
        if (duplicate && duplicate.id !== Number(id)) {
          return ApiResponse.badRequest(res, `Another card with code "${val.trim().toUpperCase()}" already exists.`);
        }
        updateData.card_code = val;
      }

      if (card_type !== undefined || cardType !== undefined) {
        updateData.card_type = card_type !== undefined ? card_type : cardType;
      }

      if (frequency !== undefined) {
        updateData.frequency = frequency;
      }

      if (read_range !== undefined || readRange !== undefined) {
        updateData.read_range = read_range !== undefined ? read_range : readRange;
      }

      if (unit_price !== undefined || unitPrice !== undefined) {
        const val = unit_price !== undefined ? unit_price : unitPrice;
        if (isNaN(val) || parseFloat(val) < 0) return ApiResponse.badRequest(res, 'Valid unit price is required.');
        updateData.unit_price = val;
      }

      if (min_order_qty !== undefined || minOrderQty !== undefined) {
        updateData.min_order_qty = min_order_qty !== undefined ? min_order_qty : minOrderQty;
      }

      if (card_image !== undefined || cardImage !== undefined) {
        updateData.card_image = card_image !== undefined ? card_image : cardImage;
      }

      if (description !== undefined) {
        updateData.description = description;
      }

      if (status !== undefined) {
        updateData.status = status;
      }

      await RfidCardMasterModel.update(Number(id), updateData);
      const updatedCard = await RfidCardMasterModel.getById(Number(id));
      return ApiResponse.success(res, 'RFID card updated successfully.', updatedCard);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /rfid-cards/:id
   * Delete an RFID Card
   */
  static async delete(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || !/^\d+$/.test(id)) {
        return ApiResponse.badRequest(res, 'Valid RFID card ID is required.');
      }

      const existing = await RfidCardMasterModel.getById(Number(id));
      if (!existing) {
        return ApiResponse.notFound(res, 'RFID card not found.');
      }

      await RfidCardMasterModel.delete(Number(id));
      return ApiResponse.success(res, 'RFID card deleted successfully.');
    } catch (error) {
      if (error.message.includes('associated with it')) {
        return ApiResponse.badRequest(res, error.message);
      }
      next(error);
    }
  }

  /**
   * PATCH /rfid-cards/:id/status
   * Toggle active/inactive status
   */
  static async toggleStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!id || !/^\d+$/.test(id)) {
        return ApiResponse.badRequest(res, 'Valid RFID card ID is required.');
      }

      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.badRequest(res, 'Status must be 0 (inactive) or 1 (active).');
      }

      const existing = await RfidCardMasterModel.getById(Number(id));
      if (!existing) {
        return ApiResponse.notFound(res, 'RFID card not found.');
      }

      await RfidCardMasterModel.toggleStatus(Number(id), status);
      return ApiResponse.success(res, `RFID card status changed to ${status == 1 ? 'active' : 'inactive'}.`);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = RfidCardMasterController;
