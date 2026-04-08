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
import { formatDistance, formatElevation, formatCoords, showNotification, debounce } from './modules/utils.js';

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

// =========== Initialize Modules ===========
const routeEngine = new RouteEngine();
const weatherService = new WeatherService();
const offlineManager = new OfflineManager();
const mapManager = new MapManager('map', onWaypointsChanged);

const elevationProfile = new ElevationProfile(
  'elevation-chart',
  'chart-empty',
  (lat, lng) => mapManager.showHoverMarker(lat, lng)
);

// When user clicks an alternative route on the map
mapManager.onRouteSelect = (idx) => selectAlternative(idx);

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
const btnFetchWeather = document.getElementById('btn-fetch-weather');
const btnClearCache = document.getElementById('btn-clear-cache');
const gpxFileInput = document.getElementById('gpx-file-input');
const weatherDateInput = document.getElementById('weather-date');

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
  elevationProfile.clear();
  resetStats();
  clearWeatherCards();
  hideAlternatives();
  showNotification('路線已清除', 'info');
});

btnUndo.addEventListener('click', () => mapManager.removeLastWaypoint());
btnFetchWeather.addEventListener('click', fetchWeather);

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

const today = new Date();
weatherDateInput.value = today.toISOString().split('T')[0];

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

    // Get all alternative routes (with elevation already fetched)
    allAlternatives = await routeEngine.getAlternativeRoutes(waypoints);

    if (allAlternatives.length > 0) {
      // Draw all routes on map
      mapManager.drawMultipleRoutes(allAlternatives, 0);

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

  // Update map selection
  mapManager.selectRoute(allAlternatives, index);

  // Update elevation chart with pre-fetched data
  elevationProfile.updateWithData(
    route.sampledCoords,
    route.elevations
  );

  // Update stats from pre-calculated route data
  statDistance.textContent = formatDistance(route.distance);
  statAscent.textContent = formatElevation(route.ascent);
  statDescent.textContent = formatElevation(route.descent);
  statMaxElev.textContent = formatElevation(route.maxElev);

  // Update card selection highlight
  renderAlternatives(allAlternatives, index);
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
  const gpx = GpxExporter.generate(
    mapManager.waypoints,
    currentRouteCoords,
    currentElevations
  );
  GpxExporter.download(gpx);
  showNotification('GPX 檔案已匯出', 'success');
}

function importGpx(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const result = GpxExporter.parse(evt.target.result);
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

// =========== Weather ===========

async function fetchWeather() {
  const dateStr = weatherDateInput.value;
  if (!dateStr) {
    showNotification('請選擇日期', 'warning');
    return;
  }
  if (currentRouteCoords.length < 2) {
    showNotification('請先建立路線', 'warning');
    return;
  }

  showNotification('查詢天氣中...', 'info', 2000);
  const results = await weatherService.getWeatherAlongRoute(currentRouteCoords, dateStr);
  renderWeatherCards(results);
}

function renderWeatherCards(results) {
  const container = document.getElementById('weather-cards');
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="weather-empty-state"><p>無天氣資料</p></div>';
    return;
  }

  container.innerHTML = results
    .map((w) => `
    <div class="weather-card">
      <div class="weather-card-header">
        <span class="location">${w.label} (${w.lat.toFixed(3)}, ${w.lng.toFixed(3)})</span>
        <span class="weather-icon">${w.weatherIcon}</span>
      </div>
      <div class="weather-temp">${w.temp}</div>
      <div class="weather-card-body">
        <div class="weather-detail">
          <span class="wd-label">天氣</span>
          <span class="wd-value">${w.weatherDesc}</span>
        </div>
        <div class="weather-detail">
          <span class="wd-label">最高/最低溫</span>
          <span class="wd-value">${w.tempMax} / ${w.tempMin}</span>
        </div>
        <div class="weather-detail">
          <span class="wd-label">風速</span>
          <span class="wd-value">${w.windSpeed}</span>
        </div>
        <div class="weather-detail">
          <span class="wd-label">降雨量</span>
          <span class="wd-value">${w.precipitation}</span>
        </div>
        <div class="weather-detail">
          <span class="wd-label">濕度</span>
          <span class="wd-value">${w.humidity}</span>
        </div>
      </div>
    </div>`)
    .join('');
}

function clearWeatherCards() {
  document.getElementById('weather-cards').innerHTML =
    '<div class="weather-empty-state"><p>選擇日期並新增路線後查詢天氣</p></div>';
}

// =========== Init ===========

async function init() {
  await offlineManager.register();

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
