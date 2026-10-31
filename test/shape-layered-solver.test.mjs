import assert from 'node:assert/strict';
import { RoadNetworkGraph } from '../src/modules/gpsArtOptimizer.js';
import { strokeToLatLngRing } from '../src/modules/shapeRoutePlanner.js';
import {
  LAYERED_DEFAULTS,
  buildLayeredField,
  collectNodesInBounds,
  solveLayeredAtLambda,
  solveShapeRoute,
  layeredStateIndex,
  waypointsFromSolvedPath,
} from '../src/modules/shapeLayeredSolver.js';

console.log('Testing shapeLayeredSolver.js...');

const CENTER = [25.034, 121.564];

/**
 * Synthetic Manhattan grid: (cols+1) x (rows+1) junctions spaced `spacingM`
 * apart, every junction wired to its 4-neighbours. Nodes carry no highway tag,
 * so isNodeAllowedForTravelMode admits them for every travel mode.
 */
function buildGridGraph({ cols = 40, rows = 40, spacingM = 50 } = {}) {
  const graph = new RoadNetworkGraph(CENTER);
  const idOf = (i, j) => i * (rows + 1) + j + 1;
  const originX = -(cols * spacingM) / 2;
  const originY = -(rows * spacingM) / 2;
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      graph.addNode(idOf(i, j), originX + i * spacingM, originY + j * spacingM);
    }
  }
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      if (i < cols) {
        graph.addEdge(idOf(i, j), idOf(i + 1, j), spacingM);
        graph.addEdge(idOf(i + 1, j), idOf(i, j), spacingM);
      }
      if (j < rows) {
        graph.addEdge(idOf(i, j), idOf(i, j + 1), spacingM);
        graph.addEdge(idOf(i, j + 1), idOf(i, j), spacingM);
      }
    }
  }
  return graph;
}

/** Axis-aligned square stroke in canvas pixels (y grows downward). */
const SQUARE_STROKE = (() => {
  const pts = [];
  const side = 100;
  const n = 25;
  for (let i = 0; i < n; i++) pts.push([(side * i) / n, 0]);
  for (let i = 0; i < n; i++) pts.push([side, (side * i) / n]);
  for (let i = 0; i < n; i++) pts.push([side - (side * i) / n, side]);
  for (let i = 0; i < n; i++) pts.push([0, side - (side * i) / n]);
  return pts;
})();

/** Four-pointed star stroke — self-crossing-free but with sharp cusps. */
const STAR_STROKE = (() => {
  const pts = [];
  const tips = 5;
  for (let i = 0; i < tips * 2; i++) {
    const r = i % 2 === 0 ? 100 : 42;
    const a = (Math.PI * i) / tips - Math.PI / 2;
    const from = [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
    const nextR = i % 2 === 0 ? 42 : 100;
    const nextA = (Math.PI * (i + 1)) / tips - Math.PI / 2;
    const to = [100 + nextR * Math.cos(nextA), 100 + nextR * Math.sin(nextA)];
    for (let s = 0; s < 8; s++) {
      pts.push([from[0] + ((to[0] - from[0]) * s) / 8, from[1] + ((to[1] - from[1]) * s) / 8]);
    }
  }
  return pts;
})();

function totalGeoLengthM(graph, coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = graph.geoToXy(coords[i - 1][0], coords[i - 1][1]);
    const b = graph.geoToXy(coords[i][0], coords[i][1]);
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

// 1. Field construction: buckets, corridor radius, admissible state count
{
  const graph = buildGridGraph();
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, 1600, { direction: 'ccw' });
  assert.ok(ring && ring.length >= 3, 'ring should be produced');

  const field = buildLayeredField(graph, ring, { travelMode: 'foot' });
  assert.ok(field && !field.tooLarge, 'field should build for a dense grid');
  assert.ok(field.K >= 24 && field.K <= 192, `bucket count in range, got ${field.K}`);
  assert.ok(Math.abs(field.bucketLen * field.K - field.perimM) < 1e-6, 'buckets partition the perimeter');
  assert.ok(
    Math.abs(field.corridorR - Math.min(260, field.bucketLen * 0.9)) < 1e-9,
    `corridor radius derives from the bucket length, got ${field.corridorR}`
  );
  assert.ok(field.corridorR < field.bucketLen, 'the corridor stays narrower than one bucket of arc');
  assert.ok(field.stateCount > field.nodeCount, 'nodes carry more than one bucket on average');
  assert.ok(field.stateCount < field.nodeCount * (field.K + 1), 'corridor filtering keeps the product graph sparse');

  // Every state's recorded deviation must be inside the corridor.
  for (let s = 0; s < field.stateCount; s++) {
    assert.ok(field.stateDev[s] <= field.corridorR + 1e-6, 'state deviation within corridor radius');
  }
  // Bucket lists are ascending, so lowerBound in the hot loop is valid.
  for (let ni = 0; ni < field.nodeCount; ni++) {
    const bs = field.bucketsOf[ni];
    for (let j = 1; j < bs.length; j++) assert.ok(bs[j] > bs[j - 1], 'bucket list strictly ascending');
    assert.equal(layeredStateIndex(field, ni, bs[0]), field.stateBase[ni], 'state index maps to the base slot');
  }
  console.log(`  field: K=${field.K} nodes=${field.nodeCount} states=${field.stateCount} R=${field.corridorR.toFixed(0)}m`);
}

// 2. Corridor radius guard: an unusably small maxStates must report, not throw
{
  const graph = buildGridGraph();
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, 1600, { direction: 'ccw' });
  const field = buildLayeredField(graph, ring, { maxStates: 10 });
  assert.ok(field && field.tooLarge === true, 'oversized corridor reports tooLarge');
  assert.equal(solveLayeredAtLambda(field, 1, 0), null, 'a tooLarge field cannot be solved');
}

