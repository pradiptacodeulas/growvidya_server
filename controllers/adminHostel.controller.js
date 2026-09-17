const HostelModel = require('../models/hostel.model');

// --- Hostel Master Controller ---
exports.getAllHostels = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const hostels = await HostelModel.getAllHostels(schoolId);
    return res.status(200).json({
      success: true,
      data: hostels,
      hostels,
    });
  } catch (err) {
    console.error('Error in getAllHostels:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getHostelById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const hostel = await HostelModel.getHostelById(id, schoolId);
    if (!hostel) {
      return res.status(404).json({ success: false, message: 'Hostel not found' });
    }
    return res.status(200).json({ success: true, data: hostel });
  } catch (err) {
    console.error('Error in getHostelById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.createHostel = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { hostel_name, hostel_fee, sort_order, status } = req.body;

    if (!hostel_name || !hostel_name.trim()) {
      return res.status(400).json({ success: false, message: 'Hostel name is required' });
    }

    const insertId = await HostelModel.createHostel({
      school_id: schoolId,
      hostel_name: hostel_name.trim(),
      hostel_fee: hostel_fee || 0,
      sort_order: sort_order || 0,
      status: status !== undefined ? status : 1,
    });

    return res.status(201).json({
      success: true,
      message: 'Hostel added successfully',
      id: insertId,
    });
  } catch (err) {
    console.error('Error in createHostel:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.updateHostel = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const { hostel_name, hostel_fee, sort_order, status } = req.body;

    if (!hostel_name || !hostel_name.trim()) {
      return res.status(400).json({ success: false, message: 'Hostel name is required' });
    }

    await HostelModel.updateHostel(id, schoolId, {
      hostel_name: hostel_name.trim(),
      hostel_fee: hostel_fee || 0,
      sort_order: sort_order || 0,
      status: status !== undefined ? status : 1,
    });

    return res.status(200).json({
      success: true,
      message: 'Hostel updated successfully',
    });
  } catch (err) {
    console.error('Error in updateHostel:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.deleteHostel = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    await HostelModel.deleteHostel(id, schoolId);
    return res.status(200).json({
      success: true,
      message: 'Hostel deleted successfully',
    });
  } catch (err) {
    console.error('Error in deleteHostel:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// --- Hostel Rooms Controller ---
exports.getAllHostelRooms = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const rooms = await HostelModel.getAllHostelRooms(schoolId);
    return res.status(200).json({
      success: true,
      data: rooms,
      rooms,
    });
  } catch (err) {
    console.error('Error in getAllHostelRooms:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getHostelRoomById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const room = await HostelModel.getHostelRoomById(id, schoolId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Hostel room not found' });
    }
    return res.status(200).json({ success: true, data: room });
  } catch (err) {
    console.error('Error in getHostelRoomById:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.createHostelRoom = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { hostel_id, room_number, sort_order, status } = req.body;

    if (!hostel_id) {
      return res.status(400).json({ success: false, message: 'Hostel selection is required' });
    }
    if (!room_number || !room_number.trim()) {
      return res.status(400).json({ success: false, message: 'Room number is required' });
    }

    const insertId = await HostelModel.createHostelRoom({
      school_id: schoolId,
      hostel_id,
      room_number: room_number.trim(),
      sort_order: sort_order || 0,
      status: status !== undefined ? status : 1,
    });

    return res.status(201).json({
      success: true,
      message: 'Hostel room added successfully',
      id: insertId,
    });
  } catch (err) {
    console.error('Error in createHostelRoom:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.updateHostelRoom = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const { hostel_id, room_number, sort_order, status } = req.body;

    if (!hostel_id) {
      return res.status(400).json({ success: false, message: 'Hostel selection is required' });
    }
    if (!room_number || !room_number.trim()) {
      return res.status(400).json({ success: false, message: 'Room number is required' });
    }

    await HostelModel.updateHostelRoom(id, schoolId, {
      hostel_id,
      room_number: room_number.trim(),
      sort_order: sort_order || 0,
      status: status !== undefined ? status : 1,
    });

    return res.status(200).json({
      success: true,
      message: 'Hostel room updated successfully',
    });
  } catch (err) {
    console.error('Error in updateHostelRoom:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.deleteHostelRoom = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    await HostelModel.deleteHostelRoom(id, schoolId);
    return res.status(200).json({
      success: true,
      message: 'Hostel room deleted successfully',
    });
  } catch (err) {
    console.error('Error in deleteHostelRoom:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
