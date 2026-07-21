// UI-restructure regressions: the unified floating 2D/3D pill (same viewport
// spot in both views), the Hikingbook-style route summary strip above the
// elevation chart, and the Relive-style follow camera (default on, persisted).
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');

async function mockElevation(page) {
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}

async function mockFeatures(page) {
  await page.route(/\/interpreter\?/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] }) }));
}

test('unified pill, summary strip, follow cam', async ({ page }) => {
  test.setTimeout(180000);
  await mockElevation(page);
  await mockFeatures(page);
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => r.abort());

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  // --- 2D pill: fixed, visible, 3D disabled with explainer title ---
  const pill2d = page.locator('#view-mode-toggle');
  await expect(pill2d).toBeVisible();
  const pos2d = await pill2d.boundingBox();
  expect(await pill2d.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  await expect(page.locator('#btn-view-3d')).toBeDisabled();
  expect(await page.locator('#btn-view-3d').getAttribute('title')).toMatch(/規劃路線|Plan a route/);

  // --- Summary strip shows placeholders without a route ---
  await expect(page.locator('#route-summary-bar')).toBeVisible();
  await expect(page.locator('#rsb-distance')).toHaveText('—');
  await expect(page.locator('#rsb-time-chip')).toBeHidden();

  // --- Import route → strip appears with real numbers, 3D enables ---
  await page.locator('#gpx-file-input').setInputFiles(sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#btn-view-3d')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#route-summary-bar')).toBeVisible();
  await expect(page.locator('#rsb-distance')).not.toHaveText('—');
  await expect(page.locator('#rsb-ascent')).not.toHaveText('—');

  // --- Open 3D via the pill; loading appears then clears ---
  await page.locator('#btn-view-3d').click();
  await page.locator('#tv-loading:not(.hidden)').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('#tv-loading.hidden').waitFor({ state: 'attached', timeout: 120000 });

  // --- 3D pill sits at the same viewport spot ---
  const pillTv = page.locator('.tv-view-mode-toggle');
  await expect(pillTv).toBeVisible();
  const posTv = await pillTv.boundingBox();
  expect(Math.abs(posTv.x - pos2d.x)).toBeLessThan(3);
  expect(Math.abs(posTv.y - pos2d.y)).toBeLessThan(3);

  // --- Follow cam defaults on; playback advances and the chase cam engages ---
  await expect(page.locator('#tp-follow')).toHaveClass(/active/);
  await page.locator('#tp-play').click();
  await expect.poll(async () => page.locator('#tp-progress-label').textContent()).not.toBe('0%');

  // --- Toggle follow off → persisted ---
  await page.locator('#tp-follow').click();
  await expect(page.locator('#tp-follow')).not.toHaveClass(/active/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_terrain3dDisplay') || '{}'));
  expect(saved.followCam).toBe(false);

  // --- Back to 2D via the pill ---
  await page.locator('#tv-view-2d').click();
  await expect(page.locator('#terrain-viewer')).toBeHidden();
  await expect(page.locator('#view-mode-toggle')).toBeVisible();
});
