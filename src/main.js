/**
 * Mapping Elf — Main Entry
 */
import 'leaflet/dist/leaflet.css';
import './styles/main.css';

import { MapManager } from './modules/mapManager.js';
import { RouteEngine } from './modules/routeEngine.js';
import { ElevationProfile } from './modules/elevationProfile.js';
import { GpxExporter } from './modules/gpxExporter.js';
import { KmlExporter } from './modules/kmlExporter.js';
import { WeatherService } from './modules/weatherService.js';
import { OfflineManager } from './modules/offlineManager.js';
import { formatDistance, formatElevation, formatCoords, showNotification, debounce, haversineDistance, interpolateRouteColor } from './modules/utils.js';
import { ACTIVITY_PROFILES, DEFAULT_PACE_PARAMS, computeCumulativeTimes, computeHourlyPoints, computeTripStats, formatDuration, defaultSpeed } from './modules/paceEngine.js';

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
const LS_PER_SEGMENT_KEY   = 'mappingElf_perSegment';
const LS_STRICT_LINEAR_KEY = 'mappingElf_strictLinear';
const LS_PACE_UNIT_KEY     = 'mappingElf_paceUnit';

/**
 * 上河速度 base: S=1.0 corresponds to 3.0 km/h on flat terrain.
 * Based on Taiwan mountain hiking convention (five-person heavy-pack group).
 * Conversion: V_km_h = SHANHE_BASE / S  ↔  S = SHANHE_BASE / V_km_h
 */
const SHANHE_BASE = 3.0;

let segmentIntervalKm = parseInt(localStorage.getItem(LS_SEGMENT_KEY) || '0') || 0;
let roundTripMode     = localStorage.getItem(LS_ROUNDTRIP_KEY) === '1';
let speedIntervalMode  = localStorage.getItem(LS_SPEED_MODE_KEY) === '1';
let speedActivity      = localStorage.getItem(LS_SPEED_ACTIVITY_KEY) || 'hiking';
let perSegmentMode     = localStorage.getItem(LS_PER_SEGMENT_KEY) === '1';
let strictLinearMode   = localStorage.getItem(LS_STRICT_LINEAR_KEY) !== '0'; // default ON
let paceUnit           = localStorage.getItem(LS_PACE_UNIT_KEY) || 'kmh'; // 'kmh' | 'minkm' | 'shanhe'
let paceParams = (() => {
  try { return { ...DEFAULT_PACE_PARAMS, ...JSON.parse(localStorage.getItem(LS_PACE_PARAMS_KEY) || 'null') }; }
  catch { return { ...DEFAULT_PACE_PARAMS }; }
})();

// Gradient colors per waypoint index (teal→sky→amber→red), updated after each route build.
// Used by the sidebar list and map waypoint icons to match the elevation chart.
let waypointGradColors = [];


// =========== Initialize Modules ===========
const routeEngine = new RouteEngine();
const weatherService = new WeatherService();
const offlineManager = new OfflineManager();
const mapManager = new MapManager('map', onWaypointsChanged);

const elevationProfile = new ElevationProfile(
  'elevation-chart',
  'chart-empty',
  (lat, lng) => mapManager.showHoverMarker(lat, lng),
  (colIdx) => highlightPoint(colIdx)
);

// When user clicks an alternative route on the map
mapManager.onRouteSelect = (idx) => selectAlternative(idx);

// When user clicks a waypoint marker on the map → cross-view highlight
mapManager.onWaypointSelect = (wpIndex) => {
  const colIdx = weatherPoints.findIndex(p => p.isWaypoint && !p.isReturn && p.wpIndex === wpIndex);
  if (colIdx >= 0) {
    highlightPoint(colIdx);
  } else {
    mapManager.highlightWaypoint(wpIndex);
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
const statKcal    = document.getElementById('stat-kcal');
const statKcalCard= document.getElementById('stat-kcal-card');
const statIntake  = document.getElementById('stat-intake');
const statIntakeCard = document.getElementById('stat-intake-card');

const layerBtns = document.querySelectorAll('.layer-btn');
const routeModeRadios = document.querySelectorAll('input[name="route-mode"]');

// =========== Event Listeners ===========

btnTogglePanel.addEventListener('click', () => sidePanel.classList.toggle('open'));

btnMyLocation.addEventListener('click', () => {
  mapManager.goToMyLocation();
  showNotification('正在定位...', 'info');
});

btnExportGpx.addEventListener('click', openExportModal);
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
  clearAllHighlights();
  // Update UI list immediately for responsive feel
  updateWaypointList(waypoints);
  // Geocode any waypoints not yet named (fire-and-forget)
  geocodeWaypoints(waypoints);

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
      const placeName = getPlaceName(wp[0], wp[1]);
      const coords = formatCoords(wp[0], wp[1]);
      const n = waypoints.length;
      const gradColor = waypointGradColors[i]
        || interpolateRouteColor(n > 1 ? i / (n - 1) : 0);
      return `
        <div class="waypoint-item">
          <span class="wp-index ${cls}" style="background:${gradColor}">${i + 1}</span>
          <span class="wp-coords" title="${coords}" style="color:${gradColor}">
            ${placeName ? `<span class="wp-place-name">${placeName}</span>` : coords}
          </span>
          <div class="wp-actions">
            <button class="wp-action wp-up" data-index="${i}" title="向上移" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="wp-action wp-down" data-index="${i}" title="向下移" ${i === waypoints.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="wp-action wp-remove" data-index="${i}" title="移除">×</button>
          </div>
        </div>`;
    })
    .join('');

  // Click on waypoint row (not on action buttons) → cross-view highlight
  waypointList.querySelectorAll('.waypoint-item').forEach((item, wpIndex) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.wp-actions')) return;
      const colIdx = weatherPoints.findIndex(p => p.isWaypoint && !p.isReturn && p.wpIndex === wpIndex);
      if (colIdx >= 0) {
        highlightPoint(colIdx);
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
        if (e2.key === 'Enter')  { e2.preventDefault(); input.blur(); }
        if (e2.key === 'Escape') { saved = true; input.removeEventListener('blur', commit); _applyPlaceNameToDOM(); }
      });
    });
  });
}

