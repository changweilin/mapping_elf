import { expect, test } from '@playwright/test';

const VISIBLE_ROUTE_PATH_SELECTOR = '.leaflet-overlay-pane path:not(.route-hit-line)';
const LONG_PRESS_MS = 650;

async function openLayerTestApp(page, options = {}) {
  const { roundTrip = '1', oLoop = '0' } = options;
  await page.addInitScript(({ roundTrip, oLoop }) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', roundTrip);
    localStorage.setItem('mappingElf_oLoop', oLoop);
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
  }, { roundTrip, oLoop });

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

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
}

async function addRoundTripWaypoints(page) {
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();

  await addWaypointsAtFractions(page, [
    [0.40, 0.50],
    [0.58, 0.50],
  ]);
  await expect(page.locator(VISIBLE_ROUTE_PATH_SELECTOR)).toHaveCount(2);
  await expect(page.locator('.leaflet-overlay-pane path.route-hit-line')).toHaveCount(1);
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

async function addWaypointByCoordinateSearch(page, lat, lng, expectedCount) {
  await page.locator('#search-input').fill(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  await page.locator('#btn-search').click();
  const addButton = page.locator('#search-results .search-result-add').first();
  await expect(addButton).toBeVisible();
  await addButton.click();
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(expectedCount);
}

async function addCoordinateSearchWaypoints(page, coords) {
  for (let i = 0; i < coords.length; i++) {
    await addWaypointByCoordinateSearch(page, coords[i][0], coords[i][1], i + 1);
  }
}

async function layerState(page) {
  return page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll('.leaflet-overlay-pane path:not(.route-hit-line)'));
    const markers = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'));
    const waypointMarkers = markers.map((el) => ({
      isReturn: el.classList.contains('return-leg'),
      z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
      transform: el.style.transform,
    }));
    const returnMarker = waypointMarkers.find((m) => m.isReturn);
    const pairedOutbound = returnMarker
      ? waypointMarkers.find((m) => !m.isReturn && m.transform === returnMarker.transform)
      : null;
    return {
      topStroke: paths.at(-1)?.getAttribute('stroke'),
      markerZ: markers.map((el) => getComputedStyle(el).zIndex),
      returnAboveOutbound: pairedOutbound && returnMarker ? returnMarker.z > pairedOutbound.z : false,
    };
  });
}

async function routeOverlapState(page) {
  return page.evaluate((selector) => {
    const paths = Array.from(document.querySelectorAll(selector));
    if (paths.length === 0) {
      return { point: null, overlapCount: 0, orderedStrokes: [], topStroke: null };
    }

    const rect = paths[0].getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const overlaps = paths
      .map((el, domIndex) => {
        const r = el.getBoundingClientRect();
        return {
          domIndex,
          stroke: el.getAttribute('stroke') || getComputedStyle(el).stroke,
          containsPoint: point.x >= r.left - 2
            && point.x <= r.right + 2
            && point.y >= r.top - 2
            && point.y <= r.bottom + 2,
        };
      })
      .filter((entry) => entry.containsPoint);

    return {
      point,
      overlapCount: overlaps.length,
      orderedStrokes: overlaps.map((entry) => entry.stroke),
      topStroke: overlaps.at(-1)?.stroke || null,
    };
  }, VISIBLE_ROUTE_PATH_SELECTOR);
}

async function longPressRouteOverlap(page) {
  const state = await routeOverlapState(page);
  expect(state.point).not.toBeNull();
  await page.mouse.move(state.point.x, state.point.y);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_MS);
  await page.mouse.move(state.point.x + 2, state.point.y + 1);
  await page.mouse.up();
}

async function waypointPairState(page) {
  return page.evaluate(() => {
    const markers = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'))
      .map((el) => {
        const text = el.textContent.trim();
        const number = Number.parseInt(text.replace(/^\D*/, ''), 10);
        return {
          number,
          isReturn: el.classList.contains('return-leg'),
          z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
          transform: el.style.transform,
        };
      });

    return markers
      .filter((marker) => Number.isFinite(marker.number) && !marker.isReturn)
      .map((outbound) => {
        const mirror = markers.find((marker) =>
          marker.isReturn &&
          marker.number === outbound.number &&
          marker.transform === outbound.transform
        ) || null;
        return {
          number: outbound.number,
          hasReturn: !!mirror,
          returnAbove: mirror ? mirror.z > outbound.z : false,
        };
      });
  });
}

