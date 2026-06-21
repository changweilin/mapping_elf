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

// Load the app and import the sample KML so a route + waypoints exist. The 3D
// button (in the route-planning section) becomes enabled once a route is drawn.
async function openWithRoute(page) {
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('#gpx-file-input').setInputFiles(sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#btn-open-3d-viewer')).toBeEnabled();
}

async function ensurePanelOpen(page) {
  const open = await page.locator('#side-panel').evaluate((el) => el.classList.contains('open'));
  if (!open) await page.locator('#btn-toggle-panel').click();
  await expect(page.locator('#side-panel')).toHaveClass(/open/);
}

// Build the current route's 3D terrain via the route-planning button.
async function open3dForCurrentRoute(page) {
  await ensurePanelOpen(page);
  await page.locator('#btn-open-3d-viewer').click();
}

test('3D terrain builds for the current route from the route-planning button', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await openWithRoute(page);

  await open3dForCurrentRoute(page);
  await expect(page.locator('#terrain-viewer')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
});

test('3D terrain: loading lock + progress, then a visible contour model with track/waypoint info', async ({ page }) => {
  await mockElevation(page, { delayMs: 120 });
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

test('3D terrain: contour toggle cycles high → low → none', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
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
  await openWithRoute(page);
  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });

  // Waypoint list row opens the marker detail popup.
  await page.locator('#tv-wp-list .tv-wp-clickable').first().click();
  await expect(page.locator('#tv-marker-detail')).not.toHaveClass(/hidden/);
  await expect(page.locator('.tv-marker-detail-title')).toBeVisible();
  await page.locator('#tv-marker-detail-close').click();
  await expect(page.locator('#tv-marker-detail')).toHaveClass(/hidden/);

  // Route-info panel collapses and — crucially — can be re-expanded (the header
  // stays visible when collapsed).
  await page.locator('#tv-info-collapse').click();
  await expect(page.locator('#tv-info-panel')).toHaveClass(/collapsed/);
  await expect(page.locator('#tv-info-body')).toBeHidden();
  await expect(page.locator('#tv-info-collapse')).toBeVisible();
  await page.locator('#tv-info-collapse').click();
  await expect(page.locator('#tv-info-panel')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#tv-info-body')).toBeVisible();

  // Person/metrics HUD collapses and re-expands too.
  await page.locator('#tv-hud-collapse').click();
  await expect(page.locator('#tv-live-hud')).toHaveClass(/collapsed/);
  await expect(page.locator('#tv-hud-body')).toBeHidden();
  await page.locator('#tv-hud-collapse').click();
  await expect(page.locator('#tv-live-hud')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#tv-hud-body')).toBeVisible();
});

test('3D terrain: the route caches its elevation grid so reopening skips the download', async ({ page }) => {
  const elevation = await mockElevation(page, { delayMs: 30 });
  await openWithRoute(page);

  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  expect(elevation.count).toBeGreaterThan(0);
  const firstRunRequests = elevation.count;

  await page.locator('#tv-close-btn').click();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/hidden/);

  // Reopen the same route: cached grid is reused, no new elevation requests.
  await page.locator('#btn-open-3d-viewer').click();
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);
  expect(elevation.count).toBe(firstRunRequests);
});

test('3D terrain: a favourite still builds via its per-favourite 3D button', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
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

test('3D terrain: scrubbing playback drives the live position readout', async ({ page }) => {
  await mockElevation(page, { delayMs: 30 });
  await openWithRoute(page);
  await open3dForCurrentRoute(page);
  await expect(page.locator('#tv-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#terrain-canvas-wrap canvas')).toHaveCount(1);

  await expect(page.locator('#tv-toggle-daynight')).toHaveClass(/active/);

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
  await openWithRoute(page);
  await open3dForCurrentRoute(page);

  await expect(page.locator('#tv-loading')).toBeVisible();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/tv-busy/);

  await page.locator('#tv-loading-abort').click();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/hidden/, { timeout: 20_000 });
});
