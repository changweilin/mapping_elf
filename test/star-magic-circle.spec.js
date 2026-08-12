import { expect, test } from '@playwright/test';
import { ANCHOR, flatElevation, nominatim, osrm, overpass } from './helpers/apiMocks.mjs';

// 魔法陣 (star tool): pick a centre + radius ring, pull POIs from Overpass, solve
// for a star, animate it, hand the vertices to route planning.
//
// Overpass/Nominatim are stubbed (see helpers/apiMocks.mjs) so the solver gets a
// geometrically perfect ring and the assertions are about the wiring, not about
// whatever the live API returns today. Routing is unreachable in CI, so the
// handoff asserts waypoints + nav mode, not road snapping.

/**
 * Registration ORDER matters: Playwright matches the last-registered route
 * first, so the broad background stubs go in before the per-test ones. Without
 * the weather stub a seeded 2-waypoint route starts a real 136-point Open-Meteo
 * load that holds the busy lock for minutes — and the handoff is (correctly)
 * refused while that lock is up, so the spec would be testing the busy guard
 * instead of the confirm dialog.
 */
// Fast, valid-enough forecast so a seeded route's weather load COMPLETES.
// Aborting instead leaves the load retrying across ~136 points, which pins the
// busy lock open for minutes and blocks the handoff under test.
const hours = (value) => Array.from({ length: 24 }, () => value);
const forecastPayload = () => ({
  daily: {
    time: ['2026-05-20'],
    temperature_2m_max: [24], temperature_2m_min: [18], precipitation_sum: [0],
    weathercode: [1], windspeed_10m_max: [12], windgusts_10m_max: [18],
    sunrise: ['2026-05-20T05:10'], sunset: ['2026-05-20T18:30'],
    sunshine_duration: [18000], precipitation_probability_max: [10],
    uv_index_max: [7], shortwave_radiation_sum: [19],
  },
  hourly: {
    time: Array.from({ length: 24 }, (_, h) => `2026-05-20T${String(h).padStart(2, '0')}:00`),
    temperature_2m: hours(21), apparent_temperature: hours(20),
    relative_humidity_2m: hours(65), dewpoint_2m: hours(14),
    precipitation: hours(0), precipitation_probability: hours(10),
    weathercode: hours(1), windspeed_10m: hours(10), windgusts_10m: hours(16),
    uv_index: hours(4), visibility: hours(10000), cloudcover: hours(25),
  },
  elevation: 100,
});

async function openApp(page, { overpassOpts = {}, nominatimOpts = null } = {}) {
  await page.route('**/v1/forecast**', (route) => route.fulfill({ json: forecastPayload() }));
  await page.route('**/v1/archive**', (route) => route.fulfill({ json: forecastPayload() }));
  await page.route('**://brouter.de/**', (route) => route.abort());
  await flatElevation(page);
  await osrm(page);
  await page.route('**://nominatim.openstreetmap.org/**', (route) => route.fulfill({ json: [] }));

  await overpass(page, overpassOpts);
  if (nominatimOpts) await nominatim(page, nominatimOpts);

  await page.addInitScript(() => { window.__mappingElfTestHooks = { events: [] }; });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
}

/**
 * Wait until nothing is loading. Two traps this avoids:
 *  - Playwright's `toBeHidden()` calls this fixed-position overlay hidden while
 *    the lock is still held, so the app's own `hidden` class is the truth.
 *  - A seeded route runs loads back to back (route → weather → 集水區) with
 *    brief gaps between them, and a single poll happily lands in one of those
 *    gaps. Require the overlay to stay hidden across consecutive checks.
 */
function busyIdle(page, stableChecks = 4) {
  let streak = 0;
  return expect
    .poll(async () => {
      const hidden = await page.evaluate(() =>
        document.getElementById('route-weather-busy-overlay')?.classList.contains('hidden'));
      streak = hidden ? streak + 1 : 0;
      return streak;
    }, { timeout: 60000, intervals: [400] })
    .toBeGreaterThanOrEqual(stableChecks);
}

const events = (page, type) => page.evaluate(
  (t) => (window.__mappingElfTestHooks?.events || []).filter((e) => e.type === t),
  type,
);

async function openStarPanel(page) {
  await page.locator('#btn-star-tool').click();
  await expect(page.locator('#star-panel')).toBeVisible();
}

