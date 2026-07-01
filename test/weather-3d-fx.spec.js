import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');

// Deterministic hilly elevation (mirrors terrain-3d.spec.js).
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

// Empty 圖資 (map features) so the background download resolves fast — the
// loading indicator now continues through this phase (see terrain-3d.spec.js),
// so leaving Overpass unmocked would make #tv-loading-hidden waits slow/flaky.
async function mockFeatures(page) {
  await page.route(/\/interpreter\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] }) });
  });
}

// Forecast whose hourly weather codes cycle through every visual category, so the
// route's weather points build a mix of 3D rigs — sun, cloud, fog, drizzle, rain,
// snow and (crucially) thunder, exercising the lightning/flash path.
function variedWeatherPayload(url) {
  const date = new URL(url).searchParams.get('start_date') || '2026-04-20';
  const cycle = process.env.WX_ALL
    ? [Number(process.env.WX_ALL)]
    : [0, 3, 45, 55, 65, 75, 95]; // clear, cloudy, fog, drizzle, rain, snow, thunder
  const hourlyCodes = Array.from({ length: 24 }, (_, h) => cycle[h % cycle.length]);
  // Identical to terrain-3d.spec.js's proven payload except the weather codes,
  // which cycle through every category so each 3D rig type gets built.
  return {
    daily: {
      time: [date],
      temperature_2m_max: [22], temperature_2m_min: [12], precipitation_sum: [0],
      weathercode: [95], windspeed_10m_max: [12], windgusts_10m_max: [18],
      sunrise: [`${date}T05:10`], sunset: [`${date}T18:30`], sunshine_duration: [18000],
      precipitation_probability_max: [10], uv_index_max: [7], shortwave_radiation_sum: [19],
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, () => 18),
      apparent_temperature: Array.from({ length: 24 }, () => 17),
      relative_humidity_2m: Array.from({ length: 24 }, () => 65),
      dewpoint_2m: Array.from({ length: 24 }, () => 11),
      precipitation: Array.from({ length: 24 }, () => 0),
      precipitation_probability: Array.from({ length: 24 }, () => 10),
      weathercode: hourlyCodes,
      windspeed_10m: Array.from({ length: 24 }, () => 9),
      windgusts_10m: Array.from({ length: 24 }, () => 15),
      uv_index: Array.from({ length: 24 }, () => 4),
      visibility: Array.from({ length: 24 }, () => 10000),
      cloudcover: Array.from({ length: 24 }, () => 25),
    },
    elevation: 100,
  };
}

test('3D weather: volumetric rigs build, animate and rebuild without errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await mockElevation(page);
  await mockFeatures(page);
  const serve = (r) => r.fulfill({ json: variedWeatherPayload(r.request().url()) });
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, serve);
  await page.route(/archive-api\.open-meteo\.com\/v1\/archive/, serve);

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('#gpx-file-input').setInputFiles(sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#btn-open-3d-viewer')).toBeEnabled();
  // Wait for the per-point weather load to actually START then FINISH, so the
  // saved weather cells (which feed the 3D rigs) are fully populated before the
  // model is built — otherwise weatherPointsData is empty and no rigs are grown.
  const wxBusy = page.locator('#route-weather-busy-overlay');
  await wxBusy.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await wxBusy.waitFor({ state: 'hidden', timeout: 60_000 });
  await page.waitForTimeout(1200);
  await wxBusy.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  // Build the 3D terrain (+ weather rigs).
  const open = await page.locator('#side-panel').evaluate((el) => el.classList.contains('open'));
  if (!open) await page.locator('#btn-toggle-panel').click();
  await page.locator('#btn-open-3d-viewer').click();
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // Let the render loop drive the rigs for a couple of seconds (rain falling,
  // clouds drifting, lightning strikes + flash light — the heaviest paths).
  await page.waitForTimeout(2200);

  if (process.env.WX_SHOT) {
    await page.screenshot({ path: process.env.WX_SHOT });
    // A top-down pass shows every rig's cloud/precip footprint over the terrain.
    await page.locator('#tv-toggle-view').click();
    await page.waitForTimeout(700);
    if (process.env.WX_SHOT_TOP) await page.screenshot({ path: process.env.WX_SHOT_TOP });
  }

  // The scene renders content (not just the flat background).
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

  // Cycling 天氣 through its animation states (on → noAnim → off → on) flips the
  // volumetric rigs' visibility (exercises the same path the old 天氣特效 toggle
  // used to, now decoupled from the 地標裝飾/效果 button).
  const weatherBtn = page.locator('#tv-toggle-weather');
  const weatherLabel = page.locator('#tv-weather-label');
  await expect(weatherBtn).toBeEnabled();
  await expect(weatherLabel).toHaveText('天氣·開');
  await weatherBtn.click(); // on -> noAnim: rigs stop animating
  await expect(weatherLabel).toHaveText('天氣·靜態');
  await page.waitForTimeout(300);
  await weatherBtn.click(); // noAnim -> off
  await weatherBtn.click(); // off -> on: rigs reappear
  await expect(weatherLabel).toHaveText('天氣·開');
  await page.waitForTimeout(300);

  // 海拔歸一化 forces an in-place rebuild → disposes the old rigs and grows fresh
  // ones. Any leak/double-free/throw in dispose or rebuild would surface here.
  await page.locator('#tv-toggle-normalize').click();
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  expect(pageErrors, `unexpected runtime errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
