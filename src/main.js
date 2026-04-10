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
import { ACTIVITY_PROFILES, DEFAULT_PACE_PARAMS, computeCumulativeTimes, computeHourlyPoints, formatDuration, defaultSpeed } from './modules/paceEngine.js';

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

const LS_SEGMENT_KEY       = 'mappingElf_segmentKm';
const LS_ROUNDTRIP_KEY     = 'mappingElf_roundTrip';
const LS_WAYPOINTS_KEY     = 'mappingElf_waypoints';
const LS_ROUTE_MODE_KEY    = 'mappingElf_routeMode';
const LS_MAP_LAYER_KEY     = 'mappingElf_mapLayer';
const LS_MAP_VIEW_KEY      = 'mappingElf_mapView';
const LS_WEATHER_CACHE_KEY = 'mappingElf_weatherCache';
const LS_SPEED_MODE_KEY    = 'mappingElf_speedMode';
const LS_SPEED_ACTIVITY_KEY= 'mappingElf_speedActivity';
const LS_PACE_PARAMS_KEY   = 'mappingElf_paceParams';

let segmentIntervalKm = parseInt(localStorage.getItem(LS_SEGMENT_KEY) || '0') || 0;
let roundTripMode     = localStorage.getItem(LS_ROUNDTRIP_KEY) === '1';
let speedIntervalMode = localStorage.getItem(LS_SPEED_MODE_KEY) === '1';
let speedActivity     = localStorage.getItem(LS_SPEED_ACTIVITY_KEY) || 'hiking';
let paceParams = (() => {
  try { return { ...DEFAULT_PACE_PARAMS, ...JSON.parse(localStorage.getItem(LS_PACE_PARAMS_KEY) || 'null') }; }
  catch { return { ...DEFAULT_PACE_PARAMS }; }
})();


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
const statTime    = document.getElementById('stat-time');
const statTimeCard= document.getElementById('stat-time-card');

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
  cachedWeatherData = {};
  localStorage.removeItem(LS_WEATHER_CACHE_KEY);
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
    localStorage.setItem(LS_MAP_LAYER_KEY, btn.dataset.layer);
    layerBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

routeModeRadios.forEach((radio) => {
  radio.addEventListener('change', (e) => {
    routeEngine.setMode(e.target.value);
    localStorage.setItem(LS_ROUTE_MODE_KEY, e.target.value);
    if (mapManager.waypoints.length >= 2) {
      onWaypointsChanged(mapManager.waypoints);
    }
  });
});


// =========== Core Logic ===========

