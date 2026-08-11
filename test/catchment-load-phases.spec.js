import { expect, test } from '@playwright/test';

// 集水區 loads in TWO ordered passes: every column's 集水區域 (the DEM delineation —
// map range + 地形 rows, time-independent) first, then every column's 水文資訊 (the
// hydrology read for that column's date/hour). The 啟用集水區 switch is split the same
// way, and 資訊 off must issue no hydrology request at all.
//
// fBm terrain (not a cone) so the basins are what real ridges/valleys give; the
// forecast/flood stubs feed the hydrology rows and count the 資訊-half requests.
const ANCHOR = [23.5, 121.0];

function fbmElevation(page, stats) {
  return page.route(/v1\/elevation/, (route) => {
    stats.demCalls++;
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((la, i) => {
      const dy = (la - ANCHOR[0]) * 111320;
      const dx = (lngs[i] - ANCHOR[1]) * 111320 * Math.cos(ANCHOR[0] * Math.PI / 180);
      let e = 1200 + dy * 0.03 - dx * 0.02;
      for (let k = 0; k < 5; k++) {
        const a = 300 / 2 ** k, w = 2 ** k / 900;
        e += a * Math.sin(dx * w + k) * Math.cos(dy * w * 1.3 + k * 2);
      }
      return e;
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
    const val = (n) => (n === 'precipitation' ? 8 : n.startsWith('soil_moisture') ? 0.35 : n === 'temperature_2m' ? 21 : 1);
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}

// The flood endpoint is 資訊-only: it is read by computeCatchmentInfo and by nothing
// in the 區域 half, so its call count is a clean probe for "did the hydrology run".
function flood(page, stats) {
  return page.route(/flood-api\.open-meteo\.com\/v1\/flood/, (route) => {
    stats.floodCalls++;
    const start = new URL(route.request().url()).searchParams.get('start_date');
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ daily: { time: [start], river_discharge: [5], river_discharge_mean: [4] } }),
    });
  });
}

const cells = (page, section) => page.locator(`[data-cat-section="${section}"] .wt-cell-value`);
const overlayHidden = (page) => page.waitForFunction(
  () => document.getElementById('route-weather-busy-overlay')?.classList.contains('hidden'), null, { timeout: 60000 });

// Records every progress-detail line the busy pill shows, from page load, so the
// pass ORDER can be asserted after the fact instead of raced against live.
function recordBusyDetails(page) {
  return page.addInitScript(() => {
    window.__busyDetails = [];
    const attach = () => {
      const el = document.getElementById('route-weather-busy-detail');
      if (!el) return false;
      const push = () => {
        const t = (el.textContent || '').trim();
        if (t && window.__busyDetails.at(-1) !== t) window.__busyDetails.push(t);
      };
      new MutationObserver(push).observe(el, { childList: true, characterData: true, subtree: true });
      push();
      return true;
    };
    if (!attach()) document.addEventListener('DOMContentLoaded', attach);
  });
}

