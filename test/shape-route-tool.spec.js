import { expect, test } from '@playwright/test';
import { RoadNetworkGraph } from '../src/modules/gpsArtOptimizer.js';

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
  await canvas.scrollIntoViewIfNeeded();
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

  await page.locator('#shape-panel').evaluate((el) => { el.scrollTop = 0; });
  await drawSquare(page);
  // A second stroke (筆畫) appends to the shape instead of replacing it.
  const canvas = page.locator('#shape-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
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

  // Swapped to Export GPX button, and route planning waypoints are not populated/cleared
  await expect(page.locator('#btn-shape-generate')).toHaveClass(/hidden/);
  await expect(page.locator('#btn-shape-export-gpx')).toBeVisible();
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(0);

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
  const firstWp = await page.evaluate(() =>
    window.__mappingElfTestHooks.lastShapeOptimizationResult?.keyWaypoints?.[0] ||
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.firstWaypoint
  );
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

  // Verify redundant preset select is removed
  await expect(page.locator('#shape-preset-select')).toHaveCount(0);

  // Verify travel mode options exist
  const modeSelect = page.locator('#shape-mode-select');
  await expect(modeSelect).toBeVisible();
  await expect(modeSelect.locator('option[value="foot"]')).toHaveText(/跑步|Running/);
  await expect(modeSelect.locator('option[value="bike"]')).toHaveText(/單車|Cycling/);
  await expect(modeSelect.locator('option[value="motorcycle"]')).toHaveText(/機車|Motorcycle/);
  await expect(modeSelect.locator('option[value="car"]')).toHaveText(/汽車|Car/);

  const presetChips = page.locator('#shape-preset-chips .shape-preset-chip');
  await expect(presetChips).toHaveCount(12);

  const expectedPresets = [
    'heart', 'star', 'moon', 'sun', 'diamond', 'club',
    'cat', 'dog', 'bird', 'fish', 'horse', 'butterfly'
  ];

  for (const presetId of expectedPresets) {
    await expect(page.locator(`#shape-preset-chips .shape-preset-chip[data-preset="${presetId}"]`)).toHaveCount(1);
  }

  // Select 'heart' preset via chip
  const heartChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="heart"]');
  await heartChip.click();
  await expect(heartChip).toHaveClass(/active/);

  // Generate route directly from preset shape without manual drawing
  await page.locator('#shape-distance-input').fill('4');
  await page.locator('#btn-shape-generate').click();

  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  // Select 'horse' preset via chip
  const horseChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="horse"]');
  await horseChip.click();
  await expect(heartChip).not.toHaveClass(/active/);
  await expect(horseChip).toHaveClass(/active/);

  // Clear resets preset UI
  await page.locator('#btn-shape-clear').click();
  await expect(horseChip).not.toHaveClass(/active/);
});

test('drawing board anchors at most recently set waypoint without clearing existing original waypoints', async ({ page }) => {
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

  const heartChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="heart"]');
  await heartChip.click();
  await page.locator('#shape-distance-input').fill('2');
  await page.locator('#btn-shape-generate').click();

  // 3. Verify route generated
  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  // 4. Check the starting waypoint of the shape is anchored at the most recently set waypoint (25.030, 121.530)
  const firstWp = await page.evaluate(() =>
    window.__mappingElfTestHooks.lastShapeOptimizationResult?.keyWaypoints?.[0] ||
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.firstWaypoint
  );
  expect(firstWp[0]).toBeCloseTo(25.030, 4);
  expect(firstWp[1]).toBeCloseTo(121.530, 4);

  // 5. Existing original waypoints are NOT cleared
  const waypointsAfter = await page.evaluate(() => window.__mappingElfTestHooks.mapManager.waypoints);
  expect(waypointsAfter.length).toBe(3);
  expect(waypointsAfter[0][0]).toBeCloseTo(25.010, 4);
  expect(waypointsAfter[1][0]).toBeCloseTo(25.020, 4);
  expect(waypointsAfter[2][0]).toBeCloseTo(25.030, 4);
});

