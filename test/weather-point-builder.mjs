import assert from 'node:assert/strict';
import {
  buildWeatherPointsFromState,
  computeWeatherRouteMetrics,
} from '../src/modules/weatherPointBuilder.js';

function key(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function waypointLabel(index, _lat, _lng, isReturn, total) {
  if (isReturn) return '回程';
  if (index === 0) return '起點';
  if (index === total - 1 && total > 1) return '終點';
  return `航點 ${index + 1}`;
}

function buildScenario({
  coords,
  waypoints,
  routeMetrics = computeWeatherRouteMetrics(coords, waypoints),
  metadata = [],
  customNames = {},
  placeNames = {},
  paceParams = { flatPaceKmH: 1, restEveryH: 0, restMinutes: 0 },
  ...overrides
}) {
  const distances = routeMetrics.routeDists.length ? routeMetrics.routeDists : [0];
  const elevations = distances.map((_, i) => 100 + i);

  return buildWeatherPointsFromState({
    waypoints,
    coords,
    routeMetrics,
    elevationPoints: coords,
    elevationElevations: elevations,
    elevationDistances: distances,
    speedActivity: 'hiking',
    paceParams,
    getPaceComputation: (_elevs, dists) => ({
      times: dists.map(d => d / 1000),
    }),
    getWaypointMetadata: (index) => ({
      waypointId: `wp-${index}`,
      ...(metadata[index] || {}),
    }),
    getWaypointLabel: (index, lat, lng, isReturn) => waypointLabel(index, lat, lng, isReturn, waypoints.length),
    getCustomName: (lat, lng) => customNames[key(lat, lng)] ?? null,
    getPlaceName: (lat, lng) => placeNames[key(lat, lng)] ?? null,
    getGeocodeKey: key,
    interpolateElevAtCumM: (cumM) => 100 + (cumM / 1000),
    ...overrides,
  });
}

function assertIncreasing(points) {
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i]._cum >= points[i - 1]._cum, `point ${i} should not move backwards`);
  }
}

{
  const coords = [[25, 121], [25, 121.01], [25, 121.02]];
  const waypoints = [coords[0], coords[2]];
  const { points, waypointCumDistM } = buildScenario({ coords, waypoints });

  assert.equal(points.length, 3);
  assert.deepEqual(points.map(p => p.isWaypoint), [true, false, true]);
  assert.equal(points[1].label, '1-0');
  assert.equal(Object.hasOwn(points[1], 'isReturn'), false);
  assert.ok(points[0]._cum < points[1]._cum);
  assert.ok(points[1]._cum < points[2]._cum);
  assert.deepEqual(waypointCumDistM, [points[0]._cum, points[2]._cum]);
  assertIncreasing(points);
}

{
  const start = [25, 121];
  const end = [25, 121.01];
  const coords = [start, end, start];
  const waypoints = [start, end];
  const { points } = buildScenario({
    coords,
    waypoints,
    roundTripMode: true,
    segmentIntervalKm: 0.5,
  });

  const outboundEnd = points.find(p => p.isWaypoint && !p.isReturn && p.wpIndex === 1);
  const returnStart = points.find(p => p.isWaypoint && p.isReturn && p.wpIndex === 0);
  const returnIntervals = points.filter(p => !p.isWaypoint && p.isReturn);

  assert.ok(outboundEnd);
  assert.ok(returnStart);
  assert.ok(returnStart._cum > outboundEnd._cum);
  assert.ok(returnStart._elapsedH > outboundEnd._elapsedH);
  assert.ok(returnIntervals.length > 0);
  assert.ok(returnIntervals.every(p => p.weather === undefined && p.windyUrl === undefined));
  assertIncreasing(points);
}

{
  const start = [25, 121];
  const mid = [25, 121.01];
  const end = [25.005, 121.006];
  const coords = [start, mid, end, start];
  const waypoints = [start, mid, end];
  const { points } = buildScenario({
    coords,
    waypoints,
    oLoopMode: true,
  });

  const returnStart = points.at(-1);
  assert.equal(returnStart.isWaypoint, true);
  assert.equal(returnStart.isReturn, true);
  assert.equal(returnStart.wpIndex, 0);
  assert.equal(returnStart.lat, start[0]);
  assert.equal(returnStart.lng, start[1]);
  assertIncreasing(points);
}

{
  const start = [25, 121];
  const end = [25, 121.03];
  const coords = [start, end];
  const waypoints = [start, end];
  const { points } = buildScenario({
    coords,
    waypoints,
    speedIntervalMode: true,
    paceParams: { flatPaceKmH: 1, restEveryH: 0, restMinutes: 0 },
  });

  const generated = points.filter(p => !p.isWaypoint);
  assert.ok(generated.length >= 2);
  assert.ok(generated.some(p => p.label === '1-1'));
  assert.ok(generated.every(p => p.weather === undefined && p.windyUrl === undefined));
  assert.ok(generated.every(p => p._preserveLabel === undefined));
  assertIncreasing(points);
}

{
  const coords = [[25, 121], [25, 121.01], [25, 121.02]];
  const waypoints = [coords[0], coords[2]];
  const routeMetrics = computeWeatherRouteMetrics(coords, waypoints);
  const midCum = (routeMetrics.wpCumDist[0] + routeMetrics.wpCumDist[1]) / 2;
  const customNames = { [key(coords[0][0], coords[0][1])]: 'Custom Start' };
  const { points, waypointCumDistM } = buildScenario({
    coords,
    waypoints,
    routeMetrics,
    metadata: [
      { cumDistM: routeMetrics.wpCumDist[0], label: 'File Start', ele: 101, fileOrder: 100 },
      { cumDistM: routeMetrics.wpCumDist[1], label: 'File Finish', ele: 201, fileOrder: 300 },
    ],
    customNames,
    importedTrackMode: true,
    roundTripMode: true,
    oLoopMode: true,
    importedIntermediatePoints: [{
      lat: coords[1][0],
      lng: coords[1][1],
      cumDistM: midCum,
      fileOrder: -10,
      label: 'File Rest',
      weather: 'sunny',
      windyUrl: 'https://example.test/windy',
      ele: 150,
    }],
  });

  assert.deepEqual(points.map(p => p.label), ['Custom Start', 'File Rest', 'File Finish']);
  assert.ok(points.every(p => p.isReturn === false));
  assert.deepEqual(waypointCumDistM, routeMetrics.wpCumDist);

  const importedIntermediate = points[1];
  assert.equal(importedIntermediate.isWaypoint, false);
  assert.equal(importedIntermediate._preserveLabel, true);
  assert.equal(importedIntermediate.weather, 'sunny');
  assert.equal(importedIntermediate.windyUrl, 'https://example.test/windy');
  assertIncreasing(points);
}

console.log('weather point builder regression checks passed');
