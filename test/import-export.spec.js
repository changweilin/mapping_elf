import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ acceptDownloads: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');

function isExpectedExternalResourceNoise(text) {
  return text.includes('Failed to load resource')
    && (
      text.includes('net::ERR_NETWORK_ACCESS_DENIED')
      || text.includes('net::ERR_NO_BUFFER_SPACE')
      || text.includes('the server responded with a status of 404 (Offline)')
    );
}

async function openApp(page) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isExpectedExternalResourceNoise(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#btn-export-gpx')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  return consoleErrors;
}

async function importFixture(page, filePath) {
  await page.locator('#gpx-file-input').setInputFiles(filePath);
}

async function expectImportedRoute(page) {
  const waypointItems = page.locator('#waypoint-list .waypoint-item');
  await expect(waypointItems.first()).toBeVisible();
  expect(await waypointItems.count()).toBeGreaterThan(0);
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  await expect(page.locator('#stat-distance')).not.toHaveText(/^[-\s]*$/);
}

async function clickStable(page, selector) {
  const locator = page.locator(selector);
  await expect(locator).toBeAttached();
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((el) => el.click());
}

async function routeSnapshot(page) {
  return page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('mappingElf_importedTrack') || 'null');
    const coords = session?.coords || [];
    const waypoints = session?.waypoints || JSON.parse(localStorage.getItem('mappingElf_waypoints') || '[]');
    const first = coords[0] || null;
    const last = coords[coords.length - 1] || null;
    return {
      trackPointCount: coords.length,
      waypointCount: waypoints.length,
      first,
      last,
      distance: document.querySelector('#stat-distance')?.textContent?.trim() || '',
    };
  });
}

function expectSameEndpoint(actual, expected, label) {
  expect(actual, `${label} endpoint should exist`).toBeTruthy();
  expect(Math.abs(actual[0] - expected[0]), `${label} latitude`).toBeLessThan(0.00001);
  expect(Math.abs(actual[1] - expected[1]), `${label} longitude`).toBeLessThan(0.00001);
}

async function downloadExport(page, testInfo, fmt, configure = async () => {}) {
  await clickStable(page, '#btn-export-gpx');
  await expect(page.locator('#export-modal')).toBeVisible();
  await page.locator(`input[name="export-fmt"][value="${fmt}"]`).check();
  await configure();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export-confirm').click(),
  ]);
  const filePath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(filePath);
  expect(filePath, `${fmt} download path`).toBeTruthy();
  return filePath;
}

test('round-trips GPX, KML, and route-only .melmap exports', async ({ page }, testInfo) => {
  const consoleErrors = await openApp(page);

  await importFixture(page, sampleKml);
  await expectImportedRoute(page);
  const baseline = await routeSnapshot(page);
  expect(baseline.trackPointCount).toBeGreaterThan(10);
  expect(baseline.waypointCount).toBeGreaterThan(0);

  const gpxPath = await downloadExport(page, testInfo, 'gpx');
  await importFixture(page, gpxPath);
  await expectImportedRoute(page);
  const afterGpx = await routeSnapshot(page);
  expect(afterGpx.trackPointCount).toBeGreaterThan(10);
  expect(afterGpx.waypointCount).toBeGreaterThan(0);
  expectSameEndpoint(afterGpx.first, baseline.first, 'GPX first');
  expectSameEndpoint(afterGpx.last, baseline.last, 'GPX last');

  const kmlPath = await downloadExport(page, testInfo, 'kml');
  await importFixture(page, kmlPath);
  await expectImportedRoute(page);
  const afterKml = await routeSnapshot(page);
  expect(afterKml.trackPointCount).toBeGreaterThan(10);
  expect(afterKml.waypointCount).toBeGreaterThan(0);
  expectSameEndpoint(afterKml.first, baseline.first, 'KML first');
  expectSameEndpoint(afterKml.last, baseline.last, 'KML last');

  const melmapPath = await downloadExport(page, testInfo, 'melmap', async () => {
    await page.locator('#mappack-inc-tiles').uncheck();
  });
  await importFixture(page, melmapPath);
  await expect(page.locator('#mappack-import-modal')).toBeVisible();
  await expect(page.locator('#mappack-restore-route')).toBeChecked();
  await page.locator('#btn-mappack-import-confirm').click();
  await expect(page.locator('#mappack-import-modal')).toHaveClass(/hidden/);
  await expectImportedRoute(page);
  const afterMelmap = await routeSnapshot(page);
  expect(afterMelmap.trackPointCount).toBeGreaterThan(10);
  expect(afterMelmap.waypointCount).toBeGreaterThan(0);
  expectSameEndpoint(afterMelmap.first, baseline.first, '.melmap first');
  expectSameEndpoint(afterMelmap.last, baseline.last, '.melmap last');

  expect(consoleErrors).toEqual([]);
});
