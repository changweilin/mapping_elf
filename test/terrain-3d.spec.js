import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');

// Mock the Open-Meteo elevation API so the 3D terrain build is deterministic and
// offline. Generates a hilly surface in the route's real elevation band so the
// terrain grid lines up with the imported KML track. Returns a `state` object
// whose `count` tracks how many elevation requests were served (for cache tests).
async function mockElevation(page, { delayMs = 30 } = {}) {
  const state = { count: 0 };
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, async (route) => {
    state.count += 1;
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((lat, i) => {
      const lng = lngs[i] ?? 0;
      const base = 2450;
      const h1 = 850 * Math.exp(-(((lat - 24.2133) ** 2) + ((lng - 121.3472) ** 2)) / 0.00035);
      const h2 = 500 * Math.exp(-(((lat - 24.205) ** 2) + ((lng - 121.355) ** 2)) / 0.0006);
      return Math.round(base + h1 + h2);
    });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ elevation }),
    });
  });
  return state;
}

// Mock the Overpass 圖資 (map features) endpoint so the background feature
// download resolves fast and deterministically instead of hitting the real
// mirrors — since the loading indicator now stays up (as a small non-blocking
// pill) through this phase too, an unmocked/unreachable Overpass would make
// every #tv-loading-hidden assertion in this file wait out the real network
// timeout. Empty `elements` by default (no roads/buildings/landmarks); pass
// `elements` for tests that need specific 圖資 (e.g. a landmark node).
async function mockFeatures(page, { delayMs = 20, elements = [] } = {}) {
  const state = { count: 0 };
  await page.route(/\/interpreter\?/, async (route) => {
    state.count += 1;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements }) });
  });
  return state;
}

// A valid Open-Meteo forecast/archive payload echoing the requested date, so the
// weather load actually completes (and its busy overlay clears) instead of hanging.
function weatherPayloadForUrl(url) {
  const date = new URL(url).searchParams.get('start_date') || '2026-04-20';
  return {
    daily: {
      time: [date],
      temperature_2m_max: [22], temperature_2m_min: [12], precipitation_sum: [0],
      weathercode: [1], windspeed_10m_max: [12], windgusts_10m_max: [18],
      sunrise: [`${date}T05:10`], sunset: [`${date}T18:30`], sunshine_duration: [18000],
      precipitation_probability_max: [10], uv_index_max: [7], shortwave_radiation_sum: [19],
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, () => 18),
      apparent_temperature: Array.from({ length: 24 }, () => 17),
      relative_humidity_2m: Array.from({ length: 24 }, () => 65),
      dewpoint_2m: Array.from({ length: 24 }, () => 11),
      precipitation: Array.from({ length: 24 }, () => 0),
      precipitation_probability: Array.from({ length: 24 }, () => 10),
      weathercode: Array.from({ length: 24 }, () => 1),
      windspeed_10m: Array.from({ length: 24 }, () => 9),
      windgusts_10m: Array.from({ length: 24 }, () => 15),
      uv_index: Array.from({ length: 24 }, () => 4),
      visibility: Array.from({ length: 24 }, () => 10000),
      cloudcover: Array.from({ length: 24 }, () => 25),
    },
    elevation: 100,
  };
}

// Load the app and import the sample KML so a route + waypoints exist. The 3D
// button (in the route-planning section) becomes enabled once a route is drawn.
// By default the weather forecast is stubbed out (aborted); pass { weather: true }
// to serve a valid forecast so the weather load completes.
async function openWithRoute(page, { weather = false } = {}) {
  if (weather) {
    const serve = (r) => r.fulfill({ json: weatherPayloadForUrl(r.request().url()) });
    await page.route(/api\.open-meteo\.com\/v1\/forecast/, serve);
    await page.route(/archive-api\.open-meteo\.com\/v1\/archive/, serve);
  } else {
    await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => r.abort());
  }
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('#gpx-file-input').setInputFiles(sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#btn-view-3d')).toBeEnabled();
}

async function ensurePanelOpen(page) {
  const open = await page.locator('#side-panel').evaluate((el) => el.classList.contains('open'));
  if (!open) await page.locator('#btn-toggle-panel').click();
  await expect(page.locator('#side-panel')).toHaveClass(/open/);
}

