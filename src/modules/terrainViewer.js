import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { haversineDistance, cumulativeDistances } from './utils.js';

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
const GRID_SIZE = 25;

export class TerrainViewer {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.clock = new THREE.Clock();

    this.routePoints = [];
    this.routeElevations = [];
    // Per-vertex route gradient colours (THREE.Color[], aligned to routePoints),
    // mirroring the 2D map / elevation-chart gradient. null → legacy single colour.
    this._routeColors = null;
    this.terrainMesh = null;
    this.routeLine = null;
    this.routeTube = null;
    this.waypointMarkers = [];
    this.weatherLabels = [];
    this.playerMarker = null;
    this.playerPath = null;

    this.contourGroup = null;
    this.contourLabelGroup = null;
    this.waypointLabelGroup = null;
    this.weatherGroup = null;

    // Contour precision: 'high' | 'low' | 'none'. Drives the iso-line interval
    // (smaller = more bands) and visibility. Rebuilt from the cached grid.
    this._contourPrecision = 'high';
    this._contourLabelsVisible = true;

    // --- Clickable 3D markers (billboard signboards) ---
    this._onMarkerClick = null;
    this._pickables = [];                 // THREE objects with userData.detail
    this._raycaster = null;
    this._pointer = new THREE.Vector2();
    this._pointerDownInfo = null;         // { x, y, t } for click-vs-drag detection
    this._pointerHandlersBound = false;
    this._markerScale = 1;                // marker size factor, scaled to terrain

    // Wide (pixel-width) line materials — contours + route track — that need
    // their `resolution` kept in sync with the renderer size.
    this._lineMaterials = [];

    this._grid = null;
    this._bbox = null;
    this._terrainInfo = null;

    this._playing = false;
    this._speed = 1;
    this._progress = 0;
    this._animFrameId = null;
    this._onProgressChange = null;
    this._onInfo = null;
    this._onLoad = null;
    this._onClose = null;
    this._onMetrics = null;
    this._onTerrainComputed = null;

    this._abortController = null;
    this._aborted = false;
    this._loading = false;

    // --- Route timing / metrics (set in loadRouteData) ---
    this._distances = null;       // cumulative metres, aligned to routePoints
    this._times = null;           // cumulative elapsed hours, aligned to routePoints
    this._fatigue = null;         // per-vertex fatigue fraction 0..1
    this._startMs = null;         // departure timestamp (ms epoch)
    this._totalDistM = 0;
    this._weatherPoints = [];
    this._centerLat = 0;
    this._centerLng = 0;
    this._worldSpan = 2000;       // approx terrain span (world units)

    // --- Environment (day/night + weather) ---
    this._envEnabled = true;
    this._weatherFxEnabled = true;
    this._sun = null;
    this._sunTarget = null;
    this._moon = null;
    this._ambient = null;
    this._hemi = null;
    this._rain = null;
    this._snow = null;
    this._currentWeatherCat = 'clear';
    this._lightningT = 0;
    this._lightningTimer = 4 + Math.random() * 6;

    // --- Animated hiker ---
    this._person = null;
    this._personPhase = 0;

