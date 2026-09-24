const express = require('express');
const router = express.Router();
const SaasController = require('../controllers/saas.controller');
const StorageMasterController = require('../controllers/storageMaster.controller');
const couponAuthMiddleware = require('../middlewares/couponAuth.middleware');

// Public SaaS routes (no auth required)
router.get('/plans', SaasController.getPlans);
router.post('/create-order', SaasController.createRegistrationOrder);

// Storage Plans requires authentication
router.get('/storage-plans', couponAuthMiddleware, StorageMasterController.getActive);
router.post('/register-school', SaasController.registerSchool);
router.get('/locations/countries', SaasController.getCountries);
router.get('/locations/states/:countryId', SaasController.getStates);
router.get('/locations/cities/:stateId', SaasController.getCities);
router.get('/genders', SaasController.getGenders);
router.post('/validate-coupon', SaasController.validateCoupon);

module.exports = router;
