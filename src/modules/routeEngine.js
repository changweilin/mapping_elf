/**
 * Mapping Elf — Route Engine
 * Uses OSRM demo API for route calculation with alternatives
 */
import { samplePoints, totalDistance } from './utils.js';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1';
const OSRM_NEAREST_BASE = 'https://router.project-osrm.org/nearest/v1';
const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';

const PROFILE_MAP = {
  walking: 'foot',
  cycling: 'bike',
  driving: 'car',
  motorcycle: 'car',
};

export function parseSpeedSegments(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  let cumM = 0;
  let prevT = 0;
  const segments = [];
  for (let i = 1; i < messages.length; i++) {
    const row = messages[i];
    const dM = parseInt(row[3], 10) || 0;
    const cumT = parseFloat(row[11]) || 0;
    const dt = Math.max(0.01, cumT - prevT);
    prevT = cumT;
    const tags = row[9] || '';
    const m = tags.match(/maxspeed=(\d+)\s*(mph)?/i);
    let maxspeed = null;
    if (m) {
      maxspeed = parseInt(m[1], 10);
      if (m[2] && m[2].toLowerCase() === 'mph') {
        maxspeed = Math.round(maxspeed * 1.60934);
      }
    }
    const baseKmh = dM > 0 ? (dM / dt) * 3.6 : 40;
    segments.push({
      startM: cumM,
      endM: cumM + dM,
      maxspeed,
      baseKmh,
    });
    cumM += dM;
  }
  return segments.length > 0 ? segments : null;
}

// Terrain is static and the elevation API is queried at 4 decimal places
// (~11 m), so a point looked up once never needs fetching again. Re-planning
// while the user keeps placing waypoints re-samples mostly the same geometry,
// which turns the per-alternative 100-point lookup into a partial (often full)
// cache hit. Bounded so a long session can't grow it without limit.
const ELEVATION_CACHE_LIMIT = 20000;

export class RouteEngine {
  constructor() {
    this.mode = 'hiking';
    this.lastRouteCoords = [];
    this.alternatives = []; // Array of { coords, distance, ascent, descent, score, elevations }
    this._elevCache = new Map();
  }

  setMode(mode) {
    this.mode = mode;
  }

  /**
   * Get single best route (backwards compatible)
   */
  async getRoute(waypoints, options = {}) {
    if (waypoints.length < 2) return [];
    const results = await this.getAlternativeRoutes(waypoints, options);
    if (results.length > 0) {
      this.lastRouteCoords = results[0].coords;
      return results[0].coords;
    }
    return [];
  }

