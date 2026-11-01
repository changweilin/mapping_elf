import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { osrm, flatElevation, mapTiles, nominatim } from './helpers/apiMocks.mjs';

// Cross-device interaction audit: for every device class, every feature has to
// stay REACHABLE while the others are open. The failure mode this guards is not
// "it looks wrong" but "the user is stuck": a panel whose close button is off
// screen or painted under something else, a 功能選單 that cannot be re-tapped to
// dismiss the active tool, a 分割線 that cannot be grabbed back.
//
// Every check is a hit test (`document.elementFromPoint`), not a bounding-box
// comparison — overlap is fine and often intended here (z-index decides), what
// is never fine is a control that cannot receive the tap.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const shortGpx = path.join(repoRoot, 'data', 'app-test-routes', 'short-zh-weather.gpx');

const DEVICES = [
  { label: 'phone-portrait', width: 390, height: 844 },
  { label: 'phone-landscape', width: 844, height: 390 },
  { label: 'tablet-portrait', width: 768, height: 1024 },
  { label: 'tablet-landscape', width: 1024, height: 768 },
  { label: 'desktop', width: 1440, height: 900 },
];

// The 環狀功能選單's tools. 3D is excluded on purpose: it replaces the whole screen
// with a WebGL overlay and has its own suite (terrain-3d*.spec.js).
const FEATURES = [
  { key: '量測工具', btn: '#btn-measure-tool', panel: '#measure-panel', close: '#btn-measure-close' },
  { key: '繪圖板', btn: '#btn-shape-tool', panel: '#shape-panel', close: '#btn-shape-close' },
  { key: '魔法陣', btn: '#btn-star-tool', panel: '#star-panel', close: '#btn-star-close' },
  { key: '天氣資訊', btn: '#btn-weather-tool', panel: '#weather-panel', close: '#btn-weather-close' },
  { key: '集水區', btn: '#btn-catchment-tool', panel: '#catchment-panel', close: '#btn-catchment-close' },
];

function forecastStub(page) {
  const hours = Array.from({ length: 24 }, (_, h) => `2026-05-20T${String(h).padStart(2, '0')}:00`);
  const hourly = (v) => Array.from({ length: 24 }, () => v);
  return page.route(/v1\/(forecast|archive)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      elevation: 100,
      daily: {
        time: ['2026-05-20'], temperature_2m_max: [24], temperature_2m_min: [18],
        precipitation_sum: [0], weathercode: [1], windspeed_10m_max: [12], windgusts_10m_max: [18],
        sunrise: ['2026-05-20T05:10'], sunset: ['2026-05-20T18:30'], sunshine_duration: [18000],
        precipitation_probability_max: [10], uv_index_max: [7], shortwave_radiation_sum: [19],
      },
      hourly: {
        time: hours, temperature_2m: hourly(21), apparent_temperature: hourly(20),
        relative_humidity_2m: hourly(65), dewpoint_2m: hourly(14), precipitation: hourly(0),
        precipitation_probability: hourly(10), weathercode: hourly(1), windspeed_10m: hourly(10),
        windgusts_10m: hourly(16), uv_index: hourly(4), visibility: hourly(10000), cloudcover: hourly(25),
      },
    }),
  }));
}

async function boot(page, device) {
  await page.setViewportSize({ width: device.width, height: device.height });
  await mapTiles(page);
  await osrm(page);
  await flatElevation(page);
  await nominatim(page);
  await forecastStub(page);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.locator('#loading-screen.hidden').waitFor({ state: 'attached' });
  await page.locator('.leaflet-container').waitFor();
  // The panel height lands in a rAF after boot; settle before measuring.
  await expect.poll(() => page.locator('#bottom-panel').evaluate((el) => el.offsetHeight)).toBeGreaterThan(40);
}

async function loadRoute(page) {
  await page.locator('#gpx-file-input').setInputFiles(shortGpx);
  await expect(page.locator('#waypoint-list .waypoint-item').first()).toBeVisible();
}

