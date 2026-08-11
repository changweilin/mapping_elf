import { expect, test } from '@playwright/test';
import { coneElevation, flood, osrm } from './helpers/apiMocks.mjs';

// Catchment must mirror weather: a failed column can be re-fetched by clicking it
// (single-column retry), a partial failure warns honestly, and the column-collapse
// control is available from the catchment view too.
const ANCHOR = [23.5, 121.0];

// Cone DEM that drains to map centre. While `failRightDem` is set, the RIGHT
// waypoint's grid (mean longitude past the midpoint) comes back with NO usable
// samples, which yields a non-'ok' delineation → that column reads "—" (fast, no
// network retry). Note this can't be faked with flat terrain any more: 平地 is a
// settled answer that shows 平地 and is deliberately never retried.
const failRightDem = { v: false };

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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}

function catchmentInit(page, extra = {}) {
  return page.addInitScript((extra) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_bpView', 'catchment');
    localStorage.setItem('mappingElf_weatherTableCollapsed', '1');
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, extra);
}

const areaCells = (page) => page.locator('[data-cat-section="terrain"][data-cat-i="0"] .wt-cell-value');
const overlayHidden = (page) => page.waitForFunction(() => document.getElementById('route-weather-busy-overlay')?.classList.contains('hidden'), null, { timeout: 40000 });

async function twoWaypoints(page) {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
}

test('a failed catchment column is re-fetchable by clicking it (single-column retry)', async ({ page }) => {
  failRightDem.v = true;   // the right waypoint's DEM 429s through the batch + sweep
  await catchmentInit(page);
  await osrm(page); await forecast(page); await flood(page);
  await coneElevation(page, { deadZone: (meanLng) => failRightDem.v && meanLng > 121.6 });
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await twoWaypoints(page);

  // Batch auto-fetch: left column resolves (area value), right stays "—" (DEM failed
  // through the retry sweep). No column is left stuck on the "…" spinner.
  await expect(areaCells(page)).toHaveCount(2);
  await expect(areaCells(page).filter({ hasText: '…' })).toHaveCount(0, { timeout: 40000 });
  await overlayHidden(page);
  const values = await areaCells(page).allInnerTexts();
  expect(values.some((t) => t.trim() === '—')).toBeTruthy();   // right column failed honestly
  expect(values.some((t) => t.trim() !== '—' && t.trim() !== '…')).toBeTruthy();  // left column ok

  // Fix the DEM and click the failed (—) column: it re-fetches just that column.
  failRightDem.v = false;
  const failedCell = areaCells(page).filter({ hasText: '—' }).first();
  await failedCell.click();
  await expect(areaCells(page).filter({ hasText: '—' })).toHaveCount(0, { timeout: 40000 });
});

test('column-collapse control is available in the catchment view', async ({ page }) => {
  failRightDem.v = false;
  // Uncollapsed + segmentKm so there are 副航點 columns to collapse away.
  await catchmentInit(page, { mappingElf_weatherTableCollapsed: '0', mappingElf_segmentKm: '1' });
  await osrm(page); await forecast(page); await flood(page);
  await coneElevation(page, { deadZone: (meanLng) => failRightDem.v && meanLng > 121.6 });
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await twoWaypoints(page);
  await overlayHidden(page);

  const collapseBtn = page.locator('#catchment-table-container [data-action="toggle-weather-table"]');
  await expect(collapseBtn).toHaveCount(1);
  // Starts uncollapsed.
  await expect(page.locator('#catchment-table-container .catchment-table.is-collapsed')).toHaveCount(0);

  await collapseBtn.click();
  // Collapse toggles the shared state → catchment table drops to 主航點-only columns.
  await expect(page.locator('#catchment-table-container .catchment-table.is-collapsed')).toHaveCount(1);
  await expect(areaCells(page)).toHaveCount(2);

  // And back — the control round-trips.
  await page.locator('#catchment-table-container [data-action="toggle-weather-table"]').click();
  await expect(page.locator('#catchment-table-container .catchment-table.is-collapsed')).toHaveCount(0);
});
