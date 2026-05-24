import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const shortGpx = path.join(repoRoot, 'data', 'app-test-routes', 'short-zh-weather.gpx');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openRaceApp(page, options = {}) {
  const {
    routeDelayMs = 0,
    geocodeDelayMs = 0,
    routeEvents = [],
    geocodeEvents = [],
  } = options;

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    window.__mappingElfTestHooks = { events: [] };
  });

  await page.route('**/route/v1/**', async (route) => {
    const url = new URL(route.request().url());
    routeEvents.push({ type: 'start', url: route.request().url() });
    const coordPart = url.pathname.split('/').pop();
    const coords = coordPart.split(';').map((coord) => coord.split(',').map(Number));
    if (routeDelayMs > 0) await wait(routeDelayMs);
    routeEvents.push({ type: 'finish', url: route.request().url() });
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

  await page.route('**/v1/forecast**', async (route) => route.fulfill({ json: weatherPayload() }));
  await page.route('**/v1/archive**', async (route) => route.fulfill({ json: weatherPayload() }));

  await page.route('**/reverse?**', async (route) => {
    geocodeEvents.push({ type: 'reverse', url: route.request().url() });
    if (geocodeDelayMs > 0) await wait(geocodeDelayMs);
    await route.fulfill({
      json: {
        name: 'Old Peak',
        category: 'natural',
        type: 'peak',
        lat: '24.1000',
        lon: '121.1000',
        address: {},
      },
    });
  });

  await page.route('**/api/interpreter', async (route) => {
    geocodeEvents.push({ type: 'overpass', url: route.request().url() });
    if (geocodeDelayMs > 0) await wait(geocodeDelayMs);
    await route.fulfill({
      json: {
        elements: [{
          type: 'node',
          lat: 24.1,
          lon: 121.1,
          tags: { natural: 'peak', name: 'Old Peak' },
        }],
      },
    });
  });

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
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

async function addWaypointsAtFractions(page, points) {
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(i + 1);
  }
}

async function hookEvents(page) {
  return page.evaluate(() => window.__mappingElfTestHooks?.events || []);
}

async function expectHookEvent(page, type) {
  await expect.poll(async () => {
    const events = await hookEvents(page);
    return events.some((event) => event.type === type);
  }).toBe(true);
}

test('stale route result is discarded when a track is imported during planning', async ({ page }) => {
  const routeEvents = [];
  await openRaceApp(page, { routeDelayMs: 1500, routeEvents });

  await addWaypointsAtFractions(page, [
    [0.40, 0.50],
    [0.58, 0.50],
  ]);
  await expect.poll(() => routeEvents.filter((event) => event.type === 'start').length).toBe(1);
  await expect(page.locator('#route-weather-busy-overlay')).toBeVisible();

  await page.locator('#gpx-file-input').setInputFiles(shortGpx);
  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('mappingElf_importedTrack') || 'null');
    return session?.coords?.length || 0;
  })).toBe(7);
  const importedDistance = await page.locator('#stat-distance').textContent();

  await expect.poll(
    () => routeEvents.filter((event) => event.type === 'finish').length,
    { timeout: 5000 },
  ).toBe(1);
  await expectHookEvent(page, 'route-plan-stale-discard');
  await page.waitForTimeout(800);

  expect(routeEvents.filter((event) => event.type === 'start')).toHaveLength(1);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(3);
  expect(await page.locator('#stat-distance').textContent()).toBe(importedDistance);
  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('mappingElf_importedTrack') || 'null');
    return {
      coords: session?.coords?.length || 0,
      waypoints: session?.waypoints?.length || 0,
    };
  })).toEqual({ coords: 7, waypoints: 3 });
});

test('stale geocode result is discarded after waypoint state changes', async ({ page }) => {
  const geocodeEvents = [];
  await openRaceApp(page, { geocodeDelayMs: 700, geocodeEvents });

  await addWaypointsAtFractions(page, [[0.42, 0.52]]);
  await expect.poll(() => geocodeEvents.filter((event) => event.type === 'reverse').length).toBe(1);

  await page.locator('#btn-clear-route').evaluate((button) => button.click());
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(0);

  await expectHookEvent(page, 'geocode-stale-discard');
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(0);
});
