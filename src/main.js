/**
 * Mapping Elf — Main Entry
 */
import 'leaflet/dist/leaflet.css';
import './styles/main.css';

import { MapManager } from './modules/mapManager.js';
import { RouteEngine } from './modules/routeEngine.js';
import { ElevationProfile } from './modules/elevationProfile.js';
import { GpxExporter } from './modules/gpxExporter.js';
import { WeatherService } from './modules/weatherService.js';
import { OfflineManager } from './modules/offlineManager.js';
import { formatDistance, formatElevation, formatCoords, showNotification, debounce, haversineDistance } from './modules/utils.js';

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

const LS_SEGMENT_KEY = 'mappingElf_segmentKm';
let segmentIntervalKm = parseInt(localStorage.getItem(LS_SEGMENT_KEY) || '0') || 0;

const LS_ROUNDTRIP_KEY = 'mappingElf_roundTrip';
let roundTripMode = localStorage.getItem(LS_ROUNDTRIP_KEY) === '1';

let currentRouteWaypoints = []; // Effective waypoints used for routing (may be expanded for round-trip)

// =========== Initialize Modules ===========
const routeEngine = new RouteEngine();
const weatherService = new WeatherService();
const offlineManager = new OfflineManager();
const mapManager = new MapManager('map', onWaypointsChanged);

const elevationProfile = new ElevationProfile(
  'elevation-chart',
  'chart-empty',
  (lat, lng) => mapManager.showHoverMarker(lat, lng),
  (colIdx) => highlightWeatherColumn(colIdx)
);

// When user clicks an alternative route on the map
mapManager.onRouteSelect = (idx) => selectAlternative(idx);

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
  mapManager.showHoverMarker(lat, lng);
};

// =========== DOM Elements ===========
const loadingScreen = document.getElementById('loading-screen');
const sidePanel = document.getElementById('side-panel');
const waypointList = document.getElementById('waypoint-list');
const alternativesSection = document.getElementById('alternatives-section');
const alternativesList = document.getElementById('alternatives-list');
const altCount = document.getElementById('alt-count');

const btnTogglePanel = document.getElementById('btn-toggle-panel');
const btnMyLocation = document.getElementById('btn-my-location');
const btnExportGpx = document.getElementById('btn-export-gpx');
const btnImportGpx = document.getElementById('btn-import-gpx');
const btnClearRoute = document.getElementById('btn-clear-route');
const btnUndo = document.getElementById('btn-undo');
const btnClearCache = document.getElementById('btn-clear-cache');
const gpxFileInput = document.getElementById('gpx-file-input');

const segmentIntervalEnable = document.getElementById('segment-interval-enable');
const segmentIntervalInput  = document.getElementById('segment-interval-input');

const btnDownloadMap = document.getElementById('btn-download-map');
const btnDownloadRoute = document.getElementById('btn-download-route');
const progressContainer = document.getElementById('download-progress-container');
const progressText = document.getElementById('download-progress-text');
const progressFill = document.getElementById('download-progress-fill');
const btnFetchWeather = document.getElementById('btn-fetch-weather');

const statDistance = document.getElementById('stat-distance');
const statAscent = document.getElementById('stat-ascent');
const statDescent = document.getElementById('stat-descent');
const statMaxElev = document.getElementById('stat-max-elev');

const layerBtns = document.querySelectorAll('.layer-btn');
const routeModeRadios = document.querySelectorAll('input[name="route-mode"]');

// =========== Event Listeners ===========

btnTogglePanel.addEventListener('click', () => sidePanel.classList.toggle('open'));

btnMyLocation.addEventListener('click', () => {
  mapManager.goToMyLocation();
  showNotification('正在定位...', 'info');
});

btnExportGpx.addEventListener('click', exportGpx);
btnImportGpx.addEventListener('click', () => gpxFileInput.click());
gpxFileInput.addEventListener('change', importGpx);

btnClearRoute.addEventListener('click', () => {
  mapManager.clearWaypoints();
  mapManager.clearIntermediateMarkers();
  elevationProfile.clear();
  resetStats();
  weatherPoints = [];
  currentRouteCoords = [];
  currentElevations = [];
  const _wc = document.getElementById('weather-table-container');
  if (_wc) _wc.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「取得天氣」</p></div>';
  hideAlternatives();
  showNotification('路線已清除', 'info');
});

btnUndo.addEventListener('click', () => mapManager.removeLastWaypoint());

