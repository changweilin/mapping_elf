import assert from 'node:assert/strict';
import {
  FlatKDTree2D,
  refineWithUmeyama2D,
  computeEdgeAngleErrorDeg,
  findConstellationOnOSM,
  EARTH_RADIUS_M,
  DEG_TO_RAD,
  RAD_TO_DEG
} from '../src/modules/star/plateSolver.js';

console.log('Testing plateSolver.js...');

// Helper: great-circle destination
function destination([lat, lng], distanceMeters, bearingDeg) {
  const br = (bearingDeg * Math.PI) / 180;
  const ad = distanceMeters / EARTH_RADIUS_M;
  const la1 = (lat * Math.PI) / 180;
  const ln1 = (lng * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(br));
  const ln2 = ln1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));
  return [(la2 * 180) / Math.PI, (((ln2 * 180) / Math.PI + 540) % 360) - 180];
}

// 1. FlatKDTree2D: Point query, annulus search, and usedMask stamp verification
{
  const N = 200;
  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    xs[i] = (i * 13) % 500;
    ys[i] = (i * 17) % 500;
  }
  const tree = new FlatKDTree2D(xs, ys);

  // Exact match
  const nearest = tree.findNearestWithin(xs[42], ys[42], 1.0);
  assert.equal(nearest.index, 42, 'KD-tree must locate exact point');
  assert.ok(nearest.distSq < 1e-9, 'Distance squared must be 0 for exact point');

  // Exclusion using usedMask
  const usedMask = new Uint8Array(N);
  usedMask[42] = 1;
  const nextNearest = tree.findNearestWithin(xs[42], ys[42], 10000, usedMask, 1);
  assert.notEqual(nextNearest.index, 42, 'KD-tree must exclude stamped point');

  // Annulus search
  const annulusIndices = [];
  tree.findInAnnulus(250, 250, 50 * 50, 100 * 100, annulusIndices);
  assert.ok(annulusIndices.length > 0, 'Annulus query should find points in [50, 100]');
  for (const idx of annulusIndices) {
    const dist = Math.hypot(xs[idx] - 250, ys[idx] - 250);
    assert.ok(dist >= 50 && dist <= 100, `Point distance ${dist} must be within annulus`);
  }
}

// 2. 2D Kabsch-Umeyama Similarity Refinement: Exact Closed-Form Transformation
{
  const pattern = [
    { x: 0, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: -100 },
    { x: -100, y: 0 }
  ];

  const groundTruthScale = 2.5;
  const groundTruthAngleDeg = 45;
  const rad = groundTruthAngleDeg * DEG_TO_RAD;
  const tx = 1500;
  const ty = -800;

  const osmX = new Float64Array(4);
  const osmY = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    osmX[i] = groundTruthScale * (Math.cos(rad) * pattern[i].x - Math.sin(rad) * pattern[i].y) + tx;
    osmY[i] = groundTruthScale * (Math.sin(rad) * pattern[i].x + Math.cos(rad) * pattern[i].y) + ty;
  }

  const kdTree = new FlatKDTree2D(osmX, osmY);
  const initialMatch = new Int32Array([0, 1, 2, 3]);
  const outMatched = new Int32Array(4);
  const usedMask = new Uint8Array(4);

  const res = refineWithUmeyama2D(
    pattern,
    osmX,
    osmY,
    initialMatch,
    false,
    kdTree,
    100 * 100,
    usedMask,
    outMatched
  );

  assert.ok(res, 'Umeyama refinement should succeed');
  assert.ok(Math.abs(res.scale - groundTruthScale) < 1e-4, `Scale should be ~${groundTruthScale}`);
  const recoveredAngleDeg = (Math.atan2(res.sinTheta, res.cosTheta) * RAD_TO_DEG + 360) % 360;
  assert.ok(Math.abs(recoveredAngleDeg - groundTruthAngleDeg) < 1e-3, `Angle should be ~${groundTruthAngleDeg}°`);
  assert.ok(Math.abs(res.tx - tx) < 1e-3, `Tx should be ~${tx}`);
  assert.ok(Math.abs(res.ty - ty) < 1e-3, `Ty should be ~${ty}`);
  assert.ok(res.rmse < 1e-4, 'RMSE on clean geometry should be zero');
}

