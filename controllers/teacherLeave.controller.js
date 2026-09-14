const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

class TeacherLeaveController {
  static getTeacherId(req) {
    return req.user?.teacherId || req.user?.userId || req.user?.id;
  }

  static getSchoolId(req) {
    return req.user?.schoolId || req.user?.school_id || 1;
  }

  /**
   * Fetch all applied leaves strictly for the logged-in teacher
   */
  static async getMyLeaves(req, res, next) {
    try {
      const teacherId = TeacherLeaveController.getTeacherId(req);
      const schoolId = TeacherLeaveController.getSchoolId(req);
      const { search } = req.query;

      let sql = `
        SELECT 
          l.id,
          l.school_id,
          l.role,
          l.staff_id,
          l.leave_id,
          lm.leave_name,
          l.duration,
          CASE 
            WHEN l.duration = 1 THEN 'Full Day'
            WHEN l.duration = 2 THEN 'Half Day'
            WHEN l.duration = 3 THEN 'Multiple'
            ELSE 'Full Day'
          END AS duration_label,
          l.document,
          l.leave_reason,
          l.status AS leave_status,
          l.created_at,
          COALESCE(
            (SELECT MIN(ld.date) FROM leaves_date ld WHERE ld.staff_leave_id = l.id),
            DATE(l.created_at)
          ) AS leave_date,
          (SELECT GROUP_CONCAT(DATE_FORMAT(ld.date, '%Y-%m-%d') ORDER BY ld.date ASC SEPARATOR ', ') 
           FROM leaves_date ld WHERE ld.staff_leave_id = l.id) AS leave_dates_str
        FROM leaves l
        LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
        WHERE l.school_id = ?
          AND l.role = 1 
          AND l.staff_id = ?
          AND l.status != 4 AND l.status != 0
      `;

      const params = [schoolId, teacherId];

      if (search && search.trim()) {
        sql += ` AND (lm.leave_name LIKE ? OR l.leave_reason LIKE ?)`;
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }

      sql += ` ORDER BY l.id DESC`;

      const [rows] = await pool.query(sql, params);
      return ApiResponse.success(res, 'Teacher leaves fetched successfully.', { leaves: rows || [] });
    } catch (error) {
      console.error('Error in TeacherLeaveController.getMyLeaves:', error);
      next(error);
    }
  }

  /**
   * Fetch single leave details by ID
   */
  static async getMyLeaveById(req, res, next) {
    try {
      const teacherId = TeacherLeaveController.getTeacherId(req);
      const schoolId = TeacherLeaveController.getSchoolId(req);
      const { id } = req.params;

      const [rows] = await pool.query(
        `SELECT 
           l.id,
           l.school_id,
           l.role,
           l.staff_id,
           l.leave_id,
           lm.leave_name,
           l.duration,
           CASE 
             WHEN l.duration = 1 THEN 'Full Day'
             WHEN l.duration = 2 THEN 'Half Day'
             WHEN l.duration = 3 THEN 'Multiple'
             ELSE 'Full Day'
           END AS duration_label,
           l.document,
           l.leave_reason,
           l.status AS leave_status,
           l.created_at,
           COALESCE(
             (SELECT MIN(ld.date) FROM leaves_date ld WHERE ld.staff_leave_id = l.id),
             DATE(l.created_at)
           ) AS leave_date
         FROM leaves l
         LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND lm.school_id = l.school_id)
         WHERE l.id = ? 
           AND l.role = 1 
           AND l.staff_id = ?
           AND l.school_id = ?
           AND l.status != 4 AND l.status != 0`,
        [id, teacherId, schoolId]
      );

      if (!rows || rows.length === 0) {
        return ApiResponse.error(res, 'Leave record not found.', null, 404);
      }

      const leave = rows[0];

      // Fetch individual leave dates
      const [dates] = await pool.query(
        `SELECT id, staff_leave_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, status 
         FROM leaves_date 
         WHERE staff_leave_id = ? 
         ORDER BY date ASC`,
        [id]
      );

      leave.dates = dates || [];
      return ApiResponse.success(res, 'Leave details fetched successfully.', { leave });
    } catch (error) {
      console.error('Error in TeacherLeaveController.getMyLeaveById:', error);
      next(error);
    }
  }

  /**
   * Fetch active leave types for teachers (role = 1)
   */
  static async getTeacherLeaveTypes(req, res, next) {
    try {
      const schoolId = TeacherLeaveController.getSchoolId(req);
      const [types] = await pool.query(
        `SELECT id, leave_name, need_document, no_leave, sort_order, status 
         FROM leave_master 
         WHERE school_id = ? 
           AND role = 1 
           AND status = 1 
         ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return ApiResponse.success(res, 'Teacher leave types fetched successfully.', { types: types || [] });
    } catch (error) {
      console.error('Error in TeacherLeaveController.getTeacherLeaveTypes:', error);
      next(error);
    }
  }

  /**
   * Apply for a new leave request
   */
  static async applyLeave(req, res, next) {
    try {
      const teacherId = TeacherLeaveController.getTeacherId(req);
      const schoolId = TeacherLeaveController.getSchoolId(req);
      const { leave_id, duration, document, leave_reason, dates = [] } = req.body;

      if (!leave_id || !duration) {
        return ApiResponse.error(res, 'Leave type and duration are required.', null, 400);
      }

      // 1. Insert into leaves table (status = 1 for pending in leaves table)
      const [result] = await pool.query(
        `INSERT INTO leaves (school_id, role, staff_id, leave_id, duration, document, leave_reason, status)
         VALUES (?, 1, ?, ?, ?, ?, ?, 1)`,
        [
          schoolId,
          teacherId,
          Number(leave_id),
          Number(duration),
          document || '',
          leave_reason || '',
        ]
      );

      const leaveId = result.insertId;

      // 2. Insert into leaves_date
      if (Array.isArray(dates) && dates.length > 0) {
        for (const d of dates) {
          if (d) {
            await pool.query(
              `INSERT INTO leaves_date (school_id, staff_leave_id, date, status)
               VALUES (?, ?, ?, 1)`,
              [schoolId, leaveId, d]
            );
          }
        }
      }

      return ApiResponse.success(res, 'Leave applied successfully.', { leaveId }, 201);
    } catch (error) {
      console.error('Error in TeacherLeaveController.applyLeave:', error);
      next(error);
    }
  }
}

module.exports = TeacherLeaveController;
