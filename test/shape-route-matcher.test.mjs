import assert from 'node:assert/strict';
import {
  generateShapeMatchedRoute,
  chaikinSmooth,
  normalizeCanvasGeometry,
  simplifyRDP,
  resampleWithCurvatureAnchors,
  projectToGeo,
  splitIntoTopologicalSegments,
  stitchSegments,
  pruneSpursAndSpikes,
  discreteFrechetDistance,
  averageTangentSimilarity,
  evaluateShapeSimilarity,
  haversineDistanceM,
  computeGeoPathLength,
  createOsrmShapeAdapter,
  GPSArtOptimizer,
  RoadNetworkGraph,
  RouteConstraints,
  KDTree2D,
  isExcessiveLegDetour,
} from '../src/modules/shapeRouteMatcher.js';
import { findOptimalViewportAnchor } from '../src/modules/shapeRoutePlanner.js';

console.log('Testing shapeRouteMatcher.js...');

// 1. Chaikin Smoothing & Loop Detection
{
  const jitteryStroke = [
    { x: 10, y: 10 },
    { x: 12, y: 11 },
    { x: 50, y: 10 },
    { x: 52, y: 50 },
    { x: 10, y: 50 },
    { x: 10, y: 10 },
  ];
  const smoothed = chaikinSmooth(jitteryStroke, 2, true);
  assert.ok(smoothed.length > jitteryStroke.length, 'Chaikin smoothing should subdivide edges');
  assert.equal(typeof smoothed[0].x, 'number');
}

// 2. Normalization & Aspect Ratio
{
  const rect = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
    { x: 0, y: 0 },
  ];
  const { normalizedPoints, normArcLength, width, height } = normalizeCanvasGeometry(rect);
  assert.ok(normArcLength > 0, 'Normalized arc length must be positive');
  assert.ok(Math.abs(width - 1.0) < 1e-4, 'Width span should be normalized to 1');
  assert.ok(Math.abs(height - 0.5) < 1e-4, 'Height span should maintain 2:1 aspect ratio');
  // Check Y inversion (downward Y in canvas becomes negative Y in normalized space)
  assert.ok(normalizedPoints[2].y < normalizedPoints[0].y, 'Y should be inverted for geo north');
}

// 3. Ramer-Douglas-Peucker & Curvature Anchors
{
  const starLike = [
    { x: 50, y: 0 },
    { x: 65, y: 35 },
    { x: 100, y: 35 },
    { x: 75, y: 58 },
    { x: 85, y: 95 },
    { x: 50, y: 72 },
    { x: 15, y: 95 },
    { x: 25, y: 58 },
    { x: 0, y: 35 },
    { x: 35, y: 35 },
    { x: 50, y: 0 },
  ];
  const { normalizedPoints } = normalizeCanvasGeometry(starLike);
  const anchors = resampleWithCurvatureAnchors(normalizedPoints, 0.05, 38, true);
  const corners = anchors.filter((a) => a.isCorner);
  assert.ok(corners.length >= 8, `Expected at least 8 curvature anchors on star, got ${corners.length}`);
}

// 4. Isotropic Geo-Projection & Anchor Alignment
{
  const diamond = [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
  ];
  const userAnchor = [25.034, 121.564];
  const projected = projectToGeo(diamond.map((p) => ({ ...p, isCorner: true })), {
    anchor: userAnchor,
    scaleMeters: 500,
    rotationDeg: 0,
  });

  // Verify that vertex 0 coincides exactly with userAnchor
  assert.ok(
    haversineDistanceM(projected[0], { lat: userAnchor[0], lng: userAnchor[1] }) < 0.01,
    'Vertex 0 must align with user anchor'
  );
}

// 5. Discrete Fréchet Distance & Direction Similarity
{
  const lineA = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
  ];
  const lineB = [
    { x: 0, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 1, y: 0.1 },
  ];
  const dF = discreteFrechetDistance(lineA, lineB);
  assert.ok(Math.abs(dF - 0.1) < 1e-6, `Expected Fréchet dist ~0.1, got ${dF}`);

  const dirSim = averageTangentSimilarity(lineA, lineB);
  assert.ok(Math.abs(dirSim - 1.0) < 1e-6, 'Parallel lines should have tangent similarity of 1.0');

  const simResult = evaluateShapeSimilarity(lineA, lineB);
  assert.ok(simResult.score >= 70, `Expected high similarity score for parallel lines, got ${simResult.score}`);
}