async function topWaypointCenter(page, number) {
  const target = await page.evaluate((targetNumber) => {
    const marker = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'))
      .filter((el) => Number.parseInt(el.textContent.trim().replace(/^\D*/, ''), 10) === targetNumber)
      .map((el) => ({
        el,
        isReturn: el.classList.contains('return-leg'),
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

async function startLongPressWaypointDrag(page, point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_MS);
  await expect(page.locator('.waypoint-trash-zone')).toBeVisible();
}

async function finishLongPressWaypointDrag(page, point) {
  await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.leaflet-marker-pane .custom-waypoint-icon.is-dragging')).toHaveCount(0);
}

test('double-clicking an overlapped waypoint cycles visible layer order', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const before = await layerState(page);
  const waypoint = await page.locator('.leaflet-marker-pane .custom-waypoint-icon').first().boundingBox();
  expect(waypoint).not.toBeNull();
  await page.mouse.dblclick(waypoint.x + waypoint.width / 2, waypoint.y + waypoint.height / 2);
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(true);
});

test('double-clicking an overlapped route marker cycles visible layer order', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const before = await layerState(page);
  const routePoint = await page.evaluate(() => {
    const path = Array.from(document.querySelectorAll('.leaflet-overlay-pane path:not(.route-hit-line)')).at(-1);
    if (!path) return null;
    const rect = path.getBoundingClientRect();
    return { x: rect.x + rect.width * 0.25, y: rect.y + rect.height / 2 };
  });
  expect(routePoint).not.toBeNull();

  await page.mouse.dblclick(routePoint.x, routePoint.y);
  await expect.poll(async () => (await layerState(page)).topStroke).not.toBe(before.topStroke);
});

test('clicking the selected route hit layer still inserts a waypoint', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const routePoint = await page.evaluate(() => {
    const path = Array.from(document.querySelectorAll('.leaflet-overlay-pane path:not(.route-hit-line)')).at(-1);
    if (!path) return null;
    const rect = path.getBoundingClientRect();
    return { x: rect.x + rect.width * 0.5, y: rect.y + rect.height / 2 };
  });
  expect(routePoint).not.toBeNull();

  await page.mouse.click(routePoint.x, routePoint.y);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(3);
});

test('round-trip mirrored waypoint pairs toggle except the turnaround endpoint', async ({ page }) => {
  await openLayerTestApp(page);
  await addWaypointsAtFractions(page, [
    [0.36, 0.56],
    [0.46, 0.46],
    [0.56, 0.56],
    [0.66, 0.46],
  ]);
  await expect(page.locator(VISIBLE_ROUTE_PATH_SELECTOR)).toHaveCount(6);

  const initialPairs = await waypointPairState(page);
  expect(initialPairs.map((pair) => [pair.number, pair.hasReturn])).toEqual([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
  ]);

  for (const number of [1, 2, 3]) {
    const beforePairs = await waypointPairState(page);
    const beforePair = beforePairs.find((pair) => pair.number === number);
    expect(beforePair?.hasReturn).toBe(true);

    const target = await page.evaluate((targetNumber) => {
      const markers = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'));
      const pair = markers
        .map((el) => ({
          el,
          isReturn: el.classList.contains('return-leg'),
          number: Number.parseInt(el.textContent.trim().replace(/^\D*/, ''), 10),
          z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
        }))
        .filter((marker) => marker.number === targetNumber)
        .sort((a, b) => b.z - a.z);
      const marker = pair[0]?.el;
      if (!marker) return null;
      const rect = marker.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, number);
    expect(target).not.toBeNull();

    await page.mouse.dblclick(target.x, target.y);
    await expect.poll(async () => {
      const pairs = await waypointPairState(page);
      return pairs.find((pair) => pair.number === number)?.returnAbove ?? null;
    }).toBe(!beforePair.returnAbove);
  }
});

test('long-press dragging an overlapped waypoint moves it instead of cycling layers', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  let target = await topWaypointCenter(page, 1);
  await page.mouse.dblclick(target.x, target.y);
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(true);

  const beforeLayer = await layerState(page);
  const before = await topWaypointCenter(page, 1);
  await startLongPressWaypointDrag(page, before);
  await finishLongPressWaypointDrag(page, { x: before.x + 90, y: before.y + 35 });

  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  const after = await topWaypointCenter(page, 1);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(30);
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(beforeLayer.returnAboveOutbound);
});

test('long-press dragging a waypoint into the trash zone deletes it', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const target = await topWaypointCenter(page, 2);
  await startLongPressWaypointDrag(page, target);

  const trashBox = await page.locator('.waypoint-trash-zone').boundingBox();
  expect(trashBox).not.toBeNull();
  await finishLongPressWaypointDrag(page, {
    x: trashBox.x + trashBox.width / 2,
    y: trashBox.y + trashBox.height / 2,
  });

  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await expect(page.locator('.waypoint-trash-zone')).not.toBeVisible();
});

test('long-pressing a route overlap with four stacked legs cycles every visible layer', async ({ page }) => {
  await openLayerTestApp(page, { roundTrip: '0' });
  await addCoordinateSearchWaypoints(page, [
    [23.5000, 121.0000],
    [23.5060, 121.0120],
    [23.5000, 121.0000],
    [23.5060, 121.0120],
    [23.5000, 121.0000],
  ]);

  await expect(page.locator(VISIBLE_ROUTE_PATH_SELECTOR)).toHaveCount(4);
  await expect.poll(async () => (await routeOverlapState(page)).overlapCount).toBeGreaterThanOrEqual(4);

  const first = await routeOverlapState(page);
  const cycle = [first.topStroke];
  const waypointCount = page.locator('#waypoint-list .waypoint-item');

  for (let i = 0; i < first.overlapCount; i++) {
    const before = await routeOverlapState(page);
    await longPressRouteOverlap(page);
    await expect.poll(async () => (await routeOverlapState(page)).topStroke).not.toBe(before.topStroke);
    cycle.push((await routeOverlapState(page)).topStroke);
    await expect(waypointCount).toHaveCount(5);
  }

  expect(new Set(cycle.slice(0, -1)).size).toBeGreaterThanOrEqual(4);
  expect(cycle.at(-1)).toBe(cycle[0]);
});
