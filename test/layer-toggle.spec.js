import { expect, test } from '@playwright/test';

const VISIBLE_ROUTE_PATH_SELECTOR = '.leaflet-overlay-pane path:not(.route-hit-line)';
const LONG_PRESS_MS = 650;

async function openLayerTestApp(page, options = {}) {
  const {
    roundTrip = '1',
    oLoop = '0',
    routeDelayMs = 0,
    weatherDelayMs = 0,
    importedTrackSession = null,
    weatherCells = null,
    weatherRequests = null,
    routeEvents = null,
  } = options;
  await page.addInitScript(({ roundTrip, oLoop, importedTrackSession, weatherCells }) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', roundTrip);
    localStorage.setItem('mappingElf_oLoop', oLoop);
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    if (importedTrackSession) {
      localStorage.setItem('mappingElf_importedTrack', JSON.stringify(importedTrackSession));
    }
    if (weatherCells) {
      localStorage.setItem('mappingElf_weatherCells', JSON.stringify(weatherCells));
    }
  }, { roundTrip, oLoop, importedTrackSession, weatherCells });

  await page.route('**/route/v1/**', async (route) => {
    const url = new URL(route.request().url());
    routeEvents?.push({ type: 'start', url: route.request().url() });
    const coordPart = url.pathname.split('/').pop();
    const coords = coordPart.split(';').map((coord) => coord.split(',').map(Number));
    if (routeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, routeDelayMs));
    routeEvents?.push({ type: 'finish', url: route.request().url() });
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

  const weatherPayload = () => ({
    daily: {
      time: ['2026-05-12'],
      temperature_2m_max: [24],
      temperature_2m_min: [18],
      precipitation_sum: [0],
      weathercode: [1],
      windspeed_10m_max: [12],
      windgusts_10m_max: [18],
      sunrise: ['2026-05-12T05:10'],
      sunset: ['2026-05-12T18:30'],
      sunshine_duration: [18000],
      precipitation_probability_max: [10],
      uv_index_max: [7],
      shortwave_radiation_sum: [19],
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `2026-05-12T${String(h).padStart(2, '0')}:00`),
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
  });

  await page.route('**/v1/forecast**', async (route) => {
    weatherRequests?.push(route.request().url());
    if (weatherDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, weatherDelayMs));
    await route.fulfill({ json: weatherPayload() });
  });

  await page.route('**/v1/archive**', async (route) => {
    weatherRequests?.push(route.request().url());
    if (weatherDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, weatherDelayMs));
    await route.fulfill({ json: weatherPayload() });
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

async function doubleClickRouteOverlap(page) {
  const state = await routeOverlapState(page);
  expect(state.point).not.toBeNull();
  await page.mouse.dblclick(state.point.x, state.point.y);
}

async function longPressDragRoute(page, startPoint, endPoint) {
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_MS);
  await page.mouse.move(endPoint.x, endPoint.y, { steps: 8 });
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

async function selectedWaypointState(page, number) {
  return page.evaluate((targetNumber) => {
    const markers = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'))
      .filter((el) => Number.parseInt(el.textContent.trim().replace(/^\D*/, ''), 10) === targetNumber)
      .map((el) => ({
        isReturn: el.classList.contains('return-leg'),
        isSelected: el.classList.contains('is-selected'),
        z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
      }));
    const selected = markers.filter((marker) => marker.isSelected);
    const top = markers.slice().sort((a, b) => b.z - a.z)[0] || null;
    return {
      selectedCount: selected.length,
      selectedIsReturn: selected[0]?.isReturn ?? null,
      topIsReturn: top?.isReturn ?? null,
    };
  }, number);
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

async function waypointCenter(page, number, isReturn) {
  const target = await page.evaluate(({ targetNumber, targetIsReturn }) => {
    const marker = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'))
      .filter((el) =>
        Number.parseInt(el.textContent.trim().replace(/^\D*/, ''), 10) === targetNumber &&
        el.classList.contains('return-leg') === targetIsReturn
      )
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
  }, { targetNumber: number, targetIsReturn: isReturn });
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

async function dropZoneTargetCenter(page, action) {
  const box = await page.locator(`.waypoint-drop-target[data-drop-action="${action}"]`).boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
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

    const existingTarget = window.__mappingElfTestTouchTarget;
    const target = (existingTarget?.isConnected ? existingTarget : null)
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

async function touchTap(page, point) {
  await dispatchTouch(page, 'touchStart', point);
  await page.waitForTimeout(45);
  await dispatchTouch(page, 'touchEnd', point);
  await page.waitForTimeout(70);
}

async function touchDoubleTap(page, point) {
  await touchTap(page, point);
  await touchTap(page, point);
}

async function touchLongPressDrag(page, startPoint, endPoint) {
  await dispatchTouch(page, 'touchStart', startPoint);
  await page.waitForTimeout(LONG_PRESS_MS);
  await expect(page.locator('.waypoint-trash-zone')).toBeVisible();
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

test('double-clicking an overlapped waypoint cycles visible layer order', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);
  await expect.poll(async () =>
    (await waypointPairState(page)).find((pair) => pair.number === 1)?.hasReturn ?? false
  ).toBe(true);

  const before = await layerState(page);
  const waypoint = await page.locator('.leaflet-marker-pane .custom-waypoint-icon').first().boundingBox();
  expect(waypoint).not.toBeNull();
  await page.mouse.dblclick(waypoint.x + waypoint.width / 2, waypoint.y + waypoint.height / 2);
  await expect.poll(async () => {
    const state = await layerState(page);
    return {
      routeChanged: state.topStroke !== before.topStroke,
      returnAboveOutbound: state.returnAboveOutbound,
    };
  }).toMatchObject({
    routeChanged: true,
    returnAboveOutbound: true,
  });
});

test('clicking a highlighted overlapped waypoint cycles visible layer and keeps highlight', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  await page.locator('.leaflet-marker-pane .custom-waypoint-icon:not(.return-leg)')
    .filter({ has: page.locator('.wp-icon-inner > span', { hasText: '1' }) })
    .first()
    .locator('.wp-icon-inner')
    .click();
  await expect.poll(async () => await selectedWaypointState(page, 1)).toMatchObject({
    selectedCount: 1,
    selectedIsReturn: false,
    topIsReturn: false,
  });

  await page.locator('.leaflet-marker-pane .custom-waypoint-icon.is-selected .wp-icon-inner').click();
  await expect.poll(async () => await selectedWaypointState(page, 1)).toMatchObject({
    selectedCount: 1,
    selectedIsReturn: true,
    topIsReturn: true,
  });
});

test('waypoint marker text is not selectable during long press gestures', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const markerStyles = await page.locator('.leaflet-marker-pane .custom-waypoint-icon').first().evaluate((marker) => {
    const nodes = [marker, ...marker.querySelectorAll('*')];
    return nodes.map((node) => getComputedStyle(node).userSelect);
  });
  expect(markerStyles.every((value) => value === 'none')).toBe(true);
});

test('route planning locks map edits and defers route parameters until completion', async ({ page }) => {
  await openLayerTestApp(page, { roundTrip: '0', routeDelayMs: 1200 });

  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.50);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.50);

  await expect(page.locator('#route-weather-busy-overlay')).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.70, box.y + box.height * 0.50);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);

  await page.evaluate(() => {
    const radio = document.querySelector('#nav-mode-roundtrip');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mappingElf_roundTrip'))).toBe('0');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mappingElf_roundTrip')), { timeout: 6000 }).toBe('1');
});

