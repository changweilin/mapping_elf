import { test, expect } from '@playwright/test';

async function openMeasure(page) {
  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();
  await expect(page.locator('#btn-measure-tool')).toHaveAttribute('aria-pressed', 'true');
}

test('F2: measure tool opens and toggles modes', async ({ page }) => {
  await openMeasure(page);
  await expect(page.locator('#measure-hint')).not.toBeEmpty();
  await expect(page.locator('[data-measure-mode="segment"]')).toHaveClass(/active/);
  await page.locator('[data-measure-mode="area"]').click();
  await expect(page.locator('[data-measure-mode="area"]')).toHaveClass(/active/);
  await expect(page.locator('[data-measure-mode="segment"]')).not.toHaveClass(/active/);
});

test('F2: area mode computes length and enclosed area', async ({ page }) => {
  await openMeasure(page);
  await page.locator('[data-measure-mode="area"]').click();
  const map = page.locator('#map');
  const box = await map.boundingBox();
  const cx = box.x, cy = box.y;
  // three distinct points forming a triangle, clear of the left-side panel
  await page.mouse.click(cx + 450, cy + 200);
  await page.mouse.click(cx + 650, cy + 210);
  await page.mouse.click(cx + 640, cy + 400);
  const readout = page.locator('#measure-readout');
  // 3 rows: points count, total length, enclosed area
  await expect(readout.locator('.mr-row')).toHaveCount(3);
  // enclosed area has a real unit and non-zero value
  await expect(readout).toContainText(/(km²|ha|m²)/);
  await expect(readout).not.toContainText(/(^|[^.\d])0 m²/);
  // clear resets
  await page.locator('#btn-measure-clear').click();
  await expect(readout).toBeEmpty();
});

test('F2: segment mode without a route warns and stays empty', async ({ page }) => {
  await openMeasure(page);
  const map = page.locator('#map');
  const box = await map.boundingBox();
  await page.mouse.click(box.x + 450, box.y + 250);
  // No route planned -> readout stays empty (guard fired).
  await expect(page.locator('#measure-readout')).toBeEmpty();
});
