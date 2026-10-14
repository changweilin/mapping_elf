/**
 * Mapping Elf — Shape-Constrained Navigation Route Generator (shapeRouteMatcher.js)
 *
 * Implements the 5-phase shape-fitting navigation routing algorithm defined in:
 * doc/形狀擬合導航路由演算法規格與實作指南.md
 *
 * Phases:
 * 1. Trajectory Denoising & Curvature-Adaptive Resampling (Chaikin + RDP + Hard Anchor Detection)
 * 2. Isotropic Geo-Projection with Detour Factor (eta = 1.32) & Anchor Alignment
 * 3. Topological Stroke Phase Segmentation & HMM Road Network Fitting (with graceful fallback)
 * 4. Topological Spur Pruning (Spike / cul-de-sac elimination with corner protection)
 * 5. Discrete Fréchet & Tangent Cosine Direction Similarity Evaluation
 */

export const EARTH_RADIUS_M = 6371008.8;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Main entry point: converts raw canvas stroke points into a shape-fitted road navigation route.
 *
 * @param {Array<[number, number]|{x: number, y: number}>} rawPoints - Raw points from drawing canvas
 * @param {Object} options - Configuration parameters
 * @param {[number, number]|{lat: number, lng: number}} [options.anchor] - Geographic anchor point where run starts
 * @param {[number, number]|{lat: number, lng: number}} [options.center] - Geographic center coordinate if no anchor
 * @param {number} [options.targetDistanceM=5000] - Desired total route distance in meters
 * @param {number} [options.detourFactor=1.32] - Road network detour multiplier (1.25 ~ 1.35)
 * @param {number} [options.sampleStepM=90] - Resampling interval along the curve in meters
 * @param {number} [options.cornerAngleDeg=38] - Turning angle threshold for hard anchors
 * @param {number} [options.rotationDeg=0] - Rotation angle in degrees
 * @param {boolean} [options.isClosed] - Whether stroke is a closed loop (auto-detected if omitted)
 * @param {Function} [options.routingAdapter] - Async function(waypoints, isMatchMode) => Array<[lat, lng]>
 * @returns {Promise<{
 *   route: Array<[number, number]>,
 *   waypoints: Array<[number, number]>,
 *   anchors: Array<{lat: number, lng: number, isCorner: boolean, index: number}>,
 *   similarityScore: number,
 *   distanceM: number,
 *   frechetDist: number,
 *   dirSimilarity: number
 * }>}
 */