// 3. Topological Edge Angle Error Calculation
{
  const patternNodes = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ];
  const patternEdges = [
    { fromIndex: 0, toIndex: 1 },
    { fromIndex: 1, toIndex: 2 }
  ];

  // Identical edges -> 0° angle error
  const osmX = new Float64Array([0, 100, 100]);
  const osmY = new Float64Array([0, 0, 100]);
  const matched = new Int32Array([0, 1, 2]);

  const error0 = computeEdgeAngleErrorDeg(
    patternNodes,
    patternEdges,
    osmX,
    osmY,
    matched,
    1, // cos(0)
    0, // sin(0)
    false
  );
  assert.ok(error0 < 1e-4, 'Parallel edges should yield 0 angle error');

  // Distorted second edge by 10 degrees
  const rad10 = 10 * DEG_TO_RAD;
  osmX[2] = 100 + 100 * Math.sin(rad10);
  osmY[2] = 100 * Math.cos(rad10);

  const error10 = computeEdgeAngleErrorDeg(
    patternNodes,
    patternEdges,
    osmX,
    osmY,
    matched,
    1,
    0,
    false
  );
  assert.ok(Math.abs(error10 - 5.0) < 0.2, `Mean angle error of 0° and 10° should be ~5°, got ${error10}`);
}

// 4. End-to-End Matching: Pentagram Magic Circle in 1000 Noisy POIs
{
  const ANCHOR = [24.1477, 120.6736];
  const radiusMeters = 4000;
  const numPoints = 5;
  const osmNodes = [];

  // 5 exact star points rotated by 33 degrees
  const rotationDeg = 33;
  for (let i = 0; i < numPoints; i++) {
    const bearing = (360 / numPoints) * i + rotationDeg;
    const [lat, lon] = destination(ANCHOR, radiusMeters, bearing);
    osmNodes.push({ id: 1000 + i, lat, lon, name: `星點 ${i + 1}` });
  }

  // 1000 noise distractor POIs
  for (let i = 0; i < 1000; i++) {
    const dist = 1000 + ((i * 37) % 7000);
    const brg = (i * 73) % 360;
    const [lat, lon] = destination(ANCHOR, dist, brg);
    osmNodes.push({ id: 5000 + i, lat, lon, name: `雜點 ${i + 1}` });
  }

  const patternNodes = [];
  for (let i = 0; i < numPoints; i++) {
    const angle = (2 * Math.PI * i) / numPoints;
    patternNodes.push({ id: `v${i}`, x: Math.sin(angle), y: Math.cos(angle) });
  }
  const patternEdges = [
    { fromIndex: 0, toIndex: 2 },
    { fromIndex: 2, toIndex: 4 },
    { fromIndex: 4, toIndex: 1 },
    { fromIndex: 1, toIndex: 3 },
    { fromIndex: 3, toIndex: 0 }
  ];

  const t0 = performance.now();
  const results = findConstellationOnOSM(patternNodes, patternEdges, osmNodes, {
    minDiameterMeters: 6000,
    maxDiameterMeters: 10000,
    minToleranceMeters: 25,
    relativeTolerance: 0.05,
    center: { lat: ANCHOR[0], lng: ANCHOR[1] },
    isSymmetric: true,
    topK: 5
  });
  const t1 = performance.now();

  assert.ok(results.length > 0, 'Solver must find the seeded star');
  const best = results[0];
  assert.ok(best.rmseMeters < 5.0, `RMSE must be under 5m, got ${best.rmseMeters}`);
  assert.ok(Math.abs(best.scale - radiusMeters) < 20.0, `Fitted radius must be ~4000m, got ${best.scale}`);

  const matchedIds = new Set(best.matchedNodes.filter(Boolean).map(n => n.id));
  for (let i = 0; i < numPoints; i++) {
    assert.ok(matchedIds.has(1000 + i), `Matched nodes must include seeded star point ${1000 + i}`);
  }

  console.log(`Plate-solver matched 5-star in 1000 POIs in ${(t1 - t0).toFixed(2)} ms!`);
}

