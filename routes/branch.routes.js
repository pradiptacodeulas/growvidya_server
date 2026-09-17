const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const BranchController = require('../controllers/branch.controller');

// Require authentication for all branch routes
router.use(authMiddleware);

// Get list of branches
router.get('/', BranchController.getBranches);

// Get branches summary with student & teacher statistics
router.get('/summary', BranchController.getBranchesSummary);

// Location Lookups (using countries_master)
router.get('/locations/countries', BranchController.getCountries);
router.get('/locations/states', BranchController.getStates);
router.get('/locations/cities', BranchController.getCities);

// Get single branch details
router.get('/:id', BranchController.getBranchById);

// Create a new branch
router.post('/', BranchController.createBranch);

// Update branch details
router.put('/:id', BranchController.updateBranch);

// Set branch as main campus
router.patch('/:id/set-main', BranchController.setMainBranch);

// Delete branch
router.delete('/:id', BranchController.deleteBranch);

module.exports = router;
