import assert from 'node:assert/strict';
import {
  cumulativeDistances,
  totalDistance,
} from '../src/modules/utils.js';
import {
  DEFAULT_PACE_PARAMS,
  computeCumulativeTimes,
  computeHourlyPoints,
  computeTripStats,
} from '../src/modules/paceEngine.js';

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

console.log('Numeric regression ok');
