// Catchment (集水區) delineation from a single pour-point click.
//
// Pipeline: sample a DEM grid around the click (Open-Meteo elevation) →
// priority-flood + ε sink fill → D8 flow directions → flow accumulation →
// snap the outlet to the local valley → reverse-BFS the upslope area →
// trace the raster boundary into lat/lng rings.
//
// The DEM source is Copernicus GLO-90 (~90 m native), so a 100 m grid neither
// over- nor under-samples it. Everything here is [lat, lng] like the rest of
// the app; the elevation endpoint takes lat/lng as separate params, so there is
// no GeoJSON coordinate-swap boundary to worry about (see INC-101).

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';

const GRID_N = 23;            // cells per side (odd → click sits on a cell centre)
const SPACING_M = 100;        // grid spacing; ~native DEM resolution
const CHUNK = 100;            // Open-Meteo elevation batch limit per request
const SNAP_R = 2;             // outlet snaps to the max-accumulation cell within ±2 cells
const MIN_CELLS = 2;          // fewer than this → not a meaningful catchment
const MIN_FINITE_FRAC = 0.6;  // below this share of usable samples the DEM is junk
const FETCH_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 3;       // per-chunk retries before that band becomes holes

// "Large flat area" guard, evaluated on the RAW DEM around the click.
const FLAT_WINDOW_R = 7;      // ~700 m radius window
const FLAT_RELIEF_M = 8;      // ≤8 m of relief across ~1.4 km ⇒ genuinely flat
const FLAT_SLOPE_DEG = 2;     // a cell is "near-flat" below this steepest-descent slope
const FLAT_FRAC = 0.85;       // …and this share of the window must be near-flat

const FILL_EPS = 0.001;       // ε to guarantee drainage across filled depressions
const SQRT2 = Math.SQRT2;
const MID = (GRID_N - 1) / 2;

// 8-neighbour offsets with planar distance in cells (1 cardinal, √2 diagonal).
const NB = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [1, 1, SQRT2],
];

/** Minimal binary min-heap keyed by elevation, FIFO tie-break for a stable fill. */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(elev, idx) {
    const a = this.a;
    a.push([elev, idx]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l][0] < a[s][0]) s = l;
        if (r < a.length && a[r][0] < a[s][0]) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

/**
 * Delineate the catchment draining to a clicked point.
 * @param {number} clat centre latitude
 * @param {number} clng centre longitude
 * @param {{ signal?: AbortSignal, offlineDem?: {grid:Array<Array<number|null>>, bbox:{minLat:number,maxLat:number,minLng:number,maxLng:number}} }} [opts]
 *   `offlineDem` is a cached 3D-terrain grid whose bbox contains the click; it is
 *   used offline-first, or as a fallback when the elevation API fails.
 * @returns {Promise<Object>} `{ status }` where status is one of
 *   'ok' | 'flat' | 'empty' | 'error' | 'aborted'. On 'ok': `outer` (ring of
 *   [lat,lng]), `holes` (rings), `outlet` [lat,lng], `outletEle`, `areaM2`,
 *   `cellCount`, `touchesBorder`, and `source` ('api' | 'cached').
 */
