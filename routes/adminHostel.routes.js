const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const authorizeRoles = require('../middlewares/rbac.middleware');
const adminHostelController = require('../controllers/adminHostel.controller');

// All admin hostel routes require admin auth
router.use(authMiddleware);

// Dynamic module & action RBAC middleware for hostel routes
router.use((req, res, next) => {
  const targetModule = req.path.startsWith('/rooms') ? 'hostel/hostelRooms' : 'hostel/hostelList';

  let targetAction = 'view';
  if (req.method === 'POST') targetAction = 'add';
  else if (req.method === 'PUT' || req.method === 'PATCH') targetAction = 'edit';
  else if (req.method === 'DELETE') targetAction = 'delete';

  return authorizeRoles(targetModule, targetAction)(req, res, next);
});

// --- Hostel Master Routes ---
router.get('/hostels', adminHostelController.getAllHostels);
router.get('/hostels/:id', adminHostelController.getHostelById);
router.post('/hostels', adminHostelController.createHostel);
router.put('/hostels/:id', adminHostelController.updateHostel);
router.delete('/hostels/:id', adminHostelController.deleteHostel);

// --- Hostel Room Master Routes ---
router.get('/rooms', adminHostelController.getAllHostelRooms);
router.get('/rooms/:id', adminHostelController.getHostelRoomById);
router.post('/rooms', adminHostelController.createHostelRoom);
router.put('/rooms/:id', adminHostelController.updateHostelRoom);
router.delete('/rooms/:id', adminHostelController.deleteHostelRoom);

module.exports = router;
