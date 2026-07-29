import { expect, test } from '@playwright/test';
import { shapeStroke } from './helpers/testShapes.mjs';

// LIVE informational check against the real routing endpoints (not part of the
// CI gates — free APIs flake). Draws a heart near Taipei and logs the fidelity
// numbers the pipeline reports. Run manually:
//   node test/run-playwright-with-preview.mjs test/shape-route-live.spec.js

test.use({
  geolocation: { latitude: 25.034, longitude: 121.564 },
  permissions: ['geolocation'],
});

test('live: heart stroke end-to-end against real routing APIs', async ({ page }) => {
  test.skip(process.env.LIVE_SHAPE !== '1', 'live-network check — run with LIVE_SHAPE=1');
  test.setTimeout(300_000);
  // Keep the noisy side calls quiet; routing + nearest stay real.
  await page.route('**://api.open-meteo.com/v1/forecast**', (route) => route.abort());
  await page.route('**://nominatim.openstreetmap.org/**', (route) => route.fulfill({ json: [] }));

  await page.addInitScript(() => { window.__mappingElfTestHooks = { events: [] }; });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  await page.locator('#btn-shape-tool').click();
  await expect(page.locator('#shape-panel')).toBeVisible();

  const box = await page.locator('#shape-canvas').boundingBox();
  const scale = Math.min(box.width, box.height) / 300;
  const pts = shapeStroke('heart').filter((_, i) => i % 2 === 0);
  await page.mouse.move(box.x + pts[0][0] * scale, box.y + pts[0][1] * scale);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    await page.mouse.move(box.x + pts[i][0] * scale, box.y + pts[i][1] * scale);
  }
  await page.mouse.up();

  await page.locator('#shape-distance-input').fill('5');
  await page.locator('#shape-angle-select').selectOption('0');
  await page.locator('#btn-shape-generate').click();

  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).some((e) => e.type === 'shape-route-finished')
  ), { timeout: 240_000, intervals: [2000] }).toBe(true);

  const detail = await page.evaluate(() =>
    (window.__mappingElfTestHooks.events).find((e) => e.type === 'shape-route-finished').detail);
  console.log('LIVE heart result:', JSON.stringify(detail));
  // Only structural asserts — network quality varies.
  expect(detail.waypointCount).toBeGreaterThanOrEqual(3);
  expect(detail.actualM).toBeGreaterThan(0);
});
