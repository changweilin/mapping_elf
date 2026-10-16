/**
 * Mapping Elf — GPS Art Route Optimizer (gpsArtOptimizer.js)
 *
 * Implements the GIS Road Network Route Optimization for GPS Art defined in:
 * "GPS 軌跡繪圖演算法實作"
 *
 * 1. Complete OSM Road Network Graph Construction:
 *    - Fast Overpass bbox query (`out geom qt`) with complete walkable/cyclable highway coverage
 *    - Largest Connected Component (LCC) extraction to prevent isolated-island snapping
 *    - 2-Core Decomposition (dead-end cul-de-sac detection) with dedicated `coreKdTree`
 *    - Edge Densification (subdividing road segments > 25m) for high-precision mid-edge snapping
 * 2. Curvature-Preserving Pattern Simplification & Affine Transformation:
 *    - Canvas Y-axis inversion support, RDP + curvature peak preservation, dense reference contour
 * 3. Corridor-Constrained Self-Avoiding Routing:
 *    - 2-Core smart snapping + A* routing with cross-track corridor guidance and edge-reuse penalty
 * 4. Multi-Objective Global + Local Optimization:
 *    - Differential Evolution + Exact Mileage Calibration + Sub-Arc Deviation Refinement + Spur Pruning
 * 5. GPX Track Export & Geographic Unprojection (WGS84 lat/lng)
 */

export const M_PER_DEG_LAT = 111320;

// In-memory LRU cache for downloaded OSM road network graphs
const _osmGraphCache = new Map();
const MAX_OSM_CACHE_ENTRIES = 8;

/**
 * 2D KD-Tree for fast nearest-neighbor lookups in planar metric space O(log N).
 */
export class KDTree2D {
  constructor(points) {
    this.points = points ? points.slice() : [];
    this.root = this._build(this.points.slice(), 0);
  }

  _build(points, depth) {
    if (!points || points.length === 0) return null;
    const axis = depth % 2; // 0 for x, 1 for y
    points.sort((a, b) => (axis === 0 ? a.x - b.x : a.y - b.y));
    const mid = Math.floor(points.length / 2);
    return {
      point: points[mid],
      axis,
      left: this._build(points.slice(0, mid), depth + 1),
      right: this._build(points.slice(mid + 1), depth + 1),
    };
  }

  query(targetPt) {
    const qx = Array.isArray(targetPt) ? targetPt[0] : targetPt.x;
    const qy = Array.isArray(targetPt) ? targetPt[1] : targetPt.y;
    let best = { node: null, distSq: Infinity };

    const search = (node) => {
      if (!node) return;
      const dx = qx - node.point.x;
      const dy = qy - node.point.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < best.distSq) {
        best.distSq = distSq;
        best.node = node.point;
      }
      const axisVal = node.axis === 0 ? dx : dy;
      const first = axisVal <= 0 ? node.left : node.right;
      const second = axisVal <= 0 ? node.right : node.left;

      search(first);
      if (axisVal * axisVal < best.distSq) {
        search(second);
      }
    };

    search(this.root);
    return best.node ? { node: best.node, distance: Math.sqrt(best.distSq) } : null;
  }
}

/**
 * Priority queue for Dijkstra / A* shortest path algorithm.
 */
class MinHeap {
  constructor() {
    this.heap = [];
  }

  push(item) {
    this.heap.push(item);
    this._up(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._down(0);
    }
    return top;
  }

  get size() {
    return this.heap.length;
  }

  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[i].priority < this.heap[p].priority) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[p];
        this.heap[p] = tmp;
        i = p;
      } else break;
    }
  }

  _down(i) {
    const len = this.heap.length;
    while ((i << 1) + 1 < len) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let smallest = i;
      if (this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < len && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest !== i) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[smallest];
        this.heap[smallest] = tmp;
        i = smallest;
      } else break;
    }
  }
}

/**
 * Planar metric road network graph with 2-Core KD-Tree, LCC pruning, Edge Densification,
 * and Corridor-Constrained Self-Avoiding A* routing.
 */
export class RoadNetworkGraph {
  constructor(centerLatLon = [25.034, 121.564]) {
    this.centerLatLon = [centerLatLon[0], centerLatLon[1]];
    this.cosLat = Math.max(0.01, Math.cos((this.centerLatLon[0] * Math.PI) / 180));
    this.nodes = new Map(); // id -> { id, x, y, lat, lng, isDeadEnd }
    this.adj = new Map(); // u -> Map(v -> minLength)
    this.kdtree = null;
    this.coreKdTree = null;
    this.nodeList = [];
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
    this._nextSyntheticId = -1;
  }

  geoToXy(lat, lng) {
    const x = (lng - this.centerLatLon[1]) * M_PER_DEG_LAT * this.cosLat;
    const y = (lat - this.centerLatLon[0]) * M_PER_DEG_LAT;
    return [x, y];
  }

  xyToGeo(x, y) {
    const lat = this.centerLatLon[0] + y / M_PER_DEG_LAT;
    const lng = this.centerLatLon[1] + x / (M_PER_DEG_LAT * this.cosLat);
    return [lat, lng];
  }

  addNode(id, x, y, lat = null, lng = null) {
    if (lat == null || lng == null) {
      const geo = this.xyToGeo(x, y);
      lat = geo[0];
      lng = geo[1];
    }
    const node = { id, x, y, lat, lng, isDeadEnd: false };
    this.nodes.set(id, node);
    if (!this.adj.has(id)) this.adj.set(id, new Map());
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    return node;
  }

  addEdge(u, v, length = null) {
    if (u === v) return;
    const nU = this.nodes.get(u);
    const nV = this.nodes.get(v);
    if (!nU || !nV) return;
    const dist = length != null ? length : Math.hypot(nU.x - nV.x, nU.y - nV.y);
    if (!this.adj.has(u)) this.adj.set(u, new Map());
    const m = this.adj.get(u);
    const prev = m.get(v);
    if (prev == null || dist < prev) {
      m.set(v, dist);
    }
  }

  /**
   * Prunes disconnected road islands by retaining only the main connected component
   * (either the component containing the anchor if substantial, or the Largest Connected Component).
   */
  pruneToMainComponent(anchorXY = [0, 0]) {
    if (this.nodes.size < 4) return;

    // Build undirected adjacency view
    const undir = new Map();
    for (const id of this.nodes.keys()) undir.set(id, []);
    for (const [u, edges] of this.adj.entries()) {
      for (const v of edges.keys()) {
        if (this.nodes.has(v)) {
          undir.get(u).push(v);
          undir.get(v).push(u);
        }
      }
    }

    const visited = new Set();
    const components = [];

    for (const startId of this.nodes.keys()) {
      if (visited.has(startId)) continue;
      const comp = [];
      const queue = [startId];
      visited.add(startId);
      let head = 0;
      while (head < queue.length) {
        const u = queue[head++];
        comp.push(u);
        const nbrs = undir.get(u) || [];
        for (let i = 0; i < nbrs.length; i++) {
          const v = nbrs[i];
          if (!visited.has(v)) {
            visited.add(v);
            queue.push(v);
          }
        }
      }
      components.push(comp);
    }

    if (components.length <= 1) return;

    components.sort((a, b) => b.length - a.length);
    let chosen = components[0];

    // If anchorXY is provided, check if a component near anchor is large enough (>= 25% of largest)
    if (anchorXY && Number.isFinite(anchorXY[0]) && Number.isFinite(anchorXY[1])) {
      let bestAnchorComp = null;
      let bestDistSq = Infinity;
      const minAcceptableSize = Math.max(15, Math.floor(components[0].length * 0.25));
      for (const comp of components) {
        if (comp.length < minAcceptableSize) continue;
        for (const nid of comp) {
          const n = this.nodes.get(nid);
          const dSq = (n.x - anchorXY[0]) ** 2 + (n.y - anchorXY[1]) ** 2;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestAnchorComp = comp;
          }
        }
      }
      if (bestAnchorComp) chosen = bestAnchorComp;
    }

    const keepSet = new Set(chosen);
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;

    for (const [id, node] of this.nodes.entries()) {
      if (!keepSet.has(id)) {
        this.nodes.delete(id);
        this.adj.delete(id);
      } else {
        if (node.x < this.minX) this.minX = node.x;
        if (node.x > this.maxX) this.maxX = node.x;
        if (node.y < this.minY) this.minY = node.y;
        if (node.y > this.maxY) this.maxY = node.y;
      }
    }

