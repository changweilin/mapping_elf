import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

    this._abortController = null;
    this._aborted = false;
    this._loading = false;
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

  // cb({ active, percent, title, detail, aborted, error })
  onLoad(cb) {
    this._onLoad = cb;
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
    if (this.contourLabelGroup) this.contourLabelGroup.visible = visible;
  }

  setWeatherVisible(visible) {
    if (this.weatherGroup) this.weatherGroup.visible = visible;
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
    const { coords, elevations, waypoints, weatherPoints, routeStats } = routeData;
    if (!coords || coords.length < 2) return;

    this.routePoints = coords;
    this.routeElevations = elevations || coords.map(() => 0);

    const bbox = this._computeBbox(coords);

    this._aborted = false;
    this._abortController = new AbortController();
    this._emitLoad({ active: true, percent: 3, title: '建立地形模型', detail: '下載高程資料中…' });

    let gridData;
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

    this._grid = gridData;
    this._bbox = bbox;

    if (!this.scene) {
      this._initScene();
    }

    this._emitLoad({ active: true, percent: 88, title: '建立地形模型', detail: '計算等高線與軌跡…' });

    this._clearScene();
    this._createTerrain(gridData, bbox);
    this._createContours(gridData, bbox);
    this._createRoutePath(coords, elevations, bbox);
    this._createWaypoints(waypoints, bbox);
    this._createWeatherLabels(weatherPoints, bbox);
    this._setupPlayer(coords, elevations, bbox);
    this._setupLighting();

    if (this._onInfo) this._onInfo(this._terrainInfo);

    const cx = (bbox.minLng + bbox.maxLng) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;
    const span = Math.max(
      haversineDistance([bbox.minLat, bbox.minLng], [bbox.minLat, bbox.maxLng]),
      haversineDistance([bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.minLng])
    );
    const dist = Math.max(span * 2.5, 2000);

    // _latLngToLocal expects (lat, lng): cy is the centre latitude, cx the centre longitude.
    const center = this._latLngToLocal(cy, cx, 0, bbox);
    this.controls.target.set(center.x, center.y, center.z);
    this.camera.position.set(center.x + dist * 0.3, center.y + dist * 0.4, center.z + dist);
    this.controls.update();

    this._setupResizeHandler();

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
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffeedd, 1.2);
    dir.position.set(10000, 30000, 10000);
    dir.castShadow = true;
    const d = 50000;
    dir.shadow.camera.left = -d;
    dir.shadow.camera.right = d;
    dir.shadow.camera.top = d;
    dir.shadow.camera.bottom = -d;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    this.scene.add(dir);

    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-10000, 10000, -10000);
    this.scene.add(fill);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a2a1a, 0.4);
    this.scene.add(hemi);
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
    const target = range / 14; // aim for ~14 contour bands
    const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
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
    const majorEvery = 5;

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

    if (minorVerts.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(minorVerts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xe8d9b5,
        transparent: true,
        opacity: 0.22,
      });
      this.contourGroup.add(new THREE.LineSegments(geo, mat));
    }

    if (majorVerts.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(majorVerts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xfff0c2,
        transparent: true,
        opacity: 0.6,
      });
      this.contourGroup.add(new THREE.LineSegments(geo, mat));
    }

    this.scene.add(this.contourGroup);

    for (const anchor of labelAnchors) {
      const label = this._createLabel(`${Math.round(anchor.level)} m`, anchor.point.x, anchor.point.y, anchor.point.z, 0xfff0c2);
      label.scale.set(40, 14, 1);
      this.contourLabelGroup.add(label);
    }
    this.scene.add(this.contourLabelGroup);
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

  _createRoutePath(coords, elevations, bbox) {
    if (!coords || coords.length < 2) return;

    const routeColor = new THREE.Color(0x00d4ff);
    const pts = coords.map(([lat, lng], i) => {
      const elev = elevations?.[i] ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + 5, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    });

    const curve = new THREE.CatmullRomCurve3(pts);

    // Tube geometry for visible path
    const tubeGeo = new THREE.TubeGeometry(curve, Math.min(pts.length * 2, 200), 3, 6, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: routeColor,
      emissive: routeColor,
      emissiveIntensity: 0.3,
      roughness: 0.4,
      metalness: 0.3,
    });
    this.routeTube = new THREE.Mesh(tubeGeo, tubeMat);
    this.routeTube.castShadow = true;
    this.scene.add(this.routeTube);

    // Thin glow line
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x88eeff, transparent: true, opacity: 0.4 });
    this.routeLine = new THREE.Line(lineGeo, lineMat);
    this.scene.add(this.routeLine);

    // Start/end markers
    const dotMat = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.5 });
    const startDot = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 16), dotMat);
    startDot.position.copy(pts[0]);
    this.scene.add(startDot);

    const endDotMat = new THREE.MeshStandardMaterial({ color: 0xff4466, emissive: 0xff4466, emissiveIntensity: 0.5 });
    const endDot = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 16), endDotMat);
    endDot.position.copy(pts[pts.length - 1]);
    this.scene.add(endDot);
  }

  _createWaypoints(waypoints, bbox) {
    if (!waypoints || waypoints.length === 0) return;

    waypoints.forEach((wp, i) => {
      const [lat, lng] = wp.coords || wp;
      const elev = wp.elevation ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + 15, bbox);

      const color = i === 0 ? 0x00ff88 : (i === waypoints.length - 1 ? 0xff4466 : 0xffaa44);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 16), mat);
      sphere.position.set(p.x, p.y, p.z);
      sphere.castShadow = true;
      this.scene.add(sphere);
      this.waypointMarkers.push(sphere);

      const label = this._createLabel(wp.label || `WP${i + 1}`, p.x, p.y + 20, p.z, color);
      this.scene.add(label);
    });
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

      let icon = '☀️';
      if (pt.weatherCode != null) {
        const code = Number(pt.weatherCode);
        if (code >= 200 && code < 300) icon = '⛈️';
        else if (code >= 300 && code < 400) icon = '🌦️';
        else if (code >= 500 && code < 600) icon = '🌧️';
        else if (code >= 600 && code < 700) icon = '❄️';
        else if (code >= 700 && code < 800) icon = '🌫️';
        else if (code === 800) icon = '☀️';
        else if (code > 800) icon = '☁️';
      }

      const temp = pt.temperature != null ? `${Math.round(pt.temperature)}°C` : '';
      const text = [icon, temp].filter(Boolean).join(' ');
      if (!text) return;

      const label = this._createLabel(text, p.x, p.y, p.z, 0x44aaff);
      this.weatherGroup.add(label);
      this.weatherLabels.push(label);
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

    const pts = coords.map(([lat, lng], i) => {
      const elev = elevations?.[i] ?? 0;
      const p = this._latLngToLocal(lat, lng, elev + 20, bbox);
      return new THREE.Vector3(p.x, p.y, p.z);
    });

    this.playerPath = new THREE.CatmullRomCurve3(pts);

    // Player marker
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      emissive: 0xff4400,
      emissiveIntensity: 0.8,
    });
    this.playerMarker = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 16), glowMat);
    this.playerMarker.castShadow = true;
    this.scene.add(this.playerMarker);

    // Progress ring
    const ringGeo = new THREE.RingGeometry(14, 18, 32);
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
    this._playerLight = new THREE.PointLight(0xff6600, 0.5, 500);
    this.scene.add(this._playerLight);
  }

  _updatePlayerPosition() {
    if (!this.playerPath || !this.playerMarker) return;

    const pt = this.playerPath.getPoint(this._progress);
    this.playerMarker.position.copy(pt);

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
            trailPts.push(this.playerPath.getPoint(t));
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
    };
    window.addEventListener('resize', handler);
    this._resizeHandler = handler;
  }

  _animate() {
    if (!this.container || this.container.classList.contains('hidden')) return;
    if (!this.renderer || !this.scene || !this.camera) return;

    this._animFrameId = requestAnimationFrame(() => this._animate());
    this.controls?.update();

    if (this._playing && this.playerPath) {
      const dt = this.clock.getDelta();
      this._progress += dt * this._speed * 0.05;
      if (this._progress >= 1) {
        this._progress = 1;
        this._playing = false;
      }
      this._updatePlayerPosition();
      if (this._onProgressChange) this._onProgressChange(this._progress);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
