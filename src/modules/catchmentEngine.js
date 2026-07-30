// Catchment (集水區) delineation from a single pour-point click.
//
// Pipeline: coarse flat probe (one request; a flat answer ends the run here) →
// sample the rest of the DEM grid around the click (Open-Meteo elevation) →
// priority-flood + ε sink fill → D8 flow directions → flow accumulation →
// snap the outlet to the local valley → reverse-BFS the upslope area (area and
// geomorphometry) → D∞ proportional-flow contribution field → iso-contour into
// lat/lng rings (the drawn divide).
//
// The boundary is NOT the traced raster staircase. D8 quantises flow to 8
// directions, so its catchment is a binary mask whose divide can only run along
// cell edges; smoothing that only rounds an artefact. Instead the divide is a
// level-set of a CONTINUOUS field (each cell's fraction of flow that reaches the
// outlet, from Tarboton D∞), which is defined between cell centres and is
// therefore located to sub-cell precision wherever the terrain — not the grid —
// parts the flow; the level itself is fitted so the ring encloses the area the
// D8 cell count reports. Cost is one extra O(N²) sweep over the sort we already
// do plus ~10 marching-squares passes, and zero extra network requests.
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

// --- Flat probe -------------------------------------------------------------
// A flat plain has no catchment to draw, so paying for the whole DEM before
// finding that out is wasted time: 6 elevation requests and the full flow
// analysis, all to end at `status:'flat'`. The FIRST request is therefore a
// 97-point probe — one chunk — and a confidently flat answer returns from it.
//
// The probe must not ALIAS: sampling the window on a 200 m lattice smooths real
// 100 m-scale corrugation into a plain (measured: a ±3 m, 380 m-wavelength
// surface the full guard rejects at 0.74 near-flat reads as 1.00 coarse). So the
// probe samples at NATIVE resolution instead, over a smaller area:
//   • a 9×9 stride-1 core, with slope evaluated on its inner 7×7 so every
//     evaluated cell still has all 8 neighbours — the exact measurement
//     isLargeFlat makes, just over ±3 cells instead of ±7;
//   • a sparse 16-point frame on the ±7 ring, so relief is still bounded across
//     the FULL window and a flat terrace ringed by hills cannot pass.
//
// Thresholds stay stricter than the full guard's (relief 6 m vs 8 m, near-flat
// 0.95 vs 0.85) because the probe sees a subset. Anything it is not sure about
// falls through to the full DEM and the unchanged isLargeFlat check, so the
// probe can only make the obvious cases fast — never invent a 平地.
//
// Its samples are real grid cells and are kept, so the fall-through path
// requests only the remaining 432 points: 6 requests total, as before.
const PROBE_CORE_R = 4;        // 9×9 native-resolution core
const PROBE_EVAL_R = 3;        // …slope evaluated on the inner 7×7 of it
const PROBE_FRAME_OFF = [-7, -4, 0, 4, 7];   // ±7 ring samples (pairs touching ±7)
const PROBE_RELIEF_M = 6;      // vs FLAT_RELIEF_M = 8 on the full grid
const PROBE_FLAT_FRAC = 0.95;  // vs FLAT_FRAC = 0.85

const PROBE_P = PROBE_CORE_R * 2 + 1;
const PROBE_CORE_CELLS = [];   // full-grid indices, row-major → a PROBE_P² grid
for (let dr = -PROBE_CORE_R; dr <= PROBE_CORE_R; dr++) {
  for (let dc = -PROBE_CORE_R; dc <= PROBE_CORE_R; dc++) PROBE_CORE_CELLS.push((MID + dr) * GRID_N + (MID + dc));
}
const PROBE_FRAME_CELLS = [];
for (const dr of PROBE_FRAME_OFF) {
  for (const dc of PROBE_FRAME_OFF) {
    if (Math.max(Math.abs(dr), Math.abs(dc)) === FLAT_WINDOW_R) PROBE_FRAME_CELLS.push((MID + dr) * GRID_N + (MID + dc));
  }
}
const PROBE_CELLS = [...PROBE_CORE_CELLS, ...PROBE_FRAME_CELLS];   // core first
const PROBE_SET = new Set(PROBE_CELLS);
const REST_CELLS = [];         // everything the probe skipped
for (let i = 0; i < GRID_N * GRID_N; i++) if (!PROBE_SET.has(i)) REST_CELLS.push(i);

