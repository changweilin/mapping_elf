import assert from 'node:assert/strict';
import {
  cumulativeDistances,
  haversineDistance,
  totalDistance,
} from '../src/modules/utils.js';
import {
  DEFAULT_PACE_PARAMS,
  computeCumulativeTimes,
  computeHourlyPoints,
  computeTripStats,
} from '../src/modules/paceEngine.js';
import {
  MELMAP_STATE_KEYS,
  RESET_STATE_KEYS,
  STATE_KEY_GROUPS,
} from '../src/modules/stateKeys.js';
import {
  MAP_PACK_TILE_LIMIT,
  enumerateMapPackTiles,
  estimateMapPackTiles,
  tilesForBoundsZoom,
} from '../src/modules/tileEstimator.js';
import {
  countShapeCorners,
  detectRouteSpurs,
  needsDistanceCalibration,
  nextCalibratedTarget,
  offShapeRouteSpurs,
  pickShapeWaypoints,
  planRefinementTs,
  planSpurRetraction,
  resampleClosedStroke,
  ringFeatureTs,
  ringPerimeter,
  ringPointAtT,
  ringRouteDeviation,
  rotationCandidates,
  selectWaypointTs,
  shapeSimilarity,
  strokeToLatLngRing,
  suggestWaypointCount,
  totalSpurLengthM,
  trimRouteSpurs,
  waypointsFromTs,
} from '../src/modules/shapeRoutePlanner.js';
import { SHAPE_NAMES, shapeStroke } from './helpers/testShapes.mjs';
import { makeGridWorld } from './helpers/gridWorld.mjs';

