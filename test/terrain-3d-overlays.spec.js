// Overlays draped on the 3D terrain, and what playback does with them:
// satellite imagery (was terrain-satellite.spec.js "F3"), the Relive close-up
// card (terrain-relive-camera.spec.js "F4") and the volumetric weather rigs
// (weather-3d-fx.spec.js). All three booted the viewer through the same
// copy-pasted stubs, so they now share one set.
//
// The core viewer suite lives in terrain-3d.spec.js — put model/build/cache
// behaviour there, and overlay-on-top-of-a-built-model behaviour here.
import { expect, test } from '@playwright/test';
import { osrm } from './helpers/apiMocks.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');

// Deterministic hilly surface around the sample route (mirrors terrain-3d.spec.js).
async function mockElevation(page) {
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, async (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((lat, i) => {
      const lng = lngs[i] ?? 0;
      const h1 = 850 * Math.exp(-(((lat - 24.2133) ** 2) + ((lng - 121.3472) ** 2)) / 0.00035);
      const h2 = 500 * Math.exp(-(((lat - 24.205) ** 2) + ((lng - 121.355) ** 2)) / 0.0006);
      return Math.round(2450 + h1 + h2);
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}

// Empty 圖資 so the background download resolves fast — the loading indicator
// runs through that phase, so leaving Overpass live makes #tv-loading waits flaky.
async function mockFeatures(page) {
  await page.route(/\/interpreter\?/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] }) }));
}

// `codes` cycles the hourly weather codes; the weather-rig test needs a mix
// (including thunder) so every rig type gets built.
function weatherPayload(url, codes = [1]) {
  const date = new URL(url).searchParams.get('start_date') || '2026-04-20';
  const hourlyCodes = Array.from({ length: 24 }, (_, h) => codes[h % codes.length]);
  const hours = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
  const flat = (v) => Array.from({ length: 24 }, () => v);
  return {
    daily: {
      time: [date],
      temperature_2m_max: [22], temperature_2m_min: [12], precipitation_sum: [0],
      weathercode: [codes[codes.length - 1]], windspeed_10m_max: [12], windgusts_10m_max: [18],
      sunrise: [`${date}T05:10`], sunset: [`${date}T18:30`], sunshine_duration: [18000],
      precipitation_probability_max: [10], uv_index_max: [7], shortwave_radiation_sum: [19],
    },
    hourly: {
      time: hours,
      temperature_2m: flat(18), apparent_temperature: flat(17), relative_humidity_2m: flat(65),
      dewpoint_2m: flat(11), precipitation: flat(0), precipitation_probability: flat(10),
      weathercode: hourlyCodes, windspeed_10m: flat(10), windgusts_10m: flat(16),
      winddirection_10m: flat(180), uv_index: flat(4), visibility: flat(10000), cloudcover: flat(25),
    },
    elevation: 100,
  };
}

async function mockWeather(page, codes) {
  const serve = (r) => r.fulfill({ json: weatherPayload(r.request().url(), codes) });
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, serve);
  await page.route(/archive-api\.open-meteo\.com\/v1\/archive/, serve);
}

// The weather rigs are built from saved weather cells, which only exist once the
// per-point load has run to completion — wait for the overlay to appear AND clear.
async function waitForWeatherLoad(page) {
  const busy = page.locator('#route-weather-busy-overlay');
  await busy.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await busy.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await busy.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
}

async function open3d(page) {
  await expect(page.locator('#btn-view-3d')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#btn-view-3d').click();
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
}

// Clicked-route flavour: `fractions` waypoints on the map, then the 3D viewer.
async function buildClickedRoute3d(page, fractions) {
  await page.addInitScript(() => localStorage.setItem('mappingElf_mapView', JSON.stringify({ lat: 24.2133, lng: 121.3472, zoom: 14 })));
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  const box = await page.locator('#map').boundingBox();
  for (const [i, [x, y]] of fractions.entries()) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(i + 1);
  }
  await page.locator('#route-weather-busy-overlay').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await open3d(page);
}

// A 1x1 green PNG stands in for Esri World Imagery so the drape is deterministic
// and offline (the real CORS/texture path is proven separately).
const GREEN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYPgPAAEEAQB9ssjfAAAAAElFTkSuQmCC',
  'base64');

