import { expect, test } from '@playwright/test';

const LONG_TRACK_POINTS = 901;
const LONG_IMPORT_LIMIT_MS = 15_000;

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

function buildLongGpx(pointCount = LONG_TRACK_POINTS) {
  const trackPoints = Array.from({ length: pointCount }, (_, i) => {
    const lat = 24.1 + i * 0.00008 + Math.sin(i / 24) * 0.0003;
    const lon = 121.1 + i * 0.00007 + Math.cos(i / 31) * 0.0002;
    const ele = 900 + Math.sin(i / 18) * 55 + i * 0.12;
    return `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
  }).join('\n');

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
