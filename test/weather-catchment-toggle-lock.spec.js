import { expect, test } from '@playwright/test';
import { coneElevation, flood } from './helpers/apiMocks.mjs';

function forecast(page) {
  return page.route(/v1\/forecast/, (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start_date') || '2026-07-18';
    const end = url.searchParams.get('end_date') || start;
    const hourlyVars = (url.searchParams.get('hourly') || '').split(',').filter(Boolean);
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const times = [];
    for (const day of days) for (let h = 0; h < 24; h++) times.push(`${day}T${String(h).padStart(2, '0')}:00`);
    const val = (n) => {
      if (n === 'precipitation') return 8;
      if (n.startsWith('soil_moisture')) return 0.35;
      if (n === 'et0_fao_evapotranspiration') return 0.2;
      if (n === 'temperature_2m') return 21;
      if (n === 'apparent_temperature') return 20;
      if (n === 'relative_humidity_2m') return 88;
      if (n === 'precipitation_probability') return 90;
      if (n === 'weathercode') return 61;
      if (n === 'windspeed_10m') return 15;
      if (n === 'windgusts_10m') return 30;
      if (n === 'cloudcover') return 95;
      return 1;
    };
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}

async function setupRouteWithSettings(page, { wpDetailWeather = '1', wpDetailCatchment = '1' } = {}) {
  await page.addInitScript(({ wpDetailWeather, wpDetailCatchment }) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_collectiveMarked', '0');
    localStorage.setItem('mappingElf_wpDetailWeather', wpDetailWeather);
    localStorage.setItem('mappingElf_wpDetailCatchment', wpDetailCatchment);
  }, { wpDetailWeather, wpDetailCatchment });

  await page.route('**/route/v1/**', (route) => {
    const coordPart = new URL(route.request().url()).pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 1000, duration: 1000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
  await forecast(page);
  await flood(page);
  await coneElevation(page);

  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
  await page.waitForFunction(() => !document.body.classList.contains('weather-card-busy'));
}

async function openFirstCardFull(page) {
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await page.locator('.weather-card').first().waitFor();
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().click();
  }
  return page.locator('.weather-card.full').first().getAttribute('id');
}

test('無基礎天氣4項以外資訊時，天氣切換鍵鎖定無法切換至天氣', async ({ page }) => {
  // wpDetailWeather=0 (no weather details beyond basic 4), wpDetailCatchment=1
  await setupRouteWithSettings(page, { wpDetailWeather: '0', wpDetailCatchment: '1' });

  const cardId = await openFirstCardFull(page);
  const card = page.locator(`#${cardId}`);
  await expect(card).toBeVisible();

  const weatherBtn = card.locator('.wc-view-btn[data-wc-view="weather"]');
  const catchmentBtn = card.locator('.wc-view-btn[data-wc-view="catchment"]');

  // Weather toggle key is locked (disabled)
  await expect(weatherBtn).toBeDisabled();
  // Catchment toggle key is unlocked
  await expect(catchmentBtn).toBeEnabled();

  // Switch to catchment view
  await catchmentBtn.dispatchEvent('click');
  await expect(card.locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });

  // Attempt to switch to weather -> blocked because weather button is locked
  await weatherBtn.dispatchEvent('click');
  await page.waitForTimeout(500);
  await expect(card.locator('.wc-catchment')).toBeVisible();
});

test('無基礎天氣4項以外資訊時，集水區切換鍵鎖定無法切換至集水區', async ({ page }) => {
  // wpDetailWeather=1, wpDetailCatchment=0 (no catchment details beyond basic 4)
  await setupRouteWithSettings(page, { wpDetailWeather: '1', wpDetailCatchment: '0' });

  const cardId = await openFirstCardFull(page);
  const card = page.locator(`#${cardId}`);
  await expect(card).toBeVisible();

  const weatherBtn = card.locator('.wc-view-btn[data-wc-view="weather"]');
  const catchmentBtn = card.locator('.wc-view-btn[data-wc-view="catchment"]');

  // Weather toggle key is unlocked (active)
  await expect(weatherBtn).toBeEnabled();
  // Catchment toggle key is locked (disabled)
  await expect(catchmentBtn).toBeDisabled();

  // Card shows weather view
  await expect(card.locator('.wc-catchment')).toHaveCount(0);
  await expect(card.locator('.wc-windy-btn')).toBeVisible();

  // Attempt to switch to catchment -> blocked
  await catchmentBtn.dispatchEvent('click');
  await page.waitForTimeout(500);
  await expect(card.locator('.wc-catchment')).toHaveCount(0);
  await expect(page.locator('#map .leaflet-overlay-pane path.wc-catchment-poly')).toHaveCount(0);
});

test('天氣與集水區皆有詳細資訊時，切換鍵正常解鎖可自由切換', async ({ page }) => {
  // wpDetailWeather=1, wpDetailCatchment=1
  await setupRouteWithSettings(page, { wpDetailWeather: '1', wpDetailCatchment: '1' });

  const cardId = await openFirstCardFull(page);
  const card = page.locator(`#${cardId}`);
  await expect(card).toBeVisible();

  const weatherBtn = card.locator('.wc-view-btn[data-wc-view="weather"]');
  const catchmentBtn = card.locator('.wc-view-btn[data-wc-view="catchment"]');

  await expect(weatherBtn).toBeEnabled();
  await expect(catchmentBtn).toBeEnabled();

  // Switch to catchment
  await catchmentBtn.dispatchEvent('click');
  await expect(card.locator('.wc-catchment')).toContainText('集水區面積', { timeout: 20000 });

  // Switch back to weather
  await weatherBtn.dispatchEvent('click');
  await expect(card.locator('.wc-catchment')).toHaveCount(0);
  await expect(card.locator('.wc-windy-btn')).toBeVisible();
});
