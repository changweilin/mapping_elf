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
import { YamlExporter } from './modules/yamlExporter.js';
import { WeatherService } from './modules/weatherService.js';
import { OfflineManager } from './modules/offlineManager.js';
import { MapPackExporter } from './modules/mapPackExporter.js';
import { MapPackImporter } from './modules/mapPackImporter.js';
import { formatDistance, formatElevation, formatCoords, showNotification, debounce, haversineDistance, interpolateRouteColor, interpolateReturnColor, tspOptimize } from './modules/utils.js';
import { ACTIVITY_PROFILES, DEFAULT_PACE_PARAMS, computeCumulativeTimes, computeHourlyPoints, computeTripStats, formatDuration, formatDurationHHMM, defaultSpeed, interpolateTimeAtDist } from './modules/paceEngine.js';

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

const LS_SEGMENT_KEY = 'mappingElf_segmentKm';
const LS_ROUNDTRIP_KEY = 'mappingElf_roundTrip';
const LS_OLOOP_KEY = 'mappingElf_oLoop';
const LS_WAYPOINTS_KEY = 'mappingElf_waypoints';
const LS_ROUTE_MODE_KEY = 'mappingElf_routeMode';
const LS_MAP_LAYER_KEY = 'mappingElf_mapLayer';
const LS_MAP_VIEW_KEY = 'mappingElf_mapView';
const LS_WEATHER_CACHE_KEY = 'mappingElf_weatherCache';
const LS_SPEED_MODE_KEY = 'mappingElf_speedMode';
const LS_SPEED_ACTIVITY_KEY = 'mappingElf_speedActivity';
const LS_PACE_PARAMS_KEY = 'mappingElf_paceParams';
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

/**
 * 上河速度 base: S=1.0 corresponds to 3.0 km/h on flat terrain.
 * Based on Taiwan mountain hiking convention (five-person heavy-pack group).
 * Conversion: V_km_h = SHANHE_BASE / S  ↔  S = SHANHE_BASE / V_km_h
 */
const SHANHE_BASE = 3.0;

let segmentIntervalKm = parseInt(localStorage.getItem(LS_SEGMENT_KEY) || '0') || 0;
let roundTripMode = localStorage.getItem(LS_ROUNDTRIP_KEY) === '1';
let oLoopMode = localStorage.getItem(LS_OLOOP_KEY) === '1';
if (roundTripMode && oLoopMode) { oLoopMode = false; localStorage.setItem(LS_OLOOP_KEY, '0'); }
let speedIntervalMode = localStorage.getItem(LS_SPEED_MODE_KEY) !== '0'; // default Pace ON (1 or null)
let speedActivity = localStorage.getItem(LS_SPEED_ACTIVITY_KEY) || 'hiking';
let perSegmentMode = localStorage.getItem(LS_PER_SEGMENT_KEY) === '1'; // default OFF
let strictLinearMode = localStorage.getItem(LS_STRICT_LINEAR_KEY) !== '0'; // default ON
let importAutoSortMode = localStorage.getItem(LS_IMPORT_AUTO_SORT_KEY) === '1'; // default OFF
let importAutoNameMode = localStorage.getItem(LS_IMPORT_AUTO_NAME_KEY) === '1'; // default OFF
let skipAutoGeocode = false;
let paceUnit = localStorage.getItem(LS_PACE_UNIT_KEY) || 'kmh'; // 'kmh' | 'minkm' | 'shanhe'
let windyLayer = localStorage.getItem(LS_WINDY_LAYER_KEY) || 'rain';
let windyModel = localStorage.getItem(LS_WINDY_MODEL_KEY) || 'ecmwf';
let collectiveMarked = localStorage.getItem(LS_COLLECTIVE_MARKED_KEY) !== '0'; // default true
let collectiveIntermediate = localStorage.getItem(LS_COLLECTIVE_INTERMEDIATE_KEY) !== '0'; // default true
let collectiveAll = localStorage.getItem(LS_COLLECTIVE_ALL_KEY) === '1'; // default false
let waypointCentering = localStorage.getItem(LS_WAYPOINT_CENTERING_KEY) !== '0'; // default true

const LS_SHOW_WP_ICON_KEY = 'mappingElf_showWpIcon';
const LS_SHOW_IM_ICON_KEY = 'mappingElf_showImIcon';
let showWpIcon = localStorage.getItem(LS_SHOW_WP_ICON_KEY) !== '0'; // default true
let showImIcon = localStorage.getItem(LS_SHOW_IM_ICON_KEY) !== null ? localStorage.getItem(LS_SHOW_IM_ICON_KEY) !== '0' : window.innerWidth > 768;

let paceParams = (() => {
  try { return { ...DEFAULT_PACE_PARAMS, ...JSON.parse(localStorage.getItem(LS_PACE_PARAMS_KEY) || 'null') }; }
  catch { return { ...DEFAULT_PACE_PARAMS }; }
})();

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


// =========== Initialize Modules ===========
const routeEngine = new RouteEngine();
const weatherService = new WeatherService();
const offlineManager = new OfflineManager();
const mapManager = new MapManager('map', onWaypointsChanged);

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
  const frozen = !!importedTrackMode;
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
  speedActivity = localStorage.getItem(LS_SPEED_ACTIVITY_KEY) || 'hiking';
  perSegmentMode = localStorage.getItem(LS_PER_SEGMENT_KEY) === '1';
  strictLinearMode = localStorage.getItem(LS_STRICT_LINEAR_KEY) !== '0';
  importAutoSortMode = localStorage.getItem(LS_IMPORT_AUTO_SORT_KEY) === '1';
  importAutoNameMode = localStorage.getItem(LS_IMPORT_AUTO_NAME_KEY) === '1';
  paceUnit = localStorage.getItem(LS_PACE_UNIT_KEY) || 'kmh';
  windyLayer = localStorage.getItem(LS_WINDY_LAYER_KEY) || 'rain';
  windyModel = localStorage.getItem(LS_WINDY_MODEL_KEY) || 'ecmwf';
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

  // Update UI components that depend on these globals
  routeEngine.setMode(localStorage.getItem(LS_ROUTE_MODE_KEY) || 'hiking');
  const modeRadio = document.querySelector(`input[name="route-mode"][value="${routeEngine.mode}"]`);
  if (modeRadio) modeRadio.checked = true;

  const savedLayer = localStorage.getItem(LS_MAP_LAYER_KEY) || 'topo';
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

  // Refresh UI
  syncTrackModeUI();
  updateFlatPlaceholder();
  updateMapWeatherIconVisibility();
  renderWeatherPanel();
}

const elevationProfile = new ElevationProfile(
  'elevation-chart',
  'chart-empty',
  (lat, lng, color) => mapManager.showHoverMarker(lat, lng, color),
  (colIdx, isIconClick) => {
    if (isIconClick) {
      // Open the specific weather card for this marker using collective rules.
      handleWeatherIconInteraction(colIdx);
    } else {
      // Dot click: only highlight the point on the map/sidebar
      highlightPoint(colIdx);
    }
  }
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
  if (action === 'waypoint') {
    mapManager.addWaypoint(lat, lng);
    showNotification('已設為航點', 'success', 1200);
    return;
  }
  if (action === 'copy') {
    const text = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const done = (ok) => showNotification(ok ? `已複製座標 ${text}` : '複製失敗', ok ? 'success' : 'error', 1500);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done(true);
      } catch (e) { done(false); }
    }
    return;
  }
  if (action === 'weather') {
    if (!weatherPoints || weatherPoints.length === 0) {
      showNotification('尚無天氣資料,請先更新天氣', 'warning', 1800);
      return;
    }
    let minD = Infinity, closestIdx = 0;
    for (let i = 0; i < weatherPoints.length; i++) {
      const d = haversineDistance([lat, lng], [weatherPoints[i].lat, weatherPoints[i].lng]);
      if (d < minD) { minD = d; closestIdx = i; }
    }
    highlightPoint(closestIdx);
    setWeatherCardMode(closestIdx, _wcLastMode);
    return;
  }
  if (action === 'windy') {
    const url = buildWindyUrl(lat, lng);
    window.open(url, '_blank', 'noopener');
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
const sidePanel = document.getElementById('side-panel');
const waypointList = document.getElementById('waypoint-list');
const alternativesList = document.getElementById('alternatives-list');
const altCount = document.getElementById('alt-count');

const btnTogglePanel = document.getElementById('btn-toggle-panel');
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const btnMyLocation = document.getElementById('btn-my-location');
const btnExportGpx = document.getElementById('btn-export-gpx');
const btnImportGpx = document.getElementById('btn-import-gpx');
const btnClearRoute = document.getElementById('btn-clear-route');
const btnReplanRoute = document.getElementById('btn-replan-route');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnResetDefaults = document.getElementById('btn-reset-defaults');
const gpxFileInput = document.getElementById('gpx-file-input');

const progressContainer = document.getElementById('download-progress-container');
const progressText = document.getElementById('download-progress-text');
const progressFill = document.getElementById('download-progress-fill');
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

const btnToggleElevation = document.getElementById('btn-toggle-elevation');

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
function updateFlatPlaceholder() {
  if (!paceFlatInput) return;
  const body = parseFloat(paceBodyWeight?.value) || 70;
  const pack = parseFloat(pacePackWeight?.value) || 0;
  const spdKmh = defaultSpeed(speedActivity, body, pack);
  if (paceUnit === 'shanhe') {
    paceFlatInput.min = '0.1';
    paceFlatInput.max = '10';
    paceFlatInput.step = '0.05';
    paceFlatInput.placeholder = (SHANHE_BASE / spdKmh).toFixed(2);
  } else if (paceUnit === 'minkm') {
    paceFlatInput.min = '1';
    paceFlatInput.max = '120';
    paceFlatInput.step = '0.5';
    paceFlatInput.placeholder = (60 / spdKmh).toFixed(1);
  } else {
    paceFlatInput.min = '0.5';
    paceFlatInput.max = '80';
    paceFlatInput.step = '0.5';
    paceFlatInput.placeholder = spdKmh.toFixed(1);
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
    collectiveMarked = collectiveMarkedEl.checked;
    localStorage.setItem(LS_COLLECTIVE_MARKED_KEY, collectiveMarked ? '1' : '0');
  });

  collectiveIntermediateEl?.addEventListener('change', () => {
    collectiveIntermediate = collectiveIntermediateEl.checked;
    localStorage.setItem(LS_COLLECTIVE_INTERMEDIATE_KEY, collectiveIntermediate ? '1' : '0');
  });

  collectiveAllEl?.addEventListener('change', () => {
    collectiveAll = collectiveAllEl.checked;
    localStorage.setItem(LS_COLLECTIVE_ALL_KEY, collectiveAll ? '1' : '0');
    syncCollectiveLock();
  });

  waypointCenteringEl?.addEventListener('change', () => {
    waypointCentering = waypointCenteringEl.checked;
    localStorage.setItem(LS_WAYPOINT_CENTERING_KEY, waypointCentering ? '1' : '0');
  });

  const showWpIconEl = document.getElementById('show-waypoint-weather-icon');
  if (showWpIconEl) {
    showWpIconEl.checked = showWpIcon;
    showWpIconEl.addEventListener('change', () => {
      showWpIcon = showWpIconEl.checked;
      localStorage.setItem(LS_SHOW_WP_ICON_KEY, showWpIcon ? '1' : '0');
      updateMapWeatherIconVisibility();
    });
  }

  const showImIconEl = document.getElementById('show-intermediate-weather-icon');
  if (showImIconEl) {
    showImIconEl.checked = showImIcon;
    showImIconEl.addEventListener('change', () => {
      showImIcon = showImIconEl.checked;
      localStorage.setItem(LS_SHOW_IM_ICON_KEY, showImIcon ? '1' : '0');
      updateMapWeatherIconVisibility();
    });
  }

  const importAutoSortEl = document.getElementById('import-auto-sort-enable');
  if (importAutoSortEl) {
    importAutoSortEl.checked = importAutoSortMode;
    importAutoSortEl.addEventListener('change', () => {
      importAutoSortMode = importAutoSortEl.checked;
      localStorage.setItem(LS_IMPORT_AUTO_SORT_KEY, importAutoSortMode ? '1' : '0');
    });
  }

  const importAutoNameEl = document.getElementById('import-auto-name-enable');
  if (importAutoNameEl) {
    importAutoNameEl.checked = importAutoNameMode;
    importAutoNameEl.addEventListener('change', () => {
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
    targetCols.forEach(idx => setWeatherCardMode(idx, targetMode));
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

function updateThemeIcons() {
  const isLight = document.documentElement.classList.contains('light-theme');
  if (isLight) {
    if (iconMoon) iconMoon.style.display = 'none';
    if (iconSun) iconSun.style.display = 'block';
  } else {
    if (iconMoon) iconMoon.style.display = 'block';
    if (iconSun) iconSun.style.display = 'none';
  }

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
// 初始設定 Icon
if (btnToggleTheme) {
  updateThemeIcons();
  btnToggleTheme.addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('light-theme');
    localStorage.setItem('mappingElf_theme', isLight ? 'light' : 'dark');
    updateThemeIcons();
  });
}

btnTogglePanel.addEventListener('click', () => sidePanel.classList.toggle('open'));

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

btnToggleElevation?.addEventListener('click', () => {
  const container = document.getElementById('elevation-chart-container');
  container.classList.toggle('collapsed');
  elevationProfile.toggleCollapse();
});

// Double-click on chart container to toggle collapse as well
document.getElementById('elevation-chart-container')?.addEventListener('dblclick', () => {
  const container = document.getElementById('elevation-chart-container');
  container.classList.toggle('collapsed');
  elevationProfile.toggleCollapse();
});


// 手機平板螢幕下，點擊地圖自動收合側拉面板
document.getElementById('map').addEventListener('click', () => {
  if (window.innerWidth <= 1024 && sidePanel.classList.contains('open')) {
    sidePanel.classList.remove('open');
  }
}, true);

btnMyLocation.addEventListener('click', () => {
  mapManager.goToMyLocation();
  showNotification('正在定位...', 'info');
});

btnExportGpx.addEventListener('click', openExportModal);
btnImportGpx.addEventListener('click', () => gpxFileInput.click());
btnResetDefaults?.addEventListener('click', () => {
  if (confirm('確定要全部回到預設值嗎？這將會清除目前的設置並重啟頁面。')) {
    resetToDefaults();
  }
});
gpxFileInput.addEventListener('change', importFile);

/** Show/hide the re-plan button based on whether we are in imported-track mode. */
function syncTrackModeUI() {
  if (btnReplanRoute) {
    btnReplanRoute.disabled = !importedTrackMode;
  }

  // Freeze route and pace parameter inputs when in imported track mode (except replan/clear)
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
    mapManager.setFrozen(frozen);
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
  const toRemove = [];
  if (importedTrackMode) {
    for (let i = 0; i < mapManager.waypoints.length; i++) {
      const meta = importedWaypointMeta[i];
      const label = meta?.label || "";
      if (/\s*[↺↻↩]$|\s*\(回程\)$/.test(label)) {
        toRemove.push(i);
      }
    }
  }

  importedTrackMode = false;
  importedIntermediatePoints = [];
  importedWaypointMeta = [];
  clearImportedTrackSession();
  syncTrackModeUI();
  // Clear the imported track polyline but keep waypoint markers
  mapManager.clearRoute();

  // Remove identified return waypoints backwards
  for (let i = toRemove.length - 1; i >= 0; i--) {
    mapManager.removeWaypoint(toRemove[i]);
  }

  // Clean remaining waypoint names (backward-compat or manual renames)
  for (let i = 0; i < mapManager.waypoints.length; i++) {
    const [lat, lng] = mapManager.waypoints[i];
    const key = _geocodeKey(lat, lng);
    if (waypointCustomNames[key]) {
      const old = waypointCustomNames[key];
      waypointCustomNames[key] = old.replace(/\s*[↺↻↩]$/, '').trim();
    }
  }
  try { localStorage.setItem(LS_CUSTOM_NAMES_KEY, JSON.stringify(waypointCustomNames)); } catch (_) { }

  // Trigger normal routing with the retained waypoints
  onWaypointsChanged(mapManager.waypoints);
  showNotification('重新規劃路線中…', 'info', 1500);
});

btnClearRoute.addEventListener('click', () => {
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
  cachedWeatherData = {};
  localStorage.removeItem(LS_WEATHER_CACHE_KEY);
  currentRouteCoords = [];
  currentElevations = [];
  lastWaypoints = [];
  pendingNewWaypointIndex = null;
  waypointCumDistM = [];
  delete window._pendingGpxDates;
  Object.keys(waypointCustomNames).forEach(k => delete waypointCustomNames[k]);
  localStorage.removeItem(LS_CUSTOM_NAMES_KEY);
  Object.keys(waypointPlaceNames).forEach(k => delete waypointPlaceNames[k]);
  localStorage.removeItem(LS_GEOCODE_KEY);
  localStorage.removeItem(LS_WAYPOINTS_KEY);
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
      const targets = getCollectiveIndices(activeColIdx);
      targets.forEach(idx => setWeatherCardMode(idx, nextMode));
      if (nextMode === 'full') {
        requestAnimationFrame(() => panMapToCenterFullCard(activeColIdx));
      }
      return;
    }
    if (k === 'arrowdown') {
      e.preventDefault();
      const targets = getCollectiveIndices(activeColIdx);
      targets.forEach(idx => closeWeatherCard(idx));
      return;
    }
  }

  // Undo/Redo/Search (requires Ctrl/Meta)
  if (!(e.ctrlKey || e.metaKey)) return;
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); historyUndo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); historyRedo(); }
});

