import { test, expect } from '@playwright/test';

// Synthetic DEM served to Open-Meteo's elevation endpoint. `shape` decides the
// terrain: a cone draining to the default map centre, or a dead-flat plain.
async function stubElevation(page, shape) {
  const ANCHOR = [23.5, 121.0]; // mapManager DEFAULT_CENTER
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((la, i) => {
      if (shape === 'flat') return 100;
      const dy = (la - ANCHOR[0]) * 111320;
      const dx = (lngs[i] - ANCHOR[1]) * 111320 * Math.cos(ANCHOR[0] * Math.PI / 180);
      return 100 + 0.1 * Math.hypot(dx, dy); // 10% cone, low point at the centre
    });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}

async function openCatchment(page, shape) {
  await stubElevation(page, shape);
  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#btn-measure-tool').click();
  await expect(page.locator('#measure-panel')).toBeVisible();
  await page.locator('[data-measure-mode="catchment"]').click();
  await expect(page.locator('[data-measure-mode="catchment"]')).toHaveClass(/active/);
}

test('catchment: cone terrain draws a basin polygon and reports area', async ({ page }) => {
  await openCatchment(page, 'cone');
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // A filled polygon lands in the overlay pane and the readout reports an area.
  await expect(page.locator('#map .leaflet-overlay-pane path')).toHaveCount(1, { timeout: 15_000 });
  const readout = page.locator('#measure-readout');
  await expect(readout).toContainText(/(km²|ha|m²)/);
  // No waypoint was inserted by the measuring click.
  await expect(page.locator('#waypoint-list .waypoint-item')).toHaveCount(0);
});

test('catchment: falls back to cached 3D terrain when offline (no API call)', async ({ page }) => {
  const ANCHOR = [23.5, 121.0];
  let elevationCalls = 0;
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, (route) => { elevationCalls++; route.abort(); });

  // Seed a cached cone terrain grid over the default centre and force offline.
  await page.addInitScript(([alat, alng]) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    const G = 25, half = 0.1; // wide enough to cover wherever the map-centre click lands
    const bbox = { minLat: alat - half, maxLat: alat + half, minLng: alng - half, maxLng: alng + half };
    const grid = [];
    for (let i = 0; i < G; i++) {
      const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (G - 1);
      const row = [];
      for (let j = 0; j < G; j++) {
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (G - 1);
        const dy = (lat - alat) * 111320;
        const dx = (lng - alng) * 111320 * Math.cos(alat * Math.PI / 180);
        row.push(100 + 0.1 * Math.hypot(dx, dy));
      }
      grid.push(row);
    }
    localStorage.setItem('mappingElf_terrain3dCache', JSON.stringify({ 'route:test': { grid, bbox, savedAt: 0 } }));
  }, ANCHOR);

  await page.goto('/');
  await page.locator('.leaflet-container').waitFor();
  await page.locator('#btn-measure-tool').click();
  await page.locator('[data-measure-mode="catchment"]').click();

  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Basin drawn from cache, flagged approximate, and the API was never used.
  await expect(page.locator('#map .leaflet-overlay-pane path')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('#notifications')).toContainText(/近似|approximate|Näherung|approximatif|caché|cache|근사/, { timeout: 15_000 });
  expect(elevationCalls).toBe(0);
});

test('catchment: large flat area aborts with a notice and draws nothing', async ({ page }) => {
  await openCatchment(page, 'flat');
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Guard fires: a toast appears and no polygon is drawn.
  await expect(page.locator('#notifications')).toContainText(/平地|flat|Ebene|plane|llana|piano|평지|平/, { timeout: 15_000 });
  await expect(page.locator('#map .leaflet-overlay-pane path')).toHaveCount(0);
  await expect(page.locator('#measure-readout')).toBeEmpty();
});