// Is `sel` on top at its own centre? Returns null when reachable, otherwise a
// short description of what is covering it (or why it has no hit point at all).
async function blockedBy(page, sel) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return 'missing from the DOM';
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return 'zero-sized';
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return 'not visible';
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) {
      return `off screen (rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${vw}x${vh})`;
    }
    // Sample the visible part of the element, centre first: a control clipped by
    // the viewport edge is still usable through whatever is left of it.
    const x1 = Math.max(0, r.left), x2 = Math.min(vw - 1, r.right);
    const y1 = Math.max(0, r.top), y2 = Math.min(vh - 1, r.bottom);
    const xs = [(x1 + x2) / 2, x1 + 2, x2 - 2];
    const ys = [(y1 + y2) / 2, y1 + 2, y2 - 2];
    let top = null;
    for (const y of ys) {
      for (const x of xs) {
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit === el || el.contains(hit) || hit.contains(el)) return null;
        if (!top) {
          const id = hit.id ? `#${hit.id}` : '';
          const cls = (hit.className && typeof hit.className === 'string')
            ? `.${hit.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
          top = `covered by <${hit.tagName.toLowerCase()}${id}${cls}>`;
        }
      }
    }
    return top || 'no hit point inside the viewport';
  }, sel);
}

async function fullyOnScreen(page, sel) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return 'missing from the DOM';
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const out = [];
    if (r.top < -1) out.push(`top ${Math.round(r.top)}`);
    if (r.left < -1) out.push(`left ${Math.round(r.left)}`);
    if (r.right > vw + 1) out.push(`right ${Math.round(r.right)} > ${vw}`);
    if (r.bottom > vh + 1) out.push(`bottom ${Math.round(r.bottom)} > ${vh}`);
    return out.length ? `spills outside the viewport (${out.join(', ')})` : null;
  }, sel);
}

const isOpen = (page, sel) => page.locator(sel).evaluate((el) => !el.classList.contains('hidden'));

async function openFeature(page, feature) {
  // 功能選單 is a toggle with three states: closed, menu open, tool active. With a
  // tool active the first tap only dismisses the tool, so tap until the ring
  // actually opens — the way a user would.
  const overlay = page.locator('#radial-menu-overlay');
  for (let i = 0; i < 3; i++) {
    if (await overlay.evaluate((el) => el.classList.contains('open'))) break;
    await page.locator('#btn-features-menu').click();
  }
  await expect(overlay).toHaveClass(/open/);
  await page.locator(feature.btn).click();
  await expect(page.locator(feature.panel)).toBeVisible();
}

// Settled = the class matches AND the slide has finished. Both matter: the class
// flips instantly while the panel keeps sliding for ~0.3s, and measuring during
// the slide hits a panel that is half on screen — which looks exactly like a
// stacking bug and is not one.
const sidePanelSettled = (page, open) => page.locator('#side-panel').evaluate((el, want) => {
  if (el.classList.contains('open') !== want) return false;
  const r = el.getBoundingClientRect();
  return want ? r.right <= window.innerWidth + 1 : r.left >= window.innerWidth - 1;
}, open);

async function setSidePanel(page, open) {
  // Retried: a GPX import calls openRouteLibrary(), which re-opens the panel a
  // beat after the first waypoint shows up, undoing a close that lands in that
  // window.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await sidePanelSettled(page, open)) return;
    const cls = await page.locator('#side-panel').evaluate((el) => el.classList.contains('open'));
    if (cls !== open) await page.locator('#btn-toggle-panel').click();
    await page.waitForTimeout(400);
  }
  expect(await sidePanelSettled(page, open), `設置面板 would not stay ${open ? 'open' : 'closed'}`).toBe(true);
}

async function dblClickDivider(page) {
  const handle = await page.locator('#bp-resize-handle').boundingBox();
  const { width: vw } = page.viewportSize();
  await page.mouse.dblclick(Math.min(handle.x + handle.width - 20, vw - 20), handle.y + handle.height / 2);
}

// Grab the divider near the right edge: the left side is where the floating
// panels live, and they would swallow the drag.
async function dragDividerTo(page, clientY) {
  const handle = await page.locator('#bp-resize-handle').boundingBox();
  const { width: vw } = page.viewportSize();
  const x = Math.min(handle.x + handle.width - 20, vw - 20);
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, clientY, { steps: 10 });
  await page.mouse.up();
}

for (const device of DEVICES) {
  const phone = device.width <= 768;

  test(`[${device.label}] every 功能選單 tool opens, stays on screen and closes`, async ({ page }) => {
    const findings = [];
    await boot(page, device);
    await loadRoute(page);
    // Phones overlay the map with the side panel; a tool opened behind it would
    // be a different test. Desktop keeps it open — that is the real default.
    if (phone) await setSidePanel(page, false);

    for (const feature of FEATURES) {
      await openFeature(page, feature);

      const spill = await fullyOnScreen(page, feature.panel);
      if (spill) findings.push(`${feature.key}: panel ${spill}`);
      for (const [name, sel] of [['close X', feature.close], ['功能選單', '#btn-features-menu'], ['分割線', '#bp-resize-handle']]) {
        const blocked = await blockedBy(page, sel);
        if (blocked) findings.push(`${feature.key}: ${name} (${sel}) ${blocked}`);
      }

      // The close button has to actually close it, from a real click.
      await page.locator(feature.close).click();
      if (await isOpen(page, feature.panel)) findings.push(`${feature.key}: close X did not dismiss the panel`);
    }

    expect(findings, `\n${findings.join('\n')}\n`).toEqual([]);
  });

  test(`[${device.label}] tools stay reachable with the 設置面板 and a tall 下方面板`, async ({ page }) => {
    const findings = [];
    await boot(page, device);
    await loadRoute(page);

    // 全展開 first, with the 設置面板 out of the way: at ≤768px that panel is a
    // full-screen sheet, so with it open the 分割線 is (correctly) untouchable and
    // the dbl-click would land on the sheet instead.
    await setSidePanel(page, false);
    await dblClickDivider(page);
    await expect.poll(() => page.locator('#bottom-panel').evaluate((el) => el.offsetHeight))
      .toBeGreaterThan(device.height / 2);

    // Now bring the 設置面板 back over it. The toolbar toggle has to survive: it is
    // the only way to put that panel away again.
    await setSidePanel(page, true);
    const blockedToggle = await blockedBy(page, '#btn-toggle-panel');
    if (blockedToggle) findings.push(`expanded panel + 設置面板: 設置面板 toggle ${blockedToggle}`);
    // On a right rail the two tile, so the 分割線 stays grabbable; the phone sheet
    // covers it on purpose.
    if (!phone) {
      const blockedHandle = await blockedBy(page, '#bp-resize-handle');
      if (blockedHandle) findings.push(`expanded panel + 設置面板: 分割線 ${blockedHandle}`);
    }

    // On phones the side panel is a full-screen sheet and deliberately covers the
    // floating buttons, so check the map-side controls with it closed.
    await setSidePanel(page, false);
    for (const [name, sel] of [['功能選單', '#btn-features-menu'], ['回到軌跡', '#btn-fit-route'], ['分割線', '#bp-resize-handle']]) {
      const blocked = await blockedBy(page, sel);
      if (blocked) findings.push(`expanded panel: ${name} (${sel}) ${blocked}`);
    }

    // And every tool opened against a fully expanded panel stays usable.
    for (const feature of FEATURES) {
      await openFeature(page, feature);
      const spill = await fullyOnScreen(page, feature.panel);
      if (spill) findings.push(`expanded panel + ${feature.key}: panel ${spill}`);
      const blocked = await blockedBy(page, feature.close);
      if (blocked) findings.push(`expanded panel + ${feature.key}: close X ${blocked}`);
      await page.locator(feature.close).click();
    }

    expect(findings, `\n${findings.join('\n')}\n`).toEqual([]);
  });

  test(`[${device.label}] a toast is click-through and clears the 下方面板`, async ({ page }) => {
    await boot(page, device);
    await loadRoute(page);
    await setSidePanel(page, false);

    // showNotification() builds an informational toast with no handler in it, so
    // it must not take the tap that was meant for whatever it covers.
    await page.evaluate(() => {
      // The import raised its own toasts; clear them so this is the only one.
      document.querySelectorAll('.notification').forEach((n) => n.remove());
      const el = document.createElement('div');
      el.className = 'notification info';
      el.id = 'audit-toast';
      el.innerHTML = '<span>i</span><span>路線規劃完成</span>';
      document.getElementById('notifications').appendChild(el);
    });
    await expect(page.locator('#audit-toast')).toBeVisible();

    const swallowed = await page.evaluate(() => {
      const r = document.getElementById('audit-toast').getBoundingClientRect();
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.top + 4], [r.right - 4, r.bottom - 4]];
      return pts.some(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.notification'));
    });
    expect(swallowed, 'a toast takes taps meant for the UI under it').toBe(false);

    // …and at the resting panel height it stays off the panel entirely, so it
    // does not hide the 高度圖 / weather rows for 3.5s either.
    const { toastBottom, panelTop } = await page.evaluate(() => ({
      toastBottom: document.getElementById('audit-toast').getBoundingClientRect().bottom,
      panelTop: document.getElementById('bottom-panel').getBoundingClientRect().top,
    }));
    expect(Math.round(toastBottom), 'toast clears the 下方面板').toBeLessThanOrEqual(Math.round(panelTop) + 1);
  });

  test(`[${device.label}] the 檢視切換 pill owns its top edge, not the 分割線`, async ({ page }) => {
    await boot(page, device);
    await loadRoute(page);
    await setSidePanel(page, false);
    await expect(page.locator('#bottom-panel')).toHaveClass(/bp-mode-elev/);

    // The 分割線's invisible ::before grab area reaches 12px into the panel and
    // used to win over the pill, turning a view switch into a resize drag.
    const btn = page.locator('#bp-view-toggle [data-bp-view="weather"]');
    const box = await btn.boundingBox();
    const pt = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 2) };
    expect(
      await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('#bp-view-toggle'), pt),
      'the pill, not the 分割線, is on top at the pill’s top edge',
    ).toBe(true);

    const before = await page.locator('#bottom-panel').evaluate((el) => el.offsetHeight);
    await page.mouse.click(pt.x, pt.y);
    await expect(page.locator('#bottom-panel')).toHaveClass(/bp-mode-weather/);
    expect(await page.locator('#bottom-panel').evaluate((el) => el.offsetHeight), 'the tap did not resize the panel').toBe(before);
  });

  test(`[${device.label}] a collapsed 下方面板 gives the screen back`, async ({ page }) => {
    const findings = [];
    await boot(page, device);
    await loadRoute(page);
    await setSidePanel(page, false);

    const bar = await page.locator('#bp-resize-handle').evaluate((el) => el.offsetHeight);
    await dragDividerTo(page, device.height);
    await expect.poll(() => page.locator('#bottom-panel').evaluate((el) => el.offsetHeight)).toBeLessThanOrEqual(bar + 2);

    // The grab bar is the only way back, so it must stay hit-testable…
    const blocked = await blockedBy(page, '#bp-resize-handle');
    if (blocked) findings.push(`collapsed: 分割線 ${blocked}`);
    // …and the map must own the vacated band: a collapsed panel whose children
    // still swallow taps is the worst kind of stuck.
    const leak = await page.evaluate((barH) => {
      const y = window.innerHeight - barH - 20;
      const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(y));
      const owner = hit?.closest('#bottom-panel');
      return owner ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}` : null;
    }, bar);
    if (leak) findings.push(`collapsed: panel content still catches taps 20px above the bar (<${leak}>)`);

    expect(findings, `\n${findings.join('\n')}\n`).toEqual([]);
  });
}