btnDownloadMap.addEventListener('click', async () => {
  const layerInfo = mapManager.getCurrentLayerInfo();
  if (!layerInfo) return;
  const bounds = mapManager.map.getBounds();

  progressContainer.classList.remove('hidden');
  btnDownloadMap.disabled = true;
  if (btnDownloadRoute) btnDownloadRoute.disabled = true;

  try {
    await offlineManager.downloadArea(bounds, layerInfo, (current, total) => {
      const pct = Math.round((current / total) * 100) || 0;
      progressText.textContent = `${pct}% (${current}/${total})`;
      progressFill.style.width = `${pct}%`;
    });
    showNotification('畫面地圖下載完成', 'success');
  } catch (err) {
    showNotification(err.message || '地圖下載失敗', 'error');
  } finally {
    progressContainer.classList.add('hidden');
    btnDownloadMap.disabled = false;
    if (btnDownloadRoute) btnDownloadRoute.disabled = false;
    progressText.textContent = '0%';
    progressFill.style.width = '0%';
  }
});

if (btnDownloadRoute) {
  btnDownloadRoute.addEventListener('click', async () => {
    if (currentRouteCoords.length < 2) {
      showNotification('請先建立路線', 'warning');
      return;
    }
    const layerInfo = mapManager.getCurrentLayerInfo();
    if (!layerInfo) return;

    progressContainer.classList.remove('hidden');
    btnDownloadMap.disabled = true;
    btnDownloadRoute.disabled = true;

    try {
      await offlineManager.downloadRoute(currentRouteCoords, layerInfo, (current, total) => {
        const pct = Math.round((current / total) * 100) || 0;
        progressText.textContent = `${pct}% (${current}/${total})`;
        progressFill.style.width = `${pct}%`;
      });
      showNotification('路線地圖下載完成', 'success');
    } catch (err) {
      showNotification(err.message || '地圖下載失敗', 'error');
    } finally {
      progressContainer.classList.add('hidden');
      btnDownloadMap.disabled = false;
      btnDownloadRoute.disabled = false;
      progressText.textContent = '0%';
      progressFill.style.width = '0%';
    }
  });
}

btnClearCache.addEventListener('click', async () => {
  await offlineManager.clearCache();
  showNotification('快取已清除', 'success');
});

layerBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    mapManager.switchLayer(btn.dataset.layer);
    layerBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

routeModeRadios.forEach((radio) => {
  radio.addEventListener('change', (e) => {
    routeEngine.setMode(e.target.value);
    if (mapManager.waypoints.length >= 2) {
      onWaypointsChanged(mapManager.waypoints);
    }
  });
});


// =========== Core Logic ===========

async function onWaypointsChanged(waypoints) {
  // Update UI list immediately for responsive feel
  updateWaypointList(waypoints);

  if (waypoints.length < 2) {
    mapManager.clearRoute();
    elevationProfile.clear();
    resetStats();
    hideAlternatives();
    currentRouteCoords = [];
    currentElevations = [];
    allAlternatives = [];
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
  
  isProcessing = true;
  pendingUpdate = false;

  try {
    showNotification('規劃最佳路徑中...', 'info', 1500);

    // Clear stale weather icons while recalculating
    mapManager.clearWaypointWeather();

    // Get all alternative routes (with elevation already fetched)
    const routeWaypoints = roundTripMode && waypoints.length >= 2
      ? [...waypoints, ...waypoints.slice(0, -1).reverse()]
      : waypoints;
    currentRouteWaypoints = routeWaypoints;
    allAlternatives = await routeEngine.getAlternativeRoutes(routeWaypoints);

    if (allAlternatives.length > 0) {
      // Draw all routes on map with gradient segment coloring
      mapManager.drawMultipleRoutes(allAlternatives, 0, currentRouteWaypoints);

      // Show alternatives panel
      renderAlternatives(allAlternatives, 0);

      // Select the best route by default
      selectAlternative(0);

      const altMsg = allAlternatives.length > 1
        ? `找到 ${allAlternatives.length} 組建議路徑`
        : '已規劃最佳路徑';
      showNotification(altMsg, 'success', 2000);
    } else {
      showNotification('找不到合適路徑', 'warning');
    }
  } catch (err) {
    console.error('Route processing error:', err);
    showNotification('路徑計算失敗', 'error');
  }

  isProcessing = false;
  
  if (pendingUpdate) {
    debouncedCalculateRoute(mapManager.waypoints);
  }
}, 500);

