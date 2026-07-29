import { expect, test } from '@playwright/test';

// Drawing board (繪圖板): sketch a shape → O繞 running loop near the current
// location. Routing APIs are unreachable in CI, so the route falls back to
// straight legs — the spec asserts the waypoint/mode wiring, not road snapping.

test.use({
  geolocation: { latitude: 25.034, longitude: 121.564 },
  permissions: ['geolocation'],
});

async function openApp(page) {
  await page.addInitScript(() => { window.__mappingElfTestHooks = { events: [] }; });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
}

async function drawSquare(page) {
  const canvas = page.locator('#shape-canvas');
  const box = await canvas.boundingBox();
  const pad = 30;
  const x0 = box.x + pad, y0 = box.y + pad;
  const x1 = box.x + box.width - pad, y1 = box.y + box.height - pad;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y0, { steps: 12 });
  await page.mouse.move(x1, y1, { steps: 12 });
  await page.mouse.move(x0, y1, { steps: 12 });
  await page.mouse.move(x0, y0 + 8, { steps: 12 });
  await page.mouse.up();
}

test('drawing board opens, generates an O繞 waypoint loop and closes', async ({ page }) => {
  await openApp(page);

  const panel = page.locator('#shape-panel');
  await expect(panel).toBeHidden();
  await page.locator('#btn-shape-tool').click();
  await expect(panel).toBeVisible();
  await expect(page.locator('#btn-shape-tool')).toHaveAttribute('aria-pressed', 'true');

  // Generate without a stroke → warning only, no waypoints.
  await page.locator('#btn-shape-generate').click();
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(0);

  await drawSquare(page);
  // A second stroke (筆畫) appends to the shape instead of replacing it.
  const box = await page.locator('#shape-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + 20, { steps: 6 });
  await page.mouse.up();

  await page.locator('#shape-distance-input').fill('3');
  await page.locator('#shape-angle-select').selectOption('30');
  await page.locator('#btn-shape-generate').click();

  // The generation event fires with the produced waypoint count.
  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  // Nav mode switched to O繞, waypoints landed in the side panel list.
  // Poll: a distance-calibration round briefly clears + re-adds the list.
  await expect(page.locator('#nav-mode-oloop')).toBeChecked();
  await expect.poll(async () => page.locator('#waypoint-list .waypoint-item').count())
    .toBeGreaterThanOrEqual(3);

  // Readout shows the plan summary; the target-shape preview is on the map.
  await expect(page.locator('#shape-readout .mr-row').first()).toBeVisible();

  // Distance and angle-tolerance choices persist.
  const savedKm = await page.evaluate(() => localStorage.getItem('mappingElf_shapeRouteDistanceKm'));
  expect(Number(savedKm)).toBe(3);
  const savedTol = await page.evaluate(() => localStorage.getItem('mappingElf_shapeRouteAngleTolDeg'));
  expect(Number(savedTol)).toBe(30);

  // 清除 empties the board; closing hides the panel and resets the button.
  await page.locator('#btn-shape-clear').click();
  await expect(page.locator('#shape-readout .mr-row')).toHaveCount(0);
  await page.locator('#btn-shape-close').click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#btn-shape-tool')).toHaveAttribute('aria-pressed', 'false');
});

test('measure tool and drawing board never overlap', async ({ page }) => {
  await openApp(page);
  await page.locator('#btn-shape-tool').click();
  await expect(page.locator('#shape-panel')).toBeVisible();
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();
  await expect(page.locator('#shape-panel')).toBeHidden();
  await page.locator('#btn-shape-tool').click();
  await expect(page.locator('#shape-panel')).toBeVisible();
  await expect(page.locator('#measure-panel')).toBeHidden();
});