export async function generateShapeMatchedRoute(rawPoints, options = {}) {
  const pts = normalizeInputPoints(rawPoints);
  if (!pts || pts.length < 2) {
    throw new Error('At least 2 valid canvas points are required to form a pattern.');
  }

  const {
    anchor = null,
    center = null,
    targetDistanceM = 5000,
    detourFactor = 1.32,
    sampleStepM = 90,
    cornerAngleDeg = 38,
    rotationDeg = 0,
    isClosed: explicitClosed = null,
    routingAdapter = null,
  } = options;

  const geoRef = parseGeoPoint(anchor || center);
  if (!geoRef) {
    throw new Error('Either options.anchor or options.center must provide valid geographic coordinates [lat, lng].');
  }

  // Phase 1: Smoothing, geometry normalization, RDP, and curvature-adaptive sampling
  const isClosed = explicitClosed != null ? Boolean(explicitClosed) : detectClosedLoop(pts);
  const smoothed = chaikinSmooth(pts, 2, isClosed);
  const { normalizedPoints, normArcLength } = normalizeCanvasGeometry(smoothed);

  if (normArcLength < 1e-6) {
    throw new Error('Drawing pattern has zero geometric length.');
  }

  // Phase 2: Rescale with detour factor compensation and isotropic geo-projection
  const geometricTargetLengthM = targetDistanceM / Math.max(1.0, detourFactor);
  const scaleMeters = geometricTargetLengthM / normArcLength;
  const stepNorm = sampleStepM / scaleMeters;

  const sampledPattern = resampleWithCurvatureAnchors(
    normalizedPoints,
    stepNorm,
    cornerAngleDeg,
    isClosed
  );

  const geoWaypoints = projectToGeo(sampledPattern, {
    anchor: anchor ? parseGeoPoint(anchor) : null,
    center: center ? parseGeoPoint(center) : null,
    scaleMeters,
    rotationDeg,
  });

  // Extract key topological anchors for UI waypoint representation (limit to ~24 max)
  const uiWaypoints = selectKeyWaypoints(geoWaypoints, 24);

  // If no routing adapter is provided, return purely geometric geo-waypoints
  if (typeof routingAdapter !== 'function') {
    const rawCoords = geoWaypoints.map((p) => [p.lat, p.lng]);
    const distanceM = computeGeoPathLength(rawCoords);
    return {
      route: rawCoords,
      waypoints: uiWaypoints,
      anchors: geoWaypoints,
      similarityScore: 100,
      distanceM,
      frechetDist: 0,
      dirSimilarity: 1,
    };
  }

  // Phase 3: Topological Stroke Phase Segmentation & Road Network Fitting
  const segments = splitIntoTopologicalSegments(geoWaypoints);
  const routedSegments = [];

  for (const segment of segments) {
    const matchedSegment = await fitSegmentToRoadNetwork(segment, routingAdapter);
    if (matchedSegment && matchedSegment.length > 0) {
      routedSegments.push(matchedSegment);
    }
  }

  const stitchedRoute = stitchSegments(routedSegments);

  // Phase 4: Topological Spur Pruning
  const cleanedRoute = pruneSpursAndSpikes(stitchedRoute, geoWaypoints, 85);

  // Phase 5: Discrete Fréchet & Direction Cosine Similarity Evaluation
  const sim = evaluateShapeSimilarity(geoWaypoints, cleanedRoute);
  const distanceM = computeGeoPathLength(cleanedRoute);

  return {
    route: cleanedRoute,
    waypoints: uiWaypoints,
    anchors: geoWaypoints,
    similarityScore: sim.score,
    distanceM,
    frechetDist: sim.frechet,
    dirSimilarity: sim.dirSim,
  };
}

/* ==========================================================================
 * Phase 1: Smoothing & Curvature-Adaptive Resampling
 * ========================================================================== */

/**
 * Normalizes mixed point inputs ([x, y] or {x, y}) into standard {x, y} array.
 */
export function normalizeInputPoints(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      out.push({ x: p[0], y: p[1] });
    } else if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

/**
 * Determines whether raw stroke forms a closed loop based on endpoint proximity.
 */
export function detectClosedLoop(points, thresholdPx = 25) {
  if (!points || points.length < 3) return false;
  const p0 = points[0];
  const pN = points[points.length - 1];
  return Math.hypot(p0.x - pN.x, p0.y - pN.y) <= thresholdPx;
}

/**
 * Chaikin smoothing algorithm: trims corners to eliminate micro-jitter while preserving curves.
 */
export function chaikinSmooth(points, iterations = 2, isClosed = false) {
  if (!points || points.length < 3) return points ? [...points] : [];
  let current = points.map((p) => ({ x: p.x, y: p.y }));

  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    const n = current.length;

    if (isClosed) {
      for (let i = 0; i < n; i++) {
        const p0 = current[i];
        const p1 = current[(i + 1) % n];
        next.push(
          { x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y },
          { x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y }
        );
      }
      next.push({ ...next[0] });
    } else {
      next.push({ ...current[0] });
      for (let i = 0; i < n - 1; i++) {
        const p0 = current[i];
        const p1 = current[i + 1];
        next.push(
          { x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y },
          { x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y }
        );
      }
      next.push({ ...current[n - 1] });
    }
    current = next;
  }
  return current;
}

/**
 * Normalizes canvas geometry into a centered, aspect-ratio-preserving coordinate system.
 * Flips Y so canvas downward (+y) matches geographic southward (-lat).
 */
