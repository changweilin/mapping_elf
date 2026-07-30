import { test, expect } from '@playwright/test';

// Overlay bounds contract for two floating controls that used to be unusable:
//   - the 3D viewer's 列印 dropdown opens into the same band as the floating
//     2D/3D pill (position:fixed at toolbar+10px), which used to paint over it.
//   - 量測工具 / 繪圖板 ride above #bottom-panel; dragging the 分割線 up used to
//     shove them off the top of the screen, taking the close X with them.

function overlaps(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function intersectionCentre(a, b) {
  const x1 = Math.max(a.x, b.x), x2 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y, b.y), y2 = Math.min(a.y + a.height, b.y + b.height);
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

async function boot(page) {
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('.leaflet-container').waitFor();
}

// Drag the bottom-panel divider up to `targetHeight` px, the way a user would.
// Grabbed near the right edge: the floating panels under test sit at left:56px
// and would otherwise swallow the drag (the 繪圖板 canvas would draw a stroke).
async function dragDivider(page, targetHeight) {
  const bottom = page.locator('#bottom-panel');
  const before = (await bottom.boundingBox()).height;
  const handle = await page.locator('#bp-resize-handle').boundingBox();
  const { width: vw, height: vh } = page.viewportSize();
  const x = Math.min(handle.x + handle.width - 20, vw - 20);
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, vh - targetHeight, { steps: 10 });
  await page.mouse.up();
  // The drag has to have actually moved the divider, or every assertion below
  // would be checking an untouched layout.
  await expect.poll(async () => (await bottom.boundingBox()).height).toBeGreaterThan(before);
}

test('3D toolbar 列印 dropdown paints above the 2D/3D pill on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);

  // Pure stacking contract — show the viewer chrome and its dropdown directly
  // instead of paying for a full terrain build.
  await page.evaluate(() => {
    document.getElementById('terrain-viewer').classList.remove('hidden');
    document.getElementById('tv-export-menu').classList.remove('hidden');
  });

  const pill = await page.locator('.tv-view-mode-toggle').boundingBox();
  const menu = await page.locator('#tv-export-menu').boundingBox();
  // The overlap is what makes this a real test: at phone width the dropdown
  // reaches back under the centred pill.
  expect(overlaps(pill, menu), 'pill and 列印 menu overlap at 390px').toBe(true);

  const p = intersectionCentre(pill, menu);
  expect(await page.evaluate((pt) => !!document.elementFromPoint(pt.x, pt.y)?.closest('#tv-export-menu'), p)).toBe(true);
});

for (const [label, size] of [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 740, height: 360 }],
]) {
  test(`繪圖板 stays inside the viewport with a tall bottom panel (${label})`, async ({ page }) => {
    await page.setViewportSize(size);
    await boot(page);
    await page.locator('#btn-shape-tool').click();
    await expect(page.locator('#shape-panel')).toBeVisible();

    // Divider dragged nearly to the toolbar — the worst case for the panel.
    await dragDivider(page, size.height - 80);

    const panel = await page.locator('#shape-panel').boundingBox();
    const toolbar = await page.locator('#toolbar').boundingBox();
    expect(panel.y, 'panel top clears the toolbar').toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    expect(panel.y + panel.height, 'panel bottom stays on screen').toBeLessThanOrEqual(size.height);

    // The close X is reachable: on screen, unobstructed, and it actually closes.
    const close = page.locator('#btn-shape-close');
    const box = await close.boundingBox();
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('#btn-shape-close'), centre)).toBe(true);
    await close.click();
    await expect(page.locator('#shape-panel')).toBeHidden();
  });
}

test('量測工具 overlays the bottom panel instead of being pushed off screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();

  const before = await page.locator('#measure-panel').boundingBox();
  await dragDivider(page, 600);
  const after = await page.locator('#measure-panel').boundingBox();

  // Phone rule: the panel ignores the 分割線 entirely.
  expect(Math.round(after.y), 'panel does not follow the divider').toBe(Math.round(before.y));

  // And it wins the overlap against #bottom-panel (z:200 vs the panel's z:620).
  const bottom = await page.locator('#bottom-panel').boundingBox();
  expect(overlaps(after, bottom), 'panel now overlaps the bottom panel').toBe(true);
  const p = intersectionCentre(after, bottom);
  expect(await page.evaluate((pt) => !!document.elementFromPoint(pt.x, pt.y)?.closest('#measure-panel'), p)).toBe(true);
});
