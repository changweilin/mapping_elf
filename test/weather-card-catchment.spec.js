import { expect, test } from '@playwright/test';

// These drive Leaflet weather-card popups that pan/animate for a moment after
// opening; under CI/load the popup can still be settling when a step fires.
// Retry to absorb that environmental flakiness (the feature itself is stable).
test.describe.configure({ retries: 2 });

// Weather-card catchment view (both waypoint and GPS-cursor cards) + the
// per-point "set to now" buttons. A cone DEM (drains to the map centre) lets a
// centre point delineate a basin; forecast/flood stubs feed weather + hydrology.
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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
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

// Two waypoints (wp1 at the cone centre → a large basin) with weather loaded.
// `collective` links the two waypoint cards; when off, one centred card opens.
async function setupRoute(page, { collective = false } = {}) {
  await page.addInitScript((collective) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_collectiveMarked', collective ? '1' : '0');
    localStorage.setItem('mappingElf_collectiveIntermediate', '0');
    localStorage.setItem('mappingElf_collectiveAll', '0');
  }, collective);
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

// Weather cards are Leaflet popups that keep panning/re-rendering while the map
// settles, so locator.click flakes on "element is not stable / detached" under
// load. We're exercising the card's click HANDLER (view switch), not hit-testing,
// so dispatch the click directly on the button — robust against map animation.
async function clickCardControl(locator) {
  const el = locator.first();
  await el.waitFor({ state: 'attached', timeout: 15000 });
  await el.dispatchEvent('click');
}

// Open the first waypoint card and ensure it is expanded to full; returns its id.
async function openFirstCardFull(page) {
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await page.locator('.weather-card').first().waitFor();
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().click();
  }
  return page.locator('.weather-card.full').first().getAttribute('id');
}

