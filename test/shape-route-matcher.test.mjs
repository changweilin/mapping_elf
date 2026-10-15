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
} from '../src/modules/shapeRouteMatcher.js';

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

console.log('shapeRouteMatcher.js test passed successfully!');

