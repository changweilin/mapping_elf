// Shared external-API stubs for the route / weather / 集水區 specs.
//
// These four stubs were copy-pasted into a dozen spec files with only cosmetic
// drift (a call counter here, a delay there), which meant a change to the DEM
// shape had to be repeated everywhere and quietly diverged instead. Each export
// below is the SUPERSET of the variants it replaces — default arguments
// reproduce the plain version byte-for-byte in behaviour.
//
// Deliberately NOT here: the per-spec `forecast` stubs. Those genuinely differ
// (varied weather codes, delayed responses, per-point request sinks, soil
// moisture) and unifying them would take more parameters than the code it saves.

export const ANCHOR = [23.5, 121.0]; // mapManager DEFAULT_CENTER

/**
 * Cone terrain draining to `anchor` — the standard delineation fixture.
 * @param {object} [opts]
 * @param {{calls:number}} [opts.stats]  incremented per elevation request
 * @param {number} [opts.delayMs]        hold each response, to keep a load in flight
 * @param {(meanLng:number)=>boolean} [opts.deadZone]  when true, answer with nulls (failed DEM read)
 */
export function coneElevation(page, { stats = null, delayMs = 0, deadZone = null, anchor = ANCHOR, slope = 0.1 } = {}) {
  return page.route(/v1\/elevation/, async (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    if (stats) stats.calls = (stats.calls || 0) + 1;
    const meanLng = lngs.reduce((a, b) => a + b, 0) / (lngs.length || 1);
    const dead = typeof deadZone === 'function' && deadZone(meanLng);
    const elevation = lats.map((la, i) => {
      if (dead) return null;
      const dy = (la - anchor[0]) * 111320;
      const dx = (lngs[i] - anchor[1]) * 111320 * Math.cos(anchor[0] * Math.PI / 180);
      return 100 + slope * Math.hypot(dx, dy);
    });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}

/**
 * fBm ridge/valley terrain — used where a cone's single convergent basin would
 * be too kind a fixture and the basin shape for an arbitrary waypoint matters.
 * @param {{demCalls:number}} [opts.stats]
 */
export function fbmElevation(page, { stats = null, anchor = ANCHOR } = {}) {
  return page.route(/v1\/elevation/, (route) => {
    if (stats) stats.demCalls = (stats.demCalls || 0) + 1;
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lngs = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const elevation = lats.map((la, i) => {
      const dy = (la - anchor[0]) * 111320;
      const dx = (lngs[i] - anchor[1]) * 111320 * Math.cos(anchor[0] * Math.PI / 180);
      let e = 1200 + dy * 0.03 - dx * 0.02;
      for (let k = 0; k < 5; k++) {
        const a = 300 / 2 ** k, w = 2 ** k / 900;
        e += a * Math.sin(dx * w + k) * Math.cos(dy * w * 1.3 + k * 2);
      }
      return e;
    });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevation }) });
  });
}

/**
 * Dead-flat DEM — the 平地 fast path. Requests are counted by size, because the
 * route's own elevation profile shares this endpoint: a catchment read is
 * `minGridPoints`+ points, a 2-waypoint profile is 2.
 */
export function flatElevation(page, { stats = null, elevation = 100, minGridPoints = 50 } = {}) {
  return page.route(/v1\/elevation/, (route) => {
    const lats = (new URL(route.request().url()).searchParams.get('latitude') || '').split(',');
    if (stats && lats.length >= minGridPoints) {
      stats.demCalls = (stats.demCalls || 0) + 1;
      stats.demPoints = (stats.demPoints || 0) + lats.length;
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ elevation: lats.map(() => elevation) }),
    });
  });
}

/** Straight-line OSRM: echoes the requested coordinates back as the geometry. */
export function osrm(page) {
  return page.route('**/route/v1/**', (route) => {
    const coordPart = new URL(route.request().url()).pathname.split('/').pop();
    const coords = coordPart.split(';').map((c) => c.split(',').map(Number));
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 1000, duration: 1000, geometry: { type: 'LineString', coordinates: coords } }] } });
  });
}

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

