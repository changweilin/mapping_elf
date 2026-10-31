/**
 * Mapping Elf — Layered Shape Route Solver (shapeLayeredSolver.js)
 *
 * Replaces the "航點 + 逐段弦走廊 A*" heuristic with a single global
 * shortest-path solve on the product graph  G' = G_road × P,  where P is the
 * drawn shape's arc length discretised into K progress buckets.
 *
 *   state       (v, k)            v = road node, k = shape progress bucket
 *   transition  (u,k) → (v,k')    along road edge u→v of length L,  k ≤ k' ≤ k+Δ
 *
 * Why this formulation rather than waypoints plus per-leg routing:
 *  - Fidelity is integrated along EVERY edge against the actual sub-arc of the
 *    drawn curve, never against the straight chord between two waypoints, so
 *    curvature survives without having to spend waypoints on it. Waypoint
 *    snapping disappears entirely — only the anchor is snapped.
 *  - Progress is monotone, so a node can only be revisited at a LATER bucket.
 *    Dijkstra settles each state once, so an out-and-back spur inside a bucket
 *    cannot be produced at all, while genuinely self-crossing drawings (star,
 *    figure-8) still route correctly. Restricting the corridor to 2-core nodes
 *    makes cross-bucket spurs cost double length, so they almost never win.
 *  - All costs are non-negative and the search is plain Dijkstra, so the result
 *    is the exact optimum of the stated objective and is deterministic: no
 *    inadmissible heuristic, no leg-ordering bias, no accept/reject rollback.
 *  - Mileage is a single Lagrangian multiplier λ on edge length. Route length
 *    is monotone non-increasing in λ, so bisection converges on the target
 *    distance instead of rescaling the ring and re-routing everything.
 *
 * Pure module: takes an already-fetched RoadNetworkGraph; no DOM, no fetch.
 * Everything runs in the graph's local planar XY metres — graph.geoToXy /
 * graph.xyToGeo are the only geo boundary, mirroring the routeEngine rule.
 */
import { resampleClosedStroke, ringRouteDeviation, shapeSimilarity } from './shapeRoutePlanner.js';

export const LAYERED_DEFAULTS = {
  bucketTargetM: 72,        // nominal shape arc length per progress bucket
  minBuckets: 24,
  maxBuckets: 192,
  corridorRadiusM: null,    // null → 0.9 × bucketLen (see buildLayeredField)
  corridorScale: 1,         // retry multiplier applied to the derived radius
  deltaMax: 2,              // max buckets a single transition may advance
  weightShape: 2.6,         // deviation from the sub-arc, normalised by corridor radius
  weightDir: 0.65,          // 1 − cos(edge, sub-arc tangent)
  weightSkip: 6.0,          // shape arc covered without road travel
  // λ scales edge length against fidelity. λ → −1 pays almost nothing for
  // distance, so the solver buys fidelity with mileage; large λ collapses to a
  // shortest path. λ_min stays above −1 so every edge cost remains positive
  // and Dijkstra stays valid.
  lambdaMin: -0.85,
  lambdaMax: 12,
  bisectSolves: 7,
  lengthTolerance: 0.03,
  allowDeadEnds: false,     // 2-core only: a spur then needs the same edge twice
  nodeCandidates: null,     // pre-filtered node list (see collectNodesInBounds)
  maxStates: 600000,
  travelMode: 'foot',
  targetLengthM: 0,
};

/** Binary min-heap over (stateIndex, priority) using parallel typed arrays. */
class StateHeap {
  constructor(capacity = 4096) {
    this.ids = new Int32Array(Math.max(16, capacity));
    this.pri = new Float64Array(Math.max(16, capacity));
    this.n = 0;
  }

  get size() {
    return this.n;
  }

  clear() {
    this.n = 0;
  }

