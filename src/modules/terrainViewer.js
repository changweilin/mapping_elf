import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { haversineDistance, cumulativeDistances } from './utils.js';
import { WeatherFx3D } from './weatherFx3D.js';

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
// Overpass mirrors tried in order — the main instance is frequently rate-limited
// (429) or times out, which previously dropped the whole 圖資 layer. Falling
// through to mirrors makes the map-feature download succeed far more often.
const OVERPASS_APIS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const GRID_SIZE = 25;

// The coarse downloaded grid is lightly smoothed and upsampled to a finer field
// (SUBDIV fine samples per coarse cell) that is shared by BOTH the rendered
// surface and the iso-lines. This makes the terrain read smooth instead of
// faceted (kills the regular diagonal "corduroy" artefact) and keeps the
// contours hugging the same surface so they no longer break through it. Missing
// elevation (holes) propagates through, so blank tiles aren't drawn.
const SUBDIV = 6;
const FIELD_SIZE = (GRID_SIZE - 1) * SUBDIV + 1; // 145

// Render layer for the terrain surface. Day/night lighting (the route-clock sun/
// ambient/hemi/moon) lives on the default layer 0 and lights the 3D objects
// (landmarks, buildings, route, weather rigs) + the sky background only. The
// terrain mesh is moved to this dedicated layer and lit by a fixed midday rig
// (also on this layer), so the ground stays legible regardless of the time of
// day — "日夜只影響 3D 物件與背景，地形不受日夜效果渲染". The camera renders both
// layers; picking is unaffected (the terrain is not a raycast target).
const TERRAIN_LAYER = 1;

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
    // Vertical drop-line "stems" connecting a suspended (absolute-elevation) track
    // to the terrain surface below it (Plan §II-4). Built with the route, hidden
    // unless the 絕對海拔 (suspended) mode is on.
    this._routeStemGroup = null;
    this._absoluteElevation = false;
    // Time-dynamic trail reveal (Plan §II-1): when on, the tube + overlay line are
    // progressively revealed up to the player's current position (CZML-Path style)
    // instead of drawn whole. These cache the geometry's segment counts so the
    // per-frame draw-range/instance-count update is cheap.
    this._routeReveal = false;
    this._routeTubeSegs = 0;
    this._routeTubeRadial = 8;
    this._routeLineSegs = 0;
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

    // Global text-label size: 'large' (default) | 'small' | 'none'. Scales (or
    // hides) every billboard/text sprite on the model — contour heights, weather
    // tags, waypoint signs and map-feature names. Each registered sprite stores
    // its base scale so the factor is applied relative to that.
    this._labelScale = 'large';
    this._labelSprites = [];
    this._LABEL_FACTORS = { large: 1, small: 0.6, none: 0 };
    // Text labels whose name is wider than the fixed billboard get a 跑馬燈
    // (marquee): the name scrolls horizontally inside the box so the full text is
    // readable. Redraw is throttled by _marqueeAccum (see _animate) to keep the
    // per-frame canvas re-upload cheap on mobile.
    this._marqueeLabels = [];
    this._marqueeAccum = 0;

    // --- Map features (roads / water / land cover / buildings) ---
    this.featureGroup = null;
    this.featureLabelGroup = null;
    this._featuresVisible = true;
    this._weatherVisible = true;
    // Point-landmark models (peaks/trees/towers/viewpoints/monuments/etc.) are visual
    // embellishments rather than base map imagery, so 特效 (effects) can declutter
    // them independently of 圖資 — visible only when BOTH 圖資 and 特效 are on.
    this.landmarkGroup = null;
    this._windTurbineRotors = [];

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
    // Smoothed/upsampled height field shared by the surface mesh + contours, and
    // the valid (hole-excluded) elevation range over it.
    this._baseField = null;
    this._field = null;
    // Per-vertex land-cover family & fine sub-biome (FIELD_SIZE²) baked into terrain.
    this._landCoverField = null;
    this._subBiomeField = null;
    this._waterDistField = null;
    // Per-vertex geomorphology fields (FIELD_SIZE²): slope, aspect, curvature, AO.
    this._slopeField = null;
    this._aspectField = null;
    this._curvatureField = null;
    this._aoField = null;
    this._fieldMinV = 0;
    this._fieldMaxV = 1;
    this._terrainInfo = null;
    // Vertical datum: terrain (and everything on it) is shifted down by the
    // terrain's minimum elevation, so the empty band below the lowest ground
    // (e.g. sea-level 0–500 m that isn't on the map) isn't rendered.
    this._elevBase = 0;
    // Vertical scale applied to every elevation in _latLngToLocal. 1 = true scale.
    // When "海拔高度歸一化" is on, the scale is recomputed so the terrain's relief
    // fills a consistent fraction of its horizontal span regardless of how flat
    // or mountainous the area actually is.
    this._elevScale = 1;
    this._elevNormalized = false;
    // Cached source data for an in-place geometry rebuild (normalization toggle)
    // that doesn't re-download anything.
    this._buildCtx = null;
    this._featuresData = null;
    // Catchment basins draped on the terrain (Task 1). Data ({ outer, holes,
    // outlet, color }[]) is kept so an in-place rebuild can redraw them; the
    // group is rebuilt from it, and its visibility follows _catchmentVisible.
    this._catchmentBasinsData = null;
    this._catchmentGroup = null;
    this._catchmentVisible = false;
    // Bbox the in-memory _featuresData were built for, so a redraw can safely
    // reuse them as a fallback only when the area hasn't changed.
    this._featuresDataBbox = null;
    // True once a 圖資 download attempt for the CURRENT scene has run to
    // completion (success, genuine failure, or a legitimately empty result) —
    // as opposed to being cut short by a switch/close mid-flight. Distinguishes
    // "tried, nothing there" (don't keep re-fetching) from "never got a real
    // chance" (worth retrying on the cache-signature re-entry shortcut).
    this._featuresSettled = false;

    this._playing = false;
    this._speed = 1;
    this._progress = 0;
    this._animFrameId = null;
    this._onProgressChange = null;
    this._onPlayStateChange = null;
    this._onInfo = null;
    this._onLoad = null;
    this._onClose = null;
    this._onMetrics = null;
    this._onTerrainComputed = null;
    this._onFeaturesComputed = null;
    // Fired once a background map-feature download finishes and drapes onto the
    // model, so the UI can re-evaluate layer toggles (圖資 availability).
    this._onFeaturesReady = null;
    // Monotonic id of the current build; background feature loads carry the id
    // they started under and bail if it no longer matches (model was rebuilt).
    this._buildToken = 0;

    this._abortController = null;
    this._aborted = false;
    this._loading = false;

    // --- Pause/resume of the elevation-grid download (see pause()/resume()) ---
    this._paused = false;
    this._resumeCb = null;
    this._lastLoadState = null;   // most recent *real* onLoad state, excluding pause/resume echoes

    // --- Route timing / metrics (set in loadRouteData) ---
    this._distances = null;       // cumulative metres, aligned to routePoints
    this._times = null;           // cumulative elapsed hours, aligned to routePoints
    this._fatigue = null;         // per-vertex fatigue fraction 0..1
    this._cumAscent = null;       // cumulative climb (m) up to each vertex
    this._cumDescent = null;      // cumulative descent (m, positive) up to each vertex
    this._startMs = null;         // departure timestamp (ms epoch)
    this._totalDistM = 0;
    this._weatherPoints = [];
    this._centerLat = 0;
    this._centerLng = 0;
    this._worldSpan = 2000;       // approx terrain span (world units)

    // --- Environment (day/night + weather) ---
    this._envEnabled = true;
    this._weatherAnimEnabled = true; // rain/snow/sky-tint + volumetric weather rigs
    this._effectsEnabled = true;     // decorative landmark models (peaks/trees/towers/…)
    this._sun = null;
    this._sunTarget = null;
    this._moon = null;
    this._ambient = null;
    this._hemi = null;
    // Fixed midday rig that lights only the terrain (see _setupEnvironment).
    this._terrainSun = null;
    this._terrainSunTarget = null;
    this._terrainRim = null;
    this._terrainAmbient = null;
    this._terrainHemi = null;
    this._rain = null;
    this._snow = null;
    this._currentWeatherCat = 'clear';
    this._lightningT = 0;
    this._lightningTimer = 4 + Math.random() * 6;

    // --- Weather marker badges + real 3D weather phenomena ---
    // Each weather point gets a compact static badge (emoji + temperature, for
    // at-a-glance reading and click-to-inspect). The actual animation is no longer
    // a flat icon: a volumetric 3D weather rig (drifting cloud banks, falling rain
    // shafts, swirling snow, ground fog, a pulsing sun, forked lightning) grows in
    // world space at each point — see WeatherFx3D — gated by the 3-state 天氣
    // toggle (on: animates; noAnim/off: hidden).
    this._weatherIconEntries = [];
    this._weather3d = null;

    // --- Animated hiker ---
    this._person = null;
    this._personPhase = 0;
    // Smoothed facing direction: like the chase cam's _followDir, the figure
    // turns toward a look-ahead chord (temporally low-passed) instead of the
    // jittery instantaneous tangent, so it stops twitching on wiggly tracks and
    // walks a smoother path.
    this._personDir = new THREE.Vector3(0, 0, 1);

    // --- Relive-style follow camera (chase cam during playback) ---
    this._followCam = true;           // user preference (persisted by the host UI)
    this._followUserOverride = false; // user grabbed the camera mid-playback; wins until next play()
    this._followPosTmp = new THREE.Vector3();
    this._followTargetTmp = new THREE.Vector3();
    // Smoothed chase heading: follows the route's big-picture direction (a
    // look-ahead chord, temporally low-passed) instead of the jittery
    // instantaneous tangent, so the camera stops shaking on wiggly tracks.
    this._followDir = new THREE.Vector3(0, 0, 1);
    // Relive-style waypoint stops: pause + close-up orbit when the walker
    // reaches each waypoint, then continue. Built in _createWaypoints.
    this._waypointStops = [];         // sorted [{ u, detail }]
    this._nextStopIdx = 0;
    this._pauseUntil = 0;             // performance.now() ms; >now = holding at a stop
    this._orbitAngle = 0;
    this._waypointPauseMs = 2600;
    this._onWaypointArrive = null;
    // Start/end waypoint details, dealt as playback cards at the trailhead and
    // finish (mid-route stops live in _waypointStops).
    this._startDetail = null;
    this._endDetail = null;
    // Satellite imagery + OSM + geomorphology surface synthesis:
    // Esri tiles are mosaicked into _satCanvas / _satImageData and fused with OSM
    // land-cover and DEM geomorphology to synthesize high-detail albedo, bump and
    // roughness maps for the terrain mesh.
    this._satelliteEnabled = false;
    this._satTexture = null;
    this._satTextureKey = null;
    this._satCanvas = null;
    this._satCanvasKey = null;
    this._satImageData = null;
    this._surfaceMap = null;
    this._surfaceBumpMap = null;
    this._surfaceRoughMap = null;
    this._onSatelliteError = null;
    // Playback staging: reveal-as-walked engaged by play() (independent of the
    // persisted 揭示 toggle), and the opening fly-in timer (Infinity = no intro).
    this._playbackReveal = false;
    this._introElapsed = Infinity;

    this._lastMetricsEmit = 0;
  }

  show() {
    this.container.classList.remove('hidden');
    if (!this._checkWebGL()) {
      throw new Error('WebGL 無法使用，請更新瀏覽器或檢查顯示卡設定');
    }
    try {
      this._initScene();
      // Only start the render loop if one isn't already running, so re-showing
      // an already-open viewer (e.g. the toolbar "更新" rebuild) doesn't spawn a
      // second requestAnimationFrame loop and double the render/playback rate.
      if (this._animFrameId == null) this._animate();
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

  // cb(playing) — fired when playback starts/stops, including the automatic stop
  // when the hiker reaches the end of the route, so the UI can sync its
  // play/pause button.
  onPlayStateChange(cb) {
    this._onPlayStateChange = cb;
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

  // cb({ features, bbox }) — fired once after a fresh map-feature download so the
  // caller can persist it alongside the terrain cache. Not fired on a cache hit.
  onFeaturesComputed(cb) {
    this._onFeaturesComputed = cb;
  }

  // cb() — fired once a background map-feature download has been draped onto the
  // model, so the UI can re-enable the 圖資 layer toggle now that features exist.
  onFeaturesReady(cb) {
    this._onFeaturesReady = cb;
  }

  isLoading() {
    return this._loading;
  }

  // True once a terrain model has been built and is still resident in the scene
  // (it survives hide()/show()). Lets the caller re-show a cached model on
  // re-entry instead of rebuilding it from scratch.
  hasBuiltScene() {
    return !!(this.scene && this.terrainMesh);
  }

  abort() {
    if (!this._loading) return;
    this._aborted = true;
    if (this._abortController) {
      try { this._abortController.abort(); } catch { /* noop */ }
    }
    this._wakePaused();   // unpark a paused elevation download so it can unwind
  }

  // state.blocking === false marks a non-blocking phase (e.g. the background 圖資
  // download): the model stays interactive and isLoading() reads false, even
  // though the same progress channel keeps counting up toward 100.
  _emitLoad(state) {
    this._loading = !!state.active && state.blocking !== false;
    if (!state.paused) this._lastLoadState = state;   // don't let a pause/resume echo overwrite the real snapshot
    if (this._onLoad) this._onLoad(state);
  }

  isPaused() {
    return this._paused;
  }

  // Pauses the elevation-grid download between batches (see _fetchElevationGrid).
  // No-op once the (fast, synchronous) mesh-build phase has started — there's no
  // await point left for a pause to take effect on.
  pause() {
    if (!this._loading || this._paused || this._aborted || !this._lastLoadState) return;
    this._paused = true;
    this._emitLoad({ ...this._lastLoadState, active: true, paused: true, detail: '已暫停' });
  }

  resume() {
    if (!this._paused) return;
    if (this._lastLoadState) this._emitLoad({ ...this._lastLoadState, active: true, paused: false });
    this._wakePaused();
  }

  _wakePaused() {
    this._paused = false;
    const cb = this._resumeCb;
    this._resumeCb = null;
    cb?.();
  }

  _waitIfPaused() {
    if (!this._paused) return Promise.resolve();
    return new Promise((resolve) => { this._resumeCb = resolve; });
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

  // Record a text sprite + its authored base scale so the global label-size
  // control can rescale/hide it later. Called right after the caller sets the
  // sprite's scale.
  _registerLabel(sprite) {
    if (!sprite || !sprite.scale) return sprite;
    sprite.userData.baseScale = { x: sprite.scale.x, y: sprite.scale.y };
    this._labelSprites.push(sprite);
    this._applyLabelScaleTo(sprite);
    return sprite;
  }

  _applyLabelScaleTo(sprite) {
    const base = sprite.userData.baseScale;
    if (!base) return;
    const f = this._LABEL_FACTORS[this._labelScale] ?? 1;
    if (f <= 0) {
      sprite.visible = false;
    } else {
      sprite.visible = true;
      sprite.scale.set(base.x * f, base.y * f, 1);
    }
  }

  // Global text-label size: 'large' | 'small' | 'none'. Rescales (or hides)
  // every registered text sprite. Group-level toggles (weather/contour labels)
  // still gate their own groups, so a label shows only when both allow it.
  setLabelScale(scale) {
    const s = (scale === 'small' || scale === 'none') ? scale : 'large';
    this._labelScale = s;
    for (const sprite of this._labelSprites) this._applyLabelScaleTo(sprite);
  }

  getLabelScale() {
    return this._labelScale;
  }

  setFeaturesVisible(visible) {
    this._featuresVisible = !!visible;
    if (this.featureGroup) this.featureGroup.visible = this._featuresVisible;
    if (this.featureLabelGroup) this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();
  }

  isFeaturesVisible() {
    return this._featuresVisible;
  }

  hasMapFeatures() {
    return !!(this.featureGroup && this.featureGroup.children.length);
  }

  // ---------- Catchment basins (Task 1) ----------
  // The main.js host owns the 集水區 computation (cache-first DEM delineation of
  // each 主航點); it feeds the resulting lat/lng rings here to be draped on the
  // terrain surface. Coordinates for the currently displayed model's 主航點 (so a
  // favourite-peek uses the right waypoints).
  getWaypointCoords() {
    const wps = this._buildCtx?.waypoints;
    if (!Array.isArray(wps)) return [];
    return wps
      .map((w) => ({
        coords: w.coords || (w.lat != null ? [w.lat, w.lng] : null),
        color: w.color || null,
        label: w.label || null,
      }))
      .filter((w) => Array.isArray(w.coords) && w.coords.length === 2);
  }

  // Replace the whole basin set. basins: { outer:[[lat,lng]…], holes:[[…]],
  // outlet:[lat,lng], color? }[].
  setCatchmentBasins(basins) {
    this._catchmentBasinsData = Array.isArray(basins) ? basins.slice() : null;
    this._drawCatchmentBasins();
  }

  // Append one basin incrementally (主航點 draw-as-computed), without disposing the
  // group — so basins pop in one by one as their DEM finishes.
  addCatchmentBasin(basin) {
    if (!basin || !Array.isArray(basin.outer) || basin.outer.length < 3) return;
    if (!this._catchmentBasinsData) this._catchmentBasinsData = [];
    this._catchmentBasinsData.push(basin);
    this._ensureCatchmentGroup();
    if (this._catchmentGroup) this._buildOneCatchmentBasin(basin, this._catchmentGroup);
  }

  setCatchmentVisible(on) {
    this._catchmentVisible = !!on;
    if (this._catchmentGroup) this._catchmentGroup.visible = this._catchmentVisible;
  }

  isCatchmentVisible() {
    return this._catchmentVisible;
  }

  clearCatchmentBasins() {
    this._catchmentBasinsData = null;
    this._disposeCatchmentGroup();
  }

  // Re-attempt the background 圖資 download for the scene the caller is about to
  // re-show without a rebuild (main.js's cache-signature "already built" shortcut)
  // when it never ran to completion last time — e.g. the user switched to another
  // route or closed the viewer before the Overpass fetch resolved. Gated on
  // _featuresSettled rather than hasMapFeatures() so a route that genuinely has
  // no OSM features nearby (settled, just empty) isn't re-fetched every time the
  // shortcut fires. Safe to call even if an earlier attempt is still in flight:
  // that one just gets superseded (its result, if it lands, is still persisted —
  // see _loadMapFeaturesInBackground).
  retryMapFeaturesIfMissing(cacheKeyForThisBuild) {
    if (this._featuresSettled || !this.scene || !this._bbox) return false;
    const token = (this._buildToken = (this._buildToken || 0) + 1);
    this._emitLoad({ active: true, percent: 90, blocking: false, title: '建立地形模型', detail: '更新圖資中…' });
    this._loadMapFeaturesInBackground(this._bbox, token, this._featuresData, this._featuresDataBbox, cacheKeyForThisBuild);
    return true;
  }

  // True once a point-landmark model (peak/tree/tower/viewpoint/monument) exists,
  // so the 特效 toggle's expanded scope has something to show/hide.
  hasLandmarks() {
    return !!(this.landmarkGroup && this.landmarkGroup.children.length);
  }

  // Landmarks need BOTH layers on: 圖資 gates them as map-derived content, 特效
  // additionally lets the user declutter these decorative models independently
  // of the weather layer/animation.
  _applyLandmarkVisibility() {
    if (this.landmarkGroup) this.landmarkGroup.visible = this._featuresVisible && this._effectsEnabled;
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
    if (!this.scene || !this._grid || !this._bbox || !this._field) return;
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
        // Drop contour-label sprites from the global label registry so the
        // label-size control doesn't keep touching disposed sprites.
        if (child.isSprite) this._labelSprites = this._labelSprites.filter((s) => s !== child);
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
    this._createContours(this._bbox);
    if (this.contourLabelGroup) this.contourLabelGroup.visible = this._contourLabelsVisible;
    if (this._onInfo) this._onInfo(this._terrainInfo);
  }

  // cb(detail) — fired when a 3D billboard/waypoint marker is clicked.
  onMarkerClick(cb) {
    this._onMarkerClick = cb;
  }

  // cb(detail) — fired when Relive-style playback reaches a waypoint stop, so
  // the host can surface that waypoint's content during the close-up pause.
  onWaypointArrive(cb) {
    this._onWaypointArrive = cb;
  }

  // Toggles the weather badge/label layer (the 3-state 天氣 button's "hints").
  // Turning hints off also implies no animation (nothing left to animate).
  setWeatherVisible(visible) {
    this._weatherVisible = !!visible;
    if (this.weatherGroup) this.weatherGroup.visible = this._weatherVisible;
    this._applyWeather3DVisibility();
  }

  // The 3D weather phenomena are the weather layer's animation: shown only when
  // BOTH the 天氣 hints are visible AND the animation state is on (the 3-state
  // 天氣 button's middle state keeps hints but drops this).
  _applyWeather3DVisibility() {
    if (this._weather3d) this._weather3d.setVisible(this._weatherVisible && this._weatherAnimEnabled);
  }

  // Day/night + directional sunlight driven by the route time. When off, the
  // scene falls back to a neutral, evenly-lit look.
  setEnvironmentEnabled(enabled) {
    this._envEnabled = !!enabled;
    this._applyEnvironment(this._metricsAtProgress(this._progress));
  }

  // Weather animation: precipitation particles, weather-driven sky/fog tint, and
  // the volumetric 3D weather rigs. Driven by the 3-state 天氣 button (on / no
  // animation / off) — independent of the 特效 (landmark decoration) toggle.
  setWeatherAnimEnabled(enabled) {
    this._weatherAnimEnabled = !!enabled;
    if (this._rain) this._rain.visible = false;
    if (this._snow) this._snow.visible = false;
    this._applyEnvironment(this._metricsAtProgress(this._progress));
    this._applyWeather3DVisibility();
  }

  // 特效: declutters the point-landmark models (peaks/trees/towers/viewpoints/
  // monuments) — they're decoration on top of the base 圖資 layer, not the map
  // data itself, so this can hide them without touching weather or the route.
  setEffectsEnabled(enabled) {
    this._effectsEnabled = !!enabled;
    this._applyLandmarkVisibility();
  }

  isEnvironmentEnabled() {
    return this._envEnabled;
  }

  isWeatherAnimEnabled() {
    return this._weatherAnimEnabled;
  }

  isEffectsEnabled() {
    return this._effectsEnabled;
  }

  // --- Layer availability: lets the UI grey out toggles that can't do anything
  // for this route (no weather points, no precipitation, no major-contour
  // labels), so a no-op toggle doesn't look broken.
  hasWeatherData() {
    return !!(this.weatherGroup && this.weatherLabels.length);
  }

  hasContourLabels() {
    return !!(this.contourLabelGroup && this.contourLabelGroup.children.length);
  }

  // True when any weather point along the route is something the FX layer can
  // actually show (rain/snow/fog/cloud tint) — i.e. not plain clear sky.
  routeHasWeatherFx() {
    return (this._weatherPoints || []).some((p) => {
      const code = p?.weatherCode;
      return code != null && TerrainViewer.weatherCategory(code) !== 'clear';
    });
  }

  play() {
    if (!this.playerPath || this.playerPath.getPoint(0) === undefined) return;
    // Pressing play after the hiker has reached the end restarts from the start
    // instead of sitting stuck at 100%.
    if (this._progress >= 1) {
      this._progress = 0;
      this._updatePlayerPosition();
      if (this._onProgressChange) this._onProgressChange(this._progress);
    }
    // Relive-style playback staging: the track reveals as it is walked (without
    // flipping the user's persisted 揭示 toggle), and starting from the trailhead
    // opens with a fly-in from a high overview down into the chase position.
    if (!this._routeReveal && !this._playbackReveal) {
      this._playbackReveal = true;
    }
    if (this._followCam && this._progress <= 0.001) this._introElapsed = 0;
    // Resume immediately (don't stay parked in a waypoint pause) and re-arm the
    // next Relive stop for wherever playback is resuming from.
    this._pauseUntil = 0;
    this._syncStopIdx();
    this._playing = true;
    // Now that playback is live, clamp the track back to the walked fraction (it
    // was restored to full while paused).
    this._applyRouteReveal();
    this._followUserOverride = false;
    if (this.controls) this.controls.autoRotate = false;
    if (this._onPlayStateChange) this._onPlayStateChange(true);
    // Deal the trailhead card as the fly-in sweeps down (metrics read at u=0).
    if (this._progress <= 0.001 && this._onWaypointArrive && this._startDetail) {
      this._onWaypointArrive(this._startDetail);
    }
  }

  pause() {
    const was = this._playing;
    this._playing = false;
    // Pausing restores the full track; play() re-clamps it to the walked fraction.
    this._applyRouteReveal();
    if (was && this._onPlayStateChange) this._onPlayStateChange(false);
  }

  setSpeed(speed) {
    this._speed = speed;
  }

  setProgress(t) {
    if (this.controls) this.controls.autoRotate = false;
    this._progress = Math.max(0, Math.min(1, t));
    // Scrubbing cancels any active waypoint pause and re-arms the next stop.
    this._pauseUntil = 0;
    this._syncStopIdx();
    this._updatePlayerPosition();
    this._emitMetrics(true);
    if (this._onProgressChange) this._onProgressChange(this._progress);
  }

  // Point _nextStopIdx at the first Relive stop still ahead of the playhead.
  _syncStopIdx() {
    const stops = this._waypointStops || [];
    let i = 0;
    while (i < stops.length && stops[i].u <= this._progress) i++;
    this._nextStopIdx = i;
  }

  getProgress() {
    return this._progress;
  }

  // Public read-only snapshot of the position-driven metrics (date/time, mileage,
  // altitude, speed, grade, fatigue, weather) at a given playback fraction — used
  // by the host to populate the Relive close-up waypoint card.
  metricsAt(u = this._progress) {
    return this._metricsAtProgress(u);
  }

  isPlaying() {
    return this._playing;
  }

  getSpeed() {
    return this._speed;
  }

  // Snapshot the camera pose + playback position/speed so a caller can restore
  // them later — e.g. the player's playlist hopping back to a route it left.
  getViewState() {
    if (!this.camera || !this.controls) return null;
    return {
      pos: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      progress: this._progress,
      speed: this._speed,
    };
  }

  // Restore a previously captured view state onto the currently built scene.
  // Camera coordinates are local to the route/bbox they were captured from, so
  // this is only meaningful when re-applied to that same route.
  applyViewState(state) {
    if (!state || !this.camera || !this.controls) return;
    if (Array.isArray(state.pos)) this.camera.position.fromArray(state.pos);
    if (Array.isArray(state.target)) this.controls.target.fromArray(state.target);
    this.controls.update();
    if (Number.isFinite(state.speed)) this._speed = state.speed;
    if (Number.isFinite(state.progress)) this.setProgress(state.progress);
  }

  // Relive-style chase cam: while playing, the camera glides behind the hiker
  // along the travel direction and looks slightly ahead. Off = classic free
  // orbit. A manual drag mid-playback suspends it until the next play().
  setFollowCamera(on) {
    this._followCam = !!on;
    if (!this._followCam && this.controls) this.controls.autoRotate = false;
    if (this._followCam) this._followUserOverride = false;
  }

  isFollowCamera() {
    return this._followCam;
  }

  _updateFollowCamera(dt) {
    if (!this._followCam || this._followUserOverride) return;
    if (!this.camera || !this.controls || !this.playerPath) return;
    const u = this._clampU(this._progress);
    const pt = this.playerPath.getPointAt(u);
    if (!pt) return;

    // Big-picture heading: instead of the instantaneous tangent (which wiggles
    // with every Catmull-Rom kink and makes the camera shake), use a chord over
    // a look-ahead window, then temporally low-pass it. The result tracks the
    // route's general direction and ignores small zig-zags.
    const pA = this.playerPath.getPointAt(this._clampU(this._progress + 0.05));
    const pB = this.playerPath.getPointAt(this._clampU(this._progress - 0.03));
    let dirX = 0, dirZ = 1;
    if (pA && pB) {
      const vx = pA.x - pB.x, vz = pA.z - pB.z;
      const len = Math.hypot(vx, vz);
      if (len > 1e-6) { dirX = vx / len; dirZ = vz / len; }
    }
    const dk = 1 - Math.exp(-dt * 1.1);   // slow heading convergence = steady cam
    this._followDir.x += (dirX - this._followDir.x) * dk;
    this._followDir.z += (dirZ - this._followDir.z) * dk;
    const dl = Math.hypot(this._followDir.x, this._followDir.z) || 1;
    const fdx = this._followDir.x / dl, fdz = this._followDir.z / dl;

    // Rig proportions scale with the model so any route frames the same way.
    // Markers are sized ~span/300 (cone height 13×that ≈ 0.043·span), so the
    // camera must sit a few tenths of a span back or it ends up inside them.
    const span = this._worldSpan || 2000;

    // Relive-style close-up: while parked at a waypoint stop, pull in and slowly
    // orbit the point so its content reads before playback continues.
    if (this._pauseUntil > performance.now()) {
      this._orbitAngle += dt * 0.5;
      const back = span * 0.3, lift = span * 0.2;
      const ca = Math.cos(this._orbitAngle), sa = Math.sin(this._orbitAngle);
      const ox = fdx * ca - fdz * sa, oz = fdx * sa + fdz * ca;
      const desired = this._followPosTmp.set(pt.x - ox * back, pt.y + lift, pt.z - oz * back);
      const look = this._followTargetTmp.set(pt.x, pt.y + lift * 0.1, pt.z);
      const k = 1 - Math.exp(-dt * 2.4);
      this.camera.position.lerp(desired, k);
      this.controls.target.lerp(look, Math.min(1, k * 1.4));
      this.camera.lookAt(this.controls.target);
      return;
    }

    let back = span * 0.5;
    let lift = span * 0.3;
    let ahead = span * 0.06;
    // Opening fly-in: for the first seconds of a from-the-start playback the rig
    // is blended from a high overview down to the chase pose (smoothstep), so
    // pressing play sweeps down into the scene instead of cutting to it.
    const INTRO_DUR = 2.6;
    if (this._introElapsed < INTRO_DUR) {
      this._introElapsed += dt;
      const p = Math.min(1, this._introElapsed / INTRO_DUR);
      const e = p * p * (3 - 2 * p);
      back += (span * 1.15 - back) * (1 - e);
      lift += (span * 0.8 - lift) * (1 - e);
      ahead *= e;
    }
    const desired = this._followPosTmp.set(pt.x - fdx * back, pt.y + lift, pt.z - fdz * back);
    const look = this._followTargetTmp.set(pt.x + fdx * ahead, pt.y + lift * 0.15, pt.z + fdz * ahead);
    // Frame-rate-independent exponential smoothing; the target converges a bit
    // faster than the camera so turns read as the camera "swinging around".
    const k = 1 - Math.exp(-dt * 2.2);
    this.camera.position.lerp(desired, k);
    this.controls.target.lerp(look, Math.min(1, k * 1.35));
    this.camera.lookAt(this.controls.target);
  }

  // Snap the camera to a preset viewing angle with north (+Z) pointing up, while
  // leaving OrbitControls free so the user can still orbit/tilt afterwards.
  //   'top' — straight-down (垂直俯視)
  //   '45'  — 45° oblique (45度視角)
  // The current zoom distance and look-at target are preserved.
  applyViewPreset(mode) {
    if (!this.camera || !this.controls) return;
    const target = this.controls.target.clone();
    const dist = Math.max(this.camera.position.distanceTo(target), this.controls.minDistance + 1);
    // phi = polar angle from +Y. Top-down ≈ 0; oblique = 45° off vertical.
    const phi = mode === 'top' ? 0.0005 : Math.PI / 4;
    // Place the camera due south of the target so looking toward +Z (north) puts
    // north at the top of the screen.
    const theta = Math.PI; // three.js spherical: atan2(x, z)
    const sinPhi = Math.sin(phi);
    const offset = new THREE.Vector3(
      dist * sinPhi * Math.sin(theta),
      dist * Math.cos(phi),
      dist * sinPhi * Math.cos(theta)
    );
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.controls.update();
  }

  // "海拔高度歸一化" — when on, the vertical scale is recomputed so the relief
  // reads boldly 3D for any route; when off, elevations render at true scale.
  // Rebuilds the model geometry in place (no re-download) when a scene exists.
  setElevationNormalized(on) {
    this._elevNormalized = !!on;
    this._recomputeElevScale();
    if (this.hasBuiltScene()) this._rebuildScene();
  }

  isElevationNormalized() {
    return this._elevNormalized;
  }

  // Derive the vertical scale from the current normalization flag, terrain relief
  // and horizontal span. Targets a relief of ~35% of the span so framing always
  // works; clamped so flat-terrain DEM noise isn't blown up absurdly.
  _recomputeElevScale() {
    if (!this._elevNormalized) { this._elevScale = 1; return; }
    const range = Math.max(this._fieldMaxV - this._fieldMinV, 1);
    const targetRelief = (this._worldSpan || 2000) * 0.35;
    this._elevScale = Math.max(0.25, Math.min(targetRelief / range, 6));
  }

  async loadRouteData(routeData) {
    const { coords, elevations, waypoints, weatherPoints, routeStats, timing, routeColors, cachedTerrain } = routeData;
    if (!coords || coords.length < 2) return;
    // A fresh route starts staged from scratch: full track until played, no
    // leftover fly-in from the previous route.
    this._playbackReveal = false;
    this._introElapsed = Infinity;

    // Honour the persisted "海拔高度歸一化" preference for the initial build so the
    // first paint uses the right vertical scale (no rebuild needed on open).
    if (typeof routeData.elevNormalized === 'boolean') this._elevNormalized = routeData.elevNormalized;

    // On a toolbar "更新" rebuild (preserveView) keep the user where they were
    // looking instead of snapping back to the default overview, so a refresh
    // feels like an in-place update rather than re-opening the model.
    const preserveView = !!routeData.preserveView && !!this.camera && !!this.controls;
    const prevView = preserveView
      ? { pos: this.camera.position.clone(), target: this.controls.target.clone(), progress: this._progress }
      : null;

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
    // Cumulative climb / descent (m) aligned to routePoints, for the playback card.
    ({ ascent: this._cumAscent, descent: this._cumDescent } = TerrainViewer._cumulativeElevationChange(this.routeElevations));
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
      // The cached rebuild (e.g. a "更新" redraw) is otherwise synchronous, so
      // yield one frame to let the progress bar + interrupt button actually paint
      // and give the user a window to abort before the geometry is regenerated.
      await new Promise((r) => setTimeout(r, 16));
      if (this._aborted) { this._emitLoad({ active: false, percent: 0, aborted: true }); return; }
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
    // Smoothed, upsampled height field shared by the surface mesh and the
    // contours (sets this._fieldMinV / this._fieldMaxV over valid data only).
    this._field = this._buildFineField(gridData);
    // Datum: anchor at the lowest *valid* ground (holes excluded) so the model
    // never starts from a spurious sea-level 0 m skirt and the empty band
    // beneath the terrain isn't rendered.
    this._elevBase = this._fieldMinV;

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
    // framing (camera sits ~1.1× the span away).
    this._markerScale = Math.max(1, span / 300);
    // Vertical scale depends on the relief + span, both known now, so the initial
    // geometry is baked at the right scale for the normalization preference.
    this._recomputeElevScale();

    this._emitLoad({ active: true, percent: 88, title: '建立地形模型', detail: '計算等高線與軌跡…' });

    this._clearScene();
    // A fresh route/model invalidates any previous route's catchment basins; the
    // host re-triggers the compute if its 集水區 toggle is still on.
    this._catchmentBasinsData = null;
    this._createTerrain(bbox);
    this._createContours(bbox);
    this._createRoutePath(coords, elevations, bbox);
    this._createWaypoints(waypoints, bbox);
    this._createWeatherLabels(weatherPoints, bbox);
    this._setupPlayer(coords, elevations, bbox);
    this._setupEnvironment();

    // Map features (roads / rivers / water / land cover / buildings). Cached
    // vector data builds synchronously (instant); a fresh Overpass download is
    // slow and flaky, so it must NOT block the model from appearing — it's fetched
    // in the background after the build completes and draped on once it arrives.
    // Keep the previous build's features (same area) as a fallback so a flaky
    // download doesn't blank the whole 圖資 layer on a redraw.
    const prevFeatures = this._featuresData;
    const prevFeaturesBbox = this._featuresDataBbox;
    const cachedFeatures = cachedTerrain && cachedTerrain.features ? cachedTerrain.features : null;
    if (cachedFeatures) {
      try { this._buildMapFeatures(cachedFeatures, bbox); } catch (err) { console.warn('map features failed:', err); }
      this._featuresData = cachedFeatures;
      this._featuresDataBbox = bbox;
      this._featuresSettled = true;
    } else {
      // Features arrive asynchronously; clear any stale ones so a rebuild in the
      // meantime (e.g. the normalization toggle) doesn't drape the old area's data.
      this._featuresData = null;
      this._featuresDataBbox = null;
      this._featuresSettled = false;
    }
    this._buildCtx = { coords, elevations, waypoints, weatherPoints, bbox };
    // Token identifying THIS build so a background feature download that resolves
    // after the user rebuilt/closed the model doesn't paint onto a stale scene.
    const buildToken = (this._buildToken = (this._buildToken || 0) + 1);

    if (this._onInfo) this._onInfo(this._terrainInfo);

    // Frame the model larger in the view (closer camera) so the terrain reads
    // bigger and dense 20 m contours aren't crammed together on screen. The
    // default sits noticeably closer than a fit-to-screen distance.
    const dist = Math.max(span * 1.12, 1000);

    // Aim at the terrain's mid-height (datum-shifted) so the model is framed,
    // not the empty space the old y=0 target used to look at.
    const midElev = this._terrainInfo
      ? (this._terrainInfo.elevMin + this._terrainInfo.elevMax) / 2
      : this._elevBase;
    const center = this._latLngToLocal(cy, cx, midElev, bbox);
    if (prevView) {
      // Refresh: restore the prior camera pose and playback position.
      this.controls.target.copy(prevView.target);
      this.camera.position.copy(prevView.pos);
      this._progress = Math.max(0, Math.min(1, prevView.progress));
    } else {
      this.controls.target.set(center.x, center.y, center.z);
      this.camera.position.set(center.x + dist * 0.3, center.y + dist * 0.4, center.z + dist);
    }
    this.controls.update();

    this._setupResizeHandler();
    this._updateLineResolutions();
    // Place the hiker/cursor at the current progress so a freshly built (or
    // refreshed) model shows them on the track right away, not parked at origin.
    this._updatePlayerPosition();
    this._emitMetrics(true);

    // Automatically sample satellite imagery in the background (non-blocking) to
    // fuse real-world vegetation density & surface texture with OSM + DEM relief.
    if (!this._aborted) {
      this._autoLoadSatelliteForSurface(bbox, buildToken);
    }

    // Kick off the background map-feature download (only when the cache didn't
    // already supply it) before closing out the load state, so the same progress
    // channel keeps counting up through the 圖資 phase instead of hiding and a
    // separate widget reopening at 0%. blocking: false keeps the model
    // interactive throughout — only the readout is shared, not the busy-lock.
    if (!cachedFeatures && !this._aborted) {
      this._emitLoad({ active: true, percent: 90, blocking: false, title: '建立地形模型', detail: '更新圖資中…' });
      this._loadMapFeaturesInBackground(bbox, buildToken, prevFeatures, prevFeaturesBbox, routeData.cacheKey || null);
    } else {
      this._emitLoad({ active: false, percent: 100 });
    }
  }

  // Download map features off the critical path and drape them onto the already
  // visible model. Draping is guarded by the build token so a download that
  // resolves after the user switched/rebuilt/closed the model doesn't paint a
  // stale scene — but a *successful* download is always persisted for its own
  // cacheKey regardless of supersession, so switching away mid-download (e.g. the
  // 3D player hopping to another route) doesn't throw away already-fetched 圖資;
  // the next visit to this route hits the cache instead of re-fetching. A failed
  // download reuses the previous build's features (same area). Progress
  // (90→100, blocking: false) rides the same onLoad channel as the terrain build
  // so the UI shows one continuous bar rather than a second one — guarded by the
  // token so a superseded fetch's late progress ticks can't corrupt the new
  // build's own progress readout.
  async _loadMapFeaturesInBackground(bbox, token, prevFeatures, prevFeaturesBbox, cacheKeyForThisBuild) {
    let featuresData = null;
    try {
      featuresData = await this._fetchMapFeatures(bbox, (p) => {
        if (token !== this._buildToken) return;
        this._emitLoad({ active: true, percent: 90 + p * 10, blocking: false, detail: '更新圖資中…' });
      });
    } catch { featuresData = null; }

    if (featuresData && this._onFeaturesComputed) {
      try { this._onFeaturesComputed({ features: featuresData, bbox, cacheKey: cacheKeyForThisBuild }); } catch { /* noop */ }
    }

    if (this._aborted || token !== this._buildToken || !this.scene) {
      // Superseded (another build/switch took over) or the viewer closed — the
      // fetch above already ran to completion and was persisted above if it
      // succeeded, so there's nothing left to do for this now-stale build. Leave
      // _featuresSettled false: this attempt never got a real chance to finish
      // against the still-current scene, so it's worth retrying later.
      return;
    }
    // The attempt ran to completion against the still-current scene — success,
    // genuine failure, or a legitimately empty result all count as "settled" so
    // the cache re-entry shortcut doesn't keep re-fetching a route with no data.
    this._featuresSettled = true;
    if (!featuresData && prevFeatures && this._bboxApproxEqual(bbox, prevFeaturesBbox)) {
      featuresData = prevFeatures;
    }
    if (!featuresData) {
      this._emitLoad({ active: false, percent: 100 });
      return;
    }
    try { this._buildMapFeatures(featuresData, bbox); } catch (err) {
      console.warn('map features failed:', err);
      this._emitLoad({ active: false, percent: 100 });
      return;
    }
    this._featuresData = featuresData;
    this._featuresDataBbox = bbox;
    // Apply the persisted label size + layer visibility to the freshly added
    // feature objects, then let the UI re-evaluate toggles now that 圖資 exists.
    this.setLabelScale(this._labelScale);
    if (this.featureGroup) this.featureGroup.visible = this._featuresVisible;
    if (this.featureLabelGroup) this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();
    this._updateLineResolutions();
    this._emitLoad({ active: false, percent: 100 });
    if (this._onFeaturesReady) {
      try { this._onFeaturesReady(); } catch { /* noop */ }
    }
  }

  _checkWebGL() {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
    } catch { return false; }
  }

  // True once a terrain height field exists, so the 3D-print export (STL / 3MF)
  // has something to build a solid from.
  hasExportableModel() {
    return !!(this._field && this._bbox);
  }

  // Build a compact, print-oriented description of the current model for the
  // STL / 3MF exporter (Plan §IV). Coordinates are millimetres in a Z-up frame
  // (X east, Y north, Z up) scaled so the horizontal span == sizeMm; the on-screen
  // vertical scale (incl. 海拔歸一化) is preserved so the print matches the view.
  // Terrain holes are filled flat (min elevation) so the exported solid stays
  // watertight, and a per-grid land-cover family drives 3MF colour blocking (§IV-3).
  getExportSource({ sizeMm = 150, baseThicknessMm = 4 } = {}) {
    if (!this._field || !this._bbox) return null;
    const N = FIELD_SIZE;
    const bbox = this._bbox;
    const field = this._field;
    const minElev = this._fieldMinV;
    const span = Math.max(1, this._worldSpan || 2000);
    const k = sizeMm / span;

    const X = new Float32Array(N * N);
    const Y = new Float32Array(N * N);
    const Z = new Float32Array(N * N);
    let minZ = Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (N - 1);
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
        const raw = field[i][j];
        const elev = this._isHole(raw) ? minElev : raw;    // holes filled flat for a manifold solid
        const p = this._latLngToLocal(lat, lng, elev, bbox);
        const idx = i * N + j;
        X[idx] = p.x * k; Y[idx] = p.z * k; Z[idx] = p.y * k;
        if (Z[idx] < minZ) minZ = Z[idx];
      }
    }

    // Per-grid land-cover family for colour blocking: land / green / soil / urban,
    // plus a water overlay (water is excluded from the terrain-colour field, so it
    // is rasterised separately here).
    const areas = (this._featuresData && this._featuresData.areas) || [];
    const buildings = (this._featuresData && this._featuresData.buildings) || [];
    const famGrid = this._buildLandCoverField(areas, buildings, bbox);
    const FAM = { land: 0, green: 1, soil: 2, urban: 3, water: 4 };
    const family = new Uint8Array(N * N);
    const latSpan = (bbox.maxLat - bbox.minLat) || 1;
    const lngSpan = (bbox.maxLng - bbox.minLng) || 1;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const f = famGrid[i][j];
        family[i * N + j] = f === 'green' ? FAM.green : f === 'soil' ? FAM.soil : f === 'urban' ? FAM.urban : FAM.land;
      }
    }
    for (const ar of areas) {
      if (ar.cls !== 'water' && ar.cls !== 'wetland') continue;
      const rings = ar.rings || [];
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const holes = rings.slice(1).filter((h) => h && h.length >= 3);
      let rminLat = Infinity, rmaxLat = -Infinity, rminLng = Infinity, rmaxLng = -Infinity;
      for (const [la, lo] of outer) { if (la < rminLat) rminLat = la; if (la > rmaxLat) rmaxLat = la; if (lo < rminLng) rminLng = lo; if (lo > rmaxLng) rmaxLng = lo; }
      const i0 = Math.max(0, Math.floor((rminLat - bbox.minLat) / latSpan * (N - 1)));
      const i1 = Math.min(N - 1, Math.ceil((rmaxLat - bbox.minLat) / latSpan * (N - 1)));
      const j0 = Math.max(0, Math.floor((rminLng - bbox.minLng) / lngSpan * (N - 1)));
      const j1 = Math.min(N - 1, Math.ceil((rmaxLng - bbox.minLng) / lngSpan * (N - 1)));
      for (let i = i0; i <= i1; i++) {
        const lat = bbox.minLat + latSpan * i / (N - 1);
        for (let j = j0; j <= j1; j++) {
          const lng = bbox.minLng + lngSpan * j / (N - 1);
          if (!this._pointInRing(lat, lng, outer)) continue;
          if (holes.some((h) => this._pointInRing(lat, lng, h))) continue;
          family[i * N + j] = FAM.water;
        }
      }
    }

    return {
      N, X, Y, Z, family,
      route: this._exportRouteSamples(bbox, k),
      baseZ: minZ - Math.max(0.5, baseThicknessMm),
      sizeMm,
    };
  }

  // Route polyline draped onto the terrain SURFACE (not the GPS elevation) in
  // print millimetres, densified so the exported ridge (Plan §IV-1) hugs the
  // printed relief smoothly.
  _exportRouteSamples(bbox, k) {
    const coords = this.routePoints;
    if (!coords || coords.length < 2) return [];
    const dLatCell = (bbox.maxLat - bbox.minLat) / (FIELD_SIZE - 1);
    const dLngCell = (bbox.maxLng - bbox.minLng) / (FIELD_SIZE - 1);
    const out = [];
    const drape = (lat, lng) => {
      const elev = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, elev, bbox);
      return [p.x * k, p.z * k, p.y * k];
    };
    for (let i = 0; i < coords.length - 1; i++) {
      const [la, lo] = coords[i];
      const [lb, lob] = coords[i + 1];
      const steps = Math.min(20, Math.max(1, Math.ceil(Math.max(Math.abs(lb - la) / dLatCell, Math.abs(lob - lo) / dLngCell))));
      for (let s = 0; s < steps; s++) { const t = s / steps; out.push(drape(la + (lb - la) * t, lo + (lob - lo) * t)); }
    }
    const last = coords[coords.length - 1];
    out.push(drape(last[0], last[1]));
    return out;
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
    // Render the terrain layer in addition to the default one (the terrain mesh
    // lives on TERRAIN_LAYER so the day/night lights skip it — see _setupEnvironment).
    this.camera.layers.enable(TERRAIN_LAYER);
    // logarithmicDepthBuffer: the scene spans tens of thousands of world units
    // with a 0.1 near / 500000 far range; a linear depth buffer has nowhere near
    // the precision for that ratio, so coplanar surfaces (route draped on
    // terrain, buildings, the hiker's cone on the ground) z-fight and shimmer as
    // the camera glides. A log buffer distributes precision across the range and
    // kills the flicker. All materials here are built-in, so it's safe.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
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
    // A manual grab always wins the camera fight: it cancels the end-of-route
    // orbit and pauses the chase cam until the next play().
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this._introElapsed = Infinity; // a grab also cancels the opening fly-in
      if (this._playing && this._followCam) this._followUserOverride = true;
    });

    this._bindPointerHandlers();
    this._bindContextLossHandlers();
  }

  // Mobile browsers drop the WebGL context when the tab is backgrounded for a
  // while; without handling, the next frame throws and can take the page down.
  // Swallow the loss (so the browser keeps the page and attempts a restore),
  // pause the loop, then resume + rebuild the geometry once the context returns.
  _bindContextLossHandlers() {
    if (this._contextHandlersBound || !this.renderer) return;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._contextLost = true;
      if (this._animFrameId) {
        cancelAnimationFrame(this._animFrameId);
        this._animFrameId = null;
      }
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      // Re-upload GPU resources by rebuilding from the cached source data, then
      // resume the render loop if the viewer is still open.
      try { if (this._buildCtx) this._rebuildScene(); } catch (err) { console.warn('context restore rebuild failed:', err); }
      if (!this.container.classList.contains('hidden') && this._animFrameId == null) this._animate();
    }, false);
    this._contextHandlersBound = true;
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
    const hits = this._raycaster.intersectObjects(this._pickables, true);
    for (const h of hits) {
      let cur = h.object;
      while (cur && !cur.userData?.detail) cur = cur.parent;
      const detail = cur?.userData?.detail;
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

    // The day/night rig above lives on layer 0 and therefore lights only the 3D
    // objects (landmarks/buildings/route/weather rigs) + the sky background. The
    // terrain is on TERRAIN_LAYER, so it is lit exclusively by this cartographic
    // dual-azimuth relief rig — an oblique key sun + cool counter-azimuth rim
    // light that accentuates ridges, gullies and canopy bump relief regardless
    // of the route clock.
    const dayPreset = this._skyPreset(55);
    this._terrainSun = new THREE.DirectionalLight(0xfff4e2, 1.38);
    this._terrainSun.position.copy(new THREE.Vector3(-0.56, 0.58, 0.59).normalize().multiplyScalar(120000));
    this._terrainSun.castShadow = true;
    const td = Math.max(1500, (this._worldSpan || 2000) * 0.95);
    this._terrainSun.shadow.camera.left = -td;
    this._terrainSun.shadow.camera.right = td;
    this._terrainSun.shadow.camera.top = td;
    this._terrainSun.shadow.camera.bottom = -td;
    this._terrainSun.shadow.camera.far = 350000;
    this._terrainSun.shadow.bias = -0.00035;
    this._terrainSun.shadow.mapSize.width = 2048;
    this._terrainSun.shadow.mapSize.height = 2048;
    this._terrainSun.shadow.camera.updateProjectionMatrix();
    this._terrainSun.layers.set(TERRAIN_LAYER);
    // Shadow cameras default to layer 0 only; enable the terrain layer so the
    // terrain (which lives there) is rendered into this rig's shadow map and the
    // ridge/valley self-shadows survive the layer split.
    this._terrainSun.shadow.camera.layers.enable(TERRAIN_LAYER);
    this.scene.add(this._terrainSun);
    // Target the terrain centre (local origin) so the fixed direction holds.
    this._terrainSunTarget = new THREE.Object3D();
    this.scene.add(this._terrainSunTarget);
    this._terrainSun.target = this._terrainSunTarget;

    // Cool sky counter-light from the opposite azimuth so shaded slopes retain
    // micro-relief definition rather than flattening out.
    this._terrainRim = new THREE.DirectionalLight(0x9bc4ee, 0.44);
    this._terrainRim.position.copy(new THREE.Vector3(0.58, 0.46, -0.54).normalize().multiplyScalar(100000));
    this._terrainRim.layers.set(TERRAIN_LAYER);
    this.scene.add(this._terrainRim);

    this._terrainAmbient = new THREE.AmbientLight(dayPreset.amb.getHex(), 0.44);
    this._terrainAmbient.layers.set(TERRAIN_LAYER);
    this.scene.add(this._terrainAmbient);

    this._terrainHemi = new THREE.HemisphereLight(0x9ed4f7, 0x3d3222, 0.52);
    this._terrainHemi.layers.set(TERRAIN_LAYER);
    this.scene.add(this._terrainHemi);

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
    // Equation of time (minutes): corrects for Earth's orbital eccentricity + axial
    // tilt, which shift true solar noon by up to ~±15 min across the year. Without
    // it, sunrise/sunset (the sun-elevation zero-crossing that drives the day/night
    // look) could be off by that much. Standard day-of-year approximation.
    const B = toRad * (360 / 365) * (dayOfYear - 81);
    const eotMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    // 4 min per degree from the 120°E standard meridian (UTC+8), plus EoT.
    const solarTime = localHour + (lng - 120) * 4 / 60 + eotMin / 60;
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

    // Day/night is permanently on (the toggle was removed). The route-clock sun/
    // ambient/hemi/moon below drive the sky background + the 3D objects only; the
    // terrain has its own fixed midday rig on TERRAIN_LAYER (see _setupEnvironment),
    // so it never darkens with the time of day.
    if (!this._envEnabled) {
      // Retained as a defensive fallback if the environment is ever disabled: a
      // flat bright look for the objects/sky (terrain is unaffected either way).
      const preset = this._skyPreset(55); // high midday sun
      const target = this.controls?.target || new THREE.Vector3();
      const dir = new THREE.Vector3(0.32, 0.9, 0.28).normalize();
      this.scene.background = preset.sky.clone();
      this.scene.fog = null;
      if (this._sunTarget) this._sunTarget.position.copy(target);
      this._sun.position.copy(target).add(dir.multiplyScalar(sunDist));
      this._sun.color.copy(preset.sun);
      this._sun.intensity = preset.sunI;
      this._sun.castShadow = true;
      this._ambient.color.copy(preset.amb); this._ambient.intensity = preset.ambI;
      this._hemi.color.copy(preset.hemiS);
      this._hemi.groundColor.copy(preset.hemiG);
      this._hemi.intensity = preset.hemiI;
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
    const cat = (this._weatherAnimEnabled && metrics?.weather?.cat) ? metrics.weather.cat : 'clear';
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
    const wantRain = this._weatherAnimEnabled && (cat === 'rain' || cat === 'drizzle' || cat === 'thunder');
    const wantSnow = this._weatherAnimEnabled && cat === 'snow';
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
  // Cumulative ascent/descent (metres, both positive) up to each vertex, aligned
  // to the elevation array. Skips non-finite samples so a hole doesn't inject a
  // spurious step. Returns { ascent[], descent[] } (index 0 = 0).
  static _cumulativeElevationChange(elevations) {
    const n = Array.isArray(elevations) ? elevations.length : 0;
    const ascent = new Array(n).fill(0);
    const descent = new Array(n).fill(0);
    let up = 0, down = 0, prev = null;
    for (let i = 0; i < n; i++) {
      const e = elevations[i];
      if (Number.isFinite(e)) {
        if (prev != null) {
          const d = e - prev;
          if (d > 0) up += d; else down -= d;
        }
        prev = e;
      }
      ascent[i] = up;
      descent[i] = down;
    }
    return { ascent, descent };
  }

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
    const active = this._weatherAnimEnabled
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
    minLat -= padLat; maxLat += padLat;
    minLng -= padLng; maxLng += padLng;

    // Expand the shorter side so the downloaded area is a square in real-world
    // distance — the rendered terrain (x = E-W metres, z = N-S metres) then comes
    // out square rather than a thin sliver for a mostly-straight route. Longitude
    // degrees are foreshortened by cos(lat), so compare distances, not raw spans.
    const cLat = (minLat + maxLat) / 2;
    const cLng = (minLng + maxLng) / 2;
    const cosLat = Math.cos(cLat * Math.PI / 180) || 1e-6;
    const nsDist = maxLat - minLat;                 // ∝ N-S distance
    const ewDist = (maxLng - minLng) * cosLat;      // ∝ E-W distance
    if (nsDist > ewDist) {
      const half = (nsDist / cosLat) / 2;           // widen longitude
      minLng = cLng - half; maxLng = cLng + half;
    } else if (ewDist > nsDist) {
      const half = ewDist / 2;                       // grow latitude
      minLat = cLat - half; maxLat = cLat + half;
    }
    return { minLat, maxLat, minLng, maxLng };
  }

  // True when two bboxes describe essentially the same area (sub-metre tolerance
  // in degrees), used to decide whether cached/in-memory map features still apply.
  _bboxApproxEqual(a, b) {
    if (!a || !b) return false;
    const e = 1e-5; // ~1 m
    return Math.abs(a.minLat - b.minLat) < e && Math.abs(a.maxLat - b.maxLat) < e
      && Math.abs(a.minLng - b.minLng) < e && Math.abs(a.maxLng - b.maxLng) < e;
  }

  _latLngToLocal(lat, lng, elev, bbox) {
    const cx = (bbox.minLng + bbox.maxLng) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const R = 6371000;
    const toRad = Math.PI / 180;
    const x = R * toRad * (lng - cx) * Math.cos(toRad * cy);
    const y = (elev - (this._elevBase || 0)) * (this._elevScale || 1);
    const z = R * toRad * (lat - cy);
    return { x, y, z };
  }

  // Inverse of _latLngToLocal's horizontal projection: recover lat/lng from a
  // world (x, z). Used to re-drape a resampled track point onto the surface,
  // which only exists as a function of lat/lng.
  _localToLatLng(x, z, bbox) {
    const cx = (bbox.minLng + bbox.maxLng) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const R = 6371000;
    const toRad = Math.PI / 180;
    const lat = cy + z / (R * toRad);
    const lng = cx + x / (R * toRad * Math.cos(toRad * cy));
    return { lat, lng };
  }

  // Interpolated terrain elevation (metres) at a lat/lng on the rendered surface,
  // so points can be dropped onto it. Samples the same fine field as the mesh;
  // falls back to the datum height over a hole.
  _sampleGridElevation(lat, lng) {
    const field = this._field;
    const bbox = this._bbox;
    if (!field || !bbox) return this._elevBase || 0;
    const gx = (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng) * (FIELD_SIZE - 1);
    const gy = (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat) * (FIELD_SIZE - 1);
    const v = this._sampleSmooth(field, gy, gx, FIELD_SIZE);
    return this._isHole(v) ? (this._elevBase || 0) : v;
  }

  // True when a lat/lng falls over a terrain "hole" (missing elevation data),
  // i.e. where the surface mesh skips its tile and nothing is drawn. Map
  // features must skip the same spots, otherwise they drape onto the basin-floor
  // datum and float/stretch in the blank space beyond the visible terrain.
  _isOverHole(lat, lng) {
    const field = this._field;
    const bbox = this._bbox;
    if (!field || !bbox) return false;
    const gx = (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng) * (FIELD_SIZE - 1);
    const gy = (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat) * (FIELD_SIZE - 1);
    return this._isHole(this._sampleSmooth(field, gy, gx, FIELD_SIZE));
  }

  // Ray-casting point-in-polygon on a [lat,lng][] ring (lat=y, lng=x). Used to
  // rasterise a catchment fill against the terrain's own grid so the fill drapes
  // over the interior relief instead of tenting flatly between boundary vertices.
  _pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0], xi = ring[i][1];
      const yj = ring[j][0], xj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  // Split a polyline ([lat,lng][]) into runs of consecutive points that sit on
  // real (non-hole) terrain, so a road/river/outline isn't drawn across a blank
  // tile. Runs shorter than 2 points are dropped by the caller.
  _splitPolylineAtHoles(pts) {
    const runs = [];
    let cur = [];
    for (const p of pts) {
      if (this._isOverHole(p[0], p[1])) {
        if (cur.length >= 2) runs.push(cur);
        cur = [];
      } else {
        cur.push(p);
      }
    }
    if (cur.length >= 2) runs.push(cur);
    return runs;
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
            else elevations.push(...batchLats.map(() => null));
            success = true;
          } else if (resp.status === 429) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
          } else {
            // Missing data → null (a hole), not a flat sea-level 0 m patch.
            elevations.push(...batchLats.map(() => null));
            success = true;
          }
        } catch {
          if (this._aborted) return null;
          if (attempt >= 2) {
            elevations.push(...batchLats.map(() => null));
            success = true;
          } else {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
      if (!success) elevations.push(...batchLats.map(() => null));

      batchIdx++;
      onProgress?.(batchIdx / batchCount);

      await this._waitIfPaused();       // park here while pause() is active
      if (this._aborted) return null;
    }

    const grid = [];
    let idx = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      const row = [];
      for (let j = 0; j < GRID_SIZE; j++) {
        const v = elevations[idx++];
        row.push(Number.isFinite(v) ? v : null); // null = hole (missing data)
      }
      grid.push(row);
    }
    return grid;
  }

  // Sample a colour ramp whose stops are in ABSOLUTE units (metres of elevation).
  // Clamps to the end stops.
  static _rampSampleAbs(stops, x) {
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (x <= first.t) return first.c.slice();
    if (x >= last.t) return last.c.slice();
    let lo = first, hi = last;
    for (let i = 0; i < stops.length - 1; i++) {
      if (x >= stops[i].t && x <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    const span = (hi.t - lo.t) || 1;
    const f = (x - lo.t) / span;
    return [lo.c[0] + (hi.c[0] - lo.c[0]) * f,
            lo.c[1] + (hi.c[1] - lo.c[1]) * f,
            lo.c[2] + (hi.c[2] - lo.c[2]) * f];
  }

  // Deterministic 2D hash & multi-octave procedural noise used for geomorphological
  // micro-relief, 3D forest canopy crown mottling, and stratified rock grain.
  static _hash2D(ix, iy) {
    let n = (ix * 374761393 + iy * 668265263) | 0;
    n = (n ^ (n >> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  static _valueNoise2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = TerrainViewer._hash2D(ix, iy);
    const b = TerrainViewer._hash2D(ix + 1, iy);
    const c = TerrainViewer._hash2D(ix, iy + 1);
    const d = TerrainViewer._hash2D(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  static _fbm2D(x, y, octaves = 3) {
    let val = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      val += amp * TerrainViewer._valueNoise2D(x * freq, y * freq);
      norm += amp;
      freq *= 2.07;
      amp *= 0.5;
    }
    return norm > 0 ? val / norm : 0.5;
  }

  // Ridged multifractal noise (0..1, sharp crests at 1) for craggy mountain spurs,
  // gully incisions and bedrock strata.
  static _ridgedFbm2D(x, y, octaves = 3) {
    let val = 0;
    let amp = 0.5;
    let freq = 1;
    let weight = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      let r = 1 - Math.abs(TerrainViewer._valueNoise2D(x * freq, y * freq) * 2 - 1);
      r = r * r * weight;
      weight = Math.max(0.15, Math.min(1, r * 1.6));
      val += r * amp;
      norm += amp;
      freq *= 2.13;
      amp *= 0.5;
    }
    return norm > 0 ? val / norm : 0.5;
  }

  // Open vegetation / meadow (草地／一般綠地) tint keyed on ABSOLUTE elevation (m).
  static _vegRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.31, 0.50, 0.25] }, // coastal / lowland meadow green
      { t: 700,  c: [0.25, 0.46, 0.21] }, // lush foothill green
      { t: 1600, c: [0.31, 0.48, 0.26] }, // montane green
      { t: 2600, c: [0.44, 0.52, 0.32] }, // subalpine bamboo / scrub (玉山箭竹)
      { t: 3200, c: [0.62, 0.61, 0.44] }, // alpine tundra / treeline grass
      { t: 3500, c: [0.68, 0.66, 0.61] }, // bare alpine rock
      { t: 3850, c: [0.94, 0.95, 0.97] }, // snow cap
    ], elevM);
  }

  // Closed-canopy forest (茂密森林／樹冠) tint: deeper, richer chlorophyll greens
  // shifting from broadleaf evergreen to dark montane cypress/fir conifer.
  static _forestRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.18, 0.37, 0.16] }, // lowland broadleaf canopy
      { t: 900,  c: [0.15, 0.34, 0.15] }, // dense machilus-castanopsis forest
      { t: 1800, c: [0.14, 0.32, 0.17] }, // cloud-belt cypress / conifer forest
      { t: 2800, c: [0.17, 0.30, 0.18] }, // subalpine hemlock / fir (鐵杉／冷杉)
      { t: 3350, c: [0.38, 0.44, 0.28] }, // krummholz juniper transition
      { t: 3650, c: [0.65, 0.64, 0.59] }, // alpine rock above treeline
      { t: 3850, c: [0.94, 0.95, 0.97] }, // snow cap
    ], elevM);
  }

  // Shrubland / orchard (灌叢／果園／茶園) tint: warm olive-emerald.
  static _scrubRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.36, 0.52, 0.26] },
      { t: 1200, c: [0.34, 0.49, 0.25] },
      { t: 2500, c: [0.46, 0.53, 0.31] },
      { t: 3400, c: [0.64, 0.62, 0.47] },
      { t: 3850, c: [0.93, 0.94, 0.96] },
    ], elevM);
  }

  // Riparian / valley corridor (溪畔濱水植物帶): moisture-enriched emerald foliage.
  static _riparianRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.20, 0.42, 0.22] },
      { t: 1200, c: [0.18, 0.39, 0.21] },
      { t: 2400, c: [0.24, 0.42, 0.24] },
      { t: 3400, c: [0.52, 0.55, 0.42] },
    ], elevM);
  }

  // Exposed bedrock / cliff / scree (裸岩／碎石坡／斷崖) tint.
  static _rockRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.50, 0.48, 0.44] }, // weathered sandstone / slate
      { t: 1500, c: [0.54, 0.52, 0.49] }, // montane grey-brown cliff
      { t: 2800, c: [0.60, 0.58, 0.55] }, // alpine shale / quartzite
      { t: 3550, c: [0.70, 0.69, 0.66] }, // high peak scree
      { t: 3850, c: [0.94, 0.95, 0.97] }, // snow cap
    ], elevM);
  }

  // Bare-ground (裸露地) tint: earthy brown → tan → pale rock with altitude.
  static _soilRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.55, 0.45, 0.27] }, // earthy brown
      { t: 1000, c: [0.63, 0.53, 0.35] }, // loam
      { t: 2500, c: [0.73, 0.66, 0.51] }, // sandy
      { t: 3400, c: [0.80, 0.77, 0.70] }, // pale rock
      { t: 3800, c: [0.93, 0.93, 0.92] }, // light peak
    ], elevM);
  }

  // Sand / gravel bar / shingle (沙地／河床礫石灘) tint.
  static _sandRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.74, 0.68, 0.54] },
      { t: 1500, c: [0.70, 0.66, 0.56] },
      { t: 3200, c: [0.76, 0.74, 0.68] },
    ], elevM);
  }

  // Built-up (市區) tint: slate grey, lightening slightly with altitude.
  static _urbanRampColor(elevM) {
    return TerrainViewer._rampSampleAbs([
      { t: 0,    c: [0.45, 0.46, 0.49] }, // slate grey
      { t: 1500, c: [0.55, 0.56, 0.59] }, // mid grey
      { t: 3000, c: [0.66, 0.67, 0.70] }, // light grey
      { t: 3800, c: [0.86, 0.87, 0.90] }, // near-white
    ], elevM);
  }

  // Final per-vertex/per-sample terrain colour from land-cover family + sub-biome +
  // ABSOLUTE elevation + slope + geomorphology (curvature, aspect, AO, riparian
  // moisture, satellite vegetation index):
  //   green (default) → 山林與草坡色系 (forest / scrub / grass / riparian)
  //   soil            → 岩層與裸土色系 (rock / sand / bare soil)
  //   urban           → 城鎮街區灰色系 (built-up blocks)
  static _terrainColorFor(family, elevM, slope, opts = null) {
    const sub = opts?.sub || null;
    const curv = Number.isFinite(opts?.curvature) ? opts.curvature : 0;
    const aspect = Number.isFinite(opts?.aspect) ? opts.aspect : 0;
    const ao = Number.isFinite(opts?.ao) ? opts.ao : 1;
    const waterProx = Number.isFinite(opts?.waterProx) ? opts.waterProx : 0;
    const satVeg = Number.isFinite(opts?.satVeg) ? opts.satVeg : null;

    if (family === 'urban' || sub === 'urban') {
      const u = TerrainViewer._urbanRampColor(elevM);
      const shade = 0.88 + 0.12 * ao;
      return [u[0] * shade, u[1] * shade, u[2] * shade];
    }
    if (sub === 'sand') {
      const sd = TerrainViewer._sandRampColor(elevM);
      const shade = 0.9 + 0.1 * ao;
      return [sd[0] * shade, sd[1] * shade, sd[2] * shade];
    }
    if (sub === 'rock') {
      const rk = TerrainViewer._rockRampColor(elevM);
      const shade = 0.85 + 0.15 * ao + Math.max(0, curv) * 0.06;
      return [
        Math.min(1, rk[0] * shade),
        Math.min(1, rk[1] * shade),
        Math.min(1, rk[2] * shade),
      ];
    }
    if (family === 'soil' || sub === 'soil') {
      const sl = TerrainViewer._soilRampColor(elevM);
      const rk = TerrainViewer._rockRampColor(elevM);
      const s = Number.isFinite(slope) ? slope : 0;
      const rockMix = Math.max(0, Math.min(1, (s - 0.45) / 0.85));
      const shade = 0.86 + 0.14 * ao;
      return [
        (sl[0] + (rk[0] - sl[0]) * rockMix) * shade,
        (sl[1] + (rk[1] - sl[1]) * rockMix) * shade,
        (sl[2] + (rk[2] - sl[2]) * rockMix) * shade,
      ];
    }

    // Determine vegetation structure (closed forest vs scrub vs open grass vs riparian)
    // from OSM sub-biome, topographic moisture (concave valleys + north/east aspect +
    // stream proximity), and satellite greenness when available.
    const veg = TerrainViewer._vegRampColor(elevM);
    const forest = TerrainViewer._forestRampColor(elevM);
    const scrub = TerrainViewer._scrubRampColor(elevM);
    const riparian = TerrainViewer._riparianRampColor(elevM);
    const s = Number.isFinite(slope) ? slope : 0;

    // Topographic moisture index: concave gullies (curv < 0), shaded NE slopes, and
    // stream corridors hold more moisture and support denser, darker canopy.
    const neAspect = Math.cos(aspect - Math.PI * 0.25); // +1 facing NE, -1 facing SW
    const moisture = Math.max(0, Math.min(1,
      0.35 + (-curv) * 0.45 + neAspect * 0.12 + waterProx * 0.55 - Math.max(0, s - 0.5) * 0.25
    ));

    let base;
    if (sub === 'forest') {
      base = [
        forest[0] * 0.82 + veg[0] * 0.18,
        forest[1] * 0.82 + veg[1] * 0.18,
        forest[2] * 0.82 + veg[2] * 0.18,
      ];
    } else if (sub === 'scrub') {
      base = scrub.slice();
    } else if (sub === 'riparian' || sub === 'wetland') {
      base = riparian.slice();
    } else if (sub === 'grass') {
      base = [
        veg[0] * 1.04,
        veg[1] * 1.05,
        veg[2] * 0.96,
      ];
    } else {
      // Unlabelled natural terrain: blend between open montane green and deep forest
      // canopy using topographic moisture + satellite vegetation cues.
      let canopyWeight = Math.max(0, Math.min(1, 0.32 + moisture * 0.48 - Math.max(0, (elevM - 3000) / 500)));
      if (satVeg != null) {
        canopyWeight = Math.max(0, Math.min(1, canopyWeight * 0.55 + Math.max(0, satVeg * 1.35) * 0.45));
      }
      base = [
        veg[0] + (forest[0] - veg[0]) * canopyWeight,
        veg[1] + (forest[1] - veg[1]) * canopyWeight,
        veg[2] + (forest[2] - veg[2]) * canopyWeight,
      ];
    }

    // Riparian / ravine lushness along streams and concave valleys.
    if (waterProx > 0.05 && elevM < 3300) {
      const rw = Math.min(0.65, waterProx * 0.7);
      base[0] += (riparian[0] - base[0]) * rw;
      base[1] += (riparian[1] - base[1]) * rw;
      base[2] += (riparian[2] - base[2]) * rw;
    }

    // Steep slopes & sharp convex ridges expose stratified bedrock / scree.
    const rock = TerrainViewer._rockRampColor(elevM);
    const ridgeExposure = Math.max(0, curv) * 0.28;
    let rockAmt = Math.max(0, Math.min(1, (s + ridgeExposure - 0.58) / 0.92));
    if (sub === 'forest') rockAmt *= 0.25;
    else if (family === 'green' || sub === 'grass' || sub === 'scrub') rockAmt *= 0.38;
    else rockAmt *= 0.78;
    if (satVeg != null && satVeg < -0.04 && s > 0.28) {
      // Satellite confirms bare ground/scree/landslide scar on slope.
      rockAmt = Math.min(1, rockAmt + Math.min(0.55, (-satVeg) * 1.4));
    }
    if (elevM > 3550) rockAmt *= 0.2;

    const c0 = base[0] + (rock[0] - base[0]) * rockAmt;
    const c1 = base[1] + (rock[1] - base[1]) * rockAmt;
    const c2 = base[2] + (rock[2] - base[2]) * rockAmt;

    // Subtle valley ambient occlusion & ridge sun-kissed warmth.
    const ridgeLift = Math.max(0, curv) * 0.055;
    const shade = (0.84 + 0.16 * ao) + ridgeLift;
    return [
      Math.max(0, Math.min(1, c0 * shade)),
      Math.max(0, Math.min(1, c1 * shade)),
      Math.max(0, Math.min(1, c2 * shade)),
    ];
  }

  // OSM land-cover class → terrain colour family + fine sub-biome + raster priority
  // (a higher priority wins where polygons overlap, so a forest or park inside a
  // town reads green). `family` keeps the 3-way ('green'|'soil'|'urban') contract
  // expected by 3MF export while `sub` drives high-detail surface synthesis.
  static _landCoverFamily(cls) {
    switch (cls) {
      case 'forest':  return { family: 'green', sub: 'forest', pri: 5 };
      case 'scrub':   return { family: 'green', sub: 'scrub',  pri: 4 };
      case 'grass':   return { family: 'green', sub: 'grass',  pri: 3 };
      case 'rock':    return { family: 'soil',  sub: 'rock',   pri: 4 };
      case 'sand':    return { family: 'soil',  sub: 'sand',   pri: 3 };
      case 'waste':   return { family: 'soil',  sub: 'soil',   pri: 2 };
      case 'urban':   return { family: 'urban', sub: 'urban',  pri: 1 };
      default:        return null;
    }
  }

  // Even-odd ray-cast point-in-polygon test ([lat,lng] ring, lat=y, lng=x).
  _pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const yi = ring[i][0], xi = ring[i][1];
      const yj = ring[k][0], xj = ring[k][1];
      const denom = (yj - yi) || 1e-12;
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / denom + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Rasterise the area polygons, building footprint density, and hydrological
  // riparian corridors onto the fine field grid. Returns the coarse `fam` grid
  // ('green'|'soil'|'urban'|null) for backward compatibility while also populating
  // `this._subBiomeField` and `this._waterDistField`.
  _buildLandCoverField(areas, buildings, bbox, lines = null) {
    const N = FIELD_SIZE;
    const fam = [];
    const sub = [];
    const pri = [];
    const waterProx = [];
    for (let i = 0; i < N; i++) {
      fam.push(new Array(N).fill(null));
      sub.push(new Array(N).fill(null));
      pri.push(new Array(N).fill(0));
      waterProx.push(new Float32Array(N));
    }
    const latSpan = (bbox.maxLat - bbox.minLat) || 1;
    const lngSpan = (bbox.maxLng - bbox.minLng) || 1;

    for (const ar of (areas || [])) {
      const rings = ar.rings || [];
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const holes = rings.slice(1).filter((h) => h && h.length >= 3);

      let rminLat = Infinity, rmaxLat = -Infinity, rminLng = Infinity, rmaxLng = -Infinity;
      for (const [la, lo] of outer) {
        if (la < rminLat) rminLat = la; if (la > rmaxLat) rmaxLat = la;
        if (lo < rminLng) rminLng = lo; if (lo > rmaxLng) rmaxLng = lo;
      }
      const i0 = Math.max(0, Math.floor((rminLat - bbox.minLat) / latSpan * (N - 1)));
      const i1 = Math.min(N - 1, Math.ceil((rmaxLat - bbox.minLat) / latSpan * (N - 1)));
      const j0 = Math.max(0, Math.floor((rminLng - bbox.minLng) / lngSpan * (N - 1)));
      const j1 = Math.min(N - 1, Math.ceil((rmaxLng - bbox.minLng) / lngSpan * (N - 1)));

      if (ar.cls === 'water' || ar.cls === 'wetland') {
        for (let i = i0; i <= i1; i++) {
          const lat = bbox.minLat + latSpan * i / (N - 1);
          for (let j = j0; j <= j1; j++) {
            const lng = bbox.minLng + lngSpan * j / (N - 1);
            if (!this._pointInRing(lat, lng, outer)) continue;
            if (holes.some((h) => this._pointInRing(lat, lng, h))) continue;
            waterProx[i][j] = Math.max(waterProx[i][j], ar.cls === 'water' ? 1.0 : 0.78);
            if (ar.cls === 'wetland' && pri[i][j] < 4) {
              fam[i][j] = 'green';
              sub[i][j] = 'wetland';
              pri[i][j] = 4;
            }
          }
        }
        continue;
      }

      const info = TerrainViewer._landCoverFamily(ar.cls);
      if (!info) continue;

      for (let i = i0; i <= i1; i++) {
        const lat = bbox.minLat + latSpan * i / (N - 1);
        for (let j = j0; j <= j1; j++) {
          if (info.pri <= pri[i][j]) continue;
          const lng = bbox.minLng + lngSpan * j / (N - 1);
          if (!this._pointInRing(lat, lng, outer)) continue;
          if (holes.some((h) => this._pointInRing(lat, lng, h))) continue;
          fam[i][j] = info.family;
          sub[i][j] = info.sub;
          pri[i][j] = info.pri;
        }
      }
    }

    // Rasterise OSM river/stream polylines into waterProx so river channels carve
    // subtle valley incisions and their banks grow lush riparian vegetation.
    const srcLines = lines || (this._featuresData && this._featuresData.lines) || [];
    for (const ln of srcLines) {
      if (ln.kind !== 'water' || !Array.isArray(ln.pts) || ln.pts.length < 2) continue;
      const isRiver = ln.cls === 'river';
      const radius = isRiver ? 3.2 : 2.2;
      const strength = isRiver ? 0.95 : 0.72;
      for (let k = 0; k < ln.pts.length - 1; k++) {
        const [la0, lo0] = ln.pts[k];
        const [la1, lo1] = ln.pts[k + 1];
        const fi0 = (la0 - bbox.minLat) / latSpan * (N - 1);
        const fj0 = (lo0 - bbox.minLng) / lngSpan * (N - 1);
        const fi1 = (la1 - bbox.minLat) / latSpan * (N - 1);
        const fj1 = (lo1 - bbox.minLng) / lngSpan * (N - 1);
        const steps = Math.max(1, Math.ceil(Math.hypot(fi1 - fi0, fj1 - fj0) * 1.5));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const ci = fi0 + (fi1 - fi0) * t;
          const cj = fj0 + (fj1 - fj0) * t;
          const rCeil = Math.ceil(radius);
          const iMin = Math.max(0, Math.floor(ci - rCeil));
          const iMax = Math.min(N - 1, Math.ceil(ci + rCeil));
          const jMin = Math.max(0, Math.floor(cj - rCeil));
          const jMax = Math.min(N - 1, Math.ceil(cj + rCeil));
          for (let ii = iMin; ii <= iMax; ii++) {
            for (let jj = jMin; jj <= jMax; jj++) {
              const d = Math.hypot(ii - ci, jj - cj);
              if (d <= radius) {
                const w = strength * (1 - d / radius);
                if (w > waterProx[ii][jj]) waterProx[ii][jj] = w;
              }
            }
          }
        }
      }
    }

    // Promote unlabelled or grass cells in the moisture halo of waterways/lakes
    // into riparian vegetation belts.
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const wp = waterProx[i][j];
        if (wp > 0.14 && wp < 0.88 && (sub[i][j] == null || sub[i][j] === 'grass')) {
          fam[i][j] = 'green';
          sub[i][j] = 'riparian';
        }
      }
    }

    // Built-up density: where building footprints cluster in a neighbourhood and
    // no higher-priority cover claimed it, mark the ground urban (灰).
    if (Array.isArray(buildings) && buildings.length) {
      const counts = [];
      for (let i = 0; i < N; i++) counts.push(new Float32Array(N));
      for (const b of buildings) {
        const ring = b.ring;
        if (!ring || ring.length < 3) continue;
        let cla = 0, clo = 0;
        for (const [la, lo] of ring) { cla += la; clo += lo; }
        cla /= ring.length; clo /= ring.length;
        const gi = Math.round((cla - bbox.minLat) / latSpan * (N - 1));
        const gj = Math.round((clo - bbox.minLng) / lngSpan * (N - 1));
        if (gi < 0 || gi >= N || gj < 0 || gj >= N) continue;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ii = gi + di, jj = gj + dj;
            if (ii >= 0 && ii < N && jj >= 0 && jj < N) {
              counts[ii][jj] += (di === 0 && dj === 0) ? 1.0 : 0.45;
            }
          }
        }
      }
      const urban = TerrainViewer._landCoverFamily('urban');
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          if (counts[i][j] >= 2.2 && urban.pri > pri[i][j]) {
            fam[i][j] = urban.family;
            sub[i][j] = urban.sub;
            pri[i][j] = urban.pri;
          }
        }
      }
    }

    this._subBiomeField = sub;
    this._waterDistField = waterProx;
    return fam;
  }

  // Sample satellite vegetation index (Excess Green: -1..1) and RGB (0..1) at
  // normalized grid coordinates (u = j/(N-1), v = i/(N-1)).
  _sampleSatelliteAtUV(u, v) {
    const img = this._satImageData;
    if (!img || !img.data || !img.width || !img.height) return null;
    const x = Math.max(0, Math.min(img.width - 1, Math.round(u * (img.width - 1))));
    const y = Math.max(0, Math.min(img.height - 1, Math.round((1 - v) * (img.height - 1))));
    const idx = (y * img.width + x) * 4;
    const d = img.data;
    if (d[idx + 3] < 32) return null;
    const r = d[idx] / 255;
    const g = d[idx + 1] / 255;
    const b = d[idx + 2] / 255;
    const exg = Math.max(-1, Math.min(1, (2 * g - r - b) * 1.8));
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    return { r, g, b, exg, luma };
  }

  // Re-sculpt micro-relief, update vertex colours, and synthesize the high-res
  // PBR surface textures once OSM map features and/or satellite data are ready.
  _applyLandCoverColors(areas, buildings, bbox, lines = null) {
    if (!this.terrainMesh || !this._field) return;
    const fam = this._buildLandCoverField(areas, buildings, bbox, lines);
    this._landCoverField = fam;
    this._refreshTerrainSurfaceFromSources(bbox);
  }

  // Refresh the terrain mesh's sculpted relief, geomorphological fields, vertex
  // colours, analytic normals, and synthesized high-res PBR surface textures from
  // all currently available sources (DEM + OSM + Satellite).
  _refreshTerrainSurfaceFromSources(bbox = this._bbox) {
    if (!this.terrainMesh || !this._field || !bbox) return;
    const N = FIELD_SIZE;

    // Re-sculpt subtle hydrological channels and forest canopy / rock micro-relief
    // into the height field and update the mesh vertex Y positions + normals.
    this._sculptTerrainRelief(bbox);
    const field = this._field;
    const minElev = this._fieldMinV;
    this._computeGeomorphFields(field, bbox, N);

    const posAttr = this.terrainMesh.geometry.getAttribute('position');
    if (posAttr) {
      let vi = 0;
      for (let i = 0; i < N; i++) {
        const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (N - 1);
        for (let j = 0; j < N; j++) {
          const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
          const raw = field[i][j];
          const elev = this._isHole(raw) ? minElev : raw;
          const p = this._latLngToLocal(lat, lng, elev, bbox);
          posAttr.setXYZ(vi++, p.x, p.y, p.z);
        }
      }
      posAttr.needsUpdate = true;
    }

    this.terrainMesh.geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(this._computeFieldNormals(field, bbox, N), 3)
    );

    const colorAttr = this.terrainMesh.geometry.getAttribute('color');
    if (colorAttr) {
      const fam = this._landCoverField;
      const sub = this._subBiomeField;
      const waterProx = this._waterDistField;
      const slopes = this._slopeField;
      const curvs = this._curvatureField;
      const aspects = this._aspectField;
      const aos = this._aoField;
      let idx = 0;
      for (let i = 0; i < N; i++) {
        const v = i / (N - 1);
        for (let j = 0; j < N; j++) {
          const u = j / (N - 1);
          const raw = field[i][j];
          const elev = this._isHole(raw) ? minElev : raw;
          const sat = this._sampleSatelliteAtUV(u, v);
          const [r, g, b] = TerrainViewer._terrainColorFor(
            fam ? fam[i][j] : null,
            elev,
            slopes[i][j],
            {
              sub: sub ? sub[i][j] : null,
              curvature: curvs ? curvs[i][j] : 0,
              aspect: aspects ? aspects[i][j] : 0,
              ao: aos ? aos[i][j] : 1,
              waterProx: waterProx ? waterProx[i][j] : 0,
              satVeg: sat ? sat.exg : null,
            }
          );
          colorAttr.setXYZ(idx++, r, g, b);
        }
      }
      colorAttr.needsUpdate = true;
    }

    this._rebuildTerrainSurfaceTextures(bbox);
  }

  // Synthesize high-resolution (512×512) Albedo, Bump, and Roughness textures
  // fusing DEM geomorphology (elevation, slope, ridge/valley curvature, aspect,
  // dual-azimuth hillshade, valley AO), spatially-feathered OSM land-cover &
  // riparian corridors, procedural biome micro-textures (3D forest canopy crowns,
  // stratified bedrock veins, meadow grain), and live Satellite imagery.
  _rebuildTerrainSurfaceTextures(bbox = this._bbox) {
    if (!this.terrainMesh || !this._field || !bbox) return;
    const N = FIELD_SIZE;
    const TEX = 512;
    const field = this._field;
    const minElev = this._fieldMinV;
    const slopes = this._slopeField || this._computeFieldSlopes(field, bbox, N);
    const curvs = this._curvatureField;
    const aspects = this._aspectField;
    const aos = this._aoField;
    const fam = this._landCoverField;
    const sub = this._subBiomeField;
    const waterProx = this._waterDistField;

    // 1) Precompute spatially-feathered vertex colours, canopy weight, rock weight,
    //    water proximity, and analytical hillshade on the N×N grid so the 512×512
    //    texel pass only needs fast bilinear interpolation + micro-texture noise.
    const gridR = new Float32Array(N * N);
    const gridG = new Float32Array(N * N);
    const gridB = new Float32Array(N * N);
    const gridCanopy = new Float32Array(N * N);
    const gridRock = new Float32Array(N * N);
    const gridWater = new Float32Array(N * N);
    const gridShade = new Float32Array(N * N);
    const gridElev = new Float32Array(N * N);

    const rawR = new Float32Array(N * N);
    const rawG = new Float32Array(N * N);
    const rawB = new Float32Array(N * N);
    const rawCanopy = new Float32Array(N * N);
    const rawRock = new Float32Array(N * N);

    for (let i = 0; i < N; i++) {
      const v = i / (N - 1);
      for (let j = 0; j < N; j++) {
        const u = j / (N - 1);
        const k = i * N + j;
        const raw = field[i][j];
        const elev = this._isHole(raw) ? minElev : raw;
        gridElev[k] = elev;
        const s = slopes[i][j] || 0;
        const c = curvs ? curvs[i][j] : 0;
        const a = aspects ? aspects[i][j] : 0;
        const ao = aos ? aos[i][j] : 1;
        const wp = waterProx ? waterProx[i][j] : 0;
        const sb = sub ? sub[i][j] : null;
        const fm = fam ? fam[i][j] : null;
        const sat = this._sampleSatelliteAtUV(u, v);

        const [cr, cg, cb] = TerrainViewer._terrainColorFor(fm, elev, s, {
          sub: sb, curvature: c, aspect: a, ao, waterProx: wp, satVeg: sat ? sat.exg : null,
        });
        rawR[k] = cr; rawG[k] = cg; rawB[k] = cb;

        // Canopy fullness (0..1) drives 3D crown mottling and bump amplitude.
        let cw = 0;
        if (sb === 'forest') cw = 0.95;
        else if (sb === 'riparian') cw = 0.78;
        else if (sb === 'scrub') cw = 0.55;
        else if (sb === 'grass' || sb === 'wetland') cw = 0.18;
        else if (fm == null && elev < 3300 && s < 0.85) {
          cw = Math.max(0.15, Math.min(0.85, 0.48 - c * 0.25 + wp * 0.3 + (sat ? sat.exg * 0.45 : 0)));
        }
        if (sat && sat.exg > 0.12 && sb !== 'urban' && sb !== 'rock') {
          cw = Math.max(cw, Math.min(0.92, 0.35 + sat.exg * 0.85));
        }
        rawCanopy[k] = cw;

        // Rock / cliff / scree weight (0..1) drives stratified bedrock veins & bump.
        let rw = sb === 'rock' ? 0.95 : (sb === 'soil' ? 0.35 : 0);
        const slopeRock = Math.max(0, Math.min(1, (s + Math.max(0, c) * 0.25 - 0.52) / 0.85));
        rw = Math.max(rw, slopeRock * (sb === 'forest' ? 0.35 : 0.88));
        if (sat && sat.exg < -0.05 && s > 0.25) rw = Math.max(rw, Math.min(0.85, (-sat.exg) * 1.3));
        rawRock[k] = rw;
        gridWater[k] = wp;

        // Dual-azimuth cartographic hillshade factor + valley AO.
        const sinSlope = Math.sin(Math.atan(s));
        const cosSlope = Math.cos(Math.atan(s));
        // Primary NW oblique light + secondary SE counter-light.
        const nw = cosSlope * 0.62 + sinSlope * 0.78 * Math.cos(a - (-Math.PI * 0.72));
        const se = cosSlope * 0.72 + sinSlope * 0.68 * Math.cos(a - (Math.PI * 0.28));
        const hs = (0.68 * Math.max(0.15, nw) + 0.32 * Math.max(0.2, se));
        gridShade[k] = Math.max(0.52, Math.min(1.22, (0.55 + 0.62 * hs) * (0.78 + 0.22 * ao)));
      }
    }

    // 3×3 spatial feather over the N×N biome arrays so polygon boundaries blend
    // organically instead of showing grid-aligned steps.
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        let sr = 0, sg = 0, sb = 0, sc = 0, srk = 0, wSum = 0;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di < 0 ? 0 : (i + di >= N ? N - 1 : i + di);
          for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj < 0 ? 0 : (j + dj >= N ? N - 1 : j + dj);
            const wt = (di === 0 && dj === 0) ? 4 : ((di === 0 || dj === 0) ? 2 : 1);
            const nk = ii * N + jj;
            sr += rawR[nk] * wt;
            sg += rawG[nk] * wt;
            sb += rawB[nk] * wt;
            sc += rawCanopy[nk] * wt;
            srk += rawRock[nk] * wt;
            wSum += wt;
          }
        }
        const k = i * N + j;
        gridR[k] = sr / wSum;
        gridG[k] = sg / wSum;
        gridB[k] = sb / wSum;
        gridCanopy[k] = sc / wSum;
        gridRock[k] = srk / wSum;
      }
    }

    // 2) Synthesize the 512×512 Albedo, Bump, and Roughness canvases.
    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = TEX; albedoCanvas.height = TEX;
    const albedoCtx = albedoCanvas.getContext('2d');
    const albedoImg = albedoCtx.createImageData(TEX, TEX);
    const aData = albedoImg.data;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = TEX; bumpCanvas.height = TEX;
    const bumpCtx = bumpCanvas.getContext('2d');
    const bumpImg = bumpCtx.createImageData(TEX, TEX);
    const bData = bumpImg.data;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = TEX; roughCanvas.height = TEX;
    const roughCtx = roughCanvas.getContext('2d');
    const roughImg = roughCtx.createImageData(TEX, TEX);
    const rData = roughImg.data;

    const satImg = this._satImageData;
    const hasSat = !!(satImg && satImg.data && satImg.width > 0 && satImg.height > 0);
    const satMode = !!this._satelliteEnabled && hasSat;

    const bilerp = (arr, gi, gj) => {
      const i0 = Math.max(0, Math.min(N - 2, Math.floor(gi)));
      const j0 = Math.max(0, Math.min(N - 2, Math.floor(gj)));
      const ty = gi - i0;
      const tx = gj - j0;
      const k00 = i0 * N + j0;
      const top = arr[k00] + (arr[k00 + 1] - arr[k00]) * tx;
      const bot = arr[k00 + N] + (arr[k00 + N + 1] - arr[k00 + N]) * tx;
      return top + (bot - top) * ty;
    };

    for (let py = 0; py < TEX; py++) {
      const v = 1 - py / (TEX - 1); // py=0 is north (v=1, maxLat)
      const gi = v * (N - 1);
      for (let px = 0; px < TEX; px++) {
        const u = px / (TEX - 1);
        const gj = u * (N - 1);
        const pIdx = (py * TEX + px) * 4;

        let r = bilerp(gridR, gi, gj);
        let g = bilerp(gridG, gi, gj);
        let b = bilerp(gridB, gi, gj);
        const canopy = bilerp(gridCanopy, gi, gj);
        const rock = bilerp(gridRock, gi, gj);
        const water = bilerp(gridWater, gi, gj);
        const shade = bilerp(gridShade, gi, gj);
        const elev = bilerp(gridElev, gi, gj);

        // Multi-scale procedural micro-texture:
        //  • nCrown: cellular forest tree-crown domes (sunlit crown tips & dark gaps)
        //  • nPatch: medium landscape patchiness (clearing / meadow / shrub clusters)
        //  • nStrata: contour-following geological bedrock strata & cliff fractures
        const nCrown1 = TerrainViewer._valueNoise2D(u * 96, v * 96);
        const nCrown2 = TerrainViewer._valueNoise2D(u * 44 + 17.3, v * 44 + 9.1);
        const crownDome = Math.sin(nCrown1 * Math.PI) * 0.65 + nCrown2 * 0.35; // 0..1
        const nPatch = TerrainViewer._valueNoise2D(u * 18 + 3.7, v * 18 + 11.2) - 0.5;
        const strataWave = Math.sin((elev * 0.14) + nCrown2 * 4.2) * 0.5 + 0.5;

        // Apply organic canopy crown mottling & meadow variation to procedural base.
        if (canopy > 0.08) {
          const crownDelta = (crownDome - 0.52) * 0.24 * canopy;
          r += crownDelta * 0.72 + nPatch * 0.04 * canopy;
          g += crownDelta * 1.05 + nPatch * 0.06 * canopy;
          b += crownDelta * 0.55;
        } else {
          // Subtle meadow / soil grain
          const grain = (nCrown1 - 0.5) * 0.06 + nPatch * 0.04;
          r += grain; g += grain; b += grain * 0.85;
        }

        // Apply stratified rock veins & scree texture on steep slopes / cliffs.
        if (rock > 0.08) {
          const rockMod = ((strataWave - 0.5) * 0.18 + (nCrown1 - 0.5) * 0.14) * rock;
          r += rockMod;
          g += rockMod * 0.96;
          b += rockMod * 0.90;
        }

        // Apply dual-azimuth hillshade & valley AO to procedural colour.
        r *= shade;
        g *= shade;
        b *= shade;

        // Fuse with Satellite imagery when available:
        if (hasSat) {
          const sx = Math.max(0, Math.min(satImg.width - 1, Math.round(u * (satImg.width - 1))));
          const sy = Math.max(0, Math.min(satImg.height - 1, Math.round((1 - v) * (satImg.height - 1))));
          const sIdx = (sy * satImg.width + sx) * 4;
          const sd = satImg.data;
          if (sd[sIdx + 3] > 32) {
            // Contrast-and-saturation enhanced satellite pixel, modulated by DEM relief shade.
            let sr = sd[sIdx] / 255;
            let sg = sd[sIdx + 1] / 255;
            let sb = sd[sIdx + 2] / 255;
            const sLuma = 0.299 * sr + 0.587 * sg + 0.114 * sb;
            // Gentle vibrance boost & shadow recovery so aerial haze doesn't wash out the 3D relief.
            const vib = 1.22;
            sr = Math.max(0, Math.min(1, sLuma + (sr - sLuma) * vib));
            sg = Math.max(0, Math.min(1, sLuma + (sg - sLuma) * vib));
            sb = Math.max(0, Math.min(1, sLuma + (sb - sLuma) * vib));

            const satRelief = 0.72 + 0.28 * shade;
            sr *= satRelief;
            sg *= satRelief;
            sb *= satRelief;

            if (satMode) {
              // Explicit Satellite Mode: crisp relief-shaded satellite imagery
              // harmonized with 20% OSM/geomorphology biome tint + canopy micro-detail.
              const bioMix = 0.20;
              r = sr * (1 - bioMix) + r * bioMix;
              g = sg * (1 - bioMix) + g * bioMix;
              b = sb * (1 - bioMix) + b * bioMix;
            } else {
              // Automatic Hybrid Mode: fuse real-world satellite texture & canopy
              // variations (~30%) into the OSM + geomorphology terrain surface.
              const autoMix = 0.30;
              r = r * (1 - autoMix) + sr * autoMix;
              g = g * (1 - autoMix) + sg * autoMix;
              b = b * (1 - autoMix) + sb * autoMix;
            }
          }
        }

        aData[pIdx]     = Math.max(0, Math.min(255, Math.round(r * 255)));
        aData[pIdx + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        aData[pIdx + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        aData[pIdx + 3] = 255;

        // Bump map height (0..255): 3D canopy domes in forests + craggy strata on rock,
        // smooth over water channels.
        const waterFlatten = Math.max(0, 1 - water * 0.85);
        const bumpVal = (
          0.5 +
          (crownDome - 0.5) * 0.55 * canopy +
          (strataWave * 0.6 + nCrown1 * 0.4 - 0.5) * 0.65 * rock +
          (nCrown2 - 0.5) * 0.14
        ) * waterFlatten;
        const bByte = Math.max(0, Math.min(255, Math.round(bumpVal * 255)));
        bData[pIdx] = bData[pIdx + 1] = bData[pIdx + 2] = bByte;
        bData[pIdx + 3] = 255;

        // Roughness map (0..255): water/wetlands are glossy (low roughness),
        // forest canopy is matte (high roughness), exposed rock has subtle mineral sheen.
        let rough = 0.86 + canopy * 0.08 - rock * 0.14 - water * 0.52;
        rough = Math.max(0.22, Math.min(0.96, rough));
        const rByte = Math.round(rough * 255);
        rData[pIdx] = rData[pIdx + 1] = rData[pIdx + 2] = rByte;
        rData[pIdx + 3] = 255;
      }
    }

    albedoCtx.putImageData(albedoImg, 0, 0);
    bumpCtx.putImageData(bumpImg, 0, 0);
    roughCtx.putImageData(roughImg, 0, 0);

    const aniso = this.renderer?.capabilities?.getMaxAnisotropy?.() || 1;

    this._surfaceMap?.dispose?.();
    this._surfaceMap = new THREE.CanvasTexture(albedoCanvas);
    this._surfaceMap.colorSpace = THREE.SRGBColorSpace;
    this._surfaceMap.anisotropy = aniso;
    this._surfaceMap.needsUpdate = true;

    this._surfaceBumpMap?.dispose?.();
    this._surfaceBumpMap = new THREE.CanvasTexture(bumpCanvas);
    this._surfaceBumpMap.anisotropy = aniso;
    this._surfaceBumpMap.needsUpdate = true;

    this._surfaceRoughMap?.dispose?.();
    this._surfaceRoughMap = new THREE.CanvasTexture(roughCanvas);
    this._surfaceRoughMap.anisotropy = aniso;
    this._surfaceRoughMap.needsUpdate = true;

    const mat = this.terrainMesh.material;
    mat.map = this._surfaceMap;
    mat.bumpMap = this._surfaceBumpMap;
    mat.bumpScale = Math.max(2.2, (this._worldSpan || 2000) * 0.0028);
    mat.roughnessMap = this._surfaceRoughMap;
    mat.roughness = 1.0;
    mat.vertexColors = false;
    mat.color.setRGB(1, 1, 1);
    mat.needsUpdate = true;
  }

  _createTerrain(bbox) {
    const field = this._field;
    const N = FIELD_SIZE;
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const indices = [];
    const uvs = [];

    const minElev = this._fieldMinV;
    this._computeGeomorphFields(field, bbox, N);
    const slopes = this._slopeField;
    const curvs = this._curvatureField;
    const aspects = this._aspectField;
    const aos = this._aoField;

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * i / (N - 1);
        const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * j / (N - 1);
        const raw = field[i][j];
        // Holes get a placeholder height; the quads touching them are skipped so
        // they never appear on screen.
        const elev = this._isHole(raw) ? minElev : raw;
        const p = this._latLngToLocal(lat, lng, elev, bbox);
        vertices.push(p.x, p.y, p.z);
        uvs.push(j / (N - 1), i / (N - 1));

        // Colour by absolute elevation + slope + geomorphology; land cover +
        // satellite are fused in by _refreshTerrainSurfaceFromSources.
        const [r, g, b] = TerrainViewer._terrainColorFor(null, elev, slopes[i][j], {
          curvature: curvs[i][j],
          aspect: aspects[i][j],
          ao: aos[i][j],
        });
        colors.push(r, g, b);
      }
    }

    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < N - 1; j++) {
        // Skip any quad touching missing data — blank tiles aren't drawn.
        if (this._isHole(field[i][j]) || this._isHole(field[i][j + 1]) ||
            this._isHole(field[i + 1][j]) || this._isHole(field[i + 1][j + 1])) continue;
        const a = i * N + j;
        const b = i * N + j + 1;
        const c = (i + 1) * N + j;
        const d = (i + 1) * N + j + 1;
        // Alternate the split diagonal per cell (checkerboard) so the
        // triangulation has no consistent direction — this removes the regular
        // diagonal "corduroy" wrinkle that a uniform split produces.
        if ((i + j) & 1) {
          indices.push(a, b, d);
          indices.push(a, d, c);
        } else {
          indices.push(a, b, c);
          indices.push(b, d, c);
        }
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    // Smooth per-vertex normals from the height-field gradient (central
    // differences) instead of averaging triangle faces.
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this._computeFieldNormals(field, bbox, N), 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.90,
      metalness: 0.02,
      side: THREE.DoubleSide,
      // Push terrain fragments slightly back in the depth buffer so coincident
      // contour/route lines win and don't z-fight / break through.
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    // Terrain is lit by the fixed midday rig on TERRAIN_LAYER, not by the
    // route-clock day/night lights (layer 0), so it never darkens at night.
    this.terrainMesh.layers.set(TERRAIN_LAYER);
    this.scene.add(this.terrainMesh);

    // Synthesize initial high-resolution geomorphological surface + bump/roughness maps.
    this._rebuildTerrainSurfaceTextures(bbox);

    // A rebuild recreates the mesh; re-drape satellite imagery if it was on.
    if (this._satelliteEnabled) this._applySatelliteTexture();
  }

  // cb() — fired when satellite imagery can't be draped (offline / no tiles) so
  // the host can reset its toggle and notify the user.
  onSatelliteError(cb) {
    this._onSatelliteError = cb;
  }

  isSatelliteEnabled() {
    return !!this._satelliteEnabled;
  }

  // 衛星影像: drape live Esri imagery over the terrain surface. The height-field
  // mesh already carries a 0..1 UV grid spanning the bbox (u→lng, v→lat), so the
  // texture maps straight on. Off → back to the hybrid geomorphology+OSM+satellite
  // biome surface.
  setSatelliteEnabled(on) {
    this._satelliteEnabled = !!on;
    if (this._satelliteEnabled) this._applySatelliteTexture();
    else this._removeSatelliteTexture();
    return this._satelliteEnabled;
  }

  _removeSatelliteTexture() {
    if (!this.terrainMesh) return;
    if (this._bbox && this._field) {
      this._rebuildTerrainSurfaceTextures(this._bbox);
    } else {
      const mat = this.terrainMesh.material;
      mat.map = null;
      mat.vertexColors = true;
      mat.color.setRGB(1, 1, 1);
      mat.needsUpdate = true;
    }
  }

  async _applySatelliteTexture() {
    if (!this.terrainMesh || !this._bbox) return;
    const b = this._bbox;
    const key = `${b.minLat.toFixed(5)},${b.minLng.toFixed(5)},${b.maxLat.toFixed(5)},${b.maxLng.toFixed(5)}`;
    try {
      if (!this._satTexture || this._satTextureKey !== key) {
        const tex = await this._buildSatelliteTexture(b);
        if (!tex) throw new Error('no satellite tiles loaded');
        this._satTexture?.dispose?.();
        this._satTexture = tex;
        this._satTextureKey = key;
      }
      // Guard: the user may have toggled it off, or the scene rebuilt, while the
      // tiles were downloading.
      if (!this._satelliteEnabled || !this.terrainMesh) return;
      this._refreshTerrainSurfaceFromSources(b);
    } catch (err) {
      console.warn('satellite drape failed, falling back to land cover:', err);
      this._satelliteEnabled = false;
      this._removeSatelliteTexture();
      if (this._onSatelliteError) this._onSatelliteError();
    }
  }

  // Non-blocking background satellite sampler: quietly fetches a low-tile-count
  // satellite mosaic for the bbox so the default 3D terrain automatically fuses
  // real-world vegetation density, canopy texture and rock/soil patches with OSM.
  async _autoLoadSatelliteForSurface(bbox, token) {
    if (!bbox) return;
    const key = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
    if (this._satCanvasKey === key && this._satImageData) {
      if (token === this._buildToken && this.terrainMesh) {
        this._refreshTerrainSurfaceFromSources(bbox);
      }
      return;
    }
    try {
      const canvas = await this._fetchSatelliteCanvas(bbox, { maxTilesPerSide: 3 });
      if (!canvas || this._aborted || token !== this._buildToken || !this.terrainMesh) return;
      this._satCanvas = canvas;
      this._satCanvasKey = key;
      try {
        this._satImageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        this._satImageData = null;
      }
      if (this._satImageData) {
        this._refreshTerrainSurfaceFromSources(bbox);
      }
    } catch {
      // Quietly fall back to DEM geomorphology + OSM procedural synthesis when offline.
    }
  }

  // Mosaic Esri World Imagery tiles covering the bbox into a Canvas (and store its
  // pixel data in _satImageData for hybrid biome/relief synthesis).
  async _fetchSatelliteCanvas(bbox, { maxTilesPerSide = 5 } = {}) {
    const TILE = 256;
    const lngToX = (lng, z) => (lng + 180) / 360 * (1 << z);
    const latToY = (lat, z) => {
      const r = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z);
    };
    let z = 17;
    for (; z >= 2; z--) {
      const xs = lngToX(bbox.maxLng, z) - lngToX(bbox.minLng, z);
      const ys = latToY(bbox.minLat, z) - latToY(bbox.maxLat, z);
      if (Math.max(xs, ys) <= maxTilesPerSide) break;
    }
    const x0 = lngToX(bbox.minLng, z), x1 = lngToX(bbox.maxLng, z);
    const y0 = latToY(bbox.maxLat, z), y1 = latToY(bbox.minLat, z);  // y0 = north/top
    const w = Math.max(1, Math.round((x1 - x0) * TILE));
    const h = Math.max(1, Math.round((y1 - y0) * TILE));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const n = 1 << z;
    let loaded = 0;
    const jobs = [];
    for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
      for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        jobs.push(new Promise((res) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE, TILE, TILE);
            loaded++; res();
          };
          img.onerror = () => res();
          // Esri World Imagery (same source as the 2D 衛星 layer): z/y/x order.
          img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${wx}`;
        }));
      }
    }
    await Promise.all(jobs);
    if (loaded === 0) return null;
    return canvas;
  }

  // Mosaic Esri World Imagery tiles covering the bbox into a CanvasTexture.
  // Returns null if no tile could be fetched (offline / no coverage).
  async _buildSatelliteTexture(bbox) {
    const key = `${bbox.minLat.toFixed(5)},${bbox.minLng.toFixed(5)},${bbox.maxLat.toFixed(5)},${bbox.maxLng.toFixed(5)}`;
    const canvas = await this._fetchSatelliteCanvas(bbox, { maxTilesPerSide: 5 });
    if (!canvas) return null;
    this._satCanvas = canvas;
    this._satCanvasKey = key;
    try {
      this._satImageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      this._satImageData = null;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
    tex.needsUpdate = true;
    return tex;
  }

  // Smooth analytic normals (N×N×3, vertex order matching _createTerrain) from
  // the height field's gradient. Accounts for the active vertical exaggeration
  // (_elevScale) and applies a subtle cartographic relief boost so ridges,
  // gullies, and slopes catch directional light with crisp 3D definition.
  _computeFieldNormals(field, bbox, N) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const dx = R * toRad * ((bbox.maxLng - bbox.minLng) / (N - 1)) * Math.cos(toRad * cy) || 1;
    const dz = R * toRad * ((bbox.maxLat - bbox.minLat) / (N - 1)) || 1;
    const normScale = Math.max(1.32, (this._elevScale || 1) * 1.15);

    const normals = new Float32Array(N * N * 3);
    const at = (i, j) => {
      const ii = i < 0 ? 0 : (i >= N ? N - 1 : i);
      const jj = j < 0 ? 0 : (j >= N ? N - 1 : j);
      const v = field[ii][jj];
      return this._isHole(v) ? null : v;
    };
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const c = at(i, j);
        // Hole vertices aren't drawn; give them a flat up-normal so they don't
        // poison neighbour shading via interpolation.
        const center = c == null ? 0 : c;
        const hl = at(i, j - 1) ?? center;
        const hr = at(i, j + 1) ?? center;
        const hd = at(i - 1, j) ?? center;
        const hu = at(i + 1, j) ?? center;
        const gx = ((hr - hl) / (2 * dx)) * normScale; // ∂h/∂x
        const gz = ((hu - hd) / (2 * dz)) * normScale; // ∂h/∂z
        tmp.set(-gx, 1, -gz).normalize();
        const o = (i * N + j) * 3;
        normals[o] = tmp.x;
        normals[o + 1] = tmp.y;
        normals[o + 2] = tmp.z;
      }
    }
    return normals;
  }

  // Compute full geomorphological fields on the N×N grid:
  //  • _slopeField: true world rise/run slope
  //  • _aspectField: slope orientation (radians, 0 = north, π/2 = east)
  //  • _curvatureField: multi-scale ridge/valley TPI in [-1, 1] (+ridge, -valley)
  //  • _aoField: topographic valley ambient occlusion / sky-view openness [0.45, 1]
  _computeGeomorphFields(field, bbox, N) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const dx = R * toRad * ((bbox.maxLng - bbox.minLng) / (N - 1)) * Math.cos(toRad * cy) || 1;
    const dz = R * toRad * ((bbox.maxLat - bbox.minLat) / (N - 1)) || 1;
    const cellScale = Math.max(4, Math.hypot(dx, dz));

    const at = (i, j) => {
      const ii = i < 0 ? 0 : (i >= N ? N - 1 : i);
      const jj = j < 0 ? 0 : (j >= N ? N - 1 : j);
      const v = field[ii][jj];
      return this._isHole(v) ? null : v;
    };

    const slopes = [];
    const aspects = [];
    const curvs = [];
    const aos = [];

    for (let i = 0; i < N; i++) {
      const sRow = new Array(N);
      const aRow = new Array(N);
      const cRow = new Array(N);
      const oRow = new Array(N);
      for (let j = 0; j < N; j++) {
        const c = at(i, j);
        const center = c == null ? 0 : c;
        const hl = at(i, j - 1) ?? center;
        const hr = at(i, j + 1) ?? center;
        const hd = at(i - 1, j) ?? center;
        const hu = at(i + 1, j) ?? center;
        const gx = (hr - hl) / (2 * dx);
        const gz = (hu - hd) / (2 * dz);
        const slope = Math.hypot(gx, gz);
        sRow[j] = slope;
        aRow[j] = Math.atan2(-gx, -gz);

        // Fine 1-ring mean vs meso 3-ring mean for Topographic Position Index (TPI).
        const avg1 = (hl + hr + hd + hu) * 0.25;
        const hll = at(i, j - 3) ?? center;
        const hrr = at(i, j + 3) ?? center;
        const hdd = at(i - 3, j) ?? center;
        const huu = at(i + 3, j) ?? center;
        const hdl = at(i - 2, j - 2) ?? center;
        const hdr = at(i - 2, j + 2) ?? center;
        const hul = at(i + 2, j - 2) ?? center;
        const hur = at(i + 2, j + 2) ?? center;
        const avg3 = (hll + hrr + hdd + huu + hdl + hdr + hul + hur) * 0.125;

        const diffFine = (center - avg1) / (cellScale * 0.14);
        const diffMeso = (center - avg3) / (cellScale * 0.36);
        const curv = Math.max(-1, Math.min(1, diffFine * 0.55 + diffMeso * 0.45));
        cRow[j] = curv;

        // Valley cavity occlusion: concave ravines and steep gorge walls darken
        // naturally while exposed ridges receive full sky illumination.
        const cavity = Math.max(0, -curv);
        const ao = Math.max(0.45, Math.min(1.0, 1.0 - cavity * 0.34 - Math.min(0.22, slope * 0.12)));
        oRow[j] = ao;
      }
      slopes.push(sRow);
      aspects.push(aRow);
      curvs.push(cRow);
      aos.push(oRow);
    }

    this._slopeField = slopes;
    this._aspectField = aspects;
    this._curvatureField = curvs;
    this._aoField = aos;
    return slopes;
  }

  // True-world slope magnitude (rise/run) per fine-field vertex, in the vertex
  // order used by _createTerrain.
  _computeFieldSlopes(field, bbox, N) {
    return this._computeGeomorphFields(field, bbox, N);
  }

  // --- Smoothed / upsampled height field + Geomorphological Micro-Relief -----

  _isHole(v) {
    return v == null || !Number.isFinite(v);
  }

  // Build the fine render/contour field from the coarse download grid: an
  // edge-preserving bilateral filter (softens flat DEM terracing while keeping
  // ridge crests and valley incisions sharp) followed by a Catmull-Rom upsample
  // to FIELD_SIZE and geomorphological micro-relief sculpting.
  _buildFineField(grid) {
    const N = GRID_SIZE;

    // Estimate coarse relief scale for the bilateral range weight.
    let cMin = Infinity, cMax = -Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const v = grid[i][j];
        if (!this._isHole(v)) {
          if (v < cMin) cMin = v;
          if (v > cMax) cMax = v;
        }
      }
    }
    const cRange = Math.max(20, (cMax - cMin) || 100);
    const sigmaElev = Math.max(12, cRange * 0.16);

    // 1) Hole-aware, edge-preserving bilateral 3×3 filter of the coarse grid:
    //    smooths quantization steps on gentle slopes while preserving sharp ridges
    //    and incised valleys.
    const sm = [];
    for (let i = 0; i < N; i++) {
      const row = [];
      for (let j = 0; j < N; j++) {
        const center = grid[i][j];
        if (this._isHole(center)) { row.push(null); continue; }
        let sum = 0;
        let w = 0;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || ii >= N || jj < 0 || jj >= N) continue;
            const v = grid[ii][jj];
            if (this._isHole(v)) continue;
            const spatialW = (di === 0 && dj === 0) ? 4.5 : ((di === 0 || dj === 0) ? 1.2 : 0.7);
            const dz = (v - center) / sigmaElev;
            const rangeW = Math.exp(-0.5 * dz * dz);
            const wt = spatialW * (0.25 + 0.75 * rangeW);
            sum += v * wt;
            w += wt;
          }
        }
        row.push(w > 0 ? sum / w : center);
      }
      sm.push(row);
    }

    // 2) Upsample to the fine base field.
    const baseField = [];
    let minV = Infinity;
    let maxV = -Infinity;
    for (let fi = 0; fi < FIELD_SIZE; fi++) {
      const row = [];
      const gy = fi / (FIELD_SIZE - 1) * (N - 1);
      for (let fj = 0; fj < FIELD_SIZE; fj++) {
        const gx = fj / (FIELD_SIZE - 1) * (N - 1);
        const v = this._sampleSmooth(sm, gy, gx, N);
        row.push(v);
        if (v != null) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
      }
      baseField.push(row);
    }

    this._fieldMinV = Number.isFinite(minV) ? minV : 0;
    this._fieldMaxV = Number.isFinite(maxV) ? maxV : (this._fieldMinV + 1);
    this._baseField = baseField;
    this._field = baseField.map((r) => r.slice());
    if (this._bbox) this._sculptTerrainRelief(this._bbox);
    return this._field;
  }

  // Sculpt realistic geomorphological micro-relief, hydrological river incisions,
  // and forest canopy crown undulation onto `this._field` from `this._baseField`.
  _sculptTerrainRelief(bbox) {
    const base = this._baseField;
    if (!base || !bbox) return;
    const N = FIELD_SIZE;
    const range = Math.max(10, this._fieldMaxV - this._fieldMinV);
    const sub = this._subBiomeField;
    const waterProx = this._waterDistField;

    // Amplitude scales gently with terrain relief so micro-undulation adds visible
    // 3D landform texture without unseating draped routes or contours.
    const ridgeAmp = Math.min(6.5, Math.max(0.8, range * 0.0085));
    const riverCarveAmp = Math.min(4.2, Math.max(0.6, range * 0.0055));
    const canopyAmp = Math.min(2.8, Math.max(0.45, range * 0.0038));

    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < N; i++) {
      const v = i / (N - 1);
      for (let j = 0; j < N; j++) {
        const h0 = base[i][j];
        if (this._isHole(h0)) {
          this._field[i][j] = null;
          continue;
        }
        const u = j / (N - 1);
        // Fade micro-displacement near the outer border so boundary skirts stay clean.
        const edgeFade = Math.min(1, Math.min(i, j, N - 1 - i, N - 1 - j) / 4);

        // Local slope & Laplacian convexity from baseField.
        const hl = base[i][Math.max(0, j - 1)] ?? h0;
        const hr = base[i][Math.min(N - 1, j + 1)] ?? h0;
        const hd = base[Math.max(0, i - 1)][j] ?? h0;
        const hu = base[Math.min(N - 1, i + 1)][j] ?? h0;
        const localGrad = Math.hypot(hr - hl, hu - hd) / Math.max(8, range * 0.04);
        const slopeFactor = Math.max(0, Math.min(1, localGrad));
        const lap = h0 - (hl + hr + hd + hu) * 0.25;

        // 1) Multi-octave ridged micro-relief on mountain slopes and spurs:
        //    accentuates secondary ridges, rock ribs and erosion gullies.
        const ridged = TerrainViewer._ridgedFbm2D(u * 14 + 1.7, v * 14 + 3.1, 3) - 0.48;
        const fineRib = (TerrainViewer._fbm2D(u * 32 + 5.2, v * 32 + 8.4, 2) - 0.5) * 0.45;
        let dh = (ridged + fineRib) * ridgeAmp * (0.22 + 0.78 * slopeFactor) + Math.max(-1.5, Math.min(1.5, lap * 0.18));

        // 2) OSM hydrological channel incision: rivers and streams sit in carved
        //    topographic beds rather than floating on convex ground.
        const wp = waterProx ? waterProx[i][j] : 0;
        if (wp > 0.2) {
          const carve = Math.pow((wp - 0.2) / 0.8, 1.35) * riverCarveAmp;
          dh -= carve;
        }

        // 3) Forest canopy crown undulation from OSM forest/scrub & Satellite NDVI:
        const sb = sub ? sub[i][j] : null;
        const sat = this._sampleSatelliteAtUV(u, v);
        let isForest = sb === 'forest' || sb === 'riparian';
        if (!isForest && sb == null && sat && sat.exg > 0.18 && h0 < 3250) isForest = true;
        if (isForest && wp < 0.55) {
          const crownWave = Math.sin(TerrainViewer._valueNoise2D(u * 48, v * 48) * Math.PI);
          dh += (crownWave - 0.35) * canopyAmp;
        } else if (sb === 'urban') {
          dh *= 0.25; // level urban ground
        }

        const hFinal = h0 + dh * edgeFade;
        this._field[i][j] = hFinal;
        if (hFinal < minV) minV = hFinal;
        if (hFinal > maxV) maxV = hFinal;
      }
    }
    if (Number.isFinite(minV)) this._fieldMinV = minV;
    if (Number.isFinite(maxV)) this._fieldMaxV = maxV;
  }

  // Catmull-Rom (bicubic) sample of a grid at fractional coords; bilinear when
  // the 4×4 neighbourhood isn't fully valid; null when a bilinear corner is a
  // hole (so the fine sample is itself a hole and won't be drawn).
  _sampleSmooth(grid, gy, gx, N) {
    const j0 = Math.max(0, Math.min(N - 1, Math.floor(gx)));
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(gy)));
    const j1 = Math.min(N - 1, j0 + 1);
    const i1 = Math.min(N - 1, i0 + 1);
    const c00 = grid[i0][j0];
    const c01 = grid[i0][j1];
    const c10 = grid[i1][j0];
    const c11 = grid[i1][j1];
    if (this._isHole(c00) || this._isHole(c01) || this._isHole(c10) || this._isHole(c11)) return null;
    const tx = gx - j0;
    const ty = gy - i0;

    const g = (di, dj) => {
      const ii = Math.max(0, Math.min(N - 1, i0 + di));
      const jj = Math.max(0, Math.min(N - 1, j0 + dj));
      return grid[ii][jj];
    };

    // Fall back to bilinear if any of the wider 4×4 stencil is a hole.
    let allValid = true;
    for (let di = -1; di <= 2 && allValid; di++) {
      for (let dj = -1; dj <= 2; dj++) {
        if (this._isHole(g(di, dj))) { allValid = false; break; }
      }
    }
    if (!allValid) {
      const top = c00 + (c01 - c00) * tx;
      const bot = c10 + (c11 - c10) * tx;
      return top + (bot - top) * ty;
    }

    const cr = (p0, p1, p2, p3, t) =>
      0.5 * ((2 * p1) + (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    const col = [];
    for (let di = -1; di <= 2; di++) {
      col.push(cr(g(di, -1), g(di, 0), g(di, 1), g(di, 2), tx));
    }
    return cr(col[0], col[1], col[2], col[3], ty);
  }

  // ---------- Contour lines (等高線) ----------

  _niceContourInterval() {
    // Fixed resolution per precision: high = 20 m, low = 100 m.
    return this._contourPrecision === 'low' ? 100 : 20;
  }

  _createContours(bbox) {
    const field = this._field;
    const minElev = this._fieldMinV;
    const maxElev = this._fieldMaxV;
    const range = maxElev - minElev;

    const interval = this._niceContourInterval();
    const majorEvery = this._contourPrecision === 'low' ? 4 : 5;

    this._terrainInfo = {
      elevMin: minElev,
      elevMax: maxElev,
      contourInterval: interval,
      gridSize: GRID_SIZE,
    };

    if (range < 1 || !field) return;

    this.contourGroup = new THREE.Group();
    this.contourLabelGroup = new THREE.Group();

    const minorVerts = [];
    const majorVerts = [];
    const labelAnchors = []; // { level, point: Vector3 }

    // Lift the iso-lines a touch above the surface so they read clearly without
    // breaking through it. Small, because they now share the surface field.
    const lift = Math.max(1.5, range * 0.004);

    const startLevel = Math.ceil(minElev / interval) * interval;
    for (let level = startLevel; level < maxElev; level += interval) {
      const isMajor = Math.round(level / interval) % majorEvery === 0;
      const segments = this._marchingSquares(field, level, bbox, lift);
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
      const mat = new LineMaterial({ color: 0xe8d9b5, linewidth: 1, transparent: true, opacity: 0.4 });
      const seg = new LineSegments2(geo, mat);
      seg.computeLineDistances();
      this.contourGroup.add(seg);
      this._lineMaterials.push(mat);
    }

    if (majorVerts.length) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(majorVerts);
      const mat = new LineMaterial({ color: 0xfff0c2, linewidth: 1.75, transparent: true, opacity: 0.75 });
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
      this._registerLabel(label);
      this.contourLabelGroup.add(label);
    }
    this.scene.add(this.contourLabelGroup);
    this._updateLineResolutions();
  }

  _cellToWorld(fi, fj, level, bbox, lift) {
    const lat = bbox.minLat + (bbox.maxLat - bbox.minLat) * fi / (FIELD_SIZE - 1);
    const lng = bbox.minLng + (bbox.maxLng - bbox.minLng) * fj / (FIELD_SIZE - 1);
    const p = this._latLngToLocal(lat, lng, level + (lift || 2), bbox);
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  // Marching squares over the fine height field for a single iso-level. Cells
  // touching a hole are skipped so no contour is drawn over missing data.
  _marchingSquares(field, level, bbox, lift) {
    const segments = [];
    const lerp = (a, b) => (level - a) / (b - a);

    for (let i = 0; i < FIELD_SIZE - 1; i++) {
      for (let j = 0; j < FIELD_SIZE - 1; j++) {
        const tl = field[i][j];
        const tr = field[i][j + 1];
        const br = field[i + 1][j + 1];
        const bl = field[i + 1][j];
        if (this._isHole(tl) || this._isHole(tr) || this._isHole(br) || this._isHole(bl)) continue;

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
            a: this._cellToWorld(ai, aj, level, bbox, lift),
            b: this._cellToWorld(bi, bj, level, bbox, lift),
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

  // World-space clearance for the draped track (and the hiker riding it). The
  // tube body has radius 6, so lifting the centreline by radius + a small
  // span-scaled margin seats the tube just above the terrain: the track hugs the
  // relief without z-fighting or piercing it, and the constant world-unit lift
  // stays glued at any vertical exaggeration (unlike a metric lift, which the
  // normalization scale would inflate into a visible float).
  _routeDrapeLift() {
    return 6 + Math.max(2, (this._worldSpan || 2000) * 0.001);
  }

  _createRoutePath(coords, elevations, bbox) {
    if (!coords || coords.length < 2) return;

    const hasGradient = !!(this._routeColors && this._routeColors.length === coords.length);
    const legacyColor = new THREE.Color(0x00d4ff);

    // The track is DRAPED onto the rendered terrain surface (grid-sampled), not
    // hung at the raw GPS elevation. The surface mesh is a smoothed 25×25 DEM, so
    // the GPS track diverges from it by tens of metres over ridges/valleys — that
    // mismatch is what left the old track visibly floating above (or sunk into)
    // the relief. Draping makes it hug whatever the viewer actually sees.
    const drapeLift = this._routeDrapeLift();

    // Build the smooth path in the HORIZONTAL plane first, then resolve every
    // point's height by draping. Centripetal Catmull-Rom never overshoots/loops
    // at sharp turns (switchbacks read as smooth curves, not cusps); the curve is
    // resampled at an even spacing dense enough that both the tube and the
    // overlay line follow the real bends instead of cutting corners between
    // sparsely-sampled GPS vertices. Sample count scales with the on-model
    // length, clamped.
    const horizPts = coords.map(([lat, lng]) => {
      const p = this._latLngToLocal(lat, lng, this._elevBase || 0, bbox);
      return new THREE.Vector3(p.x, 0, p.z);
    });
    const horizCurve = new THREE.CatmullRomCurve3(horizPts, false, 'centripetal');
    let curveLen = 0;
    try { curveLen = horizCurve.getLength(); } catch { curveLen = 0; }
    const targetSpacing = Math.max(6, (this._worldSpan || 2000) / 500);
    const segCount = Math.max(
      horizPts.length * 2,
      Math.min(4000, Math.round((curveLen || horizPts.length * targetSpacing) / targetSpacing))
    );

    // Re-drape EVERY resampled point (not just the GPS vertices) onto the surface
    // so the densified track follows the relief end to end and never dips through
    // it between sparse vertices. Over a terrain hole (missing DEM tile) carry the
    // last valid height so the track doesn't dive to the basin datum across the
    // data gap. Arc-length-even in the horizontal plane keeps the gradient
    // fraction ≈ distance fraction, so the colours still line up with the 2D route.
    let carrySurf = null;
    const sampled = horizCurve.getSpacedPoints(segCount).map((v) => {
      const { lat, lng } = this._localToLatLng(v.x, v.z, bbox);
      let surf = this._sampleGridElevation(lat, lng);
      if (this._isOverHole(lat, lng)) surf = (carrySurf != null ? carrySurf : surf);
      else carrySurf = surf;
      const base = this._latLngToLocal(lat, lng, surf, bbox);
      return new THREE.Vector3(base.x, base.y + drapeLift, base.z);
    });

    // Tube geometry gives the track a shaded 3D body. Gradient colours are applied
    // ring-by-ring so it reads like the 2D route line. Built from the draped
    // samples so the body hugs the surface too.
    const curve = new THREE.CatmullRomCurve3(sampled, false, 'centripetal');
    const tubularSegments = Math.max(1, sampled.length - 1);
    const radialSegments = 8;
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
    // Cache the tube's tubular/radial segment counts so the trail-reveal mode can
    // clamp the index draw-range to the traveled portion (Plan §II-1).
    this._routeTubeSegs = tubularSegments;
    this._routeTubeRadial = radialSegments;

    // Bright always-on overlay line carrying the same gradient. A wide (pixel
    // width) Line2 so the track stays clearly visible and thick at any zoom. It
    // follows the SAME resampled smooth curve as the tube, so the visible line no
    // longer cuts across corners at sparsely-sampled sharp turns.
    const positions = [];
    for (const v of sampled) positions.push(v.x, v.y, v.z);
    const lineGeo = new LineGeometry();
    lineGeo.setPositions(positions);
    if (hasGradient) {
      const lineColors = [];
      const denom = Math.max(1, sampled.length - 1);
      for (let i = 0; i < sampled.length; i++) {
        const col = this._routeColorAtFrac(i / denom);
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
    // Number of segment instances in the overlay line (one per gap between
    // resampled points) — the reveal mode limits instanceCount to this fraction.
    this._routeLineSegs = Math.max(1, sampled.length - 1);

    // Honour a persisted trail-reveal preference for the freshly built geometry.
    this._applyRouteReveal();
  }

  // Suspended-absolute mode (Plan §II-4): show the drop stems so the track reads
  // as floating at its true elevation above the terrain. Geometry is prebuilt, so
  // this just flips visibility — no rebuild.
  setAbsoluteElevation(on) {
    this._absoluteElevation = !!on;
    if (this._routeStemGroup) this._routeStemGroup.visible = this._absoluteElevation;
  }

  isAbsoluteElevation() {
    return this._absoluteElevation;
  }

  // Time-dynamic trail reveal (Plan §II-1): when on, the tube + overlay line only
  // draw up to the player's progress; when off, the whole track is shown.
  setRouteRevealMode(on) {
    this._routeReveal = !!on;
    // An explicit 揭示-off also cancels the automatic playback reveal, so the
    // toggle always restores the full track.
    if (!on) this._playbackReveal = false;
    this._applyRouteReveal();
  }

  isRouteRevealMode() {
    return this._routeReveal;
  }

  // Clamp the route geometry's drawn extent to the traveled fraction (reveal on)
  // or restore it in full (reveal off). Cheap — no geometry rebuild — so it can be
  // called every frame from _updatePlayerPosition.
  _applyRouteReveal() {
    // Automatic playback reveal only clamps the track while the walk is actually
    // running: pausing restores the full track (the reveal resumes on play). The
    // explicit 揭示 toggle (_routeReveal) stays reveal-as-walked regardless.
    const revealOn = this._routeReveal || (this._playbackReveal && this._playing);
    const tube = this.routeTube;
    const line = this.routeLine;
    if (tube && tube.geometry) {
      const idx = tube.geometry.index;
      if (idx) {
        if (!revealOn) {
          tube.geometry.setDrawRange(0, idx.count);
        } else {
          const segs = this._routeTubeSegs || 0;
          const radial = this._routeTubeRadial || 8;
          const shown = Math.max(1, Math.round(this._clampU(this._progress) * segs));
          tube.geometry.setDrawRange(0, Math.min(idx.count, shown * radial * 6));
        }
      }
    }
    if (line && line.geometry) {
      if (!revealOn) {
        line.geometry.instanceCount = Infinity;
      } else {
        const segs = this._routeLineSegs || 0;
        line.geometry.instanceCount = Math.max(1, Math.round(this._clampU(this._progress) * segs));
      }
    }
  }

  _createWaypoints(waypoints, bbox) {
    if (!waypoints || waypoints.length === 0) return;
    const ms = this._markerScale || 1;
    const stops = [];
    // Start/end aren't Relive pause-stops (playback's fly-in and finish-orbit
    // handle those beats), but playback still deals their cards — captured here.
    this._startDetail = null;
    this._endDetail = null;

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
        isReturn: !!wp.isReturn,
      };
      if (detail.isStart) this._startDetail = detail;
      if (detail.isEnd) this._endDetail = detail;

      // Return-leg waypoints ride the same ground point as their outbound twin, so
      // they deal a playback card/stop but plant no duplicate flag or signboard.
      if (!wp.isReturn) {
        const role = detail.isStart ? 'start' : (detail.isEnd ? 'end' : 'mid');
        const flag = this._buildWaypointFlag(colorCss, ms, role);
        flag.position.set(p.x, p.y, p.z);
        flag.userData.detail = detail;
        this.scene.add(flag);
        this.waypointMarkers.push(flag);
        this._pickables.push(flag);

        // Signboard billboard perched above the 3D waypoint structure. Click → detail.
        const sign = this._createBillboard(name, colorCss);
        const signH = 13 * ms;
        sign.scale.set(signH * (256 / 96), signH, 1);
        this._registerLabel(sign);
        sign.position.set(p.x, p.y + 12.2 * ms, p.z);
        sign.userData.detail = detail;
        this.scene.add(sign);
        this.waypointMarkers.push(sign);
        this._pickables.push(sign);
      }

      // Register a Relive stop at this waypoint's progress fraction. Skip the
      // trailhead and the finish (start/end cards are dealt by the fly-in and the
      // finish orbit) — the isEnd guard also stops a round-trip's return-to-start
      // from double-dealing if its u rounds just under 1.
      const total = this._totalDistM || 0;
      if (total > 0 && wp.distanceM != null && !detail.isStart && !detail.isEnd) {
        const u = wp.distanceM / total;
        if (u > 0.01 && u < 0.99) stops.push({ u, detail });
      }
    });

    stops.sort((a, b) => a.u - b.u);
    this._waypointStops = stops;
    this._nextStopIdx = 0;
    this._pauseUntil = 0;
  }

  // Stylized low-poly diorama 3D waypoint markers differentiated by role:
  //   • 'start' — Trailhead timber & stone welcome arch gate with pitched shingle
  //               rooflet, colour-keyed lintel plaque and glowing trail lantern
  //   • 'end'   — Two-tier granite summit/finish podium with golden bezel, tall
  //               flagstaff, golden star finial and 3D multi-wave victory banner
  //   • 'mid'   — Stacked stone cairn collar, timber/steel survey post with
  //               cross-arm brace and sculpted 3D waving trail pennant
  _buildWaypointFlag(colorCss, ms, role = 'mid') {
    const g = new THREE.Group();
    const add = (mesh, x = 0, y = 0, z = 0) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8b857c, roughness: 0.9, flatShading: true });
    const stoneDarkMat = new THREE.MeshStandardMaterial({ color: 0x625d56, roughness: 0.92, flatShading: true });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8c5830, roughness: 0.82, flatShading: true });
    const woodDarkMat = new THREE.MeshStandardMaterial({ color: 0x54331a, roughness: 0.86, flatShading: true });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xd8dee6, roughness: 0.4, metalness: 0.45 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffcf40, roughness: 0.32, metalness: 0.65,
      emissive: 0x996600, emissiveIntensity: 0.35, flatShading: true,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: colorCss, side: THREE.DoubleSide, roughness: 0.55,
      emissive: colorCss, emissiveIntensity: 0.24, flatShading: true,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xfff8eb, side: THREE.DoubleSide, roughness: 0.5,
      emissive: 0x332b20, emissiveIntensity: 0.15,
    });

    // Helper: build a 3D multi-segment waving banner extending from (0, topY, 0).
    const addWavingFlag = (topY, flagW, flagH, withTail = false) => {
      const segs = 3;
      const segW = flagW / segs;
      for (let s = 0; s < segs; s++) {
        const yaw = (s === 1 ? -0.22 : 0.18);
        const zOff = (s === 1 ? 0.28 : (s === 2 ? -0.08 : 0.1)) * ms;
        const panel = add(
          new THREE.Mesh(new THREE.BoxGeometry(segW * 1.04, flagH, 0.28 * ms), accentMat),
          (s + 0.5) * segW,
          topY - flagH / 2,
          zOff
        );
        panel.rotation.y = yaw;
      }
      // Top sleeve bar along the cross-arm/flaghead.
      add(
        new THREE.Mesh(new THREE.CylinderGeometry(0.18 * ms, 0.18 * ms, flagW * 1.02, 6), goldMat),
        flagW / 2,
        topY + 0.1 * ms,
        0
      ).rotation.z = Math.PI / 2;
      // Crisp horizontal emblem stripe across the middle of the banner.
      add(
        new THREE.Mesh(new THREE.BoxGeometry(flagW * 0.86, flagH * 0.22, 0.34 * ms), trimMat),
        flagW * 0.46,
        topY - flagH * 0.5,
        0.1 * ms
      );
      if (withTail) {
        const tail = add(
          new THREE.Mesh(new THREE.ConeGeometry(flagH * 0.45, 1.8 * ms, 4), goldMat),
          flagW + 0.7 * ms,
          topY - flagH * 0.5,
          0
        );
        tail.rotation.z = -Math.PI / 2;
      }
    };

    if (role === 'start') {
      // --- Trailhead Diorama Welcome Arch Gate (起點登山口拱門) ---
      const spanX = 3.6 * ms;
      const postH = 10.6 * ms;
      for (const sx of [-1, 1]) {
        // Stepped masonry foundation plinths.
        add(new THREE.Mesh(new THREE.CylinderGeometry(1.35 * ms, 1.65 * ms, 1.6 * ms, 6), stoneMat), sx * spanX, 0.8 * ms, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.95 * ms, 1.15 * ms, 0.7 * ms, 6), stoneDarkMat), sx * spanX, 1.85 * ms, 0);
        // Main timber pillar.
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.58 * ms, 0.68 * ms, postH, 8), woodMat), sx * spanX, 1.6 * ms + postH / 2, 0);
        // Upper diagonal brace corbel.
        const brace = add(new THREE.Mesh(new THREE.BoxGeometry(1.6 * ms, 0.48 * ms, 0.52 * ms), woodDarkMat), sx * (spanX - 0.9 * ms), postH - 0.2 * ms, 0);
        brace.rotation.z = sx * 0.55;
      }
      // Lower tie-beam & main upper lintel beam.
      const beamW = spanX * 2 + 2.8 * ms;
      add(new THREE.Mesh(new THREE.BoxGeometry(beamW * 0.92, 0.65 * ms, 0.75 * ms), woodDarkMat), 0, postH - 1.1 * ms, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(beamW, 0.95 * ms, 1.1 * ms), woodMat), 0, postH + 0.5 * ms, 0);
      // Pitched cedar-shingle gable rooflet capping the arch.
      const roofW = beamW + 1.8 * ms;
      for (const sx of [-1, 1]) {
        const slope = add(
          new THREE.Mesh(new THREE.BoxGeometry(roofW * 0.55, 0.45 * ms, 2.6 * ms), woodDarkMat),
          sx * roofW * 0.24,
          postH + 1.65 * ms,
          0
        );
        slope.rotation.z = -sx * 0.28;
      }
      // Ridge beam with golden end caps.
      add(new THREE.Mesh(new THREE.BoxGeometry(roofW * 0.96, 0.48 * ms, 0.55 * ms), goldMat), 0, postH + 2.35 * ms, 0);
      // Colour-keyed trailhead crest plaque mounted in the arch centre.
      add(new THREE.Mesh(new THREE.BoxGeometry(3.8 * ms, 1.7 * ms, 0.5 * ms), woodDarkMat), 0, postH + 0.3 * ms, 0.45 * ms);
      add(new THREE.Mesh(new THREE.BoxGeometry(3.2 * ms, 1.2 * ms, 0.56 * ms), accentMat), 0, postH + 0.3 * ms, 0.48 * ms);
      // Warm glowing trail lantern hanging inside the arch.
      const lanternX = spanX - 1.35 * ms;
      const lanternY = postH - 2.3 * ms;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.08 * ms, 0.08 * ms, 0.9 * ms, 6), woodDarkMat), lanternX, lanternY + 0.7 * ms, 0.3 * ms);
      const lanternMat = new THREE.MeshStandardMaterial({
        color: 0xffe49e, emissive: 0xffaa22, emissiveIntensity: 0.95, roughness: 0.3,
      });
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.45 * ms, 0.38 * ms, 0.85 * ms, 6), lanternMat), lanternX, lanternY, 0.3 * ms);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.65 * ms, 0.45 * ms, 6), woodDarkMat), lanternX, lanternY + 0.55 * ms, 0.3 * ms);
      return g;
    }

    if (role === 'end') {
      // --- Summit / Finish Victory Podium & Flag (終點榮耀旗座) ---
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.8 * ms, 3.3 * ms, 1.3 * ms, 8), stoneDarkMat), 0, 0.65 * ms, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.0 * ms, 2.4 * ms, 1.2 * ms, 8), stoneMat), 0, 1.9 * ms, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.55 * ms, 1.65 * ms, 0.45 * ms, 12), goldMat), 0, 2.7 * ms, 0);

      const poleH = 11.2 * ms;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.48 * ms, poleH, 10), metalMat), 0, 2.7 * ms + poleH / 2, 0);

      // Golden octahedron/star finial crowning the flagpole.
      const finialY = 2.7 * ms + poleH + 0.95 * ms;
      const star = add(new THREE.Mesh(new THREE.OctahedronGeometry(1.15 * ms, 0), goldMat), 0, finialY, 0);
      star.rotation.y = Math.PI / 4;

      // Sculpted 3D waving victory banner with golden swallowtail tip.
      addWavingFlag(2.7 * ms + poleH - 0.3 * ms, 6.2 * ms, 3.6 * ms, true);
      return g;
    }

    // --- Intermediate Waypoint Survey Beacon & Flagpost (中繼航點立體旗幟) ---
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.7 * ms, 2.3 * ms, 1.3 * ms, 7), stoneDarkMat), 0, 0.65 * ms, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.15 * ms, 1.55 * ms, 1.0 * ms, 7), stoneMat), 0, 1.75 * ms, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.68 * ms, 0.85 * ms, 0.7 * ms, 8), woodDarkMat), 0, 2.55 * ms, 0);

    const poleH = 10.2 * ms;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.42 * ms, poleH, 8), metalMat), 0, 2.5 * ms + poleH / 2, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.62 * ms, 10, 8), goldMat), 0, 2.5 * ms + poleH + 0.35 * ms, 0);

    addWavingFlag(2.5 * ms + poleH - 0.25 * ms, 5.2 * ms, 3.1 * ms, false);
    return g;
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

  // A diorama-framed signboard billboard (bevelled plaque with metallic rivets,
  // colour-keyed bezel and downward pointer pin) showing a waypoint name.
  _createBillboard(text, colorCss) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 96);

    ctx.font = 'bold 29px Inter, "Noto Sans TC", sans-serif';
    const tw = ctx.measureText(text).width;
    const bw = Math.min(244, Math.max(88, tw + 64));
    const bh = 54;
    const bx = (256 - bw) / 2;
    const by = 5;

    // Pin tail pointing down toward the 3D marker below.
    ctx.beginPath();
    ctx.moveTo(128 - 12, by + bh - 2);
    ctx.lineTo(128 + 12, by + bh - 2);
    ctx.lineTo(128, by + bh + 18);
    ctx.closePath();
    ctx.fillStyle = colorCss;
    ctx.fill();

    // Outer plaque body with subtle vertical gradient.
    this._roundRectPath(ctx, bx, by, bw, bh, 12);
    const grad = ctx.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, 'rgba(26, 30, 42, 0.95)');
    grad.addColorStop(1, 'rgba(12, 15, 22, 0.95)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = colorCss;
    ctx.stroke();

    // Inner diorama frame line.
    this._roundRectPath(ctx, bx + 4, by + 4, bw - 8, bh - 8, 8);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.stroke();

    // Corner rivet dots.
    ctx.fillStyle = 'rgba(255, 230, 170, 0.55)';
    for (const [rx, ry] of [
      [bx + 9, by + 9], [bx + bw - 9, by + 9],
      [bx + 9, by + bh - 9], [bx + bw - 9, by + bh - 9],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glowing colour badge + crisp white title.
    ctx.fillStyle = colorCss;
    ctx.beginPath();
    ctx.arc(bx + 20, by + bh / 2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 35, by + bh / 2 + 1, bw - 48);

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
    this._weatherIconEntries = [];
    // A rebuild disposes the old rigs before growing fresh ones for this build.
    if (this._weather3d) { this._weather3d.dispose(); this._weather3d = null; }
    if (!weatherPoints || weatherPoints.length === 0) return;

    this.weatherGroup = new THREE.Group();
    this.scene.add(this.weatherGroup);

    // World-space anchors for the volumetric 3D weather rigs, one per point.
    const rigPoints = [];

    const ms0 = this._markerScale || 1;
    weatherPoints.forEach((pt) => {
      if (!pt || !pt.coords) return;
      const [lat, lng] = pt.coords;
      // Sit the icon on the rendered terrain surface (sampled from the grid),
      // not at the supplied/sea-level elevation that left it floating below.
      const surfElev = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, surfElev + 18 * ms0, bbox);

      const icon = pt.weatherCode != null ? TerrainViewer.weatherIcon(pt.weatherCode) : '☀️';
      const cat = pt.weatherCode != null ? TerrainViewer.weatherCategory(pt.weatherCode) : 'clear';
      const temp = pt.temperature != null ? `${Math.round(pt.temperature)}°C` : '';

      // Each marker owns a canvas/texture so its icon can be repainted per frame
      // as a live weather animation when 天氣特效 is enabled.
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        sizeAttenuation: true,
      });
      const label = new THREE.Sprite(spriteMat);
      label.position.set(p.x, p.y, p.z);
      // Scale to the terrain so the labels are legible (the default fixed size is
      // invisible on real-scale terrain).
      const ms = this._markerScale || 1;
      label.scale.set(60 * ms, 20 * ms, 1);

      const entry = { sprite: label, canvas, ctx, texture, cat, icon, temp };
      // The badge is a static reference chip now — the animation is the 3D rig.
      this._paintWeatherLabel(entry);

      // Anchor the 3D weather rig on the terrain surface directly under the badge.
      const surf = this._latLngToLocal(lat, lng, surfElev, bbox);
      rigPoints.push({ pos: new THREE.Vector3(surf.x, surf.y, surf.z), cat });

      // Not registered with _registerLabel: the weather icon/temperature badge is
      // content gated by the 天氣／特效 toggles, not the 字體 (text label size)
      // control, so it must stay visible even when 字體 is set to 關 (none).
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
      this._weatherIconEntries.push(entry);
      this._pickables.push(label);
    });

    // Grow the volumetric 3D weather phenomena in world space at each point.
    this._weather3d = new WeatherFx3D(this.scene, { scale: ms0, worldSpan: this._worldSpan });
    this._weather3d.build(rigPoints);
    this._applyWeather3DVisibility();
  }

  // Paint one weather marker's canvas: a compact rounded badge with the emoji and
  // temperature. Drawn once on build — the moving weather is now the volumetric
  // 3D rig (WeatherFx3D), so the badge stays a static, legible reference chip.
  _paintWeatherLabel(entry) {
    const { ctx, canvas, icon, temp } = entry;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.font = 'bold 32px Inter, "Noto Sans TC", sans-serif';
    const tw = temp ? ctx.measureText(temp).width : 0;
    const glyphW = 44;            // reserved width for the icon/animation
    const gap = temp ? 10 : 0;
    const pad = 16;
    const bw = glyphW + gap + tw + pad * 2;
    const bh = 50;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;

    // Rounded badge background (matches _createLabel's styling).
    const r = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
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

    const gcx = bx + pad + glyphW / 2;
    const gcy = H / 2;
    ctx.fillStyle = '#ffffff';
    ctx.font = '30px Inter, "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, gcx, gcy);

    if (temp) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px Inter, "Noto Sans TC", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(temp, bx + pad + glyphW + gap, gcy);
    }

    entry.texture.needsUpdate = true;
  }

  // Rounded-rect path builder shared by the static and marquee label draws.
  static _labelRoundRectPath(ctx, x, y, w, h, r) {
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

  _createLabel(text, x, y, z, colorHex) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 80;

    const font = 'bold 32px Inter, "Noto Sans TC", sans-serif';
    ctx.font = font;
    const tw = ctx.measureText(text).width;

    const pad = 16;
    const bh = 50;
    // A name wider than the billboard scrolls (跑馬燈) inside a fixed-width box
    // instead of overflowing the canvas and getting clipped mid-glyph.
    const maxBoxW = canvas.width - 8;
    const isMarquee = tw + pad * 2 > maxBoxW;
    const bw = isMarquee ? maxBoxW : tw + pad * 2;
    const bx = (canvas.width - bw) / 2;
    const by = (canvas.height - bh) / 2;

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

    if (!isMarquee) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      TerrainViewer._labelRoundRectPath(ctx, bx, by, bw, bh, 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      return sprite;
    }

    // Pre-render the full name once onto a scroll strip [name][gap]; each frame
    // blits a shifted window from it, wrapping at `cycle` for a seamless loop —
    // far cheaper than re-shaping CJK text every frame.
    const gap = 64;
    const cycle = Math.ceil(tw + gap);
    const strip = document.createElement('canvas');
    strip.width = cycle;
    strip.height = bh;
    const sctx = strip.getContext('2d');
    sctx.font = font;
    sctx.fillStyle = '#ffffff';
    sctx.textAlign = 'left';
    sctx.textBaseline = 'middle';
    sctx.fillText(text, 0, bh / 2 + 1);

    sprite.userData.marquee = {
      ctx, canvas, texture, strip,
      bx, by, bw, bh, pad,
      inner: bw - pad * 2,
      cycle,
      offset: 0,
      speed: 46,   // px/sec in canvas space
    };
    this._marqueeLabels.push(sprite);
    this._drawMarqueeLabel(sprite.userData.marquee);
    return sprite;
  }

  // Advance every visible marquee label by `step` seconds and redraw it.
  _updateMarqueeLabels(step) {
    for (const sprite of this._marqueeLabels) {
      const m = sprite.userData.marquee;
      if (!m) continue;
      // Skip labels hidden by the label-size control ('none') or by a hidden
      // parent group (圖資 off) — no point redrawing a canvas nothing renders.
      if (!sprite.visible || (sprite.parent && !sprite.parent.visible)) continue;
      m.offset += m.speed * step;
      if (m.offset >= m.cycle) m.offset -= m.cycle;
      this._drawMarqueeLabel(m);
    }
  }

  _drawMarqueeLabel(m) {
    const { ctx, canvas, texture, strip, bx, by, bw, bh, pad, inner, cycle } = m;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    TerrainViewer._labelRoundRectPath(ctx, bx, by, bw, bh, 8);
    ctx.fill();

    const dstX = bx + pad;
    const srcX = Math.floor(m.offset);
    const first = Math.min(inner, cycle - srcX);
    ctx.drawImage(strip, srcX, 0, first, bh, dstX, by, first, bh);
    if (first < inner) {
      ctx.drawImage(strip, 0, 0, inner - first, bh, dstX + first, by, inner - first, bh);
    }

    // Fade the two scroll edges into the box so glyphs enter/leave softly.
    const fadeW = 18;
    let grad = ctx.createLinearGradient(dstX, 0, dstX + fadeW, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(dstX, by, fadeW, bh);
    grad = ctx.createLinearGradient(dstX + inner - fadeW, 0, dstX + inner, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(dstX + inner - fadeW, by, fadeW, bh);

    texture.needsUpdate = true;
  }

  // ---------- Map features (道路 / 河流 / 水體 / 綠地 / 荒地 / 建築) ----------

  // Classify an OSM element's tags into a render category, or null to ignore.
  // Returns { group:'line'|'area'|'building'|'structure', kind, cls, ... } where
  // kind drives the colour/label priority and cls the line/area/structure style.
  static _classifyFeature(tags) {
    if (!tags) return null;
    if (tags.building && tags.building !== 'no') return { group: 'building', kind: 'building', cls: 'building' };
    // building:part lets one complex landmark be modelled as several stacked/offset
    // blocks (Plan §III). Parsed alongside the parent footprint so towers on a
    // podium, wings and stepped massing render as distinct volumes.
    if (tags['building:part'] && tags['building:part'] !== 'no') return { group: 'building', kind: 'building', cls: 'part' };

    // 3D civil & natural structures (dams, piers, breakwaters, walls, cliffs).
    const ww = tags.waterway;
    if (ww === 'dam' || ww === 'weir') return { group: 'structure', kind: 'structure', cls: 'dam' };
    const mm = tags.man_made;
    if (mm === 'pier') return { group: 'structure', kind: 'structure', cls: 'pier' };
    if (/^(breakwater|groyne|embankment|dyke)$/.test(mm || '')) return { group: 'structure', kind: 'structure', cls: 'breakwater' };
    if (/^(city_wall|retaining_wall|wall)$/.test(tags.barrier || '') || tags.historic === 'citywalls') {
      return { group: 'structure', kind: 'structure', cls: 'wall' };
    }
    if (/^(cliff|ridge|arete)$/.test(tags.natural || '') && tags.area !== 'yes') {
      return { group: 'structure', kind: 'structure', cls: 'cliff' };
    }

    // Aerialway cable cars, gondolas, chairlifts & forestry zip-lines.
    const aw = tags.aerialway;
    if (aw && /^(cable_car|gondola|chair_lift|mixed_lift|drag_lift|zip_line|goods|rope_tow)$/.test(aw)) {
      return { group: 'line', kind: 'aerialway', cls: 'aerialway', sub: aw };
    }

    // Overhead high-voltage power transmission lines.
    if (/^(line|minor_line)$/.test(tags.power || '')) {
      return { group: 'line', kind: 'power', cls: 'power_line' };
    }

    // Railways (mainline, forest narrow-gauge, light rail, funicular, tram).
    const rw = tags.railway;
    if (rw && tags.area !== 'yes' && /^(rail|narrow_gauge|light_rail|subway|tram|monorail|funicular|preserved)$/.test(rw)) {
      const isBridge = !!(tags.bridge && tags.bridge !== 'no');
      const isTunnel = !!(tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'culvert');
      return {
        group: 'line', kind: 'rail', cls: 'railway',
        bridge: isBridge, bridgeType: isBridge ? String(tags.bridge) : null,
        tunnel: isTunnel,
      };
    }

    const hw = tags.highway;
    if (hw && tags.area !== 'yes') {
      const isBridge = !!(tags.bridge && tags.bridge !== 'no');
      const isTunnel = !!(tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'culvert');
      let cls = 'minor';
      if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(hw)) cls = 'major';
      else if (/^(residential|unclassified|service|living_street|road|pedestrian)$/.test(hw)) cls = 'minor';
      else if (/^(footway|path|track|cycleway|steps|bridleway)$/.test(hw)) {
        // A track/path tagged with 2+ lanes is a real paved rural road, not a
        // dirt trail — render it as such even where it crosses green/bare
        // terrain, instead of blending into the ground as a thin dirt line.
        const lanes = parseFloat(tags.lanes);
        cls = (Number.isFinite(lanes) && lanes >= 2) ? 'minor' : 'trail';
      }
      return {
        group: 'line', kind: 'road', cls,
        bridge: isBridge, bridgeType: isBridge ? String(tags.bridge) : null,
        tunnel: isTunnel,
      };
    }

    if (/^(runway|taxiway)$/.test(tags.aeroway || '')) {
      return { group: 'line', kind: 'road', cls: 'major' };
    }

    if (ww && !tags.tunnel) {
      if (/^(river|canal)$/.test(ww)) return { group: 'line', kind: 'water', cls: 'river' };
      if (/^(stream|ditch|drain|brook)$/.test(ww)) return { group: 'line', kind: 'water', cls: 'stream' };
    }

    // Sports courts, running tracks & swimming pools.
    if (tags.leisure === 'swimming_pool') {
      return { group: 'area', kind: 'sport', cls: 'pool' };
    }
    if (/^(pitch|track|stadium)$/.test(tags.leisure || '')) {
      return { group: 'area', kind: 'sport', cls: 'pitch', sport: tags.sport || tags.leisure };
    }

    // 濕地 (沼澤 marsh / 潮間帶 intertidal flats) — a water-domain cover kept
    // visually distinct from open water, classified before water/green so it wins.
    if (tags.natural === 'wetland' || tags.natural === 'mud' || tags.natural === 'saltmarsh'
      || tags.wetland || tags.tidal === 'yes' || tags.landuse === 'salt_pond') {
      return { group: 'area', kind: 'water', cls: 'wetland' };
    }
    if (tags.natural === 'water' || tags.water || tags.landuse === 'reservoir' || tags.landuse === 'basin') {
      return { group: 'area', kind: 'water', cls: 'water' };
    }
    if (tags.natural === 'wood' || tags.landuse === 'forest') return { group: 'area', kind: 'green', cls: 'forest' };
    if (/^(scrub|heath)$/.test(tags.natural || '') || /^(orchard|vineyard|tea)$/.test(tags.landuse || '')) {
      return { group: 'area', kind: 'green', cls: 'scrub' };
    }
    if (/^(grass|meadow|village_green|recreation_ground|farmland|farmyard|cemetery|allotments)$/.test(tags.landuse || '')
      || /^(grassland|fell)$/.test(tags.natural || '')
      || /^(park|garden|nature_reserve|golf_course|recreation_ground|common)$/.test(tags.leisure || '')) {
      return { group: 'area', kind: 'green', cls: 'grass' };
    }
    if (/^(bare_rock|scree|rock|cliff)$/.test(tags.natural || '') || tags.landuse === 'quarry') {
      return { group: 'area', kind: 'waste', cls: 'rock' };
    }
    if (/^(sand|shingle|beach)$/.test(tags.natural || '')) {
      return { group: 'area', kind: 'waste', cls: 'sand' };
    }
    if (/^(brownfield|greenfield|landfill|construction|industrial|railway)$/.test(tags.landuse || '')
      || tags.natural === 'mud') {
      return { group: 'area', kind: 'waste', cls: 'waste' };
    }
    // Built-up / urban land cover (matches the tinted urban blocks on the 2D map).
    if (/^(residential|commercial|retail|education|institutional|civic|garages)$/.test(tags.landuse || '')
      || tags.place === 'neighbourhood' || tags.place === 'quarter') {
      return { group: 'area', kind: 'urban', cls: 'urban' };
    }
    return null;
  }

  static _featureName(tags) {
    if (!tags) return null;
    return tags['name:zh'] || tags['name:zh-Hant'] || tags.name || tags['name:en'] || null;
  }

  // Classify an OSM point (node or landmark way centroid) into a 3D landmark
  // render category, or null to ignore (Plan §III-1). Drives which procedural
  // 3D model _buildMapFeatures spawns.
  static _classifyPoint(tags) {
    if (!tags) return null;
    const nat = tags.natural;
    if (nat === 'peak' || nat === 'volcano') return { cls: 'peak' };
    if (nat === 'saddle' || tags.mountain_pass === 'yes') return { cls: 'saddle' };
    if (tags.waterway === 'waterfall' || nat === 'waterfall') return { cls: 'waterfall' };
    if (/^(spring|hot_spring|geyser)$/.test(nat || '')
      || tags.amenity === 'public_bath'
      || /^(hot_spring|onsen)$/.test(tags['bath:type'] || '')) {
      return { cls: 'spring' };
    }
    if (/^(cave_entrance|arch|sinkhole)$/.test(nat || '')) return { cls: 'cave' };
    if (nat === 'stone' || nat === 'rock' || tags.historic === 'boundary_stone') return { cls: 'rock' };
    if (nat === 'tree') {
      const nm = TerrainViewer._featureName(tags) || '';
      if (tags.denotation === 'natural_monument' || tags.denotation === 'landmark'
        || tags.monument === 'yes' || tags.historic || /神木|巨木|夫妻樹|千年/.test(nm)) {
        return { cls: 'sacred_tree' };
      }
      return { cls: 'tree' };
    }

    const tour = tags.tourism;
    const amen = tags.amenity;
    const leis = tags.leisure;
    const bld = String(tags.building || '').toLowerCase();
    const hist = tags.historic;
    const mm = tags.man_made;

    // Mountain huts, wilderness cabins, trail shelters & traditional pavilions.
    if (/^(pavilion|kiosk)$/.test(bld) || leis === 'pavilion'
      || (amen === 'shelter' && /^(pavilion|gazebo|picnic_shelter|sun_shelter)$/.test(tags.shelter_type || ''))) {
      return { cls: 'pavilion' };
    }
    if (/^(alpine_hut|wilderness_hut|chalet)$/.test(tour || '')
      || amen === 'shelter'
      || /^(hut|cabin|shelter)$/.test(bld)) {
      return { cls: 'hut' };
    }

    // Campgrounds & expedition tent sites.
    if (/^(camp_site|caravan_site)$/.test(tour || '') || tags.campsite) {
      return { cls: 'camp_site' };
    }

    // Places of worship: Christian churches/chapels vs East Asian temples/shrines/torii.
    if ((amen === 'place_of_worship' && tags.religion === 'christian')
      || /^(church|cathedral|chapel)$/.test(bld)) {
      return { cls: 'church' };
    }
    if (amen === 'place_of_worship'
      || /^(temple|shrine|mosque|synagogue)$/.test(bld)
      || hist === 'wayside_shrine'
      || mm === 'torii') {
      return { cls: 'temple' };
    }

    // Energy, utilities & vertical towers.
    if ((tags.power === 'generator' && (/^(wind|wind_turbine)$/.test(tags['generator:source'] || tags['generator:method'] || '') || !tags['generator:source']))
      || /^(windmill|wind_pump)$/.test(mm || '')) {
      return { cls: 'wind_turbine' };
    }
    if (tags.power === 'tower' || tags.power === 'pole') {
      return { cls: 'power_tower' };
    }
    if (/^(water_tower|storage_tank|silo)$/.test(mm || '')) {
      return { cls: 'water_tower' };
    }
    if (/^(lighthouse|beacon)$/.test(mm || '') || /^(lighthouse|light_major)$/.test(tags['seamark:type'] || '')) {
      return { cls: 'lighthouse' };
    }
    if (/^(chimney|kiln)$/.test(mm || '')) {
      return { cls: 'chimney' };
    }
    if (mm && /^(tower|mast|communications_tower|observatory)$/.test(mm)) {
      return { cls: 'tower' };
    }

    // Historic castles/forts/bunkers vs obelisk monuments/memorials.
    if ((hist && /^(castle|fort|bunker|ruins|city_gate|cannon)$/.test(hist)) || tags.military === 'bunker') {
      return { cls: 'castle' };
    }
    if (hist && /^(monument|memorial|archaeological_site|milestone)$/.test(hist)) {
      return { cls: 'monument' };
    }

    // Viewpoints, trailheads/guideposts, stations, helipads, parking & picnic sites.
    if ((tour && /^(viewpoint|attraction|artwork)$/.test(tour)) || mm === 'cairn') {
      return { cls: 'viewpoint' };
    }
    if (tags.highway === 'trailhead'
      || /^(guidepost|board|map)$/.test(tags.information || '')
      || tour === 'information') {
      return { cls: 'trailhead' };
    }
    if (/^(station|halt|tram_stop|subway_entrance)$/.test(tags.railway || '')
      || tags.aerialway === 'station'
      || amen === 'bus_station'
      || tags.public_transport === 'station') {
      return { cls: 'station' };
    }
    if (/^(helipad|heliport)$/.test(tags.aeroway || '')) {
      return { cls: 'heliport' };
    }
    if (/^(parking|bicycle_parking|motorcycle_parking)$/.test(amen || '')
      || /^(rest_area|services)$/.test(tags.highway || '')) {
      return { cls: 'parking' };
    }
    if (tour === 'picnic_site'
      || /^(picnic_table|firepit)$/.test(leis || '')
      || /^(drinking_water|fountain|bench|bbq)$/.test(amen || '')) {
      return { cls: 'picnic' };
    }
    return null;
  }

  // Architectural style archetype for an extruded building footprint so temples,
  // churches, mountain huts and greenhouses get distinct diorama materials/roofs.
  static _buildingArch(tags) {
    if (!tags) return null;
    const bld = String(tags.building || tags['building:part'] || '').toLowerCase();
    if ((tags.amenity === 'place_of_worship' && tags.religion === 'christian')
      || /^(church|cathedral|chapel)$/.test(bld)) {
      return 'church';
    }
    if (tags.amenity === 'place_of_worship' || /^(temple|shrine)$/.test(bld)) {
      return 'temple';
    }
    if (/^(alpine_hut|wilderness_hut|chalet)$/.test(tags.tourism || '')
      || /^(hut|cabin|shelter|pavilion)$/.test(bld)) {
      return 'hut';
    }
    if (/^(greenhouse|glasshouse)$/.test(bld)) return 'greenhouse';
    if (/^(industrial|warehouse|manufacture|hangar)$/.test(bld)) return 'industrial';
    return null;
  }

  // Parse an OSM length that may carry a unit ("18", "18 m", "60'"). Returns a
  // value in metres, or NaN.
  static _parseLengthM(v) {
    if (v == null) return NaN;
    const s = String(v).trim();
    let m = /^([\d.]+)\s*(m|meter|metre|metres|meters)?$/i.exec(s);
    if (m) return parseFloat(m[1]);
    m = /^([\d.]+)\s*(ft|feet|foot|')$/i.exec(s);        // imperial fallback
    if (m) return parseFloat(m[1]) * 0.3048;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // Building height derivation hierarchy (Plan §III):
  //   1) explicit `height` / `building:height` (metres, unit-aware)
  //   2) `building:levels` (+ `roof:levels`) × 3 m per level
  //   3) a regional-statistical default keyed on the building/type tag, so an
  //      untagged footprint gets a plausible mass instead of a flat 6 m slab.
  static _buildingHeight(tags) {
    const h = TerrainViewer._parseLengthM(tags.height ?? tags['building:height']);
    if (Number.isFinite(h) && h > 0) return Math.max(2, h);

    const lv = parseFloat(tags['building:levels'] ?? tags.levels);
    if (Number.isFinite(lv) && lv > 0) {
      const roofLv = parseFloat(tags['roof:levels']);
      const levels = lv + (Number.isFinite(roofLv) ? roofLv : 0);
      return Math.max(2.5, levels * 3);       // Plan §III: 3 m / level
    }

    // Statistical fallback by building class (metres). Low houses stay low;
    // apartments/offices/landmarks rise. Keyed off the building=* value.
    const kind = String(tags.building || tags['building:part'] || 'yes').toLowerCase();
    const H = {
      house: 6, detached: 6, semidetached_house: 6, bungalow: 4, cabin: 4, hut: 3,
      terrace: 8, garage: 3, garages: 3, shed: 3, roof: 3, carport: 3, greenhouse: 4,
      apartments: 15, residential: 12, dormitory: 15, hotel: 18,
      commercial: 11, retail: 8, office: 20, supermarket: 9,
      industrial: 9, warehouse: 10, manufacture: 10,
      church: 14, cathedral: 22, chapel: 9, mosque: 14, temple: 12, shrine: 6,
      school: 9, university: 14, college: 14, hospital: 16, public: 11,
      civic: 12, government: 14, stadium: 24, train_station: 12,
    };
    return H[kind] ?? 7;
  }

  // Base offset of a building (or building:part) above the ground — lets a floor
  // that starts partway up (min_height) or a raised part float on a podium.
  static _buildingMinHeight(tags) {
    const mh = TerrainViewer._parseLengthM(tags.min_height ?? tags['building:min_height']);
    if (Number.isFinite(mh) && mh > 0) return mh;
    const ml = parseFloat(tags['building:min_level'] ?? tags.min_level);
    if (Number.isFinite(ml) && ml > 0) return ml * 3;
    return 0;
  }

  // Roof descriptor for pitched-roof modelling (Plan §III). Only tagged roofs
  // (`roof:shape`) get a 3D cap; untagged buildings stay flat-topped as before,
  // so the common case is unchanged and this only ever adds detail.
  static _roofInfo(tags) {
    const shape = (tags['roof:shape'] || '').toLowerCase();
    const pitched = /^(pyramidal|hipped|gabled|round|dome|conical|cone|mansard|half-hipped|gambrel|skillion)$/.test(shape);
    if (!pitched) return null;
    let h = TerrainViewer._parseLengthM(tags['roof:height']);
    const rl = parseFloat(tags['roof:levels']);
    if (!Number.isFinite(h) && Number.isFinite(rl) && rl > 0) h = rl * 2.5;
    const colour = TerrainViewer._parseHexColour(tags['roof:colour'] || tags['roof:color']);
    return { shape, height: Number.isFinite(h) && h > 0 ? h : null, colour };
  }

  // Roof surface triangles (Plan §III-4). Returns a flat [x,y,z,…] position array
  // capping a footprint's wall top (springY) with a pitched roof up to apexY,
  // specialised by roof shape:
  //   • gabled/gambrel → a ridge along the footprint's long axis (PCA), so the
  //     long sides slope up to the ridge and the ends form triangular gables.
  //   • skillion       → a single mono-pitch plane sloping along the long axis.
  //   • dome/round     → a two-tier faceted dome cap (steep lower ring + crown).
  //   • mansard/half-hipped → a steep lower curb ring + flatter upper hipped deck.
  //   • hipped / pyramidal / conical / (default) → a hip apex fan to a peak.
  static _roofPositions(shape, worldXZ, springY, apexY, cx, cz) {
    const n = worldXZ.length;
    const pos = [];
    const roofH = apexY - springY;

    const principalAxis = () => {
      let sxx = 0, szz = 0, sxz = 0;
      for (const [x, z] of worldXZ) { const dx = x - cx, dz = z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
      const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      return [Math.cos(theta), Math.sin(theta)];
    };
    const projRange = (dx, dz) => {
      let tMin = Infinity, tMax = -Infinity;
      for (const [x, z] of worldXZ) { const t = (x - cx) * dx + (z - cz) * dz; if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
      return [tMin, tMax];
    };

    if (shape === 'gabled' || shape === 'gambrel') {
      const [dx, dz] = principalAxis();
      const [tMin, tMax] = projRange(dx, dz);
      for (let i = 0; i < n; i++) {
        const [ax, az] = worldXZ[i];
        const [bx, bz] = worldXZ[(i + 1) % n];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        let t = (mx - cx) * dx + (mz - cz) * dz;
        t = Math.max(tMin, Math.min(tMax, t));
        pos.push(ax, springY, az, bx, springY, bz, cx + dx * t, apexY, cz + dz * t);
      }
      return pos;
    }

    if (shape === 'skillion') {
      const [dx, dz] = principalAxis();
      const [tMin, tMax] = projRange(dx, dz);
      const span = (tMax - tMin) || 1;
      const hAt = (x, z) => springY + (((x - cx) * dx + (z - cz) * dz) - tMin) / span * roofH;
      const cH = springY + roofH * 0.5;
      for (let i = 0; i < n; i++) {
        const [ax, az] = worldXZ[i];
        const [bx, bz] = worldXZ[(i + 1) % n];
        pos.push(ax, hAt(ax, az), az, bx, hAt(bx, bz), bz, cx, cH, cz);
      }
      return pos;
    }

    if (shape === 'dome' || shape === 'round' || shape === 'mansard' || shape === 'half-hipped') {
      const isDome = shape === 'dome' || shape === 'round';
      const inset = isDome ? 0.52 : 0.42;
      const midY = springY + roofH * (isDome ? 0.68 : 0.72);
      for (let i = 0; i < n; i++) {
        const [ax, az] = worldXZ[i];
        const [bx, bz] = worldXZ[(i + 1) % n];
        const aix = ax + (cx - ax) * inset, aiz = az + (cz - az) * inset;
        const bix = bx + (cx - bx) * inset, biz = bz + (cz - bz) * inset;
        // Lower sloped tier (quad split into 2 triangles).
        pos.push(ax, springY, az, bx, springY, bz, bix, midY, biz);
        pos.push(ax, springY, az, bix, midY, biz, aix, midY, aiz);
        // Upper crown fan to apex.
        pos.push(aix, midY, aiz, bix, midY, biz, cx, apexY, cz);
      }
      return pos;
    }

    // Hip / pyramidal / conical / default: apex fan to one peak.
    for (let i = 0; i < n; i++) {
      const [ax, az] = worldXZ[i];
      const [bx, bz] = worldXZ[(i + 1) % n];
      pos.push(ax, springY, az, bx, springY, bz, cx, apexY, cz);
    }
    return pos;
  }

  // Parse a CSS-style hex colour ("#a0522d") to a 0xRRGGBB int, or null.
  static _parseHexColour(v) {
    if (!v) return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v).trim());
    return m ? parseInt(m[1], 16) : null;
  }

  // Download vector map features inside the terrain bbox from Overpass. Returns a
  // compact, serialisable structure { lines, areas, buildings, structures, points }
  // so it can be cached. Parsed once here; rendering happens in _buildMapFeatures.
  async _fetchMapFeatures(bbox, onProgress) {
    const s = bbox.minLat.toFixed(5), w = bbox.minLng.toFixed(5);
    const n = bbox.maxLat.toFixed(5), e = bbox.maxLng.toFixed(5);
    const bb = `${s},${w},${n},${e}`;
    const q = `[out:json][timeout:30];(` +
      `way["highway"](${bb});` +
      `way["railway"~"rail|narrow_gauge|light_rail|subway|tram|monorail|funicular|preserved"](${bb});` +
      `way["aerialway"](${bb});` +
      `way["power"~"line|minor_line"](${bb});` +
      `way["waterway"](${bb});` +
      `way["man_made"~"bridge|pier|breakwater|groyne|embankment|dyke|tower|mast|communications_tower|water_tower|storage_tank|silo|lighthouse|chimney|windmill|wind_pump|torii"](${bb});` +
      `way["barrier"~"city_wall|retaining_wall|wall"](${bb});` +
      `way["historic"~"citywalls|castle|fort|bunker|ruins|city_gate|monument|memorial|archaeological_site|wayside_shrine"](${bb});` +
      `way["natural"~"water|wood|scrub|heath|grassland|wetland|mud|saltmarsh|bare_rock|scree|sand|shingle|cliff|ridge|arete"](${bb});` +
      `way["water"](${bb});` +
      `way["wetland"](${bb});` +
      `way["tidal"="yes"](${bb});` +
      `way["landuse"](${bb});` +
      `way["leisure"~"park|garden|nature_reserve|golf_course|pitch|track|stadium|swimming_pool|recreation_ground|common|pavilion|picnic_table"](${bb});` +
      `way["tourism"~"alpine_hut|wilderness_hut|chalet|camp_site|caravan_site|viewpoint|attraction|artwork|picnic_site|information"](${bb});` +
      `way["amenity"~"shelter|place_of_worship|parking|bus_station|drinking_water|fountain|public_bath"](${bb});` +
      `way["aeroway"~"helipad|heliport|runway|taxiway"](${bb});` +
      `way["building"](${bb});` +
      `way["building:part"](${bb});` +
      // Point landmarks (Plan §III-1): peaks, passes, waterfalls, springs, caves,
      // rocks, trees, huts, pavilions, campsites, temples, churches, wind turbines,
      // power pylons, water towers, towers, lighthouses, chimneys, castles,
      // monuments, viewpoints, trailheads, stations, helipads, parking & picnic areas.
      `node["natural"~"peak|volcano|saddle|tree|spring|hot_spring|geyser|cave_entrance|arch|stone|rock|waterfall"](${bb});` +
      `node["mountain_pass"="yes"](${bb});` +
      `node["waterway"="waterfall"](${bb});` +
      `node["man_made"~"tower|mast|communications_tower|water_tower|storage_tank|silo|lighthouse|beacon|chimney|windmill|wind_pump|torii|cairn|observatory"](${bb});` +
      `node["power"~"tower|pole|generator"](${bb});` +
      `node["tourism"~"viewpoint|attraction|artwork|alpine_hut|wilderness_hut|chalet|camp_site|caravan_site|picnic_site|information"](${bb});` +
      `node["amenity"~"shelter|place_of_worship|drinking_water|fountain|bench|parking|bus_station|public_bath"](${bb});` +
      `node["leisure"~"pavilion|picnic_table"](${bb});` +
      `node["historic"~"monument|memorial|castle|fort|bunker|ruins|city_gate|archaeological_site|wayside_shrine|boundary_stone"](${bb});` +
      `node["highway"="trailhead"](${bb});` +
      `node["information"~"guidepost|board|map"](${bb});` +
      `node["railway"~"station|halt|tram_stop|subway_entrance"](${bb});` +
      `node["aerialway"="station"](${bb});` +
      `node["aeroway"~"helipad|heliport"](${bb});` +
      `relation["natural"~"water|wetland|wood"](${bb});` +
      `relation["landuse"~"forest|reservoir|basin|grass|meadow|farmland|orchard"](${bb});` +
      `relation["leisure"~"park|nature_reserve|pitch|stadium|golf_course"](${bb});` +
      `);out geom 6000;`;

    onProgress?.(0.1);
    const encoded = encodeURIComponent(q);
    // Try each Overpass mirror in turn so one being rate-limited / down doesn't
    // blank the whole feature layer.
    let data = null;
    let lastErr = null;
    for (const api of OVERPASS_APIS) {
      if (this._aborted) throw new Error('aborted');
      try {
        // Per-mirror timeout kept modest so falling through several mirrors can't
        // stall the (blocking) feature download for too long.
        const resp = await this._fetchWithTimeout(`${api}?data=${encoded}`, this._abortController?.signal, 18000);
        if (!resp.ok) { lastErr = new Error(`Overpass ${resp.status}`); continue; }
        data = await resp.json();
        break;
      } catch (err) {
        if (this._aborted) throw err;
        lastErr = err;
      }
    }
    if (!data) throw lastErr || new Error('Overpass failed');
    onProgress?.(0.8);

    const lines = [];
    const areas = [];
    const buildings = [];
    const structures = [];
    const points = [];
    const ringFrom = (geom) => geom.filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon)).map((g) => [g.lat, g.lon]);

    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const name = TerrainViewer._featureName(tags);

      // Point landmarks (nodes) are classified separately — _classifyFeature only
      // handles line/area/building/structure ways, so nodes must be routed before it.
      if (el.type === 'node') {
        if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
        const pcat = TerrainViewer._classifyPoint(tags);
        if (pcat) {
          points.push({
            cls: pcat.cls, name, lat: el.lat, lon: el.lon,
            h: TerrainViewer._parseLengthM(tags.height ?? tags['building:height']),
          });
        }
        continue;
      }

      const cat = TerrainViewer._classifyFeature(tags);

      if (el.type === 'way' && Array.isArray(el.geometry)) {
        const pts = ringFrom(el.geometry);
        // Many OSM landmarks (camp_site, shelter, pavilion, water_tower, lighthouse,
        // castle, helipad, parking, picnic_site, alpine_hut, temple, station) are
        // mapped as closed polygon ways without (or instead of) a separate node.
        // Spawn a 3D point landmark at the way's centroid when it isn't already a
        // standard extruded building, or when it's a specialised non-building landmark.
        const pcat = TerrainViewer._classifyPoint(tags);
        if (pcat && pts.length >= 3 && (!cat || (cat.group !== 'building' && cat.group !== 'line' && cat.group !== 'structure'))) {
          let cla = 0, clo = 0;
          for (const [la, lo] of pts) { cla += la; clo += lo; }
          cla /= pts.length; clo /= pts.length;
          points.push({
            cls: pcat.cls, name, lat: cla, lon: clo,
            h: TerrainViewer._parseLengthM(tags.height ?? tags['building:height']),
          });
        }

        if (!cat) continue;
        if (cat.group === 'line') {
          if (pts.length >= 2) {
            lines.push({
              kind: cat.kind, cls: cat.cls, sub: cat.sub || null, name, pts,
              bridge: !!cat.bridge, bridgeType: cat.bridgeType || null,
              tunnel: !!cat.tunnel,
            });
          }
        } else if (cat.group === 'structure') {
          if (pts.length >= 2) {
            structures.push({
              cls: cat.cls, name, pts,
              h: TerrainViewer._parseLengthM(tags.height),
            });
          }
        } else if (cat.group === 'building') {
          if (pts.length >= 4) buildings.push({
            name, ring: pts,
            h: TerrainViewer._buildingHeight(tags),
            minH: TerrainViewer._buildingMinHeight(tags),
            roof: TerrainViewer._roofInfo(tags),
            arch: TerrainViewer._buildingArch(tags),
            wallColor: TerrainViewer._parseHexColour(tags['building:colour'] || tags['building:color']),
            part: cat.cls === 'part',
          });
        } else {
          if (pts.length >= 4) areas.push({ kind: cat.kind, cls: cat.cls, sport: cat.sport || null, name, rings: [pts] });
        }
      } else if (el.type === 'relation' && Array.isArray(el.members) && cat && cat.group === 'area') {
        const outers = [];
        const inners = [];
        for (const m of el.members) {
          if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
          const r = ringFrom(m.geometry);
          if (r.length >= 4) (m.role === 'inner' ? inners : outers).push(r);
        }
        for (const outer of outers) areas.push({ kind: cat.kind, cls: cat.cls, sport: cat.sport || null, name, rings: [outer, ...inners] });
      }
    }

    onProgress?.(1);
    return { lines, areas, buildings, structures, points };
  }

  // --- Clip vector features to the terrain bbox -------------------------------
  // Overpass returns the full geometry of any way/relation that merely touches
  // the query box, so features routinely extend far past the downloaded area.
  // Draping those out-of-bounds vertices samples clamped edge elevations, so
  // they sprawl beyond the terrain mesh and badly distort the scene. Clipping
  // every line/ring to the bbox keeps the rendered features inside the model and
  // makes their footprint match the 2D map. Coordinates are [lat, lng]; the box
  // is lat∈[minLat,maxLat], lng∈[minLng,maxLng].

  // Liang–Barsky clip of one segment a→b. Returns the clipped endpoints plus
  // whether each end was cut (so a polyline can be split into runs at the
  // boundary), or null when the segment lies entirely outside the box.
  _clipSegmentToBbox(a, b, bbox) {
    const x0 = a[1], y0 = a[0];
    const dx = b[1] - a[1], dy = b[0] - a[0];
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - bbox.minLng, bbox.maxLng - x0, y0 - bbox.minLat, bbox.maxLat - y0];
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) return null; // parallel to this edge and on its outside
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
    }
    return {
      a2: [a[0] + dy * t0, a[1] + dx * t0],
      b2: [a[0] + dy * t1, a[1] + dx * t1],
      enter: t0 > 0,
      exit: t1 < 1,
    };
  }

  // Clip a polyline to the bbox, returning an array of in-bounds sub-polylines
  // (a line can leave and re-enter the rectangle).
  _clipPolylineToBbox(pts, bbox) {
    const runs = [];
    let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = this._clipSegmentToBbox(pts[i], pts[i + 1], bbox);
      if (!seg) { if (cur && cur.length >= 2) runs.push(cur); cur = null; continue; }
      if (!cur || seg.enter) {
        if (cur && cur.length >= 2) runs.push(cur);
        cur = [seg.a2, seg.b2];
      } else {
        cur.push(seg.b2);
      }
      if (seg.exit) { if (cur.length >= 2) runs.push(cur); cur = null; }
    }
    if (cur && cur.length >= 2) runs.push(cur);
    return runs;
  }

  // Sutherland–Hodgman clip of a polygon ring (open, list of [lat,lng]) against
  // the bbox rectangle. Returns the clipped ring (possibly empty).
  _clipRingToBbox(ring, bbox) {
    if (!ring || ring.length < 3) return [];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const clip = (poly, inside, cross) => {
      if (!poly.length) return poly;
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const cur = poly[i];
        const prev = poly[(i + poly.length - 1) % poly.length];
        const curIn = inside(cur), prevIn = inside(prev);
        if (curIn) {
          if (!prevIn) out.push(cross(prev, cur));
          out.push(cur);
        } else if (prevIn) {
          out.push(cross(prev, cur));
        }
      }
      return out;
    };
    let p = ring;
    p = clip(p, (q) => q[1] >= bbox.minLng, (a, b) => lerp(a, b, (bbox.minLng - a[1]) / (b[1] - a[1])));
    p = clip(p, (q) => q[1] <= bbox.maxLng, (a, b) => lerp(a, b, (bbox.maxLng - a[1]) / (b[1] - a[1])));
    p = clip(p, (q) => q[0] >= bbox.minLat, (a, b) => lerp(a, b, (bbox.minLat - a[0]) / (b[0] - a[0])));
    p = clip(p, (q) => q[0] <= bbox.maxLat, (a, b) => lerp(a, b, (bbox.maxLat - a[0]) / (b[0] - a[0])));
    return p;
  }

  // Category label for a landmark node that carries no OSM name, so unnamed
  // peaks/towers/viewpoints still get an on-model name in 3D. Peaks/saddles add
  // the terrain-sampled elevation so nearby summits stay distinguishable.
  _fallbackLandmarkName(cls, lat, lon) {
    if (cls === 'peak' || cls === 'saddle') {
      const base = cls === 'peak' ? '山峰' : '鞍部';
      const e = typeof this._sampleGridElevation === 'function' ? this._sampleGridElevation(lat, lon) : null;
      return Number.isFinite(e) ? `${base} ${Math.round(e)} m` : base;
    }
    const names = {
      sacred_tree: '神木',
      hut: '山屋',
      pavilion: '涼亭',
      camp_site: '營地',
      temple: '廟宇',
      church: '教堂',
      wind_turbine: '風力發電',
      power_tower: '電塔',
      water_tower: '水塔',
      tower: '高塔',
      lighthouse: '燈塔',
      chimney: '煙囪',
      waterfall: '瀑布',
      spring: '湧泉',
      cave: '岩洞',
      rock: '奇岩',
      castle: '古蹟砲台',
      viewpoint: '觀景點',
      monument: '紀念地標',
      trailhead: '登山口指標',
      station: '車站',
      heliport: '停機坪',
      parking: '停車場',
      picnic: '休憩區',
    };
    return names[cls] || null;
  }

  // Build a stylized low-poly diorama 3D model for an OSM point landmark:
  //   • tree / sacred_tree — Conifer pine, broadleaf, or ancient giant cypress (神木)
  //   • peak / saddle      — Summit cairn + trig pillar + flag / pass twin cairns + signpost
  //   • hut / pavilion     — Alpine mountain cabin with solar roof / hexagonal pagoda pavilion
  //   • camp_site          — Geodesic dome & A-frame tents + glowing stone-ring campfire
  //   • temple / church    — East Asian swallowtail-roof temple + incense / spire church
  //   • wind_turbine       — Tapered tower + nacelle + 3 spinning aerodynamic rotor blades
  //   • power_tower        — Steel lattice high-voltage transmission pylon + insulators
  //   • water_tower        — Elevated spherical/cylindrical water tank on braced legs
  //   • tower / lighthouse / chimney — Telecom truss tower / coastal lighthouse / smokestack
  //   • waterfall / spring / cave / rock — Cascading cliff waterfall / steaming spring / cave / crag
  //   • castle / monument  — Battlemented stone fortress & watchtower / obelisk monument
  //   • viewpoint / trailhead / station / heliport / parking / picnic
  _buildPointModel(cls, ms, realH, lat = 0, lon = 0) {
    const g = new THREE.Group();
    const add = (mesh, x = 0, y = 0, z = 0) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const seed = Math.abs(Math.sin(lat * 127.1 + lon * 311.7) * 43758.5453) % 1;

    if (cls === 'sacred_tree') {
      // --- Ancient Giant Red-Cypress Sacred Tree (千年神木／巨木) ---
      const barkMat = new THREE.MeshStandardMaterial({ color: 0x7a4424, roughness: 0.88, flatShading: true });
      const rootMat = new THREE.MeshStandardMaterial({ color: 0x5c3218, roughness: 0.92, flatShading: true });
      const ropeMat = new THREE.MeshStandardMaterial({ color: 0xf5ecd8, roughness: 0.6, emissive: 0x3a2e18, emissiveIntensity: 0.2 });
      const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8f5b32, roughness: 0.84, flatShading: true });
      const trunkH = 9.5 * ms;
      // Massive gnarled buttress roots.
      add(new THREE.Mesh(new THREE.ConeGeometry(3.2 * ms, 2.6 * ms, 8), rootMat), 0, 1.3 * ms, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.45 * ms, 2.25 * ms, trunkH, 8), barkMat), 0, trunkH / 2, 0);
      // Sacred shimenawa rope collar & white paper shide tabs around the trunk.
      const rope = add(new THREE.Mesh(new THREE.TorusGeometry(1.82 * ms, 0.28 * ms, 6, 14), ropeMat), 0, 3.6 * ms, 0);
      rope.rotation.x = Math.PI / 2;
      // Gnarled ancient side boughs.
      for (const sx of [-1, 1]) {
        const bough = add(new THREE.Mesh(new THREE.CylinderGeometry(0.55 * ms, 0.85 * ms, 4.2 * ms, 6), barkMat), sx * 1.8 * ms, trunkH - 1.4 * ms, 0);
        bough.rotation.z = -sx * 0.65;
      }
      // Multi-tiered ancient cypress crown domes.
      const crownCols = [0x1f5420, 0x296828, 0x357c32, 0x438e3d];
      const lobes = [
        { x: 0, y: trunkH + 3.6 * ms, z: 0, s: 4.8 * ms, c: crownCols[0] },
        { x: -2.8 * ms, y: trunkH + 1.8 * ms, z: 1.1 * ms, s: 3.6 * ms, c: crownCols[1] },
        { x: 2.7 * ms, y: trunkH + 2.1 * ms, z: -0.9 * ms, s: 3.7 * ms, c: crownCols[2] },
        { x: 0.3 * ms, y: trunkH + 2.4 * ms, z: -2.4 * ms, s: 3.3 * ms, c: crownCols[3] },
        { x: -0.4 * ms, y: trunkH + 5.2 * ms, z: 0.4 * ms, s: 3.4 * ms, c: crownCols[2] },
      ];
      for (const lb of lobes) {
        const mat = new THREE.MeshStandardMaterial({ color: lb.c, roughness: 0.84, flatShading: true });
        const cr = add(new THREE.Mesh(new THREE.DodecahedronGeometry(lb.s, 0), mat), lb.x, lb.y, lb.z);
        cr.scale.set(1.18, 0.78, 1.12);
        cr.rotation.y = seed * 3 + lb.x;
      }
      // Low timber protective rail ring at base.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.2 * ms, 0.22 * ms, 1.4 * ms, 6), fenceMat), Math.cos(a) * 3.8 * ms, 0.7 * ms, Math.sin(a) * 3.8 * ms);
      }
      return g;
    }

    if (cls === 'tree') {
      const barkMat = new THREE.MeshStandardMaterial({ color: 0x6b4728, roughness: 0.9, flatShading: true });
      const rootMat = new THREE.MeshStandardMaterial({ color: 0x56381e, roughness: 0.92, flatShading: true });
      if (seed < 0.58) {
        // --- Alpine Conifer / Pine (針葉樹) ---
        const trunkH = 4.6 * ms;
        add(new THREE.Mesh(new THREE.ConeGeometry(1.55 * ms, 1.4 * ms, 6), rootMat), 0, 0.7 * ms, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.62 * ms, 1.05 * ms, trunkH, 7), barkMat), 0, trunkH / 2, 0);
        const tierColors = [0x2a5e24, 0x35722d, 0x418536, 0x529b42];
        const tiers = [
          { r: 4.3 * ms, h: 4.5 * ms, y: trunkH + 1.1 * ms },
          { r: 3.5 * ms, h: 4.0 * ms, y: trunkH + 3.4 * ms },
          { r: 2.6 * ms, h: 3.5 * ms, y: trunkH + 5.5 * ms },
          { r: 1.65 * ms, h: 2.8 * ms, y: trunkH + 7.4 * ms },
        ];
        tiers.forEach((t, idx) => {
          const mat = new THREE.MeshStandardMaterial({ color: tierColors[idx], roughness: 0.84, flatShading: true });
          const cone = add(new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 7), mat), 0, t.y, 0);
          cone.rotation.y = idx * 0.45 + seed * 3;
        });
      } else {
        // --- Lush Broadleaf / Deciduous Tree (闊葉樹) ---
        const trunkH = 5.2 * ms;
        add(new THREE.Mesh(new THREE.ConeGeometry(1.6 * ms, 1.3 * ms, 6), rootMat), 0, 0.65 * ms, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.7 * ms, 1.15 * ms, trunkH, 7), barkMat), 0, trunkH / 2, 0);
        for (const sx of [-1, 1]) {
          const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35 * ms, 0.55 * ms, 2.8 * ms, 6), barkMat), sx * 0.9 * ms, trunkH - 0.2 * ms, 0);
          b.rotation.z = -sx * 0.52;
        }
        const crownCols = [0x38762d, 0x488c38, 0x589e44, 0x2f6626];
        const lobes = [
          { x: 0, y: trunkH + 3.8 * ms, z: 0, s: 3.4 * ms, c: crownCols[0] },
          { x: -1.9 * ms, y: trunkH + 2.4 * ms, z: 0.8 * ms, s: 2.5 * ms, c: crownCols[1] },
          { x: 1.8 * ms, y: trunkH + 2.6 * ms, z: -0.7 * ms, s: 2.6 * ms, c: crownCols[2] },
          { x: 0.2 * ms, y: trunkH + 2.2 * ms, z: -1.7 * ms, s: 2.3 * ms, c: crownCols[3] },
        ];
        for (const lb of lobes) {
          const mat = new THREE.MeshStandardMaterial({ color: lb.c, roughness: 0.85, flatShading: true });
          const cr = add(new THREE.Mesh(new THREE.DodecahedronGeometry(lb.s, 0), mat), lb.x, lb.y, lb.z);
          cr.scale.set(1.12, 0.88, 1.05);
          cr.rotation.set(seed * 2, lb.x, 0);
        }
      }
      return g;
    }

    if (cls === 'peak') {
      // --- Diorama Summit Cairn (瑪尼堆) + Triangulation Pillar (三角點基石) ---
      const rockCols = [0x756e67, 0x8a8279, 0x999188, 0xaba39a, 0xbdb5ac];
      const cairnLayers = [
        { rx: 3.8 * ms, ry: 1.5 * ms, y: 0.75 * ms, ox: 0, oz: 0 },
        { rx: 3.0 * ms, ry: 1.35 * ms, y: 2.0 * ms, ox: 0.18 * ms, oz: -0.12 * ms },
        { rx: 2.3 * ms, ry: 1.2 * ms, y: 3.1 * ms, ox: -0.15 * ms, oz: 0.14 * ms },
        { rx: 1.65 * ms, ry: 1.05 * ms, y: 4.05 * ms, ox: 0.1 * ms, oz: 0.08 * ms },
        { rx: 1.1 * ms, ry: 0.9 * ms, y: 4.85 * ms, ox: 0, oz: 0 },
      ];
      cairnLayers.forEach((st, idx) => {
        const mat = new THREE.MeshStandardMaterial({ color: rockCols[idx], roughness: 0.92, flatShading: true });
        const stone = add(new THREE.Mesh(new THREE.DodecahedronGeometry(st.rx, 0), mat), st.ox, st.y, st.oz);
        stone.scale.set(1.0, st.ry / st.rx, 0.92);
        stone.rotation.y = idx * 1.1;
      });

      // Squared granite triangulation pillar (三角點基石) beside the cairn.
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c7, roughness: 0.82, flatShading: true });
      const pillarBaseMat = new THREE.MeshStandardMaterial({ color: 0x5c5751, roughness: 0.9, flatShading: true });
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xc93434, emissive: 0x3a0808, emissiveIntensity: 0.25 });
      const px = -3.4 * ms, pz = 1.6 * ms;
      add(new THREE.Mesh(new THREE.BoxGeometry(1.9 * ms, 0.8 * ms, 1.9 * ms), pillarBaseMat), px, 0.4 * ms, pz);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.35 * ms, 2.5 * ms, 1.35 * ms), pillarMat), px, 2.05 * ms, pz);
      // Engraved "+" survey cross on top of the pillar.
      add(new THREE.Mesh(new THREE.BoxGeometry(0.95 * ms, 0.14 * ms, 0.22 * ms), crossMat), px, 3.35 * ms, pz);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.22 * ms, 0.14 * ms, 0.95 * ms), crossMat), px, 3.35 * ms, pz);

      // Red-and-white banded survey staff + waving crimson summit pennant.
      const baseTop = 5.3 * ms;
      const segH = 1.6 * ms;
      const redMat = new THREE.MeshStandardMaterial({ color: 0xe03a3a, roughness: 0.5, emissive: 0x380808, emissiveIntensity: 0.25 });
      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.45 });
      for (let b = 0; b < 4; b++) {
        add(
          new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.36 * ms, segH, 8), (b % 2 === 0) ? redMat : whiteMat),
          0, baseTop + (b + 0.5) * segH, 0
        );
      }
      const staffTop = baseTop + 4 * segH;
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xffcf40, roughness: 0.35, metalness: 0.6, emissive: 0x664400, emissiveIntensity: 0.3 });
      add(new THREE.Mesh(new THREE.SphereGeometry(0.55 * ms, 8, 6), goldMat), 0, staffTop + 0.3 * ms, 0);

      const flagMat = new THREE.MeshStandardMaterial({
        color: 0xe63939, emissive: 0x420808, emissiveIntensity: 0.3, side: THREE.DoubleSide, flatShading: true,
      });
      const flag = add(new THREE.Mesh(new THREE.ConeGeometry(1.85 * ms, 4.2 * ms, 4), flagMat), 2.1 * ms, staffTop - 1.3 * ms, 0);
      flag.rotation.z = -Math.PI / 2;
      return g;
    }

    if (cls === 'saddle') {
      // --- Mountain Pass Twin Cairns & Timber Directional Signpost (鞍部埡口) ---
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x867e75, roughness: 0.92, flatShading: true });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x8f5b32, roughness: 0.82, flatShading: true });
      const woodLight = new THREE.MeshStandardMaterial({ color: 0xc99b68, roughness: 0.78, flatShading: true });
      for (const sx of [-1, 1]) {
        const c1 = add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.9 * ms, 0), stoneMat), sx * 2.4 * ms, 0.85 * ms, 0);
        c1.scale.set(1.1, 0.55, 1.0);
        const c2 = add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.3 * ms, 0), stoneMat), sx * 2.3 * ms, 1.85 * ms, 0);
        c2.scale.set(1.0, 0.6, 0.95);
      }
      const postH = 7.8 * ms;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.45 * ms, 0.55 * ms, postH, 7), woodMat), 0, postH / 2, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.75 * ms, 0.7 * ms, 7), woodMat), 0, postH + 0.35 * ms, 0);
      // Twin directional arrow boards angled across the saddle pass.
      const b1 = add(new THREE.Mesh(new THREE.BoxGeometry(3.8 * ms, 1.15 * ms, 0.38 * ms), woodLight), 1.6 * ms, postH - 1.1 * ms, 0);
      b1.rotation.y = 0.25;
      const b2 = add(new THREE.Mesh(new THREE.BoxGeometry(3.5 * ms, 1.1 * ms, 0.38 * ms), woodLight), -1.5 * ms, postH - 2.4 * ms, 0);
      b2.rotation.y = -0.35;
      return g;
    }

    if (cls === 'hut') {
      // --- Alpine Mountain Hut / Wilderness Cabin (高山山屋／避難小屋) ---
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7a756e, roughness: 0.92, flatShading: true });
      const logMat = new THREE.MeshStandardMaterial({ color: 0x9c6638, roughness: 0.82, flatShading: true });
      const trimMat = new THREE.MeshStandardMaterial({ color: 0x59371b, roughness: 0.86, flatShading: true });
      const roofMat = new THREE.MeshStandardMaterial({
        color: seed < 0.5 ? 0x2b689c : 0xb83c32, roughness: 0.55, metalness: 0.25, flatShading: true,
      });
      const solarMat = new THREE.MeshStandardMaterial({ color: 0x1c355e, roughness: 0.25, metalness: 0.6, emissive: 0x09152b, emissiveIntensity: 0.25 });
      const winMat = new THREE.MeshStandardMaterial({ color: 0xffe596, emissive: 0xffaa2b, emissiveIntensity: 0.9, roughness: 0.3 });
      const tankMat = new THREE.MeshStandardMaterial({ color: 0xd0d7de, roughness: 0.35, metalness: 0.65 });

      // Raised stone foundation + front timber porch deck.
      add(new THREE.Mesh(new THREE.BoxGeometry(7.2 * ms, 1.2 * ms, 5.8 * ms), stoneMat), 0, 0.6 * ms, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(6.2 * ms, 3.4 * ms, 4.4 * ms), logMat), 0, 2.9 * ms, -0.3 * ms);
      // Gable pitched roof (2 sloped roof planes + ridge beam).
      for (const sx of [-1, 1]) {
        const rSlope = add(new THREE.Mesh(new THREE.BoxGeometry(4.2 * ms, 0.45 * ms, 5.4 * ms), roofMat), sx * 1.75 * ms, 5.45 * ms, -0.3 * ms);
        rSlope.rotation.z = -sx * 0.52;
      }
      // Rooftop solar panel array on the right slope.
      const solar = add(new THREE.Mesh(new THREE.BoxGeometry(2.6 * ms, 0.18 * ms, 3.2 * ms), solarMat), 1.65 * ms, 5.75 * ms, -0.2 * ms);
      solar.rotation.z = -0.52;
      // Doorway + glowing warm cabin windows.
      add(new THREE.Mesh(new THREE.BoxGeometry(1.3 * ms, 2.2 * ms, 0.25 * ms), trimMat), 0, 2.3 * ms, 1.92 * ms);
      for (const sx of [-1, 1]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(1.15 * ms, 1.05 * ms, 0.25 * ms), winMat), sx * 1.95 * ms, 2.9 * ms, 1.92 * ms);
      }
      // Side stainless rainwater harvesting tank.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.95 * ms, 0.95 * ms, 2.4 * ms, 10), tankMat), -3.9 * ms, 1.8 * ms, -0.6 * ms);
      return g;
    }

    if (cls === 'pavilion') {
      // --- Traditional Hexagonal Trail Pavilion / Gazebo (山林涼亭) ---
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x969086, roughness: 0.9, flatShading: true });
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0xb3392b, roughness: 0.65, flatShading: true });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c6b4f, roughness: 0.6, flatShading: true });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xffcf40, roughness: 0.35, metalness: 0.6, emissive: 0x664400, emissiveIntensity: 0.3 });

      add(new THREE.Mesh(new THREE.CylinderGeometry(3.8 * ms, 4.3 * ms, 1.1 * ms, 6), stoneMat), 0, 0.55 * ms, 0);
      const colH = 3.8 * ms;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.28 * ms, 0.32 * ms, colH, 6), pillarMat), Math.cos(a) * 3.1 * ms, 1.1 * ms + colH / 2, Math.sin(a) * 3.1 * ms);
      }
      // Two-tiered hexagonal pagoda roof with upturned eaves.
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.8 * ms, 4.8 * ms, 1.6 * ms, 6), roofMat), 0, 1.1 * ms + colH + 0.7 * ms, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(3.2 * ms, 1.9 * ms, 6), roofMat), 0, 1.1 * ms + colH + 2.2 * ms, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.48 * ms, 8, 6), goldMat), 0, 1.1 * ms + colH + 3.3 * ms, 0);
      return g;
    }

    if (cls === 'camp_site') {
      // --- Expedition Campground: Geodesic Dome Tent + A-Frame Tent + Campfire (露營區) ---
      const padMat = new THREE.MeshStandardMaterial({ color: 0x997048, roughness: 0.88, flatShading: true });
      const tentOrange = new THREE.MeshStandardMaterial({ color: 0xf28c28, roughness: 0.62, emissive: 0x4a2205, emissiveIntensity: 0.25, flatShading: true });
      const tentGreen = new THREE.MeshStandardMaterial({ color: 0x4b8b3b, roughness: 0.68, flatShading: true });
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.8, flatShading: true });
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x78726a, roughness: 0.92, flatShading: true });
      const fireMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff4500, emissiveIntensity: 1.1, roughness: 0.2, flatShading: true });
      const flameTipMat = new THREE.MeshStandardMaterial({ color: 0xffe042, emissive: 0xffbb00, emissiveIntensity: 1.1 });

      // Timber camp deck pad.
      add(new THREE.Mesh(new THREE.CylinderGeometry(5.2 * ms, 5.5 * ms, 0.55 * ms, 8), padMat), 0, 0.28 * ms, 0);
      // Main geodesic dome tent (left-back).
      const dome = add(new THREE.Mesh(new THREE.SphereGeometry(2.55 * ms, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), tentOrange), -1.6 * ms, 0.5 * ms, -0.8 * ms);
      dome.scale.set(1.15, 0.95, 1.0);
      const vest = add(new THREE.Mesh(new THREE.ConeGeometry(1.35 * ms, 1.8 * ms, 4), doorMat), -0.9 * ms, 1.2 * ms, 1.1 * ms);
      vest.rotation.y = Math.PI / 4;
      // Secondary green A-frame pup tent (right-back).
      const pup = add(new THREE.Mesh(new THREE.CylinderGeometry(1.4 * ms, 1.4 * ms, 3.0 * ms, 3), tentGreen), 2.2 * ms, 1.2 * ms, -0.7 * ms);
      pup.rotation.z = Math.PI / 2;
      pup.rotation.y = -0.35;
      // Stone-ring campfire in the foreground (+z).
      const fx = 0.6 * ms, fz = 2.4 * ms;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.42 * ms, 0), stoneMat), fx + Math.cos(a) * 1.1 * ms, 0.65 * ms, fz + Math.sin(a) * 1.1 * ms);
      }
      add(new THREE.Mesh(new THREE.ConeGeometry(0.85 * ms, 1.9 * ms, 6), fireMat), fx, 1.45 * ms, fz);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.48 * ms, 1.3 * ms, 5), flameTipMat), fx, 2.1 * ms, fz);
      return g;
    }

    if (cls === 'temple') {
      // --- East Asian Temple / Shrine with Swallowtail Roof, Torii & Incense Cauldron (廟宇／神社) ---
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a8, roughness: 0.86, flatShading: true });
      const redMat = new THREE.MeshStandardMaterial({ color: 0xc43628, roughness: 0.58, flatShading: true });
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2e6d0, roughness: 0.75, flatShading: true });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xd98a26, roughness: 0.48, metalness: 0.2, flatShading: true });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd240, roughness: 0.3, metalness: 0.65, emissive: 0x664400, emissiveIntensity: 0.35 });
      const bronzeMat = new THREE.MeshStandardMaterial({ color: 0x8c6d3b, roughness: 0.45, metalness: 0.55 });

      // Stepped stone foundation terrace.
      add(new THREE.Mesh(new THREE.BoxGeometry(7.6 * ms, 1.2 * ms, 6.4 * ms), stoneMat), 0, 0.6 * ms, -0.4 * ms);
      // Main sanctuary hall + vermilion corner pillars.
      add(new THREE.Mesh(new THREE.BoxGeometry(5.6 * ms, 3.4 * ms, 4.2 * ms), wallMat), 0, 2.9 * ms, -0.6 * ms);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.36 * ms, 3.6 * ms, 8), redMat), sx * 2.85 * ms, 3.0 * ms, -0.6 * ms + sz * 2.1 * ms);
        }
      }
      // Double-tiered hipped palace roof + swallowtail ridge beam (燕尾脊).
      const r1 = add(new THREE.Mesh(new THREE.ConeGeometry(4.9 * ms, 1.8 * ms, 4), roofMat), 0, 5.3 * ms, -0.6 * ms);
      r1.rotation.y = Math.PI / 4;
      r1.scale.set(1.15, 1.0, 0.92);
      const r2 = add(new THREE.Mesh(new THREE.ConeGeometry(3.6 * ms, 1.7 * ms, 4), roofMat), 0, 6.7 * ms, -0.6 * ms);
      r2.rotation.y = Math.PI / 4;
      r2.scale.set(1.15, 1.0, 0.92);
      add(new THREE.Mesh(new THREE.BoxGeometry(5.2 * ms, 0.45 * ms, 0.45 * ms), goldMat), 0, 7.55 * ms, -0.6 * ms);
      for (const sx of [-1, 1]) {
        const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.45 * ms, 1.3 * ms, 4), goldMat), sx * 2.7 * ms, 7.95 * ms, -0.6 * ms);
        tail.rotation.z = -sx * 0.45;
      }
      // Forecourt bronze incense burner (香爐) + entrance torii/archway.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.75 * ms, 0.6 * ms, 1.2 * ms, 8), bronzeMat), 0, 1.8 * ms, 1.8 * ms);
      for (const sx of [-1, 1]) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.24 * ms, 0.28 * ms, 3.4 * ms, 6), redMat), sx * 1.8 * ms, 2.4 * ms, 3.1 * ms);
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(4.6 * ms, 0.38 * ms, 0.45 * ms), redMat), 0, 4.15 * ms, 3.1 * ms);
      return g;
    }

    if (cls === 'church') {
      // --- Christian Church / Chapel with Bell Tower Spire & Cross (教堂) ---
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xeae3d5, roughness: 0.78, flatShading: true });
      const plinthMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9, flatShading: true });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x45586e, roughness: 0.65, flatShading: true });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd240, roughness: 0.3, metalness: 0.7, emissive: 0x664400, emissiveIntensity: 0.35 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x7cc4ff, emissive: 0x3b82f6, emissiveIntensity: 0.65, roughness: 0.25 });

      add(new THREE.Mesh(new THREE.BoxGeometry(5.4 * ms, 1.0 * ms, 7.2 * ms), plinthMat), 0, 0.5 * ms, 0);
      // Main nave body + pitched roof.
      add(new THREE.Mesh(new THREE.BoxGeometry(4.6 * ms, 3.8 * ms, 6.2 * ms), wallMat), 0, 2.9 * ms, -0.3 * ms);
      const naveRoof = add(new THREE.Mesh(new THREE.CylinderGeometry(2.7 * ms, 2.7 * ms, 6.5 * ms, 3), roofMat), 0, 5.6 * ms, -0.3 * ms);
      naveRoof.rotation.x = Math.PI / 2;
      // Front bell tower + tall pointed spire + rose window.
      const tz = 2.2 * ms;
      add(new THREE.Mesh(new THREE.BoxGeometry(2.6 * ms, 7.2 * ms, 2.6 * ms), wallMat), 0, 4.6 * ms, tz);
      const spire = add(new THREE.Mesh(new THREE.ConeGeometry(1.95 * ms, 4.6 * ms, 4), roofMat), 0, 10.5 * ms, tz);
      spire.rotation.y = Math.PI / 4;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.65 * ms, 0.65 * ms, 0.25 * ms, 12), glassMat), 0, 5.2 * ms, tz + 1.32 * ms).rotation.x = Math.PI / 2;
      // Golden cross finial at the apex of the spire.
      add(new THREE.Mesh(new THREE.BoxGeometry(0.24 * ms, 1.8 * ms, 0.24 * ms), goldMat), 0, 13.4 * ms, tz);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.15 * ms, 0.24 * ms, 0.24 * ms), goldMat), 0, 13.6 * ms, tz);
      return g;
    }

    if (cls === 'wind_turbine') {
      // --- 3-Blade Wind Turbine Generator with Live Spinning Rotor (風力發電機) ---
      const h = Math.max(16 * ms, Math.min(Number.isFinite(realH) && realH > 0 ? realH * ms * 0.28 : 21 * ms, 32 * ms));
      const padMat = new THREE.MeshStandardMaterial({ color: 0x949088, roughness: 0.9, flatShading: true });
      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.38, metalness: 0.18 });
      const redMat = new THREE.MeshStandardMaterial({ color: 0xe63939, emissive: 0xff2222, emissiveIntensity: 0.85 });

      add(new THREE.Mesh(new THREE.CylinderGeometry(2.2 * ms, 2.8 * ms, 1.0 * ms, 10), padMat), 0, 0.5 * ms, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.48 * ms, 1.15 * ms, h, 12), whiteMat), 0, 1.0 * ms + h / 2, 0);
      // Nacelle housing + aviation warning beacon at the tower top.
      const topY = 1.0 * ms + h;
      add(new THREE.Mesh(new THREE.BoxGeometry(1.4 * ms, 1.4 * ms, 3.2 * ms), whiteMat), 0, topY, 0.2 * ms);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.36 * ms, 8, 6), redMat), 0, topY + 0.9 * ms, -0.6 * ms);

      // Rotor hub + 3 aerodynamic blades (registered for per-frame rotation).
      const rotor = new THREE.Group();
      rotor.position.set(0, topY, 1.9 * ms);
      rotor.rotation.z = seed * Math.PI * 2;
      const hub = new THREE.Mesh(new THREE.ConeGeometry(0.72 * ms, 1.5 * ms, 10), whiteMat);
      hub.rotation.x = Math.PI / 2;
      hub.castShadow = true;
      rotor.add(hub);
      const bladeLen = h * 0.46;
      for (let b = 0; b < 3; b++) {
        const bPivot = new THREE.Group();
        bPivot.rotation.z = (b / 3) * Math.PI * 2;
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.48 * ms, bladeLen, 5), whiteMat);
        blade.scale.set(0.65, 1.0, 0.22);
        blade.position.y = bladeLen / 2 + 0.35 * ms;
        blade.castShadow = true;
        bPivot.add(blade);
        rotor.add(bPivot);
      }
      g.add(rotor);
      this._windTurbineRotors.push(rotor);
      return g;
    }

    if (cls === 'power_tower') {
      // --- High-Voltage Steel Lattice Transmission Pylon (高壓輸電鐵塔) ---
      const h = Math.max(13 * ms, Math.min(Number.isFinite(realH) && realH > 0 ? realH * ms * 0.28 : 16.5 * ms, 26 * ms));
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x8e99a6, roughness: 0.5, metalness: 0.45, flatShading: true });
      const darkSteel = new THREE.MeshStandardMaterial({ color: 0x5c6673, roughness: 0.55, metalness: 0.45, flatShading: true });
      const insMat = new THREE.MeshStandardMaterial({ color: 0x4aa3b8, roughness: 0.35, metalness: 0.2 });

      // 4 concrete footing pads.
      const legSpan = 2.2 * ms;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          add(new THREE.Mesh(new THREE.BoxGeometry(0.9 * ms, 0.8 * ms, 0.9 * ms), darkSteel), sx * legSpan, 0.4 * ms, sz * legSpan);
        }
      }
      // Tapered 4-sided lattice mast body.
      const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.75 * ms, legSpan * 1.25, h, 4), steelMat), 0, 0.6 * ms + h / 2, 0);
      mast.rotation.y = Math.PI / 4;
      // 3 tiers of wide horizontal cross-arms + hanging ceramic insulator strings.
      const armTiers = [
        { y: h * 0.56, w: 7.4 * ms },
        { y: h * 0.76, w: 6.2 * ms },
        { y: h * 0.94, w: 4.8 * ms },
      ];
      for (const tier of armTiers) {
        add(new THREE.Mesh(new THREE.BoxGeometry(tier.w, 0.42 * ms, 0.65 * ms), darkSteel), 0, tier.y, 0);
        for (const sx of [-1, 1]) {
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.22 * ms, 0.22 * ms, 1.35 * ms, 6), insMat), sx * (tier.w * 0.47), tier.y - 0.8 * ms, 0);
        }
      }
      add(new THREE.Mesh(new THREE.ConeGeometry(0.85 * ms, 1.8 * ms, 4), steelMat), 0, h + 1.2 * ms, 0).rotation.y = Math.PI / 4;
      return g;
    }

    if (cls === 'water_tower') {
      // --- Elevated Spherical/Cylindrical Water Tower on Braced Legs (水塔／儲槽) ---
      const h = Math.max(11 * ms, Math.min(Number.isFinite(realH) && realH > 0 ? realH * ms * 0.3 : 14.5 * ms, 24 * ms));
      const padMat = new THREE.MeshStandardMaterial({ color: 0x8d8880, roughness: 0.9, flatShading: true });
      const legMat = new THREE.MeshStandardMaterial({ color: 0x6c7682, roughness: 0.55, metalness: 0.4 });
      const tankMat = new THREE.MeshStandardMaterial({ color: 0xd8e8f2, roughness: 0.42, metalness: 0.25, flatShading: true });
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x2f7ab8, roughness: 0.48, metalness: 0.2 });

      add(new THREE.Mesh(new THREE.CylinderGeometry(3.2 * ms, 3.6 * ms, 0.9 * ms, 10), padMat), 0, 0.45 * ms, 0);
      const legH = h * 0.58;
      // Central riser pipe + 6 perimeter support columns + horizontal brace ring.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.58 * ms, 0.68 * ms, legH, 8), legMat), 0, 0.8 * ms + legH / 2, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.24 * ms, 0.28 * ms, legH, 6), legMat), Math.cos(a) * 2.2 * ms, 0.8 * ms + legH / 2, Math.sin(a) * 2.2 * ms);
      }
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.35 * ms, 2.35 * ms, 0.32 * ms, 12), legMat), 0, 0.8 * ms + legH * 0.55, 0);
      // Elevated tank drum + blue accent stripe + conical roof cap.
      const tankY = 0.8 * ms + legH;
      const tankH = h * 0.36;
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.85 * ms, 2.65 * ms, tankH, 12), tankMat), 0, tankY + tankH / 2, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.92 * ms, 2.92 * ms, tankH * 0.26, 12), bandMat), 0, tankY + tankH * 0.52, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(3.05 * ms, 1.8 * ms, 12), bandMat), 0, tankY + tankH + 0.9 * ms, 0);
      return g;
    }

    if (cls === 'tower') {
      // --- Steel Lattice / Truss Communications & Observation Tower (高塔／電塔) ---
      const h = Math.max(13 * ms, Math.min(Number.isFinite(realH) && realH > 0 ? realH * ms * 0.3 : 17 * ms, 30 * ms));
      const concreteMat = new THREE.MeshStandardMaterial({ color: 0x99958e, roughness: 0.9, flatShading: true });
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x8c96a3, roughness: 0.55, metalness: 0.35, flatShading: true });
      const steelDark = new THREE.MeshStandardMaterial({ color: 0x59626e, roughness: 0.6, metalness: 0.4, flatShading: true });
      const dishMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.4, metalness: 0.25 });
      const redBeaconMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2222, emissiveIntensity: 0.95 });

      // Concrete foundation pad.
      add(new THREE.Mesh(new THREE.BoxGeometry(5.6 * ms, 1.2 * ms, 5.6 * ms), concreteMat), 0, 0.6 * ms, 0);
      // 3 tapered lattice-style frustum tiers with structural collar beams.
      const bodyH = h * 0.72;
      const tierH = bodyH / 3;
      const radii = [2.4 * ms, 1.85 * ms, 1.38 * ms, 1.0 * ms];
      for (let t = 0; t < 3; t++) {
        const y0 = 1.2 * ms + t * tierH;
        const frustum = add(
          new THREE.Mesh(new THREE.CylinderGeometry(radii[t + 1], radii[t], tierH, 4), steelMat),
          0, y0 + tierH / 2, 0
        );
        frustum.rotation.y = Math.PI / 4;
        const collar = add(
          new THREE.Mesh(new THREE.BoxGeometry(radii[t + 1] * 2.2, 0.42 * ms, radii[t + 1] * 2.2), steelDark),
          0, y0 + tierH, 0
        );
        collar.rotation.y = Math.PI / 4;
      }
      // Cantilevered observation / microwave gallery deck.
      const deckY = 1.2 * ms + bodyH;
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.2 * ms, 1.8 * ms, 0.9 * ms, 8), steelDark), 0, deckY + 0.45 * ms, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.35 * ms, 1.35 * ms, 1.6 * ms, 8), steelMat), 0, deckY + 1.6 * ms, 0);
      // Side microwave dish drums.
      for (const sx of [-1, 1]) {
        const dish = add(new THREE.Mesh(new THREE.CylinderGeometry(0.95 * ms, 0.6 * ms, 0.55 * ms, 10), dishMat), sx * 1.95 * ms, deckY + 1.5 * ms, 0);
        dish.rotation.z = sx * Math.PI / 2;
      }
      // Upper red/white aviation mast + glowing red warning beacon.
      const mastH = h * 0.26;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.22 * ms, 0.42 * ms, mastH, 8), dishMat), 0, deckY + 2.4 * ms + mastH / 2, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.65 * ms, 10, 8), redBeaconMat), 0, deckY + 2.4 * ms + mastH + 0.35 * ms, 0);
      return g;
    }

    if (cls === 'lighthouse') {
      // --- Coastal Diorama Lighthouse & Keeper's Cottage (海岸燈塔) ---
      const h = Math.max(14 * ms, Math.min(Number.isFinite(realH) && realH > 0 ? realH * ms * 0.32 : 18 * ms, 30 * ms));
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x706c66, roughness: 0.92, flatShading: true });
      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.65, flatShading: true });
      const redMat = new THREE.MeshStandardMaterial({ color: 0xd43737, roughness: 0.62, flatShading: true });
      const ironMat = new THREE.MeshStandardMaterial({ color: 0x2c323b, roughness: 0.55, metalness: 0.4 });
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff5b8, emissive: 0xffc83b, emissiveIntensity: 1.05, roughness: 0.2 });

      // Octagonal coastal bastion base.
      const baseH = 2.0 * ms;
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.8 * ms, 3.4 * ms, baseH, 8), rockMat), 0, baseH / 2, 0);

      // Small keeper's cottage annex nestled against the base.
      add(new THREE.Mesh(new THREE.BoxGeometry(3.2 * ms, 2.2 * ms, 2.6 * ms), whiteMat), 2.6 * ms, baseH + 1.0 * ms, 0);
      const roof = add(new THREE.Mesh(new THREE.ConeGeometry(2.4 * ms, 1.5 * ms, 4), redMat), 2.6 * ms, baseH + 2.85 * ms, 0);
      roof.rotation.y = Math.PI / 4;

      // 4-band alternating white/red tapered lighthouse shaft.
      const shaftH = h - baseH - 3.2 * ms;
      const bandH = shaftH / 4;
      for (let b = 0; b < 4; b++) {
        const rBot = (2.35 - b * 0.22) * ms;
        const rTop = (2.35 - (b + 1) * 0.22) * ms;
        add(
          new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, bandH, 12), (b % 2 === 0) ? whiteMat : redMat),
          0, baseH + (b + 0.5) * bandH, 0
        );
      }
      const galleryY = baseH + shaftH;
      // Corbelled dark-iron gallery deck + lantern room + cupola dome.
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.05 * ms, 1.5 * ms, 0.75 * ms, 12), ironMat), 0, galleryY + 0.35 * ms, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.35 * ms, 1.35 * ms, 1.8 * ms, 12), lampMat), 0, galleryY + 1.6 * ms, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(1.7 * ms, 1.6 * ms, 12), redMat), 0, galleryY + 3.2 * ms, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.35 * ms, 8, 6), ironMat), 0, galleryY + 4.1 * ms, 0);
      return g;
    }

    if (cls === 'chimney') {
      // --- Industrial Brick Smokestack with Iron Bands & Steam Puffs (煙囪) ---
      const h = Math.max(13 * ms, Math.min(Number.isFinite(realH) && realH > 0 ? realH * ms * 0.3 : 16 * ms, 28 * ms));
      const brickMat = new THREE.MeshStandardMaterial({ color: 0xa8523b, roughness: 0.88, flatShading: true });
      const brickDark = new THREE.MeshStandardMaterial({ color: 0x753828, roughness: 0.9, flatShading: true });
      const ironMat = new THREE.MeshStandardMaterial({ color: 0x363a40, roughness: 0.6, metalness: 0.4 });
      const smokeMat = new THREE.MeshStandardMaterial({
        color: 0xe6ebf0, emissive: 0x3a4048, emissiveIntensity: 0.22,
        roughness: 0.95, transparent: true, opacity: 0.78, flatShading: true,
      });

      const plinthH = 2.4 * ms;
      add(new THREE.Mesh(new THREE.BoxGeometry(4.2 * ms, plinthH, 4.2 * ms), brickDark), 0, plinthH / 2, 0);
      const stackH = h - plinthH;
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.25 * ms, 2.0 * ms, stackH, 10), brickMat), 0, plinthH + stackH / 2, 0);
      // Iron tension rings & corbelled crown rim.
      for (const frac of [0.35, 0.68, 0.94]) {
        const r = (2.0 - frac * 0.72) * ms;
        add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.35 * ms, 10), ironMat), 0, plinthH + stackH * frac, 0);
      }
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.52 * ms, 1.32 * ms, 0.7 * ms, 10), brickDark), 0, h - 0.1 * ms, 0);
      // Rising low-poly steam puffs.
      const puffs = [
        { x: 0.3 * ms, y: h + 1.4 * ms, z: 0, s: 1.15 * ms },
        { x: 1.1 * ms, y: h + 3.0 * ms, z: 0.4 * ms, s: 1.55 * ms },
        { x: 2.2 * ms, y: h + 4.8 * ms, z: -0.3 * ms, s: 1.95 * ms },
      ];
      for (const pf of puffs) {
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(pf.s, 0), smokeMat), pf.x, pf.y, pf.z);
      }
      return g;
    }

    if (cls === 'waterfall') {
      // --- Cascading Mountain Cliff Waterfall & Plunge Pool (瀑布) ---
      const cliffMat = new THREE.MeshStandardMaterial({ color: 0x5c5750, roughness: 0.92, flatShading: true });
      const cliffLight = new THREE.MeshStandardMaterial({ color: 0x78726a, roughness: 0.9, flatShading: true });
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x45c4ff, emissive: 0x12669e, emissiveIntensity: 0.45, roughness: 0.2, metalness: 0.15, flatShading: true,
      });
      const foamMat = new THREE.MeshStandardMaterial({
        color: 0xf2fbff, emissive: 0x8ad8ff, emissiveIntensity: 0.55, roughness: 0.4, transparent: true, opacity: 0.88, flatShading: true,
      });

      // Stepped craggy cliff rock formation behind the cascade.
      for (const [x, y, z, rx, ry, rz, m] of [
        [-2.2, 4.2, -1.2, 2.2, 4.2, 1.8, cliffMat],
        [2.2, 4.0, -1.1, 2.1, 4.0, 1.8, cliffMat],
        [0, 5.2, -1.6, 2.6, 5.2, 1.6, cliffLight],
        [-3.2, 1.8, 0.2, 1.8, 1.8, 1.6, cliffLight],
        [3.1, 1.7, 0.3, 1.7, 1.7, 1.6, cliffLight],
      ]) {
        const r = add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.0 * ms, 0), m), x * ms, y * ms, z * ms);
        r.scale.set(rx, ry, rz);
      }
      // Upper & lower cascading water ribbons + white foam crest.
      const fall1 = add(new THREE.Mesh(new THREE.BoxGeometry(2.6 * ms, 5.2 * ms, 0.65 * ms), waterMat), 0, 5.8 * ms, -0.3 * ms);
      fall1.rotation.x = 0.18;
      const fall2 = add(new THREE.Mesh(new THREE.BoxGeometry(3.1 * ms, 4.4 * ms, 0.7 * ms), foamMat), 0, 2.6 * ms, 0.45 * ms);
      fall2.rotation.x = 0.26;
      // Turquoise plunge pool at the base + billowing mist puffs.
      add(new THREE.Mesh(new THREE.CylinderGeometry(3.8 * ms, 4.2 * ms, 0.55 * ms, 12), waterMat), 0, 0.28 * ms, 1.4 * ms);
      for (const [mx, my, mz, msR] of [[-1.1, 1.1, 1.4, 1.1], [0.9, 1.2, 1.5, 1.2], [0, 0.9, 2.2, 0.95]]) {
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(msR * ms, 0), foamMat), mx * ms, my * ms, mz * ms);
      }
      return g;
    }

    if (cls === 'spring') {
      // --- Steaming Natural Rock Hot Spring / Mountain Spring Pool (溫泉／湧泉) ---
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d766d, roughness: 0.9, flatShading: true });
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x38d6c4, emissive: 0x0f7a6e, emissiveIntensity: 0.45, roughness: 0.18, metalness: 0.1,
      });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0xa67446, roughness: 0.8, flatShading: true });
      const steamMat = new THREE.MeshStandardMaterial({
        color: 0xf4f9fc, emissive: 0x6b8294, emissiveIntensity: 0.25, transparent: true, opacity: 0.72, flatShading: true,
      });

      // Glowing mineral-turquoise spring basin.
      add(new THREE.Mesh(new THREE.CylinderGeometry(3.4 * ms, 3.8 * ms, 0.65 * ms, 12), waterMat), 0, 0.35 * ms, 0);
      // Ring of natural river boulders around the pool rim.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = 3.45 * ms;
        const b = add(new THREE.Mesh(new THREE.DodecahedronGeometry((0.85 + (i % 3) * 0.22) * ms, 0), rockMat), Math.cos(a) * r, 0.65 * ms, Math.sin(a) * r);
        b.scale.set(1.15, 0.72, 1.05);
      }
      // Bamboo/timber spring spout at the back + rising steam puffs.
      const spout = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.35 * ms, 2.6 * ms, 8), woodMat), 0, 1.8 * ms, -2.8 * ms);
      spout.rotation.x = 1.05;
      for (const [sx, sy, sz, sr] of [[-0.6, 2.4, -0.3, 0.95], [0.8, 3.8, 0.4, 1.25], [-0.2, 5.3, 0.1, 1.5]]) {
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(sr * ms, 0), steamMat), sx * ms, sy * ms, sz * ms);
      }
      return g;
    }

    if (cls === 'cave') {
      // --- Rugged Limestone Cave Archway & Stalactites (岩洞／石門洞穴) ---
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e685f, roughness: 0.92, flatShading: true });
      const rockLight = new THREE.MeshStandardMaterial({ color: 0x8c857b, roughness: 0.88, flatShading: true });
      const darkVoid = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.98 });

      // Recessed dark cavern mouth + arched rock portal pillars & crown.
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.6 * ms, 3.0 * ms, 3.8 * ms, 8), darkVoid), 0, 1.9 * ms, -0.4 * ms);
      for (const sx of [-1, 1]) {
        const pil = add(new THREE.Mesh(new THREE.DodecahedronGeometry(2.4 * ms, 0), rockMat), sx * 2.5 * ms, 2.2 * ms, 0);
        pil.scale.set(0.95, 1.35, 1.05);
      }
      const arch = add(new THREE.Mesh(new THREE.DodecahedronGeometry(3.2 * ms, 0), rockLight), 0, 4.6 * ms, -0.2 * ms);
      arch.scale.set(1.45, 0.72, 1.0);
      // Hanging stalactite teeth inside the cave brow.
      for (const sx of [-0.9, 0, 0.85]) {
        const stal = add(new THREE.Mesh(new THREE.ConeGeometry(0.32 * ms, 1.3 * ms, 5), rockLight), sx * ms, 3.4 * ms, 0.7 * ms);
        stal.rotation.x = Math.PI;
      }
      return g;
    }

    if (cls === 'rock') {
      // --- Dramatic Clustered Monolith Crag & Boulders (奇岩／巨石地標) ---
      const rockDark = new THREE.MeshStandardMaterial({ color: 0x6b655e, roughness: 0.92, flatShading: true });
      const rockMid = new THREE.MeshStandardMaterial({ color: 0x8a8279, roughness: 0.88, flatShading: true });
      const mossMat = new THREE.MeshStandardMaterial({ color: 0x4b7838, roughness: 0.86, flatShading: true });

      const mainSpire = add(new THREE.Mesh(new THREE.DodecahedronGeometry(2.8 * ms, 0), rockMid), 0, 3.2 * ms, 0);
      mainSpire.scale.set(0.85, 1.55, 0.78);
      mainSpire.rotation.set(0.15, seed * 3, -0.12);
      const sideSpire = add(new THREE.Mesh(new THREE.DodecahedronGeometry(2.1 * ms, 0), rockDark), -2.1 * ms, 1.9 * ms, 0.7 * ms);
      sideSpire.scale.set(1.05, 1.15, 0.9);
      const foreBoulder = add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.6 * ms, 0), rockMid), 1.8 * ms, 1.2 * ms, 1.1 * ms);
      foreBoulder.scale.set(1.2, 0.75, 1.0);
      const moss = add(new THREE.Mesh(new THREE.DodecahedronGeometry(1.4 * ms, 0), mossMat), 0, 5.8 * ms, 0);
      moss.scale.set(1.1, 0.42, 0.95);
      return g;
    }

    if (cls === 'castle') {
      // --- Historic Stone Fortress / Bastion with Battlements & Watchtower (古蹟城堡／砲台) ---
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9c9488, roughness: 0.88, flatShading: true });
      const stoneDark = new THREE.MeshStandardMaterial({ color: 0x6e685f, roughness: 0.92, flatShading: true });
      const gateMat = new THREE.MeshStandardMaterial({ color: 0x3b2818, roughness: 0.9 });
      const flagMat = new THREE.MeshStandardMaterial({ color: 0xd93829, emissive: 0x3d0a05, emissiveIntensity: 0.28, side: THREE.DoubleSide });

      // Main battered bastion wall + arched gate.
      add(new THREE.Mesh(new THREE.BoxGeometry(7.2 * ms, 3.8 * ms, 5.6 * ms), stoneMat), 0, 1.9 * ms, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.8 * ms, 2.4 * ms, 0.4 * ms), gateMat), 0, 1.2 * ms, 2.75 * ms);
      // Crenelated merlon battlements along the front & back parapet.
      for (const sx of [-2.7, -0.9, 0.9, 2.7]) {
        for (const sz of [-2.4, 2.4]) {
          add(new THREE.Mesh(new THREE.BoxGeometry(1.05 * ms, 0.85 * ms, 0.65 * ms), stoneDark), sx * ms, 4.2 * ms, sz * ms);
        }
      }
      // Corner cylindrical keep / watchtower turret + heritage pennant.
      const tx = -2.2 * ms, tz = -1.6 * ms;
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.65 * ms, 1.85 * ms, 6.8 * ms, 8), stoneDark), tx, 3.4 * ms, tz);
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.9 * ms, 1.7 * ms, 0.9 * ms, 8), stoneMat), tx, 7.1 * ms, tz);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14 * ms, 0.14 * ms, 3.2 * ms, 6), stoneMat), tx, 8.9 * ms, tz);
      const flag = add(new THREE.Mesh(new THREE.ConeGeometry(0.95 * ms, 2.4 * ms, 4), flagMat), tx + 1.2 * ms, 9.8 * ms, tz);
      flag.rotation.z = -Math.PI / 2;
      return g;
    }

    if (cls === 'monument') {
      // --- Stepped Stone Plinth + Obelisk + Bronze Plaque (紀念碑) ---
      const stoneLight = new THREE.MeshStandardMaterial({ color: 0xd6d0c4, roughness: 0.78, flatShading: true });
      const stoneMid = new THREE.MeshStandardMaterial({ color: 0xa8a196, roughness: 0.85, flatShading: true });
      const bronzeMat = new THREE.MeshStandardMaterial({
        color: 0xb88644, roughness: 0.4, metalness: 0.55,
        emissive: 0x3b280c, emissiveIntensity: 0.25, flatShading: true,
      });

      add(new THREE.Mesh(new THREE.BoxGeometry(6.4 * ms, 0.9 * ms, 6.4 * ms), stoneMid), 0, 0.45 * ms, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(4.8 * ms, 1.0 * ms, 4.8 * ms), stoneLight), 0, 1.4 * ms, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(3.4 * ms, 1.4 * ms, 3.4 * ms), stoneMid), 0, 2.6 * ms, 0);
      // Four corner stone bollards on the lower terrace.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.38 * ms, 1.2 * ms, 6), stoneLight), sx * 2.6 * ms, 1.5 * ms, sz * 2.6 * ms);
        }
      }
      // Tapered 4-sided obelisk shaft + golden pyramidion cap.
      const shaftH = 8.5 * ms;
      const shaft = add(new THREE.Mesh(new THREE.CylinderGeometry(0.95 * ms, 1.65 * ms, shaftH, 4), stoneLight), 0, 3.3 * ms + shaftH / 2, 0);
      shaft.rotation.y = Math.PI / 4;
      const cap = add(new THREE.Mesh(new THREE.ConeGeometry(0.95 * ms, 1.7 * ms, 4), bronzeMat), 0, 3.3 * ms + shaftH + 0.85 * ms, 0);
      cap.rotation.y = Math.PI / 4;
      // Inlaid bronze memorial plaque on the front (+z) of the pedestal.
      add(new THREE.Mesh(new THREE.BoxGeometry(1.9 * ms, 0.9 * ms, 0.2 * ms), bronzeMat), 0, 2.6 * ms, 1.72 * ms);
      return g;
    }

    if (cls === 'trailhead') {
      // --- Trailhead Information Kiosk & Multi-Blade Guidepost (登山口導覽牌／指標樁) ---
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x827b72, roughness: 0.9, flatShading: true });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x8c5830, roughness: 0.82, flatShading: true });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x54331a, roughness: 0.86, flatShading: true });
      const mapMat = new THREE.MeshStandardMaterial({ color: 0xeaf2e8, emissive: 0x1e3824, emissiveIntensity: 0.22, roughness: 0.5 });
      const signMat = new THREE.MeshStandardMaterial({ color: 0xd99b4e, roughness: 0.72, flatShading: true });

      for (const sx of [-1, 1]) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.75 * ms, 0.95 * ms, 1.1 * ms, 6), stoneMat), sx * 1.9 * ms, 0.55 * ms, 0);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.36 * ms, 5.8 * ms, 7), woodMat), sx * 1.9 * ms, 3.4 * ms, 0);
      }
      // Trail map board + pitched cedar rooflet.
      add(new THREE.Mesh(new THREE.BoxGeometry(3.8 * ms, 2.4 * ms, 0.42 * ms), woodMat), 0, 4.1 * ms, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(3.3 * ms, 1.9 * ms, 0.48 * ms), mapMat), 0, 4.1 * ms, 0);
      for (const sx of [-1, 1]) {
        const r = add(new THREE.Mesh(new THREE.BoxGeometry(2.8 * ms, 0.35 * ms, 2.1 * ms), roofMat), sx * 1.15 * ms, 6.35 * ms, 0);
        r.rotation.z = -sx * 0.35;
      }
      // Adjacent fingerpost with directional arrow blades.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.26 * ms, 0.3 * ms, 7.2 * ms, 6), woodMat), 3.4 * ms, 3.6 * ms, 0.4 * ms);
      add(new THREE.Mesh(new THREE.BoxGeometry(2.6 * ms, 0.72 * ms, 0.28 * ms), signMat), 4.3 * ms, 6.4 * ms, 0.4 * ms);
      const b2 = add(new THREE.Mesh(new THREE.BoxGeometry(2.4 * ms, 0.72 * ms, 0.28 * ms), signMat), 3.4 * ms, 5.3 * ms, 1.2 * ms);
      b2.rotation.y = Math.PI / 2;
      return g;
    }

    if (cls === 'station') {
      // --- Mountain Railway / Cable-Car Station Platform & Miniature Railcar (車站) ---
      const platMat = new THREE.MeshStandardMaterial({ color: 0x9e9a92, roughness: 0.88, flatShading: true });
      const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5c438, emissive: 0x594200, emissiveIntensity: 0.3 });
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x455260, roughness: 0.55, metalness: 0.4 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x35698c, roughness: 0.58, metalness: 0.25, flatShading: true });
      const carRed = new THREE.MeshStandardMaterial({ color: 0xd93b30, roughness: 0.45, metalness: 0.15, flatShading: true });
      const carCream = new THREE.MeshStandardMaterial({ color: 0xf7efe0, roughness: 0.45, flatShading: true });
      const winMat = new THREE.MeshStandardMaterial({ color: 0x9ce2ff, emissive: 0x3898ff, emissiveIntensity: 0.6 });

      // Raised concrete platform + yellow safety stripe.
      add(new THREE.Mesh(new THREE.BoxGeometry(8.6 * ms, 1.3 * ms, 4.4 * ms), platMat), 0, 0.65 * ms, -0.8 * ms);
      add(new THREE.Mesh(new THREE.BoxGeometry(8.4 * ms, 0.16 * ms, 0.35 * ms), lineMat), 0, 1.32 * ms, 1.0 * ms);
      // Platform canopy pillars + butterfly/pitched canopy roof.
      for (const sx of [-2.6, 0, 2.6]) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.26 * ms, 0.3 * ms, 4.2 * ms, 6), steelMat), sx * ms, 3.4 * ms, -1.1 * ms);
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(8.8 * ms, 0.55 * ms, 4.2 * ms), roofMat), 0, 5.55 * ms, -0.9 * ms);
      // Miniature two-tone mountain railcar stopped alongside the platform (+z).
      const cz = 2.55 * ms;
      add(new THREE.Mesh(new THREE.BoxGeometry(6.4 * ms, 1.5 * ms, 2.3 * ms), carRed), 0, 1.35 * ms, cz);
      add(new THREE.Mesh(new THREE.BoxGeometry(6.2 * ms, 1.25 * ms, 2.2 * ms), carCream), 0, 2.65 * ms, cz);
      add(new THREE.Mesh(new THREE.BoxGeometry(5.6 * ms, 0.75 * ms, 2.32 * ms), winMat), 0, 2.68 * ms, cz);
      add(new THREE.Mesh(new THREE.BoxGeometry(6.4 * ms, 0.35 * ms, 2.25 * ms), steelMat), 0, 3.4 * ms, cz);
      return g;
    }

    if (cls === 'heliport') {
      // --- Mountain Rescue Helipad with "H" Marking & Windsock (直升機停機坪) ---
      const padMat = new THREE.MeshStandardMaterial({ color: 0x586068, roughness: 0.85, flatShading: true });
      const markYellow = new THREE.MeshStandardMaterial({ color: 0xffcc29, emissive: 0x664d00, emissiveIntensity: 0.35 });
      const markWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x555555, emissiveIntensity: 0.4 });
      const sockOrange = new THREE.MeshStandardMaterial({ color: 0xff5919, emissive: 0x661a00, emissiveIntensity: 0.4 });
      const lightGreen = new THREE.MeshStandardMaterial({ color: 0x38ff7a, emissive: 0x19e65c, emissiveIntensity: 0.95 });

      add(new THREE.Mesh(new THREE.CylinderGeometry(5.2 * ms, 5.6 * ms, 0.85 * ms, 8), padMat), 0, 0.42 * ms, 0);
      const ring = add(new THREE.Mesh(new THREE.RingGeometry(3.6 * ms, 4.2 * ms, 16), markYellow), 0, 0.88 * ms, 0);
      ring.rotation.x = -Math.PI / 2;
      // White "H" landing symbol.
      for (const sx of [-1.25, 1.25]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.65 * ms, 0.14 * ms, 3.6 * ms), markWhite), sx * ms, 0.9 * ms, 0);
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(2.6 * ms, 0.14 * ms, 0.65 * ms), markWhite), 0, 0.9 * ms, 0);
      // Perimeter green threshold lights.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add(new THREE.Mesh(new THREE.SphereGeometry(0.28 * ms, 6, 5), lightGreen), Math.cos(a) * 4.7 * ms, 0.95 * ms, Math.sin(a) * 4.7 * ms);
      }
      // Windsock pole + flying orange/white windsock cone.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.16 * ms, 0.2 * ms, 5.6 * ms, 6), markWhite), 4.6 * ms, 3.2 * ms, -2.2 * ms);
      const sock = add(new THREE.Mesh(new THREE.ConeGeometry(0.58 * ms, 2.4 * ms, 8), sockOrange), 5.8 * ms, 5.7 * ms, -2.2 * ms);
      sock.rotation.z = -Math.PI / 2 + 0.18;
      return g;
    }

    if (cls === 'parking') {
      // --- Trailhead Parking Lot with "P" Signpost & Miniature Cars (停車場) ---
      const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x4b5159, roughness: 0.88, flatShading: true });
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, emissive: 0x333840, emissiveIntensity: 0.25 });
      const signBlue = new THREE.MeshStandardMaterial({ color: 0x1d6fd6, emissive: 0x0a2c59, emissiveIntensity: 0.35, roughness: 0.4 });
      const car1Mat = new THREE.MeshStandardMaterial({ color: 0xe0483e, roughness: 0.4, metalness: 0.2, flatShading: true });
      const car2Mat = new THREE.MeshStandardMaterial({ color: 0x3898db, roughness: 0.4, metalness: 0.2, flatShading: true });
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xdcebf7, roughness: 0.3, metalness: 0.3 });

      add(new THREE.Mesh(new THREE.BoxGeometry(7.6 * ms, 0.55 * ms, 5.6 * ms), asphaltMat), 0, 0.28 * ms, 0);
      for (const sx of [-2.4, 0, 2.4]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.24 * ms, 0.12 * ms, 3.6 * ms), stripeMat), sx * ms, 0.58 * ms, 0.4 * ms);
      }
      // Blue "P" parking signpost at the corner.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.18 * ms, 0.22 * ms, 5.2 * ms, 6), stripeMat), -3.2 * ms, 2.8 * ms, -2.1 * ms);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.7 * ms, 1.7 * ms, 0.35 * ms), signBlue), -3.2 * ms, 5.4 * ms, -2.1 * ms);
      // 2 cute low-poly parked cars.
      for (const [cx, cMat] of [[-1.2 * ms, car1Mat], [1.25 * ms, car2Mat]]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(1.75 * ms, 0.85 * ms, 3.2 * ms), cMat), cx, 0.98 * ms, 0.4 * ms);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.45 * ms, 0.72 * ms, 1.75 * ms), cabMat), cx, 1.65 * ms, 0.2 * ms);
      }
      return g;
    }

    if (cls === 'picnic') {
      // --- Rest & Picnic Area: Wooden Table, Sun Umbrella & Water Tap (休憩野餐區) ---
      const padMat = new THREE.MeshStandardMaterial({ color: 0xb5aba0, roughness: 0.9, flatShading: true });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x996536, roughness: 0.82, flatShading: true });
      const umbMat = new THREE.MeshStandardMaterial({ color: 0xd94e34, roughness: 0.65, flatShading: true });
      const tapMat = new THREE.MeshStandardMaterial({ color: 0x5c859e, roughness: 0.45, metalness: 0.45 });

      add(new THREE.Mesh(new THREE.CylinderGeometry(3.8 * ms, 4.1 * ms, 0.48 * ms, 8), padMat), 0, 0.24 * ms, 0);
      // Picnic table top + 2 side benches.
      add(new THREE.Mesh(new THREE.BoxGeometry(2.8 * ms, 0.32 * ms, 2.0 * ms), woodMat), -0.4 * ms, 1.65 * ms, 0);
      for (const sz of [-1.35, 1.35]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(2.8 * ms, 0.28 * ms, 0.65 * ms), woodMat), -0.4 * ms, 1.05 * ms, sz * ms);
      }
      // Parasol pole + octagonal canopy.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.16 * ms, 0.18 * ms, 4.6 * ms, 6), woodMat), -0.4 * ms, 2.6 * ms, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(2.65 * ms, 1.35 * ms, 8), umbMat), -0.4 * ms, 5.1 * ms, 0);
      // Drinking-water standpipe fountain on the side.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.38 * ms, 0.45 * ms, 2.2 * ms, 8), tapMat), 2.3 * ms, 1.3 * ms, 0.8 * ms);
      return g;
    }

    // --- Viewpoint / Attraction: Timber Observation Deck + Binocular Telescope (觀景點) ---
    const woodDeckMat = new THREE.MeshStandardMaterial({ color: 0xa67244, roughness: 0.82, flatShading: true });
    const woodPostMat = new THREE.MeshStandardMaterial({ color: 0x6e4726, roughness: 0.86, flatShading: true });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd9a84e, roughness: 0.32, metalness: 0.65,
      emissive: 0x4a3208, emissiveIntensity: 0.25,
    });
    const plaqueMat = new THREE.MeshStandardMaterial({
      color: 0x356888, emissive: 0x0a1c28, emissiveIntensity: 0.28, roughness: 0.55,
    });

    const deckW = 6.4 * ms, deckD = 4.8 * ms, deckY = 1.6 * ms;
    // 4 timber pilings supporting the deck.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.36 * ms, 0.42 * ms, deckY + 2.4 * ms, 6), woodPostMat), sx * (deckW * 0.44), (deckY + 2.4 * ms) / 2, sz * (deckD * 0.42));
      }
    }
    // Timber deck platform.
    add(new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.55 * ms, deckD), woodDeckMat), 0, deckY, 0);
    // Front & side wooden safety railings.
    const railY = deckY + 2.2 * ms;
    add(new THREE.Mesh(new THREE.BoxGeometry(deckW * 0.94, 0.34 * ms, 0.34 * ms), woodPostMat), 0, railY, deckD * 0.42);
    for (const sx of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.34 * ms, 0.34 * ms, deckD * 0.88), woodPostMat), sx * deckW * 0.44, railY, 0);
    }
    // Slanted interpretive trail-map lectern on the left side.
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.24 * ms, 0.28 * ms, 2.2 * ms, 6), woodPostMat), -1.6 * ms, deckY + 1.1 * ms, 0.8 * ms);
    const lectern = add(new THREE.Mesh(new THREE.BoxGeometry(2.1 * ms, 0.24 * ms, 1.4 * ms), plaqueMat), -1.6 * ms, deckY + 2.25 * ms, 0.8 * ms);
    lectern.rotation.x = 0.48;
    // Miniature coin-operated binocular telescope on a pedestal stand on the right.
    const tx = 1.3 * ms, tz = 0.5 * ms;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.55 * ms, 0.75 * ms, 0.45 * ms, 8), woodPostMat), tx, deckY + 0.45 * ms, tz);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.25 * ms, 0.32 * ms, 2.8 * ms, 8), brassMat), tx, deckY + 1.85 * ms, tz);
    const scope = add(new THREE.Mesh(new THREE.CylinderGeometry(0.58 * ms, 0.42 * ms, 2.2 * ms, 8), brassMat), tx, deckY + 3.45 * ms, tz + 0.2 * ms);
    scope.rotation.x = Math.PI / 2 - 0.18;
    return g;
  }

  // Render the parsed map features into this.featureGroup (geometry) and
  // this.featureLabelGroup (names). Everything is draped onto the rendered
  // terrain surface so it sits on the ground.
  _buildMapFeatures(data, bbox) {
    if (!data || !this.scene) return;
    // Sculpt OSM hydrological channel incisions, forest canopy relief, and land-cover
    // surface textures first so all draped lines, polygons, and buildings sit flush
    // on the updated terrain surface.
    this._applyLandCoverColors(data.areas, data.buildings, bbox, data.lines);

    this.featureGroup = new THREE.Group();
    this.featureLabelGroup = new THREE.Group();
    this.landmarkGroup = new THREE.Group();
    this._windTurbineRotors = [];
    this.scene.add(this.featureGroup);
    this.scene.add(this.featureLabelGroup);
    this.scene.add(this.landmarkGroup);

    const ms = this._markerScale || 1;
    const range = Math.max(1, this._fieldMaxV - this._fieldMinV);
    const baseLift = Math.max(2, range * 0.004);
    const elevScale = this._elevScale || 1;
    const dLatCell = (bbox.maxLat - bbox.minLat) / (FIELD_SIZE - 1);
    const dLngCell = (bbox.maxLng - bbox.minLng) / (FIELD_SIZE - 1);

    // Drape a lat/lng onto the terrain surface.
    const world = (lat, lng, lift) => {
      const elev = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, elev + lift, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    };

    // ----- Lines (roads, waterways, railways, bridges, tunnels, aerialways, power lines) -----
    const LINE_STYLE = {
      major:      { color: 0xf4b942, width: 3.1, opacity: 0.96, lift: baseLift * 1.65, casingColor: 0x4a4035, casingWidth: 4.8, casingOpacity: 0.78 },
      minor:      { color: 0xf0eadc, width: 2.1, opacity: 0.92, lift: baseLift * 1.45, casingColor: 0x5c5346, casingWidth: 3.4, casingOpacity: 0.72 },
      trail:      { color: 0xd9924c, width: 1.65, opacity: 0.88, lift: baseLift * 1.32, casingColor: 0x6b4423, casingWidth: 2.7, casingOpacity: 0.65 },
      river:      { color: 0x3db5ff, width: 2.9, opacity: 0.94, lift: baseLift * 0.95, casingColor: 0x1b5c8f, casingWidth: 4.5, casingOpacity: 0.78 },
      stream:     { color: 0x7dd0ff, width: 1.75, opacity: 0.88, lift: baseLift * 0.92, casingColor: 0x266da1, casingWidth: 2.7, casingOpacity: 0.68 },
      railway:    { color: 0xd8dfe8, width: 2.0, opacity: 0.95, lift: baseLift * 1.58, casingColor: 0x4a3b2e, casingWidth: 4.2, casingOpacity: 0.85 },
      aerialway:  { color: 0x334155, width: 1.6, opacity: 0.92, lift: baseLift * 1.5 + 14 * ms, casingColor: null },
      power_line: { color: 0x94a3b8, width: 1.15, opacity: 0.68, lift: baseLift * 1.5 + 16 * ms, casingColor: null },
    };
    const buckets = {};
    const casingBuckets = {};
    const tunnelVerts = [];
    const bridgeParapetVerts = [];
    const railSleeperVerts = [];
    const drapeLine = (pts, lift) => {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [la, lo] = pts[i];
        const [lb, lob] = pts[i + 1];
        const steps = Math.min(14, Math.max(1, Math.ceil(Math.max(Math.abs(lb - la) / dLatCell, Math.abs(lob - lo) / dLngCell))));
        for (let st = 0; st < steps; st++) {
          const t = st / steps;
          out.push(world(la + (lb - la) * t, lo + (lob - lo) * t, lift));
        }
      }
      out.push(world(pts[pts.length - 1][0], pts[pts.length - 1][1], lift));
      return out;
    };
    const labelCands = [];
    const pushLabelCand = (name, pos, color, pri, key) => {
      if (name) labelCands.push({ name, pos, color, pri, key: key || name });
    };

    const bridgePierMat = new THREE.MeshStandardMaterial({ color: 0x8d959e, roughness: 0.82, metalness: 0.08, flatShading: true });
    const bridgeTowerMat = new THREE.MeshStandardMaterial({ color: 0xc84b31, roughness: 0.62, metalness: 0.22, flatShading: true });
    const portalStoneMat = new THREE.MeshStandardMaterial({ color: 0x767b82, roughness: 0.88, metalness: 0.05, flatShading: true });
    const portalDarkMat = new THREE.MeshStandardMaterial({ color: 0x16191d, roughness: 0.95, metalness: 0, flatShading: true });
    const gondolaBodyMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.55, metalness: 0.15, flatShading: true });
    const gondolaGlassMat = new THREE.MeshStandardMaterial({ color: 0x90e0ef, roughness: 0.25, metalness: 0.25, flatShading: true });
    const pylonSteelMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.3, flatShading: true });

    let bridgePierCount = 0;
    let tunnelPortalCount = 0;
    let aerialPylonCount = 0;

    const addTunnelPortal = (pt, dir) => {
      if (tunnelPortalCount >= 40) return;
      tunnelPortalCount++;
      const pg = new THREE.Group();
      pg.position.copy(pt);
      const yaw = Math.atan2(dir.x, dir.z);
      pg.rotation.y = yaw;
      const pw = 3.2 * ms, ph = 2.8 * ms, pd = 1.2 * ms;
      const arch = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), portalStoneMat);
      arch.position.y = ph * 0.45;
      arch.castShadow = true;
      pg.add(arch);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(pw * 1.15, ph * 0.22, pd * 1.18), portalStoneMat);
      cap.position.y = ph * 0.95;
      pg.add(cap);
      const bore = new THREE.Mesh(new THREE.CylinderGeometry(pw * 0.32, pw * 0.32, pd * 1.06, 8), portalDarkMat);
      bore.rotation.x = Math.PI / 2;
      bore.position.y = ph * 0.36;
      pg.add(bore);
      this.featureGroup.add(pg);
    };

    for (const ln of (data.lines || [])) {
      const style = LINE_STYLE[ln.cls] || LINE_STYLE.minor;
      const key = ln.cls;
      let labelMid = null;
      let labelLen = -1;
      const clippedRuns = this._clipPolylineToBbox(ln.pts, bbox)
        .flatMap((run) => this._splitPolylineAtHoles(run));
      const bridgeLift = ln.bridge ? Math.max(3.5 * ms, baseLift * 2.2) : 0;
      const lineLift = style.lift + bridgeLift;

      for (const run of clippedRuns) {
        const w = drapeLine(run, lineLift);
        if (w.length < 2) continue;

        if (ln.tunnel) {
          for (let i = 0; i < w.length - 1; i++) {
            if (i % 2 === 0) {
              tunnelVerts.push(w[i].x, w[i].y, w[i].z, w[i + 1].x, w[i + 1].y, w[i + 1].z);
            }
          }
          const d0 = new THREE.Vector3().subVectors(w[1], w[0]).normalize();
          const d1 = new THREE.Vector3().subVectors(w[w.length - 2], w[w.length - 1]).normalize();
          addTunnelPortal(w[0], d0);
          if (w[0].distanceTo(w[w.length - 1]) > 8 * ms) addTunnelPortal(w[w.length - 1], d1);
        } else {
          const verts = (buckets[key] = buckets[key] || []);
          const cVerts = (casingBuckets[key] = casingBuckets[key] || []);
          const cDrop = baseLift * 0.12;
          for (let i = 0; i < w.length - 1; i++) {
            verts.push(w[i].x, w[i].y, w[i].z, w[i + 1].x, w[i + 1].y, w[i + 1].z);
            if (style.casingColor != null) {
              cVerts.push(w[i].x, w[i].y - cDrop, w[i].z, w[i + 1].x, w[i + 1].y - cDrop, w[i + 1].z);
            }
          }

          // Railway cross-tie sleepers perpendicular to the track
          if (ln.cls === 'railway') {
            let acc = 0;
            const sleeperStep = 2.6 * ms;
            const halfTie = 1.25 * ms;
            for (let i = 0; i < w.length - 1; i++) {
              const segLen = w[i].distanceTo(w[i + 1]);
              acc += segLen;
              if (acc >= sleeperStep && segLen > 0.01) {
                acc = 0;
                const dx = (w[i + 1].x - w[i].x) / segLen;
                const dz = (w[i + 1].z - w[i].z) / segLen;
                const nx = -dz * halfTie, nz = dx * halfTie;
                const mx = (w[i].x + w[i + 1].x) * 0.5;
                const my = (w[i].y + w[i + 1].y) * 0.5 + baseLift * 0.05;
                const mz = (w[i].z + w[i + 1].z) * 0.5;
                railSleeperVerts.push(mx - nx, my, mz - nz, mx + nx, my, mz + nz);
              }
            }
          }

          // 3D Bridge: side parapets + support piers + suspension towers for trail/suspension bridges
          if (ln.bridge) {
            const halfDeck = (ln.cls === 'major' ? 1.8 : (ln.cls === 'trail' ? 0.95 : 1.35)) * ms;
            const railH = 0.85 * ms;
            let pierAcc = 0;
            const pierSpacing = (ln.cls === 'trail' ? 18 : 14) * ms;
            for (let i = 0; i < w.length - 1; i++) {
              const segLen = w[i].distanceTo(w[i + 1]);
              if (segLen < 0.01) continue;
              const dx = (w[i + 1].x - w[i].x) / segLen;
              const dz = (w[i + 1].z - w[i].z) / segLen;
              const nx = -dz * halfDeck, nz = dx * halfDeck;
              bridgeParapetVerts.push(
                w[i].x - nx, w[i].y + railH, w[i].z - nz,
                w[i + 1].x - nx, w[i + 1].y + railH, w[i + 1].z - nz,
                w[i].x + nx, w[i].y + railH, w[i].z + nz,
                w[i + 1].x + nx, w[i + 1].y + railH, w[i + 1].z + nz
              );
              pierAcc += segLen;
              if (pierAcc >= pierSpacing && bridgePierCount < 80) {
                pierAcc = 0;
                bridgePierCount++;
                const pierH = bridgeLift + style.lift;
                const pier = new THREE.Mesh(
                  new THREE.CylinderGeometry(0.45 * ms, 0.62 * ms, pierH, 6),
                  bridgePierMat
                );
                pier.position.set(w[i].x, w[i].y - pierH * 0.5, w[i].z);
                pier.castShadow = true;
                this.featureGroup.add(pier);
              }
            }
            if ((ln.bridgeType === 'suspension' || ln.cls === 'trail') && bridgePierCount < 80 && w[0].distanceTo(w[w.length - 1]) > 6 * ms) {
              const towerH = 4.2 * ms;
              for (const endPt of [w[0], w[w.length - 1]]) {
                const tower = new THREE.Mesh(new THREE.BoxGeometry(1.8 * ms, towerH, 0.7 * ms), bridgeTowerMat);
                tower.position.set(endPt.x, endPt.y + towerH * 0.4, endPt.z);
                tower.castShadow = true;
                this.featureGroup.add(tower);
              }
            }
          }

          // 3D Aerialway: support pylons + suspended gondola cabins along the cable
          if (ln.cls === 'aerialway' && aerialPylonCount < 50) {
            const cableH = 14 * ms;
            let acc = 0;
            for (let i = 0; i < w.length - 1; i++) {
              const segLen = w[i].distanceTo(w[i + 1]);
              acc += segLen;
              if ((i === 0 || acc >= 28 * ms) && aerialPylonCount < 50) {
                acc = 0;
                aerialPylonCount++;
                const pylon = new THREE.Group();
                pylon.position.set(w[i].x, w[i].y - cableH, w[i].z);
                const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.65 * ms, cableH, 6), pylonSteelMat);
                mast.position.y = cableH * 0.5;
                mast.castShadow = true;
                pylon.add(mast);
                const cross = new THREE.Mesh(new THREE.BoxGeometry(3.2 * ms, 0.45 * ms, 0.45 * ms), pylonSteelMat);
                cross.position.y = cableH;
                pylon.add(cross);
                this.featureGroup.add(pylon);
              }
              if (segLen > 4 * ms && i % 3 === 1) {
                const mx = (w[i].x + w[i + 1].x) * 0.5;
                const my = (w[i].y + w[i + 1].y) * 0.5;
                const mz = (w[i].z + w[i + 1].z) * 0.5;
                const cab = new THREE.Group();
                cab.position.set(mx, my, mz);
                const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * ms, 0.08 * ms, 1.8 * ms, 4), pylonSteelMat);
                hanger.position.y = -0.9 * ms;
                cab.add(hanger);
                const body = new THREE.Mesh(new THREE.BoxGeometry(1.7 * ms, 1.5 * ms, 1.4 * ms), gondolaBodyMat);
                body.position.y = -2.2 * ms;
                body.castShadow = true;
                cab.add(body);
                const win = new THREE.Mesh(new THREE.BoxGeometry(1.76 * ms, 0.55 * ms, 1.46 * ms), gondolaGlassMat);
                win.position.y = -2.05 * ms;
                cab.add(win);
                this.featureGroup.add(cab);
              }
            }
          }
        }
        if (w.length > labelLen) { labelLen = w.length; labelMid = w[Math.floor(w.length / 2)]; }
      }
      if (labelMid) {
        const pri = ln.kind === 'water'
          ? (ln.cls === 'river' ? 1 : 7)
          : (ln.cls === 'major' || ln.cls === 'railway' || ln.cls === 'aerialway' ? 3 : (ln.cls === 'trail' ? 7 : 5));
        const lColor = ln.kind === 'water' ? 0x9fd8ff : (ln.cls === 'railway' || ln.cls === 'aerialway' ? 0xe2e8f0 : 0xffd27a);
        pushLabelCand(ln.name, labelMid.clone().setY(labelMid.y + 10 * ms), lColor, pri);
      }
    }

    const addLinePass = (verts, color, linewidth, opacity) => {
      if (!verts || verts.length < 6) return;
      const geo = new LineSegmentsGeometry();
      geo.setPositions(verts);
      const mat = new LineMaterial({ color, linewidth, transparent: true, opacity });
      const seg = new LineSegments2(geo, mat);
      seg.computeLineDistances();
      this.featureGroup.add(seg);
      this._lineMaterials.push(mat);
    };

    for (const key of Object.keys(buckets)) {
      const verts = buckets[key];
      if (!verts.length) continue;
      const style = LINE_STYLE[key] || LINE_STYLE.minor;
      const cVerts = casingBuckets[key];
      if (cVerts && cVerts.length && style.casingColor != null) {
        addLinePass(cVerts, style.casingColor, style.casingWidth, style.casingOpacity);
      }
      addLinePass(verts, style.color, style.width, style.opacity);
    }
    addLinePass(tunnelVerts, 0x94a3b8, 2.0, 0.52);
    addLinePass(bridgeParapetVerts, 0xe2e8f0, 1.5, 0.88);
    addLinePass(railSleeperVerts, 0x5c4033, 2.2, 0.88);

    // ----- 3D Civil & Natural Linear/Polygon Structures (dams, piers, breakwaters, walls, cliffs) -----
    const structMaterials = {
      dam:        new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.78, metalness: 0.08, flatShading: true, side: THREE.DoubleSide }),
      pier:       new THREE.MeshStandardMaterial({ color: 0x9c7a54, roughness: 0.85, metalness: 0.04, flatShading: true, side: THREE.DoubleSide }),
      breakwater: new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.92, metalness: 0.04, flatShading: true, side: THREE.DoubleSide }),
      wall:       new THREE.MeshStandardMaterial({ color: 0xa89f91, roughness: 0.88, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
      cliff:      new THREE.MeshStandardMaterial({ color: 0x736b60, roughness: 0.92, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
    };
    const buildRibbon3D = (pts3D, halfW, height, mat) => {
      if (pts3D.length < 2) return;
      const positions = [];
      for (let i = 0; i < pts3D.length - 1; i++) {
        const a = pts3D[i], b = pts3D[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = (-dz / len) * halfW, nz = (dx / len) * halfW;
        const alx = a.x - nx, alz = a.z - nz, arx = a.x + nx, arz = a.z + nz;
        const blx = b.x - nx, blz = b.z - nz, brx = b.x + nx, brz = b.z + nz;
        const ay0 = a.y - height * 0.25, ay1 = a.y + height;
        const by0 = b.y - height * 0.25, by1 = b.y + height;
        positions.push(alx, ay1, alz, arx, ay1, arz, brx, by1, brz);
        positions.push(alx, ay1, alz, brx, by1, brz, blx, by1, blz);
        positions.push(alx, ay0, alz, alx, ay1, alz, blx, by1, blz);
        positions.push(alx, ay0, alz, blx, by1, blz, blx, by0, blz);
        positions.push(arx, ay1, arz, arx, ay0, arz, brx, by0, brz);
        positions.push(arx, ay1, arz, brx, by0, brz, brx, by1, brz);
      }
      if (!positions.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.featureGroup.add(mesh);
    };

    const cliffLineVerts = [];
    let cliffToothCount = 0;
    for (const st of (data.structures || [])) {
      const mat = structMaterials[st.cls] || structMaterials.wall;
      const cfg = st.cls === 'dam'
        ? { halfW: 2.6 * ms, h: 9.5 * ms }
        : st.cls === 'pier'
          ? { halfW: 1.5 * ms, h: 1.4 * ms }
          : st.cls === 'breakwater'
            ? { halfW: 2.2 * ms, h: 3.2 * ms }
            : { halfW: 0.75 * ms, h: 2.4 * ms };

      const runs = this._clipPolylineToBbox(st.pts, bbox)
        .flatMap((run) => this._splitPolylineAtHoles(run));
      let labelPt = null;
      for (const run of runs) {
        const w = drapeLine(run, baseLift * 0.9);
        if (w.length < 2) continue;
        if (!labelPt) labelPt = w[Math.floor(w.length / 2)];
        if (st.cls === 'cliff') {
          let acc = 0;
          for (let i = 0; i < w.length - 1; i++) {
            cliffLineVerts.push(w[i].x, w[i].y + baseLift * 0.5, w[i].z, w[i + 1].x, w[i + 1].y + baseLift * 0.5, w[i + 1].z);
            const segLen = w[i].distanceTo(w[i + 1]);
            acc += segLen;
            if (acc >= 6 * ms && cliffToothCount < 140) {
              acc = 0;
              cliffToothCount++;
              const crag = new THREE.Mesh(new THREE.ConeGeometry(1.8 * ms, 4.2 * ms, 5), mat);
              crag.position.set(w[i].x, w[i].y + 1.6 * ms, w[i].z);
              crag.rotation.y = (cliffToothCount * 1.7) % (Math.PI * 2);
              crag.castShadow = true;
              this.featureGroup.add(crag);
            }
          }
        } else {
          buildRibbon3D(w, cfg.halfW, cfg.h, mat);
          if (st.cls === 'pier') {
            let acc = 0;
            for (let i = 0; i < w.length; i++) {
              if (i > 0) acc += w[i].distanceTo(w[i - 1]);
              if (i === 0 || i === w.length - 1 || acc >= 8 * ms) {
                acc = 0;
                const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * ms, 0.28 * ms, 3.2 * ms, 6), mat);
                pile.position.set(w[i].x, w[i].y - 0.6 * ms, w[i].z);
                this.featureGroup.add(pile);
              }
            }
          }
        }
      }
      if (st.name && labelPt) {
        pushLabelCand(st.name, labelPt.clone().setY(labelPt.y + (cfg.h + 10 * ms)), 0xe2e8f0, 3);
      }
    }
    addLinePass(cliffLineVerts, 0x57534e, 2.4, 0.85);

    // ----- Land cover & civic grounds (water, wetland, swimming pools, sports pitches) -----
    const AREA_STYLE = {
      water:   { color: 0x2482d6, opacity: 0.76, roughness: 0.25, metalness: 0.15, outline: 0x8ad4ff, outlineW: 1.9, lift: baseLift * 0.65, labelColor: 0x9fd8ff, pri: 0 },
      wetland: { color: 0x468972, opacity: 0.58, roughness: 0.68, metalness: 0.04, outline: 0x9be2c8, outlineW: 1.5, lift: baseLift * 0.58, labelColor: 0xade8cf, pri: 1 },
      pool:    { color: 0x22d3ee, opacity: 0.86, roughness: 0.18, metalness: 0.2,  outline: 0xf8fafc, outlineW: 2.1, lift: baseLift * 1.15, labelColor: 0xa5f3fc, pri: 3 },
      pitch:   { color: 0x2ea043, opacity: 0.82, roughness: 0.72, metalness: 0.02, outline: 0xffffff, outlineW: 1.8, lift: baseLift * 1.12, labelColor: 0xbbf7d0, pri: 4 },
      forest:  { labelColor: 0x9be07a, pri: 2 },
      scrub:   { labelColor: 0xb6e488, pri: 2 },
      grass:   { labelColor: 0xc7f29a, pri: 2 },
      rock:    { labelColor: 0xd9d2c7, pri: 4 },
      sand:    { labelColor: 0xf0deb4, pri: 4 },
      waste:   { labelColor: 0xe6d3a0, pri: 4 },
      urban:   { labelColor: 0xe2dccf, pri: 5 },
    };
    const localXZ = (lat, lng) => {
      const p = this._latLngToLocal(lat, lng, 0, bbox);
      return new THREE.Vector2(p.x, p.z);
    };
    for (const ar of (data.areas || [])) {
      const style = AREA_STYLE[ar.cls] || AREA_STYLE.grass;
      const baked = !!TerrainViewer._landCoverFamily(ar.cls);
      const rings = ar.rings || [];
      if (!rings.length || rings[0].length < 3) continue;

      const toShape2D = (ring) => {
        const r = ring.slice();
        if (r.length > 1) {
          const a = r[0], b = r[r.length - 1];
          if (a[0] === b[0] && a[1] === b[1]) r.pop();
        }
        return r;
      };
      const outer = this._clipRingToBbox(toShape2D(rings[0]), bbox);
      if (outer.length < 3) continue;
      const holes = rings.slice(1)
        .map((r) => this._clipRingToBbox(toShape2D(r), bbox))
        .filter((h) => h.length >= 3);

      if (!baked) {
        const contour2D = outer.map(([la, lo]) => localXZ(la, lo));
        const holes2D = holes.map((h) => h.map(([la, lo]) => localXZ(la, lo)));
        let faces;
        try { faces = THREE.ShapeUtils.triangulateShape(contour2D, holes2D); } catch { faces = null; }
        if (faces && faces.length) {
          const combinedLL = [...outer, ...holes.flat()];
          const verts3D = combinedLL.map(([la, lo]) => world(la, lo, style.lift));
          const combinedHole = combinedLL.map(([la, lo]) => this._isOverHole(la, lo));
          const positions = [];
          for (const f of faces) {
            if (f.some((idx) => combinedHole[idx])) continue;
            for (const idx of f) {
              const v = verts3D[idx];
              if (v) positions.push(v.x, v.y, v.z);
            }
          }
          if (positions.length) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.computeVertexNormals();
            const mat = new THREE.MeshStandardMaterial({
              color: style.color, transparent: true, opacity: style.opacity,
              roughness: style.roughness ?? 0.9, metalness: style.metalness ?? 0, side: THREE.DoubleSide,
              depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.renderOrder = 1;
            this.featureGroup.add(mesh);
          }
        }

        // Shoreline / bank / court boundary outline.
        const ov = [];
        for (const seg of this._splitPolylineAtHoles([...outer, outer[0]])) {
          const ow = drapeLine(seg, style.lift + baseLift * 0.4);
          for (let i = 0; i < ow.length - 1; i++) ov.push(ow[i].x, ow[i].y, ow[i].z, ow[i + 1].x, ow[i + 1].y, ow[i + 1].z);
        }
        if (ov.length >= 6) {
          addLinePass(ov, style.outline, style.outlineW || 1.5, 0.82);
        }
      }

      let cla = 0, clo = 0;
      for (const [la, lo] of outer) { cla += la; clo += lo; }
      cla /= outer.length; clo /= outer.length;
      if (!this._isOverHole(cla, clo)) {
        const labelLift = (baked ? baseLift * 0.8 : style.lift) + 14 * ms;
        pushLabelCand(ar.name, world(cla, clo, labelLift), style.labelColor, style.pri);
      }
    }

    // ----- Buildings: diorama massing with architectural archetypes, plinth & roofs -----
    const ringArea = (ring) => {
      let a = 0;
      for (let i = 0; i < ring.length - 1; i++) a += ring[i][1] * ring[i + 1][0] - ring[i + 1][1] * ring[i][0];
      return Math.abs(a) / 2;
    };
    const blds = (data.buildings || [])
      .map((b) => ({ ...b, _a: ringArea(b.ring) }))
      .sort((a, b) => b._a - a._a)
      .slice(0, 350);
    const ringCentroidLL = (ring) => {
      let la = 0, lo = 0;
      for (const [a, o] of ring) { la += a; lo += o; }
      return [la / ring.length, lo / ring.length];
    };
    const partCentroids = blds.filter((b) => b.part).map((b) => ringCentroidLL(b.ring));
    const hasSubParts = (ring) => partCentroids.length > 0 && partCentroids.some(([la, lo]) => this._pointInRing(la, lo, ring));

    // Diorama architectural wall & roof material palettes.
    const wallPalette = [
      new THREE.MeshStandardMaterial({ color: 0xd6cec2, roughness: 0.86, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0xcfc0aa, roughness: 0.86, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0xa4acb8, roughness: 0.82, metalness: 0.06, flatShading: true, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0xc2b5a3, roughness: 0.88, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
    ];
    const archWallMaterials = {
      temple:     new THREE.MeshStandardMaterial({ color: 0xc83e2b, roughness: 0.78, metalness: 0.04, flatShading: true, side: THREE.DoubleSide }),
      church:     new THREE.MeshStandardMaterial({ color: 0xede6d6, roughness: 0.84, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
      hut:        new THREE.MeshStandardMaterial({ color: 0x9b6b43, roughness: 0.88, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
      greenhouse: new THREE.MeshStandardMaterial({ color: 0xa5d8e6, transparent: true, opacity: 0.65, roughness: 0.25, metalness: 0.18, flatShading: true, side: THREE.DoubleSide }),
      industrial: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.72, metalness: 0.18, flatShading: true, side: THREE.DoubleSide }),
    };
    const archRoofMaterials = {
      temple:     new THREE.MeshStandardMaterial({ color: 0xd49b27, roughness: 0.65, metalness: 0.15, flatShading: true, side: THREE.DoubleSide }),
      church:     new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.78, metalness: 0.08, flatShading: true, side: THREE.DoubleSide }),
      hut:        new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.68, metalness: 0.14, flatShading: true, side: THREE.DoubleSide }),
      greenhouse: new THREE.MeshStandardMaterial({ color: 0xcffafe, transparent: true, opacity: 0.58, roughness: 0.22, metalness: 0.2, flatShading: true, side: THREE.DoubleSide }),
      industrial: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.75, metalness: 0.18, flatShading: true, side: THREE.DoubleSide }),
    };
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x6b665f, roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    const roofPalette = [
      new THREE.MeshStandardMaterial({ color: 0xa45a42, roughness: 0.82, metalness: 0.04, flatShading: true, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0x566370, roughness: 0.8, metalness: 0.08, flatShading: true, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0x7d5c49, roughness: 0.84, metalness: 0.03, flatShading: true, side: THREE.DoubleSide }),
    ];
    for (const b of blds) {
      let ring = b.ring.slice();
      if (ring.length > 1) {
        const a = ring[0], z = ring[ring.length - 1];
        if (a[0] === z[0] && a[1] === z[1]) ring.pop();
      }
      ring = this._clipRingToBbox(ring, bbox);
      if (ring.length < 3) continue;
      if (ring.some(([la, lo]) => this._isOverHole(la, lo))) continue;

      const shellOnly = !b.part && hasSubParts(ring);

      const shape = new THREE.Shape();
      const worldXZ = [];
      let baseY = Infinity, maxBaseY = -Infinity;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let cx = 0, cz = 0;
      ring.forEach(([la, lo], i) => {
        const p = this._latLngToLocal(la, lo, 0, bbox);
        if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
        worldXZ.push([p.x, p.z]);
        cx += p.x; cz += p.z;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
        const e = this._sampleGridElevation(la, lo) - (this._elevBase || 0);
        if (e < baseY) baseY = e;
        if (e > maxBaseY) maxBaseY = e;
      });
      if (!Number.isFinite(baseY)) continue;
      cx /= worldXZ.length; cz /= worldXZ.length;
      const groundY = baseY * elevScale;
      const hash = Math.abs(Math.floor(cx * 13 + cz * 31));
      const wallMat = b.wallColor != null
        ? new THREE.MeshStandardMaterial({ color: b.wallColor, roughness: 0.84, metalness: 0.04, flatShading: true, side: THREE.DoubleSide })
        : (archWallMaterials[b.arch] || wallPalette[hash % wallPalette.length]);
      const defaultRoofMat = archRoofMaterials[b.arch] || roofPalette[hash % roofPalette.length];

      const totalH = Math.max(2, b.h);
      const minH = Math.max(0, Math.min(b.minH || 0, totalH - 1));
      const planDim = Math.max(1, Math.min(maxX - minX, maxZ - minZ));
      const archDefaultShape = b.arch === 'temple' ? 'hipped'
        : (b.arch === 'church' || b.arch === 'hut' || b.arch === 'greenhouse') ? 'gabled'
        : null;
      const autoPitch = !b.roof && !b.part && (archDefaultShape || (planDim < 22 && totalH <= 14));
      const roof = b.roof || (autoPitch ? { shape: archDefaultShape || ((hash % 2 === 0) ? 'gabled' : 'hipped'), height: null, colour: null } : null);
      let roofH = 0;
      if (roof) {
        roofH = Number.isFinite(roof.height) && roof.height > 0
          ? roof.height
          : Math.max(1.8, Math.min(planDim * (b.roof || archDefaultShape ? 0.36 : 0.24), b.roof || archDefaultShape ? 8 : 4.2));
        roofH = Math.min(roofH, (totalH - minH) * 0.55);
      }
      const wallTopM = totalH - roofH;
      const wallDepth = Math.max(0.5, wallTopM - minH);

      if (!shellOnly) {
        // Foundation plinth course at ground level for ground-seated buildings.
        const plinthH = minH === 0 ? Math.min(1.4, wallDepth * 0.24) : 0;
        if (plinthH > 0.25) {
          let pGeo = null;
          try { pGeo = new THREE.ExtrudeGeometry(shape, { depth: plinthH, bevelEnabled: false }); } catch { pGeo = null; }
          if (pGeo) {
            pGeo.rotateX(-Math.PI / 2);
            pGeo.translate(0, groundY, 0);
            const pMesh = new THREE.Mesh(pGeo, plinthMat);
            pMesh.castShadow = true;
            pMesh.receiveShadow = true;
            this.featureGroup.add(pMesh);
          }
        }

        let geo = null;
        try { geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.4, wallDepth - plinthH), bevelEnabled: false }); } catch { geo = null; }
        if (geo) {
          geo.rotateX(-Math.PI / 2);
          geo.translate(0, groundY + minH + plinthH, 0);
          const mesh = new THREE.Mesh(geo, wallMat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.featureGroup.add(mesh);

          if (roofH > 0.5 && worldXZ.length >= 3) {
            const springY = groundY + wallTopM;
            const apexY = groundY + totalH;
            const pos = TerrainViewer._roofPositions(roof.shape, worldXZ, springY, apexY, cx, cz);
            const rgeo = new THREE.BufferGeometry();
            rgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            rgeo.computeVertexNormals();
            const rmat = roof.colour != null
              ? new THREE.MeshStandardMaterial({ color: roof.colour, roughness: 0.82, metalness: 0.04, flatShading: true, side: THREE.DoubleSide })
              : defaultRoofMat;
            const rmesh = new THREE.Mesh(rgeo, rmat);
            rmesh.castShadow = true;
            rmesh.receiveShadow = true;
            this.featureGroup.add(rmesh);
          } else if (worldXZ.length >= 3) {
            // Flat-roofed larger block: add a dark cornice/parapet collar band at the top.
            const capH = Math.min(0.85, wallDepth * 0.12);
            let cGeo = null;
            try { cGeo = new THREE.ExtrudeGeometry(shape, { depth: capH, bevelEnabled: false }); } catch { cGeo = null; }
            if (cGeo) {
              cGeo.rotateX(-Math.PI / 2);
              cGeo.translate(0, groundY + totalH, 0);
              const cMesh = new THREE.Mesh(cGeo, plinthMat);
              cMesh.castShadow = true;
              this.featureGroup.add(cMesh);
            }
          }
        }
      }

      if (b.name && b._a > 0 && !b.part) {
        pushLabelCand(b.name, new THREE.Vector3(cx, groundY + totalH + 4 * ms, cz), 0xcfcabf, 6);
      }
    }

    // ----- Point landmarks: 22 procedural diorama 3D landmark categories -----
    const POINT_PRIORITY = {
      peak: 1, waterfall: 1, lighthouse: 1, castle: 1, temple: 2, church: 2,
      hut: 2, sacred_tree: 2, wind_turbine: 2, saddle: 2, tower: 3, water_tower: 3,
      chimney: 3, viewpoint: 3, pavilion: 3, trailhead: 3, station: 3, monument: 3,
      spring: 4, cave: 4, camp_site: 4, heliport: 4, power_tower: 5, rock: 5,
      picnic: 5, parking: 5, tree: 9,
    };
    const POINT_LABEL_COLOR = {
      peak: 0xffd9a0, saddle: 0xffd9a0, rock: 0xd9d2c7, cave: 0xd9d2c7,
      waterfall: 0x9fd8ff, spring: 0x9fd8ff,
      sacred_tree: 0xa7f3d0, tree: 0xa7f3d0,
      temple: 0xfca5a5, church: 0xfde68a, castle: 0xfde68a, monument: 0xfde68a,
      hut: 0xfcd34d, pavilion: 0xfcd34d, camp_site: 0xfcd34d, trailhead: 0xfcd34d,
    };
    const allPoints = (data.points || []).slice().sort((a, b) => (POINT_PRIORITY[a.cls] || 6) - (POINT_PRIORITY[b.cls] || 6));
    const nonTree = allPoints.filter((p) => p.cls !== 'tree');
    const trees = allPoints.filter((p) => p.cls === 'tree');
    const placedCells = new Set();
    for (const p of [...nonTree.slice(0, 180), ...trees.slice(0, 65)]) {
      const { lat, lon } = p;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLng || lon > bbox.maxLng) continue;
      if (this._isOverHole(lat, lon)) continue;
      if (p.cls !== 'tree') {
        const cellKey = `${Math.round(lat * 5000)},${Math.round(lon * 5000)}`;
        if (placedCells.has(cellKey)) continue;
        placedCells.add(cellKey);
      }
      const model = this._buildPointModel(p.cls, ms, p.h, lat, lon);
      if (!model) continue;
      model.position.copy(world(lat, lon, baseLift));
      this.landmarkGroup.add(model);
      if (p.cls !== 'tree' && p.cls !== 'power_tower') {
        const color = POINT_LABEL_COLOR[p.cls] || 0xd8e0ea;
        const pri = POINT_PRIORITY[p.cls] || 4;
        const labelPos = model.position.clone().setY(model.position.y + 16 * ms);
        if (p.name && p.name.trim()) {
          pushLabelCand(p.name, labelPos, color, pri);
        } else {
          const fb = this._fallbackLandmarkName(p.cls, lat, lon);
          if (fb) pushLabelCand(fb, labelPos, color, pri + 3, `${p.cls}@${lat.toFixed(4)},${lon.toFixed(4)}`);
        }
      }
    }

    // ----- Labels: dedupe by name, prioritise, cap, then build sprites -----
    const seen = new Set();
    labelCands.sort((a, b) => a.pri - b.pri);
    let made = 0;
    for (const c of labelCands) {
      if (made >= 70) break;
      const name = (c.name || '').trim();
      if (!name) continue;
      const key = (c.key || c.name).trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const label = this._createLabel(name, c.pos.x, c.pos.y, c.pos.z, c.color);
      label.scale.set(46 * ms, 15 * ms, 1);
      this._registerLabel(label);
      this.featureLabelGroup.add(label);
      made++;
    }

    this.featureGroup.visible = this._featuresVisible;
    this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();
    this._updateLineResolutions();
  }

  _setupPlayer(coords, elevations, bbox) {
    if (!coords || coords.length < 2) return;
    const ms = this._markerScale || 1;

    // Ride the hiker on the same draped surface as the track (see
    // _createRoutePath) so the cursor beacon stays seated on the trail.
    const drapeLift = this._routeDrapeLift();
    const pts = coords.map(([lat, lng]) => {
      const surf = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, surf, bbox);
      return new THREE.Vector3(p.x, p.y + drapeLift, p.z);
    });

    this.playerPath = new THREE.CatmullRomCurve3(pts);
    this.playerMarker = null;

    // 3D position cursor: a sculpted faceted beacon pointer with a metallic top
    // pedestal collar and a ground-hugging compass halo ring.
    this._cursorGroup = new THREE.Group();
    const coneH = (13 / 3) * ms;
    this._cursorHeight = coneH;

    const conePivot = new THREE.Group();
    const outerCone = new THREE.Mesh(
      new THREE.ConeGeometry(2.15 * ms, coneH * 0.88, 8),
      new THREE.MeshStandardMaterial({
        color: 0xff6b1a, emissive: 0xff4800, emissiveIntensity: 0.85,
        roughness: 0.35, metalness: 0.2, flatShading: true,
      })
    );
    outerCone.rotation.x = Math.PI;
    outerCone.position.y = coneH * 0.44;
    conePivot.add(outerCone);

    // Top golden pedestal collar where the cute figurine stands.
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(2.25 * ms, 1.95 * ms, coneH * 0.2, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffd24d, emissive: 0xb36b00, emissiveIntensity: 0.55,
        roughness: 0.3, metalness: 0.6,
      })
    );
    collar.position.y = coneH * 0.9;
    conePivot.add(collar);
    this._cursorGroup.add(conePivot);
    this._cursorCone = conePivot;

    // Ground compass ring with 4 cardinal pips around the pointer tip.
    const ringGroup = new THREE.Group();
    ringGroup.position.y = 0.25 * ms;
    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(2.5 * ms, 3.35 * ms, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffae42, transparent: true, opacity: 0.78, side: THREE.DoubleSide,
      })
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringGroup.add(ringMesh);
    const pipMat = new THREE.MeshBasicMaterial({ color: 0xfff0b8 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const pip = new THREE.Mesh(new THREE.BoxGeometry(0.65 * ms, 0.25 * ms, 1.15 * ms), pipMat);
      pip.position.set(Math.cos(a) * 3.4 * ms, 0.05 * ms, Math.sin(a) * 3.4 * ms);
      pip.rotation.y = -a;
      ringGroup.add(pip);
    }
    this._cursorGroup.add(ringGroup);
    this._cursorRing = ringGroup;
    this.scene.add(this._cursorGroup);

    // Cute toy / chibi figurine hiker standing on the cursor pedestal.
    this._person = this._createPersonFigure(ms);
    this.scene.add(this._person);

    // Trail line behind player
    const trailMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.3 });
    const trailGeo = new THREE.BufferGeometry();
    this.playerTrail = new THREE.Line(trailGeo, trailMat);
    this.scene.add(this.playerTrail);

    this._progress = 0;
    this._updatePlayerPosition();

    if (this._playerLight) {
      this.scene.remove(this._playerLight);
    }
    this._playerLight = new THREE.PointLight(0xff6600, 0.5, Math.max(500, 600 * ms));
    this.scene.add(this._playerLight);
  }

  // Cute toy / chibi miniature hiker figurine (可愛公仔風):
  //   • Oversized expressive vinyl-toy head with rosy cheeks, glossy eyes + white
  //     catchlights, button nose, smile, and a wide-brimmed outdoor explorer hat
  //   • Vibrant teal mountain-parka jacket with cream fleece scarf/collar & zipper
  //   • Detailed hiking backpack with top flap, side water bottle, and rolled sleeping pad
  //   • Chunky two-tone hiking boots with dark lug soles & coral ankle cuffs
  //   • Trekking pole held in the right hand that swings with the stride
  _createPersonFigure(ms) {
    const group = new THREE.Group();
    group.rotation.order = 'YXZ'; // yaw (face travel) before forward lean

    // Toy-vinyl materials with smooth sheen and gentle emissive for night readability.
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdfc4, roughness: 0.48, metalness: 0.02, emissive: 0x4a2c18, emissiveIntensity: 0.22 });
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x2299aa, roughness: 0.45, metalness: 0.05, emissive: 0x0a353d, emissiveIntensity: 0.28 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x5c6b48, roughness: 0.6, metalness: 0.02, emissive: 0x1a2014, emissiveIntensity: 0.2 });
    const fleeceMat = new THREE.MeshStandardMaterial({ color: 0xfff5e4, roughness: 0.65, emissive: 0x3d3529, emissiveIntensity: 0.2 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x7a4824, roughness: 0.55, emissive: 0x261408, emissiveIntensity: 0.2 });
    const soleMat = new THREE.MeshStandardMaterial({ color: 0x241d18, roughness: 0.75 });
    const coralMat = new THREE.MeshStandardMaterial({ color: 0xf25c54, roughness: 0.45, emissive: 0x4a1210, emissiveIntensity: 0.25 });
    const packMat = new THREE.MeshStandardMaterial({ color: 0xe09f3e, roughness: 0.52, emissive: 0x3d2808, emissiveIntensity: 0.22 });
    const packFlapMat = new THREE.MeshStandardMaterial({ color: 0x4a6b3b, roughness: 0.58, emissive: 0x142210, emissiveIntensity: 0.2 });
    const hatMat = new THREE.MeshStandardMaterial({ color: 0xd9b27c, roughness: 0.55, emissive: 0x382a16, emissiveIntensity: 0.22 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x221814, roughness: 0.3, metalness: 0.1 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.2 });
    const blushMat = new THREE.MeshStandardMaterial({ color: 0xff8fa3, roughness: 0.5, emissive: 0x4d1924, emissiveIntensity: 0.25 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xdce4ec, roughness: 0.3, metalness: 0.7 });
    const bottleMat = new THREE.MeshStandardMaterial({ color: 0x38b6ff, roughness: 0.25, metalness: 0.15, emissive: 0x0c344d, emissiveIntensity: 0.25 });

    const add = (mesh) => { mesh.castShadow = true; return mesh; };

    // Toy chibi proportions: compact sturdy legs, rounded parka torso, cute big head.
    const legR = 1.45 * ms, legLen = 5.2 * ms, legFull = legLen + legR * 2;
    const armR = 1.15 * ms, armLen = 4.8 * ms, armFull = armLen + armR * 2;
    const torsoR = 2.75 * ms, torsoLen = 3.6 * ms, torsoFull = torsoLen + torsoR * 2;
    const headR = 3.45 * ms;

    const hipY = legFull;
    const shoulderY = hipY + torsoFull;
    const headY = shoulderY + headR * 0.78;

    const makeLimb = (rad, len, mat) => {
      const pivot = new THREE.Group();
      const full = len + rad * 2;
      const mesh = add(new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 5, 12), mat));
      mesh.position.y = -full / 2;
      pivot.add(mesh);
      return pivot;
    };

    // --- Legs + Chunky Two-Tone Hiking Boots ---
    const legX = 1.45 * ms;
    const legL = makeLimb(legR, legLen, pantsMat);
    const legR2 = makeLimb(legR, legLen, pantsMat);
    legL.position.set(-legX, hipY, 0);
    legR2.position.set(legX, hipY, 0);

    for (const leg of [legL, legR2]) {
      const bootY = -legFull + legR * 0.75;
      // Coral sock/ankle cuff.
      const cuff = add(new THREE.Mesh(new THREE.CylinderGeometry(legR * 1.06, legR * 1.08, 1.1 * ms, 12), coralMat));
      cuff.position.y = bootY + 1.05 * ms;
      leg.add(cuff);
      // Rounded toy boot upper (projected slightly forward +z).
      const boot = add(new THREE.Mesh(new THREE.SphereGeometry(legR * 1.22, 12, 10), bootMat));
      boot.scale.set(1.0, 0.82, 1.32);
      boot.position.set(0, bootY + 0.15 * ms, 0.42 * ms);
      leg.add(boot);
      // Dark lug sole at the bottom.
      const sole = add(new THREE.Mesh(new THREE.CylinderGeometry(legR * 1.18, legR * 1.22, 0.55 * ms, 12), soleMat));
      sole.scale.set(1.0, 1.0, 1.32);
      sole.position.set(0, bootY - 0.55 * ms, 0.42 * ms);
      leg.add(sole);
    }
    group.add(legL, legR2);

    // --- Pelvis & Parka Torso ---
    const pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(torsoR * 0.98, 16, 12), pantsMat));
    pelvis.position.set(0, hipY + torsoR * 0.36, 0);
    pelvis.scale.set(1.0, 0.8, 1.0);
    group.add(pelvis);

    const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(torsoR, torsoLen, 6, 16), jacketMat));
    torso.position.y = hipY + torsoFull * 0.54;
    group.add(torso);

    // Parka belt + golden buckle + front zipper stripe + puffy fleece collar.
    const belt = add(new THREE.Mesh(new THREE.CylinderGeometry(torsoR * 1.03, torsoR * 1.03, 0.85 * ms, 16), soleMat));
    belt.position.y = hipY + torsoFull * 0.25;
    group.add(belt);
    const buckle = add(new THREE.Mesh(new THREE.BoxGeometry(1.3 * ms, 1.05 * ms, 0.45 * ms), packMat));
    buckle.position.set(0, hipY + torsoFull * 0.25, torsoR * 1.02);
    group.add(buckle);

    const zipper = add(new THREE.Mesh(new THREE.BoxGeometry(0.48 * ms, torsoFull * 0.62, 0.35 * ms), fleeceMat));
    zipper.position.set(0, hipY + torsoFull * 0.58, torsoR * 0.96);
    group.add(zipper);

    const collar = add(new THREE.Mesh(new THREE.TorusGeometry(torsoR * 0.78, 0.82 * ms, 10, 18), fleeceMat));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = shoulderY - 0.55 * ms;
    group.add(collar);

    // --- Cute 3D Hiking Backpack (mounted on back -z) ---
    const packGroup = new THREE.Group();
    const packY = hipY + torsoFull * 0.55;
    const packZ = -(torsoR + 1.55 * ms);
    packGroup.position.set(0, packY, packZ);
    // Main rounded pack body.
    const packBody = add(new THREE.Mesh(new THREE.BoxGeometry(4.4 * ms, 5.2 * ms, 2.8 * ms), packMat));
    packGroup.add(packBody);
    // Olive top weather flap.
    const packFlap = add(new THREE.Mesh(new THREE.SphereGeometry(2.35 * ms, 12, 10), packFlapMat));
    packFlap.scale.set(1.0, 0.55, 0.72);
    packFlap.position.set(0, 2.5 * ms, 0);
    packGroup.add(packFlap);
    // Rear outer pocket + buckle straps.
    const rearPocket = add(new THREE.Mesh(new THREE.BoxGeometry(3.2 * ms, 2.6 * ms, 0.8 * ms), coralMat));
    rearPocket.position.set(0, -0.7 * ms, -1.5 * ms);
    packGroup.add(rearPocket);
    for (const sx of [-1, 1]) {
      const strap = add(new THREE.Mesh(new THREE.BoxGeometry(0.45 * ms, 3.4 * ms, 0.35 * ms), soleMat));
      strap.position.set(sx * 1.15 * ms, 0.8 * ms, -1.55 * ms);
      packGroup.add(strap);
    }
    // Rolled sleeping pad strapped across the top of the backpack.
    const padRoll = add(new THREE.Mesh(new THREE.CylinderGeometry(0.95 * ms, 0.95 * ms, 4.8 * ms, 12), coralMat));
    padRoll.rotation.z = Math.PI / 2;
    padRoll.position.set(0, 3.55 * ms, -0.2 * ms);
    packGroup.add(padRoll);
    const padCore = add(new THREE.Mesh(new THREE.CylinderGeometry(0.55 * ms, 0.55 * ms, 4.95 * ms, 10), fleeceMat));
    padCore.rotation.z = Math.PI / 2;
    padCore.position.copy(padRoll.position);
    packGroup.add(padCore);
    // Side water bottle tucked on the left side of the pack.
    const bottle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.65 * ms, 0.65 * ms, 2.3 * ms, 10), bottleMat));
    bottle.position.set(-2.55 * ms, -0.5 * ms, 0);
    packGroup.add(bottle);
    const bottleCap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42 * ms, 0.48 * ms, 0.5 * ms, 8), darkMat));
    bottleCap.position.set(-2.55 * ms, 0.85 * ms, 0);
    packGroup.add(bottleCap);
    group.add(packGroup);

    // --- Arms + Mittens + Trekking Pole ---
    const armL = makeLimb(armR, armLen, jacketMat);
    const armR3 = makeLimb(armR, armLen, jacketMat);
    const shoX = torsoR + armR * 0.45;
    armL.position.set(-shoX, shoulderY - armR, 0);
    armR3.position.set(shoX, shoulderY - armR, 0);

    const handY = -armFull + armR * 0.65;
    const handL = add(new THREE.Mesh(new THREE.SphereGeometry(armR * 1.15, 10, 8), skinMat));
    handL.position.y = handY;
    armL.add(handL);
    const handR = add(new THREE.Mesh(new THREE.SphereGeometry(armR * 1.15, 10, 8), skinMat));
    handR.position.y = handY;
    armR3.add(handR);

    // Trekking pole held in the right hand, angled slightly forward to plant on the trail.
    const poleGroup = new THREE.Group();
    poleGroup.position.set(0, handY, 0.3 * ms);
    poleGroup.rotation.x = 0.22;
    const poleLen = 11.5 * ms;
    const shaft = add(new THREE.Mesh(new THREE.CylinderGeometry(0.18 * ms, 0.13 * ms, poleLen, 8), metalMat));
    shaft.position.y = -poleLen * 0.32;
    poleGroup.add(shaft);
    const grip = add(new THREE.Mesh(new THREE.CylinderGeometry(0.32 * ms, 0.28 * ms, 2.2 * ms, 8), coralMat));
    grip.position.y = 0.5 * ms;
    poleGroup.add(grip);
    const basket = add(new THREE.Mesh(new THREE.CylinderGeometry(0.65 * ms, 0.65 * ms, 0.22 * ms, 8), darkMat));
    basket.position.y = -poleLen * 0.72;
    poleGroup.add(basket);
    armR3.add(poleGroup);
    group.add(armL, armR3);

    // --- Cute Chibi Head + Expressive Face + Explorer Safari Hat ---
    const headGroup = new THREE.Group();
    headGroup.position.y = headY;
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 16), skinMat));
    head.scale.set(1.04, 0.96, 1.0);
    headGroup.add(head);

    // Cute ears on the sides.
    for (const sx of [-1, 1]) {
      const ear = add(new THREE.Mesh(new THREE.SphereGeometry(0.72 * ms, 10, 8), skinMat));
      ear.position.set(sx * headR * 0.98, -0.15 * ms, 0);
      headGroup.add(ear);
    }

    // Glossy dark eyes + sparkling white catchlight dots + rosy blush cheeks.
    for (const sx of [-1, 1]) {
      const eye = add(new THREE.Mesh(new THREE.SphereGeometry(0.58 * ms, 10, 8), darkMat));
      eye.scale.set(1.0, 1.18, 0.7);
      eye.position.set(sx * headR * 0.38, headR * 0.06, headR * 0.88);
      headGroup.add(eye);

      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.22 * ms, 8, 6), whiteMat);
      glint.position.set((sx * headR * 0.38) + 0.18 * ms, headR * 0.22, headR * 0.98);
      headGroup.add(glint);

      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.62 * ms, 10, 8), blushMat);
      cheek.scale.set(1.25, 0.75, 0.5);
      cheek.position.set(sx * headR * 0.58, -headR * 0.16, headR * 0.8);
      headGroup.add(cheek);
    }

    // Cute button nose + cheerful smile.
    const nose = add(new THREE.Mesh(new THREE.SphereGeometry(0.38 * ms, 8, 6), blushMat));
    nose.position.set(0, -headR * 0.04, headR * 0.98);
    headGroup.add(nose);

    const smile = add(new THREE.Mesh(new THREE.TorusGeometry(headR * 0.28, 0.22 * ms, 6, 12, Math.PI), darkMat));
    smile.rotation.x = Math.PI;
    smile.position.set(0, -headR * 0.22, headR * 0.86);
    headGroup.add(smile);

    // Outdoor Explorer Safari / Sun Hat tilted slightly back.
    const hatGroup = new THREE.Group();
    hatGroup.position.set(0, headR * 0.62, -0.25 * ms);
    hatGroup.rotation.x = -0.16;
    // Wide curved brim.
    const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(headR * 1.52, headR * 1.58, 0.42 * ms, 20), hatMat));
    hatGroup.add(brim);
    // Rounded hat crown.
    const crown = add(new THREE.Mesh(new THREE.SphereGeometry(headR * 0.96, 16, 12), hatMat));
    crown.scale.set(1.0, 0.78, 1.05);
    crown.position.y = 0.65 * ms;
    hatGroup.add(crown);
    // Coral terracotta hatband + green leaf/feather badge on the side.
    const band = add(new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.97, headR * 0.99, 0.65 * ms, 18), coralMat));
    band.position.y = 0.42 * ms;
    hatGroup.add(band);
    const leafBadge = add(new THREE.Mesh(new THREE.ConeGeometry(0.55 * ms, 1.8 * ms, 5), packFlapMat));
    leafBadge.position.set(headR * 0.98, 1.05 * ms, 0.3 * ms);
    leafBadge.rotation.z = -0.35;
    hatGroup.add(leafBadge);

    headGroup.add(hatGroup);
    group.add(headGroup);

    this._personParts = { group, legL, legR: legR2, armL, armR: armR3, headGroup };
    return group;
  }

  _updatePlayerPosition() {
    if (!this.playerPath) return;

    // Arc-length parameterised so progress (and the readout) advances by
    // distance travelled, matching the mileage/altitude/time figures.
    const ms = this._markerScale || 1;
    const coneH = this._cursorHeight || 0;
    const pt = this.playerPath.getPointAt(this._clampU(this._progress));

    if (this._cursorGroup) {
      const bob = Math.sin(this._personPhase * 4) * 2.4 * ms;
      this._cursorGroup.position.set(pt.x, pt.y + bob, pt.z);
      if (this._cursorCone) this._cursorCone.rotation.y += 0.035;
      if (this._cursorRing) this._cursorRing.rotation.y -= 0.02;
    }

    if (this._person) {
      const parts = this._personParts;
      const phase = this._personPhase;
      const moving = this._playing;
      const cadence = 11;
      const amp = moving ? 0.92 : 0.06;
      const swing = Math.sin(phase * cadence);
      const bob = Math.abs(swing) * (moving ? 1.8 : 0.3) * ms;

      // Stand on top of the cursor pedestal.
      this._person.position.set(pt.x, pt.y + coneH + bob, pt.z);

      const pA = this.playerPath.getPointAt(this._clampU(this._progress + 0.05));
      const pB = this.playerPath.getPointAt(this._clampU(this._progress - 0.03));
      if (pA && pB) {
        const vx = pA.x - pB.x, vz = pA.z - pB.z;
        const len = Math.hypot(vx, vz);
        if (len > 1e-6) {
          const tx = vx / len, tz = vz / len;
          const k = moving ? 0.1 : 1;
          this._personDir.x += (tx - this._personDir.x) * k;
          this._personDir.z += (tz - this._personDir.z) * k;
          const dl = Math.hypot(this._personDir.x, this._personDir.z) || 1;
          this._person.rotation.y = Math.atan2(this._personDir.x / dl, this._personDir.z / dl);
        }
      }
      this._person.rotation.x = moving ? 0.18 : 0.0;

      if (parts) {
        parts.legL.rotation.x = swing * amp;
        parts.legR.rotation.x = -swing * amp;
        parts.armL.rotation.x = -swing * amp * 0.88;
        parts.armR.rotation.x = swing * amp * 0.88;
        if (parts.headGroup) {
          parts.headGroup.rotation.z = Math.cos(phase * cadence) * (moving ? 0.08 : 0.015);
          parts.headGroup.rotation.y = -swing * (moving ? 0.1 : 0.02);
        }
      }
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

    // Reveal the track up to the current position when trail mode is on.
    if (this._routeReveal || this._playbackReveal) this._applyRouteReveal();

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
    const cumAscentM = this._cumAscent ? lerp(this._cumAscent[idx] ?? 0, this._cumAscent[j] ?? 0) : null;
    const cumDescentM = this._cumDescent ? lerp(this._cumDescent[idx] ?? 0, this._cumDescent[j] ?? 0) : null;

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
          // Display strings carried through from the 2D weather cells (may be
          // undefined for older data / points without a detailed read-out).
          precipitation: nearest.precipitation ?? null,
          precipProb: nearest.precipProb ?? null,
          humidity: nearest.humidity ?? null,
          windSpeed: nearest.windSpeed ?? null,
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
      cumAscentM,
      cumDescentM,
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

  // Rebuild the whole model in place from the cached source data (no network),
  // re-baking the current vertical scale into the geometry. Used by the
  // normalization toggle. Preserves the camera pose, playback position and every
  // layer/visibility toggle so the rebuild is seamless.
  _rebuildScene() {
    if (!this.scene || !this._buildCtx) return;
    const { coords, elevations, waypoints, weatherPoints, bbox } = this._buildCtx;
    const prevView = (this.camera && this.controls)
      ? { pos: this.camera.position.clone(), target: this.controls.target.clone(), progress: this._progress }
      : null;
    const wasPlaying = this._playing;
    this._playing = false;
    if (wasPlaying && this._onPlayStateChange) this._onPlayStateChange(false);

    this._clearScene();
    this._createTerrain(bbox);
    if (this._contourPrecision !== 'none') this._createContours(bbox);
    this._createRoutePath(coords, elevations, bbox);
    this._createWaypoints(waypoints, bbox);
    this._createWeatherLabels(weatherPoints, bbox);
    this._setupPlayer(coords, elevations, bbox);
    this._setupEnvironment();
    if (this._featuresData) {
      try { this._buildMapFeatures(this._featuresData, bbox); } catch (err) { console.warn('map features failed:', err); }
    }
    // Redraw catchment basins from the retained data onto the fresh terrain.
    if (this._catchmentBasinsData && this._catchmentBasinsData.length) {
      try { this._drawCatchmentBasins(); } catch (err) { console.warn('catchment redraw failed:', err); }
    }

    // Reapply the persisted layer/label state to the freshly built objects.
    this.setLabelScale(this._labelScale);
    if (this.contourLabelGroup) {
      this.contourLabelGroup.visible = this._contourLabelsVisible && this._contourPrecision !== 'none';
    }
    if (this.weatherGroup) this.weatherGroup.visible = this._weatherVisible;
    if (this.featureGroup) this.featureGroup.visible = this._featuresVisible;
    if (this.featureLabelGroup) this.featureLabelGroup.visible = this._featuresVisible;
    this._applyLandmarkVisibility();

    if (prevView) {
      this.controls.target.copy(prevView.target);
      this.camera.position.copy(prevView.pos);
      this._progress = Math.max(0, Math.min(1, prevView.progress));
      this.controls.update();
    }
    // _createWaypoints reset the stop cursor to 0; re-arm it for the restored
    // playhead so a rebuild mid-track doesn't replay already-passed stops.
    this._syncStopIdx();
    this._updateLineResolutions();
    this._updatePlayerPosition();
    this._emitMetrics(true);
    if (this._onInfo) this._onInfo(this._terrainInfo);
  }

  _ensureCatchmentGroup() {
    if (!this.scene) return;
    if (!this._catchmentGroup) {
      this._catchmentGroup = new THREE.Group();
      this._catchmentGroup.visible = this._catchmentVisible;
      this.scene.add(this._catchmentGroup);
    }
  }

  _disposeCatchmentGroup() {
    const grp = this._catchmentGroup;
    if (!grp) return;
    grp.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    if (this.scene) this.scene.remove(grp);
    this._catchmentGroup = null;
  }

  // Rebuild the whole catchment group from the retained basin data.
  _drawCatchmentBasins() {
    this._disposeCatchmentGroup();
    if (!this.scene || !this._bbox || !this._catchmentBasinsData || !this._catchmentBasinsData.length) return;
    this._ensureCatchmentGroup();
    for (const basin of this._catchmentBasinsData) this._buildOneCatchmentBasin(basin, this._catchmentGroup);
  }

  // Drape ONE basin (translucent fill + boundary outline + outlet marker) onto the
  // terrain surface. Reuses the same clip/hole/triangulate helpers as the 圖資
  // water fills. Unlit materials (MeshBasic/LineBasic) so the analytic overlay
  // stays legible regardless of the day/night lighting.
  _buildOneCatchmentBasin(basin, parentGroup) {
    if (!parentGroup || !this._bbox || !basin || !Array.isArray(basin.outer) || basin.outer.length < 3) return;
    const bbox = this._bbox;
    const color = new THREE.Color(basin.color || 0x38bdf8);
    const range = Math.max(1, (this._fieldMaxV ?? 0) - (this._fieldMinV ?? 0));
    const baseLift = Math.max(2, range * 0.004);
    const lift = baseLift * 1.2;
    const dLatCell = (bbox.maxLat - bbox.minLat) / (FIELD_SIZE - 1);
    const dLngCell = (bbox.maxLng - bbox.minLng) / (FIELD_SIZE - 1);

    const world = (lat, lng, h) => {
      const elev = this._sampleGridElevation(lat, lng);
      const p = this._latLngToLocal(lat, lng, elev + h, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    const drapeLine = (pts, h) => {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [la, lo] = pts[i];
        const [lb, lob] = pts[i + 1];
        const steps = Math.min(14, Math.max(1, Math.ceil(Math.max(Math.abs(lb - la) / dLatCell, Math.abs(lob - lo) / dLngCell))));
        for (let st = 0; st < steps; st++) { const t = st / steps; out.push(world(la + (lb - la) * t, lo + (lob - lo) * t, h)); }
      }
      out.push(world(pts[pts.length - 1][0], pts[pts.length - 1][1], h));
      return out;
    };
    // Drop a closed ring's repeated last vertex before clipping/triangulating.
    const toShape = (ring) => {
      const r = ring.slice();
      if (r.length > 1) { const a = r[0], z = r[r.length - 1]; if (a[0] === z[0] && a[1] === z[1]) r.pop(); }
      return r;
    };

    const grp = new THREE.Group();
    const outer = this._clipRingToBbox(toShape(basin.outer), bbox);
    if (outer.length >= 3) {
      const holes = (basin.holes || [])
        .map((h) => this._clipRingToBbox(toShape(h), bbox))
        .filter((h) => h.length >= 3);

      // Filled surface: rasterise the basin over its OWN bbox with a resolution
      // decoupled from the (whole-route) terrain field, sampling the terrain height
      // per node. This gives full coverage even for a small local catchment (a few
      // terrain-field cells wide) — the earlier field-index approach left small
      // basins with a sparse/empty fill under the outline — while still hugging the
      // interior relief (each node's height comes from _sampleGridElevation).
      let bLatMin = Infinity, bLatMax = -Infinity, bLngMin = Infinity, bLngMax = -Infinity;
      for (const [la, lo] of outer) {
        if (la < bLatMin) bLatMin = la; if (la > bLatMax) bLatMax = la;
        if (lo < bLngMin) bLngMin = lo; if (lo > bLngMax) bLngMax = lo;
      }
      const latSpan = bLatMax - bLatMin, lngSpan = bLngMax - bLngMin;
      // Sample ~1.5× the terrain-field density where the basin is large, but never
      // fewer than 24 steps so a tiny basin is still smoothly and fully filled.
      const stepsY = Math.max(24, Math.min(140, Math.ceil(latSpan / dLatCell * 1.5)));
      const stepsX = Math.max(24, Math.min(140, Math.ceil(lngSpan / dLngCell * 1.5)));
      const nLat = (i) => bLatMin + (i / stepsY) * latSpan;
      const nLng = (j) => bLngMin + (j / stepsX) * lngSpan;
      const cols = stepsX + 1;
      const cornerVert = new Array((stepsY + 1) * cols).fill(null);
      for (let i = 0; i <= stepsY; i++) {
        for (let j = 0; j <= stepsX; j++) {
          const la = nLat(i), lo = nLng(j);
          cornerVert[i * cols + j] = this._isOverHole(la, lo) ? null : world(la, lo, lift);
        }
      }
      const inBasin = (la, lo) => this._pointInRing(la, lo, outer) && !holes.some((h) => this._pointInRing(la, lo, h));
      const positions = [];
      for (let i = 0; i < stepsY; i++) {
        for (let j = 0; j < stepsX; j++) {
          // Cell-centre test keeps the fill inside the true boundary (drawn crisply
          // by the outline below); half-cell stair-stepping hides under it.
          if (!inBasin(nLat(i + 0.5), nLng(j + 0.5))) continue;
          const v00 = cornerVert[i * cols + j];
          const v10 = cornerVert[i * cols + (j + 1)];
          const v01 = cornerVert[(i + 1) * cols + j];
          const v11 = cornerVert[(i + 1) * cols + (j + 1)];
          if (!v00 || !v10 || !v01 || !v11) continue;   // touches a terrain hole → skip
          positions.push(v00.x, v00.y, v00.z, v10.x, v10.y, v10.z, v11.x, v11.y, v11.z);
          positions.push(v00.x, v00.y, v00.z, v11.x, v11.y, v11.z, v01.x, v01.y, v01.z);
        }
      }
      if (positions.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.34, side: THREE.DoubleSide,
          depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 2;
        grp.add(mesh);
      }

      // Boundary outline (outer + holes), split at terrain holes so it never
      // draws across blank tiles.
      const ov = [];
      const addOutline = (ring) => {
        for (const seg of this._splitPolylineAtHoles([...ring, ring[0]])) {
          const ow = drapeLine(seg, lift + baseLift * 0.6);
          for (let i = 0; i < ow.length - 1; i++) ov.push(ow[i].x, ow[i].y, ow[i].z, ow[i + 1].x, ow[i + 1].y, ow[i + 1].z);
        }
      };
      addOutline(outer);
      holes.forEach(addOutline);
      if (ov.length >= 6) {
        const lgeo = new THREE.BufferGeometry();
        lgeo.setAttribute('position', new THREE.Float32BufferAttribute(ov, 3));
        const lmat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
        const lines = new THREE.LineSegments(lgeo, lmat);
        lines.renderOrder = 3;
        grp.add(lines);
      }
    }

    // Outlet (pour point) marker: a diorama hydrology gauge beacon (concentric
    // water-ripple base rings + faceted diamond water-drop crystal + pointer tip).
    if (Array.isArray(basin.outlet) && basin.outlet.length === 2 && !this._isOverHole(basin.outlet[0], basin.outlet[1])) {
      const coneH = Math.max(baseLift * 6, range * 0.02);
      const outPos = world(basin.outlet[0], basin.outlet[1], lift);
      const outletGrp = new THREE.Group();
      outletGrp.position.copy(outPos);

      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
      const innerRing = new THREE.Mesh(new THREE.RingGeometry(coneH * 0.35, coneH * 0.55, 16), ringMat);
      innerRing.rotation.x = -Math.PI / 2;
      innerRing.position.y = coneH * 0.06;
      innerRing.renderOrder = 4;
      outletGrp.add(innerRing);

      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(coneH * 0.42, coneH * 0.75, 8),
        new THREE.MeshBasicMaterial({ color })
      );
      cone.position.y = coneH * 0.48;
      cone.rotation.x = Math.PI;
      cone.renderOrder = 4;
      outletGrp.add(cone);

      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(coneH * 0.38, 0),
        new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35) })
      );
      gem.position.y = coneH * 1.05;
      gem.renderOrder = 4;
      outletGrp.add(gem);

      grp.add(outletGrp);
    }

    if (grp.children.length) parentGroup.add(grp);
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
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => {
            if (m?.map) m.map.dispose();
            if (m?.bumpMap) m.bumpMap.dispose();
            if (m?.roughnessMap) m.roughnessMap.dispose();
            m?.dispose?.();
          });
        } else {
          if (child.material.map) child.material.map.dispose();
          if (child.material.bumpMap) child.material.bumpMap.dispose();
          if (child.material.roughnessMap) child.material.roughnessMap.dispose();
          child.material.dispose();
        }
      }
    });
    this.waypointMarkers = [];
    this.weatherLabels = [];
    this._weatherIconEntries = [];
    // The terrain material's `.map` (the satellite texture) was just disposed
    // above; drop our cached handle so a re-drape rebuilds a fresh one.
    this._satTexture = null;
    this._satTextureKey = null;
    this._surfaceMap = null;
    this._surfaceBumpMap = null;
    this._surfaceRoughMap = null;
    this.terrainMesh = null;
    this.routeLine = null;
    this.routeTube = null;
    this._routeStemGroup = null;
    this._routeTubeSegs = 0;
    this._routeLineSegs = 0;
    this.contourGroup = null;
    this.contourLabelGroup = null;
    this.waypointLabelGroup = null;
    this.weatherGroup = null;
    this.featureGroup = null;
    this.featureLabelGroup = null;
    this.landmarkGroup = null;
    this._windTurbineRotors = [];
    // The traversal above disposed + removed the catchment group; drop the handle
    // (the basin DATA is retained so _rebuildInPlace can redraw it).
    this._catchmentGroup = null;
    this._labelSprites = [];
    this._marqueeLabels = [];
    this._marqueeAccum = 0;
    this._landCoverField = null;
    this._subBiomeField = null;
    this._waterDistField = null;
    this._slopeField = null;
    this._aspectField = null;
    this._curvatureField = null;
    this._aoField = null;
    this.playerMarker = null;
    this.playerRing = null;
    this.playerTrail = null;
    this.playerPath = null;
    this._person = null;
    this._personParts = null;
    this._cursorGroup = null;
    this._cursorCone = null;
    this._cursorRing = null;
    this._cursorHeight = 0;
    this._pickables = [];
    this._lineMaterials = [];
    this._sun = null;
    this._sunTarget = null;
    this._moon = null;
    this._ambient = null;
    this._hemi = null;
    this._terrainSun = null;
    this._terrainSunTarget = null;
    this._terrainRim = null;
    this._terrainAmbient = null;
    this._terrainHemi = null;
    this._rain = null;
    this._snow = null;
    // The rigs' GPU resources were freed by the traversal above; drop the handle
    // so update() no-ops until the next build grows fresh rigs.
    this._weather3d = null;
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
    if (this._contextLost) return;

    this._animFrameId = requestAnimationFrame(() => this._animate());
    this.controls?.update();

    // One delta per frame (also avoids a progress jump after a long pause).
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this._playing && this.playerPath) {
      let reachedEnd = false;
      const now = performance.now();
      if (this._pauseUntil > now) {
        // Parked at a Relive waypoint stop: hold the playhead, keep the close-up
        // orbit and weather alive, resume automatically when the timer expires.
      } else {
        this._personPhase += dt * this._speed;
        const prev = this._progress;
        this._progress += dt * this._speed * 0.05;
        // Reached the next waypoint this frame → snap to it and begin the pause.
        const stops = this._waypointStops;
        if (this._nextStopIdx < stops.length && this._progress >= stops[this._nextStopIdx].u) {
          const stop = stops[this._nextStopIdx];
          this._nextStopIdx++;
          if (stop.u > prev && stop.u < 1) {
            this._progress = stop.u;
            this._pauseUntil = now + this._waypointPauseMs;
            this._orbitAngle = 0;
            if (this._onWaypointArrive) this._onWaypointArrive(stop.detail);
          }
        }
        if (this._progress >= 1) {
          this._progress = 1;
          this._playing = false;
          reachedEnd = true;
        }
      }
      this._updatePlayerPosition();
      this._updateFollowCamera(dt);
      if (this._onProgressChange) this._onProgressChange(this._progress);
      // The hiker walked to the end: stop playback and let the UI reset its
      // play/pause button. With the chase cam engaged, finish Relive-style on a
      // slow orbit around the final position (any grab or scrub cancels it).
      if (reachedEnd) {
        if (this._followCam && !this._followUserOverride && this.controls) {
          this.controls.autoRotate = true;
          this.controls.autoRotateSpeed = 0.6;
        }
        // Deal the finish card over the end-of-route orbit (metrics read at u=1).
        if (this._onWaypointArrive && this._endDetail) this._onWaypointArrive(this._endDetail);
        if (this._onPlayStateChange) this._onPlayStateChange(false);
      }
    }

    // Scroll long map-feature name labels (跑馬燈). Throttled to ~30fps so the
    // per-label canvas redraw + texture upload stays cheap on mobile.
    if (this._marqueeLabels.length) {
      this._marqueeAccum += dt;
      if (this._marqueeAccum >= 1 / 30) {
        this._updateMarqueeLabels(this._marqueeAccum);
        this._marqueeAccum = 0;
      }
    }

    // Weather keeps moving even while paused so a scrubbed-to frame still reads
    // as "raining/snowing", but stays subtle enough not to mask the terrain.
    this._updateWeatherParticles(dt);
    // Drive the volumetric 3D weather phenomena anchored at each weather point
    // (cloud drift, falling rain/snow, swirling fog, lightning). Distant rigs are
    // culled inside update() so a long route stays cheap.
    if (this._weather3d) this._weather3d.update(dt, this.camera);
    if (this._windTurbineRotors && this._windTurbineRotors.length && this.landmarkGroup?.visible) {
      for (const rotor of this._windTurbineRotors) rotor.rotation.z -= dt * 1.8;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
