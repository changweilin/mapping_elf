/**
 * Mapping Elf — GPS Art Route Optimizer (gpsArtOptimizer.js)
 *
 * Implements the GIS Road Network Route Optimization for GPS Art defined in:
 * "GPS 軌跡繪圖演算法實作"
 *
 * 1. Road Network Graph Construction (OSM / Synthetic planar graph in meters, KD-Tree index, Dijkstra routing)
 * 2. Pattern Simplification & Affine Transformation (RDP to max_turning_points, center, unit perimeter, scale, rotate, anchor translation)
 * 3. Map Snapping & Routing (KD-Tree nearest node snap, Dijkstra shortest path stitching, retrace/overlap penalty)
 * 4. Multi-Objective Optimization (Differential Evolution search minimizing Chamfer/Hausdorff shape error + length error + overlap ratio)
 * 5. GPX Track Export & Geographic Unprojection (WGS84 lat/lng)
 */

export const M_PER_DEG_LAT = 111320;

/**
 * 2D KD-Tree for fast nearest-neighbor lookups in planar metric space O(log N).
 */
export class KDTree2D {
  constructor(points) {
    this.root = this._build(points.slice(), 0);
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
 * Priority queue for Dijkstra's shortest path algorithm.
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
 * Planar metric road network graph with KD-Tree and Dijkstra shortest path routing.
 */
export class RoadNetworkGraph {
  constructor(centerLatLon = [25.034, 121.564]) {
    this.centerLatLon = [centerLatLon[0], centerLatLon[1]];
    this.cosLat = Math.max(0.01, Math.cos((this.centerLatLon[0] * Math.PI) / 180));
    this.nodes = new Map(); // id -> { id, x, y, lat, lng }
    this.adj = new Map(); // u -> Map(v -> minLength)
    this.kdtree = null;
    this.nodeList = [];
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
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
    const node = { id, x, y, lat, lng };
    this.nodes.set(id, node);
    if (!this.adj.has(id)) this.adj.set(id, new Map());
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    return node;
  }

  addEdge(u, v, length = null) {
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

  buildIndex() {
    this.nodeList = Array.from(this.nodes.values());
    this.kdtree = new KDTree2D(this.nodeList);
  }

  dijkstra(sourceId, targetId) {
    if (sourceId === targetId) return { path: [sourceId], length: 0 };
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) return null;

    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    const heap = new MinHeap();

    dist.set(sourceId, 0);
    heap.push({ id: sourceId, priority: 0 });

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
          heap.push({ id: v, priority: newDist });
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

    graph.buildIndex();
    return graph;
  }

  /**
   * Fetches real-world OSM data via Overpass API and builds planar graph.
   * Gracefully falls back to synthetic urban network on error/timeout.
   */
  static async fromOsm(centerLatLon, distM = 1500, mode = 'walk') {
    // Fast path for test hooks or offline environment
    if (typeof window !== 'undefined' && (window.__mappingElfTestHooks || navigator?.onLine === false)) {
      return RoadNetworkGraph.buildSyntheticCityGraph(24, Math.max(60, distM / 10), centerLatLon);
    }

    const graph = new RoadNetworkGraph(centerLatLon);
    const [cLat, cLng] = centerLatLon;

    const query = `[out:json][timeout:15];(way["highway"~"footway|path|pedestrian|living_street|residential|track|service|cycleway|steps|unclassified|tertiary"](around:${distM},${cLat},${cLng}););(._;>;);out skel;`;
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ];

    let data = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(`${ep}?data=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          data = await res.json();
          if (data && Array.isArray(data.elements) && data.elements.length > 0) {
            break;
          }
        }
      } catch (_e) {
        // Try next endpoint
      }
    }

    if (data && Array.isArray(data.elements)) {
      const nodeMap = new Map();
      data.elements.forEach((el) => {
        if (el.type === 'node') {
          const [x, y] = graph.geoToXy(el.lat, el.lon);
          graph.addNode(el.id, x, y, el.lat, el.lon);
          nodeMap.set(el.id, { x, y });
        }
      });

      data.elements.forEach((el) => {
        if (el.type === 'way' && Array.isArray(el.nodes)) {
          for (let i = 0; i < el.nodes.length - 1; i++) {
            const u = el.nodes[i];
            const v = el.nodes[i + 1];
            if (graph.nodes.has(u) && graph.nodes.has(v)) {
              graph.addEdge(u, v);
              graph.addEdge(v, u);
            }
          }
        }
      });

      if (graph.nodes.size >= 10) {
        graph.buildIndex();
        return graph;
      }
    }

    // Fallback to high-resolution synthetic city graph centered at location
    return RoadNetworkGraph.buildSyntheticCityGraph(24, Math.max(60, distM / 10), centerLatLon);
  }
}

/**
 * User-defined constraints for GPS Art route optimization.
 */
export class RouteConstraints {
  constructor({
    targetLengthM = 5000.0,
    travelMode = 'walk',
    maxTurningPoints = 15,
    startPointXY = null,
    startPointGeo = null,
    closedLoop = true,
    rotationBoundsDeg = [0.0, 360.0],
    scaleBoundsRatio = [0.6, 1.4],
    weightShape = 1.0,
    weightLength = 250.0,
    weightOverlap = 300.0,
  } = {}) {
    this.targetLengthM = targetLengthM;
    this.travelMode = travelMode;
    this.maxTurningPoints = maxTurningPoints;
    this.startPointXY = startPointXY;
    this.startPointGeo = startPointGeo;
    this.closedLoop = closedLoop;
    this.rotationBoundsDeg = rotationBoundsDeg;
    this.scaleBoundsRatio = scaleBoundsRatio;
    this.weightShape = weightShape;
    this.weightLength = weightLength;
    this.weightOverlap = weightOverlap;
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
    this.minX = graph.minX;
    this.minY = graph.minY;
    this.maxX = graph.maxX;
    this.maxY = graph.maxY;
  }

  /**
   * Preprocesses raw canvas/vector coordinates:
   * 1. Closes loop if closedLoop is true.
   * 2. Simplifies via binary-searched RDP until vertex count <= maxVertices.
   * 3. Centers at origin (0, 0).
   * 4. Normalizes total perimeter length to 1.0.
   */
  static preprocessPattern(rawCoords, maxVertices = 15, closedLoop = true) {
    const pts = [];
    for (const p of rawCoords) {
      const x = Array.isArray(p) ? p[0] : (p.x != null ? p.x : p.lat);
      const y = Array.isArray(p) ? p[1] : (p.y != null ? p.y : p.lng);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const prev = pts[pts.length - 1];
        if (!prev || Math.hypot(prev[0] - x, prev[1] - y) > 1e-4) {
          pts.push([x, y]);
        }
      }
    }

    if (pts.length < 2) return [];

    if (closedLoop && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) > 1e-4) {
      pts.push([pts[0][0], pts[0][1]]);
    }

    // Binary search on Ramer-Douglas-Peucker tolerance to achieve target vertex budget
    let line = pts;
    const initialLen = GPSArtOptimizer.computePolylineLength(line);

    if (line.length > maxVertices) {
      let tolLow = 0.0;
      let tolHigh = initialLen * 0.25;
      let bestLine = line;

      for (let iter = 0; iter < 25; iter++) {
        const mid = (tolLow + tolHigh) / 2.0;
        const simplified = GPSArtOptimizer.simplifyRDP2D(line, mid);
        if (simplified.length <= maxVertices && simplified.length >= 3) {
          bestLine = simplified;
          tolHigh = mid;
        } else if (simplified.length < 3) {
          tolHigh = mid;
        } else {
          tolLow = mid;
        }
      }
      line = bestLine;
    }

    // Center at origin (0, 0)
    let sumX = 0, sumY = 0;
    line.forEach(([x, y]) => { sumX += x; sumY += y; });
    const cx = sumX / line.length;
    const cy = sumY / line.length;
    const centered = line.map(([x, y]) => [x - cx, y - cy]);

    // Normalize total perimeter length to 1.0
    const totalLen = GPSArtOptimizer.computePolylineLength(centered);
    const sFactor = totalLen > 0 ? 1.0 / totalLen : 1.0;
    return centered.map(([x, y]) => [x * sFactor, y * sFactor]);
  }

  /**
   * Transforms normalized pattern by scale, rotation angle (degrees), and translation.
   * If anchorStartXY is specified, locks vertex 0 exactly to anchor location.
   */
  transformPattern(normPattern, scaleM, angleDeg, tx = 0, ty = 0, anchorStartXY = null) {
    const rad = (angleDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const scaledAndRotated = normPattern.map(([x, y]) => {
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
   * Snaps transformed pattern turning points to nearest road nodes and computes
   * shortest paths along the road network.
   * Returns: { routeCoordsXY, totalLengthM, overlapRatio, fullNodePath } or null.
   */
  matchAndRoute(transformedPattern) {
    if (!transformedPattern || transformedPattern.length < 2) return null;

    const snappedNodes = [];
    for (const pt of transformedPattern) {
      const res = this.kdtree.query(pt);
      if (!res || !res.node) return null;
      snappedNodes.push(res.node.id);
    }

    // Remove consecutive duplicate nodes
    const cleanedNodes = [snappedNodes[0]];
    for (let i = 1; i < snappedNodes.length; i++) {
      if (snappedNodes[i] !== cleanedNodes[cleanedNodes.length - 1]) {
        cleanedNodes.push(snappedNodes[i]);
      }
    }

    if (cleanedNodes.length < 2) return null;

    const fullNodePath = [];
    let totalLengthM = 0;
    const traversedEdges = [];

    for (let i = 0; i < cleanedNodes.length - 1; i++) {
      const u = cleanedNodes[i];
      const v = cleanedNodes[i + 1];
      const res = this.G.dijkstra(u, v);
      if (!res || !res.path || res.path.length === 0) return null;

      if (i === 0) {
        fullNodePath.push(...res.path);
      } else {
        fullNodePath.push(...res.path.slice(1));
      }

      totalLengthM += res.length;
      for (let j = 0; j < res.path.length - 1; j++) {
        const edgeKey = res.path[j] < res.path[j + 1]
          ? `${res.path[j]}_${res.path[j + 1]}`
          : `${res.path[j + 1]}_${res.path[j]}`;
        traversedEdges.push(edgeKey);
      }
    }

    if (fullNodePath.length < 2 || traversedEdges.length === 0) return null;

    const uniqueEdges = new Set(traversedEdges).size;
    const overlapRatio = 1.0 - (uniqueEdges / traversedEdges.length);

    const routeCoordsXY = fullNodePath.map((nid) => {
      const node = this.G.nodes.get(nid);
      return [node.x, node.y];
    });

    return {
      routeCoordsXY,
      totalLengthM,
      overlapRatio,
      fullNodePath,
    };
  }

  /**
   * Computes symmetric Chamfer + Hausdorff geometric distance between target
   * shape and actual routed path on the road network.
   */
  static computeShapeSimilarityError(targetGeom, routedGeom, numSamples = 60) {
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
    const hausdorffDist = Math.max(maxForward, maxBackward);

    return 0.5 * (forwardDist + backwardDist) + 0.3 * hausdorffDist;
  }

  /**
   * Differential Evolution optimization to find optimal scale, rotation, and translation.
   */
  optimize(rawPattern, constraints) {
    const normPattern = GPSArtOptimizer.preprocessPattern(
      rawPattern,
      constraints.maxTurningPoints,
      constraints.closedLoop
    );

    if (!normPattern || normPattern.length < 2) {
      throw new Error('Pattern has insufficient vertices for GPS Art optimization.');
    }

    const sMin = constraints.targetLengthM * constraints.scaleBoundsRatio[0];
    const sMax = constraints.targetLengthM * constraints.scaleBoundsRatio[1];
    const [rotMin, rotMax] = constraints.rotationBoundsDeg;

    let anchorXY = null;
    if (constraints.startPointGeo) {
      anchorXY = this.G.geoToXy(constraints.startPointGeo[0], constraints.startPointGeo[1]);
    } else if (constraints.startPointXY) {
      anchorXY = constraints.startPointXY;
    }

    // If anchor is locked, snap anchor to nearest valid road node first
    if (anchorXY) {
      const nearest = this.kdtree.query(anchorXY);
      if (nearest && nearest.node) {
        anchorXY = [nearest.node.x, nearest.node.y];
      }
    }

    const isAnchored = anchorXY != null;
    const marginX = (this.maxX - this.minX) * 0.15;
    const marginY = (this.maxY - this.minY) * 0.15;

    // Parameter bounds: [scaleM, angleDeg, tx, ty]
    const bounds = [
      [sMin, sMax],
      [rotMin, rotMax],
      isAnchored ? [0, 1] : [this.minX + marginX, this.maxX - marginX],
      isAnchored ? [0, 1] : [this.minY + marginY, this.maxY - marginY],
    ];

    const evaluateCost = (params) => {
      const [scaleM, angleDeg, tx, ty] = params;
      const candidateGeom = this.transformPattern(
        normPattern,
        scaleM,
        angleDeg,
        tx,
        ty,
        anchorXY
      );
      const res = this.matchAndRoute(candidateGeom);
      if (!res || res.totalLengthM === 0) {
        return { cost: 1e9, routed: null, candidate: candidateGeom };
      }

      const shapeErr = GPSArtOptimizer.computeShapeSimilarityError(candidateGeom, res.routeCoordsXY);
      const lenErr = Math.abs(res.totalLengthM - constraints.targetLengthM) / constraints.targetLengthM;
      const totalCost =
        constraints.weightShape * shapeErr +
        constraints.weightLength * lenErr +
        constraints.weightOverlap * res.overlapRatio;

      return { cost: totalCost, routed: res, candidate: candidateGeom, shapeErr };
    };

    // Differential Evolution (DE/rand/1/bin)
    const popSize = 15;
    const maxIter = 22;
    const F = 0.7;
    const CR = 0.8;
    const dim = bounds.length;

    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    // Initialize population
    const population = [];
    const costs = [];
    const evaluations = [];

    for (let i = 0; i < popSize; i++) {
      const ind = [];
      for (let d = 0; d < dim; d++) {
        ind.push(bounds[d][0] + rand() * (bounds[d][1] - bounds[d][0]));
      }
      population.push(ind);
      const evalRes = evaluateCost(ind);
      costs.push(evalRes.cost);
      evaluations.push(evalRes);
    }

    let bestIdx = 0;
    for (let i = 1; i < popSize; i++) {
      if (costs[i] < costs[bestIdx]) bestIdx = i;
    }

    // Generations
    for (let gen = 0; gen < maxIter; gen++) {
      for (let i = 0; i < popSize; i++) {
        // Pick 3 distinct individuals a, b, c != i
        let a, b, c;
        do { a = Math.floor(rand() * popSize); } while (a === i);
        do { b = Math.floor(rand() * popSize); } while (b === i || b === a);
        do { c = Math.floor(rand() * popSize); } while (c === i || c === a || c === b);

        const rDim = Math.floor(rand() * dim);
        const trial = [];
        for (let d = 0; d < dim; d++) {
          if (d === rDim || rand() < CR) {
            let val = population[a][d] + F * (population[b][d] - population[c][d]);
            val = Math.max(bounds[d][0], Math.min(bounds[d][1], val));
            trial.push(val);
          } else {
            trial.push(population[i][d]);
          }
        }

        const trialEval = evaluateCost(trial);
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

    const bestParams = population[bestIdx];
    const bestEval = evaluations[bestIdx];

    const routedGeom = bestEval.routed;
    const targetGeom = bestEval.candidate;

    // Convert route and target planar coordinates back to WGS84 [lat, lng]
    const routedGeometryGeo = (routedGeom ? routedGeom.routeCoordsXY : []).map(([x, y]) => this.G.xyToGeo(x, y));
    const targetGeometryGeo = (targetGeom || []).map(([x, y]) => this.G.xyToGeo(x, y));

    const actualLengthM = routedGeom ? routedGeom.totalLengthM : 0;
    const overlapRatio = routedGeom ? routedGeom.overlapRatio : 1.0;
    const radiusM = constraints.targetLengthM / (2 * Math.PI);
    const similarityPct = Math.max(0, Math.min(100, Math.round(100 * Math.exp(-((bestEval.shapeErr || 100) / Math.max(50, radiusM * 0.4))))));

    // Select UI key waypoints
    const keyWaypoints = GPSArtOptimizer.selectKeyWaypoints(routedGeometryGeo, constraints.maxTurningPoints);
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
      objectiveScore: bestEval.cost,
      similarityPct,
      keyWaypoints,
    };
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

  static selectKeyWaypoints(coordsGeo, maxCount = 15) {
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
}
