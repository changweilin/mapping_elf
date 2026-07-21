import { test, expect } from '@playwright/test';

async function mockElevation(page) {
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, async (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((lat, i) => {
      const lng = lngs[i] ?? 0;
      const h = 850 * Math.exp(-(((lat - 24.2133) ** 2) + ((lng - 121.3472) ** 2)) / 0.00035);
      return Math.round(2450 + h);
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

test('F4: Relive playback pauses at an intermediate waypoint and does not throw', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await mockElevation(page);
  await mockFeatures(page);
  await mockRouting(page);
  const serve = (r) => r.fulfill({ json: weatherPayload(r.request().url()) });
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, serve);
  await page.route(/archive-api\.open-meteo\.com\/v1\/archive/, serve);
  await page.addInitScript(() => localStorage.setItem('mappingElf_mapView', JSON.stringify({ lat: 24.2133, lng: 121.3472, zoom: 14 })));

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  // Three waypoints → a genuine intermediate stop (start/end are excluded).
  const box = await page.locator('#map').boundingBox();
  for (const [x, y, n] of [[0.35, 0.4, 1], [0.5, 0.5, 2], [0.65, 0.6, 3]]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(n);
  }
  await expect(page.locator('#btn-view-3d')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#route-weather-busy-overlay').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  await page.locator('#btn-view-3d').click();
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });

  // The Relive close-up card should be hidden before playback.
  await expect(page.locator('#tv-wp-card')).toHaveClass(/hidden/);

  await page.locator('#tp-play').click();
  // Reaching the middle waypoint triggers the Relive pause → the TCG close-up card.
  await expect(page.locator('#tv-wp-card')).not.toHaveClass(/hidden/, { timeout: 25_000 });
  await expect(page.locator('.tv-wp-card-name')).toHaveText(/.+/);
  // The card surfaces the three info categories (personal / terrain / weather).
  await expect(page.locator('#tv-wp-card .tv-wp-cat')).toHaveCount(3);

  // Playback advanced and nothing threw during the camera/animate rewrite.
  const progress = await page.locator('#tp-slider').evaluate((el) => parseFloat(el.value) || 0);
  expect(progress).toBeGreaterThan(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