// Build the current route's 3D terrain via the route-planning button.
async function open3dForCurrentRoute(page) {
  await ensurePanelOpen(page);
  await page.locator('#btn-view-3d').click();
}

// Mock the OSRM routing service so planning a routed (non-imported) route is
// deterministic — needed for the favourite skip / player-switch tests, which
// require a routed route (imported KML tracks intentionally always reload).
async function mockRouting(page) {
  await page.route('**/route/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const coordPart = url.pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    await route.fulfill({
      json: { code: 'Ok', routes: [{ distance: 1000, duration: 1000, geometry: { type: 'LineString', coordinates: coords } }] },
    });
  });
}

async function addWaypointsAtFractions(page, points) {
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(i + 1);
  }
}

// Load the app and build a routed route from map clicks (no KML import), so the
// current route is a normal routed favourite candidate rather than an imported
// track. Weather is served so the load completes cleanly.
async function openRoutedRoute(page, fractions = [[0.4, 0.42], [0.6, 0.58]]) {
  const serve = (r) => r.fulfill({ json: weatherPayloadForUrl(r.request().url()) });
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, serve);
  await page.route(/archive-api\.open-meteo\.com\/v1\/archive/, serve);
  // Seed a zoomed-in map view so clicks land close together — at the default
  // world view they'd span thousands of km and generate a huge weather point
  // set that makes the route/weather load crawl.
  await page.addInitScript(() => {
    localStorage.setItem('mappingElf_mapView', JSON.stringify({ lat: 24.2133, lng: 121.3472, zoom: 14 }));
  });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await ensurePanelOpen(page);
  await addWaypointsAtFractions(page, fractions);
  await expect(page.locator('#btn-view-3d')).toBeEnabled({ timeout: 20_000 });
  // Let the route + its weather finish so the 3D button won't refuse to open.
  await page.locator('#route-weather-busy-overlay').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
}

test('3D terrain builds for the current route from the route-planning button', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page);

  await open3dForCurrentRoute(page);
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
});

test('3D terrain: loading lock + progress, then a visible contour model with track/waypoint info', async ({ page }) => {
  await mockElevation(page, { delayMs: 120 });
  await mockFeatures(page);
  await openWithRoute(page);

  await open3dForCurrentRoute(page);

  // Loading overlay shows and all controls lock while the terrain is computing.
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeVisible();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/tv-busy/);
  await expect(page.locator('#tv-loading-abort')).toBeVisible();
  await expect(page.locator('#tp-play')).toHaveCSS('pointer-events', 'none');

  // Progress bar advances.
  await expect.poll(async () => (
    page.locator('#tv-loading-fill').evaluate((el) => parseFloat(el.style.width) || 0)
  ), { timeout: 15_000 }).toBeGreaterThan(10);

  // Load completes: overlay hidden, controls unlocked, canvas present.
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/tv-busy/);
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // Info panel: route stats + waypoint list + contour interval.
  await expect(page.locator('#tv-route-stats .tv-stat-item').first()).toBeVisible();
  expect(await page.locator('#tv-wp-list li').count()).toBeGreaterThan(0);
  await expect(page.locator('#tv-route-stats [data-contour]')).toHaveCount(1);

  // The terrain actually renders (guards against the camera-framing/black-screen bug).
  await page.waitForTimeout(800);
  const nonBg = await page.evaluate(() => {
    const cv = document.querySelector('#terrain-canvas-wrap canvas');
    const c2 = document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height;
    const ctx = c2.getContext('2d');
    ctx.drawImage(cv, 0, 0);
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (Math.abs(data[i] - 26) > 14 || Math.abs(data[i + 1] - 26) > 14 || Math.abs(data[i + 2] - 46) > 14) count++;
    }
    return count;
  });
  expect(nonBg).toBeGreaterThan(0);
});

