import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const shortGpx = path.join(repoRoot, 'data', 'app-test-routes', 'short-zh-weather.gpx');

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
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  return consoleErrors;
}

async function clickStable(page, selector) {
  const locator = page.locator(selector);
  await expect(locator).toBeAttached();
  await locator.evaluate((el) => el.click());
}

test.describe('mobile app QA', () => {
  test.use({ hasTouch: true, viewport: { width: 667, height: 375 } });

  test('export modal stays inside a small landscape viewport', async ({ page }) => {
    const consoleErrors = await openApp(page);

    await page.locator('#gpx-file-input').setInputFiles(shortGpx);
    await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();

    await clickStable(page, '#btn-export-gpx');
    await expect(page.locator('#export-modal')).toBeVisible();
    await page.locator('input[name="export-fmt"][value="melmap"]').check();
    await expect(page.locator('#melmap-sub-options')).toBeVisible();

    const bounds = await page.locator('#export-modal .modal-box').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        canScroll: el.scrollHeight >= el.clientHeight,
      };
    });
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
    await expect(page.locator('#btn-export-confirm')).toBeVisible();
    await expect(page.locator('#btn-export-cancel')).toBeVisible();

    await page.locator('#btn-export-cancel').click();
    await expect(page.locator('#export-modal')).toHaveClass(/hidden/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    expect(consoleErrors).toEqual([]);
  });
});
