import { expect, test } from '@playwright/test';

// The 集水區 bottom panel must draw each column's basin ON THE MAP, not just fill
// the table. Regression: the overlay was gated solely on a card's 集水區 view, so
// 取得集水區 reported 集水區資訊已更新 with numbers in every row while the map stayed
// blank — the region being the main thing the reading is about.
//
// fBm terrain (not a cone) so the basins are what real ridges/valleys give for an
// arbitrary waypoint; forecast/flood stubs feed the hydrology rows.
const ANCHOR = [23.5, 121.0];

function fbmElevation(page) {
  return page.route(/v1\/elevation/, (route) => {
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

function flood(page) {
  return page.route(/flood-api\.open-meteo\.com\/v1\/flood/, (route) => {
    const start = new URL(route.request().url()).searchParams.get('start_date');
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ daily: { time: [start], river_discharge: [5], river_discharge_mean: [4] } }),
    });
  });
}

// Basin overlays currently on the map, with their rendered size — a polygon that
// exists but collapsed to a couple of pixels is not "displayed".
function mapBasins(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#map path.wc-catchment-poly')).map((p) => {
    const b = p.getBBox();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  }));
}

// Two main waypoints on fBm terrain, bottom panel opened on the 集水區 view, table
// collapsed to 主航點 columns so the per-column DEM loads stay few and deterministic.
async function setupCatchmentPanel(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_bpView', 'catchment');
    localStorage.setItem('mappingElf_weatherTableCollapsed', '1');
    // Cards act individually, so a per-card 集水區 toggle means exactly one point.
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
  await fbmElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  // Zoom in so a ~1 km basin is hundreds of px wide, not one (zoom keeps the map
  // centre, so the clicks below still land on the stubbed terrain).
  // A map click during Leaflet's zoom animation is dropped, so settle after each
  // step and again before clicking.
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
  // A badge only opens its card once its weather has loaded.
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'), null, { timeout: 40000 });
}

test('集水區 panel draws each column\'s basin on the map', async ({ page }) => {
  await setupCatchmentPanel(page);

  // The panel auto-backfills the new waypoints; both basins must land on the map
  // without anyone touching a card's 天氣/集水區 toggle.
  await expect.poll(async () => (await mapBasins(page)).length, { timeout: 30000 }).toBe(2);
  for (const b of await mapBasins(page)) {
    expect(b.w).toBeGreaterThan(20);
    expect(b.h).toBeGreaterThan(20);
  }

  // The table is filled too — the map overlay must not come at the readout's cost.
  await expect(page.locator('.catchment-table .wt-data-cell').first()).not.toHaveText('…');
});

test('panel-driven basins clear when the bottom panel leaves 集水區 view', async ({ page }) => {
  await setupCatchmentPanel(page);
  await expect.poll(async () => (await mapBasins(page)).length, { timeout: 30000 }).toBe(2);

  await page.locator('#bp-view-toggle .bp-view-btn[data-bp-view="elev"]').click();
  await expect.poll(async () => (await mapBasins(page)).length, { timeout: 10000 }).toBe(0);

  // …and come back on return, from cache (no card toggle involved).
  await page.locator('#bp-view-toggle .bp-view-btn[data-bp-view="catchment"]').click();
  await expect.poll(async () => (await mapBasins(page)).length, { timeout: 30000 }).toBe(2);
});

test('a card-chosen 集水區 basin survives the panel leaving 集水區 view', async ({ page }) => {
  await setupCatchmentPanel(page);
  await expect.poll(async () => (await mapBasins(page)).length, { timeout: 30000 }).toBe(2);

  // Put the first waypoint's CARD into 集水區 view — an independent, per-point choice.
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await page.locator('.weather-card').first().waitFor();
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().click();
  }
  const viewBtn = page.locator('.weather-card.full [data-wc-view="catchment"]').first();
  await viewBtn.waitFor({ state: 'attached' });
  await viewBtn.dispatchEvent('click');
  await expect(page.locator('.weather-card.full [data-wc-view="catchment"].active').first()).toBeVisible();

  // Leaving the 集水區 panel drops the panel-driven basin but keeps the card's own.
  await page.locator('#bp-view-toggle .bp-view-btn[data-bp-view="elev"]').click();
  await expect.poll(async () => (await mapBasins(page)).length, { timeout: 15000 }).toBe(1);
});