function resetStats() {
  statDistance.textContent = '—';
  statAscent.textContent = '—';
  statDescent.textContent = '—';
  statMaxElev.textContent = '—';
  if (statTime)   statTime.textContent   = '—';
  if (statKcal)   statKcal.textContent   = '—';
  if (statIntake) statIntake.textContent = '—';
}

// =========== Pace / Speed Interval ===========

/** Compute total travel time and calorie stats for the current route. */
function updateTimeStat() {
  if ((!speedIntervalMode && segmentIntervalKm === 0) || !statTime || !statTimeCard) return;
  const pts   = elevationProfile.points;
  const elevs = elevationProfile.elevations;
  const dists = elevationProfile.distances;
  if (!pts || pts.length < 2 || !elevs.length) {
    statTime.textContent = '—';
    if (statKcal)   statKcal.textContent   = '—';
    if (statIntake) statIntake.textContent = '—';
    return;
  }
  const times = computeCumulativeTimes(elevs, dists, speedActivity, paceParams);
  const totalH = times[times.length - 1] || 0;
  statTime.textContent = formatDuration(totalH);

  const trip = computeTripStats(elevs, dists, speedActivity, paceParams);
  if (statKcal)   statKcal.textContent   = `${trip.kcalExpended.toLocaleString()} kcal`;
  if (statIntake) statIntake.textContent = `${trip.kcalSuggested.toLocaleString()} kcal`;
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
  const th0 = container.querySelector('.wt-col-head[data-idx="0"]');
  if (!th0) return;
  const startDate = th0.querySelector('.wt-date-input')?.value || '';
  const startHour = parseInt(th0.querySelector('.wt-time-select')?.value ?? '8');
  if (!startDate) return;
  weatherPoints.forEach((pt, i) => {
    if (pt.isWaypoint) return;
    const th = container.querySelector(`.wt-col-head[data-idx="${i}"]`);
    if (!th) return;

    let anchorDate = startDate;
    let anchorHour = startHour;
    let anchorElapsedH = 0;
    if (fromWP) {
      for (let j = i - 1; j >= 0; j--) {
        if (weatherPoints[j]?.isWaypoint) {
          const thj = container.querySelector(`.wt-col-head[data-idx="${j}"]`);
          if (thj) {
            anchorDate     = thj.querySelector('.wt-date-input')?.value || startDate;
            anchorHour     = parseInt(thj.querySelector('.wt-time-select')?.value ?? String(startHour));
            anchorElapsedH = weatherPoints[j]._elapsedH || 0;
          }
          break;
        }
      }
    }

    const deltaH = (pt._elapsedH || 0) - anchorElapsedH;
    const { date, hour } = addHoursToDateTime(anchorDate, anchorHour, deltaH);
    const dateInput  = th.querySelector('.wt-date-input');
    const hourSelect = th.querySelector('.wt-time-select');
    if (dateInput)  dateInput.value  = date;
    if (hourSelect) hourSelect.value = String(hour);
  });
}

/**
 * Enforce non-decreasing time order across waypoint columns only.
 * Interval points are managed by cascadeIntervalTimes() and skipped here.
 * When a waypoint column is earlier than its predecessor, keep the user's
 * chosen hour but add +1 day so the trip stays chronologically consistent.
 */
function enforceTimeOrdering() {
  if (!strictLinearMode) return;
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
    const pt = weatherPoints[i];
    if (!pt?.isWaypoint) continue; // Interval points are handled by cascade

    const prevMs = toMs(heads[i - 1]);
    let   curMs  = toMs(heads[i]);
    if (curMs >= prevMs) continue;

    // Violation: waypoint is earlier than the previous column.
    // Keep the user's chosen hour; bump the date forward until it is ≥ prev.
    const di = heads[i].querySelector('.wt-date-input');
    if (di && di.value) {
      const d = new Date(di.value + 'T12:00:00');
      while (curMs < prevMs) {
        d.setDate(d.getDate() + 1);
        curMs += 86400000;
      }
      di.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
}

/**
 * One-stop sync: cascade interval times → enforce waypoint ordering →
 * cascade again.  The second cascade is needed because enforceTimeOrdering
 * may bump a waypoint to the next day, leaving the interval points that come
 * after it showing stale (pre-bump) times.
 */
function syncIntervalTimes() {
  cascadeIntervalTimes();
  enforceTimeOrdering();
  cascadeIntervalTimes();
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
}

// =========== Export (GPX / KML) ===========

const exportModal   = document.getElementById('export-modal');
const btnExportConfirm = document.getElementById('btn-export-confirm');
const btnExportCancel  = document.getElementById('btn-export-cancel');

function openExportModal() {
  if (currentRouteCoords.length === 0) {
    showNotification('請先建立路線', 'warning');
    return;
  }
  exportModal.classList.remove('hidden');
}

function closeExportModal() {
  exportModal.classList.add('hidden');
}

exportModal?.addEventListener('click', (e) => {
  if (e.target === exportModal) closeExportModal();
});
btnExportCancel?.addEventListener('click', closeExportModal);
btnExportConfirm?.addEventListener('click', () => {
  const fmt = exportModal.querySelector('input[name="export-fmt"]:checked')?.value || 'gpx';
  closeExportModal();
  doExport(fmt);
});

/**
 * Collect all weather-column data for export (date, time, weather rows).
 * Returns array parallel to weatherPoints.
 */
function collectExportData() {
  const container = document.getElementById('weather-table-container');
  return weatherPoints.map((pt, colIdx) => {
    const th = container?.querySelector(`.wt-col-head[data-idx="${colIdx}"]`);
    const date = th?.querySelector('.wt-date-input')?.value || '';
    const h    = th?.querySelector('.wt-time-select')?.value;
    const hour = h != null ? parseInt(h) : 0;
    const time = h != null ? `${String(hour).padStart(2, '0')}:00` : '';
    const cached = date ? cachedWeatherData[weatherCoordKey(pt.lat, pt.lng, date, hour)] : null;
    const weather = {};
    if (cached) {
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(cached, row.key);
        if (val && val !== '—') weather[row.key] = { label: row.label, value: val };
      });
    } else {
      // Fallback: use saved display-cell values (survives date/coord changes and page reload)
      const savedCells = savedWeatherCells[getSemanticKey(pt, colIdx)];
      if (savedCells) {
        WEATHER_ROWS.forEach(row => {
          const val = savedCells[row.key];
          if (val && val !== '—') weather[row.key] = { label: row.label, value: val };
        });
      }
    }
    return {
      lat:        pt.lat,
      lng:        pt.lng,
      label:      pt.label,
      isWaypoint: pt.isWaypoint || false,
      isReturn:   pt.isReturn   || false,
      wpIndex:    pt.wpIndex,
      date,
      time,
      weather,
    };
  });
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

