import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('.leaflet-container').waitFor();
}

test.describe('環狀功能選單 (Radial Features Menu)', () => {
  test('功能按鍵整合 5 大功能區並能展開/收回環狀選單', async ({ page }) => {
    await boot(page);

    const btnFeatures = page.locator('#btn-features-menu');
    const overlay = page.locator('#radial-menu-overlay');
    const btnCenter = page.locator('#btn-radial-center');

    // 1. 功能按鍵存在且初始狀態為未展開
    await expect(btnFeatures).toBeVisible();
    await expect(btnFeatures).toHaveAttribute('aria-expanded', 'false');
    await expect(overlay).not.toHaveClass(/open/);

    // 2. 點擊功能按鍵後在畫面中間環狀排列展開
    await btnFeatures.click();
    await expect(overlay).toHaveClass(/open/);
    await expect(btnFeatures).toHaveAttribute('aria-expanded', 'true');
    await expect(btnCenter).toBeVisible();

    // 5 個功能按鈕皆存在於環狀選單中
    const measureBtn = page.locator('#btn-measure-tool');
    const shapeBtn = page.locator('#btn-shape-tool');
    const starBtn = page.locator('#btn-star-tool');
    const weatherBtn = page.locator('#btn-weather-tool');
    const catchmentBtn = page.locator('#btn-catchment-tool');

    await expect(measureBtn).toBeVisible();
    await expect(shapeBtn).toBeVisible();
    await expect(starBtn).toBeVisible();
    await expect(weatherBtn).toBeVisible();
    await expect(catchmentBtn).toBeVisible();

    // 3. 再點擊一次功能按鍵，收回環狀排列
    await btnFeatures.click();
    await expect(overlay).not.toHaveClass(/open/);
    await expect(btnFeatures).toHaveAttribute('aria-expanded', 'false');

    // 4. 點擊展開後，點擊環狀中間收回環狀排列
    await btnFeatures.click();
    await expect(overlay).toHaveClass(/open/);
    await btnCenter.click();
    await expect(overlay).not.toHaveClass(/open/);
    await expect(btnFeatures).toHaveAttribute('aria-expanded', 'false');

    // 5. 點擊展開後，點擊背景遮罩亦可收回
    await btnFeatures.click();
    await expect(overlay).toHaveClass(/open/);
    await page.locator('#radial-menu-backdrop').click({ position: { x: 200, y: 200 } });
    await expect(overlay).not.toHaveClass(/open/);

    // 6. 點擊展開後，按 Escape 鍵收回
    await btnFeatures.click();
    await expect(overlay).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/open/);

    // 7. 點擊其中一個功能 (如量測工具)，開啟該功能面板並自動收回環狀選單
    await btnFeatures.click();
    await expect(overlay).toHaveClass(/open/);
    await measureBtn.click();
    await expect(overlay).not.toHaveClass(/open/);
    await expect(page.locator('#measure-panel')).toBeVisible();
    await expect(btnFeatures).toHaveAttribute('aria-pressed', 'true');

    // 關閉量測工具面板後，功能按鍵狀態同步重置
    await page.locator('#btn-measure-close').click();
    await expect(page.locator('#measure-panel')).toBeHidden();
    await expect(btnFeatures).toHaveAttribute('aria-pressed', 'false');
  });
});