export async function computeCatchment(clat, clng, { signal, offlineDem } = {}) {
  const dLat = SPACING_M / 111320;
  const dLng = SPACING_M / (111320 * Math.cos(clat * Math.PI / 180));
  const latOf = (r) => clat + (MID - r) * dLat;      // r=0 is the northern edge
  const lngOf = (c) => clng + (c - MID) * dLng;

  // --- 1. Sample the DEM grid -------------------------------------------------
  const lats = [], lngs = [];
  for (let r = 0; r < GRID_N; r++) {
    for (let c = 0; c < GRID_N; c++) { lats.push(latOf(r)); lngs.push(lngOf(c)); }
  }

  // --- 2. Acquire elevations: cached terrain offline, else robust API fetch ---
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  let raw = null, source = 'api';
  if (offline && offlineDem) {
    raw = sampleOfflineDem(offlineDem, lats, lngs);
    source = 'cached';
  }
  if (finiteFrac(raw) < MIN_FINITE_FRAC) {
    try {
      raw = await fetchElevations(lats, lngs, signal);
      source = 'api';
    } catch (err) {
      if (err?.name === 'AbortError') return { status: 'aborted' };
      console.warn('Catchment elevation fetch failed:', err.message);
      raw = null;
    }
    // API came back unusable but there's cached terrain under the click.
    if (finiteFrac(raw) < MIN_FINITE_FRAC && offlineDem) {
      const off = sampleOfflineDem(offlineDem, lats, lngs);
      if (finiteFrac(off) >= MIN_FINITE_FRAC) { raw = off; source = 'cached'; }
    }
  }
  if (finiteFrac(raw) < MIN_FINITE_FRAC) return { status: 'error' };

  const N = GRID_N;
  const idx = (r, c) => r * N + c;
  const inGrid = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

  const dem = fillHoles(raw, N);   // Float64Array with holes interpolated away

  // --- 3. Large-flat-area guard (DEM window around the click) -----------------
  if (isLargeFlat(dem, N, idx, inGrid)) {
    return { status: 'flat', relief: windowRelief(dem, N, idx), source };
  }

  // --- 4. Priority-flood + ε sink fill ---------------------------------------
  const z = Float64Array.from(dem);
  const done = new Uint8Array(N * N);
  const heap = new MinHeap();
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (r === 0 || r === N - 1 || c === 0 || c === N - 1) {
        const i = idx(r, c);
        done[i] = 1;
        heap.push(z[i], i);
      }
    }
  }
  while (heap.size) {
    const [, ci] = heap.pop();
    const cr = (ci / N) | 0, cc = ci % N;
    for (const [dr, dc] of NB) {
      const nr = cr + dr, nc = cc + dc;
      if (!inGrid(nr, nc)) continue;
      const ni = idx(nr, nc);
      if (done[ni]) continue;
      if (z[ni] <= z[ci]) z[ni] = z[ci] + FILL_EPS;
      done[ni] = 1;
      heap.push(z[ni], ni);
    }
  }

  // --- 4. D8 flow target on the filled DEM -----------------------------------
  const target = new Int32Array(N * N).fill(-1);
  for (let r = 1; r < N - 1; r++) {
    for (let c = 1; c < N - 1; c++) {
      const i = idx(r, c);
      let best = 0, bestTo = -1;
      for (const [dr, dc, dist] of NB) {
        const ni = idx(r + dr, c + dc);
        const slope = (z[i] - z[ni]) / dist;
        if (slope > best) { best = slope; bestTo = ni; }
      }
      target[i] = bestTo;   // -1 only if truly pit-free-flat (fill prevents this)
    }
  }

  // --- 5. Flow accumulation (descending-elevation sweep) ---------------------
  const order = Array.from({ length: N * N }, (_, i) => i).sort((a, b) => z[b] - z[a]);
  const acc = new Float64Array(N * N).fill(1);
  for (const i of order) if (target[i] >= 0) acc[target[i]] += acc[i];

  // --- 6. Snap the outlet to the local valley (max accumulation nearby) ------
  const clickCell = idx(Math.round(MID), Math.round(MID));
  let outlet = clickCell, bestAcc = -1;
  for (let dr = -SNAP_R; dr <= SNAP_R; dr++) {
    for (let dc = -SNAP_R; dc <= SNAP_R; dc++) {
      const r = Math.round(MID) + dr, c = Math.round(MID) + dc;
      if (!inGrid(r, c)) continue;
      const i = idx(r, c);
      if (acc[i] > bestAcc) { bestAcc = acc[i]; outlet = i; }
    }
  }

  // --- 7. Upslope contributing area: reverse-BFS along flow directions -------
  const inSet = new Uint8Array(N * N);
  const queue = [outlet];
  inSet[outlet] = 1;
  let touchesBorder = false;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const cr = (c / N) | 0, cc = c % N;
    if (cr === 0 || cr === N - 1 || cc === 0 || cc === N - 1) touchesBorder = true;
    for (const [dr, dc] of NB) {
      const nr = cr + dr, nc = cc + dc;
      if (!inGrid(nr, nc)) continue;
      const ni = idx(nr, nc);
      if (!inSet[ni] && target[ni] === c) { inSet[ni] = 1; queue.push(ni); }
    }
  }

  const cellCount = queue.length;
  if (cellCount < MIN_CELLS) return { status: 'empty', source };

  // --- 8. Trace the raster boundary into lat/lng rings -----------------------
  const cornerLat = (cr) => latOf(0) + dLat / 2 - cr * dLat;
  const cornerLng = (cc) => lngOf(0) - dLng / 2 + cc * dLng;
  const { outer, holes } = traceBoundary(inSet, N, idx, inGrid, cornerLat, cornerLng);

  return {
    status: 'ok',
    outer,
    holes,
    outlet: [latOf((outlet / N) | 0), lngOf(outlet % N)],
    outletEle: dem[outlet],
    areaM2: cellCount * SPACING_M * SPACING_M,
    cellCount,
    touchesBorder,
    source,
  };
}