function doExport(fmt) {
  const name = 'Mapping Elf Track';

  // Build filename: 起點名稱_座標_時間戳
  const startWp = mapManager.waypoints[0];
  const startName = startWp ? (getEffectiveName(startWp[0], startWp[1]) || null) : null;
  const startCoords = startWp
    ? `${startWp[0].toFixed(4)},${startWp[1].toFixed(4)}`
    : '';
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const namePart = startName ? startName.replace(/[\\/:*?"<>|]/g, '_') : '起點';
  const filename = `${namePart}_${startCoords}_${ts}`;

  const wpData = collectExportData();

  if (fmt === 'gpx' || fmt === 'both') {
    const gpx = GpxExporter.generate(wpData, currentRouteCoords, currentElevations, name);
    GpxExporter.download(gpx, `${filename}.gpx`);
  }

  if (fmt === 'kml' || fmt === 'both') {
    const kml = KmlExporter.generate(wpData, currentRouteCoords, currentElevations, name);
    KmlExporter.download(kml, `${filename}.kml`);
  }

  const label = fmt === 'both' ? 'GPX + KML' : fmt.toUpperCase();
  showNotification(`${label} 檔案已匯出`, 'success');
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
const LS_WEATHER_KEY       = 'mappingElf_weather';
const LS_WEATHER_CELLS_KEY = 'mappingElf_weatherCells';

/** Persisted display-cell values keyed by semantic column key */
let savedWeatherCells = (() => {
  try { return JSON.parse(localStorage.getItem(LS_WEATHER_CELLS_KEY) || '{}'); }
  catch { return {}; }
})();

/** Stable semantic key for a weather column point */
function getSemanticKey(pt, i) {
  return pt.isWaypoint
    ? (pt.isReturn ? `ret:${pt.wpIndex}` : `wp:${pt.wpIndex}`)
    : `int:${Math.round((pt._cum ?? i * 1000) / 10) * 10}`;
}

/** Persist display-cell values for one column */
function saveWeatherCells(semKey, cells) {
  savedWeatherCells[semKey] = cells;
  try { localStorage.setItem(LS_WEATHER_CELLS_KEY, JSON.stringify(savedWeatherCells)); } catch (_) {}
}

// =========== Reverse Geocoding (place name labels) ===========
const LS_GEOCODE_KEY      = 'mappingElf_geocode';
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
 * Deduplicate labels in-place: if two items share a label the second becomes
 * "Name (2)", the third "Name (3)", etc.
 */
function deduplicateLabels(pts) {
  const count = {};
  pts.forEach(p => { count[p.label] = (count[p.label] || 0) + 1; });
  const used = {};
  pts.forEach(p => {
    if (count[p.label] > 1) {
      used[p.label] = (used[p.label] || 0) + 1;
      if (used[p.label] > 1) p.label = `${p.label} (${used[p.label]})`;
    }
  });
}
async function fetchPlaceName(lat, lng) {
  const k = _geocodeKey(lat, lng);
  if (k in waypointPlaceNames) return waypointPlaceNames[k];
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'zh-TW,zh,en', 'User-Agent': 'MappingElf/1.0' } }
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const addr = data.address || {};
    const name = data.name ||
                 addr.suburb || addr.village || addr.town ||
                 addr.city_district || addr.district ||
                 addr.city || addr.county || null;
    waypointPlaceNames[k] = name;
    try { localStorage.setItem(LS_GEOCODE_KEY, JSON.stringify(waypointPlaceNames)); } catch(_) {}
    return name;
  } catch(_) {
    waypointPlaceNames[k] = null;
    return null;
  }
}
/** Geocode waypoints in background; update column labels as results arrive. */
async function geocodeWaypoints(waypoints) {
  for (let i = 0; i < waypoints.length; i++) {
    const [lat, lng] = waypoints[i];
    const k = _geocodeKey(lat, lng);
    if (k in waypointPlaceNames) continue; // already known
    await fetchPlaceName(lat, lng);
    _applyPlaceNameToDOM();
    // Nominatim rate limit: max 1 req/s
    if (i < waypoints.length - 1) await new Promise(r => setTimeout(r, 1100));
  }
}
/** Re-render labels after a geocode result or custom name save. */
function _applyPlaceNameToDOM() {
  updateWaypointList(mapManager.waypoints);
  if (weatherPoints.length > 0) renderWeatherPanel();
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
  try { localStorage.setItem(LS_CUSTOM_NAMES_KEY, JSON.stringify(waypointCustomNames)); } catch(_) {}
  _applyPlaceNameToDOM();
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
  const cancel = () => {
    if (saved) return;
    saved = true;
    _applyPlaceNameToDOM(); // restore
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { saved = true; input.removeEventListener('blur', commit); cancel(); }
  });
}