// =========== Map Pack (.melmap) helpers ===========

function _estimateTileCountForMapPack() {
  if (currentRouteCoords.length < 2) return { count: 0, layer: null };
  const layerInfo = mapManager.getCurrentLayerInfo();
  if (!layerInfo) return { count: 0, layer: null };
  const bounds = L.latLngBounds(currentRouteCoords).pad(0.05);

  let total = 0;
  const hardMin = 8;
  const hardMax = Math.min(17, layerInfo.maxZoom);
  const MAX = 8000;
  for (let z = hardMin; z <= hardMax; z++) {
    let xMin = Math.floor(((bounds.getWest() + 180) / 360) * Math.pow(2, z));
    let xMax = Math.floor(((bounds.getEast() + 180) / 360) * Math.pow(2, z));
    const latRadN = (bounds.getNorth() * Math.PI) / 180;
    const latRadS = (bounds.getSouth() * Math.PI) / 180;
    let yMin = Math.floor(((1 - Math.log(Math.tan(latRadN) + 1 / Math.cos(latRadN)) / Math.PI) / 2) * Math.pow(2, z));
    let yMax = Math.floor(((1 - Math.log(Math.tan(latRadS) + 1 / Math.cos(latRadS)) / Math.PI) / 2) * Math.pow(2, z));
    if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
    if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
    const count = (xMax - xMin + 1) * (yMax - yMin + 1);
    if (total + count > MAX) break;
    total += count;
  }
  return { count: total, layer: mapManager.currentLayerName };
}