/** Share of finite samples in an elevation array (0 when null/empty). */
function finiteFrac(arr) {
  if (!Array.isArray(arr) && !ArrayBuffer.isView(arr)) return 0;
  if (!arr.length) return 0;
  let n = 0;
  for (const v of arr) if (Number.isFinite(v)) n++;
  return n / arr.length;
}

const abortError = () => { const e = new Error('Aborted'); e.name = 'AbortError'; return e; };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch() with a hard timeout that still honours an external abort signal. */
function fetchWithTimeout(url, signal, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', relay, { once: true });
  }
  return fetch(url, { signal: ctrl.signal }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  });
}

/**
 * Batch the elevation endpoint in ≤100-point chunks. Mirrors the 3D terrain
 * viewer's resilience: per-chunk timeout, retries with 429 back-off, and a
 * failed chunk degrades to holes (null) rather than sinking the whole run. Only
 * an external abort propagates as an error.
 */
async function fetchElevations(lats, lngs, signal) {
  const out = [];
  for (let i = 0; i < lats.length; i += CHUNK) {
    if (signal?.aborted) throw abortError();
    const chunkLen = Math.min(CHUNK, lats.length - i);
    const la = lats.slice(i, i + chunkLen).map((v) => v.toFixed(5)).join(',');
    const ln = lngs.slice(i, i + chunkLen).map((v) => v.toFixed(5)).join(',');
    const url = `${ELEVATION_API}?latitude=${la}&longitude=${ln}`;

    let got = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !got; attempt++) {
      if (signal?.aborted) throw abortError();
      try {
        const resp = await fetchWithTimeout(url, signal, FETCH_TIMEOUT_MS);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.elevation)) got = data.elevation;
          else await delay(500);
        } else if (resp.status === 429) {
          await delay((attempt + 1) * 1000);        // back off a rate limit
        } else {
          await delay(500);
        }
      } catch (err) {
        if (signal?.aborted) throw abortError();     // user superseded — bail
        await delay(500);                            // timeout / network — retry
      }
    }
    if (got && got.length === chunkLen) out.push(...got);
    else out.push(...new Array(chunkLen).fill(null));  // band lost → holes
  }
  return out;
}

/** Bilinearly sample a cached 25×25 terrain grid at each query lat/lng. */
function sampleOfflineDem(offlineDem, lats, lngs) {
  const grid = offlineDem?.grid, b = offlineDem?.bbox;
  if (!Array.isArray(grid) || !grid.length || !b) return null;
  const G = grid.length;
  const spanLat = b.maxLat - b.minLat, spanLng = b.maxLng - b.minLng;
  if (!(spanLat > 0) || !(spanLng > 0)) return null;
  const out = new Array(lats.length).fill(null);
  for (let k = 0; k < lats.length; k++) {
    const fy = (lats[k] - b.minLat) / spanLat * (G - 1);
    const fx = (lngs[k] - b.minLng) / spanLng * (G - 1);
    if (fy < 0 || fy > G - 1 || fx < 0 || fx > G - 1) continue;   // outside bbox
    const i0 = Math.floor(fy), j0 = Math.floor(fx);
    const i1 = Math.min(i0 + 1, G - 1), j1 = Math.min(j0 + 1, G - 1);
    const ty = fy - i0, tx = fx - j0;
    const a = grid[i0]?.[j0], bb = grid[i0]?.[j1], c = grid[i1]?.[j0], d = grid[i1]?.[j1];
    if (![a, bb, c, d].every(Number.isFinite)) continue;         // touches a hole
    out[k] = a * (1 - tx) * (1 - ty) + bb * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
  return out;
}

/** Interpolate null holes away (iterative neighbour mean) → all-finite DEM. */
function fillHoles(raw, N) {
  const z = Array.from(raw, (v) => (Number.isFinite(v) ? v : null));
  let missing = [];
  for (let i = 0; i < z.length; i++) if (z[i] === null) missing.push(i);
  if (!missing.length) return Float64Array.from(z);

  const finite = z.filter((v) => v !== null);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  for (let iter = 0; iter < 50 && missing.length; iter++) {
    const next = [];
    for (const i of missing) {
      const r = (i / N) | 0, c = i % N;
      let s = 0, n = 0;
      for (const [dr, dc] of NB) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const v = z[nr * N + nc];
        if (v !== null) { s += v; n++; }
      }
      if (n > 0) z[i] = s / n; else next.push(i);
    }
    missing = next;
  }
  for (const i of missing) z[i] = mean;              // fully-isolated → global mean
  return Float64Array.from(z);
}

