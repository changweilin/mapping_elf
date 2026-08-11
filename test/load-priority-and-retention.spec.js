import { expect, test } from '@playwright/test';
import { coneElevation, flood, osrm } from './helpers/apiMocks.mjs';

// Two rules for the batch loads:
//   1. Load order = 沒有數據 → 數據不完整 → 已有數據, 主航點 before 副航點 inside each tier.
//      Data need is the PRIMARY key, so an empty 副航點 outranks a complete 主航點.
//   2. The 集水區 terrain result is time-independent: once computed it is kept
//      until explicitly cleared — no age expiry, no re-download, and independent
//      of the weather-cache toggle.

test.describe.configure({ retries: 2 });

const ANCHOR = [23.5, 121.0];

function forecast(page, sink = null) {
  return page.route(/v1\/forecast/, (route) => {
    const url = new URL(route.request().url());
    if (sink) sink.push([Number(url.searchParams.get('latitude')), Number(url.searchParams.get('longitude'))]);
    const start = url.searchParams.get('start_date') || '2026-07-18';
    const end = url.searchParams.get('end_date') || start;
    const hourlyVars = (url.searchParams.get('hourly') || '').split(',').filter(Boolean);
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const times = [];
    for (const day of days) for (let h = 0; h < 24; h++) times.push(`${day}T${String(h).padStart(2, '0')}:00`);
    const val = (n) => (n === 'precipitation' ? 8 : n === 'temperature_2m' ? 21 : n === 'weathercode' ? 61 : 1);
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}

// addInitScript reruns on every navigation (incl. reload), so guard the reset with
// sessionStorage — these tests need the seeded state to survive a reload.
function baseInit(page, extra = {}) {
  return page.addInitScript((extra) => {
    if (sessionStorage.getItem('__load_priority_setup')) return;
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_collectiveMarked', '0');
    localStorage.setItem('mappingElf_collectiveIntermediate', '0');
    localStorage.setItem('mappingElf_collectiveAll', '0');
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    sessionStorage.setItem('__load_priority_setup', '1');
  }, extra);
}

const clickMap = async (page, fx, fy) => {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
};
const overlayHidden = (page) =>
  page.waitForFunction(() => document.getElementById('route-weather-busy-overlay')?.classList.contains('hidden'),
    null, { timeout: 40000 });

// A waypoint click costs TWO busy cycles (route re-plan, then the weather load)
// with a gap between them, so one overlayHidden() can return while the load has
// not started yet. Wait across the gap before treating the app as idle.
async function settleIdle(page) {
  await overlayHidden(page);
  await page.waitForTimeout(1800);
  await overlayHidden(page);
}

const catchmentCacheSize = (page) => page.evaluate(() =>
  Object.keys(JSON.parse(localStorage.getItem('mappingElf_catchmentCache') || '{}')).length);

// Saved weather read-outs live under mappingElf_weather.byKey, keyed by semantic
// key ('wp:<waypointId>' / 'ret:<waypointId>' for 主航點, 'int:<n>' for 副航點).
//
// This pins the PRIMARY sort key — data need beats position. The secondary key
// (主航點 before 副航點 inside a tier) is pinned separately by
// data-load-edit-lock.spec.js:101.
test('a data-less waypoint is loaded before waypoints that already have data', async ({ page }) => {
  test.setTimeout(180_000);
  await baseInit(page);
  await osrm(page);
  const order = [];
  await forecast(page, order);
  await coneElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  for (const [i, fx] of [0.3, 0.5, 0.7].entries()) {
    await clickMap(page, fx, 0.4);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(i + 1);
    await overlayHidden(page);
  }
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();

  // Add a fourth waypoint while the forecast endpoint is down, so it ends up with
  // no data while the three before it stay complete. Position alone would still
  // load it LAST; only the data tier can promote it.
  await page.unroute(/v1\/forecast/);
  await page.route(/v1\/forecast/, (route) => route.abort());
  await clickMap(page, 0.5, 0.62);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(4);
  await settleIdle(page);
  // Precondition: exactly one waypoint ended up with no weather. The "?" badge is
  // the unfetched state, so this proves the endpoint stayed down long enough.
  // Generous timeout: the badge re-renders a few times while the map settles.
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-placeholder'))
    .toHaveCount(1, { timeout: 20000 });

  const waypoints = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_waypoints') || '[]'));
  expect(waypoints.length).toBe(4);
  const near = (a, b) => Math.abs(a[0] - b[0]) < 0.004 && Math.abs(a[1] - b[1]) < 0.004;

  // Endpoint recovers; a forced pass re-fetches every column, so the ORDER is the
  // only thing under test.
  await page.unroute(/v1\/forecast/);
  order.length = 0;
  await forecast(page, order);
  await page.locator('#settings-toggle-header h3').click();
  await page.locator('#btn-weather-quick-fetch').click();
  await overlayHidden(page);

  expect(order.length).toBeGreaterThan(1);
  // The data-less waypoint is last on the route but first in the load.
  expect(near(order[0], waypoints[waypoints.length - 1])).toBe(true);
});

test('catchment terrain data survives a weather-cache age wipe and is not re-downloaded', async ({ page }) => {
  const stats = { calls: 0 };
  await baseInit(page);
  await osrm(page);
  await forecast(page);
  await flood(page);
  await coneElevation(page, { stats });
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await clickMap(page, 0.35, 0.4);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await clickMap(page, 0.6, 0.4);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await overlayHidden(page);
  await page.locator('#bp-view-toggle [data-bp-view="catchment"]').click();
  await overlayHidden(page);
  await expect.poll(() => catchmentCacheSize(page), { timeout: 40000 }).toBeGreaterThan(0);
  const cachedBefore = await catchmentCacheSize(page);

  // Backdate every entry far past the weather cache's max age and shorten that age.
  // Weather-style expiry must NOT reach catchment geometry.
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('mappingElf_catchmentCache') || '{}');
    Object.values(store).forEach((e) => { e.updatedAt = 1; });
    localStorage.setItem('mappingElf_catchmentCache', JSON.stringify(store));
    localStorage.setItem('mappingElf_weatherCacheMaxAgeDays', '0.1');
  });
  await page.reload();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  expect(await catchmentCacheSize(page)).toBe(cachedBefore);

  // A forced 取得集水區 reuses the kept geometry: no new elevation request.
  await overlayHidden(page);
  const callsBefore = stats.calls;
  await page.locator('#settings-toggle-header h3').click();
  await page.locator('#btn-catchment-quick-fetch').click();
  await overlayHidden(page);
  expect(stats.calls).toBe(callsBefore);
  expect(await catchmentCacheSize(page)).toBe(cachedBefore);
});

test('catchment data is kept with the weather cache off, and 清除集水區資料 empties it', async ({ page }) => {
  await baseInit(page, { mappingElf_weatherCacheEnabled: '0' });
  await osrm(page);
  await forecast(page);
  await flood(page);
  await coneElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await clickMap(page, 0.35, 0.4);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await clickMap(page, 0.6, 0.4);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await overlayHidden(page);
  await page.locator('#bp-view-toggle [data-bp-view="catchment"]').click();
  await overlayHidden(page);
  // Retention is independent of 啟用天氣快取 — catchment geometry is not weather.
  await expect.poll(() => catchmentCacheSize(page), { timeout: 40000 }).toBeGreaterThan(0);

  await page.locator('#settings-toggle-header h3').click();
  await page.locator('#btn-catchment-clear').click();
  await expect.poll(() => catchmentCacheSize(page)).toBe(0);
  expect(await page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('mappingElf_catchmentCells') || '{}')).length)).toBe(0);
});
