const AttendanceMachineMasterModel = require('../models/attendanceMachineMaster.model');
const ApiResponse = require('../utils/api.response');

class AttendanceMachineMasterController {
  /**
   * GET /attendance-machines
   * List all attendance machines (supports ?search=, ?status=, ?machine_type=, ?brand=)
   */
  static async getAll(req, res, next) {
    try {
      const { search, status, machine_type, brand, id, machine_id } = req.query;

      const targetId = id || machine_id;
      if (targetId && targetId !== ':id') {
        req.params.id = targetId;
        return AttendanceMachineMasterController.getById(req, res, next);
      }

      const machines = await AttendanceMachineMasterModel.getAll({ search, status, machine_type, brand });
      return ApiResponse.success(res, 'Attendance machines retrieved successfully.', machines);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /attendance-machines/active
   * List only active attendance machines
   */
  static async getActive(req, res, next) {
    try {
      const machines = await AttendanceMachineMasterModel.getActive();
      return ApiResponse.success(res, 'Active attendance machines retrieved successfully.', machines);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /attendance-machines/:id
   * Get single machine by ID or model_number
   */
  static async getById(req, res, next) {
    try {
      let { id } = req.params;

      if (!id || id === ':id' || String(id).trim() === '') {
        id = req.query?.id || req.body?.id;
      }

      if (!id || id === ':id' || String(id).trim() === '') {
        return ApiResponse.badRequest(res, 'Attendance machine ID is required.');
      }

      const trimmedId = String(id).trim();
      let machine = null;

      if (/^\d+$/.test(trimmedId)) {
        machine = await AttendanceMachineMasterModel.getById(Number(trimmedId));
      } else {
        machine = await AttendanceMachineMasterModel.getByModelNumber(trimmedId);
      }

      if (!machine) {
        return ApiResponse.notFound(res, 'Attendance machine not found.');
      }

      return ApiResponse.success(res, 'Attendance machine fetched successfully.', machine);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /attendance-machines
   * Create a new attendance machine item
   */
  static async create(req, res, next) {
    try {
      const {
        machine_name,
        machineName,
        model_number,
        modelNumber,
        brand,
        machine_type,
        machineType,
        connectivity,
        user_capacity,
        userCapacity,
        log_capacity,
        logCapacity,
        push_protocol,
        pushProtocol,
        unit_price,
        unitPrice,
        amc_price,
        amcPrice,
        machine_image,
        machineImage,
        specifications,
        status,
      } = req.body;

      const name = machine_name || machineName;
      const model = model_number || modelNumber;
      const brandName = brand;
      const type = machine_type || machineType || 'hybrid';
      const conn = connectivity || 'LAN, Wi-Fi';
      const uCap = user_capacity !== undefined ? user_capacity : userCapacity;
      const lCap = log_capacity !== undefined ? log_capacity : logCapacity;
      const protocol = push_protocol || pushProtocol || 'Cloud Push';
      const price = unit_price !== undefined ? unit_price : unitPrice;
      const amc = amc_price !== undefined ? amc_price : amcPrice;
      const image = machine_image || machineImage;

      if (!name || !name.trim()) {
        return ApiResponse.badRequest(res, 'Machine name is required.');
      }

      if (!model || !model.trim()) {
        return ApiResponse.badRequest(res, 'Model number / SKU is required.');
      }

      if (!brandName || !brandName.trim()) {
        return ApiResponse.badRequest(res, 'Brand / Manufacturer name is required.');
      }

      // Check unique model number
      const existing = await AttendanceMachineMasterModel.getByModelNumber(model);
      if (existing) {
        return ApiResponse.badRequest(res, `A machine with model number "${model.trim().toUpperCase()}" already exists.`);
      }

      if (price === undefined || price === null || isNaN(price) || parseFloat(price) < 0) {
        return ApiResponse.badRequest(res, 'A valid unit price is required.');
      }

      const newId = await AttendanceMachineMasterModel.create({
        machine_name: name,
        model_number: model,
        brand: brandName,
        machine_type: type,
        connectivity: conn,
        user_capacity: uCap !== undefined ? uCap : 1000,
        log_capacity: lCap !== undefined ? lCap : 100000,
        push_protocol: protocol,
        unit_price: price,
        amc_price: amc !== undefined ? amc : 0.00,
        machine_image: image,
        specifications: specifications || '',
        status: status !== undefined ? status : 1,
      });

      const newMachine = await AttendanceMachineMasterModel.getById(newId);
      return ApiResponse.created(res, 'Attendance machine created successfully.', newMachine);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /attendance-machines/:id
   * Update an attendance machine item
   */
  static async update(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || !/^\d+$/.test(id)) {
        return ApiResponse.badRequest(res, 'Valid attendance machine ID is required.');
      }

      const existing = await AttendanceMachineMasterModel.getById(Number(id));
      if (!existing) {
        return ApiResponse.notFound(res, 'Attendance machine not found.');
      }

      const {
        machine_name,
        machineName,
        model_number,
        modelNumber,
        brand,
        machine_type,
        machineType,
        connectivity,
        user_capacity,
        userCapacity,
        log_capacity,
        logCapacity,
        push_protocol,
        pushProtocol,
        unit_price,
        unitPrice,
        amc_price,
        amcPrice,
        machine_image,
        machineImage,
        specifications,
        status,
      } = req.body;

      const updateData = {};

      if (machine_name !== undefined || machineName !== undefined) {
        const val = machine_name !== undefined ? machine_name : machineName;
        if (!val || !val.trim()) return ApiResponse.badRequest(res, 'Machine name cannot be empty.');
        updateData.machine_name = val;
      }

      if (model_number !== undefined || modelNumber !== undefined) {
        const val = model_number !== undefined ? model_number : modelNumber;
        if (!val || !val.trim()) return ApiResponse.badRequest(res, 'Model number cannot be empty.');
        // Verify not duplicate of another machine
        const duplicate = await AttendanceMachineMasterModel.getByModelNumber(val);
        if (duplicate && duplicate.id !== Number(id)) {
          return ApiResponse.badRequest(res, `Another machine with model number "${val.trim().toUpperCase()}" already exists.`);
        }
        updateData.model_number = val;
      }

      if (brand !== undefined) {
        if (!brand || !brand.trim()) return ApiResponse.badRequest(res, 'Brand cannot be empty.');
        updateData.brand = brand;
      }

      if (machine_type !== undefined || machineType !== undefined) {
        updateData.machine_type = machine_type !== undefined ? machine_type : machineType;
      }

      if (connectivity !== undefined) {
        updateData.connectivity = connectivity;
      }

      if (user_capacity !== undefined || userCapacity !== undefined) {
        updateData.user_capacity = user_capacity !== undefined ? user_capacity : userCapacity;
      }

      if (log_capacity !== undefined || logCapacity !== undefined) {
        updateData.log_capacity = log_capacity !== undefined ? log_capacity : logCapacity;
      }

      if (push_protocol !== undefined || pushProtocol !== undefined) {
        updateData.push_protocol = push_protocol !== undefined ? push_protocol : pushProtocol;
      }

      if (unit_price !== undefined || unitPrice !== undefined) {
        const val = unit_price !== undefined ? unit_price : unitPrice;
        if (isNaN(val) || parseFloat(val) < 0) return ApiResponse.badRequest(res, 'Valid unit price is required.');
        updateData.unit_price = val;
      }

      if (amc_price !== undefined || amcPrice !== undefined) {
        const val = amc_price !== undefined ? amc_price : amcPrice;
        if (isNaN(val) || parseFloat(val) < 0) return ApiResponse.badRequest(res, 'Valid AMC price is required.');
        updateData.amc_price = val;
      }

      if (machine_image !== undefined || machineImage !== undefined) {
        updateData.machine_image = machine_image !== undefined ? machine_image : machineImage;
      }

      if (specifications !== undefined) {
        updateData.specifications = specifications;
      }

      if (status !== undefined) {
        updateData.status = status;
      }

      await AttendanceMachineMasterModel.update(Number(id), updateData);
      const updatedMachine = await AttendanceMachineMasterModel.getById(Number(id));
      return ApiResponse.success(res, 'Attendance machine updated successfully.', updatedMachine);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /attendance-machines/:id
   * Delete an attendance machine
   */
  static async delete(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || !/^\d+$/.test(id)) {
        return ApiResponse.badRequest(res, 'Valid attendance machine ID is required.');
      }

      const existing = await AttendanceMachineMasterModel.getById(Number(id));
      if (!existing) {
        return ApiResponse.notFound(res, 'Attendance machine not found.');
      }

      await AttendanceMachineMasterModel.delete(Number(id));
      return ApiResponse.success(res, 'Attendance machine deleted successfully.');
    } catch (error) {
      if (error.message.includes('assigned to school campuses')) {
        return ApiResponse.badRequest(res, error.message);
      }
      next(error);
    }
  }

  /**
   * PATCH /attendance-machines/:id/status
   * Toggle active/inactive status
   */
  static async toggleStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!id || !/^\d+$/.test(id)) {
        return ApiResponse.badRequest(res, 'Valid attendance machine ID is required.');
      }

      if (status === undefined || (parseInt(status, 10) !== 0 && parseInt(status, 10) !== 1)) {
        return ApiResponse.badRequest(res, 'Status must be 0 (inactive) or 1 (active).');
      }

      const existing = await AttendanceMachineMasterModel.getById(Number(id));
      if (!existing) {
        return ApiResponse.notFound(res, 'Attendance machine not found.');
      }

      await AttendanceMachineMasterModel.toggleStatus(Number(id), status);
      return ApiResponse.success(res, `Attendance machine status changed to ${status == 1 ? 'active' : 'inactive'}.`);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AttendanceMachineMasterController;