/**
 * Select a specific alternative route
 */
function selectAlternative(index) {
  if (index >= allAlternatives.length) return;

  selectedAltIndex = index;
  const route = allAlternatives[index];

  currentRouteCoords = route.coords;
  currentElevations = route.elevations;

  // Update map selection - set triggeredByUI to true to prevent recursion
  mapManager.selectRoute(allAlternatives, index, true);

  // Update elevation chart with pre-fetched data and waypoint gradient info
  elevationProfile.updateWithData(
    route.sampledCoords,
    route.elevations,
    currentRouteWaypoints
  );

  // Update stats from pre-calculated route data
  statDistance.textContent = formatDistance(route.distance);
  statAscent.textContent = formatElevation(route.ascent);
  statDescent.textContent = formatElevation(route.descent);
  statMaxElev.textContent = formatElevation(route.maxElev);

  // Update card selection highlight
  renderAlternatives(allAlternatives, index);

  // Update intermediate km-interval markers
  updateIntermediateMarkers();

  // Render weather panel placeholder cards for the new route
  renderWeatherPanel();
}

/**
 * Render alternative route cards in the side panel
 */
function renderAlternatives(routes, selectedIdx) {
  if (!routes || routes.length === 0) {
    hideAlternatives();
    return;
  }

  alternativesSection.style.display = '';
  altCount.textContent = `${routes.length} 條`;

  alternativesList.innerHTML = routes.map((r, i) => `
    <div class="alt-card ${i === selectedIdx ? 'selected' : ''}" data-color="${i}" data-index="${i}">
      <div class="alt-card-header">
        <span class="alt-color-dot"></span>
        <span class="alt-card-label">${r.label}</span>
        ${i === 0 ? '<span class="alt-badge">推薦</span>' : ''}
      </div>
      <div class="alt-stats">
        <div class="alt-stat">
          <span class="alt-stat-label">距離</span>
          <span class="alt-stat-value">${formatDistance(r.distance)}</span>
        </div>
        <div class="alt-stat">
          <span class="alt-stat-label">爬升</span>
          <span class="alt-stat-value">${formatElevation(r.ascent)}</span>
        </div>
        <div class="alt-stat">
          <span class="alt-stat-label">下降</span>
          <span class="alt-stat-value">${formatElevation(r.descent)}</span>
        </div>
      </div>
    </div>
  `).join('');

  // Bind click events
  alternativesList.querySelectorAll('.alt-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      selectAlternative(idx);
    });
  });
}

function hideAlternatives() {
  alternativesSection.style.display = 'none';
  alternativesList.innerHTML = '';
  allAlternatives = [];
  selectedAltIndex = 0;
}

function updateWaypointList(waypoints) {
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
      return `
        <div class="waypoint-item">
          <span class="wp-index ${cls}">${i + 1}</span>
          <span class="wp-coords">${formatCoords(wp[0], wp[1])}</span>
          <div class="wp-actions">
            <button class="wp-action wp-up" data-index="${i}" title="向上移" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="wp-action wp-down" data-index="${i}" title="向下移" ${i === waypoints.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="wp-action wp-remove" data-index="${i}" title="移除">×</button>
          </div>
        </div>`;
    })
    .join('');

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
}

function resetStats() {
  statDistance.textContent = '—';
  statAscent.textContent = '—';
  statDescent.textContent = '—';
  statMaxElev.textContent = '—';
}

// =========== GPX Export / Import ===========

function exportGpx() {
  if (currentRouteCoords.length === 0) {
    showNotification('請先建立路線', 'warning');
    return;
  }
  const segDates = collectSegmentDates();
  const gpx = GpxExporter.generate(
    mapManager.waypoints,
    currentRouteCoords,
    currentElevations,
    'Mapping Elf Track',
    segDates
  );
  GpxExporter.download(gpx);
  showNotification('GPX 檔案已匯出', 'success');
}

/**
 * Collect per-waypoint date/time from weather table columns for GPX export.
 */
function collectSegmentDates() {
  const container = document.getElementById('weather-table-container');
  const result = mapManager.waypoints.map(() => null);
  weatherPoints.forEach((pt, colIdx) => {
    if (!pt.isWaypoint || pt.wpIndex === undefined) return;
    const th = container?.querySelector(`.wt-col-head[data-idx="${colIdx}"]`);
    if (!th) return;
    const date = th.querySelector('.wt-date-input')?.value || '';
    const h = th.querySelector('.wt-time-select')?.value;
    const time = h != null ? `${String(h).padStart(2,'0')}:00` : '';
    result[pt.wpIndex] = { date, time };
  });
  return result;
}

