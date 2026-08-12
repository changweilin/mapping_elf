const SQRT_3 = Math.sqrt(3);
const MIN_HEX_CELL_RADIUS_METERS = 250;
const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];
const getHexTargetRadiusMeters = (outerRadiusMeters, innerRadiusMeters) => Math.max(1, (outerRadiusMeters + Math.max(0, innerRadiusMeters)) / 2);
const normalizeHexCellRadius = (outerRadiusMeters, hexCellRadiusMeters, fallbackRadiusMeters = outerRadiusMeters) => {
  const requestedRadius = typeof hexCellRadiusMeters === "number" && Number.isFinite(hexCellRadiusMeters) ? hexCellRadiusMeters : fallbackRadiusMeters;
  return Math.max(
    MIN_HEX_CELL_RADIUS_METERS,
    Math.min(Math.max(MIN_HEX_CELL_RADIUS_METERS, outerRadiusMeters), requestedRadius)
  );
};
const toPlanarPoint = (distanceMeters, bearingDeg) => {
  const bearing = bearingDeg * Math.PI / 180;
  return {
    x: distanceMeters * Math.sin(bearing),
    y: distanceMeters * Math.cos(bearing)
  };
};
const planarDistanceMeters = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
const hexKey = ({ q, r }) => `${q},${r}`;
const roundHex = (q, r) => {
  const s = -q - r;
  let roundedQ = Math.round(q);
  let roundedR = Math.round(r);
  let roundedS = Math.round(s);
  const qDiff = Math.abs(roundedQ - q);
  const rDiff = Math.abs(roundedR - r);
  const sDiff = Math.abs(roundedS - s);
  if (qDiff > rDiff && qDiff > sDiff) {
    roundedQ = -roundedR - roundedS;
  } else if (rDiff > sDiff) {
    roundedR = -roundedQ - roundedS;
  } else {
    roundedS = -roundedQ - roundedR;
  }
  return { q: roundedQ, r: roundedR };
};
const pointToHex = ({ x, y }, cellRadiusMeters) => roundHex(
  (SQRT_3 / 3 * x - y / 3) / cellRadiusMeters,
  2 / 3 * y / cellRadiusMeters
);
const hexDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
const addHex = (a, b, scale = 1) => ({
  q: a.q + b.q * scale,
  r: a.r + b.r * scale
});
const getHexRing = (center, ring) => {
  if (ring === 0) return [center];
  const cells = [];
  let current = addHex(center, HEX_DIRECTIONS[4], ring);
  for (const direction of HEX_DIRECTIONS) {
    for (let step = 0; step < ring; step += 1) {
      cells.push(current);
      current = addHex(current, direction);
    }
  }
  return cells;
};
const getHexCellCenterPlanar = (cell, cellRadiusMeters) => ({
  x: cellRadiusMeters * SQRT_3 * (cell.q + cell.r / 2),
  y: cellRadiusMeters * 1.5 * cell.r
});
export {
  addHex,
  getHexCellCenterPlanar,
  getHexRing,
  getHexTargetRadiusMeters,
  hexDistance,
  hexKey,
  normalizeHexCellRadius,
  planarDistanceMeters,
  pointToHex,
  roundHex,
  toPlanarPoint
};