// 3. Monotonicity: route length is non-increasing in λ (the bisection invariant)
{
  const graph = buildGridGraph();
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, 1600, { direction: 'ccw' });
  const field = buildLayeredField(graph, ring, { travelMode: 'foot' });
  const startId = field.nodeIds.find((id, ni) => {
    const bs = field.bucketsOf[ni];
    return bs[0] === 0 && bs[bs.length - 1] === field.K;
  });
  assert.ok(startId != null, 'a node able to open and close the loop exists');

  const lengths = [];
  for (const lambda of [LAYERED_DEFAULTS.lambdaMin, -0.5, -0.2, 0, 1, 2, 4, 8, 12]) {
    const r = solveLayeredAtLambda(field, startId, lambda);
    assert.ok(r, `λ=${lambda} must be feasible on a dense grid`);
    lengths.push(r.lengthM);
  }
  for (let i = 1; i < lengths.length; i++) {
    assert.ok(
      lengths[i] <= lengths[i - 1] + 1e-6,
      `length must not grow with λ: ${lengths[i - 1].toFixed(1)} → ${lengths[i].toFixed(1)}`
    );
  }
  console.log(`  λ sweep lengths: ${lengths.map((l) => Math.round(l)).join(' → ')}`);
}

// 4. Determinism: identical inputs give a bit-identical path
{
  const ringFor = () => strokeToLatLngRing(SQUARE_STROKE, CENTER, 1600, { direction: 'ccw' });
  const a = solveShapeRoute(buildGridGraph(), ringFor(), { targetLengthM: 1600, travelMode: 'foot' });
  const b = solveShapeRoute(buildGridGraph(), ringFor(), { targetLengthM: 1600, travelMode: 'foot' });
  assert.ok(a.ok && b.ok, 'both solves succeed');
  assert.deepEqual(a.nodePath, b.nodePath, 'Dijkstra on a fixed cost function is deterministic');
  assert.equal(a.lambda, b.lambda, 'bisection is deterministic');
}

// 5. Square on a grid: tight fidelity and mileage, closed loop, no immediate backtracking
{
  const graph = buildGridGraph({ cols: 48, rows: 48, spacingM: 50 });
  const targetM = 1800;
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, targetM / 1.1, { direction: 'ccw' });
  const res = solveShapeRoute(graph, ring, { targetLengthM: targetM, travelMode: 'foot' });
  assert.ok(res.ok, `square must solve, got ${res.reason}`);

  const first = res.routeCoordsGeo[0];
  const last = res.routeCoordsGeo[res.routeCoordsGeo.length - 1];
  assert.ok(Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9, 'loop closes on the start node');

  // A grid aligned to an axis-aligned square should track it to within a block.
  assert.ok(res.meanDevM <= 60, `mean deviation should stay within a block, got ${res.meanDevM.toFixed(1)}m`);
  assert.ok(res.maxDevM <= 180, `max deviation bounded, got ${res.maxDevM.toFixed(1)}m`);
  assert.ok(res.similarity >= 0.75, `similarity should be high on a grid, got ${res.similarity.toFixed(3)}`);

  const lenErr = Math.abs(res.lengthM - targetM) / targetM;
  assert.ok(lenErr <= 0.12, `λ bisection should land near the target, got ${(lenErr * 100).toFixed(1)}%`);
  assert.ok(
    Math.abs(totalGeoLengthM(graph, res.routeCoordsGeo) - res.lengthM) < 1,
    'reported length matches the emitted geometry'
  );

  // Monotone progress forbids A→B→A inside one bucket; check none survived.
  for (let i = 2; i < res.nodePath.length; i++) {
    assert.notEqual(res.nodePath[i], res.nodePath[i - 2], `immediate backtrack at index ${i}`);
  }
  console.log(`  square: len=${res.lengthM.toFixed(0)}m (target ${targetM}) meanDev=${res.meanDevM.toFixed(1)}m maxDev=${res.maxDevM.toFixed(1)}m sim=${(res.similarity * 100).toFixed(0)}% solves=${res.solveCount}`);
}

