import { test, expect } from '@playwright/test';

// 副航點設置 master — the interval mode itself (關 / 距離 / 配速). 關 means no 副航點
// is ever generated, so every 副航點-only control must lock (not vanish), including
// the ones that share an owner with another gate: 詳細集水區 (also under the 集水區
// master) and 全副航點 (also under 全航點).

const IM_GATED = ['#show-intermediate-weather-icon', '#im-detail-weather',
  '#im-detail-catchment', '#collective-intermediate-pts'];

async function openWaypointSettings(page) {
  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  // The side panel starts closed on a phone viewport; on desktop it is already open.
  const panel = page.locator('#side-panel');
  if (!await panel.evaluate((el) => el.classList.contains('open'))) {
    await page.locator('#btn-toggle-panel').click();
    await expect(panel).toHaveClass(/open/);
  }
  await page.locator('#waypoint-settings-toggle-header h3').click();
  await expect(page.locator('#show-intermediate-weather-icon')).toBeVisible();
}

test('desktop defaults to 配速, and every 副航點 control is usable', async ({ page }) => {
  await openWaypointSettings(page);
  await expect(page.locator('#interval-mode-pace')).toBeChecked();
  for (const sel of IM_GATED) await expect(page.locator(sel)).toBeEnabled();
});

test('關 locks every 副航點 control, 配速 restores them', async ({ page }) => {
  await openWaypointSettings(page);
  await page.locator('#interval-mode-off').check();

  for (const sel of IM_GATED) await expect(page.locator(sel)).toBeDisabled();
  // Locked, not hidden: the 副航點 column still reads as a column.
  await expect(page.locator('.wpm-col-head.intermediate-gated')).toHaveClass(/is-im-locked/);
  await expect(page.locator('.wpm-col-head.intermediate-gated')).toBeVisible();

  await page.locator('#interval-mode-pace').check();
  for (const sel of IM_GATED) await expect(page.locator(sel)).toBeEnabled();
});

test('距離 counts as on — 副航點 controls stay usable', async ({ page }) => {
  await openWaypointSettings(page);
  await page.locator('#interval-mode-off').check();
  await expect(page.locator('#im-detail-weather')).toBeDisabled();
  await page.locator('#interval-mode-distance').check();
  for (const sel of IM_GATED) await expect(page.locator(sel)).toBeEnabled();
});

test('the 關 state survives a reload', async ({ page }) => {
  await openWaypointSettings(page);
  await page.locator('#interval-mode-off').check();

  await page.reload();
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#waypoint-settings-toggle-header h3').click();
  await expect(page.locator('#interval-mode-off')).toBeChecked();
  for (const sel of IM_GATED) await expect(page.locator(sel)).toBeDisabled();
});

// Two masters reach 詳細集水區 for 副航點; neither may clear the other's lock.
test('詳細集水區 for 副航點 stays locked while either master is off', async ({ page }) => {
  await openWaypointSettings(page);
  await page.locator('#interval-mode-off').check();
  await page.locator('#settings-toggle-header h3').click();
  await page.locator('#catchment-enable-block').uncheck();
  await expect(page.locator('#im-detail-catchment')).toBeDisabled();

  // 集水區 back on — still locked, because 副航點 is 關.
  await page.locator('#catchment-enable-block').check();
  await expect(page.locator('#im-detail-catchment')).toBeDisabled();
  await expect(page.locator('#wp-detail-catchment')).toBeEnabled();

  await page.locator('#interval-mode-pace').check();
  await expect(page.locator('#im-detail-catchment')).toBeEnabled();
});

// 全航點 disables 全副航點 too; the 副航點 master must not re-enable it.
test('全副航點 stays locked under 全航點 regardless of the 副航點 master', async ({ page }) => {
  await openWaypointSettings(page);
  await page.locator('#collective-all-waypoints').check();
  await expect(page.locator('#collective-intermediate-pts')).toBeDisabled();

  await page.locator('#interval-mode-off').check();
  await expect(page.locator('#collective-intermediate-pts')).toBeDisabled();
  await page.locator('#interval-mode-pace').check();
  await expect(page.locator('#collective-intermediate-pts')).toBeDisabled();

  await page.locator('#collective-all-waypoints').uncheck();
  await expect(page.locator('#collective-intermediate-pts')).toBeEnabled();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('手機版預設關閉：副航點 starts 關 with its controls locked', async ({ page }) => {
    await openWaypointSettings(page);
    await expect(page.locator('#interval-mode-off')).toBeChecked();
    for (const sel of IM_GATED) await expect(page.locator(sel)).toBeDisabled();
  });
});