test('route replanning cancels in-flight weather fetch and restarts after route completes', async ({ page }) => {
  const weatherRequests = [];
  const routeEvents = [];
  await openLayerTestApp(page, {
    roundTrip: '0',
    routeDelayMs: 1000,
    weatherDelayMs: 2000,
    weatherRequests,
    routeEvents,
  });

  await addWaypointsAtFractions(page, [
    [0.40, 0.50],
    [0.58, 0.50],
  ]);
  await expect(page.locator(VISIBLE_ROUTE_PATH_SELECTOR)).toHaveCount(1);
  await expect.poll(() => weatherRequests.length, { timeout: 5000 }).toBeGreaterThan(0);

  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  const routeStartsBefore = routeEvents.filter((event) => event.type === 'start').length;
  const routeFinishesBefore = routeEvents.filter((event) => event.type === 'finish').length;

  await page.mouse.click(box.x + box.width * 0.70, box.y + box.height * 0.50);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(3);
  await expect.poll(
    () => routeEvents.filter((event) => event.type === 'start').length,
    { timeout: 3000 },
  ).toBe(routeStartsBefore + 1);

  const weatherRequestsDuringReplan = weatherRequests.length;
  await page.waitForTimeout(500);
  expect(routeEvents.filter((event) => event.type === 'finish').length).toBe(routeFinishesBefore);
  expect(weatherRequests.length).toBe(weatherRequestsDuringReplan);

  await expect.poll(
    () => routeEvents.filter((event) => event.type === 'finish').length,
    { timeout: 4000 },
  ).toBe(routeFinishesBefore + 1);
  await expect.poll(() => weatherRequests.length, { timeout: 6000 })
    .toBeGreaterThan(weatherRequestsDuringReplan);
});

test('opening a restored track shows weather loading progress', async ({ page }) => {
  await openLayerTestApp(page, {
    roundTrip: '0',
    weatherDelayMs: 1200,
    importedTrackSession: {
      coords: [
        [24.00, 121.00],
        [24.01, 121.02],
        [24.02, 121.04],
      ],
      elevations: [100, 120, 130],
      waypoints: [
        [24.00, 121.00],
        [24.02, 121.04],
      ],
      waypointMeta: [
        { waypointId: 'restored-start', label: 'Start', cumDistM: 0 },
        { waypointId: 'restored-end', label: 'End', cumDistM: 3000 },
      ],
      intermediates: [],
    },
  });

  await expect(page.locator('#route-weather-busy-overlay')).toBeVisible();
  await expect(page.locator('#route-weather-busy-title')).toHaveText(/天氣/);
  await expect(page.locator('#route-weather-busy-progress')).not.toHaveText('0%');

  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width * 0.70, box.y + box.height * 0.50);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);

  await expect(page.locator('#route-weather-busy-overlay')).toBeHidden({ timeout: 8000 });
});

