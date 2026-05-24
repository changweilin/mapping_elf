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

console.log('Numeric regression ok');
