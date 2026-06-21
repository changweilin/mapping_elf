import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');

// Mock the Open-Meteo elevation API so the 3D terrain build is deterministic and
// offline. Generates a hilly surface in the route's real elevation band so the
// terrain grid lines up with the imported KML track.
async function mockElevation(page, { delayMs = 30 } = {}) {
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, async (route) => {
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
}

async function openWithRoute(page) {
  // Suppress background weather fetch so it doesn't interfere with the viewer.
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('#gpx-file-input').setInputFiles(sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#btn-open-3d-viewer')).toHaveClass(/has-route/);
}

test('3D terrain: loading lock + progress, then a visible contour model with track/waypoint info', async ({ page }) => {
  await mockElevation(page, { delayMs: 120 });
  await openWithRoute(page);

  await page.locator('#btn-open-3d-viewer').click();

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

  // Layer toggle works.
  const contourBtn = page.locator('#tv-toggle-contour');
  await expect(contourBtn).toHaveClass(/active/);
  await contourBtn.click();
  await expect(contourBtn).not.toHaveClass(/active/);
});

test('3D terrain: abort button cancels computation and closes the viewer', async ({ page }) => {
  await mockElevation(page, { delayMs: 1500 }); // slow so loading stays active
  await openWithRoute(page);

  await page.locator('#btn-open-3d-viewer').click();
  await expect(page.locator('#tv-loading')).toBeVisible();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/tv-busy/);

  await page.locator('#tv-loading-abort').click();
  await expect(page.locator('#terrain-viewer')).toHaveClass(/hidden/, { timeout: 20_000 });
});
