import { expect, test } from '@playwright/test';

// 量測工具 / 繪圖板 暫存: panel state, settings and the user's own data (clicked
// points, drawn strokes) must survive a page reload.

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
}

async function reloadApp(page) {
  await page.reload();
  await expect(page.locator('#map')).toBeVisible();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
}

// Non-transparent pixel count — proves the restored strokes were actually
// redrawn, not just held in localStorage.
function canvasInk(page) {
  return page.evaluate(() => {
    const cv = document.getElementById('shape-canvas');
    const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
}

test('drawing board keeps its sketch and settings across a reload', async ({ page }) => {
  await openApp(page);
  await page.locator('#btn-shape-tool').click();
  await expect(page.locator('#shape-panel')).toBeVisible();

  const box = await page.locator('#shape-canvas').boundingBox();
  const pad = 30;
  await page.mouse.move(box.x + pad, box.y + pad);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - pad, box.y + pad, { steps: 12 });
  await page.mouse.move(box.x + box.width - pad, box.y + box.height - pad, { steps: 12 });
  await page.mouse.move(box.x + pad, box.y + box.height - pad, { steps: 12 });
  await page.mouse.up();
  expect(await canvasInk(page)).toBeGreaterThan(0);

  // Settings are saved on change — no 產生路線 needed.
  await page.locator('#shape-distance-input').fill('4');
  await page.locator('#shape-distance-input').dispatchEvent('change');
  await page.locator('#shape-angle-select').selectOption('45');
  await page.locator('#shape-trim-spurs').uncheck();

  await reloadApp(page);

  await expect(page.locator('#shape-panel')).toBeVisible();
  await expect(page.locator('#btn-shape-tool')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#shape-distance-input')).toHaveValue('4');
  await expect(page.locator('#shape-angle-select')).toHaveValue('45');
  await expect(page.locator('#shape-trim-spurs')).not.toBeChecked();
  expect(await canvasInk(page)).toBeGreaterThan(0);

  // 清除 wipes the saved board too.
  await page.locator('#btn-shape-clear').click();
  await reloadApp(page);
  await expect(page.locator('#shape-panel')).toBeVisible();
  expect(await canvasInk(page)).toBe(0);
});

test('segment measurement replays once the restored route lands', async ({ page }) => {
  // Straight-line fallback route + stubbed elevation, as in map-measure-tools.spec.js.
  await page.route(/brouter\.de\/brouter/, (r) => r.fulfill({ status: 500, body: 'down' }));
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, (route) => {
    const url = new URL(route.request().url());
    const n = (url.searchParams.get('latitude') || '').split(',').length;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: Array.from({ length: n }, () => 100) }) });
  });

  await openApp(page);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + 400, box.y + 220);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(box.x + 660, box.y + 380);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
  await page.locator('#map .leaflet-overlay-pane path').first().waitFor({ timeout: 20_000 });
  await page.locator('#route-weather-busy-overlay').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => { });
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '.leaflet-marker-icon, .leaflet-marker-icon *, .leaflet-tooltip-pane, .leaflet-shadow-pane { pointer-events: none !important; }' });

  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();
  const [a, b] = await page.evaluate(() => {
    const path = document.querySelector('#map .leaflet-overlay-pane path');
    const len = path.getTotalLength();
    const m = path.getScreenCTM();
    const at = (l) => { const p = path.getPointAtLength(l); return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; };
    const clear = [];
    for (let t = 0.15; t <= 0.85; t += 0.02) {
      const pt = at(len * t);
      const el = document.elementFromPoint(Math.round(pt.x), Math.round(pt.y));
      if (el && el.tagName.toLowerCase() === 'path') clear.push(pt);
    }
    return [clear[0], clear[clear.length - 1]];
  });
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect(page.locator('#measure-readout')).not.toBeEmpty();

  await reloadApp(page);

  await expect(page.locator('#measure-panel')).toBeVisible();
  // The track only exists after the restored route is planned again, so the
  // measurement replays asynchronously.
  await expect(page.locator('#measure-readout .mr-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
});

test('measure tool keeps mode and clicked points across a reload', async ({ page }) => {
  await openApp(page);
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();
  await page.locator('.measure-mode-btn[data-measure-mode="area"]').click();

  const map = await page.locator('#map').boundingBox();
  const cx = map.x + map.width / 2, cy = map.y + map.height / 2;
  for (const [dx, dy] of [[-60, -40], [60, -40], [40, 60]]) {
    await page.mouse.click(cx + dx, cy + dy);
  }
  await expect(page.locator('#measure-readout .mr-row')).toHaveCount(3);

  await reloadApp(page);

  await expect(page.locator('#measure-panel')).toBeVisible();
  await expect(page.locator('.measure-mode-btn[data-measure-mode="area"]')).toHaveClass(/active/);
  // 點數 / 直線距離 / 包圍面積 are recomputed from the restored points.
  await expect(page.locator('#measure-readout .mr-row')).toHaveCount(3);
  await expect(page.locator('#measure-readout .mr-row').first().locator('.mr-value')).toHaveText('3');

  // Closing the tool drops the overlay, so nothing comes back on the next load.
  await page.locator('#btn-measure-close').click();
  await reloadApp(page);
  await expect(page.locator('#measure-panel')).toBeHidden();
  await expect(page.locator('#measure-readout .mr-row')).toHaveCount(0);
});