test('shape generation completes with "匯出 GPX" button replacing generate button and exports GPX file', async ({ page }) => {
  await openApp(page);

  const toolBtn = page.locator('#btn-shape-tool');
  await toolBtn.click();
  const panel = page.locator('#shape-panel');
  await expect(panel).toBeVisible();

  const generateBtn = page.locator('#btn-shape-generate');
  const exportGpxBtn = page.locator('#btn-shape-export-gpx');

  // Initial state: generate button is visible, export GPX button is hidden
  await expect(generateBtn).toBeVisible();
  await expect(exportGpxBtn).toHaveClass(/hidden/);

  // Select preset and distance via chip
  const starChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="star"]');
  await starChip.click();
  await page.locator('#shape-distance-input').fill('3');

  // Click generate
  await generateBtn.click();

  // Wait for route generation event
  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  const iterateBtn = page.locator('#btn-shape-iterate');
  // After completion: generate button is hidden, export GPX and iterate buttons are visible
  await expect(generateBtn).toHaveClass(/hidden/);
  await expect(exportGpxBtn).toBeVisible();
  await expect(iterateBtn).toBeVisible();

  // Clicking export GPX downloads the gpx file
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportGpxBtn.click(),
  ]);

  const filename = download.suggestedFilename();
  expect(filename).toMatch(/^GPS_Art_star_\d+m\.gpx$/);

  // Clearing resets export GPX and iterate buttons back to hidden, restoring generate button
  await page.locator('#btn-shape-clear').click();
  await expect(exportGpxBtn).toHaveClass(/hidden/);
  await expect(iterateBtn).toHaveClass(/hidden/);
  await expect(generateBtn).toBeVisible();
});

test('clicking iterate button performs additional calibration pass and updates readout metrics', async ({ page }) => {
  await openApp(page);

  const toolBtn = page.locator('#btn-shape-tool');
  await toolBtn.click();

  const heartChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="heart"]');
  await heartChip.click();
  await page.locator('#shape-distance-input').fill('3');
  await page.locator('#btn-shape-generate').click();

  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated')?.detail?.waypointCount ?? 0
  )).toBeGreaterThanOrEqual(3);

  const iterateBtn = page.locator('#btn-shape-iterate');
  await expect(iterateBtn).toBeVisible();

  // Check readout contains iterations row (localized)
  await expect(page.locator('#shape-readout')).toContainText(/Iterations|迭代次數/);

  // Trigger continuous iteration
  await iterateBtn.click();

  // Readout remains populated and updated
  await expect(page.locator('#shape-readout .mr-row').first()).toBeVisible();
  await expect(page.locator('#shape-readout')).toContainText(/Iterations|迭代次數/);
});

test('drawing board allows selecting travel modes (跑步/單車/機車/汽車) and generates route with selected mode', async ({ page }) => {
  await openApp(page);

  const toolBtn = page.locator('#btn-shape-tool');
  await toolBtn.click();
  const panel = page.locator('#shape-panel');
  await expect(panel).toBeVisible();

  const modeSelect = page.locator('#shape-mode-select');
  await expect(modeSelect).toBeVisible();

  // Test selecting motorcycle
  await modeSelect.selectOption('motorcycle');
  await expect(modeSelect).toHaveValue('motorcycle');

  // Verify stored in localStorage
  const storedMode = await page.evaluate(() => localStorage.getItem('mappingElf_shapeRouteMode'));
  expect(storedMode).toBe('motorcycle');

  // Pick a preset shape and generate
  const heartChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="heart"]');
  await heartChip.click();
  await page.locator('#shape-distance-input').fill('5');
  await page.locator('#btn-shape-generate').click();

  // Route generated event should carry travelMode
  await expect.poll(async () => page.evaluate(() => {
    const ev = (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated');
    return ev ? ev.detail?.travelMode : null;
  })).toBe('motorcycle');

  // Switch to bike and test persistence
  await modeSelect.selectOption('bike');
  await expect(modeSelect).toHaveValue('bike');
  const storedModeBike = await page.evaluate(() => localStorage.getItem('mappingElf_shapeRouteMode'));
  expect(storedModeBike).toBe('bike');
});

