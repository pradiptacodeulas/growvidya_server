/**
 * Teacher Geofence (Location) Attendance Migration
 *
 * - branch_master: latitude, longitude, geo_address, attendance_radius_m, gps_max_accuracy_m,
 *                  late_after, working_days, geo_attendance_enabled
 * - teacher_attendance: source, check_in_time, latitude, longitude, accuracy_m, distance_m,
 *                       device_info, marked_by, att_date (generated) + UNIQUE (school_id, teacher_id, att_date)
 *   Duplicate rows per teacher/day are backed up into teacher_attendance_dup_backup before removal.
 *
 * The same logic also runs automatically on server start (TeacherSelfAttendanceModel.initTable()).
 * Run manually: node scripts/teacher_geofence_attendance_migration.js
 */
const { pool } = require('../config/db.config');
const TeacherSelfAttendanceModel = require('../models/teacherSelfAttendance.model');

async function runTeacherGeofenceAttendanceMigration() {
  try {
    console.log('--- Starting Teacher Geofence Attendance Migration ---');

    await TeacherSelfAttendanceModel.ensureBranchGeoColumns();
    console.log('✔ branch_master geofence columns ensured');

    await TeacherSelfAttendanceModel.ensureTeacherAttendanceColumns();
    console.log('✔ teacher_attendance audit columns ensured');

    await TeacherSelfAttendanceModel.ensureUniqueTeacherDay();
    console.log('✔ unique (school_id, teacher_id, att_date) key ensured');

    console.log('--- Teacher Geofence Attendance Migration completed ---');
  } catch (err) {
    console.error('✘ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runTeacherGeofenceAttendanceMigration();
}

module.exports = runTeacherGeofenceAttendanceMigration;