  /**
   * Get up to 4 alternative routes, scored and ranked
   * Handles multi-point routes by potentially breaking into segments if OSRM doesn't provide alternatives
   *
   * `signal` aborts every request this plan makes. A plan superseded by the
   * next waypoint is thrown away whole, so letting it finish only holds the
   * network (and the progress readout) open against the user's next click.
   */
  async getAlternativeRoutes(waypoints, { signal } = {}) {
    if (waypoints.length < 2) return [];

    let rawRoutes = [];

    if (this.mode === 'hiking' || this.mode === 'motorcycle' || this.mode === 'driving') {
      const brouterProfile = this.mode === 'motorcycle' ? 'moped' : (this.mode === 'driving' ? 'car-fast' : 'hiking-mountain');
      try {
        const coordStr = waypoints.map((w) => `${w[1]},${w[0]}`).join('|');
        const url = `https://brouter.de/brouter?lonlats=${coordStr}&profile=${brouterProfile}&alternativeidx=0&format=geojson`;
        
        const resp = await fetch(url, { signal });
        if (!resp.ok) throw new Error(`BRouter error: ${resp.status}`);
        
        const data = await resp.json();
        if (!data.features || data.features.length === 0) {
          throw new Error('No route found from BRouter');
        }

        const feature = data.features[0];
        // BRouter geojson coordinates are [lng, lat, elevation?]
        const rawCoords = feature.geometry.coordinates;
        const coords = rawCoords.map((c) => [c[1], c[0]]);
        const inlineElevations = rawCoords.some((c) => c.length > 2 && typeof c[2] === 'number')
          ? rawCoords.map((c) => (typeof c[2] === 'number' ? c[2] : null))
          : null;
        // Anchor route endpoints exactly at the original waypoints (BRouter snaps to roads)
        if (coords.length > 0) coords[0] = [...waypoints[0]];
        if (coords.length > 1) coords[coords.length - 1] = [...waypoints[waypoints.length - 1]];
        const distance = feature.properties['track-length'] || 0;
        const duration = feature.properties['total-time'] || 0;
        const messages = feature.properties.messages || null;
        const speedSegments = parseSpeedSegments(messages);

        rawRoutes = [{
          coords,
          inlineElevations,
          osrmDistance: distance,
          osrmDuration: duration,
          messages,
          speedSegments,
        }];
      } catch (err) {
        // BRouter 400s the WHOLE request when a single via-point can't be snapped
        // (e.g. a newly-added waypoint slightly off a mapped way). Rather than
        // collapsing the entire route to naive straight lines, route each leg
        // independently and only straight-line the leg(s) that genuinely fail.
        // An aborted plan must not degrade into per-leg or straight-line
        // routing: those requests are dead too, and a straight-line "route"
        // would be drawn for waypoints the user has already moved past.
        if (signal?.aborted) throw err;
        console.warn(`BRouter ${brouterProfile} combined routing failed, falling back:`, err.message);
        try {
          rawRoutes = [await this._routeBrouterPerSegment(waypoints, brouterProfile, signal)];
        } catch (segErr) {
          if (signal?.aborted) throw segErr;
          if (this.mode === 'driving' || this.mode === 'motorcycle') {
            rawRoutes = await this._routeOsrmFallback(waypoints, signal);
          } else {
            rawRoutes = [{ coords: [...waypoints], inlineElevations: null, osrmDistance: 0, osrmDuration: 0, speedSegments: null }];
          }
        }
      }
    } else {
      const profile = PROFILE_MAP[this.mode] || 'foot';
      const coordStr = waypoints.map((w) => `${w[1]},${w[0]}`).join(';');
      
      const url = `${OSRM_BASE}/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false&alternatives=3`;

      try {
        const resp = await fetch(url, { signal });
        if (!resp.ok) throw new Error(`OSRM error: ${resp.status}`);

        const data = await resp.json();
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
          throw new Error('No route found');
        }

        rawRoutes = data.routes.map((r) => {
          const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
          // Anchor route endpoints exactly at the original waypoints (OSRM snaps to roads)
          if (coords.length > 0) coords[0] = [...waypoints[0]];
          if (coords.length > 1) coords[coords.length - 1] = [...waypoints[waypoints.length - 1]];
          return { coords, osrmDistance: r.distance, osrmDuration: r.duration };
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('OSRM routing failed, using fallback:', err.message);
        rawRoutes = [{ coords: [...waypoints], osrmDistance: 0, osrmDuration: 0 }];
      }
    }

    // Limit to 4 routes max
    rawRoutes = rawRoutes.slice(0, 4);

    // Fetch elevation data for all routes in parallel
    const routesWithElevation = await Promise.all(
      rawRoutes.map(async (route, idx) => {
        // Higher resolution sampling for better climb calculation (100 points)
        const sampled = samplePoints(route.coords, 100);
        const dist = totalDistance(route.coords);

        let elevations;
        let fullElevations = new Array(route.coords.length);

        const hasInline = Array.isArray(route.inlineElevations)
          && route.inlineElevations.some((e) => typeof e === 'number');

        if (hasInline) {
          // Use BRouter's per-point elevation; fill any nulls by interpolation
          fullElevations = [...route.inlineElevations];
          for (let i = 0; i < fullElevations.length; i++) {
            if (fullElevations[i] == null) {
              let nextI = i + 1;
              while (nextI < fullElevations.length && fullElevations[nextI] == null) nextI++;
              if (nextI < fullElevations.length) {
                const prev = i > 0 ? fullElevations[i - 1] : fullElevations[nextI];
                const next = fullElevations[nextI];
                const frac = 1 / (nextI - (i - 1));
                fullElevations[i] = prev + frac * (next - prev);
              } else {
                fullElevations[i] = i > 0 ? fullElevations[i - 1] : 0;
              }
            }
          }
          // Sample at the same indices samplePoints() uses
          if (route.coords.length <= 100) {
            elevations = [...fullElevations];
          } else {
            const step = (route.coords.length - 1) / 99;
            elevations = [fullElevations[0]];
            for (let i = 1; i < 99; i++) {
              elevations.push(fullElevations[Math.round(i * step)]);
            }
            elevations.push(fullElevations[route.coords.length - 1]);
          }
        } else {
          elevations = await this._fetchElevations(sampled, signal);

          // Interpolate elevations to full track for export
          if (route.coords.length <= 100) {
            for (let i = 0; i < route.coords.length; i++) {
              fullElevations[i] = elevations[i];
            }
          } else {
            const step = (route.coords.length - 1) / 99;
            for (let i = 0; i < 100; i++) {
              const idx = i === 99 ? route.coords.length - 1 : (i === 0 ? 0 : Math.round(i * step));
              fullElevations[idx] = elevations[i];
            }
            let lastIdx = 0;
            for (let i = 1; i < 100; i++) {
              const currIdx = i === 99 ? route.coords.length - 1 : Math.round(i * step);
              const diff = currIdx - lastIdx;
              const e1 = elevations[i - 1];
              const e2 = elevations[i];
              for (let j = lastIdx + 1; j < currIdx; j++) {
                const frac = (j - lastIdx) / diff;
                fullElevations[j] = e1 + frac * (e2 - e1);
              }
              lastIdx = currIdx;
            }
          }
        }

        // Calculate ascent/descent from elevation data
        let ascent = 0, descent = 0;
        let maxElev = -Infinity, minElev = Infinity;
        for (let i = 0; i < elevations.length; i++) {
          const e = elevations[i];
          if (e > maxElev) maxElev = e;
          if (e < minElev) minElev = e;
          if (i > 0) {
            const diff = e - elevations[i - 1];
            if (diff > 0) ascent += diff;
            else descent += Math.abs(diff);
          }
        }

        return {
          coords: route.coords,
          sampledCoords: sampled,
          elevations,
          fullElevations,
          distance: dist,
          ascent: Math.round(ascent),
          descent: Math.round(descent),
          maxElev: maxElev === -Infinity ? 0 : Math.round(maxElev),
          minElev: minElev === Infinity ? 0 : Math.round(minElev),
          startElev: Math.round(elevations[0] || 0),
          endElev: Math.round(elevations[elevations.length - 1] || 0),
          turnaroundElev: null, // calculated in main.js if needed
          score: 0, // will be calculated below
          label: '',
          index: idx,
          speedSegments: route.speedSegments || null,
        };
      })
    );

    // Score routes: lower distance + lower total elevation change = better
    // Weight: 50% distance, 50% elevation change (ascent + descent)
    if (routesWithElevation.length > 1) {
      const maxDist = Math.max(...routesWithElevation.map((r) => r.distance));
      const minDist = Math.min(...routesWithElevation.map((r) => r.distance));
      const maxTotalChange = Math.max(...routesWithElevation.map((r) => r.ascent + r.descent));
      const minTotalChange = Math.min(...routesWithElevation.map((r) => r.ascent + r.descent));

      const distRange = (maxDist - minDist) || 1;
      const changeRange = (maxTotalChange - minTotalChange) || 1;

      routesWithElevation.forEach((r) => {
        const dScore = (r.distance - minDist) / distRange;
        const eScore = (r.ascent + r.descent - minTotalChange) / changeRange;
        // The user specifically mentions "best" based on distance and climb
        r.score = dScore * 0.5 + eScore * 0.5;
      });

      // Sort by score (ascending: lower score is better)
      routesWithElevation.sort((a, b) => a.score - b.score);
    }

    // Assign final labels based on ranking
    const labels = ['最佳推薦', '短捷路徑', '平緩路徑', '替代方案'];
    routesWithElevation.forEach((r, i) => {
      // Find a suitable label based on its properties compared to others
      if (i === 0) {
        r.label = '最佳推薦';
      } else {
        // Check if this one is actually shorter or flatter than the "best" but scored lower
        if (r.distance < routesWithElevation[0].distance) r.label = '距離最短';
        else if (r.ascent < routesWithElevation[0].ascent) r.label = '爬升最少';
        else r.label = labels[i] || `方案 ${i + 1}`;
      }
      r.index = i;
    });

    this.alternatives = routesWithElevation;
    if (routesWithElevation.length > 0) {
      this.lastRouteCoords = routesWithElevation[0].coords;
    }

    return routesWithElevation;
  }

  /**
   * Route a single hiking leg through BRouter. Returns [lat,lng] coords (the
   * only place BRouter's [lng,lat] order is swapped — see INC-101). Throws if
   * BRouter can't map the leg, so the caller can straight-line just this one.
   */
  async _routeBrouterSegment(a, b, profile = 'hiking-mountain', signal = undefined) {
    const url = `https://brouter.de/brouter?lonlats=${a[1]},${a[0]}|${b[1]},${b[0]}&profile=${profile}&alternativeidx=0&format=geojson`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) throw new Error(`BRouter segment error: ${resp.status}`);
    const data = await resp.json();
    if (!data.features || data.features.length === 0) throw new Error('No segment route');
    const f = data.features[0];
    return {
      coords: f.geometry.coordinates.map((c) => [c[1], c[0]]),
      speedSegments: parseSpeedSegments(f.properties?.messages),
    };
  }