export function normalizeCanvasGeometry(points) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const maxSpan = Math.max(width, height, 1e-6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const normalizedPoints = [];
  let normArcLength = 0;

  for (let i = 0; i < points.length; i++) {
    const nx = (points[i].x - cx) / maxSpan;
    const ny = -(points[i].y - cy) / maxSpan;
    normalizedPoints.push({ x: nx, y: ny });

    if (i > 0) {
      normArcLength += Math.hypot(
        nx - normalizedPoints[i - 1].x,
        ny - normalizedPoints[i - 1].y
      );
    }
  }

  return { normalizedPoints, normArcLength, width: width / maxSpan, height: height / maxSpan };
}

/**
 * Ramer-Douglas-Peucker (RDP) polyline simplification.
 */
export function simplifyRDP(points, epsilon) {
  if (!points || points.length <= 2 || !(epsilon > 0)) return points ? [...points] : [];

  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance2D(points[i], start, end);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyRDP(points.slice(0, index + 1), epsilon);
    const right = simplifyRDP(points.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  }
  return [start, end];
}

function perpendicularDistance2D(pt, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-9) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  const u = ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / (mag * mag);
  const clampedU = Math.max(0, Math.min(1, u));
  return Math.hypot(pt.x - (lineStart.x + clampedU * dx), pt.y - (lineStart.y + clampedU * dy));
}

/**
 * Resamples polyline with curvature detection: marks sharp inflection corners as Hard Anchors,
 * and generates Soft Guide Points at uniform step intervals along each sub-arc.
 */
export function resampleWithCurvatureAnchors(points, stepDist, cornerAngleDeg = 38, isClosed = false) {
  if (!points || points.length < 2) return [];
  const epsilon = Math.max(1e-4, stepDist * 0.18);
  const simplified = simplifyRDP(points, epsilon);
  if (simplified.length < 2) return points.map((p) => ({ ...p, isCorner: false }));

  const cornerCosThreshold = Math.cos(cornerAngleDeg * DEG_TO_RAD);
  const hardAnchorIndices = new Set([0, simplified.length - 1]);

  const n = simplified.length;
  for (let i = 1; i < n - 1; i++) {
    const prev = simplified[i - 1];
    const curr = simplified[i];
    const next = simplified[i + 1];

    const v1x = curr.x - prev.x, v1y = curr.y - prev.y;
    const v2x = next.x - curr.x, v2y = next.y - curr.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);

    if (len1 > 1e-6 && len2 > 1e-6) {
      const cosAngle = (v1x * v2x + v1y * v2y) / (len1 * len2);
      if (cosAngle < cornerCosThreshold) {
        hardAnchorIndices.add(i);
      }
    }
  }

  const anchorList = Array.from(hardAnchorIndices).sort((a, b) => a - b);
  const resampled = [];

  for (let k = 0; k < anchorList.length - 1; k++) {
    const startIdx = anchorList[k];
    const endIdx = anchorList[k + 1];
    const subPoly = simplified.slice(startIdx, endIdx + 1);
    const subLength = compute2DLength(subPoly);

    const numSegments = Math.max(1, Math.round(subLength / stepDist));
    for (let s = 0; s < numSegments; s++) {
      const targetDist = (s / numSegments) * subLength;
      const pt = interpolateAlong2DPolyline(subPoly, targetDist);
      resampled.push({
        x: pt.x,
        y: pt.y,
        isCorner: s === 0 && hardAnchorIndices.has(startIdx),
      });
    }
  }

  const lastPt = simplified[simplified.length - 1];
  resampled.push({ x: lastPt.x, y: lastPt.y, isCorner: true });

  if (isClosed && resampled.length > 2) {
    resampled[0].isCorner = true;
    resampled[resampled.length - 1].isCorner = true;
  }

  return resampled;
}

/* ==========================================================================
 * Phase 2: Isotropic Geo-Projection & Local Tangent Plane Mapping
 * ========================================================================== */

/**
 * Projects 2D normalized pattern into geographic coordinates.
 * Handles latitude cosine scaling, planar rotation, and anchor alignment.
 */