function importGpx(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const result = GpxExporter.parse(evt.target.result);

      // Apply per-waypoint dates to table columns after panel renders
      if (result.segmentDates?.some(d => d?.date || d?.time)) {
        // Store for application after renderWeatherPanel() is called
        window._pendingGpxDates = result.segmentDates;
      }

      if (result.waypoints.length > 0) {
        mapManager.setWaypointsFromImport(result.waypoints);
        showNotification(`已匯入 ${result.waypoints.length} 個航點`, 'success');
      }
      if (result.trackPoints.length > 0) {
        const coords = result.trackPoints.map((p) => [p.lat, p.lon]);
        mapManager.drawRoute(coords);
        currentRouteCoords = coords;
        currentElevations = result.trackPoints.map((p) => p.ele);
        elevationProfile.update(coords);
      }
    } catch (err) {
      showNotification('GPX 檔案解析失敗', 'error');
      console.error(err);
    }
  };
  reader.readAsText(file);
  gpxFileInput.value = '';
}

// =========== Weather Panel ===========

const WEATHER_ROWS = [
  { key: 'weather',       label: '天氣'   },
  { key: 'temp',          label: '溫度'   },
  { key: 'tempRange',     label: '高/低'  },
  { key: 'feelsLike',     label: '體感'   },
  { key: 'humidity',      label: '濕度'   },
  { key: 'dewPoint',      label: '露點'   },
  { key: 'precipitation', label: '降水'   },
  { key: 'precipProb',    label: '機率'   },
  { key: 'cloudCover',    label: '雲量'   },
  { key: 'windSpeed',     label: '風速'   },
  { key: 'windGust',      label: '陣風'   },
  { key: 'uvIndex',       label: 'UV'     },
  { key: 'visibility',    label: '能見度' },
  { key: 'sunshineHours', label: '日照'   },
  { key: 'radiation',     label: '輻射'   },
  { key: 'sunrise',       label: '日出'   },
  { key: 'sunset',        label: '日落'   },
];

let weatherPoints = [];
const LS_WEATHER_KEY = 'mappingElf_weather';

function getCellValue(data, key) {
  if (!data) return '—';
  const v = (a, b) => a != null ? a : (b != null ? b : '—');
  switch (key) {
    case 'weather':       return `${data.weatherIcon || ''} ${data.weatherDesc || '—'}`.trim();
    case 'temp':          return v(data.temp, data.tempMax);
    case 'tempRange':     return (data.tempMax || data.tempMin) ? `${v(data.tempMax,'—')} / ${v(data.tempMin,'—')}` : '—';
    case 'feelsLike':     return v(data.feelsLike, '—');
    case 'humidity':      return v(data.humidity, '—');
    case 'dewPoint':      return v(data.dewPoint, '—');
    case 'precipitation': return v(data.precipitation, v(data.precipitationSum, '—'));
    case 'precipProb':    return v(data.precipProb, v(data.precipProbMax, '—'));
    case 'cloudCover':    return v(data.cloudCover, '—');
    case 'windSpeed':     return v(data.windSpeed, v(data.windSpeedMax, '—'));
    case 'windGust':      return v(data.windGust, v(data.windGustMax, '—'));
    case 'uvIndex':       return v(data.uvIndex, v(data.uvIndexMax, '—'));
    case 'visibility':    return v(data.visibility, '—');
    case 'sunshineHours': return v(data.sunshineHours, '—');
    case 'radiation':     return v(data.radiation, '—');
    case 'sunrise':       return v(data.sunrise, '—');
    case 'sunset':        return v(data.sunset, '—');
    default:              return '—';
  }
}

function saveWeatherSettings() {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const cols = [];
  container.querySelectorAll('.wt-col-head').forEach(th => {
    cols.push({
      date: th.querySelector('.wt-date-input')?.value || '',
      hour: th.querySelector('.wt-time-select')?.value ?? '8',
    });
  });
  localStorage.setItem(LS_WEATHER_KEY, JSON.stringify({ cols }));
}

function loadWeatherSettings() {
  try { return JSON.parse(localStorage.getItem(LS_WEATHER_KEY) || 'null'); }
  catch { return null; }
}