  /**
   * Per-leg fallback for the hiking path: route consecutive waypoint pairs
   * independently and concatenate. A leg BRouter can't snap degrades to a
   * straight segment for that leg only, leaving the rest of the route intact.
   * Never throws — worst case (BRouter fully down) every leg is straight, i.e.
   * the old whole-route fallback. Elevations are left to the shared sampler
   * (inlineElevations: null) so mixed real/straight legs stay consistent.
   */
  async _routeBrouterPerSegment(waypoints, profile = 'hiking-mountain', signal = undefined) {
    const legs = [];
    for (let i = 0; i < waypoints.length - 1; i++) legs.push([waypoints[i], waypoints[i + 1]]);

    const legResults = await Promise.all(legs.map(async ([a, b]) => {
      let coords;
      let speedSegments = null;
      try {
        const res = await this._routeBrouterSegment(a, b, profile, signal);
        coords = res.coords;
        speedSegments = res.speedSegments;
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('BRouter segment failed, straight-lining leg:', err.message);
        coords = [[...a], [...b]];
      }
      if (coords.length > 0) coords[0] = [...a];
      if (coords.length > 1) coords[coords.length - 1] = [...b];
      return { coords, speedSegments };
    }));

    const coords = [];
    const allSpeedSegments = [];
    let cumOffsetM = 0;
    legResults.forEach((leg, i) => {
      if (i === 0) coords.push(...leg.coords);
      else coords.push(...leg.coords.slice(1));

      if (Array.isArray(leg.speedSegments) && leg.speedSegments.length > 0) {
        const segEnd = leg.speedSegments[leg.speedSegments.length - 1].endM;
        for (const s of leg.speedSegments) {
          allSpeedSegments.push({
            startM: s.startM + cumOffsetM,
            endM: s.endM + cumOffsetM,
            maxspeed: s.maxspeed,
            baseKmh: s.baseKmh,
          });
        }
        cumOffsetM += segEnd;
      }
    });

    return {
      coords,
      inlineElevations: null,
      osrmDistance: 0,
      osrmDuration: 0,
      speedSegments: allSpeedSegments.length > 0 ? allSpeedSegments : null,
    };
  }