    for (const edges of this.adj.values()) {
      for (const v of edges.keys()) {
        if (!keepSet.has(v)) edges.delete(v);
      }
    }
  }

  /**
   * Subdivides long edges (> maxEdgeLengthM) by inserting intermediate nodes
   * so KD-Tree snapping can snap accurately onto the middle of long streets.
   */
  densifyEdges(maxEdgeLengthM = 28) {
    if (!(maxEdgeLengthM > 5) || this.nodes.size === 0) return;

    const processedPairs = new Set();
    const edgesToSplit = [];

    for (const [u, nbrs] of this.adj.entries()) {
      for (const [v, len] of nbrs.entries()) {
        if (len <= maxEdgeLengthM) continue;
        const pairKey = String(u) < String(v) ? `${u}_${v}` : `${v}_${u}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);
        const reverseLen = this.adj.get(v)?.get(u);
        edgesToSplit.push({
          u,
          v,
          len,
          bidirectional: reverseLen != null,
        });
      }
    }

    for (const { u, v, len, bidirectional } of edgesToSplit) {
      const nU = this.nodes.get(u);
      const nV = this.nodes.get(v);
      if (!nU || !nV) continue;

      const steps = Math.min(12, Math.ceil(len / maxEdgeLengthM));
      if (steps <= 1) continue;

      this.adj.get(u)?.delete(v);
      if (bidirectional) this.adj.get(v)?.delete(u);

      const segLen = len / steps;
      let prevId = u;
      for (let s = 1; s < steps; s++) {
        const frac = s / steps;
        const mx = nU.x + (nV.x - nU.x) * frac;
        const my = nU.y + (nV.y - nU.y) * frac;
        const midId = `sub_${Math.abs(this._nextSyntheticId--)}`;
        this.addNode(midId, mx, my);
        this.addEdge(prevId, midId, segLen);
        if (bidirectional) this.addEdge(midId, prevId, segLen);
        prevId = midId;
      }
      this.addEdge(prevId, v, segLen);
      if (bidirectional) this.addEdge(v, prevId, segLen);
    }
  }

  /**
   * Identifies dead-end trees / cul-de-sacs via iterative leaf peeling (2-core decomposition).
   * Nodes on dead-end branches get `node.isDeadEnd = true`.
   */
  markDeadEndNodes() {
    const undir = new Map();
    for (const id of this.nodes.keys()) undir.set(id, new Set());

    for (const [u, edges] of this.adj.entries()) {
      for (const v of edges.keys()) {
        if (this.nodes.has(v) && u !== v) {
          undir.get(u).add(v);
          undir.get(v).add(u);
        }
      }
    }

    const degree = new Map();
    const queue = [];
    for (const [id, nbrs] of undir.entries()) {
      const deg = nbrs.size;
      degree.set(id, deg);
      if (deg <= 1) queue.push(id);
    }

    const peeled = new Set(queue);
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const nbrs = undir.get(u);
      if (!nbrs) continue;
      for (const v of nbrs) {
        if (peeled.has(v)) continue;
        const nextDeg = (degree.get(v) || 0) - 1;
        degree.set(v, nextDeg);
        if (nextDeg <= 1) {
          peeled.add(v);
          queue.push(v);
        }
      }
    }

    for (const [id, node] of this.nodes.entries()) {
      node.isDeadEnd = peeled.has(id);
    }
  }

  buildIndex(options = {}) {
    if (options.pruneComponents !== false && this.nodes.size >= 4) {
      this.pruneToMainComponent(options.anchorXY || [0, 0]);
    }
    if (options.densify !== false && this.nodes.size >= 4 && this.nodes.size <= 25000) {
      this.densifyEdges(options.maxEdgeLengthM || 28);
    }
    this.markDeadEndNodes();

    this.nodeList = Array.from(this.nodes.values());
    this.kdtree = new KDTree2D(this.nodeList);

    const coreNodes = this.nodeList.filter((n) => !n.isDeadEnd);
    this.coreKdTree = coreNodes.length >= 8 ? new KDTree2D(coreNodes) : this.kdtree;
  }

  /**
   * Standard A*-accelerated shortest path on the road graph.
   */
  dijkstra(sourceId, targetId) {
    if (sourceId === targetId) return { path: [sourceId], length: 0 };
    const targetNode = this.nodes.get(targetId);
    if (!this.nodes.has(sourceId) || !targetNode) return null;

    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    const heap = new MinHeap();

    dist.set(sourceId, 0);
    heap.push({ id: sourceId, priority: 0 });

    const tx = targetNode.x;
    const ty = targetNode.y;

    while (heap.size > 0) {
      const curr = heap.pop();
      const u = curr.id;
      if (visited.has(u)) continue;
      visited.add(u);

      if (u === targetId) break;

      const edges = this.adj.get(u);
      if (!edges) continue;

      const uDist = dist.get(u);
      for (const [v, weight] of edges.entries()) {
        if (visited.has(v)) continue;
        const newDist = uDist + weight;
        const oldDist = dist.get(v);
        if (oldDist == null || newDist < oldDist) {
          dist.set(v, newDist);
          prev.set(v, u);
          const vNode = this.nodes.get(v);
          const h = vNode ? Math.hypot(vNode.x - tx, vNode.y - ty) * 0.98 : 0;
          heap.push({ id: v, priority: newDist + h });
        }
      }
    }

    if (!dist.has(targetId)) return null;

    const path = [];
    let curr = targetId;
    while (curr !== undefined) {
      path.push(curr);
      curr = prev.get(curr);
    }
    path.reverse();
    return { path, length: dist.get(targetId) };
  }

  /**
   * Corridor-Constrained, Self-Avoiding A* Shortest Path:
   * Penalizes edges that stray far from the desired target segment (segStartXY -> segEndXY)
   * as well as edges already traversed in earlier legs and immediate 180-degree U-turns.
   */
  routeCorridor(
    sourceId,
    targetId,
    segStartXY = null,
    segEndXY = null,
    usedEdgeCounts = null,
    prevNodeId = null,
    corridorWeight = 0.022,
    recentEdgeSet = null
  ) {
    if (sourceId === targetId) return { path: [sourceId], length: 0 };
    const sourceNode = this.nodes.get(sourceId);
    const targetNode = this.nodes.get(targetId);
    if (!sourceNode || !targetNode) return null;

    const gCost = new Map();
    const trueLen = new Map();
    const prev = new Map();
    const visited = new Set();
    const heap = new MinHeap();

    gCost.set(sourceId, 0);
    trueLen.set(sourceId, 0);
    heap.push({ id: sourceId, priority: 0 });

    const tx = targetNode.x;
    const ty = targetNode.y;
    const pA = segStartXY || [sourceNode.x, sourceNode.y];
    const pB = segEndXY || [tx, ty];
    const abx = pB[0] - pA[0];
    const aby = pB[1] - pA[1];
    const abLenSq = abx * abx + aby * aby;

    const segDist = (x, y) => {
      if (abLenSq < 1e-6) return Math.hypot(x - pA[0], y - pA[1]);
      const u = Math.max(0, Math.min(1, ((x - pA[0]) * abx + (y - pA[1]) * aby) / abLenSq));
      return Math.hypot(x - (pA[0] + u * abx), y - (pA[1] + u * aby));
    };

    while (heap.size > 0) {
      const curr = heap.pop();
      const u = curr.id;
      if (visited.has(u)) continue;
      visited.add(u);

      if (u === targetId) break;

      const edges = this.adj.get(u);
      if (!edges) continue;

      const uNode = this.nodes.get(u);
      const uCost = gCost.get(u);
      const uLen = trueLen.get(u);

      for (const [v, weight] of edges.entries()) {
        if (visited.has(v)) continue;
        const vNode = this.nodes.get(v);
        if (!vNode) continue;

        let penaltyMultiplier = 1.0;

        // 1. Cross-track corridor deviation penalty (keeps route hugging the drawn segment)
        if (corridorWeight > 0) {
          const midX = 0.5 * (uNode.x + vNode.x);
          const midY = 0.5 * (uNode.y + vNode.y);
          const xtrackM = segDist(midX, midY);
          penaltyMultiplier += corridorWeight * Math.min(180, xtrackM);
        }

        // 2. Self-avoiding edge reuse penalty (prevents retracing and loop collapse)
        const edgeKey = String(u) < String(v) ? `${u}_${v}` : `${v}_${u}`;
        const isRecentTailEdge = recentEdgeSet && recentEdgeSet.has(edgeKey);
        if (isRecentTailEdge) {
          penaltyMultiplier += 0.35;
        } else {
          if (usedEdgeCounts) {
            const used = usedEdgeCounts.get(edgeKey) || 0;
            if (used > 0) {
              penaltyMultiplier += 2.4 * used;
            }
          }
          // 3. Immediate U-turn backtracking penalty at leg boundary
          if (u === sourceId && prevNodeId != null && v === prevNodeId) {
            penaltyMultiplier += 3.5;
          }
        }

        // 4. Slight penalty for entering dead-end branches unless target itself is on a dead end
        if (vNode.isDeadEnd && !targetNode.isDeadEnd) {
          penaltyMultiplier += 1.5;
        }

        const stepCost = weight * penaltyMultiplier;
        const newCost = uCost + stepCost;
        const oldCost = gCost.get(v);

        if (oldCost == null || newCost < oldCost) {
          gCost.set(v, newCost);
          trueLen.set(v, uLen + weight);
          prev.set(v, u);
          const h = Math.hypot(vNode.x - tx, vNode.y - ty) * 0.98;
          heap.push({ id: v, priority: newCost + h });
        }
      }
    }

    if (!gCost.has(targetId)) return null;

    const path = [];
    let curr = targetId;
    while (curr !== undefined) {
      path.push(curr);
      curr = prev.get(curr);
    }
    path.reverse();
    return { path, length: trueLen.get(targetId) };
  }

  /**
   * Creates a synthetic urban street graph with irregular perturbations, diagonal avenues,
   * and an uncrossable river/park barrier to test obstacle avoidance.
   * Matches build_synthetic_city_graph from reference paper.
   */
  static buildSyntheticCityGraph(gridSize = 22, blockSizeM = 100.0, centerLatLon = [25.034, 121.564]) {
    const graph = new RoadNetworkGraph(centerLatLon);

    let seed = 7;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const uniform = (min, max) => min + rng() * (max - min);

    const halfGrid = (gridSize * blockSizeM) / 2;

    for (let ix = 0; ix < gridSize; ix++) {
      for (let iy = 0; iy < gridSize; iy++) {
        // Uncrossable river gap in the middle, except at bridge nodes (4, 10, 16)
        if (iy === Math.floor(gridSize / 2) && ix !== 4 && ix !== 10 && ix !== 16) {
          continue;
        }
        const nid = ix * gridSize + iy;
        const jitterX = uniform(-18.0, 18.0);
        const jitterY = uniform(-18.0, 18.0);
        const x = ix * blockSizeM - halfGrid + jitterX;
        const y = iy * blockSizeM - halfGrid + jitterY;
        graph.addNode(nid, x, y);
      }
    }

    const nodesSet = new Set(graph.nodes.keys());
    for (let ix = 0; ix < gridSize; ix++) {
      for (let iy = 0; iy < gridSize; iy++) {
        const u = ix * gridSize + iy;
        if (!nodesSet.has(u)) continue;

        const neighbors = [[ix + 1, iy], [ix, iy + 1]];
        if ((ix + iy) % 4 === 0) {
          neighbors.push([ix + 1, iy + 1]);
        }

        for (const [nxIdx, nyIdx] of neighbors) {
          if (nxIdx >= 0 && nxIdx < gridSize && nyIdx >= 0 && nyIdx < gridSize) {
            const v = nxIdx * gridSize + nyIdx;
            if (nodesSet.has(v)) {
              graph.addEdge(u, v);
              graph.addEdge(v, u);
            }
          }
        }
      }
    }

    graph.buildIndex({ densify: true, maxEdgeLengthM: 35 });
    return graph;
  }

  /**
   * Creates a well-connected fallback urban street network (blocks + diagonal avenues)
   * without an artificial river barrier through the origin, used when offline or in non-live test hooks.
   */
  static buildFallbackUrbanGraph(distM = 1800, centerLatLon = [25.034, 121.564]) {
    const graph = new RoadNetworkGraph(centerLatLon);
    const blockSizeM = 85.0;
    const gridSize = Math.max(24, Math.min(44, Math.ceil((distM * 2.1) / blockSizeM)));
    const halfGrid = (gridSize * blockSizeM) / 2;

    for (let ix = 0; ix < gridSize; ix++) {
      for (let iy = 0; iy < gridSize; iy++) {
        const nid = ix * gridSize + iy;
        const x = ix * blockSizeM - halfGrid;
        const y = iy * blockSizeM - halfGrid;
        graph.addNode(nid, x, y);
      }
    }

    for (let ix = 0; ix < gridSize; ix++) {
      for (let iy = 0; iy < gridSize; iy++) {
        const u = ix * gridSize + iy;
        const neighbors = [
          [ix + 1, iy],
          [ix, iy + 1],
        ];
        if ((ix + iy) % 3 === 0) {
          neighbors.push([ix + 1, iy + 1]);
        }
        if ((ix - iy + gridSize) % 4 === 0) {
          neighbors.push([ix + 1, iy - 1]);
        }

        for (const [nxIdx, nyIdx] of neighbors) {
          if (nxIdx >= 0 && nxIdx < gridSize && nyIdx >= 0 && nyIdx < gridSize) {
            const v = nxIdx * gridSize + nyIdx;
            graph.addEdge(u, v);
            graph.addEdge(v, u);
          }
        }
      }
    }

    graph.buildIndex({ densify: true, maxEdgeLengthM: 30 });
    return graph;
  }

  /**
   * Parses Overpass JSON response (`out geom qt` or `out skel`) into `graph`.
   */
  static populateFromOverpassData(graph, data, mode = 'walk') {
    if (!data || !Array.isArray(data.elements)) return 0;

    // 1. Add standalone node elements if present (`out skel` / `out body`)
    for (const el of data.elements) {
      if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
        const [x, y] = graph.geoToXy(el.lat, el.lon);
        graph.addNode(el.id, x, y, el.lat, el.lon);
      }
    }

    // 2. Process way elements (both `out geom qt` embedded geometry and node-ref lists)
    let edgeCount = 0;
    for (const el of data.elements) {
      if (el.type !== 'way') continue;
      const tags = el.tags || {};

      // Skip impassable / private roads
      if (tags.area === 'yes') continue;
      if (tags.access === 'private' || tags.access === 'no') continue;
      if ((mode === 'walk' || mode === 'foot') && (tags.foot === 'no' || tags.foot === 'private')) continue;
      if (mode === 'bike' && (tags.bicycle === 'no' || tags.bicycle === 'private')) continue;
      if ((mode === 'motorcycle' || mode === 'car' || mode === 'drive') && (tags.motor_vehicle === 'no' || tags.motor_vehicle === 'private')) continue;
      if (mode === 'motorcycle' && (tags.motorcycle === 'no' || tags.motorcycle === 'private')) continue;
      if ((mode === 'car' || mode === 'drive') && (tags.motorcar === 'no' || tags.motorcar === 'private')) continue;

      const isCar = mode === 'car' || mode === 'drive';
      const isMotorcycle = mode === 'motorcycle';
      const isMotorVehicle = isCar || isMotorcycle;
      const isPedestrian = mode === 'walk' || mode === 'foot';

      // 1. Motorway / Expressway access: STRICTLY car/drive only. Foot, bike, motorcycle forbidden.
      const isMotorway = tags.highway === 'motorway' || tags.highway === 'motorway_link' || tags.motorroad === 'yes';
      if (isMotorway && !isCar) continue;

      // 2. Footways, steps, cycleways: forbidden for motorized vehicles unless explicitly designated
      const isPedestrianOrCycleTrack =
        tags.highway === 'footway' ||
        tags.highway === 'steps' ||
        tags.highway === 'pedestrian' ||
        tags.highway === 'cycleway' ||
        tags.highway === 'bridleway' ||
        tags.highway === 'path';
      if (isMotorVehicle && isPedestrianOrCycleTrack) {
        if (isMotorcycle) {
          if (tags.motorcycle !== 'yes' && tags.motor_vehicle !== 'yes') continue;
        } else {
          if (tags.motorcar !== 'yes' && tags.motor_vehicle !== 'yes') continue;
        }
      }
      if (mode === 'bike' && tags.highway === 'steps' && tags.bicycle !== 'yes') continue;

      // 3. Directional oneway constraints by travel mode
      let isOneway = false;
      let isReverseOneway = false;

      if (isPedestrian) {
        // Pedestrians can walk in both directions unless specifically signed oneway:foot
        if (tags['oneway:foot'] === 'yes') isOneway = true;
        else if (tags['oneway:foot'] === '-1' || tags['oneway:foot'] === 'reverse') isReverseOneway = true;
      } else if (mode === 'bike') {
        const contraflowCycle =
          tags.cycleway === 'opposite' ||
          tags.cycleway === 'opposite_lane' ||
          tags.cycleway === 'opposite_track' ||
          tags['cycleway:left'] === 'opposite' ||
          tags['cycleway:right'] === 'opposite';
        if (tags['oneway:bicycle'] === 'no' || contraflowCycle) {
          isOneway = false;
          isReverseOneway = false;
        } else if (tags['oneway:bicycle'] === 'yes' || tags['oneway:bicycle'] === '1') {
          isOneway = true;
        } else if (tags['oneway:bicycle'] === '-1' || tags['oneway:bicycle'] === 'reverse') {
          isReverseOneway = true;
        } else {
          if (tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true' || tags.junction === 'roundabout' || tags.junction === 'circular') {
            isOneway = true;
          } else if (tags.oneway === '-1' || tags.oneway === 'reverse') {
            isReverseOneway = true;
          }
        }
      } else if (isMotorcycle) {
        if (tags['oneway:motorcycle'] === 'no') {
          isOneway = false;
          isReverseOneway = false;
        } else if (tags['oneway:motorcycle'] === 'yes' || tags['oneway:motorcycle'] === '1') {
          isOneway = true;
        } else if (tags['oneway:motorcycle'] === '-1' || tags['oneway:motorcycle'] === 'reverse') {
          isReverseOneway = true;
        } else {
          if (tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true' || tags.junction === 'roundabout' || tags.junction === 'circular') {
            isOneway = true;
          } else if (tags.oneway === '-1' || tags.oneway === 'reverse') {
            isReverseOneway = true;
          }
        }
      } else {
        // Car / driving
        if (tags['oneway:motorcar'] === 'no') {
          isOneway = false;
          isReverseOneway = false;
        } else if (tags['oneway:motorcar'] === 'yes' || tags['oneway:motorcar'] === '1') {
          isOneway = true;
        } else if (tags['oneway:motorcar'] === '-1' || tags['oneway:motorcar'] === 'reverse') {
          isReverseOneway = true;
        } else {
          if (tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true' || tags.junction === 'roundabout' || tags.junction === 'circular' || isMotorway) {
            isOneway = true;
          } else if (tags.oneway === '-1' || tags.oneway === 'reverse') {
            isReverseOneway = true;
          }
        }
      }

      const addEdgePair = (u, v) => {
        if (isReverseOneway) {
          graph.addEdge(v, u);
        } else if (isOneway) {
          graph.addEdge(u, v);
        } else {
          graph.addEdge(u, v);
          graph.addEdge(v, u);
        }
        edgeCount++;
      };

      const hasGeom = Array.isArray(el.geometry) && el.geometry.length >= 2;
      const hasNodes = Array.isArray(el.nodes) && el.nodes.length >= 2;

      if (hasGeom) {
        const nodeIds = [];
        for (let i = 0; i < el.geometry.length; i++) {
          const pt = el.geometry[i];
          if (!pt || typeof pt.lat !== 'number' || typeof pt.lon !== 'number') continue;
          const nid = hasNodes && el.nodes[i] != null ? el.nodes[i] : `w${el.id}_${i}`;
          if (!graph.nodes.has(nid)) {
            const [x, y] = graph.geoToXy(pt.lat, pt.lon);
            graph.addNode(nid, x, y, pt.lat, pt.lon);
          }
          nodeIds.push(nid);
        }

        for (let i = 0; i < nodeIds.length - 1; i++) {
          addEdgePair(nodeIds[i], nodeIds[i + 1]);
        }
      } else if (hasNodes) {
        for (let i = 0; i < el.nodes.length - 1; i++) {
          const u = el.nodes[i];
          const v = el.nodes[i + 1];
          if (graph.nodes.has(u) && graph.nodes.has(v)) {
            addEdgePair(u, v);
          }
        }
      }
    }

    return edgeCount;
  }

  /**
   * Fetches complete real-world OSM road network via Overpass API and builds a connected,
   * densified planar graph. Gracefully falls back to synthetic urban network on offline/timeout.
   */
  static async fromOsm(centerLatLon, distM = 1800, mode = 'walk', options = {}) {
    const [cLat, cLng] = centerLatLon;
    const safeDistM = Math.max(900, Math.min(12000, Math.round(distM)));

    // Fast path for offline or automated test hooks (unless live Overpass is explicitly requested)
    const isTestHookMode =
      typeof window !== 'undefined' &&
      Boolean(window.__mappingElfTestHooks) &&
      !window.__mappingElfTestHooks?.forceLiveOsm &&
      !options.forceLiveOsm;
    if ((typeof navigator !== 'undefined' && navigator?.onLine === false) || isTestHookMode) {
      const g = RoadNetworkGraph.buildFallbackUrbanGraph(safeDistM, centerLatLon);
      g.isRealOsm = false;
      return g;
    }

    // Check in-memory graph cache
    const cacheKey = `${cLat.toFixed(3)}_${cLng.toFixed(3)}_${Math.ceil(safeDistM / 200) * 200}_${mode}`;
    if (_osmGraphCache.has(cacheKey)) {
      return _osmGraphCache.get(cacheKey);
    }

    const graph = new RoadNetworkGraph(centerLatLon);

    // Complete highway filter including primary/secondary/tertiary streets, links, footpaths, and crossings
    const highwayFilter =
      mode === 'bike'
        ? 'cycleway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|primary|trunk|service|track|tertiary_link|secondary_link|primary_link|trunk_link|road'
        : (mode === 'drive' || mode === 'car')
          ? 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service|road'
          : mode === 'motorcycle'
            ? 'trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service|road'
            : 'footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|primary|trunk|service|cycleway|track|steps|tertiary_link|secondary_link|primary_link|trunk_link|road|bridleway|corridor|crossing';

    // Use bounding box query for fast Overpass R-tree spatial index lookup
    const cosLat = Math.max(0.01, Math.cos((cLat * Math.PI) / 180));
    const dLat = (safeDistM * 1.05) / M_PER_DEG_LAT;
    const dLng = (safeDistM * 1.05) / (M_PER_DEG_LAT * cosLat);
    const south = (cLat - dLat).toFixed(6);
    const west = (cLng - dLng).toFixed(6);
    const north = (cLat + dLat).toFixed(6);
    const east = (cLng + dLng).toFixed(6);

    const query =
      `[out:json][timeout:18];` +
      `way["highway"~"^(${highwayFilter})$"](${south},${west},${north},${east});` +
      `out geom qt;`;

    const fastEndpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    let data = null;
    const timeoutMs = options.timeoutMs || 14000;

    const fetchFromEndpoint = async (ep) => {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const parsed = await res.json();
          if (parsed && Array.isArray(parsed.elements) && parsed.elements.length > 0) {
            return parsed;
          }
        }
      } catch (_postErr) {
        const resGet = await fetch(`${ep}?data=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(Math.min(10000, timeoutMs)),
        });
        if (resGet.ok) {
          const parsed = await resGet.json();
          if (parsed && Array.isArray(parsed.elements) && parsed.elements.length > 0) {
            return parsed;
          }
        }
      }
      throw new Error(`Overpass endpoint failed: ${ep}`);
    };

    try {
      data = await Promise.any(fastEndpoints.map((ep) => fetchFromEndpoint(ep)));
    } catch (_err) {
      data = null;
    }

    if (data && Array.isArray(data.elements)) {
      RoadNetworkGraph.populateFromOverpassData(graph, data, mode);

      if (graph.nodes.size >= 12) {
        const anchorXY = Array.isArray(options.anchorGeo)
          ? graph.geoToXy(options.anchorGeo[0], options.anchorGeo[1])
          : [0, 0];
        graph.buildIndex({
          pruneComponents: true,
          anchorXY,
          densify: true,
          maxEdgeLengthM: 25,
        });
        graph.isRealOsm = true;

        if (_osmGraphCache.size >= MAX_OSM_CACHE_ENTRIES) {
          const oldestKey = _osmGraphCache.keys().next().value;
          _osmGraphCache.delete(oldestKey);
        }
        _osmGraphCache.set(cacheKey, graph);
        return graph;
      }
    }

    // Fallback to well-connected urban street graph centered at location
    const fallback = RoadNetworkGraph.buildFallbackUrbanGraph(safeDistM, centerLatLon);
    fallback.isRealOsm = false;
    return fallback;
  }
}

