import { expect, test } from '@playwright/test';
import { makeGridWorld } from './helpers/gridWorld.mjs';
import { shapeStroke } from './helpers/testShapes.mjs';

// Drawing-board shape fidelity: heart / star / plum-blossom / palm strokes
// must survive road routing recognisably. Real routing APIs are mocked with a
// deterministic Manhattan street grid (worst-case L-shaped router), so these
// thresholds guard the waypoint-selection + refinement algorithm end to end
// through the real main.js pipeline (calibration rounds included).

test.use({
  geolocation: { latitude: 25.034, longitude: 121.564 },
  permissions: ['geolocation'],
});

const WORLD = makeGridWorld({ anchor: [25.034, 121.564], spacingM: 80, tieBreak: 'lshape' });

function xyLen(coordsLatLng) {
  const xy = coordsLatLng.map((p) => WORLD.toXY(p));
  let len = 0;
  for (let i = 1; i < xy.length; i++) len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  return len;
}

// OSRM /route/v1/foot/<lng,lat;lng,lat;...> → grid-following geometry.
function mockRoute(url) {
  const m = url.pathname.match(/\/route\/v1\/[^/]+\/(.+)$/);
  const pairs = decodeURIComponent(m[1]).split(';').map((s) => {
    const [lng, lat] = s.split(',').map(Number);
    return [lat, lng];
  });
  const coords = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    const leg = WORLD.route(pairs[i], pairs[i + 1]);
    if (i === 0) coords.push(...leg);
    else coords.push(...leg.slice(1));
  }
  const distance = xyLen(coords);
  return {
    code: 'Ok',
    routes: [{
      geometry: { coordinates: coords.map(([lat, lng]) => [lng, lat]) },
      distance,
      duration: distance / 1.4,
    }],
    waypoints: [],
  };
}

// OSRM /nearest/v1/foot/<lng,lat> → nearest street point on the grid.
function mockNearest(url) {
  const m = url.pathname.match(/\/nearest\/v1\/[^/]+\/(.+)$/);
  const [lng, lat] = decodeURIComponent(m[1]).split(',').map(Number);
  const snap = WORLD.snap([lat, lng]);
  return {
    code: 'Ok',
    waypoints: [{ location: [snap.point[1], snap.point[0]], distance: snap.distance }],
  };
}

async function installMocks(page) {
  await page.route('**://router.project-osrm.org/route/v1/**', (route) =>
    route.fulfill({ json: mockRoute(new URL(route.request().url())) }));
  await page.route('**://router.project-osrm.org/nearest/v1/**', (route) =>
    route.fulfill({ json: mockNearest(new URL(route.request().url())) }));
  await page.route('**://api.open-meteo.com/v1/elevation**', (route) => {
    const url = new URL(route.request().url());
    const n = (url.searchParams.get('latitude') || '').split(',').length;
    route.fulfill({ json: { elevation: new Array(n).fill(10) } });
  });
  // Weather + geocoding are irrelevant here — fail them fast.
  await page.route('**://api.open-meteo.com/v1/forecast**', (route) => route.abort());
  await page.route('**://nominatim.openstreetmap.org/**', (route) => route.fulfill({ json: [] }));
  await page.route('**://brouter.de/**', (route) => route.abort());
}

async function openApp(page) {
  await page.addInitScript(() => { window.__mappingElfTestHooks = { events: [] }; });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
}

// Replay a parametric stroke on the drawing canvas with the mouse. Generator
// coordinates are 300×300; scale to the live canvas box.
async function drawStroke(page, name) {
  const canvas = page.locator('#shape-canvas');
  const box = await canvas.boundingBox();
  const scale = Math.min(box.width, box.height) / 300;
  const pts = shapeStroke(name).filter((_, i) => i % 2 === 0);
  const at = (p) => [box.x + p[0] * scale, box.y + p[1] * scale];
  const [x0, y0] = at(pts[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = at(pts[i]);
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
}

async function generateAndFinish(page, name, options = {}) {
  await installMocks(page);
  await openApp(page);
  await page.locator('#btn-shape-tool').click();
  await expect(page.locator('#shape-panel')).toBeVisible();
  await drawStroke(page, name);
  await page.locator('#shape-distance-input').fill('5');
  await page.locator('#shape-angle-select').selectOption('0');
  if (options.trimSpurs === false) await page.locator('#shape-trim-spurs').uncheck();
  await page.locator('#btn-shape-generate').click();

  await expect.poll(async () => page.evaluate(() =>
    (window.__mappingElfTestHooks?.events || []).some((e) => e.type === 'shape-route-finished')
  ), { timeout: 120_000, intervals: [1000] }).toBe(true);

  return page.evaluate(() =>
    (window.__mappingElfTestHooks.events).find((e) => e.type === 'shape-route-finished').detail);
}

// Thresholds carry ~25-30% margin over the measured grid-world results with
// whisker trimming ON (its default) — sharp tips round off, so maxDev sits
// higher than the untrimmed pipeline would allow. See numeric-regression.mjs
// for the tighter pure-node guards.
const CASES = [
  { name: 'heart', maxDevM: 130, simPct: 88 },
  { name: 'star', maxDevM: 240, simPct: 86 },
  { name: 'plum', maxDevM: 170, simPct: 88 },
  { name: 'palm', maxDevM: 200, simPct: 86 },
];

for (const c of CASES) {
  test(`${c.name} stroke routes recognisably on the street grid`, async ({ page }) => {
    test.setTimeout(180_000);
    const detail = await generateAndFinish(page, c.name);
    expect(detail.trimSpurs).toBe(true);   // spur trimming defaults on
    expect(detail.similarityPct).toBeGreaterThanOrEqual(c.simPct);
    expect(detail.maxDevM).toBeLessThanOrEqual(c.maxDevM);
    expect(detail.waypointCount).toBeLessThanOrEqual(30);
    expect(Math.abs(detail.actualM - 5000) / 5000).toBeLessThanOrEqual(0.13);
  });
}

test('palm with spur trimming toggled off still routes and persists the choice', async ({ page }) => {
  test.setTimeout(180_000);
  const detail = await generateAndFinish(page, 'palm', { trimSpurs: false });
  expect(detail.trimSpurs).toBe(false);
  expect(detail.similarityPct).toBeGreaterThanOrEqual(86);
  expect(detail.maxDevM).toBeLessThanOrEqual(120);
  const saved = await page.evaluate(() => localStorage.getItem('mappingElf_shapeRouteTrimSpurs'));
  expect(saved).toBe('0');
});
