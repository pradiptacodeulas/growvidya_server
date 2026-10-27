/**
 * Validation / normalization of branch attendance-location (geofence) fields.
 * Used by branch create, update and PATCH /:id/attendance-location.
 */
const { isValidLatLng } = require('./geo.util');
const { normalizeTime } = require('./schoolTime.util');

const GEO_FIELDS = [
  'latitude',
  'longitude',
  'geo_address',
  'attendance_radius_m',
  'gps_max_accuracy_m',
  'late_after',
  'working_days',
  'geo_attendance_enabled',
];

const GEO_DEFAULTS = {
  latitude: null,
  longitude: null,
  geo_address: null,
  attendance_radius_m: 150,
  gps_max_accuracy_m: 100,
  late_after: '09:30:00',
  working_days: '1,2,3,4,5,6',
  geo_attendance_enabled: 0,
};

const RADIUS_MIN = 20;
const RADIUS_MAX = 2000;
const ACCURACY_MIN = 10;
const ACCURACY_MAX = 500;

/**
 * Whether the payload contains at least one geofence field.
 */
function hasGeoFields(body = {}) {
  return GEO_FIELDS.some((f) => body[f] !== undefined);
}

const isBlank = (v) => v === null || v === undefined || v === '';

/**
 * Merge payload over existing (or defaults), validate, and return a DB-ready object.
 * @param {object} body     incoming request body
 * @param {object} existing existing branch row (optional, for partial updates)
 * @returns {{ value: object|null, error: string|null }}
 */
function normalizeBranchLocation(body = {}, existing = null) {
  const base = { ...GEO_DEFAULTS };
  if (existing) {
    GEO_FIELDS.forEach((f) => {
      if (existing[f] !== undefined && existing[f] !== null) base[f] = existing[f];
    });
  }
  const merged = { ...base };
  GEO_FIELDS.forEach((f) => {
    if (body[f] !== undefined) merged[f] = body[f];
  });

  // Lat / Lng (both or none)
  let latitude = null;
  let longitude = null;
  if (!isBlank(merged.latitude) || !isBlank(merged.longitude)) {
    if (!isValidLatLng(merged.latitude, merged.longitude)) {
      return { value: null, error: 'Invalid location. Latitude must be between -90 and 90 and longitude between -180 and 180.' };
    }
    latitude = Number(Number(merged.latitude).toFixed(7));
    longitude = Number(Number(merged.longitude).toFixed(7));
  }

  const enabledRaw = merged.geo_attendance_enabled;
  const enabled = enabledRaw === true || enabledRaw === 'true' || Number(enabledRaw) === 1 ? 1 : 0;
  if (enabled && (latitude === null || longitude === null)) {
    return { value: null, error: 'Please pin the branch location on the map to enable Teacher App attendance.' };
  }

  const radius = Number(merged.attendance_radius_m);
  if (!Number.isFinite(radius) || radius < RADIUS_MIN || radius > RADIUS_MAX) {
    return { value: null, error: `Attendance radius must be between ${RADIUS_MIN} and ${RADIUS_MAX} meters.` };
  }

  const accuracy = Number(merged.gps_max_accuracy_m);
  if (!Number.isFinite(accuracy) || accuracy < ACCURACY_MIN || accuracy > ACCURACY_MAX) {
    return { value: null, error: `Max GPS accuracy must be between ${ACCURACY_MIN} and ${ACCURACY_MAX} meters.` };
  }

  const lateAfter = normalizeTime(merged.late_after);
  if (!lateAfter) {
    return { value: null, error: 'Late-after time must be a valid time (HH:mm).' };
  }

  const daysSource = Array.isArray(merged.working_days) ? merged.working_days : String(merged.working_days || '').split(',');
  const days = [...new Set(daysSource.map((d) => Number(String(d).trim())).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
    (a, b) => a - b
  );
  if (days.length === 0) {
    return { value: null, error: 'Select at least one working day.' };
  }

  const address = isBlank(merged.geo_address) ? null : String(merged.geo_address).trim().slice(0, 500);

  return {
    value: {
      latitude,
      longitude,
      geo_address: address,
      attendance_radius_m: Math.round(radius),
      gps_max_accuracy_m: Math.round(accuracy),
      late_after: lateAfter,
      working_days: days.join(','),
      geo_attendance_enabled: enabled,
    },
    error: null,
  };
}

module.exports = {
  GEO_FIELDS,
  GEO_DEFAULTS,
  hasGeoFields,
  normalizeBranchLocation,
};
