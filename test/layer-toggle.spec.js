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

  await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.50);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.50);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(2);
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

test('double-clicking an overlapped waypoint cycles visible layer order', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const before = await layerState(page);
  const waypoint = await page.locator('.leaflet-marker-pane .custom-waypoint-icon').first().boundingBox();
  expect(waypoint).not.toBeNull();
  await page.mouse.dblclick(waypoint.x + waypoint.width / 2, waypoint.y + waypoint.height / 2);
  await expect.poll(async () => (await layerState(page)).topStroke).not.toBe(before.topStroke);
  await expect.poll(async () => (await layerState(page)).returnAboveOutbound).toBe(true);
});

test('double-clicking an overlapped route marker cycles visible layer order', async ({ page }) => {
  await openLayerTestApp(page);
  await addRoundTripWaypoints(page);

  const before = await layerState(page);
  const intermediate = await page.locator('.intermediate-point-inner').first().boundingBox();
  expect(intermediate).not.toBeNull();

  await page.mouse.dblclick(intermediate.x + intermediate.width / 2, intermediate.y + intermediate.height / 2);
  await expect.poll(async () => (await layerState(page)).topStroke).not.toBe(before.topStroke);
});