// Centre on the anchor the Overpass stub builds its ring around.
async function useMapCentreAsStarCentre(page) {
  await page.locator('#btn-star-center-map').click();
  await expect(page.locator('#star-center-readout')).toContainText(String(ANCHOR[0]).slice(0, 4));
}

async function solve(page) {
  await page.locator('#btn-star-solve').click();
  await expect.poll(async () => (await events(page, 'star-solved')).length, { timeout: 60000 })
    .toBeGreaterThan(0);
}

/**
 * Coarsen the rotation sweep before solving. The default 3° step runs ~120
 * solver stages, each yielding to the event loop — fine in the app, but it
 * dominates the runtime of tests that only care about what happens *after* a
 * star exists. Solve quality is asserted separately.
 */
async function useCoarseSolve(page) {
  await page.locator('#star-advanced-details').evaluate((el) => { el.open = true; });
  await page.locator('#star-rotation-input').fill('18');
  await page.locator('#star-rotation-input').dispatchEvent('change');
}

test('star tool opens, shares the map corner with the other two tools', async ({ page }) => {
  await openApp(page);

  const starPanel = page.locator('#star-panel');
  const measurePanel = page.locator('#measure-panel');
  const shapePanel = page.locator('#shape-panel');
  await expect(starPanel).toBeHidden();

  await openStarPanel(page);
  await expect(page.locator('#btn-star-tool')).toHaveAttribute('aria-pressed', 'true');

  // Opening either sibling tool closes 魔法陣 — all three share one map corner.
  await page.locator('#btn-measure-tool').click();
  await expect(measurePanel).toBeVisible();
  await expect(starPanel).toBeHidden();
  await expect(page.locator('#btn-star-tool')).toHaveAttribute('aria-pressed', 'false');

  await openStarPanel(page);
  await expect(measurePanel).toBeHidden();

  await page.locator('#btn-shape-tool').click();
  await expect(shapePanel).toBeVisible();
  await expect(starPanel).toBeHidden();

  // ...and opening 魔法陣 again closes 繪圖板.
  await openStarPanel(page);
  await expect(shapePanel).toBeHidden();

  await page.locator('#btn-star-close').click();
  await expect(starPanel).toBeHidden();
});

test('solving finds the seeded star and draws an animated magic circle', async ({ page }) => {
  const stats = { calls: 0 };
  await openApp(page, { overpassOpts: { stats } });
  await openStarPanel(page);

  // No centre yet → refuses to search and makes no Overpass call.
  await page.locator('#btn-star-solve').click();
  expect(stats.calls).toBe(0);

  await useMapCentreAsStarCentre(page);
  await page.locator('#star-inner-input').fill('3');
  await page.locator('#star-outer-input').fill('8');
  await solve(page);

  const solved = (await events(page, 'star-solved'))[0].detail;
  expect(solved.mode).toBe(5);
  expect(solved.pointCount).toBe(5);
  expect(solved.resultCount).toBeGreaterThan(0);
  expect(stats.calls).toBeGreaterThan(0);

  // The result block appears with the readout and playback controls.
  await expect(page.locator('#star-result')).toBeVisible();
  await expect(page.locator('#star-result-index')).toContainText('1 /');
  await expect(page.locator('#star-readout')).toContainText('星點');

  // The magic circle is on the map: animated strokes + one marker per vertex.
  await expect.poll(async () => page.locator('.magic-drawable').count()).toBeGreaterThan(0);
  await expect(page.locator('.star-point')).toHaveCount(5);

  // The solver picked the seeded perfect ring, not the noise: a geometrically
  // exact star has ~zero angle error.
  await expect(page.locator('#star-readout')).toContainText('0.0°');
});

test('playback pauses and resumes, and results can be stepped through', async ({ page }) => {
  // Solve + several full re-renders of ~100 animated strokes each; the 60 s
  // default leaves no headroom (see catchment-flat.spec.js for the precedent).
  test.setTimeout(150_000);
  await openApp(page);
  await openStarPanel(page);
  await useMapCentreAsStarCentre(page);
  await useCoarseSolve(page);
  await solve(page);

  const play = page.locator('#btn-star-play');
  await expect(play).toHaveAttribute('aria-pressed', 'true');

  const playState = () => page.evaluate(() => {
    const el = document.querySelector('.magic-drawable');
    return el ? getComputedStyle(el).animationPlayState : null;
  });
  await expect.poll(playState).toBe('running');

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(playState).toBe('paused');

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(playState).toBe('running');

  // Stepping results keeps exactly one star drawn.
  const indexText = () => page.locator('#star-result-index').innerText();
  const first = await indexText();
  await page.locator('#btn-star-next').click();
  await expect.poll(indexText).not.toBe(first);
  await expect(page.locator('.star-point')).toHaveCount(5);
  await page.locator('#btn-star-prev').click();
  await expect.poll(indexText).toBe(first);
});

