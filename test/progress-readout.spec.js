import { test, expect } from '@playwright/test';
import { mapTiles, osrm, flatElevation, nominatim } from './helpers/apiMocks.mjs';

// One progress readout, three device presentations, one locking contract.
//
// The readout is the shared .progress-card component (index.html) driven by
// beginRouteWeatherBusyTask. What this guards:
//   * every long-running action reports through that ONE component, so its
//     anatomy (spinner / title / detail / bar / percent) is the same everywhere;
//   * the phone gets the docked full-width strip and the desktop the floating
//     pill — and in BOTH cases the furniture sharing that band (the centred
//     檢視切換 pill, the Leaflet zoom stack) stays reachable rather than being
//     painted under a z:10020 overlay;
//   * lockScope does what it says: a 'none' task leaves independent controls
//     live, a 'route' task locks the controls that would race it.
//
// Tasks are raised through the __mappingElfTestHooks.beginBusyTask hook so the
// layout contract is tested on its own, without a real load's timing.

const DEVICES = [
  { label: 'phone-portrait', width: 390, height: 844, strip: true },
  { label: 'phone-landscape', width: 844, height: 390, strip: true },
  { label: 'tablet-portrait', width: 768, height: 1024, strip: true },
  { label: 'desktop', width: 1440, height: 900, strip: false },
];

async function boot(page, device, lang = 'zh-TW') {
  await page.setViewportSize({ width: device.width, height: device.height });
  await mapTiles(page);
  await osrm(page);
  await flatElevation(page);
  await nominatim(page);
  await page.addInitScript((language) => {
    localStorage.clear();
    localStorage.setItem('mappingElf_language', language);
    window.__mappingElfTestHooks = window.__mappingElfTestHooks || {};
  }, lang);
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('.leaflet-container').waitFor();
}

/** Raise a progress task and return a handle the test can drive and end. */
async function beginTask(page, options) {
  await page.evaluate((opts) => {
    window.__busyTask = window.__mappingElfTestHooks.beginBusyTask(opts);
  }, options);
  await expect(page.locator('#route-weather-busy-overlay')).not.toHaveClass(/hidden/);
}

async function endTask(page) {
  await page.evaluate(() => { window.__busyTask?.end(); window.__busyTask = null; });
  await expect(page.locator('#route-weather-busy-overlay')).toHaveClass(/hidden/);
}