// Persist fetched weather data across route edits and page refreshes
let cachedWeatherData = (() => {
  try { return JSON.parse(localStorage.getItem(LS_WEATHER_CACHE_KEY) || '{}'); }
  catch { return {}; }
})();
/** Cache key includes date+hour so going/return at the same location can differ. */
const weatherCoordKey = (lat, lng, date, hour) =>
  `${lat.toFixed(4)},${lng.toFixed(4)},${date},${hour}`;

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
  const byKey = {};
  const cols  = [];
  weatherPoints.forEach((pt, i) => {
    const th = container.querySelector(`.wt-col-head[data-idx="${i}"]`);
    if (!th) return;
    const entry = {
      date: th.querySelector('.wt-date-input')?.value || '',
      hour: th.querySelector('.wt-time-select')?.value ?? '8',
    };
    cols.push(entry); // keep legacy array for backwards compat
    if (!pt.isWaypoint) return; // Interval times are recalculated — no need to persist
    const key = pt.isReturn ? `ret:${pt.wpIndex}` : `wp:${pt.wpIndex}`;
    byKey[key] = entry;
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
    const key = pt.isReturn ? `ret:${pt.wpIndex}` : `wp:${pt.wpIndex}`;
    if (saved.byKey[key]) return saved.byKey[key];
  }
  // Legacy fallback: index-based
  return saved.cols?.[i] ?? null;
}

