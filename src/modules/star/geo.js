const EARTH_RADIUS_METERS = 6371e3;
const toRad = (deg) => deg * Math.PI / 180;
const toDeg = (rad) => rad * 180 / Math.PI;
const normalizeDegrees = (deg) => (deg % 360 + 360) % 360;
const angularDifferenceDegrees = (a, b) => {
  const diff = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(diff, 360 - diff);
};
const haversineDistanceMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
};
const bearingDegrees = (from, to) => {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
};
const destinationPoint = (origin, distanceMeters, bearingDeg) => {
  const bearing = toRad(bearingDeg);
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    lat: toDeg(lat2),
    lng: (toDeg(lng2) + 540) % 360 - 180
  };
};
const formatDistance = (meters) => {
  if (meters >= 1e3) return `${(meters / 1e3).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
};
export {
  angularDifferenceDegrees,
  bearingDegrees,
  destinationPoint,
  formatDistance,
  haversineDistanceMeters,
  normalizeDegrees,
  toDeg,
  toRad
};