test('changing the element or geometry restyles the same star; changing mode invalidates it', async ({ page }) => {
  test.setTimeout(150_000);
  await openApp(page);
  await openStarPanel(page);
  await useMapCentreAsStarCentre(page);
  await useCoarseSolve(page);
  await solve(page);

  await expect(page.locator('.magic-element--metal').first()).toBeVisible();

  // Element switch → same 5 vertices, new element class on the markers.
  await page.locator('#star-element-select').selectOption('2');   // 水
  await expect(page.locator('.star-point.magic-element--water')).toHaveCount(5);
  await expect(page.locator('#star-result')).toBeVisible();

  // Geometry switch → still the same result, different stroke family.
  await page.locator('#star-shape-select').selectOption('rose');
  await expect(page.locator('.magic-rose-curve').first()).toBeVisible();
  await expect(page.locator('#star-result')).toBeVisible();

  // Mode switch changes what a result even means → the old star is dropped.
  await page.locator('#star-mode-select').selectOption('6');
  await expect(page.locator('#star-result')).toBeHidden();
  await expect(page.locator('.star-point')).toHaveCount(0);
});

test('each magic-circle geometry remembers its own variant', async ({ page }) => {
  await openApp(page);
  await openStarPanel(page);

  const shape = page.locator('#star-shape-select');
  const variant = page.locator('#star-variant-select');

  await shape.selectOption('rose');
  await expect(variant).toHaveValue('k-7');           // rose's own default
  await variant.selectOption('k-4');

  // Switching away and back must not clobber the choice. Regression: the
  // variant select still lists the OLD shape's ids at the moment the shape
  // changes, so reading it as the new shape's variant wrote an invalid value
  // and normalisation silently reset that shape to its first option.
  await shape.selectOption('star');
  await expect(variant).toHaveValue('5');
  await shape.selectOption('zodiac');
  await expect(variant).toHaveValue('1');
  await shape.selectOption('rose');
  await expect(variant).toHaveValue('k-4');

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mappingElf_starSettings')).magicVariants);
  expect(stored).toMatchObject({ rose: 'k-4', star: '5', zodiac: '1', sierpinski: 'd-3' });
});

test('vertices hand off to route planning in star-line order, as an O繞 loop', async ({ page }) => {
  await openApp(page);
  await openStarPanel(page);
  await useMapCentreAsStarCentre(page);
  await solve(page);

  await page.locator('#btn-star-to-route').click();

  await expect.poll(async () => (await events(page, 'star-route-applied')).length, { timeout: 20000 })
    .toBeGreaterThan(0);
  const applied = (await events(page, 'star-route-applied'))[0].detail;

  expect(applied.waypointCount).toBe(5);
  // 五芒星 is drawn 0→2→4→1→3→0, so that is the visiting order (each vertex once).
  expect(applied.order).toEqual([0, 2, 4, 1, 3]);

  await expect.poll(async () => page.evaluate(() => document.querySelectorAll('#waypoint-list .waypoint-item').length))
    .toBe(5);
  // Closed figure → O繞 nav mode.
  await expect(page.locator('#nav-mode-oloop')).toBeChecked();
  // The tool hands the map over once it is done.
  await expect(page.locator('#star-panel')).toBeHidden();
  // POI names carried across instead of 航點 N.
  await expect(page.locator('#waypoint-list')).toContainText('星點');
});