test('3D terrain: 圖資 background download continues the SAME progress bar (non-blocking pill), not a separate widget', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page, { delayMs: 800 }); // slow enough to observe the bg phase
  await openWithRoute(page);

  await open3dForCurrentRoute(page);

  // Blocking phase: elevation + mesh build, full-screen card, controls locked.
  await expect(page.locator('#tv-loading')).toBeVisible();
  await expect(page.locator('#tv-loading')).not.toHaveClass(/tv-loading-bg/);
  await expect(page.locator('#terrain-viewer')).toHaveClass(/tv-busy/);

  // Once the mesh is built the SAME element switches into non-blocking "bg" pill
  // mode instead of hiding — the model is already visible/interactive underneath
  // while 圖資 keeps downloading, and the readout keeps counting up (not reset).
  await expect(page.locator('#tv-loading')).toHaveClass(/tv-loading-bg/, { timeout: 20_000 });
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/tv-busy/);
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  await expect(page.locator('#tp-play')).not.toHaveCSS('pointer-events', 'none');
  const pctDuringBg = await page.locator('#tv-loading-fill').evaluate((el) => parseFloat(el.style.width) || 0);
  expect(pctDuringBg).toBeGreaterThanOrEqual(85);

  // 圖資 finishes: the whole indicator goes away (no leftover corner pill).
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#tv-loading')).not.toHaveClass(/tv-loading-bg/);
});

test('3D terrain: contour toggle cycles high → low → none', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page);
  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });

  const contourBtn = page.locator('#tv-toggle-contour');
  const label = page.locator('#tv-contour-label');
  await expect(label).toHaveText('等高線·高');
  await expect(contourBtn).toHaveClass(/active/);

  await contourBtn.click();
  await expect(label).toHaveText('等高線·低');

  await contourBtn.click();
  await expect(label).toHaveText('等高線·無');
  await expect(contourBtn).toHaveClass(/tv-contour-off/);
  await expect(page.locator('#tv-toggle-contour-labels')).toBeDisabled();

  await contourBtn.click();
  await expect(label).toHaveText('等高線·高');
  await expect(page.locator('#tv-toggle-contour-labels')).toBeEnabled();
});

test('3D terrain: clicking a waypoint opens its detail popup; panels collapse and re-expand', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page);
  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });

  // Waypoint list row opens the marker detail popup.
  await page.locator('#tv-wp-list .tv-wp-clickable').first().click();
  await expect(page.locator('#tv-marker-detail')).not.toHaveClass(/hidden/);
  await expect(page.locator('.tv-marker-detail-title')).toBeVisible();
  await page.locator('#tv-marker-detail-close').click();
  await expect(page.locator('#tv-marker-detail')).toHaveClass(/hidden/);

  // Route-info panel collapses down to just its leading icon (title + chevron
  // hidden, panel shrinks to auto width) — and can still be re-expanded (the
  // header/icon stays visible when collapsed).
  const infoPanelBox = await page.locator('#tv-info-panel').boundingBox();
  await page.locator('#tv-info-collapse').click();
  await expect(page.locator('#tv-info-panel')).toHaveClass(/collapsed/);
  await expect(page.locator('#tv-info-body')).toBeHidden();
  await expect(page.locator('#tv-info-collapse')).toBeVisible();
  await expect(page.locator('#tv-info-panel .tv-panel-icon')).toBeVisible();
  await expect(page.locator('#tv-info-panel .tv-panel-header-title')).toBeHidden();
  const collapsedInfoBox = await page.locator('#tv-info-panel').boundingBox();
  expect(collapsedInfoBox.width).toBeLessThan(infoPanelBox.width * 0.5);
  await page.locator('#tv-info-collapse').click();
  await expect(page.locator('#tv-info-panel')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#tv-info-body')).toBeVisible();
  await expect(page.locator('#tv-info-panel .tv-panel-header-title')).toBeVisible();

  // Person/metrics HUD collapses to an icon and re-expands too.
  const hudBox = await page.locator('#tv-live-hud').boundingBox();
  await page.locator('#tv-hud-collapse').click();
  await expect(page.locator('#tv-live-hud')).toHaveClass(/collapsed/);
  await expect(page.locator('#tv-hud-body')).toBeHidden();
  await expect(page.locator('#tv-live-hud .tv-panel-icon')).toBeVisible();
  await expect(page.locator('#tv-live-hud .tv-panel-header-title')).toBeHidden();
  const collapsedHudBox = await page.locator('#tv-live-hud').boundingBox();
  expect(collapsedHudBox.width).toBeLessThan(hudBox.width * 0.5);
  await page.locator('#tv-hud-collapse').click();
  await expect(page.locator('#tv-live-hud')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#tv-hud-body')).toBeVisible();
  await expect(page.locator('#tv-live-hud .tv-panel-header-title')).toBeVisible();
});