async function setupCatchmentPanel(page, stats) {
  await recordBusyDetails(page);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_bpView', 'catchment');
    localStorage.setItem('mappingElf_weatherTableCollapsed', '1');
    localStorage.setItem('mappingElf_collectiveMarked', '0');
    localStorage.setItem('mappingElf_collectiveIntermediate', '0');
    localStorage.setItem('mappingElf_collectiveAll', '0');
  });
  await page.route('**/route/v1/**', (route) => {
    const coordPart = new URL(route.request().url()).pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 1000, duration: 1000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
  await forecast(page);
  await flood(page, stats);
  await fbmElevation(page, stats);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  for (let i = 0; i < 6; i++) {
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);

  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'), null, { timeout: 40000 });
}

test('the progress bar runs 集水區域 to completion before 水文資訊 starts', async ({ page }) => {
  const stats = { demCalls: 0, floodCalls: 0 };
  await setupCatchmentPanel(page, stats);

  await expect(cells(page, 'hydro').filter({ hasText: '…' })).toHaveCount(0, { timeout: 60000 });
  await overlayHidden(page);

  const details = await page.evaluate(() => window.__busyDetails);
  const blockLines = details.filter((d) => d.startsWith('載入集水區域'));
  const infoLines = details.filter((d) => d.startsWith('載入水文資訊'));
  expect(blockLines.length).toBeGreaterThan(0);
  expect(infoLines.length).toBeGreaterThan(0);

  // Every 區域 line precedes every 水文 line — the passes never interleave.
  const lastBlock = details.lastIndexOf(blockLines.at(-1));
  const firstInfo = details.indexOf(infoLines[0]);
  expect(lastBlock).toBeLessThan(firstInfo);
  // And the 區域 pass covered the whole route before handing over.
  expect(blockLines.at(-1)).toMatch(/載入集水區域 (\d+)\/\1$/);

  // Both halves actually produced numbers. Individual 水文 rows are null-safe and
  // may read '—' when the stub has no input for them, so the 資訊 half is judged by
  // its risk chips (surge + debris-flow, one pair per column) instead.
  await expect(cells(page, 'terrain').filter({ hasText: '—' })).toHaveCount(0);
  expect(await page.locator('[data-cat-section="hydro"] .risk-chip').count()).toBeGreaterThanOrEqual(4);
  expect(stats.floodCalls).toBeGreaterThan(0);
});

test('水文資訊 off: 水文 rows are neither rendered nor requested', async ({ page }) => {
  const stats = { demCalls: 0, floodCalls: 0 };
  await setupCatchmentPanel(page, stats);
  await expect(cells(page, 'hydro').filter({ hasText: '…' })).toHaveCount(0, { timeout: 60000 });
  await overlayHidden(page);

  await page.locator('#settings-toggle-header h3').click();
  await page.locator('#catchment-enable-info').uncheck();

  // The 水文 half disappears from the table; 區域 rows stay.
  await expect(cells(page, 'hydro')).toHaveCount(0);
  await expect(cells(page, 'terrain').first()).toBeVisible();

  const floodBefore = stats.floodCalls;
  await page.locator('#btn-catchment-quick-fetch').click();
  await overlayHidden(page);
  expect(stats.floodCalls).toBe(floodBefore);

  // Turning it back on restores the remembered readings — from the saved readout,
  // with no second hydrology request.
  await page.locator('#catchment-enable-info').check();
  expect(await page.locator('[data-cat-section="hydro"] .risk-chip').count()).toBeGreaterThanOrEqual(4);
  expect(stats.floodCalls).toBe(floodBefore);
});

// No route here on purpose: this is about the switch's own persistence, and a live
// load would only add busy-defer noise to the toggling.
test('the 水文資訊 choice persists on its own, independently of 集水區域', async ({ page }) => {
  // No localStorage.clear() here: addInitScript re-runs on the reload below, and
  // wiping storage there would erase the very choice this test is checking survives.
  await page.addInitScript(() => { localStorage.setItem('mappingElf_language', 'zh-TW'); });
  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#settings-toggle-header h3').click();
  await expect(page.locator('#catchment-enable-info')).toBeChecked();

  await page.locator('#catchment-enable-info').uncheck();
  await page.reload();
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#settings-toggle-header h3').click();
  await expect(page.locator('#catchment-enable-info')).not.toBeChecked();
  await expect(page.locator('#catchment-enable-block')).toBeChecked();   // 區域 untouched

  // 區域 off locks 水文 in place (it has no basin to describe) without erasing the choice.
  await page.locator('#catchment-enable-block').uncheck();
  await expect(page.locator('#catchment-enable-info')).toBeDisabled();
  await page.locator('#catchment-enable-block').check();
  await expect(page.locator('#catchment-enable-info')).toBeEnabled();
  await expect(page.locator('#catchment-enable-info')).not.toBeChecked();
});
