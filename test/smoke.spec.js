import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectUnexpectedConsoleErrors } from './helpers/consoleErrors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleKml = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.kml');
const sampleMelmap = path.join(repoRoot, 'data', '820 林道_24.2133,121.3472_20260420_1510.melmap');

async function openApp(page) {
  const consoleErrors = collectUnexpectedConsoleErrors(page);

  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#file-management-toggle-header')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });

  return consoleErrors;
}

async function importFixture(page, filePath) {
  await page.locator('#gpx-file-input').setInputFiles(filePath);
}

async function clickActionable(page, selector) {
  const locator = page.locator(selector);
  await expect(locator).toBeAttached();
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

async function clickStable(page, selector) {
  const locator = page.locator(selector);
  await expect(locator).toBeAttached();
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((el) => el.click());
}

async function openSidePanel(page) {
  const panel = page.locator('#side-panel');
  const className = await panel.getAttribute('class');
  if (!className?.includes('open')) {
    await page.locator('#btn-toggle-panel').click();
  }
  await expect(panel).toHaveClass(/open/);
}

async function openRouteLibrary(page) {
  const body = page.locator('#file-management-body');
  await expect(body).toBeAttached();
  const className = await body.getAttribute('class');
  if (className?.includes('collapsed')) {
    await clickStable(page, '#file-management-toggle-header h3');
  }
  await expect(body).not.toHaveClass(/collapsed/);
}

async function expectImportedRoute(page) {
  const waypointItems = page.locator('#waypoint-list .waypoint-item');
  await expect(waypointItems.first()).toBeVisible();
  expect(await waypointItems.count()).toBeGreaterThan(0);
  await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
  await expect(page.locator('#stat-distance')).not.toHaveText(/^[-\s]*$/);
  await expect(page.locator('#elevation-chart-container')).toBeVisible();
}

test('app shell loads without console errors', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await expect(page.locator('#side-panel')).toBeAttached();
  await expect(page.locator('.privacy-link')).toHaveAttribute(
    'href',
    'https://changweilin.github.io/mapping_elf/privacy.html',
  );
  await expect(page.locator('#route-toggle-header #btn-favorite-add')).toHaveCount(0);
  await expect(page.locator('#route-toggle-header #btn-export-gpx')).toHaveCount(0);
  await expect(page.locator('#file-management-toggle-header #btn-panel-narrow')).toHaveCount(0);
  await expect(page.locator('#instructions-section')).toHaveCount(0);
  await expect(page.locator('#side-panel-header #btn-panel-narrow')).toBeVisible();
  await expect(page.locator('#side-panel-header .panel-width-btn').first()).toHaveAttribute('id', 'btn-panel-widen');
  await expect(page.locator('#side-panel-header .panel-width-btn').last()).toHaveAttribute('id', 'btn-panel-narrow');
  await expect(page.locator('#side-panel-header #btn-toggle-theme')).toBeVisible();

  // Instructions now live in a modal opened from the panel header.
  await expect(page.locator('#instructions-modal')).toHaveClass(/hidden/);
  await page.locator('#btn-open-instructions').click();
  await expect(page.locator('#instructions-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#instructions-modal .instructions-content .instr-group').first()).toBeVisible();
  await page.locator('#btn-instructions-close').click();
  await expect(page.locator('#instructions-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#file-management-toggle-header .h3-label')).toHaveText(/我的最愛|Favorites/);
  await expect(page.locator('#file-management-toggle-header #btn-favorite-add')).toBeVisible();
  await expect(page.locator('#file-management-toggle-header #btn-import-gpx')).toBeVisible();
  await expect(page.locator('#file-management-toggle-header #btn-export-gpx')).toBeVisible();
  await expect(page.locator('#file-management-toggle-header #btn-favorite-add')).toHaveAttribute('aria-label', '加到最愛');
  await expect(page.locator('#file-management-toggle-header #btn-export-gpx')).toHaveAttribute('aria-label', /匯出|Export/);
  await openRouteLibrary(page);
  await expect(page.locator('#elevation-chart-container')).toBeVisible();
  await expect(page.locator('#chart-empty')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.locator('.offline-status span:last-child')).toContainText(/Offline|離線/);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.locator('.offline-status span:last-child')).toContainText(/Online|線上/);

  // Weather-center quick entries live in the weather settings section and the
  // view shortcut switches the bottom panel to the detailed weather table.
  await clickStable(page, '#settings-toggle-header h3');
  await expect(page.locator('#settings-body')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#btn-weather-quick-fetch')).toBeVisible();
  await clickStable(page, '#btn-weather-quick-view');
  await expect(page.locator('#bottom-panel')).toHaveClass(/bp-mode-weather/);

  // Map-side search entry opens the panel and focuses the keyword search.
  await clickStable(page, '#btn-map-search');
  await expect(page.locator('#side-panel')).toHaveClass(/open/);
  await expect(page.locator('#search-input')).toBeFocused();

  expect(consoleErrors).toEqual([]);
});

