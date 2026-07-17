import { test, expect } from '@playwright/test';

// Verifies the catchment tool's weather + hydrology panel: an adjustable
// date/hour picker (seeded from the weather anchor), a weather section mirroring
// the weather-info rows, and hydrology indicators (soil / antecedent rain /
// runoff / discharge / surge / debris-flow) with risk chips — all evaluated at
// the chosen time and re-fetched when the time changes.

const ANCHOR = [23.5, 121.0]; // mapManager DEFAULT_CENTER

// Cone DEM draining to the centre, so a basin is delineated on a centre click.
async function stubElevation(page) {
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((la, i) => {
      const dy = (la - ANCHOR[0]) * 111320;
      const dx = (lngs[i] - ANCHOR[1]) * 111320 * Math.cos(ANCHOR[0] * Math.PI / 180);
      return 100 + 0.1 * Math.hypot(dx, dy);
    });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}

// One forecast handler feeds BOTH the weather card (temperature, humidity, …)
// and the hydrology module (precipitation, soil_moisture_*, et0). Returns a
// superset payload over the requested [start_date, end_date] hourly window.
function makeForecastHandler(counter) {
  return (route) => {
    counter.n++;
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start_date');
    const end = url.searchParams.get('end_date') || start;
    const hourlyVars = (url.searchParams.get('hourly') || '').split(',').filter(Boolean);
    const dailyVars = (url.searchParams.get('daily') || '').split(',').filter(Boolean);

    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
      days.push(`${y}-${mo}-${da}`);
    }
    const times = [];
    for (const day of days) for (let h = 0; h < 24; h++) times.push(`${day}T${String(h).padStart(2, '0')}:00`);

    const val = (name) => {
      if (name === 'precipitation') return 8;                       // wet: drives antecedent + event
      if (name.startsWith('soil_moisture')) return 0.35;            // 0.35/0.45 ≈ 78% sat → 高
      if (name === 'et0_fao_evapotranspiration') return 0.2;
      if (name === 'temperature_2m') return 21;
      if (name === 'apparent_temperature') return 20;
      if (name === 'relative_humidity_2m') return 88;
      if (name === 'precipitation_probability') return 90;
      if (name === 'weathercode') return 61;
      if (name === 'windspeed_10m') return 15;
      if (name === 'windgusts_10m') return 30;
      if (name === 'cloudcover') return 95;
      return 1;
    };
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));

    const daily = { time: days };
    for (const v of dailyVars) {
      if (v === 'sunrise') daily[v] = days.map((d) => `${d}T05:30`);
      else if (v === 'sunset') daily[v] = days.map((d) => `${d}T18:30`);
      else if (v === 'temperature_2m_max') daily[v] = days.map(() => 25);
      else if (v === 'temperature_2m_min') daily[v] = days.map(() => 18);
      else if (v === 'precipitation_sum') daily[v] = days.map(() => 40);
      else daily[v] = days.map(() => 1);
    }

    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ latitude: ANCHOR[0], longitude: ANCHOR[1], elevation: 1500, hourly, daily }),
    });
  };
}

async function stubFlood(page) {
  await page.route(/flood-api\.open-meteo\.com\/v1\/flood/, (route) => {
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start_date');
    const end = url.searchParams.get('end_date') || start;
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
      days.push(`${y}-${mo}-${da}`);
    }
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        daily: {
          time: days,
          river_discharge: days.map((_, i) => 5 + i * 4),   // rising
          river_discharge_mean: days.map(() => 4),
        },
      }),
    });
  });
}

async function openCatchmentClick(page, forecastCounter) {
  await page.addInitScript(() => localStorage.setItem('mappingElf_language', 'zh-TW'));
  await stubElevation(page);
  await stubFlood(page);
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, makeForecastHandler(forecastCounter));

  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#btn-measure-tool').click();
  await page.locator('[data-measure-mode="catchment"]').click();
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#map .leaflet-overlay-pane path')).toHaveCount(1, { timeout: 15_000 });
}

test('catchment: renders weather + hydrology with picker and risk chips', async ({ page }) => {
  const forecast = { n: 0 };
  await openCatchmentClick(page, forecast);

  // Adjustable time picker seeded and present.
  await expect(page.locator('#ct-date')).toHaveCount(1);
  await expect(page.locator('#ct-hour')).toHaveCount(1);
  await expect(page.locator('#ct-date')).not.toHaveValue('');

  // Terrain rows from the DEM geometry.
  const readout = page.locator('#measure-readout');
  await expect(readout).toContainText('平均坡度');
  await expect(readout).toContainText('海拔範圍');

  // Weather section mirrors the weather-info rows (populated after fetch).
  const weather = page.locator('#ct-weather');
  await expect(weather.locator('.mr-row')).toHaveCount(7, { timeout: 15_000 });
  await expect(weather).toContainText('溫度');

  // Hydrology indicators with at least one risk chip.
  const hydro = page.locator('#ct-hydro');
  await expect(hydro).toContainText('土壤含水量', { timeout: 15_000 });
  await expect(hydro).toContainText('溪水暴漲風險');
  await expect(hydro).toContainText('土石流風險');
  await expect(hydro.locator('.risk-chip')).not.toHaveCount(0);

  // Disclaimer shown; no NaN/undefined leaked into any value.
  await expect(readout).toContainText('僅供參考');
  await expect(readout).not.toContainText('NaN');
  await expect(readout).not.toContainText('undefined');
});

test('catchment: changing the hour re-fetches and re-renders', async ({ page }) => {
  const forecast = { n: 0 };
  await openCatchmentClick(page, forecast);
  await expect(page.locator('#ct-hydro')).toContainText('土壤含水量', { timeout: 15_000 });

  const before = forecast.n;
  const cur = await page.locator('#ct-hour').inputValue();
  await page.locator('#ct-hour').selectOption(cur === '3' ? '4' : '3');

  // A new forecast request fires and the hydrology section repopulates.
  await expect.poll(() => forecast.n, { timeout: 15_000 }).toBeGreaterThan(before);
  await expect(page.locator('#ct-hydro')).toContainText('土壤含水量', { timeout: 15_000 });
});