// 8-neighbour offsets with planar distance in cells (1 cardinal, √2 diagonal).
const NB = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [1, 1, SQRT2],
];

// The 8 D∞ triangular facets (Tarboton 1997): [cardinal dr,dc, diagonal dr,dc].
// Each facet spans the centre cell, one cardinal neighbour and the diagonal
// neighbour adjacent to it; flow is split between those two by the facet's
// steepest-descent aspect angle.
const FACETS = [
  [0, 1, -1, 1], [-1, 0, -1, 1], [-1, 0, -1, -1], [0, -1, -1, -1],
  [0, -1, 1, -1], [1, 0, 1, -1], [1, 0, 1, 1], [0, 1, 1, 1],
];
const QUARTER_PI = Math.PI / 4;

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
 *   'ok' | 'flat' | 'empty' | 'error' | 'aborted'. On 'flat': `relief` (m across
 *   the window that settled it) and `source`. On 'ok': `outer` (ring of
 *   [lat,lng]), `holes` (rings), `outlet` [lat,lng], `outletEle`, `areaM2`,
 *   `cellCount`, `touchesBorder`, `source` ('api' | 'cached'), and the
 *   geomorphometry `minEle`, `maxEle`, `reliefM`, `meanSlopeDeg`, `maxSlopeDeg`,
 *   `flowLenM` (main-channel length, m) that feed the hydrology indicators.
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
    // 2a. One cheap request first — flat here means we never ask for the rest.
    let probe = null;
    try {
      probe = await fetchElevations(pick(lats, PROBE_CELLS), pick(lngs, PROBE_CELLS), signal);
    } catch (err) {
      if (err?.name === 'AbortError') return { status: 'aborted' };
      console.warn('Catchment flat probe failed:', err.message);
    }
    if (finiteFrac(probe) >= MIN_FINITE_FRAC) {
      const verdict = probeFlat(probe);
      if (verdict.flat) return { status: 'flat', relief: verdict.relief, source: 'api' };
    }
    // 2b. Not flat (or the probe was unusable) — fetch what the probe skipped and
    //     merge; the probe's samples are grid cells, so nothing is re-requested.
    try {
      const rest = await fetchElevations(pick(lats, REST_CELLS), pick(lngs, REST_CELLS), signal);
      raw = new Array(GRID_N * GRID_N).fill(null);
      PROBE_CELLS.forEach((g, k) => { raw[g] = probe ? probe[k] : null; });
      REST_CELLS.forEach((g, k) => { raw[g] = rest[k]; });
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
  // flowDist[i] = downstream distance from cell i to the outlet along D8, so its
  // maximum over the catchment approximates the main-channel length.
  const inSet = new Uint8Array(N * N);
  const flowDist = new Float64Array(N * N);
  const queue = [outlet];
  inSet[outlet] = 1;
  let touchesBorder = false;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const cr = (c / N) | 0, cc = c % N;
    // Row/col 0 and N-1 have no flow target (the D8 loop skips them), so the set
    // can never reach them — the effective window edge is one cell in.
    if (cr <= 1 || cr >= N - 2 || cc <= 1 || cc >= N - 2) touchesBorder = true;
    for (const [dr, dc, dcell] of NB) {
      const nr = cr + dr, nc = cc + dc;
      if (!inGrid(nr, nc)) continue;
      const ni = idx(nr, nc);
      if (!inSet[ni] && target[ni] === c) {
        inSet[ni] = 1;
        flowDist[ni] = flowDist[c] + dcell * SPACING_M;
        queue.push(ni);
      }
    }
  }

  const cellCount = queue.length;
  if (cellCount < MIN_CELLS) return { status: 'empty', source };

  // --- 7b. Geomorphometry over the catchment cells (feeds hydrology) ---------
  // Slope is steepest-descent on the real (hole-filled, pre-sink-fill) DEM.
  let minEle = Infinity, maxEle = -Infinity, slopeDegSum = 0, maxSlope = 0, flowLenM = 0;
  for (let i = 0; i < N * N; i++) {
    if (!inSet[i]) continue;
    const e = dem[i];
    if (e < minEle) minEle = e;
    if (e > maxEle) maxEle = e;
    const s = steepestSlope(dem, N, idx, inGrid, (i / N) | 0, i % N);   // m/m
    slopeDegSum += Math.atan(s) * 180 / Math.PI;
    if (s > maxSlope) maxSlope = s;
    if (flowDist[i] > flowLenM) flowLenM = flowDist[i];
  }
  const meanSlopeDeg = slopeDegSum / cellCount;
  const maxSlopeDeg = Math.atan(maxSlope) * 180 / Math.PI;
  const reliefM = maxEle - minEle;

  // --- 8. Continuous divide: D∞ contribution field → iso-contour -------------
  // Only the DRAWN divide comes from the continuous field; areaM2/cellCount and
  // the geomorphometry above stay on the D8 set, so every hydrology number is
  // bit-for-bit what it was — and the contour level is matched to that same cell
  // count, so the ring can't disagree with the area readout either.
  const mu = dinfContribution(z, N, idx, inGrid, order, outlet);
  const { outer, holes } = contourRings(mu, cellCount, N, idx, inGrid, latOf, lngOf);

  return {
    status: 'ok',
    outer,
    holes,
    outlet: [latOf((outlet / N) | 0), lngOf(outlet % N)],
    outletEle: dem[outlet],
    areaM2: cellCount * SPACING_M * SPACING_M,
    cellCount,
    minEle,
    maxEle,
    reliefM,
    meanSlopeDeg,
    maxSlopeDeg,
    flowLenM,
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

/** Values of `arr` at the given indices, in index order. */
function pick(arr, indices) {
  return indices.map((i) => arr[i]);
}

/** Relief (max − min) over the finite values of an array. */
function finiteRelief(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

/**
 * The flat guard asked of the probe: the same two questions as isLargeFlat — is
 * the window level, and is nearly all of it gently sloped — but relief comes
 * from the core plus the ±7 frame (the full window's extent) while slope comes
 * from the inner 7×7 of the core at native spacing (no aliasing, full
 * neighbourhoods). Returns the relief so the caller can report it.
 */
function probeFlat(probe) {
  const relief = finiteRelief(probe);
  if (!(relief <= PROBE_RELIEF_M)) return { flat: false, relief };

  const core = fillHoles(probe.slice(0, PROBE_CORE_CELLS.length), PROBE_P);
  const pIdx = (r, c) => r * PROBE_P + c;
  const pIn = (r, c) => r >= 0 && r < PROBE_P && c >= 0 && c < PROBE_P;
  const flatTan = Math.tan(FLAT_SLOPE_DEG * Math.PI / 180);
  let total = 0, flat = 0;
  for (let dr = -PROBE_EVAL_R; dr <= PROBE_EVAL_R; dr++) {
    for (let dc = -PROBE_EVAL_R; dc <= PROBE_EVAL_R; dc++) {
      total++;
      if (steepestSlope(core, PROBE_P, pIdx, pIn, PROBE_CORE_R + dr, PROBE_CORE_R + dc) < flatTan) flat++;
    }
  }
  return { flat: flat / total >= PROBE_FLAT_FRAC, relief };
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
 * D∞ (Tarboton 1997) proportional flow → `mu[i]` = the fraction of cell i's flow
 * that reaches the outlet. Each cell sends its flow to at most TWO adjacent
 * neighbours, split by the aspect angle of its steepest triangular facet, so
 * membership stops being 0/1: a cell that parts its flow 60/40 across a ridge
 * scores 0.6, and the 0.5 level-set lands exactly on the topographic divide.
 *
 * On the ε-filled DEM every flow edge is strictly downhill, so the flow graph is
 * a DAG ordered by elevation and the whole field solves in ONE ascending sweep
 * over the sort computed for the accumulation step — O(N²), no extra sort, no
 * iteration to convergence. (Where a facet is clamped to a pure cardinal or pure
 * diagonal the other neighbour carries weight 0, so it may safely be a cell that
 * has not been visited yet.)
 *
 * `mu ≥ 0.5` is automatically connected to the outlet: mu[i] is a convex
 * combination of its two downslope values, so at least one downslope neighbour
 * is ≥ mu[i] — every in-region cell has a non-decreasing chain to the outlet.
 * No island filtering is needed, and the outlet itself is always ≥ 0.5, so the
 * contour is never empty.
 */
function dinfContribution(z, N, idx, inGrid, order, outlet) {
  const mu = new Float64Array(N * N);
  mu[outlet] = 1;                                   // absorbing
  for (let k = order.length - 1; k >= 0; k--) {     // `order` is descending → ascend
    const i = order[k];
    if (i === outlet) continue;
    const r = (i / N) | 0, c = i % N;
    let bestS = 0, bestAng = 0, cardinal = -1, diagonal = -1;
    for (const [cr, cc, dr, dc] of FACETS) {
      const r1 = r + cr, c1 = c + cc, r2 = r + dr, c2 = c + dc;
      if (!inGrid(r1, c1) || !inGrid(r2, c2)) continue;   // window edge → no facet
      const i1 = idx(r1, c1), i2 = idx(r2, c2);
      const s1 = (z[i] - z[i1]) / SPACING_M;              // down the cardinal edge
      const s2 = (z[i1] - z[i2]) / SPACING_M;             // across, to the diagonal
      let ang = Math.atan2(s2, s1), s;
      if (ang <= 0) { ang = 0; s = s1; }                                    // all cardinal
      else if (ang >= QUARTER_PI) { ang = QUARTER_PI; s = (z[i] - z[i2]) / (SQRT2 * SPACING_M); }
      else s = Math.hypot(s1, s2);                                          // split
      if (s > bestS) { bestS = s; bestAng = ang; cardinal = i1; diagonal = i2; }
    }
    if (cardinal < 0) continue;                     // no downslope facet → stays 0
    const w = (QUARTER_PI - bestAng) / QUARTER_PI;  // share to the cardinal
    mu[i] = w * mu[cardinal] + (1 - w) * mu[diagonal];
  }
  return mu;
}

const RING_MIN_CELLS = 0.15;       // drop degenerate slivers (one cell ≈ 0.5)
const SIMPLIFY_TOL_CELLS = 0.12;   // Douglas–Peucker tolerance (~12 m)

/**
 * Choose the contour level so the ring encloses the same area the readout
 * reports: the continuous field decides the SHAPE, the D8 cell count decides the
 * SIZE. They have to agree — areaM2 comes from that cell count, so a ring drawn
 * at any other level would contradict the number printed beside it.
 *
 * Why not simply contour at 0.5 ("most of this cell's flow reaches the outlet"):
 * that only behaves where flow converges. Where it disperses, mu decays
 * multiplicatively upslope — every split multiplies by less than one — so hardly
 * any cell holds a majority and the basin collapses to a blob around the outlet:
 * measured at 3–35 % of the D8 area on rough synthetic terrain, against ~110 %
 * in a tight valley. The right level depends on how dispersive the terrain is.
 *
 * Level sets of mu are nested, so the enclosed area falls monotonically as the
 * level rises — bisection finds it. Bisecting over the SORTED mu values rather
 * than over [0,1] keeps the search well-conditioned when mu spans decades, and
 * bounds it at ~10 passes; each pass is one marching-squares sweep of 576
 * squares, which is noise next to the DEM fetch. Candidate levels sit midway
 * between two consecutive values so no crossing gets dragged onto a cell centre.
 *
 * Area is compared on the traced polygon, not the cell count: the level shifts
 * every crossing along its edge, so a region holding exactly N cells can enclose
 * ~0.8 N of area (measured) once the crossings pull inward.
 */
function fitLevelRings(mu, targetCells, N, idx, inGrid) {
  const vals = [];
  for (let i = 0; i < mu.length; i++) if (mu[i] > 0) vals.push(mu[i]);
  if (!vals.length) return [];
  vals.sort((a, b) => b - a);
  const levelAt = (k) => (vals[k - 1] + (k < vals.length ? vals[k] : 0)) / 2;

  let lo = 1, hi = vals.length, best = null, bestErr = Infinity;
  while (lo <= hi) {
    const k = (lo + hi) >> 1;
    const rings = traceLevel(mu, levelAt(k), N, idx, inGrid);
    const area = ringsArea(rings);
    if (rings.length && Math.abs(area - targetCells) < bestErr) {
      bestErr = Math.abs(area - targetCells);
      best = rings;
    }
    if (area < targetCells) lo = k + 1; else hi = k - 1;
  }
  return best || traceLevel(mu, levelAt(1), N, idx, inGrid);
}

/** Net enclosed area of a ring set in cells² (holes wind the other way). */
function ringsArea(rings) {
  let a = 0;
  for (const ring of rings) a += shoelace(ring);
  return Math.abs(a);
}

// Marching-squares segments per corner mask (NW=8, NE=4, SE=2, SW=1), oriented
// with the ≥level side on the LEFT. Edge ids: 0=top 1=right 2=bottom 3=left.
// Grid rows run north→south, so "left" in (col, −row) space is CCW in (lng, lat)
// — the positive sign the outer ring is keyed on downstream. Masks 5 and 10
// are ambiguous saddles and are resolved from the square's centre value.
const MS_TABLE = [
  [], [[2, 3]], [[1, 2]], [[1, 3]], [[0, 1]], null, [[0, 2]], [[0, 3]],
  [[3, 0]], [[2, 0]], null, [[1, 0]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];
const MS_SADDLE_5 = [[[0, 1], [2, 3]], [[0, 3], [2, 1]]];   // [centre<level, centre≥level]
const MS_SADDLE_10 = [[[3, 0], [1, 2]], [[1, 0], [3, 2]]];

/**
 * One marching-squares sweep of the `mu = level` iso-line → closed rings in
 * fractional (row, col) cell space.
 *
 * The lattice is the cell CENTRES, padded with zeros so every ring closes inside
 * the window, and each crossing is placed by linear interpolation of mu along
 * its edge. That interpolation is the whole point: because D∞ genuinely splits
 * flow near a divide, mu is not binary there, so the crossing lands where the
 * terrain parts the flow instead of on a cell edge. The staircase is gone at its
 * source rather than filtered out afterwards, and no separate ridge-crest
 * correction is needed (an earlier per-vertex nudge toward the higher neighbour
 * is now redundant — on synthetic terrain it only injected per-edge jitter,
 * tripling the ring's total turning).
 *
 * Cell space keeps simplification and smoothing in one isotropic metric, and
 * lets the level search compare areas in cells without touching geography.
 */
function traceLevel(mu, level, N, idx, inGrid) {
  const W2 = N + 2;                                   // lattice padded by one cell
  const val = (r, c) => (inGrid(r, c) ? mu[idx(r, c)] : 0);
  const idH = (r, c) => ((r + 1) * W2 + (c + 1)) * 2;
  const idV = (r, c) => ((r + 1) * W2 + (c + 1)) * 2 + 1;

  const pos = new Map();     // edge id → [rowF, colF]
  const link = new Map();    // directed: from edge id → to edge id

  // Where the level crosses this edge, clamped off the cell centres so the ring
  // stays simple even if the field is locally degenerate.
  const crossT = (vA, vB) => {
    const t = (level - vA) / (vB - vA);
    if (!Number.isFinite(t)) return 0.5;
    return Math.min(0.98, Math.max(0.02, t));
  };
  const putH = (r, c) => {
    const id = idH(r, c);
    if (!pos.has(id)) pos.set(id, [r, c + crossT(val(r, c), val(r, c + 1))]);
    return id;
  };
  const putV = (r, c) => {
    const id = idV(r, c);
    if (!pos.has(id)) pos.set(id, [r + crossT(val(r, c), val(r + 1, c)), c]);
    return id;
  };

  for (let r = -1; r < N; r++) {
    for (let c = -1; c < N; c++) {
      const nw = val(r, c), ne = val(r, c + 1), se = val(r + 1, c + 1), sw = val(r + 1, c);
      const mask = (nw >= level ? 8 : 0) | (ne >= level ? 4 : 0)
        | (se >= level ? 2 : 0) | (sw >= level ? 1 : 0);
      let segs = MS_TABLE[mask];
      if (segs === null) {                            // saddle → follow the centre
        const centreIn = (nw + ne + se + sw) / 4 >= level ? 1 : 0;
        segs = mask === 5 ? MS_SADDLE_5[centreIn] : MS_SADDLE_10[centreIn];
      }
      if (!segs.length) continue;
      // 0=top 1=right 2=bottom 3=left, as lattice edges of this square.
      const edge = [() => putH(r, c), () => putV(r, c + 1), () => putH(r + 1, c), () => putV(r, c)];
      for (const [from, to] of segs) link.set(edge[from](), edge[to]());
    }
  }

  const rings = [];
  const seen = new Set();
  for (const start of link.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      ring.push(pos.get(cur));
      const nxt = link.get(cur);
      if (nxt === undefined) break;                   // defensive: open contour
      cur = nxt;
    }
    if (ring.length >= 3 && Math.abs(shoelace(ring)) >= RING_MIN_CELLS) rings.push(ring);
  }
  return rings;
}

/**
 * Fit the level to the reported area, then simplify, smooth and project the
 * rings to [lat,lng]. Douglas–Peucker before Chaikin means the smoothing pass
 * runs on the shape's real corners (and the ring ends up with far fewer
 * vertices than the old staircase did, which matters when a route draws dozens
 * of basins at once).
 */
function contourRings(mu, targetCells, N, idx, inGrid, latOf, lngOf) {
  const rings = fitLevelRings(mu, targetCells, N, idx, inGrid);
  if (!rings.length) return { outer: [], holes: [] };

  const pts = rings.map((ring) => chaikinSmooth(simplifyRing(ring, SIMPLIFY_TOL_CELLS), BOUNDARY_SMOOTH_ITERS)
    .map(([rF, cF]) => [latOf(rF), lngOf(cF)]));

  // Largest ring is the catchment, the rest are holes; normalise its winding to
  // the positive (CCW) sign the caller keys the outer/hole split on. Only rings
  // wound the OTHER way are holes: mu ≥ level is connected to the outlet, so a
  // second same-wound ring can only come from a saddle the centre-value rule
  // split apart — and the caller renders every extra ring as a hole, so passing
  // one on would bite a chunk out of the basin.
  const areas = pts.map(signedArea);
  let oi = 0;
  for (let i = 1; i < areas.length; i++) if (Math.abs(areas[i]) > Math.abs(areas[oi])) oi = i;
  const flip = areas[oi] < 0;
  const fix = (p) => (flip ? p.slice().reverse() : p);
  const holes = pts.filter((_, i) => i !== oi && (areas[i] < 0) !== flip).map(fix);
  return { outer: fix(pts[oi]), holes };
}

/** Shoelace area in whatever units the ring is expressed in (sign = winding). */
function shoelace(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return a / 2;
}

/**
 * Douglas–Peucker on a CLOSED ring, tolerance in cells. The contour already
 * follows the terrain, so this only drops vertices that say nothing (long runs
 * along a straight divide, sub-tolerance wobble in the mu field) — it keeps
 * every real corner, unlike a fixed-stride resample. Split at the vertex
 * farthest from pts[0] so the two anchors are genuine extremes of the ring;
 * simplifying a closed loop against a single anchor can otherwise collapse it.
 */
function simplifyRing(pts, tol) {
  const n = pts.length;
  if (n < 6) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const head = dpSimplify(pts.slice(0, far + 1), tol);
  const tail = dpSimplify(pts.slice(far).concat([pts[0]]), tol);
  const out = head.slice(0, -1).concat(tail.slice(0, -1));
  return out.length >= 3 ? out : pts;
}

/** Douglas–Peucker on an open polyline; both endpoints are always kept. */
function dpSimplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const tol2 = tol * tol;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const [ay, ax] = pts[lo], [by, bx] = pts[hi];
    const dy = by - ay, dx = bx - ax;
    const len2 = dy * dy + dx * dx;
    let worst = -1, wi = -1;
    for (let i = lo + 1; i < hi; i++) {
      const [py, px] = pts[i];
      // Perpendicular distance², degenerating to point distance² on a null span.
      const cross = (py - ay) * dx - (px - ax) * dy;
      const d2 = len2 > 0 ? (cross * cross) / len2 : (py - ay) ** 2 + (px - ax) ** 2;
      if (d2 > worst) { worst = d2; wi = i; }
    }
    if (worst > tol2) {
      keep[wi] = 1;
      stack.push([lo, wi], [wi, hi]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const BOUNDARY_SMOOTH_ITERS = 2;   // Chaikin passes that round the remaining corners

/**
 * Chaikin corner-cutting on a CLOSED ring (first vertex not repeated), run AFTER
 * simplification so only the shape's real corners get rounded rather than every
 * vertex along a straight run. This is the finishing pass, not the mechanism:
 * the contour it receives is already a continuous, sub-cell divide, so Chaikin
 * only takes the residual angularity off it. Each pass replaces every edge with
 * its ¼ and ¾ points; winding (shoelace sign) and simplicity are preserved, so
 * the outer/hole classification and every downstream point-in-ring test are
 * unaffected, and the reported area comes from the cell count, not this ring.
 */
function chaikinSmooth(ring, iters) {
  let pts = ring;
  for (let it = 0; it < iters && pts.length >= 3; it++) {
    const n = pts.length;
    const next = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      next[i * 2] = [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25];
      next[i * 2 + 1] = [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75];
    }
    pts = next;
  }
  return pts;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][1] * pts[j][0] - pts[j][1] * pts[i][0];
  }
  return a / 2;
}
