/**
 * Mapping Elf — Main Entry
 */
import 'leaflet/dist/leaflet.css';
import './styles/main.css';

import { MapManager } from './modules/mapManager.js';
import { RouteEngine } from './modules/routeEngine.js';
import { WeatherService } from './modules/weatherService.js';
import { OfflineManager } from './modules/offlineManager.js';
import { formatDistance, formatElevation, formatCoords, copyToClipboard, showNotification as rawShowNotification, debounce, haversineDistance, cumulativeDistances, interpolateRouteColor, interpolateReturnColor, interpolateRouteColorRgb, interpolateReturnColorRgb, tspOptimize, projectMileage } from './modules/utils.js';
import { ACTIVITY_PROFILES, DEFAULT_PACE_PARAMS, computeCumulativeTimes, computeTripStats, computeFatigueSeries, formatDuration, formatDurationHHMM, defaultSpeed, computeCalibrationFromTracks, summarizeImportedTrackForCalibration } from './modules/paceEngine.js';
import { applyTranslations, getLanguage, initI18n, LANGUAGES, setLanguage, translatePhrase, translateWeatherText, tWmo } from './modules/i18n.js';
import { RESET_STATE_KEYS } from './modules/stateKeys.js';
import { estimateMapPackTiles } from './modules/tileEstimator.js';
import { buildWeatherPointsFromState } from './modules/weatherPointBuilder.js';
import { platform } from './platform/index.js';
import { TerrainViewer } from './modules/terrainViewer.js';
import { computeCatchment } from './modules/catchmentEngine.js';
import { fetchHydroData, computeHydroIndicators, computeGeometryRows } from './modules/catchmentHydro.js';

function showNotification(message, type = 'info', duration = 3500) {
  rawShowNotification(translatePhrase(message), type, duration);
}

function installNativeExternalLinkHandler() {
  if (!platform.isNative || typeof document === 'undefined') return;

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const anchor = target?.closest?.('a[href]');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    let url;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    event.preventDefault();
    platform.openExternalUrl(url.href);
  }, true);
}

installNativeExternalLinkHandler();

function getLocationPermissionHelpMessage() {
  const capacitor = window.Capacitor;
  const platform = capacitor?.getPlatform?.() || 'web';
  const isNativeApp = !!capacitor?.isNativePlatform?.();

  if (isNativeApp && platform === 'android') {
    return [
      '無法取得 GPS 位置，請開啟定位權限：',
      '',
      '1. 長按 Mapping Elf 圖示，點選「應用程式資訊」。',
      '2. 進入「權限」或「應用程式權限」。',
      '3. 點選「位置」，選擇「允許」。',
      '4. 回到 Mapping Elf 後再按一次定位按鈕。',
      '',
      '若仍無法定位，請確認手機的系統「定位」總開關已開啟。',
    ].join('\n');
  }

  if (isNativeApp && platform === 'ios') {
    return [
      '無法取得 GPS 位置，請開啟定位權限：',
      '',
      '1. 開啟 iPhone/iPad「設定」。',
      '2. 往下找到「Mapping Elf」。',
      '3. 點選「位置」。',
      '4. 選擇「使用 App 期間」。',
      '5. 回到 Mapping Elf 後再按一次定位按鈕。',
      '',
      '若仍無法定位，請確認「設定 > 隱私權與安全性 > 定位服務」已開啟。',
    ].join('\n');
  }

  if (/Android/i.test(platform.getUserAgent())) {
    return [
      '無法取得 GPS 位置，請開啟瀏覽器定位權限：',
      '',
      '1. 點選網址列旁的鎖頭或網站設定圖示。',
      '2. 進入「權限」或「網站設定」。',
      '3. 將「位置」改成「允許」。',
      '4. 重新整理頁面後再按一次定位按鈕。',
      '',
      '若仍無法定位，請確認手機的系統「定位」總開關已開啟。',
    ].join('\n');
  }

  if (/iPhone|iPad|iPod/i.test(platform.getUserAgent())) {
    return [
      '無法取得 GPS 位置，請開啟瀏覽器定位權限：',
      '',
      '1. 開啟 iPhone/iPad「設定」。',
      '2. 找到目前使用的瀏覽器，例如 Safari 或 Chrome。',
      '3. 確認「位置」允許使用。',
      '4. 回到瀏覽器，重新整理頁面後再按一次定位按鈕。',
      '',
      '若仍無法定位，請確認「設定 > 隱私權與安全性 > 定位服務」已開啟。',
    ].join('\n');
  }

  return [
    '無法取得 GPS 位置，請開啟瀏覽器定位權限：',
    '',
    '1. 點選網址列旁的網站設定或鎖頭圖示。',
    '2. 將「位置」改成「允許」。',
    '3. 重新整理頁面後再按一次定位按鈕。',
  ].join('\n');
}

function showLocationPermissionHelp() {
  window.alert(getLocationPermissionHelpMessage());
}

const IMPORTED_TRACK_EDIT_NOTICE = '匯入的軌跡無法編輯，需要規劃路線請點擊「重新規劃」。';
let importedTrackEditNoticeAt = 0;
const NATIVE_IMPORT_URL_SCHEMES = new Set(['content:', 'file:']);
const handledNativeImportUrls = new Set();
let nativeFileOpenHandlersInstalled = false;

function showImportedTrackEditNotice(duration = 3200) {
  const now = Date.now();
  if (now - importedTrackEditNoticeAt < 1200) return;
  importedTrackEditNoticeAt = now;
  showNotification(IMPORTED_TRACK_EDIT_NOTICE, 'warning', duration);
}

// Undo/redo are intentionally absent: their enabled/blocked state is owned solely
// by _updateHistoryButtons so a data load ('edit' scope) can keep them live while a
// full route lock keeps them disabled. #waypoint-list button is scoped with
// :not(.wp-remove-live) so the delete-last button stays clickable during a load.
const ROUTE_WEATHER_BUSY_BLOCK_SELECTOR = [
  '#btn-clear-route',
  '#btn-replan-route',
  '#btn-reverse-replan-route',
  '.search-result-add',
].join(',');

const ROUTE_WEATHER_BUSY_DISABLE_SELECTOR = [
  '#btn-clear-route',
  '#btn-replan-route',
  '#btn-reverse-replan-route',
  '#btn-fit-route',
  '#btn-my-location',
  '#btn-import-gpx',
  '#waypoint-list button:not(.wp-remove-live)',
  '#weather-table-container button',
  '#weather-table-container input',
  '#weather-table-container select',
  '.search-result-add',
].join(',');

const WEATHER_CARD_BUSY_DISABLE_SELECTOR = [
  '.weather-card button',
  '.weather-card input',
  '.weather-card select',
].join(',');

// During a data load ('edit' scope) cards stay fully interactive (open/close/
// resize/navigate) EXCEPT their date/time editors — changing the time is an edit,
// only allowed once the load is stopped.
const WEATHER_CARD_EDIT_DISABLE_SELECTOR = [
  '.weather-card .wc-date-input',
  '.weather-card .wc-time-select',
  '.weather-card .wc-time-adj-btn',
  '.weather-card .wc-now-btn',
].join(',');

let routeWeatherBusyTasks = new Map();
// Active, pausable data loads (weather + catchment). The progress bar's 停止/繼續
// toggle acts on all of them; each run exposes { paused, _resume, busyTask }.
const pausableLoadRuns = new Set();
let deferredBusySettings = new Map();
let busyInteractionNoticeAt = 0;
let deferredSettingsNoticeAt = 0;
let weatherCardBusyNoticeAt = 0;
let weatherNotLoadedNoticeAt = 0;
let busyTaskSeq = 0;

function hasRouteWeatherBusyTasks() {
  return routeWeatherBusyTasks.size > 0;
}

// lockScope: 'route' locks route editing + weather cards; 'edit' locks route
// editing + card date/time (but leaves cards open/close/resize free) — used by the
// weather/catchment data loads; 'weather-card' locks only weather cards; 'none' is
// display-only (progress readout, no locking — e.g. a paused load).
function isRouteWeatherBusy() {
  return Array.from(routeWeatherBusyTasks.values()).some(task => task.lockScope !== 'weather-card' && task.lockScope !== 'none');
}

function isWeatherCardInteractionLocked() {
  // 'edit' scope deliberately does NOT lock card open/close/resize.
  return Array.from(routeWeatherBusyTasks.values()).some(task => task.lockScope !== 'none' && task.lockScope !== 'edit');
}

// True while the ONLY thing holding the lock is a running data load (weather/
// catchment, lockScope 'edit') — the route geometry is settled, so a limited set of
// edits is allowed mid-load: append a waypoint (map-click), delete the LAST one,
// undo, redo. Each cancels the load and re-plans, which is the intended flow. A
// 'route'-scope task (route (re)planning) or an imported track keeps EVERYTHING
// locked (returns false). Paused loads flip to 'none' and unlock fully on their own.
function isDataLoadEditMode() {
  if (importedTrackMode) return false;
  const tasks = Array.from(routeWeatherBusyTasks.values());
  if (tasks.some(task => task.lockScope !== 'edit' && task.lockScope !== 'none' && task.lockScope !== 'weather-card')) return false;
  return tasks.some(task => task.lockScope === 'edit');
}

function showRouteWeatherBusyNotice(duration = 2200) {
  const now = Date.now();
  if (now - busyInteractionNoticeAt < 900) return;
  busyInteractionNoticeAt = now;
  showNotification('路線或天氣資料處理中，暫時鎖定編輯操作', 'warning', duration);
}

function showDeferredSettingNotice() {
  const now = Date.now();
  if (now - deferredSettingsNoticeAt < 1400) return;
  deferredSettingsNoticeAt = now;
  showNotification('目前正在處理路線/天氣，參數會在完成後套用', 'info', 2200);
}

function showWeatherCardBusyNotice(duration = 2200) {
  const now = Date.now();
  if (now - weatherCardBusyNoticeAt < 900) return;
  weatherCardBusyNoticeAt = now;
  showNotification('天氣資訊載入中，天氣卡暫時不可操作。', 'warning', duration);
}

function showWeatherNotLoadedNotice(duration = 2400) {
  const now = Date.now();
  if (now - weatherNotLoadedNoticeAt < 900) return;
  weatherNotLoadedNoticeAt = now;
  showNotification('尚未載入天氣資訊，取得完成後才能展開天氣卡。', 'warning', duration);
}

function syncBusyDisabledControls(selector, disabled, className) {
  document.querySelectorAll(selector).forEach((el) => {
    if (disabled) {
      if (!el.dataset.busyWasDisabled) el.dataset.busyWasDisabled = el.disabled ? '1' : '0';
      el.disabled = true;
      el.classList.add(className);
    } else if (el.dataset.busyWasDisabled !== undefined) {
      el.disabled = el.dataset.busyWasDisabled === '1';
      delete el.dataset.busyWasDisabled;
      el.classList.remove(className);
    }
  });
}

function updateRouteWeatherBusyOverlay() {
  const busy = hasRouteWeatherBusyTasks();
  const routeLocked = isRouteWeatherBusy();
  const weatherCardLocked = isWeatherCardInteractionLocked();
  const dataLoadEdit = isDataLoadEditMode();
  const wasRouteLocked = document.body.classList.contains('route-weather-busy');
  const wasDataLoadEdit = document.body.classList.contains('data-load-edit');
  document.body.classList.toggle('route-weather-busy', routeLocked);
  document.body.classList.toggle('weather-card-busy', weatherCardLocked);
  document.body.classList.toggle('route-weather-progress-busy', busy);
  document.body.classList.toggle('data-load-edit', dataLoadEdit);

  const overlay = document.getElementById('route-weather-busy-overlay');
  const titleEl = document.getElementById('route-weather-busy-title');
  const detailEl = document.getElementById('route-weather-busy-detail');
  const progressEl = document.getElementById('route-weather-busy-progress');
  const fillEl = document.getElementById('route-weather-busy-fill');
  const countEl = document.getElementById('route-weather-busy-count');
  // Scope to the card: the hidden brand-reserve block also contains a .loading-bar.
  const barEl = overlay?.querySelector('.loading-content .loading-bar');
  const brandEl = document.getElementById('route-weather-busy-brand');
  const brandTextEl = brandEl?.querySelector('.route-busy-brand-text');
  if (brandTextEl && !brandTextEl.dataset.defaultText) {
    brandTextEl.dataset.defaultText = brandTextEl.textContent || '';
  }

  if (overlay) overlay.classList.toggle('hidden', !busy);
  if (busy) {
    const task = Array.from(routeWeatherBusyTasks.values()).at(-1);
    const showCenterBrand = !!task?.centerBrand;
    const progress = Number.isFinite(task?.progress) ? Math.max(0, Math.min(100, task.progress)) : null;
    if (overlay) overlay.classList.toggle('has-center-brand', showCenterBrand);
    if (brandEl) {
      brandEl.classList.toggle('hidden', !showCenterBrand);
      brandEl.setAttribute('aria-hidden', showCenterBrand ? 'false' : 'true');
    }
    if (brandTextEl) {
      brandTextEl.textContent = showCenterBrand
        ? (task?.title || brandTextEl.dataset.defaultText || brandTextEl.textContent)
        : (brandTextEl.dataset.defaultText || brandTextEl.textContent);
    }
    if (titleEl) titleEl.textContent = task?.title || '處理中';
    if (detailEl) detailEl.textContent = task?.detail || '請稍候...';
    if (countEl) {
      // The pill shows the newest task; surface how many more run behind it.
      const extra = routeWeatherBusyTasks.size - 1;
      countEl.classList.toggle('hidden', extra < 1);
      if (extra >= 1) countEl.textContent = `+${extra}`;
    }
    if (progressEl) progressEl.textContent = progress == null ? '處理中' : `${Math.round(progress)}%`;
    if (fillEl) {
      fillEl.classList.toggle('is-determinate', progress != null);
      fillEl.style.setProperty('--busy-progress', `${progress ?? 0}%`);
    }
    if (barEl) {
      barEl.setAttribute('aria-busy', 'true');
      barEl.setAttribute('aria-valuenow', String(Math.round(progress ?? 0)));
    }
  } else if (fillEl) {
    if (overlay) overlay.classList.remove('has-center-brand');
    if (brandEl) {
      brandEl.classList.add('hidden');
      brandEl.setAttribute('aria-hidden', 'true');
    }
    fillEl.classList.remove('is-determinate');
    fillEl.style.removeProperty('--busy-progress');
  }

  // 停止/繼續 toggle — only while a pausable data load (weather/catchment) runs.
  // Label + spinner flip with the paused state.
  const toggleBtn = document.getElementById('route-weather-busy-toggle');
  const pausedBadge = document.getElementById('route-weather-busy-paused');
  const pausable = busy && hasPausableLoad();
  const paused = pausable && anyLoadPaused();
  if (overlay) overlay.classList.toggle('is-paused', paused);
  if (toggleBtn) {
    toggleBtn.classList.toggle('hidden', !pausable);
    if (pausable) {
      toggleBtn.textContent = translatePhrase(paused ? '繼續' : '停止');
      toggleBtn.setAttribute('aria-pressed', String(paused));
    }
  }
  if (pausedBadge) pausedBadge.classList.toggle('hidden', !paused);

  syncBusyDisabledControls(ROUTE_WEATHER_BUSY_DISABLE_SELECTOR, routeLocked, 'route-edit-control');
  syncBusyDisabledControls(WEATHER_CARD_BUSY_DISABLE_SELECTOR, weatherCardLocked, 'weather-edit-control');
  // Card date/time editors: locked while a load holds the 'edit' lock (routeLocked),
  // even though the card itself stays open/close/resize-able.
  syncBusyDisabledControls(WEATHER_CARD_EDIT_DISABLE_SELECTOR, routeLocked, 'wc-time-edit-control');
  // Re-evaluate the 3D button: it must stay locked while any route/weather task
  // runs and re-enable as soon as they all finish.
  if (typeof update3dButtonBadge === 'function') update3dButtonBadge();

  if (typeof mapManager !== 'undefined' && mapManager) {
    mapManager.setFrozen(!!importedTrackMode || routeLocked);
    // Map-click append stays live while a data load holds the (relaxed) lock.
    mapManager.allowAppendWhileFrozen = dataLoadEdit;
  }
  // Undo/redo live/disabled state is owned here (they were removed from the blunt
  // disable selector): recompute on every busy transition, not just when going idle.
  if (typeof _updateHistoryButtons === 'function') _updateHistoryButtons();
  // Entering/leaving data-load-edit re-renders the waypoint list so the delete-last
  // affordance appears (or disappears) without waiting for the next waypoint change.
  if (wasDataLoadEdit !== dataLoadEdit && typeof updateWaypointList === 'function' && typeof mapManager !== 'undefined' && mapManager) {
    updateWaypointList(mapManager.waypoints);
  }
  if (!busy && typeof syncTrackModeUI === 'function') {
    syncTrackModeUI();
    if (wasRouteLocked && !routeLocked && typeof updateWaypointList === 'function' && typeof mapManager !== 'undefined' && mapManager) {
      updateWaypointList(mapManager.waypoints);
    }
  }
}

function beginRouteWeatherBusyTask({ title = '處理中', detail = '請稍候...', progress = null, lockScope = 'route', centerBrand = false } = {}) {
  const id = `busy_${++busyTaskSeq}`;
  routeWeatherBusyTasks.set(id, { title, detail, progress, lockScope, centerBrand });
  updateRouteWeatherBusyOverlay();
  let ended = false;
  return {
    set(update = {}) {
      if (ended || !routeWeatherBusyTasks.has(id)) return;
      routeWeatherBusyTasks.set(id, { ...routeWeatherBusyTasks.get(id), ...update });
      updateRouteWeatherBusyOverlay();
    },
    end() {
      if (ended) return;
      ended = true;
      routeWeatherBusyTasks.delete(id);
      updateRouteWeatherBusyOverlay();
      if (!isRouteWeatherBusy()) flushDeferredBusySettings();
    },
  };
}

function runOrDeferBusySetting(key, applyFn) {
  if (!isRouteWeatherBusy()) {
    applyFn();
    return;
  }
  deferredBusySettings.set(key, applyFn);
  showDeferredSettingNotice();
}

function flushDeferredBusySettings() {
  if (deferredBusySettings.size === 0) return;
  const pending = Array.from(deferredBusySettings.values());
  deferredBusySettings.clear();
  showNotification('正在套用等待中的參數設定...', 'info', 1400);
  pending.forEach((applyFn) => applyFn());
}

// --- Load pause/resume (progress-bar 停止/繼續 toggle) -------------------------
// A pausable load (weather/catchment) registers its run; its loop parks on
// waitIfLoadPaused() while paused. Pausing flips the load's busy task to
// display-only ('none') so date/time, track-load and waypoint edits unlock;
// resuming restores its 'edit' lock and wakes the parked loop.
function anyLoadPaused() {
  return Array.from(pausableLoadRuns).some((r) => r.paused);
}
function hasPausableLoad() {
  return pausableLoadRuns.size > 0;
}
function waitIfLoadPaused(run) {
  if (!run || !run.paused) return Promise.resolve();
  return new Promise((resolve) => { run._resume = resolve; });
}
function pauseAllLoads() {
  let changed = false;
  pausableLoadRuns.forEach((run) => {
    if (!run.paused && !run.cancelled) {
      run.paused = true;
      run.busyTask?.set({ lockScope: 'none' });   // unlock editing while stopped
      changed = true;
    }
  });
  if (changed) updateRouteWeatherBusyOverlay();
}
function resumeAllLoads() {
  pausableLoadRuns.forEach((run) => {
    if (run.paused) {
      run.paused = false;
      run.busyTask?.set({ lockScope: run.lockScope || 'edit' });   // re-lock editing
      const cb = run._resume; run._resume = null; cb?.();
    }
  });
  updateRouteWeatherBusyOverlay();
}
function toggleLoadPause() {
  if (anyLoadPaused()) resumeAllLoads(); else pauseAllLoads();
}
// Wake a parked loop so a cancel (route replan) can unwind it cleanly.
function unparkLoadRun(run) {
  if (run && run._resume) { const cb = run._resume; run._resume = null; cb?.(); }
}

function installRouteWeatherBusyGuard() {
  const toggleBtn = document.getElementById('route-weather-busy-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleLoadPause();
    });
  }
  const blockPointerEvent = (e) => {
    const target = e.target;
    const isWeatherBadgeClick = e.type === 'click' && target?.closest?.('.wp-weather-badge');
    if (isWeatherCardInteractionLocked() && (target?.closest?.('.weather-card') || isWeatherBadgeClick)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showWeatherCardBusyNotice();
      return;
    }
    if (isRouteWeatherBusy() && target?.closest?.(ROUTE_WEATHER_BUSY_BLOCK_SELECTOR)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showRouteWeatherBusyNotice();
    }
  };
  ['click', 'dblclick', 'mousedown', 'touchstart', 'contextmenu', 'dragstart'].forEach((type) => {
    document.addEventListener(type, blockPointerEvent, true);
  });
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (isWeatherCardInteractionLocked() && target?.closest?.('.weather-card')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showWeatherCardBusyNotice();
      return;
    }
    if (!isRouteWeatherBusy()) return;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
    const isUndoRedoKey = (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase());
    // Undo/redo stay live while a data load holds the relaxed lock.
    if (isUndoRedoKey && isDataLoadEditMode()) return;
    const editKey = e.key === 'Delete' || e.key === 'Backspace' || isUndoRedoKey;
    if (!editKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showRouteWeatherBusyNotice();
  }, true);
}

installRouteWeatherBusyGuard();

// Hover explanation for info-card / catchment-table items. A single translucent
// bubble follows whichever `[data-tip]` element the pointer is over; the tip text
// is the Chinese label's description (WC_INFO_TIPS), translated at show-time. Pure
// progressive enhancement — no-op on touch/no-hover devices.
let _wcTipBubble = null;
function getInfoTipBubble() {
  if (_wcTipBubble) return _wcTipBubble;
  const el = document.createElement('div');
  el.className = 'wc-tip-bubble';
  el.setAttribute('role', 'tooltip');
  el.setAttribute('data-i18n-skip', '');   // text is pre-translated; keep the observer off it
  document.body.appendChild(el);
  _wcTipBubble = el;
  return el;
}
function hideInfoTip() {
  if (_wcTipBubble) _wcTipBubble.classList.remove('visible');
  _infoTipCurrent = null;
}
function showInfoTipFor(el) {
  const label = el?.dataset?.tip;
  const desc = label && WC_INFO_TIPS[label];
  if (!desc) { hideInfoTip(); return; }
  const bubble = getInfoTipBubble();
  bubble.textContent = translatePhrase(desc);
  bubble.classList.add('visible');
  const r = el.getBoundingClientRect();
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  const margin = 8;
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - bw - margin));
  let top = r.top - bh - margin;                  // prefer above the item
  bubble.classList.toggle('below', top < margin);
  if (top < margin) top = r.bottom + margin;      // …flip below when clipped at the top
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}
let _infoTipCurrent = null;
function installInfoTipController() {
  if (!window.matchMedia?.('(hover: hover)').matches) return;  // skip touch-only devices
  document.addEventListener('mouseover', (e) => {
    const el = e.target?.closest?.('[data-tip]');
    if (el === _infoTipCurrent) return;
    _infoTipCurrent = el;
    if (el) showInfoTipFor(el); else hideInfoTip();
  });
  document.addEventListener('mouseout', (e) => {
    // Hide only when the pointer truly leaves the current tip target.
    if (_infoTipCurrent && !e.relatedTarget?.closest?.('[data-tip]')) hideInfoTip();
  });
  // A moved/closed card must not leave a stale bubble hanging over the map.
  window.addEventListener('scroll', hideInfoTip, true);
  document.addEventListener('mousedown', hideInfoTip, true);
}
installInfoTipController();

let routeExportersPromise = null;
async function ensureRouteExporters() {
  routeExportersPromise ||= Promise.all([
    import('./modules/gpxExporter.js'),
    import('./modules/kmlExporter.js'),
  ]).then(([gpxModule, kmlModule]) => ({
    GpxExporter: gpxModule.GpxExporter,
    KmlExporter: kmlModule.KmlExporter,
  }));
  return routeExportersPromise;
}

let mapPackModulesPromise = null;
async function ensureMapPackModules() {
  mapPackModulesPromise ||= Promise.all([
    import('./modules/mapPackExporter.js'),
    import('./modules/mapPackImporter.js'),
  ]).then(([exporterModule, importerModule]) => ({
    MapPackExporter: exporterModule.MapPackExporter,
    MapPackImporter: importerModule.MapPackImporter,
  }));
  return mapPackModulesPromise;
}

let offlineTileIndexModulePromise = null;
async function ensureOfflineTileIndexModule() {
  offlineTileIndexModulePromise ||= import('./modules/offlineTileIndex.js');
  return offlineTileIndexModulePromise;
}

class LazyElevationProfile {
  constructor(canvasId, emptyStateId, onHover, onMarkerClick) {
    this.args = [canvasId, emptyStateId, onHover, onMarkerClick];
    this.instance = null;
    this.loadPromise = null;
    this.isCollapsed = false;
  }

  async load() {
    if (!this.loadPromise) {
      this.loadPromise = import('./modules/elevationProfile.js').then(({ ElevationProfile }) => {
        this.instance = new ElevationProfile(...this.args);
        this.instance.isCollapsed = this.isCollapsed;
        return this.instance;
      });
    }
    return this.loadPromise;
  }

  get chart() { return this.instance?.chart || null; }
  get elevations() { return this.instance?.elevations || []; }
  get distances() { return this.instance?.distances || []; }
  get points() { return this.instance?.points || []; }
  get turnaroundFrac() { return this.instance?.turnaroundFrac ?? null; }

  async update(...args) {
    const result = await (await this.load()).update(...args);
    bumpElevationVersion();
    return result;
  }

  async updateWithData(...args) {
    const result = await (await this.load()).updateWithData(...args);
    bumpElevationVersion();
    return result;
  }

  clear() {
    if (this.instance) this.instance.clear();
    bumpElevationVersion();
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    if (this.instance) this.instance.toggleCollapse();
  }

  showCrosshairAtIndex(idx) {
    this.instance?.showCrosshairAtIndex(idx);
  }

  centerHorizontallyAtIndex(idx) {
    this.instance?.centerHorizontallyAtIndex(idx);
  }

  hideCrosshair() {
    this.instance?.hideCrosshair();
  }

  setWaypointMarkers(markers) {
    this.instance?.setWaypointMarkers(markers);
  }

  _calcStats() {
    return this.instance?._calcStats() || {
      ascent: 0,
      descent: 0,
      maxElev: 0,
      minElev: 0,
      startElev: 0,
      endElev: 0,
      turnaroundElev: null,
    };
  }

  _interpolateElevAtCumM(cumM) {
    return this.instance?._interpolateElevAtCumM(cumM) || 0;
  }
}

// Fix Leaflet default icon paths
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// =========== App State ===========
let currentRouteCoords = [];
let currentElevations = [];
let allAlternatives = []; // All route alternatives
let selectedAltIndex = 0;
let isProcessing = false;
let pendingUpdate = false;
// When a file with a recorded track is imported, this flag suppresses routing so
// the track is displayed as-is until the user clears the route or imports again.
let importedTrackMode = false;
// Intermediate points (non-waypoint, tagged with `*_` prefix on export) restored
// from an imported file. Used only while importedTrackMode is active; cleared on
// re-plan / clear-route so the auto-computed markers take over.
let importedIntermediatePoints = [];
// Per-waypoint metadata (fileOrder, ele, cumDistM) carried from the imported
// file for use by buildWeatherPoints across every render in importedTrackMode.
// Distinct from window._pendingGpxDates, which is consumed once and cleared
// after the first renderWeatherPanel applies date/time/weather to cells.
let importedWaypointMeta = [];
let lastWaypoints = [];
let pendingNewWaypointIndex = null;
let isInitialLoad = false;
let refreshKeywordSearchResults = null;
let lastGpsLatLng = null;

const LS_SEGMENT_KEY = 'mappingElf_segmentKm';
const LS_ROUNDTRIP_KEY = 'mappingElf_roundTrip';
const LS_OLOOP_KEY = 'mappingElf_oLoop';
const LS_WAYPOINTS_KEY = 'mappingElf_waypoints';
const LS_WAYPOINT_IDS_KEY = 'mappingElf_waypointIds';
const LS_ROUTE_MODE_KEY = 'mappingElf_routeMode';
const LS_MAP_LAYER_KEY = 'mappingElf_mapLayer';
const LS_MAP_VIEW_KEY = 'mappingElf_mapView';
const LS_WEATHER_CACHE_KEY = 'mappingElf_weatherCache';
const LS_WEATHER_CACHE_ENABLED_KEY = 'mappingElf_weatherCacheEnabled';
const LS_WEATHER_CACHE_DISTANCE_M_KEY = 'mappingElf_weatherCacheDistanceM';
const LS_WEATHER_CACHE_ELEVATION_M_KEY = 'mappingElf_weatherCacheElevationM';
const LS_WEATHER_CACHE_MAX_AGE_DAYS_KEY = 'mappingElf_weatherCacheMaxAgeDays';
const LS_SPEED_MODE_KEY = 'mappingElf_speedMode';
const LS_SPEED_ACTIVITY_KEY = 'mappingElf_speedActivity';
const LS_PACE_PARAMS_KEY = 'mappingElf_paceParams';
const LS_PACE_CALIBRATION_KEY = 'mappingElf_paceCalibration';
const LS_PER_SEGMENT_KEY = 'mappingElf_perSegment';
const LS_STRICT_LINEAR_KEY = 'mappingElf_strictLinear';
const LS_IMPORT_AUTO_SORT_KEY = 'mappingElf_importAutoSort';
const LS_IMPORT_AUTO_NAME_KEY = 'mappingElf_importAutoName';
const LS_IMPORTED_TRACK_KEY = 'mappingElf_importedTrack';
const LS_COLLECTIVE_MARKED_KEY = 'mappingElf_collectiveMarked';
const LS_COLLECTIVE_INTERMEDIATE_KEY = 'mappingElf_collectiveIntermediate';
const LS_COLLECTIVE_ALL_KEY = 'mappingElf_collectiveAll';
const LS_WAYPOINT_CENTERING_KEY = 'mappingElf_waypointCentering';
const LS_PACE_UNIT_KEY = 'mappingElf_paceUnit';
const LS_WINDY_LAYER_KEY = 'mappingElf_windyLayer';
const LS_WINDY_MODEL_KEY = 'mappingElf_windyModel';
const LS_WEATHER_TABLE_COLLAPSED_KEY = 'mappingElf_weatherTableCollapsed';
const LS_PANEL_WIDTH_KEY = 'mappingElf_panelWidth';
const LS_THEME_KEY = 'mappingElf_theme';
const LS_PENDING_GPX_KEY = 'mappingElf_pendingGpx';

const ROUTE_MODE_DEFAULT_ACTIVITY = Object.freeze({
  walking: 'walking',
  hiking: 'hiking',
  cycling: 'cycling',
  driving: 'driving',
});

function defaultActivityForRouteMode(mode) {
  return ROUTE_MODE_DEFAULT_ACTIVITY[mode] || 'hiking';
}

function normalizeSpeedActivity(activity) {
  return ACTIVITY_PROFILES[activity] ? activity : 'hiking';
}

const WEATHER_CACHE_SCHEMA_VERSION = 2;
const WEATHER_CACHE_DISTANCE_DEFAULT_M = 500;
const WEATHER_CACHE_ELEVATION_DEFAULT_M = 100;
const WEATHER_CACHE_MAX_AGE_DEFAULT_DAYS = 1;
const WEATHER_CACHE_MAX_DISTANCE_M = 50000;
const WEATHER_CACHE_MAX_ELEVATION_M = 5000;
const WEATHER_CACHE_MAX_AGE_DAYS = 365;

function readStoredNumberSetting(key, fallback, min = -Infinity, max = Infinity) {
  const raw = localStorage.getItem(key);
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const COUNTRY_SEARCH_LANGUAGES = {
  tw: ['zh-TW'],
  cn: ['zh'],
  hk: ['zh-TW', 'en'],
  mo: ['zh-TW'],
  sg: ['en', 'zh'],
  jp: ['ja'],
  kr: ['ko'],
  fr: ['fr'],
  be: ['fr', 'de'],
  ch: ['de', 'fr', 'it'],
  de: ['de'],
  at: ['de'],
  es: ['es'],
  mx: ['es'],
  ar: ['es'],
  cl: ['es'],
  co: ['es'],
  pe: ['es'],
  it: ['it'],
  sm: ['it'],
  va: ['it'],
  us: ['en'],
  gb: ['en'],
  ie: ['en'],
  ca: ['en', 'fr'],
  au: ['en'],
  nz: ['en'],
};

/**
 * 上河速度 base: S=1.0 corresponds to 3.0 km/h on flat terrain.
 * Based on Taiwan mountain hiking convention (five-person heavy-pack group).
 * Conversion: V_km_h = SHANHE_BASE / S  ↔  S = SHANHE_BASE / V_km_h
 */
const SHANHE_BASE = 3.0;

function createWaypointId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `wp_${Date.now().toString(36)}_${rand}`;
}

function getPersistedWaypointIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(LS_WAYPOINT_IDS_KEY) || 'null');
    return Array.isArray(ids) ? ids : [];
  } catch (_) {
    return [];
  }
}

function persistWaypointIds() {
  const ids = mapManager.waypoints.map((_, i) => mapManager.getWaypointMetadata(i)?.waypointId || null);
  try { localStorage.setItem(LS_WAYPOINT_IDS_KEY, JSON.stringify(ids)); } catch (_) { }
}

function ensureWaypointIds(seedIds = null) {
  const used = new Set();
  mapManager.waypoints.forEach((_, i) => {
    const meta = { ...(mapManager.getWaypointMetadata(i) || {}) };
    if (!meta.waypointId && seedIds?.[i]) meta.waypointId = seedIds[i];
    while (!meta.waypointId || used.has(meta.waypointId)) meta.waypointId = createWaypointId();
    used.add(meta.waypointId);
    mapManager.setWaypointMetadata(i, meta);
  });
  persistWaypointIds();
}

let segmentIntervalKm = parseInt(localStorage.getItem(LS_SEGMENT_KEY) || '0') || 0;
let roundTripMode = localStorage.getItem(LS_ROUNDTRIP_KEY) === '1';
let oLoopMode = localStorage.getItem(LS_OLOOP_KEY) === '1';
if (roundTripMode && oLoopMode) { oLoopMode = false; localStorage.setItem(LS_OLOOP_KEY, '0'); }
let speedIntervalMode = localStorage.getItem(LS_SPEED_MODE_KEY) !== '0'; // default Pace ON (1 or null)
let speedActivity = normalizeSpeedActivity(
  localStorage.getItem(LS_SPEED_ACTIVITY_KEY)
  || defaultActivityForRouteMode(localStorage.getItem(LS_ROUTE_MODE_KEY) || 'hiking')
);
let perSegmentMode = localStorage.getItem(LS_PER_SEGMENT_KEY) === '1'; // default OFF
let strictLinearMode = localStorage.getItem(LS_STRICT_LINEAR_KEY) !== '0'; // default ON
let importAutoSortMode = localStorage.getItem(LS_IMPORT_AUTO_SORT_KEY) === '1'; // default OFF
let importAutoNameMode = localStorage.getItem(LS_IMPORT_AUTO_NAME_KEY) === '1'; // default OFF
let skipAutoGeocode = false;
let paceUnit = localStorage.getItem(LS_PACE_UNIT_KEY) || 'kmh'; // 'kmh' | 'minkm' | 'shanhe'
let windyLayer = (() => {
  const saved = localStorage.getItem(LS_WINDY_LAYER_KEY);
  return (saved && ['radar', 'satellite', 'thunder', 'rainAccu', 'waves', 'meteogram', 'airgram', 'airq'].includes(saved)) ? saved : 'meteogram';
})();
let windyModel = localStorage.getItem(LS_WINDY_MODEL_KEY) || 'ecmwf';
let collectiveMarked = localStorage.getItem(LS_COLLECTIVE_MARKED_KEY) !== '0'; // default true
let collectiveIntermediate = localStorage.getItem(LS_COLLECTIVE_INTERMEDIATE_KEY) !== '0'; // default true
let collectiveAll = localStorage.getItem(LS_COLLECTIVE_ALL_KEY) === '1'; // default false
let waypointCentering = localStorage.getItem(LS_WAYPOINT_CENTERING_KEY) !== '0'; // default true
let weatherTableCollapsed = localStorage.getItem(LS_WEATHER_TABLE_COLLAPSED_KEY) === '1';
let weatherCacheEnabled = localStorage.getItem(LS_WEATHER_CACHE_ENABLED_KEY) !== '0';
let weatherCacheDistanceM = readStoredNumberSetting(
  LS_WEATHER_CACHE_DISTANCE_M_KEY,
  WEATHER_CACHE_DISTANCE_DEFAULT_M,
  1,
  WEATHER_CACHE_MAX_DISTANCE_M
);
let weatherCacheElevationM = readStoredNumberSetting(
  LS_WEATHER_CACHE_ELEVATION_M_KEY,
  WEATHER_CACHE_ELEVATION_DEFAULT_M,
  1,
  WEATHER_CACHE_MAX_ELEVATION_M
);
let weatherCacheMaxAgeDays = readStoredNumberSetting(
  LS_WEATHER_CACHE_MAX_AGE_DAYS_KEY,
  WEATHER_CACHE_MAX_AGE_DEFAULT_DAYS,
  0.1,
  WEATHER_CACHE_MAX_AGE_DAYS
);

const LS_SHOW_WP_ICON_KEY = 'mappingElf_showWpIcon';
const LS_SHOW_IM_ICON_KEY = 'mappingElf_showImIcon';
let showWpIcon = localStorage.getItem(LS_SHOW_WP_ICON_KEY) !== '0'; // default true
let showImIcon = localStorage.getItem(LS_SHOW_IM_ICON_KEY) !== null ? localStorage.getItem(LS_SHOW_IM_ICON_KEY) !== '0' : window.innerWidth > 768;

let paceParams = (() => {
  try { return { ...DEFAULT_PACE_PARAMS, ...JSON.parse(localStorage.getItem(LS_PACE_PARAMS_KEY) || 'null') }; }
  catch { return { ...DEFAULT_PACE_PARAMS }; }
})();

let paceCalibration = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_PACE_CALIBRATION_KEY) || 'null');
    return {
      enabled: !!saved?.enabled,
      factor: Number(saved?.factor) || 1,
      tracks: Array.isArray(saved?.tracks) ? saved.tracks.slice(0, 5) : [],
    };
  } catch {
    return { enabled: false, factor: 1, tracks: [] };
  }
})();
paceParams = {
  ...paceParams,
  calibrationEnabled: paceCalibration.enabled,
  calibrationFactor: paceCalibration.factor,
};

const LS_FAVORITES_KEY = 'mappingElf_favorites';
const FAVORITES_MAX = 10;
let favorites = (() => {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_FAVORITES_KEY) || '[]');
    return Array.isArray(arr) ? arr.slice(0, FAVORITES_MAX) : [];
  } catch { return []; }
})();

// Gradient colors per waypoint index (teal→sky→amber→red), updated after each route build.
// Used by the sidebar list and map waypoint icons to match the elevation chart.
let waypointGradColors = [];

// Cumulative distance (metres) from start to each waypoint, populated by buildWeatherPoints().
// Empty until the first route is calculated.
let waypointCumDistM = [];

let routeMetricsCache = null;
let paceComputationCache = null;

let routeVersion = 0;
let waypointVersion = 0;
let paceVersion = 0;
let elevationVersion = 0;
let routePlanRunSeq = 0;
let geocodeRunSeq = 0;

function bumpRouteVersion() {
  routeVersion += 1;
  routeMetricsCache = null;
}

function bumpWaypointVersion() {
  waypointVersion += 1;
  routeMetricsCache = null;
}

function bumpPaceVersion() {
  paceVersion += 1;
  paceComputationCache = null;
}

function bumpElevationVersion() {
  elevationVersion += 1;
  paceComputationCache = null;
}

function setCurrentRouteData(coords = [], elevations = []) {
  currentRouteCoords = coords;
  currentElevations = elevations;
  bumpRouteVersion();
}

function getWaypointSnapshotKey(waypoints = []) {
  return JSON.stringify((waypoints || []).map((wp) => {
    const lat = Number(wp?.[0]);
    const lng = Number(wp?.[1]);
    return [
      Number.isFinite(lat) ? lat.toFixed(6) : '',
      Number.isFinite(lng) ? lng.toFixed(6) : '',
    ];
  }));
}

function computeRouteMetrics(coords, wps) {
  let totalDistM = 0;
  const routeDists = coords.length ? [0] : [];
  if (coords.length > 1) {
    for (let j = 1; j < coords.length; j++) {
      totalDistM += haversineDistance(coords[j - 1], coords[j]);
      routeDists.push(totalDistM);
    }
  }

  const wpCumDist = [];
  const wpRouteIndices = [];
  if (coords.length > 1) {
    let searchStart = 0;
    for (let i = 0; i < wps.length; i++) {
      let minDist = Infinity;
      let minIdx = searchStart;
      for (let j = searchStart; j < coords.length; j++) {
        const d = haversineDistance(wps[i], coords[j]);
        if (d < minDist) { minDist = d; minIdx = j; }
        if (minDist === 0) break;
      }
      wpRouteIndices.push(minIdx);
      wpCumDist.push(routeDists[minIdx] || 0);
      searchStart = minIdx;
    }
  } else {
    wps.forEach(() => {
      wpRouteIndices.push(0);
      wpCumDist.push(0);
    });
  }

  return { routeDists, totalDistM, wpCumDist, wpRouteIndices };
}

function getRouteMetrics(coords = currentRouteCoords, wps = mapManager.waypoints) {
  const isCurrentState = coords === currentRouteCoords && wps === mapManager.waypoints;
  if (isCurrentState
    && routeMetricsCache?.routeVersion === routeVersion
    && routeMetricsCache?.waypointVersion === waypointVersion) {
    emitTestEvent('route-metrics-cache', { status: 'hit', routeVersion, waypointVersion });
    return routeMetricsCache;
  }

  const metrics = computeRouteMetrics(coords, wps);
  if (!isCurrentState) return metrics;
  emitTestEvent('route-metrics-cache', { status: 'miss', routeVersion, waypointVersion });
  routeMetricsCache = { ...metrics, routeVersion, waypointVersion };
  return routeMetricsCache;
}

function getPaceComputation(elevs, dists, activity = speedActivity, params = paceParams) {
  const isCurrentState = elevs === elevationProfile.elevations
    && dists === elevationProfile.distances
    && activity === speedActivity
    && params === paceParams;
  if (isCurrentState
    && paceComputationCache?.paceVersion === paceVersion
    && paceComputationCache?.elevationVersion === elevationVersion) {
    emitTestEvent('pace-computation-cache', { status: 'hit', paceVersion, elevationVersion });
    return paceComputationCache;
  }

  const times = computeCumulativeTimes(elevs, dists, activity, params);
  const trip = computeTripStats(elevs, dists, activity, params);
  if (!isCurrentState) return { times, trip };
  emitTestEvent('pace-computation-cache', { status: 'miss', paceVersion, elevationVersion });
  paceComputationCache = { paceVersion, elevationVersion, times, trip };
  return paceComputationCache;
}


// =========== Initialize Modules ===========
const routeEngine = new RouteEngine();
const weatherService = new WeatherService();
const offlineManager = new OfflineManager();
const mapManager = new MapManager('map', onWaypointsChanged);
mapManager.onFrozenInteraction = () => {
  if (isRouteWeatherBusy()) showRouteWeatherBusyNotice();
  else showImportedTrackEditNotice();
};
mapManager.onGpsFix = (lat, lng) => {
  lastGpsLatLng = [lat, lng];
};
let pendingWeatherMarkerRefreshAfterDrag = false;
function refreshWeatherMarkersAfterWeatherUpdate() {
  if (mapManager.isWaypointInteracting?.() || mapManager.isWaypointDragging?.()) {
    pendingWeatherMarkerRefreshAfterDrag = true;
    return;
  }
  updateElevationMarkers();
  updateIntermediateMarkers();
}
mapManager.onWaypointDragEnd = () => {
  if (!pendingWeatherMarkerRefreshAfterDrag) return;
  pendingWeatherMarkerRefreshAfterDrag = false;
  updateElevationMarkers();
  updateIntermediateMarkers();
};

function invalidateRoutePlanRun() {
  routePlanRunSeq += 1;
}

function createRoutePlanSnapshot(waypoints) {
  return {
    runSeq: ++routePlanRunSeq,
    waypointVersion,
    waypointKey: getWaypointSnapshotKey(waypoints),
    routeMode: routeEngine.mode,
    roundTripMode,
    oLoopMode,
  };
}

function isRoutePlanSnapshotStale(snapshot) {
  return !snapshot
    || snapshot.runSeq !== routePlanRunSeq
    || pendingUpdate
    || snapshot.waypointVersion !== waypointVersion
    || snapshot.waypointKey !== getWaypointSnapshotKey(mapManager.waypoints)
    || snapshot.routeMode !== routeEngine.mode
    || snapshot.roundTripMode !== roundTripMode
    || snapshot.oLoopMode !== oLoopMode;
}

function getRoutePlanningErrorMessage(err) {
  if (isAbortError(err)) return null;
  if (platform.getNetworkStatus().connected === false) {
    return '目前離線，暫時無法重新規劃路線';
  }
  return '路徑計算失敗，請稍後再試';
}

function emitTestEvent(type, detail = {}) {
  const hooks = typeof window !== 'undefined' ? window.__mappingElfTestHooks : null;
  if (!hooks) return;
  try {
    const event = { type, detail };
    if (Array.isArray(hooks.events)) hooks.events.push(event);
    if (typeof hooks.onEvent === 'function') hooks.onEvent(event);
  } catch (_) { /* test hooks must never affect app behavior */ }
}

// =========== Undo/Redo History ===========
// Snapshot-based history for all route-planning actions:
// waypoint add/remove/drag/reorder/clear, custom-name edits, nav-mode toggle, import.
const history = {
  undo: [],
  redo: [],
  current: null,
  suppressed: false,
  MAX: 50,
};

function _captureSnapshot() {
  return {
    waypoints: mapManager.waypoints.map(([a, b]) => [a, b]),
    waypointIds: mapManager.waypoints.map((_, i) => mapManager.getWaypointMetadata(i)?.waypointId || null),
    customNames: JSON.parse(JSON.stringify(waypointCustomNames || {})),
    roundTripMode,
    oLoopMode,
    importedTrackMode,
  };
}

function _snapsEqual(a, b) {
  if (!a || !b) return false;
  if (a.roundTripMode !== b.roundTripMode) return false;
  if (a.oLoopMode !== b.oLoopMode) return false;
  if (a.importedTrackMode !== b.importedTrackMode) return false;
  if (a.waypoints.length !== b.waypoints.length) return false;
  for (let i = 0; i < a.waypoints.length; i++) {
    if (a.waypoints[i][0] !== b.waypoints[i][0] || a.waypoints[i][1] !== b.waypoints[i][1]) return false;
    if ((a.waypointIds?.[i] || null) !== (b.waypointIds?.[i] || null)) return false;
  }
  const ak = Object.keys(a.customNames), bk = Object.keys(b.customNames);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a.customNames[k] !== b.customNames[k]) return false;
  return true;
}

function historyRecord() {
  if (history.suppressed) return;
  const next = _captureSnapshot();
  if (history.current && _snapsEqual(history.current, next)) return;
  if (history.current) {
    history.undo.push(history.current);
    if (history.undo.length > history.MAX) history.undo.shift();
  }
  history.current = next;
  history.redo = [];
  _updateHistoryButtons();
}

function _restoreSnapshot(snap) {
  history.suppressed = true;
  try {
    // Nav mode
    roundTripMode = snap.roundTripMode;
    oLoopMode = snap.oLoopMode;
    bumpRouteVersion();
    localStorage.setItem(LS_ROUNDTRIP_KEY, roundTripMode ? '1' : '0');
    localStorage.setItem(LS_OLOOP_KEY, oLoopMode ? '1' : '0');
    const modeVal = roundTripMode ? 'roundtrip' : oLoopMode ? 'oloop' : 'single';
    const modeRadio = document.getElementById(`nav-mode-${modeVal}`);
    if (modeRadio) modeRadio.checked = true;

    // Track mode flag (polyline isn't snapshotted — best-effort)
    importedTrackMode = snap.importedTrackMode;
    if (!importedTrackMode) { importedIntermediatePoints = []; importedWaypointMeta = []; }
    if (typeof syncTrackModeUI === 'function') syncTrackModeUI();

    // Custom names
    Object.keys(waypointCustomNames).forEach(k => delete waypointCustomNames[k]);
    Object.assign(waypointCustomNames, snap.customNames);
    try { localStorage.setItem(LS_CUSTOM_NAMES_KEY, JSON.stringify(waypointCustomNames)); } catch (_) { }

    // Waypoints — bulk rebuild without intermediate callbacks
    const cb = mapManager.onWaypointChange;
    mapManager.onWaypointChange = () => { };
    try {
      mapManager.clearWaypoints();
      snap.waypoints.forEach(([lat, lng]) => mapManager.addWaypoint(lat, lng));
      ensureWaypointIds(snap.waypointIds || []);
    } finally {
      mapManager.onWaypointChange = cb;
    }

    // Close all weather cards — indices will change
    _wcStates.clear();
    mapManager.closeWeatherPopup();
  } finally {
    history.suppressed = false;
  }
  history.current = _captureSnapshot();
  // Trigger a single routing pass with the restored waypoints.
  // Skip auto-geocode since names are already restored.
  skipAutoGeocode = true;
  try { onWaypointsChanged(mapManager.waypoints); }
  finally { skipAutoGeocode = false; }
  _updateHistoryButtons();
}

function historyUndo() {
  if (history.undo.length === 0) return;
  const target = history.undo.pop();
  history.redo.push(history.current);
  _restoreSnapshot(target);
  showNotification('已復原', 'info', 1200);
}

function historyRedo() {
  if (history.redo.length === 0) return;
  const target = history.redo.pop();
  history.undo.push(history.current);
  _restoreSnapshot(target);
  showNotification('已取消復原', 'info', 1200);
}

function _updateHistoryButtons() {
  // A data load ('edit' scope) keeps undo/redo live; a full route lock / imported
  // track disables them. (These buttons are no longer in the blunt disable selector,
  // so this is their single source of truth.)
  const frozen = !!importedTrackMode || (isRouteWeatherBusy() && !isDataLoadEditMode());
  if (btnUndo) btnUndo.disabled = frozen || history.undo.length === 0;
  if (btnRedo) btnRedo.disabled = frozen || history.redo.length === 0;
}

function historyInit() {
  history.current = _captureSnapshot();
  history.undo = [];
  history.redo = [];
  _updateHistoryButtons();
}

/**
 * Re-read preferences from localStorage into memory variables without a page reload.
 * Used after a mappack state restoration to apply settings immediately.
 */
function applySettingsFromStorage() {
  segmentIntervalKm = parseInt(localStorage.getItem(LS_SEGMENT_KEY) || '0') || 0;
  roundTripMode = localStorage.getItem(LS_ROUNDTRIP_KEY) === '1';
  oLoopMode = localStorage.getItem(LS_OLOOP_KEY) === '1';
  if (roundTripMode && oLoopMode) { oLoopMode = false; localStorage.setItem(LS_OLOOP_KEY, '0'); }
  speedIntervalMode = localStorage.getItem(LS_SPEED_MODE_KEY) !== '0';
  speedActivity = normalizeSpeedActivity(
    localStorage.getItem(LS_SPEED_ACTIVITY_KEY)
    || defaultActivityForRouteMode(localStorage.getItem(LS_ROUTE_MODE_KEY) || 'hiking')
  );
  perSegmentMode = localStorage.getItem(LS_PER_SEGMENT_KEY) === '1';
  strictLinearMode = localStorage.getItem(LS_STRICT_LINEAR_KEY) !== '0';
  importAutoSortMode = localStorage.getItem(LS_IMPORT_AUTO_SORT_KEY) === '1';
  importAutoNameMode = localStorage.getItem(LS_IMPORT_AUTO_NAME_KEY) === '1';
  paceUnit = localStorage.getItem(LS_PACE_UNIT_KEY) || 'kmh';
  {
    const saved = localStorage.getItem(LS_WINDY_LAYER_KEY);
    windyLayer = (saved && REMAINING_WINDY_LAYERS.has(saved)) ? saved : 'meteogram';
  }
  windyModel = localStorage.getItem(LS_WINDY_MODEL_KEY) || 'ecmwf';
  weatherCacheEnabled = localStorage.getItem(LS_WEATHER_CACHE_ENABLED_KEY) !== '0';
  weatherCacheDistanceM = readStoredNumberSetting(LS_WEATHER_CACHE_DISTANCE_M_KEY, WEATHER_CACHE_DISTANCE_DEFAULT_M, 1, WEATHER_CACHE_MAX_DISTANCE_M);
  weatherCacheElevationM = readStoredNumberSetting(LS_WEATHER_CACHE_ELEVATION_M_KEY, WEATHER_CACHE_ELEVATION_DEFAULT_M, 1, WEATHER_CACHE_MAX_ELEVATION_M);
  weatherCacheMaxAgeDays = readStoredNumberSetting(LS_WEATHER_CACHE_MAX_AGE_DAYS_KEY, WEATHER_CACHE_MAX_AGE_DEFAULT_DAYS, 0.1, WEATHER_CACHE_MAX_AGE_DAYS);
  try {
    cachedWeatherData = normalizeWeatherCacheStore(JSON.parse(localStorage.getItem(LS_WEATHER_CACHE_KEY) || '{}'));
    pruneWeatherCache({ persist: true });
  } catch {
    cachedWeatherData = {};
  }
  try {
    cachedCatchmentData = normalizeCatchmentCacheStore(JSON.parse(localStorage.getItem(LS_CATCHMENT_CACHE_KEY) || '{}'));
    pruneCatchmentCache({ persist: true });
  } catch {
    cachedCatchmentData = {};
  }
  try {
    savedCatchmentCells = JSON.parse(localStorage.getItem(LS_CATCHMENT_CELLS_KEY) || '{}');
  } catch {
    savedCatchmentCells = {};
  }
  loadCardCatchmentViewMemory();   // restore per-card 天氣/集水區 view choice from the imported state
  collectiveMarked = localStorage.getItem(LS_COLLECTIVE_MARKED_KEY) !== '0';
  collectiveIntermediate = localStorage.getItem(LS_COLLECTIVE_INTERMEDIATE_KEY) !== '0';
  collectiveAll = localStorage.getItem(LS_COLLECTIVE_ALL_KEY) === '1';
  waypointCentering = localStorage.getItem(LS_WAYPOINT_CENTERING_KEY) !== '0';
  showWpIcon = localStorage.getItem(LS_SHOW_WP_ICON_KEY) !== '0';
  showImIcon = localStorage.getItem(LS_SHOW_IM_ICON_KEY) !== null ? localStorage.getItem(LS_SHOW_IM_ICON_KEY) !== '0' : window.innerWidth > 768;
  try {
    paceParams = { ...DEFAULT_PACE_PARAMS, ...JSON.parse(localStorage.getItem(LS_PACE_PARAMS_KEY) || 'null') };
  } catch {
    paceParams = { ...DEFAULT_PACE_PARAMS };
  }
  try {
    const savedCalibration = JSON.parse(localStorage.getItem(LS_PACE_CALIBRATION_KEY) || 'null');
    paceCalibration = {
      enabled: !!savedCalibration?.enabled,
      factor: Number(savedCalibration?.factor) || 1,
      tracks: Array.isArray(savedCalibration?.tracks) ? savedCalibration.tracks.slice(0, 5) : [],
    };
  } catch {
    paceCalibration = { enabled: false, factor: 1, tracks: [] };
  }
  paceParams = {
    ...paceParams,
    calibrationEnabled: paceCalibration.enabled,
    calibrationFactor: paceCalibration.factor,
  };
  bumpRouteVersion();
  bumpPaceVersion();

  // Update UI components that depend on these globals
  routeEngine.setMode(localStorage.getItem(LS_ROUTE_MODE_KEY) || 'hiking');
  const modeRadio = document.querySelector(`input[name="route-mode"][value="${routeEngine.mode}"]`);
  if (modeRadio) modeRadio.checked = true;

  const savedLayer = getPersistedMapLayer();
  if (mapManager.currentLayerName !== savedLayer) {
    mapManager.switchLayer(savedLayer);
  }
  layerBtns.forEach((b) => b.classList.toggle('active', b.dataset.layer === mapManager.currentLayerName));

  // Sync checkboxes in settings panel
  const perSegmentEl = document.getElementById('pace-per-segment-enable');
  if (perSegmentEl) perSegmentEl.checked = perSegmentMode;
  const strictLinearEl = document.getElementById('strict-linear-enable');
  if (strictLinearEl) strictLinearEl.checked = strictLinearMode;
  const importAutoSortEl = document.getElementById('import-auto-sort-enable');
  if (importAutoSortEl) importAutoSortEl.checked = importAutoSortMode;
  const importAutoNameEl = document.getElementById('import-auto-name-enable');
  if (importAutoNameEl) importAutoNameEl.checked = importAutoNameMode;
  syncPaceCalibrationUI();

  // Waypoint Settings
  const collectiveMarkedEl = document.getElementById('collective-marked-pts');
  if (collectiveMarkedEl) collectiveMarkedEl.checked = collectiveMarked;
  const collectiveIntermediateEl = document.getElementById('collective-intermediate-pts');
  if (collectiveIntermediateEl) collectiveIntermediateEl.checked = collectiveIntermediate;
  const collectiveAllEl = document.getElementById('collective-all-waypoints');
  if (collectiveAllEl) {
    collectiveAllEl.checked = collectiveAll;
    if (collectiveAll) {
       if (collectiveMarkedEl) collectiveMarkedEl.disabled = true;
       if (collectiveIntermediateEl) collectiveIntermediateEl.disabled = true;
    }
  }
  const waypointCenteringEl = document.getElementById('waypoint-centering-enable');
  if (waypointCenteringEl) waypointCenteringEl.checked = waypointCentering;

  const showWpIconEl = document.getElementById('show-waypoint-weather-icon');
  if (showWpIconEl) showWpIconEl.checked = showWpIcon;
  const showImIconEl = document.getElementById('show-intermediate-weather-icon');
  if (showImIconEl) showImIconEl.checked = showImIcon;
  syncWeatherCacheSettingsUI();

  // Refresh UI
  syncTrackModeUI();
  updateFlatPlaceholder();
  updateMapWeatherIconVisibility();
  renderWeatherPanel();
}

const elevationProfile = new LazyElevationProfile(
  'elevation-chart',
  'chart-empty',
  (lat, lng, color) => mapManager.showHoverMarker(lat, lng, color),
  (colIdx, isIconClick) => {
    if (isIconClick) {
      // Open the specific weather card for this marker using collective rules.
      handleWeatherIconInteraction(colIdx);
    } else {
      // Dot click: only highlight the point on the map/sidebar
      highlightPoint(colIdx, true); // Requirement 2: Toggle on single click
    }
  }
);

// When user clicks an alternative route on the map
mapManager.onRouteSelect = (idx) => selectAlternative(idx);

// When user clicks a waypoint marker on the map → cross-view highlight
mapManager.onWaypointSelect = (wpIndex, isReturn = false, shouldToggle = false) => {
  const colIdx = weatherPoints.findIndex(p => p.isWaypoint && p.isReturn === isReturn && p.wpIndex === wpIndex);
  if (colIdx >= 0) {
    highlightPoint(colIdx, shouldToggle);
  } else {
    if (isReturn) mapManager.highlightReturnWaypoint(wpIndex);
    else mapManager.highlightWaypoint(wpIndex);
    
    waypointList.querySelectorAll('.waypoint-item').forEach(el => el.classList.remove('wp-highlight'));
    const item = waypointList.querySelectorAll('.waypoint-item')[wpIndex];
    if (item) {
      item.classList.add('wp-highlight');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
};

// Bidirectional: hovering the map route highlights the elevation chart
mapManager.onRouteHover = (lat, lng) => {
  if (lat == null) {
    elevationProfile.hideCrosshair();
    mapManager.clearHoverMarker();
    return;
  }
  const pts = elevationProfile.points;
  if (!pts || pts.length === 0) return;
  let minD = Infinity, closestIdx = 0;
  for (let i = 0; i < pts.length; i++) {
    const d = haversineDistance([lat, lng], pts[i]);
    if (d < minD) { minD = d; closestIdx = i; }
  }
  elevationProfile.showCrosshairAtIndex(closestIdx);

  const maxM = elevationProfile.distances[elevationProfile.distances.length - 1] || 1;
  const cumM = elevationProfile.distances[closestIdx] || 0;
  const xFrac = Math.max(0, Math.min(1, cumM / maxM));
  const tf = elevationProfile.turnaroundFrac;
  let color;
  if (tf != null && xFrac > tf) {
    const denom = 1 - tf;
    const tRet = denom > 0 ? (xFrac - tf) / denom : 0;
    color = interpolateReturnColor(Math.max(0, Math.min(1, tRet)));
  } else if (tf != null) {
    const tOut = tf > 0 ? xFrac / tf : 0;
    color = interpolateRouteColor(Math.max(0, Math.min(1, tOut)));
  } else {
    const t = roundTripMode ? (1 - Math.abs(2 * xFrac - 1)) : xFrac;
    color = interpolateRouteColor(t);
  }
  mapManager.showHoverMarker(lat, lng, color);
};

// Map-cursor action menu (placed by GPS button — set as waypoint / copy / weather)
mapManager.onMapCursorAction = (action, lat, lng) => {
  if (isRouteWeatherBusy() && ['waypoint', 'weather', 'clear'].includes(action)) {
    showRouteWeatherBusyNotice();
    return;
  }
  if (action === 'waypoint') {
    mapManager.addWaypoint(lat, lng);
    showNotification('已設為航點', 'success', 1200);
    return;
  }
  if (action === 'copy') {
    const text = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    copyToClipboard(text, (ok) => showNotification(ok ? `已複製座標 ${text}` : '複製失敗', ok ? 'success' : 'error', 1500));
    return;
  }
  if (action === 'weather') {
    openCursorWeatherCard(lat, lng);
    return;
  }
  if (action === 'windy') {
    const url = buildWindyUrl(lat, lng);
    platform.openExternalUrl(url);
    return;
  }
  if (action === 'clear') {
    mapManager.clearMapCursor();
    _resetCursorCatchment();
    showNotification('已清除 GPS 游標', 'info', 1200);
    return;
  }
};

// Handle clicks on intermediate markers on the map
mapManager.onIntermediateSelect = (lat, lng) => {
  if (!weatherPoints || weatherPoints.length === 0) return;
  let minD = Infinity, closestIdx = 0;
  for (let i = 0; i < weatherPoints.length; i++) {
    const d = haversineDistance([lat, lng], [weatherPoints[i].lat, weatherPoints[i].lng]);
    if (d < minD) { minD = d; closestIdx = i; }
  }
  highlightPoint(closestIdx);
};

// =========== DOM Elements ===========
const loadingScreen = document.getElementById('loading-screen');
const INITIAL_LOADING_FADE_MS = 520;
document.body.classList.add('app-initial-loading');
const sidePanel = document.getElementById('side-panel');
const waypointList = document.getElementById('waypoint-list');
const alternativesList = document.getElementById('alternatives-list');
const altCount = document.getElementById('alt-count');

const btnTogglePanel = document.getElementById('btn-toggle-panel');
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const btnMyLocation = document.getElementById('btn-my-location');
const btnExportGpx = document.getElementById('btn-export-gpx');
const btnImportGpx = document.getElementById('btn-import-gpx');
const btnPanelNarrow = document.getElementById('btn-panel-narrow');
const btnPanelWiden = document.getElementById('btn-panel-widen');
const btnClearRoute = document.getElementById('btn-clear-route');
const btnReplanRoute = document.getElementById('btn-replan-route');
const btnReverseReplanRoute = document.getElementById('btn-reverse-replan-route');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnResetDefaults = document.getElementById('btn-reset-defaults');
const gpxFileInput = document.getElementById('gpx-file-input');

const mappackImportModal = document.getElementById('mappack-import-modal');
// const btnFetchWeather = document.getElementById('btn-fetch-weather'); (Moved to weather table)

const statDistance = document.getElementById('stat-distance');
const statAscent = document.getElementById('stat-ascent');
const statDescent = document.getElementById('stat-descent');
const statMaxElev = document.getElementById('stat-max-elev');
const statMinElev = document.getElementById('stat-min-elev');
const statStartElev = document.getElementById('stat-start-elev');
const statEndElev = document.getElementById('stat-end-elev');
const labelStartElev = document.getElementById('label-start-elev');
const labelEndElev = document.getElementById('label-end-elev');
const statTime = document.getElementById('stat-time');
const statTimeCard = document.getElementById('stat-time-card');
const statKcal = document.getElementById('stat-kcal');
const statKcalCard = document.getElementById('stat-kcal-card');
const statIntake = document.getElementById('stat-intake');
const statIntakeCard = document.getElementById('stat-intake-card');

const layerBtns = document.querySelectorAll('.layer-btn');
const routeModeRadios = document.querySelectorAll('input[name="route-mode"]');

// Pace / Interval UI elements
const paceParamsPanel = document.getElementById('pace-params-panel');
const paceFlatInput = document.getElementById('pace-flat-input');
const paceBodyWeight = document.getElementById('pace-body-weight');
const pacePackWeight = document.getElementById('pace-pack-weight');
const paceFatigueLevelEl = document.getElementById('pace-fatigue-level');
const paceRestRow = document.getElementById('pace-rest-row');
const paceRestEvery = document.getElementById('pace-rest-every');
const paceRestMinutes = document.getElementById('pace-rest-minutes');
const paceUnitSelect = document.getElementById('pace-unit-select');
const paceCalibrationEnable = document.getElementById('pace-calibration-enable');
const paceCalibrationFileInput = document.getElementById('pace-calibration-file-input');
const paceCalibrationPick = document.getElementById('btn-pace-calibration-pick');
const paceCalibrationCompute = document.getElementById('btn-pace-calibration-compute');
const paceCalibrationClear = document.getElementById('btn-pace-calibration-clear');
const paceCalibrationList = document.getElementById('pace-calibration-list');
const paceCalibrationFactor = document.getElementById('pace-calibration-factor');

/** Convert km/h → displayed value in current unit */
function kmhToDisplayForUnit(v, unit = paceUnit) {
  return unit === 'shanhe' ? +(SHANHE_BASE / v).toFixed(2)
    : unit === 'minkm' ? +(60 / v).toFixed(1)
      : +v.toFixed(2);
}

/** Convert displayed value → km/h */
function displayToKmhForUnit(v, unit = paceUnit) {
  return unit === 'shanhe' ? SHANHE_BASE / v
    : unit === 'minkm' ? 60 / v
      : v;
}

function formatKmhForUnit(v, unit = paceUnit) {
  return unit === 'shanhe' ? (SHANHE_BASE / v).toFixed(2)
    : unit === 'minkm' ? (60 / v).toFixed(1)
      : v.toFixed(2);
}

const kmhToDisplay = (v) => kmhToDisplayForUnit(v);
const displayToKmh = (v) => displayToKmhForUnit(v);

const PACE_UNIT_INPUT_SETTINGS = {
  kmh: {
    min: '0.5',
    max: '80',
    step: '0.5',
    formatPlaceholder: (speedKmh) => speedKmh.toFixed(1),
  },
  minkm: {
    min: '1',
    max: '120',
    step: '0.5',
    formatPlaceholder: (speedKmh) => (60 / speedKmh).toFixed(1),
  },
  shanhe: {
    min: '0.1',
    max: '10',
    step: '0.05',
    formatPlaceholder: (speedKmh) => (SHANHE_BASE / speedKmh).toFixed(2),
  },
};

function getPaceUnitInputSettings(unit = paceUnit) {
  return PACE_UNIT_INPUT_SETTINGS[unit] || PACE_UNIT_INPUT_SETTINGS.kmh;
}

function formatFlatPacePlaceholder(speedKmh, unit = paceUnit) {
  const speed = Number(speedKmh);
  if (!Number.isFinite(speed) || speed <= 0) return '—';
  return getPaceUnitInputSettings(unit).formatPlaceholder(speed);
}

function applyFlatPaceInputConstraints(input = paceFlatInput, unit = paceUnit) {
  if (!input) return;
  const settings = getPaceUnitInputSettings(unit);
  input.min = settings.min;
  input.max = settings.max;
  input.step = settings.step;
}

function setDynamicPlaceholder(input, placeholder) {
  if (!input) return;
  input.setAttribute('data-i18n-originalplaceholder', placeholder);
  input.placeholder = placeholder;
}

function syncCalibrationIntoPaceParams() {
  paceParams = {
    ...DEFAULT_PACE_PARAMS,
    ...paceParams,
    calibrationEnabled: !!paceCalibration.enabled,
    calibrationFactor: Number(paceCalibration.factor) || 1,
  };
}

function savePaceCalibration() {
  paceCalibration = {
    enabled: !!paceCalibration.enabled,
    factor: Number(paceCalibration.factor) || 1,
    tracks: (paceCalibration.tracks || []).slice(0, 5),
  };
  localStorage.setItem(LS_PACE_CALIBRATION_KEY, JSON.stringify(paceCalibration));
  syncCalibrationIntoPaceParams();
  localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(paceParams));
  bumpPaceVersion();
}

function formatCalibrationTrackSummary(track) {
  const distKm = ((track.distanceM || 0) / 1000).toFixed(1);
  const est = formatDuration(track.estimatedH || 0, getLanguage());
  return `${distKm} km · +${Math.round(track.ascentM || 0)} m / -${Math.round(track.descentM || 0)} m · ${translatePhrase('預估')} ${est}`;
}

function syncPaceCalibrationUI() {
  if (paceCalibrationEnable) paceCalibrationEnable.checked = !!paceCalibration.enabled;
  if (paceCalibrationFactor) {
    paceCalibrationFactor.textContent = `個人校正 ×${(Number(paceCalibration.factor) || 1).toFixed(2)}`;
    paceCalibrationFactor.classList.toggle('disabled', !paceCalibration.enabled);
  }
  if (!paceCalibrationList) return;
  const tracks = paceCalibration.tracks || [];
  if (tracks.length === 0) {
    paceCalibrationList.innerHTML = '<div class="pace-calibration-empty">尚未載入校正軌跡</div>';
    return;
  }
  paceCalibrationList.innerHTML = tracks.map((track, idx) => `
    <div class="pace-calibration-item" data-idx="${idx}">
      <div class="pace-calibration-main">
        <div class="pace-calibration-name">${_escapeHtml(track.name || `Track ${idx + 1}`)}</div>
        <div class="pace-calibration-meta">${_escapeHtml(formatCalibrationTrackSummary(track))}</div>
      </div>
      <label class="pace-calibration-hours">
        <span>實際</span>
        <input type="number" min="0.1" step="0.1" value="${track.actualHours ?? ''}" data-calibration-hours="${idx}" placeholder="小時">
      </label>
      <button type="button" class="btn-secondary pace-calibration-remove" data-calibration-remove="${idx}">移除</button>
    </div>
  `).join('');

  paceCalibrationList.querySelectorAll('[data-calibration-hours]').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.calibrationHours);
      const val = parseFloat(input.value);
      if (paceCalibration.tracks[idx]) {
        paceCalibration.tracks[idx].actualHours = Number.isFinite(val) && val > 0 ? val : null;
        savePaceCalibration();
      }
    });
  });
  paceCalibrationList.querySelectorAll('[data-calibration-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.calibrationRemove);
      paceCalibration.tracks.splice(idx, 1);
      savePaceCalibration();
      syncPaceCalibrationUI();
      updateTimeStat();
      updateIntermediateMarkers();
      renderWeatherPanel();
    });
  });
}

async function parseCalibrationFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const text = await platform.readFileAsText(file);
  const { GpxExporter, KmlExporter } = await ensureRouteExporters();
  let result;
  if (ext === 'gpx') result = GpxExporter.parse(text);
  else if (ext === 'kml') result = KmlExporter.parse(text);
  else throw new Error('Unsupported calibration file');
  const summary = summarizeImportedTrackForCalibration(
    result,
    null,
    speedActivity || 'hiking',
    { ...paceParams, calibrationEnabled: false, calibrationFactor: 1 }
  );
  return {
    id: `cal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    ...summary,
  };
}

async function loadPaceCalibrationFiles(files) {
  const incoming = Array.from(files || []).filter(file => /\.(gpx|kml)$/i.test(file.name));
  if (incoming.length === 0) {
    showNotification('請選擇 GPX 或 KML 軌跡', 'warning');
    return;
  }
  const remainingSlots = Math.max(0, 5 - (paceCalibration.tracks?.length || 0));
  if (remainingSlots <= 0) {
    showNotification('最多只能保留 5 條校正軌跡', 'warning');
    return;
  }
  const selected = incoming.slice(0, remainingSlots);
  if (incoming.length > selected.length) showNotification('已達 5 條上限，只載入前幾條軌跡', 'warning');

  const loaded = [];
  for (const file of selected) {
    try {
      loaded.push(await parseCalibrationFile(file));
    } catch (err) {
      console.error('Calibration track parse failed:', file.name, err);
      showNotification(`校正軌跡讀取失敗：${file.name}`, 'error');
    }
  }
  if (loaded.length > 0) {
    paceCalibration.tracks = [...(paceCalibration.tracks || []), ...loaded].slice(0, 5);
    savePaceCalibration();
    syncPaceCalibrationUI();
    showNotification(`已載入 ${loaded.length} 條校正軌跡`, 'success');
  }
}

function computeAndApplyPaceCalibration() {
  const result = computeCalibrationFromTracks(paceCalibration.tracks || []);
  if (result.count === 0) {
    showNotification('請先為至少一條校正軌跡輸入實際耗時', 'warning');
    return;
  }
  paceCalibration.factor = result.factor;
  paceCalibration.enabled = true;
  savePaceCalibration();
  syncPaceCalibrationUI();
  updateTimeStat();
  updateIntermediateMarkers();
  renderWeatherPanel();
  const clipNote = result.clipped ? '，倍率已限制在 0.6–1.8' : '';
  showNotification(`個人校正已更新：×${result.factor.toFixed(2)}${clipNote}`, result.clipped ? 'warning' : 'success');
}

/** Sync placeholder and input constraints to current unit */
function updateFlatPlaceholder() {
  if (!paceFlatInput) return;
  const body = parseFloat(paceBodyWeight?.value) || 70;
  const pack = parseFloat(pacePackWeight?.value) || 0;
  const spdKmh = defaultSpeed(speedActivity, body, pack);
  applyFlatPaceInputConstraints(paceFlatInput, paceUnit);
  setDynamicPlaceholder(paceFlatInput, formatFlatPacePlaceholder(spdKmh, paceUnit));
}

function shouldShowEnergyStats() {
  return speedActivity !== 'driving';
}

function syncPaceActivityApplicabilityUi() {
  const showEnergy = shouldShowEnergyStats();
  const active = speedIntervalMode || segmentIntervalKm > 0;
  const paceLoadRow = document.getElementById('pace-load-row');
  const paceFatigueField = document.getElementById('pace-fatigue-field');
  if (paceLoadRow) paceLoadRow.style.display = showEnergy ? '' : 'none';
  if (paceFatigueField) paceFatigueField.style.display = showEnergy ? '' : 'none';
  if (paceRestRow) {
    paceRestRow.style.display = showEnergy && paceFatigueLevelEl?.value !== 'none' ? '' : 'none';
  }
  if (statKcalCard) statKcalCard.style.display = active && showEnergy ? '' : 'none';
  if (statIntakeCard) statIntakeCard.style.display = active && showEnergy ? '' : 'none';
  if (!showEnergy) {
    if (statKcal) statKcal.textContent = '—';
    if (statIntake) statIntake.textContent = '—';
  }
}

function applySpeedActivity(nextActivity, options = {}) {
  const {
    convertFlatPace = true,
    persist = true,
    syncSelect = true,
  } = options;
  const normalized = normalizeSpeedActivity(nextActivity);
  const previousActivity = normalizeSpeedActivity(speedActivity);
  const changed = normalized !== previousActivity;

  if (changed && convertFlatPace) {
    const rawDisplay = parseFloat(paceFlatInput?.value);
    if (paceFlatInput && !isNaN(rawDisplay) && paceFlatInput.value !== '') {
      const currentKmh = displayToKmhForUnit(rawDisplay);
      const body = parseFloat(paceBodyWeight?.value) || 70;
      const pack = parseFloat(pacePackWeight?.value) || 0;
      const prevDefault = defaultSpeed(previousActivity, body, pack);
      const newDefault = defaultSpeed(normalized, body, pack);
      if (prevDefault > 0) {
        const newKmh = +(currentKmh / prevDefault * newDefault).toFixed(2);
        paceFlatInput.value = formatKmhForUnit(newKmh);
        paceParams = { ...paceParams, flatPaceKmH: newKmh };
        localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(paceParams));
      }
    }
  }

  speedActivity = normalized;
  if (syncSelect) {
    const speedActivityEl = document.getElementById('speed-activity-select');
    if (speedActivityEl) speedActivityEl.value = speedActivity;
  }
  if (persist) localStorage.setItem(LS_SPEED_ACTIVITY_KEY, speedActivity);
  if (changed) bumpPaceVersion();
  updateFlatPlaceholder();
  syncPaceActivityApplicabilityUi();
  return changed;
}

function applyRouteMode(mode, options = {}) {
  const { syncPaceActivity = true } = options;
  const routeMode = ['walking', 'hiking', 'cycling', 'driving'].includes(mode) ? mode : 'hiking';
  routeEngine.setMode(routeMode);
  localStorage.setItem(LS_ROUTE_MODE_KEY, routeMode);
  bumpRouteVersion();
  if (syncPaceActivity) {
    applySpeedActivity(defaultActivityForRouteMode(routeMode));
  }
}

// =========== Waypoint Settings ===========

function initWaypointSettings() {
  const collectiveMarkedEl = document.getElementById('collective-marked-pts');
  const collectiveIntermediateEl = document.getElementById('collective-intermediate-pts');
  const collectiveAllEl = document.getElementById('collective-all-waypoints');
  const waypointCenteringEl = document.getElementById('waypoint-centering-enable');

  const btnMinimize = document.getElementById('btn-collective-minimize');
  const btnToggleGrid = document.getElementById('btn-collective-toggle-grid');

  const syncCollectiveLock = () => {
    const isAll = collectiveAllEl?.checked;
    if (collectiveMarkedEl) collectiveMarkedEl.disabled = !!isAll;
    if (collectiveIntermediateEl) collectiveIntermediateEl.disabled = !!isAll;
  };

  collectiveMarkedEl?.addEventListener('change', () => {
    if (isRouteWeatherBusy()) {
      runOrDeferBusySetting('collective-marked', () => collectiveMarkedEl.dispatchEvent(new Event('change')));
      return;
    }
    collectiveMarked = collectiveMarkedEl.checked;
    localStorage.setItem(LS_COLLECTIVE_MARKED_KEY, collectiveMarked ? '1' : '0');
  });

  collectiveIntermediateEl?.addEventListener('change', () => {
    if (isRouteWeatherBusy()) {
      runOrDeferBusySetting('collective-intermediate', () => collectiveIntermediateEl.dispatchEvent(new Event('change')));
      return;
    }
    collectiveIntermediate = collectiveIntermediateEl.checked;
    localStorage.setItem(LS_COLLECTIVE_INTERMEDIATE_KEY, collectiveIntermediate ? '1' : '0');
  });

  collectiveAllEl?.addEventListener('change', () => {
    if (isRouteWeatherBusy()) {
      runOrDeferBusySetting('collective-all', () => collectiveAllEl.dispatchEvent(new Event('change')));
      return;
    }
    collectiveAll = collectiveAllEl.checked;
    localStorage.setItem(LS_COLLECTIVE_ALL_KEY, collectiveAll ? '1' : '0');
    syncCollectiveLock();
  });

  waypointCenteringEl?.addEventListener('change', () => {
    if (isRouteWeatherBusy()) {
      runOrDeferBusySetting('waypoint-centering', () => waypointCenteringEl.dispatchEvent(new Event('change')));
      return;
    }
    waypointCentering = waypointCenteringEl.checked;
    localStorage.setItem(LS_WAYPOINT_CENTERING_KEY, waypointCentering ? '1' : '0');
  });

  const showWpIconEl = document.getElementById('show-waypoint-weather-icon');
  if (showWpIconEl) {
    showWpIconEl.checked = showWpIcon;
    showWpIconEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('show-wp-icon', () => showWpIconEl.dispatchEvent(new Event('change')));
        return;
      }
      showWpIcon = showWpIconEl.checked;
      localStorage.setItem(LS_SHOW_WP_ICON_KEY, showWpIcon ? '1' : '0');
      updateMapWeatherIconVisibility();
    });
  }

  const showImIconEl = document.getElementById('show-intermediate-weather-icon');
  if (showImIconEl) {
    showImIconEl.checked = showImIcon;
    showImIconEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('show-im-icon', () => showImIconEl.dispatchEvent(new Event('change')));
        return;
      }
      showImIcon = showImIconEl.checked;
      localStorage.setItem(LS_SHOW_IM_ICON_KEY, showImIcon ? '1' : '0');
      updateMapWeatherIconVisibility();
    });
  }

  const importAutoSortEl = document.getElementById('import-auto-sort-enable');
  if (importAutoSortEl) {
    importAutoSortEl.checked = importAutoSortMode;
    importAutoSortEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('import-auto-sort', () => importAutoSortEl.dispatchEvent(new Event('change')));
        return;
      }
      importAutoSortMode = importAutoSortEl.checked;
      localStorage.setItem(LS_IMPORT_AUTO_SORT_KEY, importAutoSortMode ? '1' : '0');
    });
  }

  const importAutoNameEl = document.getElementById('import-auto-name-enable');
  if (importAutoNameEl) {
    importAutoNameEl.checked = importAutoNameMode;
    importAutoNameEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('import-auto-name', () => importAutoNameEl.dispatchEvent(new Event('change')));
        return;
      }
      importAutoNameMode = importAutoNameEl.checked;
      localStorage.setItem(LS_IMPORT_AUTO_NAME_KEY, importAutoNameMode ? '1' : '0');
    });
  }

  btnMinimize?.addEventListener('click', () => {
    const targetCols = getCollectiveIndices();
    if (targetCols.length === 0) {
      showNotification('未選取任何操作目標 (標示點 / 中繼點)', 'warning');
      return;
    }
    targetCols.forEach(idx => closeWeatherCard(idx));
    showNotification(`已關閉 ${targetCols.length} 個天氣卡`, 'success', 1500);
  });

  btnToggleGrid?.addEventListener('click', () => {
    const targetCols = getCollectiveIndices();
    if (targetCols.length === 0) {
      showNotification('未選取任何操作目標', 'warning');
      return;
    }
    // Determine target mode (toggle based on first found or default)
    let firstOpenMode = null;
    for (const idx of targetCols) {
      if (_wcStates.has(idx)) {
        firstOpenMode = _wcStates.get(idx);
        break;
      }
    }
    const targetMode = firstOpenMode === 'full' ? 'compact' : 'full';
    setWeatherCardModeForTargets(targetCols, targetMode, targetCols[0] ?? -1);
    showNotification(`已切換 ${targetCols.length} 個天氣卡模式`, 'success', 1500);
  });

  syncCollectiveLock();
  updateMapWeatherIconVisibility();
}

/**
 * Get weather-column indices for collective operations.
 * If pivotIdx is provided, it handles "各自集體操作" logic when collectiveAll is false.
 */
function getCollectiveIndices(pivotIdx = -1) {
  if (pivotIdx === -1) {
    // Global call (e.g. from side panel buttons)
    const indices = [];
    weatherPoints.forEach((pt, i) => {
      // Skip points whose icon type is hidden
      if (!isPointIconVisible(i)) return;
      if (collectiveAll) {
        indices.push(i);
      } else {
        // Include both outbound and return-leg waypoints in "Marked Points" collective operation
        if (pt.isWaypoint && collectiveMarked) indices.push(i);
        if (!pt.isWaypoint && collectiveIntermediate) indices.push(i);
      }
    });
    return indices;
  }

  // Pivot-based call (from card/badge interaction)
  if (collectiveAll) {
    return weatherPoints.map((_, i) => i).filter(i => isPointIconVisible(i));
  }

  const pt = weatherPoints[pivotIdx];
  if (!pt) return [pivotIdx];

  const isMarked = pt.isWaypoint;
  const isIntermediate = !pt.isWaypoint;

  if (isMarked && collectiveMarked) {
    return weatherPoints.map((p, i) => (p.isWaypoint) ? i : -1).filter(idx => idx !== -1).filter(i => isPointIconVisible(i));
  }
  if (isIntermediate && collectiveIntermediate) {
    return weatherPoints.map((p, i) => (!p.isWaypoint) ? i : -1).filter(idx => idx !== -1).filter(i => isPointIconVisible(i));
  }

  return [pivotIdx];
}

// =========== Event Listeners ===========

// 在手機與平板預設收合側邊欄
if (window.innerWidth <= 1024) {
  sidePanel.classList.remove('open');
}

// Theme Toggle
const iconMoon = document.getElementById('icon-moon');
const iconSun = document.getElementById('icon-sun');

function updateMapWeatherIconVisibility() {
  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;
  mapContainer.classList.toggle('hide-wp-weather', !showWpIcon);
  mapContainer.classList.toggle('hide-im-weather', !showImIcon);
  // Close weather cards for points whose icon type is now hidden
  if (weatherPoints && weatherPoints.length > 0) {
    weatherPoints.forEach((pt, i) => {
      if (!isPointIconVisible(i) && _wcStates.has(i)) {
        closeWeatherCard(i);
      }
    });
  }
  updateElevationMarkers();
}

/**
 * Check if a weather point's icon is currently visible based on the
 * "Show Waypoint Weather Icons" / "Show Intermediate Weather Icons" toggles.
 */
function isPointIconVisible(colIdx) {
  const pt = weatherPoints[colIdx];
  if (!pt) return false;
  if (pt.isWaypoint) return showWpIcon;
  return showImIcon;
}

const PANEL_WIDTH_DEFAULT = 380;
const PANEL_WIDTH_MIN = 300;
const PANEL_WIDTH_MAX = 560;
const PANEL_WIDTH_STEP = 40;

function clampPanelWidth(width) {
  return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, width));
}

function getCurrentPanelWidth() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--panel-width');
  return parseInt(raw, 10) || PANEL_WIDTH_DEFAULT;
}

function applySidePanelWidth(width, persist = true) {
  const nextWidth = clampPanelWidth(width);
  document.documentElement.style.setProperty('--panel-width', `${nextWidth}px`);
  if (persist) {
    localStorage.setItem(LS_PANEL_WIDTH_KEY, String(nextWidth));
  }
  requestAnimationFrame(() => {
    mapManager?.map?.invalidateSize?.({ animate: false, pan: false });
    elevationProfile?.chart?.resize?.();
  });
}

function loadSidePanelWidth() {
  const savedWidth = parseInt(localStorage.getItem(LS_PANEL_WIDTH_KEY) || '', 10);
  if (Number.isFinite(savedWidth)) {
    applySidePanelWidth(savedWidth, false);
  }
}

loadSidePanelWidth();

function returnToRouteAfterPanelUpdate({ closePanel = false } = {}) {
  if (closePanel) {
    sidePanel?.classList.remove('open');
  }

  requestAnimationFrame(() => {
    mapManager?.map?.invalidateSize?.({ animate: false, pan: false });
    requestAnimationFrame(() => mapManager?.fitToRoute?.());
  });
}

const tvIconMoon = document.getElementById('tv-icon-moon');
const tvIconSun = document.getElementById('tv-icon-sun');

function updateThemeIcons() {
  const isLight = document.documentElement.classList.contains('light-theme');
  mapManager?.setTileTheme?.(isLight ? 'light' : 'dark');
  // Toolbar (homepage) + 3D viewer theme buttons share the same moon/sun pair.
  [[iconMoon, iconSun], [tvIconMoon, tvIconSun]].forEach(([moon, sun]) => {
    if (moon) moon.style.display = isLight ? 'none' : 'block';
    if (sun) sun.style.display = isLight ? 'block' : 'none';
  });

  // Update Logos
  const suffix = isLight ? '' : '_dark';
  document.querySelectorAll('.owl-logo-simple').forEach(img => {
    img.src = `./simple_owl_cursor${suffix}.svg`;
  });
  document.querySelectorAll('.owl-logo-mapping').forEach(img => {
    img.src = `./mapping_owl_cursor${suffix}.svg`;
  });
  document.querySelectorAll('.loading-icon img').forEach(img => {
    img.src = `./mapping_owl_cursor${suffix}.svg`;
  });

  // Update Favicon (Optional but nice)
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    favicon.href = `./favicon${suffix}.svg`;
  }
}
// Day/night UI style toggle, shared by the homepage toolbar and the 3D viewer
// toolbar so both stay in sync with the same `light-theme` class + persistence.
function toggleAppTheme() {
  const isLight = document.documentElement.classList.toggle('light-theme');
  localStorage.setItem(LS_THEME_KEY, isLight ? 'light' : 'dark');
  updateThemeIcons();
}
// 初始設定 Icon
updateThemeIcons();
btnToggleTheme?.addEventListener('click', toggleAppTheme);
// The 3D viewer's day/night toggle is wired further down, after its element refs.

btnTogglePanel.addEventListener('click', () => sidePanel.classList.toggle('open'));

// =========== 3D Terrain Viewer ===========
const btnFavoriteQuick = document.getElementById('btn-favorite-quick');
const btnView2d = document.getElementById('btn-view-2d');
const btnView3d = document.getElementById('btn-view-3d');
const tvView2d = document.getElementById('tv-view-2d');
const terrainViewerEl = document.getElementById('terrain-viewer');
const terrainCanvasWrap = document.getElementById('terrain-canvas-wrap');
const tvCloseBtn = document.getElementById('tv-close-btn');
const tvRedrawBtn = document.getElementById('tv-redraw-btn');
const tvExportBtn = document.getElementById('tv-export-btn');
const tvExportMenu = document.getElementById('tv-export-menu');
const tvExportStl = document.getElementById('tv-export-stl');
const tvExport3mf = document.getElementById('tv-export-3mf');
const tvLanguageSelect = document.getElementById('tv-language-select');
const tvToggleTheme = document.getElementById('tv-toggle-theme');
const tpPlay = document.getElementById('tp-play');
const tpFollow = document.getElementById('tp-follow');
const tpSlider = document.getElementById('tp-slider');
const tpProgressLabel = document.getElementById('tp-progress-label');
const tpTimeLabel = document.getElementById('tp-time-label');
const tpSpeedToggle = document.getElementById('tp-speed-toggle');
const tpSpeedValue = document.getElementById('tp-speed-value');
const tpSpeedMenu = document.getElementById('tp-speed-menu');
const tpSpeedOpts = document.querySelectorAll('.tp-speed-opt');
const tpPlaylistBtn = document.getElementById('tp-playlist-btn');
const tpPlaylistMenu = document.getElementById('tp-playlist-menu');
const tvInfoPanel = document.getElementById('tv-info-panel');
const tvInfoCollapse = document.getElementById('tv-info-collapse');
const tvRouteStats = document.getElementById('tv-route-stats');
const tvWpCount = document.getElementById('tv-wp-count');
const tvWpList = document.getElementById('tv-wp-list');
const tvToggleContour = document.getElementById('tv-toggle-contour');
const tvContourLabel = document.getElementById('tv-contour-label');
const tvToggleContourLabels = document.getElementById('tv-toggle-contour-labels');
const tvToggleWeather = document.getElementById('tv-toggle-weather');
const tvWeatherLabel = document.getElementById('tv-weather-label');
const tvToggleDaynight = document.getElementById('tv-toggle-daynight');
const tvToggleEffects = document.getElementById('tv-toggle-effects');
const tvToggleFeatures = document.getElementById('tv-toggle-features');
const tvToggleSatellite = document.getElementById('tv-toggle-satellite');
const tvToggleLabelSize = document.getElementById('tv-toggle-labelsize');
const tvLabelSizeLabel = document.getElementById('tv-labelsize-label');
const tvToggleView = document.getElementById('tv-toggle-view');
const tvViewLabel = document.getElementById('tv-view-label');
const tvToggleNormalize = document.getElementById('tv-toggle-normalize');
const tvToggleAbsolute = document.getElementById('tv-toggle-absolute');
const tvToggleTrail = document.getElementById('tv-toggle-trail');
const tvLiveHud = document.getElementById('tv-live-hud');
const tvHudCollapse = document.getElementById('tv-hud-collapse');
const tvMarkerDetail = document.getElementById('tv-marker-detail');
const tvMarkerDetailBody = document.getElementById('tv-marker-detail-body');
const tvMarkerDetailClose = document.getElementById('tv-marker-detail-close');
const tvHudClock = document.getElementById('tv-hud-clock');
const tvHudDate = document.getElementById('tv-hud-date');
const tvHudWxIcon = document.getElementById('tv-hud-wx-icon');
const tvHudWxTemp = document.getElementById('tv-hud-wx-temp');
const tvHudDist = document.getElementById('tv-hud-dist');
const tvHudElev = document.getElementById('tv-hud-elev');
const tvHudSpeed = document.getElementById('tv-hud-speed');
const tvHudGrade = document.getElementById('tv-hud-grade');
const tvHudFatigueRow = document.getElementById('tv-hud-fatigue-row');
const tvHudFatigueFill = document.getElementById('tv-hud-fatigue-fill');
const tvHudFatiguePct = document.getElementById('tv-hud-fatigue-pct');
const tvLoading = document.getElementById('tv-loading');
const tvLoadingTitle = document.getElementById('tv-loading-title');
const tvLoadingDetail = document.getElementById('tv-loading-detail');
const tvLoadingFill = document.getElementById('tv-loading-fill');
const tvLoadingPercent = document.getElementById('tv-loading-percent');
const tvLoadingAbort = document.getElementById('tv-loading-abort');
const tvWpCard = document.getElementById('tv-wp-card');
const tvWpCardBody = document.getElementById('tv-wp-card-body');
let tvWpCardLeaveTimer = null;
let tvWpCardHideTimer = null;

let terrainViewer = null;
// True while the toolbar "更新" rebuild is running. A redraw must never kick the
// user out of the viewer: if the rebuild fails or is aborted we keep the model
// that's already on screen instead of closing back to the planning page.
let terrainRefreshing = false;
// Content signature (route + departure + weather) of the model currently resident
// in the viewer. Re-opening the 3D page with an identical signature re-shows the
// cached scene instantly instead of re-running the build/progress bar; it only
// rebuilds when something actually changed or the user hits "更新" (redraw).
let terrainBuiltSignature = null;
// Set false by handleTerrainLoadState whenever a build aborts/errors, so a
// failed redraw doesn't get its (new) signature recorded against the stale scene.
let terrainLastLoadOk = true;

// --- 3D player playlist: hop between the current route and a saved favourite
// without leaving the viewer. Peeking at a favourite must not clobber an
// unsaved current route, so the live route (waypoints/settings/weather) is
// snapshotted before switching away and restored when switching back — or
// when the viewer closes while a favourite is showing. Each source's camera
// pose/progress/speed is remembered by cache key so hopping back resumes
// instead of re-flying the default view every time.
let terrainActiveRouteKey = null;    // 'current' | `fav:<id>` — source shown now
let terrainActiveCacheKey = null;    // grid-cache key actually built for it
let terrainCurrentRouteSnapshot = null;
const terrainViewStates = {};        // cacheKey -> { pos, target, progress, speed }

// Remember whether the 3D viewer was open (and for which route) so a browser/
// PWA reload — e.g. the OS discarding a backgrounded webview when the user
// switches apps and comes back — restores the 3D page instead of silently
// dropping to the 2D planning home. Only the route identity is stored; the
// scene itself is rebuilt from the (cached) elevation grid + 圖資 on restore.
const LS_TERRAIN_OPEN_KEY = 'mappingElf_terrain3dOpen';

function persistTerrainOpenState() {
  try {
    if (terrainActiveRouteKey && !terrainViewerEl.classList.contains('hidden')) {
      localStorage.setItem(LS_TERRAIN_OPEN_KEY, JSON.stringify({ routeKey: terrainActiveRouteKey }));
    } else {
      localStorage.removeItem(LS_TERRAIN_OPEN_KEY);
    }
  } catch (_) { /* noop */ }
}

function clearTerrainOpenState() {
  try { localStorage.removeItem(LS_TERRAIN_OPEN_KEY); } catch (_) { /* noop */ }
}

// --- 3D terrain cache -----------------------------------------------------
// The elevation-grid download is the slow part of building the 3D model, so the
// result (grid + bbox) is cached and reused. Cache keys are either `fav:<id>`
// (a saved favourite) or `route:<hash>` (the current / imported route). Reopening
// the same route then loads instantly. Favourite entries are pruned when their
// favourite is gone; route entries are capped to the most-recent few.
const LS_TERRAIN_CACHE_KEY = 'mappingElf_terrain3dCache';
const TERRAIN_ROUTE_CACHE_MAX = 8;

// The downloaded vector map features (圖資: roads/rivers/water/land cover/
// buildings) are cached separately via the Cache API instead of localStorage —
// a dense urban bbox easily produces a multi-MB payload that would blow past
// localStorage's ~5 MB quota (and used to be skipped outright past 1.5 MB), so
// reopening the 3D page would silently re-hit Overpass every time. The Cache
// API shares the browser's much larger storage-quota budget, so 圖資 now
// reliably survives a page reload/reopen.
const TERRAIN_FEATURES_CACHE_NAME = 'mapping-elf-terrain3d-features-v1';
const TERRAIN_FEATURES_URL_PREFIX = 'https://mapping-elf.local/terrain-features/';

// --- 3D viewer display settings (persisted across reloads) ----------------
// The top-right display toggles (等高線/高程/天氣/日夜/特效/圖資/字體) plus the new
// 海拔歸一化 toggle are remembered so reopening or reloading the 3D page keeps the
// user's chosen look instead of snapping back to defaults.
const LS_TERRAIN_DISPLAY_KEY = 'mappingElf_terrain3dDisplay';
const TERRAIN_WEATHER_STATES = ['on', 'noAnim', 'off'];
const TERRAIN_DISPLAY_DEFAULTS = Object.freeze({
  contour: 'high',        // high | low | none
  contourLabels: true,
  weather: 'on',          // on (hints+動畫) | noAnim (hints only) | off (all off)
  daynight: true,
  effects: true,          // 地標裝飾（峰頂／樹木／高塔／觀景點／紀念碑模型）
  features: true,
  labelSize: 'none',      // none | large | small
  elevNormalized: false,
  absElev: false,         // 絕對海拔懸空（軌跡懸空＋支柱）
  trailReveal: false,     // 軌跡時序揭示（依播放進度）
  followCam: true,        // Relive 式運鏡：播放時鏡頭跟拍人物
  satellite: false,       // 衛星影像疊加（Esri 空拍圖貼合地形表面）
});

function loadTerrainDisplaySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_TERRAIN_DISPLAY_KEY) || '{}');
    if (!saved || typeof saved !== 'object') return { ...TERRAIN_DISPLAY_DEFAULTS };
    const merged = { ...TERRAIN_DISPLAY_DEFAULTS, ...saved };
    // Migrate the pre-3-state boolean 天氣 toggle and the old 特效(weatherfx,
    // which used to also drive weather animation) flag.
    if (typeof saved.weather === 'boolean') merged.weather = saved.weather ? 'on' : 'off';
    if (!TERRAIN_WEATHER_STATES.includes(merged.weather)) merged.weather = 'on';
    if (saved.effects === undefined && typeof saved.weatherfx === 'boolean') merged.effects = saved.weatherfx;
    delete merged.weatherfx;
    return merged;
  } catch { return { ...TERRAIN_DISPLAY_DEFAULTS }; }
}

let terrainDisplaySettings = loadTerrainDisplaySettings();

function saveTerrainDisplaySettings() {
  try { localStorage.setItem(LS_TERRAIN_DISPLAY_KEY, JSON.stringify(terrainDisplaySettings)); } catch (_) { }
}

function loadTerrainCache() {
  try {
    const obj = JSON.parse(localStorage.getItem(LS_TERRAIN_CACHE_KEY) || '{}');
    return (obj && typeof obj === 'object') ? obj : {};
  } catch { return {}; }
}

function getTerrainCacheEntry(key) {
  if (!key) return null;
  const entry = loadTerrainCache()[key];
  if (entry && Array.isArray(entry.grid) && entry.bbox) return entry;
  return null;
}

// Cache-API-backed 圖資 store, keyed the same way as the grid cache above.
async function loadTerrainFeaturesEntry(key) {
  if (!key || !('caches' in window)) return null;
  try {
    const cache = await caches.open(TERRAIN_FEATURES_CACHE_NAME);
    const resp = await cache.match(TERRAIN_FEATURES_URL_PREFIX + encodeURIComponent(key));
    if (!resp) return null;
    return await resp.json();
  } catch { return null; }
}

// Persist the downloaded vector map features so reopening the same route/
// favourite doesn't re-hit Overpass. Only attached once a grid entry exists for
// the key (a features-only entry with no terrain to drape onto is useless).
async function saveTerrainFeaturesEntry(key, features) {
  if (!key || !features || !('caches' in window)) return;
  if (!loadTerrainCache()[key]) return;
  try {
    const cache = await caches.open(TERRAIN_FEATURES_CACHE_NAME);
    const body = JSON.stringify(features);
    await cache.put(TERRAIN_FEATURES_URL_PREFIX + encodeURIComponent(key), new Response(body, {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch { /* storage full / unsupported — 圖資 just re-downloads next time */ }
}

async function clearTerrainFeaturesEntry(key) {
  if (!key || !('caches' in window)) return;
  try {
    const cache = await caches.open(TERRAIN_FEATURES_CACHE_NAME);
    await cache.delete(TERRAIN_FEATURES_URL_PREFIX + encodeURIComponent(key));
  } catch { /* noop */ }
}

function pruneTerrainCache(cache) {
  const validFavKeys = new Set(favorites.map((f) => `fav:${f.id}`));
  Object.keys(cache).forEach((k) => {
    if (k.startsWith('fav:') && !validFavKeys.has(k)) { delete cache[k]; clearTerrainFeaturesEntry(k); }
  });
  const routeKeys = Object.keys(cache)
    .filter((k) => k.startsWith('route:'))
    .sort((a, b) => (cache[b].savedAt || 0) - (cache[a].savedAt || 0));
  routeKeys.slice(TERRAIN_ROUTE_CACHE_MAX).forEach((k) => { delete cache[k]; clearTerrainFeaturesEntry(k); });
}

function saveTerrainCacheEntry(key, grid, bbox) {
  if (!key || !Array.isArray(grid) || !bbox) return;
  const cache = loadTerrainCache();
  cache[key] = { grid, bbox, savedAt: Date.now() };
  pruneTerrainCache(cache);
  try { localStorage.setItem(LS_TERRAIN_CACHE_KEY, JSON.stringify(cache)); } catch (_) { }
}

function clearTerrainCacheEntry(key) {
  if (!key) return;
  const cache = loadTerrainCache();
  if (cache[key]) {
    delete cache[key];
    try { localStorage.setItem(LS_TERRAIN_CACHE_KEY, JSON.stringify(cache)); } catch (_) { }
  }
  clearTerrainFeaturesEntry(key);
}

// Stable cache key for the current/imported route, derived from its waypoints
// (or a downsample of the drawn track when there are none) plus the routing
// mode, so geometry changes invalidate the cache but reopening the same route
// hits it.
function terrainRouteSignature() {
  const wps = mapManager.waypoints;
  let basis;
  if (wps && wps.length >= 2) {
    basis = wps.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join('|');
  } else {
    const c = currentRouteCoords || [];
    const step = Math.max(1, Math.floor(c.length / 24));
    const pts = [];
    for (let i = 0; i < c.length; i += step) pts.push(`${c[i][0].toFixed(4)},${c[i][1].toFixed(4)}`);
    basis = pts.join('|');
  }
  basis += `#${routeEngine.mode}|${roundTripMode ? 'rt' : ''}${oLoopMode ? 'ol' : ''}`;
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return `route:${(h >>> 0).toString(36)}`;
}

// A signature of everything that changes what the built 3D model looks like:
// the cache key (route geometry + mode), the departure timestamp (drives the
// clock + day/night) and the weather points (markers + sky/FX). Two opens with
// the same signature can share the already-built scene.
function terrainContentSignature(cacheKey, routeData) {
  const coords = routeData.coords || [];
  const wx = routeData.weatherPoints || [];
  const first = coords.length ? `${coords[0][0].toFixed(4)},${coords[0][1].toFixed(4)}` : '';
  const last = coords.length ? `${coords[coords.length - 1][0].toFixed(4)},${coords[coords.length - 1][1].toFixed(4)}` : '';
  const wxSig = wx.map((w) => {
    const c = w.coords || [];
    return `${(c[0] ?? '').toString().slice(0, 8)}:${w.weatherCode ?? ''}:${w.temperature ?? ''}`;
  }).join(';');
  return [cacheKey || '', String(routeData.timing?.startMs ?? ''), `n${coords.length}`, first, last, wxSig].join('#');
}

// tv-busy locks the panels/toolbar (pointer-events) for the blocking part of a
// build. The 圖資 phase runs with blocking:false (see handleTerrainLoadState)
// so it never engages this lock — the model stays interactive throughout.
function setTerrainBusy(busy) {
  terrainViewerEl?.classList.toggle('tv-busy', busy);
}

// Single progress readout for the whole 3D build: elevation download + mesh/
// contour build (blocking, full-screen) continues seamlessly into the
// background 圖資 (map features) download (non-blocking, small pill) via the
// same bar instead of resetting into a second widget — driven by
// state.blocking from terrainViewer's unified onLoad channel.
function handleTerrainLoadState(state) {
  if (state.active) {
    const blocking = state.blocking !== false;
    setTerrainBusy(blocking);
    tvLoading?.classList.remove('hidden');
    tvLoading?.classList.toggle('tv-loading-bg', !blocking);
    const pct = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
    if (tvLoadingFill) tvLoadingFill.style.width = `${pct}%`;
    if (tvLoadingPercent) tvLoadingPercent.textContent = `${pct}%`;
    if (state.title && tvLoadingTitle) tvLoadingTitle.textContent = state.title;
    if (state.detail && tvLoadingDetail) tvLoadingDetail.textContent = state.detail;
    const bar = tvLoading?.querySelector('.loading-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
    return;
  }
  // Finished, aborted, or errored.
  setTerrainBusy(false);
  tvLoading?.classList.add('hidden');
  tvLoading?.classList.remove('tv-loading-bg');
  terrainLastLoadOk = !state.aborted && !state.error;
  if (state.aborted) {
    // A failed/aborted *refresh* keeps the existing model on screen; only the
    // initial open (nothing to fall back to) closes the viewer.
    if (!terrainRefreshing) closeTerrainViewer();
    showNotification('已終止 3D 地形建立', 'info');
  } else if (state.error) {
    if (!terrainRefreshing) closeTerrainViewer();
    showNotification('3D 地形載入失敗: ' + (state.error.message || ''), 'error');
  }
}

function tvEscapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderTerrainInfoPanel(routeData) {
  if (!tvRouteStats) return;
  const s = routeData.routeStats || {};
  const fmtDist = (m) => (m == null ? '—' : (m < 1000 ? `${Math.round(m)}<span class="tv-stat-unit">m</span>` : `${(m / 1000).toFixed(2)}<span class="tv-stat-unit">km</span>`));
  const fmtElev = (m) => (m == null ? '—' : `${Math.round(m)}<span class="tv-stat-unit">m</span>`);

  const stats = [
    { label: '距離', value: fmtDist(s.distance) },
    { label: '總爬升', value: fmtElev(s.ascent) },
    { label: '總下降', value: fmtElev(s.descent) },
    { label: '最高點', value: fmtElev(s.maxElev) },
    { label: '最低點', value: fmtElev(s.minElev) },
  ];
  tvRouteStats.innerHTML = stats.map(st =>
    `<div class="tv-stat-item"><span class="tv-stat-label">${st.label}</span><span class="tv-stat-value">${st.value}</span></div>`
  ).join('');

  const wps = routeData.waypoints || [];
  if (tvWpCount) tvWpCount.textContent = wps.length ? `(${wps.length})` : '';
  if (tvWpList) {
    tvWpList.innerHTML = wps.map((wp, i) => {
      const color = wp.color || (i === 0 ? '#00ff88' : (i === wps.length - 1 ? '#ff4466' : '#ffaa44'));
      const name = wp.label || `WP${i + 1}`;
      const elev = wp.elevation != null ? `${Math.round(wp.elevation)} m` : '';
      return `<li class="tv-wp-clickable" data-wp-index="${i}"><span class="tv-wp-dot" style="color:${color};background:${color}"></span><span class="tv-wp-name">${tvEscapeHtml(name)}</span><span class="tv-wp-elev">${elev}</span></li>`;
    }).join('');
    // Clicking a list row opens the same detail popup as the 3D billboard.
    tvWpList.querySelectorAll('.tv-wp-clickable').forEach((li) => {
      li.addEventListener('click', () => {
        const wp = wps[Number(li.dataset.wpIndex)];
        if (!wp) return;
        const [lat, lng] = wp.coords || [];
        renderTerrainMarkerDetail({
          type: 'waypoint',
          index: Number(li.dataset.wpIndex),
          label: wp.label,
          colorCss: wp.color || null,
          elevation: wp.elevation ?? null,
          lat, lng,
          distanceM: wp.distanceM ?? null,
          isStart: Number(li.dataset.wpIndex) === 0,
          isEnd: Number(li.dataset.wpIndex) === wps.length - 1,
        });
      });
    });
  }
}

function renderTerrainContourInfo(info) {
  if (!tvRouteStats || !info) return;
  // Show the contour interval as an extra stat; refresh it when the precision
  // (and therefore the interval) changes rather than appending duplicates.
  const valueHtml = `${Math.round(info.contourInterval)}<span class="tv-stat-unit">m</span>`;
  let item = tvRouteStats.querySelector('[data-contour]');
  if (!item) {
    item = document.createElement('div');
    item.className = 'tv-stat-item';
    item.setAttribute('data-contour', '');
    tvRouteStats.appendChild(item);
  }
  item.innerHTML = `<span class="tv-stat-label">等高線間距</span><span class="tv-stat-value">${valueHtml}</span>`;
}

// Departure timestamp for the 3D playback: prefer the weather table's first
// column (date + whole-hour), otherwise default to today at 08:00 local.
function getTerrainStartMs() {
  const container = document.getElementById('weather-table-container');
  const dateStr = container?.querySelector('.wt-th-date[data-idx="0"] .wt-date-input')?.value || '';
  if (dateStr) {
    const hourStr = container?.querySelector('.wt-th-time[data-idx="0"] .wt-time-select')?.value;
    const hour = parseInt(hourStr ?? '8');
    const ms = new Date(`${dateStr}T00:00:00`).getTime() + (Number.isFinite(hour) ? hour : 8) * 3600000;
    if (Number.isFinite(ms)) return ms;
  }
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

// Build the per-vertex timing track (distance/time/fatigue) the 3D viewer uses
// to drive the live readout and the day/night animation.
function buildTerrainTiming(routeCoords, routeElevs) {
  const distances = cumulativeDistances(routeCoords);
  let times = null;
  let fatigue = null;
  if (Array.isArray(routeElevs) && routeElevs.length === routeCoords.length) {
    try {
      times = computeCumulativeTimes(routeElevs, distances, speedActivity, paceParams);
      fatigue = computeFatigueSeries(routeElevs, distances, speedActivity, paceParams);
    } catch (err) {
      console.warn('terrain timing failed:', err);
    }
  }
  return { distances, times, fatigue, startMs: getTerrainStartMs() };
}

// Per-vertex route gradient colours for the 3D track, mirroring the 2D map /
// elevation chart: outbound spring-green→amber→orange-red→magenta→purple, and
// (for round-trips / O-loops) a purple→blue→aqua return leg split at the
// turnaround. Returns an array of [r,g,b] in 0..1 aligned to routeCoords.
function buildTerrainRouteColors(routeCoords) {
  const n = routeCoords?.length || 0;
  if (n === 0) return [];
  const dists = cumulativeDistances(routeCoords);
  const totalD = dists[n - 1] || 1;
  const tf = elevationProfile?.turnaroundFrac ?? null;
  const isRT = !!elevationProfile?.isRoundTrip;
  return routeCoords.map((_, i) => {
    const xFrac = totalD > 0 ? dists[i] / totalD : 0;
    let rgb;
    if (tf != null && xFrac > tf) {
      const denom = 1 - tf;
      const tRet = denom > 0 ? (xFrac - tf) / denom : 0;
      rgb = interpolateReturnColorRgb(Math.max(0, Math.min(1, tRet)));
    } else if (tf != null) {
      const tOut = tf > 0 ? xFrac / tf : 0;
      rgb = interpolateRouteColorRgb(Math.max(0, Math.min(1, tOut)));
    } else {
      const tColor = isRT ? 1 - Math.abs(2 * xFrac - 1) : xFrac;
      rgb = interpolateRouteColorRgb(tColor);
    }
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  });
}

function renderTerrainMetrics(m) {
  if (!m) return;
  const lang = getLanguage();

  if (tvHudClock && tvHudDate) {
    if (m.dateMs != null && Number.isFinite(m.dateMs)) {
      const d = new Date(m.dateMs);
      tvHudClock.textContent = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
      tvHudDate.textContent = d.toLocaleDateString(lang, { month: 'short', day: 'numeric', weekday: 'short' });
    } else {
      tvHudClock.textContent = '--:--';
      tvHudDate.textContent = '—';
    }
  }

  if (tvHudDist) {
    const km = (m.distM || 0) / 1000;
    const total = (m.totalDistM || 0) / 1000;
    tvHudDist.innerHTML = `${km.toFixed(km < 10 ? 2 : 1)}<span class="tv-hud-unit">/${total.toFixed(total < 10 ? 1 : 0)}km</span>`;
  }
  if (tvHudElev) {
    tvHudElev.innerHTML = m.elevM != null ? `${Math.round(m.elevM)}<span class="tv-hud-unit">m</span>` : '—';
  }
  if (tvHudSpeed) {
    tvHudSpeed.innerHTML = m.speedKmh != null && Number.isFinite(m.speedKmh)
      ? `${m.speedKmh.toFixed(1)}<span class="tv-hud-unit">km/h</span>` : '—';
  }
  if (tvHudGrade) {
    if (m.gradePct != null && Number.isFinite(m.gradePct)) {
      const g = m.gradePct;
      const sign = g > 0.5 ? '↗' : (g < -0.5 ? '↘' : '→');
      tvHudGrade.innerHTML = `${sign}${Math.abs(g).toFixed(1)}<span class="tv-hud-unit">%</span>`;
    } else {
      tvHudGrade.textContent = '—';
    }
  }

  if (tvHudFatigueRow) {
    const hasFatigue = m.fatiguePct != null && Number.isFinite(m.fatiguePct);
    tvHudFatigueRow.style.display = hasFatigue ? '' : 'none';
    if (hasFatigue) {
      const pct = Math.max(0, Math.min(100, m.fatiguePct));
      if (tvHudFatigueFill) tvHudFatigueFill.style.width = `${pct}%`;
      if (tvHudFatiguePct) tvHudFatiguePct.textContent = `${Math.round(pct)}%`;
    }
  }

  if (tvHudWxIcon && tvHudWxTemp) {
    if (m.weather) {
      tvHudWxIcon.textContent = m.weather.icon || '';
      tvHudWxTemp.textContent = m.weather.temperature != null ? `${Math.round(m.weather.temperature)}°C` : '';
    } else {
      tvHudWxIcon.textContent = '';
      tvHudWxTemp.textContent = '';
    }
  }

  // Elapsed time on the player bar.
  if (tpTimeLabel) {
    tpTimeLabel.textContent = m.timeH != null ? formatDurationHHMM(m.timeH) : '--';
  }
}

async function openTerrainViewer(cacheKey = null, opts = {}) {
  try {
    if (!currentRouteCoords || currentRouteCoords.length < 2) {
      showNotification('請先規劃路線', 'warning');
      return;
    }
    // Build/refresh for the current route when no explicit cache key is given.
    if (!cacheKey) cacheKey = terrainRouteSignature();
    terrainActiveCacheKey = cacheKey;

    // Planned routes come from the routing engine (allAlternatives); imported
    // tracks skip routing, so fall back to the drawn track + elevation profile.
    const route = allAlternatives[selectedAltIndex];
    let routeCoords, routeElevs, routeStats;
    if (route) {
      routeCoords = route.coords;
      routeElevs = route.fullElevations || route.elevations;
      routeStats = {
        distance: route.distance,
        ascent: route.ascent,
        descent: route.descent,
        maxElev: route.maxElev,
        minElev: route.minElev,
      };
    } else {
      routeCoords = currentRouteCoords;
      routeElevs = currentElevations;
      const epStats = typeof elevationProfile?._calcStats === 'function' ? elevationProfile._calcStats() : {};
      routeStats = {
        distance: elevationProfile?.distances?.at?.(-1) || 0,
        ascent: epStats.ascent,
        descent: epStats.descent,
        maxElev: epStats.maxElev,
        minElev: epStats.minElev,
      };
    }

    if (!routeCoords || routeCoords.length < 2) {
      showNotification('路線資料尚未就緒', 'warning');
      return;
    }

    const waypoints = mapManager.waypoints.map((wp, i) => {
      const name = getWaypointLabel(i, wp[0], wp[1]);
      let wpElev = 0;
      if (routeElevs && routeCoords) {
        let closest = 0;
        let minDist = Infinity;
        for (let j = 0; j < routeCoords.length; j++) {
          const d = (routeCoords[j][0] - wp[0]) ** 2 + (routeCoords[j][1] - wp[1]) ** 2;
          if (d < minDist) { minDist = d; closest = j; }
        }
        wpElev = routeElevs[closest] || 0;
      }
      // Reuse the 2D map's per-waypoint gradient colour so the pins match.
      return {
        coords: wp,
        label: name,
        elevation: wpElev,
        color: waypointGradColors[i] || null,
        distanceM: (Array.isArray(waypointCumDistM) ? waypointCumDistM[i] : null) ?? null,
      };
    });

    // Whether a point's weather icon shows in 3D follows the same 主航點/中繼點
    // checkboxes as the 2D map; the WMO code + temperature themselves live in the
    // weather cache (weatherPoints entries don't carry them directly), same as
    // what feeds the 2D marker badges.
    const weatherPointsData = (weatherPoints || [])
      .filter((wp) => (wp.isWaypoint ? showWpIcon : showImIcon))
      .map((wp) => {
        const cells = getSavedWeatherCells(wp);
        const code = cells?._weatherCode;
        const tempNum = cells?.temp != null ? parseFloat(cells.temp) : NaN;
        return {
          coords: wp.coords || [wp.lat, wp.lng],
          elevation: wp.elevation || 0,
          weatherCode: Number.isFinite(code) ? code : null,
          temperature: Number.isFinite(tempNum) ? tempNum : null,
          label: wp.label || null,
        };
      })
      .filter((pt) => pt.weatherCode != null);

    // Grid/bbox live in localStorage; 圖資 (map features) live in the Cache API
    // (see saveTerrainFeaturesEntry) since they can be much larger — merge them
    // back into one cachedTerrain object for loadRouteData.
    let cachedTerrain = opts.forceRebuild ? null : getTerrainCacheEntry(cacheKey);
    if (cachedTerrain) {
      const cachedFeatures = await loadTerrainFeaturesEntry(cacheKey);
      if (cachedFeatures) cachedTerrain = { ...cachedTerrain, features: cachedFeatures };
    }

    const routeData = {
      coords: routeCoords,
      elevations: routeElevs,
      waypoints,
      weatherPoints: weatherPointsData,
      routeStats,
      routeColors: buildTerrainRouteColors(routeCoords),
      // Echoed back on the onFeaturesComputed/onTerrainComputed callbacks so a
      // background 圖資 download that resolves after the user has since switched
      // to another route still persists under ITS OWN cache key, not whatever
      // route is current by the time it finishes.
      cacheKey,
      // A forced rebuild (the toolbar 更新) ignores the cached elevation grid +
      // 圖資 so the refresh genuinely re-downloads and re-runs the build from the
      // start instead of replaying the cached scene from ~90%.
      cachedTerrain,
      timing: buildTerrainTiming(routeCoords, routeElevs),
      preserveView: !!opts.preserveView,
      // Bake the persisted normalization preference into the first build so the
      // initial paint already uses the right vertical scale.
      elevNormalized: !!terrainDisplaySettings.elevNormalized,
    };

    // Re-entry shortcut: if the same route (with the same departure + weather) is
    // already built and resident in the viewer, just re-show it — no rebuild, no
    // progress bar. A redraw (preserveView) or an explicit forceRebuild always
    // rebuilds so "更新" still re-reads the latest date/weather.
    const sig = terrainContentSignature(cacheKey, routeData);
    if (!opts.preserveView && !opts.forceRebuild
      && terrainViewer && terrainViewer.hasBuiltScene?.()
      && sig === terrainBuiltSignature) {
      hideTerrainMarkerDetail();
      terrainViewerEl.classList.remove('hidden');
      terrainViewer.show();
      updateTerrainToggleAvailability();
      updateTerrainPlayerUI();
      persistTerrainOpenState();
      // Nothing to (re)build for the mesh/route/weather — but a previous visit's
      // background 圖資 (landmarks/roads/buildings) download may never have
      // finished draping (interrupted by switching away or closing before it
      // resolved), which would otherwise leave the scene silently missing map
      // data for the rest of the session. Retry it now (shows the same
      // non-blocking progress pill a normal build uses); only clear the overlay
      // outright when there's genuinely nothing left to do.
      if (!terrainViewer.retryMapFeaturesIfMissing?.(cacheKey)) {
        handleTerrainLoadState({ active: false, percent: 100 });
      }
      return;
    }

    if (!terrainViewer) {
      terrainViewer = new TerrainViewer(terrainCanvasWrap);
    }

    terrainViewer.onClose(() => closeTerrainViewer());
    terrainViewer.onProgressChange((p) => {
      tpSlider.value = p;
      tpProgressLabel.textContent = `${Math.round(p * 100)}%`;
    });
    // Sync the play/pause button when playback auto-stops at the end of the route.
    terrainViewer.onPlayStateChange(() => updateTerrainPlayerUI());
    terrainViewer.onInfo((info) => renderTerrainContourInfo(info));
    terrainViewer.onMetrics((m) => renderTerrainMetrics(m));
    terrainViewer.onLoad((state) => handleTerrainLoadState(state));
    terrainViewer.onMarkerClick((detail) => renderTerrainMarkerDetail(detail));
    // Relive-style: deal the TCG close-up card (personal/terrain/weather) while
    // the camera pauses on the waypoint.
    terrainViewer.onWaypointArrive((detail) => showWaypointCard(detail));
    // Satellite drape couldn't load (offline / no coverage): reset the toggle.
    terrainViewer.onSatelliteError(() => {
      terrainDisplaySettings.satellite = false;
      saveTerrainDisplaySettings();
      syncTerrainSatelliteButton();
      showNotification('無法載入衛星影像，已切回地形著色', 'warning');
    });
    // Persist a freshly downloaded grid against this route/favourite for reuse.
    terrainViewer.onTerrainComputed(({ grid, bbox }) => {
      if (cacheKey) saveTerrainCacheEntry(cacheKey, grid, bbox);
    });
    // Persist freshly downloaded map features against the same cache entry. Uses
    // the cacheKey echoed back on the payload (not the outer closure's cacheKey)
    // since this callback resolves asynchronously and the outer variable may by
    // then belong to a different route the user has since switched to.
    terrainViewer.onFeaturesComputed(({ features, cacheKey: featKey }) => {
      const key = featKey || cacheKey;
      if (key) saveTerrainFeaturesEntry(key, features);
    });
    // Map features download in the background now, so re-evaluate the layer toggles
    // (and re-apply the persisted 圖資 on/off) once they've draped onto the model.
    terrainViewer.onFeaturesReady(() => {
      applyTerrainDisplayToViewer();
      updateTerrainToggleAvailability();
    });

    renderTerrainInfoPanel(routeData);
    // Apply the persisted display settings to the toolbar buttons + the prefs the
    // build reads (contour interval, label size); visibility toggles that need the
    // built groups are applied after loadRouteData below.
    syncTerrainDisplayToggleUI();
    applyTerrainMobileDefaults();
    hideTerrainMarkerDetail();

    terrainViewerEl.classList.remove('hidden');
    terrainViewer.show();
    terrainLastLoadOk = true;
    await terrainViewer.loadRouteData(routeData);
    applyTerrainDisplayToViewer();
    updateTerrainToggleAvailability();
    updateTerrainPlayerUI();
    // Remember what we just built so an unchanged re-entry can skip the rebuild —
    // but only if the build actually finished (an aborted redraw keeps the old
    // scene, which no longer matches this signature).
    terrainBuiltSignature = (terrainLastLoadOk && terrainViewer.hasBuiltScene?.()) ? sig : null;
    // Only mark the 3D page as "open for restore" once a scene actually built;
    // an aborted/failed build falls through to closeTerrainViewer, which clears it.
    if (terrainLastLoadOk) persistTerrainOpenState();
  } catch (err) {
    console.error('3D viewer error:', err);
    setTerrainBusy(false);
    tvLoading?.classList.add('hidden');
    tvLoading?.classList.remove('tv-loading-bg');
    showNotification('3D 地形載入失敗: ' + (err.message || ''), 'error');
  }
}

function closeTerrainViewer() {
  if (terrainViewer) {
    if (terrainViewer.isLoading()) terrainViewer.abort();
    terrainViewer.pause();
    terrainViewer.hide();
  }
  setTerrainBusy(false);
  hideWaypointCard();
  tvLoading?.classList.add('hidden');
  tvLoading?.classList.remove('tv-loading-bg');
  terrainViewerEl.classList.add('hidden');
  closeTerrainExportMenu();
  closeTerrainPlaylistMenu();
  closeTerrainSpeedMenu();
  restoreTerrainCurrentRouteIfNeeded();
  clearTerrainOpenState();
  updateTerrainPlayerUI();
}

function updateTerrainPlayerUI() {
  const playing = terrainViewer?.isPlaying() ?? false;
  const playIcon = document.getElementById('tp-play-icon');
  const pauseIcon = document.getElementById('tp-pause-icon');
  if (playIcon) playIcon.style.display = playing ? 'none' : '';
  if (pauseIcon) pauseIcon.style.display = playing ? '' : 'none';
  tpPlay?.classList.toggle('active', playing);

  const progress = terrainViewer?.getProgress() ?? 0;
  if (tpSlider) tpSlider.value = progress;
  if (tpProgressLabel) tpProgressLabel.textContent = `${Math.round(progress * 100)}%`;

  syncTerrainSpeedUI(terrainViewer?.getSpeed() ?? 1);
}

// The route-planning 3D button builds the current/imported route's terrain.
// If that route is a saved favourite, reuse the favourite's cache key so its
// cached grid is shared; otherwise key the cache by the route signature.
function build3dForCurrentRoute() {
  if (!currentRouteCoords || currentRouteCoords.length < 2) {
    showNotification('請先規劃路線', 'warning');
    return;
  }
  // Don't build from track/weather data that's still being computed.
  if (hasRouteWeatherBusyTasks()) {
    showNotification('路線或天氣資料處理中，請待完成後再建立 3D 地形', 'warning');
    return;
  }
  const fav = findSavedCurrentRoute();
  terrainActiveRouteKey = 'current';
  terrainCurrentRouteSnapshot = null;
  return openTerrainViewer(fav ? `fav:${fav.id}` : terrainRouteSignature());
}

// Poll until the current/imported route has finished planning (or a timeout),
// so a resume-restore doesn't try to build 3D from a half-computed route.
function waitForCurrentRouteReady(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (currentRouteCoords.length >= 2 && !isProcessing && !hasRouteWeatherBusyTasks()) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) { resolve(false); return; }
      setTimeout(check, 250);
    };
    check();
  });
}

// Wait until the current route's weather has finished loading, so a 3D build
// triggered right after a route switch captures the weather points instead of
// an empty set (the auto-fetch is debounced, so we allow a short grace window
// for it to start, then wait for it to finish). Resolves true on success and
// false if the request was superseded.
function waitForWeatherSettled(requestId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let sawWeather = false;
    const check = () => {
      if (requestId != null && requestId !== favoriteExportRequestSeq) { resolve(false); return; }
      const busy = isWeatherFetching || hasRouteWeatherBusyTasks();
      sawWeather ||= busy;
      const elapsed = Date.now() - startedAt;
      // Done once weather ran and finished; or after a grace window with no
      // weather activity at all (nothing to fetch / everything cached); or timeout.
      if (!busy && (sawWeather || elapsed >= 1500)) { resolve(true); return; }
      if (elapsed >= timeoutMs) { resolve(true); return; }
      setTimeout(check, 200);
    };
    check();
  });
}

// On app start, if the 3D viewer was open before a reload/app-resume, reopen it
// for the same route so the user lands back on the 3D page instead of home.
// Returns true once settled successfully (or if there was nothing to restore),
// false if the restore was abandoned — the caller uses this to decide whether
// the initial loading screen can hand off to the 3D view directly or has to
// fall back to (and explain) landing on the 2D home instead.
async function restoreTerrain3DIfNeeded() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(LS_TERRAIN_OPEN_KEY) || 'null'); }
  catch { saved = null; }
  if (!saved || !saved.routeKey) return true;
  const routeKey = saved.routeKey;

  // Never let a failure here (e.g. loadFavorite throwing on malformed data)
  // propagate to the caller — the caller uses the return value to decide when
  // to release the boot loading screen, so a rejected promise would strand it
  // on screen forever instead of just falling back to the 2D home.
  try {
    if (routeKey.startsWith('fav:')) {
      const fav = favorites.find((f) => `fav:${f.id}` === routeKey);
      if (fav) { await open3dForFavorite(fav); return true; }
      clearTerrainOpenState();
      return false;
    }

    // Current / imported route: wait for the restored route to finish planning,
    // then reopen. If it never becomes ready, drop the marker so we don't retry.
    const ready = await waitForCurrentRouteReady();
    if (ready && currentRouteCoords.length >= 2) { await build3dForCurrentRoute(); return true; }
    clearTerrainOpenState();
    return false;
  } catch (err) {
    console.error('3D terrain restore failed:', err);
    clearTerrainOpenState();
    return false;
  }
}

// Synchronous, side-effect-free peek at whether a 3D-restore is pending, so the
// caller can decide (before running the actual restore) whether to hold the
// initial loading screen up rather than flashing the 2D home page first.
function hasPendingTerrain3DRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_TERRAIN_OPEN_KEY) || 'null');
    return !!(saved && saved.routeKey);
  } catch { return false; }
}

// Toolbar "更新" — redraw the open 3D model. A forced rebuild re-downloads a fresh
// elevation grid + 圖資 and re-runs the whole build (real progress from the start),
// so an edited track rebuilds from scratch and an unchanged one genuinely refreshes
// the latest elevation/天氣/圖資 instead of replaying the cached scene from ~90%.
// The camera pose and playback position are preserved so it still feels in-place.
async function refreshTerrainViewer() {
  if (!terrainViewer || terrainViewerEl.classList.contains('hidden')) return;
  if (terrainViewer.isLoading()) return;
  if (hasRouteWeatherBusyTasks()) {
    showNotification('路線或天氣資料處理中，請待完成後再重繪', 'warning');
    return;
  }
  const fav = findSavedCurrentRoute();
  const liveKey = fav ? `fav:${fav.id}` : terrainRouteSignature();
  tvRedrawBtn?.classList.add('tv-redraw-spin');
  terrainRefreshing = true;
  try {
    await openTerrainViewer(liveKey, { preserveView: true, forceRebuild: true });
  } finally {
    terrainRefreshing = false;
    tvRedrawBtn?.classList.remove('tv-redraw-spin');
  }
}

btnFavoriteQuick?.addEventListener('click', handleAddFavorite);
// Segmented 2D/3D switch: the toolbar's 3D side builds the current route's
// terrain; the mirrored control inside the viewer flips back to the 2D map.
btnView3d?.addEventListener('click', build3dForCurrentRoute);
btnView2d?.addEventListener('click', () => {
  if (!terrainViewerEl?.classList.contains('hidden')) closeTerrainViewer();
});
tvView2d?.addEventListener('click', closeTerrainViewer);
tvCloseBtn?.addEventListener('click', closeTerrainViewer);
tvRedrawBtn?.addEventListener('click', refreshTerrainViewer);

// ---- 3D player playlist ---------------------------------------------------
function closeTerrainPlaylistMenu() {
  if (!tpPlaylistMenu) return;
  tpPlaylistMenu.classList.add('hidden');
  tpPlaylistBtn?.setAttribute('aria-expanded', 'false');
}

function renderTerrainPlaylistMenu() {
  if (!tpPlaylistMenu) return;
  const parts = [`<div class="tp-playlist-title">切換 3D 路線</div>`];
  parts.push(
    `<button type="button" class="tp-playlist-opt${terrainActiveRouteKey === 'current' ? ' active' : ''}" data-playlist-current role="menuitem">目前路線</button>`
  );
  if (favorites.length) {
    parts.push('<div class="tp-playlist-sep"></div>');
    favorites.forEach((f) => {
      const active = terrainActiveRouteKey === `fav:${f.id}`;
      parts.push(
        `<button type="button" class="tp-playlist-opt${active ? ' active' : ''}" data-playlist-fav="${_escapeHtml(f.id)}" role="menuitem">${_escapeHtml(f.name)}</button>`
      );
    });
  } else {
    parts.push('<div class="tp-playlist-empty">尚未加入最愛路線</div>');
  }
  tpPlaylistMenu.innerHTML = parts.join('');
  tpPlaylistMenu.querySelectorAll('[data-playlist-current]').forEach((btn) => {
    btn.addEventListener('click', () => switchTerrainPlaylistSource({ type: 'current' }));
  });
  tpPlaylistMenu.querySelectorAll('[data-playlist-fav]').forEach((btn) => {
    btn.addEventListener('click', () => switchTerrainPlaylistSource({ type: 'fav', id: btn.dataset.playlistFav }));
  });
}

function captureTerrainViewState() {
  if (!terrainViewer || !terrainActiveCacheKey) return;
  const vs = terrainViewer.getViewState?.();
  if (vs) terrainViewStates[terrainActiveCacheKey] = vs;
}

// Snapshot the live "current route" so a peek at a favourite (via the player
// playlist) can be undone later. An imported track has no routing to replay
// it from — captureFavorite()/loadFavorite() only round-trip mapManager's
// sparse waypoints, which would re-route between them and silently replace
// the original recorded track with a routed approximation. So imported
// tracks get their own lossless snapshot (mirrors saveImportedTrackSession)
// restored via restoreImportedTrack(), which redraws the exact same coords/
// elevations with no network routing call; a normal routed route still uses
// the favourite round-trip since re-routing the same waypoints reproduces it.
function captureCurrentRouteSnapshot() {
  if (importedTrackMode) {
    return {
      kind: 'track',
      coords: currentRouteCoords,
      elevations: currentElevations,
      waypoints: mapManager.waypoints,
      waypointMeta: mapManager.waypoints.map((_, i) => ({
        ...(importedWaypointMeta[i] || {}),
        ...(mapManager.getWaypointMetadata(i) || {}),
      })),
      intermediates: importedIntermediatePoints,
    };
  }
  return { kind: 'favorite', fav: captureFavorite('目前路線') };
}

function currentRouteMatchesSnapshot(snap) {
  if (!snap) return true;
  if (snap.kind === 'track') return importedTrackMode && waypointsMatch(snap.waypoints, mapManager.waypoints);
  return !importedTrackMode && waypointsMatch(snap.fav.waypoints, mapManager.waypoints);
}

async function restoreCurrentRouteSnapshot(snap, requestId) {
  if (!snap) return true;
  if (snap.kind === 'track') {
    // restoreImportedTrack() is normally only called once at app startup, when
    // allAlternatives is naturally still empty. Mid-session it can still hold
    // the favourite's routed alternative from the peek we're undoing, and
    // openTerrainViewer() prefers allAlternatives[selectedAltIndex] over
    // currentRouteCoords — so without this reset the 3D view would keep
    // showing the favourite's route even after the track is restored.
    allAlternatives = [];
    selectedAltIndex = 0;
    const ok = await restoreImportedTrack(snap);
    if (ok) autoFetchWeather({ force: false });
    return ok;
  }
  loadFavorite(snap.fav);
  return waitForFavoriteRouteReady(snap.fav, requestId);
}

// If the viewer closes (or the app navigates away) while a favourite is being
// previewed, put the live app state back to whatever "current route" looked
// like before the peek — otherwise leaving the 3D page would silently leave
// the favourite's waypoints loaded as the current route.
function restoreTerrainCurrentRouteIfNeeded() {
  if (terrainActiveRouteKey && terrainActiveRouteKey !== 'current' && terrainCurrentRouteSnapshot) {
    const snap = terrainCurrentRouteSnapshot;
    if (!currentRouteMatchesSnapshot(snap)) restoreCurrentRouteSnapshot(snap, ++favoriteExportRequestSeq);
  }
  terrainActiveRouteKey = null;
  terrainActiveCacheKey = null;
  terrainCurrentRouteSnapshot = null;
}

// Switch the open 3D viewer between the current route and a saved favourite.
// The route being left is snapshotted first (the current route has no other
// persistence, so a peek at a favourite would otherwise lose it) and each
// source's camera/progress/speed is restored from terrainViewStates so
// hopping back resumes instead of re-flying the default view.
async function switchTerrainPlaylistSource(entry) {
  if (!terrainViewer || terrainViewerEl.classList.contains('hidden')) return;
  const wantKey = entry.type === 'fav' ? `fav:${entry.id}` : 'current';
  if (wantKey === terrainActiveRouteKey) { closeTerrainPlaylistMenu(); return; }
  if (terrainViewer.isLoading() || hasRouteWeatherBusyTasks()) {
    showNotification('路線或天氣資料處理中，請待完成後再切換', 'warning');
    return;
  }

  closeTerrainPlaylistMenu();
  captureTerrainViewState();
  if (terrainActiveRouteKey === 'current') {
    terrainCurrentRouteSnapshot = captureCurrentRouteSnapshot();
  }

  const requestId = ++favoriteExportRequestSeq;

  // Show the same progress overlay a normal 3D build uses for the whole switch —
  // route planning + weather load happen behind the still-visible old scene, so
  // without this the viewer would sit frozen for seconds before the terrain bar
  // finally appears. The terrain build below continues on the same bar. Only used
  // when we actually have to re-plan/re-fetch; an already-loaded route skips it.
  let showedSwitchProgress = false;
  const beginSwitchProgress = (detail) => {
    showedSwitchProgress = true;
    handleTerrainLoadState({ active: true, percent: 2, blocking: true, title: '切換 3D 路線', detail });
  };
  const failSwitch = (msg) => {
    if (showedSwitchProgress) handleTerrainLoadState({ active: false, percent: 0 });
    showNotification(msg, 'warning');
  };

  try {
    if (entry.type === 'fav') {
      const fav = favorites.find((f) => f.id === entry.id);
      if (!fav) { failSwitch('最愛路線不存在'); return; }
      // Re-plan + wait for the route AND its weather only when the favourite isn't
      // already the live route — this both keeps switching fast when nothing needs
      // reloading and guarantees the 3D build sees the full weather/圖資 data set.
      if (!waypointsMatch(fav.waypoints, mapManager.waypoints) || currentRouteCoords.length < 2) {
        beginSwitchProgress('規劃路線中…');
        loadFavorite(fav);
        const ready = await waitForFavoriteRouteReady(fav, requestId);
        if (requestId !== favoriteExportRequestSeq) return;
        if (!ready) { failSwitch('找不到合適路徑'); return; }
        handleTerrainLoadState({ active: true, percent: 4, blocking: true, title: '切換 3D 路線', detail: '載入天氣資訊…' });
        await waitForWeatherSettled(requestId);
        if (requestId !== favoriteExportRequestSeq) return;
      }
      terrainActiveRouteKey = `fav:${fav.id}`;
      await openTerrainViewer(`fav:${fav.id}`);
    } else {
      const snap = terrainCurrentRouteSnapshot;
      if (!currentRouteMatchesSnapshot(snap)) {
        beginSwitchProgress('規劃路線中…');
        const ready = await restoreCurrentRouteSnapshot(snap, requestId);
        if (requestId !== favoriteExportRequestSeq) return;
        if (!ready) { failSwitch('找不到合適路徑'); return; }
        handleTerrainLoadState({ active: true, percent: 4, blocking: true, title: '切換 3D 路線', detail: '載入天氣資訊…' });
        await waitForWeatherSettled(requestId);
        if (requestId !== favoriteExportRequestSeq) return;
      }
      terrainActiveRouteKey = 'current';
      const fav = findSavedCurrentRoute();
      await openTerrainViewer(fav ? `fav:${fav.id}` : terrainRouteSignature());
    }
  } catch (err) {
    if (showedSwitchProgress) handleTerrainLoadState({ active: false, percent: 0 });
    throw err;
  }

  if (terrainActiveCacheKey) {
    const vs = terrainViewStates[terrainActiveCacheKey];
    if (vs) terrainViewer.applyViewState?.(vs);
  }
  updateTerrainPlayerUI();
  renderTerrainPlaylistMenu();
}

tpPlaylistBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!tpPlaylistMenu) return;
  if (tpPlaylistMenu.classList.contains('hidden')) renderTerrainPlaylistMenu();
  const open = tpPlaylistMenu.classList.toggle('hidden');
  tpPlaylistBtn.setAttribute('aria-expanded', String(!open));
});
document.addEventListener('click', (e) => {
  if (!tpPlaylistMenu || tpPlaylistMenu.classList.contains('hidden')) return;
  if (e.target.closest('#tp-playlist-wrap')) return;
  closeTerrainPlaylistMenu();
});

// ---- 3D-print export (STL / 3MF) — Plan §IV ----
function closeTerrainExportMenu() {
  if (!tvExportMenu) return;
  tvExportMenu.classList.add('hidden');
  tvExportBtn?.setAttribute('aria-expanded', 'false');
}

let terrainExportBusy = false;
async function exportTerrainModel(format) {
  closeTerrainExportMenu();
  if (terrainExportBusy) return;
  if (!terrainViewer || !terrainViewer.hasExportableModel?.()) {
    showNotification('尚無可匯出的 3D 模型', 'warning');
    return;
  }
  const source = terrainViewer.getExportSource({ sizeMm: 150 });
  if (!source) { showNotification('無法建立匯出資料', 'error'); return; }
  const base = (buildDefaultRouteName?.() || 'mapping-elf-terrain')
    .replace(/[^\w一-龥-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'mapping-elf-terrain';
  terrainExportBusy = true;
  tvExportBtn?.classList.add('tv-redraw-spin');
  try {
    showNotification(`正在產生 ${format.toUpperCase()} 列印模型…`, 'info');
    const { TerrainExporter } = await import('./modules/terrainExporter.js');
    const payload = await TerrainExporter.export(source, format, base);
    await TerrainExporter.download(payload);
    showNotification(`已匯出 ${payload.filename}`, 'success');
  } catch (err) {
    console.error('3D export failed:', err);
    showNotification(`匯出失敗：${err?.message || err}`, 'error');
  } finally {
    terrainExportBusy = false;
    tvExportBtn?.classList.remove('tv-redraw-spin');
  }
}

tvExportBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (tvExportBtn.disabled || !tvExportMenu) return;
  const open = tvExportMenu.classList.toggle('hidden');
  tvExportBtn.setAttribute('aria-expanded', String(!open));
});
tvExportStl?.addEventListener('click', () => exportTerrainModel('stl'));
tvExport3mf?.addEventListener('click', () => exportTerrainModel('3mf'));
// Dismiss the menu on any outside click.
document.addEventListener('click', (e) => {
  if (!tvExportMenu || tvExportMenu.classList.contains('hidden')) return;
  if (e.target.closest('.tv-export-wrap')) return;
  closeTerrainExportMenu();
});

// 3D viewer language switcher — a sibling of the homepage one, kept in sync via
// refreshLanguageSensitiveUi (the i18n onLanguageChange hook).
function initTvLanguageSelect() {
  if (!tvLanguageSelect || tvLanguageSelect.dataset.ready) return;
  LANGUAGES.forEach(({ code, label }) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    tvLanguageSelect.appendChild(opt);
  });
  tvLanguageSelect.value = getLanguage();
  tvLanguageSelect.addEventListener('change', () => setLanguage(tvLanguageSelect.value));
  tvLanguageSelect.dataset.ready = '1';
}
function syncTvLanguageSelect() {
  if (tvLanguageSelect) tvLanguageSelect.value = getLanguage();
}
initTvLanguageSelect();
// 3D viewer day/night UI style toggle (shares the homepage light-theme state).
tvToggleTheme?.addEventListener('click', toggleAppTheme);

// Enable the 3D button only when a route exists AND no route/weather processing
// is in flight — building the model mid-calculation would snapshot half-ready
// track/weather data, so the button stays locked until everything settles.
function update3dButtonBadge() {
  const hasRoute = currentRouteCoords && currentRouteCoords.length >= 2;
  const busy = hasRouteWeatherBusyTasks();
  const disabled = !hasRoute || busy;
  if (btnView3d) {
    btnView3d.disabled = disabled;
    // Disabled state explains itself instead of looking broken.
    btnView3d.title = disabled ? '規劃路線後即可切換 3D' : '建立 3D 地形';
  }
}

// Hook into route update flow
const _origSetCurrentRouteData = setCurrentRouteData;
setCurrentRouteData = function (coords, elevations) {
  _origSetCurrentRouteData(coords, elevations);
  update3dButtonBadge();
};
update3dButtonBadge();

// --- Route summary chips (Hikingbook-style always-visible key numbers) ------
// Mirrors the side-panel stat values into the floating strip above the bottom
// panel by observing the existing nodes, so every stats write site (route
// update, clear, import, pace change) stays untouched.
(function initRouteSummaryBar() {
  const bar = document.getElementById('route-summary-bar');
  if (!bar) return;
  const pairs = [
    [statDistance, document.getElementById('rsb-distance'), null],
    [document.getElementById('stat-time'), document.getElementById('rsb-time'), document.getElementById('rsb-time-chip')],
    [statAscent, document.getElementById('rsb-ascent'), null],
    [document.getElementById('stat-descent'), document.getElementById('rsb-descent'), null],
  ];
  const sync = () => {
    for (const [src, dst, chip] of pairs) {
      if (!src || !dst) continue;
      const v = (src.textContent || '—').trim();
      if (dst.textContent !== v) dst.textContent = v;
      // 預估時間 only exists in speed mode; hide its chip instead of showing "—".
      if (chip) chip.classList.toggle('hidden', v === '—');
    }
  };
  const obs = new MutationObserver(sync);
  for (const [src] of pairs) {
    if (src) obs.observe(src, { childList: true, characterData: true, subtree: true });
  }
  sync();
})();

// Player controls
tpPlay?.addEventListener('click', () => {
  if (!terrainViewer) return;
  if (terrainViewer.isPlaying()) {
    terrainViewer.pause();
  } else {
    terrainViewer.play();
  }
  updateTerrainPlayerUI();
});

tpSlider?.addEventListener('input', () => {
  if (!terrainViewer) return;
  const val = parseFloat(tpSlider.value);
  terrainViewer.setProgress(val);
  tpProgressLabel.textContent = `${Math.round(val * 100)}%`;
});

// Speed control: a single toggle button that (a) expands a menu of preset
// rates on click, (b) cycles through those same rates on mouse-wheel while
// hovered, and (c) cycles them on a vertical touch-drag — three ways to reach
// the same TERRAIN_SPEED_STEPS list, so a phone with no hover/wheel still has
// the drag gesture and a mouse user can skip opening the menu entirely.
const TERRAIN_SPEED_STEPS = [0.25, 0.5, 1, 2, 4];
let terrainSpeed = 1;
let tpSpeedTouchStartY = null;
let tpSpeedTouchStartIdx = 0;
let tpSpeedDragged = false;

function syncTerrainSpeedUI(speed) {
  terrainSpeed = speed;
  if (tpSpeedValue) tpSpeedValue.textContent = `${speed}x`;
  tpSpeedOpts.forEach((b) => b.classList.toggle('active', parseFloat(b.dataset.speed) === speed));
}

function setTerrainSpeed(speed) {
  syncTerrainSpeedUI(speed);
  if (terrainViewer) terrainViewer.setSpeed(speed);
}

function closeTerrainSpeedMenu() {
  if (!tpSpeedMenu) return;
  tpSpeedMenu.classList.add('hidden');
  tpSpeedToggle?.setAttribute('aria-expanded', 'false');
}

tpSpeedToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  // A tap that ended a touch-drag fires a synthetic click too; swallow just
  // that one so dragging to a speed doesn't also toggle the menu open.
  if (tpSpeedDragged) { tpSpeedDragged = false; return; }
  if (!tpSpeedMenu) return;
  const open = tpSpeedMenu.classList.toggle('hidden');
  tpSpeedToggle.setAttribute('aria-expanded', String(!open));
});

tpSpeedOpts.forEach((btn) => {
  btn.addEventListener('click', () => {
    setTerrainSpeed(parseFloat(btn.dataset.speed));
    closeTerrainSpeedMenu();
  });
});

document.addEventListener('click', (e) => {
  if (!tpSpeedMenu || tpSpeedMenu.classList.contains('hidden')) return;
  if (e.target.closest('#tp-speed-wrap')) return;
  closeTerrainSpeedMenu();
});

// Mouse-hover + wheel: scrolling up steps to a faster preset, down to slower.
// The listener only ever fires while the cursor is actually over the button,
// so no separate hover state needs tracking.
tpSpeedToggle?.addEventListener('wheel', (e) => {
  e.preventDefault();
  const idx = TERRAIN_SPEED_STEPS.indexOf(terrainSpeed);
  const base = idx === -1 ? TERRAIN_SPEED_STEPS.indexOf(1) : idx;
  const dir = e.deltaY < 0 ? 1 : -1;
  const next = TERRAIN_SPEED_STEPS[Math.max(0, Math.min(TERRAIN_SPEED_STEPS.length - 1, base + dir))];
  setTerrainSpeed(next);
}, { passive: false });

// Touch drag up/down: drag up to step faster, down to step slower — one
// preset per ~28px of vertical travel. Suppresses the trailing synthetic
// click a tap-through-drag would otherwise fire (which would toggle the menu).
tpSpeedToggle?.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  tpSpeedTouchStartY = e.touches[0].clientY;
  const idx = TERRAIN_SPEED_STEPS.indexOf(terrainSpeed);
  tpSpeedTouchStartIdx = idx === -1 ? TERRAIN_SPEED_STEPS.indexOf(1) : idx;
  tpSpeedDragged = false;
}, { passive: true });
tpSpeedToggle?.addEventListener('touchmove', (e) => {
  if (tpSpeedTouchStartY == null || e.touches.length !== 1) return;
  const dy = tpSpeedTouchStartY - e.touches[0].clientY;
  const stepsMoved = Math.round(dy / 28);
  if (stepsMoved !== 0) tpSpeedDragged = true;
  const nextIdx = Math.max(0, Math.min(TERRAIN_SPEED_STEPS.length - 1, tpSpeedTouchStartIdx + stepsMoved));
  const next = TERRAIN_SPEED_STEPS[nextIdx];
  if (next !== terrainSpeed) setTerrainSpeed(next);
}, { passive: true });
tpSpeedToggle?.addEventListener('touchend', () => { tpSpeedTouchStartY = null; });

// Layer toggles (contours / elevation labels / weather / day-night / weather FX)
// Contour precision cycles: high → low → none.
const TERRAIN_CONTOUR_STATES = ['high', 'low', 'none'];
const TERRAIN_CONTOUR_LABELS = { high: '等高線·高', low: '等高線·低', none: '等高線·無' };
let terrainContourState = 'high';

function applyTerrainContourState(state) {
  terrainContourState = TERRAIN_CONTOUR_STATES.includes(state) ? state : 'high';
  if (tvContourLabel) tvContourLabel.textContent = TERRAIN_CONTOUR_LABELS[terrainContourState];
  if (tvToggleContour) {
    tvToggleContour.dataset.contourState = terrainContourState;
    tvToggleContour.classList.toggle('active', terrainContourState !== 'none');
    tvToggleContour.classList.toggle('tv-contour-off', terrainContourState === 'none');
  }
  // Elevation-label button is only meaningful when contours are shown.
  if (tvToggleContourLabels) tvToggleContourLabels.disabled = terrainContourState === 'none';
  terrainViewer?.setContourPrecision(terrainContourState);
  updateTerrainToggleAvailability();
  terrainDisplaySettings.contour = terrainContourState;
  saveTerrainDisplaySettings();
}

// 天氣 button cycles 3 states: on (hints + 動畫) → noAnim (hints only) → off (all
// off) → on. Replaces the old pair of independent 天氣/特效 booleans — 特效 no
// longer touches weather at all (see applyTerrainEffectsState below).
const TERRAIN_WEATHER_LABELS = { on: '天氣·開', noAnim: '天氣·靜態', off: '天氣·關' };
let terrainWeatherState = 'on';

function applyTerrainWeatherState(state) {
  terrainWeatherState = TERRAIN_WEATHER_STATES.includes(state) ? state : 'on';
  const hintsVisible = terrainWeatherState !== 'off';
  const animEnabled = terrainWeatherState === 'on';
  if (tvWeatherLabel) tvWeatherLabel.textContent = TERRAIN_WEATHER_LABELS[terrainWeatherState];
  if (tvToggleWeather) {
    tvToggleWeather.dataset.weatherState = terrainWeatherState;
    tvToggleWeather.classList.toggle('active', hintsVisible);
    tvToggleWeather.classList.toggle('tv-weather-off', !hintsVisible);
  }
  terrainViewer?.setWeatherVisible(hintsVisible);
  terrainViewer?.setWeatherAnimEnabled(animEnabled);
  terrainDisplaySettings.weather = terrainWeatherState;
  saveTerrainDisplaySettings();
}

// Grey out layer toggles that can't do anything for the current route (no
// weather points, clear-sky only, or no major-contour elevation labels) so a
// no-op toggle doesn't look broken. Day/night always has an effect, so it stays.
function updateTerrainToggleAvailability() {
  if (!terrainViewer) return;

  const hasWeather = terrainViewer.hasWeatherData?.() ?? false;
  if (tvToggleWeather) {
    tvToggleWeather.disabled = !hasWeather;
    tvToggleWeather.title = hasWeather ? '天氣（循環：開啟→關閉動畫→關閉提示）' : '此路線沒有天氣標記';
  }

  // 特效 purely declutters the point-landmark models (peaks/trees/towers/
  // viewpoints/monuments) — independent of weather — so it's only usable when
  // this route actually has landmarks.
  const hasLandmarks = terrainViewer.hasLandmarks?.() ?? false;
  if (tvToggleEffects) {
    tvToggleEffects.disabled = !hasLandmarks;
    tvToggleEffects.title = hasLandmarks
      ? '地標裝飾（峰頂／樹木／高塔／觀景點／紀念碑模型）'
      : '此區域沒有地標可顯示';
  }

  const hasLabels = terrainViewer.hasContourLabels?.() ?? false;
  if (tvToggleContourLabels) {
    tvToggleContourLabels.disabled = terrainContourState === 'none' || !hasLabels;
  }

  const hasFeatures = terrainViewer.hasMapFeatures?.() ?? false;
  if (tvToggleFeatures) {
    tvToggleFeatures.disabled = !hasFeatures;
    tvToggleFeatures.title = hasFeatures
      ? '地圖圖資（道路／河流／水體／綠地／荒地／建築）'
      : '此區域沒有可顯示的地圖圖資';
  }

  // 3D-print export is available once a terrain solid exists.
  const canExport = terrainViewer.hasExportableModel?.() ?? false;
  if (tvExportBtn) tvExportBtn.disabled = !canExport;
}

// Apply the persisted display settings to the toolbar buttons + the build-time
// prefs the model reads while building (contour interval, on-terrain label size).
// Visibility toggles that need the built scene groups are applied separately by
// applyTerrainDisplayToViewer() after loadRouteData.
function syncTerrainDisplayToggleUI() {
  const s = terrainDisplaySettings;
  terrainContourState = TERRAIN_CONTOUR_STATES.includes(s.contour) ? s.contour : 'high';
  if (tvContourLabel) tvContourLabel.textContent = TERRAIN_CONTOUR_LABELS[terrainContourState];
  if (tvToggleContour) {
    tvToggleContour.dataset.contourState = terrainContourState;
    tvToggleContour.classList.toggle('active', terrainContourState !== 'none');
    tvToggleContour.classList.toggle('tv-contour-off', terrainContourState === 'none');
  }
  tvToggleContourLabels?.classList.toggle('active', !!s.contourLabels);
  if (tvToggleContourLabels) tvToggleContourLabels.disabled = terrainContourState === 'none';
  terrainWeatherState = TERRAIN_WEATHER_STATES.includes(s.weather) ? s.weather : 'on';
  if (tvWeatherLabel) tvWeatherLabel.textContent = TERRAIN_WEATHER_LABELS[terrainWeatherState];
  if (tvToggleWeather) {
    tvToggleWeather.dataset.weatherState = terrainWeatherState;
    tvToggleWeather.classList.toggle('active', terrainWeatherState !== 'off');
    tvToggleWeather.classList.toggle('tv-weather-off', terrainWeatherState === 'off');
  }
  tvToggleDaynight?.classList.toggle('active', !!s.daynight);
  tvToggleEffects?.classList.toggle('active', !!s.effects);
  tvToggleFeatures?.classList.toggle('active', !!s.features);
  tvToggleAbsolute?.classList.toggle('active', !!s.absElev);
  tvToggleTrail?.classList.toggle('active', !!s.trailReveal);
  tpFollow?.classList.toggle('active', !!s.followCam);

  terrainLabelState = TERRAIN_LABEL_STATES.includes(s.labelSize) ? s.labelSize : 'none';
  if (tvLabelSizeLabel) tvLabelSizeLabel.textContent = TERRAIN_LABEL_LABELS[terrainLabelState];
  tvToggleLabelSize?.classList.toggle('active', terrainLabelState !== 'none');
  // Set the build-time label scale before the model builds so labels come out at
  // the persisted size with no post-build rescale flash.
  terrainViewer?.setLabelScale(terrainLabelState);

  syncTerrainNormalizeButton();
}

// Push the persisted visibility settings onto the freshly built model.
function applyTerrainDisplayToViewer() {
  if (!terrainViewer) return;
  const s = terrainDisplaySettings;
  terrainViewer.setContourPrecision(terrainContourState);
  terrainViewer.setContourLabelsVisible(!!s.contourLabels);
  terrainViewer.setWeatherVisible(terrainWeatherState !== 'off');
  terrainViewer.setEnvironmentEnabled(!!s.daynight);
  terrainViewer.setWeatherAnimEnabled(terrainWeatherState === 'on');
  terrainViewer.setEffectsEnabled(!!s.effects);
  terrainViewer.setFeaturesVisible(!!s.features);
  terrainViewer.setLabelScale(terrainLabelState);
  terrainViewer.setAbsoluteElevation(!!s.absElev);
  terrainViewer.setRouteRevealMode(!!s.trailReveal);
  terrainViewer.setFollowCamera(!!s.followCam);
  terrainViewer.setSatelliteEnabled(!!s.satellite);
  syncTerrainSatelliteButton();
  // Vertical normalization is baked into the build via routeData.elevNormalized;
  // here we only keep the button state in sync.
  syncTerrainNormalizeButton();
}

function syncTerrainNormalizeButton() {
  if (tvToggleNormalize) {
    tvToggleNormalize.classList.toggle('active', !!terrainDisplaySettings.elevNormalized);
  }
}

function syncTerrainSatelliteButton() {
  if (tvToggleSatellite) {
    tvToggleSatellite.classList.toggle('active', !!terrainDisplaySettings.satellite);
  }
}

// On phones the route-info (路線資訊) and character-info (人物資訊) overlays cover
// too much of a small canvas, so they open collapsed; on larger screens they
// open expanded. Matches the 640px breakpoint the panels restyle at.
function applyTerrainMobileDefaults() {
  const collapsed = window.matchMedia('(max-width: 640px)').matches;
  [[tvInfoPanel, tvInfoCollapse], [tvLiveHud, tvHudCollapse]].forEach(([panel, btn]) => {
    if (!panel) return;
    panel.classList.toggle('collapsed', collapsed);
    btn?.setAttribute('aria-expanded', String(!collapsed));
  });
}

tvToggleContour?.addEventListener('click', () => {
  const next = TERRAIN_CONTOUR_STATES[(TERRAIN_CONTOUR_STATES.indexOf(terrainContourState) + 1) % TERRAIN_CONTOUR_STATES.length];
  applyTerrainContourState(next);
});
tvToggleContourLabels?.addEventListener('click', () => {
  if (tvToggleContourLabels.disabled) return;
  const on = tvToggleContourLabels.classList.toggle('active');
  terrainViewer?.setContourLabelsVisible(on);
  terrainDisplaySettings.contourLabels = on;
  saveTerrainDisplaySettings();
});
tvToggleWeather?.addEventListener('click', () => {
  if (tvToggleWeather.disabled) return;
  const next = TERRAIN_WEATHER_STATES[(TERRAIN_WEATHER_STATES.indexOf(terrainWeatherState) + 1) % TERRAIN_WEATHER_STATES.length];
  applyTerrainWeatherState(next);
});
tvToggleDaynight?.addEventListener('click', () => {
  const on = tvToggleDaynight.classList.toggle('active');
  terrainViewer?.setEnvironmentEnabled(on);
  terrainDisplaySettings.daynight = on;
  saveTerrainDisplaySettings();
});
// 特效: purely declutters the decorative landmark models (peaks/trees/towers/
// viewpoints/monuments) — independent of the 天氣 button above.
tvToggleEffects?.addEventListener('click', () => {
  if (tvToggleEffects.disabled) return;
  const on = tvToggleEffects.classList.toggle('active');
  terrainViewer?.setEffectsEnabled(on);
  terrainDisplaySettings.effects = on;
  saveTerrainDisplaySettings();
});
tvToggleFeatures?.addEventListener('click', () => {
  const on = tvToggleFeatures.classList.toggle('active');
  terrainViewer?.setFeaturesVisible(on);
  terrainDisplaySettings.features = on;
  saveTerrainDisplaySettings();
});
tvToggleSatellite?.addEventListener('click', () => {
  const on = tvToggleSatellite.classList.toggle('active');
  terrainDisplaySettings.satellite = on;
  saveTerrainDisplaySettings();
  if (on) showNotification('載入衛星影像…', 'info');
  terrainViewer?.setSatelliteEnabled(on);
});

// Camera view preset toggle: 45° oblique ⇄ straight-down, both north-up. Snaps
// the camera but leaves OrbitControls free so the user can still orbit/tilt.
// The label names the action the next click performs (e.g. "俯視" → click to go
// top-down), so it never claims a preset that isn't actually active.
const TERRAIN_VIEW_LABELS = { '45': '45°', top: '俯視' };
let terrainViewNextMode = 'top'; // what clicking the button will switch to
function syncTerrainViewButton() {
  if (tvToggleView) tvToggleView.dataset.viewState = terrainViewNextMode;
  if (tvViewLabel) tvViewLabel.textContent = TERRAIN_VIEW_LABELS[terrainViewNextMode] || '俯視';
}
tvToggleView?.addEventListener('click', () => {
  const mode = terrainViewNextMode;
  terrainViewer?.applyViewPreset(mode);
  terrainViewNextMode = mode === 'top' ? '45' : 'top';
  syncTerrainViewButton();
});

// 海拔高度歸一化 toggle — exaggerates relief so flat terrain reads as 3D. Persisted
// and re-baked into the model on the next open; rebuilt in place when toggled live.
tvToggleNormalize?.addEventListener('click', () => {
  const on = !terrainDisplaySettings.elevNormalized;
  terrainDisplaySettings.elevNormalized = on;
  saveTerrainDisplaySettings();
  syncTerrainNormalizeButton();
  terrainViewer?.setElevationNormalized(on);
});

// 絕對海拔懸空 toggle (Plan §II-4) — shows the track floating at true elevation
// with vertical support stems to the ground. Visibility flip only; no rebuild.
tvToggleAbsolute?.addEventListener('click', () => {
  const on = tvToggleAbsolute.classList.toggle('active');
  terrainViewer?.setAbsoluteElevation(on);
  terrainDisplaySettings.absElev = on;
  saveTerrainDisplaySettings();
});

// Relive 式運鏡 toggle — while playing, the camera chases the hiker from behind
// and ends on a slow orbit; off = classic free orbit camera.
tpFollow?.addEventListener('click', () => {
  const on = tpFollow.classList.toggle('active');
  terrainViewer?.setFollowCamera(on);
  terrainDisplaySettings.followCam = on;
  saveTerrainDisplaySettings();
});

// 軌跡時序揭示 toggle (Plan §II-1) — reveals the track progressively as playback
// advances (CZML-Path style) instead of drawing the whole line at once.
tvToggleTrail?.addEventListener('click', () => {
  const on = tvToggleTrail.classList.toggle('active');
  terrainViewer?.setRouteRevealMode(on);
  terrainDisplaySettings.trailReveal = on;
  saveTerrainDisplaySettings();
});

// On-terrain text (字體) cycles: 關 (off, default) → 大 → 小.
const TERRAIN_LABEL_STATES = ['none', 'large', 'small'];
const TERRAIN_LABEL_LABELS = { large: '字體·大', small: '字體·小', none: '字體·關' };
let terrainLabelState = 'none';

function applyTerrainLabelState(state) {
  terrainLabelState = TERRAIN_LABEL_STATES.includes(state) ? state : 'large';
  if (tvLabelSizeLabel) tvLabelSizeLabel.textContent = TERRAIN_LABEL_LABELS[terrainLabelState];
  if (tvToggleLabelSize) tvToggleLabelSize.classList.toggle('active', terrainLabelState !== 'none');
  terrainViewer?.setLabelScale(terrainLabelState);
  terrainDisplaySettings.labelSize = terrainLabelState;
  saveTerrainDisplaySettings();
}

function cycleTerrainLabelState() {
  const next = TERRAIN_LABEL_STATES[(TERRAIN_LABEL_STATES.indexOf(terrainLabelState) + 1) % TERRAIN_LABEL_STATES.length];
  applyTerrainLabelState(next);
}

tvToggleLabelSize?.addEventListener('click', cycleTerrainLabelState);

// Keyboard: 'L' cycles the on-terrain label size while the 3D viewer is open.
window.addEventListener('keydown', (e) => {
  if (terrainViewerEl?.classList.contains('hidden')) return;
  const tag = (e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
  if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    cycleTerrainLabelState();
  }
});

tvInfoCollapse?.addEventListener('click', () => {
  const collapsed = tvInfoPanel?.classList.toggle('collapsed');
  tvInfoCollapse.setAttribute('aria-expanded', String(!collapsed));
});

tvHudCollapse?.addEventListener('click', () => {
  const collapsed = tvLiveHud?.classList.toggle('collapsed');
  tvHudCollapse.setAttribute('aria-expanded', String(!collapsed));
});

// ---- Marker / landmark detail popup ----
function hideTerrainMarkerDetail() {
  tvMarkerDetail?.classList.add('hidden');
}

function renderTerrainMarkerDetail(detail) {
  if (!tvMarkerDetail || !tvMarkerDetailBody || !detail) return;
  const colorCss = detail.colorCss || '#44aaff';
  const rows = [];
  const addRow = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    rows.push(`<div class="tv-marker-detail-row"><span class="tv-md-label">${tvEscapeHtml(label)}</span><span class="tv-md-value">${tvEscapeHtml(value)}</span></div>`);
  };

  let title;
  if (detail.type === 'weather') {
    title = `${detail.icon || '🌡️'} ${detail.label || '天氣點'}`;
    addRow('溫度', detail.temperature != null ? `${Math.round(detail.temperature)}°C` : null);
    addRow('天氣', detail.weatherCode != null ? tWmo(detail.weatherCode) : null);
  } else {
    const tag = detail.isStart ? '（起點）' : (detail.isEnd ? '（終點）' : '');
    title = `${detail.label || '航點'}${tag}`;
    addRow('里程', detail.distanceM != null ? formatDistance(detail.distanceM) : null);
  }
  addRow('海拔', detail.elevation != null ? formatElevation(detail.elevation) : null);
  if (detail.lat != null && detail.lng != null) {
    addRow('座標', `${detail.lat.toFixed(5)}, ${detail.lng.toFixed(5)}`);
  }

  tvMarkerDetailBody.innerHTML = `
    <div class="tv-marker-detail-title"><span class="tv-marker-detail-dot" style="color:${colorCss};background:${colorCss}"></span>${tvEscapeHtml(title)}</div>
    <div class="tv-marker-detail-rows">${rows.join('') || '<div class="tv-marker-detail-row"><span class="tv-md-label">—</span></div>'}</div>`;
  tvMarkerDetail.classList.remove('hidden');
}

// ---- Relive close-up waypoint card (TCG-style "draw" reveal) ----
// When the 3D playback camera pauses for a close-up on a waypoint, deal a card
// surfacing that moment's personal / terrain / weather info. The numbers come
// from the same position-driven metrics that feed the live HUD
// (terrainViewer.metricsAt) merged with the waypoint's own detail.
function hideWaypointCard() {
  if (tvWpCardLeaveTimer) { clearTimeout(tvWpCardLeaveTimer); tvWpCardLeaveTimer = null; }
  if (tvWpCardHideTimer) { clearTimeout(tvWpCardHideTimer); tvWpCardHideTimer = null; }
  if (!tvWpCard) return;
  tvWpCard.classList.add('hidden');
  tvWpCard.classList.remove('dealing', 'leaving');
}

function showWaypointCard(detail) {
  if (!tvWpCard || !tvWpCardBody || !detail) return;
  const m = terrainViewer?.metricsAt?.(terrainViewer.getProgress?.()) || {};
  const colorCss = detail.colorCss || '#44aaff';
  const lang = getLanguage();

  const rowsHtml = (rows) => rows
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([label, v]) => `<div class="tv-wp-row"><span class="tv-wp-row-label">${tvEscapeHtml(label)}</span><span class="tv-wp-row-value">${tvEscapeHtml(v)}</span></div>`)
    .join('') || '<div class="tv-wp-row"><span class="tv-wp-row-label">—</span></div>';

  // 個人資訊
  const arrival = (m.dateMs != null && Number.isFinite(m.dateMs))
    ? new Date(m.dateMs).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  const elapsed = m.timeH != null ? formatDurationHHMM(m.timeH) : null;
  const speed = (m.speedKmh != null && Number.isFinite(m.speedKmh)) ? `${m.speedKmh.toFixed(1)} km/h` : null;
  const fatigue = (m.fatiguePct != null && Number.isFinite(m.fatiguePct))
    ? `${Math.round(Math.max(0, Math.min(100, m.fatiguePct)))}%` : null;
  const personRows = rowsHtml([['抵達時刻', arrival], ['歷時', elapsed], ['移動速度', speed], ['疲勞度', fatigue]]);

  // 軌跡地形資訊
  const mileageM = (m.distM != null) ? m.distM : detail.distanceM;
  const mileage = mileageM != null ? formatDistance(mileageM) : null;
  const elevVal = (m.elevM != null) ? m.elevM : detail.elevation;
  const elev = elevVal != null ? formatElevation(elevVal) : null;
  let grade = null;
  if (m.gradePct != null && Number.isFinite(m.gradePct)) {
    const g = m.gradePct;
    const sign = g > 0.5 ? '↗' : (g < -0.5 ? '↘' : '→');
    grade = `${sign}${Math.abs(g).toFixed(1)}%`;
  }
  const terrainRows = rowsHtml([['里程', mileage], ['海拔', elev], ['坡度', grade]]);

  // 當下天氣資訊
  const wx = m.weather || null;
  const wxEmoji = wx?.icon || '🧭';
  const wxTemp = (wx && wx.temperature != null) ? `${Math.round(wx.temperature)}°C` : null;
  const wxCond = (wx && wx.code != null) ? tWmo(wx.code) : null;
  const weatherRows = rowsHtml([['天氣狀況', wxCond], ['溫度', wxTemp]]);

  const tag = detail.isStart ? '起點' : (detail.isEnd ? '終點' : '中繼點');

  tvWpCard.style.setProperty('--wp-card-color', colorCss);
  tvWpCardBody.innerHTML = `
    <div class="tv-wp-card-top">
      <span class="tv-wp-card-tag" style="background:${colorCss}">${tvEscapeHtml(tag)}</span>
      <span class="tv-wp-card-name">${tvEscapeHtml(detail.label || '航點')}</span>
    </div>
    <div class="tv-wp-card-hero">
      <span class="tv-wp-card-emoji">${tvEscapeHtml(wxEmoji)}</span>
      ${wxTemp ? `<span class="tv-wp-card-hero-temp">${tvEscapeHtml(wxTemp)}</span>` : ''}
    </div>
    <div class="tv-wp-card-cats">
      <section class="tv-wp-cat"><div class="tv-wp-cat-title">👤 個人</div>${personRows}</section>
      <section class="tv-wp-cat"><div class="tv-wp-cat-title">⛰️ 地形</div>${terrainRows}</section>
      <section class="tv-wp-cat"><div class="tv-wp-cat-title">🌦️ 天氣</div>${weatherRows}</section>
    </div>`;

  // Replay the deal animation from scratch on every arrival.
  if (tvWpCardLeaveTimer) { clearTimeout(tvWpCardLeaveTimer); tvWpCardLeaveTimer = null; }
  if (tvWpCardHideTimer) { clearTimeout(tvWpCardHideTimer); tvWpCardHideTimer = null; }
  tvWpCard.classList.remove('hidden', 'leaving', 'dealing');
  void tvWpCard.offsetWidth;           // force reflow so the keyframes restart
  tvWpCard.classList.add('dealing');

  // Auto-dismiss just before the close-up pause ends (~2.6s in the viewer).
  tvWpCardLeaveTimer = setTimeout(() => {
    tvWpCard.classList.add('leaving');
    tvWpCardHideTimer = setTimeout(hideWaypointCard, 420);
  }, 2200);
}

tvMarkerDetailClose?.addEventListener('click', hideTerrainMarkerDetail);

tvLoadingAbort?.addEventListener('click', () => {
  if (terrainViewer?.isLoading()) {
    terrainViewer.abort();
  } else {
    closeTerrainViewer();
  }
});

btnPanelNarrow?.addEventListener('click', () => {
  applySidePanelWidth(getCurrentPanelWidth() - PANEL_WIDTH_STEP);
});

btnPanelWiden?.addEventListener('click', () => {
  applySidePanelWidth(getCurrentPanelWidth() + PANEL_WIDTH_STEP);
});

// 手機版右滑收起側邊欄
let panelTouchStartX = 0;
let panelTouchStartY = 0;
sidePanel.addEventListener('touchstart', (e) => {
  panelTouchStartX = e.touches[0].clientX;
  panelTouchStartY = e.touches[0].clientY;
}, { passive: true });

sidePanel.addEventListener('touchend', (e) => {
  if (!sidePanel.classList.contains('open')) return;
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;
  const dx = touchEndX - panelTouchStartX;
  const dy = touchEndY - panelTouchStartY;
  
  // 判斷為向右滑動 (水平位移大於 80px 且垂直位移小)
  if (dx > 80 && Math.abs(dy) < 60) {
    sidePanel.classList.remove('open');
  }
}, { passive: true });

// F5: bottom-panel content toggle — the lower block switches between the
// elevation (vertical-track) chart and the detailed weather table instead of
// stacking both. Mode class on #bottom-panel drives visibility (see main.css).
const LS_BP_VIEW_KEY = 'mappingElf_bpView';
const bottomPanelEl = document.getElementById('bottom-panel');
const BP_VIEWS = ['elev', 'weather', 'catchment'];
// False until the weather panel has rendered once (weatherPoints initialised). The
// module-eval bootstrap below sets the mode class but MUST NOT touch weatherPoints
// (TDZ), so catchment render/fetch side-effects are gated on this.
let bottomPanelReady = false;
function getBottomPanelView() {
  if (bottomPanelEl?.classList.contains('bp-mode-weather')) return 'weather';
  if (bottomPanelEl?.classList.contains('bp-mode-catchment')) return 'catchment';
  return 'elev';
}
function setBottomPanelView(view, persist = true) {
  const mode = BP_VIEWS.includes(view) ? view : 'elev';
  bottomPanelEl?.classList.toggle('bp-mode-weather', mode === 'weather');
  bottomPanelEl?.classList.toggle('bp-mode-catchment', mode === 'catchment');
  bottomPanelEl?.classList.toggle('bp-mode-elev', mode === 'elev');
  document.querySelectorAll('#bp-view-toggle .bp-view-btn').forEach((b) => {
    const on = b.dataset.bpView === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // Chart.js needs a resize when its container becomes visible again.
  if (mode === 'elev') requestAnimationFrame(() => elevationProfile?.chart?.resize());
  // Opening the catchment view renders the table, then lazily backfills any
  // waypoint whose 集水區 read-out isn't cached yet (progress-bar managed).
  if (mode === 'catchment' && bottomPanelReady) { renderCatchmentPanel(); autoFetchCatchment({ notify: true }); }
  if (persist) { try { localStorage.setItem(LS_BP_VIEW_KEY, mode); } catch (_) { } }
}
document.getElementById('bp-view-toggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.bp-view-btn');
  if (btn) setBottomPanelView(btn.dataset.bpView);
});
setBottomPanelView(BP_VIEWS.includes(localStorage.getItem(LS_BP_VIEW_KEY)) ? localStorage.getItem(LS_BP_VIEW_KEY) : 'elev', false);


// 手機平板螢幕下，點擊地圖自動收合側拉面板
document.getElementById('map').addEventListener('click', () => {
  if (window.innerWidth <= 1024 && sidePanel.classList.contains('open')) {
    sidePanel.classList.remove('open');
  }
}, true);

btnMyLocation.addEventListener('click', async () => {
  showNotification('正在定位...', 'info');
  try {
    await mapManager.goToMyLocation();
  } catch (err) {
    console.warn('Failed to get current location:', err);
    showLocationPermissionHelp();
    showNotification('無法取得目前位置，請確認定位權限已開啟', 'error');
  }
});

// =========== F2: 2D map measurement tools ===========
// Two modes share one panel + Leaflet overlay layer:
//   segment — click two points; snap each to the planned track and report the
//             along-track distance plus asc/ descent between them.
//   area    — click any number of free points; report the cumulative straight-
//             line length and, from 3 points on, the enclosed polygon area.
const measurePanel = document.getElementById('measure-panel');
const measureHintEl = document.getElementById('measure-hint');
const measureReadoutEl = document.getElementById('measure-readout');
const btnMeasureTool = document.getElementById('btn-measure-tool');
let measureMode = 'segment';
let measurePoints = [];            // clicked [lat, lng] points (raw)
let measureLayer = null;           // L.layerGroup on the map
let catchmentAbort = null;         // AbortController for the in-flight DEM fetch
let catchmentToken = 0;            // guards against a stale async result landing
let catchmentEnvAbort = null;      // AbortController for the weather+hydrology fetch
let catchmentEnvToken = 0;         // guards a stale env result (geometry or time changed)
let catchmentLast = null;          // { lat, lng, result } — geometry kept for re-eval on time change
let catchmentDate = '';            // chosen date YYYY-MM-DD, seeded from the weather anchor
let catchmentHour = null;          // chosen hour 0-23, kept for the session

function measureTrack() {
  const pts = (elevationProfile?.points && elevationProfile.points.length >= 2)
    ? elevationProfile.points
    : currentRouteCoords;
  return Array.isArray(pts) && pts.length >= 2 ? pts : null;
}

function ensureMeasureLayer() {
  if (!measureLayer) measureLayer = L.layerGroup().addTo(mapManager.map);
  return measureLayer;
}

function clearMeasureOverlay() {
  cancelCatchment();
  measurePoints = [];
  measureLayer?.clearLayers();
  if (measureReadoutEl) measureReadoutEl.innerHTML = '';
}

function measureDot(latlng, label) {
  return L.marker(latlng, {
    icon: L.divIcon({
      className: 'measure-dot-icon',
      html: `<span class="measure-dot">${label ?? ''}</span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
    interactive: false,
    keyboard: false,
  });
}

// Latitude-corrected planar area (shoelace) in m² — good to <0.5% for the
// city-scale polygons this tool measures.
function polygonAreaM2(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  const R = 6371000.785, toRad = Math.PI / 180;
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cosLat0 = Math.cos(lat0 * toRad);
  const xy = pts.map(([la, ln]) => [ln * toRad * R * cosLat0, la * toRad * R]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    a += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1];
  }
  return Math.abs(a) / 2;
}

function formatArea(m2) {
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(2)} km²`;
  if (m2 >= 1e4) return `${(m2 / 1e4).toFixed(2)} ha`;
  return `${Math.round(m2)} m²`;
}

function latLngAtMileage(track, dists, m) {
  if (m <= 0) return track[0];
  const last = dists[dists.length - 1];
  if (m >= last) return track[track.length - 1];
  for (let i = 1; i < track.length; i++) {
    if (dists[i] >= m) {
      const segLen = dists[i] - dists[i - 1] || 1;
      const t = (m - dists[i - 1]) / segLen;
      const a = track[i - 1], b = track[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return track[track.length - 1];
}

function renderMeasureReadout(rows) {
  if (!measureReadoutEl) return;
  measureReadoutEl.innerHTML = rows.map(([label, value]) =>
    `<div class="mr-row"><span class="mr-label">${label}</span><span class="mr-value">${value}</span></div>`
  ).join('');
}

function computeSegmentMeasure() {
  const track = measureTrack();
  if (!track) { showNotification('先規劃路線再量測軌跡', 'warning'); return; }
  const D = elevationProfile?.distances || [];
  const E = elevationProfile?.elevations || [];
  const aligned = D.length === track.length;
  const m1r = projectMileage(track, measurePoints[0], 0);
  const m2r = projectMileage(track, measurePoints[1], 0);
  const lo = Math.min(m1r.mileage, m2r.mileage);
  const hi = Math.max(m1r.mileage, m2r.mileage);
  const pLo = latLngAtMileage(track, aligned ? D : cumulativeDistances(track), lo);
  const pHi = latLngAtMileage(track, aligned ? D : cumulativeDistances(track), hi);

  // Ascent / descent between the two mileages, sampled at the enclosed vertices.
  let asc = 0, desc = 0;
  if (aligned && E.length === track.length && elevationProfile._interpolateElevAtCumM) {
    const samples = [elevationProfile._interpolateElevAtCumM(lo)];
    for (let i = 0; i < D.length; i++) if (D[i] > lo && D[i] < hi) samples.push(E[i]);
    samples.push(elevationProfile._interpolateElevAtCumM(hi));
    for (let i = 1; i < samples.length; i++) {
      const d = samples[i] - samples[i - 1];
      if (d > 0) asc += d; else desc += d;
    }
  }

  // Highlight the track slice between the two snapped points.
  const dd = aligned ? D : cumulativeDistances(track);
  const slice = [pLo];
  for (let i = 0; i < track.length; i++) if (dd[i] > lo && dd[i] < hi) slice.push(track[i]);
  slice.push(pHi);
  const layer = ensureMeasureLayer();
  layer.clearLayers();
  L.polyline(slice, { color: '#f59e0b', weight: 5, opacity: 0.9 }).addTo(layer);
  measureDot(pLo, 'A').addTo(layer);
  measureDot(pHi, 'B').addTo(layer);

  renderMeasureReadout([
    ['沿軌跡距離', formatDistance(hi - lo)],
    ['直線距離', formatDistance(haversineDistance(pLo, pHi))],
    ['爬升', asc ? '+' + formatElevation(asc) : '—'],
    ['下降', desc ? '−' + formatElevation(Math.abs(desc)) : '—'],
  ]);
}

function computeAreaMeasure() {
  const layer = ensureMeasureLayer();
  layer.clearLayers();
  measurePoints.forEach((p, i) => measureDot(p, String(i + 1)).addTo(layer));
  let straight = 0;
  for (let i = 1; i < measurePoints.length; i++) straight += haversineDistance(measurePoints[i - 1], measurePoints[i]);
  if (measurePoints.length >= 3) {
    L.polygon(measurePoints, { color: '#38bdf8', weight: 3, opacity: 0.9, fillOpacity: 0.12 }).addTo(layer);
  } else if (measurePoints.length === 2) {
    L.polyline(measurePoints, { color: '#38bdf8', weight: 3, opacity: 0.9 }).addTo(layer);
  }
  const rows = [
    ['點數', String(measurePoints.length)],
    ['直線總長', formatDistance(straight)],
  ];
  if (measurePoints.length >= 3) rows.push(['包圍面積', formatArea(polygonAreaM2(measurePoints))]);
  renderMeasureReadout(rows);
}

function cancelCatchment() {
  catchmentToken++;
  catchmentAbort?.abort();
  catchmentAbort = null;
  catchmentEnvToken++;
  catchmentEnvAbort?.abort();
  catchmentEnvAbort = null;
  catchmentLast = null;
}

// Smallest-bbox cached 3D-terrain grid whose extent covers the click, so the
// catchment can be computed offline (or when the elevation API is failing).
function findCachedDemAt(lat, lng) {
  const cache = loadTerrainCache();
  let best = null, bestSpan = Infinity;
  for (const key of Object.keys(cache)) {
    const e = cache[key];
    const b = e?.bbox;
    if (!b || !Array.isArray(e.grid)) continue;
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) continue;
    const span = (b.maxLat - b.minLat) + (b.maxLng - b.minLng);
    if (span < bestSpan) { bestSpan = span; best = { grid: e.grid, bbox: b }; }
  }
  return best;
}

// Delineate a catchment, cache-first. The persistent cache (localStorage +
// .melmap) is checked before the expensive DEM fetch + flow analysis, and every
// fresh 'ok' delineation is stored — so both this measure tool and the weather
// cards populate and reuse the same 集水區 暫存.
async function getCatchmentFor(lat, lng, { signal } = {}) {
  const cached = getCatchmentCacheHit(lat, lng);
  if (cached) return cached;
  const result = await computeCatchment(lat, lng, {
    signal,
    offlineDem: findCachedDemAt(lat, lng),
  });
  if (result?.status === 'ok') setCatchmentCacheData(lat, lng, result);
  return result;
}

async function runCatchment(lat, lng) {
  cancelCatchment();                       // supersede any earlier in-flight run
  const token = catchmentToken;
  catchmentAbort = new AbortController();

  const layer = ensureMeasureLayer();
  layer.clearLayers();
  measureDot([lat, lng], '▼').addTo(layer);
  renderMeasureReadout([['提示', '計算集水區中…']]);

  let result;
  try {
    result = await getCatchmentFor(lat, lng, { signal: catchmentAbort.signal });
  } catch (err) {
    if (token !== catchmentToken) return;  // a newer click already took over
    console.warn('Catchment failed:', err);
    result = { status: 'error' };
  }
  if (token !== catchmentToken) return;     // stale result — discard silently
  catchmentAbort = null;

  if (result.status === 'aborted') return;
  if (result.status === 'flat') {
    layer.clearLayers();
    if (measureReadoutEl) measureReadoutEl.innerHTML = '';
    showNotification('此處為大面積平地，無法判定集水方向', 'info');
    return;
  }
  if (result.status === 'error') {
    layer.clearLayers();
    if (measureReadoutEl) measureReadoutEl.innerHTML = '';
    showNotification('海拔資料取得失敗，請稍後再試', 'warning');
    return;
  }
  if (result.status === 'empty' || !result.outer?.length) {
    layer.clearLayers();
    if (measureReadoutEl) measureReadoutEl.innerHTML = '';
    showNotification('此處集水範圍過小', 'info');
    return;
  }

  layer.clearLayers();
  L.polygon([result.outer, ...result.holes], {
    color: '#2563eb', weight: 2, opacity: 0.9,
    fillColor: '#3b82f6', fillOpacity: 0.25,
  }).addTo(layer);
  measureDot(result.outlet, '▼').addTo(layer);

  catchmentLast = { lat, lng, result };
  seedCatchmentDateTime();
  renderCatchmentBase(result);
  loadCatchmentEnv();
  if (result.source === 'cached') showNotification('集水區為近似值（來自已快取地形）', 'info');
  else if (result.touchesBorder) showNotification('集水區可能延伸至分析範圍外', 'info');
}

// Seed the catchment date/hour from the weather anchor (col-0 date+hour, else
// today 08:00) on first use, then keep the user's choice for the session so
// clicking a new point doesn't reset the time. See getTerrainStartMs().
function seedCatchmentDateTime() {
  if (catchmentDate && catchmentHour != null) return;
  const d = new Date(getTerrainStartMs());
  const p2 = (n) => String(n).padStart(2, '0');
  catchmentDate = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  catchmentHour = d.getHours();
}

const CATCHMENT_WEATHER_KEYS = [
  ['weather', '天氣'], ['temp', '溫度'], ['feelsLike', '體感溫度'],
  ['humidity', '濕度'], ['windSpeed', '風速'], ['precipitation', '雨量'], ['precipProb', '降雨機率'],
];

// Weather rows shown inside a weather-CARD's catchment view. Drops weather/溫度/體感
// 溫度 because the card already shows those in its header line (wc-weather-main).
const CATCHMENT_CARD_WEATHER_KEYS = CATCHMENT_WEATHER_KEYS.filter(
  ([k]) => k !== 'weather' && k !== 'temp' && k !== 'feelsLike',
);

// Hydrology row count for the "no data" fill fallback; order/labels mirror
// computeHydroIndicators (catchmentHydro.js) — see buildCatchmentSkeletonHtml.
const CATCHMENT_HYDRO_LABELS = ['土壤含水量', '前期降雨', '預估逕流量', '河川流量', '溪水暴漲風險', '土石流風險'];

// Terrain-row labels (order MUST match the terrain[] array saved by saveCatchmentCells:
// area, outlet, then computeGeometryRows → 海拔範圍/平均坡度/主流長度).
const CATCHMENT_TERRAIN_LABELS = ['集水區面積', '出水口海拔', '海拔範圍', '平均坡度', '主流長度'];

// Info-card item explanations (Chinese label → Chinese description). The description
// sentences are registered in i18n PHRASES, so the hover tooltip translates them at
// show-time via translatePhrase(). Labels shared across weather/catchment views map to
// one description. Missing keys simply show no tooltip.
const WC_INFO_TIPS = {
  '天氣': '該時段的天氣狀況與代表圖示',
  '溫度': '該時段的預估氣溫（攝氏）',
  '雨量': '該時段每小時累積降雨量（毫米）',
  '降雨機率': '該時段出現降雨的機率百分比',
  '最高溫': '當日預報的最高氣溫',
  '最低溫': '當日預報的最低氣溫',
  '體感溫度': '綜合氣溫、濕度與風速後的人體實際感受溫度',
  '濕度': '空氣相對濕度百分比',
  '露點': '空氣達到飽和凝結的溫度，愈接近氣溫代表愈潮濕',
  '雲量': '天空被雲層覆蓋的比例',
  '風速': '該時段的平均風速',
  '陣風': '該時段的最大瞬間風速',
  'UV': '紫外線指數，數值愈高愈需加強防曬',
  '能見度': '水平方向可看清物體的最大距離',
  '日照': '當日可照射到陽光的總時數',
  '輻射': '太陽短波輻射強度',
  '日出': '當日太陽升起的時刻',
  '日落': '當日太陽落下的時刻',
  '距離': '沿路線從起點累積到此點的里程',
  '海拔': '此點地面的高程',
  '坐標': '此點的經緯度座標（點擊可複製）',
  '集水區面積': '雨水最終匯流至此出水口的地表範圍面積',
  '出水口海拔': '集水區最低匯流點（出水口）的高程',
  '海拔範圍': '集水區內最低到最高的高程差',
  '平均坡度': '集水區地表的平均傾斜角度',
  '主流長度': '集水區內最長匯流路徑（主河道）的長度',
  '土壤含水量': '根區土壤的水分飽和百分比，愈高愈易形成逕流',
  '前期降雨': '事件前 24／72 小時的累積雨量，反映地表既有濕度',
  '預估逕流量': '依 SCS-CN 法估算此次降雨形成的地表逕流體積',
  '河川流量': '區域河道的模擬流量，以及相對於常態的距平',
  '溪水暴漲風險': '綜合降雨強度、土壤濕度與地形研判的溪水暴漲參考等級（非官方警報）',
  '土石流風險': '依降雨強度—延時門檻與坡度、濕度研判的土石流參考等級（非官方警報）',
};

// ` data-tip="<label>"` when the label has an explanation; '' otherwise. The
// hover controller (installInfoTipController) resolves + translates the text.
function wcTipAttr(label) {
  return WC_INFO_TIPS[label] ? ` data-tip="${label}"` : '';
}

// severity (0-3 | -1 | null) → risk-chip CSS suffix.
function catchmentSevClass(sev) {
  return sev == null ? '' : ['low', 'mid', 'high', 'ext'][sev] || 'na';
}

function catchmentRowsHtml(rows) {
  return rows.map((r) => {
    const chip = r.level
      ? ` <span class="risk-chip risk-${catchmentSevClass(r.severity)}">${r.level}</span>`
      : '';
    return `<div class="mr-row"><span class="mr-label">${r.label}</span>`
      + `<span class="mr-value">${r.value || ''}${chip}</span></div>`;
  }).join('');
}

function catchmentWeatherHtml(data) {
  if (!data) return '<div class="ct-nodata">—</div>';
  return CATCHMENT_WEATHER_KEYS.map(([key, label]) =>
    `<div class="mr-row"><span class="mr-label">${label}</span>`
    + `<span class="mr-value">${getCellValue(data, key)}</span></div>`
  ).join('');
}

// Full readout skeleton for a catchment result: area/outlet + terrain + an
// adjustable date/hour picker + async weather & hydrology sections.
function renderCatchmentBase(result) {
  if (!measureReadoutEl) return;
  const geoRows = computeGeometryRows(result);
  const outletRow = Number.isFinite(result.outletEle)
    ? `<div class="mr-row"><span class="mr-label">出水口海拔</span><span class="mr-value">${formatElevation(result.outletEle)}</span></div>`
    : '';
  const hourOpts = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}"${h === catchmentHour ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`
  ).join('');

  measureReadoutEl.innerHTML = `
    <div class="ct-sec">
      <div class="mr-row"><span class="mr-label">集水區面積</span><span class="mr-value">${formatArea(result.areaM2)}</span></div>
      ${outletRow}
      ${catchmentRowsHtml(geoRows)}
    </div>
    <div class="ct-time-row">
      <span class="mr-label">時間</span>
      <input type="date" id="ct-date" class="ct-date-input" value="${catchmentDate}">
      <select id="ct-hour" class="ct-hour-select">${hourOpts}</select>
    </div>
    <div class="mr-section">天氣</div>
    <div class="ct-sec" id="ct-weather"><div class="ct-loading">載入天氣與水文中…</div></div>
    <div class="mr-section">水文</div>
    <div class="ct-sec" id="ct-hydro"><div class="ct-loading">載入天氣與水文中…</div></div>
    <div class="ct-disclaimer">水文指標為粗略估算，僅供參考</div>`;

  const onChange = () => {
    const dv = document.getElementById('ct-date')?.value;
    const hv = parseInt(document.getElementById('ct-hour')?.value ?? '', 10);
    if (dv) catchmentDate = dv;
    if (Number.isFinite(hv)) catchmentHour = hv;
    loadCatchmentEnv();
  };
  document.getElementById('ct-date')?.addEventListener('change', onChange);
  document.getElementById('ct-hour')?.addEventListener('change', onChange);
}

function setCatchmentSectionsLoading() {
  for (const id of ['ct-weather', 'ct-hydro']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="ct-loading">載入天氣與水文中…</div>';
  }
}

// Fetch weather (existing service) + hydrology (new module) for the catchment at
// the chosen time and render both sections. Token-guarded so a superseded fetch
// (new point clicked, or time changed again) never lands stale (INC race rule).
async function loadCatchmentEnv() {
  if (!catchmentLast) return;
  catchmentEnvToken++;
  const token = catchmentEnvToken;
  catchmentEnvAbort?.abort();
  catchmentEnvAbort = new AbortController();
  const { lat, lng } = catchmentLast;
  const dateStr = catchmentDate, hour = catchmentHour;
  setCatchmentSectionsLoading();

  const swallow = (err) => {
    if (err?.name === 'AbortError') throw err;
    console.warn('Catchment env fetch failed:', err?.message);
    return null;
  };

  let weatherData = null, hydroEnv = null;
  try {
    [weatherData, hydroEnv] = await Promise.all([
      weatherService.getWeatherAtPoint(lat, lng, dateStr, hour, { signal: catchmentEnvAbort.signal }).catch(swallow),
      fetchHydroData(lat, lng, dateStr, hour, { signal: catchmentEnvAbort.signal }).catch(swallow),
    ]);
  } catch (err) {
    if (token !== catchmentEnvToken) return;   // superseded — discard silently
  }
  if (token !== catchmentEnvToken) return;
  catchmentEnvAbort = null;

  const wEl = document.getElementById('ct-weather');
  const hEl = document.getElementById('ct-hydro');
  if (wEl) wEl.innerHTML = catchmentWeatherHtml(weatherData);
  if (hEl) {
    hEl.innerHTML = (hydroEnv && hydroEnv.available)
      ? catchmentRowsHtml(computeHydroIndicators(catchmentLast.result, hydroEnv))
      : '<div class="ct-nodata">此日期無水文資料</div>';
  }
}

function handleMeasureClick(lat, lng) {
  if (measureMode === 'catchment') {
    runCatchment(lat, lng);
    return;
  }
  if (measureMode === 'segment') {
    if (!measureTrack()) { showNotification('先規劃路線再量測軌跡', 'warning'); return; }
    if (measurePoints.length >= 2) measurePoints = [];   // start a fresh pair
    measurePoints.push([lat, lng]);
    if (measurePoints.length === 2) {
      computeSegmentMeasure();
    } else {
      const track = measureTrack();
      const dd = (elevationProfile?.distances?.length === track.length)
        ? elevationProfile.distances : cumulativeDistances(track);
      const snapped = latLngAtMileage(track, dd, projectMileage(track, measurePoints[0], 0).mileage);
      const layer = ensureMeasureLayer();
      layer.clearLayers();
      measureDot(snapped, 'A').addTo(layer);
      renderMeasureReadout([['提示', '再點一下第二點']]);
    }
  } else {
    measurePoints.push([lat, lng]);
    computeAreaMeasure();
  }
}

const MEASURE_HINTS = {
  segment: '點擊軌跡上兩點以量測區間距離與爬升下降',
  area: '依序點擊地圖任意點，計算直線距離與包圍面積',
  catchment: '點擊地圖任意點，繪製該處集水區範圍',
};

function setMeasureMode(mode) {
  measureMode = MEASURE_HINTS[mode] ? mode : 'segment';
  document.querySelectorAll('#measure-mode-toggle .measure-mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.measureMode === measureMode));
  if (measureHintEl) measureHintEl.textContent = MEASURE_HINTS[measureMode];
  clearMeasureOverlay();
}

function setMeasureActive(active) {
  if (!measurePanel) return;
  mapManager.measureMode = active ? measureMode : null;
  measurePanel.classList.toggle('hidden', !active);
  btnMeasureTool?.setAttribute('aria-pressed', String(active));
  if (!active) clearMeasureOverlay();
}

mapManager.onMeasureClick = handleMeasureClick;
btnMeasureTool?.addEventListener('click', () => {
  setMeasureActive(measurePanel?.classList.contains('hidden'));
});
document.getElementById('measure-mode-toggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.measure-mode-btn');
  if (!btn) return;
  setMeasureMode(btn.dataset.measureMode);
  mapManager.measureMode = measureMode;
});
document.getElementById('btn-measure-clear')?.addEventListener('click', clearMeasureOverlay);
document.getElementById('btn-measure-close')?.addEventListener('click', () => setMeasureActive(false));
setMeasureMode('segment');

function pickRouteFile() {
  return platform.pickFile({
    accept: '.gpx,.kml,.melmap,.zip',
    inputElement: gpxFileInput,
  });
}

function setRouteLibraryTab(name = 'saved') {
  const tabName = ['saved', 'offline', 'import'].includes(name) ? name : 'saved';
  document.querySelectorAll('[data-route-library-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.routeLibraryTab === tabName);
  });
  document.querySelectorAll('.route-library-tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `route-library-tab-${tabName}`);
  });
}

function openRouteLibrary(tabName = 'saved') {
  if (!sidePanel.classList.contains('open')) sidePanel.classList.add('open');
  const section = document.getElementById('file-management-section');
  const header = document.getElementById('file-management-toggle-header');
  const body = document.getElementById('file-management-body');
  body?.classList.remove('collapsed');
  header?.classList.remove('collapsed');
  section?.scrollIntoView({ block: 'nearest' });
  setRouteLibraryTab(tabName);
  updateRouteLibraryCurrent();
  renderFavoritesList();
}

document.querySelectorAll('[data-route-library-tab]').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    setRouteLibraryTab(btn.dataset.routeLibraryTab);
  });
});

btnExportGpx.addEventListener('click', openExportModal);
btnImportGpx.addEventListener('click', pickRouteFile);
btnResetDefaults?.addEventListener('click', () => {
  if (confirm('確定要全部回到預設值嗎？這將會清除目前的設置並重啟頁面。')) {
    resetToDefaults();
  }
});
gpxFileInput.addEventListener('change', importFile);

function syncRouteHeaderButtons() {
  const busy = isRouteWeatherBusy();
  if (btnReplanRoute) {
    btnReplanRoute.disabled = busy || !importedTrackMode;
  }
  if (btnReverseReplanRoute) {
    btnReverseReplanRoute.disabled = busy || mapManager.waypoints.length < 2;
  }
  updateRouteLibraryCurrent();
}

function prepareImportedTrackForRouteReplan() {
  if (!importedTrackMode) return;

  const toRemove = [];
  for (let i = 0; i < mapManager.waypoints.length; i++) {
    const meta = importedWaypointMeta[i];
    const label = meta?.label || "";
    if (/\s*[↺↻↩]$|\s*\(回程\)$/.test(label)) {
      toRemove.push(i);
    }
  }

  importedTrackMode = false;
  importedIntermediatePoints = [];
  importedWaypointMeta = [];
  clearImportedTrackSession();
  syncTrackModeUI();
  mapManager.clearRoute();

  const cb = mapManager.onWaypointChange;
  mapManager.onWaypointChange = () => { };
  try {
    for (let i = toRemove.length - 1; i >= 0; i--) {
      mapManager.removeWaypoint(toRemove[i]);
    }
  } finally {
    mapManager.onWaypointChange = cb;
  }

  for (let i = 0; i < mapManager.waypoints.length; i++) {
    const [lat, lng] = mapManager.waypoints[i];
    const key = _geocodeKey(lat, lng);
    if (waypointCustomNames[key]) {
      const old = waypointCustomNames[key];
      waypointCustomNames[key] = old.replace(/\s*[↺↻↩]$/, '').trim();
    }
  }
  try { localStorage.setItem(LS_CUSTOM_NAMES_KEY, JSON.stringify(waypointCustomNames)); } catch (_) { }
}

/** Sync route header controls for imported-track and route-busy state. */
function syncTrackModeUI() {
  const busy = isRouteWeatherBusy();
  syncRouteHeaderButtons();

  // Freeze route and pace parameter inputs when in imported track mode (except replan/reverse/clear)
  const freezeSelectors = [
    '.nav-mode-row input',
    '.segment-interval-row input',
    '.segment-interval-row select',
    '.route-mode-selector input',
    '#route-section .pace-check-opt input',
    '#pace-params-panel input',
    '#pace-params-panel select'
  ];

  const frozen = !!importedTrackMode;
  document.querySelectorAll(freezeSelectors.join(',')).forEach(el => {
    el.disabled = frozen;
  });

  // Also freeze search result buttons if they exist
  document.querySelectorAll('.search-result-add').forEach(btn => {
    btn.disabled = frozen;
  });

  // Sync frozen state to map manager
  if (mapManager) {
    mapManager.setFrozen(frozen || busy);
  }

  // Visual dimming for frozen sections
  const frozenContainers = [
    '.nav-mode-row',
    '.segment-interval-row',
    '.route-mode-selector',
    '#route-section .pace-checks-row',
    '#pace-params-panel'
  ];
  document.querySelectorAll(frozenContainers.join(',')).forEach(c => {
    c.classList.toggle('is-frozen', frozen);
  });

  _updateHistoryButtons();
}

btnReplanRoute?.addEventListener('click', () => {
  if (isRouteWeatherBusy()) {
    showRouteWeatherBusyNotice();
    return;
  }
  prepareImportedTrackForRouteReplan();
  onWaypointsChanged(mapManager.waypoints);
  showNotification('重新規劃路線中…', 'info', 1500);
});

btnReverseReplanRoute?.addEventListener('click', () => {
  if (isRouteWeatherBusy()) {
    showRouteWeatherBusyNotice();
    return;
  }
  prepareImportedTrackForRouteReplan();
  if (mapManager.waypoints.length < 2) {
    onWaypointsChanged(mapManager.waypoints);
    showNotification('至少需 2 個航點才能反向重新規劃', 'warning');
    return;
  }
  mapManager.reverseWaypoints();
  showNotification('航點已反向排序，重新規劃路線中…', 'info', 1500);
});

btnClearRoute.addEventListener('click', () => {
  if (isRouteWeatherBusy()) {
    showRouteWeatherBusyNotice();
    return;
  }
  importedTrackMode = false;
  importedIntermediatePoints = [];
  importedWaypointMeta = [];
  clearImportedTrackSession();
  syncTrackModeUI();
  _wcStates.clear();
  mapManager.closeWeatherPopup();
  mapManager.clearMapCursor();
  mapManager.clearWaypoints();
  mapManager.clearIntermediateMarkers();
  elevationProfile.clear();
  resetStats();
  weatherPoints = [];
  setCurrentRouteData([], []);
  lastWaypoints = [];
  pendingNewWaypointIndex = null;
  waypointCumDistM = [];
  delete window._pendingGpxDates;
  Object.keys(waypointCustomNames).forEach(k => delete waypointCustomNames[k]);
  localStorage.removeItem(LS_CUSTOM_NAMES_KEY);
  Object.keys(waypointPlaceNames).forEach(k => delete waypointPlaceNames[k]);
  localStorage.removeItem(LS_GEOCODE_KEY);
  localStorage.removeItem(LS_WAYPOINTS_KEY);
  localStorage.removeItem(LS_WAYPOINT_IDS_KEY);
  const _wc = document.getElementById('weather-table-container');
  if (_wc) _wc.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「更新天氣」</p></div>';
  hideAlternatives();
  showNotification('路線已清除', 'info');
});

btnUndo.addEventListener('click', () => historyUndo());
btnRedo?.addEventListener('click', () => historyRedo());

window.addEventListener('keydown', (e) => {
  const t = e.target;
  const tag = t?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;

  const k = (e.key || '').toLowerCase();

  // Weather Card Keyboard Controls (Arrow keys)
  // Operates on the highlighted weather card/point if open, or the first open card found.
  const highlightedTh = document.querySelector('#weather-table-container .wt-col-head.wt-col-highlight');
  const highlightedColIdx = highlightedTh ? parseInt(highlightedTh.dataset.idx) : -1;
  let activeColIdx = -1;
  if (highlightedColIdx !== -1 && _wcStates.has(highlightedColIdx)) {
    activeColIdx = highlightedColIdx;
  } else if (_wcStates.size > 0) {
    activeColIdx = _wcStates.keys().next().value;
  }

  if (activeColIdx !== -1) {
    if (k === 'arrowleft') {
      e.preventDefault();
      navigateWeatherCard(activeColIdx, -1);
      return;
    }
    if (k === 'arrowright') {
      e.preventDefault();
      navigateWeatherCard(activeColIdx, 1);
      return;
    }
    if (k === 'arrowup') {
      e.preventDefault();
      const curMode = _wcStates.get(activeColIdx) || 'compact';
      const nextMode = curMode === 'compact' ? 'full' : 'compact';
      const targets = getWeatherCardInteractionIndices(activeColIdx, curMode);
      setWeatherCardModeForTargets(targets, nextMode, activeColIdx);
      highlightPoint(activeColIdx, false, { centerMap: nextMode === 'compact' });
      return;
    }
    if (k === 'arrowdown') {
      e.preventDefault();
      const targets = getWeatherCardInteractionIndices(activeColIdx, _wcStates.get(activeColIdx) || 'compact');
      targets.forEach(idx => closeWeatherCard(idx, { centerAfterClose: idx === activeColIdx }));
      return;
    }
  }

  // Undo/Redo/Search (requires Ctrl/Meta)
  if (!(e.ctrlKey || e.metaKey)) return;
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); historyUndo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); historyRedo(); }
});

// =========== Map Pack (.melmap) helpers ===========

const OFFLINE_TILE_EXPORT_UNAVAILABLE_MESSAGE = '此圖層暫不支援離線圖磚匯出';
let mapPackTilePreviewRun = 0;

function getOfflineTileExportPolicy(layerInfo = mapManager.getCurrentLayerInfo()) {
  const policy = layerInfo?.provider?.offlineTileExport;
  if (policy?.allowed === false) {
    return {
      allowed: false,
      reason: policy.reason || OFFLINE_TILE_EXPORT_UNAVAILABLE_MESSAGE,
    };
  }
  return { allowed: true, reason: '' };
}

function _estimateTileCountForMapPack(layerInfo = mapManager.getCurrentLayerInfo()) {
  if (currentRouteCoords.length < 2) return { count: 0, layer: null };
  if (!layerInfo) return { count: 0, layer: null };
  const bounds = L.latLngBounds(currentRouteCoords).pad(0.05);
  const estimate = estimateMapPackTiles(bounds, layerInfo);
  return { count: estimate.tileCount, layer: mapManager.currentLayerName };
}

function formatMapPackTileEstimate(est, bytePreview = null) {
  if (!est?.count) return '';
  const parts = [`約 ${est.count} 張`];
  if (est.layer) parts.push(est.layer);
  if (bytePreview?.estimatedBytes > 0) {
    parts.push(`${translatePhrase('預估')} ${formatByteSize(bytePreview.estimatedBytes)}`);
  }
  return `(${parts.join(',')})`;
}

async function updateMapPackTileBytePreview(runId, info, est, layerInfo) {
  if (!info || !est?.count) return;
  try {
    const { estimateOfflineTilePackBytes } = await ensureOfflineTileIndexModule();
    const bytePreview = await estimateOfflineTilePackBytes({
      layer: est.layer,
      providerId: layerInfo?.provider?.id,
      tileCount: est.count,
    });
    if (runId !== mapPackTilePreviewRun || !bytePreview?.estimatedBytes) return;
    if (!info.isConnected || info.dataset.i18n) return;
    info.textContent = formatMapPackTileEstimate(est, bytePreview);
  } catch (err) {
    console.warn('Map pack byte preview failed:', err);
  }
}

function updateMapPackTileOptionState() {
  const checkbox = document.getElementById('mappack-inc-tiles');
  const info = document.getElementById('mappack-tiles-info');
  const option = checkbox?.closest('.export-option');
  const layerInfo = mapManager.getCurrentLayerInfo();
  const policy = getOfflineTileExportPolicy(layerInfo);
  const previewRun = ++mapPackTilePreviewRun;

  if (!checkbox) return policy;

  if (!policy.allowed) {
    const reason = policy.reason || OFFLINE_TILE_EXPORT_UNAVAILABLE_MESSAGE;
    if (checkbox.dataset.providerDisabled !== '1') {
      checkbox.dataset.providerPrevChecked = checkbox.checked ? '1' : '0';
    }
    checkbox.checked = false;
    checkbox.disabled = true;
    checkbox.dataset.providerDisabled = '1';
    checkbox.title = translatePhrase(reason);
    option?.classList.add('is-disabled');
    if (info) {
      info.textContent = translatePhrase(reason);
      info.dataset.i18n = reason;
    }
    return policy;
  }

  checkbox.disabled = false;
  checkbox.removeAttribute('title');
  option?.classList.remove('is-disabled');
  if (checkbox.dataset.providerDisabled === '1') {
    checkbox.checked = checkbox.dataset.providerPrevChecked !== '0';
  }
  delete checkbox.dataset.providerDisabled;
  delete checkbox.dataset.providerPrevChecked;

  if (info) {
    delete info.dataset.i18n;
    const est = _estimateTileCountForMapPack(layerInfo);
    info.textContent = formatMapPackTileEstimate(est);
    updateMapPackTileBytePreview(previewRun, info, est, layerInfo);
  }
  return policy;
}

function formatByteSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  const digits = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

async function doExportMapPack(filenameBase, routeName = 'Mapping Elf Track', plan = readExportPlan()) {
  const includeRoute = plan.includeRoute;
  const includeWeather = plan.includeWeather;
  const includeTiles = plan.includeTiles;
  const includeState = plan.includeState;
  if (includeTiles) {
    const tilePolicy = getOfflineTileExportPolicy();
    if (!tilePolicy.allowed) {
      showNotification(tilePolicy.reason || OFFLINE_TILE_EXPORT_UNAVAILABLE_MESSAGE, 'warning');
      updateMapPackTileOptionState();
      return;
    }
  }
  if (!includeRoute && !includeTiles && !includeState) {
    showNotification('請至少勾選一項離線地圖包內容', 'warning');
    return;
  }

  const layerInfo = mapManager.getCurrentLayerInfo();
  const bounds = includeTiles && currentRouteCoords.length >= 2
    ? L.latLngBounds(currentRouteCoords).pad(0.05)
    : null;

  const { exportCoords, exportElevations } = getExportRouteData();

  const gpxXml = includeRoute
    ? (await ensureRouteExporters()).GpxExporter.generate(
      collectExportData(),
      exportCoords,
      exportElevations,
      routeName,
      { includeWeather }
    )
    : null;
  const routeMeta = includeRoute ? buildExportRouteMeta(routeName, exportCoords) : null;

  // Display-only progress: exporting snapshots the data up front, so the user
  // may keep editing while tiles download/zip.
  const busyTask = beginRouteWeatherBusyTask({ title: '匯出分享包', detail: '準備資料...', lockScope: 'none' });

  try {
    const { MapPackExporter } = await ensureMapPackModules();
    const {
      blob,
      filename,
      tileCount,
      downloadedTileCount,
      downloadedTileBytes,
      zipBytes,
    } = await MapPackExporter.export({
      bounds,
      routeCoords: currentRouteCoords,
      layerInfo: layerInfo && { ...layerInfo, name: mapManager.currentLayerName },
      includeRoute,
      includeWeather,
      includeTiles,
      includeState,
      sharePreset: plan.preset,
      routeMeta,
      gpxXml,
      filenameBase,
      onProgress: (cur, total, phase) => {
        const pct = Math.round((cur / Math.max(total, 1)) * 100);
        busyTask.set({
          detail: phase === 'zip' ? '打包中...' : `圖磚 ${cur}/${total}`,
          progress: pct,
        });
      },
    });
    await platform.shareFile({
      filename,
      mimeType: 'application/vnd.mappingelf.melmap+zip',
      content: blob,
    });
    const parts = [];
    if (includeRoute) parts.push('路線');
    if (includeRoute && includeWeather) parts.push('天氣');
    if (includeTiles) {
      const tilePart = downloadedTileCount === tileCount
        ? `${tileCount} 張圖磚`
        : `${downloadedTileCount}/${tileCount} 張圖磚`;
      const tileSize = downloadedTileBytes > 0 ? `圖磚 ${formatByteSize(downloadedTileBytes)}` : '';
      parts.push(tileSize ? `${tilePart} · ${tileSize}` : tilePart);
    }
    if (includeState) parts.push('設定');
    const zipSize = zipBytes > 0 ? `，檔案 ${formatByteSize(zipBytes)}` : '';
    showNotification(`分享包已建立 (${parts.join('、')}${zipSize})`, 'success');
  } catch (err) {
    showNotification(err.message || '匯出失敗', 'error');
    console.error(err);
  } finally {
    busyTask.end();
  }
}

let _pendingMappack = null;

function _closeMappackImportModal() {
  document.body.classList.remove('modal-open');
  mappackImportModal?.classList.add('hidden');
  _pendingMappack = null;
}

// Accidental backdrop click-to-close removed to "lock" UI.
// mappackImportModal?.addEventListener('click', (e) => {
//   if (e.target === mappackImportModal) _closeMappackImportModal();
// });
document.getElementById('btn-mappack-import-cancel')?.addEventListener('click', _closeMappackImportModal);

function exportPresetLabel(preset) {
  return EXPORT_PRESET_CONFIG[preset]?.label || preset || '自訂內容';
}

function formatManifestTileSummary(manifest = {}) {
  const providerName = manifest.tileProvider?.name || manifest.resources?.tiles?.provider?.name || manifest.layer || '未知圖層';
  const expected = Number(manifest.tileCount || manifest.resources?.tiles?.expectedTileCount || 0);
  const cached = Number(manifest.downloadedTileCount || manifest.resources?.tiles?.cachedTileCount || expected || 0);
  const bytes = Number(manifest.downloadedTileBytes || manifest.resources?.tiles?.tileBytes || 0);
  const size = bytes > 0 ? `，${formatByteSize(bytes)}` : '';
  return `${providerName}，${cached}/${expected} 張${size}`;
}

function formatMappackImportMeta(parsed) {
  const manifest = parsed?.manifest || {};
  const createdAt = manifest.createdAt ? new Date(manifest.createdAt).toLocaleString() : '—';
  const parts = [
    `來源:${manifest.generator || '—'}`,
    `建立:${createdAt}`,
  ];
  if (manifest.sharePreset) parts.push(`Preset:${exportPresetLabel(manifest.sharePreset)}`);
  if (parsed.hasGpx) {
    const routeBits = [manifest.route?.name || '路線'];
    if (manifest.route?.distanceM) routeBits.push(formatDistance(manifest.route.distanceM));
    if (manifest.includes?.weather) routeBits.push('含天氣');
    parts.push(`路線:${routeBits.join(' / ')}`);
  }
  if (parsed.hasTiles) parts.push(`離線包:${formatManifestTileSummary(manifest)}`);
  if (parsed.hasState) {
    const keyCount = manifest.resources?.state?.keyCount;
    parts.push(`設定:${Number.isFinite(Number(keyCount)) ? `${keyCount} 項` : '可還原'}`);
  }
  return parts.join(' · ');
}

async function openMappackImportModal(file) {
  try {
    const { MapPackImporter } = await ensureMapPackModules();
    const parsed = await MapPackImporter.parse(file);
    _pendingMappack = parsed;

    const restoreRoute = document.getElementById('mappack-restore-route');
    const restoreTiles = document.getElementById('mappack-restore-tiles');
    const restoreState = document.getElementById('mappack-restore-state');
    restoreRoute.checked = parsed.hasGpx;
    restoreRoute.disabled = !parsed.hasGpx;
    restoreRoute.parentElement.style.opacity = parsed.hasGpx ? '1' : '0.4';
    restoreTiles.checked = parsed.hasTiles;
    restoreTiles.disabled = !parsed.hasTiles;
    restoreTiles.parentElement.style.opacity = parsed.hasTiles ? '1' : '0.4';
    restoreState.checked = parsed.hasState;
    restoreState.disabled = !parsed.hasState;
    restoreState.parentElement.style.opacity = parsed.hasState ? '1' : '0.4';

    const tilesInfo = document.getElementById('mappack-import-tiles-info');
    if (tilesInfo) tilesInfo.textContent = parsed.hasTiles
      ? `（${formatManifestTileSummary(parsed.manifest)}）`
      : '';

    const meta = document.getElementById('mappack-import-meta');
    if (meta) {
      meta.textContent = formatMappackImportMeta(parsed);
    }

    document.body.classList.add('modal-open');
    mappackImportModal.classList.remove('hidden');
  } catch (err) {
    showNotification(err.message || '檔案解析失敗', 'error');
    console.error(err);
  }
}

document.getElementById('btn-mappack-import-confirm')?.addEventListener('click', async () => {
  if (!_pendingMappack) return;
  const restoreRoute = document.getElementById('mappack-restore-route').checked;
  const restoreTiles = document.getElementById('mappack-restore-tiles').checked;
  const restoreState = document.getElementById('mappack-restore-state').checked;

  if (!restoreRoute && !restoreTiles && !restoreState) {
    showNotification('至少需勾選一項', 'warning');
    return;
  }

  const parsed = _pendingMappack;
  _closeMappackImportModal(); // Centralized close path handles body class removal

  // Display-only progress (the pre-unification widget never locked editing
  // during restore either; route apply below drives its own busy tasks).
  const busyTask = beginRouteWeatherBusyTask({ title: '匯入離線地圖包', detail: '準備還原...', lockScope: 'none' });

  try {
    const { MapPackImporter } = await ensureMapPackModules();
    const applied = await MapPackImporter.apply(parsed, {
      restoreRoute,
      restoreTiles,
      restoreState,
      onProgress: (cur, total, phase) => {
        const pct = Math.round((cur / Math.max(total, 1)) * 100);
        busyTask.set({
          detail: phase === 'tiles' ? `還原圖磚 ${cur}/${total}` : '還原中...',
          progress: pct,
        });
      },
    });

    if (applied.layer) {
      mapManager.switchLayer(applied.layer);
      localStorage.setItem(LS_MAP_LAYER_KEY, applied.layer);
      layerBtns.forEach((b) => b.classList.toggle('active', b.dataset.layer === applied.layer));
      offlineManager.updateCacheInfo();
      setRouteLibraryTab('offline');
    }

    if (applied.stateApplied) {
      applySettingsFromStorage();
    }

    if (applied.gpxXml) {
      try {
        const { GpxExporter } = await ensureRouteExporters();
        const result = GpxExporter.parse(applied.gpxXml);
        await applyImportedResult(result);
      } catch (err) {
        showNotification('路線還原失敗', 'error');
        console.error('GPX parse failed during mappack import:', err);
      }
    }

    const parts = [];
    if (applied.gpxXml) parts.push('路線');
    if (applied.tileCount) {
      const tileSize = applied.tileBytes ? `，${formatByteSize(applied.tileBytes)}` : '';
      parts.push(`${applied.layer || '離線包'} ${applied.tileCount} 張圖磚${tileSize}`);
    }
    if (applied.stateApplied) parts.push('設定');
    showNotification(`離線地圖包匯入完成 (${parts.join('、') || '無'})`, 'success');
  } catch (err) {
    showNotification(err.message || '匯入失敗', 'error');
    console.error('Mappack apply failed:', err);
  } finally {
    busyTask.end();
    _pendingMappack = null;
  }
});

const LAYER_CYCLE_ORDER = ['streets', 'topo', 'satellite'];
const isMobileLayerMode = () => window.matchMedia('(max-width: 768px)').matches;

function normalizeMapLayerName(name) {
  return LAYER_CYCLE_ORDER.includes(name) ? name : 'topo';
}

function getPersistedMapLayer() {
  const raw = localStorage.getItem(LS_MAP_LAYER_KEY) || 'topo';
  const normalized = normalizeMapLayerName(raw);
  if (raw !== normalized) {
    localStorage.setItem(LS_MAP_LAYER_KEY, normalized);
  }
  return normalized;
}

function applyLayerSelection(name) {
  const layerName = normalizeMapLayerName(name);
  mapManager.switchLayer(layerName);
  localStorage.setItem(LS_MAP_LAYER_KEY, layerName);
  layerBtns.forEach((b) => b.classList.toggle('active', b.dataset.layer === layerName));
  const modal = document.getElementById('export-modal');
  if (modal && !modal.classList.contains('hidden')) updateMapPackTileOptionState();
}

document.addEventListener('mapping-elf:offline-map-source-activate', (event) => {
  const source = event.detail?.source;
  if (!source) return;
  const activated = mapManager.activateOfflineMapSource(source);
  if (!activated) {
    showNotification('此離線底圖尚未支援顯示', 'warning');
    return;
  }
  layerBtns.forEach((b) => b.classList.remove('active'));
  showNotification(`已切換離線底圖：${source.name || 'MBTiles'}`, 'success');
  const modal = document.getElementById('export-modal');
  if (modal && !modal.classList.contains('hidden')) updateMapPackTileOptionState();
});

document.addEventListener('mapping-elf:offline-map-source-delete', (event) => {
  const sourceId = event.detail?.sourceId;
  if (!sourceId) return;
  mapManager.removeOfflineMapSource(sourceId);
  layerBtns.forEach((b) => b.classList.toggle('active', b.dataset.layer === mapManager.currentLayerName));
});

function cycleLayer(step) {
  const cur = mapManager.currentLayerName;
  const i = LAYER_CYCLE_ORDER.indexOf(cur);
  const next = LAYER_CYCLE_ORDER[(i + step + LAYER_CYCLE_ORDER.length) % LAYER_CYCLE_ORDER.length];
  applyLayerSelection(next);
}

layerBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    // On mobile only the active button is visible — tapping it cycles to the next layer.
    if (isMobileLayerMode() && btn.dataset.layer === mapManager.currentLayerName) {
      cycleLayer(1);
      return;
    }
    applyLayerSelection(btn.dataset.layer);
  });
});

// Mobile: swipe left/right on the switcher to cycle layers.
const layerSwitcherEl = document.getElementById('layer-switcher');
if (layerSwitcherEl) {
  let tStartX = 0, tStartY = 0, tStartT = 0, tracking = false;
  layerSwitcherEl.addEventListener('touchstart', (e) => {
    if (!isMobileLayerMode() || e.touches.length !== 1) return;
    const t = e.touches[0];
    tStartX = t.clientX; tStartY = t.clientY; tStartT = Date.now();
    tracking = true;
  }, { passive: true });
  layerSwitcherEl.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - tStartX;
    const dy = t.clientY - tStartY;
    const dt = Date.now() - tStartT;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 600) {
      cycleLayer(dx < 0 ? 1 : -1);
      e.preventDefault();
    }
  });
  layerSwitcherEl.addEventListener('touchcancel', () => { tracking = false; });
}

routeModeRadios.forEach((radio) => {
  radio.addEventListener('change', (e) => {
    runOrDeferBusySetting('route-mode', () => {
      applyRouteMode(e.target.value);
      if (mapManager.waypoints.length >= 2) {
        onWaypointsChanged(mapManager.waypoints);
      } else {
        updateTimeStat();
        updateIntermediateMarkers();
        renderWeatherPanel();
      }
    });
  });
});


// =========== Core Logic ===========

// --- Computed-route session cache -----------------------------------------
// Re-planning on every page return (especially after a mobile background-kill
// reload) is slow and needs the network. When the route geometry hasn't changed
// we instead restore the previously computed alternatives from localStorage and
// redraw them directly — no routing/elevation round-trips. Weather is rebuilt
// from its own cache by renderWeatherPanel(), so it isn't duplicated here.
const LS_ROUTE_RESULT_KEY = 'mappingElf_routeResult';
const ROUTE_RESULT_MAX_BYTES = 3_000_000; // localStorage safety guard
// Set during init when a cached result matches the restored waypoints; consumed
// once by the next onWaypointsChanged so it restores instead of re-planning.
let pendingRouteRestore = null;

// In-memory (session-only) route-result cache keyed by routeStateSignature, so
// hopping between favourites/current route (e.g. via loadFavorite or the 3D
// player) reuses an already-computed route instead of re-hitting OSRM whenever
// the waypoints/mode/loop-settings genuinely haven't changed since we last saw
// them this session — the persisted LS_ROUTE_RESULT_KEY single slot only ever
// helps the very first route after a reload, not subsequent in-session switches.
const routeResultSessionCache = new Map();
const ROUTE_RESULT_SESSION_CACHE_MAX = 20;

function cacheRouteResultForSession(signature, alternatives, selectedAltIndex) {
  routeResultSessionCache.set(signature, { signature, savedAt: Date.now(), alternatives, selectedAltIndex });
  if (routeResultSessionCache.size > ROUTE_RESULT_SESSION_CACHE_MAX) {
    const oldestKey = routeResultSessionCache.keys().next().value;
    routeResultSessionCache.delete(oldestKey);
  }
}

// Stable signature of everything that determines the routed geometry: the
// waypoints plus the routing mode and round-trip / O-loop flags.
function routeStateSignature(waypoints) {
  const wps = (waypoints || []).map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join('|');
  return `${wps}#${routeEngine.mode}|${roundTripMode ? 'rt' : ''}${oLoopMode ? 'ol' : ''}`;
}

// Keep only the fields the redraw/selection path actually reads, so the cached
// payload stays as small as possible.
function trimAlternativeForCache(r) {
  return {
    coords: r.coords,
    sampledCoords: r.sampledCoords,
    elevations: r.elevations,
    fullElevations: r.fullElevations,
    distance: r.distance,
    ascent: r.ascent,
    descent: r.descent,
    maxElev: r.maxElev,
    minElev: r.minElev,
    startElev: r.startElev,
    endElev: r.endElev,
    turnaroundElev: r.turnaroundElev,
    score: r.score,
    label: r.label,
    index: r.index,
  };
}

function persistRouteResult() {
  try {
    // Imported tracks restore via their own session (LS_IMPORTED_TRACK_KEY).
    if (importedTrackMode) return;
    const wps = mapManager.waypoints;
    if (!wps || wps.length < 2 || !allAlternatives.length) {
      localStorage.removeItem(LS_ROUTE_RESULT_KEY);
      return;
    }
    const signature = routeStateSignature(wps);
    const full = allAlternatives.map(trimAlternativeForCache);
    const selected = full[selectedAltIndex] ? [full[selectedAltIndex]] : full.slice(0, 1);
    // No size constraint in memory (unlike the localStorage payload below), so
    // the session cache always keeps the full alternative set.
    cacheRouteResultForSession(signature, full, selectedAltIndex);
    // Prefer caching all alternatives; fall back to just the selected route if the
    // full set is too large for localStorage; give up if even that's too big.
    const variants = [
      { alternatives: full, selectedAltIndex },
      { alternatives: selected, selectedAltIndex: 0 },
    ];
    for (const v of variants) {
      const payload = JSON.stringify({ signature, savedAt: Date.now(), ...v });
      if (payload.length <= ROUTE_RESULT_MAX_BYTES) {
        localStorage.setItem(LS_ROUTE_RESULT_KEY, payload);
        return;
      }
    }
    localStorage.removeItem(LS_ROUTE_RESULT_KEY);
  } catch (_) {
    try { localStorage.removeItem(LS_ROUTE_RESULT_KEY); } catch (__) { /* noop */ }
  }
}

function clearRouteResultCache() {
  try { localStorage.removeItem(LS_ROUTE_RESULT_KEY); } catch (_) { /* noop */ }
}

// Return the cached computed route iff it matches these waypoints, else null.
function loadMatchingRouteResult(waypoints) {
  try {
    const raw = localStorage.getItem(LS_ROUTE_RESULT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.alternatives) || !data.alternatives.length) return null;
    if (data.signature !== routeStateSignature(waypoints)) return null;
    return data;
  } catch { return null; }
}

// Compute the round-trip / O-loop turnaround the same way the planning path does.
function computeTurnaroundLatLng(wps) {
  const isLoop = wps.length >= 3 && haversineDistance(wps[0], wps[wps.length - 1]) < 0.1;
  const actualOLoop = oLoopMode || (isLoop && !roundTripMode);
  if (roundTripMode && wps.length >= 2) return wps[wps.length - 1];
  if (actualOLoop && wps.length >= 2) {
    if (isLoop) {
      let maxD = 0;
      let turn = null;
      for (let i = 1; i < wps.length - 1; i++) {
        const d = haversineDistance(wps[0], wps[i]);
        if (d > maxD) { maxD = d; turn = wps[i]; }
      }
      return turn || wps[Math.floor(wps.length / 2)];
    }
    return wps[wps.length - 1];
  }
  return null;
}

// Redraw a cached computed route without re-planning. Falls back to a normal
// re-plan if anything is missing or throws, so the worst case is current behaviour.
async function applyRestoredRouteResult(restore) {
  try {
    allAlternatives = Array.isArray(restore.alternatives) ? restore.alternatives : [];
    if (!allAlternatives.length) { debouncedCalculateRoute(mapManager.waypoints); return; }
    selectedAltIndex = Math.min(Math.max(0, restore.selectedAltIndex || 0), allAlternatives.length - 1);

    const turnaround = computeTurnaroundLatLng(mapManager.waypoints);
    mapManager.drawMultipleRoutes(allAlternatives, selectedAltIndex, roundTripMode, turnaround);
    renderAlternatives(allAlternatives, selectedAltIndex);
    const ok = await selectAlternative(selectedAltIndex);
    if (!ok) debouncedCalculateRoute(mapManager.waypoints);
    else showNotification('已沿用先前規劃的路線', 'info', 1500);
  } catch (err) {
    console.warn('route restore failed, re-planning:', err);
    debouncedCalculateRoute(mapManager.waypoints);
  }
}

async function onWaypointsChanged(waypoints) {
  cancelWeatherFetchForRouteReplan();
  cancelCatchmentFetchForRouteReplan();
  ensureWaypointIds();
  bumpWaypointVersion();
  invalidateRoutePlanRun();
  geocodeRunSeq += 1;
  // Record this state change for undo/redo (no-op if suppressed or unchanged).
  historyRecord();
  syncRouteHeaderButtons();

  // Detect if exactly one waypoint was added (not moved or removed)
  if (waypoints.length === lastWaypoints.length + 1) {
    let diffIdx = -1;
    for (let i = 0; i < lastWaypoints.length; i++) {
        if (waypoints[i][0] !== lastWaypoints[i][0] || waypoints[i][1] !== lastWaypoints[i][1]) {
            diffIdx = i;
            break;
        }
    }
    if (diffIdx === -1) diffIdx = lastWaypoints.length; // Added at end
    pendingNewWaypointIndex = diffIdx;
  } else {
    pendingNewWaypointIndex = null;
  }
  lastWaypoints = waypoints.map(w => [...w]);

  if (importedTrackMode) {
    // Re-render labels locally and sync to map markers
    const labels = waypoints.map((wp, i) => getWaypointLabel(i, wp[0], wp[1]));
    mapManager.setWaypointLabels(labels);

    updateWaypointList(waypoints);
    if (!skipAutoGeocode) geocodeWaypoints(waypoints);
    // Re-render weather table and elevation chart markers when waypoints change
    // (e.g. user adds a new point by clicking the map while in track mode).
    renderWeatherPanel();
    return;
  }

  localStorage.setItem(LS_WAYPOINTS_KEY, JSON.stringify(waypoints));
  clearAllHighlights();
  // Clear stale cumulative distances so the sidebar shows no labels until
  // the new route is computed and buildWeatherPoints() populates fresh values.
  waypointCumDistM = [];

  // Sync labels to map markers immediately (before route calculation)
  const labels = waypoints.map((wp, i) => getWaypointLabel(i, wp[0], wp[1]));
  mapManager.setWaypointLabels(labels);

  // Update UI list immediately for responsive feel
  updateWaypointList(waypoints);
  // Geocode any waypoints not yet named (fire-and-forget)
  if (!skipAutoGeocode) geocodeWaypoints(waypoints);

  if (waypoints.length < 2) {
    // No routable geometry anymore — drop any cached computed route.
    pendingRouteRestore = null;
    clearRouteResultCache();
    if (waypoints.length === 1) {
      // Just 1 point, no route, but we still want to show weather
      mapManager.clearRoute();
      elevationProfile.clear();
      resetStats();
      hideAlternatives();
      setCurrentRouteData([], []);
      allAlternatives = [];
      renderWeatherPanel();
      autoFetchWeather({ force: false });
    } else {
      // 0 waypoints -> Definitely not in imported track mode anymore
      importedTrackMode = false;
      importedIntermediatePoints = [];
      importedWaypointMeta = [];
      clearImportedTrackSession();
      syncTrackModeUI();

      mapManager.clearRoute();
      elevationProfile.clear();
      resetStats();
      hideAlternatives();
      setCurrentRouteData([], []);
      allAlternatives = [];
      const _wc = document.getElementById('weather-table-container');
      if (_wc) _wc.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「更新天氣」</p></div>';
    }
    return;
  }

  // Page-return shortcut: if a cached computed route matches these exact
  // waypoints (set up by the init restore), redraw it instead of re-planning.
  if (pendingRouteRestore) {
    const restore = pendingRouteRestore;
    pendingRouteRestore = null;
    if (restore.signature === routeStateSignature(waypoints)) {
      applyRestoredRouteResult(restore);
      return;
    }
  }

  // Switching back to a route already computed earlier this session (e.g.
  // hopping between favourites, or back to the current route) with unchanged
  // waypoints/mode/loop-settings — reuse it instead of re-hitting OSRM.
  const routeSig = routeStateSignature(waypoints);
  const sessionCached = routeResultSessionCache.get(routeSig);
  if (sessionCached) {
    applyRestoredRouteResult(sessionCached);
    return;
  }

  // Use debounced version for the heavy OSRM calculation
  debouncedCalculateRoute(waypoints);
}

const debouncedCalculateRoute = debounce(async (waypoints) => {
  if (isProcessing) {
    pendingUpdate = true;
    return;
  }

  cancelWeatherFetchForRouteReplan();
  cancelCatchmentFetchForRouteReplan();
  isProcessing = true;
  pendingUpdate = false;
  const routePlanSnapshot = createRoutePlanSnapshot(waypoints);
  const busyTask = beginRouteWeatherBusyTask({
    title: '正在規劃路線',
    detail: '準備路線與高度資料...',
    progress: 8,
    centerBrand: true,
  });

  try {
    showNotification('規劃最佳路徑中...', 'info', 1500);

    busyTask.set({ detail: '清除舊的天氣圖示...', progress: 15 });

    // Clear stale weather icons while recalculating
    mapManager.clearWaypointWeather();

    // Get all alternative routes (with elevation already fetched)
    busyTask.set({ detail: '取得路線與高度資料...', progress: 35 });
    const isLoop = waypoints.length >= 3 && haversineDistance(waypoints[0], waypoints[waypoints.length - 1]) < 0.1;
    const routeWaypoints = roundTripMode && waypoints.length >= 2
      ? [...waypoints, ...waypoints.slice(0, -1).reverse()]
      : (oLoopMode && !isLoop && waypoints.length >= 2)
        ? [...waypoints, waypoints[0]]
        : waypoints;
    const routeAlternatives = await routeEngine.getAlternativeRoutes(routeWaypoints);
    if (isRoutePlanSnapshotStale(routePlanSnapshot)) {
      emitTestEvent('route-plan-stale-discard', {
        waypointCount: mapManager.waypoints.length,
        importedTrackMode,
      });
      pendingUpdate = true;
    } else {
      allAlternatives = routeAlternatives;
    }
    busyTask.set({ detail: '繪製路線與高度圖...', progress: 72 });

    if (!isRoutePlanSnapshotStale(routePlanSnapshot) && allAlternatives.length > 0) {
      // Draw all routes on map with continuous gradient coloring.
      // For round-trip / O-loop, the calculated turnaround point marks the return-leg split.
      let turnaroundLatLng = null;
      const actualOLoop = oLoopMode || (isLoop && !roundTripMode);
      if (roundTripMode && waypoints.length >= 2) {
        turnaroundLatLng = waypoints[waypoints.length - 1];
      } else if (actualOLoop && waypoints.length >= 2) {
        if (isLoop) {
          let maxD = 0;
          for (let i = 1; i < waypoints.length - 1; i++) {
            const d = haversineDistance(waypoints[0], waypoints[i]);
            if (d > maxD) { maxD = d; turnaroundLatLng = waypoints[i]; }
          }
          if (!turnaroundLatLng) turnaroundLatLng = waypoints[Math.floor(waypoints.length / 2)];
        } else {
          turnaroundLatLng = waypoints[waypoints.length - 1];
        }
      }
      mapManager.drawMultipleRoutes(allAlternatives, 0, roundTripMode, turnaroundLatLng);

      // Show alternatives panel
      renderAlternatives(allAlternatives, 0);

      // Select the best route by default
      const selected = await selectAlternative(0, {
        isStale: () => isRoutePlanSnapshotStale(routePlanSnapshot),
      });
      if (!selected || isRoutePlanSnapshotStale(routePlanSnapshot)) {
        pendingUpdate = true;
      } else {
        busyTask.set({ detail: '更新路線統計與天氣欄位...', progress: 94 });

        const altMsg = allAlternatives.length > 1
          ? `找到 ${allAlternatives.length} 組建議路徑`
          : '已規劃最佳路徑';
        showNotification(altMsg, 'success', 2000);
        // Cache the computed result so a later page return can skip re-planning.
        persistRouteResult();
      }
    } else if (!isRoutePlanSnapshotStale(routePlanSnapshot)) {
      showNotification('找不到合適路徑', 'warning');
    }
  } catch (err) {
    const message = getRoutePlanningErrorMessage(err);
    if (!isRoutePlanSnapshotStale(routePlanSnapshot) && message) {
      console.error('Route processing error:', err);
      showNotification(message, 'error');
    } else {
      pendingUpdate = true;
    }
  }

  isProcessing = false;
  busyTask.set({ detail: '完成', progress: 100 });

  const shouldRunPendingRoute = pendingUpdate
    && !importedTrackMode
    && mapManager.waypoints.length >= 2;
  if (shouldRunPendingRoute) {
    busyTask.end();
    debouncedCalculateRoute(mapManager.waypoints);
  } else {
    pendingUpdate = false;
    busyTask.end();
  }
}, 500);

/**
 * Select a specific alternative route
 */
async function selectAlternative(index, options = {}) {
  const isStale = typeof options.isStale === 'function' ? options.isStale : () => false;
  if (index >= allAlternatives.length || isStale()) return false;

  selectedAltIndex = index;
  const route = allAlternatives[index];
  if (isStale()) return false;

  if (options.isStale) {
    await elevationProfile.load();
    if (isStale()) return false;
  }

  setCurrentRouteData(route.coords, route.fullElevations || route.elevations);

  // Update map selection - set triggeredByUI to true to prevent recursion
  mapManager.selectRoute(allAlternatives, index, true);

  // Update elevation chart with pre-fetched data
  const wps = mapManager.waypoints;
  const isLoop = wps.length >= 3 && haversineDistance(wps[0], wps[wps.length - 1]) < 0.1;
  const actualOLoop = oLoopMode || (isLoop && !roundTripMode);
  let turnaroundLL = null;
  if (roundTripMode && wps.length >= 2) {
    turnaroundLL = wps[wps.length - 1];
  } else if (actualOLoop && wps.length >= 2) {
    if (isLoop) {
      let maxD = 0;
      for (let i = 1; i < wps.length - 1; i++) {
        const d = haversineDistance(wps[0], wps[i]);
        if (d > maxD) { maxD = d; turnaroundLL = wps[i]; }
      }
      if (!turnaroundLL) turnaroundLL = wps[Math.floor(wps.length / 2)];
    } else {
      turnaroundLL = wps[wps.length - 1];
    }
  }
  await elevationProfile.updateWithData(route.sampledCoords, route.elevations, roundTripMode, turnaroundLL);
  if (isStale()) return false;

  // Update stats from pre-calculated route data
  const epStats = elevationProfile._calcStats();
  statDistance.textContent = formatDistance(route.distance);
  updateElevationStats(epStats);

  // Update card selection highlight
  renderAlternatives(allAlternatives, index);

  // Update pace time stat (needs elevation data from profile, available after updateWithData)
  updateTimeStat();

  // Render weather panel and intermediate markers
  renderWeatherPanel();

  // Automatically fetch weather data whenever the route is finalized.
  // We trigger a general auto-fetch (force:false) so that all points (new waypoints,
  // return waypoints, and intermediate points) get weather info if missing.
  autoFetchWeather({ force: false });
  // Mirror the same auto-load for 集水區: if the catchment view is open, backfill
  // the newly-planned points (deferred internally until this plan/weather settles).
  autoFetchCatchment();
  pendingNewWaypointIndex = null;
  return true;
}

/**
 * Render alternative route cards in the side panel
 */
function renderAlternatives(routes, selectedIdx) {
  if (!routes || routes.length === 0) {
    hideAlternatives();
    return;
  }

  alternativesList.style.display = routes.length > 1 ? 'flex' : 'none';
  altCount.style.display = routes.length > 1 ? 'inline-block' : 'none';
  altCount.textContent = `${routes.length} 條方案`;

  alternativesList.innerHTML = routes.map((r, i) => `
    <div class="alt-card ${i === selectedIdx ? 'selected' : ''}" data-color="${i}" data-index="${i}">
      <div class="alt-card-header" style="margin-bottom: 0;">
        <span class="alt-color-dot"></span>
        <span class="alt-card-label">${_escapeHtml(r.label)}</span>
        ${i === 0 ? '<span class="alt-badge">推薦</span>' : ''}
      </div>
    </div>
  `).join('');

  // Bind click events
  alternativesList.querySelectorAll('.alt-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      selectAlternative(idx);
      // selectedAltIndex is updated synchronously at the top of selectAlternative,
      // so persist the new selection for the page-return shortcut.
      persistRouteResult();
    });
  });
}

function hideAlternatives() {
  alternativesList.style.display = 'none';
  altCount.style.display = 'none';
  alternativesList.innerHTML = '';
  allAlternatives = [];
  selectedAltIndex = 0;
}

function updateWaypointList(waypoints) {
  updateRouteLibraryCurrent();
  const frozen = !!importedTrackMode || isRouteWeatherBusy();
  // While a data load holds the relaxed lock, the only in-list edit allowed is
  // deleting the LAST waypoint — surface just that one button (marked
  // .wp-remove-live so the busy disable-selector skips it).
  const dataLoadEdit = isDataLoadEditMode();
  if (waypoints.length === 0) {
    waypointList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="40" height="40" opacity="0.4"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>
        <p>在地圖上點擊以新增航點</p>
        <span class="hint">點擊地圖任意位置開始規劃路線</span>
      </div>`;
    return;
  }

  waypointList.innerHTML = waypoints
    .map((wp, i) => {
      let cls = '';
      if (i === 0 && waypoints.length > 1) cls = 'start';
      else if (i === waypoints.length - 1 && waypoints.length > 1) cls = 'end';
      const placeName = getPlaceName(wp[0], wp[1]);
      const coords = formatCoords(wp[0], wp[1]);
      const n = waypoints.length;
      const gradColor = waypointGradColors[i]
        || interpolateRouteColor(n > 1 ? i / (n - 1) : 0);

      // Consistently resolve label
      const pt = weatherPoints.find(p => p.isWaypoint && !p.isReturn && p.wpIndex === i);
      const displayName = pt ? pt.label : getWaypointLabel(i, wp[0], wp[1]);
      const safeDisplayName = _escapeHtml(displayName);
      const cumM = waypointCumDistM[i];
      const distLabel = (cumM != null && cumM > 0) ? formatDistance(cumM) : '';
      const isLast = i === waypoints.length - 1;
      // Data-load-edit: last row shows a single delete-last button; all other rows
      // show no actions. Normal/full-frozen keep the existing up/down/remove set.
      const actionsHtml = dataLoadEdit
        ? (isLast
            ? `<div class="wp-actions">
            <button class="wp-action wp-remove wp-remove-live" data-index="${i}" title="刪除最後航點">×</button>
          </div>`
            : '')
        : `<div class="wp-actions" style="${frozen ? 'display:none' : ''}">
            <button class="wp-action wp-up" data-index="${i}" title="向上移" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="wp-action wp-down" data-index="${i}" title="向下移" ${isLast ? 'disabled' : ''}>↓</button>
            <button class="wp-action wp-remove" data-index="${i}" title="移除">×</button>
          </div>`;
      return `
        <div class="waypoint-item ${frozen && !dataLoadEdit ? 'is-frozen' : ''}">
          <span class="wp-index ${cls}" style="background:${gradColor}">${i + 1}</span>
          <span class="wp-coords" title="單擊高亮" style="color:${gradColor}">
            <span class="wp-place-name">${safeDisplayName}</span>
            ${distLabel ? `<span class="wp-cum-dist">${distLabel}</span>` : ''}
          </span>
          ${actionsHtml}
        </div>`;
    })
    .join('');

  // Click on waypoint row (not on action buttons) → cross-view highlight
  waypointList.querySelectorAll('.waypoint-item').forEach((item, wpIndex) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.wp-actions')) return;
      if (item._justHighlighted) {
        item._justHighlighted = false;
        return;
      }
      const colIdx = weatherPoints.findIndex(p => p.isWaypoint && !p.isReturn && p.wpIndex === wpIndex);
      if (colIdx >= 0) {
        // Requirement 4: Toggle highlight on single click
        highlightPoint(colIdx, true);
      } else {
        // Route not yet calculated — still highlight map + panel
        mapManager.highlightWaypoint(wpIndex);
        waypointList.querySelectorAll('.waypoint-item').forEach(el => el.classList.remove('wp-highlight'));
        item.classList.add('wp-highlight');
      }
    });
  });

  waypointList.querySelectorAll('.wp-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      mapManager.removeWaypoint(parseInt(e.target.dataset.index));
    });
  });

  waypointList.querySelectorAll('.wp-up').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      if (idx > 0) mapManager.moveWaypoint(idx, -1);
    });
  });

  waypointList.querySelectorAll('.wp-down').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      if (idx < waypoints.length - 1) mapManager.moveWaypoint(idx, 1);
    });
  });

  // Double-click on place name in sidebar → inline edit
  waypointList.querySelectorAll('.wp-place-name').forEach((nameEl) => {
    const item = nameEl.closest('.waypoint-item');
    const wpIndex = Array.from(waypointList.querySelectorAll('.waypoint-item')).indexOf(item);
    const wp = waypoints[wpIndex];
    if (!wp) return;
    nameEl.title = '雙擊編輯名稱';
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (frozen) {
        if (isRouteWeatherBusy()) showRouteWeatherBusyNotice();
        else showImportedTrackEditNotice();
        return;
      }
      if (nameEl.querySelector('input')) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = getEffectiveName(wp[0], wp[1]) || nameEl.textContent.trim();
      input.className = 'wp-name-edit-input';
      nameEl.innerHTML = '';
      nameEl.appendChild(input);
      input.focus();
      input.select();
      let saved = false;
      const commit = () => {
        if (saved) return;
        saved = true;
        saveCustomName(wp[0], wp[1], input.value.trim());
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e2) => {
        if (e2.key === 'Enter') { e2.preventDefault(); input.blur(); }
        if (e2.key === 'Escape') { saved = true; input.removeEventListener('blur', commit); _applyPlaceNameToDOM(); }
      });
    });
  });

  // --- Drag-and-drop sorting & Removal support ---
  let dragItem = null;
  let dragIndex = -1;
  let lpTimer = null;
  let ghost = null;
  let placeholder = null;
  let lastDragClientX = null;
  let lastDragClientY = null;
  let dragCancelledByMultiTouch = false;

  const startDrag = (item, idx, clientX, clientY) => {
    dragItem = item;
    dragIndex = idx;
    dragCancelledByMultiTouch = false;
    lastDragClientX = clientX;
    lastDragClientY = clientY;
    item.classList.add('is-dragging');
    document.body.classList.add('route-list-dragging');
    platform.vibrate(40);

    // Create placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'waypoint-placeholder';
    placeholder.style.height = `${item.offsetHeight}px`;
    placeholder.style.marginBottom = '6px';
    item.parentNode.insertBefore(placeholder, item.nextSibling);

    // Create ghost for visual feedback
    ghost = item.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${item.offsetWidth}px`;
    ghost.style.position = 'fixed';
    ghost.style.zIndex = '10010';
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = '0.8';
    document.body.appendChild(ghost);
    updateGhostPos(clientX, clientY);

    item.style.display = 'none';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);

    // Show trash zone when sidebar drag starts
    mapManager.showTrashZone('list');
  };

  const updateGhostPos = (x, y) => {
    if (!ghost) return;
    ghost.style.left = `${x - 20}px`;
    ghost.style.top = `${y - 20}px`;
  };

  const onMove = (e) => {
    if (e.touches && e.touches.length !== 1) {
      dragCancelledByMultiTouch = true;
      if (e.cancelable) e.preventDefault();
      onEnd(e);
      return;
    }
    if (e.cancelable) e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    lastDragClientX = cx;
    lastDragClientY = cy;
    updateGhostPos(cx, cy);

    // Drop-zone detection: mirrors map waypoint dragging (cancel / remove).
    const dropAction = mapManager.getTrashZoneDropAction(cx, cy);
    const overTrash = dropAction === 'delete';
    const overCancel = dropAction === 'cancel';
    mapManager.updateTrashZoneHover(cx, cy);
    if (ghost) {
      ghost.classList.toggle('drag-to-remove', overTrash);
      ghost.classList.toggle('drag-to-cancel', overCancel);
    }

    if (dropAction) return;

    // Sorting logic (only if not over trash)
    const rect = sidePanel.getBoundingClientRect();
    const inSidePanel = cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
    
    if (inSidePanel) {
      const items = Array.from(waypointList.querySelectorAll('.waypoint-item:not(.is-dragging)'));
      let bestAfter = null;
      let minDist = Infinity;
      items.forEach(it => {
        const r = it.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const d = Math.abs(cy - mid);
        if (d < minDist) {
          minDist = d;
          bestAfter = (cy < mid) ? it : it.nextSibling;
        }
      });
      
      if (bestAfter !== placeholder) {
        waypointList.insertBefore(placeholder, bestAfter);
      }
    }
  };

  const onEnd = (e) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onEnd);
    document.body.classList.remove('route-list-dragging');
    const cancelledByMultiTouch = dragCancelledByMultiTouch || e.type === 'touchcancel';
    dragCancelledByMultiTouch = false;

    const changedTouch = e.changedTouches?.[0];
    const cx = changedTouch?.clientX ?? e.clientX ?? lastDragClientX;
    const cy = changedTouch?.clientY ?? e.clientY ?? lastDragClientY;
    
    const dropAction = mapManager.getTrashZoneDropAction(cx, cy);
    const isCancelDrop = dropAction === 'cancel';
    const isOverTrash = dropAction === 'delete';
    mapManager.hideTrashZone();

    if (cancelledByMultiTouch || isCancelDrop) {
      updateWaypointList(mapManager.waypoints);
    } else if (isOverTrash) {
      platform.vibrate([20, 40, 20]);
      mapManager.removeWaypoint(dragIndex);
    } else {
      const items = Array.from(waypointList.children);
      const placeholderIdx = items.indexOf(placeholder);
      let targetIdx = 0;
      for (let i = 0; i < placeholderIdx; i++) {
        if (items[i].classList.contains('waypoint-item') && items[i] !== dragItem) {
          targetIdx++;
        }
      }

      const offset = targetIdx - dragIndex;
      if (offset !== 0) {
        mapManager.moveWaypointTo(dragIndex, targetIdx);
      } else {
        updateWaypointList(mapManager.waypoints);
      }
      
      // Highlight the moved/dropped waypoint at its new position
      const itemsAfter = Array.from(waypointList.querySelectorAll('.waypoint-item'));
      const finalIdx = itemsAfter.indexOf(dragItem);
      if (finalIdx >= 0) {
        const colIdx = weatherPoints.findIndex(p => p.isWaypoint && !p.isReturn && p.wpIndex === finalIdx);
        if (colIdx >= 0) highlightPoint(colIdx);
        else mapManager.highlightWaypoint(finalIdx);
      }
    }

    if (ghost) ghost.remove();
    if (placeholder) placeholder.remove();
    dragItem = null;
    ghost = null;
    placeholder = null;
    lastDragClientX = null;
    lastDragClientY = null;
  };

  waypointList.querySelectorAll('.waypoint-item').forEach((item, idx) => {
    let startX = 0, startY = 0;
    
    const triggerLP = (clientX, clientY) => {
      startX = clientX;
      startY = clientY;
      lpTimer = setTimeout(() => {
        lpTimer = null;
        startDrag(item, idx, clientX, clientY);
      }, 500);
    };
    
    const cancelLP = () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    };

    const checkMove = (clientX, clientY) => {
      if (!lpTimer) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (dx * dx + dy * dy > 64) cancelLP();
    };

    item.addEventListener('mousedown', (e) => {
      if (frozen) {
        if (e.button === 0 && !e.target.closest('.wp-actions')) {
          lpTimer = setTimeout(() => {
            lpTimer = null;
            if (isRouteWeatherBusy()) showRouteWeatherBusyNotice();
            else showImportedTrackEditNotice();
          }, 500);
          const clearFrozenTimer = () => {
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            document.removeEventListener('mouseup', clearFrozenTimer);
            document.removeEventListener('mousemove', clearFrozenTimer);
          };
          document.addEventListener('mouseup', clearFrozenTimer);
          document.addEventListener('mousemove', clearFrozenTimer);
        }
        return;
      }
      if (e.button !== 0 || e.target.closest('.wp-actions')) return;
      triggerLP(e.clientX, e.clientY);
      
      const onMoveGuard = (ev) => checkMove(ev.clientX, ev.clientY);
      const onUp = () => { 
        cancelLP(); 
        document.removeEventListener('mousemove', onMoveGuard);
        document.removeEventListener('mouseup', onUp); 

        // If not already highlighted, highlight on release
        if (!item.classList.contains('wp-highlight')) {
          const colIdx = weatherPoints.findIndex(p => p.isWaypoint && !p.isReturn && p.wpIndex === idx);
          if (colIdx >= 0) {
            highlightPoint(colIdx);
          } else {
            mapManager.highlightWaypoint(idx);
            waypointList.querySelectorAll('.waypoint-item').forEach(el => el.classList.remove('wp-highlight'));
            item.classList.add('wp-highlight');
          }
          item._justHighlighted = true;
        }
      };
      document.addEventListener('mousemove', onMoveGuard);
      document.addEventListener('mouseup', onUp);
    });

    item.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) {
        cancelLP();
        return;
      }
      if (frozen) {
        if (!e.target.closest('.wp-actions')) {
          lpTimer = setTimeout(() => {
            lpTimer = null;
            if (isRouteWeatherBusy()) showRouteWeatherBusyNotice();
            else showImportedTrackEditNotice();
          }, 500);
        }
        return;
      }
      if (e.target.closest('.wp-actions')) return;
      const t = e.touches[0];
      triggerLP(t.clientX, t.clientY);
    }, { passive: true });
    
    item.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) {
        cancelLP();
        return;
      }
      const t = e.touches[0];
      checkMove(t.clientX, t.clientY);
    }, { passive: true });

    item.addEventListener('touchend', cancelLP, { passive: true });
    item.addEventListener('touchcancel', cancelLP, { passive: true });
  });
}

function resetStats() {
  statDistance.textContent = '—';
  statAscent.textContent = '—';
  statDescent.textContent = '—';
  statMaxElev.textContent = '—';
  statMinElev.textContent = '—';
  if (statStartElev) statStartElev.textContent = '—';
  if (statEndElev) statEndElev.textContent = '—';
  if (statTime) statTime.textContent = '—';
  if (statKcal) statKcal.textContent = '—';
  if (statIntake) statIntake.textContent = '—';
  updateRouteLibraryCurrent();
}

/** Update the elevation stats in the side panel grid */
function updateElevationStats(stats) {
  if (!stats) return;
  
  if (statAscent) statAscent.textContent = formatElevation(stats.ascent);
  if (statDescent) statDescent.textContent = formatElevation(stats.descent);
  if (statMaxElev) statMaxElev.textContent = formatElevation(stats.maxElev);
  if (statMinElev) statMinElev.textContent = formatElevation(stats.minElev);

  if (statStartElev && statEndElev) {
    if (stats.turnaroundElev !== null) {
      // Loop or Round-trip
      if (labelStartElev) labelStartElev.textContent = '起終點海拔';
      if (labelEndElev) labelEndElev.textContent = '折返點海拔';
      statStartElev.textContent = formatElevation(stats.startElev);
      statEndElev.textContent = formatElevation(stats.turnaroundElev);
    } else {
      // One-way
      if (labelStartElev) labelStartElev.textContent = '起點海拔';
      if (labelEndElev) labelEndElev.textContent = '終點海拔';
      statStartElev.textContent = formatElevation(stats.startElev);
      statEndElev.textContent = formatElevation(stats.endElev);
    }
  }
}

// =========== Pace / Speed Interval ===========

/** Compute total travel time and calorie stats for the current route. */
function updateTimeStat() {
  if ((!speedIntervalMode && segmentIntervalKm === 0) || !statTime || !statTimeCard) return;
  const pts = elevationProfile.points;
  const elevs = elevationProfile.elevations;
  const dists = elevationProfile.distances;
  if (!pts || pts.length < 2 || !elevs.length) {
    statTime.textContent = '—';
    if (statKcal) statKcal.textContent = '—';
    if (statIntake) statIntake.textContent = '—';
    updateRouteLibraryCurrent();
    return;
  }
  const pace = getPaceComputation(elevs, dists);
  const times = pace.times;
  const totalH = times[times.length - 1] || 0;
  statTime.textContent = formatDuration(totalH, getLanguage());

  if (!shouldShowEnergyStats()) {
    if (statKcal) statKcal.textContent = '—';
    if (statIntake) statIntake.textContent = '—';
    syncPaceActivityApplicabilityUi();
    updateRouteLibraryCurrent();
    return;
  }

  const trip = pace.trip;
  if (statKcal) statKcal.textContent = `${trip.kcalExpended.toLocaleString()} kcal`;
  if (statIntake) statIntake.textContent = `${trip.kcalSuggested.toLocaleString()} kcal`;
  syncPaceActivityApplicabilityUi();
  updateRouteLibraryCurrent();
}

/** Convert a column header's current date+hour to milliseconds (local time). */
function colToMs(th) {
  const idx = th.dataset.idx;
  if (idx === undefined) return 0;
  const container = th.closest('#weather-table-container');
  const d = container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`)?.value || '';
  const h = parseInt(container.querySelector(`.wt-th-time[data-idx="${idx}"] .wt-time-select`)?.value ?? '0');
  if (!d) return 0;
  return new Date(d + 'T00:00:00').getTime() + h * 3600000;
}

/** Set a column header's date/time from a millisecond value (local time). */
function setColToMs(th, ms) {
  const idx = th.dataset.idx;
  if (idx === undefined) return;
  const d = new Date(Math.max(0, ms));
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const container = th.closest('#weather-table-container');
  const di = container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`);
  const hs = container.querySelector(`.wt-th-time[data-idx="${idx}"] .wt-time-select`);
  if (di) di.value = `${y}-${mo}-${dy}`;
  if (hs) hs.value = String(d.getHours());
}

function getWeatherDateHead(container, idx) {
  return container?.querySelector?.(`.wt-th-date[data-idx="${idx}"]`) || null;
}

function findAdjacentWaypointIndex(idx, direction) {
  for (let i = idx + direction; i >= 0 && i < weatherPoints.length; i += direction) {
    if (weatherPoints[i]?.isWaypoint) return i;
  }
  return -1;
}

/** Add elapsedH hours to a date/hour, returning the new { date, hour }. */
function addHoursToDateTime(dateStr, startHour, elapsedH) {
  const totalMins = startHour * 60 + Math.round(elapsedH * 60);
  const addDays = Math.floor(totalMins / (24 * 60));
  const finalHour = ((Math.floor(totalMins / 60) % 24) + 24) % 24;
  // Use noon to avoid DST-boundary issues
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + addDays);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return { date: `${y}-${mo}-${dy}`, hour: finalHour };
}

/**
 * Reset all waypoint dates/times based on a reference anchor (highlighted col
 * or col 0) using the pace-derived elapsed times. Overrides all manual edits
 * to bring the trip back to its "calculated" timing.
 */
function resetPaceToAnchor() {
  const container = document.getElementById('weather-table-container');
  if (!container || weatherPoints.length === 0) return;

  // 1. Identify anchor: Highlighted col OR col 0
  const highlightedTh = container.querySelector('.wt-col-head.wt-col-highlight');
  let anchorIdx = 0;
  if (highlightedTh) {
    anchorIdx = parseInt(highlightedTh.dataset.idx);
  }

  const anchorPt = weatherPoints[anchorIdx];
  const anchorDate = container.querySelector(`.wt-th-date[data-idx="${anchorIdx}"] .wt-date-input`)?.value;
  const hsSelect = container.querySelector(`.wt-th-time[data-idx="${anchorIdx}"] .wt-time-select`);
  const anchorHour = parseInt(hsSelect?.value ?? '8');
  const anchorElapsedH = anchorPt._elapsedH || 0;

  if (!anchorDate) {
    showNotification('請先設定基準航點的日期', 'warning');
    return;
  }

  // 2. Cascade to all points
  weatherPoints.forEach((pt, i) => {
    // We update every point (waypoint or interval) to match the global pace timeline
    const deltaH = (pt._elapsedH || 0) - anchorElapsedH;
    const { date, hour } = addHoursToDateTime(anchorDate, anchorHour, deltaH);

    const di = container.querySelector(`.wt-th-date[data-idx="${i}"] .wt-date-input`);
    const hs = container.querySelector(`.wt-th-time[data-idx="${i}"] .wt-time-select`);

    if (di) di.value = date;
    if (hs) hs.value = String(hour);
  });

  // 3. Sync and Save
  saveWeatherSettings();
  refreshWindyLinks();
  fetchAllWeatherData({ force: false });

  // Refresh weather cards if any are open
  if (typeof _wcStates !== 'undefined') {
    _wcStates.forEach((mode, colIdx) => _renderWeatherCard(colIdx));
  }

  const label = anchorPt.label || (anchorPt.isWaypoint ? `航點 ${anchorPt.wpIndex + 1}` : '中繼點');
  showNotification(`已依據「${label}」重置配速時間`, 'success');
  historyRecord();
}

/**
 * When speed mode is ON, cascade column 0's date/time to all other columns
 * using each point's _elapsedH.
 */
function cascadeWeatherTimes() {
  if (!speedIntervalMode || weatherPoints.length === 0) return;
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  const saved = loadWeatherSettings();
  const col0 = getSavedCol(weatherPoints[0], 0, saved);
  
  let anchorDate = col0?.date || container.querySelector('.wt-th-date[data-idx="0"] .wt-date-input')?.value || '';
  let anchorHour = parseInt(col0?.hour ?? container.querySelector('.wt-th-time[data-idx="0"] .wt-time-select')?.value ?? '8');
  let anchorElapsedH = 0;
  if (!anchorDate) return;

  weatherPoints.forEach((pt, i) => {
    if (i === 0) return;

    const sv = getSavedCol(pt, i, saved);
    if (pt.isWaypoint && sv && sv.date) {
      anchorDate = sv.date;
      anchorHour = parseInt(sv.hour);
      anchorElapsedH = pt._elapsedH || 0;
      // Already populated in DOM by renderWeatherPanel, but we update anchor to stop at this waypoint
      return;
    }

    const deltaH = (pt._elapsedH || 0) - anchorElapsedH;
    const { date, hour } = addHoursToDateTime(anchorDate, anchorHour, deltaH);
    const di = container.querySelector(`.wt-th-date[data-idx="${i}"] .wt-date-input`);
    const hs = container.querySelector(`.wt-th-time[data-idx="${i}"] .wt-time-select`);
    if (di) di.value = date;
    if (hs) hs.value = String(hour);
  });
}

/**
 * Cascade interval (non-waypoint) column times from col-0's date/hour + each
 * point's _elapsedH.  Interval inputs are disabled so this is the only way
 * their displayed time can change.
 */
/**
 * @param {boolean} [fromWP] - true = anchor each interval from its closest
 *   preceding waypoint (perSegmentMode ON, or any manual-edit cascade).
 *   false (default when perSegmentMode OFF) = anchor from col-0 so all
 *   times are continuous from trip start.
 */
function cascadeIntervalTimes(fromWP = perSegmentMode) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const startDate = container.querySelector('.wt-th-date[data-idx="0"] .wt-date-input')?.value || '';
  const startHour = parseInt(container.querySelector('.wt-th-time[data-idx="0"] .wt-time-select')?.value ?? '8');
  if (!startDate) return;

  weatherPoints.forEach((pt, i) => {
    if (pt.isWaypoint) return;

    let anchorDate = startDate;
    let anchorHour = startHour;
    let anchorElapsedH = 0;
    if (fromWP) {
      for (let j = i - 1; j >= 0; j--) {
        if (weatherPoints[j]?.isWaypoint) {
          anchorDate = container.querySelector(`.wt-th-date[data-idx="${j}"] .wt-date-input`)?.value || startDate;
          anchorHour = parseInt(container.querySelector(`.wt-th-time[data-idx="${j}"] .wt-time-select`)?.value ?? String(startHour));
          anchorElapsedH = weatherPoints[j]._elapsedH || 0;
          break;
        }
      }
    }

    const deltaH = (pt._elapsedH || 0) - anchorElapsedH;
    const { date, hour } = addHoursToDateTime(anchorDate, anchorHour, deltaH);
    const di = container.querySelector(`.wt-th-date[data-idx="${i}"] .wt-date-input`);
    const hs = container.querySelector(`.wt-th-time[data-idx="${i}"] .wt-time-select`);
    if (di) di.value = date;
    if (hs) hs.value = String(hour);
  });
}

/**
 * Enforce non-decreasing time order across waypoint columns only.
 * Interval points are managed by cascadeIntervalTimes() and skipped here.
 * When a waypoint column is earlier than its predecessor, reset it to the
 * predecessor's date+time (the minimum valid state) so the date never
 * jumps unexpectedly.
 */
function enforceTimeOrdering() {
  if (!strictLinearMode) return;
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const N = weatherPoints.length;
  if (N < 2) return;

  const toMs = (idx) => {
    const d = container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`)?.value || '';
    const h = parseInt(container.querySelector(`.wt-th-time[data-idx="${idx}"] .wt-time-select`)?.value ?? '0');
    if (!d) return -Infinity;
    return new Date(d + 'T00:00:00').getTime() + h * 3600000;
  };

  const col0Date = container.querySelector('.wt-th-date[data-idx="0"] .wt-date-input')?.value || '';
  const col0Hour = parseInt(container.querySelector('.wt-th-time[data-idx="0"] .wt-time-select')?.value ?? '0');

  for (let i = 1; i < N; i++) {
    const pt = weatherPoints[i];
    if (!pt?.isWaypoint) continue;

    const prevIdx = findAdjacentWaypointIndex(i, -1);
    if (prevIdx < 0) continue;
    const prevMs = toMs(prevIdx);
    const curMs = toMs(i);
    if (curMs >= prevMs) continue;

    const thDate = container.querySelector(`.wt-th-date[data-idx="${i}"]`);
    const thTime = container.querySelector(`.wt-th-time[data-idx="${i}"]`);
    const di = thDate?.querySelector('.wt-date-input');
    const hs = thTime?.querySelector('.wt-time-select');

    // Violation: try the pace-derived time first (col-0 + _elapsedH).
    // This keeps the waypoint aligned with the actual route timing.
    if (col0Date && pt._elapsedH) {
      const { date: paceDate, hour: paceHour } = addHoursToDateTime(col0Date, col0Hour, pt._elapsedH);
      const paceMs = new Date(paceDate + 'T00:00:00').getTime() + paceHour * 3600000;
      if (paceMs >= prevMs) {
        if (di) di.value = paceDate;
        if (hs) hs.value = String(paceHour);
        continue;
      }
    }

    // Fallback: pace time itself is too early (waypoints out of order) —
    // reset to predecessor's date+time as the minimum valid state.
    const prevDi = container.querySelector(`.wt-th-date[data-idx="${prevIdx}"] .wt-date-input`);
    const prevHs = container.querySelector(`.wt-th-time[data-idx="${prevIdx}"] .wt-time-select`);
    if (di && prevDi?.value) di.value = prevDi.value;
    if (hs && prevHs?.value != null) hs.value = prevHs.value;
  }
}

/**
 * Set the `min` attribute on each waypoint date input so the browser's
 * date picker grays out dates that would violate strict linear ordering.
 * No-op when strictLinearMode is off.
 */
function updateDateConstraints() {
  if (!strictLinearMode) return;
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const heads = Array.from(container.querySelectorAll('.wt-th-date'));
  for (const th of heads) {
    const i = parseInt(th.dataset.idx, 10);
    if (!Number.isFinite(i) || i <= 0) continue;
    const pt = weatherPoints[i];
    if (!pt?.isWaypoint) continue;
    const prevIdx = findAdjacentWaypointIndex(i, -1);
    const prevDi = prevIdx >= 0
      ? container.querySelector(`.wt-th-date[data-idx="${prevIdx}"] .wt-date-input`)
      : null;
    const di = th.querySelector('.wt-date-input');
    if (di && prevDi?.value) {
      di.min = prevDi.value;
      // Sync to open weather card
      const cardDi = document.querySelector(`.weather-card[data-col-idx="${i}"] .wc-date-input`);
      if (cardDi) cardDi.min = prevDi.value;
    }
  }
}

/**
 * One-stop sync: cascade interval times → enforce waypoint ordering →
 * cascade again.  The second cascade is needed because enforceTimeOrdering
 * may bump a waypoint to the next day, leaving the interval points that come
 * after it showing stale (pre-bump) times.
 */
function updateWeatherTimeAdjustButtons() {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  weatherPoints.forEach((pt, i) => {
    const locked = !pt?.isWaypoint;
    const thDate = container.querySelector(`.wt-th-date[data-idx="${i}"]`);
    const thTime = container.querySelector(`.wt-th-time[data-idx="${i}"]`);
    if (!thDate || !thTime) return;

    let canMinusDay = !locked;
    const canPlus = !locked;

    if (strictLinearMode && !locked && i > 0) {
      const prevIdx = findAdjacentWaypointIndex(i, -1);
      const prevTh = prevIdx >= 0 ? getWeatherDateHead(container, prevIdx) : null;
      const curMs = colToMs(thDate);
      const prevMs = prevTh ? colToMs(prevTh) : -Infinity;
      canMinusDay = curMs - 86400000 >= prevMs;
    }

    const dayMinus = thDate.querySelector('.wt-adj-day-minus');
    const dayPlus = thDate.querySelector('.wt-adj-day-plus');
    const hourMinus = thTime.querySelector('.wt-adj-hour-minus');
    const hourPlus = thTime.querySelector('.wt-adj-hour-plus');

    if (dayMinus) dayMinus.disabled = !canMinusDay;
    if (dayPlus) dayPlus.disabled = !canPlus;
    if (hourMinus) hourMinus.disabled = locked;
    if (hourPlus) hourPlus.disabled = !canPlus;
  });
  refreshWeatherDateDisplays(container);
}

function syncIntervalTimes() {
  cascadeIntervalTimes();
  enforceTimeOrdering();
  cascadeIntervalTimes();
  enforceTimeOrdering(); // re-check: cascade may have exposed new violations
}

/**
 * Like syncIntervalTimes but always anchors intervals from the preceding
 * waypoint, regardless of perSegmentMode.  Used when the user manually
 * edits a waypoint's date/time so that downstream interval points always
 * follow the edited waypoint.
 */
function syncIntervalTimesFromWP() {
  cascadeIntervalTimes(true);
  enforceTimeOrdering();
  cascadeIntervalTimes(true);
  enforceTimeOrdering(); // re-check: cascade may have exposed new violations
}

function syncPaceWeatherTimes(anchorIdx = null) {
  const container = document.getElementById('weather-table-container');
  let anchorEntry = null;
  if (container && anchorIdx != null && weatherPoints[anchorIdx]?.isWaypoint) {
    anchorEntry = {
      date: container.querySelector(`.wt-th-date[data-idx="${anchorIdx}"] .wt-date-input`)?.value || '',
      hour: container.querySelector(`.wt-th-time[data-idx="${anchorIdx}"] .wt-time-select`)?.value ?? '8',
    };
  }

  cascadeWeatherTimes();
  if (anchorEntry?.date) {
    const di = container.querySelector(`.wt-th-date[data-idx="${anchorIdx}"] .wt-date-input`);
    const hs = container.querySelector(`.wt-th-time[data-idx="${anchorIdx}"] .wt-time-select`);
    if (di) di.value = anchorEntry.date;
    if (hs) hs.value = String(anchorEntry.hour);
  }
  enforceTimeOrdering();
  saveWeatherSettings();
  cascadeWeatherTimes();
  if (anchorEntry?.date) {
    const di = container.querySelector(`.wt-th-date[data-idx="${anchorIdx}"] .wt-date-input`);
    const hs = container.querySelector(`.wt-th-time[data-idx="${anchorIdx}"] .wt-time-select`);
    if (di) di.value = anchorEntry.date;
    if (hs) hs.value = String(anchorEntry.hour);
  }
  enforceTimeOrdering();
}

// =========== Export / Import (GPX / KML) ===========

const exportModal = document.getElementById('export-modal');
const btnExportConfirm = document.getElementById('btn-export-confirm');
const btnExportCancel = document.getElementById('btn-export-cancel');

const EXPORT_PRESET_CONFIG = Object.freeze({
  'route-only': {
    label: '只分享路線',
    includeRoute: true,
    includeWeather: false,
    includeState: false,
    includeTiles: false,
    requiresMelmap: false,
  },
  'with-weather': {
    label: '含天氣',
    includeRoute: true,
    includeWeather: true,
    includeState: false,
    includeTiles: false,
    requiresMelmap: false,
  },
  'with-settings': {
    label: '含設定',
    includeRoute: true,
    includeWeather: true,
    includeState: true,
    includeTiles: false,
    requiresMelmap: true,
  },
  'with-offline': {
    label: '含離線包',
    includeRoute: true,
    includeWeather: true,
    includeState: true,
    includeTiles: true,
    requiresMelmap: true,
  },
});

const EXPORT_FORMAT_LABELS = Object.freeze({
  gpx: 'GPX · 戶外 / GPS App',
  kml: 'KML · 地圖工具',
  all: 'GPX + KML · 通用格式',
  melmap: '.melmap · Mapping Elf 完整還原',
});

function getCheckedExportValue(name, fallback) {
  return exportModal?.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function setCheckedExportValue(name, value) {
  const input = exportModal?.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function getSelectedExportPreset() {
  return getCheckedExportValue('export-preset', 'with-weather');
}

function getSelectedExportFormat() {
  return getCheckedExportValue('export-fmt', 'gpx');
}

function applyExportPresetToDetailControls(preset = getSelectedExportPreset()) {
  const config = EXPORT_PRESET_CONFIG[preset] || EXPORT_PRESET_CONFIG['with-weather'];
  const route = document.getElementById('mappack-inc-route');
  const weather = document.getElementById('mappack-inc-weather');
  const state = document.getElementById('mappack-inc-state');
  const tiles = document.getElementById('mappack-inc-tiles');
  if (route) route.checked = config.includeRoute;
  if (weather) weather.checked = config.includeWeather;
  if (state) state.checked = config.includeState;
  if (tiles) tiles.checked = config.includeTiles;
  syncMelmapWeatherOption();
}

function syncMelmapWeatherOption() {
  const route = document.getElementById('mappack-inc-route');
  const weather = document.getElementById('mappack-inc-weather');
  const option = weather?.closest('.export-option');
  if (!weather) return;
  const hasRoute = route?.checked !== false;
  weather.disabled = !hasRoute;
  if (!hasRoute) weather.checked = false;
  option?.classList.toggle('is-disabled', !hasRoute);
}

function syncExportModalState() {
  let fmt = getSelectedExportFormat();
  let preset = getSelectedExportPreset();
  const presetConfig = EXPORT_PRESET_CONFIG[preset] || EXPORT_PRESET_CONFIG['with-weather'];

  if (presetConfig.requiresMelmap && fmt !== 'melmap') {
    fmt = 'melmap';
    setCheckedExportValue('export-fmt', 'melmap');
  }

  if (fmt !== 'melmap' && presetConfig.requiresMelmap) {
    preset = 'with-weather';
    setCheckedExportValue('export-preset', preset);
    applyExportPresetToDetailControls(preset);
  }

  const sub = document.getElementById('melmap-sub-options');
  if (sub) sub.style.display = fmt === 'melmap' ? '' : 'none';

  syncMelmapWeatherOption();
  if (fmt === 'melmap') updateMapPackTileOptionState();
  updateExportPlanSummary();
}

function readExportPlan() {
  const fmt = getSelectedExportFormat();
  const preset = getSelectedExportPreset();
  const config = EXPORT_PRESET_CONFIG[preset] || EXPORT_PRESET_CONFIG['with-weather'];

  if (fmt !== 'melmap') {
    return {
      format: fmt,
      preset,
      includeRoute: true,
      includeWeather: config.includeWeather !== false,
      includeState: false,
      includeTiles: false,
    };
  }

  const includeRoute = document.getElementById('mappack-inc-route')?.checked === true;
  return {
    format: fmt,
    preset,
    includeRoute,
    includeWeather: includeRoute && document.getElementById('mappack-inc-weather')?.checked === true,
    includeState: document.getElementById('mappack-inc-state')?.checked === true,
    includeTiles: document.getElementById('mappack-inc-tiles')?.checked === true,
  };
}

function updateExportPlanSummary() {
  const summary = document.getElementById('export-plan-summary');
  if (!summary) return;
  const plan = readExportPlan();
  const content = [];
  if (plan.includeRoute) content.push('路線');
  if (plan.includeRoute && plan.includeWeather) content.push('天氣');
  if (plan.includeState) content.push('設定');
  if (plan.includeTiles) content.push('離線包');
  if (content.length === 0) content.push('尚未選擇內容');
  summary.textContent = `${EXPORT_FORMAT_LABELS[plan.format] || '匯出'} · ${content.join('、')}`;
}

function openExportModal() {
  const fmt = exportModal.querySelector('input[name="export-fmt"]:checked')?.value || 'gpx';
  // For non-melmap formats, a route is required. For melmap, we gate per-option
  // inside doExportMapPack so user can export state-only.
  if (fmt !== 'melmap' && currentRouteCoords.length === 0) {
    showNotification('請先建立路線', 'warning');
    return;
  }
  updateMapPackTileOptionState();

  // Pre-fill route name input
  const nameInput = document.getElementById('export-filename-input');
  if (nameInput) {
    nameInput.value = buildDefaultRouteName();
  }

  applyExportPresetToDetailControls(getSelectedExportPreset());
  syncExportModalState();
  document.body.classList.add('modal-open');
  exportModal.classList.remove('hidden');
}

// Toggle .melmap detail visibility and preset-driven content.
exportModal?.querySelectorAll('input[name="export-fmt"]').forEach((r) => {
  r.addEventListener('change', () => {
    if (r.checked && r.value !== 'melmap') {
      const preset = getSelectedExportPreset();
      if (EXPORT_PRESET_CONFIG[preset]?.requiresMelmap) {
        setCheckedExportValue('export-preset', 'with-weather');
        applyExportPresetToDetailControls('with-weather');
      }
    }
    syncExportModalState();
  });
});

exportModal?.querySelectorAll('input[name="export-preset"]').forEach((r) => {
  r.addEventListener('change', () => {
    if (!r.checked) return;
    applyExportPresetToDetailControls(r.value);
    syncExportModalState();
  });
});

['mappack-inc-route', 'mappack-inc-weather', 'mappack-inc-state', 'mappack-inc-tiles'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', () => {
    syncMelmapWeatherOption();
    if (id === 'mappack-inc-tiles') updateMapPackTileOptionState();
    updateExportPlanSummary();
  });
});

/**
 * Generate a default route name: [Highest Point Name]-[Type]
 * highest point: point with the maximum elevation in the current route.
 * type: 單程 (single), 來回 (roundtrip), or O繞 (oloop)
 */
function buildDefaultRouteName() {
  if (currentRouteCoords.length === 0) return '';

  // 1. Find point with highest elevation
  let maxElev = -Infinity;
  let maxIdx = 0;
  for (let i = 0; i < currentElevations.length; i++) {
    const e = currentElevations[i];
    if (e != null && e > maxElev) {
      maxElev = e;
      maxIdx = i;
    }
  }
  const maxCoord = currentRouteCoords[maxIdx];
  if (!maxCoord) return '未命名路線';

  // 2. Try to find name of the highest point
  let name = '';
  let minD = 50; // allow 50m tolerance for "peak" markers
  mapManager.waypoints.forEach(([lat, lng]) => {
    const d = haversineDistance(maxCoord, [lat, lng]);
    if (d < minD) {
      const wpName = getEffectiveName(lat, lng);
      // Skip generic waypoint names
      if (wpName && wpName !== '起點' && wpName !== '終點' && !wpName.startsWith('航點')) {
        name = wpName;
        minD = d;
      }
    }
  });

  // Secondary: Use geocoded name of the highest point itself
  if (!name) {
    const geoName = getPlaceName(maxCoord[0], maxCoord[1]);
    if (geoName && geoName !== '起點' && geoName !== '終點' && !geoName.startsWith('航點')) {
      name = geoName;
    }
  }

  // Tertiary: Start point name
  if (!name) {
    const startWp = mapManager.waypoints[0];
    if (startWp) {
      const startName = getEffectiveName(startWp[0], startWp[1]);
      if (startName && startName !== '起點') name = startName;
    }
  }

  if (!name) name = '路線';

  const suffix = oLoopMode ? '-O繞' : (roundTripMode ? '-來回' : '-單程');
  return `${name}${suffix}`;
}

function buildExportFilenameBase() {
  const nameInput = document.getElementById('export-filename-input');
  let namePart = nameInput ? nameInput.value.trim() : '';

  if (!namePart) {
    namePart = buildDefaultRouteName() || 'MappingElf';
  }

  // Clean filename
  namePart = namePart.replace(/[\\/:*?"<>|]/g, '_');

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  return `${namePart}_${ts}`;
}

function distanceForCoords(coords = []) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(coords[i - 1], coords[i]);
  }
  return total;
}

function boundsForCoordsObject(coords = []) {
  if (!coords.length) return null;
  const lats = coords.map(([lat]) => lat).filter(Number.isFinite);
  const lngs = coords.map(([, lng]) => lng).filter(Number.isFinite);
  if (!lats.length || !lngs.length) return null;
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

function routeFingerprintForCoords(coords = []) {
  let hash = 2166136261;
  const text = coords
    .map(([lat, lng]) => `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`)
    .join('|');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `route-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildExportRouteMeta(routeName, coords = currentRouteCoords) {
  if (!coords?.length) return null;
  const fingerprint = routeFingerprintForCoords(coords);
  return {
    id: fingerprint,
    fingerprint,
    name: routeName || buildDefaultRouteName() || 'Mapping Elf Track',
    distanceM: distanceForCoords(coords),
    pointCount: coords.length,
    waypointCount: mapManager.waypoints.length,
    bounds: boundsForCoordsObject(coords),
  };
}

function closeExportModal() {
  document.body.classList.remove('modal-open');
  exportModal.classList.add('hidden');
}

// Accidental backdrop click-to-close removed per user request to "lock" interaction.
// Modal must be closed via explicit Confirm / Cancel buttons.
// exportModal?.addEventListener('click', (e) => {
//   if (e.target === exportModal) closeExportModal();
// });
btnExportCancel?.addEventListener('click', closeExportModal);
btnExportConfirm?.addEventListener('click', async () => {
  const plan = readExportPlan();
  if (plan.format === 'melmap') {
    if (plan.includeTiles) {
      const tilePolicy = getOfflineTileExportPolicy();
      if (!tilePolicy.allowed) {
        showNotification(tilePolicy.reason || OFFLINE_TILE_EXPORT_UNAVAILABLE_MESSAGE, 'warning');
        updateMapPackTileOptionState();
        return;
      }
    }
    if (!plan.includeRoute && !plan.includeTiles && !plan.includeState) {
      showNotification('請至少勾選一項離線地圖包內容', 'warning');
      return;
    }
    if ((plan.includeRoute || plan.includeTiles) && currentRouteCoords.length === 0) {
      showNotification('匯出路線/圖磚前請先建立路線', 'warning');
      return;
    }

    const nameInput = document.getElementById('export-filename-input');
    const routeName = nameInput ? nameInput.value.trim() : buildDefaultRouteName();

    closeExportModal();
    await doExportMapPack(buildExportFilenameBase(), routeName, plan);
    return;
  }
  closeExportModal();
  try {
    await doExport(plan.format, plan);
  } catch (err) {
    console.error(err);
    showNotification('匯出失敗', 'error');
  }
});

// =========== Favorites ===========

const favoritesReplaceModal = document.getElementById('favorites-replace-modal');
let favoriteExportRequestSeq = 0;

function _escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const ROUTE_LIBRARY_ACTION_ICONS = Object.freeze({
  load: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M10 17l5-5-5-5v4H3v2h12v4l-5 0zM19 3h-8v2h8v14h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" fill="currentColor"/></svg>',
  terrain: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 5v14H3V5h18zm-2 2H5v3h14V7zm0 5H5v5h14v-5z" fill="currentColor" opacity="0.7"/><path d="M7 10l2-3h6l2 3-5 4-5-4z" fill="currentColor" opacity="0.9"/></svg>',
  export: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>',
  delete: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4h-3.5z" fill="currentColor"/></svg>',
});

function routeLibraryActionButton({ action, id, label, icon, className = '' }) {
  const safeId = _escapeHtml(id);
  const safeLabel = _escapeHtml(label);
  return `<button type="button" class="btn-secondary route-library-mini-btn route-library-icon-action ${className}" data-favorite-${action}="${safeId}" title="${safeLabel}" aria-label="${safeLabel}">${ROUTE_LIBRARY_ACTION_ICONS[icon]}</button>`;
}

const ROUTE_MODE_LABELS = {
  walking: '步行',
  hiking: '山徑',
  cycling: '自行車',
  driving: '駕車',
};

const SPEED_ACTIVITY_LABELS = {
  walking: '步行',
  hiking: '健行',
  'trail-run': '越野跑',
  running: '跑步',
  cycling: '自行車',
  driving: '駕車',
};

function routeDistanceForLibrary() {
  if (elevationProfile?.distances?.length > 0) {
    return elevationProfile.distances[elevationProfile.distances.length - 1] || 0;
  }
  let total = 0;
  for (let i = 1; i < currentRouteCoords.length; i++) {
    total += haversineDistance(currentRouteCoords[i - 1], currentRouteCoords[i]);
  }
  return total;
}

function waypointsMatch(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((wp, idx) => (
    Math.abs((wp?.[0] ?? NaN) - (b[idx]?.[0] ?? NaN)) < 1e-6
    && Math.abs((wp?.[1] ?? NaN) - (b[idx]?.[1] ?? NaN)) < 1e-6
  ));
}

function findSavedCurrentRoute() {
  if (mapManager.waypoints.length < 2) return null;
  return favorites.find((fav) => waypointsMatch(fav.waypoints, mapManager.waypoints)) || null;
}

function updateRouteLibraryCurrent() {
  const nameEl = document.getElementById('route-library-current-name');
  const metaEl = document.getElementById('route-library-current-meta');
  const stateEl = document.getElementById('route-library-current-state');
  const saveButtons = [
    document.getElementById('btn-favorite-add'),
    document.getElementById('btn-favorite-quick'),
  ].filter(Boolean);
  const exportButton = document.getElementById('btn-export-gpx');
  const hasRoute = mapManager.waypoints.length >= 2 || currentRouteCoords.length >= 2;
  const canSaveRoute = mapManager.waypoints.length >= 2;
  const saved = findSavedCurrentRoute();

  if (nameEl) nameEl.textContent = hasRoute ? (buildDefaultRouteName() || '目前路線') : '目前路線';
  if (metaEl) {
    if (!hasRoute) {
      metaEl.textContent = '尚未建立路線';
    } else {
      const wpCount = mapManager.waypoints.length;
      const distance = routeDistanceForLibrary();
      const routeLabel = ROUTE_MODE_LABELS[routeEngine.mode] || routeEngine.mode || '路線';
      const activityLabel = SPEED_ACTIVITY_LABELS[speedActivity] || speedActivity || '配速';
      metaEl.textContent = `${wpCount} 航點 · ${formatDistance(distance)} · ${routeLabel}/${activityLabel}`;
    }
  }
  if (stateEl) {
    stateEl.textContent = hasRoute ? (saved ? '已保存' : '未保存') : '空白';
    stateEl.classList.toggle('saved', !!saved);
  }
  saveButtons.forEach((btn) => {
    btn.disabled = !canSaveRoute;
    btn.title = canSaveRoute ? (saved ? '已加入最愛' : '加到最愛') : '至少需 2 個航點才能加到最愛';
  });
  if (exportButton) exportButton.disabled = !hasRoute;
  // 3D terrain is favourite-only; keep the toolbar badge in sync with save state.
  if (typeof update3dButtonBadge === 'function') update3dButtonBadge();
}

function persistFavorites() {
  try { localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify(favorites)); } catch (_) { }
}

function captureFavorite(name) {
  const wps = mapManager.waypoints.map(([a, b]) => [a, b]);

  const customNames = {};
  wps.forEach(([la, ln]) => {
    const k = _geocodeKey(la, ln);
    const eff = getEffectiveName(la, ln);
    if (eff) customNames[k] = eff;
  });

  const weather = wps.map(() => ({ date: null, time: null, weather: {} }));
  if (Array.isArray(weatherPoints)) {
    weatherPoints.forEach((pt, colIdx) => {
      if (!pt?.isWaypoint || pt.isReturn || pt.wpIndex == null) return;
      const wpIdx = pt.wpIndex;
      if (wpIdx < 0 || wpIdx >= weather.length) return;
      const di = document.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`);
      const ts = document.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`);
      if (di?.value) weather[wpIdx].date = di.value;
      if (ts?.value) weather[wpIdx].time = `${String(ts.value).padStart(2, '0')}:00`;

      const cellMap = getSavedWeatherCells(pt);
      if (cellMap) {
        const labelled = {};
        WEATHER_ROWS.forEach(r => {
          const v = getSavedWeatherCellValue(cellMap, r.key);
          if (v && v !== '—') labelled[r.label] = v;
        });
        if (Object.keys(labelled).length) weather[wpIdx].weather = labelled;
      }
    });
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || buildDefaultRouteName() || '未命名路線',
    savedAt: Date.now(),
    waypoints: wps,
    customNames,
    weather,
    settings: {
      routeMode: routeEngine.mode,
      roundTripMode,
      oLoopMode,
      speedIntervalMode,
      speedActivity,
      paceParams: JSON.parse(JSON.stringify(paceParams)),
      paceUnit,
      segmentIntervalKm,
      perSegmentMode,
      strictLinearMode,
    },
  };
}

// applySettingsFromStorage() covers most UI sync; this handles the rest:
// nav-mode radios, speed-activity/pace-unit selects, pace-params form inputs,
// segment-interval input, pace-params panel visibility.
function _syncExtraSettingsUI() {
  const navVal = roundTripMode ? 'roundtrip' : (oLoopMode ? 'oloop' : 'single');
  const navRadio = document.getElementById(`nav-mode-${navVal}`);
  if (navRadio) navRadio.checked = true;

  const speedActivityEl = document.getElementById('speed-activity-select');
  if (speedActivityEl) speedActivityEl.value = speedActivity;

  const puSel = document.getElementById('pace-unit-select');
  if (puSel) puSel.value = paceUnit;

  const segEl = document.getElementById('segment-interval-input');
  if (segEl && segmentIntervalKm > 0) segEl.value = String(segmentIntervalKm);

  const paceFlat = document.getElementById('pace-flat-input');
  const paceBody = document.getElementById('pace-body-weight');
  const pacePack = document.getElementById('pace-pack-weight');
  const paceFatigue = document.getElementById('pace-fatigue-level');
  const paceRestE = document.getElementById('pace-rest-every');
  const paceRestM = document.getElementById('pace-rest-minutes');
  if (paceFlat) {
    const kmh = paceParams.flatPaceKmH;
    paceFlat.value = (kmh != null && typeof kmhToDisplay === 'function')
      ? String(kmhToDisplay(kmh)) : '';
  }
  if (paceBody) paceBody.value = paceParams.bodyWeightKg ?? 70;
  if (pacePack) pacePack.value = paceParams.packWeightKg ?? 0;
  if (paceFatigue) paceFatigue.value = paceParams.fatigueLevel ?? 'general';
  if (paceRestE) paceRestE.value = paceParams.restEveryH ?? 1.0;
  if (paceRestM) paceRestM.value = paceParams.restMinutes ?? 10;

  const paceParamsPanel = document.getElementById('pace-params-panel');
  if (paceParamsPanel) paceParamsPanel.style.display = (speedIntervalMode || segmentIntervalKm > 0) ? '' : 'none';

  if (typeof updateFlatPlaceholder === 'function') updateFlatPlaceholder();
  if (typeof syncPaceActivityApplicabilityUi === 'function') syncPaceActivityApplicabilityUi();
  if (typeof syncPaceCalibrationUI === 'function') syncPaceCalibrationUI();
}

// True when a favourite is already the live route with all route-/pace-affecting
// settings unchanged, so (re)loading it would needlessly re-plan the route and
// re-fetch weather/圖資 for no visible change. Custom names alone don't count —
// they don't trigger a network refetch. Used to skip redundant reloads when the
// user re-selects the route that's already showing without editing any params.
function favoriteAlreadyLoaded(fav) {
  if (!fav || importedTrackMode) return false;
  if (!waypointsMatch(fav.waypoints, mapManager.waypoints)) return false;
  if (currentRouteCoords.length < 2) return false;
  const s = fav.settings || {};
  const rtMode = !!s.roundTripMode;
  const oLoop = rtMode ? false : !!s.oLoopMode;
  if ((s.routeMode || 'hiking') !== routeEngine.mode) return false;
  if (rtMode !== roundTripMode) return false;
  if (oLoop !== oLoopMode) return false;
  if (!!s.speedIntervalMode !== speedIntervalMode) return false;
  const favActivity = normalizeSpeedActivity(s.speedActivity || defaultActivityForRouteMode(s.routeMode || 'hiking'));
  if (favActivity !== speedActivity) return false;
  if ((s.paceUnit || 'kmh') !== paceUnit) return false;
  if ((Number(s.segmentIntervalKm) || 0) !== (Number(segmentIntervalKm) || 0)) return false;
  if (!!s.perSegmentMode !== perSegmentMode) return false;
  if ((s.strictLinearMode !== false) !== strictLinearMode) return false;
  const favPace = JSON.stringify({ ...DEFAULT_PACE_PARAMS, ...(s.paceParams || {}) });
  if (favPace !== JSON.stringify({ ...DEFAULT_PACE_PARAMS, ...paceParams })) return false;
  return true;
}

function loadFavorite(fav) {
  if (!fav || !Array.isArray(fav.waypoints) || fav.waypoints.length < 2) {
    showNotification('最愛路線資料無效', 'error');
    return;
  }
  // Nothing to reload: the route is already on screen with identical settings, so
  // keep the existing route/weather/圖資 instead of re-planning and re-fetching.
  if (favoriteAlreadyLoaded(fav)) {
    updateRouteLibraryCurrent();
    showNotification(`「${fav.name}」已是目前路線`, 'info', 1500);
    return;
  }
  history.suppressed = true;
  try {
    const s = fav.settings || {};
    const rtMode = !!s.roundTripMode;
    let oLoop = !!s.oLoopMode;
    if (rtMode && oLoop) oLoop = false;
    localStorage.setItem(LS_ROUTE_MODE_KEY, s.routeMode || 'hiking');
    localStorage.setItem(LS_ROUNDTRIP_KEY, rtMode ? '1' : '0');
    localStorage.setItem(LS_OLOOP_KEY, oLoop ? '1' : '0');
    localStorage.setItem(LS_SPEED_MODE_KEY, s.speedIntervalMode ? '1' : '0');
    localStorage.setItem(LS_SPEED_ACTIVITY_KEY, normalizeSpeedActivity(s.speedActivity || defaultActivityForRouteMode(s.routeMode || 'hiking')));
    const mergedPace = { ...DEFAULT_PACE_PARAMS, ...(s.paceParams || {}) };
    localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(mergedPace));
    localStorage.setItem(LS_PACE_UNIT_KEY, s.paceUnit || 'kmh');
    localStorage.setItem(LS_SEGMENT_KEY, String(Number(s.segmentIntervalKm) || 0));
    localStorage.setItem(LS_PER_SEGMENT_KEY, s.perSegmentMode ? '1' : '0');
    localStorage.setItem(LS_STRICT_LINEAR_KEY, s.strictLinearMode !== false ? '1' : '0');

    applySettingsFromStorage();
    _syncExtraSettingsUI();

    Object.keys(waypointCustomNames).forEach(k => delete waypointCustomNames[k]);
    Object.assign(waypointCustomNames, fav.customNames || {});
    try { localStorage.setItem(LS_CUSTOM_NAMES_KEY, JSON.stringify(waypointCustomNames)); } catch (_) { }

    if (fav.weather && fav.weather.some(w => w && (w.date || w.time || Object.keys(w.weather || {}).length))) {
      window._pendingGpxDates = fav.weather;
    } else {
      delete window._pendingGpxDates;
    }

    importedTrackMode = false;
    importedIntermediatePoints = [];
    importedWaypointMeta = [];
    clearImportedTrackSession();
    if (typeof syncTrackModeUI === 'function') syncTrackModeUI();
    _wcStates.clear();
    mapManager.closeWeatherPopup();
    mapManager.clearIntermediateMarkers();

    // Reset stale derived state so updateWaypointList / renderWeatherPanel
    // don't pick up the previous route's labels, distances, or colors
    // before debouncedCalculateRoute repopulates them.
    weatherPoints = [];
    waypointCumDistM = [];
    waypointGradColors = [];
    setCurrentRouteData([], []);
    allAlternatives = [];
    lastWaypoints = [];
    pendingNewWaypointIndex = null;

    const cb = mapManager.onWaypointChange;
    mapManager.onWaypointChange = () => { };
    try {
      mapManager.clearWaypoints();
      fav.waypoints.forEach(([lat, lng]) => mapManager.addWaypoint(lat, lng));
    } finally {
      mapManager.onWaypointChange = cb;
    }
  } finally {
    history.suppressed = false;
  }
  history.current = _captureSnapshot();
  skipAutoGeocode = true;
  try { onWaypointsChanged(mapManager.waypoints); }
  finally { skipAutoGeocode = false; }
  mapManager.fitToRoute();
  _updateHistoryButtons();
  updateRouteLibraryCurrent();
  showNotification(`已載入「${fav.name}」`, 'success');
}

function deleteFavorite(id) {
  favoriteExportRequestSeq += 1;
  const n = favorites.length;
  favorites = favorites.filter(f => f.id !== id);
  if (favorites.length !== n) {
    clearTerrainCacheEntry(`fav:${id}`);
    delete terrainViewStates[`fav:${id}`];
    if (terrainActiveRouteKey === `fav:${id}`) {
      terrainActiveRouteKey = null;
      terrainActiveCacheKey = null;
    }
    persistFavorites();
    renderFavoritesList();
    showNotification('已從最愛移除', 'info', 1200);
  }
}

function waitForFavoriteRouteReady(fav, requestId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let sawRoutePlanning = isProcessing || isRouteWeatherBusy();

    const check = () => {
      if (requestId !== favoriteExportRequestSeq) {
        resolve(false);
        return;
      }

      const currentMatchesFavorite = waypointsMatch(fav?.waypoints, mapManager.waypoints);
      sawRoutePlanning ||= isProcessing || isRouteWeatherBusy();

      if (currentMatchesFavorite && currentRouteCoords.length >= 2 && !isProcessing && !isRouteWeatherBusy()) {
        resolve(true);
        return;
      }

      if (
        sawRoutePlanning
        && currentMatchesFavorite
        && !isProcessing
        && !isRouteWeatherBusy()
        && !pendingUpdate
        && currentRouteCoords.length < 2
      ) {
        resolve(false);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(check, 250);
    };

    check();
  });
}

async function exportFavorite(fav) {
  if (!fav || !Array.isArray(fav.waypoints) || fav.waypoints.length < 2) {
    showNotification('最愛路線資料無效', 'error');
    return;
  }

  const requestId = ++favoriteExportRequestSeq;
  loadFavorite(fav);
  const ready = await waitForFavoriteRouteReady(fav, requestId);
  if (requestId !== favoriteExportRequestSeq) return;

  if (!ready) {
    showNotification('找不到合適路徑', 'warning');
    return;
  }

  openExportModal();
  const nameInput = document.getElementById('export-filename-input');
  if (nameInput && fav.name) {
    nameInput.value = fav.name;
    updateExportPlanSummary();
  }
}

// Build (or reuse the cached) 3D terrain for a favourite. Loads the favourite's
// route first if it isn't already the current one, then opens the viewer keyed
// to the favourite id so its elevation grid is cached for next time.
async function open3dForFavorite(fav) {
  if (!fav || !Array.isArray(fav.waypoints) || fav.waypoints.length < 2) {
    showNotification('最愛路線資料無效', 'error');
    return;
  }

  const alreadyCurrent = waypointsMatch(fav.waypoints, mapManager.waypoints)
    && currentRouteCoords.length >= 2;

  if (!alreadyCurrent) {
    const requestId = ++favoriteExportRequestSeq;
    loadFavorite(fav);
    const ready = await waitForFavoriteRouteReady(fav, requestId);
    if (requestId !== favoriteExportRequestSeq) return;
    if (!ready) {
      showNotification('找不到合適路徑', 'warning');
      return;
    }
  }

  terrainActiveRouteKey = `fav:${fav.id}`;
  terrainCurrentRouteSnapshot = null;
  await openTerrainViewer(`fav:${fav.id}`);
}

function closeReplaceModal() {
  if (!favoritesReplaceModal) return;
  favoritesReplaceModal.classList.add('hidden');
}

function renderFavoritesContainer(container) {
  if (!container) return;
  if (favorites.length === 0) {
    container.innerHTML = '<div class="route-library-empty">尚未加入最愛</div>';
    return;
  }
  container.innerHTML = favorites.map(f => {
    const count = Array.isArray(f.waypoints) ? f.waypoints.length : 0;
    const dateStr = new Date(f.savedAt || Date.now()).toLocaleString(getLanguage(), {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    return `
      <div class="favorite-item" data-id="${_escapeHtml(f.id)}" role="button" tabindex="0">
        <div class="fav-info">
          <div class="fav-name">${_escapeHtml(f.name || '未命名路線')}</div>
          <div class="fav-meta">${count} 個航點 · ${_escapeHtml(dateStr)}</div>
        </div>
        <div class="route-library-inline-actions">
          ${routeLibraryActionButton({ action: 'load', id: f.id, label: '載入', icon: 'load' })}
          ${routeLibraryActionButton({ action: 'terrain', id: f.id, label: '3D 地形', icon: 'terrain' })}
          ${routeLibraryActionButton({ action: 'export', id: f.id, label: '匯出', icon: 'export' })}
          ${routeLibraryActionButton({ action: 'delete', id: f.id, label: '刪除', icon: 'delete', className: 'danger' })}
        </div>
      </div>`;
  }).join('');
  _bindFavoriteItemInteractions(container);
}

function renderFavoritesList() {
  renderFavoritesContainer(document.getElementById('route-library-list'));
  updateRouteLibraryCurrent();
}

function _bindFavoriteItemInteractions(container) {
  container.querySelectorAll('[data-favorite-load]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      favoriteExportRequestSeq += 1;
      const fav = favorites.find(f => f.id === btn.dataset.favoriteLoad);
      if (fav) loadFavorite(fav);
    });
  });
  container.querySelectorAll('[data-favorite-terrain]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fav = favorites.find(f => f.id === btn.dataset.favoriteTerrain);
      if (fav) open3dForFavorite(fav);
    });
  });
  container.querySelectorAll('[data-favorite-export]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fav = favorites.find(f => f.id === btn.dataset.favoriteExport);
      if (fav) exportFavorite(fav);
    });
  });
  container.querySelectorAll('[data-favorite-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.favoriteDelete) deleteFavorite(btn.dataset.favoriteDelete);
    });
  });
  container.querySelectorAll('.favorite-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      favoriteExportRequestSeq += 1;
      const fav = favorites.find(f => f.id === item.dataset.id);
      if (fav) loadFavorite(fav);
    });
    item.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      favoriteExportRequestSeq += 1;
      const fav = favorites.find(f => f.id === item.dataset.id);
      if (fav) loadFavorite(fav);
    });
  });
}

function handleAddFavorite() {
  if (mapManager.waypoints.length < 2) {
    showNotification('至少需 2 個航點才能加入最愛', 'warning');
    return;
  }
  const name = buildDefaultRouteName() || null;
  if (favorites.length >= FAVORITES_MAX) {
    openReplaceFlow(name);
    return;
  }
  favorites.unshift(captureFavorite(name));
  persistFavorites();
  renderFavoritesList();
  openRouteLibrary('saved');
  showNotification('已加到最愛', 'success');
}

function openReplaceFlow(pendingName) {
  if (!favoritesReplaceModal) return;
  const pending = captureFavorite(pendingName);
  const list = document.getElementById('favorites-replace-list');
  if (!list) return;
  list.innerHTML = favorites.map(f => `
    <button class="btn-secondary replace-target" data-id="${_escapeHtml(f.id)}">
      <div class="replace-target-name">取代「${_escapeHtml(f.name || '未命名路線')}」</div>
      <div class="replace-target-meta">${_escapeHtml(new Date(f.savedAt).toLocaleString(getLanguage()))}</div>
    </button>`).join('');
  list.querySelectorAll('.replace-target').forEach(btn => btn.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.id;
    clearTerrainCacheEntry(`fav:${id}`);
    favorites = favorites.map(f => f.id === id ? pending : f);
    persistFavorites();
    renderFavoritesList();
    closeReplaceModal();
    showNotification('已取代最愛路線', 'success');
  }));
  favoritesReplaceModal.classList.remove('hidden');
}

document.getElementById('btn-favorite-add')?.addEventListener('click', handleAddFavorite);
document.getElementById('btn-favorites-replace-cancel')?.addEventListener('click', closeReplaceModal);
document.getElementById('btn-pace-reset')?.addEventListener('click', resetPaceToAnchor);

/**
 * Collect all weather-column data for export (date, time, weather rows).
 * Returns array parallel to weatherPoints.
 */
function collectExportData() {
  const container = document.getElementById('weather-table-container');
  return weatherPoints.map((pt, colIdx) => {
    const date = container?.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)?.value || '';
    const h = container?.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`)?.value;
    const hour = h != null ? parseInt(h) : 0;
    const time = h != null ? `${String(hour).padStart(2, '0')}:00` : '';
    const cached = date ? getWeatherCacheData(pt, date, hour) : null;
    const weather = {};
    if (cached) {
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(cached, row.key, pt);
        if (val && val !== '—') weather[row.key] = { label: row.label, value: val };
      });
    } else {
      // Fallback: use saved display-cell values (survives date/coord changes and page reload)
      const savedCells = getSavedWeatherCells(pt);
      if (savedCells) {
        WEATHER_ROWS.forEach(row => {
          const val = getSavedWeatherCellValue(savedCells, row.key);
          if (val && val !== '—') weather[row.key] = { label: row.label, value: val };
        });
      }
    }
    const windyUrl = date ? buildWindyUrl(pt.lat, pt.lng, date, hour) : '';
    return {
      lat: pt.lat,
      lng: pt.lng,
      label: pt.label,
      isWaypoint: pt.isWaypoint || false,
      isReturn: pt.isReturn || false,
      wpIndex: pt.wpIndex,
      cum: pt._cum || 0,
      ele: pt._ele ?? null,
      date,
      time,
      hour,
      weather,
      windyUrl,
    };
  });
}

/**
 * Prepare route coords and elevations for export. If the route is an un-imported
 * round-trip track, mirror the outbound coords so the exported track actually goes back.
 */
function getExportRouteData() {
  let exportCoords = currentRouteCoords;
  let exportElevations = currentElevations;

  if (!importedTrackMode && currentRouteCoords.length > 1) {
    const startC = currentRouteCoords[0];
    const endC = currentRouteCoords[currentRouteCoords.length - 1];
    const isClosed = haversineDistance(startC, endC) < 20;

    if (roundTripMode && !isClosed) {
      const revC = [];
      const revE = [];
      for (let i = currentRouteCoords.length - 2; i >= 0; i--) {
        revC.push(currentRouteCoords[i]);
        if (currentElevations && currentElevations.length === currentRouteCoords.length) {
          revE.push(currentElevations[i]);
        }
      }
      exportCoords = currentRouteCoords.concat(revC);
      if (revE.length > 0) {
        exportElevations = currentElevations.concat(revE);
      }
    } else if (oLoopMode && !isClosed) {
      // For O-loop, if not closed, add a straight segment back to start
      exportCoords = currentRouteCoords.concat([startC]);
      if (currentElevations && currentElevations.length === currentRouteCoords.length) {
        exportElevations = currentElevations.concat([currentElevations[0]]);
      }
    }
  }
  return { exportCoords, exportElevations };
}

/**
 * Collect per-waypoint date/time/weather for GPX (indexed by wpIndex).
 */
function collectSegmentDates() {
  const exportData = collectExportData();
  const result = mapManager.waypoints.map(() => null);
  exportData.forEach(d => {
    if (!d.isWaypoint || d.isReturn || d.wpIndex === undefined) return;
    result[d.wpIndex] = { date: d.date, time: d.time, weather: d.weather };
  });
  return result;
}

async function doExport(fmt, plan = readExportPlan()) {
  const nameInput = document.getElementById('export-filename-input');
  const routeName = (nameInput ? nameInput.value.trim() : null) || buildDefaultRouteName() || 'Mapping Elf Track';
  const filename = buildExportFilenameBase();
  const includeWeather = plan.includeWeather !== false;

  const wpData = collectExportData();
  const { exportCoords, exportElevations } = getExportRouteData();
  const { GpxExporter, KmlExporter } = await ensureRouteExporters();

  if (fmt === 'gpx' || fmt === 'all') {
    const gpx = GpxExporter.generate(wpData, exportCoords, exportElevations, routeName, { includeWeather });
    await platform.shareFile(GpxExporter.createDownloadPayload(gpx, `${filename}.gpx`));
  }

  if (fmt === 'kml' || fmt === 'all') {
    const kml = KmlExporter.generate(wpData, exportCoords, exportElevations, routeName, { includeWeather });
    await platform.shareFile(KmlExporter.createDownloadPayload(kml, `${filename}.kml`));
  }

  const label = fmt === 'all' ? 'GPX + KML' : fmt.toUpperCase();
  showNotification(`${label} 檔案已準備分享${includeWeather ? '（含天氣）' : '（只含路線）'}`, 'success');
}

/**
 * Persist the current imported-track session so a page refresh can restore the
 * track polyline, waypoints, and intermediate markers without re-routing.
 * Only called while importedTrackMode is true.
 */
function saveImportedTrackSession() {
  try {
    const payload = {
      coords: currentRouteCoords,
      elevations: currentElevations,
      waypoints: mapManager.waypoints,
      waypointMeta: mapManager.waypoints.map((_, i) => ({
        ...(importedWaypointMeta[i] || {}),
        ...(mapManager.getWaypointMetadata(i) || {}),
      })),
      intermediates: importedIntermediatePoints,
    };
    localStorage.setItem(LS_IMPORTED_TRACK_KEY, JSON.stringify(payload));
  } catch (_) { }
}

function clearImportedTrackSession() {
  try { localStorage.removeItem(LS_IMPORTED_TRACK_KEY); } catch (_) { }
}

/**
 * Restore a previously saved imported-track session. Mirrors the track branch
 * of importFile() without touching custom-name storage (already persisted).
 */
async function restoreImportedTrack(session) {
  const coords = Array.isArray(session.coords) ? session.coords : [];
  const elevations = Array.isArray(session.elevations) ? session.elevations : [];
  const waypoints = Array.isArray(session.waypoints) ? session.waypoints : [];
  const intermediates = Array.isArray(session.intermediates) ? session.intermediates : [];
  const waypointMeta = Array.isArray(session.waypointMeta) ? session.waypointMeta : [];
  if (coords.length < 2) return false;

  importedTrackMode = true;
  importedIntermediatePoints = intermediates;
  importedWaypointMeta = waypointMeta;
  syncTrackModeUI();

  mapManager.drawRoute(coords);
  setCurrentRouteData(coords, elevations);

  if (waypoints.length > 0) {
    skipAutoGeocode = true;
    mapManager.setWaypointsFromImport(waypoints, waypointMeta);
    ensureWaypointIds(waypointMeta.map(meta => meta?.waypointId || null));
    skipAutoGeocode = false;
  }

  await elevationProfile.updateWithData(coords, elevations);
  const totalDist = elevationProfile.distances.at(-1) || 0;
  const epStats = elevationProfile._calcStats();
  statDistance.textContent = formatDistance(totalDist);
  updateElevationStats(epStats);

  mapManager.fitToRoute();
  updateTimeStat();
  renderWeatherPanel();
  return true;
}

/**
 * Apply a parsed import result (from GpxExporter / KmlExporter)
 * to the map — same semantics as the original inline importFile logic.
 * Extracted so that .melmap imports can reuse it.
 */
async function applyImportedResult(result) {
  // Bulk import: suppress per-waypoint history entries and record one entry
  // for the whole import at the end.
  const _wasSuppressed = history.suppressed;
  history.suppressed = true;
  try {
    await _applyImportedResultCore(result);
  } finally {
    history.suppressed = _wasSuppressed;
  }
  historyRecord();
}

async function _applyImportedResultCore(result) {
  if (result.trackPoints.length > 0) {
    const coords = result.trackPoints.map((p) => [p.lat, p.lon]);

    let elevations = result.trackPoints.map((p) => p.ele);
    for (let i = 0; i < elevations.length; i++) {
      if (elevations[i] === null) {
        let nextI = i + 1;
        while (nextI < elevations.length && elevations[nextI] === null) nextI++;
        if (nextI < elevations.length) {
          const prev = i > 0 ? elevations[i - 1] : elevations[nextI];
          const next = elevations[nextI];
          const frac = 1 / (nextI - (i - 1));
          elevations[i] = prev + frac * (next - prev);
        } else {
          elevations[i] = i > 0 ? elevations[i - 1] : 0;
        }
      }
    }

    // 1. Clear old state normally (importedTrackMode still false so
    //    onWaypointsChanged([]) runs its usual clear path)
    importedTrackMode = false;
    importedIntermediatePoints = [];
    importedWaypointMeta = [];
    mapManager.clearWaypoints();
    mapManager.clearIntermediateMarkers();

    // 2. Enter track mode — from here, onWaypointsChanged skips routing
    importedTrackMode = true;
    importedIntermediatePoints = result.intermediatePoints || [];
    importedWaypointMeta = (result.segmentDates || []).map(sd => ({
      fileOrder: sd?.fileOrder,
      ele: sd?.ele ?? null,
      cumDistM: sd?.cumDistM ?? null,
      label: sd?.label ?? null,
    }));
    syncTrackModeUI();

    // 3. Draw the track polyline directly
    mapManager.drawRoute(coords);
    setCurrentRouteData(coords, elevations);

    // 4. Load waypoints as decorative markers (no routing triggered)
    if (result.waypoints.length > 0) {
      // 5. Store metadata BEFORE adding waypoints so that onWaypointsChanged callbacks
      // (triggered at the end of the batch) find the correct segmentDates for labels.
      if (result.segmentDates) {
        window._pendingGpxDates = result.segmentDates;
      }

      skipAutoGeocode = !importAutoNameMode;
      // Use batch setter for efficiency and consistent state
      mapManager.setWaypointsFromImport(result.waypoints, result.segmentDates);
      skipAutoGeocode = false;
      if (importAutoNameMode) geocodeWaypoints(result.waypoints);
    }

    // 6. Load elevation profile from track data (no elevation API call)
    await elevationProfile.updateWithData(coords, elevations);

    // 7. Update stats from track data
    const totalDist = elevationProfile.distances.at(-1) || 0;
    const epStats = elevationProfile._calcStats();
    statDistance.textContent = formatDistance(totalDist);
    updateElevationStats(epStats);

    updateTimeStat();
    renderWeatherPanel();

    saveImportedTrackSession();
    returnToRouteAfterPanelUpdate({ closePanel: true });

    const wpCount = result.waypoints.length;
    showNotification(
      `已匯入軌跡（${coords.length} 個點${wpCount > 0 ? `，${wpCount} 個航點` : ''}）`,
      'success'
    );
    showImportedTrackEditNotice(4500);
    // Explicitly call autoFetchWeather here before returning from track mode
    autoFetchWeather({ force: false });
    return;
  }

  // Not a track import — any prior track session is now stale.
  clearImportedTrackSession();

  // No track — fall back to waypoint-based routing.
  // Apply per-waypoint dates/weather to table columns after panel renders
  if (result.segmentDates?.some(d => d?.date || d?.time || (d?.weather && Object.keys(d.weather).length > 0))) {
    window._pendingGpxDates = result.segmentDates;
  }

  if (result.waypoints.length > 0) {
    // Preserve imported names as custom names if present
    if (result.segmentDates) {
      result.waypoints.forEach((wp, i) => {
        const sd = result.segmentDates[i];
        if (sd?.label) {
          // Do NOT strip symbols here; let them show up in the list so Replan can find them
          waypointCustomNames[_geocodeKey(wp[0], wp[1])] = sd.label;
        }
      });
      try { localStorage.setItem(LS_CUSTOM_NAMES_KEY, JSON.stringify(waypointCustomNames)); } catch (_) { }
    }

    // Optional TSP reorder (greedy nearest-neighbor + 2-opt, start fixed).
    const orderedWaypoints = (importAutoSortMode && result.waypoints.length >= 3)
      ? tspOptimize(result.waypoints)
      : result.waypoints;

    skipAutoGeocode = !importAutoNameMode;
    mapManager.setWaypointsFromImport(orderedWaypoints);
    skipAutoGeocode = false;
    if (importAutoNameMode) geocodeWaypoints(orderedWaypoints);
    const reorderedNote = orderedWaypoints !== result.waypoints ? '(自動排序)' : '';
    showNotification(`已匯入 ${result.waypoints.length} 個航點 ${reorderedNote}`.trim(), 'success');
  }

  // Automatically fetch weather data after import is applied (covering "新載入")
  autoFetchWeather({ force: false }); // Cache will still be checked, which is fine
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  await handleImportFile(file);
  gpxFileInput.value = '';
}

function extensionFromFilename(filename) {
  const match = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

async function detectImportFileKind(file) {
  const ext = extensionFromFilename(file?.name);
  if (ext === 'gpx' || ext === 'kml' || ext === 'melmap' || ext === 'zip') return ext;

  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return 'melmap';

  try {
    const text = await file.slice(0, 4096).text();
    if (/<gpx[\s>]/i.test(text)) return 'gpx';
    if (/<kml[\s>]/i.test(text)) return 'kml';
  } catch (_) {}
  return '';
}

async function handleImportFile(file) {
  const kind = await detectImportFileKind(file);
  if (kind === 'melmap' || kind === 'zip') {
    openMappackImportModal(file);
    return;
  }
  try {
    const text = await platform.readFileAsText(file);
    const { GpxExporter, KmlExporter } = await ensureRouteExporters();
    let result;
    if (kind === 'gpx') {
      result = GpxExporter.parse(text);
    } else if (kind === 'kml') {
      result = KmlExporter.parse(text);
    } else {
      showNotification('不支援的檔案格式', 'error');
      return;
    }
    await applyImportedResult(result);
  } catch (err) {
    showNotification('檔案解析失敗', 'error');
    console.error(err);
  }
}

function isNativeImportUrl(url) {
  try {
    return NATIVE_IMPORT_URL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function nativeImportFilenameHint(url) {
  try {
    const decoded = decodeURIComponent(new URL(url).pathname || '');
    return decoded.split(/[\\/]/).filter(Boolean).pop() || 'mapping-elf-import';
  } catch {
    return 'mapping-elf-import';
  }
}

async function handleNativeImportUrl(url) {
  if (!platform.isNative || !url || !isNativeImportUrl(url) || handledNativeImportUrls.has(url)) return;
  handledNativeImportUrls.add(url);
  try {
    showNotification('正在載入外部檔案...', 'info', 1600);
    const file = await platform.readUrlAsFile(url, { filename: nativeImportFilenameHint(url) });
    await handleImportFile(file);
  } catch (err) {
    console.error('Native file import failed:', err);
    showNotification('檔案解析失敗', 'error');
  }
}

async function installNativeFileOpenHandlers() {
  if (!platform.isNative || nativeFileOpenHandlersInstalled) return;
  nativeFileOpenHandlersInstalled = true;

  platform.subscribeOpenUrl?.((event) => {
    handleNativeImportUrl(event?.url).catch((err) => console.error('Native file open event failed:', err));
  });

  const launchUrl = await platform.getLaunchUrl?.();
  if (launchUrl) await handleNativeImportUrl(launchUrl);
}

// =========== Windy URL Builder ===========

function buildWindyUrl(lat, lng, date, hour, layerOverride) {
  const zoom = Math.round(mapManager.map.getZoom());
  const latF = lat.toFixed(3);
  const lngF = lng.toFixed(3);
  const layer = layerOverride || windyLayer;
  const model = windyModel;
  let ts = '';
  if (date && hour != null) {
    const localDt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`);
    const utcDate = localDt.getUTCFullYear() + '-' +
      String(localDt.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(localDt.getUTCDate()).padStart(2, '0');
    const utcHour = String(localDt.getUTCHours()).padStart(2, '0');
    ts = `,${utcDate}-${utcHour}`;
  }

  // multimodel: special URL regardless of layer
  if (model === 'multimodel') {
    return `https://www.windy.com/multimodel/${latF}/${lngF}?satellite${ts},${latF},${lngF},${zoom}`;
  }

  // Layers with fixed paths — model does not change the path, only the view layer
  // meteogram / airgram: always their own path, use model as query if non-ECMWF
  if (layer === 'meteogram') {
    const q = model === 'ecmwf' ? 'satellite' : model;
    return `https://www.windy.com/${latF}/${lngF}/meteogram?${q}${ts},${latF},${lngF},${zoom}`;
  }
  if (layer === 'airgram') {
    const q = model === 'ecmwf' ? 'satellite' : model;
    return `https://www.windy.com/${latF}/${lngF}/airgram?${q}${ts},${latF},${lngF},${zoom}`;
  }
  // airq (CAMS): always its own path, model not applicable
  if (layer === 'airq') {
    return `https://www.windy.com/${latF}/${lngF}/cams/airq?satellite${ts},${latF},${lngF},${zoom}`;
  }

  // For non-ECMWF models: model path + layer as query parameter
  if (model !== 'ecmwf') {
    return `https://www.windy.com/${latF}/${lngF}/${model}?${layer}${ts},${latF},${lngF},${zoom}`;
  }

  // ECMWF model: wind and clouds use path segments; rest use query-only
  if (layer === 'wind') {
    return `https://www.windy.com/${latF}/${lngF}/wind?satellite${ts},${latF},${lngF},${zoom}`;
  }
  if (layer === 'clouds') {
    return `https://www.windy.com/${latF}/${lngF}/meteogram?clouds${ts},${latF},${lngF},${zoom}`;
  }
  return `https://www.windy.com/${latF}/${lngF}?${layer}${ts},${latF},${lngF},${zoom}`;
}

function refreshWindyLinks() {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  container.querySelectorAll('.wt-windy-link').forEach(a => {
    const col = parseInt(a.closest('td')?.dataset.col);
    if (isNaN(col) || !weatherPoints[col]) return;
    const thDate = container.querySelector(`.wt-th-date[data-idx="${col}"]`);
    const thTime = container.querySelector(`.wt-th-time[data-idx="${col}"]`);
    const date = thDate?.querySelector('.wt-date-input')?.value || '';
    const hour = parseInt(thTime?.querySelector('.wt-time-select')?.value ?? '0');
    a.href = buildWindyUrl(weatherPoints[col].lat, weatherPoints[col].lng, date, hour);
  });
  // Per-cell row icons: link uses each cell's own column coords + date/hour
  container.querySelectorAll('.wt-data-cell .row-windy-link').forEach(a => {
    const td = a.closest('td');
    const col = parseInt(td?.dataset.col);
    const layer = a.dataset.layer;
    if (!layer || isNaN(col) || !weatherPoints[col]) return;
    const thDate = container.querySelector(`.wt-th-date[data-idx="${col}"]`);
    const thTime = container.querySelector(`.wt-th-time[data-idx="${col}"]`);
    const date = thDate?.querySelector('.wt-date-input')?.value || '';
    const hour = parseInt(thTime?.querySelector('.wt-time-select')?.value ?? '0');
    a.href = buildWindyUrl(weatherPoints[col].lat, weatherPoints[col].lng, date, hour, layer);
  });
}

// =========== Weather Panel ===========

/** Weather-row key → Windy layer (only those that have a direct Windy counterpart). */
const ROW_KEY_TO_WINDY_LAYER = {
  temp: 'temp',
  precipitation: 'rain',
  windSpeed: 'wind',
  cloudCover: 'clouds',
};

const WINDY_LAYER_LABELS = {
  temp: '溫度',
  rain: '降雨',
  wind: '風速',
  clouds: '雲',
};

/** Layers still shown in the dropdown (ones without a direct row counterpart). */
const REMAINING_WINDY_LAYERS = new Set([
  'radar', 'satellite', 'thunder', 'rainAccu', 'waves',
  'meteogram', 'airgram', 'airq',
]);

function buildRowWindyIconHtml(layer, url, size = 12) {
  const title = `在 Windy 開啟「${WINDY_LAYER_LABELS[layer] || layer}」圖層`;
  return ` <a class="row-windy-link" href="${url}" target="_blank" rel="noopener" title="${title}" data-layer="${layer}" onclick="event.stopPropagation()">` +
    `<img src="https://www.windy.com/favicon.ico" width="${size}" height="${size}" alt="Windy" class="windy-favicon"></a>`;
}

const WEATHER_TOP_ROWS = [
  { key: 'weather', label: '天氣' },
  { key: 'temp', label: '溫度' },
  { key: 'precipitation', label: '雨量' },
  { key: 'precipProb', label: '降雨機率' },
];

const WEATHER_MIDDLE_ROWS = [
  { key: 'tempMax', label: '最高溫' },
  { key: 'tempMin', label: '最低溫' },
  { key: 'feelsLike', label: '體感溫度' },
  { key: 'humidity', label: '濕度' },
  { key: 'dewPoint', label: '露點' },
  { key: 'cloudCover', label: '雲量' },
  { key: 'windSpeed', label: '風速' },
  { key: 'windGust', label: '陣風' },
  { key: 'uvIndex', label: 'UV' },
  { key: 'visibility', label: '能見度' },
  { key: 'sunshineHours', label: '日照' },
  { key: 'radiation', label: '輻射' },
  { key: 'sunrise', label: '日出' },
  { key: 'sunset', label: '日落' },
];

const WEATHER_BOTTOM_ROWS = [
  { key: 'distance', label: '距離' },
  { key: 'elevation', label: '海拔' },
  { key: 'coords', label: '坐標' },
];

const WEATHER_ROWS = [
  ...WEATHER_TOP_ROWS,
  ...WEATHER_MIDDLE_ROWS,
  ...WEATHER_BOTTOM_ROWS,
];

const WEATHER_CARD_TOP_STAT_ROWS = WEATHER_TOP_ROWS.filter(row => row.key === 'precipitation' || row.key === 'precipProb');
const WEATHER_CARD_MIDDLE_ROWS = WEATHER_MIDDLE_ROWS;
const WEATHER_CARD_BOTTOM_ROWS = WEATHER_BOTTOM_ROWS;

let weatherPoints = [];
const LS_WEATHER_KEY = 'mappingElf_weather';
const LS_WEATHER_CELLS_KEY = 'mappingElf_weatherCells';

/** Persisted display-cell values keyed by semantic column key */
let savedWeatherCells = (() => {
  try { return JSON.parse(localStorage.getItem(LS_WEATHER_CELLS_KEY) || '{}'); }
  catch { return {}; }
})();

// Persisted catchment readout (terrain + hydrology fill-ready HTML) keyed by the
// SAME semantic point key as savedWeatherCells, so a waypoint's 集水區 info is
// remembered across refresh / .melmap and shows instantly — the catchment data
// flows through the same save/prune/restore pipeline as the weather cells.
const LS_CATCHMENT_CELLS_KEY = 'mappingElf_catchmentCells';
let savedCatchmentCells = (() => {
  try { return JSON.parse(localStorage.getItem(LS_CATCHMENT_CELLS_KEY) || '{}'); }
  catch { return {}; }
})();
function saveCatchmentCells(semKey, cells) {
  if (!semKey) return;
  savedCatchmentCells[semKey] = cells;
  try { localStorage.setItem(LS_CATCHMENT_CELLS_KEY, JSON.stringify(savedCatchmentCells)); } catch (_) { }
}
function getSavedCatchmentCells(semKey) {
  return (semKey && savedCatchmentCells[semKey]) || null;
}

/**
 * Stable semantic key for a weather column point, based on coordinates.
 * Rounds lat/lng to 2 decimal places (~550 m threshold at equator):
 *   - same location after minor adjustment → same key → cache preserved
 *   - significantly moved → different key → cache miss (stale data not shown)
 */
function getWaypointIdForPoint(pt) {
  if (!pt?.isWaypoint) return null;
  return pt.waypointId || mapManager.getWaypointMetadata(pt.wpIndex)?.waypointId || null;
}

function getLegacySemanticKey(pt) {
  const latK = pt.lat.toFixed(2);
  const lngK = pt.lng.toFixed(2);
  if (pt.isWaypoint) {
    return pt.isReturn ? `ret:${latK},${lngK}` : `wp:${latK},${lngK}`;
  }
  return `int:${latK},${lngK}`;
}

function getSemanticKey(pt) {
  if (pt?.isWaypoint) {
    const waypointId = getWaypointIdForPoint(pt);
    if (waypointId) return `${pt.isReturn ? 'ret' : 'wp'}:${waypointId}`;
  }
  if (Number.isFinite(pt?._cum)) return `int:${Math.round(pt._cum / 10) * 10}`;
  return getLegacySemanticKey(pt);
}

function getSavedWeatherCells(pt) {
  const key = getSemanticKey(pt);
  const legacyKey = getLegacySemanticKey(pt);
  const cells = savedWeatherCells[key] || savedWeatherCells[legacyKey] || null;
  if (cells && key !== legacyKey && !savedWeatherCells[key]) saveWeatherCells(key, cells);
  return cells;
}

function getSavedWeatherCellValue(cells, key) {
  if (!cells) return '—';
  if (key === 'weather') {
    const icon = cells._icon || String(cells.weather || '').split(' ')[0] || '';
    if (cells._weatherCode != null) return `${icon} ${tWmo(cells._weatherCode)}`.trim();
    return translateWeatherText(cells.weather || '—');
  }
  if (!Object.prototype.hasOwnProperty.call(cells, key)) return '—';
  const value = cells[key];
  return value != null && String(value).trim() !== '' ? value : '—';
}

const WEATHER_CONTENT_KEYS = [...WEATHER_TOP_ROWS, ...WEATHER_MIDDLE_ROWS].map(row => row.key);
const WEATHER_DETAIL_KEYS = WEATHER_CONTENT_KEYS.filter(key => key !== 'weather');

function isMeaningfulWeatherValue(value) {
  const text = String(value ?? '').trim();
  return !!text && !['—', '-', '--', '...', '??', '?'].includes(text);
}

function hasSavedWeatherCellField(cells, key) {
  if (!cells) return false;
  return Object.prototype.hasOwnProperty.call(cells, key)
    || (key === 'weather' && (cells._weatherCode != null || isMeaningfulWeatherValue(cells._icon)));
}

function hasSavedWeatherDetailInfo(cells) {
  if (!cells) return false;
  return WEATHER_DETAIL_KEYS.some(key =>
    hasSavedWeatherCellField(cells, key) && isMeaningfulWeatherValue(getSavedWeatherCellValue(cells, key))
  );
}

function hasWeatherDataDetailInfo(data, pt = null) {
  if (!data) return false;
  return WEATHER_DETAIL_KEYS.some(key => isMeaningfulWeatherValue(getCellValue(data, key, pt)));
}

function getWeatherTableCellDisplayValue(colIdx, key) {
  const container = document.getElementById('weather-table-container');
  const valueEl = container?.querySelector(`[data-col="${colIdx}"][data-key="${key}"] .wt-cell-value`);
  const text = valueEl?.textContent?.trim() || '';
  return isMeaningfulWeatherValue(text) ? text : null;
}

function hasWeatherTableDetailInfo(colIdx) {
  return WEATHER_DETAIL_KEYS.some(key => getWeatherTableCellDisplayValue(colIdx, key) !== null);
}

function weatherCellsMatchSchedule(cells, dateStr, hour) {
  if (!cells) return false;
  const storedDate = cells._weatherDate || cells._date || null;
  const storedHour = cells._weatherHour ?? cells._hour ?? null;
  if (!storedDate && storedHour == null) return true;
  if (storedDate && dateStr && storedDate !== dateStr) return false;
  if (storedHour != null && hour != null && Number(storedHour) !== Number(hour)) return false;
  return true;
}

function hasCompletedWeatherLoad(cells, dateStr, hour) {
  if (!cells || !weatherCellsMatchSchedule(cells, dateStr, hour)) return false;
  return hasSavedWeatherDetailInfo(cells);
}

function markWeatherCellsLoaded(cells, dateStr, hour) {
  return {
    ...cells,
    _weatherLoaded: true,
    _weatherLoadState: 'loaded',
    _weatherDate: dateStr || null,
    _weatherHour: Number.isFinite(Number(hour)) ? Number(hour) : null,
  };
}

function applySavedWeatherCellsToColumn(pt, colIdx, cells) {
  if (!pt || !cells) return;
  const container = document.getElementById('weather-table-container');
  WEATHER_ROWS.forEach(row => {
    const hasStoredValue = hasSavedWeatherCellField(cells, row.key);
    if (!hasStoredValue) return;
    const cell = container?.querySelector(`[data-col="${colIdx}"][data-key="${row.key}"]`);
    const val = getSavedWeatherCellValue(cells, row.key);
    if (cell && val) {
      updateWeatherTableCell(cell, row.key, val);
      cell.classList.remove('loading', 'error');
    }
  });
  const icon = cells._icon || String(cells.weather || '').split(' ')[0] || '';
  if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && isMeaningfulWeatherValue(icon)) {
    mapManager.setWaypointWeather(pt.wpIndex, icon);
  }
  updateElevationMarkers();
  updateIntermediateMarkers();
  if (typeof _wcStates !== 'undefined' && _wcStates.has(colIdx)) _renderWeatherCard(colIdx);
}

function getWeatherPointShortLabel(pt, fallbackIdx = 0) {
  if (pt?.isWaypoint && Number.isInteger(pt.wpIndex)) return String(pt.wpIndex + 1);
  return String(fallbackIdx + 1);
}

function getMainWaypointNameList() {
  return weatherPoints
    .filter(pt => pt.isWaypoint && !pt.isReturn)
    .map(pt => `${getWeatherPointShortLabel(pt)}. ${pt.label || ''}`.trim())
    .filter(Boolean);
}

function showMainWaypointNamePeek(anchor = null) {
  const names = getMainWaypointNameList();
  if (names.length === 0) return;
  document.querySelector('.wt-name-peek')?.remove();
  const peek = document.createElement('div');
  peek.className = 'wt-name-peek';
  peek.textContent = names.join('  /  ');
  document.body.appendChild(peek);

  const rect = anchor?.getBoundingClientRect?.();
  const left = rect ? Math.min(window.innerWidth - 16, Math.max(8, rect.left + rect.width / 2)) : window.innerWidth / 2;
  const top = rect ? Math.max(12, rect.top - 10) : Math.max(12, window.innerHeight * 0.36);
  peek.style.left = `${left}px`;
  peek.style.top = `${top}px`;
  requestAnimationFrame(() => peek.classList.add('show'));
  clearTimeout(showMainWaypointNamePeek._timer);
  showMainWaypointNamePeek._timer = setTimeout(() => {
    peek.classList.remove('show');
    setTimeout(() => peek.remove(), 180);
  }, 2600);
}

function showAllWaypointNamePeeks(container, fallbackAnchor = null) {
  const heads = Array.from(container.querySelectorAll('.wt-header-row-label .wt-col-head'))
    .map(th => {
      const colIdx = parseInt(th.dataset.idx);
      const pt = weatherPoints[colIdx];
      if (!pt?.isWaypoint || pt.isReturn) return null;
      const label = pt.label || getWeatherPointShortLabel(pt, colIdx);
      return { th, colIdx, label, rect: th.getBoundingClientRect() };
    })
    .filter(Boolean)
    .sort((a, b) => a.rect.left - b.rect.left);

  if (heads.length === 0) return;
  document.querySelectorAll('.wt-name-peek').forEach(el => el.remove());

  const anchorRect = fallbackAnchor?.getBoundingClientRect?.() || heads[0].rect;
  const showBelow = anchorRect.top <= 86;
  const laneRight = [];
  const lanes = 3;

  heads.forEach(item => {
    const peek = document.createElement('div');
    peek.className = 'wt-name-peek wt-name-peek-single';
    peek.textContent = item.label;
    document.body.appendChild(peek);

    const width = Math.min(Math.max(item.label.length * 12 + 26, 76), Math.min(window.innerWidth - 16, 180));
    const center = item.rect.left + item.rect.width / 2;
    const left = Math.min(window.innerWidth - width / 2 - 8, Math.max(width / 2 + 8, center));
    const boxLeft = left - width / 2;

    let lane = laneRight.findIndex(right => boxLeft > right + 6);
    if (lane < 0) lane = laneRight.length < lanes ? laneRight.length : laneRight.indexOf(Math.min(...laneRight));
    laneRight[lane] = boxLeft + width;

    const top = showBelow
      ? Math.min(window.innerHeight - 12, anchorRect.bottom + 38 + lane * 32)
      : Math.max(12, anchorRect.top - 6 - lane * 32);

    peek.style.width = `${width}px`;
    peek.classList.toggle('below', showBelow);
    peek.style.left = `${left}px`;
    peek.style.top = `${top}px`;
    requestAnimationFrame(() => peek.classList.add('show'));
  });

  clearTimeout(showAllWaypointNamePeeks._timer);
  showAllWaypointNamePeeks._timer = setTimeout(() => {
    document.querySelectorAll('.wt-name-peek').forEach(peek => {
      peek.classList.remove('show');
      setTimeout(() => peek.remove(), 180);
    });
  }, 2300);
}

function showWaypointNamePeek(anchor, pt, fallbackIdx = 0) {
  const label = pt?.label || getWeatherPointShortLabel(pt, fallbackIdx);
  if (!label) return;
  document.querySelector('.wt-name-peek')?.remove();
  const peek = document.createElement('div');
  peek.className = 'wt-name-peek wt-name-peek-single';
  peek.textContent = label;
  document.body.appendChild(peek);

  const rect = anchor?.getBoundingClientRect?.();
  const peekWidth = Math.min(Math.max(label.length * 13 + 28, 90), Math.min(window.innerWidth - 24, 260));
  const left = rect
    ? Math.min(window.innerWidth - peekWidth / 2 - 8, Math.max(peekWidth / 2 + 8, rect.left + rect.width / 2))
    : window.innerWidth / 2;
  const top = rect
    ? (rect.top > 68 ? Math.max(12, rect.top - 6) : Math.min(window.innerHeight - 12, rect.bottom + 42))
    : Math.max(12, window.innerHeight * 0.36);
  peek.style.width = `${peekWidth}px`;
  peek.classList.toggle('below', !!rect && rect.top <= 68);
  peek.style.left = `${left}px`;
  peek.style.top = `${top}px`;
  requestAnimationFrame(() => peek.classList.add('show'));
  clearTimeout(showWaypointNamePeek._timer);
  showWaypointNamePeek._timer = setTimeout(() => {
    peek.classList.remove('show');
    setTimeout(() => peek.remove(), 180);
  }, 1800);
}

function getWeatherTableVisibleIndices() {
  const indices = weatherPoints.map((_, i) => i);
  if (!weatherTableCollapsed) return indices;
  const main = indices.filter(i => weatherPoints[i]?.isWaypoint && !weatherPoints[i]?.isReturn);
  return main.length > 0 ? main : indices;
}

function setWeatherTableCollapsed(collapsed) {
  weatherTableCollapsed = !!collapsed;
  localStorage.setItem(LS_WEATHER_TABLE_COLLAPSED_KEY, weatherTableCollapsed ? '1' : '0');
  renderWeatherPanel();
}

function toggleWeatherTableCollapsed() {
  setWeatherTableCollapsed(!weatherTableCollapsed);
}

/** Persist display-cell values for one column */
function saveWeatherCells(semKey, cells) {
  savedWeatherCells[semKey] = cells;
  try { localStorage.setItem(LS_WEATHER_CELLS_KEY, JSON.stringify(savedWeatherCells)); } catch (_) { }
}

// =========== Reverse Geocoding (place name labels) ===========
const LS_GEOCODE_KEY = 'mappingElf_geocode';
const LS_CUSTOM_NAMES_KEY = 'mappingElf_customNames';
/** "lat4,lng4" → geocoded place name | null */
const waypointPlaceNames = (() => {
  try { return JSON.parse(localStorage.getItem(LS_GEOCODE_KEY) || '{}'); }
  catch { return {}; }
})();
/** "lat4,lng4" → user-set name (overrides geocoded) */
const waypointCustomNames = (() => {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_NAMES_KEY) || '{}'); }
  catch { return {}; }
})();

function _geocodeKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}
/** Returns user custom name > geocoded name > null */
function getEffectiveName(lat, lng) {
  const k = _geocodeKey(lat, lng);
  return waypointCustomNames[k] ?? waypointPlaceNames[k] ?? null;
}
/** Backward-compat alias */
function getPlaceName(lat, lng) { return getEffectiveName(lat, lng); }

/**
 * Centered naming logic for all UI components.
 * Priority: Custom Name > Geocoded Name > Fallback (Start/End/Waypoint N)
 */
function getWaypointLabel(index, lat, lng, isReturn = false) {
  const custom = getEffectiveName(lat, lng);
  if (custom) return custom;

  if (isReturn) return '回程';
  const total = mapManager.waypoints.length;
  if (index === 0) return '起點';
  if (index === total - 1 && total > 1) return '終點';
  return `航點 ${index + 1}`;
}

/**
 * Deduplicate labels in-place: if two items share a label the second becomes
 * "Name (2)", the third "Name (3)", etc.
 */
function deduplicateLabels(pts) {
  // Mapping to track final labels of outbound waypoints by their index
  const wpIndexToFinalLabel = {};

  // First pass: Count outbound labels to identify which ones need numbering
  const outboundCount = {};
  pts.forEach(p => {
    if (!p.isReturn) {
      outboundCount[p.label] = (outboundCount[p.label] || 0) + 1;
    }
  });

  // Second pass: Deduplicate outbound points and record waypoint labels
  const used = {};
  pts.forEach(p => {
    if (!p.isReturn) {
      if (outboundCount[p.label] > 1) {
        used[p.label] = (used[p.label] || 0) + 1;
        if (used[p.label] > 1) {
          p.label = `${p.label} (${used[p.label]})`;
        }
      }
      // Record final label for waypoints to map to return leg later
      if (p.isWaypoint && p.wpIndex !== undefined) {
        wpIndexToFinalLabel[p.wpIndex] = p.label;
      }
    }
  });

  // Third pass: Map return leg waypoints to their outbound counterpart's final label
  pts.forEach(p => {
    if (p.isReturn && p.isWaypoint && p.wpIndex !== undefined) {
      const mappedLabel = wpIndexToFinalLabel[p.wpIndex];
      if (mappedLabel) {
        p.label = mappedLabel;
      }
    }
  });
}
/**
 * Continuous rank for a candidate: type score + distance penalty.
 * K ≈ 150 m per score-unit, matching the old tier width (100/250/500).
 * Smooth — neighbouring waypoints can't flip labels over a few metres of boundary.
 */
const _POI_DIST_K = 150;
function _poiRank(score, dist) {
  return score + (dist || 0) / _POI_DIST_K;
}

/** Apply layer-aware offset: topo favors nature, streets favors facilities. */
function _layerBias(layer, isNatural, isFacility) {
  if (layer === 'topo') {
    if (isNatural) return -2;
    if (isFacility) return 1;
  } else if (layer === 'streets') {
    if (isFacility) return -3;
    if (isNatural) return 1;
  }
  return 0;
}

/** Priority score for an Overpass POI element (lower = higher priority). */
function _poiScore(tags, layer) {
  const n = tags.natural, w = tags.waterway;
  let base;
  if (n === 'peak' || n === 'volcano') base = 0;
  else if (w === 'waterfall') base = 1;
  else if (n === 'spring' || n === 'cave_entrance') base = 2;
  else if (n) base = 3;
  else if (tags.tourism) base = 4;
  else if (tags.historic) base = 5;
  else if (tags.leisure) base = 6;
  else if (tags.amenity) base = 7;
  else if (tags.shop) base = 8;
  else base = 9;
  const isNatural = !!n || w === 'waterfall';
  const isFacility = !!(tags.amenity || tags.shop || tags.tourism || tags.historic || tags.leisure);
  return base + _layerBias(layer, isNatural, isFacility);
}

/** Priority score for the Nominatim result's own data.name (roads/boundaries get 99). */
function _nominatimScore(data, layer) {
  const cat = data.category || '', typ = data.type || '';
  let base;
  if (cat === 'natural') base = (typ === 'peak' || typ === 'volcano') ? 0 : typ === 'waterfall' ? 1 : 2;
  else if (cat === 'waterway') base = 1;
  else if (cat === 'tourism') base = 4;
  else if (cat === 'historic') base = 5;
  else if (cat === 'leisure') base = 6;
  else if (cat === 'amenity') base = 7;
  else if (cat === 'building') base = 7;
  else if (cat === 'shop') base = 8;
  else return 99; // highway, boundary, place, etc. — don't use data.name
  const isNatural = cat === 'natural' || cat === 'waterway';
  const isFacility = cat === 'tourism' || cat === 'historic' || cat === 'leisure' || cat === 'amenity' || cat === 'building' || cat === 'shop';
  return base + _layerBias(layer, isNatural, isFacility);
}

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Signal set by fetchPlaceName when Nominatim returns 429; the queue reads this
// to trigger exponential backoff.
let _geocodeRateLimitHit = false;

async function fetchPlaceName(lat, lng) {
  const k = _geocodeKey(lat, lng);
  if (k in waypointPlaceNames) return waypointPlaceNames[k];
  const layer = (typeof mapManager !== 'undefined' && mapManager?.currentLayerName) || 'topo';

  const latS = lat.toFixed(5), lngS = lng.toFixed(5);

  // Overpass query: search for named POIs with widened radii by feature type
  const ovpQuery = `[out:json][timeout:3];
(
  node["natural"~"peak|volcano"]["name"](around:3000,${latS},${lngS});
  node["waterway"="waterfall"]["name"](around:1000,${latS},${lngS});
  node["natural"~"spring|cave_entrance"]["name"](around:500,${latS},${lngS});
  node["tourism"]["name"](around:500,${latS},${lngS});
  way["tourism"]["name"](around:500,${latS},${lngS});
  node["historic"]["name"](around:500,${latS},${lngS});
  way["historic"]["name"](around:500,${latS},${lngS});
  node["leisure"~"park|nature_reserve|garden"]["name"](around:300,${latS},${lngS});
  way["leisure"~"park|nature_reserve|garden"]["name"](around:300,${latS},${lngS});
  node["amenity"]["name"](around:200,${latS},${lngS});
  way["amenity"]["name"](around:200,${latS},${lngS});
  node["shop"]["name"](around:100,${latS},${lngS});
);
out center 20;`;

  // Provide a short timeout so geocoding doesn't block forever
  const fetchOptions = { signal: AbortSignal.timeout(4000) };

  // Run Nominatim (address / road / admin) and Overpass (nearby POIs) in parallel
  const [nomRes, ovpRes] = await Promise.allSettled([
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'zh-TW,zh,en', 'User-Agent': 'MappingElf/1.0' }, ...fetchOptions }
    ).then(r => {
      if (r.status === 429) { _geocodeRateLimitHit = true; return null; }
      return r.ok ? r.json() : null;
    }),

    fetch(OVERPASS_API, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(ovpQuery),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...fetchOptions
    }).then(r => r.ok ? r.json() : null),
  ]);

  const nomData = nomRes.status === 'fulfilled' ? nomRes.value : null;
  const ovpData = ovpRes.status === 'fulfilled' ? ovpRes.value : null;

  // --- Best Overpass candidate (sorted by continuous rank = score + dist/K) ---
  let ovpName = null, ovpRank = Infinity;
  if (ovpData?.elements) {
    const ranked = ovpData.elements
      .filter(e => e.tags?.name)
      .map(e => {
        const dist = haversineDistance([lat, lng], [e.lat ?? e.center?.lat ?? lat, e.lon ?? e.center?.lon ?? lng]);
        return { name: e.tags.name, rank: _poiRank(_poiScore(e.tags, layer), dist) };
      })
      .sort((a, b) => a.rank - b.rank);
    if (ranked.length) { ovpName = ranked[0].name; ovpRank = ranked[0].rank; }
  }

  // --- Best Nominatim POI name (only if data.name is a landmark, not a road/boundary) ---
  let nomPOI = null, nomPOIRank = Infinity;
  if (nomData?.name) {
    const nomScore = _nominatimScore(nomData, layer);
    if (nomScore < 99) {
      nomPOI = nomData.name;
      const nLat = parseFloat(nomData.lat), nLon = parseFloat(nomData.lon);
      const nDist = (Number.isFinite(nLat) && Number.isFinite(nLon))
        ? haversineDistance([lat, lng], [nLat, nLon]) : 0;
      nomPOIRank = _poiRank(nomScore, nDist);
    }
  }

  // --- Select final name by rank (whichever landmark is better) ---
  let name = null;
  if (ovpName && ovpRank <= nomPOIRank) name = ovpName;
  else if (nomPOI) name = nomPOI;

  // 2. Fallback: road name, then administrative area
  if (!name && nomData) {
    const addr = nomData.address || {};
    name = addr.road ||
      addr.neighbourhood || addr.quarter || addr.suburb ||
      addr.village || addr.hamlet || addr.town ||
      addr.municipality || addr.city_district || addr.district ||
      addr.city || addr.county || null;
  }

  waypointPlaceNames[k] = name ?? null;
  try { localStorage.setItem(LS_GEOCODE_KEY, JSON.stringify(waypointPlaceNames)); } catch (_) { }
  return waypointPlaceNames[k];
}
// Global geocode throttle: ensures Nominatim requests are >= 1s apart across
// all call sites (batch import + rapid manual clicks share the same queue).
const GEOCODE_MIN_INTERVAL_MS = 1000;
let _geocodeQueue = Promise.resolve();
let _lastGeocodeRequestTime = 0;
let _geocode429BackoffMs = 0;

/** Enqueue one point for geocoding. Returns a promise that resolves after the
 *  fetch (or cache hit) completes. Cache hits skip the rate-limit wait. */
function enqueueGeocode(lat, lng) {
  const k = _geocodeKey(lat, lng);
  if (k in waypointPlaceNames || k in waypointCustomNames) {
    return Promise.resolve(waypointPlaceNames[k] ?? null);
  }
  const task = _geocodeQueue.then(async () => {
    // Re-check cache: a prior queued task may have resolved this same point.
    if (k in waypointPlaceNames || k in waypointCustomNames) {
      return waypointPlaceNames[k] ?? null;
    }
    const now = Date.now();
    const wait = Math.max(
      0,
      _lastGeocodeRequestTime + GEOCODE_MIN_INTERVAL_MS + _geocode429BackoffMs - now
    );
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _lastGeocodeRequestTime = Date.now();
    _geocodeRateLimitHit = false;
    const name = await fetchPlaceName(lat, lng);
    if (_geocodeRateLimitHit) {
      _geocode429BackoffMs = _geocode429BackoffMs
        ? Math.min(_geocode429BackoffMs * 2, 30000)
        : 2000;
    } else {
      _geocode429BackoffMs = 0;
    }
    return name;
  });
  _geocodeQueue = task.catch(() => {}); // don't break the chain on error
  return task;
}

/** Geocode waypoints in background; update column labels as results arrive. */
async function geocodeWaypoints(waypoints) {
  const runSeq = ++geocodeRunSeq;
  const runWaypointVersion = waypointVersion;
  const waypointKey = getWaypointSnapshotKey(waypoints);
  const isStale = () => runSeq !== geocodeRunSeq
    || runWaypointVersion !== waypointVersion
    || waypointKey !== getWaypointSnapshotKey(mapManager.waypoints);

  for (let i = 0; i < waypoints.length; i++) {
    if (isStale()) {
      emitTestEvent('geocode-stale-discard', { index: i });
      return;
    }
    const [lat, lng] = waypoints[i];
    try {
      await enqueueGeocode(lat, lng);
    } catch (_) { /* swallow; next point still queues */ }
    if (isStale()) {
      emitTestEvent('geocode-stale-discard', { index: i });
      return;
    }
    _applyPlaceNameToDOM();
  }
}
/** Re-render labels locally after a geocode result or custom name save to avoid UI flashing */
function _applyPlaceNameToDOM() {
  if (weatherPoints.length > 0) {
    const wps = mapManager.waypoints;
    weatherPoints.forEach((pt) => {
      if (pt.isWaypoint) {
        pt.label = getWaypointLabel(pt.wpIndex, pt.lat, pt.lng, pt.isReturn);
      }
    });
    deduplicateLabels(weatherPoints);
  }

  // Update Waypoint List Labels iteratively
  const items = waypointList.querySelectorAll('.waypoint-item');
  if (items.length === mapManager.waypoints.length) {
    mapManager.waypoints.forEach((wp, i) => {
      const pt = weatherPoints.find(p => p.isWaypoint && !p.isReturn && p.wpIndex === i);
      const displayName = pt ? pt.label : getWaypointLabel(i, wp[0], wp[1]);
      const nameEl = items[i].querySelector('.wp-place-name');
      if (nameEl && nameEl.textContent !== displayName) {
        nameEl.textContent = displayName;
      }
    });
  } else {
    updateWaypointList(mapManager.waypoints);
  }

  // Update Weather Table Column Labels iteratively
  const container = document.getElementById('weather-table-container');
  if (container && weatherPoints.length > 0) {
    weatherPoints.forEach((pt, col) => {
      if (pt.isWaypoint) {
        const th = container.querySelector(`.wt-col-head[data-idx="${col}"]`);
        if (th) {
          const labelEl = th.querySelector('.wt-col-label');
          if (labelEl && !labelEl.querySelector('input')) { // skip if user is editing
            const badge = labelEl.querySelector('.wt-elapsed-badge');
            const currentText = (labelEl.childNodes[0]?.nodeType === Node.TEXT_NODE
              ? labelEl.childNodes[0].textContent
              : labelEl.textContent).trim();
            if (currentText !== pt.label) {
              labelEl.innerHTML = '';
              labelEl.appendChild(document.createTextNode(pt.label + (badge ? ' ' : '')));
              if (badge) labelEl.appendChild(badge);
            }
          }
        }
      }
    });
  }

  // Sync labels back to map markers to ensure map, sidebar, and chart match
  const finalLabels = mapManager.waypoints.map((wp, i) => {
    const pt = weatherPoints.find(p => p.isWaypoint && !p.isReturn && p.wpIndex === i);
    return pt ? pt.label : getWaypointLabel(i, wp[0], wp[1]);
  });
  mapManager.setWaypointLabels(finalLabels);
  updateElevationMarkers();
  updateIntermediateMarkers();
}

/**
 * Save a user-edited name for a waypoint, then refresh all labels.
 * @param {number} lat
 * @param {number} lng
 * @param {string} name  Empty string = clear custom name (fall back to geocoded / default)
 */
function saveCustomName(lat, lng, name) {
  const k = _geocodeKey(lat, lng);
  if (name) {
    waypointCustomNames[k] = name;
  } else {
    delete waypointCustomNames[k];
  }
  try { localStorage.setItem(LS_CUSTOM_NAMES_KEY, JSON.stringify(waypointCustomNames)); } catch (_) { }
  _applyPlaceNameToDOM();
  historyRecord();
}

/**
 * Start inline label editing inside a weather-table column header.
 * Double-click on .wt-col-label triggers this.
 */
function startLabelEdit(labelEl, pt) {
  if (labelEl.querySelector('input')) return; // already editing
  const badge = labelEl.querySelector('.wt-elapsed-badge');
  // Current display text (strip badge text)
  const currentText = (labelEl.childNodes[0]?.nodeType === Node.TEXT_NODE
    ? labelEl.childNodes[0].textContent
    : labelEl.textContent).trim();

  const labelColor = labelEl.style.color || 'var(--accent-primary)';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = getEffectiveName(pt.lat, pt.lng) || currentText;
  input.className = 'wt-label-edit-input';
  input.style.color = labelColor;
  input.style.borderColor = labelColor;
  // Stop clicks inside the input from bubbling to labelEl's highlight handler
  input.addEventListener('click', (e) => e.stopPropagation());
  labelEl.innerHTML = '';
  labelEl.appendChild(input);
  if (badge) labelEl.appendChild(badge);
  input.focus();
  input.select();

  let saved = false;
  const commit = () => {
    if (saved) return;
    saved = true;
    saveCustomName(pt.lat, pt.lng, input.value.trim());
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      saved = true;
      input.removeEventListener('blur', commit);
      _applyPlaceNameToDOM(); // restore original label
    }
  });
}

/** Cache key includes date+hour so going/return at the same location can differ. */
const weatherCoordKey = (lat, lng, date, hour) =>
  `${lat.toFixed(4)},${lng.toFixed(4)},${date},${hour}`;

// Temporary weather database. Entries survive route edits/deleted waypoints and
// are removed by manual weather refresh or the update-time cleanup rule.
let cachedWeatherData = (() => {
  try { return normalizeWeatherCacheStore(JSON.parse(localStorage.getItem(LS_WEATHER_CACHE_KEY) || '{}')); }
  catch { return {}; }
})();
pruneWeatherCache({ persist: true });

function normalizeWeatherCacheStore(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const now = Date.now();
  const normalized = {};
  Object.entries(raw).forEach(([key, value]) => {
    const parsedKey = parseWeatherCacheKey(key);
    const isEntry = value
      && typeof value === 'object'
      && !Array.isArray(value)
      && value.data
      && typeof value.data === 'object';
    const data = isEntry ? value.data : value;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    const lat = finiteOrNull(isEntry ? value.lat : parsedKey?.lat);
    const lng = finiteOrNull(isEntry ? value.lng : parsedKey?.lng);
    const date = String((isEntry ? value.date : parsedKey?.date) || '');
    const hour = finiteOrNull(isEntry ? value.hour : parsedKey?.hour);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !date || !Number.isFinite(hour)) return;

    normalized[key] = {
      schema: WEATHER_CACHE_SCHEMA_VERSION,
      lat,
      lng,
      ele: finiteOrNull(isEntry ? value.ele : pointElevationForWeatherCache(null, data)),
      date,
      hour,
      updatedAt: finiteOrNull(isEntry ? value.updatedAt : null) || now,
      data,
    };
  });
  return normalized;
}

function parseWeatherCacheKey(key) {
  const parts = String(key || '').split(',');
  if (parts.length < 4) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  const date = parts[2];
  const hour = Number(parts[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !date || !Number.isFinite(hour)) return null;
  return { lat, lng, date, hour };
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pointElevationForWeatherCache(pt, data = null) {
  const direct = finiteOrNull(pt?._ele ?? pt?.ele);
  if (Number.isFinite(direct)) return direct;
  const dataElevation = data?.elevation;
  if (typeof dataElevation === 'number') return finiteOrNull(dataElevation);
  if (typeof dataElevation === 'string') {
    const parsed = Number(dataElevation.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function makeWeatherCacheEntry(pt, dateStr, hour, data, updatedAt = Date.now()) {
  return {
    schema: WEATHER_CACHE_SCHEMA_VERSION,
    lat: Number(pt.lat),
    lng: Number(pt.lng),
    ele: pointElevationForWeatherCache(pt, data),
    date: dateStr,
    hour: Number(hour),
    updatedAt,
    data,
  };
}

function persistWeatherCache() {
  try { localStorage.setItem(LS_WEATHER_CACHE_KEY, JSON.stringify(cachedWeatherData)); } catch (_) { }
}

function clearWeatherTempCache() {
  cachedWeatherData = {};
  try { localStorage.removeItem(LS_WEATHER_CACHE_KEY); } catch (_) { }
}

function pruneWeatherCache({ persist = false } = {}) {
  const maxAgeMs = Math.max(0.1, Number(weatherCacheMaxAgeDays) || WEATHER_CACHE_MAX_AGE_DEFAULT_DAYS) * 86400000;
  const cutoff = Date.now() - maxAgeMs;
  let changed = false;
  Object.entries(cachedWeatherData || {}).forEach(([key, entry]) => {
    const updatedAt = finiteOrNull(entry?.updatedAt);
    if (!updatedAt || updatedAt < cutoff || !entry?.data) {
      delete cachedWeatherData[key];
      changed = true;
    }
  });
  if (changed && persist) persistWeatherCache();
  return changed;
}

function setWeatherCacheData(pt, dateStr, hour, data, options = {}) {
  if (!weatherCacheEnabled || !pt || !dateStr || !data) return null;
  const cacheKey = options.cacheKey || weatherCoordKey(pt.lat, pt.lng, dateStr, hour);
  const updatedAt = finiteOrNull(options.updatedAt) || Date.now();
  cachedWeatherData[cacheKey] = makeWeatherCacheEntry(pt, dateStr, hour, data, updatedAt);
  persistWeatherCache();
  return cachedWeatherData[cacheKey];
}

function rememberWeatherCacheHitForPoint(hit, pt, dateStr, hour) {
  if (!hit?.entry || !pt || !dateStr) return;
  const currentKey = weatherCoordKey(pt.lat, pt.lng, dateStr, hour);
  if (hit.key === currentKey) return;
  setWeatherCacheData(pt, dateStr, hour, hit.entry.data, {
    cacheKey: currentKey,
    updatedAt: hit.entry.updatedAt,
  });
}

function getWeatherCacheHit(pt, dateStr, hour) {
  if (!weatherCacheEnabled || !pt || !dateStr) return null;
  pruneWeatherCache({ persist: true });

  const exactKey = weatherCoordKey(pt.lat, pt.lng, dateStr, hour);
  const exactEntry = cachedWeatherData[exactKey];
  if (isWeatherCacheEntryUsable(exactEntry, pt, dateStr, hour)) {
    return { key: exactKey, entry: exactEntry, data: exactEntry.data, distanceM: 0 };
  }

  const targetEle = pointElevationForWeatherCache(pt);
  let best = null;
  Object.entries(cachedWeatherData).forEach(([key, entry]) => {
    if (!isWeatherCacheEntryUsable(entry, pt, dateStr, hour, { skipSpatial: true })) return;
    const distanceM = haversineDistance([pt.lat, pt.lng], [entry.lat, entry.lng]);
    if (!Number.isFinite(distanceM) || distanceM > weatherCacheDistanceM) return;

    const entryEle = finiteOrNull(entry.ele);
    const elevationDeltaM = Number.isFinite(targetEle) && Number.isFinite(entryEle)
      ? Math.abs(targetEle - entryEle)
      : 0;
    if (Number.isFinite(targetEle) && Number.isFinite(entryEle) && elevationDeltaM > weatherCacheElevationM) return;

    const score = (distanceM / Math.max(1, weatherCacheDistanceM))
      + (elevationDeltaM / Math.max(1, weatherCacheElevationM));
    if (!best || score < best.score) {
      best = { key, entry, data: entry.data, distanceM, elevationDeltaM, score };
    }
  });
  return best;
}

function getWeatherCacheData(pt, dateStr, hour) {
  return getWeatherCacheHit(pt, dateStr, hour)?.data || null;
}

// --- Catchment (集水區) result cache ----------------------------------------
// Delineation geometry is terrain-derived and time-independent, so it is keyed
// by coordinate only. Mirrors the weather cache: localStorage-backed, pruned by
// the shared max-age setting, gated on weatherCacheEnabled, and exported inside
// .melmap via mappingElf_catchmentCache (see stateKeys.js). The hydrology/weather
// overlay stays time-dependent and is fetched fresh, not stored here.
const LS_CATCHMENT_CACHE_KEY = 'mappingElf_catchmentCache';
const CATCHMENT_CACHE_SCHEMA_VERSION = 1;

let cachedCatchmentData = (() => {
  try { return normalizeCatchmentCacheStore(JSON.parse(localStorage.getItem(LS_CATCHMENT_CACHE_KEY) || '{}')); }
  catch { return {}; }
})();

function normalizeCatchmentCacheStore(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const now = Date.now();
  const out = {};
  Object.entries(raw).forEach(([key, value]) => {
    const result = value?.result;
    const lat = finiteOrNull(value?.lat);
    const lng = finiteOrNull(value?.lng);
    if (lat == null || lng == null) return;
    if (!result || result.status !== 'ok' || !Array.isArray(result.outer) || !result.outer.length) return;
    out[key] = {
      schema: CATCHMENT_CACHE_SCHEMA_VERSION,
      lat, lng,
      updatedAt: finiteOrNull(value?.updatedAt) || now,
      result,
    };
  });
  return out;
}

function catchmentCoordKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

function persistCatchmentCache() {
  try { localStorage.setItem(LS_CATCHMENT_CACHE_KEY, JSON.stringify(cachedCatchmentData)); } catch (_) { }
}

function pruneCatchmentCache({ persist = false } = {}) {
  const maxAgeMs = Math.max(0.1, Number(weatherCacheMaxAgeDays) || WEATHER_CACHE_MAX_AGE_DEFAULT_DAYS) * 86400000;
  const cutoff = Date.now() - maxAgeMs;
  let changed = false;
  Object.entries(cachedCatchmentData || {}).forEach(([key, entry]) => {
    const updatedAt = finiteOrNull(entry?.updatedAt);
    if (!updatedAt || updatedAt < cutoff || entry?.result?.status !== 'ok') {
      delete cachedCatchmentData[key];
      changed = true;
    }
  });
  if (changed && persist) persistCatchmentCache();
  return changed;
}

function getCatchmentCacheHit(lat, lng) {
  if (!weatherCacheEnabled) return null;
  pruneCatchmentCache({ persist: true });
  const entry = cachedCatchmentData[catchmentCoordKey(lat, lng)];
  return entry?.result || null;
}

function setCatchmentCacheData(lat, lng, result) {
  if (!weatherCacheEnabled || result?.status !== 'ok') return;
  cachedCatchmentData[catchmentCoordKey(lat, lng)] = {
    schema: CATCHMENT_CACHE_SCHEMA_VERSION,
    lat: Number(lat),
    lng: Number(lng),
    updatedAt: Date.now(),
    result,
  };
  persistCatchmentCache();
}
pruneCatchmentCache({ persist: true });

function isWeatherCacheEntryUsable(entry, pt, dateStr, hour, options = {}) {
  if (!entry?.data) return false;
  if (entry.date !== dateStr || Number(entry.hour) !== Number(hour)) return false;
  if (!Number.isFinite(Number(entry.lat)) || !Number.isFinite(Number(entry.lng))) return false;
  if (!options.skipSpatial) {
    const distanceM = haversineDistance([pt.lat, pt.lng], [entry.lat, entry.lng]);
    if (!Number.isFinite(distanceM) || distanceM > weatherCacheDistanceM) return false;
    const targetEle = pointElevationForWeatherCache(pt);
    const entryEle = finiteOrNull(entry.ele);
    if (Number.isFinite(targetEle) && Number.isFinite(entryEle)
      && Math.abs(targetEle - entryEle) > weatherCacheElevationM) return false;
  }
  return hasWeatherDataDetailInfo(entry.data, pt);
}

function syncWeatherCacheSettingsUI() {
  const enabledEl = document.getElementById('weather-cache-enable');
  const distanceEl = document.getElementById('weather-cache-distance');
  const elevationEl = document.getElementById('weather-cache-elevation');
  const maxAgeEl = document.getElementById('weather-cache-max-age-days');
  if (enabledEl) enabledEl.checked = weatherCacheEnabled;
  if (distanceEl) distanceEl.value = String(weatherCacheDistanceM);
  if (elevationEl) elevationEl.value = String(weatherCacheElevationM);
  if (maxAgeEl) maxAgeEl.value = formatWeatherCacheMaxAgeDays(weatherCacheMaxAgeDays);
  [distanceEl, elevationEl, maxAgeEl].forEach(el => {
    if (el) el.disabled = !weatherCacheEnabled;
  });
}

function formatWeatherCacheMaxAgeDays(value) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : WEATHER_CACHE_MAX_AGE_DEFAULT_DAYS).toFixed(1);
}

function initWeatherCacheSettingsControls() {
  const enabledEl = document.getElementById('weather-cache-enable');
  const distanceEl = document.getElementById('weather-cache-distance');
  const elevationEl = document.getElementById('weather-cache-elevation');
  const maxAgeEl = document.getElementById('weather-cache-max-age-days');
  syncWeatherCacheSettingsUI();

  enabledEl?.addEventListener('change', () => {
    weatherCacheEnabled = enabledEl.checked;
    localStorage.setItem(LS_WEATHER_CACHE_ENABLED_KEY, weatherCacheEnabled ? '1' : '0');
    syncWeatherCacheSettingsUI();
  });

  const bindNumber = (el, key, fallback, min, max, onChange) => {
    el?.addEventListener('change', () => {
      const value = Math.min(max, Math.max(min, Number(el.value) || fallback));
      onChange(value);
      el.value = key === LS_WEATHER_CACHE_MAX_AGE_DAYS_KEY
        ? formatWeatherCacheMaxAgeDays(value)
        : String(value);
      localStorage.setItem(key, el.value);
      pruneWeatherCache({ persist: true });
    });
  };
  bindNumber(distanceEl, LS_WEATHER_CACHE_DISTANCE_M_KEY, WEATHER_CACHE_DISTANCE_DEFAULT_M, 1, WEATHER_CACHE_MAX_DISTANCE_M, value => { weatherCacheDistanceM = value; });
  bindNumber(elevationEl, LS_WEATHER_CACHE_ELEVATION_M_KEY, WEATHER_CACHE_ELEVATION_DEFAULT_M, 1, WEATHER_CACHE_MAX_ELEVATION_M, value => { weatherCacheElevationM = value; });
  bindNumber(maxAgeEl, LS_WEATHER_CACHE_MAX_AGE_DAYS_KEY, WEATHER_CACHE_MAX_AGE_DEFAULT_DAYS, 0.1, WEATHER_CACHE_MAX_AGE_DAYS, value => { weatherCacheMaxAgeDays = value; });
}

function getWeatherIconMeta(icon) {
  const normalized = String(icon || '').replace(/\ufe0f/g, '');
  const map = {
    '☀': 'sun',
    '🌤': 'partly',
    '⛅': 'partly',
    '☁': 'cloud',
    '🌫': 'fog',
    '🌦': 'shower',
    '🌧': 'rain',
    '🌨': 'snow',
    '❄': 'snow',
    '⛈': 'storm',
    '❓': 'unknown',
  };
  return { cls: map[normalized] || 'unknown', symbol: icon || '?' };
}

function buildWeatherRoundIconHtml(icon, extraClass = '') {
  const meta = getWeatherIconMeta(icon);
  return `<span class="weather-round-icon weather-round-icon--${meta.cls}${extraClass ? ` ${extraClass}` : ''}" data-raw-icon="${_escapeHtml(icon || '')}" aria-hidden="true">${_escapeHtml(meta.symbol)}</span>`;
}

function getCellValue(data, key, pt) {
  const v = (a, b) => a != null ? a : (b != null ? b : '—');
  if (key === 'distance' && pt && Number.isFinite(pt._cum)) return formatDistance(pt._cum);
  if (key === 'elevation' && pt && pt._ele != null) return formatElevation(pt._ele);
  if (key === 'coords' && pt) return formatCoords(pt.lat, pt.lng);
  if (!data) return '—';
  switch (key) {
    case 'weather': return `${data.weatherIcon || ''} ${data.weatherCode != null ? tWmo(data.weatherCode) : translateWeatherText(data.weatherDesc || '—')}`.trim();
    case 'temp': return v(data.temp, data.tempMax);
    case 'tempRange': return (data.tempMax || data.tempMin) ? `${v(data.tempMax, '—')} / ${v(data.tempMin, '—')}` : '—';
    case 'tempMax': return v(data.tempMax, '—');
    case 'tempMin': return v(data.tempMin, '—');
    case 'feelsLike': return v(data.feelsLike, '—');
    case 'humidity': return v(data.humidity, '—');
    case 'dewPoint': return v(data.dewPoint, '—');
    case 'precipitation': return v(data.precipitation, v(data.precipitationSum, '—'));
    case 'precipProb': return v(data.precipProb, v(data.precipProbMax, '—'));
    case 'cloudCover': return v(data.cloudCover, '—');
    case 'windSpeed': return v(data.windSpeed, v(data.windSpeedMax, '—'));
    case 'windGust': return v(data.windGust, v(data.windGustMax, '—'));
    case 'uvIndex': return v(data.uvIndex, v(data.uvIndexMax, '—'));
    case 'visibility': return v(data.visibility, '—');
    case 'sunshineHours': return v(data.sunshineHours, '—');
    case 'radiation': return v(data.radiation, '—');
    case 'sunrise': return v(data.sunrise, '—');
    case 'sunset': return v(data.sunset, '—');
    case 'elevation': return v(data.elevation, '—');
    default: return '—';
  }
}

/**
 * Update a specific cell in the weather table with content and trigger logic.
 * Specifically wraps the weather icon in a trigger span for popup expansion.
 */
function updateWeatherTableCell(cell, key, val) {
  if (!cell) return;
  let valueEl = cell.querySelector('.wt-cell-value');
  const layerForRow = ROW_KEY_TO_WINDY_LAYER[key];

  if (key === 'coords') {
    const col = parseInt(cell.dataset.col);
    const pt = weatherPoints[col];
    const coords = pt ? formatCoords(pt.lat, pt.lng) : val;
    const html = `<span class="wt-cell-value clickable-coords" data-coords="${coords}" title="點擊複製座標">${coords}</span>`;
    if (valueEl) valueEl.outerHTML = html;
    else cell.innerHTML = html;
    return;
  }

  // If the cell should have an icon but it's missing (e.g. cleared by textContent), restore it
  if (layerForRow && !cell.querySelector('.row-windy-link')) {
    const col = parseInt(cell.dataset.col);
    const pt = weatherPoints[col];
    if (pt) {
      const container = document.getElementById('weather-table-container');
      const thDate = container?.querySelector(`.wt-th-date[data-idx="${col}"]`);
      const thTime = container?.querySelector(`.wt-th-time[data-idx="${col}"]`);
      const dateStr = thDate?.querySelector('.wt-date-input')?.value || '';
      const hour = parseInt(thTime?.querySelector('.wt-time-select')?.value ?? '8');
      const iconHtml = buildRowWindyIconHtml(
        layerForRow,
        buildWindyUrl(pt.lat, pt.lng, dateStr, hour, layerForRow),
        12
      );
      cell.innerHTML = `${iconHtml}<span class="wt-cell-value">${formatWeatherTableValueHtml(key, val)}</span>`;
      return;
    }
  }

  if (key === 'weather') {
    val = translateWeatherText(val);
    const parts = val.split(' ');
    const icon = parts[0];
    const desc = parts.slice(1).join(' ');
    const html = `<span class="wt-weather-icon-trigger" title="點擊展開天氣卡">${buildWeatherRoundIconHtml(icon)}</span> ${desc}`;
    if (valueEl) valueEl.innerHTML = html;
    else cell.innerHTML = html;
  } else if (valueEl) {
    valueEl.innerHTML = formatWeatherTableValueHtml(key, val);
  } else {
    cell.innerHTML = `<span class="wt-cell-value">${formatWeatherTableValueHtml(key, val)}</span>`;
  }
}

function formatWeatherTableValueHtml(key, val) {
  const text = String(val ?? '—');
  if (key === 'weather' || key === 'coords') return text;
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return text;
  return `<span class="wt-cell-number">${match[1]}</span><span class="wt-cell-unit">${match[2]}</span>`;
}

/**
 * Persist weather column dates/hours keyed by column identity (not DOM index).
 * Keys:
 *   wp:<wpIndex>       — outgoing waypoint
 *   ret:<wpIndex>      — return waypoint
 *   int:<cumDistM_m>   — interval point (cumulative distance, rounded to nearest 10 m)
 * Fallback cols[] (old index-based) kept for migration compatibility.
 */
function saveWeatherSettings() {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const previous = loadWeatherSettings();
  const byKey = {};
  const cols = [];
  weatherPoints.forEach((pt, i) => {
    if (!pt.isWaypoint) {
      cols[i] = null; // keep legacy index alignment without persisting computed interval times
      return;
    }
    const thDate = container.querySelector(`.wt-th-date[data-idx="${i}"]`);
    const thTime = container.querySelector(`.wt-th-time[data-idx="${i}"]`);
    const previousEntry = getSavedCol(pt, i, previous) || previous?.cols?.[i] || defaultWeatherSchedule();
    const entry = {
      date: thDate?.querySelector('.wt-date-input')?.value || previousEntry.date || '',
      hour: thTime?.querySelector('.wt-time-select')?.value ?? previousEntry.hour ?? '8',
    };
    cols[i] = entry; // keep legacy array for backwards compat
    byKey[getSemanticKey(pt)] = entry;
  });
  localStorage.setItem(LS_WEATHER_KEY, JSON.stringify({ byKey, cols }));
}

function loadWeatherSettings() {
  try { return JSON.parse(localStorage.getItem(LS_WEATHER_KEY) || 'null'); }
  catch { return null; }
}

/** Look up a weatherPoint's saved date/hour from persisted settings. */
function getSavedCol(pt, i, saved) {
  if (!saved) return null;
  if (!pt.isWaypoint) return null; // Interval points are always recalculated from col-0
  if (saved.byKey) {
    const key = getSemanticKey(pt);
    if (saved.byKey[key]) return saved.byKey[key];
    const legacyIndexKey = pt.isReturn ? `ret:${pt.wpIndex}` : `wp:${pt.wpIndex}`;
    if (saved.byKey[legacyIndexKey]) return saved.byKey[legacyIndexKey];
  }
  // Legacy fallback: index-based
  return saved.cols?.[i] ?? null;
}

function defaultWeatherSchedule() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { date, hour: now.getHours() };
}

function readWeatherPointScheduleFromDom(colIdx) {
  const container = document.getElementById('weather-table-container');
  if (!container || colIdx == null || colIdx < 0) return null;
  const date = container.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)?.value;
  const hourRaw = container.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`)?.value;
  const hour = hourRaw != null ? parseInt(hourRaw) : NaN;
  if (!date || Number.isNaN(hour)) return null;
  return { date, hour };
}

function getWeatherPointSchedule(pt, colIdx, saved = loadWeatherSettings(), options = {}) {
  const { preferDom = true, withDefault = true } = options;
  if (preferDom) {
    const domSchedule = readWeatherPointScheduleFromDom(colIdx);
    if (domSchedule) return domSchedule;
  }
  const savedCol = getSavedCol(pt, colIdx, saved);
  if (savedCol?.date) return { date: savedCol.date, hour: parseInt(savedCol.hour ?? '8') };
  return withDefault ? defaultWeatherSchedule() : null;
}

function shiftAllDates(deltaDays, deltaHours) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  const deltaMs = deltaDays * 86400000 + deltaHours * 3600000;
  const N = weatherPoints.length;
  for (let i = 0; i < N; i++) {
    if (!weatherPoints[i]?.isWaypoint) continue;
    const th = container.querySelector(`.wt-col-head[data-idx="${i}"]`);
    if (th) {
      const currentMs = colToMs(th);
      const newMs = currentMs + deltaMs;
      setColToMs(th, newMs);
    }
  }

  syncIntervalTimes();
  saveWeatherSettings();
  updateDateConstraints();
  updateWeatherTimeAdjustButtons();
  refreshOpenWeatherCards();
}

/**
 * Shift a single waypoint's time by deltaMs.
 * Respects strictLinearMode by checking neighbors.
 */
function shiftWaypointTime(idx, deltaMs) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  const thDate = container.querySelector(`.wt-th-date[data-idx="${idx}"]`);
  const di = thDate?.querySelector('.wt-date-input');
  if (!di || di.disabled) return;

  const curMs = colToMs(thDate);
  const newMs = curMs + deltaMs;

  if (strictLinearMode && deltaMs < 0) {
    // For manual shifts, we block going earlier than previous if it's a DATE shift.
    // For HOUR shifts, we let handleWeatherTimeChange handle the bumping.
    if (Math.abs(deltaMs) >= 86400000 && idx > 0) {
       const prevIdx = findAdjacentWaypointIndex(idx, -1);
       const prevTh = prevIdx >= 0 ? getWeatherDateHead(container, prevIdx) : null;
       if (prevTh && newMs < colToMs(prevTh)) return;
    }
  }

  // Snapshot before change for delta-shift logic in handleWeatherTimeChange
  thDate.dataset.prevMs = String(curMs);
  setColToMs(thDate, newMs);
  handleWeatherTimeChange(idx, thDate);
  refreshOpenWeatherCards();
}

/**
 * Align the highlighted weather column to "now" and shift every other waypoint
 * column by the same delta so their relative spacing stays intact.
 * Falls back to column 0 when nothing is highlighted.
 */
function shiftToNow(mode /* 'day' | 'hour' */) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  const anchor =
    container.querySelector('.wt-col-head.wt-col-highlight') ||
    container.querySelector('.wt-col-head[data-idx="0"]');
  if (!anchor) return;

  const now = new Date();
  const idx = anchor.dataset.idx;

  if (mode === 'day') {
    const di = container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`);
    const curDate = di?.value;
    if (!curDate) {
      console.warn(`shiftToNow: Could not find date input for col ${idx}`);
      return;
    }
    const cur = new Date(curDate + 'T00:00:00');
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deltaDays = Math.round((today - cur) / 86400000);
    if (deltaDays !== 0) shiftAllDates(deltaDays, 0);
  } else {
    const hs = container.querySelector(`.wt-th-time[data-idx="${idx}"] .wt-time-select`);
    const curHour = parseInt(hs?.value ?? '');
    if (Number.isNaN(curHour)) return;
    const deltaHours = now.getHours() - curHour;
    if (deltaHours !== 0) shiftAllDates(0, deltaHours);
  }
}

const LS_PANEL_HEIGHT_KEY = 'mappingElf_panelHeight';
const LS_PANEL_HEIGHT_RATIO_KEY = 'mappingElf_panelHeightRatio';

function initWeatherControls() {
  // Event delegation: fetch + date/time adj buttons live inside the dynamic weather table
  document.getElementById('weather-table-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'toggle-weather-table': toggleWeatherTableCollapsed(); break;
      case 'fetch': fetchAllWeatherData({ force: true }); break;
      case 'day-minus': shiftAllDates(-1, 0); break;
      case 'day-plus': shiftAllDates(+1, 0); break;
      case 'day-now': shiftToNow('day'); break;
      case 'hour-minus': shiftAllDates(0, -1); break;
      case 'hour-plus': shiftAllDates(0, +1); break;
      case 'hour-now': shiftToNow('hour'); break;
    }
  });

  // Detailed-catchment table: manual "取得集水區" (force re-fetch of all columns);
  // clicking a failed/stale data column retries just that one (parity with a weather
  // "?" badge click); clicking an OK column highlights its point like the weather table.
  document.getElementById('catchment-table-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="fetch-catchment"]');
    if (btn) { fetchAllCatchmentData({ force: true }); return; }
    if (e.target.closest('[data-action="toggle-weather-table"]')) { toggleWeatherTableCollapsed(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const cell = e.target.closest('[data-cat-col]');
    if (!cell) return;
    const colIdx = parseInt(cell.dataset.catCol);
    if (isNaN(colIdx)) return;
    const pt = weatherPoints[colIdx];
    if (pt && catchmentColumnNeedsFetch(pt, colIdx)) fetchCatchmentForUnloadedColumn(colIdx);
    else highlightPoint(colIdx, true);
  });

  const panel = document.getElementById('bottom-panel');
  const handle = document.getElementById('bp-resize-handle');
  if (!panel) return;

  // Helpers: save/restore panel height as a viewport ratio so portrait↔landscape
  // transitions maintain the same proportional split.
  const MIN_H = 56;
  // Hard upper bound: divider must never hide behind the fixed toolbar.
  const getMaxPanelH = () => {
    const toolbar = document.querySelector('.toolbar');
    const toolbarH = toolbar ? toolbar.offsetHeight : 0;
    // Leave a small gap on mobile to ensure the handle remains reachable
    const gap = window.innerWidth <= 768 ? 12 : 0;
    return Math.max(MIN_H, window.innerHeight - toolbarH - gap);
  };
  const isElevationChartExpanded = () => {
    const chart = panel.querySelector('#elevation-chart-container');
    return chart && !chart.classList.contains('collapsed');
  };
  const getChartOnlyPanelH = () => {
    const chartRow = panel.querySelector('.bp-chart-row');
    const chartH = chartRow?.offsetHeight || 0;
    return Math.max(MIN_H, Math.min(getMaxPanelH(), (handle?.offsetHeight || 18) + chartH));
  };
  const savePanelRatio = () => {
    const ratio = panel.offsetHeight / window.innerHeight;
    localStorage.setItem(LS_PANEL_HEIGHT_RATIO_KEY, ratio);
  };
  const applyPanelRatio = () => {
    const savedRatio = parseFloat(localStorage.getItem(LS_PANEL_HEIGHT_RATIO_KEY));
    // Fall back to legacy absolute-pixel key for existing installs
    const legacyH = parseInt(localStorage.getItem(LS_PANEL_HEIGHT_KEY));
    let h;
    if (savedRatio > 0) {
      h = Math.round(savedRatio * window.innerHeight);
    } else if (legacyH > 0) {
      h = legacyH;
    } else {
      // Default: handle + summary chips + elevation-chart height. Measured from
      // the always-visible summary bar plus the chart so the default stays right
      // regardless of the active view (F5 toggle) — the chart's offsetHeight is 0
      // while hidden in weather mode, so fall back to a sensible constant then.
      const summaryBar = panel.querySelector('#route-summary-bar');
      const chart = panel.querySelector('#elevation-chart-container');
      const chartH = chart?.offsetHeight || 148;
      h = (handle.offsetHeight || 18) + (summaryBar?.offsetHeight || 0) + chartH + 16;
    }

    if (h > 0) {
      // Allow full range so dbl-click collapsed/expanded states persist across reloads.
      const clamped = Math.max(0, Math.min(getMaxPanelH(), h));
      panel.style.height = `${clamped}px`;
      document.documentElement.style.setProperty('--bottom-panel-height', `${clamped}px`);
    }
  };

  // Restore saved height or apply smart default (handle + chart)
  requestAnimationFrame(applyPanelRatio);

  // Sync CSS var whenever panel naturally resizes (content changes)
  new ResizeObserver(entries => {
    const h = Math.round(entries[0]?.contentRect.height || 0);
    if (h > 0 && !panel._resizing)
      document.documentElement.style.setProperty('--bottom-panel-height', `${h}px`);
    // Redraw chart so it fills the container correctly after layout changes.
    // Skip during active drag — chart.resize() is expensive and would be called
    // on every pixel of movement, causing stutter. The drag-end path handles it.
    if (!panel._resizing)
      requestAnimationFrame(() => elevationProfile?.chart?.resize());
  }).observe(panel);

  if (!handle) return;

  const invalidateMapSize = () => {
    mapManager.map.invalidateSize({ animate: false, pan: false });
  };
  const invalidateMapSizeAfterLayout = () => {
    requestAnimationFrame(() => {
      invalidateMapSize();
      requestAnimationFrame(invalidateMapSize);
    });
  };

  // --- Drag-to-resize ---
  // rAF-coalesce pointer moves: multiple move events within a single frame are
  // collapsed into one DOM write, which keeps the drag smooth under high-rate
  // input (trackpads, high-Hz touch screens).
  let pendingClientY = null;
  let rafId = 0;
  const flushHeight = () => {
    rafId = 0;
    if (pendingClientY == null) return;
    const clientY = pendingClientY;
    pendingClientY = null;
    const h = Math.max(MIN_H, Math.min(getMaxPanelH(), window.innerHeight - clientY));
    panel.style.height = `${h}px`;
    document.documentElement.style.setProperty('--bottom-panel-height', `${h}px`);
    invalidateMapSize();
  };
  const scheduleHeight = (clientY) => {
    pendingClientY = clientY;
    if (!rafId) rafId = requestAnimationFrame(flushHeight);
  };
  const cancelPending = () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    pendingClientY = null;
  };
  const DRAG_START_THRESHOLD = 6;
  let lastHandleTouchWasDrag = false;
  const beginPanelResize = () => {
    panel.style.transition = '';
    panel._resizing = true;
    document.body.classList.add('is-resizing');
    handle.classList.add('dragging');
  };
  const endPanelResize = () => {
    cancelPending();
    panel._resizing = false;
    document.body.classList.remove('is-resizing');
    handle.classList.remove('dragging');
    savePanelRatio();
    invalidateMapSizeAfterLayout();
    requestAnimationFrame(() => elevationProfile?.chart?.resize());
  };

  // Mouse
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    let didDrag = false;
    const onMove = (ev) => {
      if (!didDrag) {
        if (Math.abs(ev.clientY - startY) < DRAG_START_THRESHOLD) return;
        didDrag = true;
        beginPanelResize();
      }
      scheduleHeight(ev.clientY);
    };
    const onUp = () => {
      if (didDrag) endPanelResize();
      else cancelPending();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch
  handle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    lastHandleTouchWasDrag = false;
    const startY = e.touches[0].clientY;
    let didDrag = false;
    const onMove = (ev) => {
      const touch = ev.touches[0];
      if (!touch) return;
      if (!didDrag) {
        if (Math.abs(touch.clientY - startY) < DRAG_START_THRESHOLD) return;
        didDrag = true;
        lastHandleTouchWasDrag = true;
        beginPanelResize();
      }
      ev.preventDefault();
      scheduleHeight(touch.clientY);
    };
    const onEnd = () => {
      lastHandleTouchWasDrag = didDrag;
      if (didDrag) endPanelResize();
      else cancelPending();
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }, { passive: false });

  // --- Double-click toggle: 0:10 ↔ 10:0 ---
  // Collapsed state keeps the handle bar visible so it remains clickable;
  // expanded state lets the panel fill the whole viewport.
  const COLLAPSE_H = handle.offsetHeight || 18;
  const togglePanel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const viewH = window.innerHeight;
    const expandH = getMaxPanelH();
    const currentH = panel.offsetHeight;
    const targetH = currentH > viewH / 2
      ? (isElevationChartExpanded() ? getChartOnlyPanelH() : COLLAPSE_H)
      : expandH;
    panel.style.transition = 'height 0.25s ease';
    panel.style.height = `${targetH}px`;
    document.documentElement.style.setProperty('--bottom-panel-height', `${targetH}px`);
    const onEnd = () => {
      panel.style.transition = '';
      panel.removeEventListener('transitionend', onEnd);
      savePanelRatio();
      invalidateMapSizeAfterLayout();
      requestAnimationFrame(() => elevationProfile?.chart?.resize());
    };
    panel.addEventListener('transitionend', onEnd);
  };
  handle.addEventListener('dblclick', togglePanel);
  // Touch: detect double-tap within 300ms on the handle
  let lastTap = 0;
  handle.addEventListener('touchend', (e) => {
    if (lastHandleTouchWasDrag) {
      lastTap = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTap < 300) {
      togglePanel(e);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });

  // Re-apply saved ratio when viewport changes (orientation change, keyboard, etc.)
  // so portrait↔landscape preserves the proportional split.
  window.addEventListener('resize', () => {
    if (panel._resizing) return;
    applyPanelRatio();
    invalidateMapSizeAfterLayout();
  });
}

function updateIntermediateMarkers() {
  if (!weatherPoints || weatherPoints.length === 0) {
    mapManager.clearIntermediateMarkers();
    return;
  }

  const pts = weatherPoints
    .map((p, i) => ({ pt: p, i }))
    .filter(x => !x.pt.isWaypoint)
    .map(x => {
      // Look up weather icon for intermediate point
      const schedule = getWeatherPointSchedule(x.pt, x.i);
      const cached = schedule ? getWeatherCacheData(x.pt, schedule.date, schedule.hour) : null;
      const weatherIcon = cached?.weatherIcon || getSavedWeatherCells(x.pt)?.weather?.split(' ')[0] || null;

      return {
        lat: x.pt.lat,
        lng: x.pt.lng,
        cumDistM: x.pt._cum,
        label: x.pt.label,
        colIdx: x.i,
        weatherIcon
      };
    });

  let totalDistM = 0;
  if (currentRouteCoords.length > 1) {
    totalDistM = elevationProfile.distances.at(-1) || 0;
  }

  // Turnaround distance: largest _cum among forward (non-return) waypoints.
  let turnaroundDistM = null;
  if ((roundTripMode || oLoopMode) && !importedTrackMode) {
    const fwdCums = weatherPoints
      .filter(p => p.isWaypoint && !p.isReturn && typeof p._cum === 'number')
      .map(p => p._cum);
    if (fwdCums.length) turnaroundDistM = Math.max(...fwdCums);
  }

  mapManager.setIntermediateMarkers(pts, totalDistM, turnaroundDistM);
  updateReturnWaypointMarkers();
}

function updateReturnWaypointMarkers() {
  if (!weatherPoints || weatherPoints.length === 0) {
    mapManager.clearReturnWaypoints();
    return;
  }
  const pts = weatherPoints
    .map((p, i) => ({ pt: p, i }))
    .filter((x) => x.pt.isWaypoint && x.pt.isReturn)
    .map((x) => {
      const schedule = getWeatherPointSchedule(x.pt, x.i);
      const cached = schedule ? getWeatherCacheData(x.pt, schedule.date, schedule.hour) : null;
      const weatherIcon = cached?.weatherIcon || getSavedWeatherCells(x.pt)?.weather?.split(' ')[0] || null;
      return {
        lat: x.pt.lat,
        lng: x.pt.lng,
        wpIndex: x.pt.wpIndex,
        label: x.pt.label,
        colIdx: x.i,
        cumDistM: x.pt._cum,
        color: _weatherPointGradColor(x.pt),
        weather: weatherIcon,
      };
    });
  mapManager.setReturnWaypoints(pts);
}

function buildWeatherPoints() {
  const wps = mapManager.waypoints;
  const coords = currentRouteCoords;
  if (wps.length === 0) {
    return [];
  }

  const result = buildWeatherPointsFromState({
    waypoints: wps,
    coords,
    routeMetrics: getRouteMetrics(coords, wps),
    importedTrackMode,
    importedIntermediatePoints,
    roundTripMode,
    oLoopMode,
    speedIntervalMode,
    segmentIntervalKm,
    perSegmentMode,
    elevationPoints: elevationProfile.points,
    elevationElevations: elevationProfile.elevations,
    elevationDistances: elevationProfile.distances,
    speedActivity,
    paceParams,
    getPaceComputation,
    getWaypointMetadata: (index) => mapManager.getWaypointMetadata(index),
    getWaypointLabel,
    getCustomName: (lat, lng) => waypointCustomNames[_geocodeKey(lat, lng)],
    getPlaceName: (lat, lng) => waypointPlaceNames[_geocodeKey(lat, lng)],
    getGeocodeKey: _geocodeKey,
    interpolateElevAtCumM: (cumM) => elevationProfile._interpolateElevAtCumM(cumM),
  });
  waypointCumDistM = result.waypointCumDistM;
  return result.points;
}

function computeWeatherPointPositions() {
  const N = weatherPoints.length;
  if (N === 0) return [];

  const totalDist = currentRouteCoords.length > 1
    ? getRouteMetrics().totalDistM
    : (weatherPoints.at(-1)?._cum || 1);

  if (totalDist === 0) return weatherPoints.map((_, i) => N <= 1 ? 0.5 : i / (N - 1));

  // Use pre-calculated _cum distance instead of re-projecting coords (which fails on out-and-back)
  return weatherPoints.map(pt => (pt._cum || 0) / totalDist);
}

function handleWeatherTimeChange(idx, th) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  if (!th) th = getWeatherDateHead(container, idx);
  if (!th) return;

  // 1. Enforce strict linear ordering: if this waypoint is earlier than its predecessor
  // on the same day, bump it to the next day.
  if (strictLinearMode && idx > 0) {
    const prevIdx = findAdjacentWaypointIndex(idx, -1);
    const prevDate = prevIdx >= 0
      ? container.querySelector(`.wt-th-date[data-idx="${prevIdx}"] .wt-date-input`)?.value
      : '';
    const curDate = container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`)?.value;
    const prevH = prevIdx >= 0
      ? parseInt(container.querySelector(`.wt-th-time[data-idx="${prevIdx}"] .wt-time-select`)?.value ?? '0')
      : 0;
    const curH = parseInt(container.querySelector(`.wt-th-time[data-idx="${idx}"] .wt-time-select`)?.value ?? '0');

    if (prevDate && curDate && prevDate === curDate && curH < prevH) {
      const d = new Date(curDate + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dy = String(d.getDate()).padStart(2, '0');
      const di = container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`);
      if (di) di.value = `${y}-${mo}-${dy}`;
    }
  }

  // 2. Calculate shift delta. Use dataset.prevMs (snapshot on focus) to determine how much 
  // the user shifted this point, so we can apply the same delta to all subsequent waypoints.
  let prevMs = parseInt(th.dataset.prevMs);
  if (isNaN(prevMs)) {
    const saved = loadWeatherSettings();
    const pt = weatherPoints[idx];
    const sv = getSavedCol(pt, idx, saved);
    if (sv && sv.date) {
      prevMs = new Date(sv.date + 'T00:00:00').getTime() + parseInt(sv.hour) * 3600000;
    } else {
      prevMs = colToMs(th);
    }
  }
  const deltaMs = colToMs(th) - prevMs;

  if (deltaMs !== 0) {
    // Shifting subsequent waypoints linearly provides a natural "move entire trip" UX.
    // Interval points are skipped here and handled by the cascade logic below.
    for (let j = idx + 1; j < weatherPoints.length; j++) {
      if (weatherPoints[j]?.isWaypoint) {
        const nextTh = getWeatherDateHead(container, j);
        if (nextTh) setColToMs(nextTh, colToMs(nextTh) + deltaMs);
      }
    }
  }

  // 3. Sync interval points and enforce ordering.
  // We save settings after the linear shift so the cascade/enforce logic sees the new waypoint times.
  saveWeatherSettings();
  if (speedIntervalMode) {
    syncPaceWeatherTimes(idx);
  } else {
    syncIntervalTimesFromWP();
  }
  // Save again to persist any adjustments made by sync/enforce (e.g. min-time enforcement)
  saveWeatherSettings();

  updateDateConstraints();
  updateWeatherTimeAdjustButtons();
  th.dataset.prevMs = String(colToMs(th));
  refreshWindyLinks();
  
  // Refresh weather for the edited column. 
  // Subsequent columns that shifted will retain their old weather data until a global 
  // "Update Weather" fetch is triggered, to avoid massive parallel API calls on every slider change.
  fetchAllWeatherData({ onlyColIndex: idx });

  refreshOpenWeatherCards();
  
  // Ensure the edited point is highlighted and map is panned
  highlightPoint(idx);
}

/** Re-render all currently open weather cards (Map Popups). */
function refreshOpenWeatherCards() {
  if (typeof _wcStates !== 'undefined' && _wcStates.size > 0) {
    _wcStates.forEach((state, cIdx) => {
      _renderWeatherCard(cIdx);
    });
  }
  syncCatchmentBasins();   // keep basins in step with the catchment-view memory
}

const timeOpts = (sel) => Array.from({ length: 24 }, (_, h) =>
  `<option value="${h}"${h === sel ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`
).join('');

function buildDayFirstDateHtml(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-');
  if (!year || !month || !day) return '<span class="wt-date-display"><span class="wt-date-day">--</span></span>';
  return `<span class="wt-date-display" aria-hidden="true"><span class="wt-date-day">${day}</span><span class="wt-date-meta">${month}/${year}</span></span>`;
}

function refreshWeatherDateDisplays(root = document) {
  root.querySelectorAll('.wt-date-picker').forEach((wrap) => {
    const input = wrap.querySelector('.wt-date-input');
    const display = wrap.querySelector('.wt-date-display');
    if (!input || !display) return;
    display.outerHTML = buildDayFirstDateHtml(input.value);
  });
}

function buildWeatherCollapseButton() {
  const label = weatherTableCollapsed ? '展開天氣資訊' : '收縮天氣資訊';
  const path = weatherTableCollapsed
    ? 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'
    : 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z';
  return `<button class="wt-ctrl-collapse" data-action="toggle-weather-table" title="${label}" aria-label="${label}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>
  </button>`;
}

function buildWeatherColumnClassNames(pt, colIdx, firstReturnIdx, baseClass) {
  let classNames = baseClass;
  if (pt.isReturn) classNames += ' wt-return-col';
  if (!pt.isWaypoint) classNames += ' wt-interval-col';
  if (colIdx === firstReturnIdx) classNames += ' wt-return-start';
  return classNames;
}

function buildWeatherDataColumnClassNames(pt, colIdx, firstReturnIdx, baseClass) {
  let classNames = baseClass;
  if (pt.isReturn) classNames += ' wt-return-col';
  if (colIdx === firstReturnIdx) classNames += ' wt-return-start';
  return classNames;
}

function buildWeatherColgroupHtml(labelW, colWidths) {
  let html = `<colgroup><col style="width:${labelW}px">`;
  colWidths.forEach(w => { html += `<col style="width:${Math.round(w)}px">`; });
  return `${html}</colgroup>`;
}

function buildWeatherTableControlHeaderHtml() {
  return `<th class="wt-label-cell wt-th">
      ${buildWeatherCollapseButton()}
      <button class="wt-ctrl-fetch" data-action="fetch" title="更新天氣">
        <svg class="wt-ctrl-fetch-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="currentColor"/></svg>
        <span>更新天氣</span>
      </button>
    </th>`;
}

function buildWeatherDateBulkControlHtml() {
  return `<th class="wt-label-cell wt-th">
      <div class="wt-ctrl-adj-row" title="所有日期 ±1 天">
        <button class="wt-ctrl-adj" data-action="day-minus">−</button>
        <button class="wt-ctrl-now" data-action="day-now" title="將目前選取欄位設為今日,其他欄位同步對齊">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" fill="currentColor"/></svg>
        </button>
        <button class="wt-ctrl-adj" data-action="day-plus">+</button>
      </div>
    </th>`;
}

function buildWeatherTimeBulkControlHtml() {
  return `<th class="wt-label-cell wt-th">
      <div class="wt-ctrl-adj-row" title="所有時間 ±1 小時">
        <button class="wt-ctrl-adj" data-action="hour-minus">−</button>
        <button class="wt-ctrl-now" data-action="hour-now" title="將目前選取欄位設為現在時刻,其他欄位同步對齊">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="currentColor"/><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="currentColor"/></svg>
        </button>
        <button class="wt-ctrl-adj" data-action="hour-plus">+</button>
      </div>
    </th>`;
}

function buildWeatherElapsedBadgeHtml(pt, colIdx) {
  let displayElapsedH = pt._elapsedH || 0;
  if (perSegmentMode && displayElapsedH > 0) {
    let prevWpElapsed = 0;
    for (let j = colIdx - 1; j >= 0; j--) {
      if (weatherPoints[j]?.isWaypoint) {
        prevWpElapsed = weatherPoints[j]._elapsedH || 0;
        break;
      }
    }
    displayElapsedH -= prevWpElapsed;
  }
  return (speedIntervalMode || segmentIntervalKm > 0) && displayElapsedH > 0
    ? `<span class="wt-elapsed-badge">${formatDurationHHMM(displayElapsedH)}</span>`
    : '';
}

function buildWeatherLabelHeaderCellHtml(pt, colIdx, visiblePos, firstReturnIdx) {
  const gradColor = _weatherPointGradColor(pt);
  const rgba = (alpha) => gradColor.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
  const thClass = buildWeatherColumnClassNames(pt, colIdx, firstReturnIdx, 'wt-col-head wt-th');
  const labelStyle = pt.isWaypoint
    ? `style="color:${gradColor}; font-weight: bold;"`
    : `style="color:${rgba(0.7)};"`;
  const thStyle = pt.isWaypoint
    ? `style="border-top: 3px solid ${rgba(0.8)}; background-color: var(--bg-tertiary); background-image: linear-gradient(to bottom, ${rgba(0.1)}, transparent);"`
    : `style="border-top: 2px solid ${rgba(0.2)};"`;
  const displayLabel = weatherTableCollapsed ? getWeatherPointShortLabel(pt, visiblePos) : pt.label;
  const safeDisplayLabel = _escapeHtml(displayLabel);
  const safeTitle = _escapeHtml(pt.label || displayLabel || '');
  const titleAttr = weatherTableCollapsed ? ` title="${safeTitle}"` : '';
  const elapsedBadge = buildWeatherElapsedBadgeHtml(pt, colIdx);

  return `<th class="${thClass}" data-idx="${colIdx}" ${thStyle}${titleAttr}>
      <div class="wt-col-label" ${labelStyle}${titleAttr}>${safeDisplayLabel}${weatherTableCollapsed ? '' : elapsedBadge}</div>
    </th>`;
}

function buildWeatherLabelHeaderRowHtml(visibleIndices, firstReturnIdx) {
  let html = `<tr class="wt-header-row wt-header-row-label">
    ${buildWeatherTableControlHeaderHtml()}`;
  visibleIndices.forEach((colIdx, visiblePos) => {
    html += buildWeatherLabelHeaderCellHtml(weatherPoints[colIdx], colIdx, visiblePos, firstReturnIdx);
  });
  return `${html}</tr>`;
}

function getWeatherDateHeaderState(pt, colIdx, saved, todayStr) {
  const sv = getSavedCol(pt, colIdx, saved);
  const date = sv?.date || todayStr;
  const locked = !pt.isWaypoint;
  let minAttr = '';
  let canMinus = !locked;
  let canPlus = !locked;

  if (strictLinearMode && colIdx > 0) {
    const prevIdx = findAdjacentWaypointIndex(colIdx, -1);
    const prevVal = prevIdx >= 0 ? (getSavedCol(weatherPoints[prevIdx], prevIdx, saved)?.date || todayStr) : '';
    if (prevVal) minAttr = ` min="${prevVal}"`;
  }

  if (strictLinearMode && !locked && colIdx > 0) {
    const prevIdx = findAdjacentWaypointIndex(colIdx, -1);
    const prevSv = prevIdx >= 0 ? getSavedCol(weatherPoints[prevIdx], prevIdx, saved) : null;
    const curDateMs = new Date(date + 'T00:00:00').getTime();
    const prevDateMs = new Date((prevSv?.date || todayStr) + 'T00:00:00').getTime();
    if (curDateMs - 86400000 < prevDateMs) canMinus = false;
  }

  return { date, locked, minAttr, canMinus, canPlus };
}

function buildWeatherDateHeaderCellHtml(pt, colIdx, firstReturnIdx, saved, todayStr) {
  const { date, locked, minAttr, canMinus, canPlus } = getWeatherDateHeaderState(pt, colIdx, saved, todayStr);
  const thClass = buildWeatherColumnClassNames(pt, colIdx, firstReturnIdx, 'wt-col-head wt-th wt-th-date');

  return {
    date,
    html: `<th class="${thClass}" data-idx="${colIdx}" title="${_escapeHtml(pt.label || '')}">
      <div class="wt-adj-wrap">
        <button class="wt-adj-btn wt-adj-day-minus" title="前一天"${canMinus ? '' : ' disabled'}>−</button>
        <span class="wt-picker-icon wt-date-picker has-day-first" title="選擇日期">
          ${buildDayFirstDateHtml(date)}
          <input type="date" class="wt-date-input" value="${date}"${locked ? ' disabled' : ''}${minAttr}>
        </span>
        <button class="wt-adj-btn wt-adj-day-plus" title="後一天"${canPlus ? '' : ' disabled'}>+</button>
      </div>
    </th>`,
  };
}

function buildWeatherDateHeaderRowHtml(visibleIndices, firstReturnIdx, saved, todayStr, colTimes) {
  let html = `<tr class="wt-header-row wt-header-row-date">
    ${buildWeatherDateBulkControlHtml()}`;
  visibleIndices.forEach((colIdx) => {
    const cell = buildWeatherDateHeaderCellHtml(weatherPoints[colIdx], colIdx, firstReturnIdx, saved, todayStr);
    colTimes[colIdx] = { date: cell.date };
    html += cell.html;
  });
  return `${html}</tr>`;
}

function buildWeatherTimeHeaderCellHtml(pt, colIdx, firstReturnIdx, saved, nowHour) {
  const sv = getSavedCol(pt, colIdx, saved);
  const hour = sv?.hour != null ? parseInt(sv.hour) : nowHour;
  const locked = !pt.isWaypoint;
  const thClass = buildWeatherColumnClassNames(pt, colIdx, firstReturnIdx, 'wt-col-head wt-th wt-th-time');

  return {
    hour,
    html: `<th class="${thClass}" data-idx="${colIdx}" title="${_escapeHtml(pt.label || '')}">
      <div class="wt-time-row">
        <button class="wt-adj-btn wt-adj-hour-minus" title="前一小時"${locked ? ' disabled' : ''}>−</button>
        <span class="wt-picker-icon wt-time-picker" title="選擇時間">
          <select class="wt-time-select"${locked ? ' disabled' : ''}>${timeOpts(hour)}</select>
        </span>
        <button class="wt-adj-btn wt-adj-hour-plus" title="後一小時"${locked ? ' disabled' : ''}>+</button>
      </div>
    </th>`,
  };
}

function buildWeatherTimeHeaderRowHtml(visibleIndices, firstReturnIdx, saved, nowHour, colTimes) {
  let html = `<tr class="wt-header-row wt-header-row-time">
    ${buildWeatherTimeBulkControlHtml()}`;
  visibleIndices.forEach((colIdx) => {
    const cell = buildWeatherTimeHeaderCellHtml(weatherPoints[colIdx], colIdx, firstReturnIdx, saved, nowHour);
    if (!colTimes[colIdx]) colTimes[colIdx] = {};
    colTimes[colIdx].hour = cell.hour;
    html += cell.html;
  });
  return `${html}</tr>`;
}

function buildWeatherDataCellHtml(row, pt, colIdx, firstReturnIdx, colTimes) {
  const layerForRow = ROW_KEY_TO_WINDY_LAYER[row.key];
  const tdClass = buildWeatherDataColumnClassNames(
    pt,
    colIdx,
    firstReturnIdx,
    `wt-data-cell wt-td${layerForRow ? ' wt-cell-with-icon' : ''}`,
  );
  const cellStyle = !pt.isWaypoint ? ' style="opacity: 0.8;"' : '';
  const colTime = colTimes[colIdx] || {};
  const iconHtml = layerForRow
    ? buildRowWindyIconHtml(
        layerForRow,
        buildWindyUrl(pt.lat, pt.lng, colTime.date, colTime.hour, layerForRow),
        12,
      )
    : '';
  const coordText = row.key === 'coords' ? formatCoords(pt.lat, pt.lng) : '';
  const initialVal = getCellValue(null, row.key, pt);
  const cellInner = row.key === 'coords'
    ? `<span class="wt-cell-value clickable-coords" data-coords="${coordText}" title="點擊複製座標">${coordText}</span>`
    : layerForRow
      ? `${iconHtml}<span class="wt-cell-value">—</span>`
      : `<span class="wt-cell-value">${formatWeatherTableValueHtml(row.key, initialVal)}</span>`;

  return `<td class="${tdClass}" data-col="${colIdx}" data-key="${row.key}"${cellStyle}>${cellInner}</td>`;
}

function buildWeatherDataRowHtml(row, visibleIndices, firstReturnIdx, colTimes) {
  let html = `<tr><td class="wt-label-cell wt-td">${row.label}</td>`;
  visibleIndices.forEach((colIdx) => {
    html += buildWeatherDataCellHtml(row, weatherPoints[colIdx], colIdx, firstReturnIdx, colTimes);
  });
  return `${html}</tr>`;
}

function buildWeatherWindyRowHtml(visibleIndices, firstReturnIdx, colTimes) {
  let html = '<tr class="wt-windy-row"><td class="wt-label-cell wt-td">Windy</td>';
  visibleIndices.forEach((colIdx) => {
    const pt = weatherPoints[colIdx];
    const tdClass = buildWeatherDataColumnClassNames(pt, colIdx, firstReturnIdx, 'wt-data-cell wt-td wt-windy-cell');
    const colTime = colTimes[colIdx] || {};
    html += `<td class="${tdClass}" data-col="${colIdx}">` +
      `<a class="wt-windy-link" href="${buildWindyUrl(pt.lat, pt.lng, colTime.date, colTime.hour)}" target="_blank" rel="noopener" title="在 Windy 開啟">` +
      `<img src="https://www.windy.com/favicon.ico" width="13" height="13" alt="Windy" class="windy-favicon">` +
      `</a></td>`;
  });
  return `${html}</tr>`;
}

function buildWeatherTableHtml({ labelW, colWidths, visibleIndices, firstReturnIdx, saved, todayStr, nowHour }) {
  const colTimes = [];
  let html = buildWeatherCollapseButton();
  html += `<table class="weather-table${weatherTableCollapsed ? ' is-collapsed' : ''}">`;
  html += buildWeatherColgroupHtml(labelW, colWidths);
  html += '<thead>';
  html += buildWeatherLabelHeaderRowHtml(visibleIndices, firstReturnIdx);
  html += buildWeatherDateHeaderRowHtml(visibleIndices, firstReturnIdx, saved, todayStr, colTimes);
  html += buildWeatherTimeHeaderRowHtml(visibleIndices, firstReturnIdx, saved, nowHour, colTimes);
  html += '</thead><tbody>';
  WEATHER_ROWS.forEach(row => { html += buildWeatherDataRowHtml(row, visibleIndices, firstReturnIdx, colTimes); });
  html += buildWeatherWindyRowHtml(visibleIndices, firstReturnIdx, colTimes);
  return `${html}</tbody></table>`;
}

function renderWeatherPanel() {
  const previousWeatherPoints = weatherPoints;
  const previousCardStates = new Map();
  if (typeof _wcStates !== 'undefined') {
    _wcStates.forEach((state, colIdx) => {
      const prevPt = previousWeatherPoints[colIdx];
      if (prevPt) previousCardStates.set(getSemanticKey(prevPt), state);
    });
  }
  weatherPoints = buildWeatherPoints();
  // Basin overlays are keyed by colIdx; a rebuild re-maps colIdx→point. Clear them
  // all, then (below) redraw for every catchment-view point at its new position —
  // independent of whether its card is open, so 副航點/compact/closed basins survive.
  clearAllCardCatchments();
  if (previousCardStates.size > 0 && typeof _wcStates !== 'undefined') {
    _wcStates.clear();
    weatherPoints.forEach((pt, colIdx) => {
      const state = previousCardStates.get(getSemanticKey(pt));
      if (state) _wcStates.set(colIdx, state);
    });
    mapManager.closeWeatherPopup();
  }
  syncCatchmentBasins();
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  if (weatherPoints.length === 0) {
    container.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「更新天氣」</p></div>';
    return;
  }

  // Prune savedWeatherCells + savedCatchmentCells: remove entries whose key no
  // longer matches any point in the current panel. Prevents stale data from
  // accumulating in localStorage when waypoints are moved far or deleted. Both
  // stores share the semantic-key namespace, so they prune in one pass.
  {
    const validKeys = new Set(weatherPoints.flatMap(p => [getSemanticKey(p), getLegacySemanticKey(p)]));
    let pruned = false;
    Object.keys(savedWeatherCells).forEach(k => {
      if (!validKeys.has(k)) { delete savedWeatherCells[k]; pruned = true; }
    });
    if (pruned) {
      try { localStorage.setItem(LS_WEATHER_CELLS_KEY, JSON.stringify(savedWeatherCells)); } catch (_) { }
    }
    let prunedCatch = false;
    Object.keys(savedCatchmentCells).forEach(k => {
      if (!validKeys.has(k)) { delete savedCatchmentCells[k]; prunedCatch = true; }
    });
    if (prunedCatch) {
      try { localStorage.setItem(LS_CATCHMENT_CELLS_KEY, JSON.stringify(savedCatchmentCells)); } catch (_) { }
    }
  }

  // Compute per-waypoint gradient colors (matching polyline + elevation chart).
  // Configured (forward) waypoints span the outbound segment teal→red (0→1);
  // return waypoints (not rendered as map markers) use the red→purple→blue return gradient.
  {
    const fwdCums = weatherPoints
      .filter(p => p.isWaypoint && !p.isReturn && typeof p._cum === 'number')
      .map(p => p._cum);
    const outboundMax = fwdCums.length ? Math.max(...fwdCums) : 0;
    const colorById = {};
    const labelById = {};
    weatherPoints.forEach(p => {
      if (!p.isWaypoint || p.isReturn) return;
      const t = outboundMax > 0
        ? Math.max(0, Math.min(1, (p._cum ?? 0) / outboundMax))
        : 0;
      colorById[p.wpIndex] = interpolateRouteColor(t);
      labelById[p.wpIndex] = p.label;
    });
    const newColors = mapManager.waypoints.map((_, i) => colorById[i] || null);
    if (newColors.every(c => c !== null) && newColors.length > 0) {
      waypointGradColors = newColors;
      mapManager.setWaypointColors(waypointGradColors);
    }
    const newLabels = mapManager.waypoints.map((_, i) => labelById[i] || null);
    mapManager.setWaypointLabels(newLabels);
    // Always re-render sidebar so cumulative distances are up-to-date
    updateWaypointList(mapManager.waypoints);
  }

  // Update intermediate markers on the map
  updateIntermediateMarkers();
  mapManager.setWaypointDistances(waypointCumDistM);

  const saved = loadWeatherSettings();
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowHour = now.getHours();

  // Proportional column widths aligned with elevation chart X axis
  const positions = computeWeatherPointPositions();
  const visibleIndices = getWeatherTableVisibleIndices();
  const visiblePositions = visibleIndices.map(i => positions[i]);
  const visibleN = visibleIndices.length;
  const voronoi = visiblePositions.map((p, i) => {
    const left = i === 0 ? p : (p - visiblePositions[i - 1]) / 2;
    const right = i === visibleN - 1 ? (1 - p) : (visiblePositions[i + 1] - p) / 2;
    return left + right;
  });
  const panelW = document.getElementById('bottom-panel')?.offsetWidth || window.innerWidth;
  const labelW = weatherTableCollapsed ? 36 : 68;
  const minColW = weatherTableCollapsed ? 30 : 110;
  const dataW = weatherTableCollapsed
    ? visibleN * minColW
    : Math.max(panelW - labelW, visibleN * minColW);
  const colWidths = voronoi.map(v => Math.max(v * dataW, minColW));

  const firstReturnIdx = weatherPoints.findIndex(pt => pt.isReturn);
  const html = buildWeatherTableHtml({
    labelW,
    colWidths,
    visibleIndices,
    firstReturnIdx,
    saved,
    todayStr,
    nowHour,
  });
  container.innerHTML = html;

  // Re-bind controls directly to ensure responsiveness regardless of delegation status
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent header/column highlight click from triggering
      const action = btn.dataset.action;
      switch (action) {
        case 'toggle-weather-table': toggleWeatherTableCollapsed(); break;
        case 'fetch': fetchAllWeatherData({ force: true }); break;
        case 'day-minus': shiftAllDates(-1, 0); break;
        case 'day-plus': shiftAllDates(+1, 0); break;
        case 'day-now': shiftToNow('day'); break;
        case 'hour-minus': shiftAllDates(0, -1); break;
        case 'hour-plus': shiftAllDates(0, +1); break;
        case 'hour-now': shiftToNow('hour'); break;
      }
    });
  });

  // Snapshot each column's time before the user changes it (for delta-shift in speed mode)
  // Use Row 2 (date headers) as the authoritative reference for "heads" indexing
  const heads = Array.from(container.querySelectorAll('.wt-th-date'));
  const snapshot = (th) => () => { th.dataset.prevMs = String(colToMs(th)); };
  heads.forEach(th => {
    const di = th.querySelector('.wt-date-input');
    const hs = container.querySelector(`.wt-th-time[data-idx="${th.dataset.idx}"] .wt-time-select`);
    di?.addEventListener('focus', snapshot(th));
    hs?.addEventListener('mousedown', snapshot(th));
    hs?.addEventListener('focus', snapshot(th));
  });

  // On change: speed mode → delta-shift subsequent columns; otherwise → cascade interval
  // times from col-0; all modes → enforce waypoint ordering → save
  container.querySelectorAll('.wt-date-input, .wt-time-select').forEach(el =>
    el.addEventListener('change', (e) => {
      const th = e.target.closest('th');
      if (th) handleWeatherTimeChange(parseInt(th.dataset.idx), th);
      refreshWeatherDateDisplays(container);
    })
  );

  container.querySelectorAll('.wt-adj-day-minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (th) shiftWaypointTime(parseInt(th.dataset.idx), -86400000);
    });
  });

  container.querySelectorAll('.wt-adj-day-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (th) shiftWaypointTime(parseInt(th.dataset.idx), 86400000);
    });
  });

  container.querySelectorAll('.wt-adj-hour-minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (th) shiftWaypointTime(parseInt(th.dataset.idx), -3600000);
    });
  });

  container.querySelectorAll('.wt-adj-hour-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (th) shiftWaypointTime(parseInt(th.dataset.idx), 3600000);
    });
  });

  // Initial cascade + enforce on first render
  if (speedIntervalMode) syncPaceWeatherTimes();
  else syncIntervalTimes();
  updateDateConstraints();
  updateWeatherTimeAdjustButtons();
  refreshWindyLinks();

  // Restore previously fetched weather data — read actual date/hour from DOM
  // (after cascade/enforce so keys match what was stored during the original fetch)
  weatherPoints.forEach((pt, colIdx) => {
    const dateStr = container.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)?.value;
    const hour = parseInt(container.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`)?.value ?? '0');
    if (!dateStr) return;
    const cacheHit = getWeatherCacheHit(pt, dateStr, hour);
    const cached = cacheHit?.data || null;
    if (cached && hasWeatherDataDetailInfo(cached, pt)) {
      rememberWeatherCacheHitForPoint(cacheHit, pt, dateStr, hour);
      const cells = markWeatherCellsLoaded({ _icon: cached.weatherIcon, _weatherCode: cached.weatherCode }, dateStr, hour);
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(cached, row.key, pt);
        cells[row.key] = val;
        const cell = container.querySelector(`[data-col="${colIdx}"][data-key="${row.key}"]`);
        updateWeatherTableCell(cell, row.key, val);
      });
      saveWeatherCells(getSemanticKey(pt), cells);
      if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && cached.weatherIcon) {
        mapManager.setWaypointWeather(pt.wpIndex, cached.weatherIcon);
      }
    } else {
      // Fallback: restore display values saved from a previous fetch
      const saved = getSavedWeatherCells(pt);
      if (saved) {
        applySavedWeatherCellsToColumn(pt, colIdx, saved);
      }
    }
  });

  // Click on column header (but not date/time inputs/label) or any data cell → highlight
  // Double-click on column label → edit name
  container.querySelectorAll('.wt-col-head').forEach(th => {
    th.style.cursor = 'pointer';
    const colIdx = parseInt(th.dataset.idx);
    const pt = weatherPoints[colIdx];
    th.addEventListener('click', (e) => {
      // Requirement: Don't highlight when clicking inputs/selects (opening dropdowns)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.target.closest('.clickable-coords')) return;
      // Requirement 3: Toggle on single click
      highlightPoint(colIdx, true);
    });
    const labelEl = th.querySelector('.wt-col-label');
    if (labelEl) {
      labelEl.style.cursor = 'pointer';
      if (pt.isWaypoint) {
        labelEl.title = '單擊高亮 · 雙擊編輯名稱';
        labelEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startLabelEdit(labelEl, pt); });
        if (weatherTableCollapsed) labelEl.title = pt.label || getWeatherPointShortLabel(pt, colIdx);
      } else {
        labelEl.title = '單擊高亮';
      }
    }
  });
  container.querySelectorAll('.wt-data-cell').forEach(td => {
    td.style.cursor = 'pointer';
    td.addEventListener('click', (e) => {
      // Requirement: Don't highlight when clicking inputs (though cells usually don't have them, for safety)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.target.closest('.clickable-coords')) return;
      // Requirement 3: Toggle on single click
      highlightPoint(parseInt(td.dataset.col), true);
    });
  });

  // --- Long-press drag on primary-waypoint label cells: reorder or remove ---
  // Mirror the side-panel waypoint-list flow (main.js line ~1665) but on the
  // weather-table label row. The trash zone uses the 'table' variant so it
  // appears at the elevation-chart area, anchored to the bottom-panel divider.
  bindWeatherTableColumnDrag(container);
  bindWeatherTableNamePeek(container);

  // Weather table icon click -> Expand card
  container.querySelectorAll('.wt-weather-icon-trigger').forEach(span => {
    span.style.cursor = 'pointer';
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const td = span.closest('td');
      if (td) {
        const colIdx = parseInt(td.dataset.col);
        if (!isNaN(colIdx)) handleWeatherIconInteraction(colIdx);
      }
    });
  });

  // Sync elevation chart markers with weather columns
  updateElevationMarkers();

  if (window._pendingGpxDates) {
    const labelToKey = {};
    WEATHER_ROWS.forEach(r => labelToKey[r.label] = r.key);

    window._pendingGpxDates.forEach((importedData, wpIdx) => {
      // Find the corresponding point in weatherPoints. 
      // For waypoints, we match by wpIndex. 
      // For non-waypoints (if somehow present in pending), we skip or handle as needed.
      const colIdx = weatherPoints.findIndex(p => p.isWaypoint && !p.isReturn && p.wpIndex === wpIdx);
      if (colIdx < 0) return;

      const pt = weatherPoints[colIdx];

      if (importedData.date) {
        const di = container.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`);
        if (di) di.value = importedData.date;
      }
      if (importedData.time) {
        const h = parseInt(importedData.time.split(':')[0]);
        if (!isNaN(h)) {
          const hs = container.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`);
          if (hs) hs.value = String(h);
        }
      }

      if (importedData.weather) {
        const cells = {};
        for (const [k, v] of Object.entries(importedData.weather)) {
          const val = (typeof v === 'object') ? v.value : v;
          const key = labelToKey[k] || k;
          cells[key] = key === 'weather' ? translateWeatherText(val) : val;
          const cell = container.querySelector(`[data-col="${colIdx}"][data-key="${key}"]`);
          if (cell) updateWeatherTableCell(cell, key, cells[key]);
        }
        // The weather cell is formatted "<emoji> <desc>" — extract the emoji so
        // downstream consumers (map marker, elevation chart) can render the icon
        // without needing a live weather fetch.
        if (cells.weather && cells.weather !== '—') {
          cells._icon = cells.weather.split(' ')[0];
          if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && cells._icon) {
            mapManager.setWaypointWeather(pt.wpIndex, cells._icon);
          }
        }
        if (Object.keys(cells).length > 0) {
          const scheduleDate = importedData.date || container.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)?.value || null;
          const scheduleHour = importedData.time
            ? parseInt(importedData.time.split(':')[0])
            : parseInt(container.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`)?.value ?? '0');
          const cellsToSave = hasSavedWeatherDetailInfo(cells)
            ? markWeatherCellsLoaded(cells, scheduleDate, scheduleHour)
            : cells;
          saveWeatherCells(getSemanticKey(pt), cellsToSave);
        }
      }
    });

    window._pendingGpxDates = null;
    refreshWindyLinks();
  }

  // Always persist the rendered state so page reload restores it correctly
  // (covers the case where user never manually changes any date/time input)
  saveWeatherSettings();
  refreshOpenWeatherCards();
  if (isRouteWeatherBusy()) updateRouteWeatherBusyOverlay();

  // weatherPoints is now initialised; the bottom-panel side-effects are safe.
  // Keep the detailed-catchment table in step with the rebuilt columns (cache-only
  // repaint — new columns show cached values or '…', backfilled by 取得集水區).
  bottomPanelReady = true;
  if (getBottomPanelView() === 'catchment') renderCatchmentPanel();
}

/**
 * Long-press drag on the weather-table label-row column heads of primary
 * waypoints. Drop on another primary column → reorder; drop on the trash
 * zone (rendered above the elevation chart, clamped to the bottom-panel
 * divider) → remove that waypoint. Mirrors the side-panel waypoint-list
 * flow in updateWaypointList().
 */
function bindWeatherTableColumnDrag(container) {
  const LP_MS = 500;
  const MOVE_TOL_SQ = 64;

  let lpTimer = null;
  let dragOriginTh = null;   // <th> the drag started on (for click suppression)
  let dragWpIdx = -1;        // mapManager.waypoints index being dragged
  let ghost = null;
  let targetTh = null;
  let targetAfter = false;
  let dragCancelledByMultiTouch = false;

  const updateGhost = (x, y) => {
    if (!ghost) return;
    ghost.style.left = `${x - 20}px`;
    ghost.style.top = `${y - 20}px`;
  };

  const clearTargetHighlight = () => {
    if (targetTh) {
      targetTh.classList.remove('wt-drop-target', 'wt-drop-target-after');
    }
    targetTh = null;
    targetAfter = false;
  };

  const findDropTarget = (cx) => {
    let bestTh = null;
    let after = false;
    container.querySelectorAll('.wt-header-row-label .wt-col-head').forEach(th => {
      const idx = parseInt(th.dataset.idx);
      const pt = weatherPoints[idx];
      if (!pt) return;
      if (th === dragOriginTh) return;
      const r = th.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right) {
        bestTh = th;
        after = cx > r.left + r.width / 2;
      }
    });
    return { th: bestTh, after };
  };

  const onMove = (e) => {
    if (e.touches && e.touches.length !== 1) {
      dragCancelledByMultiTouch = true;
      if (e.cancelable) e.preventDefault();
      clearTargetHighlight();
      onEnd(e);
      return;
    }
    if (e.cancelable) e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    updateGhost(cx, cy);

    const dropAction = mapManager.getTrashZoneDropAction(cx, cy);
    const overTrash = dropAction === 'delete';
    const overCancel = dropAction === 'cancel';
    mapManager.updateTrashZoneHover(cx, cy);
    if (ghost) {
      ghost.classList.toggle('drag-to-remove', overTrash);
      ghost.classList.toggle('drag-to-cancel', overCancel);
    }
    if (dropAction) { clearTargetHighlight(); return; }

    const found = findDropTarget(cx);
    if (found.th !== targetTh) {
      clearTargetHighlight();
      if (found.th) found.th.classList.add('wt-drop-target');
    }
    targetTh = found.th;
    targetAfter = found.after;
    if (targetTh) targetTh.classList.toggle('wt-drop-target-after', targetAfter);
  };

  const suppressNextClick = (el) => {
    if (!el) return;
    const handler = (ev) => {
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      ev.preventDefault();
      el.removeEventListener('click', handler, true);
    };
    el.addEventListener('click', handler, true);
    setTimeout(() => el.removeEventListener('click', handler, true), 350);
  };

  const onEnd = (e) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onEnd);

    const changedTouch = e.changedTouches?.[0];
    const cx = changedTouch?.clientX ?? e.clientX;
    const cy = changedTouch?.clientY ?? e.clientY;

    const dropAction = mapManager.getTrashZoneDropAction(cx, cy);
    const isCancelDrop = dropAction === 'cancel';
    const overTrash = dropAction === 'delete';
    mapManager.hideTrashZone();

    const _draggedWpIdx = dragWpIdx;
    const _targetTh = targetTh;
    const _targetAfter = targetAfter;
    const _originEl = dragOriginTh;
    const cancelledByMultiTouch = dragCancelledByMultiTouch || e.type === 'touchcancel';
    dragCancelledByMultiTouch = false;

    clearTargetHighlight();
    if (dragOriginTh) dragOriginTh.classList.remove('wt-col-dragging');
    dragOriginTh = null;
    dragWpIdx = -1;
    if (ghost) { ghost.remove(); ghost = null; }

    // Suppress the click that would otherwise toggle the highlight
    suppressNextClick(_originEl);

    if (cancelledByMultiTouch || isCancelDrop) {
      return;
    }

    if (overTrash) {
      platform.vibrate([20, 40, 20]);
      mapManager.removeWaypoint(_draggedWpIdx); // triggers full re-render
      return;
    }

    if (!_targetTh) return; // dropped on nothing → no-op

    const targetColIdx = parseInt(_targetTh.dataset.idx);
    let targetWpIdx = -1;
    let _targetAfterFinal = _targetAfter;

    // Find the nearest outbound waypoint index for the drop position
    for (let i = targetColIdx; i < weatherPoints.length; i++) {
      if (weatherPoints[i].isWaypoint && !weatherPoints[i].isReturn) {
        targetWpIdx = weatherPoints[i].wpIndex;
        if (i > targetColIdx) _targetAfterFinal = false; // Dropped on intermediate before this WP
        break;
      }
    }

    if (targetWpIdx === -1) {
      // Dropped after the last outbound waypoint
      const lastOutbound = weatherPoints.slice().reverse().find(p => p.isWaypoint && !p.isReturn);
      if (lastOutbound) {
        targetWpIdx = lastOutbound.wpIndex;
        _targetAfterFinal = true;
      } else {
        return;
      }
    }

    let insertAt = targetWpIdx;
    if (_draggedWpIdx < targetWpIdx) insertAt -= 1;
    if (_targetAfterFinal) insertAt += 1;
    insertAt = Math.max(0, Math.min(mapManager.waypoints.length - 1, insertAt));

    if (insertAt === _draggedWpIdx) return; // no positional change
    mapManager.moveWaypointTo(_draggedWpIdx, insertAt);
  };

  const startDrag = (el, clientX, clientY) => {
    dragOriginTh = el;
    dragCancelledByMultiTouch = false;
    const colIdx = parseInt(el.dataset.idx || el.dataset.col);
    const pt = weatherPoints[colIdx];
    if (!pt?.isWaypoint || pt.isReturn || pt.wpIndex == null) {
      dragOriginTh = null;
      return;
    }
    dragWpIdx = pt.wpIndex;

    el.classList.add('wt-col-dragging');
    if (weatherTableCollapsed) {
      showAllWaypointNamePeeks(container, el);
    }
    platform.vibrate(40);

    // If it's a data cell, we use the corresponding header label as ghost
    const headerTh = container.querySelector(`.wt-header-row-label .wt-col-head[data-idx="${colIdx}"]`);
    const ghostBase = headerTh || el;
    ghost = ghostBase.cloneNode(true);
    ghost.classList.remove('wt-col-dragging');
    ghost.style.position = 'fixed';
    ghost.style.zIndex = '10010';
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = '0.85';
    ghost.style.width = `${ghostBase.offsetWidth}px`;
    ghost.style.background = 'var(--bg-tertiary)';
    ghost.style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)';
    ghost.style.borderRadius = '4px';
    document.body.appendChild(ghost);
    updateGhost(clientX, clientY);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);

    mapManager.showTrashZone('table');
  };

  // Bind long-press detection to each cell in primary-waypoint columns
  container.querySelectorAll('.wt-col-head, .wt-data-cell').forEach(el => {
    const colIdx = parseInt(el.dataset.idx || el.dataset.col);
    const pt = weatherPoints[colIdx];
    if (!pt?.isWaypoint || pt.isReturn) return;

    let startX = 0, startY = 0;
    const triggerLP = (cx, cy) => {
      startX = cx; startY = cy;
      lpTimer = setTimeout(() => {
        lpTimer = null;
        startDrag(el, cx, cy);
      }, LP_MS);
    };
    const cancelLP = () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    };
    const checkMove = (cx, cy) => {
      if (!lpTimer) return;
      const dx = cx - startX, dy = cy - startY;
      if (dx * dx + dy * dy > MOVE_TOL_SQ) cancelLP();
    };

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      triggerLP(e.clientX, e.clientY);
      const canDragByMove = el.matches('.wt-header-row-label .wt-col-head');
      const guardMove = (ev) => {
        if (!lpTimer) return;
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (dx * dx + dy * dy <= MOVE_TOL_SQ) return;
        if (canDragByMove) {
          cancelLP();
          startDrag(el, startX, startY);
          onMove(ev);
        } else {
          cancelLP();
        }
      };
      const guardUp = () => {
        cancelLP();
        document.removeEventListener('mousemove', guardMove);
        document.removeEventListener('mouseup', guardUp);
      };
      document.addEventListener('mousemove', guardMove);
      document.addEventListener('mouseup', guardUp);
    });

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) {
        cancelLP();
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      const t = e.touches[0];
      triggerLP(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) {
        cancelLP();
        return;
      }
      const t = e.touches[0];
      checkMove(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener('touchend', cancelLP, { passive: true });
    el.addEventListener('touchcancel', cancelLP, { passive: true });
  });
}

function bindWeatherTableNamePeek(container) {
  if (!weatherTableCollapsed) return;
  const targets = container.querySelectorAll('.wt-col-head, .wt-col-label, .wt-data-cell');
  targets.forEach(el => {
    const colIdx = parseInt(el.dataset.idx || el.dataset.col || el.closest('.wt-col-head')?.dataset.idx);
    const pt = weatherPoints[colIdx];
    if (!pt?.isWaypoint || pt.isReturn) return;
    let timer = 0;
    const start = () => {
      clearTimeout(timer);
      timer = setTimeout(() => showAllWaypointNamePeeks(container, el), 650);
    };
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', cancel, { passive: true });
    el.addEventListener('touchend', cancel, { passive: true });
    el.addEventListener('touchcancel', cancel, { passive: true });
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
  });
}

/**
 * Automatically fetch weather for all points.
 * Debounced and checks for existing UI states to avoid conflicting fetches.
 */
let autoFetchTimeout = 0;
let isWeatherFetching = false;
let initialWeatherLoadPending = false;
let activeWeatherFetchRun = null;
let weatherFetchRunSeq = 0;

function waitForWeatherProgressPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function isAbortError(err) {
  return err?.name === 'AbortError'
    || (typeof DOMException !== 'undefined' && err?.code === DOMException.ABORT_ERR);
}

function waitForWeatherFetchDelay(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve(true);
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function isWeatherFetchRunCancelled(run) {
  return !run || run.cancelled || run.signal?.aborted || activeWeatherFetchRun !== run;
}

function cancelWeatherFetchForRouteReplan() {
  if (autoFetchTimeout) {
    clearTimeout(autoFetchTimeout);
    autoFetchTimeout = 0;
  }
  if (!activeWeatherFetchRun || activeWeatherFetchRun.cancelled) return;
  activeWeatherFetchRun.cancelled = true;
  activeWeatherFetchRun.controller?.abort();
  unparkLoadRun(activeWeatherFetchRun);   // wake a paused loop so it can unwind
}

// Stable partition putting 主航點 (isWaypoint — user-placed points, incl. return
// legs) before 副航點 (intermediate points), so a long weather/集水區 load fills the
// important named points first and the many intermediates afterwards. Geographic
// order is preserved within each group.
function orderMainWaypointsFirst(items, ptOf) {
  const main = [];
  const sub = [];
  for (const it of items) (ptOf(it)?.isWaypoint ? main : sub).push(it);
  return main.concat(sub);
}

function autoFetchWeather(options = {}) {
  if (autoFetchTimeout) clearTimeout(autoFetchTimeout);
  const queuedOptions = {
    ...options,
    initialLoad: !!options.initialLoad || initialWeatherLoadPending,
  };
  autoFetchTimeout = setTimeout(() => {
    // Only auto-fetch if we are not already processing a route
    // and if the "Fetch" button is not currently disabled (meaning a fetch is in progress)
    const fetchBtn = document.querySelector('[data-action="fetch"]');
    if (!isProcessing && !isWeatherFetching && fetchBtn && !fetchBtn.disabled) {
      fetchAllWeatherData({
        ...queuedOptions,
        initialLoad: queuedOptions.initialLoad || initialWeatherLoadPending,
      });
    } else if (queuedOptions.initialLoad || initialWeatherLoadPending) {
      autoFetchWeather(queuedOptions);
    }
  }, queuedOptions.initialLoad ? 250 : 1000); // Let rendering settle before the API/cache pass.
}

async function fetchAllWeatherData(options = {}) {
  const { force = false, onlyWaypointIndex = null, onlyColIndex = null } = options;
  const isInitialWeatherLoad = !!options.initialLoad || initialWeatherLoadPending;
  if (isWeatherFetching) return;
  if (weatherPoints.length === 0) {
    if (isInitialWeatherLoad) initialWeatherLoadPending = false;
    showNotification('請先建立路線', 'warning');
    return;
  }

  const container = document.getElementById('weather-table-container');
  if (!container) return;

  if (force && onlyWaypointIndex === null && onlyColIndex === null) {
    clearWeatherTempCache();
  } else {
    pruneWeatherCache({ persist: true });
  }

  const targetStates = weatherPoints
    .map((pt, i) => ({ pt, i }))
    .filter(({ pt, i }) => {
      if (onlyWaypointIndex !== null && (!pt.isWaypoint || pt.wpIndex !== onlyWaypointIndex)) return false;
      if (onlyColIndex !== null && i !== onlyColIndex) return false;
      return true;
    })
    .map(({ pt, i }) => {
      const schedule = getWeatherPointSchedule(pt, i);
      const dateStr = schedule?.date || null;
      const hour = schedule?.hour ?? 8;
      const cacheKey = dateStr ? weatherCoordKey(pt.lat, pt.lng, dateStr, hour) : null;
      const cacheHit = dateStr ? getWeatherCacheHit(pt, dateStr, hour) : null;
      const cached = hasWeatherDataDetailInfo(cacheHit?.data, pt) ? cacheHit.data : null;
      const saved = !force ? getSavedWeatherCells(pt) : null;
      const tableLoaded = !force && hasWeatherTableDetailInfo(i);
      const savedLoaded = !force && (hasCompletedWeatherLoad(saved, dateStr, hour) || tableLoaded);
      return {
        pt,
        i,
        dateStr,
        hour,
        cacheKey,
        cacheHit,
        cached,
        saved,
        savedLoaded,
        needsFetch: !!dateStr && (force || (!cached && !savedLoaded)),
      };
    });
  const needsNetworkFetch = targetStates.some(state => state.needsFetch);
  minimizeWeatherCardsForLoading(targetStates);
  if (!needsNetworkFetch) {
    targetStates.forEach(({ pt, i, cached, cacheHit, saved, savedLoaded, dateStr, hour }) => {
      if (cached) {
        rememberWeatherCacheHitForPoint(cacheHit, pt, dateStr, hour);
        const cells = markWeatherCellsLoaded({ _icon: cached.weatherIcon, _weatherCode: cached.weatherCode }, dateStr, hour);
        WEATHER_ROWS.forEach(row => {
          const val = getCellValue(cached, row.key, pt);
          cells[row.key] = val;
        });
        saveWeatherCells(getSemanticKey(pt), cells);
        applySavedWeatherCellsToColumn(pt, i, cells);
      } else if (savedLoaded) {
        applySavedWeatherCellsToColumn(pt, i, saved);
      }
    });
    if (isInitialWeatherLoad) initialWeatherLoadPending = false;
    return;
  }

  const totalTargets = Math.max(1, targetStates.length);
  let processedTargets = 0;
  const progressPaintEvery = Math.max(1, Math.ceil(totalTargets / 12));
  const fetchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const minInitialProgressMs = isInitialWeatherLoad ? 700 : 0;
  const controller = new AbortController();
  const fetchRun = {
    id: ++weatherFetchRunSeq,
    controller,
    signal: controller.signal,
    cancelled: false,
    paused: false,
    lockScope: 'edit',
    _resume: null,
  };
  activeWeatherFetchRun = fetchRun;
  isWeatherFetching = true;
  const busyTask = beginRouteWeatherBusyTask({
    title: '正在載入天氣資訊',
    detail: isInitialWeatherLoad
      ? `網頁開啟時載入天氣資訊 0/${totalTargets}`
      : `準備天氣欄位 0/${totalTargets}`,
    progress: 0,
    lockScope: 'edit',
  });
  fetchRun.busyTask = busyTask;
  pausableLoadRuns.add(fetchRun);
  const markWeatherProgress = () => {
    busyTask.set({
      detail: isInitialWeatherLoad
        ? `網頁開啟時載入天氣資訊 ${processedTargets}/${totalTargets}`
        : `載入天氣資訊 ${processedTargets}/${totalTargets}`,
      progress: (processedTargets / totalTargets) * 100,
    });
  };
  const maybePaintWeatherProgress = async () => {
    if (!isInitialWeatherLoad) return;
    if (processedTargets < totalTargets && processedTargets % progressPaintEvery !== 0) return;
    await waitForWeatherProgressPaint();
  };

  saveWeatherSettings();
  const fetchBtn = document.querySelector('[data-action="fetch"]');
  if (fetchBtn) fetchBtn.disabled = true;

  // Network-fetch + apply ONE target's weather. Returns 'ok' | 'fail' | 'cancel'.
  // 'cancel' = the run was aborted (caller breaks). 'fail' = a genuine data failure,
  // left as a retry candidate. weatherService already retries transient 429/timeout/
  // empty responses internally; this outcome drives the post-pass retry sweep so a
  // failed point is never left stuck as an unopenable "?" badge.
  const fetchAndApplyWeatherForState = async (state) => {
    const { pt, i, dateStr, hour, cacheKey } = state;
    WEATHER_ROWS.forEach(row => {
      const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
      if (cell) {
        const valueEl = cell.querySelector('.wt-cell-value');
        if (valueEl) valueEl.textContent = '...';
        else cell.textContent = '...';
        cell.classList.remove('error');
        cell.classList.add('loading');
      }
    });
    try {
      const data = await weatherService.getWeatherAtPoint(pt.lat, pt.lng, dateStr, hour, { signal: fetchRun.signal });
      if (isWeatherFetchRunCancelled(fetchRun)) return 'cancel';
      setWeatherCacheData(pt, dateStr, hour, data, { cacheKey });
      const cells = markWeatherCellsLoaded({ _icon: data.weatherIcon, _weatherCode: data.weatherCode }, dateStr, hour);
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(data, row.key, pt);
        cells[row.key] = val;
        const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
        if (cell) {
          updateWeatherTableCell(cell, row.key, val);
          cell.classList.remove('loading', 'error');
        }
      });
      saveWeatherCells(getSemanticKey(pt), cells);
      // Update only the outbound map badge; return markers carry their own icon.
      if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && data.weatherIcon)
        mapManager.setWaypointWeather(pt.wpIndex, data.weatherIcon);
      // Refresh chart/map weather markers when it will not interrupt an active waypoint drag.
      refreshWeatherMarkersAfterWeatherUpdate();
      if (typeof _wcStates !== 'undefined' && _wcStates.has(i)) _renderWeatherCard(i);
      return 'ok';
    } catch (err) {
      if (isWeatherFetchRunCancelled(fetchRun) || isAbortError(err)) return 'cancel';
      console.warn(`Weather fetch failed for ${pt.label}:`, err.message);
      WEATHER_ROWS.forEach(row => {
        const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
        if (cell) {
          const valueEl = cell.querySelector('.wt-cell-value');
          if (valueEl) valueEl.textContent = '—';
          else cell.textContent = '—';
          cell.classList.remove('loading');
          cell.classList.add('error');
        }
      });
      if (typeof _wcStates !== 'undefined' && _wcStates.has(i)) _renderWeatherCard(i);
      return 'fail';
    }
  };

  // 主航點 first, 副航點 after (requirement: load the important named points before
  // the many intermediates). Failures are collected for a single retry sweep.
  const orderedTargets = orderMainWaypointsFirst(targetStates, (s) => s.pt);
  const failedStates = [];
  let remainingFailures = 0;

  try {
    for (const state of orderedTargets) {
      if (isWeatherFetchRunCancelled(fetchRun)) break;
      await waitIfLoadPaused(fetchRun);            // park here while 停止 is active
      if (isWeatherFetchRunCancelled(fetchRun)) break;   // cancelled while paused
      let { pt, i, dateStr, hour, cacheKey, cacheHit, saved, savedLoaded } = state;
      if (fetchBtn) {
        const labelSpan = fetchBtn.querySelector('span');
        const label = `${Math.min(processedTargets + 1, totalTargets)}/${totalTargets}`;
        if (labelSpan) labelSpan.textContent = label;
        else fetchBtn.textContent = label;
      }

      if (!dateStr) {
        processedTargets++;
        markWeatherProgress();
        await maybePaintWeatherProgress();
        continue;
      }

      let data = state.cached;

      // If not forced and we have cache, just apply it and skip fetching
      if (!force) {
        if (!data) {
          cacheHit = getWeatherCacheHit(pt, dateStr, hour);
          data = hasWeatherDataDetailInfo(cacheHit?.data, pt) ? cacheHit.data : null;
        }
        if (data) {
          rememberWeatherCacheHitForPoint(cacheHit, pt, dateStr, hour);
          const cells = markWeatherCellsLoaded({ _icon: data.weatherIcon, _weatherCode: data.weatherCode }, dateStr, hour);
          WEATHER_ROWS.forEach(row => {
            const val = getCellValue(data, row.key, pt);
            cells[row.key] = val;
            const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
            if (cell) {
              updateWeatherTableCell(cell, row.key, val);
              cell.classList.remove('loading', 'error');
            }
          });
          saveWeatherCells(getSemanticKey(pt), cells);
          if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && data.weatherIcon)
            mapManager.setWaypointWeather(pt.wpIndex, data.weatherIcon);

          // Update chart/map weather markers when it will not interrupt an active waypoint drag.
          refreshWeatherMarkersAfterWeatherUpdate();
          if (typeof _wcStates !== 'undefined' && _wcStates.has(i)) _renderWeatherCard(i);
          processedTargets++;
          markWeatherProgress();
          await maybePaintWeatherProgress();
          continue;
        }

        // Also check if UI already restored this point's weather from map pack (savedWeatherCells)
        if (savedLoaded) {
          applySavedWeatherCellsToColumn(pt, i, saved);
          processedTargets++;
          markWeatherProgress();
          await maybePaintWeatherProgress();
          continue;
        }
      }

      const outcome = await fetchAndApplyWeatherForState(state);
      if (outcome === 'cancel') break;
      if (outcome === 'fail') failedStates.push(state);
      processedTargets++;
      markWeatherProgress();
      await maybePaintWeatherProgress();

      if (processedTargets < totalTargets) {
        const shouldContinue = await waitForWeatherFetchDelay(400, fetchRun.signal);
        if (!shouldContinue || isWeatherFetchRunCancelled(fetchRun)) break;
      }
    }

    // Retry sweep: a burst load's TAIL is the most 429/timeout-prone, and the
    // progress bar reaching 100% while those points sit at "?" is exactly the
    // reported bug. By now the rate-limit window has had time to recover — re-attempt
    // the failures once (主航點 first). Whatever still fails is surfaced honestly.
    let stillFailed = failedStates;
    if (!isWeatherFetchRunCancelled(fetchRun) && stillFailed.length) {
      const retryList = orderMainWaypointsFirst(stillFailed, (s) => s.pt);
      stillFailed = [];
      const retryTotal = retryList.length;
      let retryDone = 0;
      for (const state of retryList) {
        if (isWeatherFetchRunCancelled(fetchRun)) { stillFailed.push(state); continue; }
        await waitIfLoadPaused(fetchRun);
        if (isWeatherFetchRunCancelled(fetchRun)) { stillFailed.push(state); continue; }
        busyTask.set({ detail: `重試載入天氣資訊 ${retryDone + 1}/${retryTotal}`, progress: 100 });
        const outcome = await fetchAndApplyWeatherForState(state);
        if (outcome === 'cancel') { stillFailed.push(state); break; }
        if (outcome === 'fail') stillFailed.push(state);
        retryDone++;
        if (retryDone < retryTotal) {
          const shouldContinue = await waitForWeatherFetchDelay(500, fetchRun.signal);
          if (!shouldContinue || isWeatherFetchRunCancelled(fetchRun)) break;
        }
      }
    }
    remainingFailures = stillFailed.length;
  } finally {
    const wasCancelled = isWeatherFetchRunCancelled(fetchRun);
    pausableLoadRuns.delete(fetchRun);
    if (isInitialWeatherLoad && !wasCancelled) {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - fetchStartedAt;
      if (elapsed < minInitialProgressMs) {
        await new Promise(r => setTimeout(r, minInitialProgressMs - elapsed));
      }
      initialWeatherLoadPending = false;
    }
    if (activeWeatherFetchRun === fetchRun) {
      activeWeatherFetchRun = null;
      isWeatherFetching = false;
    }
    if (!wasCancelled) {
      busyTask.set({ detail: '完成', progress: 100 });
      if (isInitialWeatherLoad) await waitForWeatherProgressPaint();
    }
    busyTask.end();
    if (fetchBtn) {
      fetchBtn.disabled = false;
      fetchBtn.innerHTML = `<svg class="wt-ctrl-fetch-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="currentColor"/></svg><span>更新天氣</span>`;
    }
    if (wasCancelled) return;
    // Honest completion: don't claim success while some points are still "?".
    // Those badges stay clickable to retry that single point on demand.
    if (remainingFailures > 0) {
      showNotification(`部分航點天氣載入失敗（${remainingFailures}），點擊該航點可重試`, 'warning', 3200);
    } else {
      showNotification('天氣資訊已更新', 'success', 2000);
    }
  }
}

// =========== Detailed Catchment Table (bottom-panel view) ===========
// A read-only table mirroring the detailed-weather table's look (same
// .weather-table classes + per-waypoint column widths aligned to the chart X
// axis): one column per visible weather point, rows = 集水區 terrain + hydrology
// indicators. Cell values come from the shared 集水區 cache (savedCatchmentCells);
// fetchAllCatchmentData backfills missing ones under the busy/progress overlay.

// Row plan: label + which saved-cells array (terrain|hydro) + index within it.
const CATCHMENT_TABLE_ROWS = [
  ...CATCHMENT_TERRAIN_LABELS.map((label, i) => ({ label, section: 'terrain', i })),
  ...CATCHMENT_HYDRO_LABELS.map((label, i) => ({ label, section: 'hydro', i })),
];

// Detailed catchment is kept COLUMN-IDENTICAL to detailed weather (同調): same
// visible set — primary waypoints + 副航點 (intermediate points) + return legs —
// and it inherits the weather table's collapse state (which drops to main
// waypoints only). Each column is still a cache-first per-point DEM read, so the
// batch loader's progress bar + 300 ms spacing carry a long 副航點-heavy load.
function getCatchmentColumnIndices() {
  return getWeatherTableVisibleIndices();
}

// Column layout matching the weather table's look (voronoi widths over the chosen
// waypoint columns → the same proportional spread across the panel width).
function computeCatchmentColumnLayout() {
  const positions = computeWeatherPointPositions();
  const visibleIndices = getCatchmentColumnIndices();
  const visiblePositions = visibleIndices.map(i => positions[i]);
  const visibleN = visibleIndices.length;
  const voronoi = visiblePositions.map((p, i) => {
    const left = i === 0 ? p : (p - visiblePositions[i - 1]) / 2;
    const right = i === visibleN - 1 ? (1 - p) : (visiblePositions[i + 1] - p) / 2;
    return left + right;
  });
  const panelW = document.getElementById('bottom-panel')?.offsetWidth || window.innerWidth;
  const labelW = weatherTableCollapsed ? 36 : 68;
  const minColW = weatherTableCollapsed ? 30 : 110;
  const dataW = weatherTableCollapsed ? visibleN * minColW : Math.max(panelW - labelW, visibleN * minColW);
  const colWidths = voronoi.map(v => Math.max(v * dataW, minColW));
  return { labelW, colWidths, visibleIndices, firstReturnIdx: weatherPoints.findIndex(pt => pt.isReturn) };
}

// Saved-cell value (HTML, may carry a risk chip) for a catchment row/column, or '…'.
function catchmentTableCellHtml(pt, row) {
  const saved = getSavedCatchmentCells(getSemanticKey(pt));
  if (saved?.status === 'ok') {
    const arr = row.section === 'terrain' ? saved.terrain : saved.hydro;
    if (Array.isArray(arr) && arr[row.i] != null) return arr[row.i];
  }
  return '…';
}

function buildCatchmentFetchControlHtml() {
  return `<th class="wt-label-cell wt-th">
      <button class="wt-ctrl-fetch" data-action="fetch-catchment" title="取得集水區">
        <svg class="wt-ctrl-fetch-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C8.2 6.7 5.5 10 5.5 13.4a6.5 6.5 0 0 0 13 0C18.5 10 15.8 6.7 12 2.5z" fill="currentColor"/></svg>
        <span>取得集水區</span>
      </button>
    </th>`;
}

// Read-only per-column date+hour line (mirrors the weather table's time header,
// without editors). Reflects each column's live schedule (weather-table DOM → saved).
function buildCatchmentScheduleRowHtml(visibleIndices, firstReturnIdx, saved) {
  let html = `<tr class="wt-header-row wt-header-row-time"><th class="wt-label-cell wt-th"><span class="wt-catch-sched-head">時間</span></th>`;
  visibleIndices.forEach((colIdx) => {
    const pt = weatherPoints[colIdx];
    const thClass = buildWeatherColumnClassNames(pt, colIdx, firstReturnIdx, 'wt-col-head wt-th');
    const sched = getWeatherPointSchedule(pt, colIdx, saved);
    const txt = sched?.date
      ? `${sched.date.slice(5).replace('-', '/')} ${String(sched.hour ?? 8).padStart(2, '0')}:00`
      : '—';
    html += `<th class="${thClass}" data-idx="${colIdx}"><span class="wt-catch-sched">${txt}</span></th>`;
  });
  return `${html}</tr>`;
}

function buildCatchmentDataRowHtml(row, visibleIndices, firstReturnIdx) {
  let html = `<tr><td class="wt-label-cell wt-td"${wcTipAttr(row.label)}>${row.label}</td>`;
  visibleIndices.forEach((colIdx) => {
    const pt = weatherPoints[colIdx];
    const tdClass = buildWeatherDataColumnClassNames(pt, colIdx, firstReturnIdx, 'wt-data-cell wt-td');
    const cellStyle = !pt.isWaypoint ? ' style="opacity: 0.8;"' : '';
    html += `<td class="${tdClass}" data-cat-col="${colIdx}" data-cat-section="${row.section}" data-cat-i="${row.i}"${cellStyle}>`
      + `<span class="wt-cell-value">${catchmentTableCellHtml(pt, row)}</span></td>`;
  });
  return `${html}</tr>`;
}

function renderCatchmentPanel() {
  const container = document.getElementById('catchment-table-container');
  if (!container) return;
  if (!Array.isArray(weatherPoints) || weatherPoints.length === 0) {
    container.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「取得集水區」</p></div>';
    return;
  }
  const { labelW, colWidths, visibleIndices, firstReturnIdx } = computeCatchmentColumnLayout();
  const saved = loadWeatherSettings();

  // Column-collapse toggle (shared weatherTableCollapsed state) — parity with the
  // weather table, so the user can drop to 主航點-only columns from catchment view too.
  let html = buildWeatherCollapseButton();
  html += `<table class="weather-table catchment-table${weatherTableCollapsed ? ' is-collapsed' : ''}">`;
  html += buildWeatherColgroupHtml(labelW, colWidths);
  html += '<thead>';
  html += `<tr class="wt-header-row wt-header-row-label">${buildCatchmentFetchControlHtml()}`;
  visibleIndices.forEach((colIdx, visiblePos) => {
    html += buildWeatherLabelHeaderCellHtml(weatherPoints[colIdx], colIdx, visiblePos, firstReturnIdx);
  });
  html += `</tr>`;
  html += buildCatchmentScheduleRowHtml(visibleIndices, firstReturnIdx, saved);
  html += '</thead><tbody>';
  CATCHMENT_TABLE_ROWS.forEach((row) => { html += buildCatchmentDataRowHtml(row, visibleIndices, firstReturnIdx); });
  html += '</tbody></table>';
  html += `<div class="ct-disclaimer catchment-table-note">水文指標為粗略估算，僅供參考</div>`;
  container.innerHTML = html;
}

let isCatchmentFetching = false;
let activeCatchmentFetchRun = null;
let catchmentFetchRunSeq = 0;

function isCatchmentFetchRunCancelled(run) {
  return !run || run.cancelled || run.signal?.aborted || activeCatchmentFetchRun !== run;
}

function cancelCatchmentFetchForRouteReplan() {
  if (!activeCatchmentFetchRun || activeCatchmentFetchRun.cancelled) return;
  activeCatchmentFetchRun.cancelled = true;
  activeCatchmentFetchRun.controller?.abort();
  unparkLoadRun(activeCatchmentFetchRun);   // wake a paused loop so it can unwind
}

let catchmentAutoFetchTimeout = 0;
let catchmentReadNoticeAt = 0;

// Hint shown when the catchment view has missing data but the read is currently
// restricted — a route re-plan / weather load owns the edit lock, or a batch just
// came back empty (network / API-quota limited). Throttled like the other notices.
function showCatchmentReadRestrictedNotice(kind = 'busy') {
  const now = Date.now();
  if (now - catchmentReadNoticeAt < 1500) return;
  catchmentReadNoticeAt = now;
  const msg = kind === 'failed'
    ? '集水區資訊讀取受限，請稍後再試'
    : '資料處理中，集水區資訊將於完成後自動載入';
  showNotification(msg, 'warning', 2400);
}

// Parity with weather's weatherCellsMatchSchedule: a saved 集水區 readout is stale
// once the column's date/hour changes, because the hydrology rows depend on
// dateStr/hour. Terrain is time-independent, but the readout is stored as a unit.
function catchmentCellsMatchSchedule(saved, dateStr, hour) {
  if (!saved) return false;
  const sd = saved.dateStr ?? null;
  const sh = saved.hour ?? null;
  if (!sd && sh == null) return true;   // legacy entry with no schedule stamp
  if (sd && dateStr && sd !== dateStr) return false;
  if (sh != null && hour != null && Number(sh) !== Number(hour)) return false;
  return true;
}

// A catchment column needs (re)fetching when it has no OK readout, or its saved
// readout was computed for a different schedule than the column shows now — parity
// with weather's hasCompletedWeatherLoad gating.
function catchmentColumnNeedsFetch(pt, colIdx) {
  const saved = getSavedCatchmentCells(getSemanticKey(pt));
  if (saved?.status !== 'ok') return true;
  const schedule = getWeatherPointSchedule(pt, colIdx);
  return !catchmentCellsMatchSchedule(saved, schedule?.date || null, schedule?.hour ?? null);
}

// Auto-load 集水區 for any visible column still missing it — the catchment
// counterpart to autoFetchWeather, so a freshly-planned route backfills new
// waypoints without a manual 取得集水區. Only runs while the catchment view is
// showing; when a route/weather load holds priority it defers (and, if the user
// just switched in, hints why) then retries once that work settles.
function autoFetchCatchment({ notify = false } = {}) {
  if (catchmentAutoFetchTimeout) { clearTimeout(catchmentAutoFetchTimeout); catchmentAutoFetchTimeout = 0; }
  if (!bottomPanelReady || getBottomPanelView() !== 'catchment') return;
  if (isCatchmentFetching) return;

  const anyMissing = getCatchmentColumnIndices().some((colIdx) => {
    const pt = weatherPoints[colIdx];
    return pt && catchmentColumnNeedsFetch(pt, colIdx);
  });
  if (!anyMissing) return;

  // Defer only while an active route re-plan owns the state (columns are still
  // being rebuilt); a concurrent weather load is fine — catchment loads alongside
  // it, same as the manual 取得集水區 during a weather fetch.
  if (isProcessing) {
    if (notify) showCatchmentReadRestrictedNotice('busy');
    catchmentAutoFetchTimeout = setTimeout(() => autoFetchCatchment({ notify: false }), 1200);
    return;
  }
  fetchAllCatchmentData();
}

// Delineate + hydrology for one point, save to the shared cache, return
// { status, terrain[], hydro[] } (HTML strings). Aborts propagate to the caller.
async function computeCatchmentReadout(pt, colIdx, signal) {
  const schedule = getWeatherPointSchedule(pt, colIdx);
  const dateStr = schedule?.date || null;
  const hour = schedule?.hour ?? 8;

  const result = await getCatchmentFor(pt.lat, pt.lng, { signal });
  if (!result || result.status !== 'ok' || !result.outer?.length) return { status: result?.status || 'error' };

  const outlet = Number.isFinite(result.outletEle) ? formatElevation(result.outletEle) : '—';
  const terrain = [formatArea(result.areaM2), outlet, ...computeGeometryRows(result).map(catchmentValueHtml)];

  let hydroEnv = null;
  try {
    hydroEnv = await fetchHydroData(pt.lat, pt.lng, dateStr, hour, { signal });
  } catch (err) {
    if (isAbortError(err)) throw err;
    hydroEnv = null;
  }
  const hydro = (hydroEnv && hydroEnv.available)
    ? computeHydroIndicators(result, hydroEnv).map(catchmentValueHtml)
    : CATCHMENT_HYDRO_LABELS.map(() => '—');

  saveCatchmentCells(getSemanticKey(pt), {
    status: 'ok', terrain, hydro,
    dateStr: dateStr || null,
    hour: Number.isFinite(Number(hour)) ? Number(hour) : null,
  });
  return { status: 'ok', terrain, hydro };
}

function setCatchmentColumnCells(colIdx, valueFor) {
  const container = document.getElementById('catchment-table-container');
  if (!container) return;
  CATCHMENT_TABLE_ROWS.forEach((row) => {
    const cell = container.querySelector(`[data-cat-col="${colIdx}"][data-cat-section="${row.section}"][data-cat-i="${row.i}"] .wt-cell-value`);
    if (cell) cell.innerHTML = valueFor(row);
  });
}

function fillCatchmentTableColumn(colIdx, readout) {
  const ok = readout?.status === 'ok';
  setCatchmentColumnCells(colIdx, (row) => {
    const arr = ok ? (row.section === 'terrain' ? readout.terrain : readout.hydro) : null;
    return (arr && arr[row.i] != null) ? arr[row.i] : '—';
  });
}

// Batch-load 集水區 read-outs for every visible column, progress-bar managed.
// `force` re-fetches all columns; otherwise only the uncached ones.
async function fetchAllCatchmentData(options = {}) {
  const { force = false, onlyColIndex = null } = options;
  if (isCatchmentFetching) return;
  if (!Array.isArray(weatherPoints) || weatherPoints.length === 0) {
    showNotification('請先建立路線', 'warning');
    return;
  }
  renderCatchmentPanel();   // ensure the cells exist to receive values

  const visibleIndices = getCatchmentColumnIndices();
  // Progress-bar parity with weather (fetchAllWeatherData): 分母 = 全部可見欄位,
  // NOT only the uncached ones, so 航點完成數 climbs through the whole route. Each
  // target carries whether it still needs a DEM read; cached columns are applied
  // instantly in-loop (no fetch, no inter-request delay) yet still count toward N/total.
  const allTargets = visibleIndices
    .filter((colIdx) => onlyColIndex === null || colIdx === onlyColIndex)   // single-column retry
    .map((colIdx) => ({ colIdx, pt: weatherPoints[colIdx] }))
    .filter(({ pt }) => pt)
    .map((t) => ({ ...t, needsFetch: force || catchmentColumnNeedsFetch(t.pt, t.colIdx) }));

  // Nothing needs a fetch → apply saved readouts synchronously, no progress bar
  // (mirrors weather's !needsNetworkFetch fast path).
  if (!allTargets.some((t) => t.needsFetch)) {
    allTargets.forEach(({ colIdx }) =>
      fillCatchmentTableColumn(colIdx, getSavedCatchmentCells(getSemanticKey(weatherPoints[colIdx]))));
    showNotification('集水區資訊已更新', 'success', 1500);
    return;
  }

  // 主航點 first, 副航點 (intermediates) after — the important named points get their
  // 集水區 read-out before the many intermediates on a long, DEM-heavy load.
  const orderedTargets = orderMainWaypointsFirst(allTargets, (t) => t.pt);

  const controller = new AbortController();
  const run = { id: ++catchmentFetchRunSeq, controller, signal: controller.signal, cancelled: false, paused: false, lockScope: 'edit', _resume: null };
  activeCatchmentFetchRun = run;
  isCatchmentFetching = true;
  const total = allTargets.length;
  let done = 0;
  let okCount = 0;
  const busyTask = beginRouteWeatherBusyTask({
    title: '正在載入集水區資訊',
    detail: `載入集水區資訊 0/${total}`,
    progress: 0,
    lockScope: 'edit',
  });
  run.busyTask = busyTask;
  pausableLoadRuns.add(run);
  const fetchBtn = document.querySelector('[data-action="fetch-catchment"]');
  if (fetchBtn) fetchBtn.disabled = true;

  // Compute + apply ONE column's 集水區 readout. Returns 'ok' | 'fail' | 'cancel'.
  // Draws the point's map basin incrementally (cache hit → no refetch), mirroring
  // weather's per-point setWaypointWeather so 已算完的航點先顯示集水區.
  const loadOneCatchment = async ({ colIdx, pt }) => {
    if (isCatchmentFetchRunCancelled(run)) return 'cancel';
    await waitIfLoadPaused(run);                        // park here while 停止 is active
    if (isCatchmentFetchRunCancelled(run)) return 'cancel';
    setCatchmentColumnCells(colIdx, () => '…');
    let readout;
    try {
      readout = await computeCatchmentReadout(pt, colIdx, run.signal);
    } catch (err) {
      if (isAbortError(err) || isCatchmentFetchRunCancelled(run)) return 'cancel';
      console.warn(`Catchment fetch failed for ${pt.label}:`, err?.message);
      readout = { status: 'error' };
    }
    if (isCatchmentFetchRunCancelled(run)) return 'cancel';
    fillCatchmentTableColumn(colIdx, readout);
    const ok = readout?.status === 'ok';
    if (ok && isCatchmentView(colIdx) && !_cardCatchmentLayers.has(colIdx)) drawCatchmentPolygonForCard(colIdx);
    // Keep an open card that's showing this point's catchment view in sync.
    if (typeof _wcStates !== 'undefined' && _wcStates.has(colIdx) && isCatchmentView(colIdx)) _renderWeatherCard(colIdx);
    return ok ? 'ok' : 'fail';
  };

  // Apply ONE already-cached column instantly (parity with weather's cache path):
  // fills the table + syncs an open card, no DEM read and no inter-request delay,
  // but still advances N/total. Basins for cached columns are reconciled by
  // syncCatchmentBasins() at completion, matching the all-cached fast path.
  const fillCachedColumn = ({ colIdx, pt }) => {
    const saved = getSavedCatchmentCells(getSemanticKey(pt));
    fillCatchmentTableColumn(colIdx, saved);
    if (typeof _wcStates !== 'undefined' && _wcStates.has(colIdx) && isCatchmentView(colIdx)) _renderWeatherCard(colIdx);
    return saved?.status === 'ok';
  };

  const failedTargets = [];
  let remainingFailures = 0;
  try {
    for (const target of orderedTargets) {
      if (isCatchmentFetchRunCancelled(run)) break;
      await waitIfLoadPaused(run);                       // park here while 停止 is active
      if (isCatchmentFetchRunCancelled(run)) break;      // cancelled while paused

      // Cached column: no fetch, no delay — just fill + advance the counter.
      if (!target.needsFetch) {
        if (fillCachedColumn(target)) okCount++;
        done++;
        busyTask.set({ detail: `載入集水區資訊 ${done}/${total}`, progress: (done / total) * 100 });
        continue;
      }

      const outcome = await loadOneCatchment(target);
      if (outcome === 'cancel') break;
      if (outcome === 'ok') okCount++;
      else failedTargets.push(target);
      done++;
      busyTask.set({ detail: `載入集水區資訊 ${done}/${total}`, progress: (done / total) * 100 });
      if (done < total) {
        const cont = await waitForWeatherFetchDelay(300, run.signal);
        if (!cont || isCatchmentFetchRunCancelled(run)) break;
      }
    }

    // Retry sweep — parity with weather: the burst tail is the most 429/timeout-prone;
    // re-attempt failures once (主航點 first) now the rate-limit window has recovered.
    let stillFailed = failedTargets;
    if (!isCatchmentFetchRunCancelled(run) && stillFailed.length) {
      const retryList = orderMainWaypointsFirst(stillFailed, (t) => t.pt);
      stillFailed = [];
      const retryTotal = retryList.length;
      let retryDone = 0;
      for (const target of retryList) {
        if (isCatchmentFetchRunCancelled(run)) { stillFailed.push(target); continue; }
        busyTask.set({ detail: `重試載入集水區 ${retryDone + 1}/${retryTotal}`, progress: 100 });
        const outcome = await loadOneCatchment(target);
        if (outcome === 'cancel') { stillFailed.push(target); break; }
        if (outcome === 'ok') okCount++;
        else stillFailed.push(target);
        retryDone++;
        if (retryDone < retryTotal) {
          const cont = await waitForWeatherFetchDelay(500, run.signal);
          if (!cont || isCatchmentFetchRunCancelled(run)) break;
        }
      }
    }
    remainingFailures = stillFailed.length;
  } finally {
    const wasCancelled = isCatchmentFetchRunCancelled(run);
    pausableLoadRuns.delete(run);
    if (activeCatchmentFetchRun === run) { activeCatchmentFetchRun = null; isCatchmentFetching = false; }
    if (!wasCancelled) busyTask.set({ detail: '完成', progress: 100 });
    busyTask.end();
    if (fetchBtn) fetchBtn.disabled = false;
    if (!wasCancelled) syncCatchmentBasins();   // reconcile every catchment-view basin at completion
    // Honest completion (parity with weather): total blackout keeps the restricted
    // hint; a partial failure warns + invites a per-column retry; else success.
    if (!wasCancelled) {
      if (okCount === 0) showCatchmentReadRestrictedNotice('failed');
      else if (remainingFailures > 0) showNotification(`部分集水區載入失敗（${remainingFailures}），點擊該欄可重試`, 'warning', 3200);
      else showNotification('集水區資訊已更新', 'success', 2000);
    }
  }
}

// Single-column catchment re-fetch, the parity counterpart of
// fetchWeatherForUnloadedCard: clicking a failed/stale 集水區 column retries just
// that column. Deferred (not swallowed) while a batch load already owns the state.
function fetchCatchmentForUnloadedColumn(colIdx) {
  if (isCatchmentFetching) {
    showNotification('集水區載入中，該欄會自動重試', 'info', 1800);
    return false;
  }
  showNotification('開始載入此欄集水區資訊...', 'info', 1600);
  fetchAllCatchmentData({ onlyColIndex: colIdx, force: true });
  return true;
}

// =========== Weather Card (Map Popup) ===========

// Map of colIdx -> state ('compact' | 'full') for currently open weather cards
let _wcStates = new Map();
// Last-seen card mode fallback; individual route cards also remember their own
// last closed size by semantic weather-point key.
let _wcLastMode = 'full';
let _wcLastModes = new Map();

function isMobileWeatherCardCenterMode() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function getWeatherCardModeMemoryKey(colIdx) {
  const pt = weatherPoints[colIdx];
  return pt ? getSemanticKey(pt) : `idx:${colIdx}`;
}

function rememberWeatherCardMode(colIdx, mode) {
  if (mode !== 'compact' && mode !== 'full') return;
  _wcLastMode = mode;
  _wcLastModes.set(getWeatherCardModeMemoryKey(colIdx), mode);
}

function getWeatherCardPreferredMode(colIdx) {
  return _wcLastModes.get(getWeatherCardModeMemoryKey(colIdx)) || _wcLastMode;
}

function getWeatherCardInteractionIndices(colIdx, mode = _wcStates.get(colIdx) || getWeatherCardPreferredMode(colIdx)) {
  if (isMobileWeatherCardCenterMode() && mode === 'full') return [colIdx];
  return getCollectiveIndices(colIdx);
}

function closeOtherOpenWeatherCardsOnMobile(colIdx, mode = 'full') {
  if (!isMobileWeatherCardCenterMode() || mode !== 'full') return;
  Array.from(_wcStates.keys()).forEach((openIdx) => {
    if (openIdx !== colIdx && _wcStates.get(openIdx) === 'full') closeWeatherCard(openIdx);
  });
}

function setWeatherCardModeForTargets(targets, mode, pivotIdx, options = {}) {
  if (!targets.length) return;
  const pivot = targets.includes(pivotIdx) ? pivotIdx : targets[0];
  if (
    isMobileWeatherCardCenterMode() &&
    mode === 'full' &&
    targets.length > 1
  ) {
    targets
      .filter(idx => idx !== pivot)
      .forEach(idx => setWeatherCardMode(idx, 'compact', options));
    setWeatherCardMode(pivot, 'full', { ...options, centerOnMobileExpand: true });
    return;
  }

  targets.forEach(idx => {
    setWeatherCardMode(idx, mode, { ...options, centerOnMobileExpand: idx === pivot });
  });
}

function getLoadedWeatherCardInfo(colIdx) {
  const pt = weatherPoints[colIdx];
  if (!pt) return null;

  const schedule = getWeatherPointSchedule(pt, colIdx);
  const dateStr = schedule?.date || null;
  const hour = schedule?.hour ?? 8;
  if (!dateStr) return null;

  const cacheHit = getWeatherCacheHit(pt, dateStr, hour);
  const cached = cacheHit?.data || null;
  rememberWeatherCacheHitForPoint(cacheHit, pt, dateStr, hour);
  if (cached && hasWeatherDataDetailInfo(cached, pt)) return { data: cached, pt, dateStr, hour, colIdx };

  const saved = getSavedWeatherCells(pt);
  if (hasCompletedWeatherLoad(saved, dateStr, hour)) {
    return { cells: saved, pt, dateStr, hour, colIdx };
  }
  if (hasWeatherTableDetailInfo(colIdx)) {
    return { cells: saved || {}, pt, dateStr, hour, colIdx };
  }

  return null;
}

function hasLoadedWeatherCardInfo(colIdx) {
  return !!getLoadedWeatherCardInfo(colIdx);
}

function minimizeWeatherCardsForLoading(targetStates = []) {
  const loadingCols = new Set(
    targetStates
      .filter(state => state.needsFetch || !state.cached && !state.savedLoaded)
      .map(state => state.i)
  );
  Array.from(_wcStates.keys()).forEach((colIdx) => {
    if (loadingCols.has(colIdx) || !hasLoadedWeatherCardInfo(colIdx)) {
      closeWeatherCard(colIdx);
    }
  });
}

function fetchWeatherForUnloadedCard(colIdx) {
  if (isWeatherCardInteractionLocked()) {
    showWeatherCardBusyNotice();
    return false;
  }
  if (hasLoadedWeatherCardInfo(colIdx)) return false;
  // A batch load is already running — fetchAllWeatherData would no-op on its
  // isWeatherFetching guard, silently swallowing the click. That load's retry sweep
  // re-attempts failed points, so tell the user rather than pretending to fetch.
  if (isWeatherFetching) {
    showNotification('天氣載入中，該航點會自動重試', 'info', 1800);
    return false;
  }
  closeWeatherCard(colIdx);
  showNotification('開始載入此點天氣資訊...', 'info', 1600);
  // force:true guarantees a real re-fetch of this one column (bypasses any stale
  // partial state); it does NOT clear the whole temp cache (onlyColIndex is set).
  fetchAllWeatherData({ onlyColIndex: colIdx, force: true });
  return true;
}

/**
 * Open (or toggle) the weather card popup for a point.
 * Reopens at the size the user last had open (tracked in _wcLastMode).
 */
function openWeatherCard(colIdx, options = {}) {
  // If already open, close it (toggle behavior)
  if (_wcStates.has(colIdx)) {
    closeWeatherCard(colIdx, { centerAfterClose: true });
    return false;
  }
  if (isWeatherCardInteractionLocked()) {
    if (hasLoadedWeatherCardInfo(colIdx)) showWeatherCardBusyNotice();
    else showWeatherNotLoadedNotice();
    return false;
  }
  if (!hasLoadedWeatherCardInfo(colIdx)) {
    closeWeatherCard(colIdx);
    if (options.notify !== false) showWeatherNotLoadedNotice();
    return false;
  }
  const mode = getWeatherCardPreferredMode(colIdx);
  closeOtherOpenWeatherCardsOnMobile(colIdx, mode);
  _wcStates.set(colIdx, mode);
  _renderWeatherCard(colIdx);
  if (
    options.centerOnMobileExpand === true &&
    mode === 'full'
  ) {
    scheduleWeatherCardCenter(colIdx, { settle: true });
  }
  return true;
}

/**
 * Handle user click on a weather icon (map badge or chart marker).
 * Applies collective operation rules.
 */
function handleWeatherIconInteraction(colIdx) {
  if (colIdx < 0 || colIdx >= weatherPoints.length) return;
  if (isWeatherCardInteractionLocked()) {
    if (hasLoadedWeatherCardInfo(colIdx)) showWeatherCardBusyNotice();
    else showWeatherNotLoadedNotice();
    return;
  }
  if (!hasLoadedWeatherCardInfo(colIdx)) {
    fetchWeatherForUnloadedCard(colIdx);
    return;
  }

  const preferredMode = _wcStates.get(colIdx) || getWeatherCardPreferredMode(colIdx);
  const collectiveCols = getWeatherCardInteractionIndices(colIdx, preferredMode);
  if (collectiveCols.length > 1) {
    // Collective toggle based on the state of the target point
    const isAlreadyOpen = _wcStates.has(colIdx);
    if (isAlreadyOpen) {
      collectiveCols.forEach(ci => closeWeatherCard(ci, { centerAfterClose: ci === colIdx }));
    } else {
      setWeatherCardModeForTargets(collectiveCols, preferredMode, colIdx, { notify: false });
      // Sync highlight so keyboard/centering targets this group
      highlightPoint(colIdx);
    }
  } else {
    // Single toggle
    openWeatherCard(colIdx, { centerOnMobileExpand: true });
    highlightPoint(colIdx);
  }
}

/** Close a specific weather card. */
function closeWeatherCard(colIdx, options = {}) {
  const prev = _wcStates.get(colIdx);
  rememberWeatherCardMode(colIdx, prev);
  _wcStates.delete(colIdx);
  // Keep the catchment/weather choice AND (for catchment cards) the basin overlay
  // so closing/minimizing the card still shows the range on the map; the overlay
  // only clears on toggle-to-weather or a route rebuild (clearAllCardCatchments).
  if (!isCatchmentView(colIdx)) clearCardCatchment(colIdx);
  mapManager.closeWeatherPopup(colIdx, { animate: true });
  if (options.centerAfterClose === true && prev === 'full') {
    highlightPoint(colIdx, false, { centerMap: true, centerFullCard: false });
  }
  return prev;
}

function isVisibleOverlay(el) {
  return !!el && !el.classList.contains('hidden');
}

function closeOpenWeatherCardsForBackButton() {
  if (_wcStates.size === 0) return false;
  const openIndices = Array.from(_wcStates.keys());
  openIndices.forEach((idx) => closeWeatherCard(idx));
  return true;
}

function handleNativeBackButton() {
  if (isVisibleOverlay(exportModal)) {
    closeExportModal();
    return;
  }
  if (isVisibleOverlay(mappackImportModal)) {
    _closeMappackImportModal();
    return;
  }
  if (isVisibleOverlay(favoritesReplaceModal)) {
    closeReplaceModal();
    return;
  }
  if (closeOpenWeatherCardsForBackButton()) return;

  const searchResults = document.getElementById('search-results');
  if (searchResults && searchResults.style.display !== 'none') {
    searchResults.style.display = 'none';
    return;
  }

  if (sidePanel?.classList.contains('open')) {
    sidePanel.classList.remove('open');
    return;
  }

  if (isRouteWeatherBusy()) {
    showRouteWeatherBusyNotice();
    return;
  }

  platform.exitApp?.();
}

if (platform.isNative && typeof platform.subscribeBackButton === 'function') {
  platform.subscribeBackButton(handleNativeBackButton);
}

/** Set the card mode and re-render. */
function setWeatherCardMode(colIdx, mode, options = {}) {
  if (mode === 'minimized') {
    closeWeatherCard(colIdx);
    return;
  }
  if (isWeatherCardInteractionLocked()) {
    showWeatherCardBusyNotice();
    return;
  }
  if (!hasLoadedWeatherCardInfo(colIdx)) {
    closeWeatherCard(colIdx);
    if (options.notify) showWeatherNotLoadedNotice();
    return;
  }
  closeOtherOpenWeatherCardsOnMobile(colIdx, mode);
  const prevMode = _wcStates.get(colIdx);
  _wcStates.set(colIdx, mode);
  _renderWeatherCard(colIdx);
  syncCatchmentBasins();   // ensure this point's basin matches its catchment-view choice
  if (
    options.centerOnMobileExpand === true &&
    prevMode !== 'full' &&
    mode === 'full'
  ) {
    scheduleWeatherCardCenter(colIdx, { settle: true });
  }
}

/** Navigate a specific card holder to the next/prev point that has weather data. */
function navigateWeatherCard(colIdx, delta) {
  // Find all column indices that have weather icons AND whose icon type is visible
  const colsWithWeather = [];

  weatherPoints.forEach((pt, i) => {
    // Skip points whose icon type is hidden by the toggle
    if (!isPointIconVisible(i)) return;
    if (hasLoadedWeatherCardInfo(i)) colsWithWeather.push(i);
  });

  if (colsWithWeather.length === 0) return;

  const curPos = colsWithWeather.indexOf(colIdx);
  let nextPos;
  if (curPos < 0) {
    nextPos = delta > 0 ? 0 : colsWithWeather.length - 1;
  } else {
    nextPos = (curPos + delta + colsWithWeather.length) % colsWithWeather.length;
  }

  const nextColIdx = colsWithWeather[nextPos];
  if (nextColIdx === colIdx) return;

  // Cyclic switch: close the current card so prev/next feels like the
  // viewport is moving along the route (start ↔ end wraps around) rather
  // than stacking new popups on top of the old one.
  const mode = _wcStates.get(colIdx) || 'compact';
  closeWeatherCard(colIdx);
  setWeatherCardMode(nextColIdx, mode, { centerOnMobileExpand: mode === 'full' });
  // Full-card centering is scheduled by setWeatherCardMode; compact cards
  // need the marker itself centred because the card no longer reserves room.
  highlightPoint(nextColIdx, false, { centerMap: mode !== 'full' });
}

/**
 * Get weather data for a specific column.
 * Attempts: 1) cachedWeatherData  2) savedWeatherCells  3) fallback '—'
 */
function _getWeatherCardData(colIdx) {
  const pt = weatherPoints[colIdx];
  if (!pt) return null;

  const schedule = getWeatherPointSchedule(pt, colIdx);
  const dateStr = schedule?.date || null;
  const hour = schedule?.hour ?? 8;
  return getLoadedWeatherCardInfo(colIdx) || { data: null, pt, dateStr, hour, colIdx, isLoaded: false };
}

function buildWeatherCardSectionHtml(rows, val, windyUrlForLayer, extraClass = '') {
  const className = `wc-info-grid${extraClass ? ` ${extraClass}` : ''}`;
  let html = `<div class="${className}">`;
  rows.forEach(row => {
    const isWide = row.key === 'coords';
    const fullWidthAttr = isWide ? ' style="grid-column: span 2;"' : '';
    const isCoords = row.key === 'coords';
    const valueClass = isCoords ? 'wc-info-value clickable-coords' : 'wc-info-value';
    const displayVal = val(row.key);
    const layerForRow = ROW_KEY_TO_WINDY_LAYER[row.key];
    const valuePrefix = layerForRow
      ? buildRowWindyIconHtml(layerForRow, windyUrlForLayer(layerForRow))
      : '';
    html += `<div class="wc-info-item${isWide ? ' is-wide' : ''}"${fullWidthAttr}${wcTipAttr(row.label)}>`;
    html += `<span class="wc-info-label">${row.label}</span>`;
    html += `<span class="${valueClass}" ${isCoords ? `data-coords="${displayVal}" title="點擊複製"` : ''}>${valuePrefix}${displayVal}</span>`;
    html += `</div>`;
  });
  html += `</div>`;
  return html;
}

// ---- Weather-card catchment view (shared by waypoint + cursor cards) --------
// A full card can toggle its body between weather info and 集水區 info: the
// delineation is fetched cache-first (getCatchmentFor), drawn on the map in the
// point's own colour, and paired with a time-dependent hydrology read-out.
// The chosen view is remembered by semantic key (like card size in _wcLastModes)
// so a card reopens in the same view — and its basin redraws at the same,
// cache-deterministic position.
// semanticKey → boolean (catchment view). Persisted so a card reopens in the same
// view after a page refresh (keys are coordinate/id-derived, stable across reload).
const LS_CARD_CATCHMENT_VIEW_KEY = 'mappingElf_cardCatchmentView';
const _wcCatchmentViewMemory = new Map();
function loadCardCatchmentViewMemory() {
  _wcCatchmentViewMemory.clear();
  try {
    const arr = JSON.parse(localStorage.getItem(LS_CARD_CATCHMENT_VIEW_KEY) || '[]');
    if (Array.isArray(arr)) arr.forEach((k) => { if (typeof k === 'string') _wcCatchmentViewMemory.set(k, true); });
  } catch (_) { }
}
loadCardCatchmentViewMemory();
function persistCardCatchmentViewMemory() {
  try {
    const keys = [];
    _wcCatchmentViewMemory.forEach((on, k) => { if (on) keys.push(k); });
    localStorage.setItem(LS_CARD_CATCHMENT_VIEW_KEY, JSON.stringify(keys));
  } catch (_) { }
}
let cursorCatchmentView = false;            // GPS-cursor card catchment toggle
const _cardCatchmentToken = new Map();      // key → generation guard for the basin-polygon draw
const _cardCatchmentAbort = new Map();      // key → AbortController for the polygon delineation
const _cardCatchmentLayers = new Map();     // key → L.layerGroup drawn on the map
const _cardPanelToken = new Map();          // key → generation guard for the catchment PANEL fill
const _cardPanelAbort = new Map();          // key → AbortController for the panel weather/hydrology fetch

function catchmentViewKeyFor(colIdx) {
  const pt = weatherPoints[colIdx];
  return pt ? getSemanticKey(pt) : `idx:${colIdx}`;
}
function isCatchmentView(colIdx) {
  return _wcCatchmentViewMemory.get(catchmentViewKeyFor(colIdx)) === true;
}
function setCatchmentViewMemory(colIdx, on) {
  _wcCatchmentViewMemory.set(catchmentViewKeyFor(colIdx), !!on);
  persistCardCatchmentViewMemory();
}

function clearCardCatchmentPolygon(key) {
  const layer = _cardCatchmentLayers.get(key);
  if (layer) { layer.remove(); _cardCatchmentLayers.delete(key); }
}

function drawCardCatchmentPolygon(key, result, accentColor) {
  clearCardCatchmentPolygon(key);
  if (!result?.outer?.length) return;
  const grp = L.layerGroup();
  L.polygon([result.outer, ...(result.holes || [])], {
    color: accentColor, weight: 2, opacity: 0.9,
    fillColor: accentColor, fillOpacity: 0.25,
    className: 'wc-catchment-poly',
  }).addTo(grp);
  if (Array.isArray(result.outlet)) measureDot(result.outlet, '▼').addTo(grp);
  grp.addTo(mapManager.map);
  _cardCatchmentLayers.set(key, grp);
}

// Abort any in-flight fill and remove the drawn polygon for a card key.
function clearCardCatchment(key) {
  _cardCatchmentToken.set(key, (_cardCatchmentToken.get(key) || 0) + 1);
  _cardCatchmentAbort.get(key)?.abort();
  _cardCatchmentAbort.delete(key);
  clearCardCatchmentPolygon(key);
}

// Remove every waypoint-card basin overlay (e.g. on a route rebuild, where colIdx
// keys are re-mapped). Leaves the GPS-cursor overlay alone.
function clearAllCardCatchments() {
  Array.from(_cardCatchmentLayers.keys()).forEach((key) => {
    if (key !== 'cursor') clearCardCatchment(key);
  });
}

// Single source of truth for waypoint/intermediate basin overlays: draw one for
// every point currently in catchment view (regardless of whether its card is
// full, compact, minimized, or closed — the view choice is what matters), and
// clear overlays that are no longer wanted (toggled back to weather, point
// removed, or a stale colIdx after a rebuild). Cache-first + token-guarded, so a
// no-op reconcile is cheap and never flickers an already-correct basin.
function syncCatchmentBasins() {
  const wanted = new Set();
  weatherPoints.forEach((pt, colIdx) => { if (isCatchmentView(colIdx)) wanted.add(colIdx); });
  Array.from(_cardCatchmentLayers.keys()).forEach((key) => {
    if (key !== 'cursor' && !wanted.has(key)) clearCardCatchment(key);
  });
  wanted.forEach((colIdx) => { if (!_cardCatchmentLayers.has(colIdx)) drawCatchmentPolygonForCard(colIdx); });
}

// Display-only progress pill (lockScope 'none' — no editing lock) shown while a
// card's 集水區 basin/data is being delineated. The per-card DEM compute is
// otherwise silent, so the user faced an empty card + undrawn region with no sign
// anything was running. Ref-counted so concurrent card computes share one pill,
// and only raised on a cache MISS (a cache hit returns instantly).
let _cardCatchmentBusyCount = 0;
let _cardCatchmentBusyTask = null;
let _cardCatchmentBusyRun = null;
let _cardCatchmentBusyRunSeq = 0;
// Parity with weather's single-point load (fetchWeatherForUnloadedCard →
// lockScope 'edit' + pausable): the per-card basin compute locks editing to the
// relaxed data-load set AND registers a pausable run so 停止/繼續 shows and actually
// parks the compute (callers park on `_cardCatchmentBusyRun` before the DEM read).
function beginCardCatchmentBusy() {
  _cardCatchmentBusyCount++;
  if (!_cardCatchmentBusyTask) {
    _cardCatchmentBusyTask = beginRouteWeatherBusyTask({
      title: '正在計算集水區', detail: '計算集水區範圍中…', progress: null, lockScope: 'edit',
    });
    _cardCatchmentBusyRun = {
      id: `cardcatch_${++_cardCatchmentBusyRunSeq}`, cancelled: false, paused: false,
      lockScope: 'edit', _resume: null, busyTask: _cardCatchmentBusyTask,
    };
    pausableLoadRuns.add(_cardCatchmentBusyRun);
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    _cardCatchmentBusyCount = Math.max(0, _cardCatchmentBusyCount - 1);
    if (_cardCatchmentBusyCount === 0 && _cardCatchmentBusyTask) {
      if (_cardCatchmentBusyRun) { pausableLoadRuns.delete(_cardCatchmentBusyRun); _cardCatchmentBusyRun = null; }
      _cardCatchmentBusyTask.end();
      _cardCatchmentBusyTask = null;
    }
  };
}

// Delineate (cache-first) and draw ONLY the basin overlay for a card key — no
// panel — so the range shows on the map independently of the card body (compact,
// minimized, closed, or the GPS cursor). Token-guarded per key against a newer
// draw for the same key.
async function drawBasinOverlay(key, lat, lng, accentColor) {
  const token = (_cardCatchmentToken.get(key) || 0) + 1;
  _cardCatchmentToken.set(key, token);
  _cardCatchmentAbort.get(key)?.abort();
  const abort = new AbortController();
  _cardCatchmentAbort.set(key, abort);
  const endBusy = getCatchmentCacheHit(lat, lng) ? null : beginCardCatchmentBusy();
  let result = null;
  try {
    if (endBusy && _cardCatchmentBusyRun) await waitIfLoadPaused(_cardCatchmentBusyRun);  // honor 停止
    if (token !== _cardCatchmentToken.get(key)) return;    // superseded while parked
    result = await getCatchmentFor(lat, lng, { signal: abort.signal });
  } catch (_) {
    if (token !== _cardCatchmentToken.get(key)) return;
  } finally {
    endBusy?.();
  }
  if (token !== _cardCatchmentToken.get(key)) return;
  if (_cardCatchmentAbort.get(key) === abort) _cardCatchmentAbort.delete(key);
  if (result?.status === 'ok' && result.outer?.length) drawCardCatchmentPolygon(key, result, accentColor);
  else clearCardCatchmentPolygon(key);
}

function drawCatchmentPolygonForCard(colIdx) {
  const pt = weatherPoints[colIdx];
  if (!pt) return;
  drawBasinOverlay(colIdx, pt.lat, pt.lng, _weatherPointGradColor(pt));
}

function buildWeatherCardViewToggleHtml(showCatchment) {
  return `<div class="wc-view-toggle" role="tablist">
    <button class="wc-view-btn${showCatchment ? '' : ' active'}" type="button" data-wc-view="weather" role="tab" aria-selected="${!showCatchment}">天氣</button>
    <button class="wc-view-btn${showCatchment ? ' active' : ''}" type="button" data-wc-view="catchment" role="tab" aria-selected="${showCatchment}">集水區</button>
  </div>`;
}

// A catchment row's value cell: value text + optional risk chip. Matches the
// weather card's right-aligned .wc-info-value slot.
function catchmentValueHtml(row) {
  const chip = row.level
    ? ` <span class="risk-chip risk-${catchmentSevClass(row.severity)}">${row.level}</span>`
    : '';
  return `${row.value ?? ''}${chip}`;
}

// Full-size skeleton in the weather-card 2-column grid format (terrain / weather
// / hydrology), rendered up front so the card never resizes when async data
// lands. Values fill in place by index — row order MUST match the fill order in
// renderCardCatchment (area, outlet, computeGeometryRows / computeHydroIndicators).
// `1` = full-width row (like the weather card's is-wide coords row) for the long
// values that don't fit a half-column.
function buildCatchmentSkeletonHtml() {
  const TERRAIN = [['集水區面積', 0], ['出水口海拔', 0], ['海拔範圍', 1], ['平均坡度', 1], ['主流長度', 0]];
  const WEATHER = CATCHMENT_CARD_WEATHER_KEYS.map(([, label]) => [label, 0]);
  const HYDRO = [['土壤含水量', 0], ['前期降雨', 1], ['預估逕流量', 0], ['河川流量', 1], ['溪水暴漲風險', 0], ['土石流風險', 0]];
  const grid = (section, rows) =>
    `<div class="wc-info-grid wc-catch-grid" data-catch="${section}">` +
    rows.map(([label, wide]) =>
      `<div class="wc-info-item${wide ? ' is-wide' : ''}"${wide ? ' style="grid-column: span 2;"' : ''}${wcTipAttr(label)}>`
      + `<span class="wc-info-label">${label}</span>`
      + `<span class="wc-info-value wc-catch-val">…</span></div>`).join('') +
    `</div>`;
  return grid('terrain', TERRAIN) + grid('weather', WEATHER) + grid('hydro', HYDRO)
    + `<div class="ct-disclaimer">水文指標為粗略估算，僅供參考</div>`;
}

// Resolve a waypoint card's weather value for a key, matching the weather view's
// fallback chain (live data → saved cells → weather-table cell → '—') so the
// catchment view's weather rows never diverge from the weather view.
function resolveCardWeatherValue(colIdx, info, key) {
  if (info.data) return getCellValue(info.data, key, info.pt);
  if (info.cells && hasSavedWeatherCellField(info.cells, key)) return getSavedWeatherCellValue(info.cells, key);
  const tableValue = getWeatherTableCellDisplayValue(colIdx, key);
  return (tableValue !== null && tableValue !== undefined) ? tableValue : '—';
}

// Fill a full card's `.wc-catchment` PANEL: render the fixed skeleton, delineate
// (cache-first) for the terrain rows, fill the card's weather, then async
// hydrology — all in place. The basin OVERLAY on the map is owned separately by
// syncCatchmentBasins(); this only touches the card body. Guarded by its own
// per-key panel token/abort so it never fights the polygon draw, and so a
// superseded fill (time change or a newer card) never lands stale (INC race
// rule). weatherVal(key) resolves the card's already-shown weather value (same
// fallback chain as the weather view), so no extra weather fetch is issued here.
async function renderCardCatchment({ key, semKey, lat, lng, dateStr, hour, weatherVal, container }) {
  if (!container) return;
  const token = (_cardPanelToken.get(key) || 0) + 1;
  _cardPanelToken.set(key, token);
  _cardPanelAbort.get(key)?.abort();
  const abort = new AbortController();
  _cardPanelAbort.set(key, abort);
  const stale = () => token !== _cardPanelToken.get(key);

  container.innerHTML = buildCatchmentSkeletonHtml();
  const fill = (section, values) => {
    const cells = container.querySelectorAll(`[data-catch="${section}"] .wc-catch-val`);
    values.forEach((v, i) => { if (cells[i]) cells[i].innerHTML = v; });
  };
  // Weather mirrors the weather view (already loaded) — fill it immediately while the DEM computes.
  fill('weather', CATCHMENT_CARD_WEATHER_KEYS.map(([k]) => (weatherVal ? weatherVal(k) : '—')));

  // Prefill terrain + hydrology from the remembered readout so nothing shows "…"
  // while the live compute runs — and the info survives if a fetch fails / offline.
  const saved = getSavedCatchmentCells(semKey);
  const hasSaved = saved?.status === 'ok';
  if (hasSaved) {
    if (Array.isArray(saved.terrain)) fill('terrain', saved.terrain);
    if (Array.isArray(saved.hydro)) fill('hydro', saved.hydro);
  }

  const endBusy = getCatchmentCacheHit(lat, lng) ? null : beginCardCatchmentBusy();
  let result;
  try {
    if (endBusy && _cardCatchmentBusyRun) await waitIfLoadPaused(_cardCatchmentBusyRun);  // honor 停止
    if (stale()) return;                                   // superseded while parked
    result = await getCatchmentFor(lat, lng, { signal: abort.signal });
  } catch (err) {
    if (stale()) return;                                   // superseded — discard silently
    result = { status: 'error' };
  } finally {
    endBusy?.();
  }
  if (stale()) return;

  if (!result || result.status !== 'ok' || !result.outer?.length) {
    // Live delineation failed — keep the remembered readout on screen if we have
    // one; only show the reason when there is nothing to fall back to.
    if (hasSaved) return;
    const msg = result?.status === 'flat' ? '此處為大面積平地，無法判定集水方向'
      : result?.status === 'empty' ? '此處集水範圍過小'
      : '海拔資料取得失敗，請稍後再試';
    container.innerHTML = `<div class="ct-nodata wc-catch-msg">${msg}</div>`;
    return;
  }

  const geoRows = computeGeometryRows(result);
  const outlet = Number.isFinite(result.outletEle) ? formatElevation(result.outletEle) : '—';
  const terrainVals = [formatArea(result.areaM2), outlet, ...geoRows.map(catchmentValueHtml)];
  fill('terrain', terrainVals);

  let hydroEnv = null;
  try {
    hydroEnv = await fetchHydroData(lat, lng, dateStr, hour, { signal: abort.signal });
  } catch (err) {
    if (stale()) return;
    hydroEnv = null;
  }
  if (stale()) return;
  if (_cardPanelAbort.get(key) === abort) _cardPanelAbort.delete(key);
  const hydroVals = (hydroEnv && hydroEnv.available)
    ? computeHydroIndicators(result, hydroEnv).map(catchmentValueHtml)
    : null;
  if (hydroVals) fill('hydro', hydroVals);
  else if (!(hasSaved && Array.isArray(saved.hydro))) fill('hydro', CATCHMENT_HYDRO_LABELS.map(() => '—'));

  // Remember the freshest complete readout (keyed like the weather cells) so it
  // shows instantly next time and after a page refresh / .melmap import.
  saveCatchmentCells(semKey, {
    status: 'ok',
    terrain: terrainVals,
    hydro: hydroVals || (hasSaved ? saved.hydro : null) || CATCHMENT_HYDRO_LABELS.map(() => '—'),
    dateStr: dateStr || null,
    hour: Number.isFinite(Number(hour)) ? Number(hour) : null,
  });
}

// Per-point "set to now" for a waypoint card. Mirrors the card's ± buttons
// (shiftWaypointTime shifts only this column, respecting strict-linear order).
function setWeatherCardTimeToNow(colIdx, mode /* 'day' | 'hour' */) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const thDate = container.querySelector(`.wt-th-date[data-idx="${colIdx}"]`);
  const di = thDate?.querySelector('.wt-date-input');
  if (!di || di.disabled) return;
  const curMs = colToMs(thDate);
  if (!Number.isFinite(curMs) || curMs <= 0) return;
  const cur = new Date(curMs);
  const now = new Date();
  let deltaMs = 0;
  if (mode === 'day') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const curDay = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()).getTime();
    deltaMs = today - curDay;
  } else {
    deltaMs = (now.getHours() - cur.getHours()) * 3600000;
  }
  if (deltaMs !== 0) shiftWaypointTime(colIdx, deltaMs);
}

function buildWeatherCardTimeControlsHtml(pt, colIdx, dateStr, hour) {
  const tableDateInput = document.querySelector(`#weather-table-container .wt-th-date[data-idx="${colIdx}"] .wt-date-input`);
  const tableTimeSelect = document.querySelector(`#weather-table-container .wt-th-time[data-idx="${colIdx}"] .wt-time-select`);
  const tableDateHead = tableDateInput?.closest('th');
  const tableTimeHead = tableTimeSelect?.closest('th');
  const locked = (tableDateInput?.disabled || tableTimeSelect?.disabled) ?? !pt?.isWaypoint;
  const disabledAttr = locked ? ' disabled' : '';
  const minValue = tableDateInput?.min || '';
  const minAttr = minValue ? ` min="${minValue}"` : '';
  const dayMinusDisabled = locked || !!tableDateHead?.querySelector('.wt-adj-day-minus')?.disabled;
  const dayPlusDisabled = locked || !!tableDateHead?.querySelector('.wt-adj-day-plus')?.disabled;
  const hourMinusDisabled = locked || !!tableTimeHead?.querySelector('.wt-adj-hour-minus')?.disabled;
  const hourPlusDisabled = locked || !!tableTimeHead?.querySelector('.wt-adj-hour-plus')?.disabled;

  return `<div class="wc-info-grid wc-time-grid">
    <div class="wc-info-item wc-time-item">
      <span class="wc-time-edit-wrap">
        <button class="wc-time-adj-btn wc-adj-date-minus" title="減少 1 天" aria-label="減少 1 天"${dayMinusDisabled ? ' disabled' : ''}>-</button>
        <input type="date" class="wc-date-input" value="${dateStr}"${disabledAttr}${minAttr}>
        <button class="wc-time-adj-btn wc-adj-date-plus" title="增加 1 天" aria-label="增加 1 天"${dayPlusDisabled ? ' disabled' : ''}>+</button>
      </span>
    </div>
    <div class="wc-info-item wc-time-item">
      <span class="wc-time-edit-wrap">
        <button class="wc-time-adj-btn wc-adj-hour-minus" title="減少 1 小時" aria-label="減少 1 小時"${hourMinusDisabled ? ' disabled' : ''}>-</button>
        <select class="wc-time-select"${disabledAttr}>${timeOpts(hour)}</select>
        <button class="wc-time-adj-btn wc-adj-hour-plus" title="增加 1 小時" aria-label="增加 1 小時"${hourPlusDisabled ? ' disabled' : ''}>+</button>
      </span>
    </div>
  </div>
  <div class="wc-now-row">
    <button class="wc-now-btn wc-adj-date-now" type="button" title="設為今日" aria-label="設為今日"${locked ? ' disabled' : ''}>
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" fill="currentColor"/></svg>
      <span>今日</span>
    </button>
    <button class="wc-now-btn wc-adj-hour-now" type="button" title="設為現在" aria-label="設為現在"${locked ? ' disabled' : ''}>
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="currentColor"/><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="currentColor"/></svg>
      <span>現在</span>
    </button>
  </div>`;
}

function colorWithAlpha(color, alpha) {
  const text = String(color || '').trim();
  const rgb = text.match(/^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  const rgba = text.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/i);
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map(ch => ch + ch).join('')
      : hex[1];
    const int = parseInt(raw, 16);
    return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
  }
  return text;
}

function buildCompactWeatherValuesHtml(values) {
  const safeValues = values
    .map(value => String(value ?? '').trim())
    .filter(value => value && value !== '??');
  const itemHtml = (safeValues.length ? safeValues : ['??'])
    .map(value => `<span class="wc-compact-value">${_escapeHtml(value)}</span>`)
    .join('');
  return `<span class="wc-compact-data-viewport">
    <span class="wc-compact-marquee">
      <span class="wc-compact-value-set">${itemHtml}</span>
      <span class="wc-compact-value-set" aria-hidden="true">${itemHtml}</span>
    </span>
  </span>`;
}

function updateCompactWeatherMarquee(root) {
  if (!root?.classList?.contains('compact')) return;
  const viewport = root.querySelector('.wc-compact-data-viewport');
  const firstSet = root.querySelector('.wc-compact-value-set:not([aria-hidden="true"])');
  if (!viewport || !firstSet) return;

  requestAnimationFrame(() => {
    const overflow = firstSet.scrollWidth > viewport.clientWidth + 1;
    root.classList.toggle('has-compact-marquee', overflow);
    if (!overflow) {
      root.style.removeProperty('--wc-marquee-distance');
      root.style.removeProperty('--wc-marquee-duration');
      return;
    }
    const distance = Math.ceil(firstSet.scrollWidth + 18);
    const duration = Math.min(18, Math.max(7, distance / 18));
    root.style.setProperty('--wc-marquee-distance', `${distance}px`);
    root.style.setProperty('--wc-marquee-duration', `${duration.toFixed(1)}s`);
  });
}

/** Render a specific weather card. */
function _renderWeatherCard(colIdx) {
  const state = _wcStates.get(colIdx);
  if (!state || state === 'minimized') {
    // Hidden (closed/minimized): keep the basin overlay so 縮小/最小 doesn't
    // remove the catchment range from the map. It clears on toggle-to-weather.
    mapManager.closeWeatherPopup(colIdx);
    return;
  }

  const info = _getWeatherCardData(colIdx);
  if (!info || info.isLoaded === false) {
    mapManager.closeWeatherPopup(colIdx);
    _wcStates.delete(colIdx);
    return;
  }

  const { data, cells, pt, dateStr, hour } = info;
  const isCompact = state === 'compact';
  const isFull = state === 'full';
  // Basin overlays are reconciled centrally by syncCatchmentBasins() (called from
  // the view toggle, refreshOpenWeatherCards, and route rebuilds), so the overlay
  // follows the catchment-view choice regardless of card size/open-state — full,
  // compact, minimized, or closed. This render just draws the card body.

  // Check if this card should be highlighted
  const curTh = document.querySelector('#weather-table-container .wt-col-head.wt-col-highlight');
  const isHighlighted = curTh && parseInt(curTh.dataset.idx) === colIdx;

  // Resolve display values
  const val = (key) => {
    if (key === 'distance') return Number.isFinite(pt._cum) ? formatDistance(pt._cum) : '—';
    if (key === 'elevation') return formatElevation(pt._ele);
    if (key === 'coords') return formatCoords(pt.lat, pt.lng);
    if (data) return getCellValue(data, key, pt);
    if (hasSavedWeatherCellField(cells, key)) return getSavedWeatherCellValue(cells, key);
    const tableValue = getWeatherTableCellDisplayValue(colIdx, key);
    if (tableValue !== null) return tableValue;
    return '—';
  };

  // Weather info
  const weatherStr = val('weather');
  const weatherParts = weatherStr.split(' ');
  const hasWeatherPayload = !!(
    data
    || hasSavedWeatherCellField(cells, 'weather')
    || getWeatherTableCellDisplayValue(colIdx, 'weather') !== null
  );
  const displayWeatherIcon = hasWeatherPayload ? (weatherParts[0] || '?') : '?';
  const wDesc = weatherParts.slice(1).join(' ') || '—';
  const temp = val('temp');
  const precipitation = val('precipitation');
  const precipProb = val('precipProb');
  const windSpeed = val('windSpeed');
  const cardLabel = isCompact ? getWeatherPointShortLabel(pt, colIdx) : (pt.label || getWeatherPointShortLabel(pt, colIdx));

  // Build HTML with unique ID per column card. Use gradient color for card accent.
  const gradColor = _weatherPointGradColor(pt);
  const cardStyle = `--wc-accent: ${gradColor}; --wc-accent-soft: ${colorWithAlpha(gradColor, 0.18)}; --wc-accent-wash: ${colorWithAlpha(gradColor, 0.08)};`;
  let html = `<div class="weather-card${isCompact ? ' compact' : ''}${isFull ? ' full' : ''}${isHighlighted ? ' is-highlighted' : ''}" id="wc-root-${colIdx}" data-col-idx="${colIdx}" style="${cardStyle}">`;

  // Header
  if (isFull) {
    const headerStyle = `background: ${colorWithAlpha(gradColor, 0.1)};`;
    html += `<div class="wc-header" style="${headerStyle}">`;
    html += `<span class="wc-title" title="${_escapeHtml(pt.label || cardLabel)}">${_escapeHtml(cardLabel)}</span>`;
    html += `<button class="wc-btn q-prev" title="上一個點">`;
    html += `<svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor"/></svg></button>`;
    html += `<button class="wc-btn q-next" title="下一個點">`;
    html += `<svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor"/></svg></button>`;
    html += `<button class="wc-btn q-toggle" title="收縮">`;
    html += `<svg viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" fill="currentColor"/></svg></button>`;
    html += `<button class="wc-btn q-close" title="關閉">`;
    html += `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg></button>`;
    html += `</div>`;
  }

  // Body
  html += `<div class="wc-body">`;

  if (isCompact) {
    html += `<div class="wc-compact">`;
    html += `<button class="wc-compact-icon q-close" type="button" title="Close weather card" aria-label="Close weather card">${buildWeatherRoundIconHtml(displayWeatherIcon, 'wc-compact-weather-icon')}</button>`;
    html += `<button class="wc-compact-data q-toggle" type="button" title="Expand weather details" aria-label="Expand weather details">`;
    html += buildCompactWeatherValuesHtml([temp, precipitation, precipProb, windSpeed]);
    html += `</button>`;
    html += `</div>`;
  } else {
    const tempIcon = buildRowWindyIconHtml('temp', buildWindyUrl(pt.lat, pt.lng, dateStr, hour, 'temp'), 14);
    html += `<div class="wc-weather-main"><button class="wc-weather-icon q-weather-icon-close" type="button" title="關閉天氣卡" aria-label="關閉天氣卡">${buildWeatherRoundIconHtml(displayWeatherIcon, 'wc-main-weather-icon')}</button><span class="wc-weather-desc">${wDesc}</span><span class="wc-weather-temp">${tempIcon}${temp}</span></div>`;
  }
  if (isFull) {
    const showCatch = isCatchmentView(colIdx);
    // Time controls sit in the shared block above the weather/集水區 toggle so they
    // apply to whichever view is active.
    html += buildWeatherCardTimeControlsHtml(pt, colIdx, dateStr, hour);
    html += buildWeatherCardViewToggleHtml(showCatch);
    if (showCatch) {
      html += `<div class="wc-catchment"></div>`;
    } else {
      html += buildWeatherCardSectionHtml(WEATHER_CARD_TOP_STAT_ROWS, val, (layer) => buildWindyUrl(pt.lat, pt.lng, dateStr, hour, layer), 'wc-top-stats');
      html += buildWeatherCardSectionHtml(WEATHER_CARD_MIDDLE_ROWS, val, (layer) => buildWindyUrl(pt.lat, pt.lng, dateStr, hour, layer));
      html += buildWeatherCardSectionHtml(WEATHER_CARD_BOTTOM_ROWS, val, (layer) => buildWindyUrl(pt.lat, pt.lng, dateStr, hour, layer), 'wc-bottom-facts');

      const windyUrl = buildWindyUrl(pt.lat, pt.lng, dateStr, hour);
      html += `<a class="wc-windy-btn" href="${windyUrl}" target="_blank" rel="noopener" title="在 Windy 開啟">`;
      html += `<img src="https://www.windy.com/favicon.ico" alt="Windy"><span>在 Windy 開啟</span>`;
      html += `</a>`;
    }
  }

  html += `</div></div>`;

  mapManager.openWeatherPopup(colIdx, html, (wrapper) => {
    _bindWeatherCardEvents(colIdx, wrapper);
  }, !pt.isWaypoint, pt.wpIndex, !!pt.isReturn);
}

/**
 * Open a weather card for the GPS cursor's exact coordinates (independent of
 * the route's weatherPoints). Fetches today's data at the current hour.
 * Toggles closed if already open.
 */
// Last-rendered GPS-cursor card context, so the weather ⇄ catchment toggle can
// rebuild the card without re-fetching.
let _cursorCardCtx = null;

function _rerenderCursorWeatherCard() {
  const ctx = _cursorCardCtx;
  if (!ctx || !mapManager.isCursorWeatherPopupOpen?.()) return;
  const html = _buildCursorWeatherCardHtml(ctx.lat, ctx.lng, ctx.dateStr, ctx.hour, ctx.data, ctx.status);
  mapManager.openCursorWeatherPopup(html, (wrapper) => {
    _bindCursorWeatherCardEvents(wrapper, ctx.lat, ctx.lng);
  });
}

function _resetCursorCatchment() {
  cursorCatchmentView = false;
  clearCardCatchment('cursor');
}

async function openCursorWeatherCard(lat, lng) {
  if (isWeatherCardInteractionLocked()) {
    showWeatherCardBusyNotice();
    return;
  }
  if (mapManager.isCursorWeatherPopupOpen?.()) {
    mapManager.closeCursorWeatherPopup();
    _resetCursorCatchment();
    return;
  }
  _resetCursorCatchment();   // a fresh cursor card always starts in weather view

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hour = now.getHours();
  const cacheKey = weatherCoordKey(lat, lng, dateStr, hour);

  const renderCard = (data, status) => {
    _cursorCardCtx = { lat, lng, dateStr, hour, data, status };
    const html = _buildCursorWeatherCardHtml(lat, lng, dateStr, hour, data, status);
    mapManager.openCursorWeatherPopup(html, (wrapper) => {
      _bindCursorWeatherCardEvents(wrapper, lat, lng);
    });
  };

  const cacheHit = getWeatherCacheHit({ lat, lng }, dateStr, hour);
  let data = cacheHit?.data || null;
  if (data) {
    rememberWeatherCacheHitForPoint(cacheHit, { lat, lng }, dateStr, hour);
    renderCard(data, 'ok');
    return;
  }

  // Show loading state, then fetch
  renderCard(null, 'loading');
  try {
    data = await weatherService.getWeatherAtPoint(lat, lng, dateStr, hour);
    setWeatherCacheData({ lat, lng }, dateStr, hour, data, { cacheKey });
    if (mapManager.isCursorWeatherPopupOpen?.()) renderCard(data, 'ok');
  } catch (err) {
    console.warn('Cursor weather fetch failed:', err.message);
    if (mapManager.isCursorWeatherPopupOpen?.()) renderCard(null, 'error');
  }
}

function _buildCursorWeatherCardHtml(lat, lng, dateStr, hour, data, status) {
  const val = (key) => {
    if (key === 'distance') return '—';
    if (key === 'coords') return formatCoords(lat, lng);
    if (data) return getCellValue(data, key, { lat, lng }); // GPS cursor has no elevation, so pt._ele will be undefined
    return '—';
  };
  const weatherStr = val('weather');
  const weatherParts = weatherStr.split(' ');
  const wIcon = (data && weatherParts[0]) || (status === 'loading' ? '⏳' : status === 'error' ? '⚠️' : '❓');
  const wDesc = (data && weatherParts.slice(1).join(' ')) || (status === 'loading' ? '取得天氣中…' : status === 'error' ? '取得失敗' : '—');
  const temp = val('temp');
  const title = 'GPS 游標';

  const accentColor = '#6366f1';
  const cardStyle = `--wc-accent: ${accentColor};`;
  const headerBg = 'rgba(99, 102, 241, 0.1)';
  const headerStyle = `background: ${headerBg};`;

  let html = `<div class="weather-card full cursor-weather-card" data-cursor-card="1" style="${cardStyle}">`;
  html += `<div class="wc-header" style="${headerStyle}">`;
  html += `<span class="wc-title">${title}</span>`;
  html += `<button class="wc-btn q-close" title="關閉">`;
  html += `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg></button>`;
  html += `</div>`;

  html += `<div class="wc-body">`;
  const tempIcon = buildRowWindyIconHtml('temp', buildWindyUrl(lat, lng, dateStr, hour, 'temp'), 14);
  html += `<div class="wc-weather-main"><button class="wc-weather-icon q-weather-icon-close" type="button" title="關閉天氣卡" aria-label="關閉天氣卡">${buildWeatherRoundIconHtml(wIcon, 'wc-main-weather-icon')}</button><span class="wc-weather-desc">${wDesc}</span><span class="wc-weather-temp">${tempIcon}${temp}</span></div>`;

  html += buildWeatherCardViewToggleHtml(cursorCatchmentView);

  if (cursorCatchmentView) {
    html += `<div class="wc-catchment"></div>`;
  } else if (status === 'ok') {
    html += buildWeatherCardSectionHtml(WEATHER_CARD_TOP_STAT_ROWS, val, (layer) => buildWindyUrl(lat, lng, dateStr, hour, layer), 'wc-top-stats');
    html += buildWeatherCardSectionHtml(WEATHER_CARD_MIDDLE_ROWS, val, (layer) => buildWindyUrl(lat, lng, dateStr, hour, layer));
    html += buildWeatherCardSectionHtml(WEATHER_CARD_BOTTOM_ROWS, val, (layer) => buildWindyUrl(lat, lng, dateStr, hour, layer), 'wc-bottom-facts');

    const windyUrl = buildWindyUrl(lat, lng, dateStr, hour);
    html += `<a class="wc-windy-btn" href="${windyUrl}" target="_blank" rel="noopener" title="在 Windy 開啟">`;
    html += `<img src="https://www.windy.com/favicon.ico" alt="Windy"><span>在 Windy 開啟</span>`;
    html += `</a>`;
  } else {
    html += `<div class="wc-info-grid"><div class="wc-info-item is-wide" style="grid-column: span 2;">`;
    html += `<span class="wc-info-label">坐標</span><span class="wc-info-value clickable-coords" data-coords="${formatCoords(lat, lng)}" title="點擊複製">${formatCoords(lat, lng)}</span>`;
    html += `</div></div>`;
  }

  html += `</div></div>`;
  return html;
}

function _bindCursorWeatherCardEvents(wrapper, lat, lng) {
  if (!wrapper) return;
  const closeCursorCard = () => {
    mapManager.closeCursorWeatherPopup();
    _resetCursorCatchment();
  };
  wrapper.querySelector('.q-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCursorCard();
  });
  wrapper.querySelector('.q-weather-icon-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCursorCard();
  });
  wrapper.querySelectorAll('.clickable-coords').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = e.currentTarget.dataset.coords || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      copyToClipboard(text, (ok) => showNotification(ok ? `已複製座標 ${text}` : '複製失敗', ok ? 'success' : 'error', 1500));
    });
  });

  // Weather ⇄ catchment view toggle for the GPS-cursor card.
  wrapper.querySelectorAll('.wc-view-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const toCatch = btn.dataset.wcView === 'catchment';
      if (toCatch === cursorCatchmentView) return;
      cursorCatchmentView = toCatch;
      if (!toCatch) clearCardCatchment('cursor');
      _rerenderCursorWeatherCard();
    });
  });

  if (cursorCatchmentView) {
    const container = wrapper.querySelector('.wc-catchment');
    const ctx = _cursorCardCtx;
    if (container && ctx) {
      drawBasinOverlay('cursor', ctx.lat, ctx.lng, '#6366f1');   // basin on the map
      renderCardCatchment({                                       // panel body
        key: 'cursor',
        semKey: null,   // GPS cursor is ephemeral — not remembered
        lat: ctx.lat,
        lng: ctx.lng,
        dateStr: ctx.dateStr,
        hour: ctx.hour,
        weatherVal: (k) => (ctx.data ? getCellValue(ctx.data, k, { lat: ctx.lat, lng: ctx.lng }) : '—'),
        container,
      });
    }
  }
}

function isWeatherCardBlankClickTarget(target, root) {
  if (!target?.closest || !root?.contains?.(target)) return false;
  if (!root.classList.contains('full')) return false;

  const contentOrControlSelector = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    '.clickable-coords',
    '.wc-title',
    '.wc-weather-icon',
    '.wc-weather-desc',
    '.wc-weather-temp',
    '.wc-info-item',
    '.wc-time-edit-wrap',
    '.wc-now-row',
    '.wc-view-toggle',
    '.wc-catchment',
  ].join(',');
  const contentOrControl = target.closest(contentOrControlSelector);
  if (contentOrControl && root.contains(contentOrControl)) return false;

  return !!target.closest('.weather-card.full, .wc-header, .wc-body, .wc-weather-main, .wc-info-grid');
}

/** Bind click and touch events to the weather card DOM. */
function _bindWeatherCardEvents(colIdx, wrapper) {
  const root = wrapper?.querySelector(`.weather-card`) || document.getElementById(`wc-root-${colIdx}`);
  if (!root) return;
  updateCompactWeatherMarquee(root);

  // Clicking the card highlights the point
  root.addEventListener('click', (e) => {
    // Requirement: Don't highlight when clicking inputs/selects in the card
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.target.closest('.clickable-coords')) return;
    if (isWeatherCardBlankClickTarget(e.target, root)) {
      e.stopPropagation();
      const targets = getWeatherCardInteractionIndices(colIdx, _wcStates.get(colIdx) || 'full');
      setWeatherCardModeForTargets(targets, 'compact', colIdx);
      highlightPoint(colIdx, false, { centerMap: true });
      return;
    }
    highlightPoint(colIdx, false, { centerFullCard: true });
  });

  // Button clicks
  root.querySelector('.q-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const targets = getWeatherCardInteractionIndices(colIdx, _wcStates.get(colIdx) || 'compact');
    targets.forEach(idx => closeWeatherCard(idx, { centerAfterClose: idx === colIdx }));
  });
  root.querySelector('.q-weather-icon-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const targets = getWeatherCardInteractionIndices(colIdx, _wcStates.get(colIdx) || 'compact');
    targets.forEach(idx => closeWeatherCard(idx, { centerAfterClose: idx === colIdx }));
  });
  root.querySelector('.q-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curMode = _wcStates.get(colIdx) || 'compact';
    const nextMode = curMode === 'compact' ? 'full' : 'compact';
    const targets = getWeatherCardInteractionIndices(colIdx, curMode);
    setWeatherCardModeForTargets(targets, nextMode, colIdx);
    highlightPoint(colIdx, false, { centerMap: nextMode === 'compact' });
  });
  root.querySelector('.q-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateWeatherCard(colIdx, -1);
  });
  root.querySelector('.q-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateWeatherCard(colIdx, +1);
  });
  // Click to copy coordinates
  root.querySelectorAll('.clickable-coords').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = e.currentTarget.dataset.coords;
      if (!text) return;
      copyToClipboard(text, (ok) => showNotification(ok ? `已複製座標 ${text}` : '複製失敗', ok ? 'success' : 'error', 1500));
    });
  });

  let namePeekTimer = 0;
  const startNamePeek = () => {
    clearTimeout(namePeekTimer);
    namePeekTimer = setTimeout(() => showMainWaypointNamePeek(root), 650);
  };
  const cancelNamePeek = () => {
    clearTimeout(namePeekTimer);
    namePeekTimer = 0;
  };
  root.addEventListener('mousedown', startNamePeek);
  root.addEventListener('mouseup', cancelNamePeek);
  root.addEventListener('mouseleave', cancelNamePeek);

  // Sync changes back to the weather table
  root.querySelectorAll('.wc-date-input, .wc-time-select').forEach(el => {
    el.addEventListener('change', (e) => {
      e.stopPropagation();
      const container = document.getElementById('weather-table-container');
      if (!container) return;
      const isDate = e.target.classList.contains('wc-date-input');
      const tableInput = isDate
        ? container.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)
        : container.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`);

      if (tableInput) {
        // Before changing, snapshot for delta shift logic if speed mode is on
        const th = container.querySelector(`.wt-th-date[data-idx="${colIdx}"]`);
        if (th) th.dataset.prevMs = String(colToMs(th));

        tableInput.value = e.target.value;
        handleWeatherTimeChange(colIdx);
        // Re-render card immediately so the user sees their changes (and eventually new weather data)
        _renderWeatherCard(colIdx);
      }
    });
  });

  const bindCardTimeAdjust = (selector, deltaMs) => {
    root.querySelector(selector)?.addEventListener('click', (e) => {
      e.stopPropagation();
      shiftWaypointTime(colIdx, deltaMs);
    });
  };
  bindCardTimeAdjust('.wc-adj-date-minus', -86400000);
  bindCardTimeAdjust('.wc-adj-date-plus', 86400000);
  bindCardTimeAdjust('.wc-adj-hour-minus', -3600000);
  bindCardTimeAdjust('.wc-adj-hour-plus', 3600000);

  // "Set to now" buttons — per-point, matching the ± buttons above.
  root.querySelector('.wc-adj-date-now')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setWeatherCardTimeToNow(colIdx, 'day');
  });
  root.querySelector('.wc-adj-hour-now')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setWeatherCardTimeToNow(colIdx, 'hour');
  });

  // Weather ⇄ catchment view toggle. Applies to the whole collective set (like
  // the card's expand/close), and the choice is remembered per card so it
  // reopens in the same view. Re-renders each target; the basin overlay is
  // drawn/cleared by the catchment fill below.
  root.querySelectorAll('.wc-view-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const toCatch = btn.dataset.wcView === 'catchment';
      if (toCatch === isCatchmentView(colIdx)) return;   // already in this view
      // Remember the choice for the whole collective set (so closed/compact cards
      // adopt it too), then re-render only the open cards via the safe refresh
      // path (raw _renderWeatherCard would close a momentarily-unloaded card).
      getWeatherCardInteractionIndices(colIdx).forEach((idx) => {
        setCatchmentViewMemory(idx, toCatch);
      });
      syncCatchmentBasins();   // draw/clear basins for the whole set (incl. compact/closed)
      refreshOpenWeatherCards();
    });
  });

  // If this full card is in catchment view, fill its panel (the basin overlay on
  // the map is handled separately by syncCatchmentBasins).
  if (isCatchmentView(colIdx)) {
    const container = root.querySelector('.wc-catchment');
    const info = _getWeatherCardData(colIdx);
    if (container && info?.pt) {
      renderCardCatchment({
        key: colIdx,
        semKey: getSemanticKey(info.pt),
        lat: info.pt.lat,
        lng: info.pt.lng,
        dateStr: info.dateStr,
        hour: info.hour,
        weatherVal: (k) => resolveCardWeatherValue(colIdx, info, k),
        container,
      });
    }
  }

  // Touch gestures: swipe detection
  let _touchStartX = 0, _touchStartY = 0;
  let _touchStartTime = 0;

  root.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    _touchStartX = touch.clientX;
    _touchStartY = touch.clientY;
    _touchStartTime = Date.now();
    startNamePeek();
  }, { passive: true });

  root.addEventListener('touchmove', cancelNamePeek, { passive: true });

  root.addEventListener('touchend', (e) => {
    cancelNamePeek();
    const touch = e.changedTouches[0];
    const dx = touch.clientX - _touchStartX;
    const dy = touch.clientY - _touchStartY;
    const dt = Date.now() - _touchStartTime;

    if (dt > 400) return;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const minSwipe = 40;

    if (absDx > absDy && absDx > minSwipe) {
      // Horizontal swipe
      if (dx < 0) {
        navigateWeatherCard(colIdx, +1);
      } else {
        navigateWeatherCard(colIdx, -1);
      }
    } else if (absDy > absDx && absDy > minSwipe) {
      // Vertical swipe
      if (dy < 0) {
        // Swipe up: toggle between compact and full
        const curMode = _wcStates.get(colIdx) || 'compact';
        const nextMode = curMode === 'compact' ? 'full' : 'compact';
        const targets = getWeatherCardInteractionIndices(colIdx, curMode);
        setWeatherCardModeForTargets(targets, nextMode, colIdx);
        highlightPoint(colIdx, false, { centerMap: nextMode === 'compact' });
      } else {
        // Swipe down: close
        const targets = getWeatherCardInteractionIndices(colIdx, _wcStates.get(colIdx) || 'compact');
        targets.forEach(idx => closeWeatherCard(idx, { centerAfterClose: idx === colIdx }));
      }
    }
  }, { passive: false });
}

// Bind weather badge click callback on mapManager
mapManager.onWeatherBadgeClick = (idx, isIntermediate) => {
  let targetColIdx = -1;
  if (isIntermediate) {
    targetColIdx = idx;
  } else {
    // waypoints use their waypoint index for badge click; map back to colIdx
    targetColIdx = weatherPoints.findIndex(p => p.isWaypoint && !p.isReturn && p.wpIndex === idx);
  }

  if (targetColIdx >= 0) {
    handleWeatherIconInteraction(targetColIdx);
  }
};

// =========== Elevation Markers ===========

/**
 * Gradient color for a weather-table point, matching the map polyline:
 *   - return-leg points → red→purple→blue across return cum range
 *   - outbound points (when a return exists) → teal→red across outbound max
 *   - no-return modes → legacy (round-trip folds; straight line linear)
 */
function _weatherPointGradColor(pt) {
  if (!pt) return interpolateRouteColor(0);

  const fwdPts = weatherPoints.filter(p => !p.isReturn && typeof p._cum === 'number');
  const outboundMax = fwdPts.length ? Math.max(...fwdPts.map(p => p._cum)) : 0;
  const allPts = weatherPoints.filter(p => typeof p._cum === 'number');
  const totalMax = allPts.length ? Math.max(...allPts.map(p => p._cum)) : 0;

  if (pt.isReturn) {
    const tRet = (totalMax > outboundMax)
      ? Math.max(0, Math.min(1, ((pt._cum ?? outboundMax) - outboundMax) / (totalMax - outboundMax)))
      : 0;
    return interpolateReturnColor(tRet);
  }

  // Outbound or non-split route
  const t = outboundMax > 0
    ? Math.max(0, Math.min(1, (pt._cum ?? 0) / outboundMax))
    : 0;

  if (roundTripMode && !pt.isReturn && !weatherPoints.some(p => p.isReturn)) {
    // Basic round-trip fold fallback (when no explicit return points exist yet)
    const xFrac = totalMax > 0 ? (pt._cum ?? 0) / totalMax : 0;
    const tFold = 1 - Math.abs(2 * xFrac - 1);
    return interpolateRouteColor(tFold);
  }

  return interpolateRouteColor(t);
}

function highlightWeatherColumn(colIdx) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  container.querySelectorAll('.wt-col-highlight')
    .forEach(el => {
      el.classList.remove('wt-col-highlight');
      el.style.removeProperty('background-color');
    });

  const pt = weatherPoints[colIdx];
  let bgStr = '';
  if (pt) {
    const base = _weatherPointGradColor(pt);
    bgStr = base.replace('rgb', 'rgba').replace(')', ', 0.15)');
  }

  const cols = container.querySelectorAll(`[data-idx="${colIdx}"], [data-col="${colIdx}"]`);
  cols.forEach(el => {
    el.classList.add('wt-col-highlight');
    if (bgStr) el.style.setProperty('background-color', bgStr, 'important');
  });
}

function centerWeatherColumn(colIdx, behavior = 'smooth') {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  const scroller = container.closest('.bp-weather-scroll') || container.parentElement;
  if (!scroller) return;

  const th = container.querySelector(`.wt-header-row-label .wt-col-head[data-idx="${colIdx}"]`)
    || container.querySelector(`.wt-col-head[data-idx="${colIdx}"]`)
    || container.querySelector(`[data-col="${colIdx}"]`);
  if (!th) return;

  const scrollerRect = scroller.getBoundingClientRect();
  const thRect = th.getBoundingClientRect();
  const currentLeft = scroller.scrollLeft || 0;
  const targetLeft = currentLeft
    + (thRect.left - scrollerRect.left)
    - (scroller.clientWidth / 2)
    + (thRect.width / 2);
  const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const left = Math.max(0, Math.min(maxLeft, targetLeft));

  if (typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ left, behavior });
  } else {
    scroller.scrollLeft = left;
  }
}

/**
 * Compute the safe viewport area inside the map container, excluding the
 * regions occluded by the side-panel (right) and the bottom-panel (bottom).
 * The vertical safe area is therefore bounded above by the toolbar/container
 * top and below by the bottom-panel divider line.
 */
function _getMapSafeArea() {
  const map = mapManager.map;
  const container = map.getContainer();
  const rect = container.getBoundingClientRect();

  const sidePanel = document.getElementById('side-panel');
  const panelOpen = sidePanel?.classList.contains('open');
  const panelRect = panelOpen ? sidePanel.getBoundingClientRect() : null;
  const panelOverlap = panelRect ? Math.max(0, rect.right - panelRect.left) : 0;

  const bottomPanel = document.getElementById('bottom-panel');
  const bpRect = bottomPanel?.getBoundingClientRect();
  const bottomOverlap = bpRect ? Math.max(0, rect.bottom - bpRect.top) : 0;

  const isMobile = rect.width < 768;
  const padX = isMobile ? 12 : 16;
  // Extra top padding on mobile so the card-header buttons stay clear of
  // the toolbar edge and remain easy to tap.
  const padTop = isMobile ? 20 : 16;
  const padBottom = isMobile ? 8 : 12;

  return {
    rect,
    safeLeft:   padX,
    safeRight:  rect.width - panelOverlap - padX,
    safeTop:    padTop,
    safeBottom: rect.height - bottomOverlap - padBottom,
  };
}

/**
 * Pan the map so the weather card popup is centred in the safe viewport
 * area — vertically the centre is determined by the bottom-panel divider
 * line (i.e. the visible map area), so the card sits midway between the
 * toolbar and the divider, with its top buttons clear of the toolbar edge.
 */
function panMapToCenterFullCard(colIdx) {
  const pt = weatherPoints[colIdx];
  if (!pt) return;
  const map = mapManager.map;

  const cardEl = document.getElementById(`wc-root-${colIdx}`);
  const { rect, safeLeft, safeRight, safeTop, safeBottom } = _getMapSafeArea();
  const safeCenterX = (safeLeft + safeRight) / 2;
  const safeCenterY = (safeTop + safeBottom) / 2;

  // Inline map cards inherit different marker anchors for waypoints versus
  // interval points. Measure the rendered card itself so switching between
  // those marker types lands on the same visual centre.
  if (cardEl && !cardEl.closest('.mobile-weather-card-layer')) {
    const cardRect = cardEl.getBoundingClientRect();
    const cardCenterX = cardRect.left - rect.left + cardRect.width / 2;
    const cardCenterY = cardRect.top - rect.top + cardRect.height / 2;
    const dx = cardCenterX - safeCenterX;
    const dy = cardCenterY - safeCenterY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    map.panBy([dx, dy], { animate: true, duration: 0.25 });
    return;
  }

  const cardW = cardEl?.offsetWidth || 280;
  const cardH = cardEl?.offsetHeight || 260;
  const popupOffsetY = pt.isWaypoint ? 24 : 12;

  // The popup wrapper sits with its bottom at marker_y - popupOffsetY (the
  // tip is hidden via CSS, so no extra gap is needed). Prefer centering the
  // card between the toolbar and bottom-panel divider, but clamp its top edge
  // into the safe area so the header buttons remain reachable on small phones.
  const targetX = safeCenterX;
  const desiredCardTop = safeCenterY - cardH / 2;
  const cardTop = Math.max(safeTop, desiredCardTop);
  const targetY = cardTop + cardH + popupOffsetY;

  const currentPointPx = map.latLngToContainerPoint([pt.lat, pt.lng]);
  const dx = currentPointPx.x - targetX;
  const dy = currentPointPx.y - targetY;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  map.panBy([dx, dy], { animate: true, duration: 0.25 });
}

function scheduleWeatherCardCenter(colIdx, options = {}) {
  const center = () => panMapToCenterFullCard(colIdx);
  requestAnimationFrame(() => {
    requestAnimationFrame(center);
  });
  if (options.settle) {
    setTimeout(center, 120);
    setTimeout(center, 280);
  }
}

/**
 * Pan so the marker lands at the visible centre of the safe area
 * (used when no full card needs vertical room). On mobile this keeps
 * the marker above the bottom-panel divider rather than hidden behind it.
 */
function panMapToVisibleCenter(latlng) {
  const map = mapManager.map;
  const { safeLeft, safeRight, safeTop, safeBottom } = _getMapSafeArea();
  const targetX = (safeLeft + safeRight) / 2;
  const targetY = (safeTop + safeBottom) / 2;
  const currentPointPx = map.latLngToContainerPoint(latlng);
  const dx = currentPointPx.x - targetX;
  const dy = currentPointPx.y - targetY;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  map.panBy([dx, dy], { animate: true, duration: 0.25 });
}

/**
 * Unified highlight: sync weather table, elevation chart, map marker,
 * and side-panel waypoint item for the given weather-column index.
 * All columns that share the same coordinate are highlighted together.
 */
function highlightPoint(colIdx, toggle = false, options = {}) {
  if (toggle && typeof toggle === 'object') {
    options = toggle;
    toggle = !!options.toggle;
  }
  if (colIdx < 0 || colIdx >= weatherPoints.length) return;
  const pt = weatherPoints[colIdx];

  // If toggle is true and this column is already highlighted, clear everything
  const container = document.getElementById('weather-table-container');
  const isAlreadyHighlighted = container?.querySelector(`.wt-col-highlight[data-idx="${colIdx}"]`) !== null;
  if (toggle && isAlreadyHighlighted) {
    clearAllHighlights();
    return;
  }

  // 1. Weather table — highlight exactly the clicked column
  highlightWeatherColumn(colIdx);
  centerWeatherColumn(colIdx);

  // 2. Elevation chart — crosshair at this column's route position
  const sampledPts = elevationProfile.points;
  const sampledDists = elevationProfile.distances;
  if (sampledPts && sampledPts.length > 1 && currentRouteCoords.length > 1) {
    const fullDist = getRouteMetrics().totalDistM;
    if (fullDist > 0) {
      const frac = Math.max(0, Math.min(1, (pt._cum || 0) / fullDist));
      const idx = Math.round(frac * (sampledPts.length - 1));
      elevationProfile.centerHorizontallyAtIndex(idx);
      elevationProfile.showCrosshairAtIndex(idx);
    }
  }

  // 3. Map — highlight the physical waypoint marker (one per wpIndex per leg)
  if (pt.isWaypoint && pt.wpIndex !== undefined && !pt.isReturn) {
    mapManager.highlightWaypoint(pt.wpIndex);
    mapManager.clearHoverMarker();
  } else if (pt.isWaypoint && pt.isReturn && pt.wpIndex !== undefined) {
    mapManager.highlightReturnWaypoint(pt.wpIndex);
    mapManager.clearHoverMarker();
  } else {
    mapManager.clearWaypointHighlight();
    mapManager.showHoverMarker(pt.lat, pt.lng, _weatherPointGradColor(pt));
  }

  // 4. Side panel — highlight the outgoing waypoint item row
  const items = waypointList.querySelectorAll('.waypoint-item');
  items.forEach(el => el.classList.remove('wp-highlight'));
  if (pt.isWaypoint && pt.wpIndex !== undefined) {
    const item = items[pt.wpIndex];
    if (item) {
      item.classList.add('wp-highlight');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // 5. Weather Card — Highlight the card and bring to front
  document.querySelectorAll('.weather-card.is-highlighted').forEach(el => {
    el.classList.remove('is-highlighted');
    const popup = el.closest('.leaflet-popup');
    if (popup) popup.style.zIndex = '';
    el.closest('.leaflet-marker-icon')?.classList.remove('has-highlighted-weather-card');
  });
  const card = document.getElementById(`wc-root-${colIdx}`);
  if (card) {
    card.classList.add('is-highlighted');
    const popup = card.closest('.leaflet-popup');
    if (popup) popup.style.zIndex = '1000';
    card.closest('.leaflet-marker-icon')?.classList.add('has-highlighted-weather-card');
  }

  // 6. Map Centering: default highlight taps only pan when there is no open
  // card. Card navigation/collapse can opt in so the newly highlighted marker
  // remains visible after the popup size or target changes.
  const cardMode = _wcStates.get(colIdx);
  if (waypointCentering && cardMode === 'full' && options.centerFullCard !== false) {
    scheduleWeatherCardCenter(colIdx, { settle: true });
    return;
  }
  const shouldCenterMap = options.centerMap === true || (options.centerMap !== false && !cardMode);
  if (waypointCentering && shouldCenterMap) {
    panMapToVisibleCenter([pt.lat, pt.lng]);
  }
}

/** Remove all cross-view highlights. */
function clearAllHighlights() {
  document.querySelectorAll('.wt-col-highlight').forEach(el => {
    el.classList.remove('wt-col-highlight');
    el.style.removeProperty('background-color');
  });
  document.querySelectorAll('.waypoint-item.wp-highlight').forEach(el => el.classList.remove('wp-highlight'));
  document.querySelectorAll('.weather-card.is-highlighted').forEach(el => {
    el.classList.remove('is-highlighted');
    const popup = el.closest('.leaflet-popup');
    if (popup) popup.style.zIndex = '';
    el.closest('.leaflet-marker-icon')?.classList.remove('has-highlighted-weather-card');
  });
  mapManager.clearWaypointHighlight();
  mapManager.clearHoverMarker();
  elevationProfile.hideCrosshair();
}

function updateElevationMarkers() {
  if (weatherPoints.length === 0 || currentRouteCoords.length < 2) {
    elevationProfile.setWaypointMarkers([]);
    return;
  }
  // Only show actual waypoints and km-interval markers; exclude auto-midpoints
  const sampledPts = elevationProfile.points;
  const sampledDists = elevationProfile.distances;

  const fullTotalDist = getRouteMetrics().totalDistM;

  const markers = [];
  weatherPoints.forEach((pt, colIdx) => {
    if (pt.isWaypoint || segmentIntervalKm > 0 || speedIntervalMode) {
      let cumDistM = pt._cum || 0;
      let dataIdx = null;
      if (sampledPts && sampledPts.length > 1 && fullTotalDist > 0) {
        // Map pt._cum fraction → sampled index (handles round-trip correctly since
        // fraction is monotonic and sampled indices match route order)
        const fraction = Math.max(0, Math.min(1, cumDistM / fullTotalDist));
        dataIdx = Math.round(fraction * (sampledPts.length - 1));
        cumDistM = sampledDists[dataIdx] || 0;
      }

      // Try to find weather icon for this point
      const schedule = getWeatherPointSchedule(pt, colIdx);
      const cached = schedule ? getWeatherCacheData(pt, schedule.date, schedule.hour) : null;
      let weatherIcon = cached?.weatherIcon || getSavedWeatherCells(pt)?.weather?.split(' ')[0] || null;

      // Filter weather icons based on visibility settings
      if (pt.isWaypoint && !showWpIcon) weatherIcon = null;
      if (!pt.isWaypoint && !showImIcon) weatherIcon = null;

      markers.push({ cumDistM, dataIdx, label: pt.label, colIdx, isWaypoint: pt.isWaypoint, weatherIcon });
    }
  });
  elevationProfile.setWaypointMarkers(markers);
}

function refreshLanguageSensitiveUi() {
  renderWeatherPanel();
  if (allAlternatives.length > 0) {
    renderAlternatives(allAlternatives, selectedAltIndex);
  }
  updateWaypointList(mapManager.waypoints);
  updateTimeStat();
  syncPaceCalibrationUI();
  updateFlatPlaceholder();
  updateThemeIcons();
  renderFavoritesList();
  refreshOpenWeatherCards();
  refreshKeywordSearchResults?.();
  syncTvLanguageSelect();
  applyTranslations();
}

// =========== Init ===========

async function init() {
  initI18n({
    onLanguageChange: refreshLanguageSensitiveUi,
  });

  // Global listener for clickable coordinates
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.clickable-coords');
    if (!el) return;
    const text = el.dataset.coords || el.innerText;
    if (!text) return;
    e.stopPropagation();
    copyToClipboard(text, (ok) => showNotification(ok ? `已複製座標 ${text}` : '複製失敗', ok ? 'success' : 'error', 1500));
  });

  isInitialLoad = true;
  await offlineManager.register();
  initWeatherControls();
  initWaypointSettings();

  // Restore route mode
  const savedMode = localStorage.getItem(LS_ROUTE_MODE_KEY) || 'hiking';
  if (savedMode) {
    routeEngine.setMode(savedMode);
    const modeRadio = document.querySelector(`input[name="route-mode"][value="${savedMode}"]`);
    if (modeRadio) modeRadio.checked = true;
  }

  // Restore map tile layer
  const savedLayer = getPersistedMapLayer();
  if (savedLayer) {
    mapManager.switchLayer(savedLayer);
    layerBtns.forEach((b) => b.classList.toggle('active', b.dataset.layer === savedLayer));
  }

  // Restore map view (center + zoom) — will be overridden by fitToRoute if waypoints exist
  const savedView = (() => {
    try { return JSON.parse(localStorage.getItem(LS_MAP_VIEW_KEY) || 'null'); }
    catch { return null; }
  })();
  if (savedView) mapManager.map.setView([savedView.lat, savedView.lng], savedView.zoom);

  // Persist map view on every move
  mapManager.map.on('moveend', () => {
    const c = mapManager.map.getCenter();
    localStorage.setItem(LS_MAP_VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: mapManager.map.getZoom() }));
  });

  // Restore + wire nav-mode radio group (單程 / 來回 / O繞)
  {
    const navModeEls = document.querySelectorAll('input[name="nav-mode"]');
    const initNavMode = roundTripMode ? 'roundtrip' : oLoopMode ? 'oloop' : 'single';
    const initRadioEl = document.getElementById(`nav-mode-${initNavMode}`);
    if (initRadioEl) initRadioEl.checked = true;
    navModeEls.forEach(radio => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        runOrDeferBusySetting('nav-mode', () => {
          roundTripMode = radio.value === 'roundtrip';
          oLoopMode = radio.value === 'oloop';
          bumpRouteVersion();
          localStorage.setItem(LS_ROUNDTRIP_KEY, roundTripMode ? '1' : '0');
          localStorage.setItem(LS_OLOOP_KEY, oLoopMode ? '1' : '0');
          if (mapManager.waypoints.length >= 2) onWaypointsChanged(mapManager.waypoints);
          else historyRecord();
        });
      });
    });
  }

  // --- Unified interval mode (off / distance / pace) + activity wiring ---
  {
    const intervalModeEls = document.querySelectorAll('input[name="interval-mode"]');
    const segmentInputEl = document.getElementById('segment-interval-input');
    const speedActivityEl = document.getElementById('speed-activity-select');
    const activityRow = document.getElementById('pace-header-actions');
    const pacePanel = document.getElementById('pace-params-panel');

    // Derive initial mode from saved state
    const initMode = speedIntervalMode ? 'pace' : (segmentIntervalKm > 0 ? 'distance' : 'off');
    const initRadio = document.getElementById(`interval-mode-${initMode}`);
    if (initRadio) initRadio.checked = true;
    if (segmentInputEl) {
      segmentInputEl.value = String(segmentIntervalKm || 5);
      segmentInputEl.disabled = initMode !== 'distance';
    }
    if (speedActivityEl) speedActivityEl.value = speedActivity;

    const anyActive = initMode !== 'off';
    if (activityRow) activityRow.style.display = anyActive ? '' : 'none';
    if (pacePanel) pacePanel.style.display = anyActive ? '' : 'none';
    if (statTimeCard) statTimeCard.style.display = anyActive ? '' : 'none';
    syncPaceActivityApplicabilityUi();

    const applyIntervalMode = () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('interval-mode', applyIntervalMode);
        return;
      }
      const mode = Array.from(intervalModeEls).find(r => r.checked)?.value || 'off';
      const newActivity = speedActivityEl?.value || 'hiking';

      // Update mode state
      speedIntervalMode = mode === 'pace';
      const activityChanged = applySpeedActivity(newActivity);

      if (mode === 'distance') {
        const v = Math.min(100, Math.max(1, parseInt(segmentInputEl?.value) || 5));
        if (segmentInputEl) segmentInputEl.value = String(v);
        segmentIntervalKm = v;
      } else {
        segmentIntervalKm = 0;
      }
      if (!activityChanged) bumpPaceVersion();

      if (segmentInputEl) segmentInputEl.disabled = mode !== 'distance';

      const active = mode !== 'off';
      if (activityRow) activityRow.style.display = active ? '' : 'none';
      if (pacePanel) pacePanel.style.display = active ? '' : 'none';
      if (statTimeCard) statTimeCard.style.display = active ? '' : 'none';
      syncPaceActivityApplicabilityUi();

      updateFlatPlaceholder();

      localStorage.setItem(LS_SEGMENT_KEY, String(segmentIntervalKm));
      localStorage.setItem(LS_SPEED_MODE_KEY, speedIntervalMode ? '1' : '0');
      localStorage.setItem(LS_SPEED_ACTIVITY_KEY, speedActivity);

      updateTimeStat();
      updateIntermediateMarkers();
      renderWeatherPanel();
    };

    intervalModeEls.forEach(r => r.addEventListener('change', applyIntervalMode));
    if (speedActivityEl) speedActivityEl.addEventListener('change', applyIntervalMode);
    if (segmentInputEl) segmentInputEl.addEventListener('change', applyIntervalMode);
  }

  // Use the top-level updateFlatPlaceholder
  updateFlatPlaceholder();

  // Restore saved paceParams to UI inputs
  const paceUnitSelectRestored = paceUnitSelect;
  if (paceUnitSelectRestored) paceUnitSelectRestored.value = paceUnit;

  // Restore flat pace in the current unit
  if (paceFlatInput) {
    const storedKmh = paceParams.flatPaceKmH;
    paceFlatInput.value = storedKmh != null ? String(kmhToDisplay(storedKmh)) : '';
  }
  if (paceBodyWeight) paceBodyWeight.value = paceParams.bodyWeightKg ?? 70;
  if (pacePackWeight) pacePackWeight.value = paceParams.packWeightKg ?? 0;
  if (paceFatigueLevelEl) paceFatigueLevelEl.value = paceParams.fatigueLevel ?? 'general';
  if (paceRestEvery) paceRestEvery.value = paceParams.restEveryH ?? 1.0;
  if (paceRestMinutes) paceRestMinutes.value = paceParams.restMinutes ?? 10;

  // Show/hide pace-rest-row: hide only when fatigue is fully disabled
  const applyFatigueToggle = () => {
    syncPaceActivityApplicabilityUi();
  };
  applyFatigueToggle();

  // Show/hide panel based on current speed mode state
  if (paceParamsPanel) paceParamsPanel.style.display = (speedIntervalMode || segmentIntervalKm > 0) ? '' : 'none';
  syncPaceActivityApplicabilityUi();

  // Read all pace inputs → paceParams (always in km/h internally) → save → recalc
  const onPaceParamChange = () => {
    if (isRouteWeatherBusy()) {
      runOrDeferBusySetting('pace-params', onPaceParamChange);
      return;
    }
    const rawDisplay = parseFloat(paceFlatInput?.value);
    const flatKmh = (!isNaN(rawDisplay) && paceFlatInput?.value !== '')
      ? displayToKmh(rawDisplay)
      : null;
    paceParams = {
      ...paceParams,
      flatPaceKmH: flatKmh,
      bodyWeightKg: parseFloat(paceBodyWeight?.value) || 70,
      packWeightKg: parseFloat(pacePackWeight?.value) || 0,
      fatigueLevel: paceFatigueLevelEl?.value || 'general',
      restEveryH: parseFloat(paceRestEvery?.value) || 1.0,
      restMinutes: parseFloat(paceRestMinutes?.value) || 10,
    };
    syncCalibrationIntoPaceParams();
    localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(paceParams));
    bumpPaceVersion();
    updateFlatPlaceholder();
    applyFatigueToggle();
    updateTimeStat();
    updateIntermediateMarkers();
    renderWeatherPanel();
  };

  [paceFlatInput, paceBodyWeight, pacePackWeight, paceRestEvery, paceRestMinutes, paceFatigueLevelEl].forEach(el => {
    if (el) el.addEventListener('change', onPaceParamChange);
  });

  // --- Pace unit toggle (km/h ↔ 上河速度) ---
  if (paceUnitSelect) {
    paceUnitSelect.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('pace-unit', () => paceUnitSelect.dispatchEvent(new Event('change')));
        return;
      }
      const prevUnit = paceUnit;
      paceUnit = paceUnitSelect.value;
      localStorage.setItem(LS_PACE_UNIT_KEY, paceUnit);

      // Convert the currently displayed value to the new unit
      const rawDisplay = parseFloat(paceFlatInput?.value);
      if (!isNaN(rawDisplay) && paceFlatInput?.value !== '') {
        const kmh = displayToKmhForUnit(rawDisplay, prevUnit);
        const newDisplay = formatKmhForUnit(kmh);
        if (paceFlatInput) paceFlatInput.value = newDisplay;
      }

      updateFlatPlaceholder();
    });
  }

  // --- Per-segment mode checkbox ---
  const perSegmentEl = document.getElementById('pace-per-segment-enable');
  if (perSegmentEl) {
    perSegmentEl.checked = perSegmentMode;
    perSegmentEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('per-segment', () => perSegmentEl.dispatchEvent(new Event('change')));
        return;
      }
      perSegmentMode = perSegmentEl.checked;
      localStorage.setItem(LS_PER_SEGMENT_KEY, perSegmentMode ? '1' : '0');
      bumpPaceVersion();
      renderWeatherPanel();
    });
  }

  // --- Strict linear time checkbox ---
  const strictLinearEl = document.getElementById('strict-linear-enable');
  if (strictLinearEl) {
    strictLinearEl.checked = strictLinearMode;
    strictLinearEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('strict-linear', () => strictLinearEl.dispatchEvent(new Event('change')));
        return;
      }
      strictLinearMode = strictLinearEl.checked;
      localStorage.setItem(LS_STRICT_LINEAR_KEY, strictLinearMode ? '1' : '0');
      if (strictLinearMode) {
        if (speedIntervalMode) syncPaceWeatherTimes();
        else syncIntervalTimes();
      }
      renderWeatherPanel();
    });
  }

  // --- Import auto-sort (TSP) checkbox ---
  const importAutoSortEl = document.getElementById('import-auto-sort-enable');
  if (importAutoSortEl) {
    importAutoSortEl.checked = importAutoSortMode;
    importAutoSortEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('import-auto-sort-init', () => importAutoSortEl.dispatchEvent(new Event('change')));
        return;
      }
      importAutoSortMode = importAutoSortEl.checked;
      localStorage.setItem(LS_IMPORT_AUTO_SORT_KEY, importAutoSortMode ? '1' : '0');
    });
  }

  // --- Import auto-name checkbox ---
  const importAutoNameEl = document.getElementById('import-auto-name-enable');
  if (importAutoNameEl) {
    importAutoNameEl.checked = importAutoNameMode;
    importAutoNameEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('import-auto-name-init', () => importAutoNameEl.dispatchEvent(new Event('change')));
        return;
      }
      importAutoNameMode = importAutoNameEl.checked;
      localStorage.setItem(LS_IMPORT_AUTO_NAME_KEY, importAutoNameMode ? '1' : '0');
    });
  }

  // --- Personal pace calibration ---
  syncPaceCalibrationUI();
  if (paceCalibrationEnable) {
    paceCalibrationEnable.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('pace-calibration-enable', () => paceCalibrationEnable.dispatchEvent(new Event('change')));
        return;
      }
      paceCalibration.enabled = paceCalibrationEnable.checked;
      savePaceCalibration();
      syncPaceCalibrationUI();
      updateTimeStat();
      updateIntermediateMarkers();
      renderWeatherPanel();
    });
  }
  if (paceCalibrationPick && paceCalibrationFileInput) {
    paceCalibrationPick.addEventListener('click', () => paceCalibrationFileInput.click());
    paceCalibrationFileInput.addEventListener('change', async () => {
      await loadPaceCalibrationFiles(paceCalibrationFileInput.files);
      paceCalibrationFileInput.value = '';
    });
  }
  if (paceCalibrationCompute) {
    paceCalibrationCompute.addEventListener('click', computeAndApplyPaceCalibration);
  }
  if (paceCalibrationClear) {
    paceCalibrationClear.addEventListener('click', () => {
      if (isRouteWeatherBusy()) {
        showRouteWeatherBusyNotice();
        return;
      }
      paceCalibration = { enabled: false, factor: 1, tracks: [] };
      savePaceCalibration();
      syncPaceCalibrationUI();
      updateTimeStat();
      updateIntermediateMarkers();
      renderWeatherPanel();
      showNotification('已清除個人配速校正', 'success');
    });
  }


  // --- Collapsible sections toggle ---
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.collapsible');
      const body = section?.querySelector('.collapsible-body');
      if (body) {
        const collapsed = body.classList.toggle('collapsed');
        header.classList.toggle('collapsed', collapsed);
      }
    });
  });

  // --- Windy settings ---
  const windyLayerEl = document.getElementById('windy-layer-select');
  if (windyLayerEl) {
    windyLayerEl.value = windyLayer;
    windyLayerEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('windy-layer', () => windyLayerEl.dispatchEvent(new Event('change')));
        return;
      }
      windyLayer = windyLayerEl.value;
      localStorage.setItem(LS_WINDY_LAYER_KEY, windyLayer);
      refreshWindyLinks();
    });
  }
  const windyModelEl = document.getElementById('windy-model-select');
  if (windyModelEl) {
    windyModelEl.value = windyModel;
    windyModelEl.addEventListener('change', () => {
      if (isRouteWeatherBusy()) {
        runOrDeferBusySetting('windy-model', () => windyModelEl.dispatchEvent(new Event('change')));
        return;
      }
      windyModel = windyModelEl.value;
      localStorage.setItem(LS_WINDY_MODEL_KEY, windyModel);
      refreshWindyLinks();
    });
  }
  initWeatherCacheSettingsControls();

  updateFlatPlaceholder();

  // Replay a pending .melmap GPX that was stashed just before a state-restore
  // reload. Parse + applyImportedResult will also call saveImportedTrackSession,
  // so subsequent reloads take the normal restore path below.
  const pendingGpx = (() => {
    try { return localStorage.getItem(LS_PENDING_GPX_KEY); } catch { return null; }
  })();
  if (pendingGpx) {
    initialWeatherLoadPending = true;
    try { localStorage.removeItem(LS_PENDING_GPX_KEY); } catch (_) { }
    try {
      const { GpxExporter } = await ensureRouteExporters();
      const result = GpxExporter.parse(pendingGpx);
      await applyImportedResult(result);
    } catch (err) {
      console.error('Pending GPX replay failed:', err);
      initialWeatherLoadPending = false;
    }
  }

  // Restore imported-track session first — if present, it fully reconstructs
  // the track polyline + waypoints + intermediates without triggering routing.
  const savedTrackSession = (() => {
    try { return JSON.parse(localStorage.getItem(LS_IMPORTED_TRACK_KEY) || 'null'); }
    catch { return null; }
  })();
  const trackRestored = pendingGpx ? true : (savedTrackSession ? await restoreImportedTrack(savedTrackSession) : false);
  if (!pendingGpx && trackRestored) {
    initialWeatherLoadPending = true;
    autoFetchWeather({ force: false, initialLoad: true });
  }

  // Otherwise, fall back to normal waypoint-only restore (triggers route recalc).
  const savedWaypoints = trackRestored ? null : (() => {
    try { return JSON.parse(localStorage.getItem(LS_WAYPOINTS_KEY) || 'null'); }
    catch { return null; }
  })();
  if (savedWaypoints && savedWaypoints.length > 0) {
    initialWeatherLoadPending = true;
    skipAutoGeocode = true;
    // If a previously computed route still matches these waypoints, arm the
    // page-return shortcut so onWaypointsChanged redraws it instead of re-planning
    // (no routing/elevation network round-trips on return).
    pendingRouteRestore = loadMatchingRouteResult(savedWaypoints);
    const savedWaypointIds = getPersistedWaypointIds();
    mapManager.setWaypointsFromImport(savedWaypoints, savedWaypointIds.map(waypointId => ({ waypointId })));
    ensureWaypointIds(savedWaypointIds);
    skipAutoGeocode = false;
  } else if (!trackRestored && !savedView) {
    // No saved state at all — pan to user's location
    platform.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    })
      .then((pos) => {
        lastGpsLatLng = [pos.coords.latitude, pos.coords.longitude];
        mapManager.map.setView(lastGpsLatLng, 13);
      })
      .catch(() => { });
  }

  await installNativeFileOpenHandlers();

  // Keyword search (Nominatim forward-geocoding + direct lat,lng parser)
  initKeywordSearch();

  // Map action buttons
  document.getElementById('btn-fit-route')?.addEventListener('click', () => mapManager.fitToRoute());
  renderFavoritesList();
  updateRouteLibraryCurrent();

  // Seed undo/redo history with the restored state as the baseline.
  historyInit();
  isInitialLoad = false;

  // Re-open the 3D viewer if it was showing before a reload/app-resume — e.g.
  // the OS discarding a backgrounded webview when the user switches apps and
  // comes back — so the user lands back on the 3D page instead of home. When a
  // restore is pending, hold the initial loading screen up (instead of the
  // usual fixed 800ms) until it settles; otherwise the 2D home would flash on
  // screen — possibly for the whole route/weather wait timeout — before the 3D
  // view finally reopens, which is what actually reads as "coming back to the
  // tab dumped me on the home page".
  if (hasPendingTerrain3DRestore()) {
    const loadingCaption = loadingScreen?.querySelector('p[data-i18n]');
    if (loadingCaption) loadingCaption.textContent = '正在恢復 3D 地形…';
    // try/finally so the boot screen always gets released even if something
    // unexpected throws — restoreTerrain3DIfNeeded already catches its own
    // errors, but a stuck full-screen overlay is bad enough to defend twice.
    try {
      const restored = await restoreTerrain3DIfNeeded();
      if (!restored) showNotification('3D 地形恢復逾時，已返回主畫面', 'warning');
    } catch (err) {
      console.error('3D terrain restore failed:', err);
    } finally {
      loadingScreen.classList.add('hidden');
      setTimeout(() => {
        document.body.classList.remove('app-initial-loading');
        document.body.classList.add('app-loading-ready');
      }, INITIAL_LOADING_FADE_MS);
    }
  } else {
    setTimeout(() => {
      loadingScreen.classList.add('hidden');
      setTimeout(() => {
        document.body.classList.remove('app-initial-loading');
        document.body.classList.add('app-loading-ready');
      }, INITIAL_LOADING_FADE_MS);
    }, 800);
    restoreTerrain3DIfNeeded();
  }
}

// =========== Keyword Search (forward geocoding) ===========
/**
 * Parse "lat,lng" style input (also supports "N 24.5 E 121.5" loosely).
 * Returns [lat, lng] when both in valid ranges, otherwise null.
 */
function parseLatLngInput(q) {
  const m = q.match(/(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

function detectSearchInputLanguage(query) {
  const text = (query || '').trim();
  if (!text) return null;
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-TW';
  if (/[ßäö]/i.test(text)) return 'de';
  if (/[ñ¿¡]/i.test(text)) return 'es';
  if (/[âæçêëîïôœûÿ]/i.test(text)) return 'fr';
  if (/[ìò]/i.test(text)) return 'it';
  return null;
}

function countryLanguages(countryCode) {
  return COUNTRY_SEARCH_LANGUAGES[String(countryCode || '').toLowerCase()] || [];
}

async function getLanguagesForLatLng(latlng) {
  if (!latlng) return [];
  const [lat, lng] = latlng;
  const cc = await fetchViewCountryCode(lat, lng);
  return countryLanguages(cc);
}

async function getSearchAcceptLanguage(query, bounds) {
  const languages = [];
  const add = (value) => {
    if (!value || languages.includes(value)) return;
    languages.push(value);
  };
  const addMany = (values) => values.forEach(add);

  const inputLanguage = detectSearchInputLanguage(query);
  add(inputLanguage);
  add(getLanguage());

  if (bounds) {
    const center = bounds.getCenter();
    addMany(await getLanguagesForLatLng([center.lat, center.lng]));
  }

  addMany(await getLanguagesForLatLng(lastGpsLatLng || mapManager._mapCursorLatLng));
  if (!inputLanguage) add('en');

  return languages.join(',');
}

/**
 * Resolve the ISO country code at (lat, lng) via Nominatim reverse-geocoding.
 * Cached on a ~11 km grid so a panning user doesn't trigger repeated lookups.
 */
const _viewCountryCache = new Map();
async function fetchViewCountryCode(lat, lng) {
  const k = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  if (_viewCountryCache.has(k)) return _viewCountryCache.get(k);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`,
      {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'MappingElf/1.0' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!r.ok) { _viewCountryCache.set(k, null); return null; }
    const data = await r.json();
    const cc = data?.address?.country_code || null;
    _viewCountryCache.set(k, cc);
    return cc;
  } catch {
    _viewCountryCache.set(k, null);
    return null;
  }
}

/**
 * Two-tier keyword search, sorted by category priority, then distance from center:
 * Priority: 自然景觀 (natural/waterway) > 景點 (tourism/historic) > 地標 (place/boundary/man_made)
 *          > 建築 (building) > 店家 (shop/amenity) > 其他
 */
async function searchByKeyword(query, bounds) {
  const dedup = [];
  const searchAcceptLanguage = await getSearchAcceptLanguage(query, bounds);

  const getSearchPriority = (it) => {
    const c = it.class || '';
    if (c === 'natural' || c === 'waterway') return 1;
    if (c === 'tourism' || c === 'historic') return 2;
    if (c === 'man_made') return 3; // Landmarks
    if (c === 'building') return 4;
    if (c === 'shop' || c === 'amenity') return 5;
    if (c === 'place' || c === 'boundary') return 7; // Administrative regions
    return 6; // Others
  };


  const pushNomItems = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      const lat = parseFloat(it.lat);
      const lon = parseFloat(it.lon);
      const name = it.name || (it.display_name?.split(',')[0]) || '';
      const head = name.split(',')[0];
      if (!head) continue;

      const dup = dedup.find(d =>
        d.name.split(',')[0] === head &&
        haversineDistance([d.lat, d.lon], [lat, lon]) < 30
      );
      if (!dup) {
        dedup.push({
          lat, lon, name,
          display_name: it.display_name,
          class: it.class,
          type: it.type,
          _priority: getSearchPriority(it)
        });
      }
    }
  };

  const fetchNom = async (url) => {
    const r = await fetch(url, {
      headers: { 'Accept-Language': searchAcceptLanguage, 'User-Agent': 'MappingElf/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? r.json() : null;
  };

  // Tier 1: same-country (preference layer based on view center)
  const center = bounds.getCenter();
  const cc = await fetchViewCountryCode(center.lat, center.lng);
  if (cc) {
    try {
      const items = await fetchNom(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=25&addressdetails=1&countrycodes=${cc}`
      );
      pushNomItems(items);
    } catch (err) {
      console.warn('Country-scoped search failed:', err);
    }
  }

  // Tier 2: global fallback
  if (dedup.length === 0) {
    try {
      const items = await fetchNom(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=25&addressdetails=1`
      );
      pushNomItems(items);
    } catch (err) {
      console.warn('Global search failed:', err);
    }
  }

  // Sort by priority, then distance from view center
  const c = [center.lat, center.lng];
  for (const it of dedup) it._dist = haversineDistance(c, [it.lat, it.lon]);
  dedup.sort((a, b) => {
    if (a._priority !== b._priority) return a._priority - b._priority;
    return a._dist - b._dist;
  });

  return dedup;
}



function expandSearchSection() {
  const body = document.getElementById('search-body');
  const header = document.getElementById('search-toggle-header');
  if (body?.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    header?.classList.remove('collapsed');
  }
}

function renderSearchResults(items, resultsEl) {
  const frozen = !!importedTrackMode;
  resultsEl.innerHTML = '';
  expandSearchSection();
  if (!items.length) {
    resultsEl.innerHTML = '<div class="search-result-empty">查無結果</div>';
    resultsEl.style.display = '';
    return;
  }
  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    const lat = parseFloat(it.lat), lng = parseFloat(it.lon);
    const name = it.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const distLabel = Number.isFinite(it._dist)
      ? (it._dist < 1000 ? `${Math.round(it._dist)} m` : `${(it._dist / 1000).toFixed(1)} km`)
      : '';
    const coordLine = distLabel
      ? `${lat.toFixed(5)}, ${lng.toFixed(5)} · ${distLabel}`
      : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const safeName = _escapeHtml(name);
    const safeCoordLine = _escapeHtml(coordLine);
    row.innerHTML = `
      <div class="search-result-text">
        <div class="search-result-name" title="${safeName}">${safeName}</div>
        <div class="search-result-coord clickable-coords" data-coords="${lat.toFixed(5)}, ${lng.toFixed(5)}" title="點擊複製座標">${safeCoordLine}</div>
      </div>
      <button class="search-result-add" title="加入為航點" ${frozen ? 'disabled' : ''}>+ 航點</button>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('search-result-add')) return;
      mapManager.map.setView([lat, lng], Math.max(mapManager.map.getZoom(), 14));
    });
    row.querySelector('.search-result-add').addEventListener('click', (e) => {
      e.stopPropagation();
      if (frozen) {
        showImportedTrackEditNotice();
        return;
      }
      // Store the search result name as a custom name before adding to avoid redundant geocoding
      // and ensure the specific place name found during search is preserved.
      if (it.name || it.display_name) {
        saveCustomName(lat, lng, it.name || it.display_name.split(',')[0]);
      }
      mapManager.addWaypoint(lat, lng);
      mapManager.map.setView([lat, lng], Math.max(mapManager.map.getZoom(), 14));
      showNotification('已加入航點', 'success');
    });
    resultsEl.appendChild(row);
  });
  resultsEl.style.display = '';
}

function initKeywordSearch() {
  const input = document.getElementById('search-input');
  const btn = document.getElementById('btn-search');
  const resultsEl = document.getElementById('search-results');
  if (!input || !btn || !resultsEl) return;

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) { resultsEl.style.display = 'none'; return; }
    expandSearchSection();

    // Direct coord input — skip network
    const coords = parseLatLngInput(q);
    if (coords) {
      renderSearchResults([{
        lat: coords[0], lon: coords[1],
        display_name: `座標: ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`,
      }], resultsEl);
      return;
    }

    resultsEl.innerHTML = '<div class="search-result-loading">搜尋中…</div>';
    resultsEl.style.display = '';
    try {
      const items = await searchByKeyword(q, mapManager.map.getBounds());
      renderSearchResults(items, resultsEl);
    } catch (err) {
      console.error('Keyword search failed:', err);
      resultsEl.innerHTML = '<div class="search-result-empty">搜尋失敗,請稍後再試</div>';
    }
  };

  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    else if (e.key === 'Escape') { resultsEl.style.display = 'none'; }
  });

  refreshKeywordSearchResults = () => {
    const hasVisibleResults = resultsEl.style.display !== 'none';
    if (hasVisibleResults && input.value.trim()) doSearch();
  };

  const gmapsLink = document.getElementById('search-gmaps-link');
  if (gmapsLink) {
    const updateGmapsHref = () => {
      const q = input.value.trim();
      if (q) {
        gmapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
      } else {
        const c = mapManager.map.getCenter();
        gmapsLink.href = `https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
      }
    };
    updateGmapsHref();
    input.addEventListener('input', updateGmapsHref);
    mapManager.map.on('moveend zoomend', updateGmapsHref);
  }

  const coordInput = document.getElementById('search-coord-input');
  const coordBtn = document.getElementById('btn-coord-go');
  if (coordInput && coordBtn) {
    const goToCoord = () => {
      const coords = parseLatLngInput(coordInput.value.trim());
      if (!coords) {
        showNotification('座標格式錯誤,請輸入「緯度, 經度」', 'warning');
        return;
      }
      const [lat, lng] = coords;
      mapManager.map.setView([lat, lng], Math.max(mapManager.map.getZoom(), 14));
    };
    coordBtn.addEventListener('click', goToCoord);
    coordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); goToCoord(); }
    });
  }
}

function resetToDefaults() {
  RESET_STATE_KEYS.forEach(key => localStorage.removeItem(key));
  window.location.reload();
}

init();
