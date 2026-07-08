import { expect, test } from '@playwright/test';
import { collectUnexpectedConsoleErrors } from './helpers/consoleErrors.js';

const VISIBLE_ROUTE_PATH_SELECTOR = '.leaflet-overlay-pane path:not(.route-hit-line)';

async function openCacheVersionApp(page) {
  const consoleErrors = collectUnexpectedConsoleErrors(page);

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '1');
    localStorage.setItem('mappingElf_segmentKm', '0');
    window.__mappingElfTestHooks = { events: [] };
  });

  await page.route('**/route/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const coordPart = url.pathname.split('/').pop();
    const coords = coordPart.split(';').map((coord) => coord.split(',').map(Number));
    await route.fulfill({
      json: {
        code: 'Ok',
        routes: [{
          distance: 12_000,
          duration: 10_800,
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

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  return consoleErrors;
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
  await expect(page.locator(VISIBLE_ROUTE_PATH_SELECTOR)).toHaveCount(1);
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  // The bottom panel now toggles between the elevation chart and the weather
  // table (defaults to the chart); switch to the weather view to see the header.
  await page.locator('#bp-view-toggle [data-bp-view="weather"]').click();
  await expect(page.locator('#weather-table-container .wt-header-row-label .wt-col-head').first()).toBeVisible();
}

async function clearHookEvents(page) {
  await page.evaluate(() => {
    if (window.__mappingElfTestHooks) window.__mappingElfTestHooks.events = [];
  });
}

async function expectCacheEvent(page, type, status) {
  await expect.poll(async () => page.evaluate(({ type, status }) => {
    const events = window.__mappingElfTestHooks?.events || [];
    return events.some((event) => event.type === type && event.detail?.status === status);
  }, { type, status })).toBe(true);
}

test('route and pace computation caches hit until their version inputs change', async ({ page }) => {
  const consoleErrors = await openCacheVersionApp(page);

  await addWaypointsAtFractions(page, [
    [0.40, 0.50],
    [0.58, 0.50],
  ]);

  await clearHookEvents(page);
  await page.locator('#weather-table-container .wt-ctrl-collapse').first().evaluate((button) => button.click());
  await expectCacheEvent(page, 'route-metrics-cache', 'hit');
  await expectCacheEvent(page, 'pace-computation-cache', 'hit');

  await clearHookEvents(page);
  await page.locator('#speed-activity-select').selectOption('walking');
  await expectCacheEvent(page, 'pace-computation-cache', 'miss');
  await expectCacheEvent(page, 'route-metrics-cache', 'hit');

  await clearHookEvents(page);
  await page.locator('input[name="route-mode"][value="cycling"]').evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expectCacheEvent(page, 'route-metrics-cache', 'miss');

  expect(consoleErrors).toEqual([]);
});
