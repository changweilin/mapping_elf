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
const btnClearCache = document.getElementById('btn-clear-cache');
const gpxFileInput = document.getElementById('gpx-file-input');

const btnDownloadMap = document.getElementById('btn-download-map');
const btnDownloadRoute = document.getElementById('btn-download-route');
const progressContainer = document.getElementById('download-progress-container');
const progressText = document.getElementById('download-progress-text');
const progressFill = document.getElementById('download-progress-fill');
const weatherPointsContainer = document.getElementById('weather-points-container');
const weatherDateInput = document.getElementById('weather-date');
const weatherTimeSelect = document.getElementById('weather-time');
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
  elevationProfile.clear();
  resetStats();
  weatherPoints = [];
  if (weatherPointsContainer) weatherPointsContainer.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「取得天氣」</p></div>';
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

  // Update map selection - set triggeredByUI to true to prevent recursion
  mapManager.selectRoute(allAlternatives, index, true);

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
 * Collect the global date/time for GPX export (same for all waypoints).
 */
function collectSegmentDates() {
  const date = weatherDateInput?.value || '';
  const h = weatherTimeSelect?.value;
  const time = h != null ? `${String(h).padStart(2, '0')}:00` : '';
  return mapManager.waypoints.map(() => ({ date, time }));
}

function importGpx(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const result = GpxExporter.parse(evt.target.result);

      // Apply first segment date/time to global weather controls
      if (result.segmentDates?.some(d => d?.date || d?.time)) {
        const first = result.segmentDates.find(d => d?.date || d?.time);
        if (first?.date && weatherDateInput) weatherDateInput.value = first.date;
        if (first?.time && weatherTimeSelect) {
          const h = parseInt(first.time.split(':')[0]);
          if (!isNaN(h)) weatherTimeSelect.value = String(h);
        }
        saveWeatherSettings();
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

let weatherPoints = []; // { label, lat, lng, isWaypoint, wpIndex? }

const LS_WEATHER_KEY = 'mappingElf_weather';

function saveWeatherSettings() {
  localStorage.setItem(LS_WEATHER_KEY, JSON.stringify({
    date: weatherDateInput?.value || '',
    hour: weatherTimeSelect?.value ?? '8',
  }));
}

function loadWeatherSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_WEATHER_KEY) || 'null');
    if (!s) return;
    if (s.date && weatherDateInput) weatherDateInput.value = s.date;
    if (s.hour != null && weatherTimeSelect) weatherTimeSelect.value = String(s.hour);
  } catch {}
}