// 6. Spur Pruning with Corner Protection
{
  const originalCorners = [
    { lat: 25.034, lng: 121.564, isCorner: true },
    { lat: 25.036, lng: 121.564, isCorner: false },
  ];
  // A route that goes out along dead-end alley and doubles back
  const routeWithDeadEnd = [
    [25.0340, 121.5640],
    [25.0345, 121.5640],
    [25.0348, 121.5645], // dead-end alley entrance
    [25.0348, 121.5649],
    [25.0348, 121.5652], // alley tip (not an intentional corner)
    [25.0348, 121.5649],
    [25.0348, 121.5645], // back to alley entrance
    [25.0355, 121.5640],
    [25.0360, 121.5640],
  ];

  const pruned = pruneSpursAndSpikes(routeWithDeadEnd, originalCorners, 85);
  assert.ok(pruned.length < routeWithDeadEnd.length, 'Dead-end alley should be pruned');
  assert.ok(pruned.length >= 4, 'Remaining main path should be intact');
}

// 7. End-to-End generateShapeMatchedRoute Execution (Mocked Routing)
{
  const heartPoints = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    heartPoints.push([150 + x * 7, 150 + y * 7]);
  }

  // Mock routing adapter: returns intermediate points to simulate road matching
  const mockAdapter = async (waypoints, isMatchMode) => {
    const coords = [];
    for (let i = 0; i < waypoints.length; i++) {
      const p = waypoints[i];
      coords.push(Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lng]);
    }
    return coords;
  };

  const result = await generateShapeMatchedRoute(heartPoints, {
    anchor: [25.034, 121.564],
    targetDistanceM: 5000,
    detourFactor: 1.32,
    routingAdapter: mockAdapter,
  });

  assert.ok(result.route && result.route.length >= 10, 'Route should have sufficient vertices');
  assert.ok(result.waypoints && result.waypoints.length <= 25, 'UI waypoints should be within budget');
  assert.ok(result.similarityScore >= 80, `Expected high similarity score, got ${result.similarityScore}`);
  assert.ok(result.distanceM > 0, 'Distance should be greater than 0');
  assert.ok(
    haversineDistanceM(result.route[0], { lat: 25.034, lng: 121.564 }) < 0.05,
    'Route start should coincide with anchor'
  );
}

// 8. GPSArtOptimizer & RoadNetworkGraph & Differential Evolution
{
  const city = RoadNetworkGraph.buildSyntheticCityGraph(22, 100.0);
  assert.ok(city.nodes.size > 100, 'Synthetic city graph should contain nodes');
  assert.ok(city.kdtree != null, 'KDTree should be built');

  const optimizer = new GPSArtOptimizer(city);

  // Five-pointed star
  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1.0 : 0.42;
    const th = (i * Math.PI) / 5 - Math.PI / 2;
    star.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  star.push(star[0]);

  const constraints = new RouteConstraints({
    targetLengthM: 4800.0,
    travelMode: 'walk',
    maxTurningPoints: 12,
    closedLoop: true,
    rotationBoundsDeg: [0.0, 72.0],
    scaleBoundsRatio: [0.7, 1.3],
  });

  const solution = optimizer.optimize(star, constraints);

  assert.ok(solution.actualLengthM > 3000 && solution.actualLengthM < 6500, `Actual distance ${solution.actualLengthM} should be near target 4800m`);
  assert.ok(solution.keyWaypoints.length >= 3, 'Key waypoints should be generated');
  assert.ok(solution.routedGeometryGeo.length > 10, 'Full routed geometry should have dense points');
  assert.ok(solution.overlapRatio >= 0 && solution.overlapRatio <= 1, 'Overlap ratio should be in [0, 1]');
  assert.ok(solution.objectiveScore > 0, 'Objective score should be positive');
  assert.ok(solution.similarityPct >= 50, `Expected reasonable shape similarity percentage, got ${solution.similarityPct}`);
}