test('3D terrain: the route caches its elevation grid + 圖資 so reopening skips both downloads', async ({ page }) => {
  const elevation = await mockElevation(page, { delayMs: 30 });
  const features = await mockFeatures(page);
  await openWithRoute(page);

  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  expect(elevation.count).toBeGreaterThan(0);
  expect(features.count).toBeGreaterThan(0);
  const firstRunElevation = elevation.count;
  const firstRunFeatures = features.count;

  await page.locator('#tv-close-btn').click();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/hidden/);
  // saveTerrainFeaturesEntry's Cache-API write is fire-and-forget (not awaited
  // by the caller) — give it a beat to flush before reopening.
  await page.waitForTimeout(200);

  // Reopen the same route: cached grid + 圖資 (Cache-API-backed, see
  // saveTerrainFeaturesEntry) are both reused — no new elevation or Overpass
  // requests, and the page never re-hits the network for either.
  await page.locator('#btn-view-3d').click();
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  expect(elevation.count).toBe(firstRunElevation);
  expect(features.count).toBe(firstRunFeatures);
});

test('3D terrain: the 更新 redraw genuinely re-downloads and re-runs the build', async ({ page }) => {
  const elevation = await mockElevation(page, { delayMs: 30 });
  const features = await mockFeatures(page);
  await openWithRoute(page, { weather: true });

  // The 3D build and the 更新 redraw are both gated on weather finishing loading,
  // so wait for its busy overlay to settle before each.
  await expect(page.locator('#route-weather-busy-overlay')).toBeHidden({ timeout: 20_000 });

  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  const firstRunRequests = elevation.count;
  const firstRunFeatures = features.count;
  expect(firstRunRequests).toBeGreaterThan(0);
  expect(firstRunFeatures).toBeGreaterThan(0);
  await expect(page.locator('#route-weather-busy-overlay')).toBeHidden({ timeout: 20_000 });

  // Unlike reopening (which reuses the cache), 更新 forces a fresh build: it
  // re-downloads the elevation grid + 圖資 and re-runs the progress bar from the
  // start rather than replaying the cached scene from ~90%.
  await page.locator('#tv-redraw-btn').click();
  await expect(page.locator('#tv-loading')).toBeVisible();
  // Progress restarts low instead of jumping straight to the tail end.
  await expect.poll(async () => (
    page.locator('#tv-loading-fill').evaluate((el) => parseFloat(el.style.width) || 0)
  ), { timeout: 15_000 }).toBeLessThan(85);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  expect(elevation.count).toBeGreaterThan(firstRunRequests);
  expect(features.count).toBeGreaterThan(firstRunFeatures);
});

test('3D terrain: 天氣 button cycles 開→關閉動畫→關閉提示→開 and drives hints/animation independently', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page, { weather: true });
  // The per-waypoint weather load must actually finish (visible -> hidden, plus
  // a settle buffer) before opening the 3D view, or weatherPointsData comes back
  // empty and hasWeatherData() stays false (see weather-3d-fx.spec.js's same
  // wait pattern) — a plain "currently hidden" check can pass before the load
  // ever starts.
  const wxBusy = page.locator('#route-weather-busy-overlay');
  await wxBusy.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await wxBusy.waitFor({ state: 'hidden', timeout: 60_000 });
  await page.waitForTimeout(1200);

  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  const weatherBtn = page.locator('#tv-toggle-weather');
  const label = page.locator('#tv-weather-label');
  await expect(weatherBtn).toBeEnabled();

  // State 1: on — hints + animation, fully active.
  await expect(label).toHaveText('天氣·開');
  await expect(weatherBtn).toHaveClass(/active/);
  await expect(weatherBtn).not.toHaveClass(/tv-weather-off/);

  // State 2: noAnim — hints stay visible (still "active"), animation drops.
  await weatherBtn.click();
  await expect(label).toHaveText('天氣·靜態');
  await expect(weatherBtn).toHaveClass(/active/);
  await expect(weatherBtn).not.toHaveClass(/tv-weather-off/);

  // State 3: off — hints hidden too, muted like the contour "none" state.
  await weatherBtn.click();
  await expect(label).toHaveText('天氣·關');
  await expect(weatherBtn).not.toHaveClass(/active/);
  await expect(weatherBtn).toHaveClass(/tv-weather-off/);

  // Cycles back to the start.
  await weatherBtn.click();
  await expect(label).toHaveText('天氣·開');
  await expect(weatherBtn).toHaveClass(/active/);
});

