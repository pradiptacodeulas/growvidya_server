const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

class TeacherHostelController {
  static getTeacherId(req) {
    return req.user?.teacherId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    return req.user?.schoolId || req.user?.school_id || 1;
  }

  /**
   * Get Hostels strictly assigned to the logged-in teacher
   */
  static async getMyAssignedHostel(req, res, next) {
    try {
      const teacherId = TeacherHostelController.getTeacherId(req);
      const schoolId = TeacherHostelController.getSchoolId(req);

      // Query assigned hostel(s) for this specific teacher
      const [assignedHostels] = await pool.query(
        `SELECT 
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
           AND (th.status = 1 OR th.status IS NULL)
         ORDER BY th.id DESC`,
        [teacherId, schoolId]
      );

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
