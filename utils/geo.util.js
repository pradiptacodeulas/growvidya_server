/**
 * Geo helpers used by geofence-based (location) attendance.
 */

const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (Number(deg) * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates in meters (Haversine formula).
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Validate a latitude / longitude pair.
 */
function isValidLatLng(lat, lng) {
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') {
    return false;
  }
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

module.exports = { haversineMeters, isValidLatLng };
