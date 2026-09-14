const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

class TeacherTransportController {
  static getTeacherId(req) {
    return req.user?.teacherId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    return req.user?.schoolId || req.user?.school_id || 1;
  }

  /**
   * Get transport/route/vehicle strictly assigned to the logged-in teacher
   */
  static async getMyAssignedTransport(req, res, next) {
    try {
      const teacherId = TeacherTransportController.getTeacherId(req);
      const schoolId = TeacherTransportController.getSchoolId(req);

      const [assignedTransports] = await pool.query(
        `SELECT 
           tt.id,
           tt.school_id,
           tt.teacher_id,
           tt.academic_year AS academic_year_id,
           tt.route AS route_id,
           tt.vehicle_number,
           tt.pickup_point,
           tt.drop_point,
           tt.staus AS status,
           trm.transport_route AS route_name,
           trm.fare AS route_fare,
           bm.id AS bus_id,
           bm.name AS vehicle_name,
           bm.number_plate,
           bm.seat AS vehicle_capacity,
           bm.color AS vehicle_color,
           NULLIF(TRIM(MAX(IF(op.type = 1, CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')), NULL))), '') AS driver_name,
           MAX(IF(op.type = 1, op.phone, NULL)) AS driver_phone,
           NULLIF(TRIM(MAX(IF(op.type = 2, CONCAT(IFNULL(op.first_name, ''), ' ', IFNULL(op.last_name, '')), NULL))), '') AS helper_name,
           MAX(IF(op.type = 2, op.phone, NULL)) AS helper_phone,
           aym.academic_year AS academic_year_label
         FROM teacher_transport tt
         LEFT JOIN trans_route_master trm ON tt.route = trm.id
         LEFT JOIN bus_master bm ON (trm.bus_id = bm.id OR tt.vehicle_number = bm.id)
         LEFT JOIN bus_to_operator bo ON (bm.id = bo.bus_id AND (bo.status != 0 OR bo.status IS NULL))
         LEFT JOIN operator_master op ON (bo.operator_id = op.id AND (op.status != 0 OR op.status IS NULL))
         LEFT JOIN academic_year_master aym ON tt.academic_year = aym.id
         WHERE tt.teacher_id = ? 
           AND tt.school_id = ?
           AND (tt.staus = 1 OR tt.staus IS NULL)
         GROUP BY 
           tt.id, tt.school_id, tt.teacher_id, tt.academic_year, tt.route, 
           tt.vehicle_number, tt.pickup_point, tt.drop_point, tt.staus, 
           trm.transport_route, trm.fare, bm.id, bm.name, bm.number_plate, 
           bm.seat, bm.color, aym.academic_year
         ORDER BY tt.id DESC`,
        [teacherId, schoolId, schoolId]
      );

      return ApiResponse.success(res, 'Assigned transport fetched successfully', {
        transports: assignedTransports || [],
        assigned_transport: assignedTransports && assignedTransports.length > 0 ? assignedTransports[0] : null,
      });
    } catch (error) {
      console.error('Error in TeacherTransportController.getMyAssignedTransport:', error);
      next(error);
    }
  }
}

module.exports = TeacherTransportController;
