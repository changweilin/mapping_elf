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