test('restored weather detail info prevents automatic weather fetch', async ({ page }) => {
  const weatherRequests = [];
  await openLayerTestApp(page, {
    roundTrip: '0',
    weatherDelayMs: 200,
    weatherRequests,
    importedTrackSession: {
      coords: [
        [24.00, 121.00],
        [24.01, 121.02],
        [24.02, 121.04],
      ],
      elevations: [100, 120, 130],
      waypoints: [
        [24.00, 121.00],
        [24.02, 121.04],
      ],
      waypointMeta: [
        { waypointId: 'saved-start', label: 'Start', cumDistM: 0 },
        { waypointId: 'saved-end', label: 'End', cumDistM: 3000 },
      ],
      intermediates: [],
    },
    weatherCells: {
      'wp:saved-start': {
        weather: 'sunny Clear',
        temp: '21 C',
        precipitation: '0 mm',
        _icon: 'sunny',
      },
      'wp:saved-end': {
        _weatherLoaded: true,
        _weatherLoadState: 'loaded',
        weather: 'cloudy Cloudy',
        temp: '22 C',
        precipitation: '0 mm',
        _icon: 'cloudy',
      },
      'int:24.01,121.02': {
        _weatherLoaded: true,
        _weatherLoadState: 'loaded',
        weather: 'cloudy Cloudy',
        temp: '22 C',
        precipitation: '0 mm',
        _icon: 'cloudy',
      },
    },
  });

  await page.waitForTimeout(1500);
  expect(weatherRequests).toHaveLength(0);
  await expect(page.locator('#route-weather-busy-overlay')).toBeHidden();
});

test('icon-only restored waypoint weather refetches before opening map card', async ({ page }) => {
  const weatherRequests = [];
  await openLayerTestApp(page, {
    roundTrip: '0',
    weatherDelayMs: 100,
    weatherRequests,
    importedTrackSession: {
      coords: [
        [24.00, 121.00],
        [24.01, 121.02],
        [24.02, 121.04],
      ],
      elevations: [100, 120, 130],
      waypoints: [
        [24.00, 121.00],
        [24.02, 121.04],
      ],
      waypointMeta: [
        { waypointId: 'icon-start', label: 'Start', cumDistM: 0 },
        { waypointId: 'icon-end', label: 'End', cumDistM: 3000 },
      ],
      intermediates: [],
    },
    weatherCells: {
      'wp:icon-start': {
        _weatherLoaded: true,
        _weatherLoadState: 'loaded',
        weather: 'sunny Clear',
        _icon: 'sunny',
      },
      'wp:icon-end': {
        _weatherLoaded: true,
        _weatherLoadState: 'loaded',
        _weatherCode: 1,
        _icon: 'sunny',
      },
    },
  });

  await expect.poll(() => weatherRequests.length, { timeout: 5000 }).toBeGreaterThan(0);
  await expect(page.locator('#route-weather-busy-overlay')).toBeHidden({ timeout: 8000 });
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();

  const card = page.locator('.custom-waypoint-icon .wp-weather-card-slot .weather-card').first();
  await expect(card).toBeVisible();
  await expect(card).toContainText(/21/);
});

