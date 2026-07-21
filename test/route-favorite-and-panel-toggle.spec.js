import { test, expect } from '@playwright/test';

test('F1: route toolbar 3D button replaced by add-to-favorite', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#btn-open-3d-viewer')).toHaveCount(0);
  await expect(page.locator('#btn-favorite-quick')).toHaveCount(1);
  // Top 2D/3D toggle still exists (3D access preserved).
  await expect(page.locator('#btn-view-3d')).toHaveCount(1);
});

test('F5: bottom panel toggles between elevation chart and weather table', async ({ page }) => {
  await page.goto('/');
  // Collapse toggle removed.
  await expect(page.locator('#btn-toggle-elevation')).toHaveCount(0);
  const toggle = page.locator('#bp-view-toggle');
  await expect(toggle).toHaveCount(1);

  const chart = page.locator('#elevation-chart-container');
  const weather = page.locator('.bp-weather-scroll');

  // Default: elevation chart visible, weather hidden.
  await expect(chart).toBeVisible();
  await expect(weather).toBeHidden();

  // Switch to weather.
  await toggle.locator('[data-bp-view="weather"]').click();
  await expect(weather).toBeVisible();
  await expect(chart).toBeHidden();

  // Switch back to elevation.
  await toggle.locator('[data-bp-view="elev"]').click();
  await expect(chart).toBeVisible();
  await expect(weather).toBeHidden();

  // Persists across reload.
  await toggle.locator('[data-bp-view="weather"]').click();
  await page.reload();
  await expect(page.locator('.bp-weather-scroll')).toBeVisible();
  await expect(page.locator('#elevation-chart-container')).toBeHidden();
  // Panel did not collapse to chips-only on reload.
  const panelH = await page.locator('#bottom-panel').evaluate((el) => el.offsetHeight);
  expect(panelH).toBeGreaterThan(120);
});
