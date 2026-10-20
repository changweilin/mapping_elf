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

    // 驗證叉叉鍵剛好在地圖畫面的最中間
    const mapBox = await page.locator('#map').boundingBox();
    const centerBox = await btnCenter.boundingBox();
    const mapCenter = { x: mapBox.x + mapBox.width / 2, y: mapBox.y + mapBox.height / 2 };
    const btnCenterPoint = { x: centerBox.x + centerBox.width / 2, y: centerBox.y + centerBox.height / 2 };
    expect(Math.abs(btnCenterPoint.x - mapCenter.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(btnCenterPoint.y - mapCenter.y)).toBeLessThanOrEqual(2);

    // 等待展開動畫（0.38s + delay）完成定點
    await page.waitForTimeout(450);

    // 驗證 5 個功能鍵以叉叉鍵為圓心，半徑一致
    for (const btn of [measureBtn, shapeBtn, starBtn, weatherBtn, catchmentBtn]) {
      const box = await btn.boundingBox();
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const dist = Math.hypot(pt.x - btnCenterPoint.x, pt.y - btnCenterPoint.y);
      expect(Math.abs(dist - 125)).toBeLessThanOrEqual(3);
    }

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

    // 8. 展開的單一功能頁面在地圖畫面置中
    const mapBoxCurrent = await page.locator('#map').boundingBox();
    const panelBox = await page.locator('#measure-panel').boundingBox();
    const currentMapCenter = { x: mapBoxCurrent.x + mapBoxCurrent.width / 2, y: mapBoxCurrent.y + mapBoxCurrent.height / 2 };
    const panelCenter = { x: panelBox.x + panelBox.width / 2, y: panelBox.y + panelBox.height / 2 };
    expect(Math.abs(panelCenter.x - currentMapCenter.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(panelCenter.y - currentMapCenter.y)).toBeLessThanOrEqual(2);

    // 展開單一功能頁面時，再點一次功能選單會收回展開的功能頁面
    await btnFeatures.click();
    await expect(page.locator('#measure-panel')).toBeHidden();
    await expect(overlay).not.toHaveClass(/open/);
    await expect(btnFeatures).toHaveAttribute('aria-pressed', 'false');

    // 9. 環狀選單的 5 個功能鍵各自對應一個專屬顏色
    await btnFeatures.click();
    await expect(overlay).toHaveClass(/open/);
    const colors = await Promise.all([
      measureBtn.evaluate((el) => getComputedStyle(el).getPropertyValue('--radial-item-color').trim()),
      shapeBtn.evaluate((el) => getComputedStyle(el).getPropertyValue('--radial-item-color').trim()),
      starBtn.evaluate((el) => getComputedStyle(el).getPropertyValue('--radial-item-color').trim()),
      weatherBtn.evaluate((el) => getComputedStyle(el).getPropertyValue('--radial-item-color').trim()),
      catchmentBtn.evaluate((el) => getComputedStyle(el).getPropertyValue('--radial-item-color').trim()),
    ]);
    // 每個按鍵都有定義顏色且彼此獨立互不相同
    expect(colors.every(c => !!c)).toBe(true);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(5);

    // 收回環狀選單
    await btnCenter.click();
    await expect(overlay).not.toHaveClass(/open/);
  });

  test('手機視窗下叉叉鍵依然在地圖最中間且各功能鍵以其為圓心', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);

    const btnFeatures = page.locator('#btn-features-menu');
    const btnCenter = page.locator('#btn-radial-center');

    await btnFeatures.click();
    await page.waitForTimeout(450);

    const mapBox = await page.locator('#map').boundingBox();
    const centerBox = await btnCenter.boundingBox();
    const mapCenter = { x: mapBox.x + mapBox.width / 2, y: mapBox.y + mapBox.height / 2 };
    const btnCenterPoint = { x: centerBox.x + centerBox.width / 2, y: centerBox.y + centerBox.height / 2 };

    expect(Math.abs(btnCenterPoint.x - mapCenter.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(btnCenterPoint.y - mapCenter.y)).toBeLessThanOrEqual(2);

    for (const id of ['#btn-measure-tool', '#btn-shape-tool', '#btn-star-tool', '#btn-weather-tool', '#btn-catchment-tool']) {
      const box = await page.locator(id).boundingBox();
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const dist = Math.hypot(pt.x - btnCenterPoint.x, pt.y - btnCenterPoint.y);
      expect(Math.abs(dist - 108)).toBeLessThanOrEqual(3);
    }
  });

  test('各功能頁面上方標題列貼齊頂部且不遮住下方操作區塊', async ({ page }) => {
    await boot(page);
    const btnFeatures = page.locator('#btn-features-menu');

    const tools = [
      { btn: '#btn-measure-tool', panel: '#measure-panel', close: '#btn-measure-close' },
      { btn: '#btn-shape-tool', panel: '#shape-panel', close: '#btn-shape-close' },
      { btn: '#btn-star-tool', panel: '#star-panel', close: '#btn-star-close' },
      { btn: '#btn-weather-tool', panel: '#weather-panel', close: '#btn-weather-close' },
      { btn: '#btn-catchment-tool', panel: '#catchment-panel', close: '#btn-catchment-close' },
    ];

    for (const t of tools) {
      await btnFeatures.click();
      await page.locator(t.btn).click();
      const panel = page.locator(t.panel);
      await expect(panel).toBeVisible();

      const head = panel.locator('.measure-panel-head');
      const panelBox = await panel.boundingBox();
      const headBox = await head.boundingBox();

      // 標題列頂部貼齊面板（在 3px 頂部裝飾框之內，無多餘下沉）
      expect(headBox.y - panelBox.y).toBeLessThanOrEqual(3.5);

      // 下方第一組操作區塊不被標題列遮住
      const nextOp = panel.locator('> *:nth-child(2)');
      const nextBox = await nextOp.boundingBox();
      expect(nextBox.y).toBeGreaterThanOrEqual(headBox.y + headBox.height);

      await page.locator(t.close).click();
      await expect(panel).toBeHidden();
    }
  });
});
