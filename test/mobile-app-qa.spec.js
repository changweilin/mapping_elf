import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const shortGpx = path.join(repoRoot, 'data', 'app-test-routes', 'short-zh-weather.gpx');
const sampleMelmap = path.join(
  repoRoot,
  'data',
  fs.readdirSync(path.join(repoRoot, 'data')).find((name) => name.endsWith('.melmap')),
);
const LONG_PRESS_MS = 650;

function isExpectedExternalResourceNoise(text) {
  return text.includes('Failed to load resource')
    && (
      text.includes('net::ERR_NETWORK_ACCESS_DENIED')
      || text.includes('net::ERR_NO_BUFFER_SPACE')
      || text.includes('the server responded with a status of 404 (Offline)')
    );
}

async function openApp(page) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isExpectedExternalResourceNoise(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await mockRouteServices(page);
  await mockWeather(page);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
  });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  return consoleErrors;
}

async function mockRouteServices(page) {
  await page.route('**/route/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const coordPart = url.pathname.split('/').pop();
    const coords = coordPart.split(';').map((coord) => coord.split(',').map(Number));
    await route.fulfill({
      json: {
        code: 'Ok',
        routes: [{
          distance: 1000,
          duration: 1000,
          geometry: { type: 'LineString', coordinates: coords },
        }],
      },
    });
  });
  await page.route('**/v1/elevation**', async (route) => {
    const url = new URL(route.request().url());
    const count = (url.searchParams.get('latitude') || '').split(',').filter(Boolean).length || 3;
    await route.fulfill({ json: { elevation: Array.from({ length: count }, () => 100) } });
  });
}

async function mockWeather(page) {
  await page.route('**/v1/forecast**', async (route) => route.fulfill({ json: weatherPayload() }));
  await page.route('**/v1/archive**', async (route) => route.fulfill({ json: weatherPayload() }));
}

