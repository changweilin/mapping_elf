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
import { haversineDistance, totalDistance } from './utils.js';

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

/** Computes winding order of a [lat, lng] closed ring: 'cw', 'ccw', or 'any'. */
export function computeGeoRingWinding(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 'any';
  let signedArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    // In equirectangular planar projection, x is lng, y is lat
    signedArea += (a[1] * b[0] - b[1] * a[0]);
  }
  return signedArea > 0 ? 'ccw' : signedArea < 0 ? 'cw' : 'any';
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

  // Enforce forward winding direction: 'cw' (clockwise), 'ccw' (counter-clockwise), or 'any' (as drawn)
  if (options.direction === 'cw' || options.direction === 'ccw') {
    let signedArea = 0;
    for (let i = 0; i < local.length; i++) {
      const a = local[i];
      const b = local[(i + 1) % local.length];
      signedArea += (a[0] * b[1] - b[0] * a[1]);
    }
    const isCcw = signedArea > 0;
    if ((options.direction === 'cw' && isCcw) || (options.direction === 'ccw' && !isCcw)) {
      local.reverse();
    }
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

/** Local equirectangular projector centred on the ring centroid ([lat,lng] → [xM, yM]). */
function ringProjector(ring) {
  const clat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const clng = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const cosLat = Math.max(0.01, Math.cos((clat * Math.PI) / 180));
  return ([lat, lng]) => [(lng - clng) * M_PER_DEG_LAT * cosLat, (lat - clat) * M_PER_DEG_LAT];
}

/** Cumulative arc lengths: cum[i] = metres from vertex 0 to vertex i; total includes the closing leg. */
function ringArcMetrics(ring) {
  const cum = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + haversineDistance(ring[i - 1], ring[i]));
  const total = cum[ring.length - 1] + haversineDistance(ring[ring.length - 1], ring[0]);
  return { cum, total };
}

/**
 * Point on the closed ring at arc-length fraction t (wraps mod 1). Waypoint
 * positions are stored as these fractions so they survive the ring being
 * re-scaled during distance calibration.
 */
export function ringPointAtT(ring, t, metrics) {
  const { cum, total } = metrics || ringArcMetrics(ring);
  const n = ring.length;
  const s = (((t % 1) + 1) % 1) * total;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid - 1;
  }
  const a = ring[lo];
  const b = ring[(lo + 1) % n];
  const segLen = (lo < n - 1 ? cum[lo + 1] : total) - cum[lo] || 1;
  const f = Math.min(1, Math.max(0, (s - cum[lo]) / segLen));
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Circular distance between two arc fractions, in metres. */
function circArcDistM(ta, tb, totalM) {
  let d = Math.abs(ta - tb) % 1;
  if (d > 0.5) d = 1 - d;
  return d * totalM;
}

/** Min distance (m) from XY point p to XY segment ab. */
function pointSegDistXY(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const apx = p[0] - a[0], apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const u = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2)) : 0;
  return Math.hypot(apx - u * abx, apy - u * aby);
}

/**
 * Curvature feature points: vertices whose turn angle exceeds `thresholdDeg`
 * and is the local maximum within ±nmsWindow vertices (star tips, the heart
 * cusp, finger notches). Returns [{ t, angle }] sorted by descending angle.
 */
export function ringFeatureTs(ring, options = {}) {
  const thresholdDeg = options.thresholdDeg ?? 28;
  const nmsWindow = options.nmsWindow ?? 2;
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const { cum, total } = ringArcMetrics(ring);
  if (!(total > 0)) return [];
  const proj = ringProjector(ring);
  const xy = ring.map(proj);
  const n = ring.length;
  const angles = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = xy[(i - 1 + n) % n], b = xy[i], c = xy[(i + 1) % n];
    const v1x = b[0] - a[0], v1y = b[1] - a[1];
    const v2x = c[0] - b[0], v2y = c[1] - b[1];
    const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
    if (!n1 || !n2) continue;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
    angles[i] = (Math.acos(cos) * 180) / Math.PI;
  }
  const feats = [];
  for (let i = 0; i < n; i++) {
    const a = angles[i];
    if (a < thresholdDeg) continue;
    let isPeak = true;
    for (let w = 1; w <= nmsWindow && isPeak; w++) {
      if (angles[(i - w + n) % n] > a || angles[(i + w) % n] >= a) isPeak = false;
    }
    if (isPeak) feats.push({ t: cum[i] / total, angle: a });
  }
  feats.sort((x, y) => y.angle - x.angle);
  return feats;
}

