import { expect, test } from '@playwright/test';

async function openLayerTestApp(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '1');
    localStorage.setItem('mappingElf_oLoop', '0');
  });

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
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(2);
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

async function layerState(page) {
  return page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll('.leaflet-overlay-pane path'));
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
    const path = Array.from(document.querySelectorAll('.leaflet-overlay-pane path')).at(-1);
    if (!path) return null;
    const rect = path.getBoundingClientRect();
    return { x: rect.x + rect.width * 0.25, y: rect.y + rect.height / 2 };
  });
  expect(routePoint).not.toBeNull();

  await page.mouse.dblclick(routePoint.x, routePoint.y);
  await expect.poll(async () => (await layerState(page)).topStroke).not.toBe(before.topStroke);
});

test('round-trip mirrored waypoint pairs toggle except the turnaround endpoint', async ({ page }) => {
  await openLayerTestApp(page);
  await addWaypointsAtFractions(page, [
    [0.36, 0.56],
    [0.46, 0.46],
    [0.56, 0.56],
    [0.66, 0.46],
  ]);
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(6);

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

test('long-pressing an overlapped waypoint toggles both directions without dragging', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const pressTopWaypoint = async () => {
    const target = await page.evaluate(() => {
      const markers = Array.from(document.querySelectorAll('.leaflet-marker-pane .custom-waypoint-icon'))
        .filter((el) => Number.parseInt(el.textContent.trim().replace(/^\D*/, ''), 10) === 1)
        .map((el) => ({ el, z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0 }))
        .sort((a, b) => b.z - a.z)[0]?.el;
      if (!markers) return null;
      const rect = markers.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    expect(target).not.toBeNull();
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.move(target.x + 3, target.y + 2);
    await page.mouse.up();
  };

  await pressTopWaypoint();
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(true);
  await expect(page.locator('.leaflet-marker-pane .custom-waypoint-icon.is-dragging')).toHaveCount(0);

  await pressTopWaypoint();
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(false);
  await expect(page.locator('.leaflet-marker-pane .custom-waypoint-icon.is-dragging')).toHaveCount(0);
});