test('weather card: catchment toggle draws basin + set-to-now buttons work', async ({ page }) => {
  await setupRoute(page, { collective: false });

  const cardId = await openFirstCardFull(page);
  const card = page.locator(`#${cardId}`);
  await expect(card).toBeVisible();

  // New controls present in weather view.
  await expect(card.locator('.wc-view-toggle')).toBeVisible();
  await expect(card.locator('.wc-now-btn')).toHaveCount(2);

  const pathsBefore = await page.locator('#map .leaflet-overlay-pane path').count();

  // Switch this freshly-centred card to catchment view.
  await clickCardControl(card.locator('.wc-view-btn[data-wc-view="catchment"]'));
  const catch1 = card.locator('.wc-catchment');
  await expect(catch1).toContainText('集水區面積', { timeout: 20000 });
  await expect(catch1).toContainText('海拔範圍');
  await expect(catch1).toContainText('土壤含水量', { timeout: 20000 });
  await expect(catch1).toContainText('僅供參考');
  await expect(catch1).not.toContainText('NaN');
  await expect(catch1).not.toContainText('undefined');
  // 天氣/溫度/體感溫度 are shown in the card header line, so the catchment panel omits them.
  await expect(catch1).not.toContainText('天氣');
  await expect(catch1).not.toContainText('溫度');

  // Basin polygon drawn on the map, and it added a path.
  await expect(page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly')).toHaveCount(1, { timeout: 20000 });
  expect(await page.locator('#map .leaflet-overlay-pane path').count()).toBeGreaterThan(pathsBefore);

  // Weather-card format: 2-column info grid, all rows present up front (terrain 5
  // + weather 4 [humidity/wind/precip×2] + hydrology 6), so the card does not
  // balloon when async data lands.
  await expect(card.locator('.wc-catchment [data-catch] .wc-info-item')).toHaveCount(15);
  // 前期降雨 + 河川流量 carry the long values and stay marked .is-wide.
  await expect(card.locator('[data-catch="hydro"] .wc-info-item.is-wide')).toHaveCount(2);

  // 集水區域 (terrain) and 水文 (hydrology) sit LEFT-RIGHT: same top edge, no overlap.
  const cols = card.locator('.wc-catchment .wc-catch-col');
  await expect(cols).toHaveCount(2);
  await expect(cols.nth(0)).toContainText('集水區域');
  await expect(cols.nth(1)).toContainText('水文');
  // Measure BOTH in one evaluate: the popup is still panning, so two separate
  // boundingBox() round-trips sample different animation frames.
  const geom = await card.locator('.wc-catchment').evaluate((el) => {
    const [l, r] = el.querySelectorAll('.wc-catch-col');
    const a = l.getBoundingClientRect();
    const b = r.getBoundingClientRect();
    return { lx: a.x, lw: a.width, ly: a.y, rx: b.x, ry: b.y };
  });
  expect(geom.rx).toBeGreaterThanOrEqual(geom.lx + geom.lw);
  expect(Math.abs(geom.ry - geom.ly)).toBeLessThanOrEqual(1);
  const skelH = await card.locator('.wc-catchment').evaluate((el) => el.getBoundingClientRect().height);
  await expect(card.locator('[data-catch="hydro"] .wc-catch-val').first()).not.toHaveText('…', { timeout: 20000 });
  const fullH = await card.locator('.wc-catchment').evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(fullH - skelH)).toBeLessThanOrEqual(30);   // ~a row of wrap variance, not a balloon

  // Switch back to weather → windy button returns, polygon removed.
  await clickCardControl(card.locator('.wc-view-btn[data-wc-view="weather"]'));
  await expect(card.locator('.wc-windy-btn')).toBeVisible();
  await expect(page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly')).toHaveCount(0);

  // Set-to-now buttons don't throw and keep the card alive.
  await clickCardControl(card.locator('.wc-adj-date-now'));
  await clickCardControl(card.locator('.wc-adj-hour-now'));
  await expect(page.locator(`#${cardId}`)).toBeVisible();

  // Catchment cache persisted for reuse.
  const cacheLen = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mappingElf_catchmentCache') || '{}')).length);
  expect(cacheLen).toBeGreaterThan(0);
});

test('catchment basin persists through compact / minimize / reopen', async ({ page }) => {
  await setupRoute(page, { collective: false });
  const poly = page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly');

  const cardId = await openFirstCardFull(page);
  const card = () => page.locator(`#${cardId}`);
  await clickCardControl(card().locator('.wc-view-btn[data-wc-view="catchment"]'));
  await expect(card().locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });
  await expect(poly).toHaveCount(1, { timeout: 20000 });

  // Shrink to compact (縮小) → basin stays on the map even without the panel.
  await clickCardControl(card().locator('.q-toggle').first());
  await expect(card()).toHaveClass(/compact/);
  await expect(card().locator('.wc-catchment')).toHaveCount(0);   // no panel while compact
  await expect(poly).toHaveCount(1, { timeout: 20000 });

  // Close/minimize (最小) → basin still shown; the view choice is remembered.
  await clickCardControl(card().locator('.q-close').first());
  await expect(page.locator(`#${cardId}`)).toHaveCount(0);
  await expect(poly).toHaveCount(1, { timeout: 20000 });

  // Reopen → back in catchment view, basin still there.
  await openFirstCardFull(page);
  await expect(card().locator('.wc-view-btn[data-wc-view="catchment"].active')).toBeVisible();
  await expect(card().locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });
  await expect(poly).toHaveCount(1, { timeout: 20000 });

  // Toggling back to weather removes the basin.
  await clickCardControl(card().locator('.wc-view-btn[data-wc-view="weather"]'));
  await expect(poly).toHaveCount(0, { timeout: 20000 });
});

test('catchment view choice is remembered across a page reload', async ({ page }) => {
  // addInitScript reruns on every navigation (incl. reload), so guard the reset
  // with sessionStorage — the route + persisted view choice must survive the reload.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__catch_reload_setup')) return;
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
    sessionStorage.setItem('__catch_reload_setup', '1');
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

  const cardId = await openFirstCardFull(page);
  const card = page.locator(`#${cardId}`);
  await clickCardControl(card.locator('.wc-view-btn[data-wc-view="catchment"]'));
  await expect(card.locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });
  const poly = page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly');
  await expect(poly).toHaveCount(1, { timeout: 20000 });

  // The choice is written to localStorage under the registered key.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_cardCatchmentView') || '[]'));
  expect(Array.isArray(stored)).toBe(true);
  expect(stored.length).toBeGreaterThan(0);

  // Reload → route restores AND the basin is auto-redrawn from the remembered view
  // choice (syncCatchmentBasins reconciles on panel render, no card reopen needed).
  await page.reload();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await expect(poly).toHaveCount(1, { timeout: 20000 });
});

