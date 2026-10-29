const express = require('express');
const router = express.Router();
const SaasController = require('../controllers/saas.controller');
const StorageMasterController = require('../controllers/storageMaster.controller');

// Public SaaS routes (no auth required)
router.get('/plans', SaasController.getPlans);
router.get('/config-catalog', SaasController.getConfigCatalog);
router.get('/storage-plans', StorageMasterController.getActive);
router.get('/trial-eligibility', SaasController.checkTrialEligibility);
router.post('/check-trial-eligibility', SaasController.checkTrialEligibility);
router.get('/check-availability', SaasController.checkAvailability);
router.post('/check-availability', SaasController.checkAvailability);
router.post('/create-order', SaasController.createRegistrationOrder);
router.post('/record-payment-failure', SaasController.recordPaymentFailure);
router.get('/orders/:orderNo', SaasController.getPublicOrderDetails);
router.post('/register-school', SaasController.registerSchool);
router.post('/register', SaasController.registerSchool);
router.post('/auth/exchange-handover', SaasController.exchangeHandoverToken);
router.get('/locations/countries', SaasController.getCountries);
router.get('/locations/states/:countryId', SaasController.getStates);
router.get('/locations/cities/:stateId', SaasController.getCities);
router.get('/genders', SaasController.getGenders);
router.post('/validate-coupon', SaasController.validateCoupon);

module.exports = router;