// 9. Pattern Intermediate Start Point Shifting (shiftPatternStart)
{
  const square = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  // Shift by 25% (vertex [10, 0])
  const shifted25 = GPSArtOptimizer.shiftPatternStart(square, 0.25, true);
  assert.equal(shifted25.length, square.length, 'Shifted polygon vertex count should match');
  assert.ok(Math.hypot(shifted25[0][0] - 10, shifted25[0][1] - 0) < 0.5, 'Vertex 0 should shift to intermediate corner');
  assert.ok(Math.hypot(shifted25[shifted25.length - 1][0] - shifted25[0][0], shifted25[shifted25.length - 1][1] - shifted25[0][1]) < 1e-4, 'Loop should close at new start');

  // Shift by intermediate mid-segment fraction 0.125 ([5, 0])
  const shifted125 = GPSArtOptimizer.shiftPatternStart(square, 0.125, true);
  assert.ok(Math.hypot(shifted125[0][0] - 5, shifted125[0][1] - 0) < 0.5, 'Vertex 0 should shift to mid-segment');
  assert.ok(Math.hypot(shifted125[shifted125.length - 1][0] - shifted125[0][0], shifted125[shifted125.length - 1][1] - shifted125[0][1]) < 1e-4, 'Loop should close at new start');
}

// 10. Iterative Calibration Constraints (calibrateConstraints)
{
  const baseConstraints = new RouteConstraints({
    targetLengthM: 5000.0,
    travelMode: 'walk',
    rotationBoundsDeg: [0, 360],
  });

  // If actual mileage was 4000m (under by 20%), calibrated target should scale up
  const calibrated = GPSArtOptimizer.calibrateConstraints(baseConstraints, 4000.0, 75, {
    targetM: 5000.0,
    bestAngleDeg: 45.0,
  });

  assert.ok(calibrated.targetLengthM > 5000.0, `Expected calibrated target > 5000m, got ${calibrated.targetLengthM}`);
  assert.ok(calibrated.rotationBoundsDeg[0] >= 20 && calibrated.rotationBoundsDeg[1] <= 70, 'Angle bounds should narrow around best angle');
  assert.equal(calibrated.startFractionBounds[0], 0.0);
  assert.equal(calibrated.startFractionBounds[1], 1.0);
}

// 11. Complete OSM Overpass `out geom qt` Parsing, LCC Pruning, 2-Core Dead-End Detection & Edge Densification
{
  const g = new RoadNetworkGraph([25.034, 121.564]);
  const mockOverpassGeom = {
    elements: [
      // Main connected city block loop (4 corners, ~110m per side)
      {
        type: 'way',
        id: 1001,
        tags: { highway: 'primary' },
        nodes: [1, 2, 3, 4, 1],
        geometry: [
          { lat: 25.034, lon: 121.564 },
          { lat: 25.034, lon: 121.565 },
          { lat: 25.035, lon: 121.565 },
          { lat: 25.035, lon: 121.564 },
          { lat: 25.034, lon: 121.564 },
        ],
      },
      // Attached dead-end cul-de-sac alley at node 2
      {
        type: 'way',
        id: 1002,
        tags: { highway: 'service' },
        nodes: [2, 5],
        geometry: [
          { lat: 25.034, lon: 121.565 },
          { lat: 25.034, lon: 121.5654 },
        ],
      },
      // Disconnected private/island footpath far away
      {
        type: 'way',
        id: 1003,
        tags: { highway: 'footway' },
        nodes: [90, 91],
        geometry: [
          { lat: 25.045, lon: 121.580 },
          { lat: 25.0452, lon: 121.5802 },
        ],
      },
      // Private road that must be ignored
      {
        type: 'way',
        id: 1004,
        tags: { highway: 'service', access: 'private' },
        nodes: [1, 99],
        geometry: [
          { lat: 25.034, lon: 121.564 },
          { lat: 25.033, lon: 121.564 },
        ],
      },
    ],
  };

  const addedEdges = RoadNetworkGraph.populateFromOverpassData(g, mockOverpassGeom, 'walk');
  assert.ok(addedEdges >= 5, 'Should parse embedded way geometry from out geom qt');
  assert.ok(!g.nodes.has(99), 'Private access ways must be excluded');

  g.buildIndex({ pruneComponents: true, anchorXY: [0, 0], densify: true, maxEdgeLengthM: 25 });
  assert.ok(!g.nodes.has(90) && !g.nodes.has(91), 'Disconnected island component must be pruned by LCC');
  assert.ok(g.nodes.size > 12, `Long edges should be densified into intermediate nodes, got ${g.nodes.size}`);
  assert.ok(g.nodes.get(5)?.isDeadEnd === true, 'Cul-de-sac leaf node must be marked as dead-end by 2-core peeling');
  assert.ok(g.nodes.get(1)?.isDeadEnd === false, 'Main block loop node must be in 2-core (not dead-end)');

  const opt = new GPSArtOptimizer(g);
  const nearCulDeSac = g.geoToXy(25.034, 121.5653);
  const snapped = opt.snapPointToRoad(nearCulDeSac, false);
  assert.ok(snapped && !snapped.isDeadEnd, 'Smart 2-core snapping should avoid snapping to cul-de-sac dead-end');
}