// 6. Star with sharp cusps: the detail the chord-corridor heuristic flattens
{
  const graph = buildGridGraph({ cols: 60, rows: 60, spacingM: 40 });
  const targetM = 3000;
  const ring = strokeToLatLngRing(STAR_STROKE, CENTER, targetM / 1.15, { direction: 'ccw' });
  const res = solveShapeRoute(graph, ring, { targetLengthM: targetM, travelMode: 'foot' });
  assert.ok(res.ok, `star must solve, got ${res.reason}`);
  assert.ok(res.meanDevM <= 70, `star mean deviation, got ${res.meanDevM.toFixed(1)}m`);
  assert.ok(res.similarity >= 0.6, `star similarity, got ${res.similarity.toFixed(3)}`);
  assert.ok(res.bucketCount >= 24, 'star gets enough progress buckets to express its cusps');
  console.log(`  star: len=${res.lengthM.toFixed(0)}m meanDev=${res.meanDevM.toFixed(1)}m sim=${(res.similarity * 100).toFixed(0)}% states=${res.stateCount}`);
}

// 7. Target longer / shorter than the ring can express: bracket, never crash
{
  const graph = buildGridGraph();
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, 1600, { direction: 'ccw' });
  const tooLong = solveShapeRoute(graph, ring, { targetLengthM: 40000, travelMode: 'foot' });
  assert.ok(tooLong.ok, 'an unreachable long target still returns the most faithful solve');
  assert.ok(tooLong.lengthM <= tooLong.maxLengthM + 1e-6, 'clamped to the λ=0 length');
  assert.ok(tooLong.lambda < 0, 'an over-long target picks the most faithful end of the λ family');

  const tooShort = solveShapeRoute(graph, ring, { targetLengthM: 100, travelMode: 'foot' });
  assert.ok(tooShort.ok, 'an unreachable short target still returns the shortest solve');
  assert.ok(tooShort.lengthM >= tooShort.minLengthM - 1e-6, 'clamped to the λ=λmax length');
}

// 8. Degenerate and hostile inputs are reported, never thrown
{
  const graph = buildGridGraph({ cols: 4, rows: 4, spacingM: 50 });
  assert.equal(solveShapeRoute(null, []).ok, false, 'null graph reports');
  assert.equal(solveShapeRoute(graph, [[0, 0]]).ok, false, 'a 1-point ring reports');
  assert.equal(buildLayeredField(graph, null), null, 'null ring builds nothing');
  assert.equal(buildLayeredField(new RoadNetworkGraph(CENTER), [[25, 121], [25.01, 121], [25, 121.01]]), null,
    'an empty graph builds nothing');

  // A ring far outside the graph has no corridor at all.
  const faraway = strokeToLatLngRing(SQUARE_STROKE, [26.5, 122.5], 1600, { direction: 'ccw' });
  const res = solveShapeRoute(graph, faraway, { targetLengthM: 1600 });
  assert.equal(res.ok, false, 'a ring outside the graph reports a reason');
  assert.ok(typeof res.reason === 'string' && res.reason.length > 0, 'failure carries a reason');
}

