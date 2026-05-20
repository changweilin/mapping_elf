import { expect, test } from '@playwright/test';
import { collectUnexpectedConsoleErrors } from './helpers/consoleErrors.js';

const VISIBLE_ROUTE_PATH_SELECTOR = '.leaflet-overlay-pane path:not(.route-hit-line)';

async function openWeatherRegressionApp(page, options = {}) {
  const {
    roundTrip = '1',
    oLoop = '0',
    speedMode = '0',
    segmentKm = '0',
    perSegment = '0',
  } = options;
  const consoleErrors = collectUnexpectedConsoleErrors(page);

  await page.addInitScript(({ roundTrip, oLoop, speedMode, segmentKm, perSegment }) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', roundTrip);
    localStorage.setItem('mappingElf_oLoop', oLoop);
    localStorage.setItem('mappingElf_speedMode', speedMode);
    localStorage.setItem('mappingElf_segmentKm', segmentKm);
    localStorage.setItem('mappingElf_perSegment', perSegment);
  }, { roundTrip, oLoop, speedMode, segmentKm, perSegment });

  await page.route('**/route/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const coordPart = url.pathname.split('/').pop();
    const coords = coordPart.split(';').map((coord) => coord.split(',').map(Number));
    await route.fulfill({
      json: {
        code: 'Ok',
        routes: [{
          distance: 12000,
          duration: 10800,
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
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  await expect(page.locator(VISIBLE_ROUTE_PATH_SELECTOR).first()).toBeVisible();
}

async function weatherColumnSnapshot(page) {
  return page.locator('#weather-table-container .wt-header-row-label .wt-col-head').evaluateAll((heads) => {
    const container = document.getElementById('weather-table-container');
    return heads.map((th) => {
      const idx = Number.parseInt(th.dataset.idx, 10);
      const labelEl = th.querySelector('.wt-col-label');
      const label = Array.from(labelEl?.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join('')
        .trim();
      return {
        idx,
        label,
        isInterval: th.classList.contains('wt-interval-col'),
        isReturn: th.classList.contains('wt-return-col'),
        date: container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`)?.value || '',
        hour: Number.parseInt(container.querySelector(`.wt-th-time[data-idx="${idx}"] .wt-time-select`)?.value || '', 10),
      };
    });
  });
}

function columnTimeMs(column) {
  return new Date(`${column.date}T00:00:00`).getTime() + column.hour * 60 * 60 * 1000;
}

test('round-trip per-segment weather timeline stays monotonic and keeps interval schedules ephemeral', async ({ page }) => {
  const consoleErrors = await openWeatherRegressionApp(page, {
    roundTrip: '1',
    speedMode: '1',
    perSegment: '1',
  });

  await addCoordinateSearchWaypoints(page, [
    [25.0300, 121.5000],
    [25.0800, 121.5500],
    [25.1300, 121.6000],
  ]);

  await expect(page.locator('#weather-table-container .wt-header-row-label .wt-col-head.wt-return-col')).not.toHaveCount(0);
  await expect(page.locator('#weather-table-container .wt-header-row-label .wt-col-head.wt-interval-col')).not.toHaveCount(0);

  const columns = await weatherColumnSnapshot(page);
  expect(columns.some((column) => column.isReturn)).toBe(true);
  expect(columns.some((column) => column.isInterval)).toBe(true);

  const times = columns.map(columnTimeMs);
  for (const time of times) {
    expect(Number.isFinite(time)).toBe(true);
  }
  for (let i = 1; i < times.length; i++) {
    expect(times[i], `${columns[i - 1].label} -> ${columns[i].label}`).toBeGreaterThanOrEqual(times[i - 1]);
  }

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_weather') || 'null'));
  expect(stored).toBeTruthy();
  expect(Object.keys(stored.byKey || {}).some((key) => key.startsWith('int:'))).toBe(false);

  const intervalIndices = columns.filter((column) => column.isInterval).map((column) => column.idx);
  for (const idx of intervalIndices) {
    expect(stored.cols?.[idx] ?? null).toBeNull();
  }

  const waypointIndices = columns.filter((column) => !column.isInterval).map((column) => column.idx);
  for (const idx of waypointIndices) {
    expect(stored.cols?.[idx]).toEqual(expect.objectContaining({
      date: expect.any(String),
      hour: expect.anything(),
    }));
  }

  expect(consoleErrors).toEqual([]);
});

test('O-loop weather columns end at the synthetic return-to-start waypoint', async ({ page }) => {
  const consoleErrors = await openWeatherRegressionApp(page, {
    roundTrip: '0',
    oLoop: '1',
    speedMode: '1',
  });

  await addCoordinateSearchWaypoints(page, [
    [25.0300, 121.5000],
    [25.0800, 121.5500],
    [25.1300, 121.6000],
  ]);

  await expect(page.locator('#weather-table-container .wt-header-row-label .wt-col-head.wt-return-col')).not.toHaveCount(0);
  const columns = await weatherColumnSnapshot(page);
  const returnWaypoints = columns.filter((column) => column.isReturn && !column.isInterval);

  expect(returnWaypoints).toHaveLength(1);
  expect(columns.at(-1)).toEqual(expect.objectContaining({
    isReturn: true,
    isInterval: false,
  }));
  expect(columns.at(-1).label).toBe(columns[0].label);

  expect(consoleErrors).toEqual([]);
});