// 12. High-Similarity Heart Optimization on Dense Urban Graph with Corridor-Guided A*
{
  const city = RoadNetworkGraph.buildSyntheticCityGraph(26, 75.0);
  const optimizer = new GPSArtOptimizer(city);
  const heart = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    heart.push([150 + x * 7, 150 + y * 7]);
  }
  const constraints = new RouteConstraints({
    targetLengthM: 4500.0,
    travelMode: 'walk',
    maxTurningPoints: 22,
    closedLoop: true,
    flipY: true,
    rotationBoundsDeg: [0, 0],
  });
  const sol = optimizer.optimize(heart, constraints);
  assert.ok(sol.similarityPct >= 85, `Expected heart similarity >= 85% on urban graph, got ${sol.similarityPct}%`);
  assert.ok(Math.abs(sol.actualLengthM - 4500) / 4500 <= 0.12, `Expected calibrated length near 4500m, got ${sol.actualLengthM}`);
}

// 13. Viewport Optimal Anchor Search when no waypoints on map
{
  const city = RoadNetworkGraph.buildSyntheticCityGraph(26, 75.0, [25.034, 121.564]);
  const optimizer = new GPSArtOptimizer(city);
  const heart = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    heart.push([150 + x * 7, 150 + y * 7]);
  }

  const viewportBounds = {
    south: 25.025,
    west: 121.554,
    north: 25.043,
    east: 121.574,
  };
  const viewportCenter = [25.034, 121.564];

  const optRes = findOptimalViewportAnchor({
    viewportBounds,
    viewportCenter,
    strokePts: heart,
    targetM: 4000,
    graph: city,
    optimizer,
    options: { angleTolDeg: 30 },
  });

  assert.ok(optRes.anchor, 'Optimal anchor must be found');
  assert.ok(optRes.similarity > 0.6, `Expected high similarity for optimal anchor, got ${optRes.similarity}`);
  assert.ok(optRes.candidatesCount > 1, `Expected multiple candidates evaluated, got ${optRes.candidatesCount}`);
  assert.ok(optRes.anchor[0] >= viewportBounds.south - 0.01 && optRes.anchor[0] <= viewportBounds.north + 0.01, 'Anchor lat inside viewport');
  assert.ok(optRes.anchor[1] >= viewportBounds.west - 0.01 && optRes.anchor[1] <= viewportBounds.east + 0.01, 'Anchor lng inside viewport');
}

// 14. Detection of excessive navigation detour between adjacent setting points
{
  // Normal city street turns or slight bends should NOT be flagged as excessive detours
  assert.equal(isExcessiveLegDetour(100, 135), false, 'Normal turn should be allowed');
  assert.equal(isExcessiveLegDetour(25, 120), false, 'Short city block turn (<250m) should be allowed');
  assert.equal(isExcessiveLegDetour(500, 900), false, 'Slightly winding road should be allowed');
  assert.equal(isExcessiveLegDetour(1000, 1500), false, 'Long winding street should be allowed');

  // Highway wall, river barrier, or interchange detours MUST be flagged
  assert.equal(isExcessiveLegDetour(60, 360), true, 'Short distance with huge detour (ratio 6.0, excess 300m) must be rejected');
  assert.equal(isExcessiveLegDetour(100, 550), true, 'Physical barrier crossing (ratio 5.5, excess 450m) must be rejected');
  assert.equal(isExcessiveLegDetour(300, 950), true, 'Excessive leg detour (>500m excess and >2.0 ratio) must be rejected');
}