test('handoff over an existing route asks first and honours a cancel', async ({ page }) => {
  // Seeds a real route (route → weather → 集水區 loads) before it can even start.
  test.setTimeout(180_000);
  await openApp(page);

  // Seed a route by clicking the map twice. Two guards, both load-bearing:
  // map clicks are swallowed while the busy lock is up, and back-to-back clicks
  // register as a dblclick (map zoom) which cancels the pending waypoint — so
  // wait for the previous waypoint to land before clicking again.
  const box = await page.locator('#map').boundingBox();
  const seeded = [[0.4, 0.4], [0.6, 0.6]];
  for (let i = 0; i < seeded.length; i += 1) {
    await busyIdle(page);
    await page.mouse.click(box.x + box.width * seeded[i][0], box.y + box.height * seeded[i][1]);
    await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(i + 1);
  }

  await openStarPanel(page);
  await useMapCentreAsStarCentre(page);
  await solve(page);

  // The handoff is refused outright while the route is still planning, so let
  // the seeded route settle — otherwise this asserts the busy guard, not the
  // confirm dialog.
  await busyIdle(page);

  // Decline → the existing route survives untouched, nothing is applied.
  let prompted = 0;
  page.once('dialog', (dialog) => { prompted += 1; dialog.dismiss(); });
  await page.locator('#btn-star-to-route').click();
  // Assert on the reason, not just the absence of an apply: without this a
  // busy-guard bail would look identical to the user declining.
  await expect.poll(async () => (await events(page, 'star-route-blocked')).map((e) => e.detail.reason))
    .toEqual(['declined']);
  expect(prompted).toBe(1);
  await expect.poll(async () => (await events(page, 'star-route-applied')).length).toBe(0);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await expect(page.locator('#star-panel')).toBeVisible();

  // Accept → the magic circle replaces it.
  page.once('dialog', (dialog) => { prompted += 1; dialog.accept(); });
  await page.locator('#btn-star-to-route').click();
  await expect.poll(() => prompted).toBe(2);
  await expect.poll(async () => (await events(page, 'star-route-applied')).length, { timeout: 20000 })
    .toBeGreaterThan(0);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(5);
});

test('hostile OSM names are escaped, not executed', async ({ page }) => {
  // OSM tags are world-editable, so a POI name is untrusted input that reaches
  // the readout, the map tooltips and the place list.
  const XSS = '<img src=x onerror="window.__pwned=1">評鑑廟';
  await openApp(page);
  // AFTER openApp: the last-registered route wins, so this has to outrank the
  // plain `overpass` stub openApp installs.
  await page.route(/overpass/, (route) => {
    const elements = [0, 1, 2, 3, 4].map((i) => {
      const rad = (deg) => (deg * Math.PI) / 180;
      const d = 5000 / 6371000;
      const b = rad((360 / 5) * i);
      const la1 = rad(ANCHOR[0]);
      const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
      const ln2 = rad(ANCHOR[1]) + Math.atan2(
        Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
      return {
        type: 'node', id: 700 + i,
        lat: (la2 * 180) / Math.PI, lon: (ln2 * 180) / Math.PI,
        tags: { amenity: 'place_of_worship', name: `${XSS} ${i}` },
      };
    });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements }) });
  });

  await openStarPanel(page);
  await useMapCentreAsStarCentre(page);
  await solve(page);

  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  // The name is rendered as text, so the tag survives verbatim and no <img> exists.
  await expect(page.locator('#star-readout')).toContainText('<img src=x');
  expect(await page.locator('#star-readout img').count()).toBe(0);
});

test('a failing Overpass surfaces an error instead of breaking the panel', async ({ page }) => {
  await openApp(page, { overpassOpts: { status: 504 } });
  await openStarPanel(page);
  await useMapCentreAsStarCentre(page);

  await page.locator('#btn-star-solve').click();

  // The panel stays usable and no result block appears.
  await expect(page.locator('#star-panel')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#star-result')).toBeHidden();
  // The busy overlay must not be left pinned open (INC-338).
  await busyIdle(page);
});

test('centre, settings and panel state survive a reload', async ({ page }) => {
  await openApp(page, { nominatimOpts: { label: '測試中心' } });
  await openStarPanel(page);

  await page.locator('#star-center-input').fill('測試中心');
  await page.locator('#btn-star-search-place').click();
  await expect(page.locator('#star-center-readout')).toContainText('測試中心');

  await page.locator('#star-mode-select').selectOption('7');
  await page.locator('#star-outer-input').fill('9');
  await page.locator('#star-element-select').selectOption('3');

  await page.reload();
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  // Panel reopens on the settings and centre the user left behind.
  await expect(page.locator('#star-panel')).toBeVisible();
  await expect(page.locator('#star-mode-select')).toHaveValue('7');
  await expect(page.locator('#star-outer-input')).toHaveValue('9');
  await expect(page.locator('#star-element-select')).toHaveValue('3');
  await expect(page.locator('#star-center-readout')).toContainText('測試中心');
});