async function doExportMapPack(filenameBase, routeName = 'Mapping Elf Track') {
  const includeRoute = document.getElementById('mappack-inc-route').checked;
  const includeTiles = document.getElementById('mappack-inc-tiles').checked;
  const includeState = document.getElementById('mappack-inc-state').checked;
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
    ? GpxExporter.generate(collectExportData(), exportCoords, exportElevations, routeName)
    : null;

  progressContainer.classList.remove('hidden');

  try {
    const { blob, filename, tileCount } = await MapPackExporter.export({
      bounds,
      routeCoords: currentRouteCoords,
      layerInfo: layerInfo && { ...layerInfo, name: mapManager.currentLayerName },
      includeRoute,
      includeTiles,
      includeState,
      gpxXml,
      filenameBase,
      onProgress: (cur, total, phase) => {
        const pct = Math.round((cur / Math.max(total, 1)) * 100);
        progressText.textContent = phase === 'zip'
          ? `打包中 ${pct}%`
          : `圖磚 ${pct}% (${cur}/${total})`;
        progressFill.style.width = `${pct}%`;
      },
    });
    MapPackExporter.triggerDownload(blob, filename);
    const parts = [];
    if (includeRoute) parts.push('路線');
    if (includeTiles) parts.push(`${tileCount} 張圖磚`);
    if (includeState) parts.push('個人偏好');
    showNotification(`離線地圖包已匯出 (${parts.join('、')})`, 'success');
  } catch (err) {
    showNotification(err.message || '匯出失敗', 'error');
    console.error(err);
  } finally {
    progressContainer.classList.add('hidden');
    progressText.textContent = '0%';
    progressFill.style.width = '0%';
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

async function openMappackImportModal(file) {
  try {
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
      ? `（圖層:${parsed.manifest.layer},${parsed.manifest.tileCount} 張)`
      : '';

    const meta = document.getElementById('mappack-import-meta');
    if (meta) {
      const t = parsed.manifest.createdAt ? new Date(parsed.manifest.createdAt).toLocaleString() : '—';
      meta.textContent = `來源:${parsed.manifest.generator || '—'} · 建立:${t}`;
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
  console.log('Mappack import confirm clicked');

  const restoreRoute = document.getElementById('mappack-restore-route').checked;
  const restoreTiles = document.getElementById('mappack-restore-tiles').checked;
  const restoreState = document.getElementById('mappack-restore-state').checked;

  if (!restoreRoute && !restoreTiles && !restoreState) {
    showNotification('至少需勾選一項', 'warning');
    return;
  }

  const parsed = _pendingMappack;
  _closeMappackImportModal(); // Centralized close path handles body class removal

  // Use the global progress variables defined at the top of the file
  if (progressContainer) progressContainer.classList.remove('hidden');
  if (progressText) progressText.textContent = '準備還原...';
  if (progressFill) progressFill.style.width = '0%';

  try {
    console.log('Applying mappack...', { restoreRoute, restoreTiles, restoreState });
    const applied = await MapPackImporter.apply(parsed, {
      restoreRoute,
      restoreTiles,
      restoreState,
      onProgress: (cur, total, phase) => {
        const pct = Math.round((cur / Math.max(total, 1)) * 100);
        if (progressText) {
          progressText.textContent = phase === 'tiles'
            ? `還原圖磚 ${pct}% (${cur}/${total})`
            : `${pct}%`;
        }
        if (progressFill) progressFill.style.width = `${pct}%`;
      },
    });

    console.log('Mappack apply result:', applied);

    if (applied.layer) {
      mapManager.switchLayer(applied.layer);
      localStorage.setItem(LS_MAP_LAYER_KEY, applied.layer);
      layerBtns.forEach((b) => b.classList.toggle('active', b.dataset.layer === applied.layer));
      offlineManager.updateCacheInfo();
    }

    if (applied.stateApplied) {
      applySettingsFromStorage();
    }

    if (applied.gpxXml) {
      try {
        const result = GpxExporter.parse(applied.gpxXml);
        applyImportedResult(result);
      } catch (err) {
        showNotification('路線還原失敗', 'error');
        console.error('GPX parse failed during mappack import:', err);
      }
    }

    const parts = [];
    if (applied.gpxXml) parts.push('路線');
    if (applied.tileCount) parts.push(`${applied.tileCount} 張圖磚`);
    if (applied.stateApplied) parts.push('個人偏好');
    showNotification(`離線地圖包匯入完成 (${parts.join('、') || '無'})`, 'success');
  } catch (err) {
    showNotification(err.message || '匯入失敗', 'error');
    console.error('Mappack apply failed:', err);
  } finally {
    if (progressContainer) progressContainer.classList.add('hidden');
    if (progressText) progressText.textContent = '0%';
    if (progressFill) progressFill.style.width = '0%';
    _pendingMappack = null;
  }
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
  // Record this state change for undo/redo (no-op if suppressed or unchanged).
  historyRecord();

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

  // In imported-track mode, update the sidebar list but skip routing entirely.
  // The track polyline is managed directly; waypoints are decorative markers only.
  if (importedTrackMode) {
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
    if (waypoints.length === 1) {
      // Just 1 point, no route, but we still want to show weather
      mapManager.clearRoute();
      elevationProfile.clear();
      resetStats();
      hideAlternatives();
      currentRouteCoords = [];
      currentElevations = [];
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
      currentRouteCoords = [];
      currentElevations = [];
      allAlternatives = [];
      const _wc = document.getElementById('weather-table-container');
      if (_wc) _wc.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「更新天氣」</p></div>';
    }
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
    const isLoop = waypoints.length >= 3 && haversineDistance(waypoints[0], waypoints[waypoints.length - 1]) < 0.1;
    const routeWaypoints = roundTripMode && waypoints.length >= 2
      ? [...waypoints, ...waypoints.slice(0, -1).reverse()]
      : (oLoopMode && !isLoop && waypoints.length >= 2)
        ? [...waypoints, waypoints[0]]
        : waypoints;
    allAlternatives = await routeEngine.getAlternativeRoutes(routeWaypoints);

    if (allAlternatives.length > 0) {
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
  currentElevations = route.fullElevations || route.elevations;

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
  elevationProfile.updateWithData(route.sampledCoords, route.elevations, roundTripMode, turnaroundLL);

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
  pendingNewWaypointIndex = null;
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
        <span class="alt-card-label">${r.label}</span>
        ${i === 0 ? '<span class="alt-badge">推薦</span>' : ''}
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
  alternativesList.style.display = 'none';
  altCount.style.display = 'none';
  alternativesList.innerHTML = '';
  allAlternatives = [];
  selectedAltIndex = 0;
}

function updateWaypointList(waypoints) {
  const frozen = !!importedTrackMode;
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
      const cumM = waypointCumDistM[i];
      const distLabel = (cumM != null && cumM > 0) ? formatDistance(cumM) : '';
      return `
        <div class="waypoint-item ${frozen ? 'is-frozen' : ''}">
          <span class="wp-index ${cls}" style="background:${gradColor}">${i + 1}</span>
          <span class="wp-coords" title="${coords}" style="color:${gradColor}">
            <span class="wp-place-name">${displayName}</span>
            ${distLabel ? `<span class="wp-cum-dist">${distLabel}</span>` : ''}
          </span>
          <div class="wp-actions" style="${frozen ? 'display:none' : ''}">
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
      if (frozen || nameEl.querySelector('input')) return;
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

  const startDrag = (item, idx, clientX, clientY) => {
    dragItem = item;
    dragIndex = idx;
    item.classList.add('is-dragging');
    if (navigator.vibrate) navigator.vibrate(40);

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
    ghost.style.zIndex = '10000';
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = '0.8';
    document.body.appendChild(ghost);
    updateGhostPos(clientX, clientY);

    item.style.display = 'none';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  };

  const updateGhostPos = (x, y) => {
    if (!ghost) return;
    ghost.style.left = `${x - 20}px`;
    ghost.style.top = `${y - 20}px`;
  };

  const onMove = (e) => {
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    updateGhostPos(cx, cy);

    // Removal detection: drag out of the route planning area (side-panel)
    const rect = sidePanel.getBoundingClientRect();
    const out = cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom;
    if (ghost) ghost.classList.toggle('drag-to-remove', out);

    if (out) return;

    // Sorting logic
    const items = Array.from(waypointList.querySelectorAll('.waypoint-item:not(.is-dragging)'));
    let bestAfter = null;
    let minDist = Infinity;
    items.forEach(it => {
      const rect = it.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const d = Math.abs(cy - mid);
      if (d < minDist) {
        minDist = d;
        bestAfter = (cy < mid) ? it : it.nextSibling;
      }
    });
    
    if (bestAfter !== placeholder) {
       waypointList.insertBefore(placeholder, bestAfter);
    }
  };

  const onEnd = (e) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);

    const cx = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const cy = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const rect = sidePanel.getBoundingClientRect();
    const out = cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom;

    if (out) {
      mapManager.removeWaypoint(dragIndex);
    } else {
      const items = Array.from(waypointList.childNodes);
      const newIdx = items.indexOf(placeholder);
      // Because we inserted placeholder, we need to map back to logic index
      const logicalItems = items.filter(n => n.nodeType === 1 && n !== placeholder && n !== dragItem);
      let targetIdx = logicalItems.indexOf(items[newIdx]);
      if (targetIdx === -1) targetIdx = logicalItems.length;

      const offset = targetIdx - dragIndex;
      if (offset !== 0) {
        // Move one step at a time via manager to update everything correctly
        // (Simplified re-sort implementation)
        const waypointsCopy = [...mapManager.waypoints];
        const [moved] = waypointsCopy.splice(dragIndex, 1);
        waypointsCopy.splice(targetIdx, 0, moved);
        mapManager.clearWaypoints();
        // temporarily disable callback to avoid spam
        const cb = mapManager.onWaypointChange;
        mapManager.onWaypointChange = () => {};
        waypointsCopy.forEach(wp => mapManager.addWaypoint(wp[0], wp[1]));
        mapManager.onWaypointChange = cb;
        onWaypointsChanged(mapManager.waypoints);
      } else {
        updateWaypointList(mapManager.waypoints);
      }
    }

    if (ghost) ghost.remove();
    if (placeholder) placeholder.remove();
    dragItem = null;
    ghost = null;
    placeholder = null;
  };

  waypointList.querySelectorAll('.waypoint-item').forEach((item, idx) => {
    // Shared long press logic for Mouse & Touch
    const triggerLP = (clientX, clientY) => {
      lpTimer = setTimeout(() => {
        lpTimer = null;
        startDrag(item, idx, clientX, clientY);
      }, 500);
    };
    const cancelLP = () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    };

    item.addEventListener('mousedown', (e) => {
      if (frozen || e.button !== 0 || e.target.closest('.wp-actions')) return;
      triggerLP(e.clientX, e.clientY);
      const onUp = () => { cancelLP(); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mouseup', onUp);
    });

    item.addEventListener('touchstart', (e) => {
        if (frozen || e.target.closest('.wp-actions')) return;
        const t = e.touches[0];
        triggerLP(t.clientX, t.clientY);
    }, { passive: true });
    
    item.addEventListener('touchend', cancelLP, { passive: true });
    item.addEventListener('touchmove', (e) => {
        // Cancel if move too much
        cancelLP();
    }, { passive: true });
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
    return;
  }
  const times = computeCumulativeTimes(elevs, dists, speedActivity, paceParams);
  const totalH = times[times.length - 1] || 0;
  statTime.textContent = formatDuration(totalH);

  const trip = computeTripStats(elevs, dists, speedActivity, paceParams);
  if (statKcal) statKcal.textContent = `${trip.kcalExpended.toLocaleString()} kcal`;
  if (statIntake) statIntake.textContent = `${trip.kcalSuggested.toLocaleString()} kcal`;
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

/** Add elapsedH hours to a date/hour, returning the new { date, hour }. */
function addHoursToDateTime(dateStr, startHour, elapsedH) {
  const totalMins = startHour * 60 + Math.round(elapsedH * 60);
  const addDays = Math.floor(totalMins / (24 * 60));
  const finalHour = Math.floor(totalMins / 60) % 24;
  // Use noon to avoid DST-boundary issues
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + addDays);
  const y = d.getFullYear();
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
  const startDate = container.querySelector('.wt-th-date[data-idx="0"] .wt-date-input')?.value || '';
  const startHour = parseInt(container.querySelector('.wt-th-time[data-idx="0"] .wt-time-select')?.value ?? '8');
  if (!startDate) return;

  weatherPoints.forEach((pt, i) => {
    if (i === 0) return;
    const { date, hour } = addHoursToDateTime(startDate, startHour, pt._elapsedH || 0);
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

    const prevMs = toMs(i - 1);
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
    const prevDi = container.querySelector(`.wt-th-date[data-idx="${i - 1}"] .wt-date-input`);
    const prevHs = container.querySelector(`.wt-th-time[data-idx="${i - 1}"] .wt-time-select`);
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
  for (let i = 1; i < heads.length; i++) {
    const pt = weatherPoints[i];
    if (!pt?.isWaypoint) continue;
    const prevDi = heads[i - 1].querySelector('.wt-date-input');
    const di = heads[i].querySelector('.wt-date-input');
    if (di && prevDi?.value) di.min = prevDi.value;
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

// =========== Export / Import (GPX / KML / YAML) ===========

const exportModal = document.getElementById('export-modal');
const btnExportConfirm = document.getElementById('btn-export-confirm');
const btnExportCancel = document.getElementById('btn-export-cancel');

function openExportModal() {
  const fmt = exportModal.querySelector('input[name="export-fmt"]:checked')?.value || 'gpx';
  // For non-melmap formats, a route is required. For melmap, we gate per-option
  // inside doExportMapPack so user can export state-only.
  if (fmt !== 'melmap' && currentRouteCoords.length === 0) {
    showNotification('請先建立路線', 'warning');
    return;
  }
  // Refresh tile-count estimate whenever the modal is opened.
  const info = document.getElementById('mappack-tiles-info');
  if (info) {
    const est = _estimateTileCountForMapPack();
    info.textContent = est.count > 0 ? `(約 ${est.count} 張,${est.layer})` : '';
  }

  // Pre-fill route name input
  const nameInput = document.getElementById('export-filename-input');
  if (nameInput) {
    nameInput.value = buildDefaultRouteName();
  }

  document.body.classList.add('modal-open');
  exportModal.classList.remove('hidden');
}

// Toggle melmap sub-options visibility when fmt radio changes.
exportModal?.querySelectorAll('input[name="export-fmt"]').forEach((r) => {
  r.addEventListener('change', () => {
    const sub = document.getElementById('melmap-sub-options');
    if (sub) sub.style.display = r.checked && r.value === 'melmap' ? '' : sub.style.display;
    // Hide if a non-melmap radio is now checked.
    const checked = exportModal.querySelector('input[name="export-fmt"]:checked')?.value;
    if (sub) sub.style.display = checked === 'melmap' ? '' : 'none';
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
btnExportConfirm?.addEventListener('click', () => {
  const fmt = exportModal.querySelector('input[name="export-fmt"]:checked')?.value || 'gpx';
  if (fmt === 'melmap') {
    const includeRoute = document.getElementById('mappack-inc-route').checked;
    const includeTiles = document.getElementById('mappack-inc-tiles').checked;
    const includeState = document.getElementById('mappack-inc-state').checked;
    if (!includeRoute && !includeTiles && !includeState) {
      showNotification('請至少勾選一項離線地圖包內容', 'warning');
      return;
    }
    if ((includeRoute || includeTiles) && currentRouteCoords.length === 0) {
      showNotification('匯出路線/圖磚前請先建立路線', 'warning');
      return;
    }

    const nameInput = document.getElementById('export-filename-input');
    const routeName = nameInput ? nameInput.value.trim() : buildDefaultRouteName();

    closeExportModal();
    doExportMapPack(buildExportFilenameBase(), routeName);
    return;
  }
  closeExportModal();
  doExport(fmt);
});

// =========== Favorites ===========

const favoritesModal = document.getElementById('favorites-modal');
const favoritesReplaceModal = document.getElementById('favorites-replace-modal');

function _escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
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

      const cellMap = savedWeatherCells[getSemanticKey(pt)];
      if (cellMap) {
        const labelled = {};
        WEATHER_ROWS.forEach(r => {
          const v = cellMap[r.key];
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
  if (paceParamsPanel) paceParamsPanel.style.display = speedIntervalMode ? '' : 'none';

  if (typeof updateFlatPlaceholder === 'function') updateFlatPlaceholder();
}

function loadFavorite(fav) {
  if (!fav || !Array.isArray(fav.waypoints) || fav.waypoints.length < 2) {
    showNotification('最愛資料無效', 'error');
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
    localStorage.setItem(LS_SPEED_ACTIVITY_KEY, s.speedActivity || 'hiking');
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
    currentRouteCoords = [];
    currentElevations = [];
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
  showNotification(`已載入「${fav.name}」`, 'success');
}

function deleteFavorite(id) {
  const n = favorites.length;
  favorites = favorites.filter(f => f.id !== id);
  if (favorites.length !== n) {
    persistFavorites();
    renderFavoritesList();
    showNotification('已刪除', 'info', 1200);
  }
}

function openFavoritesModal() {
  if (!favoritesModal) return;
  renderFavoritesList();
  document.body.classList.add('modal-open');
  favoritesModal.classList.remove('hidden');
}

function closeFavoritesModal() {
  if (!favoritesModal) return;
  document.body.classList.remove('modal-open');
  favoritesModal.classList.add('hidden');
}

function closeReplaceModal() {
  if (!favoritesReplaceModal) return;
  favoritesReplaceModal.classList.add('hidden');
}

function renderFavoritesList() {
  const container = document.getElementById('favorites-list');
  if (!container) return;
  if (favorites.length === 0) {
    container.innerHTML = '<div class="empty-hint">尚未加入任何最愛</div>';
    return;
  }
  container.innerHTML = favorites.map(f => {
    const count = Array.isArray(f.waypoints) ? f.waypoints.length : 0;
    const dateStr = new Date(f.savedAt || Date.now()).toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    return `
      <div class="favorite-item" data-id="${_escapeHtml(f.id)}" role="button" tabindex="0">
        <div class="fav-info">
          <div class="fav-name">${_escapeHtml(f.name || '未命名路線')}</div>
          <div class="fav-meta">${count} 個航點 · ${_escapeHtml(dateStr)}</div>
        </div>
      </div>`;
  }).join('');
  _bindFavoriteItemInteractions(container);
}

// Whole favorite item = click to load; long-press + drag outside modal box = delete.
function _bindFavoriteItemInteractions(container) {
  const modalBox = favoritesModal?.querySelector('.modal-box');
  if (!modalBox) return;

  container.querySelectorAll('.favorite-item').forEach(item => {
    let pressTimer = null;
    let dragging = false;
    let longPressed = false;
    let startX = 0, startY = 0;
    let capturedPointer = null;

    const resetVisual = () => {
      item.classList.remove('dragging', 'drag-over-delete');
      item.style.transform = '';
    };
    const cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    };
    const releaseCapture = () => {
      if (capturedPointer != null) {
        try { item.releasePointerCapture(capturedPointer); } catch (_) { }
        capturedPointer = null;
      }
    };
    const isOutsideBox = (x, y) => {
      const r = modalBox.getBoundingClientRect();
      return x < r.left || x > r.right || y < r.top || y > r.bottom;
    };

    item.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0) return;
      startX = e.clientX;
      startY = e.clientY;
      longPressed = false;
      dragging = false;
      cancelPress();
      pressTimer = setTimeout(() => {
        pressTimer = null;
        longPressed = true;
        dragging = true;
        item.classList.add('dragging');
        try { item.setPointerCapture(e.pointerId); capturedPointer = e.pointerId; } catch (_) { }
      }, 450);
    });

    item.addEventListener('pointermove', (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging) {
        // Movement before long-press triggers: cancel (user is scrolling or tap-drifting).
        if (pressTimer && Math.hypot(dx, dy) > 10) cancelPress();
        return;
      }
      item.style.transform = `translate(${dx}px, ${dy}px)`;
      item.classList.toggle('drag-over-delete', isOutsideBox(e.clientX, e.clientY));
    });

    const endPointer = (e) => {
      cancelPress();
      const wasDragging = dragging;
      dragging = false;
      releaseCapture();
      if (wasDragging) {
        if (isOutsideBox(e.clientX, e.clientY)) {
          const id = item.dataset.id;
          resetVisual();
          if (id) deleteFavorite(id);
          return;
        }
      }
      resetVisual();
    };
    item.addEventListener('pointerup', endPointer);
    item.addEventListener('pointercancel', () => { cancelPress(); dragging = false; releaseCapture(); resetVisual(); });

    item.addEventListener('click', (e) => {
      if (longPressed) {
        longPressed = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const id = item.dataset.id;
      const fav = favorites.find(f => f.id === id);
      if (fav) {
        closeFavoritesModal();
        loadFavorite(fav);
      }
    });

    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const id = item.dataset.id;
        const fav = favorites.find(f => f.id === id);
        if (fav) { closeFavoritesModal(); loadFavorite(fav); }
      }
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
  showNotification('已加入我的最愛', 'success');
}

function openReplaceFlow(pendingName) {
  if (!favoritesReplaceModal) return;
  const pending = captureFavorite(pendingName);
  const list = document.getElementById('favorites-replace-list');
  if (!list) return;
  list.innerHTML = favorites.map(f => `
    <button class="btn-secondary replace-target" data-id="${_escapeHtml(f.id)}">
      <div class="replace-target-name">取代「${_escapeHtml(f.name || '未命名路線')}」</div>
      <div class="replace-target-meta">${_escapeHtml(new Date(f.savedAt).toLocaleString('zh-TW'))}</div>
    </button>`).join('');
  list.querySelectorAll('.replace-target').forEach(btn => btn.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.id;
    favorites = favorites.map(f => f.id === id ? pending : f);
    persistFavorites();
    renderFavoritesList();
    closeReplaceModal();
    showNotification('已取代最愛', 'success');
  }));
  favoritesReplaceModal.classList.remove('hidden');
}

document.getElementById('btn-favorite-add')?.addEventListener('click', handleAddFavorite);
document.getElementById('btn-favorite-open')?.addEventListener('click', openFavoritesModal);
document.getElementById('btn-favorites-close')?.addEventListener('click', closeFavoritesModal);
document.getElementById('btn-favorites-replace-cancel')?.addEventListener('click', closeReplaceModal);

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
    const cached = date ? cachedWeatherData[weatherCoordKey(pt.lat, pt.lng, date, hour)] : null;
    const weather = {};
    if (cached) {
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(cached, row.key);
        if (val && val !== '—') weather[row.key] = { label: row.label, value: val };
      });
    } else {
      // Fallback: use saved display-cell values (survives date/coord changes and page reload)
      const savedCells = savedWeatherCells[getSemanticKey(pt)];
      if (savedCells) {
        WEATHER_ROWS.forEach(row => {
          const val = savedCells[row.key];
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

function doExport(fmt) {
  const nameInput = document.getElementById('export-filename-input');
  const routeName = (nameInput ? nameInput.value.trim() : null) || buildDefaultRouteName() || 'Mapping Elf Track';
  const filename = buildExportFilenameBase();

  const wpData = collectExportData();
  const { exportCoords, exportElevations } = getExportRouteData();

  if (fmt === 'gpx' || fmt === 'all') {
    const gpx = GpxExporter.generate(wpData, exportCoords, exportElevations, routeName);
    GpxExporter.download(gpx, `${filename}.gpx`);
  }

  if (fmt === 'kml' || fmt === 'all') {
    const kml = KmlExporter.generate(wpData, exportCoords, exportElevations, routeName);
    KmlExporter.download(kml, `${filename}.kml`);
  }

  if (fmt === 'yaml' || fmt === 'all') {
    const yaml = YamlExporter.generate(wpData, routeName);
    YamlExporter.download(yaml, `${filename}.yaml`);
  }

  const label = fmt === 'all' ? 'GPX + KML + YAML' : fmt.toUpperCase();
  showNotification(`${label} 檔案已匯出`, 'success');
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
      waypointMeta: importedWaypointMeta,
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
function restoreImportedTrack(session) {
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
  currentRouteCoords = coords;
  currentElevations = elevations;

  if (waypoints.length > 0) {
    skipAutoGeocode = true;
    mapManager.setWaypointsFromImport(waypoints);
    skipAutoGeocode = false;
  }

  elevationProfile.updateWithData(coords, elevations);
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
 * Apply a parsed import result (from GpxExporter / KmlExporter / YamlExporter)
 * to the map — same semantics as the original inline importFile logic.
 * Extracted so that .melmap imports can reuse it.
 */
function applyImportedResult(result) {
  // Bulk import: suppress per-waypoint history entries and record one entry
  // for the whole import at the end.
  const _wasSuppressed = history.suppressed;
  history.suppressed = true;
  try {
    _applyImportedResultCore(result);
  } finally {
    history.suppressed = _wasSuppressed;
  }
  historyRecord();
}

function _applyImportedResultCore(result) {
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
    currentRouteCoords = coords;
    currentElevations = elevations;

    // 4. Load waypoints as decorative markers (no routing triggered)
    if (result.waypoints.length > 0) {
      // 5. Store metadata BEFORE adding waypoints so that onWaypointsChanged callbacks
      // (triggered at the end of the batch) find the correct segmentDates for labels.
      if (result.segmentDates) {
        window._pendingGpxDates = result.segmentDates;
      }

      skipAutoGeocode = !importAutoNameMode;
      // Use batch setter for efficiency and consistent state
      mapManager.setWaypointsFromImport(result.waypoints);
      skipAutoGeocode = false;
      if (importAutoNameMode) geocodeWaypoints(result.waypoints);
    }

    // 6. Load elevation profile from track data (no elevation API call)
    elevationProfile.updateWithData(coords, elevations);

    // 7. Update stats from track data
    const totalDist = elevationProfile.distances.at(-1) || 0;
    const epStats = elevationProfile._calcStats();
    statDistance.textContent = formatDistance(totalDist);
    updateElevationStats(epStats);

    mapManager.fitToRoute();
    updateTimeStat();
    renderWeatherPanel();

    saveImportedTrackSession();

    const wpCount = result.waypoints.length;
    showNotification(
      `已匯入軌跡（${coords.length} 個點${wpCount > 0 ? `，${wpCount} 個航點` : ''}）`,
      'success'
    );
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

function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'melmap' || ext === 'zip') {
    openMappackImportModal(file);
    gpxFileInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      let result;
      if (ext === 'gpx') {
        result = GpxExporter.parse(evt.target.result);
      } else if (ext === 'kml') {
        result = KmlExporter.parse(evt.target.result);
      } else if (ext === 'yaml' || ext === 'yml') {
        result = YamlExporter.parse(evt.target.result);
      } else {
        showNotification('不支援的檔案格式', 'error');
        return;
      }
      applyImportedResult(result);
    } catch (err) {
      showNotification('檔案解析失敗', 'error');
      console.error(err);
    }
  };
  reader.readAsText(file);
  gpxFileInput.value = '';
}

// =========== Windy URL Builder ===========

function buildWindyUrl(lat, lng, date, hour) {
  const zoom = Math.round(mapManager.map.getZoom());
  const latF = lat.toFixed(3);
  const lngF = lng.toFixed(3);
  const layer = windyLayer;
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
    const th = container.querySelector(`.wt-col-head[data-idx="${col}"]`);
    const date = th?.querySelector('.wt-date-input')?.value || '';
    const hour = parseInt(th?.querySelector('.wt-time-select')?.value ?? '0');
    a.href = buildWindyUrl(weatherPoints[col].lat, weatherPoints[col].lng, date, hour);
  });
}

// =========== Weather Panel ===========

const WEATHER_ROWS = [
  { key: 'weather', label: '天氣' },
  { key: 'temp', label: '溫度' },
  { key: 'precipitation', label: '雨量' },
  { key: 'precipProb', label: '降雨機率' },
  { key: 'tempRange', label: '高/低' },
  { key: 'feelsLike', label: '體感' },
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
  { key: 'forecastTime', label: '預報時間' },
];

let weatherPoints = [];
const LS_WEATHER_KEY = 'mappingElf_weather';
const LS_WEATHER_CELLS_KEY = 'mappingElf_weatherCells';

/** Persisted display-cell values keyed by semantic column key */
let savedWeatherCells = (() => {
  try { return JSON.parse(localStorage.getItem(LS_WEATHER_CELLS_KEY) || '{}'); }
  catch { return {}; }
})();

/**
 * Stable semantic key for a weather column point, based on coordinates.
 * Rounds lat/lng to 2 decimal places (~550 m threshold at equator):
 *   - same location after minor adjustment → same key → cache preserved
 *   - significantly moved → different key → cache miss (stale data not shown)
 */
function getSemanticKey(pt) {
  const latK = pt.lat.toFixed(2);
  const lngK = pt.lng.toFixed(2);
  if (pt.isWaypoint) {
    return pt.isReturn ? `ret:${latK},${lngK}` : `wp:${latK},${lngK}`;
  }
  return `int:${latK},${lngK}`;
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
  for (let i = 0; i < waypoints.length; i++) {
    const [lat, lng] = waypoints[i];
    try {
      await enqueueGeocode(lat, lng);
    } catch (_) { /* swallow; next point still queues */ }
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
    case 'forecastTime': return v(data.forecastTime, '—');
    case 'weather': return `${data.weatherIcon || ''} ${data.weatherDesc || '—'}`.trim();
    case 'temp': return v(data.temp, data.tempMax);
    case 'tempRange': return (data.tempMax || data.tempMin) ? `${v(data.tempMax, '—')} / ${v(data.tempMin, '—')}` : '—';
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
    default: return '—';
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
  const cols = [];
  weatherPoints.forEach((pt, i) => {
    const thDate = container.querySelector(`.wt-th-date[data-idx="${i}"]`);
    const thTime = container.querySelector(`.wt-th-time[data-idx="${i}"]`);
    const entry = {
      date: thDate?.querySelector('.wt-date-input')?.value || '',
      hour: thTime?.querySelector('.wt-time-select')?.value ?? '8',
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
  const N = weatherPoints.length;
  console.log(`shiftAllDates deltaDays=${deltaDays} deltaHours=${deltaHours} N=${N}`);
  for (let i = 0; i < N; i++) {
    if (!weatherPoints[i]?.isWaypoint) continue;
    const th = container.querySelector(`.wt-col-head[data-idx="${i}"]`);
    if (th) {
      const currentMs = colToMs(th);
      const newMs = currentMs + deltaMs;
      console.log(`  Updating col ${i}: currentMs=${currentMs} -> newMs=${newMs}`);
      setColToMs(th, newMs);
    }
  }

  syncIntervalTimes();
  saveWeatherSettings();
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
    console.log(`shiftToNow day: curDate=${curDate} today=${today.toISOString()} deltaDays=${deltaDays}`);
    if (deltaDays !== 0) shiftAllDates(deltaDays, 0);
  } else {
    const hs = container.querySelector(`.wt-th-time[data-idx="${idx}"] .wt-time-select`);
    const curHour = parseInt(hs?.value ?? '');
    console.log(`shiftToNow hour: curHour=${curHour} nowHour=${now.getHours()}`);
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
    console.log('Delegated click caught:', btn.dataset.action);
    switch (btn.dataset.action) {
      case 'fetch': fetchAllWeatherData({ force: true }); break;
      case 'day-minus': shiftAllDates(-1, 0); break;
      case 'day-plus': shiftAllDates(+1, 0); break;
      case 'day-now': shiftToNow('day'); break;
      case 'hour-minus': shiftAllDates(0, -1); break;
      case 'hour-plus': shiftAllDates(0, +1); break;
      case 'hour-now': shiftToNow('hour'); break;
    }
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
    return Math.max(MIN_H, window.innerHeight - toolbarH);
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
    }
    if (h > 0) {
      // Allow full range so dbl-click collapsed/expanded states persist across reloads.
      const clamped = Math.max(0, Math.min(getMaxPanelH(), h));
      panel.style.height = `${clamped}px`;
      document.documentElement.style.setProperty('--bottom-panel-height', `${clamped}px`);
    }
  };

  // Restore saved height (ratio-based)
  if (localStorage.getItem(LS_PANEL_HEIGHT_RATIO_KEY) || localStorage.getItem(LS_PANEL_HEIGHT_KEY)) {
    applyPanelRatio();
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
    // Redraw chart so it fills the container correctly after layout changes.
    // Skip during active drag — chart.resize() is expensive and would be called
    // on every pixel of movement, causing stutter. The drag-end path handles it.
    if (!panel._resizing)
      requestAnimationFrame(() => elevationProfile?.chart?.resize());
  }).observe(panel);

  if (!handle) return;

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
  };
  const scheduleHeight = (clientY) => {
    pendingClientY = clientY;
    if (!rafId) rafId = requestAnimationFrame(flushHeight);
  };
  const cancelPending = () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    pendingClientY = null;
  };

  // Mouse
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    panel.style.transition = '';
    panel._resizing = true;
    document.body.classList.add('is-resizing');
    handle.classList.add('dragging');
    const onMove = (ev) => scheduleHeight(ev.clientY);
    const onUp = () => {
      cancelPending();
      panel._resizing = false;
      document.body.classList.remove('is-resizing');
      handle.classList.remove('dragging');
      savePanelRatio();
      mapManager.map.invalidateSize({ animate: false });
      requestAnimationFrame(() => elevationProfile?.chart?.resize());
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch
  handle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    panel.style.transition = '';
    panel._resizing = true;
    document.body.classList.add('is-resizing');
    handle.classList.add('dragging');
    const onMove = (ev) => scheduleHeight(ev.touches[0].clientY);
    const onEnd = () => {
      cancelPending();
      panel._resizing = false;
      document.body.classList.remove('is-resizing');
      handle.classList.remove('dragging');
      savePanelRatio();
      mapManager.map.invalidateSize({ animate: false });
      requestAnimationFrame(() => elevationProfile?.chart?.resize());
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
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
    const targetH = currentH > viewH / 2 ? COLLAPSE_H : expandH;
    panel.style.transition = 'height 0.25s ease';
    panel.style.height = `${targetH}px`;
    document.documentElement.style.setProperty('--bottom-panel-height', `${targetH}px`);
    const onEnd = () => {
      panel.style.transition = '';
      panel.removeEventListener('transitionend', onEnd);
      savePanelRatio();
      mapManager.map.invalidateSize({ animate: false });
      requestAnimationFrame(() => elevationProfile?.chart?.resize());
    };
    panel.addEventListener('transitionend', onEnd);
  };
  handle.addEventListener('dblclick', togglePanel);
  // Touch: detect double-tap within 300ms on the handle
  let lastTap = 0;
  handle.addEventListener('touchend', (e) => {
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
    mapManager.map.invalidateSize({ animate: false });
  });
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
      
      // Use Spherical Mercator projection for interpolation to ensure points 
      // overlap perfectly with the straight lines drawn by Leaflet's polyline.
      const p1 = L.Projection.SphericalMercator.project(L.latLng(coords[i - 1][0], coords[i - 1][1]));
      const p2 = L.Projection.SphericalMercator.project(L.latLng(coords[i][0], coords[i][1]));
      const projectedPoint = L.point(
        p1.x + frac * (p2.x - p1.x),
        p1.y + frac * (p2.y - p1.y)
      );
      const unprojected = L.Projection.SphericalMercator.unproject(projectedPoint);

      result.push({
        lat: unprojected.lat,
        lng: unprojected.lng,
        cumDistM: nextMarkM,
      });
      nextMarkM += intervalM;
    }
    cumDist += segDist;
  }
  return result;
}

/**
 * Project each imported intermediate point onto currentRouteCoords to derive
 * `{lat, lng, cumDistM}`. Returns [pts, totalDistM].
 */
function _projectImportedIntermediates() {
  const coords = currentRouteCoords;
  if (coords.length < 2 || importedIntermediatePoints.length === 0) return [[], 0];

  // Calculate cumulative distances for routeCoords
  const dists = [0];
  for (let i = 1; i < coords.length; i++) {
    dists.push(dists[i - 1] + haversineDistance(coords[i - 1], coords[i]));
  }
  const totalDistM = dists[dists.length - 1];

  let searchStartIdx = 0;
  const pts = importedIntermediatePoints.map((p) => {
    let minD = Infinity, minI = searchStartIdx;
    for (let j = searchStartIdx; j < coords.length; j++) {
      const d = haversineDistance([p.lat, p.lng], coords[j]);
      if (d < minD) {
        minD = d;
        minI = j;
      }
      if (d === 0) break;
    }
    searchStartIdx = minI; // Forward cursor
    return { lat: p.lat, lng: p.lng, cumDistM: dists[minI], label: p.label };
  });
  return [pts, totalDistM];
}

function updateIntermediateMarkers() {
  if (!weatherPoints || weatherPoints.length === 0) {
    mapManager.clearIntermediateMarkers();
    return;
  }

  const container = document.getElementById('weather-table-container');

  const pts = weatherPoints
    .map((p, i) => ({ pt: p, i }))
    .filter(x => !x.pt.isWaypoint)
    .map(x => {
      // Look up weather icon for intermediate point
      const dateStr = container?.querySelector(`.wt-th-date[data-idx="${x.i}"] .wt-date-input`)?.value;
      const hour = parseInt(container?.querySelector(`.wt-th-time[data-idx="${x.i}"] .wt-time-select`)?.value ?? '0');
      const cached = (dateStr) ? cachedWeatherData[weatherCoordKey(x.pt.lat, x.pt.lng, dateStr, hour)] : null;
      const weatherIcon = cached?.weatherIcon || savedWeatherCells[getSemanticKey(x.pt)]?.weather?.split(' ')[0] || null;

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
  const container = document.getElementById('weather-table-container');
  const pts = weatherPoints
    .map((p, i) => ({ pt: p, i }))
    .filter((x) => x.pt.isWaypoint && x.pt.isReturn)
    .map((x) => {
      const dateStr = container?.querySelector(`.wt-th-date[data-idx="${x.i}"] .wt-date-input`)?.value;
      const hour = parseInt(container?.querySelector(`.wt-th-time[data-idx="${x.i}"] .wt-time-select`)?.value ?? '0');
      const cached = (dateStr) ? cachedWeatherData[weatherCoordKey(x.pt.lat, x.pt.lng, dateStr, hour)] : null;
      const weatherIcon = cached?.weatherIcon || savedWeatherCells[getSemanticKey(x.pt)]?.weather?.split(' ')[0] || null;
      return {
        lat: x.pt.lat,
        lng: x.pt.lng,
        wpIndex: x.pt.wpIndex,
        label: x.pt.label,
        colIdx: x.i,
        color: _weatherPointGradColor(x.pt),
        weather: weatherIcon,
      };
    });
  mapManager.setReturnWaypoints(pts);
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
      for (let j = searchStart; j < coords.length; j++) {
        const d = haversineDistance(wps[i], coords[j]);
        if (d < minDist) { minDist = d; minIdx = j; }
        // Only break when we have an exact match (anchored endpoint) to avoid
        // a false-minimum from a curve that temporarily approaches then veers away.
        if (minDist === 0) break;
      }
      let cum = 0;
      for (let j = 1; j <= minIdx; j++) cum += haversineDistance(coords[j - 1], coords[j]);
      wpCumDist.push(cum);
      searchStart = minIdx;
    }
  } else {
    // No route coords — suppress all distance labels
    wps.forEach(() => wpCumDist.push(0));
  }
  // Expose for sidebar distance display
  waypointCumDistM = [...wpCumDist];

  // Compute pace cumulative times whenever any interval mode is active so that
  // distance-mode interval points also get meaningful _elapsedH values.
  const sampledPts = elevationProfile.points;
  const sampledElevs = elevationProfile.elevations;
  const sampledDists = elevationProfile.distances;
  let cumTimes = null;
  let fullTotalDistBuild = 0;
  for (let j = 1; j < coords.length; j++) fullTotalDistBuild += haversineDistance(coords[j - 1], coords[j]);
  if ((speedIntervalMode || segmentIntervalKm > 0) && sampledPts && sampledPts.length > 1 && sampledElevs.length > 1) {
    cumTimes = computeCumulativeTimes(sampledElevs, sampledDists, speedActivity, paceParams);
  }

  /** Get elapsed hours for a given cumDistM (full-route metres). */
  const getElapsedH = (cumDistM) => {
    if (!cumTimes || !sampledDists.length || fullTotalDistBuild === 0) return 0;
    // Map high-res distance to sampled distance space for pace lookup
    const fraction = Math.max(0, Math.min(1, cumDistM / (totalDistM || 1)));
    const mappedDist = fraction * (sampledDists[sampledDists.length - 1] || 0);
    return interpolateTimeAtDist(mappedDist, sampledDists, cumTimes);
  };

  /** Get elevation (metres) at a given cumDistM (full-route metres). */
  const getEleAt = (cumDistM) => {
    if (!sampledDists || !sampledDists.length || !sampledElevs || !sampledElevs.length) return null;
    const totalSampled = sampledDists[sampledDists.length - 1] || 0;
    if (totalSampled === 0 || totalDistM === 0) return sampledElevs[0] ?? null;
    // Map high-res distance to sampled distance space for elevation lookup
    const fraction = Math.max(0, Math.min(1, cumDistM / (totalDistM || 1)));
    return elevationProfile._interpolateElevAtCumM(fraction * totalSampled);
  };

  const all = [];

  if (importedTrackMode && coords.length > 1) {
    // Build cumulative distance index for the track polyline (used as
    // projection fallback when a marker doesn't carry its own cumDistM).
    const trackCum = [0];
    for (let j = 1; j < coords.length; j++) {
      trackCum.push(trackCum[j - 1] + haversineDistance(coords[j - 1], coords[j]));
    }

    // Forward-walk projection cursor.
    let projectCursor = 0;
    const projectCum = (lat, lng) => {
      const snap = projectMileage(coords, [lat, lng], projectCursor);
      projectCursor = snap.mileage;
      return snap.mileage;
    };

    const markers = [];
    wps.forEach((wp, i) => {
      // Prefer the persistent meta (survives across re-renders); fall back to
      // _pendingGpxDates for back-compat / edge cases where meta wasn't set.
      const meta = importedWaypointMeta[i]
        || (window._pendingGpxDates && window._pendingGpxDates[i])
        || {};
      markers.push({
        lat: wp[0], lng: wp[1], isWaypoint: true, wpIndex: i,
        fileOrder: meta.fileOrder ?? (i * 1000),
        ele: meta.ele ?? null,
        cumDistM: meta.cumDistM ?? null,
        label: meta.label ?? null,
      });
    });
    importedIntermediatePoints.forEach((p, i) => {
      markers.push({
        ...p, isWaypoint: false,
        fileOrder: p.fileOrder ?? (i * 1000 + 500)
      });
    });

    // Prefer the authoritative cumDistM stored in the file (Mapping-Elf
    // exports always include this) — it's the exact distance recorded at
    // export time, immune to projection error and ordering ambiguity.
    // Only fall back to fileOrder + sequential projection for third-party
    // files that lack cumDistM.
    const allHaveCum = markers.length > 0 && markers.every(
      m => typeof m.cumDistM === 'number' && Number.isFinite(m.cumDistM)
    );
    if (allHaveCum) {
      markers.sort((a, b) => a.cumDistM - b.cumDistM);
    } else {
      markers.sort((a, b) => a.fileOrder - b.fileOrder);
    }

    // Imported tracks are strictly processed as single-way. We do not use the UI
    // nav-mode (roundTripMode/oLoopMode) to synthesize return flags here.

    markers.forEach(m => {
      const cum = (typeof m.cumDistM === 'number' && Number.isFinite(m.cumDistM))
        ? m.cumDistM
        : projectCum(m.lat, m.lng);

      if (m.isWaypoint) {
        wpCumDist[m.wpIndex] = cum;
        waypointCumDistM[m.wpIndex] = cum;
        const k = _geocodeKey(m.lat, m.lng);
        const customName = waypointCustomNames[k];
        const geocodedName = waypointPlaceNames[k];
        const isRet = false; // Imported tracks always single-way

        // User-edited custom names win over labels restored from the imported
        // file — otherwise a fresh saveCustomName() reverts to the original
        // imported label on the next buildWeatherPoints() pass.
        const label = customName || m.label || geocodedName || getWaypointLabel(m.wpIndex, m.lat, m.lng, isRet);
        all.push({
          label, lat: m.lat, lng: m.lng, isWaypoint: true, wpIndex: m.wpIndex,
          isReturn: isRet,
          _cum: cum, _elapsedH: getElapsedH(cum),
          _ele: m.ele != null ? m.ele : getEleAt(cum),
        });
      } else {
        all.push({
          label: m.label || '—',
          lat: m.lat, lng: m.lng, isWaypoint: false,
          isReturn: false,
          _cum: cum, _elapsedH: getElapsedH(cum),
          _ele: m.ele != null ? m.ele : getEleAt(cum),
          weather: m.weather,
          windyUrl: m.windyUrl,
          _preserveLabel: !!m.label,
        });
      }
    });
  } else {
    // Legacy / Non-Import Batching logic
    // Add actual waypoints
    for (let i = 0; i < wps.length; i++) {
      const lat = wps[i][0], lng = wps[i][1];
      const label = getWaypointLabel(i, lat, lng, false);
      all.push({
        label, lat, lng, isWaypoint: true, wpIndex: i,
        isReturn: false,
        _cum: wpCumDist[i], _elapsedH: getElapsedH(wpCumDist[i]),
        _ele: getEleAt(wpCumDist[i]),
      });
    }
  }

  const hasImportedIntersects = importedTrackMode && importedIntermediatePoints.length > 0 && coords.length > 1;

  if (hasImportedIntersects) {
    // Imported intermediates were already merged in the unified sequential pass above.
    // Skip generating dynamic intervals.
  } else if (coords.length > 1) {
    // Construct integrated (full-trip) high-resolution track for interval calculations.
    // This ensures markers stay on-track even during mirroring / O-loops and avoids
    // the "sampled shortcut" deviation seen with 80-point elevation profiles.
    let integratedCoords = [...coords];
    if (roundTripMode && !importedTrackMode) {
      for (let i = coords.length - 2; i >= 0; i--) integratedCoords.push(coords[i]);
    } else if (oLoopMode && !importedTrackMode) {
      integratedCoords.push(coords[0]);
    }

    if (speedIntervalMode) {
      // Speed mode: intermediate points every 1 hour of travel time.
      // We pass the high-res integratedCoords + interpolated high-res elevations
      // so the pace engine calculates exact positions along the real track.
      const integratedDists = [0];
      for (let j = 1; j < integratedCoords.length; j++) {
        integratedDists.push(integratedDists[j - 1] + haversineDistance(integratedCoords[j - 1], integratedCoords[j]));
      }
      const integratedElevs = integratedCoords.map((_, i) => getEleAt(integratedDists[i]));

      let wpTimes = null;
      if (perSegmentMode) {
        const allWpCumDists = [...wpCumDist];
        if (roundTripMode && wps.length >= 2 && totalDistM > 0) {
          for (let i = wps.length - 2; i >= 0; i--) allWpCumDists.push(totalDistM - wpCumDist[i]);
        } else if (oLoopMode && wps.length >= 2 && totalDistM > 0) {
          allWpCumDists.push(totalDistM);
        }
        wpTimes = allWpCumDists.map(cum => getElapsedH(cum));
      }

      const hourlyPts = computeHourlyPoints(integratedCoords, integratedElevs, integratedDists, speedActivity, 1.0, paceParams, wpTimes);
      hourlyPts.forEach((pt) => {
        const hLabel = Number.isInteger(pt.estTimeH) ? `第 ${pt.estTimeH} 小時` : `${pt.estTimeH.toFixed(1)} 小時`;
        all.push({
          label: hLabel, lat: pt.lat, lng: pt.lng, isWaypoint: false,
          isReturn: pt.cumDistM > (wpCumDist[wps.length - 1] + 1e-3),
          _cum: pt.cumDistM, _elapsedH: pt.estTimeH,
          _ele: pt._ele ?? getEleAt(pt.cumDistM),
        });
      });
    } else if (segmentIntervalKm > 0) {
      // km-interval intermediate points using high-res integrated track
      const intermediates = computeIntermediatePoints(integratedCoords, segmentIntervalKm);
      intermediates.forEach((pt) => {
        const kmLabel = (pt.cumDistM / 1000 % 1 === 0)
          ? `${pt.cumDistM / 1000 | 0} km`
          : `${(pt.cumDistM / 1000).toFixed(1)} km`;
        all.push({
          label: kmLabel, lat: pt.lat, lng: pt.lng, isWaypoint: false,
          isReturn: pt.cumDistM > (wpCumDist[wps.length - 1] + 1e-3),
          _cum: pt.cumDistM, _elapsedH: getElapsedH(pt.cumDistM),
          _ele: getEleAt(pt.cumDistM),
        });
      });
    } else {
      // Fallback: auto-midpoints between each waypoint pair
      const wpIndices = [];
      let searchStart = 0;
      for (let i = 0; i < wps.length; i++) {
        let minDist = Infinity, minIdx = searchStart;
        for (let j = searchStart; j < coords.length; j++) {
          const d = haversineDistance(wps[i], coords[j]);
          if (d < minDist) { minDist = d; minIdx = j; }
          if (minDist === 0) break;
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
        all.push({
          label: `${labelA}→${labelB}`, lat: mc[0], lng: mc[1], isWaypoint: false,
          _cum: midCum, _elapsedH: getElapsedH(midCum),
          _ele: getEleAt(midCum),
        });

        if ((roundTripMode || oLoopMode) && !importedTrackMode) {
          const returnCumMid = totalDistM - midCum;
          all.push({
            label: `${labelA}→${labelB}`,
            lat: mc[0], lng: mc[1], // For round-trip, lat/lng is the same
            isWaypoint: false,
            isReturn: true,
            _cum: returnCumMid,
            _elapsedH: getElapsedH(returnCumMid),
            _ele: getEleAt(returnCumMid),
          });
        }
      }
    }
  }

  // --- Add Return Waypoints (Outbound already added above) ---
  if ((roundTripMode || oLoopMode) && !importedTrackMode && wps.length >= 2 && totalDistM > 0 && wpCumDist.length === wps.length) {
    if (roundTripMode) {
      for (let i = wps.length - 2; i >= 0; i--) {
        const lat = wps[i][0], lng = wps[i][1];
        const k = _geocodeKey(lat, lng);
        const effectivePlaceName = waypointCustomNames[k] || waypointPlaceNames[k];
        const outLabel = effectivePlaceName || (i === 0 ? '起點' : `航點 ${i + 1}`);
        const returnCum = totalDistM - wpCumDist[i];
        all.push({
          label: outLabel, lat, lng, isWaypoint: true, isReturn: true, wpIndex: i,
          _cum: returnCum, _elapsedH: getElapsedH(returnCum), _ele: getEleAt(returnCum),
        });
      }
    } else if (oLoopMode) {
      const i = 0;
      const lat = wps[i][0], lng = wps[i][1];
      const k = _geocodeKey(lat, lng);
      const effectivePlaceName = waypointCustomNames[k] || waypointPlaceNames[k];
      const returnCum = totalDistM;
      all.push({
        label: effectivePlaceName || '起點', lat, lng, isWaypoint: true, isReturn: true, wpIndex: i,
        _cum: returnCum, _elapsedH: getElapsedH(returnCum), _ele: getEleAt(returnCum),
      });
    }
  }

  // Sort by position along route
  all.sort((a, b) => {
    if (Math.abs(a._cum - b._cum) < 1e-3) {
      if (a.isWaypoint && !b.isWaypoint) return 1;
      if (!a.isWaypoint && b.isWaypoint) return -1;
      return 0;
    }
    return a._cum - b._cum;
  });

  // Relabel interval points as "n-t"
  // n = preceding waypoint's wpIndex (1-based); t = elapsed time (segment or cumulative)
  {
    const fmtT = (h) => {
      if (h <= 0) return '0';
      const v = Math.round(h * 10) / 10;
      return v % 1 === 0 ? String(v | 0) : v.toFixed(1);
    };
    let prevWpIdx = 0;
    let prevWpElapsedH = 0;
    all.forEach(pt => {
      if (pt.isWaypoint) {
        prevWpIdx = pt.wpIndex ?? 0;
        prevWpElapsedH = pt._elapsedH || 0;
      } else if (!pt._preserveLabel) {
        const displayH = perSegmentMode
          ? (pt._elapsedH || 0) - prevWpElapsedH
          : (pt._elapsedH || 0);
        const n = prevWpIdx;
        const prefix = pt.isReturn ? `r${n}` : `${n + 1}`;
        pt.label = `${prefix}-${fmtT(displayH)}`;
      }
    });
  }

  // Deduplicate: same label → append (2), (3), …
  deduplicateLabels(all);

  return all;
}

function computeWeatherPointPositions() {
  const N = weatherPoints.length;
  if (N === 0) return [];

  const totalDist = (currentRouteCoords.length > 1 && elevationProfile.distances.length > 0)
    ? elevationProfile.distances.at(-1)
    : (weatherPoints.at(-1)?._cum || 1);

  if (totalDist === 0) return weatherPoints.map((_, i) => N <= 1 ? 0.5 : i / (N - 1));

  // Use pre-calculated _cum distance instead of re-projecting coords (which fails on out-and-back)
  return weatherPoints.map(pt => (pt._cum || 0) / totalDist);
}

function renderWeatherPanel() {
  weatherPoints = buildWeatherPoints();
  const container = document.getElementById('weather-table-container');
  if (!container) return;

  if (weatherPoints.length === 0) {
    container.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「更新天氣」</p></div>';
    return;
  }

  // Prune savedWeatherCells: remove entries whose coordinate key no longer matches
  // any point in the current panel. This prevents stale data from accumulating in
  // localStorage when waypoints are moved far or deleted.
  {
    const validKeys = new Set(weatherPoints.map(p => getSemanticKey(p)));
    let pruned = false;
    Object.keys(savedWeatherCells).forEach(k => {
      if (!validKeys.has(k)) { delete savedWeatherCells[k]; pruned = true; }
    });
    if (pruned) {
      try { localStorage.setItem(LS_WEATHER_CELLS_KEY, JSON.stringify(savedWeatherCells)); } catch (_) { }
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

  const saved = loadWeatherSettings();
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowHour = now.getHours();
  const N = weatherPoints.length;

  // Proportional column widths aligned with elevation chart X axis
  const positions = computeWeatherPointPositions();
  const voronoi = positions.map((p, i) => {
    const left = i === 0 ? p : (p - positions[i - 1]) / 2;
    const right = i === N - 1 ? (1 - p) : (positions[i + 1] - p) / 2;
    return left + right;
  });
  const panelW = document.getElementById('bottom-panel')?.offsetWidth || window.innerWidth;
  const labelW = 68;
  const minColW = 110;
  const dataW = Math.max(panelW - labelW, N * minColW);
  const colWidths = voronoi.map(v => Math.max(v * dataW, minColW));

  const timeOpts = (sel) => Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}"${h === sel ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`
  ).join('');

  let html = `<table class="weather-table"><colgroup><col style="width:${labelW}px">`;
  colWidths.forEach(w => html += `<col style="width:${Math.round(w)}px">`);
  html += `</colgroup><thead>`;

  const firstReturnIdx = weatherPoints.findIndex(pt => pt.isReturn);

  // Track colTimes for Windy links later
  const colTimes = [];

  // --- Row 1: labels / fetch ---
  html += `<tr class="wt-header-row wt-header-row-label">
    <th class="wt-label-cell wt-th">
      <button class="wt-ctrl-fetch" data-action="fetch" title="更新天氣">
        <svg class="wt-ctrl-fetch-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="currentColor"/></svg>
        <span>更新天氣</span>
      </button>
    </th>`;

  weatherPoints.forEach((pt, i) => {
    const gradColor = _weatherPointGradColor(pt);
    const rgba = (alpha) => gradColor.replace('rgb', 'rgba').replace(')', `, ${alpha})`);

    let thClass = 'wt-col-head wt-th';
    if (pt.isReturn) thClass += ' wt-return-col';
    if (!pt.isWaypoint) thClass += ' wt-interval-col';
    if (i === firstReturnIdx) thClass += ' wt-return-start';

    const labelStyle = pt.isWaypoint
      ? `style="color:${gradColor}; font-weight: bold;"`
      : `style="color:${rgba(0.7)};"`;

    const thStyle = pt.isWaypoint
      ? `style="border-top: 3px solid ${rgba(0.8)}; background-color: var(--bg-tertiary); background-image: linear-gradient(to bottom, ${rgba(0.1)}, transparent);"`
      : `style="border-top: 2px solid ${rgba(0.2)};"`;

    let displayElapsedH = pt._elapsedH || 0;
    if (perSegmentMode && displayElapsedH > 0) {
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
      ? `<span class="wt-elapsed-badge">${formatDurationHHMM(displayElapsedH)}</span>`
      : '';

    html += `<th class="${thClass}" data-idx="${i}" ${thStyle}>
      <div class="wt-col-label" ${labelStyle}>${pt.label}${elapsedBadge}</div>
    </th>`;
  });
  html += `</tr>`;

  // --- Row 2: date / day-adj ---
  html += `<tr class="wt-header-row wt-header-row-date">
    <th class="wt-label-cell wt-th">
      <div class="wt-ctrl-adj-row" title="所有日期 ±1 天">
        <button class="wt-ctrl-adj" data-action="day-minus">−</button>
        <button class="wt-ctrl-now" data-action="day-now" title="將目前選取欄位設為今日,其他欄位同步對齊">今日</button>
        <button class="wt-ctrl-adj" data-action="day-plus">+</button>
      </div>
    </th>`;

  weatherPoints.forEach((pt, i) => {
    const sv = getSavedCol(pt, i, saved);
    const date = sv?.date || todayStr;
    const locked = strictLinearMode && !pt.isWaypoint;

    let thClass = 'wt-col-head wt-th wt-th-date';
    if (pt.isReturn) thClass += ' wt-return-col';
    if (!pt.isWaypoint) thClass += ' wt-interval-col';
    if (i === firstReturnIdx) thClass += ' wt-return-start';

    html += `<th class="${thClass}" data-idx="${i}">
      <input type="date" class="wt-date-input" value="${date}"${locked ? ' disabled' : ''}>
    </th>`;

    // Initialize colTimes for later use in Windy links
    colTimes[i] = { date };
  });
  html += `</tr>`;

  // --- Row 3: time / hour-adj ---
  html += `<tr class="wt-header-row wt-header-row-time">
    <th class="wt-label-cell wt-th">
      <div class="wt-ctrl-adj-row" title="所有時間 ±1 小時">
        <button class="wt-ctrl-adj" data-action="hour-minus">−</button>
        <button class="wt-ctrl-now" data-action="hour-now" title="將目前選取欄位設為現在時刻,其他欄位同步對齊">此時</button>
        <button class="wt-ctrl-adj" data-action="hour-plus">+</button>
      </div>
    </th>`;

  weatherPoints.forEach((pt, i) => {
    const sv = getSavedCol(pt, i, saved);
    const hour = sv?.hour != null ? parseInt(sv.hour) : nowHour;
    const locked = strictLinearMode && !pt.isWaypoint;

    let thClass = 'wt-col-head wt-th wt-th-time';
    if (pt.isReturn) thClass += ' wt-return-col';
    if (!pt.isWaypoint) thClass += ' wt-interval-col';
    if (i === firstReturnIdx) thClass += ' wt-return-start';

    html += `<th class="${thClass}" data-idx="${i}">
      <div class="wt-time-row">
        <span class="wt-time-label">時:</span>
        <select class="wt-time-select"${locked ? ' disabled' : ''}>${timeOpts(hour)}</select>
      </div>
    </th>`;

    // Finalize colTimes with hour
    colTimes[i].hour = hour;
  });
  html += `</tr></thead><tbody>`;

  // Windy link row
  html += '<tr class="wt-windy-row"><td class="wt-label-cell wt-td">Windy</td>';
  weatherPoints.forEach((pt, i) => {
    const returnClass = pt.isReturn ? ' wt-return-col' : '';
    const startClass = i === firstReturnIdx ? ' wt-return-start' : '';
    html += `<td class="wt-data-cell wt-td wt-windy-cell${returnClass}${startClass}" data-col="${i}">` +
      `<a class="wt-windy-link" href="${buildWindyUrl(pt.lat, pt.lng, colTimes[i].date, colTimes[i].hour)}" target="_blank" rel="noopener" title="在 Windy 開啟">` +
      `<img src="https://www.windy.com/favicon.ico" width="13" height="13" alt="Windy" class="windy-favicon">` +
      `<svg viewBox="0 0 24 24" width="11" height="11" style="opacity:0.7"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/></svg>` +
      `</a></td>`;
  });
  html += '</tr>';

  WEATHER_ROWS.forEach(row => {
    html += `<tr><td class="wt-label-cell wt-td">${row.label}</td>`;
    weatherPoints.forEach((pt, i) => {
      const returnClass = pt.isReturn ? ' wt-return-col' : '';
      const startClass = i === firstReturnIdx ? ' wt-return-start' : '';
      const cellStyle = !pt.isWaypoint ? ' style="opacity: 0.8;"' : '';
      html += `<td class="wt-data-cell wt-td${returnClass}${startClass}" data-col="${i}" data-key="${row.key}"${cellStyle}>—</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  // Re-bind controls directly to ensure responsiveness regardless of delegation status
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent header/column highlight click from triggering
      const action = btn.dataset.action;
      console.log('Direct button click:', action);
      switch (action) {
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
  const onTimeChange = (e) => {
    const th = e.target.closest('th');
    if (!th) return;

    if (strictLinearMode) {
      const idx = parseInt(th.dataset.idx);
      if (idx > 0) {
        const prevDate = container.querySelector(`.wt-th-date[data-idx="${idx - 1}"] .wt-date-input`)?.value;
        const curDate = container.querySelector(`.wt-th-date[data-idx="${idx}"] .wt-date-input`)?.value;
        const prevH = parseInt(container.querySelector(`.wt-th-time[data-idx="${idx - 1}"] .wt-time-select`)?.value ?? '0');
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
    }

    if (strictLinearMode) {
      if (speedIntervalMode) {
        const idx = parseInt(th.dataset.idx);
        const prevMs = parseInt(th.dataset.prevMs) || colToMs(th);
        const deltaMs = colToMs(th) - prevMs;
        if (deltaMs !== 0) {
          for (let j = idx + 1; j < heads.length; j++) {
            setColToMs(heads[j], colToMs(heads[j]) + deltaMs);
          }
        }
      } else {
        syncIntervalTimesFromWP();
      }
    }
    updateDateConstraints();
    saveWeatherSettings();
    th.dataset.prevMs = String(colToMs(th));
    refreshWindyLinks();
    fetchAllWeatherData({ onlyColIndex: parseInt(th.dataset.idx) });
  };
  container.querySelectorAll('.wt-date-input, .wt-time-select').forEach(el =>
    el.addEventListener('change', onTimeChange)
  );

  // Initial cascade + enforce on first render
  if (speedIntervalMode) cascadeWeatherTimes();
  else syncIntervalTimes();
  updateDateConstraints();
  refreshWindyLinks();

  // Restore previously fetched weather data — read actual date/hour from DOM
  // (after cascade/enforce so keys match what was stored during the original fetch)
  weatherPoints.forEach((pt, colIdx) => {
    const dateStr = container.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)?.value;
    const hour = parseInt(container.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`)?.value ?? '0');
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
      saveWeatherCells(getSemanticKey(pt), cells);
      if (pt.isWaypoint && !pt.isReturn && pt.wpIndex !== undefined && cached.weatherIcon) {
        mapManager.setWaypointWeather(pt.wpIndex, cached.weatherIcon);
      }
    } else {
      // Fallback: restore display values saved from a previous fetch
      const saved = savedWeatherCells[getSemanticKey(pt)];
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
      // Guard: ignore clicks that originate from the inline edit input
      labelEl.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        highlightPoint(colIdx);
      });
      if (pt.isWaypoint) {
        labelEl.title = '單擊高亮 · 雙擊編輯名稱';
        labelEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startLabelEdit(labelEl, pt); });
      } else {
        labelEl.title = '單擊高亮';
      }
    }
  });
  container.querySelectorAll('.wt-data-cell').forEach(td => {
    td.style.cursor = 'pointer';
    td.addEventListener('click', () => highlightPoint(parseInt(td.dataset.col)));
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
          cells[key] = val;
          const cell = container.querySelector(`[data-col="${colIdx}"][data-key="${key}"]`);
          if (cell) cell.textContent = val;
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
          saveWeatherCells(getSemanticKey(pt), cells);
        }
      }
    });

    window._pendingGpxDates = null;
    refreshWindyLinks();
  }

  // Always persist the rendered state so page reload restores it correctly
  // (covers the case where user never manually changes any date/time input)
  saveWeatherSettings();
}