// 15. Travel mode filtering on road network: prohibit highways for running/foot
{
  const graph = new RoadNetworkGraph([25.03, 121.56]);
  // Highway node: motorway (strictly disallowed for foot/running)
  const nHwy1 = graph.addNode('hwy1', 100, 100);
  const nHwy2 = graph.addNode('hwy2', 200, 100);
  graph.addEdge('hwy1', 'hwy2', 100, { highway: 'motorway' });
  graph.addEdge('hwy2', 'hwy1', 100, { highway: 'motorway' });

  // Urban street node: residential (allowed for foot/running)
  const nCity1 = graph.addNode('city1', 100, 105);
  const nCity2 = graph.addNode('city2', 200, 105);
  graph.addEdge('city1', 'city2', 100, { highway: 'residential' });
  graph.addEdge('city2', 'city1', 100, { highway: 'residential' });

  graph.buildIndex({ pruneComponents: false });

  assert.equal(RoadNetworkGraph.isNodeAllowedForTravelMode(nHwy1, 'foot'), false, 'Motorway node must NOT be allowed for foot');
  assert.equal(RoadNetworkGraph.isNodeAllowedForTravelMode(nHwy1, 'car'), true, 'Motorway node must be allowed for car');
  assert.equal(RoadNetworkGraph.isNodeAllowedForTravelMode(nCity1, 'foot'), true, 'Residential node must be allowed for foot');

  const optimizer = new GPSArtOptimizer(graph);
  // Point closer to highway node (y=101 vs y=105)
  const queryPt = { x: 100, y: 101 };

  // For car, it can snap to the closer highway node
  const snappedCar = optimizer.snapPointToRoad(queryPt, true, { travelMode: 'car' });
  assert.equal(snappedCar?.id, 'hwy1', 'Car mode should snap to closer highway node');

  // For foot/running, it MUST skip the illegal highway node and snap to the residential node
  const snappedFoot = optimizer.snapPointToRoad(queryPt, true, { travelMode: 'foot' });
  assert.equal(snappedFoot?.id, 'city1', 'Foot mode must snap to allowed residential street node');
}

// 16. Search and routing rejects excessive detours between adjacent setting points
{
  const graph = new RoadNetworkGraph([25.03, 121.56]);
  // Create two points close to each other (dist = 10m) separated by a barrier
  // Routing between them requires going around a 600m loop
  graph.addNode('p1', 10, 0);
  graph.addNode('far1', 0, 300);
  graph.addNode('far2', 20, 300);
  graph.addNode('p2', 10, 10);

  graph.addEdge('p1', 'far1', 300, { highway: 'residential' });
  graph.addEdge('far1', 'p1', 300, { highway: 'residential' });
  graph.addEdge('far1', 'far2', 20, { highway: 'residential' });
  graph.addEdge('far2', 'far1', 20, { highway: 'residential' });
  graph.addEdge('far2', 'p2', 300, { highway: 'residential' });
  graph.addEdge('p2', 'far2', 300, { highway: 'residential' });

  graph.buildIndex({ pruneComponents: false });
  const optimizer = new GPSArtOptimizer(graph);

  // Directly routing between p1 and p2: straight distance is 10m, route distance is 620m
  const resWithDetourCheck = optimizer.matchAndRoute([{ x: 10, y: 0 }, { x: 10, y: 10 }], {
    rejectExcessiveDetours: true,
  });
  assert.equal(resWithDetourCheck, null, 'Leg with excessive detour (10m vs 620m) must be rejected');

  // Without excessive detour rejection, route would be produced
  const resWithoutCheck = optimizer.matchAndRoute([{ x: 10, y: 0 }, { x: 10, y: 10 }], {
    rejectExcessiveDetours: false,
  });
  assert.ok(resWithoutCheck !== null, 'Route produced when detour rejection is disabled');
}

// 17. Search range expansion when initial candidates fail to route
{
  const city = RoadNetworkGraph.buildSyntheticCityGraph(26, 75.0, [25.034, 121.564]);
  const optimizer = new GPSArtOptimizer(city);
  const heart = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    heart.push([150 + x * 6, 150 + y * 6]);
  }

  const viewportBounds = {
    south: 25.028,
    west: 121.558,
    north: 25.040,
    east: 121.570,
  };
  const viewportCenter = [25.034, 121.564];

  // Test expanded search mode
  const expRes = findOptimalViewportAnchor({
    viewportBounds,
    viewportCenter,
    strokePts: heart,
    targetM: 3500,
    graph: city,
    optimizer,
    options: {
      angleTolDeg: 180,
      expandedSearch: true,
      travelMode: 'foot',
    },
  });

  assert.ok(expRes.anchor, 'Expanded search must find viable anchor');
  assert.ok(expRes.similarity > 0.5, `Expanded search similarity should be solid, got ${expRes.similarity}`);
  assert.ok(Array.isArray(expRes.rankedCandidates), 'Must return rankedCandidates array');
  assert.ok(expRes.rankedCandidates.length >= 1, 'Must have at least one ranked candidate');
}

