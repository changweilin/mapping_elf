import { expect, test } from '@playwright/test';

function weatherPayload() {
  return {
    daily: {
      time: ['2026-05-13'],
      temperature_2m_max: [24],
      temperature_2m_min: [18],
      precipitation_sum: [0],
      weathercode: [1],
      windspeed_10m_max: [12],
      windgusts_10m_max: [18],
      sunrise: ['2026-05-13T05:10'],
      sunset: ['2026-05-13T18:30'],
      sunshine_duration: [18000],
      precipitation_probability_max: [10],
      uv_index_max: [7],
      shortwave_radiation_sum: [19],
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `2026-05-13T${String(h).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, () => '21°C'),
      apparent_temperature: Array.from({ length: 24 }, () => '20°C'),
      relative_humidity_2m: Array.from({ length: 24 }, () => '65%'),
      dewpoint_2m: Array.from({ length: 24 }, () => '14°C'),
      precipitation: Array.from({ length: 24 }, () => '0 mm'),
      precipitation_probability: Array.from({ length: 24 }, () => '10%'),
      weathercode: Array.from({ length: 24 }, () => 1),
      windspeed_10m: Array.from({ length: 24 }, () => '10 km/h'),
      windgusts_10m: Array.from({ length: 24 }, () => '16 km/h'),
      uv_index: Array.from({ length: 24 }, () => 4),
      visibility: Array.from({ length: 24 }, () => 10000),
      cloudcover: Array.from({ length: 24 }, () => '25%'),
    },
    elevation: 100,
  };
}

test('opened map waypoint weather card keeps weather values visible', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
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
  await page.route('**/v1/forecast**', async (route) => route.fulfill({ json: weatherPayload() }));
  await page.route('**/v1/archive**', async (route) => route.fulfill({ json: weatherPayload() }));
  await page.route('**/v1/elevation**', async (route) => {
    const url = new URL(route.request().url());
    const count = (url.searchParams.get('latitude') || '').split(',').filter(Boolean).length || 2;
    await route.fulfill({ json: { elevation: Array.from({ length: count }, () => 100) } });
  });

  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  const card = page.locator('.custom-waypoint-icon .wp-weather-card-slot .weather-card').first();
  await expect(card).toContainText(/21.C/);
  await expect(card.locator('.wc-weather-desc')).toHaveCSS('position', 'static');
  await expect(card.locator('.wc-info-value').first()).toHaveCSS('position', 'static');
});
