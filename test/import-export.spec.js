import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ acceptDownloads: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');
const shortGpx = path.join(repoRoot, 'data', 'app-test-routes', 'short-zh-weather.gpx');
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

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

async function mockMapTiles(page) {
  await page.route(/basemaps\.cartocdn\.com|tile\.opentopomap\.org|server\.arcgisonline\.com/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: transparentPng,
    });
  });
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

async function importedTrackState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('mappingElf_importedTrack') || 'null'));
}

function expectSameEndpoint(actual, expected, label) {
  expect(actual, `${label} endpoint should exist`).toBeTruthy();
  expect(Math.abs(actual[0] - expected[0]), `${label} latitude`).toBeLessThan(0.00001);
  expect(Math.abs(actual[1] - expected[1]), `${label} longitude`).toBeLessThan(0.00001);
}

async function writeStateOnlyMapPack(filePath, state) {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    version: 1,
    generator: 'Mapping Elf Test',
    createdAt: '2026-05-18T00:00:00.000Z',
    includes: { route: false, tiles: false, state: true },
    layer: null,
    bounds: null,
    minZoom: null,
    maxZoom: null,
    tileCount: 0,
  }, null, 2));
  zip.file('state.json', JSON.stringify(state, null, 2));
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}

async function readMapPackManifest(filePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  const tileFiles = Object.keys(zip.files).filter((name) =>
    /^tiles\/[^/]+\/\d+\/\d+\/\d+\.(png|jpg|jpeg)$/i.test(name)
  );
  return { manifest, tileFiles };
}

function parseTileEstimate(text) {
  const match = String(text || '').match(/\d+/);
  expect(match, `tile estimate should contain a count: ${text}`).toBeTruthy();
  return Number(match[0]);
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

test('map-pack tile estimate matches exported manifest tile count', async ({ page }, testInfo) => {
  await mockMapTiles(page);
  const consoleErrors = await openApp(page);

  await importFixture(page, shortGpx);
  await expectImportedRoute(page);

  const melmapPath = await downloadExport(page, testInfo, 'melmap', async () => {
    await expect(page.locator('#melmap-sub-options')).toBeVisible();
    await expect(page.locator('#mappack-inc-tiles')).toBeChecked();
    const estimatedTileCount = parseTileEstimate(await page.locator('#mappack-tiles-info').textContent());
    expect(estimatedTileCount).toBeGreaterThan(0);
    await page.evaluate((count) => {
      window.__mappingElfExpectedTileCount = count;
    }, estimatedTileCount);
  });

  const expectedTileCount = await page.evaluate(() => window.__mappingElfExpectedTileCount);
  const { manifest } = await readMapPackManifest(melmapPath);
  expect(manifest.includes.tiles).toBe(true);
  expect(manifest.layer).toBeTruthy();
  expect(manifest.tileCount).toBe(expectedTileCount);
  expect(manifest.minZoom).toBeLessThanOrEqual(manifest.maxZoom);

  expect(consoleErrors).toEqual([]);
});

test('imports app fixture with Chinese names, weather metadata, and interval points', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await importFixture(page, shortGpx);
  await expectImportedRoute(page);

  const state = await importedTrackState(page);
  expect(state.coords.length).toBe(7);
  expect(state.waypoints.length).toBe(3);
  expect(state.waypointMeta.map((m) => m.label)).toEqual([
    '起點 松山',
    '中途 觀景台',
    '終點 象山',
  ]);
  expect(state.waypointMeta[0].date).toBe('2026-05-20');
  expect(state.waypointMeta[0].time).toBe('07:00');
  expect(state.waypointMeta[0].weather.temp).toBe('22 C');
  expect(state.intermediates).toHaveLength(1);
  expect(state.intermediates[0].label).toBe('補給點');

  expect(consoleErrors).toEqual([]);
});