function weatherPayload() {
  return {
    daily: {
      time: ['2026-05-20'],
      temperature_2m_max: [24],
      temperature_2m_min: [18],
      precipitation_sum: [0],
      weathercode: [1],
      windspeed_10m_max: [12],
      windgusts_10m_max: [18],
      sunrise: ['2026-05-20T05:10'],
      sunset: ['2026-05-20T18:30'],
      sunshine_duration: [18000],
      precipitation_probability_max: [10],
      uv_index_max: [7],
      shortwave_radiation_sum: [19],
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `2026-05-20T${String(h).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, () => 21),
      apparent_temperature: Array.from({ length: 24 }, () => 20),
      relative_humidity_2m: Array.from({ length: 24 }, () => 65),
      dewpoint_2m: Array.from({ length: 24 }, () => 14),
      precipitation: Array.from({ length: 24 }, () => 0),
      precipitation_probability: Array.from({ length: 24 }, () => 10),
      weathercode: Array.from({ length: 24 }, () => 1),
      windspeed_10m: Array.from({ length: 24 }, () => 10),
      windgusts_10m: Array.from({ length: 24 }, () => 16),
      uv_index: Array.from({ length: 24 }, () => 4),
      visibility: Array.from({ length: 24 }, () => 10000),
      cloudcover: Array.from({ length: 24 }, () => 25),
    },
    elevation: 100,
  };
}

async function clickStable(page, selector) {
  const locator = page.locator(selector);
  await expect(locator).toBeAttached();
  await locator.evaluate((el) => el.click());
}

async function elementBounds(page, selector) {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      canScroll: el.scrollHeight >= el.clientHeight,
    };
  });
}

function expectInsideViewport(bounds) {
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
}

async function doubleTap(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(x, y);
}

async function closeSidePanel(page) {
  const isOpen = await page.locator('#side-panel').evaluate((el) => el.classList.contains('open'));
  if (isOpen) {
    await clickStable(page, '#btn-toggle-panel');
  }
  await expect(page.locator('#side-panel')).not.toHaveClass(/open/);
}

async function addWaypointsAtFractions(page, points) {
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(i + 1);
  }
  if (points.length >= 2) {
    await expect(page.locator('.leaflet-overlay-pane path:not(.route-hit-line)').first()).toBeVisible();
  }
}

async function addWaypointByCoordinateSearch(page, lat, lng, expectedCount) {
  await page.locator('#search-input').fill(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  await clickStable(page, '#btn-search');
  const addButton = page.locator('#search-results .search-result-add').first();
  await expect(addButton).toBeVisible();
  await addButton.evaluate((el) => el.click());
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(expectedCount);
}

async function addCoordinateSearchWaypoints(page, coords) {
  for (let i = 0; i < coords.length; i++) {
    await addWaypointByCoordinateSearch(page, coords[i][0], coords[i][1], i + 1);
  }
  if (coords.length >= 2) {
    await expect(page.locator('.leaflet-overlay-pane path:not(.route-hit-line)').first()).toBeVisible();
  }
}

async function topWaypointCenter(page, number) {
  const target = await page.evaluate((targetNumber) => {
    const marker = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'))
      .filter((el) => Number.parseInt(el.textContent.trim().replace(/^\D*/, ''), 10) === targetNumber)
      .map((el) => ({
        el,
        z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
      }))
      .sort((a, b) => b.z - a.z)[0]?.el;
    if (!marker) return null;
    const rect = marker.getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }, number);
  expect(target).not.toBeNull();
  return target;
}

async function storedWaypoints(page) {
  const waypoints = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_waypoints') || '[]'));
  expect(Array.isArray(waypoints)).toBe(true);
  return waypoints;
}

function coordinateDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

async function dispatchTouch(page, type, point) {
  await page.evaluate(({ type, point }) => {
    const domType = {
      touchStart: 'touchstart',
      touchMove: 'touchmove',
      touchEnd: 'touchend',
      touchCancel: 'touchcancel',
    }[type];
    if (!domType) throw new Error(`Unsupported touch event: ${type}`);

    const markerAtPoint = () => Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
      })
      .map((el) => ({
        el,
        z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
      }))
      .sort((a, b) => b.z - a.z)[0]?.el || null;

    const existingTarget = window.__mappingElfTestTouchTarget;
    const target = (existingTarget?.isConnected ? existingTarget : null)
      || markerAtPoint()
      || document.elementFromPoint(point.x, point.y)
      || document;
    if (!target) throw new Error(`No touch target at ${point.x}, ${point.y}`);
    if (type === 'touchStart') window.__mappingElfTestTouchTarget = target;

    const touch = new Touch({
      identifier: 1,
      target,
      clientX: point.x,
      clientY: point.y,
      pageX: point.x + window.scrollX,
      pageY: point.y + window.scrollY,
      screenX: point.x,
      screenY: point.y,
      radiusX: 8,
      radiusY: 8,
      force: 1,
    });
    const activeTouches = type === 'touchEnd' || type === 'touchCancel' ? [] : [touch];
    target.dispatchEvent(new TouchEvent(domType, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches: activeTouches,
      targetTouches: activeTouches,
      changedTouches: [touch],
    }));

    if (type === 'touchEnd' || type === 'touchCancel') {
      window.__mappingElfTestTouchTarget = null;
    }
  }, { type, point });
}

async function touchLongPressDrag(page, startPoint, endPoint) {
  await dispatchTouch(page, 'touchStart', startPoint);
  await page.waitForTimeout(LONG_PRESS_MS);
  await expect(page.locator('.waypoint-trash-zone')).toBeVisible();
  await finishTouchDrag(page, startPoint, endPoint);
}

async function finishTouchDrag(page, startPoint, endPoint) {
  await dispatchTouch(page, 'touchMove', {
    x: (startPoint.x + endPoint.x) / 2,
    y: (startPoint.y + endPoint.y) / 2,
  });
  await page.waitForTimeout(40);
  await dispatchTouch(page, 'touchMove', endPoint);
  await page.waitForTimeout(40);
  await dispatchTouch(page, 'touchEnd', endPoint);
  await expect(page.locator('.leaflet-marker-pane .custom-waypoint-icon.is-dragging')).toHaveCount(0);
}

async function dropZoneTargetCenter(page, action) {
  const box = await page.locator(`.waypoint-drop-target[data-drop-action="${action}"]`).boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

test.describe('mobile app QA', () => {
  test.use({ hasTouch: true, viewport: { width: 667, height: 375 } });

  test('export modal stays inside a small landscape viewport', async ({ page }) => {
    const consoleErrors = await openApp(page);

    await page.locator('#gpx-file-input').setInputFiles(shortGpx);
    await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();

    await clickStable(page, '#btn-export-gpx');
    await expect(page.locator('#export-modal')).toBeVisible();
    await page.locator('input[name="export-fmt"][value="melmap"]').check();
    await expect(page.locator('#melmap-sub-options')).toBeVisible();

    expectInsideViewport(await elementBounds(page, '#export-modal .modal-box'));
    await expect(page.locator('#btn-export-confirm')).toBeVisible();
    await expect(page.locator('#btn-export-cancel')).toBeVisible();

    await page.locator('#btn-export-cancel').click();
    await expect(page.locator('#export-modal')).toHaveClass(/hidden/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    expect(consoleErrors).toEqual([]);
  });

  test('map-pack import modal stays inside a small landscape viewport', async ({ page }) => {
    const consoleErrors = await openApp(page);

    await page.locator('#gpx-file-input').setInputFiles(sampleMelmap);
    await expect(page.locator('#mappack-import-modal')).toBeVisible();
    expectInsideViewport(await elementBounds(page, '#mappack-import-modal .modal-box'));

    await expect(page.locator('#mappack-restore-route')).toBeVisible();
    await expect(page.locator('#mappack-restore-tiles')).toBeVisible();
    await expect(page.locator('#mappack-restore-state')).toBeVisible();
    await expect(page.locator('#btn-mappack-import-confirm')).toBeVisible();
    await expect(page.locator('#btn-mappack-import-cancel')).toBeVisible();

    await page.locator('#btn-mappack-import-cancel').click();
    await expect(page.locator('#mappack-import-modal')).toHaveClass(/hidden/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    expect(consoleErrors).toEqual([]);
  });

  test('bottom weather panel remains bounded when expanded by touch', async ({ page }) => {
    const consoleErrors = await openApp(page);

    await page.locator('#gpx-file-input').setInputFiles(shortGpx);
    await expect(page.locator('#weather-table-container .wt-col-head').first()).toBeVisible();

    const initial = await elementBounds(page, '#bottom-panel');
    expectInsideViewport(initial);

    await doubleTap(page, '#bp-resize-handle');
    await expect.poll(async () => {
      const expanded = await elementBounds(page, '#bottom-panel');
      return expanded.height > initial.height + 40;
    }).toBe(true);

    const expanded = await elementBounds(page, '#bottom-panel');
    const toolbarBottom = await page.locator('.toolbar').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(expanded.top).toBeGreaterThanOrEqual(toolbarBottom - 1);
    expectInsideViewport(expanded);
    await expect(page.locator('#bp-resize-handle')).toBeVisible();
    await expect(page.locator('#weather-table-container')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('touch long-press dragging a waypoint updates only that waypoint', async ({ page }) => {
    const consoleErrors = await openApp(page);
    await addCoordinateSearchWaypoints(page, [
      [24.1000, 121.1000],
      [24.1060, 121.1120],
    ]);
    await closeSidePanel(page);

    const before = await topWaypointCenter(page, 2);
    const storedBefore = await storedWaypoints(page);
    const releasePoint = { x: before.x - 70, y: before.y + 28 };
    await touchLongPressDrag(page, before, releasePoint);

    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
    await expect(page.locator('.waypoint-trash-zone')).not.toBeVisible();
    const storedAfter = await storedWaypoints(page);
    expect(coordinateDistance(storedAfter[1], storedBefore[1])).toBeGreaterThan(0.0001);
    expect(coordinateDistance(storedAfter[0], storedBefore[0])).toBeLessThan(0.000001);
    const after = await topWaypointCenter(page, 2);
    expect(Math.hypot(after.x - releasePoint.x, after.y - releasePoint.y)).toBeLessThan(45);
    expect(consoleErrors).toEqual([]);
  });

  test('touch long-press dragging a waypoint into delete zone removes it', async ({ page }) => {
    const consoleErrors = await openApp(page);
    await addCoordinateSearchWaypoints(page, [
      [24.1000, 121.1000],
      [24.1060, 121.1120],
    ]);
    await closeSidePanel(page);

    const before = await storedWaypoints(page);
    expect(before).toHaveLength(2);
    await dispatchTouch(page, 'touchStart', await topWaypointCenter(page, 2));
    await page.waitForTimeout(LONG_PRESS_MS);
    await expect(page.locator('.waypoint-drop-delete')).toBeVisible();
    await finishTouchDrag(page, await topWaypointCenter(page, 2), await dropZoneTargetCenter(page, 'delete'));

    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
    await expect(page.locator('.waypoint-trash-zone')).not.toBeVisible();
    const after = await storedWaypoints(page);
    expect(after).toHaveLength(1);
    expect(coordinateDistance(after[0], before[0])).toBeLessThan(0.000001);
    expect(consoleErrors).toEqual([]);
  });
});