  push(id, pri) {
    if (this.n === this.ids.length) {
      const ids = new Int32Array(this.n * 2);
      const prs = new Float64Array(this.n * 2);
      ids.set(this.ids);
      prs.set(this.pri);
      this.ids = ids;
      this.pri = prs;
    }
    let i = this.n++;
    this.ids[i] = id;
    this.pri[i] = pri;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this._swap(parent, i);
      i = parent;
    }
  }

  pop() {
    if (this.n === 0) return -1;
    const top = this.ids[0];
    this.n--;
    if (this.n > 0) {
      this.ids[0] = this.ids[this.n];
      this.pri[0] = this.pri[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.pri[l] < this.pri[m]) m = l;
        if (r < this.n && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this._swap(m, i);
        i = m;
      }
    }
    return top;
  }

  _swap(a, b) {
    const id = this.ids[a];
    const pr = this.pri[a];
    this.ids[a] = this.ids[b];
    this.pri[a] = this.pri[b];
    this.ids[b] = id;
    this.pri[b] = pr;
  }
}

/** Min distance from (px, py) to segment a→b, all in planar metres. */
function pointSegDist(px, py, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = px - a[0];
  const apy = py - a[1];
  const len2 = abx * abx + aby * aby;
  const u = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2)) : 0;
  return Math.hypot(apx - u * abx, apy - u * aby);
}

/** First index in the ascending Int32Array `arr` whose value is >= value. */
function lowerBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Flat state index for (node index, bucket), or -1 when that pair is not in the corridor. */
export function layeredStateIndex(field, nodeIdx, bucket) {
  if (!field || nodeIdx == null || nodeIdx < 0) return -1;
  const buckets = field.bucketsOf[nodeIdx];
  if (!buckets) return -1;
  const j = lowerBound(buckets, bucket);
  if (j >= buckets.length || buckets[j] !== bucket) return -1;
  return field.stateBase[nodeIdx] + j;
}

/**
 * Pre-compute the progress-indexed corridor: which (road node, progress bucket)
 * pairs are admissible, how far each is from its sub-arc, and the sub-arc
 * tangents. Built once per ring and reused across every λ solve, so the
 * bisection only re-evaluates edge costs.
 *
 * Returns null when the ring or graph is unusable, or `{ tooLarge: true }`
 * when the corridor would exceed `maxStates` (the caller then shrinks it).
 */
