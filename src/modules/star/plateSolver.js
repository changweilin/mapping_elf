/**
 * High-Performance 2D Magic Circle & Constellation Matcher for OSM
 * 
 * References: "OSM 魔法陣配對演算法優化.md"
 * Features:
 *  1. Local Tangent Plane (ENU / Equirectangular) metric projection in meters.
 *  2. FlatKDTree2D: Zero-allocation typed-array 2D KD-Tree (Float64Array/Int32Array).
 *  3. Astrometry Plate Solving canonical complex basis (longest baseline pivot + fallback).
 *  4. Hierarchical branch-and-bound pruning (outermost & high-degree hubs first).
 *  5. 2D Kabsch-Umeyama closed-form similarity transformation (scale, rotation, translation).
 *  6. 2-step trimmed ICP reassignment with injective (1-to-1) mutual exclusion.
 *  7. Topological edge angle fidelity scoring.
 *  8. Symmetry group deduplication for cyclic and dihedral patterns.
 */

export const EARTH_RADIUS_M = 6371008.8;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Lightweight, zero-allocation static 2D KD-Tree backed by TypedArrays
 */
export class FlatKDTree2D {
  constructor(xs, ys) {
    this.n = xs.length;
    this.coords = new Float64Array(this.n * 2);
    this.ids = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.coords[2 * i] = xs[i];
      this.coords[2 * i + 1] = ys[i];
      this.ids[i] = i;
    }
    if (this.n > 1) {
      this.build(0, this.n - 1, 0);
    }
  }

  swap(i, j) {
    const tmpId = this.ids[i];
    this.ids[i] = this.ids[j];
    this.ids[j] = tmpId;

    const ix = 2 * i;
    const jx = 2 * j;
    const tx = this.coords[ix];
    const ty = this.coords[ix + 1];
    this.coords[ix] = this.coords[jx];
    this.coords[ix + 1] = this.coords[jx + 1];
    this.coords[jx] = tx;
    this.coords[jx + 1] = ty;
  }

  build(left, right, axis) {
    if (left >= right) return;
    const mid = (left + right) >> 1;
    this.quickSelect(left, right, mid, axis);
    const nextAxis = 1 - axis;
    this.build(left, mid - 1, nextAxis);
    this.build(mid + 1, right, nextAxis);
  }

  quickSelect(left, right, k, axis) {
    while (left < right) {
      const mid = (left + right) >> 1;
      const pivot = this.coords[2 * mid + axis];
      let i = left;
      let j = right;
      while (i <= j) {
        while (this.coords[2 * i + axis] < pivot) i++;
        while (this.coords[2 * j + axis] > pivot) j--;
        if (i <= j) {
          this.swap(i, j);
          i++;
          j--;
        }
      }
      if (k <= j) right = j;
      else if (k >= i) left = i;
      else break;
    }
  }

  /**
   * Finds nearest neighbor within maxDistSq, excluding already assigned indices
   */
  findNearestWithin(qx, qy, maxDistSq, usedMask = null, currentStamp = 0) {
    let bestIdx = -1;
    let bestDistSq = maxDistSq;

    const search = (left, right, axis) => {
      if (left > right) return;
      const mid = (left + right) >> 1;
      const mx = this.coords[2 * mid];
      const my = this.coords[2 * mid + 1];
      const origIdx = this.ids[mid];

      if (!usedMask || usedMask[origIdx] !== currentStamp) {
        const dx = qx - mx;
        const dy = qy - my;
        const dSq = dx * dx + dy * dy;
        if (dSq <= bestDistSq) {
          bestDistSq = dSq;
          bestIdx = origIdx;
        }
      }

      const delta = axis === 0 ? qx - mx : qy - my;
      const nextAxis = 1 - axis;

      if (delta <= 0) {
        search(left, mid - 1, nextAxis);
        if (delta * delta <= bestDistSq) search(mid + 1, right, nextAxis);
      } else {
        search(mid + 1, right, nextAxis);
        if (delta * delta <= bestDistSq) search(left, mid - 1, nextAxis);
      }
    };

    search(0, this.n - 1, 0);
    return { index: bestIdx, distSq: bestDistSq };
  }

  /**
   * Collects all point indices within distance range [minDistSq, maxDistSq] from (qx, qy)
   */
  findInAnnulus(qx, qy, minDistSq, maxDistSq, outIndices) {
    outIndices.length = 0;
    const search = (left, right, axis) => {
      if (left > right) return;
      const mid = (left + right) >> 1;
      const mx = this.coords[2 * mid];
      const my = this.coords[2 * mid + 1];

      const dx = qx - mx;
      const dy = qy - my;
      const dSq = dx * dx + dy * dy;
      if (dSq >= minDistSq && dSq <= maxDistSq) {
        outIndices.push(this.ids[mid]);
      }

      const delta = axis === 0 ? qx - mx : qy - my;
      const nextAxis = 1 - axis;

      if (delta <= 0) {
        search(left, mid - 1, nextAxis);
        if (delta * delta <= maxDistSq) search(mid + 1, right, nextAxis);
      } else {
        search(mid + 1, right, nextAxis);
        if (delta * delta <= maxDistSq) search(left, mid - 1, nextAxis);
      }
    };

    search(0, this.n - 1, 0);
  }
}