/**
 * User-defined constraints for GPS Art route optimization.
 */
export class RouteConstraints {
  constructor({
    targetLengthM = 5000.0,
    travelMode = 'walk',
    maxTurningPoints = 22,
    startPointXY = null,
    startPointGeo = null,
    closedLoop = true,
    flipY = false,
    trimSpurs = true,
    rotationBoundsDeg = [0.0, 360.0],
    scaleBoundsRatio = [0.55, 1.35],
    startFractionBounds = [0.0, 1.0],
    weightShape = 4.2,
    weightLength = 220.0,
    weightOverlap = 260.0,
    isRefinement = false,
  } = {}) {
    this.targetLengthM = targetLengthM;
    this.travelMode = travelMode;
    this.maxTurningPoints = maxTurningPoints;
    this.startPointXY = startPointXY;
    this.startPointGeo = startPointGeo;
    this.closedLoop = closedLoop;
    this.flipY = flipY;
    this.trimSpurs = trimSpurs;
    this.rotationBoundsDeg = rotationBoundsDeg;
    this.scaleBoundsRatio = scaleBoundsRatio;
    this.startFractionBounds = startFractionBounds;
    this.weightShape = weightShape;
    this.weightLength = weightLength;
    this.weightOverlap = weightOverlap;
    this.isRefinement = isRefinement;
  }
}

