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
};

export class RouteEngine {
  constructor() {
    this.mode = 'hiking';
    this.lastRouteCoords = [];
    this.alternatives = []; // Array of { coords, distance, ascent, descent, score, elevations }
  }

  setMode(mode) {
    this.mode = mode;
  }

  /**
   * Get single best route (backwards compatible)
   */
  async getRoute(waypoints) {
    if (waypoints.length < 2) return [];
    const results = await this.getAlternativeRoutes(waypoints);
    if (results.length > 0) {
      this.lastRouteCoords = results[0].coords;
      return results[0].coords;
    }
    return [];
  }

  /**
   * Get up to 4 alternative routes, scored and ranked
   * Handles multi-point routes by potentially breaking into segments if OSRM doesn't provide alternatives
   */
  async getAlternativeRoutes(waypoints) {
    if (waypoints.length < 2) return [];

    let rawRoutes = [];

    if (this.mode === 'hiking') {
      try {
        const coordStr = waypoints.map((w) => `${w[1]},${w[0]}`).join('|');
        const url = `https://brouter.de/brouter?lonlats=${coordStr}&profile=hiking-mountain&alternativeidx=0&format=geojson`;
        
        const resp = await fetch(url);
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

        rawRoutes = [{
          coords,
          inlineElevations,
          osrmDistance: distance,
          osrmDuration: duration
        }];
      } catch (err) {
        // BRouter 400s the WHOLE request when a single via-point can't be snapped
        // (e.g. a newly-added waypoint slightly off a mapped way). Rather than
        // collapsing the entire route to naive straight lines, route each leg
        // independently and only straight-line the leg(s) that genuinely fail.
        console.warn('BRouter combined routing failed, falling back to per-segment:', err.message);
        rawRoutes = [await this._routeBrouterPerSegment(waypoints)];
      }
    } else {
      const profile = PROFILE_MAP[this.mode] || 'foot';
      const coordStr = waypoints.map((w) => `${w[1]},${w[0]}`).join(';');
      
      const url = `${OSRM_BASE}/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false&alternatives=3`;

      try {
        const resp = await fetch(url);
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
          elevations = await this._fetchElevations(sampled);

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
  async _routeBrouterSegment(a, b) {
    const url = `https://brouter.de/brouter?lonlats=${a[1]},${a[0]}|${b[1]},${b[0]}&profile=hiking-mountain&alternativeidx=0&format=geojson`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`BRouter segment error: ${resp.status}`);
    const data = await resp.json();
    if (!data.features || data.features.length === 0) throw new Error('No segment route');
    return data.features[0].geometry.coordinates.map((c) => [c[1], c[0]]);
  }

  /**
   * Per-leg fallback for the hiking path: route consecutive waypoint pairs
   * independently and concatenate. A leg BRouter can't snap degrades to a
   * straight segment for that leg only, leaving the rest of the route intact.
   * Never throws — worst case (BRouter fully down) every leg is straight, i.e.
   * the old whole-route fallback. Elevations are left to the shared sampler
   * (inlineElevations: null) so mixed real/straight legs stay consistent.
   */
  async _routeBrouterPerSegment(waypoints) {
    const legs = [];
    for (let i = 0; i < waypoints.length - 1; i++) legs.push([waypoints[i], waypoints[i + 1]]);

    const legCoords = await Promise.all(legs.map(async ([a, b]) => {
      let coords;
      try {
        coords = await this._routeBrouterSegment(a, b);
      } catch (err) {
        console.warn('BRouter segment failed, straight-lining leg:', err.message);
        coords = [[...a], [...b]];
      }
      // Anchor each leg's endpoints exactly on the original waypoints (INC-133);
      // this also guarantees adjacent legs meet at an identical join point.
      if (coords.length > 0) coords[0] = [...a];
      if (coords.length > 1) coords[coords.length - 1] = [...b];
      return coords;
    }));

    const coords = [];
    legCoords.forEach((leg, i) => {
      // Drop each leg's first point after the first leg — it duplicates the
      // shared waypoint already appended as the previous leg's last point.
      if (i === 0) coords.push(...leg);
      else coords.push(...leg.slice(1));
    });

    return { coords, inlineElevations: null, osrmDistance: 0, osrmDuration: 0 };
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
   * Fetch elevations for an array of [lat,lng] points
   */
  async _fetchElevations(points) {
    if (!points || points.length === 0) return [];

    const lats = points.map((p) => p[0].toFixed(4)).join(',');
    const lngs = points.map((p) => p[1].toFixed(4)).join(',');

    try {
      const resp = await fetch(`${ELEVATION_API}?latitude=${lats}&longitude=${lngs}`);
      if (!resp.ok) throw new Error(`Elevation API error: ${resp.status}`);
      const data = await resp.json();
      return data.elevation || points.map(() => 0);
    } catch (err) {
      console.warn('Elevation fetch failed:', err.message);
      return points.map(() => 0);
    }
  }

  getLastRouteCoords() {
    return this.lastRouteCoords;
  }

  getAlternatives() {
    return this.alternatives;
  }
}