export function buildLayeredField(graph, ring, options = {}) {
  const opt = { ...LAYERED_DEFAULTS, ...options };
  if (!graph || !graph.nodes || graph.nodes.size === 0) return null;
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const ringXY = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    ringXY.push(graph.geoToXy(p[0], p[1]));
  }
  if (ringXY.length < 3) return null;

  let perimM = 0;
  for (let i = 0; i < ringXY.length; i++) {
    const a = ringXY[i];
    const b = ringXY[(i + 1) % ringXY.length];
    perimM += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (!(perimM > 1)) return null;

  // One field vertex per bucket boundary, so bucket k IS segment k→k+1 and the
  // deviation of a node from bucket k is an exact point-to-segment distance.
  const K = Math.max(opt.minBuckets, Math.min(opt.maxBuckets, Math.round(perimM / opt.bucketTargetM)));
  const fieldPts = resampleClosedStroke(ringXY, K);
  if (!fieldPts || fieldPts.length < 3) return null;
  const bucketLen = perimM / K;
  // The corridor radius is tied to the bucket length, not to the overall ring
  // size: "standing on bucket k" only constrains anything while the corridor is
  // narrower than the arc one bucket spans. Let it grow wider and a node at the
  // apex of a cusp becomes admissible for both the outbound and the inbound
  // sub-arc at once, and the solver turns back early — exactly the corner
  // cutting the chord-corridor heuristic suffered from.
  // Deliberately no lower floor here: on the first attempt the invariant
  // R < bucketLen matters more than guaranteeing the corridor holds a road.
  // solveShapeRoute widens it (×1.6, ×2.5, ×3.6) only when no loop is feasible,
  // so a sparse network pays for its sparsity in fit instead of silently
  // cutting corners everywhere.
  const corridorScale = Number.isFinite(opt.corridorScale) && opt.corridorScale > 0 ? opt.corridorScale : 1;
  const corridorR = opt.corridorRadiusM != null
    ? Math.max(40, opt.corridorRadiusM) * corridorScale
    : Math.min(260, bucketLen * 0.9) * corridorScale;

  const tanX = new Float64Array(K);
  const tanY = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const a = fieldPts[k];
    const b = fieldPts[(k + 1) % K];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    tanX[k] = dx / len;
    tanY[k] = dy / len;
  }

  // Uniform grid over the bucket segments (bbox rasterisation: a superset of
  // the cells a segment touches, which only costs extra distance checks).
  const cell = Math.max(25, corridorR);
  const grid = new Map();
  for (let k = 0; k < K; k++) {
    const a = fieldPts[k];
    const b = fieldPts[(k + 1) % K];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx}_${cy}`;
        let arr = grid.get(key);
        if (!arr) {
          arr = [];
          grid.set(key, arr);
        }
        arr.push(k);
      }
    }
  }

  const startPt = fieldPts[0];
  const nodeIndex = new Map();
  const nodeIds = [];
  const bucketsOf = [];
  const devOf = [];
  const nodeXs = [];
  const nodeYs = [];

  const nodeSource = Array.isArray(opt.nodeCandidates) && opt.nodeCandidates.length > 0
    ? opt.nodeCandidates
    : graph.nodes.values();
  for (const node of nodeSource) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    const degree = graph.adj.get(node.id)?.size || 0;
    if (degree === 0) continue;
    if (!opt.allowDeadEnds && node.isDeadEnd) continue;
    if (typeof graph.isNodeAllowedForTravelMode === 'function'
      && !graph.isNodeAllowedForTravelMode(node, opt.travelMode)) continue;

    const cx = Math.floor(node.x / cell);
    const cy = Math.floor(node.y / cell);
    const best = new Map();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(`${cx + dx}_${cy + dy}`);
        if (!arr) continue;
        for (const k of arr) {
          const d = pointSegDist(node.x, node.y, fieldPts[k], fieldPts[(k + 1) % K]);
          if (d > corridorR) continue;
          const prev = best.get(k);
          if (prev == null || d < prev) best.set(k, d);
        }
      }
    }
    // Terminal bucket K means "progress complete, standing on the ring start".
    const dStart = Math.hypot(node.x - startPt[0], node.y - startPt[1]);
    if (dStart <= corridorR) best.set(K, dStart);
    if (best.size === 0) continue;

    const ks = [...best.keys()].sort((a, b) => a - b);
    nodeIndex.set(node.id, nodeIds.length);
    nodeIds.push(node.id);
    bucketsOf.push(Int32Array.from(ks));
    devOf.push(Float64Array.from(ks, (k) => best.get(k)));
    nodeXs.push(node.x);
    nodeYs.push(node.y);
  }

  const N = nodeIds.length;
  if (N === 0) return null;

  const stateBase = new Int32Array(N + 1);
  for (let ni = 0; ni < N; ni++) stateBase[ni + 1] = stateBase[ni] + bucketsOf[ni].length;
  const stateCount = stateBase[N];
  if (stateCount > opt.maxStates) {
    return { tooLarge: true, stateCount, corridorR, K, nodeCount: N };
  }

  const stateBucket = new Int32Array(stateCount);
  const stateDev = new Float64Array(stateCount);
  const stateNode = new Int32Array(stateCount);
  for (let ni = 0; ni < N; ni++) {
    const base = stateBase[ni];
    const bs = bucketsOf[ni];
    const ds = devOf[ni];
    for (let j = 0; j < bs.length; j++) {
      stateBucket[base + j] = bs[j];
      stateDev[base + j] = ds[j];
      stateNode[base + j] = ni;
    }
  }

  // Corridor-restricted adjacency: edges leaving the corridor are simply absent.
  const adjTo = new Array(N);
  const adjLen = new Array(N);
  let edgeCount = 0;
  for (let ni = 0; ni < N; ni++) {
    const neighbours = graph.adj.get(nodeIds[ni]);
    const to = [];
    const len = [];
    if (neighbours) {
      for (const [v, w] of neighbours.entries()) {
        const nj = nodeIndex.get(v);
        if (nj == null) continue;
        to.push(nj);
        len.push(w > 0 ? w : 1e-3);
      }
    }
    adjTo[ni] = Int32Array.from(to);
    adjLen[ni] = Float64Array.from(len);
    edgeCount += to.length;
  }

  return {
    K,
    bucketLen,
    perimM,
    corridorR,
    deltaMax: opt.deltaMax,
    weightShape: opt.weightShape,
    weightDir: opt.weightDir,
    weightSkip: opt.weightSkip,
    fieldPts,
    tanX,
    tanY,
    nodeIndex,
    nodeIds,
    nodeX: Float64Array.from(nodeXs),
    nodeY: Float64Array.from(nodeYs),
    bucketsOf,
    devOf,
    adjTo,
    adjLen,
    stateBase,
    stateBucket,
    stateDev,
    stateNode,
    stateCount,
    nodeCount: N,
    edgeCount,
    // Reused across λ solves so the bisection allocates nothing.
    _dist: new Float64Array(stateCount),
    _trueLen: new Float64Array(stateCount),
    _prev: new Int32Array(stateCount),
    _done: new Uint8Array(stateCount),
    _heap: new StateHeap(Math.min(1 << 16, Math.max(4096, stateCount >> 2))),
  };
}

/**
 * Graph nodes inside a planar bounding box, to hand to buildLayeredField or
 * buildLayeredField as `nodeCandidates`.
 *
 * Building a field costs O(|V_graph|) because every node is tested against the
 * corridor, so a sweep over many candidate rings (the orientation search) would
 * otherwise pay that scan once per ring. Pay it once here over the union of the
 * candidate rings' bounds instead.
 *
 * `bounds` must already include padding for the corridor radius and for the
 * widening retries — at least ~400 m beyond the rings — or edges leaving the
 * box are silently dropped and the solve looks infeasible.
 */
export function collectNodesInBounds(graph, bounds) {
  const out = [];
  if (!graph || !graph.nodes || !bounds) return out;
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return out;
  for (const node of graph.nodes.values()) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    if (node.x < minX || node.x > maxX || node.y < minY || node.y > maxY) continue;
    out.push(node);
  }
  return out;
}

/**
 * Exact Dijkstra on the layered field for one λ. Returns the optimal node path
 * from (start, bucket 0) to (start, bucket K) — a closed loop that walks the
 * whole shape exactly once — or null when no such path exists in the corridor.
 *
 * Edge cost (metres-equivalent, every term non-negative):
 *   L · (1 + λ + w_shape·dev/R + w_dir·(1 − cosθ))  +  w_skip·max(0, Δk − 1)·bucketLen
 * plus a stay-put transition costing w_skip·bucketLen that advances one bucket
 * without moving, which is how shape detail finer than the road network gets
 * absorbed instead of failing the solve.
 */
export function solveLayeredAtLambda(field, startNodeId, lambda) {
  if (!field || field.tooLarge || !Number.isFinite(lambda)) return null;
  const nodeIdx = field.nodeIndex.get(startNodeId);
  if (nodeIdx == null) return null;

  const { K, bucketLen, corridorR, deltaMax, weightShape, weightDir, weightSkip } = field;
  const sStart = layeredStateIndex(field, nodeIdx, 0);
  const sGoal = layeredStateIndex(field, nodeIdx, K);
  if (sStart < 0 || sGoal < 0) return null;

  const dist = field._dist;
  const trueLen = field._trueLen;
  const prev = field._prev;
  const done = field._done;
  const heap = field._heap;
  dist.fill(Infinity);
  trueLen.fill(0);
  prev.fill(-1);
  done.fill(0);
  heap.clear();

  dist[sStart] = 0;
  heap.push(sStart, 0);
  let settled = 0;

  while (heap.size > 0) {
    const s = heap.pop();
    if (done[s]) continue;
    done[s] = 1;
    settled++;
    if (s === sGoal) break;

    const ni = field.stateNode[s];
    const k = field.stateBucket[s];
    const devU = field.stateDev[s];
    const baseCost = dist[s];
    const ux = field.nodeX[ni];
    const uy = field.nodeY[ni];

    // Stay-put progress: the drawn shape turns inside a single road block.
    if (k < K) {
      const sv = layeredStateIndex(field, ni, k + 1);
      if (sv >= 0 && !done[sv]) {
        const nd = baseCost + weightSkip * bucketLen;
        if (nd < dist[sv]) {
          dist[sv] = nd;
          trueLen[sv] = trueLen[s];
          prev[sv] = s;
          heap.push(sv, nd);
        }
      }
    }

    const to = field.adjTo[ni];
    const lens = field.adjLen[ni];
    for (let e = 0; e < to.length; e++) {
      const nj = to[e];
      const L = lens[e];
      const ex = field.nodeX[nj] - ux;
      const ey = field.nodeY[nj] - uy;
      const eLen = Math.hypot(ex, ey) || 1;
      const buckets = field.bucketsOf[nj];
      const devs = field.devOf[nj];
      const limit = k + deltaMax;
      for (let j = lowerBound(buckets, k); j < buckets.length; j++) {
        const kp = buckets[j];
        if (kp > limit) break;
        const sv = field.stateBase[nj] + j;
        if (done[sv]) continue;
        // The terminal bucket reuses the last sub-arc's tangent.
        const tk = kp < K ? kp : K - 1;
        const dirPen = 1 - (ex * field.tanX[tk] + ey * field.tanY[tk]) / eLen;
        const dev = 0.5 * (devU + devs[j]);
        const skipped = Math.max(0, kp - k - 1) * bucketLen;
        const cost = L * (1 + lambda + weightShape * (dev / corridorR) + weightDir * dirPen)
          + weightSkip * skipped;
        const nd = baseCost + cost;
        if (nd < dist[sv]) {
          dist[sv] = nd;
          trueLen[sv] = trueLen[s] + L;
          prev[sv] = s;
          heap.push(sv, nd);
        }
      }
    }
  }

  if (!done[sGoal] || !Number.isFinite(dist[sGoal])) return null;

  const statePath = [];
  for (let s = sGoal; s >= 0; s = prev[s]) {
    statePath.push(s);
    if (s === sStart) break;
  }
  statePath.reverse();
  if (statePath[0] !== sStart) return null;

  // Collapse stay-put transitions: they advance progress without moving.
  const nodePath = [];
  for (const s of statePath) {
    const id = field.nodeIds[field.stateNode[s]];
    if (nodePath.length === 0 || nodePath[nodePath.length - 1] !== id) nodePath.push(id);
  }

  return {
    nodePath,
    statePath,
    lengthM: trueLen[sGoal],
    cost: dist[sGoal],
    lambda,
    settledStates: settled,
  };
}

/** Nearest corridor node that can both start (bucket 0) and close (bucket K) the loop. */
function pickStartNode(field, anchorXY) {
  let bestId = null;
  let bestD = Infinity;
  for (let ni = 0; ni < field.nodeCount; ni++) {
    const buckets = field.bucketsOf[ni];
    if (buckets[0] !== 0 || buckets[buckets.length - 1] !== field.K) continue;
    const d = Math.hypot(field.nodeX[ni] - anchorXY[0], field.nodeY[ni] - anchorXY[1]);
    if (d < bestD) {
      bestD = d;
      bestId = field.nodeIds[ni];
    }
  }
  return bestId == null ? null : { nodeId: bestId, distM: bestD };
}

/**
 * Full solve: build the corridor, then bisect λ until the route length matches
 * `targetLengthM`. Route length is monotone non-increasing in λ, so the two
 * endpoint solves bracket what this ring can achieve and the bisection needs
 * no damping, budget or rollback.
 *
 * The corridor radius is the only thing retried: too wide and the state space
 * blows past `maxStates`, too narrow and a sparse road network has no feasible
 * loop at all.
 */
export function solveShapeRoute(graph, ring, options = {}) {
  const opt = { ...LAYERED_DEFAULTS, ...options };
  if (!graph || typeof graph.geoToXy !== 'function' || !Array.isArray(ring) || ring.length < 3) {
    return { ok: false, reason: 'invalid-input' };
  }

  const anchorXY = graph.geoToXy(ring[0][0], ring[0][1]);
  let field = null;
  let start = null;
  let lastReason = 'no-corridor';

  // Widen the corridor only when the narrow one has no feasible loop: a wider
  // corridor always fits worse, so the first attempt that works wins. The last
  // attempt also admits cul-de-sac nodes, which keeps sparse rural networks on
  // this solver instead of dropping them to the fallback pipeline.
  const attempts = [
    { scale: 1 },
    { scale: 1.6 },
    { scale: 2.5 },
    { scale: 3.6 },
    { scale: 2.5, allowDeadEnds: true },
  ];
  let tight = null;
  for (const attempt of attempts) {
    const built = buildLayeredField(graph, ring, {
      ...opt,
      corridorScale: attempt.scale,
      allowDeadEnds: attempt.allowDeadEnds ?? opt.allowDeadEnds,
    });
    if (!built) {
      lastReason = 'no-corridor';
      continue;
    }
    if (built.tooLarge) {
      lastReason = 'corridor-too-large';
      continue;
    }
    const candidate = pickStartNode(built, anchorXY);
    if (!candidate) {
      lastReason = 'no-closable-start';
      continue;
    }
    // Feasibility probe at the cheapest λ, kept as the shortest-length end of
    // the λ family so the bisection does not pay for it twice.
    const probe = solveLayeredAtLambda(built, candidate.nodeId, opt.lambdaMax);
    if (!probe) {
      lastReason = 'infeasible-loop';
      continue;
    }
    field = built;
    start = candidate;
    tight = probe;
    break;
  }

  if (!field || !start || !tight) return { ok: false, reason: lastReason };

  let solveCount = 1;
  const runAt = (lambda) => {
    const r = solveLayeredAtLambda(field, start.nodeId, lambda);
    if (r) solveCount++;
    return r;
  };

  const loose = runAt(opt.lambdaMin);
  if (!loose) return { ok: false, reason: 'infeasible-loop' };

  const target = Number(opt.targetLengthM) || 0;
  let best = loose;
  if (target > 0) {
    if (loose.lengthM <= target) {
      best = loose;              // even the most faithful solve falls short of the target
    } else if (tight.lengthM >= target) {
      best = tight;              // even the shortest feasible loop overshoots
    } else {
      let lo = opt.lambdaMin;
      let hi = opt.lambdaMax;
      best = Math.abs(loose.lengthM - target) <= Math.abs(tight.lengthM - target) ? loose : tight;
      for (let i = 0; i < opt.bisectSolves; i++) {
        const mid = (lo + hi) / 2;
        const r = runAt(mid);
        if (!r) {
          hi = mid;
          continue;
        }
        if (Math.abs(r.lengthM - target) < Math.abs(best.lengthM - target)) best = r;
        if (Math.abs(r.lengthM - target) / target <= opt.lengthTolerance) break;
        if (r.lengthM > target) lo = mid;
        else hi = mid;
      }
    }
  }

  const routeCoordsGeo = [];
  for (const id of best.nodePath) {
    const n = graph.nodes.get(id);
    if (n) routeCoordsGeo.push([n.lat, n.lng]);
  }
  if (routeCoordsGeo.length < 3) return { ok: false, reason: 'degenerate-path' };

  const dev = ringRouteDeviation(ring, routeCoordsGeo, { bidirectional: true });

  return {
    ok: true,
    routeCoordsGeo,
    nodePath: best.nodePath,
    lengthM: best.lengthM,
    lambda: best.lambda,
    meanDevM: dev.meanM,
    maxDevM: dev.maxM,
    similarity: shapeSimilarity(routeCoordsGeo, ring),
    minLengthM: tight.lengthM,
    maxLengthM: loose.lengthM,
    startNodeId: start.nodeId,
    startOffsetM: start.distM,
    bucketCount: field.K,
    bucketLenM: field.bucketLen,
    corridorRadiusM: field.corridorR,
    stateCount: field.stateCount,
    solveCount,
  };
}

/**
 * Reduce a solved node path to the waypoints handed to the normal routing
 * pipeline. Ramer–Douglas–Peucker in planar metres: every kept point is a real
 * road node, and consecutive kept points stay close enough that the router's
 * own shortest path between them reproduces the solved geometry.
 * Returns distinct waypoints (no duplicate of the start at the end).
 */
export function waypointsFromSolvedPath(graph, routeCoordsGeo, options = {}) {
  const maxCount = options.maxCount ?? 28;
  const minCount = options.minCount ?? 6;
  if (!Array.isArray(routeCoordsGeo) || routeCoordsGeo.length < 3) return [];

  const last = routeCoordsGeo[routeCoordsGeo.length - 1];
  const closed = Math.abs(routeCoordsGeo[0][0] - last[0]) < 1e-9
    && Math.abs(routeCoordsGeo[0][1] - last[1]) < 1e-9;
  const open = closed ? routeCoordsGeo.slice(0, -1) : routeCoordsGeo.slice();
  if (open.length < 3) return [];

  const xy = open.map(([lat, lng]) => graph.geoToXy(lat, lng));

  const simplify = (toleranceM) => {
    const keep = new Uint8Array(xy.length);
    keep[0] = 1;
    keep[xy.length - 1] = 1;
    const stack = [[0, xy.length - 1]];
    while (stack.length > 0) {
      const [lo, hi] = stack.pop();
      if (hi <= lo + 1) continue;
      let worst = -1;
      let worstD = toleranceM;
      for (let i = lo + 1; i < hi; i++) {
        const d = pointSegDist(xy[i][0], xy[i][1], xy[lo], xy[hi]);
        if (d > worstD) {
          worstD = d;
          worst = i;
        }
      }
      if (worst < 0) continue;
      keep[worst] = 1;
      stack.push([lo, worst], [worst, hi]);
    }
    const out = [];
    for (let i = 0; i < xy.length; i++) if (keep[i]) out.push(open[i]);
    return out;
  };

  let tolerance = options.toleranceM ?? 25;
  let wps = simplify(tolerance);
  // Widen the tolerance until the waypoint budget is met; the solved geometry
  // is already on-road, so dropping vertices costs little fidelity.
  for (let i = 0; i < 8 && wps.length > maxCount; i++) {
    tolerance *= 1.5;
    wps = simplify(tolerance);
  }
  for (let i = 0; i < 6 && wps.length < minCount && tolerance > 4; i++) {
    tolerance /= 1.8;
    wps = simplify(tolerance);
  }
  if (wps.length > maxCount) {
    const stride = wps.length / maxCount;
    const thinned = [];
    for (let i = 0; i < maxCount; i++) thinned.push(wps[Math.floor(i * stride)]);
    wps = thinned;
  }
  return wps;
}