test('satellite toggle drapes imagery (stays on) and persists', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockElevation(page);
  await mockFeatures(page);
  await osrm(page);
  await mockWeather(page);
  await page.route(/server\.arcgisonline\.com\/.*World_Imagery/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: GREEN_PNG }));

  await buildClickedRoute3d(page, [[0.4, 0.42], [0.6, 0.58]]);

  const sat = page.locator('#tv-toggle-satellite');
  await expect(sat).toBeVisible();
  await expect(sat).not.toHaveClass(/active/);

  await sat.click();
  await expect(sat).toHaveClass(/active/);

  // Let the (mocked) tile mosaic load. A failed drape fires onSatelliteError and
  // clears the toggle; a successful one keeps it active.
  await page.waitForTimeout(2_000);
  await expect(sat).toHaveClass(/active/);
  expect(errors, errors.join('\n')).toEqual([]);

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_terrain3dDisplay') || '{}').satellite);
  expect(persisted).toBe(true);

  await sat.click();
  await expect(sat).not.toHaveClass(/active/);
});

test('Relive playback pauses at an intermediate waypoint and does not throw', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockElevation(page);
  await mockFeatures(page);
  await osrm(page);
  await mockWeather(page);

  // Three waypoints → a genuine intermediate stop (start/end are excluded).
  await buildClickedRoute3d(page, [[0.35, 0.4], [0.5, 0.5], [0.65, 0.6]]);

  await expect(page.locator('#tv-wp-card')).toHaveClass(/hidden/);
  await page.locator('#tp-play').click();
  // Reaching the middle waypoint triggers the Relive pause → the close-up card.
  await expect(page.locator('#tv-wp-card')).not.toHaveClass(/hidden/, { timeout: 25_000 });
  await expect(page.locator('.tv-wp-card-name')).toHaveText(/.+/);
  // The card surfaces the three info categories (personal / terrain / weather).
  await expect(page.locator('#tv-wp-card .tv-wp-cat')).toHaveCount(3);

  const progress = await page.locator('#tp-slider').evaluate((el) => parseFloat(el.value) || 0);
  expect(progress).toBeGreaterThan(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('3D weather: volumetric rigs build, animate and rebuild without errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await mockElevation(page);
  await mockFeatures(page);
  // clear, cloudy, fog, drizzle, rain, snow, thunder — one of every rig type,
  // the last exercising the lightning/flash path.
  await mockWeather(page, process.env.WX_ALL ? [Number(process.env.WX_ALL)] : [0, 3, 45, 55, 65, 75, 95]);

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('#gpx-file-input').setInputFiles(sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#btn-view-3d')).toBeEnabled();
  await waitForWeatherLoad(page);

  const open = await page.locator('#side-panel').evaluate((el) => el.classList.contains('open'));
  if (!open) await page.locator('#btn-toggle-panel').click();
  await open3d(page);
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // Let the render loop drive the rigs (rain falling, clouds drifting, lightning).
  await page.waitForTimeout(2200);

  if (process.env.WX_SHOT) {
    await page.screenshot({ path: process.env.WX_SHOT });
    await page.locator('#tv-toggle-view').click();
    await page.waitForTimeout(700);
    if (process.env.WX_SHOT_TOP) await page.screenshot({ path: process.env.WX_SHOT_TOP });
  }

  // The scene renders content, not just the flat background.
  const nonBg = await page.evaluate(() => {
    const cv = document.querySelector('#terrain-canvas-wrap canvas');
    const c2 = document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height;
    const ctx = c2.getContext('2d');
    ctx.drawImage(cv, 0, 0);
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (Math.abs(data[i] - 26) > 14 || Math.abs(data[i + 1] - 26) > 14 || Math.abs(data[i + 2] - 46) > 14) count++;
    }
    return count;
  });
  expect(nonBg).toBeGreaterThan(0);

  // 天氣 cycles on → static → off → on, flipping the rigs' visibility.
  const weatherBtn = page.locator('#tv-toggle-weather');
  const weatherLabel = page.locator('#tv-weather-label');
  await expect(weatherBtn).toBeEnabled();
  await expect(weatherLabel).toHaveText('天氣·開');
  await weatherBtn.click();
  await expect(weatherLabel).toHaveText('天氣·靜態');
  await page.waitForTimeout(300);
  await weatherBtn.click();
  await weatherBtn.click();
  await expect(weatherLabel).toHaveText('天氣·開');
  await page.waitForTimeout(300);

  // 海拔歸一化 forces an in-place rebuild → disposes the old rigs and grows fresh
  // ones. Any leak/double-free/throw in dispose or rebuild surfaces here.
  await page.locator('#tv-toggle-normalize').click();
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  expect(pageErrors, `unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
