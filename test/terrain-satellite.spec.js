import { test, expect } from '@playwright/test';

async function mockElevation(page) {
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, async (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((lat, i) => {
      const lng = lngs[i] ?? 0;
      return Math.round(2450 + 850 * Math.exp(-(((lat - 24.2133) ** 2) + ((lng - 121.3472) ** 2)) / 0.00035));
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}
async function mockFeatures(page) {
  await page.route(/\/interpreter\?/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] }) }));
}
async function mockRouting(page) {
  await page.route('**/route/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const coords = url.pathname.split('/').pop().split(';').map((c) => c.split(',').map(Number));
    await route.fulfill({ json: { code: 'Ok', routes: [{ distance: 1000, duration: 1000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
}
function weatherPayload(url) {
  const date = new URL(url).searchParams.get('start_date') || '2026-04-20';
  return {
    daily: { time: [date], temperature_2m_max: [22], temperature_2m_min: [12], precipitation_sum: [0], weathercode: [1], windspeed_10m_max: [12], windgusts_10m_max: [18], sunrise: [`${date}T05:10`], sunset: [`${date}T18:30`], sunshine_duration: [18000], precipitation_probability_max: [10], uv_index_max: [7], shortwave_radiation_sum: [19] },
    hourly: { time: Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 24 }, () => 18), apparent_temperature: Array.from({ length: 24 }, () => 17), relative_humidity_2m: Array.from({ length: 24 }, () => 65), precipitation: Array.from({ length: 24 }, () => 0), weathercode: Array.from({ length: 24 }, () => 1), windspeed_10m: Array.from({ length: 24 }, () => 10), winddirection_10m: Array.from({ length: 24 }, () => 180), cloudcover: Array.from({ length: 24 }, () => 20) },
  };
}

// A 1x1 green PNG stands in for Esri World Imagery so the drape is deterministic
// and offline (the real CORS/texture path is proven by _probe-esri-cors).
const GREEN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYPgPAAEEAQB9ssjfAAAAAElFTkSuQmCC',
  'base64');
async function mockSatelliteTiles(page) {
  await page.route(/server\.arcgisonline\.com\/.*World_Imagery/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: GREEN_PNG }));
}

async function buildRouted3d(page) {
  await mockElevation(page);
  await mockFeatures(page);
  await mockRouting(page);
  await mockSatelliteTiles(page);
  const serve = (r) => r.fulfill({ json: weatherPayload(r.request().url()) });
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, serve);
  await page.route(/archive-api\.open-meteo\.com\/v1\/archive/, serve);
  await page.addInitScript(() => localStorage.setItem('mappingElf_mapView', JSON.stringify({ lat: 24.2133, lng: 121.3472, zoom: 14 })));
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  const box = await page.locator('#map').boundingBox();
  for (const [x, y, n] of [[0.4, 0.42, 1], [0.6, 0.58, 2]]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(n);
  }
  await expect(page.locator('#btn-view-3d')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#route-weather-busy-overlay').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await page.locator('#btn-view-3d').click();
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
}

test('F3: satellite toggle drapes imagery (stays on) and persists', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buildRouted3d(page);

  const sat = page.locator('#tv-toggle-satellite');
  await expect(sat).toBeVisible();
  await expect(sat).not.toHaveClass(/active/);

  await sat.click();
  await expect(sat).toHaveClass(/active/);

  // Let the (mocked) tile mosaic load. If the drape failed, onSatelliteError
  // clears the toggle; a successful drape keeps it active.
  await page.waitForTimeout(2_000);
  await expect(sat).toHaveClass(/active/);
  expect(errors, errors.join('\n')).toEqual([]);

  // Persisted across reload of the 3D page.
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_terrain3dDisplay') || '{}').satellite);
  expect(persisted).toBe(true);

  // Toggle back off.
  await sat.click();
  await expect(sat).not.toHaveClass(/active/);
});