// 18. Highway avoidance and candidate recovery near highway barriers
{
  const graph = new RoadNetworkGraph([25.034, 121.564]);

  // West side walkable local street network
  graph.addNode('w0', 0, 0);
  graph.addNode('w1', 0, 50);
  graph.addNode('w2', 0, 100);
  graph.addNode('w3', 50, 100);
  graph.addNode('w4', 50, 50);
  graph.addNode('w5', 50, 0);

  const localEdges = [
    ['w0', 'w1'], ['w1', 'w2'], ['w2', 'w3'],
    ['w3', 'w4'], ['w4', 'w5'], ['w5', 'w0'],
    ['w1', 'w4'], ['w0', 'w5']
  ];
  for (const [u, v] of localEdges) {
    const dist = Math.hypot(graph.nodes.get(u).x - graph.nodes.get(v).x, graph.nodes.get(u).y - graph.nodes.get(v).y);
    graph.addEdge(u, v, dist, { highway: 'residential' });
    graph.addEdge(v, u, dist, { highway: 'residential' });
  }

  // Freeway running north-south, forbidden for pedestrians
  graph.addNode('hw1', 60, 0);
  graph.addNode('hw2', 60, 50);
  graph.addNode('hw3', 60, 100);
  graph.addNode('ramp1', 58, 25);
  graph.addEdge('hw1', 'hw2', 50, { highway: 'motorway', isHighway: true });
  graph.addEdge('hw2', 'hw3', 50, { highway: 'motorway', isHighway: true });
  graph.addEdge('ramp1', 'hw2', 30, { highway: 'motorway_link', isHighway: true });

  // East side across the freeway, only reachable via far underpass at y=1200
  graph.addNode('e1', 75, 0);
  graph.addNode('e2', 75, 50);
  graph.addNode('e3', 75, 100);
  graph.addEdge('e1', 'e2', 50, { highway: 'residential' });
  graph.addEdge('e2', 'e3', 50, { highway: 'residential' });
  graph.addEdge('e3', 'e2', 50, { highway: 'residential' });
  graph.addEdge('e2', 'e1', 50, { highway: 'residential' });

  // Distant crossing at y=1200
  graph.addNode('cross_w', 50, 1200);
  graph.addNode('cross_e', 75, 1200);
  graph.addEdge('w3', 'cross_w', 1100, { highway: 'residential' });
  graph.addEdge('cross_w', 'w3', 1100, { highway: 'residential' });
  graph.addEdge('cross_w', 'cross_e', 25, { highway: 'footway' });
  graph.addEdge('cross_e', 'cross_w', 25, { highway: 'footway' });
  graph.addEdge('cross_e', 'e3', 1100, { highway: 'residential' });
  graph.addEdge('e3', 'cross_e', 1100, { highway: 'residential' });

  graph.buildIndex({ pruneComponents: false });
  const optimizer = new GPSArtOptimizer(graph);

  // 1. Verify candidate query for foot mode steers away from highway and ramps
  const candidates = optimizer.snapPointCandidates({ x: 59, y: 50 }, 4, { travelMode: 'foot' });
  assert.ok(candidates.length > 0, 'Should find candidates on allowed roads');
  for (const cand of candidates) {
    assert.ok(
      cand.id !== 'hw1' && cand.id !== 'hw2' && cand.id !== 'hw3' && cand.id !== 'ramp1',
      `Candidate ${cand.id} must NOT be on disallowed highway or ramp`
    );
  }

  // 2. Drawing board route drawn near highway fence with one point at { x: 62, y: 100 }
  const drawnStroke = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 62, y: 100 }, // Drawn over the highway corridor
    { x: 50, y: 0 },
    { x: 0, y: 0 }
  ];

  const routeRes = optimizer.matchAndRoute(drawnStroke, {
    travelMode: 'foot',
    rejectExcessiveDetours: true,
  });

  assert.ok(routeRes !== null, 'Route generation near highway must succeed by adjusting setting points');
  assert.ok(Array.isArray(routeRes.routeCoordsXY) && routeRes.routeCoordsXY.length >= 4, 'Route should contain coordinates');
  assert.ok(
    !routeRes.snappedNodes.includes('hw1') &&
    !routeRes.snappedNodes.includes('hw2') &&
    !routeRes.snappedNodes.includes('hw3') &&
    !routeRes.snappedNodes.includes('ramp1'),
    'Setting points must steer away from disallowed highway roads'
  );
  // Route distance should remain reasonable (local loop ~200-350m) instead of detouring 2400m to distant bridge
  assert.ok(
    routeRes.totalLengthM < 600,
    `Route should not detour wildly across barrier, got ${routeRes.totalLengthM}m`
  );
}

console.log('shapeRouteMatcher.js test passed successfully!');