/**
 * Select `budget` waypoint positions (arc fractions, sorted, starting with
 * 0 = the anchor): curvature features first — a shortest-path router chords
 * across any sharp tip that lacks a waypoint — then the largest remaining
 * gaps split evenly. `minGapM` keeps neighbours from collapsing into one
 * point during road snapping.
 */
export function selectWaypointTs(ring, budget, options = {}) {
  const minGapM = options.minGapM ?? 60;
  if (!Array.isArray(ring) || ring.length < 3) return [0];
  const { total } = ringArcMetrics(ring);
  if (!(total > 0)) return [0];
  const cap = Math.max(3, budget | 0);

  const picked = [0];
  for (const f of ringFeatureTs(ring, options)) {
    if (picked.length >= cap) break;
    if (picked.some((t) => circArcDistM(t, f.t, total) < minGapM)) continue;
    picked.push(f.t);
  }
  picked.sort((a, b) => a - b);

  while (picked.length < cap) {
    let gi = -1, gLen = 0;
    for (let i = 0; i < picked.length; i++) {
      const a = picked[i];
      const b = i < picked.length - 1 ? picked[i + 1] : picked[0] + 1;
      const len = (b - a) * total;
      if (len > gLen) { gLen = len; gi = i; }
    }
    if (gi < 0 || gLen / 2 < minGapM) break;
    const a = picked[gi];
    const b = gi < picked.length - 1 ? picked[gi + 1] : picked[0] + 1;
    picked.splice(gi + 1, 0, ((a + b) / 2) % 1);
    picked.sort((x, y) => x - y);
  }
  return picked;
}

/** Materialise arc fractions into [lat,lng] waypoints. */
export function waypointsFromTs(ring, ts) {
  const metrics = ringArcMetrics(ring);
  return ts.map((t) => ringPointAtT(ring, t, metrics));
}

/**
 * Directed deviation of the routed polyline from the drawn ring: how far
 * each ring vertex sits from the route (in metres). Catches cut-off
 * features that the mean-based shapeSimilarity barely registers.
 */
export function ringRouteDeviation(ring, routeCoords, options = {}) {
  if (!Array.isArray(ring) || ring.length < 3) return { maxM: 0, meanM: 0, ringToRouteMaxM: 0, routeToRingMaxM: 0 };
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) return { maxM: Infinity, meanM: Infinity, ringToRouteMaxM: Infinity, routeToRingMaxM: Infinity };
  const proj = ringProjector(ring);
  const ringXY = ring.map(proj);
  const routeXY = routeCoords.map(proj);

  let ringToRouteMaxM = 0, sumRing = 0;
  for (const q of ringXY) {
    let best = Infinity;
    for (let i = 0; i < routeXY.length - 1; i++) {
      const d = pointSegDistXY(q, routeXY[i], routeXY[i + 1]);
      if (d < best) best = d;
    }
    if (best > ringToRouteMaxM) ringToRouteMaxM = best;
    sumRing += best;
  }

  let routeToRingMaxM = 0, sumRoute = 0;
  if (options.bidirectional) {
    for (const q of routeXY) {
      let best = Infinity;
      for (let i = 0; i < ringXY.length; i++) {
        const a = ringXY[i];
        const b = ringXY[(i + 1) % ringXY.length];
        const d = pointSegDistXY(q, a, b);
        if (d < best) best = d;
      }
      if (best > routeToRingMaxM) routeToRingMaxM = best;
      sumRoute += best;
    }
  }

  const maxM = options.bidirectional ? Math.max(ringToRouteMaxM, routeToRingMaxM) : ringToRouteMaxM;
  const meanM = options.bidirectional ? (sumRing / ringXY.length + sumRoute / routeXY.length) / 2 : sumRing / ring.length;
  return { maxM, meanM, ringToRouteMaxM, routeToRingMaxM };
}

/**
 * Split a routed loop's coords into per-leg ranges by locating each
 * waypoint's nearest route vertex (monotonically — legs never overlap).
 * One entry per leg including the closing leg (last waypoint → route end).
 */