// 9. Waypoint extraction: on-road, budgeted, distinct, anchored at the start
{
  const graph = buildGridGraph({ cols: 48, rows: 48, spacingM: 50 });
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, 1800, { direction: 'ccw' });
  const res = solveShapeRoute(graph, ring, { targetLengthM: 1800, travelMode: 'foot' });
  assert.ok(res.ok, 'solve for waypoint extraction');

  const wps = waypointsFromSolvedPath(graph, res.routeCoordsGeo, { maxCount: 20, minCount: 6 });
  assert.ok(wps.length >= 4 && wps.length <= 20, `waypoint budget respected, got ${wps.length}`);
  assert.deepEqual(wps[0], res.routeCoordsGeo[0], 'first waypoint is the anchor');
  const lastWp = wps[wps.length - 1];
  assert.ok(
    Math.abs(lastWp[0] - wps[0][0]) > 1e-9 || Math.abs(lastWp[1] - wps[0][1]) > 1e-9,
    'waypoints are distinct — the O-loop mode closes the ring itself'
  );
  for (const [lat, lng] of wps) {
    assert.ok(Number.isFinite(lat) && Number.isFinite(lng), 'waypoints are finite coordinates');
  }
  assert.deepEqual(waypointsFromSolvedPath(graph, [[25, 121], [25, 121]]), [], 'degenerate path yields no waypoints');
  console.log(`  waypoints: ${wps.length} from ${res.routeCoordsGeo.length} solved vertices`);
}

// 10. collectNodesInBounds prefilter: same answer, fewer nodes scanned
{
  const graph = buildGridGraph({ cols: 60, rows: 60, spacingM: 50 });
  const targetM = 1800;
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, targetM / 1.1, { direction: 'ccw' });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [la, ln] of ring) {
    const [x, y] = graph.geoToXy(la, ln);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const PAD = 1000;
  const box = { minX: minX - PAD, minY: minY - PAD, maxX: maxX + PAD, maxY: maxY + PAD };
  const nodeCandidates = collectNodesInBounds(graph, box);

  assert.ok(nodeCandidates.length > 0, 'prefilter finds nodes around the ring');
  assert.ok(nodeCandidates.length < graph.nodes.size, 'prefilter is actually a subset');
  for (const n of nodeCandidates) {
    assert.ok(n.x >= box.minX && n.x <= box.maxX && n.y >= box.minY && n.y <= box.maxY, 'node inside the box');
  }

  // The padded box covers the whole corridor, so the solve must be unchanged.
  const full = solveShapeRoute(graph, ring, { targetLengthM: targetM, travelMode: 'foot' });
  const pre = solveShapeRoute(graph, ring, { targetLengthM: targetM, travelMode: 'foot', nodeCandidates });
  assert.ok(full.ok && pre.ok, 'both solve');
  assert.deepEqual(pre.nodePath, full.nodePath, 'prefiltering a padded box does not change the optimum');
  assert.equal(pre.stateCount, full.stateCount, 'same corridor, same state count');

  // Degenerate boxes report empty rather than throwing, and an empty candidate
  // list must fall back to the full node set instead of yielding no corridor.
  assert.deepEqual(collectNodesInBounds(null, box), [], 'null graph yields no nodes');
  assert.deepEqual(collectNodesInBounds(graph, null), [], 'null bounds yields no nodes');
  assert.deepEqual(collectNodesInBounds(graph, { minX: NaN, minY: 0, maxX: 1, maxY: 1 }), [], 'non-finite bounds yield no nodes');
  const emptyFallback = solveShapeRoute(graph, ring, { targetLengthM: targetM, travelMode: 'foot', nodeCandidates: [] });
  assert.ok(emptyFallback.ok, 'an empty prefilter falls back to scanning every node');

  // A box that misses most of the ring must fail cleanly, not silently return a
  // route that ignores the uncovered part of the shape.
  const clipped = collectNodesInBounds(graph, { minX: minX - PAD, minY: minY - PAD, maxX: minX + 50, maxY: minY + 50 });
  const clippedRes = solveShapeRoute(graph, ring, { targetLengthM: targetM, travelMode: 'foot', nodeCandidates: clipped });
  assert.equal(clippedRes.ok, false, 'a box that clips the ring reports failure');
  console.log(`  prefilter: ${nodeCandidates.length}/${graph.nodes.size} nodes scanned, same optimum`);
}

// 11. Travel mode filtering reaches the corridor
{
  const graph = buildGridGraph({ cols: 30, rows: 30, spacingM: 50 });
  // Tag the whole grid as motorway: foot must find no corridor, car still does.
  for (const node of graph.nodes.values()) node.highway = 'motorway';
  const ring = strokeToLatLngRing(SQUARE_STROKE, CENTER, 1200, { direction: 'ccw' });
  assert.equal(buildLayeredField(graph, ring, { travelMode: 'foot' }), null, 'foot mode rejects a motorway-only grid');
  const carField = buildLayeredField(graph, ring, { travelMode: 'car' });
  assert.ok(carField && !carField.tooLarge && carField.nodeCount > 0, 'car mode accepts the same grid');
}

console.log('shapeLayeredSolver.js test passed successfully!');