function shiftAllDates(deltaDays, deltaHours) {
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  const deltaMs = deltaDays * 86400000 + deltaHours * 3600000;
  Array.from(container.querySelectorAll('.wt-col-head')).forEach((th, i) => {
    if (!weatherPoints[i]?.isWaypoint) return; // skip interval cols — recalculated below
    setColToMs(th, colToMs(th) + deltaMs);
  });

  syncIntervalTimes();
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

  // Compute pace cumulative times whenever any interval mode is active so that
  // distance-mode interval points also get meaningful _elapsedH values.
  const sampledPts   = elevationProfile.points;
  const sampledElevs = elevationProfile.elevations;
  const sampledDists = elevationProfile.distances;
  let cumTimes = null;
  let fullTotalDistBuild = 0;
  if ((speedIntervalMode || segmentIntervalKm > 0) && sampledPts && sampledPts.length > 1 && sampledElevs.length > 1) {
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
    const placeName = getPlaceName(wps[i][0], wps[i][1]);
    const label = placeName
      ? placeName
      : (i === 0 ? '起點' : i === wps.length - 1 ? '終點' : `航點 ${i + 1}`);
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

  // Round-trip: add return waypoints (reversed, excluding turning point)
  // Each return wp shares lat/lng with its outgoing counterpart (same location, different time).
  if (roundTripMode && wps.length >= 2 && totalDistM > 0 && wpCumDist.length === wps.length) {
    for (let i = wps.length - 2; i >= 0; i--) {
      const placeName = getPlaceName(wps[i][0], wps[i][1]);
      const outLabel = placeName || (i === 0 ? '起點' : `航點 ${i + 1}`);
      // Mirror cumDist: return position = totalRouteDist − outgoingCum
      const returnCum = totalDistM - wpCumDist[i];
      all.push({
        label: `↩ ${outLabel}`,
        lat: wps[i][0],
        lng: wps[i][1],
        isWaypoint: true,
        isReturn: true,
        wpIndex: i,
        _cum: returnCum,
        _elapsedH: getElapsedH(returnCum),
      });
    }
  }

  // Sort by position along route
  all.sort((a, b) => a._cum - b._cum);

  // Relabel interval points as "n-t"
  // n = preceding waypoint's wpIndex (0-based); t = elapsed time (segment or cumulative)
  {
    const fmtT = (h) => {
      if (h <= 0) return '0';
      const v = Math.round(h * 10) / 10;
      return v % 1 === 0 ? String(v | 0) : v.toFixed(1);
    };
    let prevWpIdx      = 0;
    let prevWpElapsedH = 0;
    all.forEach(pt => {
      if (pt.isWaypoint) {
        prevWpIdx      = pt.wpIndex ?? 0;
        prevWpElapsedH = pt._elapsedH || 0;
      } else {
        const displayH = perSegmentMode
          ? (pt._elapsedH || 0) - prevWpElapsedH
          : (pt._elapsedH || 0);
        pt.label = `${prevWpIdx}-${fmtT(displayH)}`;
      }
    });
  }

  // Deduplicate: same label → append (2), (3), …
  deduplicateLabels(all);

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

  // Compute per-waypoint gradient colors (matching elevation chart) and apply
  // to map markers + sidebar list so all views share the same teal→red palette.
  {
    const maxCumWp = weatherPoints.reduce((m, p) => Math.max(m, p._cum ?? 0), 0) || 1;
    const colorById = {};
    weatherPoints.forEach(p => {
      if (!p.isWaypoint || p.isReturn) return;
      const xFrac = Math.max(0, Math.min(1, (p._cum ?? 0) / maxCumWp));
      const t = roundTripMode ? (1 - Math.abs(2 * xFrac - 1)) : xFrac;
      colorById[p.wpIndex] = interpolateRouteColor(t);
    });
    const newColors = mapManager.waypoints.map((_, i) => colorById[i] || null);
    if (newColors.every(c => c !== null) && newColors.length > 0) {
      waypointGradColors = newColors;
      mapManager.setWaypointColors(waypointGradColors);
      updateWaypointList(mapManager.waypoints);
    }
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

  // Index of the first return column (for separator styling)
  const firstReturnIdx = weatherPoints.findIndex(pt => pt.isReturn);

  // Route-gradient color per column (same formula as elevation chart)
  const maxCum = weatherPoints.reduce((m, p) => Math.max(m, p._cum ?? 0), 0) || 1;

  weatherPoints.forEach((pt, i) => {
    const sv = getSavedCol(pt, i, saved);
    // For speed mode: only col-0 uses saved/default; others are cascaded after render
    const date = sv?.date || todayStr;
    const hour = sv?.hour != null ? parseInt(sv.hour) : nowHour;
    let displayElapsedH = pt._elapsedH || 0;
    if (perSegmentMode && displayElapsedH > 0) {
      // Find the preceding waypoint's _elapsedH and show segment-relative time
      let prevWpElapsed = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (weatherPoints[j]?.isWaypoint) {
          prevWpElapsed = weatherPoints[j]._elapsedH || 0;
          break;
        }
      }
      displayElapsedH = displayElapsedH - prevWpElapsed;
    }
    const elapsedBadge = (speedIntervalMode || segmentIntervalKm > 0) && displayElapsedH > 0
      ? `<span class="wt-elapsed-badge">${formatDuration(displayElapsedH)}</span>`
      : '';

    // Gradient position fraction (mirrors elevation chart logic)
    const xFrac = Math.max(0, Math.min(1, (pt._cum ?? 0) / maxCum));
    const t = roundTripMode ? (1 - Math.abs(2 * xFrac - 1)) : xFrac;
    const gradColor = interpolateRouteColor(t);

    let thClass = 'wt-col-head wt-th';
    if (pt.isReturn)     thClass += ' wt-return-col';
    if (!pt.isWaypoint)  thClass += ' wt-interval-col';
    if (i === firstReturnIdx) thClass += ' wt-return-start';

    const labelStyle = `style="color:${gradColor}"`;
    const thStyle = pt.isWaypoint
      ? `style="border-top:2px solid ${gradColor}40"`
      : `style="border-top:2px solid ${gradColor}20"`;

    const locked = !pt.isWaypoint;
    html += `
      <th class="${thClass}" data-idx="${i}"${pt.isReturn ? ' data-return="true"' : ''} ${thStyle}>
        <div class="wt-col-label" ${labelStyle}>${pt.label}${elapsedBadge}</div>
        <input type="date" class="wt-date-input" value="${date}"${locked ? ' disabled' : ''}>
        <div class="wt-time-row">
          <span class="wt-time-label">時:</span>
          <select class="wt-time-select"${locked ? ' disabled' : ''}>${timeOpts(hour)}</select>
        </div>
      </th>`;
  });

  html += '</tr></thead><tbody>';
  WEATHER_ROWS.forEach(row => {
    html += `<tr><td class="wt-label-cell wt-td">${row.label}</td>`;
    weatherPoints.forEach((pt, i) => {
      const returnClass = pt.isReturn ? ' wt-return-col' : '';
      const startClass  = i === firstReturnIdx ? ' wt-return-start' : '';
      html += `<td class="wt-data-cell wt-td${returnClass}${startClass}" data-col="${i}" data-key="${row.key}">—</td>`;
    });
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

  // On change: speed mode → delta-shift subsequent columns; otherwise → cascade interval
  // times from col-0; all modes → enforce waypoint ordering → save
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
    } else {
      syncIntervalTimesFromWP();
    }
    saveWeatherSettings();
  };
  container.querySelectorAll('.wt-date-input, .wt-time-select').forEach(el =>
    el.addEventListener('change', onTimeChange)
  );

  // Initial cascade + enforce on first render
  if (speedIntervalMode) cascadeWeatherTimes();
  else syncIntervalTimes();

  // Restore previously fetched weather data — read actual date/hour from DOM
  // (after cascade/enforce so keys match what was stored during the original fetch)
  weatherPoints.forEach((pt, colIdx) => {
    const th = container.querySelector(`.wt-col-head[data-idx="${colIdx}"]`);
    const dateStr = th?.querySelector('.wt-date-input')?.value;
    const hour    = parseInt(th?.querySelector('.wt-time-select')?.value ?? '0');
    if (!dateStr) return;
    const cached = cachedWeatherData[weatherCoordKey(pt.lat, pt.lng, dateStr, hour)];
    if (cached) {
      const cells = {};
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(cached, row.key);
        cells[row.key] = val;
        const cell = container.querySelector(`[data-col="${colIdx}"][data-key="${row.key}"]`);
        if (cell) cell.textContent = val;
      });
      saveWeatherCells(getSemanticKey(pt, colIdx), cells);
      if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && cached.weatherIcon) {
        mapManager.setWaypointWeather(pt.wpIndex, cached.weatherIcon);
      }
    } else {
      // Fallback: restore display values saved from a previous fetch
      const saved = savedWeatherCells[getSemanticKey(pt, colIdx)];
      if (saved) {
        WEATHER_ROWS.forEach(row => {
          const cell = container.querySelector(`[data-col="${colIdx}"][data-key="${row.key}"]`);
          if (cell && saved[row.key]) cell.textContent = saved[row.key];
        });
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
      if (e.target.closest('.wt-date-input, .wt-time-select, .wt-col-label')) return;
      highlightPoint(colIdx);
    });
    const labelEl = th.querySelector('.wt-col-label');
    if (labelEl) {
      labelEl.style.cursor = 'pointer';
      labelEl.title = '單擊高亮 · 雙擊編輯名稱';
      labelEl.addEventListener('click',    () => highlightPoint(colIdx));
      labelEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startLabelEdit(labelEl, pt); });
    }
  });
  container.querySelectorAll('.wt-data-cell').forEach(td => {
    td.style.cursor = 'pointer';
    td.addEventListener('click', () => highlightPoint(parseInt(td.dataset.col)));
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
  }

  // Always persist the rendered state so page reload restores it correctly
  // (covers the case where user never manually changes any date/time input)
  saveWeatherSettings();
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
      cachedWeatherData[weatherCoordKey(pt.lat, pt.lng, dateStr, hour)] = data;
      // Save after each point so partial data survives a mid-fetch page close
      localStorage.setItem(LS_WEATHER_CACHE_KEY, JSON.stringify(cachedWeatherData));
      const cells = {};
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(data, row.key);
        cells[row.key] = val;
        const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
        if (cell) { cell.textContent = val; cell.className = 'wt-data-cell wt-td'; }
      });
      saveWeatherCells(getSemanticKey(pt, i), cells);
      // Map weather icon only on outgoing waypoints (return shares the same marker)
      if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && data.weatherIcon)
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

  container.querySelectorAll('.wt-col-highlight')
    .forEach(el => el.classList.remove('wt-col-highlight'));

  const th = container.querySelector(`.wt-col-head[data-idx="${colIdx}"]`);
  if (th) {
    th.classList.add('wt-col-highlight');
    th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  container.querySelectorAll(`[data-col="${colIdx}"]`)
    .forEach(td => td.classList.add('wt-col-highlight'));
}

