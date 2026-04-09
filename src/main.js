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
const progressContainer = document.getElementById('download-progress-container');
const progressText = document.getElementById('download-progress-text');
const progressFill = document.getElementById('download-progress-fill');
const weatherSegmentsContainer = document.getElementById('weather-segments-container');
const segmentDistSelect = document.getElementById('segment-dist-select');

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

btnDownloadMap.addEventListener('click', async () => {
  const layerInfo = mapManager.getCurrentLayerInfo();
  if (!layerInfo) return;
  const bounds = mapManager.map.getBounds();
  
  progressContainer.classList.remove('hidden');
  btnDownloadMap.disabled = true;
  
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
    progressText.textContent = '0%';
    progressFill.style.width = '0%';
  }
});

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

if (segmentDistSelect) {
  segmentDistSelect.addEventListener('change', () => {
    if (currentRouteCoords && currentRouteCoords.length >= 2) {
      renderWeatherSegments();
    }
  });
}

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

  // Render weather segments for the new route
  renderWeatherSegments();
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

// =========== Weather Segment API ===========

let weatherSegments = [];

function generateWeatherSegments(coords, waypoints) {
  const distSelect = document.getElementById('segment-dist-select');
  const segmentLimitMeters = distSelect ? parseInt(distSelect.value) : 10000;
  const SEGMENT_MAX_DIST = segmentLimitMeters;
  const segments = [];
  if (coords.length < 2 || waypoints.length < 2) return segments;

  // Find corresponding index in coords array for each waypoint
  const wpIndices = [];
  let searchIdx = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    let minD = Infinity;
    let minIdx = searchIdx;
    for (let j = searchIdx; j < coords.length; j++) {
      const d = haversineDistance(wp, coords[j]);
      if (d < minD) {
        minD = d;
        minIdx = j;
      }
    }
    wpIndices.push(minIdx);
    searchIdx = minIdx;
  }

  // Generate segments between waypoints
  for (let w = 0; w < wpIndices.length - 1; w++) {
    const startIdx = wpIndices[w];
    const endIdx = wpIndices[w + 1];
    // Edge case if waypoints resolve to same index (very close)
    if (startIdx === endIdx) continue;
    
    const legCoords = coords.slice(startIdx, endIdx + 1);
    
    let legDist = 0;
    for (let j = 1; j < legCoords.length; j++) {
      legDist += haversineDistance(legCoords[j-1], legCoords[j]);
    }
    
    if (legDist <= SEGMENT_MAX_DIST) {
      segments.push({
        label: `航點 ${w + 1} ➔ 航點 ${w + 2}`,
        startWpIndex: w,
        endWpIndex: w + 1,
        coords: legCoords,
        distance: legDist
      });
    } else {
      const numParts = Math.ceil(legDist / SEGMENT_MAX_DIST);
      let currentPart = 1;
      let currentChunk = [legCoords[0]];
      let currentDist = 0;
      const targetDist = legDist / numParts;

      for (let i = 1; i < legCoords.length; i++) {
        const p1 = legCoords[i-1];
        const p2 = legCoords[i];
        const d = haversineDistance(p1, p2);

        currentChunk.push(p2);
        currentDist += d;

        if (currentDist >= targetDist || i === legCoords.length - 1) {
          segments.push({
            label: `航點 ${w + 1} ➔ 航點 ${w + 2}`,
            partInfo: ` (段落 ${currentPart}/${numParts})`,
            startWpIndex: w,
            endWpIndex: w + 1,
            coords: [...currentChunk],
            distance: currentDist
          });
          if (i !== legCoords.length - 1) {
            currentChunk = [p2];
            currentDist = 0;
            currentPart++;
          }
        }
      }
    }
  }
  return segments;
}

function renderWeatherSegments() {
  weatherSegments = generateWeatherSegments(currentRouteCoords, mapManager.waypoints);
  weatherSegmentsContainer.innerHTML = '';
  
  if (weatherSegments.length === 0) {
    clearWeatherCards();
    return;
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  weatherSegments.forEach((seg, idx) => {
    const card = document.createElement('div');
    card.className = 'weather-segment-card';
    const title = seg.label + (seg.partInfo || '');
    
    card.innerHTML = `
      <div class="ws-header">
        <span class="ws-title">${title}</span>
        <span class="ws-dist">${formatDistance(seg.distance)}</span>
      </div>
      <div class="ws-controls" style="display: flex; gap: 4px;">
        <input type="date" value="${todayStr}" class="seg-date" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background: var(--bg-color, #fff); color: var(--text-color, #000);" />
        <input type="time" value="${nowTimeStr}" class="seg-time" style="width: 100px; padding: 4px; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background: var(--bg-color, #fff); color: var(--text-color, #000);" />
      </div>
      <div class="ws-result empty">
        <p>讀取中...</p>
      </div>
    `;

    const dateInput = card.querySelector('.seg-date');
    const timeInput = card.querySelector('.seg-time');
    const resContainer = card.querySelector('.ws-result');

    const fetchWeatherForSeg = async () => {
      const dateStr = dateInput.value;
      const timeStr = timeInput.value;
      if (!dateStr || !timeStr) return;
      
      dateInput.disabled = true;
      timeInput.disabled = true;
      resContainer.classList.remove('empty');
      resContainer.innerHTML = '<p>讀取中...</p>';
      
      try {
        const results = await weatherService.getWeatherAlongRoute(seg.coords, dateStr, timeStr);
        // Use the middle point for segment summary (index 1 if 3 points sampled)
        const mainRes = results.length > 1 ? results[1] : results[0]; 
        
        if (mainRes && mainRes.temp !== '—') {
          resContainer.innerHTML = `
            <div class="ws-icon">${mainRes.weatherIcon}</div>
            <div class="ws-info">
              <span class="ws-temp" style="font-weight: 500;">${mainRes.temp} <span style="font-size: 0.85em; opacity: 0.8; font-weight: normal;">(高低 ${mainRes.tempMax} / ${mainRes.tempMin})</span></span>
              <span class="ws-desc">${mainRes.weatherDesc} • 降水 ${mainRes.precipitation}</span>
            </div>
          `;

          // Update waypoint marker weather icons
          if (results[0]?.weatherIcon && seg.startWpIndex !== undefined) {
            mapManager.setWaypointWeather(seg.startWpIndex, results[0].weatherIcon);
          }
          if (results[results.length - 1]?.weatherIcon && seg.endWpIndex !== undefined) {
            mapManager.setWaypointWeather(seg.endWpIndex, results[results.length - 1].weatherIcon);
          }
        } else {
          resContainer.classList.add('empty');
          resContainer.innerHTML = '<p>無天氣資料</p>';
        }
      } catch (err) {
        resContainer.classList.add('empty');
        resContainer.innerHTML = '<p>查詢失敗</p>';
      } finally {
        dateInput.disabled = false;
        timeInput.disabled = false;
      }
    };

    dateInput.addEventListener('change', fetchWeatherForSeg);
    timeInput.addEventListener('change', fetchWeatherForSeg);
    weatherSegmentsContainer.appendChild(card);
    
    // Auto load weather
    fetchWeatherForSeg();
  });
}

function clearWeatherCards() {
  if (weatherSegmentsContainer) {
    weatherSegmentsContainer.innerHTML =
      '<div class="weather-empty-state"><p>完成規劃路線後即可查閱各段段落天氣</p></div>';
  }
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