test('full weather card highlight centers the card and closing it centers the waypoint', async ({ page }) => {
  const loadedCells = (weather, temp) => ({
    _weatherLoaded: true,
    _weatherLoadState: 'loaded',
    weather,
    _icon: weather.split(' ')[0],
    temp,
    precipitation: '0 mm',
    precipProb: '10%',
    windSpeed: '10 km/h',
  });
  await openLayerTestApp(page, {
    roundTrip: '0',
    importedTrackSession: {
      coords: [
        [24.00, 121.00],
        [24.80, 121.80],
      ],
      elevations: [100, 140],
      waypoints: [
        [24.00, 121.00],
        [24.80, 121.80],
      ],
      waypointMeta: [
        { waypointId: 'desktop-card-start', label: 'Start', cumDistM: 0 },
        { waypointId: 'desktop-card-end', label: 'End', cumDistM: 120000 },
      ],
      intermediates: [],
    },
    weatherCells: {
      'wp:desktop-card-start': loadedCells('sunny Clear', '21 C'),
      'wp:desktop-card-end': loadedCells('cloudy Cloudy', '22 C'),
    },
  });

  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded')).toHaveCount(2);
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();

  const card = page.locator('.wp-weather-card-slot .weather-card.full.is-highlighted');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-col-idx', '0');
  await expect(card).toHaveClass(/is-highlighted/);
  await page.waitForTimeout(650);

  const cardOffset = await card.evaluate((el) => {
    const map = document.querySelector('#map');
    const sidePanel = document.querySelector('#side-panel');
    const bottomPanel = document.querySelector('#bottom-panel');
    if (!map) return null;
    const mapRect = map.getBoundingClientRect();
    const panelRect = sidePanel?.classList.contains('open') ? sidePanel.getBoundingClientRect() : null;
    const bottomRect = bottomPanel?.getBoundingClientRect();
    const panelOverlap = panelRect ? Math.max(0, mapRect.right - panelRect.left) : 0;
    const bottomOverlap = bottomRect ? Math.max(0, mapRect.bottom - bottomRect.top) : 0;
    const safeLeft = 16;
    const safeRight = mapRect.width - panelOverlap - 16;
    const safeTop = 16;
    const safeBottom = mapRect.height - bottomOverlap - 12;
    const center = {
      x: mapRect.left + (safeLeft + safeRight) / 2,
      y: mapRect.top + (safeTop + safeBottom) / 2,
    };
    if (!center) return null;
    const rect = el.getBoundingClientRect();
    return {
      dx: rect.left + rect.width / 2 - center.x,
      dy: rect.top + rect.height / 2 - center.y,
    };
  });
  expect(cardOffset).not.toBeNull();
  expect(Math.abs(cardOffset.dx)).toBeLessThan(20);
  expect(Math.abs(cardOffset.dy)).toBeLessThan(24);

  await card.locator('.q-close').click();
  await page.waitForTimeout(350);

  const waypointOffset = await page.evaluate(() => {
    const marker = document.querySelector('.custom-waypoint-icon.is-selected');
    const map = document.querySelector('#map');
    const sidePanel = document.querySelector('#side-panel');
    const bottomPanel = document.querySelector('#bottom-panel');
    if (!marker || !map) return null;
    const mapRect = map.getBoundingClientRect();
    const panelRect = sidePanel?.classList.contains('open') ? sidePanel.getBoundingClientRect() : null;
    const bottomRect = bottomPanel?.getBoundingClientRect();
    const panelOverlap = panelRect ? Math.max(0, mapRect.right - panelRect.left) : 0;
    const bottomOverlap = bottomRect ? Math.max(0, mapRect.bottom - bottomRect.top) : 0;
    const safeLeft = 16;
    const safeRight = mapRect.width - panelOverlap - 16;
    const safeTop = 16;
    const safeBottom = mapRect.height - bottomOverlap - 12;
    const center = {
      x: mapRect.left + (safeLeft + safeRight) / 2,
      y: mapRect.top + (safeTop + safeBottom) / 2,
    };
    const rect = marker.getBoundingClientRect();
    return {
      dx: rect.left + rect.width / 2 - center.x,
      dy: rect.bottom - center.y,
    };
  });
  expect(waypointOffset).not.toBeNull();
  expect(Math.abs(waypointOffset.dx)).toBeLessThan(45);
  expect(Math.abs(waypointOffset.dy)).toBeLessThan(60);
});

test('desktop waypoint weather card controls stay clickable inside the marker', async ({ page }) => {
  const loadedCells = (weather, temp) => ({
    _weatherLoaded: true,
    _weatherLoadState: 'loaded',
    weather,
    _icon: weather.split(' ')[0],
    temp,
    precipitation: '0 mm',
    precipProb: '10%',
    windSpeed: '10 km/h',
  });

  await openLayerTestApp(page, {
    roundTrip: '0',
    importedTrackSession: {
      coords: [
        [24.00, 121.00],
        [24.80, 121.80],
      ],
      elevations: [100, 140],
      waypoints: [
        [24.00, 121.00],
        [24.80, 121.80],
      ],
      waypointMeta: [
        { waypointId: 'desktop-card-control-start', label: 'Start', cumDistM: 0 },
        { waypointId: 'desktop-card-control-end', label: 'End', cumDistM: 120000 },
      ],
      intermediates: [],
    },
    weatherCells: {
      'wp:desktop-card-control-start': loadedCells('sunny Clear', '21 C'),
      'wp:desktop-card-control-end': loadedCells('cloudy Cloudy', '22 C'),
    },
  });

  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded')).toHaveCount(2);
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();

  const card = page.locator('.weather-card.is-highlighted').first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-col-idx', '0');
  await expect(card).toHaveClass(/full/);

  await card.locator('.q-next').click();
  await expect(card).not.toHaveAttribute('data-col-idx', '0');
  const nextColIdx = await card.getAttribute('data-col-idx');
  expect(nextColIdx).toBeTruthy();

  await card.locator('.q-prev').click();
  await expect(card).toHaveAttribute('data-col-idx', '0');

  await card.locator('.wc-header').click({ position: { x: 2, y: 12 } });
  await expect(card).not.toHaveClass(/full/);

  await card.locator('.q-toggle').click();
  await expect(card).toHaveClass(/full/);

  await card.locator('.q-weather-icon-close').click();
  await expect(page.locator('.weather-card[data-col-idx="0"]')).toHaveCount(0);

  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/full/);

  await card.locator('.q-close').click();
  await expect(page.locator('.weather-card[data-col-idx="0"]')).toHaveCount(0);
});

