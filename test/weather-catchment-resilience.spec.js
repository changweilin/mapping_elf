import { expect, test } from '@playwright/test';

// Follow-ups: (1) transient 429s must not leave waypoints stuck as an unfetched
// "?" placeholder badge — getWeatherAtPoint retries; (2) a card's 集水區 compute
// must surface a progress pill instead of running silently.
const ANCHOR = [23.5, 121.0];

function coneElevation(page, { delayMs = 0 } = {}) {
  return page.route(/v1\/elevation/, async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
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

function forecast(page, { failFirst = 0 } = {}) {
  let seen = 0;
  return page.route(/v1\/forecast/, (route) => {
    seen += 1;
    if (seen <= failFirst) { route.fulfill({ status: 429, contentType: 'text/plain', body: 'rate limited' }); return; }
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
    const val = (n) => (n === 'weathercode' ? 1 : n === 'temperature_2m' ? 21 : n.startsWith('soil_moisture') ? 0.35 : 1);
    const hourly = { time: times };
    for (const v of hourlyVars) hourly[v] = times.map(() => val(v));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: 1500, hourly, daily: { time: days } }) });
  });
}

function flood(page) {
  return page.route(/flood-api\.open-meteo\.com\/v1\/flood/, (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: ['2026-07-18'], river_discharge: [5], river_discharge_mean: [4] } }) });
  });
}

function osrm(page) {
  return page.route('**/route/v1/**', (route) => {
    const coordPart = new URL(route.request().url()).pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 1000, duration: 1000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
}

// Minimal, deterministic route settings: no 副航點 (segmentKm 0), so the weather
// load is just the two waypoints and finishes fast.
function baseInit(page) {
  return page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mappingElf_routeMode', 'walking');
    localStorage.setItem('mappingElf_roundTrip', '0');
    localStorage.setItem('mappingElf_oLoop', '0');
    localStorage.setItem('mappingElf_speedMode', '0');
    localStorage.setItem('mappingElf_segmentKm', '0');
    localStorage.setItem('mappingElf_language', 'zh-TW');
    localStorage.setItem('mappingElf_collectiveMarked', '0');
    localStorage.setItem('mappingElf_collectiveIntermediate', '0');
    localStorage.setItem('mappingElf_collectiveAll', '0');
  });
}

const overlayHidden = (page) =>
  page.waitForFunction(() => document.getElementById('route-weather-busy-overlay')?.classList.contains('hidden'));

async function twoWaypoints(page) {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.5);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  return box;
}

test('transient 429s recover via retry — no stuck "?" badge (follow-up 1)', async ({ page }) => {
  await baseInit(page);
  await osrm(page);
  await forecast(page, { failFirst: 2 });  // first two weather calls 429, retries succeed
  await coneElevation(page);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await twoWaypoints(page);

  // Both waypoint badges must end up loaded (retry rescued the 429'd point),
  // i.e. NO badge is left in the unfetched placeholder state.
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded')).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-placeholder')).toHaveCount(0);
});

test('card 集水區 compute shows a progress pill (follow-up 2)', async ({ page }) => {
  await baseInit(page);
  await osrm(page);
  await forecast(page);
  await flood(page);
  await coneElevation(page, { delayMs: 700 });  // slow the DEM so the pill is observable
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await twoWaypoints(page);
  await expect(page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first()).toBeVisible();
  // Let the (2-point) weather load finish so the only later busy task is the
  // catchment compute — the overlay is back to hidden here.
  await overlayHidden(page);

  // Open the first waypoint card, expand to full, switch to the 集水區 view.
  await page.locator('.custom-waypoint-icon .wp-weather-badge.is-loaded').first().click();
  await page.locator('.weather-card').first().waitFor();
  if (!(await page.locator('.weather-card.full').count())) {
    await page.locator('.weather-card .q-toggle').first().dispatchEvent('click');
  }
  await page.locator('.weather-card.full').first().waitFor();
  await page.locator('.wc-view-btn[data-wc-view="catchment"]').first().dispatchEvent('click');

  // While the DEM computes (elevation delayed), the display-only busy pill shows
  // the catchment title.
  const overlay = page.locator('#route-weather-busy-overlay');
  await expect(overlay).not.toHaveClass(/hidden/, { timeout: 5000 });
  await expect(page.locator('#route-weather-busy-title')).toHaveText('正在計算集水區', { timeout: 5000 });
  // ...and it clears once the compute finishes (pill is non-blocking, not stuck).
  await expect(overlay).toHaveClass(/\bhidden\b/, { timeout: 20000 });
});