function splitRouteByWaypoints(routeCoords, waypoints) {
  const idx = [];
  let cursor = 0;
  for (const wp of waypoints) {
    let best = cursor, bestD = Infinity;
    for (let i = cursor; i < routeCoords.length; i++) {
      const d = haversineDistance(wp, routeCoords[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    idx.push(best);
    cursor = best;
  }
  const legs = [];
  for (let k = 0; k < idx.length - 1; k++) legs.push({ start: idx[k], end: idx[k + 1] });
  legs.push({ start: idx[idx.length - 1], end: routeCoords.length - 1 });
  return legs;
}

/**
 * One refinement round: find the legs whose routed polyline strays more than
 * `minDevM` from their drawn arc and insert a waypoint at each deviation
 * maximum. Returns the new sorted ts array, or null when no leg qualifies
 * (converged) or the `maxTotal` budget is exhausted. The caller re-routes
 * and decides — via ringRouteDeviation — whether the round actually helped;
 * on a network coarser than the drawn feature it will not, and the caller
 * should revert rather than keep buying mileage with no shape gain.
 */
export function planRefinementTs(ring, ts, routeCoords, waypoints, options = {}) {
  const maxInsert = options.maxInsert ?? 4;
  const minDevM = options.minDevM ?? 55;
  const minGapM = options.minGapM ?? 60;
  const maxTotal = options.maxTotal ?? 30;
  if (!Array.isArray(ring) || ring.length < 3) return null;
  if (!Array.isArray(ts) || ts.length < 3 || ts.length >= maxTotal) return null;
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) return null;
  if (!Array.isArray(waypoints) || waypoints.length !== ts.length) return null;
  const metrics = ringArcMetrics(ring);
  const { total } = metrics;
  if (!(total > 0)) return null;

  const legs = splitRouteByWaypoints(routeCoords, waypoints);
  const proj = ringProjector(ring);
  const routeXY = routeCoords.map(proj);
  const devs = [];
  for (let k = 0; k < ts.length; k++) {
    const t0 = ts[k];
    const t1 = k < ts.length - 1 ? ts[k + 1] : ts[0] + 1;
    const spanM = (t1 - t0) * total;
    if (spanM <= 2 * minGapM) continue;
    const leg = legs[k];
    const nSamples = Math.max(8, Math.min(48, Math.ceil(spanM / 40)));
    let maxDevM = 0, tAtMax = (t0 + t1) / 2;
    for (let s = 1; s < nSamples; s++) {
      const t = t0 + ((t1 - t0) * s) / nSamples;
      const p = proj(ringPointAtT(ring, t, metrics));
      let best = Infinity;
      if (leg.end <= leg.start) {
        best = Math.hypot(p[0] - routeXY[leg.start][0], p[1] - routeXY[leg.start][1]);
      } else {
        for (let i = leg.start; i < leg.end; i++) {
          const d = pointSegDistXY(p, routeXY[i], routeXY[i + 1]);
          if (d < best) best = d;
        }
      }
      if (best > maxDevM) { maxDevM = best; tAtMax = t; }
    }
    if (maxDevM > minDevM) devs.push({ t0, t1, maxDevM, tAtMax });
  }
  if (!devs.length) return null;
  devs.sort((a, b) => b.maxDevM - a.maxDevM);

  const next = [...ts];
  let inserted = 0;
  for (const d of devs) {
    if (inserted >= maxInsert || next.length >= maxTotal) break;
    let t = d.tAtMax;
    // Keep clear of the leg's own endpoints; fall back to the arc midpoint.
    const tUnwrapped = t < d.t0 ? t + 1 : t;
    if ((tUnwrapped - d.t0) * total < minGapM || (d.t1 - tUnwrapped) * total < minGapM) {
      t = ((d.t0 + d.t1) / 2) % 1;
    }
    if (next.some((x) => circArcDistM(x, t, total) < minGapM)) continue;
    next.push(t % 1);
    inserted++;
  }
  if (!inserted) return null;
  next.sort((a, b) => a - b);
  return next;
}

/**
 * Detect out-and-back spurs on a routed polyline: spans where the path goes
 * out along a line and retraces the same line back (≈ zero enclosed area).
 * A spur tip is a vertex whose two neighbours pinch together within
 * `corridorM`; the span is grown outward while the mirrored vertices keep
 * pinching. Returns [{ start, end, tip, junction, lengthM }] with `junction`
 * the vertex index just before the spur (route order), `lengthM` the one-way
 * spur length. Spurs shorter than `minLengthM` are ignored.
 */
export function detectRouteSpurs(coords, options = {}) {
  const corridorM = options.corridorM ?? 25;
  const minLengthM = options.minLengthM ?? 40;
  if (!Array.isArray(coords) || coords.length < 5) return [];
  const spurs = [];
  let lastSpurEnd = -1;   // spans must not overlap — lengths would double-count
  let i = 1;
  while (i < coords.length - 1) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const next = coords[i + 1];
    // At a genuine spur tip, the step into `i` and step out of `i` fold back (dot <= 0)
    const v1Lat = curr[0] - prev[0];
    const v1Lng = curr[1] - prev[1];
    const v2Lat = next[0] - curr[0];
    const v2Lng = next[1] - curr[1];
    const isReversal = (v1Lat * v2Lat + v1Lng * v2Lng) <= 0;

    if (isReversal && haversineDistance(prev, next) < corridorM) {
      let k = 1;
      while (i - 1 - k > lastSpurEnd && i + 1 + k < coords.length
        && haversineDistance(coords[i - 1 - k], coords[i + 1 + k]) < corridorM) k++;
      const start = i - k;
      const end = Math.min(coords.length - 1, i + k);
      const junction = Math.max(0, start - 1);
      let lengthM = 0;
      for (let j = junction; j < i; j++) lengthM += haversineDistance(coords[j], coords[j + 1]);
      const tipDisplacementM = haversineDistance(coords[junction], curr);
      if (lengthM >= minLengthM && tipDisplacementM >= minLengthM * 0.5) {
        spurs.push({ start, end, tip: i, junction, lengthM });
        lastSpurEnd = end;
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return spurs;
}

/** Min distance (m) from a point to the closed ring's polyline. */
function distToRingM(ring, point) {
  const proj = ringProjector(ring);
  const p = proj(point);
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = proj(ring[i]);
    const b = proj(ring[(i + 1) % ring.length]);
    const d = pointSegDistXY(p, a, b);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The spurs that wander OFF the drawn shape: tip further than `offShapeM`
 * from the target ring. A zero-area out-and-back ALONG the drawn line is how
 * a router traces a sharp tip (star point, finger) — those spurs draw the
 * shape and must be kept; only off-shape whiskers (dead-end side streets the
 * snap dragged a waypoint onto) are trim candidates.
 */
export function offShapeRouteSpurs(coords, ring, options = {}) {
  const offShapeM = options.offShapeM ?? 50;
  if (!Array.isArray(ring) || ring.length < 3) return [];
  return detectRouteSpurs(coords, options)
    .map((s) => ({ ...s, tipDistM: distToRingM(ring, coords[s.tip]) }))
    .filter((s) => s.tipDistM > offShapeM);
}

/** Total one-way length (m) of the given spurs (e.g. from offShapeRouteSpurs). */
export function totalSpurLengthM(spurs) {
  return (spurs || []).reduce((s, x) => s + x.lengthM, 0);
}

/**
 * Copy of the route with the given spur spans collapsed to their junction
 * vertices — the track used to judge similarity when spur trimming is
 * enabled. The physical run still includes the spurs.
 */
export function trimRouteSpurs(coords, spurs) {
  if (!Array.isArray(spurs) || !spurs.length) return coords;
  const out = [];
  let cursor = 0;
  for (const s of spurs) {
    for (let i = cursor; i <= s.junction; i++) out.push(coords[i]);
    cursor = s.end + 1;
  }
  for (let i = cursor; i < coords.length; i++) out.push(coords[i]);
  return out.length >= 2 ? out : coords;
}

/** Arc fraction of the ring vertex nearest to `point`. */
export function nearestRingT(ring, point) {
  const { cum, total } = ringArcMetrics(ring);
  if (!(total > 0)) return 0;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = haversineDistance(ring[i], point);
    if (d < bestD) { bestD = d; best = i; }
  }
  return cum[best] / total;
}

/**
 * Plan the waypoint retraction that removes out-and-back spurs: every
 * waypoint sitting on a spur (except the anchor, index 0 — the run must
 * still start at the user) is pulled back to the spur's junction vertex, and
 * its arc fraction is re-pointed at the junction's ring position so later
 * ring re-scaling does not resurrect the spur. By default EVERY zero-area
 * whisker is a target — the drawn figure should enclose area, so even a
 * feature-tracing out-and-back (star tip) is retracted, rounding the tip;
 * pass `offShapeM` to restrict to off-shape spurs instead. Returns
 * { wps, ts, trimmedM, retracted } or null when no waypoint-caused spur
 * exists. Junction points lie on the routed track, so no re-snap is needed.
 */
export function planSpurRetraction(routeCoords, waypoints, ts, ring, options = {}) {
  const nearM = options.nearM ?? 30;
  const spurs = options.offShapeM != null
    ? offShapeRouteSpurs(routeCoords, ring, options)
    : detectRouteSpurs(routeCoords, options);
  if (!spurs.length) return null;
  if (!Array.isArray(waypoints) || !Array.isArray(ts) || waypoints.length !== ts.length) return null;

  const drop = options.drop === true;
  const pairs = waypoints.map((wp, i) => ({ wp, t: ts[i] }));

  // A waypoint belongs to a spur only when it sits closer to the whisker
  // than to the REST of the route — a main-loop waypoint that merely passes
  // within nearM of a whisker's mouth (parallel alley, junction bystander,
  // or a previously retracted point) is a genuine shape support and must
  // not be pulled away.
  const inSpan = (idx) => spurs.some((s) => idx >= s.start && idx <= s.end);
  const distToRest = (wp) => {
    let best = Infinity;
    for (let i = 0; i < routeCoords.length; i++) {
      if (inSpan(i)) continue;
      const d = haversineDistance(wp, routeCoords[i]);
      if (d < best) best = d;
    }
    return best;
  };

  let retracted = 0;
  let trimmedM = 0;
  for (const s of spurs) {
    const junction = routeCoords[s.junction];
    let hit = false;
    for (let k = 1; k < pairs.length; k++) {
      if (!pairs[k]) continue;
      let spurDist = Infinity;
      for (let i = s.start; i <= s.end; i++) {
        const d = haversineDistance(pairs[k].wp, routeCoords[i]);
        if (d < spurDist) spurDist = d;
      }
      if (!(spurDist < nearM) || distToRest(pairs[k].wp) <= spurDist) continue;
      // drop: remove the forcing waypoint entirely (its t can never be
      // re-materialised into a whisker by a later ring re-scale); default:
      // retract it to the junction so the loop keeps a support point there.
      pairs[k] = drop ? null : { wp: [junction[0], junction[1]], t: nearestRingT(ring, junction) };
      retracted++;
      hit = true;
    }
    if (hit) trimmedM += s.lengthM;
  }
  if (!retracted) return null;

  // Retractions can collapse neighbours onto the same junction — dedupe
  // within 30 m (loop closure included), always keeping the anchor.
  const alive = pairs.filter(Boolean);
  const kept = [alive[0]];
  for (let k = 1; k < alive.length; k++) {
    const prev = kept[kept.length - 1];
    if (haversineDistance(prev.wp, alive[k].wp) < 30) continue;
    kept.push(alive[k]);
  }
  if (kept.length >= 2 && haversineDistance(kept[0].wp, kept[kept.length - 1].wp) < 30) kept.pop();
  if (kept.length < 3) return null;
  return { wps: kept.map((p) => p.wp), ts: kept.map((p) => p.t), trimmedM, retracted };
}

/**
 * Pick `count` waypoints evenly spaced (by arc length) along a closed
 * [lat,lng] ring, starting at index 0 (the anchor / run start). Returns
 * distinct points only — O-loop routing adds the return to start.
 * (Used for cheap orientation probes; the real waypoint set comes from
 * selectWaypointTs, which is curvature-aware.)
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
  const base = Math.round(km * 2.2);
  const complexity = 6 + Math.round(corners * 1.5) + (strokeCount - 1) * 2;
  return Math.max(8, Math.min(26, Math.max(base, complexity)));
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
 * True when the planned route's actual mileage strays from the requested
 * target by more than `tolerance` (fraction, default 5%) and a calibration
 * re-plan is worthwhile.
 */
export function needsDistanceCalibration(actualM, targetM, tolerance = 0.05) {
  if (!(actualM > 0) || !(targetM > 0)) return false;
  return Math.abs(actualM - targetM) / targetM > tolerance;
}

/**
 * Next ring perimeter to request so the routed mileage lands on target:
 * scale the current request by target/actual (route length is ~linear in
 * ring perimeter), clamped to a sane band around the target so a degenerate
 * measurement can't run away.
 */
export function nextCalibratedTarget(currentScaledM, actualM, targetM, options = {}) {
  if (!(currentScaledM > 0) || !(actualM > 0) || !(targetM > 0)) return currentScaledM;
  const minRatio = options.minRatio || 0.4;
  const maxRatio = options.maxRatio || 2.5;
  const next = currentScaledM * (targetM / actualM);
  return Math.min(targetM * maxRatio, Math.max(targetM * minRatio, next));
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

  const distsAtoB = [];
  let maxAtoB = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) {
      const d = haversineDistance(p, q);
      if (d < best) best = d;
    }
    distsAtoB.push(best);
    if (best > maxAtoB) maxAtoB = best;
  }

  const distsBtoA = [];
  let maxBtoA = 0;
  for (const p of b) {
    let best = Infinity;
    for (const q of a) {
      const d = haversineDistance(p, q);
      if (d < best) best = d;
    }
    distsBtoA.push(best);
    if (best > maxBtoA) maxBtoA = best;
  }

  const meanAtoB = distsAtoB.reduce((s, d) => s + d, 0) / a.length;
  const meanBtoA = distsBtoA.reduce((s, d) => s + d, 0) / b.length;
  const rmsAtoB = Math.sqrt(distsAtoB.reduce((s, d) => s + d * d, 0) / a.length);
  const rmsBtoA = Math.sqrt(distsBtoA.reduce((s, d) => s + d * d, 0) / b.length);

  // Blend linear mean and RMS: punishes large highway excursions / detours while staying smooth for street grids
  const effectiveAtoB = 0.5 * meanAtoB + 0.5 * rmsAtoB;
  const effectiveBtoA = 0.5 * meanBtoA + 0.5 * rmsBtoA;
  const d = (effectiveAtoB + effectiveBtoA) / 2;
  let sim = Math.max(0, Math.min(1, 1 - d / meanRadius));

  // Severe penalty for off-shape spurs (interchange ramps / unwanted out-and-back whiskers)
  const spurs = offShapeRouteSpurs(routeCoords, ring);
  const spurM = totalSpurLengthM(spurs) * 2;
  const routeLen = totalDistance(routeCoords);
  if (routeLen > 0 && spurM > 0) {
    const spurRatio = Math.min(1, spurM / routeLen);
    sim *= (1 - spurRatio * 0.8);
  }

  // Severe penalty for excessive max deviation (spikes far beyond normal grid error)
  const maxDev = Math.max(maxAtoB, maxBtoA);
  if (maxDev > 0.4 * meanRadius) {
    const excessRatio = maxDev / meanRadius - 0.4;
    sim *= Math.max(0.05, 1 - Math.min(0.85, excessRatio * 0.6));
  }

  return Math.max(0, Math.min(1, sim));
}

/**
 * Searches the visible map viewport for the anchor point (and rotation) that
 * maximizes shape similarity after routing onto the road network.
 * Used when no waypoints exist on the map.
 *
 * @param {Object} params
 * @param {{ south: number, west: number, north: number, east: number }} params.viewportBounds
 * @param {Array<number>} params.viewportCenter [lat, lng]
 * @param {Array<Array<number>>} params.strokePts raw canvas drawing points
 * @param {number} params.targetM target route distance in meters
 * @param {RoadNetworkGraph} params.graph
 * @param {GPSArtOptimizer} params.optimizer
 * @param {Object} [params.options]
 * @returns {{ anchor: [number, number], angleDeg: number, similarity: number, score: number }}
 */
export function findOptimalViewportAnchor({
  viewportBounds,
  viewportCenter,
  strokePts,
  targetM,
  graph,
  optimizer,
  options = {},
}) {
  const fallback = {
    anchor: viewportCenter || [25.034, 121.564],
    angleDeg: 0,
    similarity: 0,
    score: -Infinity,
  };
  if (!viewportBounds || !graph || !optimizer || !Array.isArray(strokePts) || strokePts.length < 3 || !(targetM > 0)) {
    return fallback;
  }

  const { south, west, north, east } = viewportBounds;
  const dLat = north - south;
  const dLng = east - west;
  if (!(dLat > 0) || !(dLng > 0)) {
    return fallback;
  }

  const isExpanded = Boolean(options.expandedSearch);
  const uSteps = isExpanded ? [0.15, 0.32, 0.50, 0.68, 0.85] : [0.30, 0.50, 0.70];
  const vSteps = isExpanded ? [0.15, 0.32, 0.50, 0.68, 0.85] : [0.30, 0.50, 0.70];
  const rawPoints = [];

  if (viewportCenter && Number.isFinite(viewportCenter[0]) && Number.isFinite(viewportCenter[1])) {
    rawPoints.push([viewportCenter[0], viewportCenter[1]]);
  }

  if (Array.isArray(options.hintPoints)) {
    for (const hp of options.hintPoints) {
      if (Array.isArray(hp) && Number.isFinite(hp[0]) && Number.isFinite(hp[1])) {
        rawPoints.push([hp[0], hp[1]]);
      }
    }
  }

  for (const v of vSteps) {
    const lat = south + dLat * v;
    for (const u of uSteps) {
      const lng = west + dLng * u;
      rawPoints.push([lat, lng]);
    }
  }

  const travelMode = options.travelMode || graph.travelMode || 'foot';

  // In expanded search, also add radial concentric points around center
  if (isExpanded && viewportCenter) {
    const cLat = viewportCenter[0];
    const cLng = viewportCenter[1];
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(cLat * (Math.PI / 180));
    const viewHalfDiagM = haversineDistance([south, west], [north, east]) * 0.5;
    const radialDistsM = [viewHalfDiagM * 0.4, viewHalfDiagM * 0.8, viewHalfDiagM * 1.25, viewHalfDiagM * 1.6];
    const radialAnglesDeg = [0, 45, 90, 135, 180, 225, 270, 315];

    for (const distM of radialDistsM) {
      for (const ang of radialAnglesDeg) {
        const rad = (ang * Math.PI) / 180;
        const rLat = cLat + (distM * Math.cos(rad)) / mPerDegLat;
        const rLng = cLng + (distM * Math.sin(rad)) / mPerDegLng;
        rawPoints.push([rLat, rLng]);
      }
    }

    // Also pick prominent connected road network nodes from the graph
    if (Array.isArray(graph.nodeList) && graph.nodeList.length > 0) {
      const connected = graph.nodeList.filter(
        (n) => graph.isNodeAllowedForTravelMode(n, travelMode) && (graph.adj.get(n.id)?.size || 0) >= 3
      );
      const step = Math.max(1, Math.floor(connected.length / 16));
      for (let k = 0; k < connected.length && rawPoints.length < 80; k += step) {
        rawPoints.push([connected[k].lat, connected[k].lng]);
      }
    }
  }

  // Snap candidates to road network and deduplicate within 75m
  const snapRawPoints = (points) => {
    const candidates = [];
    const padLat = dLat * (isExpanded ? 0.35 : 0.1);
    const padLng = dLng * (isExpanded ? 0.35 : 0.1);
    for (const [la, ln] of points) {
      const xy = graph.geoToXy(la, ln);
      const node = optimizer.snapPointToRoad(xy, false, { travelMode });
      if (!node) continue;
      if (graph.isNodeAllowedForTravelMode && !graph.isNodeAllowedForTravelMode(node, travelMode)) {
        continue;
      }
      const geo = graph.xyToGeo(node.x, node.y);
      if (geo[0] < south - padLat || geo[0] > north + padLat || geo[1] < west - padLng || geo[1] > east + padLng) {
        continue;
      }
      const dup = candidates.some((c) => haversineDistance(c, geo) < 75);
      if (!dup) candidates.push(geo);
    }
    return candidates;
  };

  let uniqueCandidates = snapRawPoints(rawPoints);

  if (uniqueCandidates.length === 0) {
    if (viewportCenter) uniqueCandidates.push([viewportCenter[0], viewportCenter[1]]);
    else return fallback;
  }

  const angleTol = Number(options.angleTolDeg) || 0;
  const direction = options.direction || 'any';
  const probeAngles = angleTol > 0
    ? (angleTol >= 180 ? [0, 45, 90, 135, 180, 225, 270, 315] : rotationCandidates(angleTol))
    : (isExpanded ? [0, 45, 90, 135, 180, 225, 270, 315] : [0]);

  const evalCandidate = (cand, ang) => {
    const ring = strokeToLatLngRing(strokePts, cand, targetM / 1.22, { rotationDeg: ang, direction });
    if (!ring || ring.length < 3) return null;
    const probeWps = pickShapeWaypoints(ring, 10);
    const xyPts = probeWps.concat([probeWps[0]]).map((p) => graph.geoToXy(p[0], p[1]));
    const routed = optimizer.matchAndRoute(xyPts, {
      pruneSpurs: true,
      rejectExcessiveDetours: true,
      travelMode,
    });
    if (!routed || !Array.isArray(routed.routeCoordsXY) || routed.routeCoordsXY.length < 2) return null;
    const routedGeo = routed.routeCoordsXY.map(([x, y]) => graph.xyToGeo(x, y));
    const sim = shapeSimilarity(routedGeo, ring);
    const score = sim * 100 - (routed.overlapRatio || 0) * 25;
    return { sim, score, ring, routedGeo };
  };

  const evaluateCandidateList = (candidates) => {
    const scored = [];
    for (const cand of candidates) {
      let bestForCand = null;
      const res0 = evalCandidate(cand, 0);
      if (res0) {
        bestForCand = { cand, score: res0.score, similarity: res0.sim, angleDeg: 0 };
      } else if (probeAngles.length > 1) {
        for (const ang of probeAngles) {
          if (ang === 0) continue;
          const res = evalCandidate(cand, ang);
          if (res && (!bestForCand || res.score > bestForCand.score)) {
            bestForCand = { cand, score: res.score, similarity: res.sim, angleDeg: ang };
          }
        }
      }
      if (bestForCand) scored.push(bestForCand);
    }
    return scored;
  };

  let scoredCandidates = evaluateCandidateList(uniqueCandidates);

  // If no initial candidate could route without excessive detours, trigger in-situ candidate expansion
  if (scoredCandidates.length === 0 && !isExpanded && options.autoExpand !== false && viewportCenter) {
    const fallbackRawPoints = [];
    const cLat = viewportCenter[0];
    const cLng = viewportCenter[1];
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(cLat * (Math.PI / 180));
    const viewHalfDiagM = haversineDistance([south, west], [north, east]) * 0.5;
    const radialDistsM = [viewHalfDiagM * 0.45, viewHalfDiagM * 0.9, viewHalfDiagM * 1.4];
    const radialAnglesDeg = [0, 45, 90, 135, 180, 225, 270, 315];

    for (const distM of radialDistsM) {
      for (const ang of radialAnglesDeg) {
        const rad = (ang * Math.PI) / 180;
        fallbackRawPoints.push([
          cLat + (distM * Math.cos(rad)) / mPerDegLat,
          cLng + (distM * Math.sin(rad)) / mPerDegLng,
        ]);
      }
    }
    if (Array.isArray(graph.nodeList)) {
      const connected = graph.nodeList.filter(
        (n) => graph.isNodeAllowedForTravelMode(n, travelMode) && (graph.adj.get(n.id)?.size || 0) >= 3
      );
      const step = Math.max(1, Math.floor(connected.length / 14));
      for (let k = 0; k < connected.length && fallbackRawPoints.length < 50; k += step) {
        fallbackRawPoints.push([connected[k].lat, connected[k].lng]);
      }
    }

    const fallbackCandidates = snapRawPoints(fallbackRawPoints);
    if (fallbackCandidates.length > 0) {
      const fallbackScored = evaluateCandidateList(fallbackCandidates);
      if (fallbackScored.length > 0) {
        scoredCandidates = fallbackScored;
        uniqueCandidates = fallbackCandidates;
      }
    }
  }

  scoredCandidates.sort((a, b) => b.score - a.score);

  let bestAnchor = scoredCandidates[0]?.cand || uniqueCandidates[0];
  let bestAngleDeg = scoredCandidates[0]?.angleDeg || 0;
  let bestScore = scoredCandidates[0]?.score ?? -Infinity;
  let bestSimilarity = scoredCandidates[0]?.similarity ?? 0;

  // Pass 2: Refine angle tolerance for top candidate locations
  if (probeAngles.length > 1 && scoredCandidates.length > 0) {
    const topPicks = scoredCandidates.slice(0, 3);
    for (const item of topPicks) {
      for (const ang of probeAngles) {
        if (ang === item.angleDeg) continue;
        const res = evalCandidate(item.cand, ang);
        if (res && res.score > bestScore + 0.5) {
          bestScore = res.score;
          bestSimilarity = res.sim;
          bestAngleDeg = ang;
          bestAnchor = item.cand;
        }
      }
    }
  }

  return {
    anchor: bestAnchor,
    angleDeg: bestAngleDeg,
    similarity: bestSimilarity,
    score: bestScore,
    candidatesCount: uniqueCandidates.length,
    rankedCandidates: scoredCandidates.slice(0, 6),
    searchExpanded: isExpanded,
  };
}

// Re-export 5-stage shape-constrained routing engine functions from shapeRouteMatcher
export {
  generateShapeMatchedRoute,
  createOsrmShapeAdapter,
  chaikinSmooth,
  normalizeCanvasGeometry,
  simplifyRDP,
  resampleWithCurvatureAnchors,
  projectToGeo,
  splitIntoTopologicalSegments,
  fitSegmentToRoadNetwork,
  stitchSegments,
  pruneSpursAndSpikes,
  evaluateShapeSimilarity,
  discreteFrechetDistance,
  averageTangentSimilarity,
  computeGeoPathLength,
  haversineDistanceM,
} from './shapeRouteMatcher.js';

export {
  GPSArtOptimizer,
  RoadNetworkGraph,
  RouteConstraints,
  KDTree2D,
  isExcessiveLegDetour,
} from './gpsArtOptimizer.js';