test('full-card navigation keeps waypoint and intermediate cards centered', async ({ page }) => {
  const loadedCells = (weather, temp) => ({
    _weatherLoaded: true,
    _weatherLoadState: 'loaded',
    weather,
    _icon: weather.split(' ')[0],
    temp,
    precipitation: '0 mm',
    precipProb: '10%',
    windSpeed: '10 km/h',
  });

  await openLayerTestApp(page, {
    roundTrip: '0',
    importedTrackSession: {
      coords: [
        [24.00, 121.00],
        [24.40, 121.40],
        [24.80, 121.80],
      ],
      elevations: [100, 120, 140],
      waypoints: [
        [24.00, 121.00],
        [24.80, 121.80],
      ],
      waypointMeta: [
        { waypointId: 'desktop-card-nav-start', label: 'Start', cumDistM: 0 },
        { waypointId: 'desktop-card-nav-end', label: 'End', cumDistM: 120000 },
      ],
      intermediates: [
        { lat: 24.40, lng: 121.40, label: 'Mid', cumDistM: 60000, ele: 120 },
      ],
    },
    weatherCells: {
      'wp:desktop-card-nav-start': loadedCells('sunny Clear', '21 C'),
      'int:60000': loadedCells('cloudy Cloudy', '22 C'),
      'wp:desktop-card-nav-end': loadedCells('cloudy Cloudy', '22 C'),
    },
  });

  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded')).toHaveCount(2);
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();

  const card = page.locator('.wp-weather-card-slot .weather-card.full.is-highlighted');
  await expect(card).toBeVisible();

  const midColIdx = await page.locator('#weather-table-container .wt-col-head').evaluateAll((heads) => {
    const mid = heads.find((head) => (head.textContent || '').includes('Mid'));
    return mid?.dataset.idx || '';
  });
  expect(midColIdx).not.toBe('');

  for (let i = 0; i < 3; i++) {
    if ((await card.getAttribute('data-col-idx')) === midColIdx) break;
    await card.locator('.q-next').click();
    await expect(card).toBeVisible();
  }
  await expect(card).toHaveAttribute('data-col-idx', midColIdx);
  await page.waitForTimeout(650);

  const cardOffset = await card.evaluate((el) => {
    const map = document.querySelector('#map');
    const sidePanel = document.querySelector('#side-panel');
    const bottomPanel = document.querySelector('#bottom-panel');
    if (!map) return null;
    const mapRect = map.getBoundingClientRect();
    const panelRect = sidePanel?.classList.contains('open') ? sidePanel.getBoundingClientRect() : null;
    const bottomRect = bottomPanel?.getBoundingClientRect();
    const panelOverlap = panelRect ? Math.max(0, mapRect.right - panelRect.left) : 0;
    const bottomOverlap = bottomRect ? Math.max(0, mapRect.bottom - bottomRect.top) : 0;
    const safeLeft = 16;
    const safeRight = mapRect.width - panelOverlap - 16;
    const safeTop = 16;
    const safeBottom = mapRect.height - bottomOverlap - 12;
    const center = {
      x: mapRect.left + (safeLeft + safeRight) / 2,
      y: mapRect.top + (safeTop + safeBottom) / 2,
    };
    const rect = el.getBoundingClientRect();
    return {
      dx: rect.left + rect.width / 2 - center.x,
      dy: rect.top + rect.height / 2 - center.y,
    };
  });
  expect(cardOffset).not.toBeNull();
  expect(Math.abs(cardOffset.dx)).toBeLessThan(20);
  expect(Math.abs(cardOffset.dy)).toBeLessThan(24);
});