/**
 * Automatically fetch weather for all points.
 * Debounced and checks for existing UI states to avoid conflicting fetches.
 */
let autoFetchTimeout = 0;
function autoFetchWeather(options = {}) {
  if (autoFetchTimeout) clearTimeout(autoFetchTimeout);
  autoFetchTimeout = setTimeout(() => {
    // Only auto-fetch if we are not already processing a route
    // and if the "Fetch" button is not currently disabled (meaning a fetch is in progress)
    const fetchBtn = document.querySelector('[data-action="fetch"]');
    if (!isProcessing && fetchBtn && !fetchBtn.disabled) {
      console.log('Triggering auto weather fetch...', options);
      fetchAllWeatherData(options);
    }
  }, 1000); // 1s delay to let everything settle
}

async function fetchAllWeatherData(options = {}) {
  const { force = false, onlyWaypointIndex = null, onlyColIndex = null } = options;
  console.log('fetchAllWeatherData triggered', { force, onlyWaypointIndex, onlyColIndex });
  if (weatherPoints.length === 0) { showNotification('請先建立路線', 'warning'); return; }

  const container = document.getElementById('weather-table-container');
  if (!container) return;

  saveWeatherSettings();
  const fetchBtn = document.querySelector('[data-action="fetch"]');
  if (fetchBtn) fetchBtn.disabled = true;

  for (let i = 0; i < weatherPoints.length; i++) {
    const pt = weatherPoints[i];

    // Filter by specific waypoint or column if requested
    if (onlyWaypointIndex !== null) {
        if (!pt.isWaypoint || pt.wpIndex !== onlyWaypointIndex) continue;
    }
    if (onlyColIndex !== null && i !== onlyColIndex) continue;

    if (fetchBtn) fetchBtn.textContent = `${i + 1}/${weatherPoints.length}`;

    const dateStr = container.querySelector(`.wt-th-date[data-idx="${i}"] .wt-date-input`)?.value;
    const hour = parseInt(container.querySelector(`.wt-th-time[data-idx="${i}"] .wt-time-select`)?.value ?? '8');
    if (!dateStr) continue;

    const cacheKey = weatherCoordKey(pt.lat, pt.lng, dateStr, hour);
    let data = cachedWeatherData[cacheKey];

    // If not forced and we have cache, just apply it and skip fetching
    if (!force) {
      if (data) {
        const cells = { _icon: data.weatherIcon };
        WEATHER_ROWS.forEach(row => {
          const val = getCellValue(data, row.key);
          cells[row.key] = val;
          const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
          if (cell) { cell.textContent = val; cell.classList.remove('loading', 'error'); }
        });
        saveWeatherCells(getSemanticKey(pt), cells);
        if (pt.isWaypoint && pt.wpIndex !== undefined && data.weatherIcon)
          mapManager.setWaypointWeather(pt.wpIndex, data.weatherIcon);
        
        // Update chart markers to show icon immediately
        updateElevationMarkers();
        updateIntermediateMarkers();
        continue;
      }
      
      // Also check if UI already restored this point's weather from map pack (savedWeatherCells)
      const semKey = getSemanticKey(pt);
      const existingCells = savedWeatherCells[semKey];
      if (existingCells && existingCells.weather && existingCells.weather !== '—') {
        const cell = container.querySelector(`[data-col="${i}"][data-key="weather"]`);
        if (cell && cell.textContent !== '...' && cell.textContent !== '—') {
          // Data is already populated correctly in the UI
          if (pt.isWaypoint && pt.wpIndex !== undefined && existingCells._icon) {
            mapManager.setWaypointWeather(pt.wpIndex, existingCells._icon);
          }
          updateElevationMarkers();
          updateIntermediateMarkers();
          continue;
        }
      }
    }

    WEATHER_ROWS.forEach(row => {
      const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
      if (cell) { cell.textContent = '...'; cell.classList.remove('error'); cell.classList.add('loading'); }
    });

    try {
      data = await weatherService.getWeatherAtPoint(pt.lat, pt.lng, dateStr, hour);
      cachedWeatherData[cacheKey] = data;
      // Save after each point so partial data survives a mid-fetch page close
      localStorage.setItem(LS_WEATHER_CACHE_KEY, JSON.stringify(cachedWeatherData));
      const cells = { _icon: data.weatherIcon };
      WEATHER_ROWS.forEach(row => {
        const val = getCellValue(data, row.key);
        cells[row.key] = val;
        const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
        if (cell) { cell.textContent = val; cell.classList.remove('loading', 'error'); }
      });
      saveWeatherCells(getSemanticKey(pt), cells);
      // Update map icon (shared between outbound/return return markers)
      if (pt.isWaypoint && pt.wpIndex !== undefined && data.weatherIcon)
        mapManager.setWaypointWeather(pt.wpIndex, data.weatherIcon);

      // Refresh chart markers to show icon immediately
      updateElevationMarkers();
      updateIntermediateMarkers();
    } catch (err) {
      console.warn(`Weather fetch failed for ${pt.label}:`, err.message);
      WEATHER_ROWS.forEach(row => {
        const cell = container.querySelector(`[data-col="${i}"][data-key="${row.key}"]`);
        if (cell) { cell.textContent = '—'; cell.classList.remove('loading'); cell.classList.add('error'); }
      });
    }

    if (i < weatherPoints.length - 1) await new Promise(r => setTimeout(r, 400));
  }

  if (fetchBtn) {
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = `<svg class="wt-ctrl-fetch-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="currentColor"/></svg><span>更新天氣</span>`;
  }
  showNotification('天氣資訊已更新', 'success', 2000);
}