test('3D terrain: 地標裝飾 (效果) button is gated on landmarks, independent of weather', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  // No landmark nodes in the mocked 圖資 — the button should be disabled.
  await mockFeatures(page);
  await openWithRoute(page, { weather: true });
  // See the previous test: wait for the per-waypoint weather load to actually
  // finish so 天氣 is enabled and can be toggled off below.
  const wxBusy = page.locator('#route-weather-busy-overlay');
  await wxBusy.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await wxBusy.waitFor({ state: 'hidden', timeout: 60_000 });
  await page.waitForTimeout(1200);

  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  const effectsBtn = page.locator('#tv-toggle-effects');
  await expect(effectsBtn).toBeDisabled();

  // Turning weather all the way off must not affect the (still-disabled) 地標 button.
  const weatherBtn = page.locator('#tv-toggle-weather');
  await weatherBtn.click();
  await weatherBtn.click();
  await expect(page.locator('#tv-weather-label')).toHaveText('天氣·關');
  await expect(effectsBtn).toBeDisabled();
});

test('3D terrain: 地標裝飾 (效果) button toggles landmark visibility once the route has landmarks', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page, {
    elements: [{ type: 'node', id: 1, lat: 24.2133, lon: 121.3472, tags: { natural: 'peak', name: 'Test Peak' } }],
  });
  await openWithRoute(page);

  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  const effectsBtn = page.locator('#tv-toggle-effects');
  await expect(effectsBtn).toBeEnabled();
  await expect(effectsBtn).toHaveClass(/active/);
  await effectsBtn.click();
  await expect(effectsBtn).not.toHaveClass(/active/);
  await effectsBtn.click();
  await expect(effectsBtn).toHaveClass(/active/);

  // 天氣 stays untouched by 地標 clicks — the two are fully independent now.
  await expect(page.locator('#tv-toggle-weather')).toHaveClass(/active/);
  await expect(page.locator('#tv-weather-label')).toHaveText('天氣·開');
});

test('3D terrain: a favourite still builds via its per-favourite 3D button', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page);
  await ensurePanelOpen(page);

  await page.locator('#btn-favorite-add').click();
  const terrainBtn = page.locator('[data-favorite-terrain]').first();
  await expect(terrainBtn).toBeVisible();
  await terrainBtn.click();

  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
});

test('3D terrain: reopens itself after a page reload (browser/app resume restore)', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page, { weather: true });

  await open3dForCurrentRoute(page);
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // Simulate the OS discarding a backgrounded webview and the user returning:
  // the app reloads, and the 3D page should come back on its own rather than
  // dropping to the 2D planning home.
  await page.reload();
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/, { timeout: 30_000 });
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // Closing the viewer clears the restore marker so a later reload stays on home.
  await page.locator('#tv-close-btn').click();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/hidden/);
  await page.reload();
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.waitForTimeout(2000);
  await expect(page.locator('#terrain-viewer')).toHaveClass(/hidden/);
});

