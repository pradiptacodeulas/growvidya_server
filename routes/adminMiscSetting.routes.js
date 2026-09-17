const express = require('express');
const router = express.Router();
const AdminMiscSettingController = require('../controllers/adminMiscSetting.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const rbacMiddleware = require('../middlewares/rbac.middleware');

// All setting routes require JWT authentication
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for settings routes
router.use((req, res, next) => {
  const path = req.path.toLowerCase();

  // Master taxonomy and geographic lookup endpoints needed system-wide by all staff
  const isMasterLookup =
    req.method === 'GET' &&
    (path.startsWith('/religions') ||
      path.startsWith('/mother-tongues') ||
      path.startsWith('/genders') ||
      path.startsWith('/categories') ||
      path.startsWith('/general/states') ||
      path.startsWith('/general/cities'));

  if (isMasterLookup) {
    return next();
  }

  let targetModule = 'settings/miscManagement';

  if (path.startsWith('/general')) {
    targetModule = 'settings/general';
  } else if (path.startsWith('/salary-date')) {
    targetModule = 'settings/salarydatesettings';
  }

  let targetAction = 'view';
  if (req.method === 'POST') targetAction = 'add';
  else if (req.method === 'PUT' || req.method === 'PATCH') targetAction = 'edit';
  else if (req.method === 'DELETE') targetAction = 'delete';

  return rbacMiddleware(targetModule, targetAction)(req, res, next);
});

// Religion Routes
router.get('/religions', AdminMiscSettingController.getReligions);
router.post('/religions', AdminMiscSettingController.createReligion);
router.put('/religions/:id', AdminMiscSettingController.updateReligion);
router.delete('/religions/:id', AdminMiscSettingController.deleteReligion);

// Mother Tongue Routes
router.get('/mother-tongues', AdminMiscSettingController.getMotherTongues);
router.post('/mother-tongues', AdminMiscSettingController.createMotherTongue);
router.put('/mother-tongues/:id', AdminMiscSettingController.updateMotherTongue);
router.delete('/mother-tongues/:id', AdminMiscSettingController.deleteMotherTongue);

// Gender Routes
router.get('/genders', AdminMiscSettingController.getGenders);

// Category Routes
router.get('/categories', AdminMiscSettingController.getCategories);
router.post('/categories', AdminMiscSettingController.createCategory);
router.put('/categories/:id', AdminMiscSettingController.updateCategory);
router.delete('/categories/:id', AdminMiscSettingController.deleteCategory);

// General Settings Routes
const AdminGeneralSettingController = require('../controllers/adminGeneralSetting.controller');
router.get('/general', AdminGeneralSettingController.getGeneralSettings);
router.post('/general', AdminGeneralSettingController.updateGeneralSettings);
router.put('/general', AdminGeneralSettingController.updateGeneralSettings);
router.get('/general/states/:countryId', AdminGeneralSettingController.getStatesByCountry);
router.get('/general/cities/:stateId', AdminGeneralSettingController.getCitiesByState);

// Salary Date Routes
const AdminSalaryDateController = require('../controllers/adminSalaryDate.controller');
router.get('/salary-dates', AdminSalaryDateController.getSalaryDates);
router.post('/salary-dates', AdminSalaryDateController.createSalaryDate);
router.put('/salary-dates/:id', AdminSalaryDateController.updateSalaryDate);
router.delete('/salary-dates/:id', AdminSalaryDateController.deleteSalaryDate);

module.exports = router;