function initWeatherControls() {
  if (!weatherTimeSelect || !weatherDateInput || !btnFetchWeather) return;

  weatherTimeSelect.innerHTML = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`
  ).join('');

  const now = new Date();
  weatherDateInput.value = now.toISOString().split('T')[0];
  weatherTimeSelect.value = String(now.getHours());

  loadWeatherSettings();

  weatherDateInput.addEventListener('change', saveWeatherSettings);
  weatherTimeSelect.addEventListener('change', saveWeatherSettings);
  btnFetchWeather.addEventListener('click', fetchAllWeatherData);
}

function buildWeatherPoints() {
  const wps = mapManager.waypoints;
  const coords = currentRouteCoords;
  if (wps.length === 0) return [];

  const points = [];
  const wpIndices = [];

  if (coords.length > 0) {
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
  }

  for (let i = 0; i < wps.length; i++) {
    const label = i === 0 ? '起點' : i === wps.length - 1 ? '終點' : `航點 ${i + 1}`;
    points.push({ label, lat: wps[i][0], lng: wps[i][1], isWaypoint: true, wpIndex: i });

    if (i < wps.length - 1 && coords.length > 0 && wpIndices.length > i + 1) {
      const si = wpIndices[i];
      const ei = wpIndices[i + 1] ?? coords.length - 1;
      const mc = coords[Math.max(0, Math.min(Math.floor((si + ei) / 2), coords.length - 1))];
      const nextLabel = (i + 1 === wps.length - 1) ? '終點' : `航點 ${i + 2}`;
      points.push({ label: `${label} → ${nextLabel} 中點`, lat: mc[0], lng: mc[1], isWaypoint: false });
    }
  }
  return points;
}

function renderWeatherPanel() {
  weatherPoints = buildWeatherPoints();
  if (!weatherPointsContainer) return;
  weatherPointsContainer.innerHTML = '';

  if (weatherPoints.length === 0) {
    weatherPointsContainer.innerHTML = '<div class="weather-empty-state"><p>完成規劃路線後點擊「取得天氣」</p></div>';
    return;
  }

  weatherPoints.forEach((pt, idx) => {
    const card = document.createElement('div');
    card.className = 'weather-point-card';
    card.dataset.index = idx;
    card.innerHTML = `
      <div class="wpc-header">
        <span class="wpc-label">${pt.label}</span>
        <span class="wpc-status">等待查詢</span>
      </div>
      <div class="wpc-body wpc-idle">點擊「取得天氣」查閱資訊</div>
    `;
    weatherPointsContainer.appendChild(card);
  });
}

function _renderWeatherCardData(card, data) {
  const d = (v, alt = '—') => v != null ? v : alt;
  card.querySelector('.wpc-status').textContent = data.weatherDesc;
  card.querySelector('.wpc-body').className = 'wpc-body';
  card.querySelector('.wpc-body').innerHTML = `
    <div class="wpc-main">
      <span class="wpc-icon">${data.weatherIcon}</span>
      <div class="wpc-temps">
        <span class="wpc-temp-cur">${d(data.temp, d(data.tempMax))}</span>
        <span class="wpc-temp-range">高 ${d(data.tempMax)} / 低 ${d(data.tempMin)}</span>
      </div>
    </div>
    <div class="wpc-grid">
      <div class="wpc-item"><span class="wpc-lbl">體感</span><span>${d(data.feelsLike)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">濕度</span><span>${d(data.humidity)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">露點</span><span>${d(data.dewPoint)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">降水</span><span>${d(data.precipitation, d(data.precipitationSum))}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">機率</span><span>${d(data.precipProb, d(data.precipProbMax))}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">雲量</span><span>${d(data.cloudCover)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">風速</span><span>${d(data.windSpeed, d(data.windSpeedMax))}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">陣風</span><span>${d(data.windGust, d(data.windGustMax))}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">UV</span><span>${d(data.uvIndex, d(data.uvIndexMax))}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">能見度</span><span>${d(data.visibility)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">日照</span><span>${d(data.sunshineHours)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">輻射</span><span>${d(data.radiation)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">日出</span><span>${d(data.sunrise)}</span></div>
      <div class="wpc-item"><span class="wpc-lbl">日落</span><span>${d(data.sunset)}</span></div>
    </div>
  `;
}

async function fetchAllWeatherData() {
  if (weatherPoints.length === 0) { showNotification('請先建立路線', 'warning'); return; }
  const dateStr = weatherDateInput?.value;
  if (!dateStr) { showNotification('請選擇日期', 'warning'); return; }
  const hour = parseInt(weatherTimeSelect?.value ?? '8');

  saveWeatherSettings();
  mapManager.clearWaypointWeather();
  btnFetchWeather.disabled = true;

  for (let i = 0; i < weatherPoints.length; i++) {
    const pt = weatherPoints[i];
    const card = weatherPointsContainer.querySelector(`[data-index="${i}"]`);
    btnFetchWeather.textContent = `${i + 1} / ${weatherPoints.length}`;

    if (card) {
      card.querySelector('.wpc-status').textContent = '讀取中...';
      card.querySelector('.wpc-body').className = 'wpc-body';
      card.querySelector('.wpc-body').innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:12px;padding:8px 0">讀取中...</p>';
    }

    try {
      const data = await weatherService.getWeatherAtPoint(pt.lat, pt.lng, dateStr, hour);
      if (card) _renderWeatherCardData(card, data);
      if (pt.isWaypoint && pt.wpIndex !== undefined && data.weatherIcon) {
        mapManager.setWaypointWeather(pt.wpIndex, data.weatherIcon);
      }
    } catch (err) {
      console.warn(`Weather fetch failed for ${pt.label}:`, err.message);
      if (card) {
        card.querySelector('.wpc-status').textContent = '查詢失敗';
        card.querySelector('.wpc-body').innerHTML = '<p style="text-align:center;color:var(--danger,#f87171);font-size:12px;padding:8px 0">無法取得天氣資料</p>';
      }
    }

    if (i < weatherPoints.length - 1) await new Promise(r => setTimeout(r, 400));
  }

  btnFetchWeather.disabled = false;
  btnFetchWeather.textContent = '取得天氣';
  showNotification('天氣資訊已更新', 'success', 2000);
}

// =========== Init ===========

async function init() {
  await offlineManager.register();
  initWeatherControls();

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