test.describe('mobile weather cards', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('map waypoint weather card reads values shown in the weather table', async ({ page }) => {
    await openLayerTestApp(page, {
      roundTrip: '0',
      importedTrackSession: {
        coords: [
          [24.00, 121.00],
          [24.01, 121.02],
          [24.02, 121.04],
        ],
        elevations: [100, 120, 130],
        waypoints: [
          [24.00, 121.00],
          [24.02, 121.04],
        ],
        waypointMeta: [
          { waypointId: 'mobile-start', label: 'Start', cumDistM: 0 },
          { waypointId: 'mobile-end', label: 'End', cumDistM: 3000 },
        ],
        intermediates: [],
      },
      weatherCells: {
        'wp:mobile-start': {
          _weatherLoaded: true,
          _weatherLoadState: 'loaded',
          weather: 'sunny Clear',
          _icon: 'sunny',
        },
      },
    });

    await page.evaluate(() => {
      const setCell = (key, value) => {
        const cell = document.querySelector(`[data-col="0"][data-key="${key}"] .wt-cell-value`);
        if (cell) cell.textContent = value;
      };
      setCell('weather', 'sunny Clear');
      setCell('temp', '21 C');
      setCell('precipitation', '0 mm');
      setCell('precipProb', '10%');
      setCell('windSpeed', '10 km/h');
    });

    await expect(page.locator('[data-col="0"][data-key="temp"] .wt-cell-value')).toHaveText('21 C');
    await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
    await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().tap();

    const card = page.locator('#mobile-weather-card-layer .weather-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/21/);
    await expect(card).toContainText('0 mm');
    await expect(card).toContainText('10%');
  });

  test('full map weather card keeps readable height when bottom weather panel is tall', async ({ page }) => {
    await openLayerTestApp(page, {
      roundTrip: '0',
      importedTrackSession: {
        coords: [
          [24.00, 121.00],
          [24.01, 121.02],
          [24.02, 121.04],
        ],
        elevations: [100, 120, 130],
        waypoints: [
          [24.00, 121.00],
          [24.02, 121.04],
        ],
        waypointMeta: [
          { waypointId: 'mobile-tall-start', label: 'Start', cumDistM: 0 },
          { waypointId: 'mobile-tall-end', label: 'End', cumDistM: 3000 },
        ],
        intermediates: [],
      },
    });

    await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
    await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
    await page.evaluate(() => {
      const panel = document.querySelector('#bottom-panel');
      if (panel) panel.style.height = '760px';
      document.documentElement.style.setProperty('--bottom-panel-height', '760px');
    });

    await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().tap();
    const card = page.locator('#mobile-weather-card-layer .weather-card.full').first();
    await expect(page.locator('#mobile-weather-card-layer .weather-card.full')).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(card).toContainText(/21/);
    await page.waitForTimeout(350);

    const maxHeight = await card.evaluate((el) => parseFloat(getComputedStyle(el).maxHeight));
    expect(maxHeight).toBeGreaterThanOrEqual(220);
    const hitTest = await card.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const samples = [0.2, 0.45, 0.7].map((ratio) => {
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height * ratio));
        return !!document.elementFromPoint(x, y)?.closest?.('.weather-card');
      });
      return {
        bottom: rect.bottom,
        samples,
        viewportHeight: window.innerHeight,
      };
    });
    expect(hitTest.bottom).toBeLessThanOrEqual(hitTest.viewportHeight);
    expect(hitTest.samples.every(Boolean)).toBe(true);
  });

  test('full-card navigation selects the new waypoint and compacting recenters it', async ({ page }) => {
    const loadedCells = (weather, temp) => ({
      _weatherLoaded: true,
      _weatherLoadState: 'loaded',
      weather,
      _icon: weather.split(' ')[0],
      temp,
      precipitation: '0 mm',
      precipProb: '10%',
      windSpeed: '10 km/h',
    });
    const selectedAnchorState = () => page.evaluate(() => {
      const marker = document.querySelector('.custom-waypoint-icon.is-selected');
      const map = document.querySelector('#map');
      const bottomPanel = document.querySelector('#bottom-panel');
      if (!marker || !map) return null;
      const mapRect = map.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      const bottomRect = bottomPanel?.getBoundingClientRect();
      const bottomOverlap = bottomRect ? Math.max(0, mapRect.bottom - bottomRect.top) : 0;
      const safeLeft = 12;
      const safeRight = mapRect.width - 12;
      const safeTop = 20;
      const safeBottom = mapRect.height - bottomOverlap - 8;
      const targetX = mapRect.left + (safeLeft + safeRight) / 2;
      const targetY = mapRect.top + (safeTop + safeBottom) / 2;
      const anchorX = markerRect.left + markerRect.width / 2;
      const anchorY = markerRect.bottom;
      return {
        dx: anchorX - targetX,
        dy: anchorY - targetY,
        inSafe: anchorX >= mapRect.left + safeLeft
          && anchorX <= mapRect.left + safeRight
          && anchorY >= mapRect.top + safeTop
          && anchorY <= mapRect.top + safeBottom,
      };
    });

    await openLayerTestApp(page, {
      roundTrip: '0',
      importedTrackSession: {
        coords: [
          [24.00, 121.00],
          [24.80, 121.80],
        ],
        elevations: [100, 140],
        waypoints: [
          [24.00, 121.00],
          [24.80, 121.80],
        ],
        waypointMeta: [
          { waypointId: 'mobile-nav-start', label: 'Start', cumDistM: 0 },
          { waypointId: 'mobile-nav-end', label: 'End', cumDistM: 120000 },
        ],
        intermediates: [],
      },
      weatherCells: {
        'wp:mobile-nav-start': loadedCells('sunny Clear', '21 C'),
        'wp:mobile-nav-end': loadedCells('cloudy Cloudy', '22 C'),
      },
    });

    await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded')).toHaveCount(2);
    await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
    await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().tap();

    const fullCard = page.locator('#mobile-weather-card-layer .weather-card.full');
    await expect(fullCard).toBeVisible();
    await expect(fullCard).toHaveAttribute('data-col-idx', '0');

    await fullCard.locator('.q-next').tap();
    await expect(fullCard).toHaveAttribute('data-col-idx', '2');
    await expect(fullCard).toHaveClass(/is-highlighted/);
    await expect(page.locator('.custom-waypoint-icon.is-selected .wp-icon-inner span')).toHaveText('2');
    await page.waitForTimeout(350);

    const fullOffset = await selectedAnchorState();
    expect(fullOffset).not.toBeNull();
    expect(fullOffset.inSafe).toBe(true);

    await fullCard.locator('.q-toggle').tap();
    await expect(page.locator('.custom-waypoint-icon.is-selected .wp-weather-card-slot .weather-card:not(.full)')).toBeVisible();
    await page.waitForTimeout(350);

    const offset = await selectedAnchorState();

    expect(offset).not.toBeNull();
    expect(Math.abs(offset.dx)).toBeLessThan(35);
    expect(Math.abs(offset.dy)).toBeLessThan(55);
  });
});