// 5. Constellation Matching: Leo Constellation (9 stars, irregular shape)
{
  const ANCHOR = [24.1477, 120.6736];
  const leoSkyLines = [
    [[152.093, 11.9672], [151.8331, 16.7627], [154.9931, 19.8415], [168.5271, 20.5237], [177.2649, 14.5721], [168.56, 15.4296], [152.093, 11.9672]],
    [[154.9931, 19.8415], [154.1726, 23.4173], [148.1909, 26.007], [146.4628, 23.7743]]
  ];

  // Extract unique points
  const leoPoints = [];
  const pointIndexMap = new Map();
  leoSkyLines.forEach(line => {
    line.forEach(([ra, dec]) => {
      const key = `${ra.toFixed(4)},${dec.toFixed(4)}`;
      if (!pointIndexMap.has(key)) {
        pointIndexMap.set(key, leoPoints.length);
        leoPoints.push([ra, dec]);
      }
    });
  });

  const meanRa = leoPoints.reduce((acc, p) => acc + p[0], 0) / leoPoints.length;
  const meanDec = leoPoints.reduce((acc, p) => acc + p[1], 0) / leoPoints.length;
  const cosDec = Math.cos(meanDec * DEG_TO_RAD);
  const rawPoints = leoPoints.map(([ra, dec]) => ({
    x: -(ra - meanRa) * cosDec,
    y: dec - meanDec
  }));
  const maxExtent = Math.max(...rawPoints.map(p => Math.hypot(p.x, p.y)));
  const patternNodes = rawPoints.map((p, i) => ({
    id: `leo-${i}`,
    x: p.x / maxExtent,
    y: p.y / maxExtent
  }));

  const patternEdges = [];
  leoSkyLines.forEach(line => {
    for (let i = 0; i < line.length - 1; i++) {
      const from = pointIndexMap.get(`${line[i][0].toFixed(4)},${line[i][1].toFixed(4)}`);
      const to = pointIndexMap.get(`${line[i + 1][0].toFixed(4)},${line[i + 1][1].toFixed(4)}`);
      patternEdges.push({ fromIndex: from, toIndex: to });
    }
  });

  // Seed Leo onto OSM map at 7000m scale, rotated by 58°
  const constellationScale = 7000;
  const constRotationDeg = 58;
  const constRad = constRotationDeg * DEG_TO_RAD;
  const osmNodes = [];

  for (let i = 0; i < patternNodes.length; i++) {
    const rx = constellationScale * (Math.cos(constRad) * patternNodes[i].x - Math.sin(constRad) * patternNodes[i].y);
    const ry = constellationScale * (Math.sin(constRad) * patternNodes[i].x + Math.cos(constRad) * patternNodes[i].y);
    const dist = Math.hypot(rx, ry);
    const brg = (Math.atan2(rx, ry) * RAD_TO_DEG + 360) % 360;
    const [lat, lon] = destination(ANCHOR, dist, brg);
    osmNodes.push({ id: 2000 + i, lat, lon, name: `獅子座星 ${i + 1}` });
  }

  // Add 300 distractor points
  for (let i = 0; i < 300; i++) {
    const dist = 2000 + ((i * 41) % 9000);
    const brg = (i * 61) % 360;
    const [lat, lon] = destination(ANCHOR, dist, brg);
    osmNodes.push({ id: 8000 + i, lat, lon, name: `雜點 ${i + 1}` });
  }

  const t0 = performance.now();
  const results = findConstellationOnOSM(patternNodes, patternEdges, osmNodes, {
    minDiameterMeters: 10000,
    maxDiameterMeters: 18000,
    minToleranceMeters: 30,
    relativeTolerance: 0.05,
    topK: 3
  });
  const t1 = performance.now();

  assert.ok(results.length > 0, 'Solver must find Leo constellation in OSM');
  const best = results[0];
  assert.ok(best.rmseMeters < 3.0, `Constellation RMSE should be <3m, got ${best.rmseMeters}`);
  assert.ok(Math.abs(best.scale - constellationScale) < 20.0, `Fitted scale should be ~7000m, got ${best.scale}`);

  const matchedIds = new Set(best.matchedNodes.filter(Boolean).map(n => n.id));
  assert.equal(matchedIds.size, patternNodes.length, 'All 9 Leo stars must be matched 1-to-1');
  console.log(`Matched 9-star Leo constellation in 309 POIs in ${(t1 - t0).toFixed(2)} ms!`);
}

console.log('All plateSolver.js unit tests passed successfully!');
