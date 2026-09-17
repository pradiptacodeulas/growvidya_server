const express = require('express');
const router = express.Router();
const SaasController = require('../controllers/saas.controller');

// Public SaaS routes (no auth required)
router.get('/plans', SaasController.getPlans);
router.post('/create-order', SaasController.createRegistrationOrder);
router.post('/register-school', SaasController.registerSchool);
router.get('/locations/countries', SaasController.getCountries);
router.get('/locations/states/:countryId', SaasController.getStates);
router.get('/locations/cities/:stateId', SaasController.getCities);

module.exports = router;