// =========== Weather Card (Map Popup) ===========

// Map of colIdx -> state ('compact' | 'full') for currently open weather cards
let _wcStates = new Map();
// Last-seen card mode at close time — used so the cursor's "open weather card"
// re-uses the size the user last had open.
let _wcLastMode = 'full';

/**
 * Open (or toggle) the weather card popup for a point.
 * Default opens in compact mode.
 */
function openWeatherCard(colIdx) {
  // If already open, close it (toggle behavior)
  if (_wcStates.has(colIdx)) {
    closeWeatherCard(colIdx);
    return;
  }
  _wcStates.set(colIdx, 'compact');
  _renderWeatherCard(colIdx);
}

/**
 * Handle user click on a weather icon (map badge or chart marker).
 * Applies collective operation rules.
 */
function handleWeatherIconInteraction(colIdx) {
  if (colIdx < 0 || colIdx >= weatherPoints.length) return;

  const collectiveCols = getCollectiveIndices(colIdx);
  if (collectiveCols.length > 1) {
    // Collective toggle based on the state of the target point
    const isAlreadyOpen = _wcStates.has(colIdx);
    if (isAlreadyOpen) {
      collectiveCols.forEach(ci => closeWeatherCard(ci));
    } else {
      collectiveCols.forEach(ci => { if (!_wcStates.has(ci)) openWeatherCard(ci); });
      // Sync highlight so keyboard/centering targets this group
      highlightPoint(colIdx);
    }
  } else {
    // Single toggle
    openWeatherCard(colIdx);
    highlightPoint(colIdx);
  }
}