  async _routeOsrmFallback(waypoints, signal = undefined) {
    const profile = PROFILE_MAP[this.mode] || 'car';
    const coordStr = waypoints.map((w) => `${w[1]},${w[0]}`).join(';');
    const url = `${OSRM_BASE}/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) throw new Error(`OSRM fallback error: ${resp.status}`);
    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('No OSRM route found');
    }
    const r = data.routes[0];
    const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
    if (coords.length > 0) coords[0] = [...waypoints[0]];
    if (coords.length > 1) coords[coords.length - 1] = [...waypoints[waypoints.length - 1]];
    return [{
      coords,
      inlineElevations: null,
      osrmDistance: r.distance,
      osrmDuration: r.duration,
      speedSegments: null,
    }];
  }

  /**
   * Snap [lat,lng] points onto the OSRM walkable (foot) network so no
   * waypoint sits away from a routable way. Coordinate-order conversion to
   * OSRM's [lng,lat] happens only here (INC-101 boundary). Each point
   * resolves independently; a failed lookup falls back to the original point
   * with `distance: Infinity` so callers can tell it was never verified.
   * Returns [{ point: [lat,lng], distance, snapped }] in input order.
   */
  async snapToFootNetwork(points, profile = 'foot') {
    return Promise.all((points || []).map(async ([lat, lng]) => {
      try {
        const resp = await fetch(`${OSRM_NEAREST_BASE}/${profile}/${lng},${lat}?number=1`);
        if (!resp.ok) throw new Error(`OSRM nearest error: ${resp.status}`);
        const data = await resp.json();
        const wp = data.code === 'Ok' && Array.isArray(data.waypoints) ? data.waypoints[0] : null;
        if (!wp || !Array.isArray(wp.location)) throw new Error('no nearest location');
        return {
          point: [wp.location[1], wp.location[0]],
          distance: Number.isFinite(wp.distance) ? wp.distance : 0,
          snapped: true,
        };
      } catch (err) {
        console.warn('OSRM nearest snap failed:', err.message);
        return { point: [lat, lng], distance: Infinity, snapped: false };
      }
    }));
  }

  /**
   * Fetch elevations for an array of [lat,lng] points.
   *
   * Only the points not already cached (and each distinct point once) are
   * requested; a re-plan over mostly-unchanged geometry therefore sends a much
   * shorter request, or none at all. Results are identical to the uncached
   * path — the key IS the 4dp coordinate the API is asked for.
   */
  async _fetchElevations(points, signal = undefined) {
    if (!points || points.length === 0) return [];

    const keys = points.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`);
    const missing = [];
    const missingKeys = new Set();
    for (let i = 0; i < keys.length; i++) {
      if (this._elevCache.has(keys[i]) || missingKeys.has(keys[i])) continue;
      missingKeys.add(keys[i]);
      missing.push(points[i]);
    }

