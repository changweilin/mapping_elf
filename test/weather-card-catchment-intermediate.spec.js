import { expect, test } from '@playwright/test';
import { coneElevation, flood } from './helpers/apiMocks.mjs';

// Intermediate (副航點/中繼點) weather cards must draw the catchment basin on the
// map just like waypoint cards, and it must survive a weather-panel rebuild
// (which re-maps colIdx→point). The basin is reconciled centrally by
// syncCatchmentBasins(), independent of card re-render.
const ANCHOR = [23.5, 121.0];


function forecast(page) {
  return page.route(/v1\/forecast/, (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start_date') || '2026-07-18';
    const end = url.searchParams.get('end_date') || start;
    const hourlyVars = (url.searchParams.get('hourly') || '').split(',').filter(Boolean);
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    const times = [];
    for (const day of days) for (let h = 0; h < 24; h++) times.push(`${day}T${String(h).padStart(2, '0')}:00`);
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => v === 'precipitation' ? 8 : v.startsWith('soil_moisture') ? 0.35 : v === 'temperature_2m' ? 21 : 1);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}


test('intermediate (副航點) card: catchment draws a basin that survives a rebuild', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0.1');
    localStorage.setItem('mappingElf_waypointCentering', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    // 副航點 detailed catchment defaults OFF (card shows weather-only, no basin);
    // this test asserts the detailed basin, so opt the 副航點 into it explicitly.
    localStorage.setItem('mappingElf_imDetailCatchment', '1');
  });
  await page.route('**/route/v1/**', (route) => {
    const coordPart = new URL(route.request().url()).pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 3000, duration: 3000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
  await forecast(page);
  await flood(page);
  await coneElevation(page);

  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  const box = await page.locator('#map').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.mouse.click(cx, box.y + box.height * 0.15);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(cx, box.y + box.height * 0.85);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);

  await expect(page.locator('.intermediate-point-icon').first()).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
  await page.locator('.wt-ctrl-fetch, [data-action="fetch"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(2000);

  // Open the intermediate (副航點) card via its map weather badge.
  const badge = page.locator('.intermediate-point-icon .wp-weather-badge').first();
  for (let i = 0; i < 3 && (await page.locator('.weather-card').count()) === 0; i++) {
    await badge.dispatchEvent('click');
    await page.waitForTimeout(1200);
  }
  await page.locator('.weather-card').first().waitFor({ timeout: 8000 });
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().dispatchEvent('click');
  }
  const cardId = await page.locator('.weather-card.full').first().getAttribute('id');
  const card = page.locator(`#${cardId}`);
  expect(await card.getAttribute('data-col-idx')).not.toBeNull();

  // Switch the sub-waypoint card to catchment → basin drawn on the map.
  await card.locator('.wc-view-btn[data-wc-view="catchment"]').dispatchEvent('click');
  await expect(card.locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });
  const poly = page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly');
  await expect(poly).toHaveCount(1, { timeout: 20000 });

  // Force a weather-panel rebuild (shift all times) → basin must survive (redrawn
  // by syncCatchmentBasins even though colIdx→point is re-mapped). The bulk
  // day-plus lives in the weather table (hidden by default → reveal it first).
  await page.locator('#bp-view-toggle [data-bp-view="weather"]').click();
  await page.locator('#weather-table-container [data-action="day-plus"]').first().waitFor({ timeout: 5000 });
  await page.locator('#weather-table-container [data-action="day-plus"]').first().click();
  await page.waitForTimeout(1800);
  await expect(poly).toHaveCount(1, { timeout: 20000 });
});

test('intermediate (副航點) card defaults: minimal card — no basin, no full detail', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0.1');
    localStorage.setItem('mappingElf_waypointCentering', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    // No opt-in: 副航點 詳細天氣資訊/詳細集水區資訊 both default OFF.
  });
  await page.route('**/route/v1/**', (route) => {
    const coordPart = new URL(route.request().url()).pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 3000, duration: 3000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
  await forecast(page);
  await flood(page);
  await coneElevation(page);

  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  const box = await page.locator('#map').boundingBox();
  const cx = box.x + box.width / 2;

  await page.mouse.click(cx, box.y + box.height * 0.15);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(cx, box.y + box.height * 0.85);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);

  await expect(page.locator('.intermediate-point-icon').first()).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
  await page.locator('.wt-ctrl-fetch, [data-action="fetch"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(2000);

  const badge = page.locator('.intermediate-point-icon .wp-weather-badge').first();
  for (let i = 0; i < 3 && (await page.locator('.weather-card').count()) === 0; i++) {
    await badge.dispatchEvent('click');
    await page.waitForTimeout(1200);
  }
  await page.locator('.weather-card').first().waitFor({ timeout: 8000 });
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().dispatchEvent('click');
  }
  const card = page.locator('.weather-card.full').first();

  // Weather view (default): only 雨量/降雨機率/濕度/風速 below the header — no full
  // detail (海拔/坐標 bottom facts) and no Windy link.
  await expect(card).toContainText('雨量');
  await expect(card).toContainText('風速');
  await expect(card.locator('.wc-windy-btn')).toHaveCount(0);
  await expect(card.locator('.wc-bottom-facts')).toHaveCount(0);
  await expect(card).not.toContainText('坐標');

  // Catchment view: weather-only — no 地形/水文 rows computed, no basin drawn.
  await card.locator('.wc-view-btn[data-wc-view="catchment"]').dispatchEvent('click');
  await page.waitForTimeout(1500);
  await expect(card.locator('.wc-catchment')).toContainText('雨量');
  await expect(card.locator('.wc-catchment')).not.toContainText('集水區面積');
  await expect(card.locator('.wc-catchment')).not.toContainText('土壤含水量');
  await expect(page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly')).toHaveCount(0);
});
