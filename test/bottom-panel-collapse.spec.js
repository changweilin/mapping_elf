import { test, expect } from '@playwright/test';

// 下方面板 (高度圖) operation contract:
//   - dragging the 分割線 past the floor shuts the panel completely, leaving only
//     the grab bar (it is the only way back, so it must stay on screen);
//   - dbl-clicking the 分割線 cycles 預設 → 全展開 → 全收起 → 預設;
//   - a fully expanded panel must not shove the floating map buttons off screen.

async function boot(page) {
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('.leaflet-container').waitFor();
  // The height is applied in a rAF after boot; settle before measuring.
  await expect.poll(() => panelHeight(page)).toBeGreaterThan(100);
}

const panelHeight = (page) => page.locator('#bottom-panel').evaluate((el) => el.offsetHeight);
const handleHeight = (page) => page.locator('#bp-resize-handle').evaluate((el) => el.offsetHeight);

// Grab the divider near the right edge: the left side is where the floating
// panels/buttons live, and they would swallow the drag.
async function dragDividerTo(page, clientY) {
  const handle = await page.locator('#bp-resize-handle').boundingBox();
  const { width: vw } = page.viewportSize();
  const x = Math.min(handle.x + handle.width - 20, vw - 20);
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, clientY, { steps: 10 });
  await page.mouse.up();
}

async function dblClickDivider(page) {
  const handle = await page.locator('#bp-resize-handle').boundingBox();
  const { width: vw } = page.viewportSize();
  await page.mouse.dblclick(Math.min(handle.x + handle.width - 20, vw - 20), handle.y + handle.height / 2);
}

test('dragging the 分割線 to the floor collapses the panel to its grab bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  const bar = await handleHeight(page);

  // Past the bottom edge: the drag must snap shut, not park at a content stub.
  await dragDividerTo(page, 800);

  await expect.poll(() => panelHeight(page)).toBeLessThanOrEqual(bar + 2);
  await expect(page.locator('#bottom-panel')).toHaveClass(/bp-collapsed/);
  await expect(page.locator('#bp-resize-handle')).toBeVisible();
  await expect(page.locator('#route-summary-bar')).toBeHidden();
  await expect(page.locator('#bp-view-toggle')).toBeHidden();

  // Collapsed means out of the way: the map now owns the screen.
  const mapBottom = await page.locator('#map').evaluate((el) => el.getBoundingClientRect().bottom);
  expect(mapBottom).toBeGreaterThanOrEqual(800 - bar - 2);

  // And the bar is still draggable back open.
  await dragDividerTo(page, 450);
  await expect.poll(() => panelHeight(page)).toBeGreaterThan(300);
  await expect(page.locator('#bottom-panel')).not.toHaveClass(/bp-collapsed/);
});

test('a collapsed panel comes back collapsed after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  const bar = await handleHeight(page);
  await dragDividerTo(page, 800);
  await expect.poll(() => panelHeight(page)).toBeLessThanOrEqual(bar + 2);

  await page.reload();
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('.leaflet-container').waitFor();

  // The saved ratio is a couple of pixels, which must restore as "shut", not as
  // a stub whose content spills out of it.
  await expect(page.locator('#bottom-panel')).toHaveClass(/bp-collapsed/);
  expect(await panelHeight(page)).toBeLessThanOrEqual(bar + 2);
  await expect(page.locator('#bp-resize-handle')).toBeVisible();
});

test('dbl-clicking the 分割線 cycles 預設 → 全展開 → 全收起 → 預設', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  const bar = await handleHeight(page);
  const toolbarH = await page.locator('#toolbar').evaluate((el) => el.offsetHeight);
  const defaultH = await panelHeight(page);

  await dblClickDivider(page);
  await expect.poll(() => panelHeight(page)).toBeGreaterThanOrEqual(800 - toolbarH - 1);

  await dblClickDivider(page);
  await expect.poll(() => panelHeight(page)).toBeLessThanOrEqual(bar + 2);

  // Back to 預設: re-measured from the live layout, so allow a pixel of drift.
  await dblClickDivider(page);
  await expect.poll(async () => Math.abs(await panelHeight(page) - defaultH)).toBeLessThanOrEqual(4);
});

test('an expanded panel tiles with the 設置面板 instead of eating it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await expect(page.locator('#side-panel')).toHaveClass(/open/);

  await dblClickDivider(page);
  await expect.poll(() => panelHeight(page)).toBeGreaterThan(600);

  const side = await page.locator('#side-panel').boundingBox();
  const bottom = await page.locator('#bottom-panel').boundingBox();
  expect(side.height, '設置面板 keeps its full height').toBeGreaterThan(600);
  expect(bottom.x + bottom.width, 'panel stops at the 設置面板 edge').toBeLessThanOrEqual(side.x + 1);

  // The grab bar stays hit-testable: the side panel's sticky header sits in the
  // same band, and it used to swallow the dbl-click that reopens the panel.
  const handle = await page.locator('#bp-resize-handle').boundingBox();
  const pt = { x: Math.round(handle.x + handle.width - 10), y: Math.round(handle.y + handle.height / 2) };
  expect(await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('#bp-resize-handle'), pt)).toBe(true);
});

test('a fully expanded panel keeps the floating map buttons on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);

  await dblClickDivider(page);
  await expect.poll(() => panelHeight(page)).toBeGreaterThan(600);

  // The buttons ride --bottom-panel-offset, which is capped; before that they
  // followed the raw panel height straight off the top of the viewport.
  const btns = await page.locator('.map-action-btns').boundingBox();
  const toolbar = await page.locator('#toolbar').boundingBox();
  expect(btns.y, 'buttons stay below the toolbar').toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);
  expect(btns.y + btns.height, 'buttons stay on screen').toBeLessThanOrEqual(800);
});