test('3D terrain: re-selecting the already-loaded favourite does not re-plan the route', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await mockRouting(page);
  await openRoutedRoute(page);

  // Save the routed route as a favourite; loading it back changes nothing.
  await page.locator('#btn-favorite-add').click();
  const loadBtn = page.locator('[data-favorite-load]').first();
  await expect(loadBtn).toBeVisible();

  // Let any in-flight route/weather work settle so the busy overlay is idle.
  const busy = page.locator('#route-weather-busy-overlay');
  await busy.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  await loadBtn.click();
  // The skip path reports the route is already current and must NOT raise the
  // route-planning busy overlay (which a real re-plan would).
  await expect(page.locator('#notifications')).toContainText('已是目前路線', { timeout: 5_000 });
  await expect(page.locator('#route-weather-busy-overlay')).toBeHidden();
});

test('3D terrain: switching routes in the player keeps a working model + hidden progress bar', async ({ page }) => {
  await mockElevation(page, { delayMs: 60 });
  await mockFeatures(page);
  await mockRouting(page);
  await openRoutedRoute(page);

  // Save the current route as a favourite so the player playlist has an entry.
  await page.locator('#btn-favorite-add').click();

  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // Open the playlist and switch to the saved favourite.
  await page.locator('#tp-playlist-btn').click();
  await expect(page.locator('#tp-playlist-menu')).not.toHaveClass(/hidden/);
  await page.locator('[data-playlist-fav]').first().click();

  // The viewer stays open and ends with a working model + hidden progress bar.
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  // The playlist now marks the favourite as the active source.
  await page.locator('#tp-playlist-btn').click();
  await expect(page.locator('[data-playlist-fav].active')).toHaveCount(1);
});

test('3D terrain: scrubbing playback drives the live position readout', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page);
  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // Day/night is permanently on now (its toggle was removed); use the default-on
  // 等高線 toggle as the "toolbar rendered" readiness proxy instead.
  await expect(page.locator('#tv-toggle-contour')).toHaveClass(/active/);

  const slider = page.locator('#tp-slider');
  await slider.evaluate((el) => {
    el.value = '0.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const dist = page.locator('#tv-hud-dist');
  const elev = page.locator('#tv-hud-elev');
  await expect.poll(async () => (await dist.textContent())?.trim()).not.toBe('—');
  await expect.poll(async () => (await elev.textContent())?.trim()).not.toBe('—');

  const distAtHalf = await dist.textContent();
  await slider.evaluate((el) => {
    el.value = '0.9';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => (await dist.textContent())).not.toBe(distAtHalf);
});

test('3D terrain: abort button cancels computation and closes the viewer', async ({ page }) => {
  await mockElevation(page, { delayMs: 1500 }); // slow so loading stays active
  await mockFeatures(page);
  await openWithRoute(page);
  await open3dForCurrentRoute(page);

  await expect(page.locator('#tv-loading')).toBeVisible();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/tv-busy/);

  await page.locator('#tv-loading-abort').click();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/hidden/, { timeout: 20_000 });
});

test('3D terrain: removed toggles are gone and 集水區 toggle drives the basin overlay', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await mockElevation(page, { delayMs: 30 });
  await mockFeatures(page);
  await openWithRoute(page);
  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  // The 日夜 / 懸空 / 揭示 toggles were removed (day/night is permanently on).
  await expect(page.locator('#tv-toggle-daynight')).toHaveCount(0);
  await expect(page.locator('#tv-toggle-absolute')).toHaveCount(0);
  await expect(page.locator('#tv-toggle-trail')).toHaveCount(0);

  // The 集水區 toggle is present, enabled (route has 主航點) and starts off.
  const catchmentBtn = page.locator('#tv-toggle-catchment');
  await expect(catchmentBtn).toBeEnabled();
  await expect(catchmentBtn).not.toHaveClass(/active/);

  // Turning it on runs the (cache-first / offline-DEM) compute and persists.
  await catchmentBtn.click();
  await expect(catchmentBtn).toHaveClass(/active/);
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_terrain3dDisplay') || '{}').catchment3d))
    .toBe(true);
  // The delineation eventually settles (its busy overlay clears).
  await expect(page.locator('#route-weather-busy-overlay')).toBeHidden({ timeout: 30_000 });

  // Turning it off hides the overlay and clears the persisted flag.
  await catchmentBtn.click();
  await expect(catchmentBtn).not.toHaveClass(/active/);
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_terrain3dDisplay') || '{}').catchment3d))
    .toBe(false);

  expect(errors).toEqual([]);
});
