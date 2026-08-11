import { test, expect } from '@playwright/test';

// Layout contract for the two icon-only switches and the floating 2D/3D pill:
//   - #bp-view-toggle must stay narrow enough to never cover the summary bar's
//     距離 / 預估時間 chips it is positioned over.
//   - the expanded 設置面板 must paint above the pill (the pill used to sit in the
//     toolbar's stacking context and punch through the panel on phones).

function overlaps(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

async function boot(page) {
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('#bp-view-toggle').waitFor();
}

test('bottom-panel view switch is icon-only and clears the summary chips', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await boot(page);

  const toggle = page.locator('#bp-view-toggle');
  // Icons only — no text labels to widen the pill.
  expect((await toggle.innerText()).trim()).toBe('');
  await expect(toggle.locator('.bp-view-btn svg')).toHaveCount(3);
  expect((await toggle.boundingBox()).width).toBeLessThan(110);

  // Unhide the estimated-time chip (route-less by default) so it can be checked too.
  await page.locator('#rsb-time-chip').evaluate((el) => el.classList.remove('hidden'));
  const toggleBox = await toggle.boundingBox();
  for (const id of ['#rsb-distance', '#rsb-time']) {
    const chip = await page.locator(id).boundingBox();
    expect(overlaps(toggleBox, chip), `${id} sits under #bp-view-toggle`).toBe(false);
  }
});

// Was route-favorite-and-panel-toggle.spec.js "F5": the panel switches panes
// instead of stacking them, the old collapse button is gone, and a restored
// weather view must not come back as a chips-only sliver (the height fallback
// measures the summary bar + chart row).
test('bottom-panel view switch exchanges panes and survives a reload', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#btn-toggle-elevation')).toHaveCount(0);

  const toggle = page.locator('#bp-view-toggle');
  const chart = page.locator('#elevation-chart-container');
  const weather = page.locator('.bp-weather-scroll');

  await expect(chart).toBeVisible();
  await expect(weather).toBeHidden();

  await toggle.locator('[data-bp-view="weather"]').click();
  await expect(weather).toBeVisible();
  await expect(chart).toBeHidden();

  await toggle.locator('[data-bp-view="elev"]').click();
  await expect(chart).toBeVisible();
  await expect(weather).toBeHidden();

  await toggle.locator('[data-bp-view="weather"]').click();
  await page.reload();
  await expect(page.locator('.bp-weather-scroll')).toBeVisible();
  await expect(page.locator('#elevation-chart-container')).toBeHidden();
  expect(await page.locator('#bottom-panel').evaluate((el) => el.offsetHeight)).toBeGreaterThan(120);
});

test('icon switches keep localized accessible labels', async ({ page }) => {
  await boot(page);
  await page.locator('#btn-measure-tool').click();
  const labelled = await page.evaluate(() => [...document.querySelectorAll('.bp-view-btn, .measure-mode-btn')]
    .every((b) => !!b.getAttribute('title') && !!b.getAttribute('aria-label')));
  expect(labelled).toBe(true);
});

test('measure tool modes still switch as icons', async ({ page }) => {
  await boot(page);
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();
  await expect(page.locator('#measure-mode-toggle .measure-mode-btn svg')).toHaveCount(3);
  await expect(page.locator('[data-measure-mode="segment"]')).toHaveClass(/active/);
  await page.locator('[data-measure-mode="catchment"]').click();
  await expect(page.locator('[data-measure-mode="catchment"]')).toHaveClass(/active/);
  await expect(page.locator('[data-measure-mode="segment"]')).not.toHaveClass(/active/);
});

test('expanded settings panel covers the 2D/3D pill on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  const pill = await page.locator('#view-mode-toggle').boundingBox();
  const centre = { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 };

  // Panel closed: the pill owns its own spot.
  await page.locator('#side-panel').evaluate((el) => el.classList.remove('open'));
  expect(await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('#view-mode-toggle'), centre)).toBe(true);

  // Panel open (full-width on phones): the panel owns that spot instead.
  await page.locator('#btn-toggle-panel').click();
  await expect(page.locator('#side-panel')).toHaveClass(/open/);
  await expect.poll(async () => page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('#side-panel'), centre))
    .toBe(true);
});