test('drawing board displays mode + direction and distance + angle side-by-side, and supports direction options (順/逆/不限)', async ({ page }) => {
  await openApp(page);

  const toolBtn = page.locator('#btn-shape-tool');
  await toolBtn.click();

  const modeSelect = page.locator('#shape-mode-select');
  const dirSelect = page.locator('#shape-direction-select');
  const distInput = page.locator('#shape-distance-input');
  const angleSelect = page.locator('#shape-angle-select');

  await expect(modeSelect).toBeVisible();
  await expect(dirSelect).toBeVisible();
  await expect(distInput).toBeVisible();
  await expect(angleSelect).toBeVisible();

  // Verify side-by-side layout: mode and direction share roughly the same vertical band
  const modeBox = await modeSelect.boundingBox();
  const dirBox = await dirSelect.boundingBox();
  expect(modeBox).not.toBeNull();
  expect(dirBox).not.toBeNull();
  expect(Math.abs(modeBox.y - dirBox.y)).toBeLessThan(15);
  expect(dirBox.x).toBeGreaterThan(modeBox.x);

  // Distance and angle share roughly the same vertical band
  const distBox = await distInput.boundingBox();
  const angleBox = await angleSelect.boundingBox();
  expect(distBox).not.toBeNull();
  expect(angleBox).not.toBeNull();
  expect(Math.abs(distBox.y - angleBox.y)).toBeLessThan(15);
  expect(angleBox.x).toBeGreaterThan(distBox.x);

  // Verify direction options
  const dirOptions = await dirSelect.locator('option').allTextContents();
  expect(dirOptions.some((t) => /不限|Any/i.test(t))).toBe(true);
  expect(dirOptions.some((t) => /順|CW/i.test(t))).toBe(true);
  expect(dirOptions.some((t) => /逆|CCW/i.test(t))).toBe(true);

  // Test selecting cw (順) and check persistence
  await dirSelect.selectOption('cw');
  await expect(dirSelect).toHaveValue('cw');
  let storedDir = await page.evaluate(() => localStorage.getItem('mappingElf_shapeRouteDirection'));
  expect(storedDir).toBe('cw');

  // Generate route and verify direction in test event
  const heartChip = page.locator('#shape-preset-chips .shape-preset-chip[data-preset="heart"]');
  await heartChip.click();
  await distInput.fill('4');
  await page.locator('#btn-shape-generate').click();

  await expect.poll(async () => page.evaluate(() => {
    const ev = (window.__mappingElfTestHooks?.events || []).find((e) => e.type === 'shape-route-generated');
    return ev ? ev.detail?.direction : null;
  })).toBe('cw');

  // Verify readout displays direction
  const readout = page.locator('#shape-readout');
  await expect(readout).toContainText(/前進方向|Direction/);
  await expect(readout).toContainText(/順|CW/);
});

