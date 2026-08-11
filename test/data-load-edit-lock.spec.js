import { expect, test } from '@playwright/test';
import { coneElevation, osrm } from './helpers/apiMocks.mjs';

// Covers two follow-ups:
//  (#3) A data load fetches 主航點 (waypoints) BEFORE 副航點 (intermediate points).
//  (#4) While a data load runs, the ONLY allowed route edits are: append a waypoint
//       (map-click), delete the LAST waypoint, undo, redo. Move/insert stay blocked.
//
// Note on choreography: adding a waypoint to an existing route briefly enters the
// route-PLANNING phase (fully locked). Tests wait for the busy overlay to clear
// between setup waypoints; the "during a load" interactions target the slower
// weather 'edit' phase (data-load-edit), reached via a delayed forecast stub.
const ANCHOR = [23.5, 121.0];



// Records per-point forecast requests (lat,lng) into `sink`, and can delay each
// response so a load stays observably in-flight.
function forecast(page, { delayMs = 0, sink = null } = {}) {
  return page.route(/v1\/forecast/, async (route) => {
    const url = new URL(route.request().url());
    if (sink) sink.push([Number(url.searchParams.get('latitude')), Number(url.searchParams.get('longitude'))]);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const start = url.searchParams.get('start_date') || '2026-07-18';
    const end = url.searchParams.get('end_date') || start;
    const hourlyVars = (url.searchParams.get('hourly') || '').split(',').filter(Boolean);
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const times = [];
    for (const day of days) for (let h = 0; h < 24; h++) times.push(`${day}T${String(h).padStart(2, '0')}:00`);
    const val = (n) => (n === 'weathercode' ? 1 : n === 'temperature_2m' ? 21 : 1);
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}



function baseInit(page, extra = {}) {
  return page.addInitScript((extra) => {
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
  }, extra);
}

const wpCount = (page) => page.locator('#waypoint-list .waypoint-item');
const isHidden = () => document.getElementById('route-weather-busy-overlay')?.classList.contains('hidden');
const overlayHidden = (page) => page.waitForFunction(isHidden, null, { timeout: 30000 });
const dataLoadEdit = (page) => page.waitForFunction(() => document.body.classList.contains('data-load-edit'), null, { timeout: 20000 });

async function clickMap(page, fx, fy) {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function waitUntil(fn, timeoutMs = 20000) {
  const t0 = Date.now();
  while (!fn() && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Two waypoints, waiting for the resulting load to settle so the route is stable.
// An edit produces TWO busy cycles (route re-plan, then the data load) with a ~1s
// gap, so one overlayHidden() can return inside the gap; the NEXT click then lands
// while the map is frozen and is silently refused. Wait across the gap — the tests
// that deliberately click mid-load do their own thing and must not use this.
async function twoStableWaypoints(page) {
  await clickMap(page, 0.35, 0.4);
  await expect(wpCount(page)).toHaveCount(1);
  await clickMap(page, 0.6, 0.4);
  await expect(wpCount(page)).toHaveCount(2);
  await overlayHidden(page);
  await page.waitForTimeout(1800);
  await overlayHidden(page);
}

test('主航點 weather is fetched before 副航點 (ordering, #3)', async ({ page }) => {
  // segmentKm 1km → intermediate points (副航點) between the two spaced waypoints.
  // The FIRST load (nothing cached yet) is a clean full pass over every point, so its
  // request order directly reveals the main-first policy — no forced reload needed.
  await baseInit(page, { mappingElf_segmentKm: '1' });
  await osrm(page);
  const order = [];
  await forecast(page, { sink: order });
  await coneElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await clickMap(page, 0.3, 0.4);
  await expect(wpCount(page)).toHaveCount(1);
  await clickMap(page, 0.65, 0.4);   // spaced far enough to spawn 副航點 between them
  await expect(wpCount(page)).toHaveCount(2);

  const waypoints = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_waypoints') || '[]'));
  expect(waypoints.length).toBe(2);
  const near = (a, b) => Math.abs(a[0] - b[0]) < 0.003 && Math.abs(a[1] - b[1]) < 0.003;
  const isWaypoint = (c) => waypoints.some((w) => near(c, w));

  // Wait until we've observed both 主航點 and at least one 副航點 request.
  await waitUntil(() => order.some((c) => !isWaypoint(c))
    && new Set(order.filter(isWaypoint).map((c) => `${c[0].toFixed(3)},${c[1].toFixed(3)}`)).size >= 2);

  // Dedup by coordinate (an interrupted first-load can re-request the mains); every
  // load pass is main-first, so the deduped sequence must place ALL 主航點 before
  // ANY 副航點. Geographic ordering would interleave them and fail this.
  const seen = new Set();
  const deduped = [];
  for (const c of order) {
    const k = `${c[0].toFixed(3)},${c[1].toFixed(3)}`;
    if (!seen.has(k)) { seen.add(k); deduped.push(c); }
  }
  const mainIdx = deduped.map((c, i) => (isWaypoint(c) ? i : -1)).filter((i) => i >= 0);
  const subIdx = deduped.map((c, i) => (isWaypoint(c) ? -1 : i)).filter((i) => i >= 0);
  expect(mainIdx.length).toBe(2);              // both 主航點 fetched
  expect(subIdx.length).toBeGreaterThan(0);    // 副航點 exist to order after
  expect(Math.max(...mainIdx)).toBeLessThan(Math.min(...subIdx));   // 主 before 副
});

test('append via map-click is allowed during a running weather load (#4)', async ({ page }) => {
  await baseInit(page);
  await osrm(page);
  await forecast(page, { delayMs: 2500 });   // slow load stays in-flight
  await coneElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await clickMap(page, 0.35, 0.4);
  await expect(wpCount(page)).toHaveCount(1);
  await clickMap(page, 0.6, 0.4);
  await expect(wpCount(page)).toHaveCount(2);

  await dataLoadEdit(page);   // weather 'edit' load is running with the relaxed lock
  // Append a third waypoint mid-load (center map, clear of controls + bottom panel).
  await clickMap(page, 0.5, 0.52);
  await expect(wpCount(page)).toHaveCount(3, { timeout: 15000 });
});

test('delete-last is allowed, but move/insert controls are hidden during a load (#4)', async ({ page }) => {
  await baseInit(page);
  await osrm(page);
  await forecast(page, { delayMs: 2500 });
  await coneElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await clickMap(page, 0.35, 0.4);
  await expect(wpCount(page)).toHaveCount(1);
  await clickMap(page, 0.6, 0.4);
  await expect(wpCount(page)).toHaveCount(2);

  await dataLoadEdit(page);
  // Up/down (move) buttons must NOT exist while a load holds the lock.
  await expect(page.locator('#waypoint-list .wp-up')).toHaveCount(0);
  await expect(page.locator('#waypoint-list .wp-down')).toHaveCount(0);
  // Exactly one delete-last button (on the last row), and it is enabled.
  const del = page.locator('#waypoint-list .wp-remove-live');
  await expect(del).toHaveCount(1);
  await expect(del).toBeEnabled();

  await del.click();
  await expect(wpCount(page)).toHaveCount(1, { timeout: 15000 });
});

test('undo is allowed during a running weather load (#4)', async ({ page }) => {
  await baseInit(page);
  await osrm(page);
  await forecast(page, { delayMs: 2500 });
  await coneElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await twoStableWaypoints(page);   // load settled; history holds the 2-waypoint state

  // Append a third waypoint → its (slow) weather load becomes the running load.
  await clickMap(page, 0.5, 0.52);
  await expect(wpCount(page)).toHaveCount(3);
  await dataLoadEdit(page);
  await expect(page.locator('#btn-undo')).toBeEnabled();
  await page.keyboard.press('Control+z');   // revert the 3rd waypoint mid-load
  await expect(wpCount(page)).toHaveCount(2, { timeout: 15000 });
});
