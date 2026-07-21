import { expect, test } from '@playwright/test';

// Issue 1: planning a new route must backfill the new waypoint's 集水區 info the
// same way weather auto-loads — no manual 取得集水區. A cone DEM (drains to map
// centre) lets every point delineate a basin; forecast/flood stubs feed hydrology.
const ANCHOR = [23.5, 121.0];

function coneElevation(page) {
  return page.route(/v1\/elevation/, (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((la, i) => {
      const dy = (la - ANCHOR[0]) * 111320;
      const dx = (lngs[i] - ANCHOR[1]) * 111320 * Math.cos(ANCHOR[0] * Math.PI / 180);
      return 100 + 0.1 * Math.hypot(dx, dy);
    });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}

function forecast(page) {
  return page.route(/v1\/forecast/, (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start_date') || '2026-07-18';
    const end = url.searchParams.get('end_date') || start;
    const hourlyVars = (url.searchParams.get('hourly') || '').split(',').filter(Boolean);
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const times = [];
    for (const day of days) for (let h = 0; h < 24; h++) times.push(`${day}T${String(h).padStart(2, '0')}:00`);
    const val = (n) => {
      if (n === 'precipitation') return 8;
      if (n.startsWith('soil_moisture')) return 0.35;
      if (n === 'et0_fao_evapotranspiration') return 0.2;
      if (n === 'temperature_2m') return 21;
      if (n === 'apparent_temperature') return 20;
      if (n === 'relative_humidity_2m') return 88;
      if (n === 'precipitation_probability') return 90;
      if (n === 'weathercode') return 61;
      if (n === 'windspeed_10m') return 15;
      if (n === 'windgusts_10m') return 30;
      if (n === 'cloudcover') return 95;
      return 1;
    };
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    const daily = { time: days };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily }) });
  });
}

function flood(page) {
  return page.route(/flood-api\.open-meteo\.com\/v1\/flood/, (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start_date');
    const end = url.searchParams.get('end_date') || start;
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: days, river_discharge: days.map((_, i) => 5 + i * 4), river_discharge_mean: days.map(() => 4) } }) });
  });
}

test('catchment panel auto-backfills a newly-added waypoint (issue 1)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_bpView', 'catchment');
    // Collapse the table so columns are the main waypoints only (no 副航點),
    // keeping the per-column DEM loads few and the assertion deterministic.
    localStorage.setItem('mappingElf_weatherTableCollapsed', '1');
  });
  await page.route('**/route/v1/**', (route) => {
    const coordPart = new URL(route.request().url()).pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 1000, duration: 1000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
  await forecast(page);
  await flood(page);
  await coneElevation(page);

  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  const box = await page.locator('#map').boundingBox();

  // Two waypoints → a route.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);

  // Catchment view is the active bottom-panel view; its table should auto-fill
  // both columns without a manual 取得集水區.
  const areaCells = () => page.locator('[data-cat-section="terrain"][data-cat-i="0"] .wt-cell-value');
  const noDots = () => areaCells().filter({ hasText: '…' });
  await expect(noDots()).toHaveCount(0, { timeout: 30000 });
  const colCount = await areaCells().count();

  // The load holds the edit-lock; wait for it to clear before editing the route.
  await page.waitForFunction(() => !document.body.classList.contains('route-weather-busy'));

  // Add a THIRD waypoint — a fresh route plan. Its new column must auto-backfill
  // (this is the fix: previously it stayed '…' until a manual 取得集水區).
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(3);
  await expect(areaCells()).toHaveCount(colCount + 1);

  await expect(noDots()).toHaveCount(0, { timeout: 30000 });
  const lastCol = areaCells().last();
  await expect(lastCol).not.toHaveText('—');
});