test('double-clicking an overlapped route marker cycles visible layer order', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);
  await expect.poll(async () =>
    (await waypointPairState(page)).find((pair) => pair.number === 1)?.hasReturn ?? false
  ).toBe(true);

  const before = await layerState(page);
  const routePoint = await page.evaluate(() => {
    const path = Array.from(document.querySelectorAll('.leaflet-overlay-pane path:not(.route-hit-line)')).at(-1);
    if (!path) return null;
    const rect = path.getBoundingClientRect();
    return { x: rect.x + rect.width * 0.25, y: rect.y + rect.height / 2 };
  });
  expect(routePoint).not.toBeNull();

  await page.mouse.dblclick(routePoint.x, routePoint.y);
  await expect.poll(async () => {
    const state = await layerState(page);
    return {
      routeChanged: state.topStroke !== before.topStroke,
      returnAboveOutbound: state.returnAboveOutbound,
    };
  }).toMatchObject({
    routeChanged: true,
    returnAboveOutbound: !before.returnAboveOutbound,
  });
});

test('route layer cycling moves an already highlighted waypoint to the switched-up leg', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);
  await expect.poll(async () =>
    (await waypointPairState(page)).find((pair) => pair.number === 1)?.hasReturn ?? false
  ).toBe(true);

  const waypoint = await topWaypointCenter(page, 1);
  await page.mouse.dblclick(waypoint.x, waypoint.y);
  await expect.poll(async () => await selectedWaypointState(page, 1)).toMatchObject({
    selectedCount: 1,
    selectedIsReturn: true,
    topIsReturn: true,
  });

  const before = await layerState(page);
  const routePoint = await page.evaluate(() => {
    const path = Array.from(document.querySelectorAll('.leaflet-overlay-pane path:not(.route-hit-line)')).at(-1);
    if (!path) return null;
    const rect = path.getBoundingClientRect();
    return { x: rect.x + rect.width * 0.25, y: rect.y + rect.height / 2 };
  });
  expect(routePoint).not.toBeNull();

  await page.mouse.dblclick(routePoint.x, routePoint.y);
  await expect.poll(async () => {
    const state = await layerState(page);
    const selected = await selectedWaypointState(page, 1);
    return {
      routeChanged: state.topStroke !== before.topStroke,
      returnAboveOutbound: state.returnAboveOutbound,
      selectedIsReturn: selected.selectedIsReturn,
      topIsReturn: selected.topIsReturn,
    };
  }).toMatchObject({
    routeChanged: true,
    returnAboveOutbound: false,
    selectedIsReturn: false,
    topIsReturn: false,
  });
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

test('long-press dragging a return waypoint edits its paired outbound waypoint instead of cycling layers', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  let target = await topWaypointCenter(page, 1);
  await page.mouse.dblclick(target.x, target.y);
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(true);

  const beforeLayer = await layerState(page);
  const outboundBefore = await waypointCenter(page, 1, false);
  const returnBefore = await waypointCenter(page, 1, true);
  const storedBefore = await storedWaypoints(page);
  expect(storedBefore).toHaveLength(2);
  const releasePoint = { x: returnBefore.x + 90, y: returnBefore.y + 35 };
  await startLongPressWaypointDrag(page, returnBefore);
  await finishLongPressWaypointDrag(page, releasePoint);

  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  const outboundAfter = await waypointCenter(page, 1, false);
  const storedAfter = await storedWaypoints(page);
  expect(storedAfter).toHaveLength(2);
  expect(coordinateDistance(storedAfter[0], storedBefore[0])).toBeGreaterThan(0.0001);
  expect(coordinateDistance(storedAfter[1], storedBefore[1])).toBeLessThan(0.000001);
  expect(Math.hypot(outboundAfter.x - outboundBefore.x, outboundAfter.y - outboundBefore.y)).toBeGreaterThan(30);
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(beforeLayer.returnAboveOutbound);
});

test('long-press dragging an outbound waypoint tolerates movement before activation', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const before = await waypointCenter(page, 2, false);
  const storedBefore = await storedWaypoints(page);
  expect(storedBefore).toHaveLength(2);
  const releasePoint = { x: before.x + 95, y: before.y + 30 };
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.move(before.x + 18, before.y + 7, { steps: 3 });
  await page.waitForTimeout(LONG_PRESS_MS);
  await expect(page.locator('.waypoint-trash-zone')).toBeVisible();
  await page.mouse.move(releasePoint.x, releasePoint.y, { steps: 8 });
  const whileDragging = await waypointCenter(page, 2, false);
  expect(Math.hypot(whileDragging.x - releasePoint.x, whileDragging.y - releasePoint.y)).toBeLessThan(10);
  await page.mouse.up();
  await expect(page.locator('.leaflet-marker-pane .custom-waypoint-icon.is-dragging')).toHaveCount(0);

  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  const storedAfter = await storedWaypoints(page);
  expect(storedAfter).toHaveLength(2);
  expect(coordinateDistance(storedAfter[1], storedBefore[1])).toBeGreaterThan(0.0001);
  expect(coordinateDistance(storedAfter[0], storedBefore[0])).toBeLessThan(0.000001);
});

