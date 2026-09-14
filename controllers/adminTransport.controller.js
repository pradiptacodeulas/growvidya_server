const TransportModel = require('../models/transport.model');
const ApiResponse = require('../utils/api.response');

class AdminTransportController {
  // ==========================================
  // 1. ROUTES
  // ==========================================

  static async getAllRoutes(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { search, status } = req.query;

      const routes = await TransportModel.getAllRoutes(schoolId, { search, status });
      return ApiResponse.success(res, 'Routes fetched successfully.', { routes });
    } catch (error) {
      next(error);
    }
  }

  static async getRouteById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const route = await TransportModel.getRouteById(schoolId, id);
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
      const schoolId = req.user.schoolId;
      const { transport_route, bus_id, fare, sort_order, status } = req.body;

      if (!transport_route) {
        return ApiResponse.error(res, 'Route name is required.', null, 400);
      }

      const id = await TransportModel.createRoute(schoolId, {
        transport_route,
        bus_id,
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
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { transport_route, bus_id, fare, sort_order, status } = req.body;

      if (!transport_route) {
        return ApiResponse.error(res, 'Route name is required.', null, 400);
      }

      await TransportModel.updateRoute(schoolId, id, {
        transport_route,
        bus_id,
        fare,
        sort_order,
        status,
      });
      return ApiResponse.success(res, 'Route updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteRoute(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      await TransportModel.deleteRoute(schoolId, id);
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
      const schoolId = req.user.schoolId;
      const { search, status } = req.query;

      const vehicles = await TransportModel.getAllVehicles(schoolId, { search, status });
      return ApiResponse.success(res, 'Vehicles fetched successfully.', { vehicles });
    } catch (error) {
      next(error);
    }
  }

  static async getVehicleById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const vehicle = await TransportModel.getVehicleById(schoolId, id);
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
      const schoolId = req.user.schoolId;
      const { name, number_plate, seat, color, driver_id, status } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Vehicle name is required.', null, 400);
      }

      const id = await TransportModel.createVehicle(schoolId, {
        name,
        number_plate,
        seat,
        color,
        driver_id,
        status,
      });
      return ApiResponse.success(res, 'Vehicle created successfully.', { id }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateVehicle(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { name, number_plate, seat, color, driver_id, status } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Vehicle name is required.', null, 400);
      }

      await TransportModel.updateVehicle(schoolId, id, {
        name,
        number_plate,
        seat,
        color,
        driver_id,
        status,
      });
      return ApiResponse.success(res, 'Vehicle updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteVehicle(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      await TransportModel.deleteVehicle(schoolId, id);
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
      const schoolId = req.user.schoolId;
      const { search, status } = req.query;

      const drivers = await TransportModel.getAllDrivers(schoolId, { search, status });
      return ApiResponse.success(res, 'Drivers fetched successfully.', { drivers });
    } catch (error) {
      next(error);
    }
  }

  static async getDriverById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const driver = await TransportModel.getDriverById(schoolId, id);
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
      const schoolId = req.user.schoolId;
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
      const schoolId = req.user.schoolId;
      const { first_name, last_name, email, phone, license_number, lisence_number, gender, picture, status } = req.body;

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

      // License number duplicate check
      const targetLicense = (license_number || lisence_number || '').trim();
      if (targetLicense) {
        const isLicenseDup = await TransportModel.checkDriverLicense(schoolId, targetLicense);
        if (isLicenseDup) {
          return ApiResponse.error(res, 'A driver with this license number already exists.', null, 400);
        }
      }

      const id = await TransportModel.createDriver(schoolId, {
        first_name,
        last_name,
        email,
        phone,
        license_number: targetLicense,
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
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { first_name, last_name, email, phone, license_number, lisence_number, gender, picture, status } = req.body;

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

      // License number duplicate check
      const targetLicense = (license_number || lisence_number || '').trim();
      if (targetLicense) {
        const isLicenseDup = await TransportModel.checkDriverLicense(schoolId, targetLicense, id);
        if (isLicenseDup) {
          return ApiResponse.error(res, 'A driver with this license number already exists.', null, 400);
        }
      }

      await TransportModel.updateDriver(schoolId, id, {
        first_name,
        last_name,
        email,
        phone,
        license_number: targetLicense,
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
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      await TransportModel.deleteDriver(schoolId, id);
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
      const schoolId = req.user.schoolId;
      const { search, status } = req.query;

      const helpers = await TransportModel.getAllHelpers(schoolId, { search, status });
      return ApiResponse.success(res, 'Helpers fetched successfully.', { helpers });
    } catch (error) {
      next(error);
    }
  }

  static async getHelperById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const helper = await TransportModel.getHelperById(schoolId, id);
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
      const schoolId = req.user.schoolId;
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
      const schoolId = req.user.schoolId;
      const { first_name, last_name, email, phone, gender, picture, status } = req.body;

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

      const id = await TransportModel.createHelper(schoolId, {
        first_name,
        last_name,
        email,
        phone,
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
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { first_name, last_name, email, phone, gender, picture, status } = req.body;

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

      await TransportModel.updateHelper(schoolId, id, {
        first_name,
        last_name,
        email,
        phone,
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
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      await TransportModel.deleteHelper(schoolId, id);
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
      const schoolId = req.user.schoolId;
      const { search, route_id, class_id, section_id } = req.query;

      const allocations = await TransportModel.getAllAllocations(schoolId, {
        search,
        route_id,
        class_id,
        section_id,
      });
      return ApiResponse.success(res, 'Transport allocations fetched successfully.', { allocations });
    } catch (error) {
      next(error);
    }
  }

  static async getAllocateById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const allocation = await TransportModel.getAllocateById(schoolId, id);
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
      const schoolId = req.user.schoolId;
      const { student_id, route, vehicle_number, pickup_point, drop_point, status } = req.body;

      if (!student_id || !route) {
        return ApiResponse.error(res, 'Student and Route are required.', null, 400);
      }

      const id = await TransportModel.createAllocation(schoolId, {
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
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { student_id, route, vehicle_number, pickup_point, drop_point, status } = req.body;

      if (!student_id || !route) {
        return ApiResponse.error(res, 'Student and Route are required.', null, 400);
      }

      await TransportModel.updateAllocation(schoolId, id, {
        student_id,
        route,
        vehicle_number,
        pickup_point,
        drop_point,
        status,
      });
      return ApiResponse.success(res, 'Transport allocation updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteAllocation(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      await TransportModel.deleteAllocation(schoolId, id);
      return ApiResponse.success(res, 'Transport allocation deleted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminTransportController;