/**
 * Unified highlight: sync weather table, elevation chart, map marker,
 * and side-panel waypoint item for the given weather-column index.
 * All columns that share the same coordinate are highlighted together.
 */
function highlightPoint(colIdx) {
  if (colIdx < 0 || colIdx >= weatherPoints.length) return;
  const pt = weatherPoints[colIdx];

  // 1. Weather table — highlight every column at the same lat/lng
  const container = document.getElementById('weather-table-container');
  if (container) {
    container.querySelectorAll('.wt-col-highlight')
      .forEach(el => el.classList.remove('wt-col-highlight'));
    weatherPoints.forEach((p, i) => {
      if (Math.abs(p.lat - pt.lat) < 0.0002 && Math.abs(p.lng - pt.lng) < 0.0002) {
        const th = container.querySelector(`.wt-col-head[data-idx="${i}"]`);
        if (th) {
          th.classList.add('wt-col-highlight');
          if (i === colIdx) th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        container.querySelectorAll(`[data-col="${i}"]`)
          .forEach(td => td.classList.add('wt-col-highlight'));
      }
    });
  }

  // 2. Elevation chart — crosshair at this column's route position
  const sampledPts   = elevationProfile.points;
  const sampledDists = elevationProfile.distances;
  if (sampledPts && sampledPts.length > 1 && currentRouteCoords.length > 1) {
    let fullDist = 0;
    for (let j = 1; j < currentRouteCoords.length; j++)
      fullDist += haversineDistance(currentRouteCoords[j - 1], currentRouteCoords[j]);
    if (fullDist > 0) {
      const frac = Math.max(0, Math.min(1, (pt._cum || 0) / fullDist));
      const idx  = Math.round(frac * (sampledPts.length - 1));
      elevationProfile.showCrosshairAtIndex(idx);
    }
  }

  // 3. Map — highlight the physical waypoint marker (only one per wpIndex)
  if (pt.isWaypoint && pt.wpIndex !== undefined) {
    mapManager.highlightWaypoint(pt.wpIndex);
  } else {
    mapManager.clearWaypointHighlight();
    mapManager.showHoverMarker(pt.lat, pt.lng);
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
}

/** Remove all cross-view highlights. */
function clearAllHighlights() {
  document.querySelectorAll('.wt-col-highlight').forEach(el => el.classList.remove('wt-col-highlight'));
  document.querySelectorAll('.waypoint-item.wp-highlight').forEach(el => el.classList.remove('wp-highlight'));
  mapManager.clearWaypointHighlight();
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

  // Compute total distance along full route coords for fraction mapping
  let fullTotalDist = 0;
  for (let j = 1; j < currentRouteCoords.length; j++) {
    fullTotalDist += haversineDistance(currentRouteCoords[j - 1], currentRouteCoords[j]);
  }

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
      markers.push({ cumDistM, dataIdx, label: pt.label, colIdx, isWaypoint: pt.isWaypoint });
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

  // --- Unified interval mode (off / distance / pace) + activity wiring ---
  {
    const intervalModeEls    = document.querySelectorAll('input[name="interval-mode"]');
    const segmentInputEl     = document.getElementById('segment-interval-input');
    const speedActivityEl    = document.getElementById('speed-activity-select');
    const activityRow        = document.getElementById('interval-activity-row');
    const pacePanel          = document.getElementById('pace-params-panel');

    // Derive initial mode from saved state
    const initMode = speedIntervalMode ? 'pace' : (segmentIntervalKm > 0 ? 'distance' : 'off');
    const initRadio = document.getElementById(`interval-mode-${initMode}`);
    if (initRadio) initRadio.checked = true;
    if (segmentInputEl) {
      segmentInputEl.value    = String(segmentIntervalKm || 5);
      segmentInputEl.disabled = initMode !== 'distance';
    }
    if (speedActivityEl) speedActivityEl.value = speedActivity;

    const anyActive = initMode !== 'off';
    if (activityRow)    activityRow.style.display    = anyActive ? '' : 'none';
    if (pacePanel)      pacePanel.style.display      = anyActive ? '' : 'none';
    if (statTimeCard)   statTimeCard.style.display   = anyActive ? '' : 'none';
    if (statKcalCard)   statKcalCard.style.display   = anyActive ? '' : 'none';
    if (statIntakeCard) statIntakeCard.style.display = anyActive ? '' : 'none';

    let prevActivity = speedActivity;

    const applyIntervalMode = () => {
      const mode        = Array.from(intervalModeEls).find(r => r.checked)?.value || 'off';
      const newActivity = speedActivityEl?.value || 'hiking';

      // Convert custom flat pace proportionally on activity switch.
      // Always work in km/h internally; convert display value to/from current unit.
      if (newActivity !== prevActivity) {
        const flatEl = document.getElementById('pace-flat-input');
        const bodyEl = document.getElementById('pace-body-weight');
        const packEl = document.getElementById('pace-pack-weight');
        const rawDisplay = parseFloat(flatEl?.value);
        if (flatEl && !isNaN(rawDisplay) && flatEl.value !== '') {
          const currentKmh = paceUnit === 'shanhe' ? SHANHE_BASE / rawDisplay
            : paceUnit === 'minkm' ? 60 / rawDisplay
            : rawDisplay;
          const body = parseFloat(bodyEl?.value) || 70;
          const pack = parseFloat(packEl?.value) || 0;
          const prevDefault = defaultSpeed(prevActivity, body, pack);
          const newDefault  = defaultSpeed(newActivity,  body, pack);
          if (prevDefault > 0) {
            const newKmh = +(currentKmh / prevDefault * newDefault).toFixed(2);
            const newDisplay = paceUnit === 'shanhe'
              ? (SHANHE_BASE / newKmh).toFixed(2)
              : paceUnit === 'minkm'
              ? (60 / newKmh).toFixed(1)
              : newKmh.toFixed(2);
            flatEl.value = newDisplay;
            paceParams = { ...paceParams, flatPaceKmH: newKmh };
            localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(paceParams));
          }
        }
        prevActivity = newActivity;
      }

      // Update mode state
      speedIntervalMode = mode === 'pace';
      speedActivity     = newActivity;

      if (mode === 'distance') {
        const v = Math.min(100, Math.max(1, parseInt(segmentInputEl?.value) || 5));
        if (segmentInputEl) segmentInputEl.value = String(v);
        segmentIntervalKm = v;
      } else {
        segmentIntervalKm = 0;
      }

      if (segmentInputEl) segmentInputEl.disabled = mode !== 'distance';

      const active = mode !== 'off';
      if (activityRow)    activityRow.style.display    = active ? '' : 'none';
      if (pacePanel)      pacePanel.style.display      = active ? '' : 'none';
      if (statTimeCard)   statTimeCard.style.display   = active ? '' : 'none';
      if (statKcalCard)   statKcalCard.style.display   = active ? '' : 'none';
      if (statIntakeCard) statIntakeCard.style.display = active ? '' : 'none';

      // Update flat-pace placeholder for new activity (in current unit)
      const flatEl = document.getElementById('pace-flat-input');
      const bodyEl = document.getElementById('pace-body-weight');
      const packEl = document.getElementById('pace-pack-weight');
      if (flatEl) {
        const spd = defaultSpeed(speedActivity, parseFloat(bodyEl?.value) || 70, parseFloat(packEl?.value) || 0);
        flatEl.placeholder = paceUnit === 'shanhe'
          ? (SHANHE_BASE / spd).toFixed(2)
          : spd.toFixed(1);
      }

      localStorage.setItem(LS_SEGMENT_KEY,       String(segmentIntervalKm));
      localStorage.setItem(LS_SPEED_MODE_KEY,    speedIntervalMode ? '1' : '0');
      localStorage.setItem(LS_SPEED_ACTIVITY_KEY, speedActivity);

      updateTimeStat();
      updateIntermediateMarkers();
      renderWeatherPanel();
    };

    intervalModeEls.forEach(r  => r.addEventListener('change',  applyIntervalMode));
    if (speedActivityEl) speedActivityEl.addEventListener('change', applyIntervalMode);
    if (segmentInputEl)  segmentInputEl.addEventListener('change',  applyIntervalMode);
  }

  // --- Pace params panel wiring ---
  const paceParamsPanel   = document.getElementById('pace-params-panel');
  const paceFlatInput     = document.getElementById('pace-flat-input');
  const paceBodyWeight    = document.getElementById('pace-body-weight');
  const pacePackWeight    = document.getElementById('pace-pack-weight');
  const paceFatigueLevelEl = document.getElementById('pace-fatigue-level');
  const paceRestRow       = document.getElementById('pace-rest-row');
  const paceRestEvery     = document.getElementById('pace-rest-every');
  const paceRestMinutes   = document.getElementById('pace-rest-minutes');

  const paceUnitSelect = document.getElementById('pace-unit-select');

  /** Convert km/h → displayed value in current unit */
  const kmhToDisplay = (v) =>
    paceUnit === 'shanhe' ? +(SHANHE_BASE / v).toFixed(2)
    : paceUnit === 'minkm' ? +(60 / v).toFixed(1)
    : +v.toFixed(2);
  /** Convert displayed value → km/h */
  const displayToKmh = (v) =>
    paceUnit === 'shanhe' ? SHANHE_BASE / v
    : paceUnit === 'minkm' ? 60 / v
    : v;

  /** Sync placeholder and input constraints to current unit */
  const updateFlatPlaceholder = () => {
    if (!paceFlatInput) return;
    const body = parseFloat(paceBodyWeight?.value) || 70;
    const pack = parseFloat(pacePackWeight?.value) || 0;
    const spdKmh = defaultSpeed(speedActivity, body, pack);
    if (paceUnit === 'shanhe') {
      paceFlatInput.min       = '0.1';
      paceFlatInput.max       = '10';
      paceFlatInput.step      = '0.05';
      paceFlatInput.placeholder = (SHANHE_BASE / spdKmh).toFixed(2);
    } else if (paceUnit === 'minkm') {
      paceFlatInput.min       = '1';
      paceFlatInput.max       = '120';
      paceFlatInput.step      = '0.5';
      paceFlatInput.placeholder = (60 / spdKmh).toFixed(1);
    } else {
      paceFlatInput.min       = '0.5';
      paceFlatInput.max       = '80';
      paceFlatInput.step      = '0.5';
      paceFlatInput.placeholder = spdKmh.toFixed(1);
    }
  };

  // Restore saved paceParams to UI inputs
  const paceUnitSelectRestored = paceUnitSelect;
  if (paceUnitSelectRestored) paceUnitSelectRestored.value = paceUnit;

  // Restore flat pace in the current unit
  if (paceFlatInput) {
    const storedKmh = paceParams.flatPaceKmH;
    paceFlatInput.value = storedKmh != null ? String(kmhToDisplay(storedKmh)) : '';
  }
  if (paceBodyWeight)      paceBodyWeight.value      = paceParams.bodyWeightKg ?? 70;
  if (pacePackWeight)      pacePackWeight.value      = paceParams.packWeightKg ?? 0;
  if (paceFatigueLevelEl)  paceFatigueLevelEl.value  = paceParams.fatigueLevel ?? 'general';
  if (paceRestEvery)       paceRestEvery.value       = paceParams.restEveryH ?? 1.0;
  if (paceRestMinutes)     paceRestMinutes.value     = paceParams.restMinutes ?? 10;

  // Show/hide pace-rest-row: hide only when fatigue is fully disabled
  const applyFatigueToggle = () => {
    if (paceRestRow) paceRestRow.style.display = (paceFatigueLevelEl?.value === 'none') ? 'none' : '';
  };
  applyFatigueToggle();

  // Show/hide panel based on current speed mode state
  if (paceParamsPanel) paceParamsPanel.style.display = speedIntervalMode ? '' : 'none';

  // Read all pace inputs → paceParams (always in km/h internally) → save → recalc
  const onPaceParamChange = () => {
    const rawDisplay = parseFloat(paceFlatInput?.value);
    const flatKmh = (!isNaN(rawDisplay) && paceFlatInput?.value !== '')
      ? displayToKmh(rawDisplay)
      : null;
    paceParams = {
      flatPaceKmH:  flatKmh,
      bodyWeightKg: parseFloat(paceBodyWeight?.value)    || 70,
      packWeightKg: parseFloat(pacePackWeight?.value)    || 0,
      fatigueLevel: paceFatigueLevelEl?.value            || 'general',
      restEveryH:   parseFloat(paceRestEvery?.value)     || 1.0,
      restMinutes:  parseFloat(paceRestMinutes?.value)   || 10,
    };
    localStorage.setItem(LS_PACE_PARAMS_KEY, JSON.stringify(paceParams));
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
      const prevUnit = paceUnit;
      paceUnit = paceUnitSelect.value;
      localStorage.setItem(LS_PACE_UNIT_KEY, paceUnit);

      // Convert the currently displayed value to the new unit
      const rawDisplay = parseFloat(paceFlatInput?.value);
      if (!isNaN(rawDisplay) && paceFlatInput?.value !== '') {
        const kmh = prevUnit === 'shanhe' ? SHANHE_BASE / rawDisplay
          : prevUnit === 'minkm' ? 60 / rawDisplay
          : rawDisplay;
        const newDisplay = paceUnit === 'shanhe'
          ? (SHANHE_BASE / kmh).toFixed(2)
          : paceUnit === 'minkm'
          ? (60 / kmh).toFixed(1)
          : kmh.toFixed(2);
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
      perSegmentMode = perSegmentEl.checked;
      localStorage.setItem(LS_PER_SEGMENT_KEY, perSegmentMode ? '1' : '0');
      renderWeatherPanel();
    });
  }

  // --- Strict linear time checkbox ---
  const strictLinearEl = document.getElementById('strict-linear-enable');
  if (strictLinearEl) {
    strictLinearEl.checked = strictLinearMode;
    strictLinearEl.addEventListener('change', () => {
      strictLinearMode = strictLinearEl.checked;
      localStorage.setItem(LS_STRICT_LINEAR_KEY, strictLinearMode ? '1' : '0');
    });
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

  // Map action buttons
  document.getElementById('btn-fit-route')?.addEventListener('click', () => mapManager.fitToRoute());
  document.getElementById('btn-my-location')?.addEventListener('click', () => mapManager.goToMyLocation());

  setTimeout(() => {
    loadingScreen.classList.add('hidden');
  }, 800);
}

init();
