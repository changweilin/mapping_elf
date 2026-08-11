import { expect, test } from '@playwright/test';
import { flatElevation, flood, osrm } from './helpers/apiMocks.mjs';

// 平地 is an ANSWER, not a failed read. On a dead-flat DEM the panel must mark
// every column 平地, treat the load as successful (no "—", no retry sweep), and
// get there on the cheap probe alone — one small elevation request per waypoint
// instead of the six-chunk, 529-point DEM grid a delineation costs.
//
// The route's own elevation profile shares this endpoint, so DEM reads are
// counted by request size (a catchment read is ≥50 points; the profile for a
// 2-waypoint route is 2) rather than by raw call count.
const DEM_MIN_POINTS = 50;
const FULL_GRID_POINTS = 529;

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
    const val = (n) => (n === 'weathercode' ? 1 : n.startsWith('soil_moisture') ? 0.35 : n === 'precipitation' ? 3 : 1);
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 100, hourly, daily: { time: days } }) });
  });
}

// Seeds defaults ONCE per tab: the reload test needs the localStorage caches it
// just filled to survive, so the wipe is guarded by a sessionStorage flag rather
// than re-running on every navigation.
function catchmentInit(page) {
  return page.addInitScript(() => {
    if (sessionStorage.getItem('me_test_seeded')) return;
    sessionStorage.setItem('me_test_seeded', '1');
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_bpView', 'catchment');
    localStorage.setItem('mappingElf_weatherTableCollapsed', '1');
  });
}

const areaCells = (page) => page.locator('[data-cat-section="terrain"][data-cat-i="0"] .wt-cell-value');
const overlayHidden = (page) => page.waitForFunction(
  () => document.getElementById('route-weather-busy-overlay')?.classList.contains('hidden'), null, { timeout: 60000 });

async function twoWaypoints(page) {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
}

async function openFlatRoute(page, stats) {
  await catchmentInit(page);
  await osrm(page); await forecast(page); await flood(page); await flatElevation(page, { stats });
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await twoWaypoints(page);
}

// Both tests boot the app, route it and probe the DEM (the second also reloads),
// and their inner waits already ask for 60 s — more than the default 45 s test
// budget can grant. Budget them explicitly instead of running at 96% of the cap.
test('flat terrain: every column is marked 平地, on the probe alone', async ({ page }) => {
  test.setTimeout(120_000);
  const stats = { demCalls: 0, demPoints: 0 };
  await openFlatRoute(page, stats);

  await expect(areaCells(page)).toHaveCount(2);
  await expect(areaCells(page).filter({ hasText: '…' })).toHaveCount(0, { timeout: 60000 });
  await overlayHidden(page);

  // Marked 平地 — not left as the "—" of a failed read.
  await expect(areaCells(page).filter({ hasText: '平地' })).toHaveCount(2);
  await expect(areaCells(page).filter({ hasText: '—' })).toHaveCount(0);
  // No basin can be drawn for a plain, and none is.
  await expect(page.locator('#map .wc-catchment-poly')).toHaveCount(0);

  // One probe per waypoint, and both together cost less than a SINGLE full grid.
  expect(stats.demCalls).toBe(2);
  expect(stats.demPoints).toBeLessThan(FULL_GRID_POINTS);
});

test('flat terrain: the 平地 verdict survives a reload without re-probing', async ({ page }) => {
  test.setTimeout(120_000);
  const stats = { demCalls: 0, demPoints: 0 };
  await openFlatRoute(page, stats);

  await expect(areaCells(page).filter({ hasText: '平地' })).toHaveCount(2, { timeout: 60000 });
  await overlayHidden(page);
  const afterFirst = stats.demCalls;
  expect(afterFirst).toBeGreaterThan(0);

  await page.reload();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await expect(areaCells(page).filter({ hasText: '平地' })).toHaveCount(2, { timeout: 60000 });
  await page.waitForTimeout(1500);
  expect(stats.demCalls).toBe(afterFirst);   // remembered, not re-probed
});