/** Close a specific weather card. */
function closeWeatherCard(colIdx) {
  const prev = _wcStates.get(colIdx);
  if (prev === 'compact' || prev === 'full') _wcLastMode = prev;
  _wcStates.delete(colIdx);
  mapManager.closeWeatherPopup(colIdx);
}

/** Set the card mode and re-render. */
function setWeatherCardMode(colIdx, mode) {
  if (mode === 'minimized') {
    closeWeatherCard(colIdx);
    return;
  }
  _wcStates.set(colIdx, mode);
  _renderWeatherCard(colIdx);
}

/** Navigate a specific card holder to the next/prev point that has weather data. */
function navigateWeatherCard(colIdx, delta) {
  // Find all column indices that have weather icons AND whose icon type is visible
  const colsWithWeather = [];
  const container = document.getElementById('weather-table-container');

  weatherPoints.forEach((pt, i) => {
    // Skip points whose icon type is hidden by the toggle
    if (!isPointIconVisible(i)) return;

    const dateStr = container?.querySelector(`.wt-th-date[data-idx="${i}"] .wt-date-input`)?.value;
    const hour = parseInt(container?.querySelector(`.wt-th-time[data-idx="${i}"] .wt-time-select`)?.value ?? '0');
    const cached = (dateStr) ? cachedWeatherData[weatherCoordKey(pt.lat, pt.lng, dateStr, hour)] : null;
    const icon = cached?.weatherIcon || savedWeatherCells[getSemanticKey(pt)]?.weather?.split(' ')[0] || null;
    
    if (icon) colsWithWeather.push(i);
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
  setWeatherCardMode(nextColIdx, mode);
  // highlightPoint handles mode-aware pan/centering
  highlightPoint(nextColIdx);
}

/**
 * Get weather data for a specific column.
 * Attempts: 1) cachedWeatherData  2) savedWeatherCells  3) fallback '—'
 */
function _getWeatherCardData(colIdx) {
  const pt = weatherPoints[colIdx];
  if (!pt) return null;

  const container = document.getElementById('weather-table-container');

  // Try to read date/hour from the weather table DOM
  let dateStr = null, hour = null;
  if (container) {
    dateStr = container.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)?.value;
    hour = parseInt(container.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`)?.value ?? '0');
  }
  // Fallback: today & now
  if (!dateStr) {
    const now = new Date();
    dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    hour = new Date().getHours();
  }

  // 1) Try exact cache hit
  const cached = cachedWeatherData[weatherCoordKey(pt.lat, pt.lng, dateStr, hour)];
  if (cached) {
    return { data: cached, pt, dateStr, hour, colIdx };
  }

  // 2) Try savedWeatherCells (display values)
  const saved = savedWeatherCells[getSemanticKey(pt)];
  if (saved) {
    return { cells: saved, pt, dateStr, hour, colIdx };
  }

  // 3) No data
  return { data: null, pt, dateStr, hour, colIdx };
}

/** Render a specific weather card. */
function _renderWeatherCard(colIdx) {
  const state = _wcStates.get(colIdx);
  if (!state || state === 'minimized') {
    mapManager.closeWeatherPopup(colIdx);
    return;
  }

  const info = _getWeatherCardData(colIdx);
  if (!info) {
    mapManager.closeWeatherPopup(colIdx);
    return;
  }

  const { data, cells, pt, dateStr, hour } = info;
  const isCompact = state === 'compact';
  const isFull = state === 'full';

  // Check if this card should be highlighted
  const curTh = document.querySelector('#weather-table-container .wt-col-head.wt-col-highlight');
  const isHighlighted = curTh && parseInt(curTh.dataset.idx) === colIdx;

  // Resolve display values
  const val = (key) => {
    if (data) return getCellValue(data, key);
    if (cells && cells[key]) return cells[key];
    return '—';
  };

  // Weather info
  const weatherStr = val('weather');
  const weatherParts = weatherStr.split(' ');
  const wIcon = weatherParts[0] || '❓';
  const wDesc = weatherParts.slice(1).join(' ') || '—';
  const temp = val('temp');
  const precipitation = val('precipitation');
  const precipProb = val('precipProb');
  const label = pt.label || (pt.isWaypoint ? `航點 ${pt.wpIndex + 1}` : '中繼點');

  // Build HTML with unique ID per column card. Use gradient color for card accent.
  const gradColor = _weatherPointGradColor(pt);
  const cardStyle = `--wc-accent: ${gradColor};`;
  let html = `<div class="weather-card${isFull ? ' full' : ''}${isHighlighted ? ' is-highlighted' : ''}" id="wc-root-${colIdx}" data-col-idx="${colIdx}" style="${cardStyle}">`;

  // Header
  const headerStyle = `background: ${gradColor.replace('rgb', 'rgba').replace(')', ', 0.1)')};`;
  html += `<div class="wc-header" style="${headerStyle}">`;
  html += `<span class="wc-title">${wIcon} ${label}</span>`;
  if (isFull) {
    html += `<button class="wc-btn q-prev" title="上一個點">`;
    html += `<svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor"/></svg></button>`;
    html += `<button class="wc-btn q-next" title="下一個點">`;
    html += `<svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor"/></svg></button>`;
  }
  html += `<button class="wc-btn q-toggle" title="${isCompact ? '展開詳細' : '收縮'}">`;
  html += `<svg viewBox="0 0 24 24"><path d="${isCompact
    ? 'M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z'
    : 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z'
  }" fill="currentColor"/></svg></button>`;
  html += `<button class="wc-btn q-close" title="關閉">`;
  html += `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg></button>`;
  html += `</div>`;

  // Body
  html += `<div class="wc-body">`;

  if (isCompact) {
    // Compact: Single row grid for values
    html += `<div class="wc-compact">`;
    html += `<div class="wc-c-row">`;
    html += `<span class="wc-c-val">${temp}</span>`;
    html += `<span class="wc-c-val">${precipitation}</span>`;
    html += `<span class="wc-c-val">${precipProb}</span>`;
    html += `</div>`;
    html += `</div>`;
  } else {
    html += `<div class="wc-weather-main"><span class="wc-weather-icon">${wIcon}</span><span class="wc-weather-desc">${wDesc}</span><span class="wc-weather-temp">${temp}</span></div>`;
  }
  if (isFull) {
    const CARD_ROWS = [
      { key: 'tempRange', label: '高/低溫' },
      { key: 'feelsLike', label: '體感溫度' },
      { key: 'precipitation', label: '雨量' },
      { key: 'precipProb', label: '降雨機率' },
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
      { key: 'forecastTime', label: '預報時間' },
    ];
    html += `<div class="wc-info-grid">`;
    CARD_ROWS.forEach(row => {
      const fullWidth = row.key === 'forecastTime' ? ' style="grid-column: span 2;"' : '';
      html += `<div class="wc-info-item"${fullWidth}><span class="wc-info-label">${row.label}</span><span class="wc-info-value">${val(row.key)}</span></div>`;
    });
    html += `</div>`;

    const windyUrl = buildWindyUrl(pt.lat, pt.lng, dateStr, hour);
    html += `<a class="wc-windy-btn" href="${windyUrl}" target="_blank" rel="noopener" title="在 Windy 開啟">`;
    html += `<img src="https://www.windy.com/favicon.ico" alt="Windy"><span>在 Windy 開啟</span>`;
    html += `<svg viewBox="0 0 24 24" width="12" height="12" style="opacity:0.6"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/></svg></a>`;
  }

  html += `</div></div>`;

  mapManager.openWeatherPopup(colIdx, html, (wrapper) => {
    _bindWeatherCardEvents(colIdx, wrapper);
  }, !pt.isWaypoint, pt.wpIndex);
}

/** Bind click and touch events to the weather card DOM. */
function _bindWeatherCardEvents(colIdx, wrapper) {
  const root = wrapper?.querySelector(`.weather-card`) || document.getElementById(`wc-root-${colIdx}`);
  if (!root) return;

  // Clicking the card highlights the point
  root.addEventListener('click', () => {
    highlightPoint(colIdx);
  });

  // Button clicks
  root.querySelector('.q-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const targets = getCollectiveIndices(colIdx);
    targets.forEach(idx => closeWeatherCard(idx));
  });
  root.querySelector('.q-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curMode = _wcStates.get(colIdx) || 'compact';
    const nextMode = curMode === 'compact' ? 'full' : 'compact';
    const targets = getCollectiveIndices(colIdx);
    targets.forEach(idx => setWeatherCardMode(idx, nextMode));
  });
  root.querySelector('.q-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateWeatherCard(colIdx, -1);
  });
  root.querySelector('.q-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateWeatherCard(colIdx, +1);
  });
  // Touch gestures: swipe detection
  let _touchStartX = 0, _touchStartY = 0;
  let _touchStartTime = 0;

  root.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    _touchStartX = touch.clientX;
    _touchStartY = touch.clientY;
    _touchStartTime = Date.now();
  }, { passive: true });

  root.addEventListener('touchend', (e) => {
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
        const targets = getCollectiveIndices(colIdx);
        targets.forEach(idx => setWeatherCardMode(idx, nextMode));
      } else {
        // Swipe down: close
        const targets = getCollectiveIndices(colIdx);
        targets.forEach(idx => closeWeatherCard(idx));
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
  const cardW = cardEl?.offsetWidth || 280;
  const cardH = cardEl?.offsetHeight || 260;
  const popupOffsetY = pt.isWaypoint ? 24 : 12;

  const { safeLeft, safeRight, safeTop, safeBottom } = _getMapSafeArea();

  if (safeRight - safeLeft < cardW + 8 || safeBottom - safeTop < cardH + popupOffsetY) {
    map.panTo([pt.lat, pt.lng], { animate: true });
    return;
  }

  // The popup wrapper sits with its bottom at marker_y - popupOffsetY (the
  // tip is hidden via CSS, so no extra gap is needed). Centre the card
  // vertically in the safe area, then place the marker directly below:
  //   card_center = marker_y - popupOffsetY - cardH/2 = safeCenterY
  const safeCenterX = (safeLeft + safeRight) / 2;
  const safeCenterY = (safeTop + safeBottom) / 2;
  const targetX = safeCenterX;
  const targetY = safeCenterY + cardH / 2 + popupOffsetY;

  const currentPointPx = map.latLngToContainerPoint([pt.lat, pt.lng]);
  const dx = currentPointPx.x - targetX;
  const dy = currentPointPx.y - targetY;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  map.panBy([dx, dy], { animate: true, duration: 0.25 });
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
function highlightPoint(colIdx) {
  if (colIdx < 0 || colIdx >= weatherPoints.length) return;

  // Toggle: clicking the already-highlighted column clears the highlight
  const curTh = document.querySelector(
    '#weather-table-container .wt-col-head.wt-col-highlight'
  );
  if (curTh && parseInt(curTh.dataset.idx) === colIdx) {
    clearAllHighlights();
    return;
  }

  const pt = weatherPoints[colIdx];

  // 1. Weather table — highlight exactly the clicked column
  highlightWeatherColumn(colIdx);

  // 2. Elevation chart — crosshair at this column's route position
  const sampledPts = elevationProfile.points;
  const sampledDists = elevationProfile.distances;
  if (sampledPts && sampledPts.length > 1 && currentRouteCoords.length > 1) {
    let fullDist = 0;
    for (let j = 1; j < currentRouteCoords.length; j++)
      fullDist += haversineDistance(currentRouteCoords[j - 1], currentRouteCoords[j]);
    if (fullDist > 0) {
      const frac = Math.max(0, Math.min(1, (pt._cum || 0) / fullDist));
      const idx = Math.round(frac * (sampledPts.length - 1));
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

  // 5. Map Centering — when a card is open, centre the card in the visible
  // safe area (so its top buttons stay clear of the toolbar and it sits
  // above the bottom-panel divider). Otherwise just centre the marker.
  const mode = _wcStates.get(colIdx);
  if (mode === 'full' || mode === 'compact') {
    panMapToCenterFullCard(colIdx);
  } else if (waypointCentering) {
    panMapToVisibleCenter([pt.lat, pt.lng]);
  }

  // 6. Weather Card — Highlight the card and bring to front
  document.querySelectorAll('.weather-card.is-highlighted').forEach(el => {
    el.classList.remove('is-highlighted');
    const popup = el.closest('.leaflet-popup');
    if (popup) popup.style.zIndex = '';
  });
  const card = document.getElementById(`wc-root-${colIdx}`);
  if (card) {
    card.classList.add('is-highlighted');
    const popup = card.closest('.leaflet-popup');
    if (popup) popup.style.zIndex = '1000';
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

      // Try to find weather icon for this point
      const container = document.getElementById('weather-table-container');
      const dateStr = container?.querySelector(`.wt-th-date[data-idx="${colIdx}"] .wt-date-input`)?.value;
      const hour = parseInt(container?.querySelector(`.wt-th-time[data-idx="${colIdx}"] .wt-time-select`)?.value ?? '0');
      const cached = (dateStr) ? cachedWeatherData[weatherCoordKey(pt.lat, pt.lng, dateStr, hour)] : null;
      let weatherIcon = cached?.weatherIcon || savedWeatherCells[getSemanticKey(pt)]?.weather?.split(' ')[0] || null;

      // Filter weather icons based on visibility settings
      if (pt.isWaypoint && !showWpIcon) weatherIcon = null;
      if (!pt.isWaypoint && !showImIcon) weatherIcon = null;

      markers.push({ cumDistM, dataIdx, label: pt.label, colIdx, isWaypoint: pt.isWaypoint, weatherIcon });
    }
  });
  elevationProfile.setWaypointMarkers(markers);
}

// =========== Init ===========

async function init() {
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
  const savedLayer = localStorage.getItem(LS_MAP_LAYER_KEY) || 'topo';
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
        roundTripMode = radio.value === 'roundtrip';
        oLoopMode = radio.value === 'oloop';
        localStorage.setItem(LS_ROUNDTRIP_KEY, roundTripMode ? '1' : '0');
        localStorage.setItem(LS_OLOOP_KEY, oLoopMode ? '1' : '0');
        if (mapManager.waypoints.length >= 2) onWaypointsChanged(mapManager.waypoints);
        else historyRecord();
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
    if (statKcalCard) statKcalCard.style.display = anyActive ? '' : 'none';
    if (statIntakeCard) statIntakeCard.style.display = anyActive ? '' : 'none';

    let prevActivity = speedActivity;

    const applyIntervalMode = () => {
      const mode = Array.from(intervalModeEls).find(r => r.checked)?.value || 'off';
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
          const newDefault = defaultSpeed(newActivity, body, pack);
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
      speedActivity = newActivity;

      if (mode === 'distance') {
        const v = Math.min(100, Math.max(1, parseInt(segmentInputEl?.value) || 5));
        if (segmentInputEl) segmentInputEl.value = String(v);
        segmentIntervalKm = v;
      } else {
        segmentIntervalKm = 0;
      }

      if (segmentInputEl) segmentInputEl.disabled = mode !== 'distance';

      const active = mode !== 'off';
      if (activityRow) activityRow.style.display = active ? '' : 'none';
      if (pacePanel) pacePanel.style.display = active ? '' : 'none';
      if (statTimeCard) statTimeCard.style.display = active ? '' : 'none';
      if (statKcalCard) statKcalCard.style.display = active ? '' : 'none';
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
      flatPaceKmH: flatKmh,
      bodyWeightKg: parseFloat(paceBodyWeight?.value) || 70,
      packWeightKg: parseFloat(pacePackWeight?.value) || 0,
      fatigueLevel: paceFatigueLevelEl?.value || 'general',
      restEveryH: parseFloat(paceRestEvery?.value) || 1.0,
      restMinutes: parseFloat(paceRestMinutes?.value) || 10,
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
      if (strictLinearMode) {
        if (speedIntervalMode) cascadeWeatherTimes();
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
      importAutoSortMode = importAutoSortEl.checked;
      localStorage.setItem(LS_IMPORT_AUTO_SORT_KEY, importAutoSortMode ? '1' : '0');
    });
  }

  // --- Import auto-name checkbox ---
  const importAutoNameEl = document.getElementById('import-auto-name-enable');
  if (importAutoNameEl) {
    importAutoNameEl.checked = importAutoNameMode;
    importAutoNameEl.addEventListener('change', () => {
      importAutoNameMode = importAutoNameEl.checked;
      localStorage.setItem(LS_IMPORT_AUTO_NAME_KEY, importAutoNameMode ? '1' : '0');
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
      windyLayer = windyLayerEl.value;
      localStorage.setItem(LS_WINDY_LAYER_KEY, windyLayer);
      refreshWindyLinks();
    });
  }
  const windyModelEl = document.getElementById('windy-model-select');
  if (windyModelEl) {
    windyModelEl.value = windyModel;
    windyModelEl.addEventListener('change', () => {
      windyModel = windyModelEl.value;
      localStorage.setItem(LS_WINDY_MODEL_KEY, windyModel);
      refreshWindyLinks();
    });
  }

  updateFlatPlaceholder();

  // Replay a pending .melmap GPX that was stashed just before a state-restore
  // reload. Parse + applyImportedResult will also call saveImportedTrackSession,
  // so subsequent reloads take the normal restore path below.
  const pendingGpx = (() => {
    try { return localStorage.getItem(LS_PENDING_GPX_KEY); } catch { return null; }
  })();
  if (pendingGpx) {
    try { localStorage.removeItem(LS_PENDING_GPX_KEY); } catch (_) { }
    try {
      const result = GpxExporter.parse(pendingGpx);
      applyImportedResult(result);
    } catch (err) {
      console.error('Pending GPX replay failed:', err);
    }
  }

  // Restore imported-track session first — if present, it fully reconstructs
  // the track polyline + waypoints + intermediates without triggering routing.
  const savedTrackSession = (() => {
    try { return JSON.parse(localStorage.getItem(LS_IMPORTED_TRACK_KEY) || 'null'); }
    catch { return null; }
  })();
  const trackRestored = pendingGpx ? true : (savedTrackSession ? restoreImportedTrack(savedTrackSession) : false);

  // Otherwise, fall back to normal waypoint-only restore (triggers route recalc).
  const savedWaypoints = trackRestored ? null : (() => {
    try { return JSON.parse(localStorage.getItem(LS_WAYPOINTS_KEY) || 'null'); }
    catch { return null; }
  })();
  if (savedWaypoints && savedWaypoints.length > 0) {
    skipAutoGeocode = true;
    mapManager.setWaypointsFromImport(savedWaypoints);
    skipAutoGeocode = false;
  } else if (!trackRestored && !savedView && navigator.geolocation) {
    // No saved state at all — pan to user's location
    navigator.geolocation.getCurrentPosition(
      (pos) => mapManager.map.setView([pos.coords.latitude, pos.coords.longitude], 13),
      () => { }
    );
  }

  // Keyword search (Nominatim forward-geocoding + direct lat,lng parser)
  initKeywordSearch();

  // Map action buttons
  document.getElementById('btn-fit-route')?.addEventListener('click', () => mapManager.fitToRoute());

  setTimeout(() => {
    loadingScreen.classList.add('hidden');
  }, 800);

  // Seed undo/redo history with the restored state as the baseline.
  historyInit();
  isInitialLoad = false;
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
        headers: { 'Accept-Language': 'zh-TW,zh,en', 'User-Agent': 'MappingElf/1.0' },
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
      headers: { 'Accept-Language': 'zh-TW,zh,en', 'User-Agent': 'MappingElf/1.0' },
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
    row.innerHTML = `
      <div class="search-result-text">
        <div class="search-result-name" title="${name.replace(/"/g, '&quot;')}">${name}</div>
        <div class="search-result-coord">${coordLine}</div>
      </div>
      <button class="search-result-add" title="加入為航點" ${frozen ? 'disabled' : ''}>+ 航點</button>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('search-result-add')) return;
      mapManager.map.setView([lat, lng], Math.max(mapManager.map.getZoom(), 14));
    });
    row.querySelector('.search-result-add').addEventListener('click', (e) => {
      e.stopPropagation();
      if (frozen) return;
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
  const keysToClear = [
    LS_SEGMENT_KEY,
    LS_ROUNDTRIP_KEY,
    LS_OLOOP_KEY,
    LS_ROUTE_MODE_KEY,
    LS_MAP_LAYER_KEY,
    LS_SPEED_MODE_KEY,
    LS_SPEED_ACTIVITY_KEY,
    LS_PACE_PARAMS_KEY,
    LS_PER_SEGMENT_KEY,
    LS_STRICT_LINEAR_KEY,
    LS_IMPORT_AUTO_SORT_KEY,
    LS_IMPORT_AUTO_NAME_KEY,
    LS_PACE_UNIT_KEY,
    LS_WINDY_LAYER_KEY,
    LS_WINDY_MODEL_KEY,
    LS_MAP_VIEW_KEY
  ];
  keysToClear.forEach(key => localStorage.removeItem(key));
  window.location.reload();
}

init();
