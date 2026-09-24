const StorageMasterModel = require('../models/storageMaster.model');
const CapacityUnitMasterModel = require('../models/capacityUnitMaster.model');
const ApiResponse = require('../utils/api.response');

class StorageMasterController {
  /**
   * GET /storage-plans
   * List all storage plans (supports ?search= and ?status=)
   */
  static async getAll(req, res, next) {
    try {
      const { search, status, id, plan_id, planId } = req.query;

      // If specific storage plan ID is provided in query, body, or header, delegate to getById
      const targetId = id || plan_id || planId || req.body?.id || req.body?.plan_id || req.headers['x-storage-plan-id'];
      if (targetId && targetId !== ':id') {
        req.params.id = targetId;
        return StorageMasterController.getById(req, res, next);
      }

      const plans = await StorageMasterModel.getAll({ search, status });
      return ApiResponse.success(res, 'Storage plans retrieved successfully.', plans);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /storage-plans/active
   * List only active storage plans (for schools/pricing display)
   */
  static async getActive(req, res, next) {
    try {
      const { id, plan_id, planId } = req.query;

      // If specific storage plan ID is provided in query, body, or header, delegate to getById
      const targetId = id || plan_id || planId || req.body?.id || req.body?.plan_id || req.headers['x-storage-plan-id'];
      if (targetId && targetId !== ':id') {
        req.params.id = targetId;
        return StorageMasterController.getById(req, res, next);
      }

      const plans = await StorageMasterModel.getActivePlans();
      return ApiResponse.success(res, 'Active storage plans retrieved successfully.', plans);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /storage-plans/units (or /capacity-units)
   * List available capacity units (MB, GB, TB, etc.)
   */
  static async getCapacityUnits(req, res, next) {
    try {
      const units = await CapacityUnitMasterModel.getActive();
      return ApiResponse.success(res, 'Capacity units retrieved successfully.', units);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /storage-plans/:id
   * Get single storage plan by ID
   */
  static async getById(req, res, next) {
    try {
      let { id } = req.params;

      // Fallback if id was passed as query or body parameter, or literal placeholder ':id'
      if (!id || id === ':id' || String(id).trim() === '') {
        id =
          req.query?.id ||
          req.query?.plan_id ||
          req.query?.planId ||
          req.body?.id ||
          req.body?.plan_id ||
          req.headers['x-storage-plan-id'];
      }

      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.error(res, 'Storage plan ID is required.', null, 400);
      }

      const trimmedId = String(id).trim();
      let plan = null;
      if (/^\d+$/.test(trimmedId)) {
        plan = await StorageMasterModel.getById(Number(trimmedId));
      } else {
        // Fallback for lookup by code
        plan = await StorageMasterModel.getByCode(trimmedId);
        if (plan && plan.id) {
          plan = await StorageMasterModel.getById(plan.id);
        }
      }

      if (!plan) {
        return ApiResponse.notFound(res, 'Storage plan not found.');
      }
      return ApiResponse.success(res, 'Storage plan fetched successfully.', plan);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /storage-plans
   * Create a new storage plan
   */
  static async create(req, res, next) {
    try {
      const {
        plan_name,
        planName,
        storage_capacity,
        storageCapacity,
        capacity_unit_id,
        capacityUnitId,
        capacity_unit,
        capacityUnit,
        monthly_price,
        monthlyPrice,
        annual_price,
        annualPrice,
        description,
        status,
      } = req.body;

      const name = plan_name || planName;
      const capacity = storage_capacity !== undefined ? storage_capacity : storageCapacity;
      const unitIdOrCode = capacity_unit_id || capacityUnitId || capacity_unit || capacityUnit;
      const mPrice = monthly_price !== undefined ? monthly_price : monthlyPrice;
      const aPrice = annual_price !== undefined ? annual_price : annualPrice;

      if (!name || !name.trim()) {
        return ApiResponse.badRequest(res, 'Plan name is required.');
      }

      if (capacity === undefined || capacity === null || isNaN(capacity) || parseInt(capacity, 10) <= 0) {
        return ApiResponse.badRequest(res, 'A valid positive storage capacity is required.');
      }

      if (mPrice === undefined || mPrice === null || isNaN(mPrice) || parseFloat(mPrice) < 0) {
        return ApiResponse.badRequest(res, 'A valid monthly price is required.');
      }

      if (aPrice === undefined || aPrice === null || isNaN(aPrice) || parseFloat(aPrice) < 0) {
        return ApiResponse.badRequest(res, 'A valid annual price is required.');
      }

      const resolvedUnitId = await StorageMasterModel.resolveUnitId(unitIdOrCode);

      const newId = await StorageMasterModel.create({
        plan_name: name,
        storage_capacity: capacity,
        capacity_unit_id: resolvedUnitId,
        monthly_price: mPrice,
        annual_price: aPrice,
        description: description || '',
        status: status !== undefined ? status : 1,
      });

      const newPlan = await StorageMasterModel.getById(newId);
      return ApiResponse.created(res, 'Storage plan created successfully.', newPlan);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /storage-plans/:id
   * Update an existing storage plan
   */
  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await StorageMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.notFound(res, 'Storage plan not found.');
      }

      const {
        plan_name,
        planName,
        storage_capacity,
        storageCapacity,
        capacity_unit_id,
        capacityUnitId,
        capacity_unit,
        capacityUnit,
        monthly_price,
        monthlyPrice,
        annual_price,
        annualPrice,
        description,
        status,
      } = req.body;

      const updateData = {};
      if (plan_name !== undefined || planName !== undefined) {
        updateData.plan_name = plan_name !== undefined ? plan_name : planName;
      }
      if (storage_capacity !== undefined || storageCapacity !== undefined) {
        updateData.storage_capacity = storage_capacity !== undefined ? storage_capacity : storageCapacity;
      }
      if (capacity_unit_id !== undefined || capacityUnitId !== undefined || capacity_unit !== undefined || capacityUnit !== undefined) {
        const unitVal = capacity_unit_id || capacityUnitId || capacity_unit || capacityUnit;
        updateData.capacity_unit_id = await StorageMasterModel.resolveUnitId(unitVal);
      }
      if (monthly_price !== undefined || monthlyPrice !== undefined) {
        updateData.monthly_price = monthly_price !== undefined ? monthly_price : monthlyPrice;
      }
      if (annual_price !== undefined || annualPrice !== undefined) {
        updateData.annual_price = annual_price !== undefined ? annual_price : annualPrice;
      }
      if (description !== undefined) {
        updateData.description = description;
      }
      if (status !== undefined) {
        updateData.status = status;
      }

      const success = await StorageMasterModel.update(id, updateData);
      if (!success) {
        return ApiResponse.badRequest(res, 'No changes made or update failed.');
      }

      const updated = await StorageMasterModel.getById(id);
      return ApiResponse.success(res, 'Storage plan updated successfully.', updated);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /storage-plans/:id
   * Delete a storage plan
   */
  static async delete(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await StorageMasterModel.getById(id);
      if (!existing) {
        return ApiResponse.notFound(res, 'Storage plan not found.');
      }

      await StorageMasterModel.delete(id);
      return ApiResponse.success(res, 'Storage plan deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /storage-plans/:id/status
   * Toggle active/inactive status
   */
  static async toggleStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.badRequest(res, 'Status must be 0 (inactive) or 1 (active).');
      }

      const success = await StorageMasterModel.toggleStatus(id, status);
      if (!success) {
        return ApiResponse.notFound(res, 'Storage plan not found.');
      }

      return ApiResponse.success(
        res,
        `Storage plan ${parseInt(status, 10) === 1 ? 'activated' : 'deactivated'} successfully.`
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = StorageMasterController;
