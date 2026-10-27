const { pool } = require('../config/db.config');

/**
 * Teacher Self Attendance (geofence based check-in from the Teacher App)
 */
class TeacherSelfAttendanceModel {
  /**
   * Idempotent schema setup:
   *  - branch_master geofence columns
   *  - teacher_attendance audit columns (source, check-in time, coordinates ...)
   *  - one-record-per-teacher-per-day unique key (duplicates are backed up then removed)
   */
  static async initTable() {
    try {
      await TeacherSelfAttendanceModel.ensureBranchGeoColumns();
      await TeacherSelfAttendanceModel.ensureTeacherAttendanceColumns();
      await TeacherSelfAttendanceModel.ensureUniqueTeacherDay();
    } catch (err) {
      console.error('[TeacherSelfAttendanceModel] Error initializing schema:', err.message);
    }
  }

  static async getColumns(table) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
    return cols.map((c) => c.Field);
  }

  static async ensureBranchGeoColumns() {
    const cols = await TeacherSelfAttendanceModel.getColumns('branch_master');
    const defs = [
      ['latitude', 'DECIMAL(10,7) NULL DEFAULT NULL'],
      ['longitude', 'DECIMAL(10,7) NULL DEFAULT NULL'],
      ['geo_address', 'VARCHAR(500) NULL DEFAULT NULL'],
      ['attendance_radius_m', 'INT(11) NOT NULL DEFAULT 150'],
      ['gps_max_accuracy_m', 'INT(11) NOT NULL DEFAULT 100'],
      ['late_after', "TIME NOT NULL DEFAULT '09:30:00'"],
      ['working_days', "VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5,6' COMMENT 'ISO days Mon=1..Sun=7'"],
      ['geo_attendance_enabled', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Teacher App geofence attendance'"],
    ];
    for (const [name, def] of defs) {
      if (!cols.includes(name)) {
        await pool.query(`ALTER TABLE \`branch_master\` ADD COLUMN \`${name}\` ${def}`);
      }
    }
  }

  static async ensureTeacherAttendanceColumns() {
    const cols = await TeacherSelfAttendanceModel.getColumns('teacher_attendance');
    const defs = [
      ['source', "VARCHAR(10) NOT NULL DEFAULT 'admin' COMMENT 'admin | app | machine'"],
      ['check_in_time', 'DATETIME NULL DEFAULT NULL'],
      ['latitude', 'DECIMAL(10,7) NULL DEFAULT NULL'],
      ['longitude', 'DECIMAL(10,7) NULL DEFAULT NULL'],
      ['accuracy_m', 'DECIMAL(8,2) NULL DEFAULT NULL'],
      ['distance_m', 'DECIMAL(8,2) NULL DEFAULT NULL'],
      ['device_info', 'VARCHAR(255) NULL DEFAULT NULL'],
      ['marked_by', 'INT(11) NULL DEFAULT NULL'],
    ];
    for (const [name, def] of defs) {
      if (!cols.includes(name)) {
        await pool.query(`ALTER TABLE \`teacher_attendance\` ADD COLUMN \`${name}\` ${def}`);
      }
    }
    if (!cols.includes('att_date')) {
      await pool.query(
        'ALTER TABLE `teacher_attendance` ADD COLUMN `att_date` DATE GENERATED ALWAYS AS (DATE(`date`)) STORED'
      );
    }
  }

  static async ensureUniqueTeacherDay() {
    const [idx] = await pool.query(`SHOW INDEX FROM \`teacher_attendance\` WHERE Key_name = 'uq_teacher_day'`);
    if (idx.length > 0) return;

    // Back up and remove duplicates (keep the latest row per teacher per day)
    const [dups] = await pool.query(`
      SELECT COUNT(*) AS cnt FROM teacher_attendance t1
      INNER JOIN teacher_attendance t2
        ON t1.school_id <=> t2.school_id AND t1.teacher_id = t2.teacher_id
       AND t1.att_date = t2.att_date AND t1.id < t2.id
    `);
    if (Number(dups[0]?.cnt) > 0) {
      await pool.query(`CREATE TABLE IF NOT EXISTS teacher_attendance_dup_backup LIKE teacher_attendance`);
      await pool.query(`
        INSERT IGNORE INTO teacher_attendance_dup_backup (id, school_id, branch_id, teacher_id, attendance, notes, date, status)
        SELECT t1.id, t1.school_id, t1.branch_id, t1.teacher_id, t1.attendance, t1.notes, t1.date, t1.status
        FROM teacher_attendance t1
        INNER JOIN teacher_attendance t2
          ON t1.school_id <=> t2.school_id AND t1.teacher_id = t2.teacher_id
         AND t1.att_date = t2.att_date AND t1.id < t2.id
      `);
      await pool.query(`
        DELETE t1 FROM teacher_attendance t1
        INNER JOIN teacher_attendance t2
          ON t1.school_id <=> t2.school_id AND t1.teacher_id = t2.teacher_id
         AND t1.att_date = t2.att_date AND t1.id < t2.id
      `);
      console.warn(
        `[TeacherSelfAttendanceModel] Removed ${dups[0].cnt} duplicate teacher_attendance rows (backup: teacher_attendance_dup_backup).`
      );
    }

    await pool.query(
      'ALTER TABLE `teacher_attendance` ADD UNIQUE KEY `uq_teacher_day` (`school_id`, `teacher_id`, `att_date`)'
    );
  }

  /* =========================================================================
   * Queries
   * ========================================================================= */

  /**
   * Teacher + branch geofence configuration
   */
  static async getTeacherBranchConfig(teacherId, schoolId) {
    const [rows] = await pool.query(
      `SELECT
         t.id AS teacher_id, t.school_id, t.branch_id, t.status AS teacher_status,
         b.id AS b_id, b.branch_name, b.latitude, b.longitude, b.geo_address,
         b.attendance_radius_m, b.gps_max_accuracy_m, b.late_after, b.working_days,
         b.geo_attendance_enabled, b.status AS branch_status
       FROM teacher_master t
       LEFT JOIN branch_master b ON b.id = t.branch_id AND b.school_id = t.school_id
       WHERE t.id = ? AND t.school_id = ? AND t.status != 4
       LIMIT 1`,
      [teacherId, schoolId]
    );
    return rows[0] || null;
  }

  /**
   * Today's row (any status). The caller treats only status = 1 as "marked";
   * an inactive row is re-used on check-in because of the unique (teacher, day) key.
   */
  static async getTodayRecord(teacherId, schoolId, dateStr) {
    const [rows] = await pool.query(
      `SELECT id, attendance, source, check_in_time, distance_m, notes, status
       FROM teacher_attendance
       WHERE teacher_id = ? AND school_id = ? AND att_date = ?
       ORDER BY (status = 1) DESC, id DESC LIMIT 1`,
      [teacherId, schoolId, dateStr]
    );
    return rows[0] || null;
  }

  /**
   * Re-activate an inactive row for today with the app check-in data.
   */
  static async reuseRowForAppCheckIn(id, data) {
    await pool.query(
      `UPDATE teacher_attendance
       SET attendance = ?, notes = ?, status = 1, source = 'app', check_in_time = ?,
           latitude = ?, longitude = ?, accuracy_m = ?, distance_m = ?, device_info = ?,
           branch_id = COALESCE(?, branch_id), marked_by = NULL
       WHERE id = ? AND status != 1`,
      [
        data.attendance,
        data.notes || 'Self check-in (Teacher App)',
        data.checkInTime,
        data.latitude,
        data.longitude,
        data.accuracy,
        data.distance,
        data.deviceInfo ? String(data.deviceInfo).slice(0, 255) : null,
        data.branchId || null,
        id,
      ]
    );
    return id;
  }

  static async getTodayHoliday(schoolId, branchId, dateStr) {
    const [rows] = await pool.query(
      `SELECT id, title FROM holiday
       WHERE school_id = ? AND status = 1
         AND (branch_id IS NULL OR branch_id = 0 OR branch_id = ?)
         AND ? BETWEEN from_date AND COALESCE(to_date, from_date)
       ORDER BY id DESC LIMIT 1`,
      [schoolId, branchId || 0, dateStr]
    );
    return rows[0] || null;
  }

  /**
   * Approved leave covering today. duration: 1 = Full Day, 2 = Half Day, 3 = Multiple
   */
  static async getTodayApprovedLeave(teacherId, schoolId, dateStr) {
    try {
      const [rows] = await pool.query(
        `SELECT l.id, l.duration, lm.leave_name
         FROM leaves l
         INNER JOIN leaves_date ld ON ld.staff_leave_id = l.id
         LEFT JOIN leave_master lm ON lm.id = l.leave_id
         WHERE l.role = 1 AND l.staff_id = ? AND l.school_id = ?
           AND DATE(ld.date) = ? AND ld.status = 2
         ORDER BY (l.duration = 2) ASC, l.id DESC
         LIMIT 1`,
        [teacherId, schoolId, dateStr]
      );
      return rows[0] || null;
    } catch (err) {
      // leave_master may use a different name column in some installs
      const [rows] = await pool.query(
        `SELECT l.id, l.duration, NULL AS leave_name
         FROM leaves l
         INNER JOIN leaves_date ld ON ld.staff_leave_id = l.id
         WHERE l.role = 1 AND l.staff_id = ? AND l.school_id = ?
           AND DATE(ld.date) = ? AND ld.status = 2
         ORDER BY (l.duration = 2) ASC, l.id DESC
         LIMIT 1`,
        [teacherId, schoolId, dateStr]
      );
      return rows[0] || null;
    }
  }

  /**
   * Insert app check-in. Throws ER_DUP_ENTRY if already marked (unique key).
   */
  static async insertAppCheckIn({
    schoolId,
    branchId,
    teacherId,
    attendance,
    dateStr,
    checkInTime,
    latitude,
    longitude,
    accuracy,
    distance,
    deviceInfo,
    notes = 'Self check-in (Teacher App)',
  }) {
    const [result] = await pool.query(
      `INSERT INTO teacher_attendance
         (school_id, branch_id, teacher_id, attendance, notes, date, status,
          source, check_in_time, latitude, longitude, accuracy_m, distance_m, device_info)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'app', ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        branchId || null,
        teacherId,
        attendance,
        notes,
        dateStr,
        checkInTime,
        latitude,
        longitude,
        accuracy,
        distance,
        deviceInfo ? String(deviceInfo).slice(0, 255) : null,
      ]
    );
    return result.insertId;
  }
}

module.exports = TeacherSelfAttendanceModel;