test('long-press dragging a waypoint into the trash zone deletes it', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const target = await topWaypointCenter(page, 2);
  await startLongPressWaypointDrag(page, target);

  await finishLongPressWaypointDrag(page, await dropZoneTargetCenter(page, 'delete'));

  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await expect(page.locator('.waypoint-trash-zone')).not.toBeVisible();
});

test('long-press dragging a waypoint into the cancel zone leaves it unchanged', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const before = await topWaypointCenter(page, 1);
  await startLongPressWaypointDrag(page, before);
  await expect(page.locator('.waypoint-drop-cancel')).toBeVisible();
  await expect(page.locator('.waypoint-drop-delete')).toBeVisible();

  await finishLongPressWaypointDrag(page, await dropZoneTargetCenter(page, 'cancel'));

  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  const after = await topWaypointCenter(page, 1);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(6);
  await expect(page.locator('.waypoint-trash-zone')).not.toBeVisible();
});

test.describe('touch waypoint gestures', () => {
  test.use({ hasTouch: true });

  test('touch double-tapping an overlapped waypoint cycles visible layer order', async ({ page }) => {
    await openLayerTestApp(page);
    await addRoundTripWaypoints(page);

    const before = await layerState(page);
    const target = await topWaypointCenter(page, 1);
    await touchDoubleTap(page, target);

    await expect.poll(async () => (await layerState(page)).returnAboveOutbound)
      .toBe(!before.returnAboveOutbound);
    await expect(page.locator('.leaflet-marker-pane .custom-waypoint-icon.is-dragging')).toHaveCount(0);
    await expect(page.locator('.waypoint-trash-zone')).not.toBeVisible();
  });

  test('touch long-press dragging a return waypoint does not cycle its layer', async ({ page }) => {
    await openLayerTestApp(page);
    await addRoundTripWaypoints(page);

    const target = await topWaypointCenter(page, 1);
    await touchDoubleTap(page, target);
    await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(true);

    const beforeLayer = await layerState(page);
    const returnBefore = await waypointCenter(page, 1, true);
    const storedBefore = await storedWaypoints(page);
    expect(storedBefore).toHaveLength(2);

    await touchLongPressDrag(page, returnBefore, {
      x: returnBefore.x + 90,
      y: returnBefore.y + 35,
    });

    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
    const storedAfter = await storedWaypoints(page);
    expect(storedAfter).toHaveLength(2);
    expect(coordinateDistance(storedAfter[0], storedBefore[0])).toBeGreaterThan(0.0001);
    expect(coordinateDistance(storedAfter[1], storedBefore[1])).toBeLessThan(0.000001);
    await expect.poll(async () => (await layerState(page)).returnAboveOutbound)
      .toBe(beforeLayer.returnAboveOutbound);
  });

  test('touch long-press dragging survives weather marker updates while loading', async ({ page }) => {
    await openLayerTestApp(page, { weatherDelayMs: 600 });
    await addRoundTripWaypoints(page);

    const before = await waypointCenter(page, 1, false);
    const storedBefore = await storedWaypoints(page);
    expect(storedBefore).toHaveLength(2);

    await expect(page.locator('[data-action="fetch"]').first()).toBeDisabled({ timeout: 4000 });
    await touchLongPressDrag(page, before, {
      x: before.x + 85,
      y: before.y + 30,
    });

    const storedAfter = await storedWaypoints(page);
    expect(storedAfter).toHaveLength(2);
    expect(coordinateDistance(storedAfter[0], storedBefore[0])).toBeGreaterThan(0.0001);
    expect(coordinateDistance(storedAfter[1], storedBefore[1])).toBeLessThan(0.000001);
  });
});

test('long-press dragging a route inserts a waypoint at the release position', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const routeState = await routeOverlapState(page);
  expect(routeState.point).not.toBeNull();
  const releasePoint = {
    x: routeState.point.x + 80,
    y: routeState.point.y + 70,
  };

  await longPressDragRoute(page, routeState.point, releasePoint);

  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(3);
  const inserted = await topWaypointCenter(page, 2);
  expect(Math.hypot(inserted.x - releasePoint.x, inserted.y - releasePoint.y)).toBeLessThan(45);
});

test('double-clicking a route overlap with four stacked legs cycles every visible layer', async ({ page }) => {
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
    await doubleClickRouteOverlap(page);
    await expect.poll(async () => (await routeOverlapState(page)).topStroke).not.toBe(before.topStroke);
    cycle.push((await routeOverlapState(page)).topStroke);
    await expect(waypointCount).toHaveCount(5);
  }

  expect(new Set(cycle.slice(0, -1)).size).toBeGreaterThanOrEqual(4);
  expect(cycle.at(-1)).toBe(cycle[0]);
});