/**
 * Closed-form 2D Kabsch-Umeyama similarity transform estimation + 2-step ICP refinement
 */
export function refineWithUmeyama2D(
  patternNodes,
  osmX,
  osmY,
  initialMatch,
  reflected,
  kdTree,
  tolSq,
  usedMask,
  outMatchedIndices
) {
  const M = patternNodes.length;

  const solveSimilarity = (matchIndices) => {
    let wSum = 0;
    let meanPx = 0;
    let meanPy = 0;
    let meanQx = 0;
    let meanQy = 0;

    for (let k = 0; k < M; k++) {
      const osmIdx = matchIndices[k];
      if (osmIdx === -1) continue;
      const w = patternNodes[k].weight ?? 1.0;
      const px = patternNodes[k].x;
      const py = reflected ? -patternNodes[k].y : patternNodes[k].y;
      wSum += w;
      meanPx += w * px;
      meanPy += w * py;
      meanQx += w * osmX[osmIdx];
      meanQy += w * osmY[osmIdx];
    }

    if (wSum <= 0) return null;
    meanPx /= wSum;
    meanPy /= wSum;
    meanQx /= wSum;
    meanQy /= wSum;

    let varP = 0;
    let cPar = 0;
    let cPerp = 0;

    for (let k = 0; k < M; k++) {
      const osmIdx = matchIndices[k];
      if (osmIdx === -1) continue;
      const w = patternNodes[k].weight ?? 1.0;
      const px = patternNodes[k].x;
      const py = reflected ? -patternNodes[k].y : patternNodes[k].y;
      const dpx = px - meanPx;
      const dpy = py - meanPy;
      const dqx = osmX[osmIdx] - meanQx;
      const dqy = osmY[osmIdx] - meanQy;

      varP += w * (dpx * dpx + dpy * dpy);
      cPar += w * (dpx * dqx + dpy * dqy);
      cPerp += w * (dpx * dqy - dpy * dqx);
    }

    if (varP < 1e-12) return null;

    const a = cPar / varP;
    const b = cPerp / varP;
    const scale = Math.hypot(a, b);
    if (scale < 1e-9) return null;

    const cosTheta = a / scale;
    const sinTheta = b / scale;
    const tx = meanQx - (a * meanPx - b * meanPy);
    const ty = meanQy - (b * meanPx + a * meanPy);

    return { a, b, scale, cosTheta, sinTheta, tx, ty, meanQx, meanQy };
  };

  // Pass 1: Solve from initial matches
  let sim = solveSimilarity(initialMatch);
  if (!sim) return null;

  // Pass 2: Re-project and perform conflict-free nearest neighbor matching
  const refineStamp = 1;
  const runIcpStep = (currentSim) => {
    usedMask.fill(0);
    let sqErrorSum = 0;
    let matchedWeightSum = 0;
    let missingCount = 0;

    for (let k = 0; k < M; k++) {
      const px = patternNodes[k].x;
      const py = reflected ? -patternNodes[k].y : patternNodes[k].y;
      const predX = currentSim.a * px - currentSim.b * py + currentSim.tx;
      const predY = currentSim.b * px + currentSim.a * py + currentSim.ty;

      const nearest = kdTree.findNearestWithin(predX, predY, tolSq, usedMask, refineStamp);
      if (nearest.index === -1) {
        outMatchedIndices[k] = -1;
        missingCount++;
      } else {
        outMatchedIndices[k] = nearest.index;
        usedMask[nearest.index] = refineStamp;
        const w = patternNodes[k].weight ?? 1.0;
        sqErrorSum += w * nearest.distSq;
        matchedWeightSum += w;
      }
    }

    if (matchedWeightSum <= 0) return null;
    return {
      rmse: Math.sqrt(sqErrorSum / matchedWeightSum),
      missingCount,
      matchedWeightSum,
    };
  };

  let icpRes = runIcpStep(sim);
  if (!icpRes) return null;

  // If any matches shifted, do a 2nd Umeyama pass for sub-meter convergence
  const sim2 = solveSimilarity(outMatchedIndices);
  if (sim2) {
    const icpRes2 = runIcpStep(sim2);
    if (icpRes2 && icpRes2.rmse <= icpRes.rmse) {
      sim = sim2;
      icpRes = icpRes2;
    }
  }

  return {
    scale: sim.scale,
    cosTheta: sim.cosTheta,
    sinTheta: sim.sinTheta,
    tx: sim.tx,
    ty: sim.ty,
    centerX: sim.meanQx,
    centerY: sim.meanQy,
    rmse: icpRes.rmse,
    missingCount: icpRes.missingCount,
  };
}

