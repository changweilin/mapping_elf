import { test, expect } from '@playwright/test';

// 集水區域 switch (#catchment-enable-block) — the feature master, since 水文資訊
// is computed from the 區域. The feature reaches four separate surfaces; the switch
// has to lock every one of them (plus the 資訊 switch), survive a reload, and step
// the user off whichever catchment surface is currently showing.

const MEASURE_CATCHMENT = '#measure-mode-toggle [data-measure-mode="catchment"]';
const BP_CATCHMENT = '#bp-view-toggle [data-bp-view="catchment"]';

// The switch lives in the 天氣設置 section body, which starts collapsed.
async function openApp(page) {
  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#settings-toggle-header h3').click();
  await expect(page.locator('#catchment-enable-block')).toBeVisible();
}

test('catchment switch defaults on and every catchment control is usable', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#catchment-enable-block')).toBeChecked();
  for (const sel of [MEASURE_CATCHMENT, BP_CATCHMENT, '#wp-detail-catchment', '#im-detail-catchment',
    '#btn-catchment-quick-fetch', '#btn-catchment-quick-view']) {
    await expect(page.locator(sel)).toBeEnabled();
  }
});

test('集水區域 and 水文資訊 sit side by side on one row', async ({ page }) => {
  await openApp(page);
  const boxes = async () => ({
    block: await page.locator('#catchment-enable-block').locator('xpath=ancestor::label').boundingBox(),
    info: await page.locator('#catchment-enable-info').locator('xpath=ancestor::label').boundingBox(),
  });
  // The 天氣設置 body animates open — measure only once the row has settled.
  await expect.poll(async () => {
    const { block, info } = await boxes();
    return Math.round(block.y) === Math.round(info.y);
  }).toBe(true);

  const { block, info } = await boxes();
  expect(block.x + block.width).toBeLessThanOrEqual(info.x + 1);  // 區域 left, 水文 right
  // Both halves share the row evenly rather than one shrinking to its text.
  expect(Math.abs(block.width - info.width)).toBeLessThan(2);
});

test('switching off locks every catchment entry point, switching back on restores them', async ({ page }) => {
  await openApp(page);
  await page.locator('#catchment-enable-block').uncheck();

  const gated = [MEASURE_CATCHMENT, BP_CATCHMENT, '#catchment-enable-info',
    '#wp-detail-catchment', '#im-detail-catchment',
    '#btn-catchment-quick-fetch', '#btn-catchment-quick-view'];
  for (const sel of gated) await expect(page.locator(sel)).toBeDisabled();
  // The per-waypoint 詳細集水區 row reads as locked, not missing.
  await expect(page.locator('#waypoint-settings-body .wpm-row-label.catchment-gated')).toHaveClass(/is-locked/);

  await page.locator('#catchment-enable-block').check();
  for (const sel of gated) await expect(page.locator(sel)).toBeEnabled();
});

test('switching off steps the bottom panel out of the 集水區 view', async ({ page }) => {
  await openApp(page);
  await page.locator(BP_CATCHMENT).click();
  await expect(page.locator('#bottom-panel')).toHaveClass(/bp-mode-catchment/);

  await page.locator('#catchment-enable-block').uncheck();
  await expect(page.locator('#bottom-panel')).toHaveClass(/bp-mode-elev/);
  await expect(page.locator(BP_CATCHMENT)).not.toHaveClass(/active/);
});

test('switching off drops the 量測工具 out of catchment mode', async ({ page }) => {
  await openApp(page);
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();
  await page.locator(MEASURE_CATCHMENT).click();
  await expect(page.locator(MEASURE_CATCHMENT)).toHaveClass(/active/);

  await page.locator('#catchment-enable-block').uncheck();
  await expect(page.locator(MEASURE_CATCHMENT)).not.toHaveClass(/active/);
  await expect(page.locator('#measure-mode-toggle [data-measure-mode="segment"]')).toHaveClass(/active/);
});

test('the off state persists across a reload and blocks a restored catchment surface', async ({ page }) => {
  await openApp(page);
  // Leave both the panel view and the measure tool parked on 集水區 first, so the
  // reload has a saved catchment surface to refuse.
  await page.locator(BP_CATCHMENT).click();
  await page.locator('#btn-measure-tool').click();
  await page.locator(MEASURE_CATCHMENT).click();
  await expect(page.locator(MEASURE_CATCHMENT)).toHaveClass(/active/);
  await page.locator('#catchment-enable-block').uncheck();

  await page.reload();
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#settings-toggle-header h3').click();
  await expect(page.locator('#catchment-enable-block')).not.toBeChecked();
  await expect(page.locator(MEASURE_CATCHMENT)).toBeDisabled();
  await expect(page.locator(BP_CATCHMENT)).toBeDisabled();
  await expect(page.locator('#bottom-panel')).toHaveClass(/bp-mode-elev/);
  await expect(page.locator('#measure-mode-toggle [data-measure-mode="segment"]')).toHaveClass(/active/);
});

test('a locked 集水區 measure mode cannot be entered by clicking the map', async ({ page }) => {
  let elevationCalls = 0;
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, (route) => { elevationCalls++; route.abort(); });
  await openApp(page);
  await page.locator('#catchment-enable-block').uncheck();
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();

  // force:true bypasses actionability so a genuinely dead button is proven dead
  // rather than just unclickable.
  await page.locator(MEASURE_CATCHMENT).click({ force: true });
  await expect(page.locator(MEASURE_CATCHMENT)).not.toHaveClass(/active/);
  expect(elevationCalls).toBe(0);
});