    this._lastMetricsEmit = 0;
  }

  show() {
    this.container.classList.remove('hidden');
    if (!this._checkWebGL()) {
      throw new Error('WebGL 無法使用，請更新瀏覽器或檢查顯示卡設定');
    }
    try {
      this._initScene();
      this._animate();
    } catch (err) {
      console.error('TerrainViewer init failed:', err);
    }
  }

  hide() {
    this.container.classList.add('hidden');
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  destroy() {
    this.hide();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.controls = null;
  }

  onClose(cb) {
    this._onClose = cb;
  }

  onProgressChange(cb) {
    this._onProgressChange = cb;
  }

  onInfo(cb) {
    this._onInfo = cb;
  }

  // cb(metrics) — position-driven live readout (date/time, dist, elev, speed,
  // grade, fatigue, weather). Fired on scrub and during playback.
  onMetrics(cb) {
    this._onMetrics = cb;
  }

  // cb({ active, percent, title, detail, aborted, error })
  onLoad(cb) {
    this._onLoad = cb;
  }

  // cb({ grid, bbox }) — fired once after a fresh elevation-grid download so the
  // caller can persist it (per-favourite terrain cache). Not fired on a cache hit.
  onTerrainComputed(cb) {
    this._onTerrainComputed = cb;
  }

  isLoading() {
    return this._loading;
  }

  abort() {
    if (!this._loading) return;
    this._aborted = true;
    if (this._abortController) {
      try { this._abortController.abort(); } catch { /* noop */ }
    }
  }

  _emitLoad(state) {
    this._loading = !!state.active;
    if (this._onLoad) this._onLoad(state);
  }

  getTerrainInfo() {
    return this._terrainInfo;
  }

  setContoursVisible(visible) {
    if (this.contourGroup) this.contourGroup.visible = visible;
  }

  setContourLabelsVisible(visible) {
    this._contourLabelsVisible = !!visible;
    // Labels only show when contours themselves are visible.
    if (this.contourLabelGroup) {
      this.contourLabelGroup.visible = !!visible && this._contourPrecision !== 'none';
    }
  }

  // Contour precision: 'high' (dense bands) | 'low' (sparse bands) | 'none'.
  // Rebuilds the iso-lines from the cached elevation grid.
  setContourPrecision(precision) {
    const p = (precision === 'low' || precision === 'none') ? precision : 'high';
    // No-op if nothing changed and the matching geometry already exists (avoids
    // rebuilding the just-built contours right after load).
    const alreadyBuilt = p === 'none' ? !this.contourGroup : !!this.contourGroup;
    if (p === this._contourPrecision && alreadyBuilt) return;
    this._contourPrecision = p;
    if (!this.scene || !this._grid || !this._bbox) return;
    this._rebuildContours();
  }

  getContourPrecision() {
    return this._contourPrecision;
  }

  _rebuildContours() {
    // Tear down the existing contour geometry/labels, then rebuild for the
    // current precision (unless 'none').
    for (const grp of [this.contourGroup, this.contourLabelGroup]) {
      if (!grp) continue;
      this.scene.remove(grp);
      grp.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          // Drop the wide-line material from the resolution-tracked list.
          this._lineMaterials = this._lineMaterials.filter((m) => m !== child.material);
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }
    this.contourGroup = null;
    this.contourLabelGroup = null;
    if (this._contourPrecision === 'none') {
      if (this._onInfo) this._onInfo(this._terrainInfo);
      return;
    }
    this._createContours(this._grid, this._bbox);
    if (this.contourLabelGroup) this.contourLabelGroup.visible = this._contourLabelsVisible;
    if (this._onInfo) this._onInfo(this._terrainInfo);
  }

  // cb(detail) — fired when a 3D billboard/waypoint marker is clicked.
  onMarkerClick(cb) {
    this._onMarkerClick = cb;
  }

  setWeatherVisible(visible) {
    if (this.weatherGroup) this.weatherGroup.visible = visible;
  }

  // Day/night + directional sunlight driven by the route time. When off, the
  // scene falls back to a neutral, evenly-lit look.
  setEnvironmentEnabled(enabled) {
    this._envEnabled = !!enabled;
    this._applyEnvironment(this._metricsAtProgress(this._progress));
  }

  // Precipitation / fog effects. When off, particle systems and weather fog are
  // hidden so nothing obscures the terrain.
  setWeatherFxEnabled(enabled) {
    this._weatherFxEnabled = !!enabled;
    if (this._rain) this._rain.visible = false;
    if (this._snow) this._snow.visible = false;
    this._applyEnvironment(this._metricsAtProgress(this._progress));
  }

  isEnvironmentEnabled() {
    return this._envEnabled;
  }

  isWeatherFxEnabled() {
    return this._weatherFxEnabled;
  }

  play() {
    if (!this.playerPath || this.playerPath.getPoint(0) === undefined) return;
    this._playing = true;
  }

  pause() {
    this._playing = false;
  }

  setSpeed(speed) {
    this._speed = speed;
  }

  setProgress(t) {
    this._progress = Math.max(0, Math.min(1, t));
    this._updatePlayerPosition();
    this._emitMetrics(true);
    if (this._onProgressChange) this._onProgressChange(this._progress);
  }

  getProgress() {
    return this._progress;
  }

  isPlaying() {
    return this._playing;
  }

  getSpeed() {
    return this._speed;
  }

  async loadRouteData(routeData) {
    const { coords, elevations, waypoints, weatherPoints, routeStats, timing, routeColors, cachedTerrain } = routeData;
    if (!coords || coords.length < 2) return;

    this.routePoints = coords;
    this.routeElevations = elevations || coords.map(() => 0);
    this._weatherPoints = Array.isArray(weatherPoints) ? weatherPoints : [];
    this._routeColors = Array.isArray(routeColors) && routeColors.length === coords.length
      ? routeColors.map((c) => new THREE.Color(c[0], c[1], c[2]))
      : null;
    // Each open starts at high-precision contours with labels on (the UI resets
    // its toggles to match), so the initial build uses the right interval.
    this._contourPrecision = 'high';
    this._contourLabelsVisible = true;

    // Timing track for the position-driven readout + day/night animation.
    this._distances = Array.isArray(timing?.distances) && timing.distances.length === coords.length
      ? timing.distances
      : cumulativeDistances(coords);
    this._totalDistM = this._distances[this._distances.length - 1] || 0;
    this._times = Array.isArray(timing?.times) && timing.times.length === coords.length ? timing.times : null;
    this._fatigue = Array.isArray(timing?.fatigue) && timing.fatigue.length === coords.length ? timing.fatigue : null;
    this._startMs = Number.isFinite(timing?.startMs) ? timing.startMs : Date.now();

    this._aborted = false;
    this._abortController = new AbortController();

    // Reuse a previously downloaded elevation grid (per-favourite cache) when one
    // is supplied and matches the current grid resolution; otherwise download it.
    const cacheHit = cachedTerrain
      && Array.isArray(cachedTerrain.grid)
      && cachedTerrain.grid.length === GRID_SIZE
      && cachedTerrain.bbox;

    let bbox;
    let gridData;
    if (cacheHit) {
      bbox = cachedTerrain.bbox;
      this._centerLat = (bbox.minLat + bbox.maxLat) / 2;
      this._centerLng = (bbox.minLng + bbox.maxLng) / 2;
      gridData = cachedTerrain.grid;
      this._emitLoad({ active: true, percent: 80, title: '建立地形模型', detail: '讀取暫存高程資料…' });
    } else {
      bbox = this._computeBbox(coords);
      this._centerLat = (bbox.minLat + bbox.maxLat) / 2;
      this._centerLng = (bbox.minLng + bbox.maxLng) / 2;
      this._emitLoad({ active: true, percent: 3, title: '建立地形模型', detail: '下載高程資料中…' });

      try {
        gridData = await this._fetchElevationGrid(bbox, (p) => {
          this._emitLoad({ active: true, percent: 3 + p * 80, title: '建立地形模型', detail: '下載高程資料中…' });
        });
      } catch (err) {
        if (this._aborted) {
          this._emitLoad({ active: false, percent: 0, aborted: true });
          return;
        }
        this._emitLoad({ active: false, percent: 0, error: err });
        return;
      }

      if (this._aborted || gridData == null) {
        this._emitLoad({ active: false, percent: 0, aborted: true });
        return;
      }

      // Hand the freshly downloaded grid back so the caller can cache it.
      if (this._onTerrainComputed) {
        try { this._onTerrainComputed({ grid: gridData, bbox }); } catch { /* noop */ }
      }
    }

    this._grid = gridData;
    this._bbox = bbox;

    if (!this.scene) {
      this._initScene();
    }

    // Terrain span (world units) — set before markers so they can scale to the
    // model size and stay visible at the default camera distance.
    const cx = (bbox.minLng + bbox.maxLng) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const span = Math.max(
      haversineDistance([bbox.minLat, bbox.minLng], [bbox.minLat, bbox.maxLng]),
      haversineDistance([bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.minLng])
    );
    this._worldSpan = span;
    // Scale markers/hiker to the terrain so they stay visible at the default
    // framing (camera sits ~2.5× the span away).
    this._markerScale = Math.max(1, span / 300);

    this._emitLoad({ active: true, percent: 88, title: '建立地形模型', detail: '計算等高線與軌跡…' });

    this._clearScene();
    this._createTerrain(gridData, bbox);
    this._createContours(gridData, bbox);
    this._createRoutePath(coords, elevations, bbox);
    this._createWaypoints(waypoints, bbox);
    this._createWeatherLabels(weatherPoints, bbox);
    this._setupPlayer(coords, elevations, bbox);
    this._setupEnvironment();

    if (this._onInfo) this._onInfo(this._terrainInfo);

    const dist = Math.max(span * 2.5, 2000);

    // _latLngToLocal expects (lat, lng): cy is the centre latitude, cx the centre longitude.
    const center = this._latLngToLocal(cy, cx, 0, bbox);
    this.controls.target.set(center.x, center.y, center.z);
    this.camera.position.set(center.x + dist * 0.3, center.y + dist * 0.4, center.z + dist);
    this.controls.update();

    this._setupResizeHandler();
    this._updateLineResolutions();
    this._emitMetrics(true);

    this._emitLoad({ active: false, percent: 100 });
  }

  _checkWebGL() {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
    } catch { return false; }
  }

  _initScene() {
    if (this.renderer) return;

    let w = this.container.clientWidth;
    let h = this.container.clientHeight;
    if (w < 1 || h < 1) {
      w = this.container.parentElement?.clientWidth || window.innerWidth;
      h = this.container.parentElement?.clientHeight || window.innerHeight;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200000;

    this._bindPointerHandlers();
  }

  // Click-to-inspect: distinguishes a click from an orbit drag, then raycasts
  // against the billboard/waypoint markers and reports the hit's detail.
  _bindPointerHandlers() {
    if (this._pointerHandlersBound || !this.renderer) return;
    const el = this.renderer.domElement;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    el.addEventListener('pointerdown', (e) => {
      this._pointerDownInfo = { x: e.clientX, y: e.clientY, t: now() };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this._pointerDownInfo;
      this._pointerDownInfo = null;
      if (!d) return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved > 6 || (now() - d.t) > 600) return; // drag / long-press → orbit, not a pick
      this._handlePick(e);
    });
    this._pointerHandlersBound = true;
  }

  _handlePick(e) {
    if (!this.camera || !this.renderer || !this._onMarkerClick || !this._pickables.length) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this._raycaster.intersectObjects(this._pickables, false);
    for (const h of hits) {
      const detail = h.object?.userData?.detail;
      if (detail) { this._onMarkerClick(detail); return; }
    }
  }

  // ---------- Environment: day/night lighting + weather ----------

  _setupEnvironment() {
    this._ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this._ambient);

    this._hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a2a1a, 0.4);
    this.scene.add(this._hemi);

    this._sun = new THREE.DirectionalLight(0xffeedd, 1.2);
    this._sun.castShadow = true;
    const d = 50000;
    this._sun.shadow.camera.left = -d;
    this._sun.shadow.camera.right = d;
    this._sun.shadow.camera.top = d;
    this._sun.shadow.camera.bottom = -d;
    this._sun.shadow.camera.far = 400000;
    this._sun.shadow.mapSize.width = 1024;
    this._sun.shadow.mapSize.height = 1024;
    this._sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this._sun);

    this._sunTarget = new THREE.Object3D();
    this.scene.add(this._sunTarget);
    this._sun.target = this._sunTarget;

    // A soft cool fill that doubles as moonlight at night.
    this._moon = new THREE.DirectionalLight(0xaaccff, 0.0);
    this.scene.add(this._moon);

    this._createPrecipitation();
    this._applyEnvironment(this._metricsAtProgress(this._progress));
  }

  // Approximate solar position for a date + location. Precision is well beyond
  // what a visual day/night cycle needs; the model uses a declination from the
  // day-of-year and an hour-angle from local clock time (longitude-corrected to
  // the Asia/Taipei UTC+8 standard meridian used by the weather data).
  _sunPosition(dateMs, lat, lng) {
    const date = new Date(dateMs);
    const toRad = Math.PI / 180;
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
    const decl = 23.44 * Math.sin(toRad * (360 / 365) * (dayOfYear - 81));
    const localHour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    // 4 min per degree from the 120°E standard meridian (UTC+8).
    const solarTime = localHour + (lng - 120) * 4 / 60;
    const H = 15 * (solarTime - 12); // hour angle, degrees

    const latR = lat * toRad;
    const declR = decl * toRad;
    const Hr = H * toRad;
    const sinEl = Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(Hr);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl))); // radians

    let cosAz = (Math.sin(declR) - Math.sin(el) * Math.sin(latR)) / (Math.cos(el) * Math.cos(latR) || 1e-6);
    cosAz = Math.max(-1, Math.min(1, cosAz));
    let az = Math.acos(cosAz); // from north, 0..π
    if (Hr > 0) az = 2 * Math.PI - az; // afternoon → west

    // World frame: +x east, +y up, +z north.
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    );
    return { elevationDeg: el / toRad, azimuthDeg: az / toRad, dir };
  }

  // Colour/intensity presets keyed on sun elevation. Lerps between night,
  // twilight, golden-hour and day so the transition is smooth during playback.
  _skyPreset(elevDeg) {
    const stops = [
      { e: -90, sky: 0x05060f, sun: 0x14213a, sunI: 0.0, amb: 0x1a2138, ambI: 0.32, hemiS: 0x10182e, hemiG: 0x05070c, hemiI: 0.28, moonI: 0.55 },
      { e: -6,  sky: 0x16213d, sun: 0x3a4a78, sunI: 0.10, amb: 0x29314f, ambI: 0.40, hemiS: 0x35406a, hemiG: 0x161a26, hemiI: 0.42, moonI: 0.30 },
      { e: 0,   sky: 0x5a4a6a, sun: 0xff8a4a, sunI: 0.55, amb: 0x4a4660, ambI: 0.48, hemiS: 0x7a6a8a, hemiG: 0x2a221c, hemiI: 0.5, moonI: 0.05 },
      { e: 6,   sky: 0x8fb0d8, sun: 0xffcaa0, sunI: 1.05, amb: 0x9aa6c0, ambI: 0.55, hemiS: 0x9fc0e8, hemiG: 0x3a2e22, hemiI: 0.55, moonI: 0.0 },
      { e: 35,  sky: 0x7fb4ec, sun: 0xfff3e0, sunI: 1.35, amb: 0xc7d4e8, ambI: 0.6, hemiS: 0x87ceeb, hemiG: 0x3a2a1a, hemiI: 0.6, moonI: 0.0 },
      { e: 90,  sky: 0x6fa8e8, sun: 0xffffff, sunI: 1.45, amb: 0xd6e2f2, ambI: 0.62, hemiS: 0x9bd0f5, hemiG: 0x3a2a1a, hemiI: 0.62, moonI: 0.0 },
    ];
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (elevDeg >= stops[i].e && elevDeg <= stops[i + 1].e) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    if (elevDeg <= stops[0].e) { lo = hi = stops[0]; }
    if (elevDeg >= stops[stops.length - 1].e) { lo = hi = stops[stops.length - 1]; }
    const span = (hi.e - lo.e) || 1;
    const f = Math.max(0, Math.min(1, (elevDeg - lo.e) / span));
    const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), f);
    const num = (a, b) => a + (b - a) * f;
    return {
      sky: mix(lo.sky, hi.sky),
      sun: mix(lo.sun, hi.sun),
      sunI: num(lo.sunI, hi.sunI),
      amb: mix(lo.amb, hi.amb),
      ambI: num(lo.ambI, hi.ambI),
      hemiS: mix(lo.hemiS, hi.hemiS),
      hemiG: mix(lo.hemiG, hi.hemiG),
      hemiI: num(lo.hemiI, hi.hemiI),
      moonI: num(lo.moonI, hi.moonI),
    };
  }

  _applyEnvironment(metrics) {
    if (!this._sun || !this.scene) return;
    const span = this._worldSpan || 2000;
    const sunDist = Math.max(span * 4, 40000);

    if (!this._envEnabled) {
      // Neutral, evenly-lit fallback.
      this.scene.background = new THREE.Color(0x1a1a2e);
      this.scene.fog = null;
      this._sun.color.set(0xffeedd);
      this._sun.intensity = 1.2;
      this._sun.position.set(sunDist * 0.4, sunDist, sunDist * 0.4);
      if (this._sunTarget) this._sunTarget.position.copy(this.controls?.target || new THREE.Vector3());
      this._ambient.color.set(0x6a708a); this._ambient.intensity = 0.6;
      this._hemi.color.set(0x87ceeb); this._hemi.groundColor.set(0x3a2a1a); this._hemi.intensity = 0.4;
      if (this._moon) this._moon.intensity = 0.0;
      if (this._rain) this._rain.visible = false;
      if (this._snow) this._snow.visible = false;
      this._currentWeatherCat = 'clear';
      return;
    }

    const dateMs = metrics?.dateMs ?? this._startMs ?? Date.now();
    const lat = metrics?.lat ?? this._centerLat;
    const lng = metrics?.lng ?? this._centerLng;
    const sun = this._sunPosition(dateMs, lat, lng);
    const preset = this._skyPreset(sun.elevationDeg);

    // Weather dims/colours the sky and softens shadows.
    const cat = (this._weatherFxEnabled && metrics?.weather?.cat) ? metrics.weather.cat : 'clear';
    this._currentWeatherCat = cat;
    const wx = this._weatherModifier(cat);

    const target = this.controls?.target || new THREE.Vector3();
    if (this._sunTarget) this._sunTarget.position.copy(target);
    this._sun.position.copy(target).add(sun.dir.clone().multiplyScalar(sunDist));
    this._sun.color.copy(preset.sun);
    this._sun.intensity = Math.max(0, preset.sunI * wx.sun);
    this._sun.castShadow = sun.elevationDeg > 1 && wx.shadow;

    this._ambient.color.copy(preset.amb);
    this._ambient.intensity = preset.ambI * wx.amb;
    this._hemi.color.copy(preset.hemiS);
    this._hemi.groundColor.copy(preset.hemiG);
    this._hemi.intensity = preset.hemiI * wx.amb;
    if (this._moon) {
      this._moon.intensity = preset.moonI;
      this._moon.position.copy(target).add(new THREE.Vector3(-sun.dir.x, Math.max(0.4, -sun.dir.y), -sun.dir.z).multiplyScalar(sunDist));
    }

    const sky = preset.sky.clone().lerp(new THREE.Color(wx.tint), wx.tintAmt);
    this.scene.background = sky;

    if (wx.fog > 0) {
      const near = span * (1.0 - wx.fog * 0.7);
      const far = span * (3.5 - wx.fog * 2.2);
      this.scene.fog = new THREE.Fog(sky.clone().lerp(new THREE.Color(0xffffff), 0.05), Math.max(10, near), Math.max(near + 50, far));
    } else {
      this.scene.fog = null;
    }

    // Toggle the right precipitation system.
    const wantRain = this._weatherFxEnabled && (cat === 'rain' || cat === 'drizzle' || cat === 'thunder');
    const wantSnow = this._weatherFxEnabled && cat === 'snow';
    if (this._rain) {
      this._rain.visible = wantRain;
      this._rain.material.opacity = cat === 'thunder' ? 0.5 : (cat === 'drizzle' ? 0.28 : 0.42);
    }
    if (this._snow) this._snow.visible = wantSnow;
  }

  // Per-category multipliers: how much weather dims light, tints the sky and
  // adds fog. Kept gentle so the terrain and track stay readable.
  _weatherModifier(cat) {
    switch (cat) {
      case 'cloudy':  return { sun: 0.7, amb: 1.05, shadow: true,  fog: 0.12, tint: 0xb8c2d0, tintAmt: 0.18 };
      case 'fog':     return { sun: 0.45, amb: 1.1, shadow: false, fog: 0.6,  tint: 0xc8d0da, tintAmt: 0.4 };
      case 'drizzle': return { sun: 0.55, amb: 1.05, shadow: false, fog: 0.3, tint: 0x9aa6b4, tintAmt: 0.3 };
      case 'rain':    return { sun: 0.4, amb: 1.0, shadow: false, fog: 0.4,  tint: 0x7e8a99, tintAmt: 0.4 };
      case 'snow':    return { sun: 0.6, amb: 1.15, shadow: false, fog: 0.35, tint: 0xd8e2ee, tintAmt: 0.35 };
      case 'thunder': return { sun: 0.3, amb: 0.95, shadow: false, fog: 0.45, tint: 0x5e6a7c, tintAmt: 0.5 };
      default:        return { sun: 1.0, amb: 1.0, shadow: true,  fog: 0.0,  tint: 0xffffff, tintAmt: 0.0 };
    }
  }

  // WMO weather code → coarse visual category used by the FX + sky tint.
  static weatherCategory(code) {
    const c = Number(code);
    if (!Number.isFinite(c) || c < 0) return 'clear';
    if (c === 0 || c === 1) return 'clear';
    if (c === 2) return 'cloudy';
    if (c === 3) return 'cloudy';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95) return 'thunder';
    return 'cloudy';
  }

  // WMO weather code → emoji (matches weatherService's WMO_CODES table).
  static weatherIcon(code) {
    const c = Number(code);
    const map = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
      51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️',
      61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
      71: '🌨️', 73: '🌨️', 75: '❄️', 77: '❄️',
      80: '🌦️', 81: '🌧️', 82: '⛈️', 85: '🌨️', 86: '❄️',
      95: '⛈️', 96: '⛈️', 99: '⛈️',
    };
    if (map[c]) return map[c];
    return ({
      clear: '☀️', cloudy: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', thunder: '⛈️',
    })[TerrainViewer.weatherCategory(c)] || '☀️';
  }

  _createPrecipitation() {
    // Particles live in a unit box [-0.5, 0.5]^3; the Points object is scaled
    // and positioned each frame to sit in front of the camera.
    const makePoints = (count, color, size, opacity) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = Math.random() - 0.5;
        pos[i * 3 + 1] = Math.random() - 0.5;
        pos[i * 3 + 2] = Math.random() - 0.5;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color,
        size,
        transparent: true,
        opacity,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      pts.renderOrder = 5;
      return pts;
    };

    this._rain = makePoints(700, 0xafd0ff, 2.6, 0.42);
    this._snow = makePoints(500, 0xffffff, 5.0, 0.8);
    this.scene.add(this._rain);
    this.scene.add(this._snow);
  }

  _updateWeatherParticles(dt) {
    const active = this._weatherFxEnabled
      ? (this._currentWeatherCat === 'snow' ? this._snow
        : (['rain', 'drizzle', 'thunder'].includes(this._currentWeatherCat) ? this._rain : null))
      : null;
    if (this._rain) this._rain.visible = active === this._rain;
    if (this._snow) this._snow.visible = active === this._snow;
    if (!active || !this.camera) return;

    // Box centred in front of the camera, sized by the view distance so the
    // weather fills the frame without depending on the player position.
    const target = this.controls?.target || new THREE.Vector3();
    const viewDist = this.camera.position.distanceTo(target);
    const boxSize = Math.max(600, Math.min(viewDist * 1.3, this._worldSpan * 3 || 6000));
    const center = this.camera.position.clone().lerp(target, 0.55);
    active.position.copy(center);
    active.scale.setScalar(boxSize);

    const isSnow = active === this._snow;
    const fall = (isSnow ? 0.12 : 0.9) * dt; // fraction of the box per second
    const arr = active.geometry.getAttribute('position');
    const sway = isSnow ? 0.04 : 0.0;
    this._fxTime = (this._fxTime || 0) + dt;
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) - fall;
      if (y < -0.5) y += 1;
      arr.setY(i, y);
      if (sway) {
        let x = arr.getX(i) + Math.sin((this._fxTime + i) * 1.5) * sway * dt;
        if (x > 0.5) x -= 1; else if (x < -0.5) x += 1;
        arr.setX(i, x);
      }
    }
    arr.needsUpdate = true;

    // Occasional lightning flash during thunderstorms.
    if (this._currentWeatherCat === 'thunder' && this._envEnabled) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningT = 1;
        this._lightningTimer = 4 + Math.random() * 7;
      }
      if (this._lightningT > 0) {
        this._lightningT = Math.max(0, this._lightningT - dt * 4);
        if (this._ambient) this._ambient.intensity = 0.95 + this._lightningT * 1.8;
      }
    }
  }

  _computeBbox(coords) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lat, lng] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const padLat = (maxLat - minLat) * 0.3 + 0.01;
    const padLng = (maxLng - minLng) * 0.3 + 0.01;
    return {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
    };
  }

  _latLngToLocal(lat, lng, elev, bbox) {
    const cx = (bbox.minLng + bbox.maxLng) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const R = 6371000;
    const toRad = Math.PI / 180;
    const x = R * toRad * (lng - cx) * Math.cos(toRad * cy);
    const y = elev;
    const z = R * toRad * (lat - cy);
    return { x, y, z };
  }

  // fetch with a per-request timeout that also honours the shared abort signal.
  async _fetchWithTimeout(url, parentSignal, ms) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (parentSignal) {
      if (parentSignal.aborted) ctrl.abort();
      else parentSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  }

  async _fetchElevationGrid(bbox, onProgress) {
    const lats = [];
    const lngs = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (GRID_SIZE - 1);
      for (let j = 0; j < GRID_SIZE; j++) {
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (GRID_SIZE - 1);
        lats.push(lat);
        lngs.push(lng);
      }
    }

    const signal = this._abortController?.signal;
    const elevations = [];
    const total = lats.length;
    const batchSize = 100;
    const batchCount = Math.ceil(total / batchSize);
    let batchIdx = 0;

    for (let start = 0; start < total; start += batchSize) {
      if (this._aborted) return null;
      const end = Math.min(start + batchSize, total);
      const batchLats = lats.slice(start, end);
      const batchLngs = lngs.slice(start, end);
      const latsStr = batchLats.map(v => v.toFixed(4)).join(',');
      const lngsStr = batchLngs.map(v => v.toFixed(4)).join(',');
      const url = `${ELEVATION_API}?latitude=${latsStr}&longitude=${lngsStr}`;

      let success = false;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        if (this._aborted) return null;
        try {
          const resp = await this._fetchWithTimeout(url, signal, 15000);
          if (resp.ok) {
            const data = await resp.json();
            if (data.elevation) elevations.push(...data.elevation);
            else elevations.push(...batchLats.map(() => 0));
            success = true;
          } else if (resp.status === 429) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
          } else {
            elevations.push(...batchLats.map(() => 0));
            success = true;
          }
        } catch {
          if (this._aborted) return null;
          if (attempt >= 2) {
            elevations.push(...batchLats.map(() => 0));
            success = true;
          } else {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
      if (!success) elevations.push(...batchLats.map(() => 0));

      batchIdx++;
      onProgress?.(batchIdx / batchCount);
    }

    const grid = [];
    let idx = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      const row = [];
      for (let j = 0; j < GRID_SIZE; j++) {
        row.push(elevations[idx++] || 0);
      }
      grid.push(row);
    }
    return grid;
  }

  _createTerrain(grid, bbox) {
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const indices = [];
    const uvs = [];

    const minElev = Math.min(...grid.flat());
    const maxElev = Math.max(...grid.flat());
    const elevRange = Math.max(maxElev - minElev, 1);

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (GRID_SIZE - 1);
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (GRID_SIZE - 1);
        const elev = grid[i][j];
        const p = this._latLngToLocal(lat, lng, elev, bbox);
        vertices.push(p.x, p.y, p.z);
        uvs.push(j / (GRID_SIZE - 1), i / (GRID_SIZE - 1));

        const t = (elev - minElev) / elevRange;
        const r = 0.1 + t * 0.7;
        const g = 0.5 - t * 0.3;
        const b = 0.1 + (1 - t) * 0.4;
        colors.push(r, g, b);
      }
    }

    for (let i = 0; i < GRID_SIZE - 1; i++) {
      for (let j = 0; j < GRID_SIZE - 1; j++) {
        const a = i * GRID_SIZE + j;
        const b = i * GRID_SIZE + j + 1;
        const c = (i + 1) * GRID_SIZE + j;
        const d = (i + 1) * GRID_SIZE + j + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.scene.add(this.terrainMesh);
  }

  // ---------- Contour lines (等高線) ----------

  _niceContourInterval(range) {
    // Target band count depends on precision: high = dense, low = sparse.
    const bands = this._contourPrecision === 'low' ? 7 : 28;
    const target = range / bands;
    const steps = [2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    for (const s of steps) {
      if (s >= target) return s;
    }
    return 2000;
  }

  _createContours(grid, bbox) {
    const flat = grid.flat();
    const minElev = Math.min(...flat);
    const maxElev = Math.max(...flat);
    const range = maxElev - minElev;

    const interval = this._niceContourInterval(Math.max(range, 1));
    const majorEvery = this._contourPrecision === 'low' ? 4 : 5;

    this._terrainInfo = {
      elevMin: minElev,
      elevMax: maxElev,
      contourInterval: interval,
      gridSize: GRID_SIZE,
    };

    if (range < 1) return;

    this.contourGroup = new THREE.Group();
    this.contourLabelGroup = new THREE.Group();

    const minorVerts = [];
    const majorVerts = [];
    const labelAnchors = []; // { level, point: Vector3 }

    const startLevel = Math.ceil(minElev / interval) * interval;
    for (let level = startLevel; level < maxElev; level += interval) {
      const isMajor = Math.round(level / interval) % majorEvery === 0;
      const segments = this._marchingSquares(grid, level, bbox);
      const sink = isMajor ? majorVerts : minorVerts;
      for (const seg of segments) {
        sink.push(seg.a.x, seg.a.y, seg.a.z, seg.b.x, seg.b.y, seg.b.z);
      }
      if (isMajor && segments.length) {
        // Pick a mid segment so the label sits inside the terrain, not on an edge.
        const mid = segments[Math.floor(segments.length / 2)];
        labelAnchors.push({
          level,
          point: new THREE.Vector3(
            (mid.a.x + mid.b.x) / 2,
            (mid.a.y + mid.b.y) / 2 + 4,
            (mid.a.z + mid.b.z) / 2
          ),
        });
      }
    }

    const ms = this._markerScale || 1;

    // Wide (pixel-width) iso-lines so they read clearly and are ~2× the old
    // 1px hairlines.
    if (minorVerts.length) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(minorVerts);
      const mat = new LineMaterial({ color: 0xe8d9b5, linewidth: 2, transparent: true, opacity: 0.4 });
      const seg = new LineSegments2(geo, mat);
      seg.computeLineDistances();
      this.contourGroup.add(seg);
      this._lineMaterials.push(mat);
    }

    if (majorVerts.length) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(majorVerts);
      const mat = new LineMaterial({ color: 0xfff0c2, linewidth: 3.5, transparent: true, opacity: 0.75 });
      const seg = new LineSegments2(geo, mat);
      seg.computeLineDistances();
      this.contourGroup.add(seg);
      this._lineMaterials.push(mat);
    }

    this.scene.add(this.contourGroup);

    // Elevation labels, scaled to the terrain so they're actually legible (the
    // old fixed 40×14 size was invisible on real-scale terrain).
    for (const anchor of labelAnchors) {
      const label = this._createLabel(`${Math.round(anchor.level)} m`, anchor.point.x, anchor.point.y, anchor.point.z, 0xfff0c2);
      label.scale.set(48 * ms, 16 * ms, 1);
      this.contourLabelGroup.add(label);
    }
    this.scene.add(this.contourLabelGroup);
    this._updateLineResolutions();
  }

  _cellToWorld(fi, fj, level, bbox) {
    const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * fi / (GRID_SIZE - 1);
    const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * fj / (GRID_SIZE - 1);
    const p = this._latLngToLocal(lat, lng, level + 2, bbox);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  // Marching squares over the elevation grid for a single iso-level.
  _marchingSquares(grid, level, bbox) {
    const segments = [];
    const lerp = (a, b) => (level - a) / (b - a);

    for (let i = 0; i < GRID_SIZE - 1; i++) {
      for (let j = 0; j < GRID_SIZE - 1; j++) {
        const tl = grid[i][j];
        const tr = grid[i][j + 1];
        const br = grid[i + 1][j + 1];
        const bl = grid[i + 1][j];

        let idx = 0;
        if (tl > level) idx |= 8;
        if (tr > level) idx |= 4;
        if (br > level) idx |= 2;
        if (bl > level) idx |= 1;
        if (idx === 0 || idx === 15) continue;

        // Edge crossing points in fractional grid coords.
        const top = () => [i, j + lerp(tl, tr)];
        const right = () => [i + lerp(tr, br), j + 1];
        const bottom = () => [i + 1, j + lerp(bl, br)];
        const left = () => [i + lerp(tl, bl), j];

        const pairs = [];
        switch (idx) {
          case 1: case 14: pairs.push([left, bottom]); break;
          case 2: case 13: pairs.push([bottom, right]); break;
          case 3: case 12: pairs.push([left, right]); break;
          case 4: case 11: pairs.push([top, right]); break;
          case 6: case 9: pairs.push([top, bottom]); break;
          case 7: case 8: pairs.push([top, left]); break;
          case 5: pairs.push([top, right], [bottom, left]); break;
          case 10: pairs.push([top, left], [bottom, right]); break;
          default: break;
        }

        for (const [ea, eb] of pairs) {
          const [ai, aj] = ea();
          const [bi, bj] = eb();
          segments.push({
            a: this._cellToWorld(ai, aj, level, bbox),
            b: this._cellToWorld(bi, bj, level, bbox),
          });
        }
      }
    }
    return segments;
  }

  // Route gradient colour at arc-length fraction f (0..1), matching the 2D map.
  // Falls back to the legacy cyan when no per-vertex colours were supplied.
  _routeColorAtFrac(f) {
    const cols = this._routeColors;
    if (!cols || !cols.length) return new THREE.Color(0x00d4ff);
    if (cols.length === 1) return cols[0].clone();
    const D = this._distances;
    if (D && D.length === cols.length && this._totalDistM > 0) {
      const { idx, f: ff } = this._bracketByDist(this._clampU(f) * this._totalDistM);
      const a = cols[idx];
      const b = cols[Math.min(idx + 1, cols.length - 1)];
      return a.clone().lerp(b, ff);
    }
    const idx = Math.max(0, Math.min(cols.length - 1, Math.round(this._clampU(f) * (cols.length - 1))));
    return cols[idx].clone();
  }

  _createRoutePath(coords, elevations, bbox) {
    if (!coords || coords.length < 2) return;

    const hasGradient = !!(this._routeColors && this._routeColors.length === coords.length);
    const legacyColor = new THREE.Color(0x00d4ff);
    const pts = coords.map(([lat, lng], i) => {
      const elev = elevations?.[i] ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + 5, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    });

    const curve = new THREE.CatmullRomCurve3(pts);

    // Tube geometry gives the track a shaded 3D body. Radius doubled for a
    // noticeably thicker track. Gradient colours are applied ring-by-ring so it
    // reads like the 2D route line.
    const tubularSegments = Math.min(pts.length * 2, 200);
    const radialSegments = 6;
    const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, 6, radialSegments, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: hasGradient ? 0xffffff : legacyColor,
      vertexColors: hasGradient,
      emissive: hasGradient ? 0x000000 : legacyColor,
      emissiveIntensity: hasGradient ? 0 : 0.3,
      roughness: 0.4,
      metalness: 0.3,
    });
    if (hasGradient) {
      const ringCount = tubularSegments + 1;
      const vertsPerRing = radialSegments + 1;
      const colorArr = new Float32Array(ringCount * vertsPerRing * 3);
      for (let ring = 0; ring < ringCount; ring++) {
        const col = this._routeColorAtFrac(ringCount > 1 ? ring / (ringCount - 1) : 0);
        for (let j = 0; j < vertsPerRing; j++) {
          const vi = (ring * vertsPerRing + j) * 3;
          colorArr[vi] = col.r;
          colorArr[vi + 1] = col.g;
          colorArr[vi + 2] = col.b;
        }
      }
      tubeGeo.setAttribute('color', new THREE.Float32BufferAttribute(colorArr, 3));
    }
    this.routeTube = new THREE.Mesh(tubeGeo, tubeMat);
    this.routeTube.castShadow = true;
    this.scene.add(this.routeTube);

    // Bright always-on overlay line carrying the same gradient. A wide (pixel
    // width) Line2 so the track stays clearly visible and thick at any zoom.
    const positions = [];
    for (const v of pts) positions.push(v.x, v.y, v.z);
    const lineGeo = new LineGeometry();
    lineGeo.setPositions(positions);
    if (hasGradient) {
      const lineColors = [];
      for (let i = 0; i < coords.length; i++) {
        const col = this._routeColors[i];
        lineColors.push(col.r, col.g, col.b);
      }
      lineGeo.setColors(lineColors);
    }
    const lineMat = new LineMaterial({
      color: hasGradient ? 0xffffff : 0x88eeff,
      vertexColors: hasGradient,
      linewidth: 4,           // screen-space pixels
      transparent: true,
      opacity: 0.95,
    });
    this.routeLine = new Line2(lineGeo, lineMat);
    this.routeLine.computeLineDistances();
    this.scene.add(this.routeLine);
    this._lineMaterials.push(lineMat);
  }

  _createWaypoints(waypoints, bbox) {
    if (!waypoints || waypoints.length === 0) return;
    const ms = this._markerScale || 1;

    waypoints.forEach((wp, i) => {
      const [lat, lng] = wp.coords || wp;
      const elev = wp.elevation ?? 0;
      const p = this._latLngToLocal(lat, lng, elev, bbox);

      // Prefer the gradient colour supplied by the 2D map (per-waypoint); fall
      // back to the legacy start/mid/end scheme when none is given.
      const fallbackCss = i === 0 ? '#00ff88' : (i === waypoints.length - 1 ? '#ff4466' : '#ffaa44');
      const colorCss = wp.color || fallbackCss;

      const name = wp.label || `WP${i + 1}`;
      const detail = {
        type: 'waypoint',
        index: i,
        label: name,
        colorCss,
        elevation: wp.elevation ?? null,
        lat, lng,
        distanceM: wp.distanceM ?? null,
        isStart: i === 0,
        isEnd: i === waypoints.length - 1,
      };

      // Signboard billboard whose downward pin points at the waypoint — no ground
      // sphere. Half the previous size. Click → detail.
      const sign = this._createBillboard(name, colorCss);
      const signH = 13 * ms;
      sign.scale.set(signH * (256 / 96), signH, 1);
      sign.position.set(p.x, p.y, p.z);
      sign.userData.detail = detail;
      this.scene.add(sign);
      this.waypointMarkers.push(sign);
      this._pickables.push(sign);
    });
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // A signboard-style billboard (rounded plaque with a colour-keyed border and a
  // downward pin) showing a name; always faces the camera.
  _createBillboard(text, colorCss) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 96);

    ctx.font = 'bold 30px Inter, "Noto Sans TC", sans-serif';
    const tw = ctx.measureText(text).width;
    const bw = Math.min(244, Math.max(80, tw + 60));
    const bh = 52;
    const bx = (256 - bw) / 2;
    const by = 5;

    // Pin tail pointing down toward the marker.
    ctx.beginPath();
    ctx.moveTo(128 - 11, by + bh - 2);
    ctx.lineTo(128 + 11, by + bh - 2);
    ctx.lineTo(128, by + bh + 18);
    ctx.closePath();
    ctx.fillStyle = colorCss;
    ctx.fill();

    // Plaque.
    this._roundRectPath(ctx, bx, by, bw, bh, 12);
    ctx.fillStyle = 'rgba(12,14,20,0.92)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = colorCss;
    ctx.stroke();

    // Colour dot + name.
    ctx.fillStyle = colorCss;
    ctx.beginPath();
    ctx.arc(bx + 18, by + bh / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 32, by + bh / 2 + 1, bw - 44);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.center.set(0.5, 0);
    return sprite;
  }

  _createWeatherLabels(weatherPoints, bbox) {
    if (!weatherPoints || weatherPoints.length === 0) return;

    this.weatherGroup = new THREE.Group();
    this.scene.add(this.weatherGroup);

    weatherPoints.forEach((pt) => {
      if (!pt || !pt.coords) return;
      const [lat, lng] = pt.coords;
      const elev = pt.elevation ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + 25, bbox);

      const icon = pt.weatherCode != null ? TerrainViewer.weatherIcon(pt.weatherCode) : '☀️';

      const temp = pt.temperature != null ? `${Math.round(pt.temperature)}°C` : '';
      const text = [icon, temp].filter(Boolean).join(' ');
      if (!text) return;

      const label = this._createLabel(text, p.x, p.y, p.z, 0x44aaff);
      // Scale to the terrain so the labels are legible (the default fixed size is
      // invisible on real-scale terrain).
      const ms = this._markerScale || 1;
      label.scale.set(60 * ms, 20 * ms, 1);
      label.userData.detail = {
        type: 'weather',
        label: pt.label || '天氣點',
        icon,
        temperature: pt.temperature ?? null,
        weatherCode: pt.weatherCode ?? null,
        elevation: pt.elevation ?? null,
        lat, lng,
      };
      this.weatherGroup.add(label);
      this.weatherLabels.push(label);
      this._pickables.push(label);
    });
  }

  _createLabel(text, x, y, z, colorHex) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 80;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 32px Inter, "Noto Sans TC", sans-serif';
    const metrics = ctx.measureText(text);
    const tw = metrics.width;

    const pad = 16;
    const bw = tw + pad * 2;
    const bh = 50;
    const bx = (canvas.width - bw) / 2;
    const by = (canvas.height - bh) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y, z);
    sprite.scale.set(60, 20, 1);
    return sprite;
  }

  _setupPlayer(coords, elevations, bbox) {
    if (!coords || coords.length < 2) return;
    const ms = this._markerScale || 1;

    const pts = coords.map(([lat, lng], i) => {
      const elev = elevations?.[i] ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + 20, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    });

    this.playerPath = new THREE.CatmullRomCurve3(pts);
    this.playerMarker = null;   // no sphere — the inverted-cone cursor marks the spot

    // 3D position cursor: a single inverted cone (tip pointing down at the route
    // point) sitting just below the hiker. Half the previous marker size.
    this._cursorGroup = new THREE.Group();
    const coneH = 13 * ms;
    this._cursorHeight = coneH;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(6 * ms, coneH, 16),
      new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff5500, emissiveIntensity: 0.9 })
    );
    cone.rotation.x = Math.PI;        // apex points straight down at the point
    cone.position.y = coneH / 2;      // tip at the cursor-group origin (the point)
    this._cursorGroup.add(cone);
    this._cursorCone = cone;
    this.scene.add(this._cursorGroup);

    // Animated hiker sprite riding just above the cursor cone (half size).
    this._person = this._createPersonSprite();
    this._person.scale.set(20 * ms, 26 * ms, 1);
    this.scene.add(this._person);

    // Progress ring (half size).
    const ringGeo = new THREE.RingGeometry(6.5 * ms, 9 * ms, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    this.playerRing = new THREE.Mesh(ringGeo, ringMat);
    this.scene.add(this.playerRing);

    // Trail line behind player
    const trailMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.3 });
    const trailGeo = new THREE.BufferGeometry();
    this.playerTrail = new THREE.Line(trailGeo, trailMat);
    this.scene.add(this.playerTrail);

    this._progress = 0;
    this._updatePlayerPosition();

    // Remove existing player light if any
    if (this._playerLight) {
      this.scene.remove(this._playerLight);
    }
    this._playerLight = new THREE.PointLight(0xff6600, 0.5, Math.max(500, 600 * ms));
    this.scene.add(this._playerLight);
  }

  // A canvas-drawn hiker that always faces the camera. Drawn once; the gait is
  // produced by bobbing/leaning the sprite, so it stays light and never blocks
  // the terrain behind it.
  _createPersonSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '84px "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚶', canvas.width / 2, canvas.height / 2 + 6);
    // Guaranteed vector fallback for renderers without colour emoji.
    const rendered = ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0);
    if (!rendered) {
      const cx = canvas.width / 2;
      ctx.fillStyle = '#ff8a3c';
      ctx.strokeStyle = '#ff8a3c';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, 30, 14, 0, Math.PI * 2); ctx.fill();          // head
      ctx.beginPath(); ctx.moveTo(cx, 44); ctx.lineTo(cx, 86); ctx.stroke();      // torso
      ctx.beginPath(); ctx.moveTo(cx, 56); ctx.lineTo(cx - 20, 74);              // arms
      ctx.moveTo(cx, 56); ctx.lineTo(cx + 20, 70); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, 86); ctx.lineTo(cx - 18, 116);            // legs (mid-stride)
      ctx.moveTo(cx, 86); ctx.lineTo(cx + 16, 116); ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(34, 45, 1);
    sprite.center.set(0.5, 0);
    return sprite;
  }

  _updatePlayerPosition() {
    if (!this.playerPath) return;

    // Arc-length parameterised so progress (and the readout) advances by
    // distance travelled, matching the mileage/altitude/time figures.
    const ms = this._markerScale || 1;
    const coneH = this._cursorHeight || 0;
    const pt = this.playerPath.getPointAt(this._clampU(this._progress));

    if (this._cursorGroup) {
      const bob = Math.sin(this._personPhase * 4) * 3 * ms;
      this._cursorGroup.position.set(pt.x, pt.y + bob, pt.z);
      if (this._cursorCone) this._cursorCone.rotation.y += 0.04;
    }

    if (this._person) {
      const bob = Math.sin(this._personPhase * 8) * (this._playing ? 3 : 0) * ms;
      const lean = Math.cos(this._personPhase * 8) * (this._playing ? 0.06 : 0);
      // Ride just above the cursor cone.
      this._person.position.set(pt.x, pt.y + coneH + 2 * ms + bob, pt.z);
      this._person.material.rotation = lean;
    }

    if (this.playerRing) {
      this.playerRing.position.copy(pt);
      this.playerRing.lookAt(this.camera.position);
    }

    if (this.playerTrail) {
      const trailCount = Math.floor(this._progress * 100);
      if (trailCount >= 2) {
        const trailPts = [];
        for (let i = Math.max(0, trailCount - 30); i <= trailCount; i++) {
          const t = i / 100;
          if (t <= this._progress) {
            trailPts.push(this.playerPath.getPointAt(this._clampU(t)));
          }
        }
        const trailGeo = new THREE.BufferGeometry().setFromPoints(trailPts);
        this.playerTrail.geometry.dispose();
        this.playerTrail.geometry = trailGeo;
      }
    }

    if (this._playerLight) {
      this._playerLight.position.copy(pt);
    }

    const metrics = this._metricsAtProgress(this._progress);
    this._applyEnvironment(metrics);
    this._emitMetrics(false, metrics);
  }

  _clampU(u) {
    return Math.max(0, Math.min(1, u));
  }

  // Find the route vertex bracket + interpolation factor for a cumulative
  // distance, via binary search over the cumulative-distance array.
  _bracketByDist(cumDistM) {
    const D = this._distances;
    if (!D || D.length < 2) return { idx: 0, f: 0 };
    if (cumDistM <= D[0]) return { idx: 0, f: 0 };
    const last = D.length - 1;
    if (cumDistM >= D[last]) return { idx: last - 1, f: 1 };
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (D[mid] <= cumDistM) lo = mid; else hi = mid;
    }
    const span = D[hi] - D[lo];
    return { idx: lo, f: span > 0 ? (cumDistM - D[lo]) / span : 0 };
  }

  // Position-driven readout for the side HUD + the day/night animation.
  _metricsAtProgress(t) {
    const coords = this.routePoints;
    if (!coords || coords.length < 2 || !this._distances) {
      return { progress: t, dateMs: this._startMs };
    }
    const tt = this._clampU(t);
    const cumDistM = tt * this._totalDistM;
    const { idx, f } = this._bracketByDist(cumDistM);
    const j = Math.min(idx + 1, coords.length - 1);
    const lerp = (a, b) => a + (b - a) * f;

    const lat = lerp(coords[idx][0], coords[j][0]);
    const lng = lerp(coords[idx][1], coords[j][1]);
    const elev = this.routeElevations || [];
    const elevM = lerp(elev[idx] ?? 0, elev[j] ?? 0);
    const timeH = this._times ? lerp(this._times[idx] ?? 0, this._times[j] ?? 0) : null;
    const fatiguePct = this._fatigue ? lerp(this._fatigue[idx] ?? 0, this._fatigue[j] ?? 0) * 100 : null;

    // Smooth speed/grade over a small index window so single-segment noise
    // doesn't make the readout jump.
    const D = this._distances;
    const lo = Math.max(0, idx - 2);
    const hi = Math.min(D.length - 1, idx + 3);
    const wDist = D[hi] - D[lo];
    let speedKmh = null;
    if (this._times && wDist > 0) {
      const wTime = (this._times[hi] ?? 0) - (this._times[lo] ?? 0);
      if (wTime > 0) speedKmh = (wDist / 1000) / wTime;
    }
    const gradePct = wDist > 0 ? ((elev[hi] ?? 0) - (elev[lo] ?? 0)) / wDist * 100 : 0;

    const dateMs = (this._startMs != null && timeH != null) ? this._startMs + timeH * 3600000 : this._startMs;

    let weather = null;
    if (this._weatherPoints && this._weatherPoints.length) {
      let best = Infinity;
      let nearest = null;
      for (const pt of this._weatherPoints) {
        const c = pt.coords || (pt.lat != null ? [pt.lat, pt.lng] : null);
        if (!c) continue;
        const d = haversineDistance([lat, lng], c);
        if (d < best) { best = d; nearest = pt; }
      }
      if (nearest) {
        const code = nearest.weatherCode;
        weather = {
          code,
          cat: TerrainViewer.weatherCategory(code),
          icon: code != null ? TerrainViewer.weatherIcon(code) : '',
          temperature: nearest.temperature ?? nearest.temp ?? null,
        };
      }
    }

    return {
      progress: tt,
      lat,
      lng,
      distM: cumDistM,
      totalDistM: this._totalDistM,
      elevM,
      timeH,
      dateMs,
      speedKmh,
      gradePct,
      fatiguePct,
      weather,
    };
  }

  _emitMetrics(force, metrics) {
    if (!this._onMetrics) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!force && now - this._lastMetricsEmit < 80) return;
    this._lastMetricsEmit = now;
    this._onMetrics(metrics || this._metricsAtProgress(this._progress));
  }

  _clearScene() {
    const toRemove = [];
    this.scene.traverse((child) => {
      if (child !== this.scene && child !== this.camera) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(child => {
      this.scene.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    this.waypointMarkers = [];
    this.weatherLabels = [];
    this.terrainMesh = null;
    this.routeLine = null;
    this.routeTube = null;
    this.contourGroup = null;
    this.contourLabelGroup = null;
    this.waypointLabelGroup = null;
    this.weatherGroup = null;
    this.playerMarker = null;
    this.playerRing = null;
    this.playerTrail = null;
    this.playerPath = null;
    this._person = null;
    this._cursorGroup = null;
    this._cursorCone = null;
    this._cursorHeight = 0;
    this._pickables = [];
    this._lineMaterials = [];
    this._sun = null;
    this._sunTarget = null;
    this._moon = null;
    this._ambient = null;
    this._hemi = null;
    this._rain = null;
    this._snow = null;
    this._playerLight = null;
    if (this.scene) this.scene.fog = null;
  }

  // Keep wide-line (LineMaterial) resolution in sync with the renderer, else the
  // pixel-width lines render at the wrong thickness or vanish.
  _updateLineResolutions() {
    if (!this.renderer || !this._lineMaterials.length) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    for (const m of this._lineMaterials) {
      if (m && m.resolution) m.resolution.set(size.x, size.y);
    }
  }

  _setupResizeHandler() {
    if (this._resizeHandler) return;
    const handler = () => {
      if (!this.container || !this.renderer) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this._updateLineResolutions();
    };
    window.addEventListener('resize', handler);
    this._resizeHandler = handler;
  }

  _animate() {
    if (!this.container || this.container.classList.contains('hidden')) return;
    if (!this.renderer || !this.scene || !this.camera) return;

    this._animFrameId = requestAnimationFrame(() => this._animate());
    this.controls?.update();

    // One delta per frame (also avoids a progress jump after a long pause).
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this._playing && this.playerPath) {
      this._personPhase += dt * this._speed;
      this._progress += dt * this._speed * 0.05;
      if (this._progress >= 1) {
        this._progress = 1;
        this._playing = false;
      }
      this._updatePlayerPosition();
      if (this._onProgressChange) this._onProgressChange(this._progress);
    }

    // Weather keeps moving even while paused so a scrubbed-to frame still reads
    // as "raining/snowing", but stays subtle enough not to mask the terrain.
    this._updateWeatherParticles(dt);

    this.renderer.render(this.scene, this.camera);
  }
}