    if (missing.length === 0) return keys.map((k) => this._elevCache.get(k));

    const lats = missing.map((p) => p[0].toFixed(4)).join(',');
    const lngs = missing.map((p) => p[1].toFixed(4)).join(',');

    try {
      const resp = await fetch(`${ELEVATION_API}?latitude=${lats}&longitude=${lngs}`, { signal });
      if (!resp.ok) throw new Error(`Elevation API error: ${resp.status}`);
      const data = await resp.json();
      const fetched = Array.isArray(data.elevation) ? data.elevation : null;
      if (!fetched) throw new Error('Elevation API returned no elevation array');
      [...missingKeys].forEach((key, i) => {
        if (typeof fetched[i] === 'number') this._elevCache.set(key, fetched[i]);
      });
      this._trimElevationCache();
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn('Elevation fetch failed:', err.message);
    }

    // Cache misses that stayed missing read 0, as they did before caching.
    return keys.map((k) => this._elevCache.get(k) ?? 0);
  }

  _trimElevationCache() {
    while (this._elevCache.size > ELEVATION_CACHE_LIMIT) {
      const oldest = this._elevCache.keys().next().value;
      if (oldest === undefined) return;
      this._elevCache.delete(oldest);
    }
  }

  getLastRouteCoords() {
    return this.lastRouteCoords;
  }

  getAlternatives() {
    return this.alternatives;
  }
}