test('pace flat placeholder follows unit and activity changes', async ({ page }) => {
  const consoleErrors = await openApp(page);
  const flatInput = page.locator('#pace-flat-input');
  const unitSelect = page.locator('#pace-unit-select');
  const activitySelect = page.locator('#speed-activity-select');

  await unitSelect.selectOption('minkm');
  await expect(flatInput).toHaveAttribute('placeholder', '15.0');
  await activitySelect.selectOption('walking');
  await expect(flatInput).toHaveAttribute('placeholder', '17.1');

  await unitSelect.selectOption('shanhe');
  await expect(flatInput).toHaveAttribute('placeholder', '0.86');
  await activitySelect.selectOption('hiking');
  await expect(flatInput).toHaveAttribute('placeholder', '0.75');

  await unitSelect.selectOption('kmh');
  await expect(flatInput).toHaveAttribute('placeholder', '4.0');
  await activitySelect.selectOption('walking');
  await expect(flatInput).toHaveAttribute('placeholder', '3.5');

  expect(consoleErrors).toEqual([]);
});

test('route mode syncs the default pace activity and keeps manual overrides available', async ({ page }) => {
  const consoleErrors = await openApp(page);
  const activitySelect = page.locator('#speed-activity-select');
  const flatInput = page.locator('#pace-flat-input');

  const chooseRouteMode = async (mode) => {
    await page.locator(`input[name="route-mode"][value="${mode}"]`).evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  await chooseRouteMode('cycling');
  await expect(activitySelect).toHaveValue('cycling');
  await expect(flatInput).toHaveAttribute('placeholder', '15.0');

  await activitySelect.selectOption('trail-run');
  await expect(activitySelect).toHaveValue('trail-run');
  await expect(flatInput).toHaveAttribute('placeholder', '8.0');

  await chooseRouteMode('driving');
  await expect(activitySelect).toHaveValue('driving');
  await expect(flatInput).toHaveAttribute('placeholder', '40.0');
  await expect(page.locator('#stat-kcal-card')).toHaveCSS('display', 'none');
  await expect(page.locator('#pace-load-row')).toHaveCSS('display', 'none');

  await chooseRouteMode('walking');
  await expect(activitySelect).toHaveValue('walking');
  await expect(flatInput).toHaveAttribute('placeholder', '3.5');
  await expect(page.locator('#pace-load-row')).toHaveCSS('display', 'grid');

  expect(consoleErrors).toEqual([]);
});

test('dynamic DOM added after language switch is translated', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await page.locator('#language-select').selectOption('en');
  await page.evaluate(() => {
    const probe = document.createElement('button');
    probe.id = 'dynamic-i18n-probe';
    probe.textContent = '更新天氣';
    probe.title = '點擊複製座標';
    probe.setAttribute('aria-label', '關閉天氣卡');
    document.body.appendChild(probe);
  });

  const probe = page.locator('#dynamic-i18n-probe');
  await expect(probe).toHaveText('Update weather');
  await expect(probe).toHaveAttribute('title', 'Click to copy coordinates');
  await expect(probe).toHaveAttribute('aria-label', 'close the weather card');
  expect(consoleErrors).toEqual([]);
});

test('privacy policy page is available in the release build', async ({ page }) => {
  await page.goto('privacy.html');
  await expect(page.locator('h1')).toContainText('Mapping Elf');
  await expect(page.locator('body')).toContainText('定位權限');
});

test('imports sample KML and keeps route UI functional', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await importFixture(page, sampleKml);
  await expectImportedRoute(page);

  // Bottom panel toggles between the elevation chart and the weather table.
  await clickActionable(page, '#bp-view-toggle [data-bp-view="weather"]');
  await expect(page.locator('.bp-weather-scroll')).toBeVisible();
  await expect(page.locator('#elevation-chart-container')).toBeHidden();
  await clickActionable(page, '#bp-view-toggle [data-bp-view="elev"]');
  await expect(page.locator('#elevation-chart-container')).toBeVisible();
  await expect(page.locator('.bp-weather-scroll')).toBeHidden();

  await clickActionable(page, '#btn-fit-route');
  // Import closes the side panel; reopen it like a user would so the clear
  // button is genuinely actionable instead of DOM-clicked off-canvas.
  await openSidePanel(page);
  await clickActionable(page, '#btn-clear-route');
  await expect(page.locator('#chart-empty')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('opens export modal and reveals map-pack options', async ({ page }) => {
  const consoleErrors = await openApp(page);

  await importFixture(page, sampleKml);
  await expectImportedRoute(page);

  await openSidePanel(page);
  await openRouteLibrary(page);
  await clickActionable(page, '#btn-export-gpx');
  await expect(page.locator('#export-modal')).toBeVisible();
  await expect(page.locator('#export-modal .modal-title')).toHaveText(/匯出|Export/);
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
  await expectImportedRoute(page);
  expect(consoleErrors).toEqual([]);
});