const closeTo = (actual, expected, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const coords = [
  [25.034, 121.564],
  [25.044, 121.574],
  [25.054, 121.584],
];
const elevations = [10, 80, 30];
const distances = cumulativeDistances(coords);

closeTo(distances[0], 0);
closeTo(distances[1], 1500.4611108253257);
closeTo(distances[2], 3000.8670630215397);
closeTo(totalDistance(coords), distances[2]);

const paceParams = {
  ...DEFAULT_PACE_PARAMS,
  flatPaceKmH: 4,
  restMinutes: 0,
};
const times = computeCumulativeTimes(elevations, distances, 'hiking', paceParams);
closeTo(times[0], 0);
closeTo(times[1], 0.530670833261887);
closeTo(times[2], 0.8857723213109405);

const trip = computeTripStats(elevations, distances, 'hiking', paceParams);
closeTo(trip.totalH, 0.8857723213109405);
closeTo(trip.movingH, 0.8857723213109405);
assert.equal(trip.restH, 0);
assert.equal(trip.kcalExpended, 310);
assert.equal(trip.kcalSuggested, 221);

const hourly = computeHourlyPoints(coords, elevations, distances, 'hiking', 0.25, paceParams);
assert.equal(hourly.length, 3);
[
  [25.038711, 121.568711, 706.87, 0.25],
  [25.043422, 121.573422, 1413.74, 0.5],
  [25.050177, 121.580177, 2427.19, 0.75],
].forEach(([lat, lng, cumDistM, estTimeH], idx) => {
  closeTo(hourly[idx].lat, lat, 0.000001);
  closeTo(hourly[idx].lng, lng, 0.000001);
  closeTo(hourly[idx].cumDistM, cumDistM, 0.01);
  closeTo(hourly[idx].estTimeH, estTimeH);
});

const savedWeather = {
  byKey: {
    'wp:a': { date: '2026-04-30', hour: '8' },
    'int:1000': { date: '2026-05-01', hour: '9' },
  },
  cols: [
    { date: '2026-04-30', hour: '8' },
    { date: '2026-05-01', hour: '9' },
  ],
};
const semanticKey = (pt) => pt.key;
const getSavedColRule = (pt, i, saved) => {
  if (!saved) return null;
  if (!pt.isWaypoint) return null;
  return saved.byKey?.[semanticKey(pt)] ?? saved.cols?.[i] ?? null;
};
assert.deepEqual(
  getSavedColRule({ isWaypoint: true, key: 'wp:a' }, 0, savedWeather),
  { date: '2026-04-30', hour: '8' },
);
assert.equal(getSavedColRule({ isWaypoint: false, key: 'int:1000' }, 1, savedWeather), null);

const savedCols = [];
[
  { isWaypoint: true, entry: { date: '2026-04-30', hour: '8' } },
  { isWaypoint: false, entry: { date: '2026-04-30', hour: '9' } },
  { isWaypoint: true, entry: { date: '2026-04-30', hour: '10' } },
].forEach((pt, i) => {
  savedCols[i] = pt.isWaypoint ? pt.entry : null;
});
assert.deepEqual(savedCols, [
  { date: '2026-04-30', hour: '8' },
  null,
  { date: '2026-04-30', hour: '10' },
]);

assert.equal(new Set(MELMAP_STATE_KEYS).size, MELMAP_STATE_KEYS.length);
assert.equal(new Set(RESET_STATE_KEYS).size, RESET_STATE_KEYS.length);
[
  'mappingElf_roundTrip',
  'mappingElf_oLoop',
  'mappingElf_mapLayer',
  'mappingElf_customNames',
  'mappingElf_weatherTableCollapsed',
  'mappingElf_theme',
].forEach((key) => assert.ok(MELMAP_STATE_KEYS.includes(key), `${key} should export with .melmap state`));
assert.ok(RESET_STATE_KEYS.includes('mappingElf_pendingGpx'));
assert.ok(RESET_STATE_KEYS.includes('mappingElf_waypoints'));
assert.ok(!MELMAP_STATE_KEYS.includes('mappingElf_waypoints'));
assert.ok(!MELMAP_STATE_KEYS.includes('mappingElf_importedTrack'));
assert.ok(!MELMAP_STATE_KEYS.includes('mappingElf_favorites'));
assert.deepEqual(
  Object.keys(STATE_KEY_GROUPS).sort(),
  ['layout', 'pace', 'preference', 'route', 'routeSession', 'session', 'userCollection', 'weather'].sort(),
);

const tileBounds = {
  getWest: () => 121.4,
  getEast: () => 121.5,
  getNorth: () => 24.3,
  getSouth: () => 24.2,
};
const tileLayerInfo = { maxZoom: 17 };
const enumeratedTiles = enumerateMapPackTiles(tileBounds, tileLayerInfo);
const estimatedTiles = estimateMapPackTiles(tileBounds, tileLayerInfo);
assert.equal(estimatedTiles.tileCount, enumeratedTiles.tiles.length);
assert.equal(estimatedTiles.minZoom, enumeratedTiles.minZoom);
assert.equal(estimatedTiles.maxZoom, enumeratedTiles.maxZoom);
assert.equal(enumeratedTiles.tileCount, enumeratedTiles.tiles.length);
assert.ok(enumeratedTiles.tileCount > 0);
assert.ok(enumeratedTiles.tileCount <= MAP_PACK_TILE_LIMIT);
assert.deepEqual(tilesForBoundsZoom(tileBounds, 8), enumeratedTiles.tiles.filter((tile) => tile.z === 8));

const cappedTiles = enumerateMapPackTiles(tileBounds, tileLayerInfo, { maxTiles: 20 });
assert.ok(cappedTiles.tileCount <= 20);
assert.ok(cappedTiles.maxZoom < enumeratedTiles.maxZoom);

// --- Shape route planner (drawing board → waypoint loop) ---
const squareStroke = [];
for (let i = 0; i <= 10; i++) squareStroke.push([i * 10, 0]);
for (let i = 1; i <= 10; i++) squareStroke.push([100, i * 10]);
for (let i = 1; i <= 10; i++) squareStroke.push([100 - i * 10, 100]);
for (let i = 1; i < 10; i++) squareStroke.push([0, 100 - i * 10]);

const resampled = resampleClosedStroke(squareStroke, 80);
assert.equal(resampled.length, 80);
let resampledPerimPx = 0;
for (let i = 0; i < resampled.length; i++) {
  const a = resampled[i];
  const b = resampled[(i + 1) % resampled.length];
  resampledPerimPx += Math.hypot(b[0] - a[0], b[1] - a[1]);
}
closeTo(resampledPerimPx, 400, 1);
assert.equal(resampleClosedStroke([[0, 0], [1, 1]], 80), null);
assert.equal(resampleClosedStroke([[5, 5], [5, 5], [5, 5], [5, 5]], 80), null);

const shapeAnchor = [25.034, 121.564];
const TARGET_M = 5000;
const geoRing = strokeToLatLngRing(squareStroke, shapeAnchor, TARGET_M, { samples: 96 });
assert.equal(geoRing.length, 96);
closeTo(ringPerimeter(geoRing), TARGET_M, TARGET_M * 0.01);
// Ring starts exactly at the anchor (run starts where the user is).
closeTo(geoRing[0][0], shapeAnchor[0], 1e-9);
closeTo(geoRing[0][1], shapeAnchor[1], 1e-9);
// The whole loop stays near the anchor (within one perimeter length).
geoRing.forEach((p) => assert.ok(haversineDistance(shapeAnchor, p) < TARGET_M));

const shapeWps = pickShapeWaypoints(geoRing, 8);
assert.equal(shapeWps.length, 8);
assert.deepEqual(shapeWps[0], geoRing[0]);
// Distinct waypoints — O-loop mode closes the ring, no duplicate start.
const wpKeys = new Set(shapeWps.map((p) => p.join(',')));
assert.equal(wpKeys.size, 8);
// Evenly spread: consecutive gaps stay near perimeter/8.
for (let i = 1; i < shapeWps.length; i++) {
  const gap = haversineDistance(shapeWps[i - 1], shapeWps[i]);
  assert.ok(gap > TARGET_M / 8 * 0.4 && gap < TARGET_M / 8 * 1.8, `gap ${i} = ${gap}`);
}

assert.equal(suggestWaypointCount(2000), 8);
assert.equal(suggestWaypointCount(5000), 11);
assert.equal(suggestWaypointCount(20000), 26);
// Complexity raises the count: corners + extra strokes, capped at 26.
assert.equal(suggestWaypointCount(2000, { strokeCount: 1, corners: 4 }), 12);
assert.equal(suggestWaypointCount(2000, { strokeCount: 3, corners: 8 }), 22);
assert.equal(suggestWaypointCount(2000, { strokeCount: 2, corners: 0 }), 8);

// Corner counting: a square has 4 sharp turns; resampling noise adds none.
assert.equal(countShapeCorners(squareStroke), 4);
assert.equal(countShapeCorners([[0, 0], [1, 1]]), 0);

// Rotation candidates: drawn orientation first (wins ties), symmetric within
// the tolerance; ≥180 samples the full circle.
assert.deepEqual(rotationCandidates(0), [0]);
const cand45 = rotationCandidates(45);
assert.equal(cand45[0], 0);
assert.equal(cand45.length, 9);
assert.equal(Math.max(...cand45.map(Math.abs)), 45);
const candAny = rotationCandidates(360);
assert.equal(candAny[0], 0);
assert.equal(candAny.length, 12);
assert.ok(candAny.includes(180));

// Distance calibration: trigger only outside the 5% band; requested perimeter
// scales by target/actual, clamped to a sane band around the target.
assert.equal(needsDistanceCalibration(5600, 5000), true);
assert.equal(needsDistanceCalibration(5100, 5000), false);
assert.equal(needsDistanceCalibration(4300, 5000), true);
assert.equal(needsDistanceCalibration(0, 5000), false);
closeTo(nextCalibratedTarget(5000, 5750, 5000), 5000 * (5000 / 5750), 1e-6);
assert.equal(nextCalibratedTarget(5000, 100000, 5000), 2000);   // min 0.4×target
assert.equal(nextCalibratedTarget(5000, 100, 5000), 12500);     // max 2.5×target
assert.equal(nextCalibratedTarget(0, 5750, 5000), 0);           // invalid input passthrough

// Rotated ring keeps the perimeter and anchor-start invariants.
const rotatedRing = strokeToLatLngRing(squareStroke, shapeAnchor, TARGET_M, { rotationDeg: 90 });
closeTo(ringPerimeter(rotatedRing), TARGET_M, TARGET_M * 0.01);
closeTo(rotatedRing[0][0], shapeAnchor[0], 1e-9);
closeTo(rotatedRing[0][1], shapeAnchor[1], 1e-9);

// A route that exactly follows the ring scores ~1; a distant route scores lower.
closeTo(shapeSimilarity([...geoRing, geoRing[0]], geoRing), 1, 0.05);
const offsetRoute = geoRing.map(([la, ln]) => [la + 0.02, ln]);
assert.ok(shapeSimilarity(offsetRoute, geoRing) < 0.5);
assert.equal(shapeSimilarity([], geoRing), 0);

// --- Shape fidelity: feature-aware waypoints + deviation refinement ---

// Arc-fraction addressing: t=0 is the anchor vertex; the point half a
// perimeter away sits on the far side of the square (straight-line distance
// between one side length and one diagonal, depending on where the anchor
// vertex landed on the ring).
assert.deepEqual(ringPointAtT(geoRing, 0), geoRing[0]);
const halfway = haversineDistance(ringPointAtT(geoRing, 0.5), geoRing[0]);
assert.ok(halfway > (TARGET_M / 4) * 0.98 && halfway < (TARGET_M / 4) * Math.SQRT2 * 1.02, `halfway ${halfway}`);

// ringRouteDeviation: directed drawn→route distance; a route on the ring is 0,
// a parallel-shifted route is the shift everywhere.
closeTo(ringRouteDeviation(geoRing, [...geoRing, geoRing[0]]).maxM, 0, 1e-6);
assert.ok(ringRouteDeviation(geoRing, offsetRoute).maxM > 1500);

// Star: all 10 sharp corners are curvature features and every one must get a
// waypoint — a shortest-path router chords across any tip without one.
const starRing = strokeToLatLngRing(shapeStroke('star'), shapeAnchor, TARGET_M);
const starFeats = ringFeatureTs(starRing, { thresholdDeg: 40 });
assert.ok(starFeats.length >= 10, `star features ${starFeats.length}`);
const starTs = selectWaypointTs(starRing, 20);
assert.equal(starTs[0], 0);
assert.deepEqual([...starTs].sort((a, b) => a - b), starTs);
assert.ok(starTs.length <= 20);
const starPerim = ringPerimeter(starRing);
for (const f of starFeats.slice(0, 10)) {
  const covered = starTs.some((t) => {
    let d = Math.abs(t - f.t) % 1;
    if (d > 0.5) d = 1 - d;
    return d * starPerim < 60;
  });
  assert.ok(covered, `star feature at t=${f.t.toFixed(3)} has no waypoint`);
}
assert.deepEqual(waypointsFromTs(starRing, [0])[0], starRing[0]);

// Refinement: a route already on the ring converges (null); a sparse chorded
// loop gets ≤4 insertions inside the worst legs, keeping the original ts.
const sqTs = [0, 0.25, 0.5, 0.75];
const sqWps = waypointsFromTs(geoRing, sqTs);
assert.equal(planRefinementTs(geoRing, sqTs, [...geoRing, geoRing[0]], sqWps), null);
const sparseTs = [0, 0.2, 0.4, 0.6, 0.8];
const sparseWps = waypointsFromTs(starRing, sparseTs);
const refined = planRefinementTs(starRing, sparseTs, [...sparseWps, sparseWps[0]], sparseWps, { minDevM: 55 });
assert.ok(Array.isArray(refined), 'sparse star loop should refine');
assert.ok(refined.length > sparseTs.length && refined.length <= sparseTs.length + 4);
assert.deepEqual([...refined].sort((a, b) => a - b), refined);
for (const t of sparseTs) assert.ok(refined.includes(t), `refinement dropped t=${t}`);

// --- Out-and-back spur detection / trimming / waypoint retraction ---

// Splice a zero-area whisker (junction → A → tip → A → back) into the square
// loop: it must be detected, classified off-shape, trimmable, and its
// waypoint retractable to the junction.
const spurBase = geoRing[20];
const spurA = [spurBase[0] + 100 / 111320, spurBase[1]];
const spurTip = [spurBase[0] + 220 / 111320, spurBase[1]];
const spurRoute = [...geoRing, geoRing[0]];
spurRoute.splice(21, 0, spurA, spurTip, spurA);
const foundSpurs = detectRouteSpurs(spurRoute);
assert.equal(foundSpurs.length, 1);
assert.equal(foundSpurs[0].junction, 20);
assert.deepEqual(spurRoute[foundSpurs[0].tip], spurTip);
closeTo(foundSpurs[0].lengthM, 220, 30);

const offSpurs = offShapeRouteSpurs(spurRoute, geoRing);
assert.equal(offSpurs.length, 1);
assert.ok(offSpurs[0].tipDistM > 150, `tipDist ${offSpurs[0].tipDistM}`);
closeTo(totalSpurLengthM(offSpurs), foundSpurs[0].lengthM, 1e-6);

// A short whisker staying near the drawn line is detected but NOT off-shape
// (that is how routers trace sharp tips — it must be kept).
const nearA = [spurBase[0] + 15 / 111320, spurBase[1]];
const nearTip = [spurBase[0] + 45 / 111320, spurBase[1]];
const nearRoute = [...geoRing, geoRing[0]];
nearRoute.splice(21, 0, nearA, nearTip, nearA);
assert.ok(detectRouteSpurs(nearRoute).length >= 1);
assert.equal(offShapeRouteSpurs(nearRoute, geoRing).length, 0);

// Trimming collapses the whisker back to the plain loop length.
closeTo(
  totalDistance(trimRouteSpurs(spurRoute, offSpurs)),
  totalDistance([...geoRing, geoRing[0]]),
  30,
);

// Retraction pulls the whisker waypoint to the junction (anchor never moves).
const spurWps = [geoRing[0], spurTip, geoRing[48]];
const spurTs = [0, 20.5 / 96, 0.5];
const retractPlan = planSpurRetraction(spurRoute, spurWps, spurTs, geoRing);
assert.ok(retractPlan && retractPlan.retracted === 1);
closeTo(haversineDistance(retractPlan.wps[1], geoRing[20]), 0, 1);
closeTo(retractPlan.trimmedM, 220, 30);
assert.equal(retractPlan.wps.length, retractPlan.ts.length);
// A spur touched only by the anchor is left alone (run must start there).
assert.equal(planSpurRetraction(spurRoute, [spurTip, geoRing[30]], [0, 0.3], geoRing), null);

// Bystander protection: a main-route waypoint that merely passes near a
// whisker's mouth is closer to the rest of the route than to the whisker —
// it must keep its place while the whisker's own waypoint retracts.
{
  const lngAt = (xM) => [25.034, 121.564 + xM / (111320 * Math.cos((25.034 * Math.PI) / 180))];
  const at = (xM, yM) => [25.034 + yM / 111320, lngAt(xM)[1]];
  const lineRoute = [
    at(0, 0), at(40, 0), at(80, 0), at(120, 0), at(160, 0),
    at(200, 0), at(200, 45), at(200, 90), at(200, 45), at(200, 0),
    at(240, 0), at(280, 0), at(320, 0),
  ];
  const bystander = at(222, 0);   // 22 m from the whisker mouth, on the main line
  const lineWps = [at(0, 0), at(200, 90), bystander, at(320, 0)];
  const linePlan = planSpurRetraction(lineRoute, lineWps, [0, 0.3, 0.5, 0.7], geoRing);
  assert.ok(linePlan && linePlan.retracted === 1, 'whisker waypoint should retract');
  assert.ok(linePlan.wps.some((w) => haversineDistance(w, bystander) < 1), 'bystander must keep its place');
  assert.ok(!linePlan.wps.some((w) => haversineDistance(w, at(200, 90)) < 1), 'tip waypoint must be gone');
}

// Default policy retracts even near-shape whiskers (the figure should
// enclose area); passing offShapeM restores the tracing-whisker exemption.
const nearWps = [geoRing[0], nearTip, geoRing[48]];
const nearTs = [0, 20.5 / 96, 0.5];
const nearPlan = planSpurRetraction(nearRoute, nearWps, nearTs, geoRing);
assert.ok(nearPlan && nearPlan.retracted === 1, 'near-shape whisker should retract by default');
assert.equal(planSpurRetraction(nearRoute, nearWps, nearTs, geoRing, { offShapeM: 50 }), null);

// --- End-to-end fidelity on a synthetic street grid (worst-case L-router) ---
// Replays the main.js drawing-board loop (select → snap → route → calibrate →
// refine → post-calibrate) against a deterministic Manhattan grid and guards
// the improvement over the old even-spacing behaviour.
{
  const world = makeGridWorld({ anchor: shapeAnchor, spacingM: 80, tieBreak: 'lshape' });
  const distXY = (a, b) => {
    const A = world.toXY(a);
    const B = world.toXY(b);
    return Math.hypot(B[0] - A[0], B[1] - A[1]);
  };
  const snapPairs = (ring, ts) => {
    const kept = [];
    for (const t of ts) {
      const s = world.snap(ringPointAtT(ring, t)).point;
      const prev = kept[kept.length - 1];
      if (prev && distXY(prev.wp, s) < 30) continue;
      kept.push({ t, wp: s });
    }
    if (kept.length >= 2 && distXY(kept[0].wp, kept[kept.length - 1].wp) < 30) kept.pop();
    return { ts: kept.map((k) => k.t), wps: kept.map((k) => k.wp) };
  };
  const legacyCount = (m) => Math.max(6, Math.min(16, Math.round((m / 1000) * 1.6)));

  const runPipeline = (strokePts, targetM, mode) => {
    const wpCount = mode === 'v0'
      ? legacyCount(targetM)
      : suggestWaypointCount(targetM, { strokeCount: 1, corners: countShapeCorners(strokePts) });
    let scaled = targetM;
    let ring, ts, wps, coords, actual;
    const plan = () => {
      ring = strokeToLatLngRing(strokePts, shapeAnchor, scaled);
      const sel = mode === 'v0' ? null : selectWaypointTs(ring, wpCount);
      if (mode === 'v0') {
        wps = snapPairs(ring, pickShapeWaypoints(ring, wpCount).map((_, i) => i / wpCount)).wps;
        ts = null;
      } else {
        ({ ts, wps } = snapPairs(ring, sel));
      }
      coords = world.routeLoop(wps);
      actual = totalDistance(coords);
    };
    plan();
    for (let a = 0; a < 2 && needsDistanceCalibration(actual, targetM); a++) {
      scaled = nextCalibratedTarget(scaled, actual, targetM);
      plan();
    }
    if (mode !== 'v0') {
      for (let r = 0; r < 3; r++) {
        const next = planRefinementTs(ring, ts, coords, wps, { minDevM: Math.max(45, targetM * 0.01), maxInsert: 4, maxTotal: 30 });
        if (!next) break;
        const before = { ts, wps, coords, actual, dev: ringRouteDeviation(ring, coords) };
        ({ ts, wps } = snapPairs(ring, next));
        coords = world.routeLoop(wps);
        actual = totalDistance(coords);
        const dev = ringRouteDeviation(ring, coords);
        if (!(dev.maxM <= before.dev.maxM * 0.9 || dev.meanM <= before.dev.meanM * 0.85)) {
          ({ ts, wps, coords, actual } = before);
          break;
        }
      }
      // Damped mileage recalibration with keep-best revert; budget shared
      // across v4's trim/calibrate alternation.
      let calibBudget = mode === 'v4' ? 4 : 2;
      const dampedCalib = () => {
        while (calibBudget > 0 && needsDistanceCalibration(actual, targetM, 0.08)) {
          calibBudget--;
          const before = { scaled, ring, ts, wps, coords, actual };
          scaled = Math.max(targetM * 0.4, Math.min(targetM * 2.5, scaled * Math.sqrt(targetM / actual)));
          ring = strokeToLatLngRing(strokePts, shapeAnchor, scaled);
          ({ ts, wps } = snapPairs(ring, before.ts));
          coords = world.routeLoop(wps);
          actual = totalDistance(coords);
          if (Math.abs(actual - targetM) > Math.abs(before.actual - targetM)) {
            ({ scaled, ring, ts, wps, coords, actual } = before);
            return false;
          }
        }
        return true;
      };
      // v4: retract ALL waypoint whiskers (the figure should enclose area),
      // alternating with recalibration; kept only when the whisker total
      // strictly shrinks.
      if (mode === 'v4') {
        for (let s = 0; s < 3; s++) {
          const spurBefore = totalSpurLengthM(detectRouteSpurs(coords));
          if (spurBefore > 0) {
            const before = { ts, wps, coords, actual };
            const plan = planSpurRetraction(coords, wps, ts, ring);
            if (plan) {
              ({ ts, wps } = plan);
              coords = world.routeLoop(wps);
              actual = totalDistance(coords);
              if (totalSpurLengthM(detectRouteSpurs(coords)) >= spurBefore) {
                ({ ts, wps, coords, actual } = before);
              }
            }
          }
          if (!dampedCalib()) break;
        }
      } else {
        dampedCalib();
      }
    }
    return {
      maxDev: ringRouteDeviation(ring, coords).maxM,
      simPct: shapeSimilarity(coords, ring) * 100,
      actual,
      wpCount: wps.length,
      spurM: totalSpurLengthM(detectRouteSpurs(coords)),
    };
  };

  assert.ok(SHAPE_NAMES.includes('star') && SHAPE_NAMES.includes('palm'));
  for (const [shape, v0Min, v3Max] of [['star', 100, 80], ['palm', 110, 90]]) {
    const strokePts = shapeStroke(shape);
    const v0 = runPipeline(strokePts, 5000, 'v0');
    const v3 = runPipeline(strokePts, 5000, 'v3');
    assert.ok(v0.maxDev > v0Min, `${shape}: legacy pipeline maxDev ${v0.maxDev.toFixed(0)} unexpectedly good (< ${v0Min})`);
    assert.ok(v3.maxDev < v3Max, `${shape}: refined pipeline maxDev ${v3.maxDev.toFixed(0)} too high (>= ${v3Max})`);
    assert.ok(v3.simPct >= 88, `${shape}: similarity ${v3.simPct.toFixed(0)}% < 88%`);
    assert.ok(v3.wpCount <= 30, `${shape}: waypoint count ${v3.wpCount} > 30`);
    assert.ok(Math.abs(v3.actual - 5000) / 5000 <= 0.12, `${shape}: mileage error ${(Math.abs(v3.actual - 5000) / 50).toFixed(0)}%`);
    // All-whisker retraction (畫作要有包圍面積): the whisker total must
    // clearly shrink, at a bounded cost in tip sharpness and mileage.
    const v4 = runPipeline(strokePts, 5000, 'v4');
    assert.ok(v4.spurM <= v3.spurM - 80, `${shape}: whiskers ${v4.spurM.toFixed(0)} m not clearly below v3 ${v3.spurM.toFixed(0)} m`);
    assert.ok(v4.maxDev < 210, `${shape}: trimmed pipeline maxDev ${v4.maxDev.toFixed(0)} too high (>= 210)`);
    assert.ok(v4.simPct >= 88, `${shape}: trimmed similarity ${v4.simPct.toFixed(0)}% < 88%`);
    assert.ok(Math.abs(v4.actual - 5000) / 5000 <= 0.13, `${shape}: trimmed mileage error ${(Math.abs(v4.actual - 5000) / 50).toFixed(0)}%`);
  }
}

console.log('Numeric regression ok');
