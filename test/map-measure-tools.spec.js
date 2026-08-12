import { test, expect } from '@playwright/test';

async function openMeasure(page) {
  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  // Boot is not finished when the Leaflet container appears: the loading screen
  // still covers the map and map clicks are dropped until it lifts. Waiting only
  // on the container made this spec fail on slow CI runners.
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached', timeout: 30_000 });
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

test('F2: segment click on the planned track measures without inserting a waypoint', async ({ page }) => {
  // Force a straight-line route (BRouter down → fallback) so the track sits on a
  // predictable screen line, and stub elevation so the plan completes offline.
  await page.route(/brouter\.de\/brouter/, (r) => r.fulfill({ status: 500, body: 'down' }));
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, (route) => {
    const url = new URL(route.request().url());
    const n = (url.searchParams.get('latitude') || '').split(',').length;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation: Array.from({ length: n }, () => 100) }) });
  });

  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  // Boot is not finished when the Leaflet container appears: the loading screen
  // still covers the map and map clicks are dropped until it lifts. Waiting only
  // on the container made this spec fail on slow CI runners.
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached', timeout: 30_000 });

  const box = await page.locator('#map').boundingBox();
  const p1 = { x: box.x + 400, y: box.y + 220 };
  const p2 = { x: box.x + 660, y: box.y + 380 };
  await page.mouse.click(p1.x, p1.y);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(1);
  await page.mouse.click(p2.x, p2.y);
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);

  // Wait for the route polyline to render and any route/weather work to settle.
  await page.locator('#map .leaflet-overlay-pane path').first().waitFor({ timeout: 20_000 });
  await page.locator('#route-weather-busy-overlay').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(500); // let any fit-bounds animation settle

  // The tiny test route is blanketed by weather-badge markers; make the marker
  // pane click-through so an on-line click reaches the route polyline the way a
  // real click on a bare segment of a longer route would.
  await page.addStyleTag({ content: '.leaflet-marker-icon, .leaflet-marker-icon *, .leaflet-tooltip-pane, .leaflet-shadow-pane { pointer-events: none !important; }' });

  // Open the measure tool (segment mode is the default).
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();

  // Sample two on-track screen points from the ACTUAL rendered polyline (the map
  // auto-fits after planning, so precomputed pixels no longer sit on the line).
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
  expect(a && b).toBeTruthy();
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);

  // The measurement produced a readout and NO extra waypoint was inserted.
  await expect(page.locator('#measure-readout')).not.toBeEmpty();
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(2);
});
