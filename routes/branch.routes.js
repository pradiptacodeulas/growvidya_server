const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const rbacMiddleware = require('../middlewares/rbac.middleware');
const BranchController = require('../controllers/branch.controller');

// Require authentication for all branch routes
router.use(authMiddleware);

// Get list of branches (available to authenticated users for branch info/selection)
router.get('/', BranchController.getBranches);

// Get branches summary with student & teacher statistics (Super Admin campus management)
router.get('/summary', rbacMiddleware('settings/branches', 'view'), BranchController.getBranchesSummary);

// Location Lookups (using countries)
router.get('/locations/countries', BranchController.getCountries);
router.get('/locations/states', BranchController.getStates);
router.get('/locations/cities', BranchController.getCities);

// Eligible staff candidates for branch head (Super Admin campus management)
router.get('/head-candidates', rbacMiddleware('settings/branches', 'view'), BranchController.getBranchHeadCandidates);

// Get single branch details
router.get('/:id', BranchController.getBranchById);

// Create a new branch (Super Admin campus management)
router.post('/', rbacMiddleware('settings/branches', 'add'), BranchController.createBranch);

// Update branch details (Super Admin campus management)
router.put('/:id', rbacMiddleware('settings/branches', 'edit'), BranchController.updateBranch);

// Set branch as main campus (Super Admin campus management)
router.patch('/:id/set-main', rbacMiddleware('settings/branches', 'edit'), BranchController.setMainBranch);

// Delete branch (Super Admin campus management)
router.delete('/:id', rbacMiddleware('settings/branches', 'delete'), BranchController.deleteBranch);

module.exports = router;