async function onWaypointsChanged(waypoints) {
  localStorage.setItem(LS_WAYPOINTS_KEY, JSON.stringify(waypoints));
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
    allAlternatives = await routeEngine.getAlternativeRoutes(routeWaypoints);

    if (allAlternatives.length > 0) {
      // Draw all routes on map with continuous gradient coloring
      mapManager.drawMultipleRoutes(allAlternatives, 0, roundTripMode);

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

  // Update elevation chart with pre-fetched data
  elevationProfile.updateWithData(route.sampledCoords, route.elevations, roundTripMode);

  // Update stats from pre-calculated route data
  statDistance.textContent = formatDistance(route.distance);
  statAscent.textContent = formatElevation(route.ascent);
  statDescent.textContent = formatElevation(route.descent);
  statMaxElev.textContent = formatElevation(route.maxElev);

  // Update card selection highlight
  renderAlternatives(allAlternatives, index);

  // Update intermediate km-interval markers
  updateIntermediateMarkers();

  // Update pace time stat (needs elevation data from profile, available after updateWithData)
  updateTimeStat();

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
  if (statTime) statTime.textContent = '—';
}

// =========== Pace / Speed Interval ===========

/** Compute total travel time for the current route and update the time stat card. */
function updateTimeStat() {
  if (!speedIntervalMode || !statTime || !statTimeCard) return;
  const pts  = elevationProfile.points;
  const elevs = elevationProfile.elevations;
  const dists = elevationProfile.distances;
  if (!pts || pts.length < 2 || !elevs.length) {
    statTime.textContent = '—';
    return;
  }
  const times = computeCumulativeTimes(elevs, dists, speedActivity, paceParams);
  const totalH = times[times.length - 1] || 0;
  statTime.textContent = formatDuration(totalH);
}

/** Convert a column header's current date+hour to milliseconds (local time). */
function colToMs(th) {
  const d = th.querySelector('.wt-date-input')?.value || '';
  const h = parseInt(th.querySelector('.wt-time-select')?.value ?? '0');
  if (!d) return 0;
  return new Date(d + 'T00:00:00').getTime() + h * 3600000;
}

/** Set a column header's date/time from a millisecond value (local time). */
function setColToMs(th, ms) {
  const d = new Date(Math.max(0, ms));
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const di = th.querySelector('.wt-date-input');
  const hs = th.querySelector('.wt-time-select');
  if (di) di.value = `${y}-${mo}-${dy}`;
  if (hs) hs.value = String(d.getHours());
}

/** Add elapsedH hours to a date/hour, returning the new { date, hour }. */
function addHoursToDateTime(dateStr, startHour, elapsedH) {
  const totalMins = startHour * 60 + Math.round(elapsedH * 60);
  const addDays   = Math.floor(totalMins / (24 * 60));
  const finalHour = Math.floor(totalMins / 60) % 24;
  // Use noon to avoid DST-boundary issues
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + addDays);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return { date: `${y}-${mo}-${dy}`, hour: finalHour };
}

/**
 * When speed mode is ON, cascade column 0's date/time to all other columns
 * using each point's _elapsedH.
 */
function cascadeWeatherTimes() {
  if (!speedIntervalMode || weatherPoints.length === 0) return;
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const th0 = container.querySelector('.wt-col-head[data-idx="0"]');
  if (!th0) return;
  const startDate = th0.querySelector('.wt-date-input')?.value || '';
  const startHour = parseInt(th0.querySelector('.wt-time-select')?.value ?? '8');
  if (!startDate) return;

  weatherPoints.forEach((pt, i) => {
    if (i === 0) return;
    const th = container.querySelector(`.wt-col-head[data-idx="${i}"]`);
    if (!th) return;
    const { date, hour } = addHoursToDateTime(startDate, startHour, pt._elapsedH || 0);
    const dateInput  = th.querySelector('.wt-date-input');
    const hourSelect = th.querySelector('.wt-time-select');
    if (dateInput)  dateInput.value  = date;
    if (hourSelect) hourSelect.value = String(hour);
  });
}

/**
 * Enforce non-decreasing time order across all editable columns.
 * If column i is earlier than column i-1, snap it forward to match column i-1.
 * Skips auto-cascade columns (speed mode cols 1..N).
 */