test('road network strictly excludes motorway/expressway for non-car modes and enforces oneway rules', async () => {
  // Synthetic Overpass response containing:
  // 1. Motorway (highway=motorway)
  // 2. Motorroad expressway (highway=trunk, motorroad=yes)
  // 3. Oneway street (highway=residential, oneway=yes)
  // 4. Contraflow cycleway street (highway=residential, oneway=yes, oneway:bicycle=no)
  const overpassData = {
    elements: [
      { type: 'node', id: 1, lat: 25.034, lon: 121.564 },
      { type: 'node', id: 2, lat: 25.035, lon: 121.564 },
      { type: 'node', id: 3, lat: 25.036, lon: 121.564 },
      { type: 'node', id: 4, lat: 25.037, lon: 121.564 },
      { type: 'node', id: 5, lat: 25.038, lon: 121.564 },
      { type: 'node', id: 6, lat: 25.039, lon: 121.564 },
      { type: 'node', id: 7, lat: 25.040, lon: 121.564 },
      { type: 'node', id: 8, lat: 25.041, lon: 121.564 },
      // Motorway: nodes 1 -> 2
      {
        type: 'way',
        id: 101,
        nodes: [1, 2],
        tags: { highway: 'motorway' },
      },
      // Trunk with motorroad=yes: nodes 3 -> 4
      {
        type: 'way',
        id: 102,
        nodes: [3, 4],
        tags: { highway: 'trunk', motorroad: 'yes' },
      },
      // Oneway residential street: nodes 5 -> 6
      {
        type: 'way',
        id: 103,
        nodes: [5, 6],
        tags: { highway: 'residential', oneway: 'yes' },
      },
      // Contraflow cycleway: nodes 7 -> 8
      {
        type: 'way',
        id: 104,
        nodes: [7, 8],
        tags: { highway: 'residential', oneway: 'yes', 'oneway:bicycle': 'no' },
      },
    ],
  };

  // Test for car
  const carGraph = new RoadNetworkGraph([25.034, 121.564]);
  RoadNetworkGraph.populateFromOverpassData(carGraph, overpassData, 'car');

  // Test for motorcycle
  const motoGraph = new RoadNetworkGraph([25.034, 121.564]);
  RoadNetworkGraph.populateFromOverpassData(motoGraph, overpassData, 'motorcycle');

  // Test for bike
  const bikeGraph = new RoadNetworkGraph([25.034, 121.564]);
  RoadNetworkGraph.populateFromOverpassData(bikeGraph, overpassData, 'bike');

  // Test for foot
  const footGraph = new RoadNetworkGraph([25.034, 121.564]);
  RoadNetworkGraph.populateFromOverpassData(footGraph, overpassData, 'foot');

  const testResults = {
    carHasMotorway: carGraph.adj.get(1)?.has(2) ?? false,
    motoHasMotorway: motoGraph.adj.get(1)?.has(2) ?? false,
    bikeHasMotorway: bikeGraph.adj.get(1)?.has(2) ?? false,
    footHasMotorway: footGraph.adj.get(1)?.has(2) ?? false,

    carHasMotorroad: carGraph.adj.get(3)?.has(4) ?? false,
    motoHasMotorroad: motoGraph.adj.get(3)?.has(4) ?? false,
    bikeHasMotorroad: bikeGraph.adj.get(3)?.has(4) ?? false,
    footHasMotorroad: footGraph.adj.get(3)?.has(4) ?? false,

    carOnewayForward: carGraph.adj.get(5)?.has(6) ?? false,
    carOnewayReverse: carGraph.adj.get(6)?.has(5) ?? false,

    bikeContraflowForward: bikeGraph.adj.get(7)?.has(8) ?? false,
    bikeContraflowReverse: bikeGraph.adj.get(8)?.has(7) ?? false,

    footIsBidirectional: (footGraph.adj.get(5)?.has(6) ?? false) && (footGraph.adj.get(6)?.has(5) ?? false),
  };

  // Car CAN access motorways
  expect(testResults.carHasMotorway).toBe(true);
  expect(testResults.carHasMotorroad).toBe(true);

  // Non-cars CANNOT access motorways
  expect(testResults.motoHasMotorway).toBe(false);
  expect(testResults.motoHasMotorroad).toBe(false);
  expect(testResults.bikeHasMotorway).toBe(false);
  expect(testResults.bikeHasMotorroad).toBe(false);
  expect(testResults.footHasMotorway).toBe(false);
  expect(testResults.footHasMotorroad).toBe(false);

  // Oneway restrictions
  expect(testResults.carOnewayForward).toBe(true);
  expect(testResults.carOnewayReverse).toBe(false);

  // Contraflow bike override
  expect(testResults.bikeContraflowForward).toBe(true);
  expect(testResults.bikeContraflowReverse).toBe(true);

  // Foot pedestrians not blocked by vehicle oneway
  expect(testResults.footIsBidirectional).toBe(true);
});