/** Steepest-descent slope magnitude (rise/run) on the raw DEM at cell (r,c). */
function steepestSlope(raw, N, idx, inGrid, r, c) {
  const i = idx(r, c);
  let best = 0;
  for (const [dr, dc, dist] of NB) {
    const nr = r + dr, nc = c + dc;
    if (!inGrid(nr, nc)) continue;
    const slope = (raw[i] - raw[idx(nr, nc)]) / (dist * SPACING_M);
    if (slope > best) best = slope;
  }
  return best;
}

function windowRelief(raw, N, idx) {
  let lo = Infinity, hi = -Infinity;
  const c0 = Math.round(MID);
  for (let dr = -FLAT_WINDOW_R; dr <= FLAT_WINDOW_R; dr++) {
    for (let dc = -FLAT_WINDOW_R; dc <= FLAT_WINDOW_R; dc++) {
      const v = raw[idx(c0 + dr, c0 + dc)];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return hi - lo;
}

/** True when the window around the click is a broad, near-level surface. */
function isLargeFlat(raw, N, idx, inGrid) {
  const c0 = Math.round(MID);
  const flatTan = Math.tan(FLAT_SLOPE_DEG * Math.PI / 180);
  let total = 0, flat = 0;
  for (let dr = -FLAT_WINDOW_R; dr <= FLAT_WINDOW_R; dr++) {
    for (let dc = -FLAT_WINDOW_R; dc <= FLAT_WINDOW_R; dc++) {
      total++;
      if (steepestSlope(raw, N, idx, inGrid, c0 + dr, c0 + dc) < flatTan) flat++;
    }
  }
  return windowRelief(raw, N, idx) <= FLAT_RELIEF_M && flat / total >= FLAT_FRAC;
}

/**
 * March the boundary of the catchment raster into rings, CCW with the interior
 * on the left, so shoelace sign separates the outer ring (positive) from holes.
 */
function traceBoundary(inSet, N, idx, inGrid, cornerLat, cornerLng) {
  const inCatch = (r, c) => inGrid(r, c) && inSet[idx(r, c)];
  const node = (cr, cc) => cr * (N + 1) + cc;
  const outAdj = new Map();          // directed corner-graph, interior on the left
  const addEdge = (a, b) => {
    if (!outAdj.has(a)) outAdj.set(a, []);
    outAdj.get(a).push(b);
  };
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!inSet[idx(r, c)]) continue;
      if (!inCatch(r - 1, c)) addEdge(node(r, c + 1), node(r, c));          // N: NE→NW
      if (!inCatch(r + 1, c)) addEdge(node(r + 1, c), node(r + 1, c + 1));  // S: SW→SE
      if (!inCatch(r, c - 1)) addEdge(node(r, c), node(r + 1, c));          // W: NW→SW
      if (!inCatch(r, c + 1)) addEdge(node(r + 1, c + 1), node(r, c + 1));  // E: SE→NE
    }
  }

  const rings = [];
  for (const [start, outs] of outAdj) {
    while (outs.length) {
      const ring = [];
      let cur = start;
      for (;;) {
        const nexts = outAdj.get(cur);
        if (!nexts || !nexts.length) break;   // defensive: shouldn't happen
        const nxt = nexts.pop();
        ring.push(cur);
        cur = nxt;
        if (cur === start) break;
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }

  const toLatLng = (ring) => simplifyRing(ring.map((n) => {
    const cr = (n / (N + 1)) | 0, cc = n % (N + 1);
    return [cornerLat(cr), cornerLng(cc)];
  }));

  let outer = null, outerArea = -Infinity;
  const holes = [];
  for (const ring of rings) {
    const pts = toLatLng(ring);
    const a = signedArea(pts);
    if (a >= 0) {                       // CCW → outer candidate
      if (a > outerArea) {
        if (outer) holes.push(outer);   // demote a smaller earlier candidate
        outer = pts;
        outerArea = a;
      } else holes.push(pts);
    } else holes.push(pts);             // CW → hole
  }
  return { outer: outer || [], holes };
}

/** Drop collinear vertices along the axis-aligned raster boundary. */
function simplifyRing(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 1e-12) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][1] * pts[j][0] - pts[j][1] * pts[i][0];
  }
  return a / 2;
}