/** null when `sel` is on top at its own centre, else what is covering it. */
async function blockedBy(page, sel) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return 'missing from the DOM';
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return 'zero-sized';
    const x = Math.min(window.innerWidth - 1, Math.max(0, (r.left + r.right) / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, (r.top + r.bottom) / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit) return 'no hit point';
    if (hit === el || el.contains(hit) || hit.contains(el)) return null;
    const id = hit.id ? `#${hit.id}` : '';
    const cls = typeof hit.className === 'string' && hit.className.trim()
      ? `.${hit.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `covered by <${hit.tagName.toLowerCase()}${id}${cls}>`;
  }, sel);
}

for (const device of DEVICES) {
  test.describe(`[${device.label}]`, () => {
    test('the readout keeps its full anatomy and the right device shape', async ({ page }) => {
      await boot(page, device);
      await beginTask(page, { title: '正在載入天氣資訊', detail: '準備天氣欄位 2/8', progress: 25, lockScope: 'none' });

      const card = page.locator('#route-weather-busy-overlay .loading-content');
      // Same anatomy on every device — that is what "unified format" means.
      await expect(card.locator('.progress-spinner')).toBeVisible();
      await expect(page.locator('#route-weather-busy-title')).toHaveText('正在載入天氣資訊');
      await expect(page.locator('#route-weather-busy-progress')).toHaveText('25%');
      await expect(card.locator('.loading-bar')).toHaveAttribute('aria-valuenow', '25');
      await expect(card.locator('.loading-bar-fill')).toHaveClass(/is-determinate/);

      const box = await card.boundingBox();
      const vw = device.width;
      if (device.strip) {
        // Docked strip: edge to edge, square, flush under the toolbar.
        expect(box.width).toBeCloseTo(vw, 0);
        const radius = await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
        expect(radius).toBe('0px');
      } else {
        // Floating pill: inset, rounded, centred.
        expect(box.width).toBeLessThan(vw - 80);
        const radius = await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
        expect(radius).not.toBe('0px');
      }
      await endTask(page);
    });

    test('the readout never buries the controls in its own band', async ({ page }) => {
      await boot(page, device);
      // The Leaflet zoom stack is what shares the top band with the readout on
      // the 2D map, and the overlay sits at z:10020 — above it — so the zoom
      // buttons have to be MOVED out of the way, not painted over. (The 2D/3D
      // pill lives inside the 3D viewer now; terrain-3d*.spec.js covers it.)
      const zoomOut = '.leaflet-control-zoom a:last-child';
      expect(await blockedBy(page, zoomOut), 'zoom-out before the readout').toBeNull();

      await beginTask(page, { title: '正在規劃路線', detail: '準備路線與高度資料...', progress: 8, lockScope: 'none' });
      expect(await blockedBy(page, zoomOut), 'zoom-out while the readout is up').toBeNull();

      await endTask(page);
      expect(await blockedBy(page, zoomOut), 'zoom-out after the readout closes').toBeNull();
    });
  });
}

test('an independent task leaves view controls live; a dependent one locks the editing controls', async ({ page }) => {
  await boot(page, DEVICES.at(-1));

  const fit = page.locator('#btn-fit-route');
  const locate = page.locator('#btn-my-location');
  const clear = page.locator('#btn-clear-route');
  const importBtn = page.locator('#btn-import-gpx');

  // 'none' — e.g. an export, a tile delete, a geocode sweep. Nothing locks.
  await beginTask(page, { title: '匯出路線檔案', detail: '產生 GPX...', progress: 40, lockScope: 'none' });
  await expect(fit).toBeEnabled();
  await expect(locate).toBeEnabled();
  await expect(clear).toBeEnabled();
  expect(await page.evaluate(() => window.__mappingElfTestHooks.isRouteWeatherBusy())).toBe(false);
  await endTask(page);

  // 'route' — a route plan or a track import. The controls that would race it
  // for the same data are locked; the pure view controls stay live, because
  // panning the map cannot corrupt what the task is writing.
  await beginTask(page, { title: '匯入路線檔案', detail: '解析軌跡資料...', progress: 35, lockScope: 'route' });
  expect(await page.evaluate(() => window.__mappingElfTestHooks.isRouteWeatherBusy())).toBe(true);
  await expect(clear).toBeDisabled();
  await expect(importBtn).toBeDisabled();
  await expect(fit).toBeEnabled();
  await expect(locate).toBeEnabled();
  await endTask(page);

  await expect(clear).toBeEnabled();
  await expect(importBtn).toBeEnabled();
});

test('concurrent independent tasks share one readout and name themselves on the badge', async ({ page }) => {
  await boot(page, DEVICES.at(-1));

  await page.evaluate(() => {
    window.__tasks = [
      window.__mappingElfTestHooks.beginBusyTask({ title: '匯出路線檔案', detail: '產生 GPX...', lockScope: 'none' }),
      window.__mappingElfTestHooks.beginBusyTask({ title: '正在取得地名', detail: '取得地名 1/6', lockScope: 'none' }),
      window.__mappingElfTestHooks.beginBusyTask({ title: '清除離線圖磚', detail: '刪除圖磚快取...', lockScope: 'none' }),
    ];
  });

  // The newest task owns the title; the badge counts and names the rest.
  await expect(page.locator('#route-weather-busy-title')).toHaveText('清除離線圖磚');
  const count = page.locator('#route-weather-busy-count');
  await expect(count).not.toHaveClass(/hidden/);
  await expect(count).toHaveText('+2');
  await expect(count).toHaveAttribute('title', /匯出路線檔案[\s\S]*正在取得地名/);
  // All three are independent, so none of them locks route editing.
  await expect(page.locator('#btn-clear-route')).toBeEnabled();

  await page.evaluate(() => { window.__tasks.forEach((t) => t.end()); });
  await expect(page.locator('#route-weather-busy-overlay')).toHaveClass(/hidden/);
});

test('progress strings localise in the shared readout', async ({ page }) => {
  await boot(page, DEVICES.at(-1), 'en');

  // Call sites pass raw zh-TW; updateRouteWeatherBusyOverlay localises on the
  // way to the DOM, counters included.
  await beginTask(page, { title: '正在載入集水區域', detail: '載入集水區域 3/12', progress: 25, lockScope: 'none' });
  await expect(page.locator('#route-weather-busy-title')).toHaveText('Loading catchment zone');
  await expect(page.locator('#route-weather-busy-detail')).toHaveText('Loading catchments 3/12');
  await endTask(page);
});
