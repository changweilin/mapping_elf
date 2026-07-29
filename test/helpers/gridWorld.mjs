// gridworld.mjs — deterministic fake Manhattan street grid for offline testing of
// the drawing-board route-shaping algorithm. Pure ESM, no dependencies.
//
// Public API works in [lat, lng] (LATITUDE FIRST); internal math is local meters.
// Streets: vertical lines x = offsetM[0] + k*spacingM, horizontal lines
// y = offsetM[1] + k*spacingM, for all integer k.

const M_PER_DEG_LAT = 111320;

function distToSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-18) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(apx - t * abx, apy - t * aby);
}

export function makeGridWorld(opts = {}) {
  const anchor = opts.anchor ?? [25.034, 121.564];
  const spacingM = opts.spacingM ?? 100;
  const offsetM = opts.offsetM ?? [37, 23];
  const tieBreak = opts.tieBreak ?? 'hug';
  if (tieBreak !== 'hug' && tieBreak !== 'lshape') {
    throw new Error(`makeGridWorld: unknown tieBreak "${tieBreak}"`);
  }

  const s = spacingM;
  const [offX, offY] = offsetM;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((anchor[0] * Math.PI) / 180);
  const EPS = 1e-9;
  const SAME = 1e-7;

  // Boundary conversions: latlng <-> local meters happen ONLY here.
  function toXY([lat, lng]) {
    return [(lng - anchor[1]) * mPerDegLng, (lat - anchor[0]) * M_PER_DEG_LAT];
  }
  function toLatLng([x, y]) {
    return [anchor[0] + y / M_PER_DEG_LAT, anchor[1] + x / mPerDegLng];
  }

  function nearestVLine(x) { return offX + Math.round((x - offX) / s) * s; }
  function nearestHLine(y) { return offY + Math.round((y - offY) / s) * s; }

  function snapXY([x, y]) {
    const vx = nearestVLine(x);
    const hy = nearestHLine(y);
    const dv = Math.abs(x - vx);
    const dh = Math.abs(y - hy);
    if (dv <= dh) return { xy: [vx, y], distance: dv, onVertical: true };
    return { xy: [x, hy], distance: dh, onVertical: false };
  }

  function snap(latlng) {
    const r = snapXY(toXY(latlng));
    return { point: toLatLng(r.xy), distance: r.distance };
  }

  // The two adjacent intersections along the free axis of a snapped point's
  // street (identical when the point already sits on an intersection).
  function entryCandidates(v, off) {
    const t = (v - off) / s;
    const lo = off + Math.floor(t + 1e-9) * s;
    const hi = off + Math.ceil(t - 1e-9) * s;
    return lo === hi ? [lo] : [lo, hi];
  }

  function routeXY(aXY, bXY) {
    const A = snapXY(aXY);
    const B = snapXY(bXY);
    const [ax, ay] = A.xy;
    const [bx, by] = B.xy;

    // Degenerate: same snapped point.
    if (Math.abs(ax - bx) < SAME && Math.abs(ay - by) < SAME) return [A.xy];

    // Both on the same street: direct segment along that street.
    if (Math.abs(ax - bx) < SAME && Math.abs(ax - nearestVLine(ax)) < SAME) return [A.xy, B.xy];
    if (Math.abs(ay - by) < SAME && Math.abs(ay - nearestHLine(ay)) < SAME) return [A.xy, B.xy];

    // Entry intersections: consider both directions along each endpoint's
    // street and take the globally shortest combination — a real
    // shortest-path router never walks past its target and doubles back, and
    // the "toward the target" heuristic used previously did exactly that
    // when both points sat mid-block in the same block band (zero-area
    // whisker artifacts the app's spur logic then chased).
    const candsA = (A.onVertical ? entryCandidates(ay, offY) : entryCandidates(ax, offX))
      .map((v) => (A.onVertical ? [ax, v] : [v, ay]));
    const candsB = (B.onVertical ? entryCandidates(by, offY) : entryCandidates(bx, offX))
      .map((v) => (B.onVertical ? [bx, v] : [v, by]));
    let entryA = candsA[0], entryB = candsB[0], bestLen = Infinity;
    for (const ea of candsA) {
      for (const eb of candsB) {
        const len = Math.abs(ea[0] - ax) + Math.abs(ea[1] - ay)
          + Math.abs(eb[0] - ea[0]) + Math.abs(eb[1] - ea[1])
          + Math.abs(bx - eb[0]) + Math.abs(by - eb[1]);
        if (len < bestLen - 1e-9) { bestLen = len; entryA = ea; entryB = eb; }
      }
    }

    let i = Math.round((entryA[0] - offX) / s);
    let j = Math.round((entryA[1] - offY) / s);
    const i1 = Math.round((entryB[0] - offX) / s);
    const j1 = Math.round((entryB[1] - offY) / s);

    const pts = [A.xy];
    const pushUnique = (p) => {
      const last = pts[pts.length - 1];
      if (Math.abs(last[0] - p[0]) > SAME || Math.abs(last[1] - p[1]) > SAME) pts.push(p);
    };
    pushUnique(entryA);

    let prevAxis = null;
    const maxSteps = Math.abs(i1 - i) + Math.abs(j1 - j) + 4;
    let steps = 0;
    // Intersection-to-intersection march: every step reduces the remaining
    // Manhattan distance, so the march segment is Manhattan-optimal and terminates.
    while (i !== i1 || j !== j1) {
      if (++steps > maxSteps) throw new Error('gridworld: march failed to terminate');
      const canX = i !== i1;
      const canY = j !== j1;
      let axis;
      if (canX && canY) {
        if (tieBreak === 'hug') {
          const candX = [offX + (i + Math.sign(i1 - i)) * s, offY + j * s];
          const candY = [offX + i * s, offY + (j + Math.sign(j1 - j)) * s];
          const dX = distToSegment(candX, A.xy, B.xy);
          const dY = distToSegment(candY, A.xy, B.xy);
          axis = dX <= dY + 1e-9 ? 'x' : 'y'; // tie -> x first
        } else {
          axis = prevAxis ?? (Math.abs(i1 - i) >= Math.abs(j1 - j) ? 'x' : 'y');
        }
      } else {
        axis = canX ? 'x' : 'y';
      }
      if (axis === 'x') i += Math.sign(i1 - i);
      else j += Math.sign(j1 - j);
      prevAxis = axis;
      pushUnique([offX + i * s, offY + j * s]);
    }

    pushUnique(B.xy);
    return pts;
  }

  function route(a, b) {
    return routeXY(toXY(a), toXY(b)).map(toLatLng);
  }

  function routeLoop(waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length < 3) {
      throw new Error('routeLoop: need at least 3 waypoints');
    }
    const out = [];
    const n = waypoints.length;
    for (let k = 0; k < n; k++) {
      const leg = route(waypoints[k], waypoints[(k + 1) % n]);
      if (k === 0) out.push(...leg);
      else out.push(...leg.slice(1)); // leg[0] equals previous leg's last point
    }
    return out;
  }

  return { anchor, spacingM, offsetM, tieBreak, toXY, toLatLng, snap, route, routeLoop };
}
