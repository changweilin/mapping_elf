/**
 * Mapping Elf — Shape Route Planner
 *
 * Pure geometry for the drawing-board tool: turns a freehand stroke drawn in
 * canvas pixels into a georeferenced waypoint loop near an anchor location,
 * sized to a target running distance. No DOM, no fetch — main.js wires the UI
 * and hands the resulting waypoints to the normal routing pipeline (O-loop
 * mode closes the ring, so the waypoints here are distinct — no duplicate of
 * the start point at the end).
 *
 * Canvas y grows downward while latitude grows upward; the flip happens once
 * in strokeToLatLngRing (the only pixel→geo boundary, mirroring the routeEngine
 * coordinate-order rule).
 */
import { haversineDistance } from './utils.js';

const M_PER_DEG_LAT = 111320;

/**
 * Clean a raw freehand stroke ([[x, y], ...] canvas pixels) and resample it as
 * a closed ring of `n` points evenly spaced along its arc length. The implicit
 * closing segment (last → first) is included in the arc length so a stroke the
 * user didn't quite close still becomes a sensible loop.
 * Returns null when the stroke is degenerate (too few points / zero length).
 */
export function resampleClosedStroke(rawPoints, n = 96) {
  if (!Array.isArray(rawPoints) || n < 3) return null;
  const pts = [];
  for (const p of rawPoints) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < 1e-6 && Math.abs(prev[1] - p[1]) < 1e-6) continue;
    pts.push([p[0], p[1]]);
  }
  if (pts.length < 3) return null;

  // Closed-ring vertex list: implicit segment from last back to first.
  const ringLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + ringLen(pts[i - 1], pts[i]));
  const total = cum[pts.length - 1] + ringLen(pts[pts.length - 1], pts[0]);
  if (!(total > 0)) return null;

  const out = [];
  const step = total / n;
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < pts.length - 1 && cum[seg + 1] < target) seg++;
    const a = pts[seg];
    const b = seg < pts.length - 1 ? pts[seg + 1] : pts[0];
    const segStart = cum[seg];
    const segSpan = (seg < pts.length - 1 ? cum[seg + 1] : total) - segStart || 1;
    const t = Math.min(1, Math.max(0, (target - segStart) / segSpan));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Perimeter of a closed [lat,lng] ring in metres (includes last→first leg). */
export function ringPerimeter(ring) {
  if (!Array.isArray(ring) || ring.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < ring.length; i++) d += haversineDistance(ring[i - 1], ring[i]);
  d += haversineDistance(ring[ring.length - 1], ring[0]);
  return d;
}

/**
 * Convert a freehand canvas stroke into a closed [lat,lng] ring whose
 * perimeter is `targetDistanceM`, placed so the ring passes through `anchor`
 * ([lat, lng], e.g. the user's current location) at index 0 — the run starts
 * exactly where the user is and loops out from there.
 * `options.rotationDeg` rotates the shape counterclockwise around its centroid
 * before georeferencing (used by the angle-tolerance orientation search).
 * Returns null when the stroke is unusable.
 */
export function strokeToLatLngRing(rawPoints, anchor, targetDistanceM, options = {}) {
  const samples = options.samples || 96;
  if (!Array.isArray(anchor) || !Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) return null;
  if (!(targetDistanceM > 0)) return null;
  const ring = resampleClosedStroke(rawPoints, samples);
  if (!ring) return null;

  // Centre on the stroke centroid, flip canvas y to map north.
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let local = ring.map(([x, y]) => [x - cx, -(y - cy)]);

  const rot = ((Number(options.rotationDeg) || 0) * Math.PI) / 180;
  if (rot) {
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    local = local.map(([x, y]) => [x * cosR - y * sinR, x * sinR + y * cosR]);
  }

  // Uniform scale so the pixel perimeter (with closing leg) matches the target.
  let perimPx = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    perimPx += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (!(perimPx > 0)) return null;
  const scale = targetDistanceM / perimPx;

  const cosLat = Math.max(0.01, Math.cos((anchor[0] * Math.PI) / 180));
  let geo = local.map(([mx, my]) => [
    anchor[0] + (my * scale) / M_PER_DEG_LAT,
    anchor[1] + (mx * scale) / (M_PER_DEG_LAT * cosLat),
  ]);

  // Shift the ring so its vertex nearest the anchor sits exactly on the
  // anchor, then rotate the array to start there.
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < geo.length; i++) {
    const d = haversineDistance(anchor, geo[i]);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  const dLat = anchor[0] - geo[bestIdx][0];
  const dLng = anchor[1] - geo[bestIdx][1];
  geo = geo.map(([la, ln]) => [la + dLat, ln + dLng]);
  return [...geo.slice(bestIdx), ...geo.slice(0, bestIdx)];
}