/**
 * Basemap tiles as a 1×1 transparent PNG. Anything that pans or zooms the map
 * (fitBounds after a search, a restored route) otherwise fires dozens of real
 * tile requests per move, which is both slow and a flake source.
 */
export function mapTiles(page) {
  return page.route(/basemaps\.cartocdn\.com|tile\.opentopomap\.org|server\.arcgisonline\.com|tile\.openstreetmap\.org/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: TRANSPARENT_PNG,
    }));
}

const EARTH_R = 6371000;

/** Point `distanceMeters` from `[lat,lng]` along `bearingDeg` (great circle). */
export function destination([lat, lng], distanceMeters, bearingDeg) {
  const br = (bearingDeg * Math.PI) / 180;
  const ad = distanceMeters / EARTH_R;
  const la1 = (lat * Math.PI) / 180;
  const ln1 = (lng * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(br));
  const ln2 = ln1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));
  return [(la2 * 180) / Math.PI, (((ln2 * 180) / Math.PI + 540) % 360) - 180];
}

/**
 * Overpass stub for the 魔法陣 tool. Answers every query with a ring of POIs at
 * exact bearings around `center`, so the solver has a geometrically perfect
 * star to find and the spec can assert on the result rather than on whatever
 * the live API happens to return.
 *
 * The POIs are tagged `amenity=place_of_worship`, which is the 宗教 category —
 * the tool's default selection.
 *
 * @param {object} [opts]
 * @param {[number,number]} [opts.center]
 * @param {number} [opts.points]        vertices in the perfect ring (default 5)
 * @param {number} [opts.radiusMeters]  ring radius
 * @param {number} [opts.noise]         extra off-pattern POIs
 * @param {{calls:number}} [opts.stats]
 * @param {number} [opts.status]        respond with this HTTP status instead (failure path)
 */
export function overpass(page, {
  center = ANCHOR, points = 5, radiusMeters = 5000, noise = 24, stats = null, status = 0,
} = {}) {
  return page.route(/overpass/, async (route) => {
    if (stats) stats.calls = (stats.calls || 0) + 1;
    if (status) { await route.fulfill({ status, contentType: 'text/plain', body: 'stubbed failure' }); return; }
    const elements = [];
    for (let i = 0; i < points; i += 1) {
      const [lat, lon] = destination(center, radiusMeters, (360 / points) * i);
      elements.push({ type: 'node', id: 1000 + i, lat, lon, tags: { amenity: 'place_of_worship', name: `星點 ${i + 1}` } });
    }
    for (let i = 0; i < noise; i += 1) {
      // Deliberately off both the target radius and the target bearings.
      const [lat, lon] = destination(center, radiusMeters * (0.72 + ((i * 7) % 40) / 100), (i * 47) % 360);
      elements.push({ type: 'node', id: 5000 + i, lat, lon, tags: { amenity: 'place_of_worship', name: `雜點 ${i + 1}` } });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements }) });
  });
}

/** Nominatim place-search stub used by the 魔法陣 centre input. */
export function nominatim(page, { center = ANCHOR, results = 1, label = '測試地點' } = {}) {
  return page.route(/nominatim.*\/search/, (route) => {
    const body = Array.from({ length: results }, (_, i) => ({
      place_id: 900 + i,
      lat: String(center[0] + i * 0.01),
      lon: String(center[1]),
      name: results === 1 ? label : `${label} ${i + 1}`,
      display_name: `${label} ${i + 1}, 台灣`,
    }));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/**
 * River-discharge (hydrology) stub, answering across the whole requested date
 * range. `discharge`/`mean` receive (dayString, index) so a spec can ramp the
 * values to move the risk chips.
 */
export function flood(page, { stats = null, discharge = () => 5, mean = () => 4 } = {}) {
  return page.route(/flood-api\.open-meteo\.com\/v1\/flood/, (route) => {
    if (stats) stats.floodCalls = (stats.floodCalls || 0) + 1;
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start_date') || '2026-07-18';
    const end = url.searchParams.get('end_date') || start;
    const days = [];
    for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ daily: { time: days, river_discharge: days.map(discharge), river_discharge_mean: days.map(mean) } }),
    });
  });
}