/**
 * Evaluates topological angular distortion along constellation / magic circle edges
 */
export function computeEdgeAngleErrorDeg(
  patternNodes,
  patternEdges,
  osmX,
  osmY,
  matchedIndices,
  cosTheta,
  sinTheta,
  reflected
) {
  if (!patternEdges || patternEdges.length === 0) return 0;

  let totalAngleDiffRad = 0;
  let validEdges = 0;

  for (const edge of patternEdges) {
    const idxA = matchedIndices[edge.fromIndex];
    const idxB = matchedIndices[edge.toIndex];
    if (idxA === -1 || idxB === -1) continue;

    // Rotated template edge vector
    const pAx = patternNodes[edge.fromIndex].x;
    const pAy = reflected ? -patternNodes[edge.fromIndex].y : patternNodes[edge.fromIndex].y;
    const pBx = patternNodes[edge.toIndex].x;
    const pBy = reflected ? -patternNodes[edge.toIndex].y : patternNodes[edge.toIndex].y;

    const dpx = pBx - pAx;
    const dpy = pBy - pAy;
    const rotPx = cosTheta * dpx - sinTheta * dpy;
    const rotPy = sinTheta * dpx + cosTheta * dpy;

    // Actual OSM edge vector
    const dqx = osmX[idxB] - osmX[idxA];
    const dqy = osmY[idxB] - osmY[idxA];

    const lenP = Math.hypot(rotPx, rotPy);
    const lenQ = Math.hypot(dqx, dqy);
    if (lenP < 1e-9 || lenQ < 1e-9) continue;

    const cosSim = Math.max(-1, Math.min(1, (rotPx * dqx + rotPy * dqy) / (lenP * lenQ)));
    totalAngleDiffRad += Math.acos(cosSim);
    validEdges++;
  }

  return validEdges > 0 ? (totalAngleDiffRad / validEdges) * RAD_TO_DEG : 0;
}

/**
 * Select the longest baseline pivot pair, with fallback options
 */
export function selectPivotPairs(patternNodes, count = 2) {
  const M = patternNodes.length;
  const pairs = [];

  for (let i = 0; i < M; i++) {
    for (let j = i + 1; j < M; j++) {
      const dx = patternNodes[j].x - patternNodes[i].x;
      const dy = patternNodes[j].y - patternNodes[i].y;
      const distSq = dx * dx + dy * dy;
      pairs.push({ i, j, distSq, dist: Math.sqrt(distSq) });
    }
  }

  pairs.sort((a, b) => b.distSq - a.distSq);
  return pairs.slice(0, Math.min(count, pairs.length));
}

/**
 * Main solver to match an arbitrary constellation / magic circle pattern to OSM nodes
 */
export function findConstellationOnOSM(
  patternNodes,
  patternEdges,
  osmNodes,
  options = {}
) {
  const iterator = findConstellationOnOSMSteps(patternNodes, patternEdges, osmNodes, options);
  let step = iterator.next();
  while (!step.done) {
    step = iterator.next();
  }
  return step.value;
}

/**
 * Generator version for interactive progress & pausable cancellation
 */
