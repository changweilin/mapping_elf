import { expect, test } from '@playwright/test';
import { coneElevation, flood } from './helpers/apiMocks.mjs';

// Cancelling a load (停止 → X) must leave NOTHING behind: no parked run, no busy
// task, so the progress bar closes and later loads run normally. The regression
// this pins: the per-card 集水區 compute registers as a pausable run but had no
// cancel hook, so an X-cancel left it parked forever — the bar stayed pinned open
// and every later 更新天氣 / 取得集水區 finished underneath a bar that never closed.

// One retry only: these deliberately hang an endpoint, so a genuine failure
// costs a full test timeout and extra retries just multiply that.
test.describe.configure({ retries: 1 });

const ANCHOR = [23.5, 121.0];

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
    const val = (n) => (n === 'precipitation' ? 8 : n === 'temperature_2m' ? 21 : n === 'weathercode' ? 61 : 1);
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}

async function setupRoute(page) {
  await page.addInitScript(() => {
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
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
}

// A DEM read that never answers — the state where a cancel actually has to abort
// something rather than wait for the loop to notice on its own.
async function hangElevation(page) {
  await page.unroute(/v1\/elevation/);
  await page.route(/v1\/elevation/, () => new Promise(() => { }));
}

const overlay = (page) => page.locator('#route-weather-busy-overlay');

async function stopThenCancel(page) {
  // Wait for the 停止 toggle itself, not merely a visible bar: an earlier task (a
  // route re-plan) can raise the overlay before the pausable load registers its
  // run. Its appearance is also the guarantee that a load IS reachable — the
  // per-card 集水區 compute used to register its run after the overlay had already
  // repainted, leaving this button hidden for the whole compute.
  await expect(page.locator('#route-weather-busy-toggle')).toBeVisible({ timeout: 30_000 });
  await page.locator('#route-weather-busy-toggle').click();
  await expect(page.locator('#route-weather-busy-cancel')).toBeVisible();
  await page.locator('#route-weather-busy-cancel').click();
}

test('cancelling a stuck per-card 集水區 compute closes the progress bar', async ({ page }) => {
  await setupRoute(page);
  await hangElevation(page);

  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await page.locator('.weather-card').first().waitFor();
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().dispatchEvent('click');
  }
  await page.locator('.weather-card.full [data-wc-view="catchment"]').first().dispatchEvent('click');

  await stopThenCancel(page);
  await expect(overlay(page)).toHaveClass(/hidden/);
  // Nothing parked, nothing pinned: the editing lock is released too.
  await expect(page.locator('body')).not.toHaveClass(/route-weather-busy/);
});

test('a load started after a cancel completes and closes the bar', async ({ page }) => {
  await setupRoute(page);
  await hangElevation(page);

  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await page.locator('.weather-card').first().waitFor();
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().dispatchEvent('click');
  }
  await page.locator('.weather-card.full [data-wc-view="catchment"]').first().dispatchEvent('click');
  await stopThenCancel(page);
  await expect(overlay(page)).toHaveClass(/hidden/);

  // The endpoint recovers; 更新天氣 must run to completion and leave the bar closed.
  await page.unroute(/v1\/elevation/);
  await coneElevation(page);
  await page.locator('#settings-toggle-header h3').click();
  await page.locator('#btn-weather-quick-fetch').click();
  await expect(overlay(page)).toHaveClass(/hidden/, { timeout: 30_000 });
  await expect(page.locator('body')).not.toHaveClass(/route-weather-busy/);
});

test('cancelling the batch 集水區 load closes the bar and frees a re-run', async ({ page }) => {
  await setupRoute(page);
  await hangElevation(page);

  await page.locator('#bp-view-toggle [data-bp-view="catchment"]').click();
  await page.locator('#settings-toggle-header h3').click();
  await page.locator('#btn-catchment-quick-fetch').click();
  await stopThenCancel(page);
  await expect(overlay(page)).toHaveClass(/hidden/);

  await page.unroute(/v1\/elevation/);
  await coneElevation(page);
  await page.locator('#btn-catchment-quick-fetch').click();
  await expect(overlay(page)).toHaveClass(/hidden/, { timeout: 60_000 });
});
