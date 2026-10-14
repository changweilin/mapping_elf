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

test('drawing board anchors at most recently placed map cursor or waypoint', async ({ page }) => {
  await openApp(page);

  // 1. Place a map cursor far from default geolocation (25.034, 121.564)
  await page.evaluate(() => {
    window.__mappingElfTestHooks.mapManager.setMapCursor(24.800, 120.900);
  });

  const panel = page.locator('#shape-panel');
  await page.locator('#btn-shape-tool').click();
  await expect(panel).toBeVisible();

  await drawSquare(page);
  await page.locator('#shape-distance-input').fill('2');
  await page.locator('#shape-angle-select').selectOption('0');
  await page.locator('#btn-shape-generate').click();

  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  // Check the first waypoint is anchored near 24.800, 120.900 (not default GPS 25.034, 121.564)
  const firstWp = await page.evaluate(() => window.__mappingElfTestHooks.mapManager.waypoints[0]);
  expect(Math.abs(firstWp[0] - 24.800)).toBeLessThan(0.03);
  expect(Math.abs(firstWp[1] - 120.900)).toBeLessThan(0.03);
  expect(Math.abs(firstWp[0] - 25.034)).toBeGreaterThan(0.1);
});

test('drawing board supports undo/redo, pen/eraser mode, and clear/generate icon buttons', async ({ page }) => {
  await openApp(page);
  await page.locator('#btn-shape-tool').click();
  const panel = page.locator('#shape-panel');
  await expect(panel).toBeVisible();

  const undoBtn = page.locator('#btn-shape-undo');
  const redoBtn = page.locator('#btn-shape-redo');
  const modeBtn = page.locator('#btn-shape-mode-toggle');
  const clearBtn = page.locator('#btn-shape-clear');
  const genBtn = page.locator('#btn-shape-generate');

  // Verify initial states
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();
  await expect(modeBtn).toHaveAttribute('data-shape-mode', 'pen');
  await expect(clearBtn).toBeVisible();
  await expect(genBtn).toBeVisible();

  // Draw stroke 1
  await drawSquare(page);
  await expect(undoBtn).toBeEnabled();
  await expect(redoBtn).toBeDisabled();

  // Undo stroke 1
  await undoBtn.click();
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeEnabled();

  // Redo stroke 1
  await redoBtn.click();
  await expect(undoBtn).toBeEnabled();
  await expect(redoBtn).toBeDisabled();

  // Switch to eraser mode
  await modeBtn.click();
  await expect(modeBtn).toHaveAttribute('data-shape-mode', 'eraser');

  // Switch back to pen mode
  await modeBtn.click();
  await expect(modeBtn).toHaveAttribute('data-shape-mode', 'pen');

  // Clear with icon button
  await clearBtn.click();
  await expect(undoBtn).toBeEnabled(); // clearing is also undoable
});

test('drawing board provides 12 preset shapes (愛心, 星星, 月亮, 太陽, 鑽石, 梅花, 貓, 狗, 鳥, 魚, 馬, 蝴蝶) and hand-drawn pony icon', async ({ page }) => {
  await openApp(page);

  // Icon of drawing board button is a hand-drawn pony
  const toolBtn = page.locator('#btn-shape-tool');
  await expect(toolBtn).toBeVisible();
  const svg = toolBtn.locator('svg');
  await expect(svg).toBeVisible();

  // Open drawing board
  await toolBtn.click();
  const panel = page.locator('#shape-panel');
  await expect(panel).toBeVisible();

  const presetSelect = page.locator('#shape-preset-select');
  await expect(presetSelect).toBeVisible();

  const presetChips = page.locator('#shape-preset-chips .shape-preset-chip');
  await expect(presetChips).toHaveCount(12);

  const expectedPresets = [
    'heart', 'star', 'moon', 'sun', 'diamond', 'club',
    'cat', 'dog', 'bird', 'fish', 'horse', 'butterfly'
  ];

  // Verify all 12 options exist in select
  for (const presetId of expectedPresets) {
    await expect(presetSelect.locator(`option[value="${presetId}"]`)).toHaveCount(1);
  }

  // Select 'heart' preset via select
  await presetSelect.selectOption('heart');
  await expect(presetSelect).toHaveValue('heart');
  await expect(page.locator('#shape-preset-chips .shape-preset-chip[data-preset="heart"]')).toHaveClass(/active/);

  // Generate route directly from preset shape without manual drawing
  await page.locator('#shape-distance-input').fill('4');
  await page.locator('#btn-shape-generate').click();

  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  // Select 'horse' preset via chip
  const horseChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="horse"]');
  await horseChip.click();
  await expect(presetSelect).toHaveValue('horse');
  await expect(horseChip).toHaveClass(/active/);

  // Clear resets preset UI
  await page.locator('#btn-shape-clear').click();
  await expect(presetSelect).toHaveValue('');
  await expect(horseChip).not.toHaveClass(/active/);
});

test('drawing board anchors at most recently set waypoint, clears remaining original waypoints, and draws route', async ({ page }) => {
  await openApp(page);

  // 1. Add 3 waypoints on the map: WP0, WP1, WP2
  await page.evaluate(() => {
    const mm = window.__mappingElfTestHooks.mapManager;
    mm.addWaypoint(25.010, 121.510);
    mm.addWaypoint(25.020, 121.520);
    mm.addWaypoint(25.030, 121.530);
  });

  const waypointsBefore = await page.evaluate(() => window.__mappingElfTestHooks.mapManager.waypoints.length);
  expect(waypointsBefore).toBe(3);

  // 2. Open drawing board and select a preset (e.g. heart)
  const panel = page.locator('#shape-panel');
  await page.locator('#btn-shape-tool').click();
  await expect(panel).toBeVisible();

  const presetSelect = page.locator('#shape-preset-select');
  await presetSelect.selectOption('heart');
  await page.locator('#shape-distance-input').fill('2');
  await page.locator('#btn-shape-generate').click();

  // 3. Verify route generated
  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  // 4. Check the starting waypoint is anchored at the most recently set waypoint (25.030, 121.530)
  const waypointsAfter = await page.evaluate(() => window.__mappingElfTestHooks.mapManager.waypoints);
  expect(waypointsAfter[0][0]).toBeCloseTo(25.030, 4);
  expect(waypointsAfter[0][1]).toBeCloseTo(121.530, 4);

  // 5. Check the remaining original waypoints (25.010, 121.510) and (25.020, 121.520) were cleared
  const hasOldWP0 = waypointsAfter.slice(1).some(([lat, lng]) => Math.abs(lat - 25.010) < 1e-4 && Math.abs(lng - 121.510) < 1e-4);
  const hasOldWP1 = waypointsAfter.slice(1).some(([lat, lng]) => Math.abs(lat - 25.020) < 1e-4 && Math.abs(lng - 121.520) < 1e-4);
  expect(hasOldWP0).toBe(false);
  expect(hasOldWP1).toBe(false);
});




