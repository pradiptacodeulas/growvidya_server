const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

class TeacherHostelController {
  static getTeacherId(req) {
    return req.user?.teacherId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    const schoolId = req.user?.schoolId || req.user?.school_id;
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }
    return Number(schoolId);
  }

  /**
   * Get Hostels strictly assigned to the logged-in teacher
   */
  static async getMyAssignedHostel(req, res, next) {
    try {
      const teacherId = TeacherHostelController.getTeacherId(req);
      const schoolId = TeacherHostelController.getSchoolId(req);
      const branchId = req.branchId || req.query?.branch_id || req.query?.branchId || null;

      // Query assigned hostel(s) for this specific teacher
      let query = `SELECT 
           th.id,
           th.teacher_id,
           th.academic_year AS academic_year_id,
           th.hostel_name AS hostel_id,
           th.room_number AS room_id,
           th.status,
           th.created_at,
           hnm.hostel_name,
           hnm.hostel_fee,
           hrm.room_number,
           aym.academic_year AS academic_year_label
         FROM teacher_hostel th
         LEFT JOIN hostel_name_master hnm ON th.hostel_name = hnm.id
         LEFT JOIN hostel_room_master hrm ON th.room_number = hrm.id
         LEFT JOIN academic_year_master aym ON th.academic_year = aym.id
         WHERE th.teacher_id = ? 
           AND th.school_id = ?
           AND (th.status = 1 OR th.status IS NULL)`;
      const params = [teacherId, schoolId];
      if (branchId) {
        query += ` AND (hnm.branch_id = ? OR hrm.branch_id = ? OR hnm.branch_id IS NULL)`;
        params.push(Number(branchId), Number(branchId));
      }
      query += ` ORDER BY th.id DESC`;

      const [assignedHostels] = await pool.query(query, params);

      return ApiResponse.success(res, 'Assigned hostel fetched successfully', {
        hostels: assignedHostels || [],
        assigned_hostel: assignedHostels && assignedHostels.length > 0 ? assignedHostels[0] : null,
      });
    } catch (error) {
      console.error('Error in TeacherHostelController.getMyAssignedHostel:', error);
      next(error);
    }
  }
}

module.exports = TeacherHostelController;
