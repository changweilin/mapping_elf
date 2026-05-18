import { expect, test } from '@playwright/test';

const LONG_TRACK_POINTS = 901;
const LONG_IMPORT_LIMIT_MS = 15_000;
const DENSE_TRACK_POINTS = 720;
const DENSE_WAYPOINT_COUNT = 24;
const DENSE_INTERVAL_COUNT = 48;
const DENSE_IMPORT_LIMIT_MS = 15_000;

async function openLongRouteApp(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_importAutoName', '0');
  });

  await page.route('**/v1/forecast**', async (route) => route.fulfill({ json: weatherPayload() }));
  await page.route('**/v1/archive**', async (route) => route.fulfill({ json: weatherPayload() }));

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
}

function weatherPayload() {
  return {
    daily: {
      time: ['2026-05-20'],
      temperature_2m_max: [24],
      temperature_2m_min: [18],
      precipitation_sum: [0],
      weathercode: [1],
      windspeed_10m_max: [12],
      windgusts_10m_max: [18],
      sunrise: ['2026-05-20T05:10'],
      sunset: ['2026-05-20T18:30'],
      sunshine_duration: [18000],
      precipitation_probability_max: [10],
      uv_index_max: [7],
      shortwave_radiation_sum: [19],
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `2026-05-20T${String(h).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, () => 21),
      apparent_temperature: Array.from({ length: 24 }, () => 20),
      relative_humidity_2m: Array.from({ length: 24 }, () => 65),
      dewpoint_2m: Array.from({ length: 24 }, () => 14),
      precipitation: Array.from({ length: 24 }, () => 0),
      precipitation_probability: Array.from({ length: 24 }, () => 10),
      weathercode: Array.from({ length: 24 }, () => 1),
      windspeed_10m: Array.from({ length: 24 }, () => 10),
      windgusts_10m: Array.from({ length: 24 }, () => 16),
      uv_index: Array.from({ length: 24 }, () => 4),
      visibility: Array.from({ length: 24 }, () => 10000),
      cloudcover: Array.from({ length: 24 }, () => 25),
    },
    elevation: 100,
  };
}

function buildTrackPoints(pointCount) {
  return Array.from({ length: pointCount }, (_, i) => ({
    lat: 24.1 + i * 0.00008 + Math.sin(i / 24) * 0.0003,
    lon: 121.1 + i * 0.00007 + Math.cos(i / 31) * 0.0002,
    ele: 900 + Math.sin(i / 18) * 55 + i * 0.12,
  }));
}

function buildTrackPointXml(points) {
  return points
    .map((point) => `      <trkpt lat="${point.lat.toFixed(6)}" lon="${point.lon.toFixed(6)}"><ele>${point.ele.toFixed(1)}</ele></trkpt>`)
    .join('\n');
}

function buildLongGpx(pointCount = LONG_TRACK_POINTS) {
  const trackPoints = buildTrackPointXml(buildTrackPoints(pointCount));

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mapping Elf Performance Test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Long Imported Track</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

function cumulativeDistances(points) {
  const distances = [0];
  const toRad = (value) => value * Math.PI / 180;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    const dLat = toRad(point.lat - prev.lat);
    const dLon = toRad(point.lon - prev.lon);
    const lat1 = toRad(prev.lat);
    const lat2 = toRad(point.lat);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    distances.push(distances[i - 1] + 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
  return distances;
}

function evenlySpacedIndexes(count, pointCount) {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => Math.round(i * (pointCount - 1) / (count - 1)));
}

function intervalIndexes(count, pointCount, reservedIndexes) {
  const candidates = Array.from({ length: Math.max(0, pointCount - 2) }, (_, i) => i + 1)
    .filter((index) => !reservedIndexes.has(index));
  const stride = candidates.length / count;
  return Array.from({ length: count }, (_, i) => candidates[Math.min(candidates.length - 1, Math.floor((i + 0.5) * stride))]);
}

function buildWaypointXml(point, index, cumDistM) {
  const hour = String(6 + (index % 12)).padStart(2, '0');
  return `  <wpt lat="${point.lat.toFixed(6)}" lon="${point.lon.toFixed(6)}">
    <name>Anchor ${String(index + 1).padStart(2, '0')}</name>
    <ele>${point.ele.toFixed(1)}</ele>
    <extensions>
      <date>2026-05-20</date>
      <time>${hour}:00</time>
      <cumDistM>${cumDistM.toFixed(1)}</cumDistM>
    </extensions>
  </wpt>`;
}

function buildIntervalXml(point, index, cumDistM) {
  return `  <wpt lat="${point.lat.toFixed(6)}" lon="${point.lon.toFixed(6)}">
    <name>*_Interval ${String(index + 1).padStart(2, '0')}</name>
    <type>mel:interval</type>
    <ele>${point.ele.toFixed(1)}</ele>
    <extensions>
      <cumDistM>${cumDistM.toFixed(1)}</cumDistM>
      <weatherCode>1</weatherCode>
    </extensions>
  </wpt>`;
}

function buildDenseWaypointIntervalGpx({
  pointCount = DENSE_TRACK_POINTS,
  waypointCount = DENSE_WAYPOINT_COUNT,
  intervalCount = DENSE_INTERVAL_COUNT,
} = {}) {
  const points = buildTrackPoints(pointCount);
  const distances = cumulativeDistances(points);
  const waypointIndexes = evenlySpacedIndexes(waypointCount, pointCount);
  const intervalMarkerIndexes = intervalIndexes(intervalCount, pointCount, new Set(waypointIndexes));
  const waypointXml = waypointIndexes
    .map((pointIndex, index) => buildWaypointXml(points[pointIndex], index, distances[pointIndex]))
    .join('\n');
  const intervalXml = intervalMarkerIndexes
    .map((pointIndex, index) => buildIntervalXml(points[pointIndex], index, distances[pointIndex]))
    .join('\n');
  const trackPoints = buildTrackPointXml(points);

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mapping Elf Dense Performance Test" xmlns="http://www.topografix.com/GPX/1/1">
${waypointXml}
${intervalXml}
  <trk>
    <name>Dense Imported Track</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

test('imports a long recorded track within the app baseline budget', async ({ page }) => {
  await openLongRouteApp(page);

  const startedAt = Date.now();
  await page.locator('#gpx-file-input').setInputFiles({
    name: 'long-recorded-track.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(buildLongGpx(), 'utf8'),
  });

  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('mappingElf_importedTrack') || 'null');
    return session?.coords?.length || 0;
  }), { timeout: LONG_IMPORT_LIMIT_MS }).toBe(LONG_TRACK_POINTS);

  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(LONG_IMPORT_LIMIT_MS);
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  await expect(page.locator('#stat-distance')).not.toHaveText(/^[-\s]*$/);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(11);
});

test('imports a dense waypoint and interval-heavy track within the app baseline budget', async ({ page }) => {
  await openLongRouteApp(page);

  const startedAt = Date.now();
  await page.locator('#gpx-file-input').setInputFiles({
    name: 'dense-waypoints-intervals.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(buildDenseWaypointIntervalGpx(), 'utf8'),
  });

  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('mappingElf_importedTrack') || 'null');
    return {
      coords: session?.coords?.length || 0,
      waypoints: session?.waypoints?.length || 0,
      intermediates: session?.intermediates?.length || 0,
    };
  }), { timeout: DENSE_IMPORT_LIMIT_MS }).toEqual({
    coords: DENSE_TRACK_POINTS,
    waypoints: DENSE_WAYPOINT_COUNT,
    intermediates: DENSE_INTERVAL_COUNT,
  });

  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(DENSE_IMPORT_LIMIT_MS);
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  await expect(page.locator('#stat-distance')).not.toHaveText(/^[-\s]*$/);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(DENSE_WAYPOINT_COUNT);
  await expect(page.locator('#weather-table-container .wt-header-row-label .wt-col-head'))
    .toHaveCount(DENSE_WAYPOINT_COUNT + DENSE_INTERVAL_COUNT);

  const tableStats = await page.locator('#weather-table-container').evaluate((container) => {
    const labelHeads = Array.from(container.querySelectorAll('.wt-header-row-label .wt-col-head'));
    return {
      columns: labelHeads.length,
      waypointColumns: labelHeads.filter((head) => !head.classList.contains('wt-interval-col')).length,
      intervalColumns: labelHeads.filter((head) => head.classList.contains('wt-interval-col')).length,
      disabledDateInputs: container.querySelectorAll('.wt-th-date .wt-date-input:disabled').length,
      disabledTimeSelects: container.querySelectorAll('.wt-th-time .wt-time-select:disabled').length,
    };
  });

  expect(tableStats).toEqual({
    columns: DENSE_WAYPOINT_COUNT + DENSE_INTERVAL_COUNT,
    waypointColumns: DENSE_WAYPOINT_COUNT,
    intervalColumns: DENSE_INTERVAL_COUNT,
    disabledDateInputs: DENSE_INTERVAL_COUNT,
    disabledTimeSelects: DENSE_INTERVAL_COUNT,
  });
});