/**
 * Pick `count` waypoints evenly spaced (by arc length) along a closed
 * [lat,lng] ring, starting at index 0 (the anchor / run start). Returns
 * distinct points only — O-loop routing adds the return to start.
 */
export function pickShapeWaypoints(ring, count) {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const n = Math.max(3, Math.min(count | 0 || 3, ring.length));
  const cum = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + haversineDistance(ring[i - 1], ring[i]));
  const total = cum[ring.length - 1] + haversineDistance(ring[ring.length - 1], ring[0]);
  if (!(total > 0)) return [];
  const out = [];
  let idx = 0;
  for (let k = 0; k < n; k++) {
    const target = (k * total) / n;
    while (idx < ring.length - 1 && cum[idx + 1] <= target) idx++;
    out.push([ring[idx][0], ring[idx][1]]);
  }
  // Guarantee the start is the anchor vertex exactly.
  out[0] = [ring[0][0], ring[0][1]];
  return out;
}

/**
 * Waypoint count for a target distance and drawing complexity: enough to pin
 * the router to the drawn shape without exceeding what the free routing
 * endpoints handle comfortably. More strokes (筆畫) and more corners raise
 * the count so intricate shapes keep their detail.
 */
export function suggestWaypointCount(targetDistanceM, options = {}) {
  const km = (targetDistanceM || 0) / 1000;
  const strokeCount = Math.max(1, (options.strokeCount | 0) || 1);
  const corners = Math.max(0, options.corners | 0);
  const base = Math.round(km * 1.6);
  const complexity = 4 + corners + (strokeCount - 1) * 2;
  return Math.max(6, Math.min(16, Math.max(base, complexity)));
}

/**
 * Count sharp direction changes (> thresholdDeg) on the resampled closed
 * stroke — a proxy for how intricate the drawn shape is (square → 4).
 */
export function countShapeCorners(rawPoints, options = {}) {
  const samples = options.samples || 48;
  const thresholdDeg = options.thresholdDeg || 35;
  const ring = resampleClosedStroke(rawPoints, samples);
  if (!ring) return 0;
  let corners = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[i];
    const c = ring[(i + 1) % ring.length];
    const v1x = b[0] - a[0], v1y = b[1] - a[1];
    const v2x = c[0] - b[0], v2y = c[1] - b[1];
    const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
    if (!n1 || !n2) continue;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
    if ((Math.acos(cos) * 180) / Math.PI > thresholdDeg) corners++;
  }
  return corners;
}

/**
 * Candidate rotations (degrees) to try within ±toleranceDeg, drawn
 * orientation (0) first so it wins ties. toleranceDeg ≥ 180 means any
 * orientation — the full circle is sampled every 30°.
 */
export function rotationCandidates(toleranceDeg) {
  const t = Math.max(0, Math.min(360, Number(toleranceDeg) || 0));
  if (t === 0) return [0];
  const out = [0];
  if (t >= 180) {
    for (let d = 30; d < 180; d += 30) out.push(d, -d);
    out.push(180);
    return out;
  }
  const step = t / 4;
  for (let k = 1; k <= 4; k++) out.push(k * step, -k * step);
  return out;
}

/**
 * Similarity between the planned route and the drawn target ring, as 0..1
 * (1 = route hugs the shape). Symmetric mean nearest-vertex distance,
 * normalised by the ring's mean radius. Vertex-to-vertex is accurate enough
 * here because both inputs are densely sampled.
 */
export function shapeSimilarity(routeCoords, ring) {
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) return 0;
  if (!Array.isArray(ring) || ring.length < 3) return 0;

  const clat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const clng = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let meanRadius = 0;
  for (const p of ring) meanRadius += haversineDistance([clat, clng], p);
  meanRadius /= ring.length;
  if (!(meanRadius > 0)) return 0;

  const sample = (pts, max) => {
    if (pts.length <= max) return pts;
    const out = [];
    const step = (pts.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
    return out;
  };
  const a = sample(routeCoords, 120);
  const b = sample(ring, 120);

  const meanNearest = (from, to) => {
    let sum = 0;
    for (const p of from) {
      let best = Infinity;
      for (const q of to) {
        const d = haversineDistance(p, q);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum / from.length;
  };

  const d = (meanNearest(a, b) + meanNearest(b, a)) / 2;
  return Math.max(0, Math.min(1, 1 - d / meanRadius));
}
