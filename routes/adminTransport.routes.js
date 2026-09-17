const express = require('express');
const router = express.Router();
const AdminTransportController = require('../controllers/adminTransport.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');

router.use(authMiddleware);

// Dynamic module & action RBAC middleware for transport routes
router.use((req, res, next) => {
  let targetModule = 'transport/route';
  const path = req.path.toLowerCase();

  if (path.startsWith('/vehicle') || path.startsWith('/bus')) {
    targetModule = req.method === 'GET'
      ? ['transport/bus', 'transport/route', 'transport/driver', 'transport/helper', 'staff/teachers', 'ward/students']
      : 'transport/bus';
  } else if (path.startsWith('/driver')) {
    targetModule = req.method === 'GET'
      ? ['transport/driver', 'transport/bus', 'transport/route', 'transport/helper']
      : 'transport/driver';
  } else if (path.startsWith('/helper')) {
    targetModule = req.method === 'GET'
      ? ['transport/helper', 'transport/bus', 'transport/route', 'transport/driver']
      : 'transport/helper';
  } else if (path.startsWith('/route') || path.startsWith('/assign') || path.startsWith('/allocation')) {
    targetModule = req.method === 'GET'
      ? [
          'transport/route',
          'transport/bus',
          'transport/driver',
          'transport/helper',
          'feesmanagement/structures',
          'feesmanagement/payments',
          'ward/students',
          'staff/teachers',
          'staff/users'
        ]
      : 'transport/route';
  }

  let targetAction = 'view';
  if (req.method === 'POST') targetAction = 'add';
  else if (req.method === 'PUT' || req.method === 'PATCH') targetAction = 'edit';
  else if (req.method === 'DELETE') targetAction = 'delete';

  return authorizeRoles(targetModule, targetAction)(req, res, next);
});

// 1. Routes (and alias /route)
router.get('/routes', AdminTransportController.getAllRoutes);
router.get('/route', AdminTransportController.getAllRoutes);
router.post('/routes', AdminTransportController.createRoute);
router.post('/route', AdminTransportController.createRoute);
router.get('/routes/:id', AdminTransportController.getRouteById);
router.get('/route/:id', AdminTransportController.getRouteById);
router.put('/routes/:id', AdminTransportController.updateRoute);
router.put('/route/:id', AdminTransportController.updateRoute);
router.delete('/routes/:id', AdminTransportController.deleteRoute);
router.delete('/route/:id', AdminTransportController.deleteRoute);

// 2. Buses / Vehicles (and alias /bus, /buses)
router.get('/vehicles', AdminTransportController.getAllVehicles);
router.get('/buses', AdminTransportController.getAllVehicles);
router.get('/bus', AdminTransportController.getAllVehicles);
router.post('/vehicles', AdminTransportController.createVehicle);
router.post('/buses', AdminTransportController.createVehicle);
router.post('/bus', AdminTransportController.createVehicle);
router.get('/vehicles/:id', AdminTransportController.getVehicleById);
router.get('/buses/:id', AdminTransportController.getVehicleById);
router.get('/bus/:id', AdminTransportController.getVehicleById);
router.put('/vehicles/:id', AdminTransportController.updateVehicle);
router.put('/buses/:id', AdminTransportController.updateVehicle);
router.put('/bus/:id', AdminTransportController.updateVehicle);
router.delete('/vehicles/:id', AdminTransportController.deleteVehicle);
router.delete('/buses/:id', AdminTransportController.deleteVehicle);
router.delete('/bus/:id', AdminTransportController.deleteVehicle);

// 3. Drivers (and alias /driver)
router.get('/drivers/check-duplicate', AdminTransportController.checkDriverDuplicate);
router.get('/driver/check-duplicate', AdminTransportController.checkDriverDuplicate);
router.get('/drivers', AdminTransportController.getAllDrivers);
router.get('/driver', AdminTransportController.getAllDrivers);
router.post('/drivers', AdminTransportController.createDriver);
router.post('/driver', AdminTransportController.createDriver);
router.get('/drivers/:id', AdminTransportController.getDriverById);
router.get('/driver/:id', AdminTransportController.getDriverById);
router.put('/drivers/:id', AdminTransportController.updateDriver);
router.put('/driver/:id', AdminTransportController.updateDriver);
router.delete('/drivers/:id', AdminTransportController.deleteDriver);
router.delete('/driver/:id', AdminTransportController.deleteDriver);

// 4. Helpers (and alias /helper)
router.get('/helpers/check-duplicate', AdminTransportController.checkHelperDuplicate);
router.get('/helper/check-duplicate', AdminTransportController.checkHelperDuplicate);
router.get('/helpers', AdminTransportController.getAllHelpers);
router.get('/helper', AdminTransportController.getAllHelpers);
router.post('/helpers', AdminTransportController.createHelper);
router.post('/helper', AdminTransportController.createHelper);
router.get('/helpers/:id', AdminTransportController.getHelperById);
router.get('/helper/:id', AdminTransportController.getHelperById);
router.put('/helpers/:id', AdminTransportController.updateHelper);
router.put('/helper/:id', AdminTransportController.updateHelper);
router.delete('/helpers/:id', AdminTransportController.deleteHelper);
router.delete('/helper/:id', AdminTransportController.deleteHelper);

// 5. Allocations (Assign Transport)
router.get('/allocations', AdminTransportController.getAllAllocations);
router.post('/allocations', AdminTransportController.createAllocation);
router.get('/allocations/:id', AdminTransportController.getAllocateById);
router.put('/allocations/:id', AdminTransportController.updateAllocation);
router.delete('/allocations/:id', AdminTransportController.deleteAllocation);

module.exports = router;