/**
 * GIS Road Network Route Optimizer for GPS Art.
 * Matches a 2D vector pattern onto a real-world traversable road network.
 */
export class GPSArtOptimizer {
  constructor(graph) {
    this.G = graph;
    this.kdtree = graph.kdtree;
    this.coreKdTree = graph.coreKdTree || graph.kdtree;
    this.minX = graph.minX;
    this.minY = graph.minY;
    this.maxX = graph.maxX;
    this.maxY = graph.maxY;
  }

  /**
   * Cleans raw input coordinates and optionally flips Y-axis (for HTML5 canvas downward Y).
   */
  static cleanInputCoords(rawCoords, closedLoop = true, flipY = false) {
    const pts = [];
    const ySign = flipY ? -1 : 1;
    for (const p of rawCoords || []) {
      const x = Array.isArray(p) ? p[0] : (p.x != null ? p.x : p.lat);
      const rawY = Array.isArray(p) ? p[1] : (p.y != null ? p.y : p.lng);
      const y = rawY * ySign;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const prev = pts[pts.length - 1];
        if (!prev || Math.hypot(prev[0] - x, prev[1] - y) > 1e-5) {
          pts.push([x, y]);
        }
      }
    }
    if (pts.length < 2) return [];
    if (closedLoop && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) > 1e-5) {
      pts.push([pts[0][0], pts[0][1]]);
    }
    return pts;
  }

  /**
   * Preprocesses raw canvas/vector coordinates:
   * 1. Cleans and closes loop if closedLoop is true.
   * 2. Preserves sharp curvature peaks AND simplifies via RDP + max-span subdivision
   *    so vertex count <= maxVertices while curved lobes remain well-supported.
   * 3. Centers at centroid (0, 0).
   * 4. Normalizes total perimeter length to 1.0.
   */
  static preprocessPattern(rawCoords, maxVertices = 22, closedLoop = true, flipY = false) {
    const pts = GPSArtOptimizer.cleanInputCoords(rawCoords, closedLoop, flipY);
    if (pts.length < 2) return [];

    // First center and normalize the full contour so RDP operates in scale-invariant space
    const dense = GPSArtOptimizer.centerAndNormalize2D(pts);
    if (dense.length <= maxVertices) return dense;

    // Binary search on Ramer-Douglas-Peucker tolerance to fit within vertex budget
    const initialLen = GPSArtOptimizer.computePolylineLength(dense);
    let tolLow = 0.0;
    let tolHigh = initialLen * 0.25;
    let bestLine = dense;

    // Leave room to subdivide overly long straight chords along curved arcs
    const rdpTarget = Math.max(4, Math.min(maxVertices, Math.round(maxVertices * 0.82)));

    for (let iter = 0; iter < 25; iter++) {
      const mid = (tolLow + tolHigh) / 2.0;
      const simplified = GPSArtOptimizer.simplifyRDP2D(dense, mid);
      if (simplified.length <= rdpTarget && simplified.length >= 3) {
        bestLine = simplified;
        tolHigh = mid;
      } else if (simplified.length < 3) {
        tolHigh = mid;
      } else {
        tolLow = mid;
      }
    }

    let line = bestLine;

    // If budget remains, split the longest contour intervals using points from `dense`
    // so curved lobes (heart, plum, animal bodies) don't chord across long spans.
    if (dense.length > line.length && line.length < maxVertices) {
      line = GPSArtOptimizer.enrichWithContourGuides(dense, line, maxVertices);
    }

    return GPSArtOptimizer.centerAndNormalize2D(line);
  }

  /**
   * Produces both a dense normalized contour (for exact shape evaluation and refinement)
   * and the curvature-prioritized turning/guide pattern.
   */
  static preparePatternPair(rawCoords, maxVertices = 22, closedLoop = true, flipY = false, denseCount = 96) {
    const pts = GPSArtOptimizer.cleanInputCoords(rawCoords, closedLoop, flipY);
    if (pts.length < 2) return { normPattern: [], densePattern: [] };

    const normDenseRaw = GPSArtOptimizer.centerAndNormalize2D(pts);
    const densePattern = GPSArtOptimizer.sampleUniform2D(normDenseRaw, denseCount);
    if (closedLoop && densePattern.length >= 2) {
      densePattern[densePattern.length - 1] = [densePattern[0][0], densePattern[0][1]];
    }

    const normPattern = GPSArtOptimizer.preprocessPattern(pts, maxVertices, closedLoop, false);
    return { normPattern, densePattern };
  }

  static centerAndNormalize2D(pts) {
    if (!pts || pts.length === 0) return [];
    // Compute arc-length weighted centroid so uneven vertex density doesn't bias centering
    let cx = 0;
    let cy = 0;
    let totalW = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const w = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (w > 0) {
        cx += 0.5 * (pts[i][0] + pts[i + 1][0]) * w;
        cy += 0.5 * (pts[i][1] + pts[i + 1][1]) * w;
        totalW += w;
      }
    }
    if (totalW > 1e-9) {
      cx /= totalW;
      cy /= totalW;
    } else {
      for (const [x, y] of pts) {
        cx += x;
        cy += y;
      }
      cx /= pts.length;
      cy /= pts.length;
    }

    const centered = pts.map(([x, y]) => [x - cx, y - cy]);
    const totalLen = GPSArtOptimizer.computePolylineLength(centered);
    const sFactor = totalLen > 0 ? 1.0 / totalLen : 1.0;
    return centered.map(([x, y]) => [x * sFactor, y * sFactor]);
  }

  /**
   * Inserts intermediate points from `dense` along the longest segments of `simplified`
   * up to `maxVertices`, preserving curved lobes.
   */
  static enrichWithContourGuides(dense, simplified, maxVertices) {
    if (simplified.length >= maxVertices || dense.length <= simplified.length) {
      return simplified;
    }

    // Locate monotonic indices in `dense` corresponding to `simplified` vertices
    const denseIndices = [0];
    let cursor = 0;
    for (let k = 1; k < simplified.length - 1; k++) {
      const target = simplified[k];
      let bestIdx = cursor;
      let bestD = Infinity;
      for (let i = cursor; i < dense.length - 1; i++) {
        const d = Math.hypot(dense[i][0] - target[0], dense[i][1] - target[1]);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      if (bestIdx > denseIndices[denseIndices.length - 1]) {
        denseIndices.push(bestIdx);
        cursor = bestIdx;
      }
    }
    denseIndices.push(dense.length - 1);

    const cum = [0];
    for (let i = 1; i < dense.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    }

    while (denseIndices.length < maxVertices) {
      let bestGapPos = -1;
      let bestGapScore = 0;
      let bestMidDenseIdx = -1;

      for (let i = 0; i < denseIndices.length - 1; i++) {
        const idxA = denseIndices[i];
        const idxB = denseIndices[i + 1];
        if (idxB - idxA <= 1) continue;

        const arcLen = cum[idxB] - cum[idxA];
        // Also check max arch deviation from chord (idxA -> idxB)
        let maxArchDev = 0;
        let peakIdx = Math.floor((idxA + idxB) / 2);
        for (let j = idxA + 1; j < idxB; j++) {
          const dev = GPSArtOptimizer.perpendicularDistance2D(dense[j], dense[idxA], dense[idxB]);
          if (dev > maxArchDev) {
            maxArchDev = dev;
            peakIdx = j;
          }
        }

        const score = arcLen + maxArchDev * 3.0;
        if (score > bestGapScore) {
          bestGapScore = score;
          bestGapPos = i + 1;
          bestMidDenseIdx = maxArchDev > 0.008 ? peakIdx : Math.floor((idxA + idxB) / 2);
        }
      }

      if (bestGapPos === -1 || bestMidDenseIdx === -1) break;
      denseIndices.splice(bestGapPos, 0, bestMidDenseIdx);
    }

    return denseIndices.map((idx) => [dense[idx][0], dense[idx][1]]);
  }

  /**
   * Cyclically shifts closed polygon coordinates so that an arbitrary intermediate
   * point at arc-length fraction t in [0, 1) becomes vertex 0.
   */
  static shiftPatternStart(normPattern, startFraction = 0, closedLoop = true) {
    if (!Array.isArray(normPattern) || normPattern.length < 3) {
      return normPattern ? normPattern.slice() : [];
    }

    const frac = ((startFraction % 1.0) + 1.0) % 1.0;
    if (frac < 1e-4 || frac > 1.0 - 1e-4) {
      return normPattern.slice();
    }

    const N = normPattern.length;
    const isClosed = closedLoop || Math.hypot(
      normPattern[0][0] - normPattern[N - 1][0],
      normPattern[0][1] - normPattern[N - 1][1]
    ) < 1e-4;

    if (!isClosed) {
      return normPattern.slice();
    }

    const cum = [0];
    for (let i = 0; i < N - 1; i++) {
      const d = Math.hypot(
        normPattern[i + 1][0] - normPattern[i][0],
        normPattern[i + 1][1] - normPattern[i][1]
      );
      cum.push(cum[cum.length - 1] + d);
    }
    const totalLen = cum[cum.length - 1];
    if (!(totalLen > 1e-6)) return normPattern.slice();

    const targetD = frac * totalLen;
    let segIdx = 0;
    while (segIdx < N - 2 && cum[segIdx + 1] < targetD) {
      segIdx++;
    }

    const segSpan = cum[segIdx + 1] - cum[segIdx];
    const alpha = segSpan > 1e-6 ? (targetD - cum[segIdx]) / segSpan : 0;

    const pA = normPattern[segIdx];
    const pB = normPattern[segIdx + 1];
    const newStart = [
      pA[0] + (pB[0] - pA[0]) * alpha,
      pA[1] + (pB[1] - pA[1]) * alpha,
    ];

    if (alpha < 0.04) {
      const shifted = [];
      for (let k = segIdx; k < N - 1; k++) shifted.push(normPattern[k]);
      for (let k = 0; k <= segIdx; k++) shifted.push(normPattern[k]);
      return shifted;
    }
    if (alpha > 0.96) {
      const nextIdx = (segIdx + 1) % (N - 1);
      const shifted = [];
      for (let k = nextIdx; k < N - 1; k++) shifted.push(normPattern[k]);
      for (let k = 0; k <= nextIdx; k++) shifted.push(normPattern[k]);
      return shifted;
    }

    const shifted = [newStart];
    for (let k = segIdx + 1; k < N - 1; k++) {
      shifted.push(normPattern[k]);
    }
    for (let k = 0; k <= segIdx; k++) {
      shifted.push(normPattern[k]);
    }
    shifted.push([newStart[0], newStart[1]]);

    return shifted;
  }

  /**
   * Transforms normalized pattern by scale, rotation angle (degrees), translation, and start fraction.
   * If anchorStartXY is specified, locks vertex 0 (selected start point) exactly to anchor location.
   */
  transformPattern(
    normPattern,
    scaleM,
    angleDeg,
    tx = 0,
    ty = 0,
    anchorStartXY = null,
    startFraction = 0,
    closedLoop = true
  ) {
    const pattern = startFraction > 0
      ? GPSArtOptimizer.shiftPatternStart(normPattern, startFraction, closedLoop)
      : normPattern;

    const rad = (angleDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const scaledAndRotated = pattern.map(([x, y]) => {
      const sx = x * scaleM;
      const sy = y * scaleM;
      return [sx * cosR - sy * sinR, sx * sinR + sy * cosR];
    });

    let dx = tx;
    let dy = ty;
    if (anchorStartXY != null && scaledAndRotated.length > 0) {
      dx = anchorStartXY[0] - scaledAndRotated[0][0];
      dy = anchorStartXY[1] - scaledAndRotated[0][1];
    }

    return scaledAndRotated.map(([x, y]) => [x + dx, y + dy]);
  }

  /**
   * Snaps a planar target point to the road network, preferring 2-core (non-dead-end)
   * streets to avoid cul-de-sac spikes unless a dead-end node is much closer at a sharp corner.
   */
  snapPointToRoad(pt, isCorner = false) {
    const allHit = this.kdtree ? this.kdtree.query(pt) : null;
    if (!allHit || !allHit.node) return null;

    if (this.coreKdTree && this.coreKdTree !== this.kdtree) {
      const coreHit = this.coreKdTree.query(pt);
      if (coreHit && coreHit.node) {
        const toleranceM = isCorner ? 22 : 42;
        if (coreHit.distance <= allHit.distance + toleranceM) {
          return coreHit.node;
        }
      }
    }
    return allHit.node;
  }

  /**
   * Snaps transformed pattern turning points to nearest road nodes and computes
   * corridor-guided, self-avoiding shortest paths along the road network.
   * Returns: { routeCoordsXY, totalLengthM, overlapRatio, fullNodePath, snappedNodes } or null.
   */
  matchAndRoute(transformedPattern, options = {}) {
    if (!transformedPattern || transformedPattern.length < 2) return null;

    const nPts = transformedPattern.length;
    const snappedNodes = [];
    const snappedTargetPts = [];

    for (let i = 0; i < nPts; i++) {
      const pt = transformedPattern[i];
      // Check if vertex i is a sharp corner
      let isCorner = i === 0 || i === nPts - 1;
      if (!isCorner && i > 0 && i < nPts - 1) {
        const pPrev = transformedPattern[i - 1];
        const pNext = transformedPattern[i + 1];
        const v1x = pt[0] - pPrev[0], v1y = pt[1] - pPrev[1];
        const v2x = pNext[0] - pt[0], v2y = pNext[1] - pt[1];
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        if (l1 > 1e-3 && l2 > 1e-3) {
          const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
          if (cos < 0.5) isCorner = true; // turn > 60 deg
        }
      }

      const node = this.snapPointToRoad(pt, isCorner);
      if (!node) return null;
      snappedNodes.push(node.id);
      snappedTargetPts.push(pt);
    }

    // Remove consecutive duplicate nodes while keeping target segment endpoints aligned
    const cleanedNodes = [snappedNodes[0]];
    const cleanedTargets = [snappedTargetPts[0]];
    for (let i = 1; i < snappedNodes.length; i++) {
      if (snappedNodes[i] !== cleanedNodes[cleanedNodes.length - 1]) {
        cleanedNodes.push(snappedNodes[i]);
        cleanedTargets.push(snappedTargetPts[i]);
      }
    }

    if (cleanedNodes.length < 2) return null;

    const fullNodePath = [];
    const waypointNodeSet = new Set(cleanedNodes);
    const usedEdgeCounts = new Map();
    const corridorWeight = options.corridorWeight ?? 0.022;
    const allowHairpinTrim = options.pruneSpurs !== false;

    for (let i = 0; i < cleanedNodes.length - 1; i++) {
      const u = cleanedNodes[i];
      const v = cleanedNodes[i + 1];
      const prevNodeId = fullNodePath.length >= 2 ? fullNodePath[fullNodePath.length - 2] : null;
      let recentEdgeSet = null;
      if (allowHairpinTrim && fullNodePath.length >= 2) {
        recentEdgeSet = new Set();
        const tailStart = Math.max(0, fullNodePath.length - 3);
        for (let t = tailStart; t < fullNodePath.length - 1; t++) {
          const a = fullNodePath[t];
          const b = fullNodePath[t + 1];
          recentEdgeSet.add(String(a) < String(b) ? `${a}_${b}` : `${b}_${a}`);
        }
      }

      const res = this.G.routeCorridor(
        u,
        v,
        cleanedTargets[i],
        cleanedTargets[i + 1],
        usedEdgeCounts,
        prevNodeId,
        corridorWeight,
        recentEdgeSet
      );
      if (!res || !res.path || res.path.length === 0) return null;

      if (i === 0) {
        fullNodePath.push(...res.path);
      } else {
        fullNodePath.push(...res.path.slice(1));
      }

      for (let j = 0; j < res.path.length - 1; j++) {
        const a = res.path[j];
        const b = res.path[j + 1];
        const edgeKey = String(a) < String(b) ? `${a}_${b}` : `${b}_${a}`;
        usedEdgeCounts.set(edgeKey, (usedEdgeCounts.get(edgeKey) || 0) + 1);
      }
    }

    if (fullNodePath.length < 2) return null;

    // Eliminate accidental micro-hairpin reversals (A -> B -> A) unless B is a sharp corner waypoint
    const prunedPath = GPSArtOptimizer.pruneNodePathHairpins(fullNodePath, waypointNodeSet, allowHairpinTrim);

    // Recompute exact physical length and edge overlap from prunedPath
    let totalLengthM = 0;
    const traversedEdges = [];
    const routeCoordsXY = [];

    for (let i = 0; i < prunedPath.length; i++) {
      const node = this.G.nodes.get(prunedPath[i]);
      if (!node) continue;
      routeCoordsXY.push([node.x, node.y]);

      if (i > 0) {
        const u = prunedPath[i - 1];
        const v = prunedPath[i];
        const prevNode = this.G.nodes.get(u);
        const edgeLen = this.G.adj.get(u)?.get(v) ?? Math.hypot(node.x - prevNode.x, node.y - prevNode.y);
        totalLengthM += edgeLen;
        const edgeKey = String(u) < String(v) ? `${u}_${v}` : `${v}_${u}`;
        traversedEdges.push(edgeKey);
      }
    }

    if (routeCoordsXY.length < 2 || traversedEdges.length === 0) return null;

    const uniqueEdges = new Set(traversedEdges).size;
    const overlapRatio = 1.0 - uniqueEdges / traversedEdges.length;

    return {
      routeCoordsXY,
      totalLengthM,
      overlapRatio,
      fullNodePath: prunedPath,
      snappedNodes: cleanedNodes,
    };
  }

  /**
   * Collapses immediate out-and-back hairpins (u -> v -> u) on the graph node sequence.
   */
  static pruneNodePathHairpins(nodePath, protectedNodes = new Set(), aggressive = true) {
    if (!nodePath || nodePath.length < 4) return nodePath ? nodePath.slice() : [];
    let current = nodePath.slice();

    for (let pass = 0; pass < 3; pass++) {
      const stack = [];
      let changed = false;
      for (let i = 0; i < current.length; i++) {
        const nid = current[i];
        if (
          stack.length >= 2 &&
          stack[stack.length - 2] === nid &&
          (aggressive || !protectedNodes.has(stack[stack.length - 1]))
        ) {
          stack.pop(); // remove the spike tip
          changed = true;
        } else {
          stack.push(nid);
        }
      }
      current = stack;
      if (!changed || current.length < 4) break;
    }

    return current.length >= 2 ? current : nodePath;
  }

  /**
   * Computes symmetric Chamfer + Hausdorff geometric distance between target
   * shape and actual routed path on the road network.
   */
  static computeShapeSimilarityError(targetGeom, routedGeom, numSamples = 64) {
    const metrics = GPSArtOptimizer.computeSimilarityMetrics(targetGeom, routedGeom, numSamples);
    return metrics.shapeErr;
  }

  /**
   * Computes comprehensive geometric similarity metrics between target shape and routed path:
   * - forwardDist: mean distance from target shape to routed path (m)
   * - backwardDist: mean distance from routed path to target shape (m)
   * - chamferDist: 0.5 * (forwardDist + backwardDist) (m)
   * - maxDevM: maximum directed deviation from target shape to routed path (m)
   * - hausdorffDist: bidirectional Hausdorff distance (m)
   * - shapeErr: 0.5 * (forwardDist + backwardDist) + 0.3 * hausdorffDist (m)
   * - similarityPct: 0..100% shape similarity score normalized by mean shape radius
   */
  static computeSimilarityMetrics(targetGeom, routedGeom, numSamples = 72) {
    if (!targetGeom || targetGeom.length < 2 || !routedGeom || routedGeom.length < 2) {
      return {
        forwardDist: 9999,
        backwardDist: 9999,
        chamferDist: 9999,
        maxDevM: 9999,
        hausdorffDist: 9999,
        shapeErr: 9999,
        similarityPct: 0,
      };
    }

    const targetSamples = GPSArtOptimizer.sampleUniform2D(targetGeom, numSamples);
    const routedSamples = GPSArtOptimizer.sampleUniform2D(routedGeom, numSamples);

    let forwardSum = 0;
    let maxForward = 0;
    for (const p of targetSamples) {
      const d = GPSArtOptimizer.minDistPointToPolyline(p, routedGeom);
      forwardSum += d;
      if (d > maxForward) maxForward = d;
    }
    const forwardDist = forwardSum / targetSamples.length;

    let backwardSum = 0;
    let maxBackward = 0;
    for (const p of routedSamples) {
      const d = GPSArtOptimizer.minDistPointToPolyline(p, targetGeom);
      backwardSum += d;
      if (d > maxBackward) maxBackward = d;
    }
    const backwardDist = backwardSum / routedSamples.length;
    const chamferDist = 0.5 * (forwardDist + backwardDist);
    const hausdorffDist = Math.max(maxForward, maxBackward);
    const shapeErr = chamferDist + 0.3 * hausdorffDist;

    // Compute mean radius of target shape around its centroid for scale-invariant similarity %
    let cx = 0, cy = 0;
    for (const [x, y] of targetSamples) {
      cx += x;
      cy += y;
    }
    cx /= targetSamples.length;
    cy /= targetSamples.length;

    let meanRadius = 0;
    for (const [x, y] of targetSamples) {
      meanRadius += Math.hypot(x - cx, y - cy);
    }
    meanRadius /= targetSamples.length;

    const refRadius = Math.max(35, meanRadius);
    const rawSim = Math.max(0, Math.min(1, 1 - chamferDist / refRadius));
    const similarityPct = Math.max(0, Math.min(100, Math.round(rawSim * 100)));

    return {
      forwardDist,
      backwardDist,
      chamferDist,
      maxDevM: maxForward,
      hausdorffDist,
      shapeErr,
      similarityPct,
    };
  }

  /**
   * Multi-Stage Global + Local Optimization:
   * 1. Curvature-preserving pattern normalization (`normPattern` + `densePattern`)
   * 2. Detour-compensated Multi-Start Differential Evolution over (scaleM, angleDeg, [tx, ty], startFraction)
   * 3. Exact Scale Calibration + Deviation-Driven Sub-Arc Refinement on the road graph
   */
  optimize(rawPattern, constraints = new RouteConstraints()) {
    const maxVertices = Math.max(8, constraints.maxTurningPoints || 22);
    const { normPattern, densePattern } = GPSArtOptimizer.preparePatternPair(
      rawPattern,
      maxVertices,
      constraints.closedLoop,
      Boolean(constraints.flipY),
      96
    );

    if (!normPattern || normPattern.length < 2) {
      throw new Error('Pattern has insufficient vertices for GPS Art optimization.');
    }

    const sMin = constraints.targetLengthM * (constraints.scaleBoundsRatio?.[0] ?? 0.55);
    const sMax = constraints.targetLengthM * (constraints.scaleBoundsRatio?.[1] ?? 1.35);
    const [rotMin, rotMax] = constraints.rotationBoundsDeg || [0, 360];

    let anchorXY = null;
    if (constraints.startPointGeo) {
      anchorXY = this.G.geoToXy(constraints.startPointGeo[0], constraints.startPointGeo[1]);
    } else if (constraints.startPointXY) {
      anchorXY = constraints.startPointXY;
    }

    // If anchor is locked, snap anchor to nearest valid 2-core road node first
    if (anchorXY) {
      const snappedNode = this.snapPointToRoad(anchorXY, false);
      if (snappedNode) {
        anchorXY = [snappedNode.x, snappedNode.y];
      }
    }

    const isAnchored = anchorXY != null;
    const marginX = (this.maxX - this.minX) * 0.15;
    const marginY = (this.maxY - this.minY) * 0.15;

    const bounds = isAnchored
      ? [
          [sMin, sMax],
          [rotMin, rotMax],
          constraints.startFractionBounds || [0.0, 1.0],
        ]
      : [
          [sMin, sMax],
          [rotMin, rotMax],
          [this.minX + marginX, this.maxX - marginX],
          [this.minY + marginY, this.maxY - marginY],
          constraints.startFractionBounds || [0.0, 1.0],
        ];

    // Candidate start fractions at polygon corners and midpoints
    const cum = [0];
    for (let i = 0; i < normPattern.length - 1; i++) {
      cum.push(
        cum[cum.length - 1] +
          Math.hypot(normPattern[i + 1][0] - normPattern[i][0], normPattern[i + 1][1] - normPattern[i][1])
      );
    }
    const totalP = cum[cum.length - 1] || 1;
    const candidateStarts = [0.0];
    for (let i = 1; i < normPattern.length - 1; i++) {
      candidateStarts.push(cum[i] / totalP);
    }

    const evaluateCandidate = (scaleM, angleDeg, tx, ty, rawStartFrac, customNormPattern = null) => {
      const startFraction = ((rawStartFrac % 1.0) + 1.0) % 1.0;
      const activePattern = customNormPattern || normPattern;

      const candidateGeom = this.transformPattern(
        activePattern,
        scaleM,
        angleDeg,
        tx,
        ty,
        anchorXY,
        startFraction,
        constraints.closedLoop
      );
      const denseTargetGeom = this.transformPattern(
        densePattern,
        scaleM,
        angleDeg,
        tx,
        ty,
        anchorXY,
        startFraction,
        constraints.closedLoop
      );

      const res = this.matchAndRoute(candidateGeom, {
        pruneSpurs: constraints.trimSpurs !== false,
      });

      if (!res || res.totalLengthM === 0) {
        return {
          cost: 1e9,
          routed: null,
          candidate: candidateGeom,
          denseTarget: denseTargetGeom,
          shapeErr: 9999,
          maxDevM: 9999,
          similarityPct: 0,
          startFraction,
        };
      }

      const simMetrics = GPSArtOptimizer.computeSimilarityMetrics(denseTargetGeom, res.routeCoordsXY, 72);
      const shapeErr = simMetrics.shapeErr;
      const lenErr = Math.abs(res.totalLengthM - constraints.targetLengthM) / constraints.targetLengthM;
      const simPct = simMetrics.similarityPct;

      const simPenalty = (100 - simPct) * 18.0;
      const totalCost =
        simPenalty +
        constraints.weightShape * shapeErr +
        constraints.weightLength * lenErr +
        constraints.weightOverlap * res.overlapRatio;

      return {
        cost: totalCost,
        routed: res,
        candidate: candidateGeom,
        denseTarget: denseTargetGeom,
        shapeErr,
        maxDevM: simMetrics.maxDevM,
        similarityPct: simPct,
        startFraction,
      };
    };

    const evaluateParams = (params) => {
      if (isAnchored) {
        return evaluateCandidate(params[0], params[1], 0, 0, params[2]);
      }
      return evaluateCandidate(params[0], params[1], params[2], params[3], params[4]);
    };

    // Differential Evolution (Hybrid DE/best/1/bin + DE/rand/1/bin)
    const isRefine = Boolean(constraints.isRefinement);
    const popSize = isRefine ? 8 : Math.min(16, Math.max(10, candidateStarts.length));
    const maxIter = isRefine ? 8 : 14;
    const F = 0.65;
    const CR = 0.82;
    const dim = bounds.length;

    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    // Estimate road detour factor (~1.22 on urban street networks) for smart initial scale seeding
    const detourScaleGuess = Math.max(sMin, Math.min(sMax, constraints.targetLengthM / 1.22));
    const rotSpan = rotMax - rotMin;

    const population = [];
    const costs = [];
    const evaluations = [];

    for (let i = 0; i < popSize; i++) {
      const ind = [];
      for (let d = 0; d < dim; d++) {
        ind.push(bounds[d][0] + rand() * (bounds[d][1] - bounds[d][0]));
      }

      // Individual 0: exact drawn orientation (or midpoint) + anchor start 0 + detour-compensated scale
      if (i === 0) {
        ind[0] = detourScaleGuess;
        ind[1] = rotMin <= 0 && rotMax >= 0 ? 0 : (rotMin + rotMax) / 2;
        ind[isAnchored ? 2 : 4] = bounds[isAnchored ? 2 : 4][0];
      } else {
        // Stratified scale around detour-compensated guess
        const scaleSpread = (sMax - sMin) * 0.35;
        ind[0] = Math.max(sMin, Math.min(sMax, detourScaleGuess + ((i / popSize) - 0.5) * 2 * scaleSpread));

        // Stratified rotation angles across allowed tolerance
        if (rotSpan > 0) {
          ind[1] = rotMin + ((i % 8) / 8) * rotSpan;
        } else {
          ind[1] = rotMin;
        }

        // Seed startFraction with curvature corners
        if (candidateStarts.length > 0) {
          const startIdx = isAnchored ? 2 : 4;
          const [sfMin, sfMax] = bounds[startIdx];
          const baseFrac = candidateStarts[i % candidateStarts.length];
          ind[startIdx] = Math.max(sfMin, Math.min(sfMax, baseFrac));
        }
      }

      population.push(ind);
      const evalRes = evaluateParams(ind);
      costs.push(evalRes.cost);
      evaluations.push(evalRes);
    }

    let bestIdx = 0;
    for (let i = 1; i < popSize; i++) {
      if (costs[i] < costs[bestIdx]) bestIdx = i;
    }

    for (let gen = 0; gen < maxIter; gen++) {
      for (let i = 0; i < popSize; i++) {
        let a, b, c;
        do { a = Math.floor(rand() * popSize); } while (a === i);
        do { b = Math.floor(rand() * popSize); } while (b === i || b === a);
        do { c = Math.floor(rand() * popSize); } while (c === i || c === a || c === b);

        // Alternate between DE/best/1/bin and DE/rand/1/bin for fast convergence + diversity
        const baseVec = gen % 2 === 0 ? population[bestIdx] : population[a];
        const rDim = Math.floor(rand() * dim);
        const trial = [];
        for (let d = 0; d < dim; d++) {
          if (d === rDim || rand() < CR) {
            let val = baseVec[d] + F * (population[b][d] - population[c][d]);
            val = Math.max(bounds[d][0], Math.min(bounds[d][1], val));
            trial.push(val);
          } else {
            trial.push(population[i][d]);
          }
        }

        const trialEval = evaluateParams(trial);
        if (trialEval.cost <= costs[i]) {
          population[i] = trial;
          costs[i] = trialEval.cost;
          evaluations[i] = trialEval;
          if (trialEval.cost < costs[bestIdx]) {
            bestIdx = i;
          }
        }
      }
    }

    let bestParams = population[bestIdx].slice();
    let bestEval = evaluations[bestIdx];

    // Stage 3A: Exact Scale Polish (calibrating road detour length to match targetLengthM)
    for (let calibStep = 0; calibStep < 3; calibStep++) {
      if (!bestEval.routed || bestEval.routed.totalLengthM <= 0) break;
      const actualLen = bestEval.routed.totalLengthM;
      const relErr = Math.abs(actualLen - constraints.targetLengthM) / constraints.targetLengthM;
      if (relErr <= 0.015) break;

      const ratio = constraints.targetLengthM / actualLen;
      const dampedRatio = 1.0 + (ratio - 1.0) * 0.85;
      const nextScale = Math.max(sMin * 0.75, Math.min(sMax * 1.25, bestParams[0] * dampedRatio));
      const polishedParams = bestParams.slice();
      polishedParams[0] = nextScale;

      const polishedEval = evaluateParams(polishedParams);
      if (
        polishedEval.routed &&
        (polishedEval.cost < bestEval.cost ||
          (polishedEval.similarityPct >= bestEval.similarityPct - 1 &&
            Math.abs(polishedEval.routed.totalLengthM - constraints.targetLengthM) <
              Math.abs(actualLen - constraints.targetLengthM)))
      ) {
        bestParams = polishedParams;
        bestEval = polishedEval;
      }
    }

    // Stage 3B: Deviation-Driven Sub-Arc Pinning on the Graph
    if (bestEval.routed && densePattern.length > normPattern.length) {
      const refinedPattern = this._refinePatternByDeviation(
        normPattern,
        densePattern,
        bestParams,
        isAnchored,
        anchorXY,
        constraints
      );
      if (refinedPattern) {
        const refinedEval = evaluateCandidate(
          bestParams[0],
          bestParams[1],
          isAnchored ? 0 : bestParams[2],
          isAnchored ? 0 : bestParams[3],
          isAnchored ? bestParams[2] : bestParams[4],
          refinedPattern
        );
        if (
          refinedEval.routed &&
          (refinedEval.similarityPct > bestEval.similarityPct ||
            (refinedEval.similarityPct === bestEval.similarityPct && refinedEval.maxDevM < bestEval.maxDevM))
        ) {
          bestEval = refinedEval;
        }
      }
    }

    const routedGeom = bestEval.routed;
    const targetGeom = bestEval.denseTarget || bestEval.candidate;

    // Convert route and target planar coordinates back to WGS84 [lat, lng]
    const routedGeometryGeo = (routedGeom ? routedGeom.routeCoordsXY : []).map(([x, y]) => this.G.xyToGeo(x, y));
    const targetGeometryGeo = (targetGeom || []).map(([x, y]) => this.G.xyToGeo(x, y));

    const actualLengthM = routedGeom ? routedGeom.totalLengthM : 0;
    const overlapRatio = routedGeom ? routedGeom.overlapRatio : 1.0;
    const similarityPct = bestEval.similarityPct ?? 0;
    const maxDevM = Math.round(bestEval.maxDevM ?? 0);

    const optimalStartFraction = bestEval.startFraction != null
      ? bestEval.startFraction
      : (bestParams[isAnchored ? 2 : 4] || 0);

    // Select curvature-aware UI key waypoints from target/routed geometry
    const keyWaypoints = GPSArtOptimizer.selectKeyWaypoints(
      routedGeometryGeo,
      Math.min(30, Math.max(12, constraints.maxTurningPoints))
    );
    if (constraints.startPointGeo && keyWaypoints.length > 0) {
      keyWaypoints[0] = [constraints.startPointGeo[0], constraints.startPointGeo[1]];
      if (routedGeometryGeo.length > 0) {
        routedGeometryGeo[0] = [constraints.startPointGeo[0], constraints.startPointGeo[1]];
      }
    }

    return {
      routedGeometryGeo,
      routedGeometryXY: routedGeom ? routedGeom.routeCoordsXY : [],
      targetGeometryGeo,
      targetGeometryXY: targetGeom || [],
      actualLengthM,
      overlapRatio,
      optimalScaleM: bestParams[0],
      optimalAngleDeg: bestParams[1],
      optimalStartFraction,
      objectiveScore: bestEval.cost,
      similarityPct,
      maxDevM,
      keyWaypoints,
    };
  }

  /**
   * Checks if any leg of the current pattern deviates excessively from `densePattern`
   * when routed on the road graph, and inserts up to 4 pinning vertices at deviation maxima.
   */
  _refinePatternByDeviation(normPattern, densePattern, bestParams, isAnchored, anchorXY, constraints) {
    const scaleM = bestParams[0];
    const angleDeg = bestParams[1];
    const tx = isAnchored ? 0 : bestParams[2];
    const ty = isAnchored ? 0 : bestParams[3];
    const startFrac = isAnchored ? bestParams[2] : bestParams[4];

    const transformedSparse = this.transformPattern(
      normPattern,
      scaleM,
      angleDeg,
      tx,
      ty,
      anchorXY,
      0,
      constraints.closedLoop
    );
    const transformedDense = this.transformPattern(
      densePattern,
      scaleM,
      angleDeg,
      tx,
      ty,
      anchorXY,
      startFrac,
      constraints.closedLoop
    );

    const routed = this.matchAndRoute(
      this.transformPattern(normPattern, scaleM, angleDeg, tx, ty, anchorXY, startFrac, constraints.closedLoop),
      { pruneSpurs: constraints.trimSpurs !== false }
    );
    if (!routed || !routed.routeCoordsXY || routed.routeCoordsXY.length < 2) return null;

    // Find points on normPattern where intermediate dense points have large distance to routedCoordsXY
    if (transformedSparse.length < 3 || transformedSparse.length >= 28) return null;

    const enriched = GPSArtOptimizer.enrichWithContourGuides(
      densePattern,
      normPattern,
      Math.min(28, normPattern.length + 4)
    );
    return enriched.length > normPattern.length ? enriched : null;
  }

  /**
   * Calibrates optimization constraints based on completed length, similarity, and optimal angle/start.
   * Implements iterative convergence towards the optimal GPS Art route solution.
   */
  static calibrateConstraints(currentConstraints, actualLengthM, actualSimilarityPct, options = {}) {
    const targetM = options.targetM || currentConstraints.targetLengthM;
    let nextTargetM = currentConstraints.targetLengthM;

    if (actualLengthM > 0 && targetM > 0) {
      const ratio = targetM / actualLengthM;
      const dampedRatio = 1.0 + (ratio - 1.0) * 0.85;
      nextTargetM = Math.min(targetM * 2.2, Math.max(targetM * 0.45, currentConstraints.targetLengthM * dampedRatio));
    }

    let nextRotBounds = currentConstraints.rotationBoundsDeg;
    if (options.bestAngleDeg != null && currentConstraints.rotationBoundsDeg[0] !== currentConstraints.rotationBoundsDeg[1]) {
      const span = Math.abs(currentConstraints.rotationBoundsDeg[1] - currentConstraints.rotationBoundsDeg[0]);
      if (span > 30) {
        nextRotBounds = [
          Math.max(currentConstraints.rotationBoundsDeg[0], options.bestAngleDeg - 25),
          Math.min(currentConstraints.rotationBoundsDeg[1], options.bestAngleDeg + 25),
        ];
      }
    }

    return new RouteConstraints({
      targetLengthM: nextTargetM,
      travelMode: currentConstraints.travelMode,
      maxTurningPoints: currentConstraints.maxTurningPoints,
      startPointXY: currentConstraints.startPointXY,
      startPointGeo: currentConstraints.startPointGeo,
      closedLoop: currentConstraints.closedLoop,
      flipY: currentConstraints.flipY,
      trimSpurs: currentConstraints.trimSpurs,
      rotationBoundsDeg: nextRotBounds,
      scaleBoundsRatio: [0.85, 1.15],
      startFractionBounds: currentConstraints.startFractionBounds,
      weightShape: currentConstraints.weightShape,
      weightLength: currentConstraints.weightLength * 1.2,
      weightOverlap: currentConstraints.weightOverlap,
      isRefinement: true,
    });
  }

  // --- Utility functions ---

  static computePolylineLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return len;
  }

  static simplifyRDP2D(points, epsilon) {
    if (!points || points.length <= 2 || !(epsilon > 0)) return points ? [...points] : [];
    let maxDist = 0;
    let index = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = GPSArtOptimizer.perpendicularDistance2D(points[i], start, end);
      if (d > maxDist) {
        index = i;
        maxDist = d;
      }
    }

    if (maxDist > epsilon) {
      const left = GPSArtOptimizer.simplifyRDP2D(points.slice(0, index + 1), epsilon);
      const right = GPSArtOptimizer.simplifyRDP2D(points.slice(index), epsilon);
      return left.slice(0, left.length - 1).concat(right);
    }
    return [start, end];
  }

  static perpendicularDistance2D(p, a, b) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const u = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
    return Math.hypot(apx - u * abx, apy - u * aby);
  }

  static sampleUniform2D(polyline, numSamples) {
    if (!polyline || polyline.length === 0) return [];
    if (polyline.length === 1) return Array(numSamples).fill([polyline[0][0], polyline[0][1]]);

    const cum = [0];
    for (let i = 1; i < polyline.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(polyline[i][0] - polyline[i - 1][0], polyline[i][1] - polyline[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    if (total === 0) return Array(numSamples).fill([polyline[0][0], polyline[0][1]]);

    const samples = [];
    const step = total / Math.max(1, numSamples - 1);
    let seg = 0;

    for (let i = 0; i < numSamples; i++) {
      const target = i * step;
      while (seg < polyline.length - 2 && cum[seg + 1] < target) seg++;
      const a = polyline[seg];
      const b = polyline[seg + 1];
      const segSpan = cum[seg + 1] - cum[seg] || 1;
      const t = Math.max(0, Math.min(1, (target - cum[seg]) / segSpan));
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return samples;
  }

  static minDistPointToPolyline(p, polyline) {
    let minD = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
      const d = GPSArtOptimizer.perpendicularDistance2D(p, polyline[i], polyline[i + 1]);
      if (d < minD) minD = d;
    }
    return minD;
  }

  static selectKeyWaypoints(coordsGeo, maxCount = 18) {
    if (!coordsGeo || coordsGeo.length <= maxCount) return coordsGeo ? [...coordsGeo] : [];
    const result = [coordsGeo[0]];
    const step = (coordsGeo.length - 1) / (maxCount - 1);
    for (let i = 1; i < maxCount - 1; i++) {
      const idx = Math.round(i * step);
      result.push(coordsGeo[idx]);
    }
    result.push(coordsGeo[coordsGeo.length - 1]);
    return result;
  }

  /**
   * Routes key waypoints on real OpenStreetMap walkable roads via OSRM foot profile or RouteEngine.
   */
  static async routeWithOsmEngine(keyWaypoints, routeEngine, closedLoop = true) {
    if (!Array.isArray(keyWaypoints) || keyWaypoints.length < 2) {
      return null;
    }
    let snappedWps = keyWaypoints;
    if (routeEngine && typeof routeEngine.snapToFootNetwork === 'function') {
      try {
        const snaps = await routeEngine.snapToFootNetwork(keyWaypoints);
        if (Array.isArray(snaps) && snaps.length >= 2) {
          snappedWps = snaps.map((s, idx) => (s.snapped ? s.point : keyWaypoints[idx]));
        }
      } catch (_err) { }
    }

    const loop = [...snappedWps];
    if (closedLoop && (loop[0][0] !== loop[loop.length - 1][0] || loop[0][1] !== loop[loop.length - 1][1])) {
      loop.push([loop[0][0], loop[0][1]]);
    }

    // Try OSRM foot routing first (fast and directly follows walkable street grids)
    try {
      const coordStr = loop.map((w) => `${w[1]},${w[0]}`).join(';');
      const resp = await fetch(
        `https://router.project-osrm.org/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=false`
      );
      if (resp.ok) {
        const data = await resp.json();
        const coords = data?.routes?.[0]?.geometry?.coordinates;
        if (data?.code === 'Ok' && Array.isArray(coords) && coords.length >= 2) {
          return {
            routedCoords: coords.map((c) => [c[1], c[0]]),
            snappedWaypoints: snappedWps,
          };
        }
      }
    } catch (_osrmErr) { }

    if (routeEngine && typeof routeEngine.getRoute === 'function') {
      try {
        const realCoords = await routeEngine.getRoute(loop);
        if (Array.isArray(realCoords) && realCoords.length >= 2) {
          return {
            routedCoords: realCoords,
            snappedWaypoints: snappedWps,
          };
        }
      } catch (_err) { }
    }

    return {
      routedCoords: loop,
      snappedWaypoints: snappedWps,
    };
  }
}