test('melmap state restore uses allow-list and preserves user collections/session keys', async ({ page }, testInfo) => {
  const consoleErrors = await openApp(page);
  const originalFavorites = [{ id: 'fav-local', name: '保留的最愛', savedAt: '2026-05-18T00:00:00.000Z' }];
  const originalWaypoints = [[25.03, 121.56], [25.04, 121.57]];
  await page.evaluate(({ originalFavorites, originalWaypoints }) => {
    localStorage.setItem('mappingElf_theme', 'dark');
    localStorage.setItem('mappingElf_favorites', JSON.stringify(originalFavorites));
    localStorage.setItem('mappingElf_waypoints', JSON.stringify(originalWaypoints));
    localStorage.setItem('mappingElf_importedTrack', JSON.stringify({ coords: [[1, 2], [3, 4]] }));
  }, { originalFavorites, originalWaypoints });

  const packPath = testInfo.outputPath('state-allow-list.melmap');
  await writeStateOnlyMapPack(packPath, {
    mappingElf_theme: 'light',
    mappingElf_favorites: JSON.stringify([{ id: 'fav-evil', name: '不應覆蓋' }]),
    mappingElf_waypoints: JSON.stringify([[0, 0], [1, 1]]),
    mappingElf_importedTrack: JSON.stringify({ coords: [[9, 9], [8, 8]] }),
  });

  await importFixture(page, packPath);
  await expect(page.locator('#mappack-import-modal')).toBeVisible();
  await expect(page.locator('#mappack-restore-state')).toBeChecked();
  await page.locator('#btn-mappack-import-confirm').click();
  await expect(page.locator('#mappack-import-modal')).toHaveClass(/hidden/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mappingElf_theme'))).toBe('light');

  const stored = await page.evaluate(() => ({
    theme: localStorage.getItem('mappingElf_theme'),
    favorites: JSON.parse(localStorage.getItem('mappingElf_favorites') || '[]'),
    waypoints: JSON.parse(localStorage.getItem('mappingElf_waypoints') || '[]'),
    importedTrack: JSON.parse(localStorage.getItem('mappingElf_importedTrack') || 'null'),
  }));
  expect(stored.theme).toBe('light');
  expect(stored.favorites).toEqual(originalFavorites);
  expect(stored.waypoints).toEqual(originalWaypoints);
  expect(stored.importedTrack).toEqual({ coords: [[1, 2], [3, 4]] });

  expect(consoleErrors).toEqual([]);
});

test('reset defaults clears app state but keeps favorites', async ({ page }) => {
  const originalFavorites = [{ id: 'fav-reset', name: '重置後保留', savedAt: '2026-05-18T00:00:00.000Z' }];
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isExpectedExternalResourceNoise(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  await page.addInitScript((favorites) => {
    if (sessionStorage.getItem('__mappingElfResetSeeded') === '1') return;
    sessionStorage.setItem('__mappingElfResetSeeded', '1');
    localStorage.clear();
    localStorage.setItem('mappingElf_theme', 'light');
    localStorage.setItem('mappingElf_routeMode', 'driving');
    localStorage.setItem('mappingElf_waypoints', JSON.stringify([[25.03, 121.56], [25.04, 121.57]]));
    localStorage.setItem('mappingElf_pendingGpx', '<gpx></gpx>');
    localStorage.setItem('mappingElf_favorites', JSON.stringify(favorites));
  }, originalFavorites);
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  page.once('dialog', (dialog) => dialog.accept());
  await clickStable(page, '#btn-reset-defaults');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  const stored = await page.evaluate(() => ({
    theme: localStorage.getItem('mappingElf_theme'),
    routeMode: localStorage.getItem('mappingElf_routeMode'),
    waypoints: localStorage.getItem('mappingElf_waypoints'),
    pendingGpx: localStorage.getItem('mappingElf_pendingGpx'),
    favorites: JSON.parse(localStorage.getItem('mappingElf_favorites') || '[]'),
  }));
  expect(stored.theme).toBeNull();
  expect(stored.routeMode).toBeNull();
  expect(stored.waypoints).toBeNull();
  expect(stored.pendingGpx).toBeNull();
  expect(stored.favorites).toEqual(originalFavorites);

  expect(consoleErrors).toEqual([]);
});
