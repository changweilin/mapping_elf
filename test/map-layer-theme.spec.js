import { expect, test } from '@playwright/test';

const TILE_BODY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

async function mockTileRequests(page) {
  await page.route(/basemaps\.cartocdn\.com|server\.arcgisonline\.com/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TILE_BODY,
    });
  });
}

async function openAppWithMapLayer(page, { theme = 'dark', layer = 'streets' } = {}) {
  await mockTileRequests(page);
  await page.addInitScript(({ theme, layer }) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_theme', theme);
    localStorage.setItem('mappingElf_mapLayer', layer);
  }, { theme, layer });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
}

test('street and terrain tiles use theme-aware contrast filters', async ({ page }) => {
  await openAppWithMapLayer(page, { theme: 'dark', layer: 'streets' });

  const streetTile = page.locator('.leaflet-layer.map-tiles-streets .leaflet-tile').first();
  await expect(streetTile).toBeAttached();

  const streetLayer = page.locator('.leaflet-layer.map-tiles-streets');
  await expect(streetLayer).toHaveClass(/map-tiles-dark/);
  await expect(streetLayer).toHaveClass(/map-tiles-streets-dark/);

  const darkStreetFilter = await streetTile.evaluate((el) => getComputedStyle(el).filter);
  expect(darkStreetFilter).not.toBe('none');

  await page.locator('#btn-toggle-theme').click();
  await expect(page.locator('html')).toHaveClass(/light-theme/);
  await expect(streetLayer).toHaveClass(/map-tiles-light/);
  await expect(streetLayer).toHaveClass(/map-tiles-streets-light/);

  const lightStreetFilter = await streetTile.evaluate((el) => getComputedStyle(el).filter);
  expect(lightStreetFilter).not.toBe('none');
  expect(lightStreetFilter).not.toBe(darkStreetFilter);

  await page.locator('#btn-layer-topo').click();
  const terrainTile = page.locator('.leaflet-layer.map-tiles-topo.map-tiles-terrain .leaflet-tile').first();
  await expect(terrainTile).toBeAttached();
  await expect(page.locator('.leaflet-layer.map-tiles-topo.map-tiles-terrain'))
    .toHaveClass(/map-tiles-terrain-light/);

  const lightTerrainFilter = await terrainTile.evaluate((el) => getComputedStyle(el).filter);
  expect(lightTerrainFilter).not.toBe('none');
  expect(lightTerrainFilter).not.toBe(lightStreetFilter);
});

test('dark map tiles keep their contrast filter while zooming', async ({ page }) => {
  await openAppWithMapLayer(page, { theme: 'dark', layer: 'streets' });

  const streetTile = page.locator('.leaflet-layer.map-tiles-streets-dark .leaflet-tile').first();
  await expect(streetTile).toBeAttached();

  const beforeZoomFilter = await streetTile.evaluate((el) => getComputedStyle(el).filter);
  expect(beforeZoomFilter).not.toBe('none');

  await page.locator('#map').evaluate((el) => el.classList.add('is-map-zooming'));

  const zoomingStyle = await streetTile.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      filter: style.filter,
      transitionDuration: style.transitionDuration,
      transitionProperty: style.transitionProperty,
    };
  });
  expect(zoomingStyle.filter).toBe(beforeZoomFilter);
  expect(zoomingStyle.transitionDuration).toBe('0s');
});
