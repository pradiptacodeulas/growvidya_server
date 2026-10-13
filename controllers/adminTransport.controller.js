const TransportModel = require('../models/transport.model');
const ApiResponse = require('../utils/api.response');

const getSchoolId = (req) => {
  const schoolId = req.user?.schoolId || req.user?.school_id;
  if (!schoolId) {
    const err = new Error('School context required. Please log in again.');
    err.statusCode = 401;
    throw err;
  }
  return Number(schoolId);
};

class AdminTransportController {
  // ==========================================
  // 1. ROUTES
  // ==========================================

  static async getAllRoutes(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { search, status } = req.query;

      const routes = await TransportModel.getAllRoutes(schoolId, { search, status, branchId });
      return ApiResponse.success(res, 'Routes fetched successfully.', { routes });
    } catch (error) {
      next(error);
    }
  }

  static async getRouteById(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;

      const route = await TransportModel.getRouteById(schoolId, id, branchId);
      if (!route) {
        return ApiResponse.error(res, 'Route not found.', null, 404);
      }
      return ApiResponse.success(res, 'Route fetched successfully.', { route });
    } catch (error) {
      next(error);
    }
  }

  static async createRoute(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || null;
      const { transport_route, bus_id, bus, driver_id, driver, helpers, helper, fare, sort_order, status } = req.body;

      if (!transport_route) {
        return ApiResponse.error(res, 'Route name is required.', null, 400);
      }

      const id = await TransportModel.createRoute(schoolId, {
        branch_id: branchId,
        transport_route,
        bus_id: bus_id || bus,
        driver_id: driver_id || driver,
        helpers: helpers || helper,
        fare,
        sort_order,
        status,
      });
      return ApiResponse.success(res, 'Route created successfully.', { id }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateRoute(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || null;
      const { id } = req.params;
      const { transport_route, bus_id, bus, driver_id, driver, helpers, helper, fare, sort_order, status, branch_id } = req.body;

      if (!transport_route) {
        return ApiResponse.error(res, 'Route name is required.', null, 400);
      }

      await TransportModel.updateRoute(schoolId, id, {
        transport_route,
        bus_id: bus_id || bus,
        driver_id: driver_id || driver,
        helpers: helpers || helper,
        fare,
        sort_order,
        status,
        branch_id: branch_id !== undefined ? branch_id : branchId,
      }, branchId);
      return ApiResponse.success(res, 'Route updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteRoute(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || null;
      const { id } = req.params;

      await TransportModel.deleteRoute(schoolId, id, branchId);
      return ApiResponse.success(res, 'Route deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // 2. VEHICLES / BUSES
  // ==========================================

  static async getAllVehicles(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { search, status } = req.query;

      const vehicles = await TransportModel.getAllVehicles(schoolId, { search, status, branchId });
      return ApiResponse.success(res, 'Vehicles fetched successfully.', { vehicles });
    } catch (error) {
      next(error);
    }
  }

  static async getVehicleById(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;

      const vehicle = await TransportModel.getVehicleById(schoolId, id, branchId);
      if (!vehicle) {
        return ApiResponse.error(res, 'Vehicle not found.', null, 404);
      }
      return ApiResponse.success(res, 'Vehicle fetched successfully.', { vehicle });
    } catch (error) {
      next(error);
    }
  }

  static async createVehicle(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || null;
      const { name, number_plate, seat, color, driver_id, status } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Vehicle name is required.', null, 400);
      }

      const imagePath = req.file ? `upload/buses/${req.file.filename}` : (req.body.image || null);

      const id = await TransportModel.createVehicle(schoolId, {
        branch_id: branchId,
        name,
        number_plate,
        seat,
        color,
        driver_id,
        status,
        image: imagePath,
      });
      return ApiResponse.success(res, 'Vehicle created successfully.', { id }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateVehicle(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || null;
      const { id } = req.params;
      const { name, number_plate, seat, color, driver_id, status, branch_id, remove_image } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Vehicle name is required.', null, 400);
      }

      let imagePath = undefined;
      const isRemoveImage = remove_image === 'true' || remove_image === true || remove_image === '1';
      if (req.file) {
        imagePath = `upload/buses/${req.file.filename}`;
      } else if (isRemoveImage) {
        imagePath = null;
      } else if (req.body.image !== undefined) {
        imagePath = req.body.image;
      }

      await TransportModel.updateVehicle(schoolId, id, {
        name,
        number_plate,
        seat,
        color,
        driver_id,
        status,
        image: imagePath,
        branch_id: branch_id !== undefined ? branch_id : branchId,
      }, branchId);
      return ApiResponse.success(res, 'Vehicle updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteVehicle(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || null;
      const { id } = req.params;

      await TransportModel.deleteVehicle(schoolId, id, branchId);
      return ApiResponse.success(res, 'Vehicle deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // 3. DRIVERS
  // ==========================================

  static async getAllDrivers(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const { search, status } = req.query;
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;

      const drivers = await TransportModel.getAllDrivers(schoolId, { search, status, branchId });
      return ApiResponse.success(res, 'Drivers fetched successfully.', { drivers });
    } catch (error) {
      next(error);
    }
  }

  static async getDriverById(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;

      const driver = await TransportModel.getDriverById(schoolId, id, branchId);
      if (!driver) {
        return ApiResponse.error(res, 'Driver not found.', null, 404);
      }
      return ApiResponse.success(res, 'Driver fetched successfully.', { driver });
    } catch (error) {
      next(error);
    }
  }

  static async checkDriverDuplicate(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const { email, phone, license_number, exclude_id } = req.query;

      const { isEmailDuplicate, isPhoneDuplicate, isLicenseDuplicate } =
        await TransportModel.checkDriverDuplicate(
          schoolId,
          { email, phone, license_number },
          exclude_id || null
        );

      let message = '';
      if (isEmailDuplicate) message = 'A driver with this email address already exists.';
      else if (isPhoneDuplicate) message = 'A driver with this phone number already exists.';
      else if (isLicenseDuplicate) message = 'A driver with this license number already exists.';

      return ApiResponse.success(res, 'Duplicate check completed.', {
        isEmailDuplicate,
        isPhoneDuplicate,
        isLicenseDuplicate,
        message,
      });
    } catch (error) {
      next(error);
    }
  }

  static async createDriver(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const {
        first_name,
        last_name,
        email,
        phone,
        license_number,
        lisence_number,
        gender,
        picture,
        status,
        branch_id,
        id_proof_type,
        id_proof_number,
      } = req.body || {};
      const branchId = branch_id !== undefined ? branch_id : (req.branchId || null);

      if (!first_name || !first_name.trim()) {
        return ApiResponse.error(res, 'Driver first name is required.', null, 400);
      }
      if (!last_name || !last_name.trim()) {
        return ApiResponse.error(res, 'Driver last name is required.', null, 400);
      }
      if (!phone || !phone.trim()) {
        return ApiResponse.error(res, 'Phone number is required.', null, 400);
      }

      // Phone format validation
      const cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
      const phoneRegex = /^[+]?[0-9]{10,15}$/;
      if (!phoneRegex.test(cleanPhone)) {
        return ApiResponse.error(res, 'Please provide a valid phone number (at least 10 digits).', null, 400);
      }

      // Email format validation and duplicate check
      if (email && email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
        }

        const isEmailDup = await TransportModel.checkDriverEmail(schoolId, email.trim());
        if (isEmailDup) {
          return ApiResponse.error(res, 'A driver with this email address already exists.', null, 400);
        }
      }

      // Phone duplicate check
      const isPhoneDup = await TransportModel.checkDriverPhone(schoolId, cleanPhone);
      if (isPhoneDup) {
        return ApiResponse.error(res, 'A driver with this phone number already exists.', null, 400);
      }

      // License number duplicate check (Required)
      const targetLicense = (license_number || lisence_number || '').trim();
      if (!targetLicense) {
        return ApiResponse.error(res, 'Driving license number is required.', null, 400);
      }
      const isLicenseDup = await TransportModel.checkDriverLicense(schoolId, targetLicense);
      if (isLicenseDup) {
        return ApiResponse.error(res, 'A driver with this license number already exists.', null, 400);
      }

      // Document files
      const licenseFile = req.files?.['license_doc']?.[0] || req.files?.['lisence_doc']?.[0] || null;
      const idProofFile = req.files?.['id_proof_doc']?.[0] || req.files?.['id_proof_file']?.[0] || null;

      // Driving License Document validation (Required)
      if (!licenseFile) {
        return ApiResponse.error(res, 'Driving license document is required.', null, 400);
      }

      // Government ID Proof Type validation (Required)
      const idProofType = (id_proof_type || req.body?.id_proof_type || '').trim();
      if (!idProofType) {
        return ApiResponse.error(res, 'Government ID proof type is required.', null, 400);
      }

      // Government ID Proof Number validation (Required)
      const idProofNumber = (id_proof_number || req.body?.id_proof_number || '').trim();
      if (!idProofNumber) {
        return ApiResponse.error(res, 'Government ID proof number is required.', null, 400);
      }

      // Government ID Proof Document validation (Required)
      if (!idProofFile) {
        return ApiResponse.error(res, 'Government ID proof document is required.', null, 400);
      }

      const licenseDocPath = `upload/drivers/documents/${licenseFile.filename}`;
      const idProofDocPath = `upload/drivers/documents/${idProofFile.filename}`;

      const id = await TransportModel.createDriver(schoolId, {
        branch_id: branchId,
        first_name,
        last_name,
        email,
        phone,
        license_number: targetLicense,
        license_doc: licenseDocPath,
        id_proof_type: idProofType,
        id_proof_number: idProofNumber,
        id_proof_doc: idProofDocPath,
        gender,
        picture,
        status,
      });
      return ApiResponse.success(res, 'Driver created successfully.', { id }, 201);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const msg = error.message.toLowerCase();
        if (msg.includes('email')) return ApiResponse.error(res, 'A driver with this email address already exists.', null, 400);
        if (msg.includes('phone')) return ApiResponse.error(res, 'A driver with this phone number already exists.', null, 400);
        if (msg.includes('lisence')) return ApiResponse.error(res, 'A driver with this license number already exists.', null, 400);
      }
      next(error);
    }
  }

  static async updateDriver(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const { id } = req.params;
      const {
        first_name,
        last_name,
        email,
        phone,
        license_number,
        lisence_number,
        gender,
        picture,
        status,
        branch_id,
        id_proof_type,
        id_proof_number,
        remove_license_doc,
        remove_id_proof_doc,
      } = req.body || {};
      const branchId = branch_id !== undefined ? branch_id : undefined;

      if (!first_name || !first_name.trim()) {
        return ApiResponse.error(res, 'Driver first name is required.', null, 400);
      }
      if (!last_name || !last_name.trim()) {
        return ApiResponse.error(res, 'Driver last name is required.', null, 400);
      }
      if (!phone || !phone.trim()) {
        return ApiResponse.error(res, 'Phone number is required.', null, 400);
      }

      // Phone format validation
      const cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
      const phoneRegex = /^[+]?[0-9]{10,15}$/;
      if (!phoneRegex.test(cleanPhone)) {
        return ApiResponse.error(res, 'Please provide a valid phone number (at least 10 digits).', null, 400);
      }

      // Email format validation and duplicate check
      if (email && email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
        }

        const isEmailDup = await TransportModel.checkDriverEmail(schoolId, email.trim(), id);
        if (isEmailDup) {
          return ApiResponse.error(res, 'A driver with this email address already exists.', null, 400);
        }
      }

      // Phone duplicate check
      const isPhoneDup = await TransportModel.checkDriverPhone(schoolId, cleanPhone, id);
      if (isPhoneDup) {
        return ApiResponse.error(res, 'A driver with this phone number already exists.', null, 400);
      }

      // License number duplicate check (Required)
      const targetLicense = (license_number || lisence_number || '').trim();
      if (!targetLicense) {
        return ApiResponse.error(res, 'Driving license number is required.', null, 400);
      }
      const isLicenseDup = await TransportModel.checkDriverLicense(schoolId, targetLicense, id);
      if (isLicenseDup) {
        return ApiResponse.error(res, 'A driver with this license number already exists.', null, 400);
      }

      // Government ID Proof Type validation (Required)
      const idProofType = (id_proof_type || '').trim();
      if (!idProofType) {
        return ApiResponse.error(res, 'Government ID proof type is required.', null, 400);
      }

      // Government ID Proof Number validation (Required)
      const idProofNumber = (id_proof_number || '').trim();
      if (!idProofNumber) {
        return ApiResponse.error(res, 'Government ID proof number is required.', null, 400);
      }

      // Existing driver documents check (Required)
      const existingDriver = await TransportModel.getDriverById(schoolId, id);
      if (!existingDriver) {
        return ApiResponse.error(res, 'Driver not found.', null, 404);
      }

      // Document files & removal flags
      const licenseFile = req.files?.['license_doc']?.[0] || req.files?.['lisence_doc']?.[0] || null;
      const idProofFile = req.files?.['id_proof_doc']?.[0] || req.files?.['id_proof_file']?.[0] || null;

      const hasLicenseDoc = (existingDriver.lisence_doc && remove_license_doc !== 'true' && remove_license_doc !== true) || licenseFile;
      if (!hasLicenseDoc) {
        return ApiResponse.error(res, 'Driving license document is required.', null, 400);
      }

      const hasIdProofDoc = (existingDriver.id_proof_doc && remove_id_proof_doc !== 'true' && remove_id_proof_doc !== true) || idProofFile;
      if (!hasIdProofDoc) {
        return ApiResponse.error(res, 'Government ID proof document is required.', null, 400);
      }

      const licenseDocPath = licenseFile ? `upload/drivers/documents/${licenseFile.filename}` : undefined;
      const idProofDocPath = idProofFile ? `upload/drivers/documents/${idProofFile.filename}` : undefined;

      await TransportModel.updateDriver(schoolId, id, {
        branch_id: branchId,
        first_name,
        last_name,
        email,
        phone,
        license_number: targetLicense,
        license_doc: licenseDocPath,
        id_proof_type: idProofType,
        id_proof_number: idProofNumber,
        id_proof_doc: idProofDocPath,
        remove_license_doc,
        remove_id_proof_doc,
        gender,
        picture,
        status,
      });
      return ApiResponse.success(res, 'Driver updated successfully.');
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const msg = error.message.toLowerCase();
        if (msg.includes('email')) return ApiResponse.error(res, 'A driver with this email address already exists.', null, 400);
        if (msg.includes('phone')) return ApiResponse.error(res, 'A driver with this phone number already exists.', null, 400);
        if (msg.includes('lisence')) return ApiResponse.error(res, 'A driver with this license number already exists.', null, 400);
      }
      next(error);
    }
  }

  static async deleteDriver(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || null;
      const { id } = req.params;

      await TransportModel.deleteDriver(schoolId, id, branchId);
      return ApiResponse.success(res, 'Driver deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // 4. HELPERS
  // ==========================================

  static async getAllHelpers(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const { search, status } = req.query;
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;

      const helpers = await TransportModel.getAllHelpers(schoolId, { search, status, branchId });
      return ApiResponse.success(res, 'Helpers fetched successfully.', { helpers });
    } catch (error) {
      next(error);
    }
  }

  static async getHelperById(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;

      const helper = await TransportModel.getHelperById(schoolId, id, branchId);
      if (!helper) {
        return ApiResponse.error(res, 'Helper not found.', null, 404);
      }
      return ApiResponse.success(res, 'Helper fetched successfully.', { helper });
    } catch (error) {
      next(error);
    }
  }

  static async checkHelperDuplicate(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const { email, phone, exclude_id } = req.query;

      const { isEmailDuplicate, isPhoneDuplicate } = await TransportModel.checkHelperDuplicate(
        schoolId,
        { email, phone },
        exclude_id || null
      );

      return ApiResponse.success(res, 'Duplicate check completed.', {
        isEmailDuplicate,
        isPhoneDuplicate,
        message: isEmailDuplicate
          ? 'A helper or operator with this email address already exists.'
          : isPhoneDuplicate
          ? 'A helper or operator with this phone number already exists.'
          : '',
      });
    } catch (error) {
      next(error);
    }
  }

  static async createHelper(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const {
        first_name,
        last_name,
        email,
        phone,
        gender,
        picture,
        status,
        branch_id,
        id_proof_type,
        id_proof_number,
      } = req.body || {};
      const branchId = branch_id !== undefined ? branch_id : (req.branchId || req.query.branch_id || null);

      if (!first_name || !first_name.trim()) {
        return ApiResponse.error(res, 'First name is required.', null, 400);
      }
      if (!last_name || !last_name.trim()) {
        return ApiResponse.error(res, 'Last name is required.', null, 400);
      }
      if (!phone || !phone.trim()) {
        return ApiResponse.error(res, 'Phone number is required.', null, 400);
      }

      // Phone format validation
      const cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
      const phoneRegex = /^[+]?[0-9]{10,15}$/;
      if (!phoneRegex.test(cleanPhone)) {
        return ApiResponse.error(res, 'Please provide a valid phone number (at least 10 digits).', null, 400);
      }

      // Email format validation and duplicate check
      if (email && email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
        }

        const isEmailDup = await TransportModel.checkHelperEmail(schoolId, email.trim());
        if (isEmailDup) {
          return ApiResponse.error(res, 'A helper or operator with this email address already exists.', null, 400);
        }
      }

      // Phone duplicate check
      const isPhoneDup = await TransportModel.checkHelperPhone(schoolId, cleanPhone);
      if (isPhoneDup) {
        return ApiResponse.error(res, 'A helper or operator with this phone number already exists.', null, 400);
      }

      // Government ID Proof validation (Required)
      const idProofType = (req.body?.id_proof_type || '').trim();
      if (!idProofType) {
        return ApiResponse.error(res, 'Government ID proof type is required.', null, 400);
      }

      const idProofNumber = (req.body?.id_proof_number || '').trim();
      if (!idProofNumber) {
        return ApiResponse.error(res, 'Government ID proof number is required.', null, 400);
      }

      const idProofFile = req.files?.['id_proof_doc']?.[0] || req.files?.['id_proof_file']?.[0] || null;
      if (!idProofFile) {
        return ApiResponse.error(res, 'Government ID proof document is required.', null, 400);
      }
      const idProofDocPath = `upload/drivers/documents/${idProofFile.filename}`;

      const id = await TransportModel.createHelper(schoolId, {
        branch_id: branchId,
        first_name,
        last_name,
        email,
        phone,
        id_proof_type: idProofType,
        id_proof_number: idProofNumber,
        id_proof_doc: idProofDocPath,
        gender,
        picture,
        status,
      });
      return ApiResponse.success(res, 'Helper created successfully.', { id }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateHelper(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const { id } = req.params;
      const {
        first_name,
        last_name,
        email,
        phone,
        gender,
        picture,
        status,
        branch_id,
        id_proof_type,
        id_proof_number,
        remove_id_proof_doc,
      } = req.body || {};
      const branchId = branch_id !== undefined ? branch_id : undefined;

      if (!first_name || !first_name.trim()) {
        return ApiResponse.error(res, 'First name is required.', null, 400);
      }
      if (!last_name || !last_name.trim()) {
        return ApiResponse.error(res, 'Last name is required.', null, 400);
      }
      if (!phone || !phone.trim()) {
        return ApiResponse.error(res, 'Phone number is required.', null, 400);
      }

      // Phone format validation
      const cleanPhone = phone.trim().replace(/[\s\-()]/g, '');
      const phoneRegex = /^[+]?[0-9]{10,15}$/;
      if (!phoneRegex.test(cleanPhone)) {
        return ApiResponse.error(res, 'Please provide a valid phone number (at least 10 digits).', null, 400);
      }

      // Email format validation and duplicate check
      if (email && email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          return ApiResponse.error(res, 'Please provide a valid email address.', null, 400);
        }

        const isEmailDup = await TransportModel.checkHelperEmail(schoolId, email.trim(), id);
        if (isEmailDup) {
          return ApiResponse.error(res, 'A helper or operator with this email address already exists.', null, 400);
        }
      }

      // Phone duplicate check
      const isPhoneDup = await TransportModel.checkHelperPhone(schoolId, cleanPhone, id);
      if (isPhoneDup) {
        return ApiResponse.error(res, 'A helper or operator with this phone number already exists.', null, 400);
      }

      // Government ID Proof validation (Required)
      const idProofTypeVal = (id_proof_type || '').trim();
      if (!idProofTypeVal) {
        return ApiResponse.error(res, 'Government ID proof type is required.', null, 400);
      }

      const idProofNumberVal = (id_proof_number || '').trim();
      if (!idProofNumberVal) {
        return ApiResponse.error(res, 'Government ID proof number is required.', null, 400);
      }

      const existingHelper = await TransportModel.getHelperById(schoolId, id);
      if (!existingHelper) {
        return ApiResponse.error(res, 'Helper not found.', null, 404);
      }

      const idProofFile = req.files?.['id_proof_doc']?.[0] || req.files?.['id_proof_file']?.[0] || null;
      const hasIdProofDoc = (existingHelper.id_proof_doc && remove_id_proof_doc !== 'true' && remove_id_proof_doc !== true) || idProofFile;
      if (!hasIdProofDoc) {
        return ApiResponse.error(res, 'Government ID proof document is required.', null, 400);
      }

      const idProofDocPath = idProofFile ? `upload/drivers/documents/${idProofFile.filename}` : undefined;

      await TransportModel.updateHelper(schoolId, id, {
        branch_id: branchId,
        first_name,
        last_name,
        email,
        phone,
        id_proof_type: idProofTypeVal,
        id_proof_number: idProofNumberVal,
        id_proof_doc: idProofDocPath,
        remove_id_proof_doc,
        gender,
        picture,
        status,
      });
      return ApiResponse.success(res, 'Helper updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteHelper(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || null;
      const { id } = req.params;

      await TransportModel.deleteHelper(schoolId, id, branchId);
      return ApiResponse.success(res, 'Helper deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==========================================
  // 5. ALLOCATIONS
  // ==========================================

  static async getAllAllocations(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { search, route_id, class_id, section_id, status } = req.query;

      const allocations = await TransportModel.getAllAllocations(schoolId, {
        search,
        route_id,
        class_id,
        section_id,
        status,
        branchId,
      });
      return ApiResponse.success(res, 'Transport allocations fetched successfully.', { allocations });
    } catch (error) {
      next(error);
    }
  }

  static async getAllocateById(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || req.query.branchId || null;
      const { id } = req.params;

      const allocation = await TransportModel.getAllocateById(schoolId, id, branchId);
      if (!allocation) {
        return ApiResponse.error(res, 'Allocation not found.', null, 404);
      }
      return ApiResponse.success(res, 'Allocation fetched successfully.', { allocation });
    } catch (error) {
      next(error);
    }
  }

  static async createAllocation(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || req.query.branch_id || null;
      const { student_id, route, vehicle_number, pickup_point, drop_point, status } = req.body;

      if (!student_id || !route) {
        return ApiResponse.error(res, 'Student and Route are required.', null, 400);
      }

      const id = await TransportModel.createAllocation(schoolId, {
        branch_id: branchId,
        student_id,
        route,
        vehicle_number,
        pickup_point,
        drop_point,
        status,
      });
      return ApiResponse.success(res, 'Transport allocation created successfully.', { id }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateAllocation(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.body?.branch_id || null;
      const { id } = req.params;
      const { student_id, route, vehicle_number, pickup_point, drop_point, status, branch_id } = req.body;

      if (!student_id || !route) {
        return ApiResponse.error(res, 'Student and Route are required.', null, 400);
      }

      await TransportModel.updateAllocation(schoolId, id, {
        branch_id: branch_id !== undefined ? branch_id : branchId,
        student_id,
        route,
        vehicle_number,
        pickup_point,
        drop_point,
        status,
      }, branchId);
      return ApiResponse.success(res, 'Transport allocation updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteAllocation(req, res, next) {
    try {
      const schoolId = getSchoolId(req);
      const branchId = req.branchId || req.query.branch_id || null;
      const { id } = req.params;

      await TransportModel.deleteAllocation(schoolId, id, branchId);
      return ApiResponse.success(res, 'Transport allocation deleted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminTransportController;