function enforceTimeOrdering() {
  const container = document.getElementById('weather-table-container');
  if (!container) return;
  const heads = Array.from(container.querySelectorAll('.wt-col-head'));
  if (heads.length < 2) return;

  const toMs = (th) => {
    const d = th.querySelector('.wt-date-input')?.value || '';
    const h = parseInt(th.querySelector('.wt-time-select')?.value ?? '0');
    if (!d) return -Infinity;
    return new Date(d + 'T00:00:00').getTime() + h * 3600000;
  };

  for (let i = 1; i < heads.length; i++) {
    if (toMs(heads[i]) < toMs(heads[i - 1])) {
      setColToMs(heads[i], toMs(heads[i - 1]));
    }
  }
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

// Persist fetched weather data across route edits and page refreshes
let cachedWeatherData = (() => {
  try { return JSON.parse(localStorage.getItem(LS_WEATHER_CACHE_KEY) || '{}'); }
  catch { return {}; }
})();
const weatherCoordKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

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

  const deltaMs = deltaDays * 86400000 + deltaHours * 3600000;
  Array.from(container.querySelectorAll('.wt-col-head')).forEach(th => {
    setColToMs(th, colToMs(th) + deltaMs);
  });

  enforceTimeOrdering();
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
    const pts = computeIntermediatePoints(currentRouteCoords, segmentIntervalKm);
    let totalDistM = 0;
    for (let i = 1; i < currentRouteCoords.length; i++) {
      totalDistM += haversineDistance(currentRouteCoords[i - 1], currentRouteCoords[i]);
    }
    mapManager.setIntermediateMarkers(pts, totalDistM);
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

  // Prepare pace cumulative times if speed mode is ON
  const sampledPts   = elevationProfile.points;
  const sampledElevs = elevationProfile.elevations;
  const sampledDists = elevationProfile.distances;
  let cumTimes = null;
  let fullTotalDistBuild = 0;
  if (speedIntervalMode && sampledPts && sampledPts.length > 1 && sampledElevs.length > 1) {
    cumTimes = computeCumulativeTimes(sampledElevs, sampledDists, speedActivity, paceParams);
    for (let j = 1; j < coords.length; j++) fullTotalDistBuild += haversineDistance(coords[j - 1], coords[j]);
  }

  /** Get elapsed hours for a given cumDistM (full-route metres). */
  const getElapsedH = (cumDistM) => {
    if (!cumTimes || !sampledDists.length || fullTotalDistBuild === 0) return 0;
    // Map full-route fraction → sampled index → cumulative time
    const fraction = Math.max(0, Math.min(1, cumDistM / fullTotalDistBuild));
    const idx = Math.round(fraction * (sampledPts.length - 1));
    return cumTimes[idx] ?? 0;
  };

  const all = [];

  // Add actual waypoints
  for (let i = 0; i < wps.length; i++) {
    const label = i === 0 ? '起點' : i === wps.length - 1 ? '終點' : `航點 ${i + 1}`;
    all.push({ label, lat: wps[i][0], lng: wps[i][1], isWaypoint: true, wpIndex: i,
               _cum: wpCumDist[i], _elapsedH: getElapsedH(wpCumDist[i]) });
  }

  if (speedIntervalMode && sampledPts && sampledPts.length > 1 && sampledElevs.length > 1) {
    // Speed mode: intermediate points every 1 hour of travel time
    const hourlyPts = computeHourlyPoints(sampledPts, sampledElevs, sampledDists, speedActivity, 1.0, paceParams);
    hourlyPts.forEach((pt) => {
      const hLabel = Number.isInteger(pt.estTimeH)
        ? `第 ${pt.estTimeH} 小時`
        : `${pt.estTimeH.toFixed(1)} 小時`;
      all.push({ label: hLabel, lat: pt.lat, lng: pt.lng, isWaypoint: false,
                 _cum: pt.cumDistM, _elapsedH: pt.estTimeH });
    });
  } else if (segmentIntervalKm > 0 && coords.length > 1) {
    // km-interval intermediate points
    const intermediates = computeIntermediatePoints(coords, segmentIntervalKm);
    intermediates.forEach((pt) => {
      const kmLabel = (pt.cumDistM / 1000 % 1 === 0)
        ? `${pt.cumDistM / 1000 | 0} km`
        : `${(pt.cumDistM / 1000).toFixed(1)} km`;
      all.push({ label: kmLabel, lat: pt.lat, lng: pt.lng, isWaypoint: false,
                 _cum: pt.cumDistM, _elapsedH: getElapsedH(pt.cumDistM) });
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
      all.push({ label: `${labelA}→${labelB}`, lat: mc[0], lng: mc[1], isWaypoint: false,
                 _cum: midCum, _elapsedH: getElapsedH(midCum) });
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
    // For speed mode: only col-0 uses saved/default; others are cascaded after render
    const date = sv?.date || todayStr;
    const hour = sv?.hour != null ? parseInt(sv.hour) : nowHour;
    const elapsedBadge = speedIntervalMode && pt._elapsedH > 0
      ? `<span class="wt-elapsed-badge">${formatDuration(pt._elapsedH)}</span>`
      : '';
    html += `
      <th class="wt-col-head wt-th" data-idx="${i}">
        <div class="wt-col-label">${pt.label}${elapsedBadge}</div>
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

  // Snapshot each column's time before the user changes it (for delta-shift in speed mode)
  const heads = Array.from(container.querySelectorAll('.wt-col-head'));
  const snapshot = (th) => () => { th.dataset.prevMs = String(colToMs(th)); };
  heads.forEach(th => {
    const di = th.querySelector('.wt-date-input');
    const hs = th.querySelector('.wt-time-select');
    di?.addEventListener('focus',     snapshot(th));
    hs?.addEventListener('mousedown', snapshot(th));
    hs?.addEventListener('focus',     snapshot(th));
  });

  // On change: speed mode → delta-shift subsequent columns; all modes → enforce order → save
  const onTimeChange = (e) => {
    const th = e.target.closest('.wt-col-head');
    if (speedIntervalMode && th) {
      const idx      = parseInt(th.dataset.idx);
      const prevMs   = parseInt(th.dataset.prevMs) || colToMs(th);
      const deltaMs  = colToMs(th) - prevMs;
      if (deltaMs !== 0) {
        for (let j = idx + 1; j < heads.length; j++) {
          setColToMs(heads[j], colToMs(heads[j]) + deltaMs);
        }
      }
    }
    enforceTimeOrdering();
    saveWeatherSettings();
  };
  container.querySelectorAll('.wt-date-input, .wt-time-select').forEach(el =>
    el.addEventListener('change', onTimeChange)
  );

  // Initial cascade (speed mode) + enforce on first render
  if (speedIntervalMode) cascadeWeatherTimes();
  enforceTimeOrdering();

  // Restore previously fetched weather data for matching coordinates
  weatherPoints.forEach((pt, colIdx) => {
    const cached = cachedWeatherData[weatherCoordKey(pt.lat, pt.lng)];
    if (!cached) return;
    WEATHER_ROWS.forEach(row => {
      const cell = container.querySelector(`[data-col="${colIdx}"][data-key="${row.key}"]`);
      if (cell) cell.textContent = getCellValue(cached, row.key);
    });
    if (pt.isWaypoint && pt.wpIndex !== undefined && cached.weatherIcon) {
      mapManager.setWaypointWeather(pt.wpIndex, cached.weatherIcon);
    }
  });

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
      cachedWeatherData[weatherCoordKey(pt.lat, pt.lng)] = data;
      // Save after each point so partial data survives a mid-fetch page close
      localStorage.setItem(LS_WEATHER_CACHE_KEY, JSON.stringify(cachedWeatherData));
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
  // Only show actual waypoints and km-interval markers; exclude auto-midpoints
  const sampledPts = elevationProfile.points;
  const sampledDists = elevationProfile.distances;

  // Compute total distance along full route coords for fraction mapping
  let fullTotalDist = 0;
  for (let j = 1; j < currentRouteCoords.length; j++) {
    fullTotalDist += haversineDistance(currentRouteCoords[j - 1], currentRouteCoords[j]);
  }

  const markers = [];
  weatherPoints.forEach((pt, colIdx) => {
    if (pt.isWaypoint || segmentIntervalKm > 0 || speedIntervalMode) {
      let cumDistM = pt._cum || 0;
      if (sampledPts && sampledPts.length > 1 && fullTotalDist > 0) {
        // Map pt._cum fraction → sampled index (handles round-trip correctly since
        // fraction is monotonic and sampled indices match route order)
        const fraction = Math.max(0, Math.min(1, cumDistM / fullTotalDist));
        const idx = Math.round(fraction * (sampledPts.length - 1));
        cumDistM = sampledDists[idx] || 0;
      }
      markers.push({ cumDistM, label: pt.label, colIdx, isWaypoint: pt.isWaypoint });
    }
  });
  elevationProfile.setWaypointMarkers(markers);
}

// =========== Init ===========

async function init() {
  await offlineManager.register();
  initWeatherControls();

  // Restore route mode
  const savedMode = localStorage.getItem(LS_ROUTE_MODE_KEY);
  if (savedMode) {
    routeEngine.setMode(savedMode);
    const modeRadio = document.querySelector(`input[name="route-mode"][value="${savedMode}"]`);
    if (modeRadio) modeRadio.checked = true;
  }

  // Restore map tile layer
  const savedLayer = localStorage.getItem(LS_MAP_LAYER_KEY);
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

  // Restore + wire speed-interval controls
  const speedIntervalEnableEl = document.getElementById('speed-interval-enable');
  const speedActivitySelectEl = document.getElementById('speed-activity-select');
  if (speedIntervalEnableEl && speedActivitySelectEl) {
    // Restore saved state
    speedIntervalEnableEl.checked = speedIntervalMode;
    speedActivitySelectEl.value   = speedActivity;
    speedActivitySelectEl.disabled = !speedIntervalMode;
    if (statTimeCard) statTimeCard.style.display = speedIntervalMode ? '' : 'none';

    // Track previous activity for pace conversion
    let prevActivity = speedActivity;

    const applySpeedInterval = () => {
      const newActivity = speedActivitySelectEl.value;
      speedIntervalMode = speedIntervalEnableEl.checked;

      // Convert custom flat pace proportionally when activity switches
      if (newActivity !== prevActivity) {
        const flatEl = document.getElementById('pace-flat-input');
        const bodyEl = document.getElementById('pace-body-weight');
        const packEl = document.getElementById('pace-pack-weight');
        const rawFlat = parseFloat(flatEl?.value);
        if (flatEl && !isNaN(rawFlat) && flatEl.value !== '') {
          const body = parseFloat(bodyEl?.value) || 70;
          const pack = parseFloat(packEl?.value) || 0;
          const prevDefault = defaultSpeed(prevActivity, body, pack);
          const newDefault  = defaultSpeed(newActivity,  body, pack);
          if (prevDefault > 0) {
            const converted = +(rawFlat / prevDefault * newDefault).toFixed(2);
            flatEl.value = converted;
            paceParams = { ...paceParams, flatPaceKmH: converted };
            localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(paceParams));
          }
        }
        prevActivity = newActivity;
      }

      speedActivity = newActivity;
      speedActivitySelectEl.disabled = !speedIntervalMode;
      if (statTimeCard) statTimeCard.style.display = speedIntervalMode ? '' : 'none';
      const panel = document.getElementById('pace-params-panel');
      if (panel) panel.style.display = speedIntervalMode ? '' : 'none';
      localStorage.setItem(LS_SPEED_MODE_KEY, speedIntervalMode ? '1' : '0');
      localStorage.setItem(LS_SPEED_ACTIVITY_KEY, speedActivity);
      // Update flat pace placeholder when activity changes
      const bodyEl = document.getElementById('pace-body-weight');
      const packEl = document.getElementById('pace-pack-weight');
      const flatEl = document.getElementById('pace-flat-input');
      if (flatEl) {
        const spd = defaultSpeed(speedActivity, parseFloat(bodyEl?.value) || 70, parseFloat(packEl?.value) || 0);
        flatEl.placeholder = spd.toFixed(1);
      }
      updateTimeStat();
      updateIntermediateMarkers();
      renderWeatherPanel();
    };

    speedIntervalEnableEl.addEventListener('change', applySpeedInterval);
    speedActivitySelectEl.addEventListener('change', applySpeedInterval);
  }

  // --- Pace params panel wiring ---
  const paceParamsPanel   = document.getElementById('pace-params-panel');
  const paceFlatInput     = document.getElementById('pace-flat-input');
  const paceBodyWeight    = document.getElementById('pace-body-weight');
  const pacePackWeight    = document.getElementById('pace-pack-weight');
  const paceFatigueEnable = document.getElementById('pace-fatigue-enable');
  const paceRestRow       = document.getElementById('pace-rest-row');
  const paceRestEvery     = document.getElementById('pace-rest-every');
  const paceRestMinutes   = document.getElementById('pace-rest-minutes');

  // Sync flat pace placeholder based on activity + weights
  const updateFlatPlaceholder = () => {
    if (!paceFlatInput) return;
    const body = parseFloat(paceBodyWeight?.value) || 70;
    const pack = parseFloat(pacePackWeight?.value) || 0;
    const spd  = defaultSpeed(speedActivity, body, pack);
    paceFlatInput.placeholder = spd.toFixed(1);
  };

  // Restore saved paceParams to UI inputs
  if (paceFlatInput)     paceFlatInput.value     = paceParams.flatPaceKmH ?? '';
  if (paceBodyWeight)    paceBodyWeight.value     = paceParams.bodyWeightKg ?? 70;
  if (pacePackWeight)    pacePackWeight.value     = paceParams.packWeightKg ?? 0;
  if (paceFatigueEnable) paceFatigueEnable.checked = paceParams.fatigue ?? true;
  if (paceRestEvery)     paceRestEvery.value      = paceParams.restEveryH ?? 1.0;
  if (paceRestMinutes)   paceRestMinutes.value    = paceParams.restMinutes ?? 10;

  // Show/hide pace-rest-row based on fatigue checkbox
  const applyFatigueToggle = () => {
    if (paceRestRow) paceRestRow.style.display = paceFatigueEnable?.checked ? '' : 'none';
  };
  applyFatigueToggle();

  // Show/hide panel based on current speed mode state
  if (paceParamsPanel) paceParamsPanel.style.display = speedIntervalMode ? '' : 'none';

  // Read all pace inputs → paceParams → save → recalc
  const onPaceParamChange = () => {
    const rawFlat = parseFloat(paceFlatInput?.value);
    paceParams = {
      flatPaceKmH:  isNaN(rawFlat) || paceFlatInput?.value === '' ? null : rawFlat,
      bodyWeightKg: parseFloat(paceBodyWeight?.value)  || 70,
      packWeightKg: parseFloat(pacePackWeight?.value)  || 0,
      fatigue:      paceFatigueEnable?.checked ?? true,
      restEveryH:   parseFloat(paceRestEvery?.value)   || 1.0,
      restMinutes:  parseFloat(paceRestMinutes?.value) || 10,
    };
    localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(paceParams));
    updateFlatPlaceholder();
    applyFatigueToggle();
    updateTimeStat();
    updateIntermediateMarkers();
    renderWeatherPanel();
  };

  [paceFlatInput, paceBodyWeight, pacePackWeight, paceRestEvery, paceRestMinutes].forEach(el => {
    if (el) el.addEventListener('change', onPaceParamChange);
  });
  if (paceFatigueEnable) {
    paceFatigueEnable.addEventListener('change', onPaceParamChange);
  }

  updateFlatPlaceholder();

  // Restore saved waypoints (triggers route recalculation + weather cache restore)
  const savedWaypoints = (() => {
    try { return JSON.parse(localStorage.getItem(LS_WAYPOINTS_KEY) || 'null'); }
    catch { return null; }
  })();
  if (savedWaypoints && savedWaypoints.length > 0) {
    mapManager.setWaypointsFromImport(savedWaypoints);
  } else if (!savedView && navigator.geolocation) {
    // No saved state at all — pan to user's location
    navigator.geolocation.getCurrentPosition(
      (pos) => mapManager.map.setView([pos.coords.latitude, pos.coords.longitude], 13),
      () => {}
    );
  }

  setTimeout(() => {
    loadingScreen.classList.add('hidden');
  }, 800);
}

init();
