const TeacherSelfAttendanceModel = require('../models/teacherSelfAttendance.model');
const ApiResponse = require('../utils/api.response');
const { haversineMeters, isValidLatLng } = require('../utils/geo.util');
const { nowInTz, toSchoolIso } = require('../utils/schoolTime.util');

const ATTENDANCE_LABELS = { 0: 'Absent', 1: 'Present', 2: 'Late', 3: 'Half Day' };

/* ---------------------------------------------------------------------------
 * Simple in-memory rate limiter for check-in (per teacher)
 * ------------------------------------------------------------------------- */
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 10;
const rateBuckets = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) rateBuckets.delete(k);
    }
  }
  return hits.length > RATE_MAX;
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */
const formatTime12 = (hhmmss) => {
  if (!hhmmss) return '';
  const [h, m] = String(hhmmss).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
};

const timePartOf = (dateTime) => (dateTime ? String(dateTime).replace('T', ' ').slice(11, 19) : null);

class TeacherSelfAttendanceController {
  static getContext(req) {
    const isTeacherToken =
      String(req.user?.roleName || req.user?.role || '').toLowerCase() === 'teacher' ||
      req.user?.portalType === 'TeacherPortal';
    const teacherId = Number(req.user?.teacherId || (isTeacherToken ? req.user?.userId || req.user?.id : 0) || 0);
    const schoolId = Number(req.user?.schoolId || req.user?.school_id || 0);
    if (!teacherId) {
      const err = new Error('Only teacher accounts can mark self attendance.');
      err.statusCode = 403;
      throw err;
    }
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }
    return { teacherId, schoolId };
  }

  /**
   * Builds the full status for the teacher for "today" (school timezone).
   * Shared by GET /status and POST /check-in (validation order is identical).
   */
  static async buildStatus(teacherId, schoolId) {
    const now = nowInTz();
    const cfg = await TeacherSelfAttendanceModel.getTeacherBranchConfig(teacherId, schoolId);
    if (!cfg) {
      const err = new Error('Teacher account not found.');
      err.statusCode = 404;
      throw err;
    }

    const lateAfter = cfg.late_after ? String(cfg.late_after).slice(0, 8) : '09:30:00';
    const hasPin = isValidLatLng(cfg.latitude, cfg.longitude);
    const geofenceReady = Boolean(cfg.b_id) && hasPin && Number(cfg.geo_attendance_enabled) === 1;

    const geofence = geofenceReady
      ? {
          latitude: Number(cfg.latitude),
          longitude: Number(cfg.longitude),
          radius_m: Number(cfg.attendance_radius_m) || 150,
          max_accuracy_m: Number(cfg.gps_max_accuracy_m) || 100,
          late_after: lateAfter.slice(0, 5),
          address: cfg.geo_address || null,
        }
      : null;

    const record = await TeacherSelfAttendanceModel.getTodayRecord(teacherId, schoolId, now.dateStr);
    const marked = Boolean(record && Number(record.status) === 1);
    const today = {
      marked,
      attendance: marked ? Number(record.attendance) : null,
      label: marked ? ATTENDANCE_LABELS[Number(record.attendance)] || 'Marked' : null,
      check_in_time: marked ? toSchoolIso(record.check_in_time) : null,
      source: marked ? record.source || 'admin' : null,
      distance_m: marked && record.distance_m !== null ? Number(record.distance_m) : null,
    };

    const leave = await TeacherSelfAttendanceModel.getTodayApprovedLeave(teacherId, schoolId, now.dateStr);
    const halfDayLeave = Boolean(leave && Number(leave.duration) === 2);

    const status = {
      server_time: now.iso,
      date: now.dateStr,
      branch: cfg.b_id ? { id: Number(cfg.b_id), name: cfg.branch_name } : null,
      geofence,
      today,
      half_day_leave: halfDayLeave,
      blocked: false,
      reason: null,
      message: null,
      extra: {},
      will_be_late: !halfDayLeave && now.timeStr > lateAfter,
    };

    const block = (reason, message, extra = {}) => {
      status.blocked = true;
      status.reason = reason;
      status.message = message;
      status.extra = extra;
      return status;
    };

    // 1. Location configured?
    if (!geofenceReady) {
      return {
        status: block(
          'GEOFENCE_NOT_SET',
          'Attendance location is not configured for your branch. Please contact the school admin.'
        ),
        cfg,
        now,
        record,
      };
    }

    // 2. Holiday
    const holiday = await TeacherSelfAttendanceModel.getTodayHoliday(schoolId, cfg.branch_id, now.dateStr);
    if (holiday) {
      return {
        status: block('HOLIDAY', `Today is a holiday${holiday.title ? `: ${holiday.title}` : ''}. Attendance is not required.`, {
          title: holiday.title || null,
        }),
        cfg,
        now,
        record,
      };
    }

    // 3. Weekly off
    const workingDays = String(cfg.working_days || '1,2,3,4,5,6')
      .split(',')
      .map((d) => Number(d.trim()));
    if (!workingDays.includes(now.isoDay)) {
      return { status: block('WEEKLY_OFF', 'Today is a weekly off. Attendance is not required.'), cfg, now, record };
    }

    // 4. Approved full-day / multiple-day leave (half-day leave is allowed)
    if (leave && !halfDayLeave) {
      return {
        status: block(
          'ON_LEAVE',
          `You are on approved leave today${leave.leave_name ? ` (${leave.leave_name})` : ''}. Attendance cannot be marked.`,
          { leave_name: leave.leave_name || null }
        ),
        cfg,
        now,
        record,
      };
    }

    // 5. Already marked (by app or admin)
    if (marked) {
      const timeTxt = today.check_in_time ? ` at ${formatTime12(timePartOf(record.check_in_time))}` : '';
      const msg =
        today.source === 'admin'
          ? `Your attendance has already been marked by the admin: ${today.label}.`
          : `Attendance already marked${timeTxt}: ${today.label}.`;
      return {
        status: block('ALREADY_MARKED', msg, {
          attendance: today.attendance,
          label: today.label,
          check_in_time: today.check_in_time,
          source: today.source,
        }),
        cfg,
        now,
        record,
      };
    }

    return { status, cfg, now, record };
  }

  /**
   * GET /teacher/attendance/self/status
   */
  static async getStatus(req, res, next) {
    try {
      const { teacherId, schoolId } = TeacherSelfAttendanceController.getContext(req);
      const { status } = await TeacherSelfAttendanceController.buildStatus(teacherId, schoolId);
      const { extra, ...payload } = status;
      return ApiResponse.success(res, 'Attendance status fetched successfully.', payload);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /teacher/attendance/self/check-in
   * Body: { latitude, longitude, accuracy, is_mocked, device_info }
   */
  static async checkIn(req, res, next) {
    try {
      const { teacherId, schoolId } = TeacherSelfAttendanceController.getContext(req);

      if (isRateLimited(`${schoolId}:${teacherId}`)) {
        return ApiResponse.error(res, 'Too many attempts. Please wait a few minutes and try again.', { code: 'RATE_LIMITED' }, 429);
      }

      const { latitude, longitude, accuracy, is_mocked, device_info } = req.body || {};
      if (!isValidLatLng(latitude, longitude)) {
        return ApiResponse.error(res, 'Unable to read your location. Please enable GPS and try again.', { code: 'INVALID_LOCATION' }, 400);
      }

      const { status, cfg, now, record } = await TeacherSelfAttendanceController.buildStatus(teacherId, schoolId);

      if (status.blocked) {
        const httpByReason = { GEOFENCE_NOT_SET: 400, HOLIDAY: 403, WEEKLY_OFF: 403, ON_LEAVE: 403, ALREADY_MARKED: 409 };
        return ApiResponse.error(res, status.message, { code: status.reason, ...status.extra }, httpByReason[status.reason] || 403);
      }

      // 6. Mock / fake GPS
      if (is_mocked === true || is_mocked === 'true' || Number(is_mocked) === 1) {
        return ApiResponse.error(res, 'Fake GPS detected. Please disable mock location apps and try again.', { code: 'MOCK_LOCATION' }, 403);
      }

      // 7. GPS accuracy
      const geofence = status.geofence;
      const acc = Number(accuracy);
      if (!Number.isFinite(acc) || acc <= 0 || acc > geofence.max_accuracy_m) {
        const shown = Number.isFinite(acc) ? Math.round(acc) : null;
        return ApiResponse.error(
          res,
          `GPS signal is weak${shown ? ` (±${shown} m)` : ''}. Move to an open area and try again.`,
          { code: 'LOW_ACCURACY', accuracy_m: shown, max_accuracy_m: geofence.max_accuracy_m },
          422
        );
      }

      // 8. Distance from campus pin
      const distance = haversineMeters(Number(latitude), Number(longitude), geofence.latitude, geofence.longitude);
      const distanceRounded = Math.round(distance * 100) / 100;
      if (distance > geofence.radius_m) {
        return ApiResponse.error(
          res,
          `You are ${Math.round(distance)} m away from campus. Allowed range: ${geofence.radius_m} m.`,
          { code: 'OUTSIDE_RADIUS', distance_m: Math.round(distance), radius_m: geofence.radius_m },
          403
        );
      }

      // 9. Decide status: Half Day (approved half-day leave) > Late > Present
      const lateAfter = `${geofence.late_after}:00`.slice(0, 8);
      let attendance = 1;
      if (status.half_day_leave) attendance = 3;
      else if (now.timeStr > lateAfter) attendance = 2;

      const data = {
        schoolId,
        branchId: cfg.branch_id,
        teacherId,
        attendance,
        dateStr: now.dateStr,
        checkInTime: now.dateTimeStr,
        latitude: Number(Number(latitude).toFixed(7)),
        longitude: Number(Number(longitude).toFixed(7)),
        accuracy: Math.round(acc * 100) / 100,
        distance: distanceRounded,
        deviceInfo: device_info,
        notes: status.half_day_leave ? 'Self check-in (Teacher App) - Half day leave' : 'Self check-in (Teacher App)',
      };

      try {
        if (record && Number(record.status) !== 1) {
          await TeacherSelfAttendanceModel.reuseRowForAppCheckIn(record.id, data);
        } else {
          await TeacherSelfAttendanceModel.insertAppCheckIn(data);
        }
      } catch (dbErr) {
        if (dbErr && dbErr.code === 'ER_DUP_ENTRY') {
          return ApiResponse.error(res, 'Attendance has already been marked for today.', { code: 'ALREADY_MARKED' }, 409);
        }
        throw dbErr;
      }

      const label = ATTENDANCE_LABELS[attendance];
      return ApiResponse.success(
        res,
        `Attendance marked ${label} at ${formatTime12(now.timeStr)}.`,
        {
          attendance,
          label,
          check_in_time: now.iso,
          distance_m: Math.round(distance),
          message: `Attendance marked ${label} at ${formatTime12(now.timeStr)}.`,
        },
        201
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = TeacherSelfAttendanceController;