function shiftAllDates(deltaDays, deltaHours) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  container.querySelectorAll('.wt-col-head').forEach(th => {
    const dateInput = th.querySelector('.wt-date-input');
    const timeSelect = th.querySelector('.wt-time-select');
    if (!dateInput || !timeSelect) return;
    const base = dateInput.value ? new Date(dateInput.value + 'T00:00:00') : new Date();
    let hour = parseInt(timeSelect.value) || 0;
    hour += deltaHours;
    const dayCarry = Math.floor(hour / 24);
    hour = ((hour % 24) + 24) % 24;
    base.setDate(base.getDate() + deltaDays + dayCarry);
    const y = base.getFullYear();
    const mo = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    dateInput.value = `${y}-${mo}-${d}`;
    timeSelect.value = String(hour);
  });
  saveWeatherSettings();
}

const LS_PANEL_HEIGHT_KEY = 'mappingElf_panelHeight';

function initWeatherControls() {
  if (btnFetchWeather) btnFetchWeather.addEventListener('click', fetchAllWeatherData);
  document.getElementById('btn-date-minus-day') ?.addEventListener('click', () => shiftAllDates(-1, 0));
  document.getElementById('btn-date-plus-day')  ?.addEventListener('click', () => shiftAllDates(+1, 0));
  document.getElementById('btn-date-minus-hour')?.addEventListener('click', () => shiftAllDates(0, -1));
  document.getElementById('btn-date-plus-hour') ?.addEventListener('click', () => shiftAllDates(0, +1));

  const panel = document.getElementById('bottom-panel');
  const handle = document.getElementById('bp-resize-handle');
  if (!panel) return;

  // Restore saved height
  const savedH = parseInt(localStorage.getItem(LS_PANEL_HEIGHT_KEY));
  if (savedH > 0) {
    const clamped = Math.max(56, Math.min(Math.round(window.innerHeight * 0.85), savedH));
    panel.style.height = `${clamped}px`;
    document.documentElement.style.setProperty('--bottom-panel-height', `${clamped}px`);
  } else {
    requestAnimationFrame(() => {
      const h = panel.offsetHeight;
      if (h > 0) document.documentElement.style.setProperty('--bottom-panel-height', `${h}px`);
    });
  }

  // Sync CSS var whenever panel naturally resizes (content changes)
  new ResizeObserver(entries => {
    const h = Math.round(entries[0]?.contentRect.height || 0);
    if (h > 0 && !panel._resizing)
      document.documentElement.style.setProperty('--bottom-panel-height', `${h}px`);
  }).observe(panel);

  if (!handle) return;

  // --- Drag-to-resize ---
  const MIN_H = 56;
  const applyHeight = (clientY) => {
    const h = Math.max(MIN_H, Math.min(Math.round(window.innerHeight * 0.85), window.innerHeight - clientY));
    panel.style.height = `${h}px`;
    document.documentElement.style.setProperty('--bottom-panel-height', `${h}px`);
  };

  // Mouse
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    panel._resizing = true;
    handle.classList.add('dragging');
    const onMove = (ev) => applyHeight(ev.clientY);
    const onUp = () => {
      panel._resizing = false;
      handle.classList.remove('dragging');
      localStorage.setItem(LS_PANEL_HEIGHT_KEY, panel.offsetHeight);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch
  handle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    panel._resizing = true;
    handle.classList.add('dragging');
    const onMove = (ev) => applyHeight(ev.touches[0].clientY);
    const onEnd = () => {
      panel._resizing = false;
      handle.classList.remove('dragging');
      localStorage.setItem(LS_PANEL_HEIGHT_KEY, panel.offsetHeight);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, { passive: false });
}

/**
 * Compute lat/lng points spaced every intervalKm along the route.
 * Returns [{lat, lng, cumDistM}]
 */
function computeIntermediatePoints(coords, intervalKm) {
  const intervalM = intervalKm * 1000;
  const result = [];
  let cumDist = 0;
  let nextMarkM = intervalM;

  for (let i = 1; i < coords.length; i++) {
    const segDist = haversineDistance(coords[i - 1], coords[i]);
    while (nextMarkM <= cumDist + segDist + 1e-6) {
      const frac = segDist > 0 ? (nextMarkM - cumDist) / segDist : 0;
      result.push({
        lat: coords[i - 1][0] + frac * (coords[i][0] - coords[i - 1][0]),
        lng: coords[i - 1][1] + frac * (coords[i][1] - coords[i - 1][1]),
        cumDistM: nextMarkM,
      });
      nextMarkM += intervalM;
    }
    cumDist += segDist;
  }
  return result;
}

function updateIntermediateMarkers() {
  if (segmentIntervalKm > 0 && currentRouteCoords.length > 1) {
    mapManager.setIntermediateMarkers(
      computeIntermediatePoints(currentRouteCoords, segmentIntervalKm)
    );
  } else {
    mapManager.clearIntermediateMarkers();
  }
}

function buildWeatherPoints() {
  const wps = mapManager.waypoints;
  const coords = currentRouteCoords;
  if (wps.length === 0) return [];

  // --- Compute cumulative distances for waypoints along the route ---
  let totalDistM = 0;
  const wpCumDist = [];
  if (coords.length > 1) {
    for (let j = 1; j < coords.length; j++) totalDistM += haversineDistance(coords[j - 1], coords[j]);
    let searchStart = 0;
    for (let i = 0; i < wps.length; i++) {
      let minDist = Infinity, minIdx = searchStart;
      const end = Math.min(coords.length, searchStart + 600);
      for (let j = searchStart; j < end; j++) {
        const d = haversineDistance(wps[i], coords[j]);
        if (d < minDist) { minDist = d; minIdx = j; }
      }
      let cum = 0;
      for (let j = 1; j <= minIdx; j++) cum += haversineDistance(coords[j - 1], coords[j]);
      wpCumDist.push(cum);
      searchStart = minIdx;
    }
  } else {
    wps.forEach((_, i) => wpCumDist.push(i));
  }

  const all = [];

  // Add actual waypoints
  for (let i = 0; i < wps.length; i++) {
    const label = i === 0 ? '起點' : i === wps.length - 1 ? '終點' : `航點 ${i + 1}`;
    all.push({ label, lat: wps[i][0], lng: wps[i][1], isWaypoint: true, wpIndex: i, _cum: wpCumDist[i] });
  }

  if (segmentIntervalKm > 0 && coords.length > 1) {
    // Add km-interval intermediate points
    const intermediates = computeIntermediatePoints(coords, segmentIntervalKm);
    intermediates.forEach((pt) => {
      const kmLabel = (pt.cumDistM / 1000 % 1 === 0)
        ? `${pt.cumDistM / 1000 | 0} km`
        : `${(pt.cumDistM / 1000).toFixed(1)} km`;
      all.push({ label: kmLabel, lat: pt.lat, lng: pt.lng, isWaypoint: false, _cum: pt.cumDistM });
    });
  } else if (coords.length > 0) {
    // Fallback: auto-midpoints between each waypoint pair
    const wpIndices = [];
    let searchStart = 0;
    for (let i = 0; i < wps.length; i++) {
      let minDist = Infinity, minIdx = searchStart;
      const end = Math.min(coords.length, searchStart + 600);
      for (let j = searchStart; j < end; j++) {
        const d = haversineDistance(wps[i], coords[j]);
        if (d < minDist) { minDist = d; minIdx = j; }
      }
      wpIndices.push(minIdx);
      searchStart = minIdx;
    }
    for (let i = 0; i < wps.length - 1; i++) {
      const si = wpIndices[i];
      const ei = wpIndices[i + 1] ?? coords.length - 1;
      const mc = coords[Math.max(0, Math.min(Math.floor((si + ei) / 2), coords.length - 1))];
      const labelA = i === 0 ? '起點' : `航點 ${i + 1}`;
      const labelB = (i + 1 === wps.length - 1) ? '終點' : `航點 ${i + 2}`;
      const midCum = (wpCumDist[i] + wpCumDist[i + 1]) / 2;
      all.push({ label: `${labelA}→${labelB}`, lat: mc[0], lng: mc[1], isWaypoint: false, _cum: midCum });
    }
  }

  // Sort by position along route
  all.sort((a, b) => a._cum - b._cum);
  return all;
}

function computeWeatherPointPositions() {
  const coords = currentRouteCoords;
  const N = weatherPoints.length;
  if (coords.length < 2 || N === 0) return weatherPoints.map((_, i) => N <= 1 ? 0.5 : i / (N - 1));

  let totalDist = 0;
  for (let j = 1; j < coords.length; j++) totalDist += haversineDistance(coords[j-1], coords[j]);
  if (totalDist === 0) return weatherPoints.map((_, i) => N <= 1 ? 0.5 : i / (N - 1));

  return weatherPoints.map(pt => {
    let minD = Infinity, ci = 0;
    for (let j = 0; j < coords.length; j++) {
      const d = haversineDistance([pt.lat, pt.lng], coords[j]);
      if (d < minD) { minD = d; ci = j; }
    }
    let cum = 0;
    for (let j = 1; j <= ci; j++) cum += haversineDistance(coords[j-1], coords[j]);
    return cum / totalDist;
  });
}

function renderWeatherPanel() {
  weatherPoints = buildWeatherPoints();
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  if (weatherPoints.length === 0) {
    container.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「取得天氣」</p></div>';
    return;
  }

  const saved = loadWeatherSettings();
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const nowHour = now.getHours();
  const N = weatherPoints.length;

  // Proportional column widths aligned with elevation chart X axis
  const positions = computeWeatherPointPositions();
  const voronoi = positions.map((p, i) => {
    const left  = i === 0   ? p       : (p - positions[i-1]) / 2;
    const right = i === N-1 ? (1 - p) : (positions[i+1] - p) / 2;
    return left + right;
  });
  const panelW = document.getElementById('bottom-panel')?.offsetWidth || window.innerWidth;
  const labelW = 58;
  const minColW = 110;
  const dataW = Math.max(panelW - labelW, N * minColW);
  const colWidths = voronoi.map(v => Math.max(v * dataW, minColW));

  const timeOpts = (sel) => Array.from({length: 24}, (_, h) =>
    `<option value="${h}"${h === sel ? ' selected' : ''}>${String(h).padStart(2,'0')}:00</option>`
  ).join('');

  let html = `<table class="weather-table"><colgroup><col style="width:${labelW}px">`;
  colWidths.forEach(w => html += `<col style="width:${Math.round(w)}px">`);
  html += '</colgroup><thead><tr class="wt-header-row"><th class="wt-label-cell wt-th"></th>';

  weatherPoints.forEach((pt, i) => {
    const sv = saved?.cols?.[i];
    const date = sv?.date || todayStr;
    const hour = sv?.hour != null ? parseInt(sv.hour) : nowHour;
    html += `
      <th class="wt-col-head wt-th" data-idx="${i}">
        <div class="wt-col-label">${pt.label}</div>
        <input type="date" class="wt-date-input" value="${date}">
        <div class="wt-time-row">
          <span class="wt-time-label">時:</span>
          <select class="wt-time-select">${timeOpts(hour)}</select>
        </div>
      </th>`;
  });

  html += '</tr></thead><tbody>';
  WEATHER_ROWS.forEach(row => {
    html += `<tr><td class="wt-label-cell wt-td">${row.label}</td>`;
    weatherPoints.forEach((_, i) => html += `<td class="wt-data-cell wt-td" data-col="${i}" data-key="${row.key}">—</td>`);
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  // Bind auto-save and restore pending GPX dates
  container.querySelectorAll('.wt-date-input, .wt-time-select').forEach(el =>
    el.addEventListener('change', saveWeatherSettings)
  );

  // Sync elevation chart markers with weather columns
  updateElevationMarkers();

  if (window._pendingGpxDates) {
    weatherPoints.forEach((pt, colIdx) => {
      if (!pt.isWaypoint || pt.wpIndex === undefined) return;
      const sd = window._pendingGpxDates[pt.wpIndex];
      if (!sd) return;
      const th = container.querySelector(`.wt-col-head[data-idx="${colIdx}"]`);
      if (!th) return;
      if (sd.date) th.querySelector('.wt-date-input').value = sd.date;
      if (sd.time) {
        const h = parseInt(sd.time.split(':')[0]);
        if (!isNaN(h)) th.querySelector('.wt-time-select').value = String(h);
      }
    });
    window._pendingGpxDates = null;
    saveWeatherSettings();
  }
}

async function fetchAllWeatherData() {
  if (weatherPoints.length === 0) { showNotification('請先建立路線', 'warning'); return; }

  const container = document.getElementById('weather-table-container');
  if (!container) return;

  saveWeatherSettings();
  mapManager.clearWaypointWeather();
  if (btnFetchWeather) btnFetchWeather.disabled = true;

  for (let i = 0; i < weatherPoints.length; i++) {
    const pt = weatherPoints[i];
    if (btnFetchWeather) btnFetchWeather.textContent = `${i + 1} / ${weatherPoints.length}`;

    const th = container.querySelector(`.wt-col-head[data-idx="${i}"]`);
    const dateStr = th?.querySelector('.wt-date-input')?.value;
    const hour = parseInt(th?.querySelector('.wt-time-select')?.value ?? '8');
    if (!dateStr) continue;

    WEATHER_ROWS.forEach(row => {
      const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
      if (cell) { cell.textContent = '...'; cell.className = 'wt-data-cell wt-td loading'; }
    });

    try {
      const data = await weatherService.getWeatherAtPoint(pt.lat, pt.lng, dateStr, hour);
      WEATHER_ROWS.forEach(row => {
        const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
        if (cell) { cell.textContent = getCellValue(data, row.key); cell.className = 'wt-data-cell wt-td'; }
      });
      if (pt.isWaypoint && pt.wpIndex !== undefined && data.weatherIcon)
        mapManager.setWaypointWeather(pt.wpIndex, data.weatherIcon);
    } catch (err) {
      console.warn(`Weather fetch failed for ${pt.label}:`, err.message);
      WEATHER_ROWS.forEach(row => {
        const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
        if (cell) { cell.textContent = '—'; cell.className = 'wt-data-cell wt-td error'; }
      });
    }

    if (i < weatherPoints.length - 1) await new Promise(r => setTimeout(r, 400));
  }

  if (btnFetchWeather) { btnFetchWeather.disabled = false; btnFetchWeather.textContent = '取得天氣'; }
  showNotification('天氣資訊已更新', 'success', 2000);
}

// =========== Elevation Markers ===========

function highlightWeatherColumn(colIdx) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  // Clear previous highlight
  container.querySelectorAll('.wt-col-highlight')
    .forEach(el => el.classList.remove('wt-col-highlight'));

  // Highlight header + data cells for this column
  const th = container.querySelector(`.wt-col-head[data-idx="${colIdx}"]`);
  if (th) {
    th.classList.add('wt-col-highlight');
    th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  container.querySelectorAll(`[data-col="${colIdx}"]`)
    .forEach(td => td.classList.add('wt-col-highlight'));
}

function updateElevationMarkers() {
  if (weatherPoints.length === 0 || currentRouteCoords.length < 2) {
    elevationProfile.setWaypointMarkers([]);
    return;
  }
  const markers = weatherPoints.map((pt, i) => ({
    cumDistM: pt._cum || 0,
    label: pt.label,
    colIdx: i,
    isWaypoint: pt.isWaypoint,
  }));
  elevationProfile.setWaypointMarkers(markers);
}

// =========== Init ===========

async function init() {
  await offlineManager.register();
  initWeatherControls();

  // Restore + wire round-trip toggle
  const toggleRoundtrip = document.getElementById('toggle-roundtrip');
  if (toggleRoundtrip) {
    toggleRoundtrip.checked = roundTripMode;
    toggleRoundtrip.addEventListener('change', () => {
      roundTripMode = toggleRoundtrip.checked;
      localStorage.setItem(LS_ROUNDTRIP_KEY, roundTripMode ? '1' : '0');
      if (mapManager.waypoints.length >= 2) onWaypointsChanged(mapManager.waypoints);
    });
  }

  // Restore + wire segment interval controls
  if (segmentIntervalEnable && segmentIntervalInput) {
    // Restore saved state: value > 0 means enabled
    if (segmentIntervalKm > 0) {
      segmentIntervalEnable.checked = true;
      segmentIntervalInput.value = String(segmentIntervalKm);
    } else {
      segmentIntervalEnable.checked = false;
      segmentIntervalInput.disabled = true;
    }

    const applySegmentInterval = () => {
      if (!segmentIntervalEnable.checked) {
        segmentIntervalKm = 0;
      } else {
        const v = Math.min(100, Math.max(1, parseInt(segmentIntervalInput.value) || 5));
        segmentIntervalInput.value = String(v);
        segmentIntervalKm = v;
      }
      localStorage.setItem(LS_SEGMENT_KEY, String(segmentIntervalKm));
      updateIntermediateMarkers();
      renderWeatherPanel();
    };

    segmentIntervalEnable.addEventListener('change', () => {
      segmentIntervalInput.disabled = !segmentIntervalEnable.checked;
      applySegmentInterval();
    });

    segmentIntervalInput.addEventListener('change', applySegmentInterval);
  }

  setTimeout(() => {
    loadingScreen.classList.add('hidden');
  }, 800);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => mapManager.map.setView([pos.coords.latitude, pos.coords.longitude], 13),
      () => {}
    );
  }
}

init();