export function* findConstellationOnOSMSteps(
  patternNodes,
  patternEdges,
  osmNodes,
  options = {}
) {
  const M = patternNodes.length;
  const N = osmNodes.length;
  if (M < 3 || N < 3) return [];

  const relTol = options.relativeTolerance ?? 0.05;
  const minTolM = options.minToleranceMeters ?? 12;
  const maxMissing = options.maxMissingNodes ?? 0;
  const allowReflection = options.allowReflection ?? false;
  const topK = options.topK ?? 5;
  const minDiameterMeters = options.minDiameterMeters ?? 500;
  const maxDiameterMeters = options.maxDiameterMeters ?? 50000;
  const isSymmetric = options.isSymmetric ?? false;

  // 1. Local ENU Metric Projection
  let sumLat = 0;
  let sumLon = 0;
  for (let i = 0; i < N; i++) {
    sumLat += osmNodes[i].lat;
    sumLon += (osmNodes[i].lng ?? osmNodes[i].lon);
  }
  const refLat = options.center?.lat ?? (sumLat / N);
  const refLon = options.center?.lng ?? options.center?.lon ?? (sumLon / N);
  const cosLat = Math.cos(refLat * DEG_TO_RAD);

  const osmX = new Float64Array(N);
  const osmY = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const lon = osmNodes[i].lng ?? osmNodes[i].lon;
    osmX[i] = (lon - refLon) * DEG_TO_RAD * EARTH_RADIUS_M * cosLat;
    osmY[i] = (osmNodes[i].lat - refLat) * DEG_TO_RAD * EARTH_RADIUS_M;
  }

  const kdTree = new FlatKDTree2D(osmX, osmY);

  // 2. Select baseline pivots
  const pivotPairs = selectPivotPairs(patternNodes, maxMissing > 0 ? 2 : 1);
  const primaryPivot = pivotPairs[0];
  const pivotA = primaryPivot.i;
  const pivotB = primaryPivot.j;
  const patternBaseDist = primaryPivot.dist;
  const patternBaseDistSq = primaryPivot.distSq;

  // Pattern normalization scale
  let maxPatternExtent = 0;
  for (let i = 0; i < M; i++) {
    const dist = Math.hypot(patternNodes[i].x, patternNodes[i].y);
    if (dist > maxPatternExtent) maxPatternExtent = dist;
  }
  const patternScaleNormalizer = Math.max(1e-6, maxPatternExtent);

  const vx = patternNodes[pivotB].x - patternNodes[pivotA].x;
  const vy = patternNodes[pivotB].y - patternNodes[pivotA].y;
  const invBaseSq = 1.0 / patternBaseDistSq;

  // Calculate degrees from pattern edges to prioritize high-connectivity hubs
  const degrees = new Int32Array(M);
  for (const edge of patternEdges) {
    if (edge.fromIndex >= 0 && edge.fromIndex < M) degrees[edge.fromIndex]++;
    if (edge.toIndex >= 0 && edge.toIndex < M) degrees[edge.toIndex]++;
  }

  // Pre-compute canonical basis (alpha, beta) for remaining nodes
  const verifyList = [];
  for (let k = 0; k < M; k++) {
    if (k === pivotA || k === pivotB) continue;
    const dx = patternNodes[k].x - patternNodes[pivotA].x;
    const dy = patternNodes[k].y - patternNodes[pivotA].y;
    const alpha = (vx * dx + vy * dy) * invBaseSq;
    const beta = (vx * dy - vy * dx) * invBaseSq;
    const distFromCenter = Math.hypot(alpha - 0.5, beta);
    const weight = patternNodes[k].weight ?? 1.0;
    verifyList.push({
      patternIndex: k,
      alpha,
      beta,
      weight,
      priority: weight * (1 + degrees[k]) * (0.5 + distFromCenter),
    });
  }
  // Sort descending by priority (outer hubs first) for early branch-and-bound pruning
  verifyList.sort((a, b) => b.priority - a.priority);

  // Center coordinates in canonical basis for instant center-offset pruning
  let patternCenterX = 0;
  let patternCenterY = 0;
  for (let k = 0; k < M; k++) {
    patternCenterX += patternNodes[k].x / M;
    patternCenterY += patternNodes[k].y / M;
  }
  const dxCenter = patternCenterX - patternNodes[pivotA].x;
  const dyCenter = patternCenterY - patternNodes[pivotA].y;
  const alphaCenter = (vx * dxCenter + vy * dyCenter) * invBaseSq;
  const betaCenter = (vx * dyCenter - vy * dxCenter) * invBaseSq;
  const maxCenterOffsetMeters = options.maxCenterOffsetMeters ?? (options.radiusMeters ? options.radiusMeters * 0.75 : null);
  const maxCenterOffsetSq = maxCenterOffsetMeters ? maxCenterOffsetMeters * maxCenterOffsetMeters : null;

  // Scale bounds in meters for the baseline
  const minBaseMeters = (patternBaseDist / patternScaleNormalizer) * (minDiameterMeters * 0.5);
  const maxBaseMeters = (patternBaseDist / patternScaleNormalizer) * (maxDiameterMeters * 0.5);
  const minDistSq = minBaseMeters * minBaseMeters;
  const maxDistSq = maxBaseMeters * maxBaseMeters;

  const candidatePartners = [];
  const usedMask = new Uint8Array(N);
  let stamp = 1;

  const matchedOsmIndices = new Int32Array(M);
  const refinedMatchedIndices = new Int32Array(M);
  const seenSignatures = new Set();
  const results = [];

  const reflectionModes = allowReflection ? [1, -1] : [1];
  const totalOuterSteps = N;

  for (let i = 0; i < N; i++) {
    const xi = osmX[i];
    const yi = osmY[i];

    // Optional category filter on pivotA
    const reqCatA = patternNodes[pivotA].preferredCategory;
    if (reqCatA && osmNodes[i].category && osmNodes[i].category !== reqCatA) {
      continue;
    }

    kdTree.findInAnnulus(xi, yi, minDistSq, maxDistSq, candidatePartners);

    for (let pIdx = 0; pIdx < candidatePartners.length; pIdx++) {
      const j = candidatePartners[pIdx];
      if (i === j) continue;

      const reqCatB = patternNodes[pivotB].preferredCategory;
      if (reqCatB && osmNodes[j].category && osmNodes[j].category !== reqCatB) {
        continue;
      }

      const dx = osmX[j] - xi;
      const dy = osmY[j] - yi;
      const baseLen = Math.hypot(dx, dy);
      const tol = Math.max(minTolM, relTol * baseLen);
      const tolSq = tol * tol;

      for (const reflectSign of reflectionModes) {
        // Fast 4-FMA center offset check
        if (maxCenterOffsetSq !== null) {
          const bCenterSigned = betaCenter * reflectSign;
          const predCenterX = xi + alphaCenter * dx - bCenterSigned * dy;
          const predCenterY = yi + alphaCenter * dy + bCenterSigned * dx;
          const centerDistSq = predCenterX * predCenterX + predCenterY * predCenterY;
          if (centerDistSq > maxCenterOffsetSq) continue;
        }

        stamp = (stamp + 1) & 0xff;
        if (stamp === 0) {
          usedMask.fill(0);
          stamp = 1;
        }

        matchedOsmIndices.fill(-1);
        matchedOsmIndices[pivotA] = i;
        matchedOsmIndices[pivotB] = j;
        usedMask[i] = stamp;
        usedMask[j] = stamp;

        let missingCount = 0;
        let aborted = false;

        // Hierarchical Branch-and-Bound verification
        for (let v = 0; v < verifyList.length; v++) {
          const item = verifyList[v];
          const bSigned = item.beta * reflectSign;
          const predX = xi + item.alpha * dx - bSigned * dy;
          const predY = yi + item.alpha * dy + bSigned * dx;

          const nearest = kdTree.findNearestWithin(predX, predY, tolSq, usedMask, stamp);
          if (nearest.index === -1) {
            missingCount++;
            if (missingCount > maxMissing) {
              aborted = true;
              break;
            }
          } else {
            matchedOsmIndices[item.patternIndex] = nearest.index;
            usedMask[nearest.index] = stamp;
          }
        }

        if (aborted) continue;

        // 4. Closed-form Kabsch-Umeyama refinement + 2-step ICP
        const refined = refineWithUmeyama2D(
          patternNodes,
          osmX,
          osmY,
          matchedOsmIndices,
          reflectSign === -1,
          kdTree,
          tolSq,
          usedMask,
          refinedMatchedIndices
        );

        if (!refined || refined.missingCount > maxMissing) continue;

        // Deduplication (using sorted matched IDs or sorted index signature)
        let signature;
        if (isSymmetric) {
          const matchedIds = [];
          for (let k = 0; k < M; k++) {
            if (refinedMatchedIndices[k] !== -1) {
              matchedIds.push(osmNodes[refinedMatchedIndices[k]].id);
            }
          }
          signature = matchedIds.sort().join(',');
        } else {
          signature = refinedMatchedIndices.join(',') + (reflectSign === -1 ? ':R' : ':N');
        }

        if (seenSignatures.has(signature)) continue;
        seenSignatures.add(signature);

        // 5. Evaluate Edge Angle Fidelity & Composite Score
        const angleErrorDeg = computeEdgeAngleErrorDeg(
          patternNodes,
          patternEdges,
          osmX,
          osmY,
          refinedMatchedIndices,
          refined.cosTheta,
          refined.sinTheta,
          reflectSign === -1
        );

        let semanticBonus = 0;
        let matchedCount = 0;
        for (let k = 0; k < M; k++) {
          const osmIdx = refinedMatchedIndices[k];
          if (osmIdx !== -1) {
            matchedCount++;
            const node = osmNodes[osmIdx];
            if (node.semanticWeight) semanticBonus += node.semanticWeight;
            if (
              patternNodes[k].preferredCategory &&
              node.category === patternNodes[k].preferredCategory
            ) {
              semanticBonus += 0.5;
            }
          }
        }
        semanticBonus /= M;

        const completenessRatio = matchedCount / M;
        const normalizedRmse = refined.rmse / Math.max(1, baseLen);

        // Penalty score (lower is better for compatibility with mapping_elf ranking)
        // Perfectly aligned -> score approaches 0.0
        const penaltyScore = (normalizedRmse * 0.5) + (angleErrorDeg / 180 * 0.3) + ((1 - completenessRatio) * 0.2) - (semanticBonus * 0.05);

        // Match quality score (0 to 100, higher is better)
        const matchQualityScore = Math.max(0, Math.min(100,
          100 * completenessRatio * Math.exp(-12.0 * normalizedRmse) * Math.exp(-angleErrorDeg / 18.0) + (5.0 * semanticBonus)
        ));

        // Convert fitted pattern positions back to WGS84 (lat, lon)
        const fittedPatternLatLon = [];
        const matchedNodesList = [];
        for (let k = 0; k < M; k++) {
          const px = patternNodes[k].x;
          const py = reflectSign === -1 ? -patternNodes[k].y : patternNodes[k].y;
          const fx = refined.scale * (refined.cosTheta * px - refined.sinTheta * py) + refined.tx;
          const fy = refined.scale * (refined.sinTheta * px + refined.cosTheta * py) + refined.ty;

          fittedPatternLatLon.push({
            lat: refLat + (fy / EARTH_RADIUS_M) * RAD_TO_DEG,
            lng: refLon + (fx / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG,
            lon: refLon + (fx / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG,
          });
          matchedNodesList.push(
            refinedMatchedIndices[k] !== -1 ? osmNodes[refinedMatchedIndices[k]] : null
          );
        }

        const centerLat = refLat + (refined.centerY / EARTH_RADIUS_M) * RAD_TO_DEG;
        const centerLon = refLon + (refined.centerX / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG;

        // Fitted real-world radius mean
        const fittedRadiusMeters = refined.scale * patternScaleNormalizer;

        // Center offset from requested center
        const centerOffsetMeters = Math.hypot(refined.centerX, refined.centerY);

        results.push({
          score: penaltyScore,
          matchQualityScore,
          rmseMeters: refined.rmse,
          angleErrorDeg,
          scale: fittedRadiusMeters,
          radiusMeanMeters: fittedRadiusMeters,
          radiusStdMeters: refined.rmse,
          centerErrorMeters: centerOffsetMeters,
          rotationDeg: (Math.atan2(refined.sinTheta, refined.cosTheta) * RAD_TO_DEG + 360) % 360,
          reflected: reflectSign === -1,
          centerLat,
          centerLon,
          center: { lat: centerLat, lng: centerLon },
          matchedNodes: matchedNodesList,
          points: matchedNodesList.filter(Boolean),
          fittedPatternLatLon,
        });

        // Maintain topK sorted by penalty score ascending
        results.sort((a, b) => a.score - b.score);
        if (results.length > topK * 4) {
          results.length = topK * 4;
        }
      }
    }

    if (i % 25 === 0 || i === N - 1) {
      yield {
        stage: 'plate-solving',
        label: `星圖錨點空間幾何搜尋 (${i + 1}/${N})`,
        completedSteps: i + 1,
        totalSteps: totalOuterSteps,
        progress: (i + 1) / totalOuterSteps,
        results: results.slice(0, topK),
        bestResult: results[0] ?? null,
      };
    }
  }

  results.sort((a, b) => a.score - b.score);
  return results.slice(0, topK);
}