export function projectToGeo(sampledPattern, options) {
  const {
    anchor = null,
    center = null,
    scaleMeters = 1000,
    rotationDeg = 0,
  } = options;

  const baseGeo = parseGeoPoint(anchor || center) || { lat: 25.034, lng: 121.564 };
  const radRot = (Number(rotationDeg) || 0) * DEG_TO_RAD;
  const cosR = Math.cos(radRot);
  const sinR = Math.sin(radRot);
  const cosLat = Math.max(0.01, Math.cos(baseGeo.lat * DEG_TO_RAD));

  // 1. Transform pattern to meter-offsets relative to (0, 0)
  const metricCoords = sampledPattern.map((pt) => {
    const eastM = (pt.x * cosR - pt.y * sinR) * scaleMeters;
    const northM = (pt.x * sinR + pt.y * cosR) * scaleMeters;
    return { eastM, northM, isCorner: Boolean(pt.isCorner) };
  });

  // 2. If anchor is given, shift pattern so that vertex 0 coincides with anchor
  let offsetEastM = 0;
  let offsetNorthM = 0;

  if (anchor && metricCoords.length > 0) {
    offsetEastM = -metricCoords[0].eastM;
    offsetNorthM = -metricCoords[0].northM;
  }

  return metricCoords.map((pt, index) => {
    const e = pt.eastM + offsetEastM;
    const n = pt.northM + offsetNorthM;

    const dLat = (n / EARTH_RADIUS_M) * RAD_TO_DEG;
    const dLng = (e / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG;

    return {
      lat: baseGeo.lat + dLat,
      lng: baseGeo.lng + dLng,
      isCorner: pt.isCorner,
      index,
    };
  });
}

/**
 * Selects representative waypoints for UI side-panel and GPX export.
 */
function selectKeyWaypoints(geoWaypoints, maxBudget = 24) {
  if (!geoWaypoints || geoWaypoints.length <= maxBudget) {
    return geoWaypoints.map((p) => [p.lat, p.lng]);
  }

  const corners = [];
  const nonCorners = [];

  geoWaypoints.forEach((p, idx) => {
    if (idx === 0 || idx === geoWaypoints.length - 1 || p.isCorner) {
      corners.push({ idx, pt: [p.lat, p.lng] });
    } else {
      nonCorners.push({ idx, pt: [p.lat, p.lng] });
    }
  });

  const selected = new Map();
  corners.forEach((c) => selected.set(c.idx, c.pt));

  if (selected.size < maxBudget && nonCorners.length > 0) {
    const needed = maxBudget - selected.size;
    const step = nonCorners.length / (needed + 1);
    for (let i = 1; i <= needed; i++) {
      const targetIdx = Math.floor(i * step);
      const item = nonCorners[Math.min(nonCorners.length - 1, targetIdx)];
      if (item) selected.set(item.idx, item.pt);
    }
  }

  return Array.from(selected.entries())
    .sort((a, b) => a[0] - b[0])
    .map((e) => e[1]);
}

/* ==========================================================================
 * Phase 3: Topological Segmentation & Road Network Fitting
 * ========================================================================== */

/**
 * Splits path into distinct segments at hard corners and maximum vertex limit
 * to prevent shortcutting across loop openings.
 */
export function splitIntoTopologicalSegments(geoWaypoints) {
  if (!geoWaypoints || geoWaypoints.length < 2) return [];

  const segments = [];
  let currentSegment = [geoWaypoints[0]];

  for (let i = 1; i < geoWaypoints.length; i++) {
    const pt = geoWaypoints[i];
    currentSegment.push(pt);

    const isLast = i === geoWaypoints.length - 1;
    // Split condition: sharp corner with at least 3 points, or max segment capacity (25)
    if ((pt.isCorner && currentSegment.length >= 3) || currentSegment.length >= 25) {
      if (!isLast) {
        segments.push(currentSegment);
        currentSegment = [pt]; // Adjacent segments share boundary point
      }
    }
  }

  if (currentSegment.length >= 2) {
    segments.push(currentSegment);
  } else if (segments.length > 0 && currentSegment.length === 1) {
    segments[segments.length - 1].push(currentSegment[0]);
  }

  return segments;
}

/**
 * Fits a topological segment onto the road network using HMM Map Matching,
 * with graceful fallback to decimated routing.
 */
export async function fitSegmentToRoadNetwork(segmentWaypoints, routingAdapter) {
  if (!segmentWaypoints || segmentWaypoints.length === 0) return [];
  if (segmentWaypoints.length === 1) return [[segmentWaypoints[0].lat, segmentWaypoints[0].lng]];

  // 1. Attempt HMM Map Matching (isMatchMode = true)
  try {
    const matched = await routingAdapter(segmentWaypoints, true);
    if (matched && matched.length >= 2) {
      return normalizeCoordArray(matched);
    }
  } catch (_err) {
    // Map matching rejected or unsupported — fallback
  }

  // 2. Graceful Fallback: Decimate segment and route via shortest path (isMatchMode = false)
  const decimated = segmentWaypoints.filter(
    (pt, idx) =>
      pt.isCorner ||
      idx === 0 ||
      idx === segmentWaypoints.length - 1 ||
      idx % 2 === 0
  );

  try {
    const routed = await routingAdapter(decimated, false);
    if (routed && routed.length >= 2) {
      return normalizeCoordArray(routed);
    }
  } catch (_err) {
    // Both failed: straight-line connecting original waypoints
  }

  return segmentWaypoints.map((p) => [p.lat, p.lng]);
}

/**
 * Stitches routed segments together while removing duplicate boundary vertices.
 */
export function stitchSegments(segments) {
  const result = [];
  for (const seg of segments) {
    if (!seg || seg.length === 0) continue;
    for (const rawPt of seg) {
      const pt = Array.isArray(rawPt) ? rawPt : [rawPt.lat, rawPt.lng];
      if (
        result.length === 0 ||
        haversineDistanceM(result[result.length - 1], pt) > 1.5
      ) {
        result.push(pt);
      }
    }
  }
  return result;
}

/* ==========================================================================
 * Phase 4: Topological Spur Pruning
 * ========================================================================== */

/**
 * Eliminates dead-end out-and-back spikes caused by snapping errors,
 * while strictly protecting intentional sharp corners drawn by the user.
 */
export function pruneSpursAndSpikes(routePoints, originalAnchors, maxSpurLengthM = 85) {
  if (!routePoints || routePoints.length < 4) return routePoints ? [...routePoints] : [];

  const cornerAnchors = (originalAnchors || [])
    .filter((a) => a.isCorner)
    .map((a) => (Array.isArray(a) ? a : [a.lat, a.lng]));

  let pts = routePoints.map((p) => (Array.isArray(p) ? p : [p.lat, p.lng]));
  let modified = true;
  let pass = 0;

  while (modified && pass < 3) {
    modified = false;
    pass++;
    const nextPts = [];
    let i = 0;

    while (i < pts.length) {
      let prunedJumpIndex = -1;
      let cumDist = 0;

      for (let j = i + 2; j < Math.min(pts.length, i + 18); j++) {
        cumDist += haversineDistanceM(pts[j - 1], pts[j]);
        if (cumDist > maxSpurLengthM * 2) break;

        const closureDist = haversineDistanceM(pts[i], pts[j]);
        if (closureDist < 14 && cumDist > closureDist * 3.2) {
          const midIdx = Math.floor((i + j) / 2);
          const tipPt = pts[midIdx];

          const isIntentionalCorner = cornerAnchors.some(
            (anchor) => haversineDistanceM(anchor, tipPt) < 22
          );

          if (!isIntentionalCorner) {
            prunedJumpIndex = j;
            break;
          }
        }
      }

      if (prunedJumpIndex !== -1) {
        nextPts.push(pts[i]);
        i = prunedJumpIndex + 1;
        modified = true;
      } else {
        nextPts.push(pts[i]);
        i++;
      }
    }
    pts = nextPts;
  }

  return pts;
}

/* ==========================================================================
 * Phase 5: Discrete Fréchet Distance & Direction Similarity Evaluation
 * ========================================================================== */

/**
 * Evaluates shape similarity using discrete Fréchet distance and tangent direction cosine.
 */
export function evaluateShapeSimilarity(targetPattern, routedPath) {
  const normTarget = resampleGeoToNormalized2D(targetPattern, 64);
  const normRouted = resampleGeoToNormalized2D(routedPath, 64);

  if (normTarget.length < 2 || normRouted.length < 2) {
    return { score: 0, frechet: Infinity, dirSim: 0 };
  }

  const frechet = discreteFrechetDistance(normTarget, normRouted);
  const dirSim = averageTangentSimilarity(normTarget, normRouted);

  const distanceScore = Math.max(0, 100 * Math.exp(-3.2 * frechet));
  const directionScore = Math.max(0, ((dirSim + 1) / 2) * 100);

  const compositeScore = Math.min(
    100,
    Math.max(0, Math.round(0.65 * distanceScore + 0.35 * directionScore))
  );

  return {
    score: compositeScore,
    frechet,
    dirSim,
  };
}

/**
 * Non-recursive, 2-row dynamic programming discrete Fréchet distance calculation.
 * O(N * M) time, O(M) space, stack-safe.
 */
export function discreteFrechetDistance(P, Q) {
  const n = P.length;
  const m = Q.length;
  if (n === 0 || m === 0) return Infinity;

  let prevRow = new Float64Array(m);
  let currRow = new Float64Array(m);

  // Initialize (0, 0)
  prevRow[0] = Math.hypot(P[0].x - Q[0].x, P[0].y - Q[0].y);

  // Initialize first row (i = 0)
  for (let j = 1; j < m; j++) {
    const d = Math.hypot(P[0].x - Q[j].x, P[0].y - Q[j].y);
    prevRow[j] = Math.max(prevRow[j - 1], d);
  }

  // Iterate rows i = 1 to n - 1
  for (let i = 1; i < n; i++) {
    const d0 = Math.hypot(P[i].x - Q[0].x, P[i].y - Q[0].y);
    currRow[0] = Math.max(prevRow[0], d0);

    for (let j = 1; j < m; j++) {
      const d = Math.hypot(P[i].x - Q[j].x, P[i].y - Q[j].y);
      const minPrev = Math.min(prevRow[j], prevRow[j - 1], currRow[j - 1]);
      currRow[j] = Math.max(minPrev, d);
    }

    const tmp = prevRow;
    prevRow = currRow;
    currRow = tmp;
  }

  return prevRow[m - 1];
}

/**
 * Computes average cosine similarity of tangent vectors along the polylines.
 */
export function averageTangentSimilarity(P, Q) {
  let sumCos = 0;
  let count = 0;
  const len = Math.min(P.length, Q.length);

  for (let i = 0; i < len - 1; i++) {
    const dx1 = P[i + 1].x - P[i].x, dy1 = P[i + 1].y - P[i].y;
    const dx2 = Q[i + 1].x - Q[i].x, dy2 = Q[i + 1].y - Q[i].y;
    const m1 = Math.hypot(dx1, dy1), m2 = Math.hypot(dx2, dy2);

    if (m1 > 1e-6 && m2 > 1e-6) {
      sumCos += (dx1 * dx2 + dy1 * dy2) / (m1 * m2);
      count++;
    }
  }

  return count > 0 ? sumCos / count : 0;
}

/* ==========================================================================
 * OSRM Shape Adapter Factory
 * ========================================================================== */

/**
 * Factory for production OSRM shape router adapter.
 * Supports /match/v1 HMM Viterbi matching with fallback to /route/v1.
 */
export function createOsrmShapeAdapter(
  osrmBaseUrl = 'https://router.project-osrm.org',
  profile = 'foot'
) {
  return async function osrmAdapter(waypoints, isMatchMode = false) {
    if (!waypoints || waypoints.length < 2) return [];

    const normWps = waypoints.map((p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p));
    const coordsStr = normWps
      .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(';');

    // 1. HMM Map Matching API
    if (isMatchMode && normWps.length >= 3) {
      let currentTimestamp = 1700000000;
      const timestamps = [currentTimestamp];
      const radiuses = [normWps[0].isCorner ? 25 : 50];

      for (let i = 1; i < normWps.length; i++) {
        const dist = haversineDistanceM(
          [normWps[i - 1].lat, normWps[i - 1].lng],
          [normWps[i].lat, normWps[i].lng]
        );
        currentTimestamp += Math.max(1, Math.round(dist / 1.4));
        timestamps.push(currentTimestamp);
        radiuses.push(normWps[i].isCorner ? 25 : 55);
      }

      const matchUrl =
        `${osrmBaseUrl}/match/v1/${profile}/${coordsStr}` +
        `?overview=full&geometries=geojson&gaps=ignore&tidy=true` +
        `&radiuses=${radiuses.join(';')}&timestamps=${timestamps.join(';')}`;

      try {
        const res = await fetch(matchUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.code === 'Ok' && Array.isArray(data.matchings) && data.matchings.length > 0) {
            const merged = [];
            for (const m of data.matchings) {
              if (m.geometry && Array.isArray(m.geometry.coordinates)) {
                for (const [lng, lat] of m.geometry.coordinates) {
                  merged.push([lat, lng]);
                }
              }
            }
            if (merged.length >= 2) return merged;
          }
        }
      } catch (_err) {
        // Fall back to standard route
      }
    }

    // 2. Standard Route API (Shortest path between waypoints)
    const routeUrl =
      `${osrmBaseUrl}/route/v1/${profile}/${coordsStr}` +
      `?overview=full&geometries=geojson&continue_straight=false`;

    const res = await fetch(routeUrl);
    if (!res.ok) throw new Error(`OSRM HTTP status: ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) {
      throw new Error(`OSRM route failed with code: ${data?.code || 'empty'}`);
    }

    return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  };
}

/* ==========================================================================
 * Geometry & Geographic Utilities
 * ========================================================================== */

export function haversineDistanceM(a, b) {
  const pA = Array.isArray(a) ? { lat: a[0], lng: a[1] } : a;
  const pB = Array.isArray(b) ? { lat: b[0], lng: b[1] } : b;

  const dLat = (pB.lat - pA.lat) * DEG_TO_RAD;
  const dLng = (pB.lng - pA.lng) * DEG_TO_RAD;
  const lat1 = pA.lat * DEG_TO_RAD;
  const lat2 = pB.lat * DEG_TO_RAD;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function computeGeoPathLength(geoPoints) {
  if (!geoPoints || geoPoints.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < geoPoints.length; i++) {
    total += haversineDistanceM(geoPoints[i - 1], geoPoints[i]);
  }
  return total;
}

function compute2DLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

function interpolateAlong2DPolyline(pts, targetDist) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  if (targetDist <= 0 || pts.length === 1) return { x: pts[0].x, y: pts[0].y };

  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + segLen >= targetDist) {
      const t = segLen > 1e-9 ? (targetDist - acc) / segLen : 0;
      return {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      };
    }
    acc += segLen;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

function resampleGeoToNormalized2D(points, numSamples = 64) {
  if (!points || points.length < 2) return [];

  const isPure2D = points.some((p) => p && typeof p === 'object' && !Array.isArray(p) && 'x' in p && !('lat' in p));
  let pts2D;

  if (isPure2D) {
    pts2D = points.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  } else {
    const coords = points.map((p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p));
    const cosLat = Math.cos((coords[0].lat || 0) * DEG_TO_RAD);
    pts2D = coords.map((p) => ({
      x: (p.lng || 0) * cosLat,
      y: (p.lat || 0),
    }));
  }

  const { normalizedPoints, normArcLength } = normalizeCanvasGeometry(
    pts2D.map((p) => ({ x: p.x, y: -p.y }))
  );

  const sampled = [];
  const step = normArcLength / Math.max(1, numSamples - 1);
  for (let i = 0; i < numSamples; i++) {
    const d = i * step;
    sampled.push(interpolateAlong2DPolyline(normalizedPoints, d));
  }
  return sampled;
}

function parseGeoPoint(pt) {
  if (!pt) return null;
  if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
    return { lat: pt[0], lng: pt[1] };
  }
  if (typeof pt === 'object' && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)) {
    return { lat: pt.lat, lng: pt.lng };
  }
  return null;
}

function normalizeCoordArray(coords) {
  return coords.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lng]));
}
