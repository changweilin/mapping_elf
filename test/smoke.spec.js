import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');
const sampleMelmap = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.melmap');

async function openApp(page) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#btn-export-gpx')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  return consoleErrors;
}

async function importFixture(page, filePath) {
  await page.locator('#gpx-file-input').setInputFiles(filePath);
}

test('app shell loads without console errors', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await expect(page.locator('#side-panel')).toBeAttached();
  await expect(page.locator('#elevation-chart-container')).toBeVisible();
  await expect(page.locator('#chart-empty')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('imports sample KML and keeps route UI functional', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await importFixture(page, sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  await expect(page.locator('#stat-distance')).not.toHaveText(/^[-–—]*$/);

  await page.locator('#btn-toggle-elevation').click();
  await expect(page.locator('#elevation-chart-container')).toHaveClass(/collapsed/);
  await page.locator('#btn-toggle-elevation').click();
  await expect(page.locator('#elevation-chart-container')).not.toHaveClass(/collapsed/);

  await page.locator('#btn-fit-route').click();
  await page.locator('#btn-clear-route').click();
  await expect(page.locator('#chart-empty')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('opens export modal and reveals map-pack options', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await importFixture(page, sampleKml);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();

  await page.locator('#btn-export-gpx').click();
  await expect(page.locator('#export-modal')).toBeVisible();
  await expect(page.locator('input[name="export-fmt"][value="gpx"]')).toBeChecked();
  await page.locator('input[name="export-fmt"][value="kml"]').check();
  await expect(page.locator('#melmap-sub-options')).not.toBeVisible();
  await page.locator('input[name="export-fmt"][value="melmap"]').check();
  await expect(page.locator('#melmap-sub-options')).toBeVisible();
  await expect(page.locator('#mappack-inc-route')).toBeChecked();
  await page.locator('#btn-export-cancel').click();
  await expect(page.locator('#export-modal')).toHaveClass(/hidden/);
  expect(consoleErrors).toEqual([]);
});

test('imports sample melmap through restore modal', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await importFixture(page, sampleMelmap);
  await expect(page.locator('#mappack-import-modal')).toBeVisible();
  await expect(page.locator('#mappack-restore-route')).toBeEnabled();
  await expect(page.locator('#mappack-restore-route')).toBeChecked();
  await expect(page.locator('#mappack-restore-tiles')).toBeEnabled();
  await expect(page.locator('#mappack-import-meta')).not.toHaveText('');

  await page.locator('#mappack-restore-tiles').uncheck();
  await page.locator('#btn-mappack-import-confirm').click();
  await expect(page.locator('#mappack-import-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  expect(consoleErrors).toEqual([]);
});