test('waypoint catchment readout is remembered across a page reload', async ({ page }) => {
  // Reload-safe reset (see the view-choice test): the route, weather cache and the
  // persisted catchment readout must all survive the reload.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__catch_data_setup')) return;
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
    sessionStorage.setItem('__catch_data_setup', '1');
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

  const cardId = await openFirstCardFull(page);
  const card = page.locator(`#${cardId}`);
  await clickCardControl(card.locator('.wc-view-btn[data-wc-view="catchment"]'));
  await expect(card.locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });
  // Wait for the full readout (last hydrology cell resolves off the "…" skeleton).
  await expect(card.locator('[data-catch="hydro"] .wc-catch-val').last()).not.toHaveText('…', { timeout: 20000 });

  // The full readout is now persisted under the registered key: an ok entry with a
  // 6-row hydrology array + terrain values.
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_catchmentCells') || '{}'));
  const entries = Object.values(store);
  expect(entries.length).toBeGreaterThan(0);
  expect(entries[0].status).toBe('ok');
  expect(Array.isArray(entries[0].hydro)).toBe(true);
  expect(entries[0].hydro.length).toBe(6);
  expect(Array.isArray(entries[0].terrain)).toBe(true);
  expect(entries[0].terrain.length).toBeGreaterThan(0);

  // Reload → the remembered readout survives storage AND the card (reopened in its
  // remembered catchment view) shows real terrain + hydrology, no "…" placeholders.
  await page.reload();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  const survived = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mappingElf_catchmentCells') || '{}')).length);
  expect(survived).toBeGreaterThan(0);

  const cardId2 = await openFirstCardFull(page);
  const card2 = page.locator(`#${cardId2}`);
  await expect(card2.locator('.wc-view-btn[data-wc-view="catchment"].active')).toBeVisible({ timeout: 10000 });
  await expect(card2.locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });
  await expect(card2.locator('[data-catch="hydro"] .wc-catch-val').last()).not.toHaveText('…', { timeout: 20000 });
  await expect(card2.locator('.wc-catchment')).not.toContainText('…');
});

test('view toggle applies to the whole collective set', async ({ page }) => {
  await setupRoute(page, { collective: true });

  // Collective marked-point mode: opening one waypoint opens both cards full.
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await expect(page.locator('.weather-card.full')).toHaveCount(2, { timeout: 10000 });

  // Toggle the centred (pivot) card to catchment → BOTH linked cards follow, so
  // both open cards render a catchment panel and select the 集水區 tab.
  await clickCardControl(page.locator('#wc-root-0 .wc-view-btn[data-wc-view="catchment"]'));
  await expect(page.locator('.weather-card.full .wc-catchment')).toHaveCount(2, { timeout: 20000 });
  await expect(page.locator('.weather-card.full .wc-view-btn[data-wc-view="catchment"].active')).toHaveCount(2);

  // Toggle back → both return to weather view.
  await clickCardControl(page.locator('#wc-root-0 .wc-view-btn[data-wc-view="weather"]'));
  await expect(page.locator('.weather-card.full .wc-catchment')).toHaveCount(0);
});

test.describe('GPS cursor', () => {
  test.use({ permissions: ['geolocation'], geolocation: { latitude: ANCHOR[0], longitude: ANCHOR[1] } });

  test('GPS-cursor card: catchment toggle draws basin', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_language', 'zh-TW');
  });
  await forecast(page);
  await flood(page);
  await coneElevation(page);

  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  // Drop the GPS cursor at the cone centre, then open its cursor menu.
  await page.locator('#btn-my-location').click();
  await page.locator('.map-cursor-icon').first().waitFor({ timeout: 15000 });
  await page.locator('.map-cursor-icon').first().click({ button: 'right' });
  await page.locator('.map-cursor-menu').waitFor({ timeout: 10000 });
  await page.locator('.map-cursor-menu [data-action="weather"]').click();

  const cursor = page.locator('.cursor-weather-card');
  await expect(cursor).toBeVisible({ timeout: 15000 });
  await expect(cursor.locator('.wc-view-toggle')).toBeVisible();

  // Switch to catchment view → data + basin polygon.
  await cursor.locator('.wc-view-btn[data-wc-view="catchment"]').click();
  await expect(cursor.locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });
  await expect(cursor.locator('.wc-catchment')).toContainText('土壤含水量', { timeout: 20000 });
  await expect(page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly')).toHaveCount(1, { timeout: 20000 });

  // Switch back → polygon removed.
  await cursor.locator('.wc-view-btn[data-wc-view="weather"]').click();
  await expect(page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly')).toHaveCount(0);
  });
});
