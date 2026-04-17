/**
 * Mapping Elf — Utility Functions
 */

const EARTH_RADIUS = 6371000;

export function haversineDistance(p1, p2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(p2[0] - p1[0]);
  const dLng = toRad(p2[1] - p1[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1[0])) * Math.cos(toRad(p2[0])) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function totalDistance(points) {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    dist += haversineDistance(points[i - 1], points[i]);
  }
  return dist;
}

export function cumulativeDistances(points) {
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    dists.push(dists[i - 1] + haversineDistance(points[i - 1], points[i]));
  }
  return dists;
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatElevation(meters) {
  return `${Math.round(meters)} m`;
}

export function formatCoords(lat, lng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function showNotification(message, type = 'info', duration = 3500) {
  const container = document.getElementById('notifications');
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

export function samplePoints(points, maxSamples = 100) {
  if (points.length <= maxSamples) return [...points];
  const sampled = [points[0]];
  const step = (points.length - 1) / (maxSamples - 1);
  for (let i = 1; i < maxSamples - 1; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  sampled.push(points[points.length - 1]);
  return sampled;
}

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Reorder `points` (array of [lat, lng]) to approximately minimize total
 * straight-line Haversine distance, keeping index 0 as a fixed start.
 *
 * Nearest-neighbor greedy construction, then 2-opt local improvement.
 * Intended for ≲ a few hundred points; 2-opt is O(n²) per pass.
 *
 * Returns a new array with the same elements in a new order (by reference).
 */
export function tspOptimize(points) {
  const n = points.length;
  if (n <= 2) return [...points];

  const dist = (a, b) => haversineDistance(a, b);

  // --- 1. Nearest-neighbor greedy from fixed start (index 0) ---
  const visited = new Array(n).fill(false);
  const order = [0];
  visited[0] = true;
  for (let step = 1; step < n; step++) {
    const last = points[order[order.length - 1]];
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = dist(last, points[i]);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    order.push(bestIdx);
    visited[bestIdx] = true;
  }

  // --- 2. 2-opt improvement (start fixed; never reverse segment starting at 0) ---
  let improved = true;
  let guard = 0;
  const MAX_PASSES = 50;
  while (improved && guard++ < MAX_PASSES) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = points[order[i - 1]];
        const b = points[order[i]];
        const c = points[order[k]];
        const d = k + 1 < n ? points[order[k + 1]] : null;
        const before = dist(a, b) + (d ? dist(c, d) : 0);
        const after  = dist(a, c) + (d ? dist(b, d) : 0);
        if (after + 1e-9 < before) {
          // reverse order[i..k]
          let lo = i, hi = k;
          while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }
  }

  return order.map((idx) => points[idx]);
}

/**
 * Interpolate the route gradient color at fraction t (0 = start, 1 = end).
 * Returns { r, g, b } integers.
 */
export function interpolateRouteColorRgb(t) {
  const stops = [
    { t: 0,    r: 110, g: 231, b: 183 }, // #6ee7b7  teal-green
    { t: 0.33, r: 56,  g: 189, b: 248 }, // #38bdf8  sky-blue
    { t: 0.66, r: 251, g: 191, b: 36  }, // #fbbf24  amber
    { t: 1,    r: 248, g: 113, b: 113 }, // #f87171  red
  ];
  const tc = Math.max(0, Math.min(1, t));
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (tc <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = hi.t - lo.t;
  const f = span > 0 ? (tc - lo.t) / span : 0;
  return {
    r: Math.round(lo.r + (hi.r - lo.r) * f),
    g: Math.round(lo.g + (hi.g - lo.g) * f),
    b: Math.round(lo.b + (hi.b - lo.b) * f),
  };
}

/** Returns `rgb(r,g,b)` string for gradient at fraction t. */
export function interpolateRouteColor(t) {
  const { r, g, b } = interpolateRouteColorRgb(t);
  return `rgb(${r},${g},${b})`;
}
