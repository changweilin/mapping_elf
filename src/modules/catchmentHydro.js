// Catchment hydrology — turns a delineated basin's geometry + free Open-Meteo
// data (soil moisture, antecedent/forecast rainfall, GLOFAS river discharge)
// into coarse hydrology indicators for a chosen date/hour.
//
// SAFETY: the 溪水暴漲 (stream-surge) and 土石流 (debris-flow) outputs are
// heuristic REFERENCE levels derived from rainfall + soil + terrain, NOT
// official warnings. Callers must present them as rough estimates.
//
// Data source is Open-Meteo (same free provider already used app-wide); no new
// runtime dependency. All fetches degrade to nulls rather than throwing, so one
// failing endpoint never sinks the panel (see CLAUDE.md API-fallback rule).

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const FLOOD_API = 'https://flood-api.open-meteo.com/v1/flood';
const FETCH_TIMEOUT_MS = 12000;

// Saturated volumetric water content (porosity). Soil moisture from Open-Meteo
// is m³/m³; dividing by this gives a 0–1 saturation fraction.
const POROSITY = 0.45;

// Root-zone soil-saturation weights: the thin 0–1 cm skin layer swings fast and
// matters least; the deep layer holds the bulk of the antecedent storage.
const SOIL_LAYERS = [
  ['soil_moisture_0_to_1cm', 1],
  ['soil_moisture_3_to_9cm', 6],
  ['soil_moisture_9_to_27cm', 18],
  ['soil_moisture_27_to_81cm', 54],
];

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return d; };

function fetchWithTimeout(url, signal, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', relay, { once: true });
  }
  return fetch(url, { signal: ctrl.signal }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  });
}

async function fetchJson(url, signal) {
  const resp = await fetchWithTimeout(url, signal, FETCH_TIMEOUT_MS);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

const sumRange = (arr, lo, hi) => {
  if (!Array.isArray(arr)) return null;
  let s = 0, n = 0;
  for (let i = Math.max(0, lo); i < Math.min(arr.length, hi); i++) {
    if (Number.isFinite(arr[i])) { s += arr[i]; n++; }
  }
  return n ? s : null;
};

const maxRange = (arr, lo, hi) => {
  if (!Array.isArray(arr)) return null;
  let m = null;
  for (let i = Math.max(0, lo); i < Math.min(arr.length, hi); i++) {
    if (Number.isFinite(arr[i]) && (m === null || arr[i] > m)) m = arr[i];
  }
  return m;
};

/**
 * Fetch and normalize the environmental inputs for a catchment's hydrology at a
 * chosen local date/hour. Never throws except on external abort; on any data
 * gap the corresponding field is null.
 *
 * @returns {Promise<{
 *   available: boolean, soilSaturation: number|null, rainPast24: number|null,
 *   rainPast72: number|null, rainNext24: number|null, peakIntensity: number|null,
 *   wetHours: number|null, wetRainSum: number|null, et0: number|null,
 *   discharge: number|null, dischargeMean: number|null, dischargePrev: number|null
 * }>}
 */
export async function fetchHydroData(lat, lng, dateStr, hour, { signal } = {}) {
  const h = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.round(hour))) : 8;
  const start = ymd(addDays(dateStr, -3));   // 72 h antecedent window + margin
  const end = ymd(addDays(dateStr, 1));      // + forecast/event window
  const hourlyVars = ['precipitation', ...SOIL_LAYERS.map((l) => l[0]), 'et0_fao_evapotranspiration'].join(',');
  const wxUrl = `${FORECAST_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + `&hourly=${hourlyVars}&timezone=Asia%2FTaipei&start_date=${start}&end_date=${end}`;

  const fStart = ymd(addDays(dateStr, -1));
  const fEnd = ymd(addDays(dateStr, 3));      // a few days ahead for the trend
  const floodUrl = `${FLOOD_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + `&daily=river_discharge,river_discharge_mean&start_date=${fStart}&end_date=${fEnd}`;

  const [wx, flood] = await Promise.all([
    fetchJson(wxUrl, signal).catch((err) => { if (err?.name === 'AbortError') throw err; console.warn('Hydro forecast failed:', err.message); return null; }),
    fetchJson(floodUrl, signal).catch((err) => { if (err?.name === 'AbortError') throw err; console.warn('Hydro flood failed:', err.message); return null; }),
  ]);

  return normalize(wx, flood, dateStr, h);
}

function normalize(wx, flood, dateStr, hour) {
  const out = {
    available: false, soilSaturation: null, rainPast24: null, rainPast72: null,
    rainNext24: null, peakIntensity: null, wetHours: null, wetRainSum: null, et0: null,
    discharge: null, dischargeMean: null, dischargePrev: null,
  };

  const H = wx?.hourly;
  const times = H?.time;
  if (Array.isArray(times)) {
    const key = `${dateStr}T${pad2(hour)}:00`;
    const i = times.indexOf(key);
    if (i >= 0) {
      out.available = true;
      // Root-zone saturation = depth-weighted mean of (vwc / porosity), clamped.
      let sw = 0, ww = 0;
      for (const [field, w] of SOIL_LAYERS) {
        const v = H[field]?.[i];
        if (Number.isFinite(v)) { sw += (v / POROSITY) * w; ww += w; }
      }
      if (ww > 0) out.soilSaturation = Math.max(0, Math.min(1, sw / ww));

      const p = H.precipitation;
      out.rainPast24 = sumRange(p, i - 24, i);
      out.rainPast72 = sumRange(p, i - 72, i);
      out.rainNext24 = sumRange(p, i, i + 24);
      out.peakIntensity = maxRange(p, i, i + 24);   // peak hourly rate over the event window
      // Wet-hour duration/sum over the SAME hour set (≥1 mm/h), so the debris-flow
      // storm-mean intensity P_event/D isn't inflated by a mismatched window.
      if (Array.isArray(p)) {
        let wc = 0, ws = 0, any = false;
        for (let j = i; j < Math.min(p.length, i + 24); j++) {
          if (!Number.isFinite(p[j])) continue;
          any = true;
          if (p[j] >= 1) { wc++; ws += p[j]; }
        }
        if (any) { out.wetHours = wc; out.wetRainSum = ws; }
      }
      const e = H.et0_fao_evapotranspiration?.[i];
      out.et0 = Number.isFinite(e) ? e : null;
    }
  }

  const D = flood?.daily;
  if (Array.isArray(D?.time)) {
    const di = D.time.indexOf(dateStr);
    if (di >= 0) {
      const rd = D.river_discharge?.[di];
      const rm = D.river_discharge_mean?.[di];
      const rp = D.river_discharge?.[di - 1];
      out.discharge = Number.isFinite(rd) ? rd : null;
      out.dischargeMean = Number.isFinite(rm) ? rm : null;
      out.dischargePrev = Number.isFinite(rp) ? rp : null;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Indicator computation (pure). Thresholds are tunable constants; treat them as
// a data contract if ever externalised (give defaults, merge {...DEFAULT}).
// ---------------------------------------------------------------------------

// Risk vocabulary, low→high. Rows carry the zh-TW word (translated by the caller)
// plus a 0–3 severity for colour; -1 marks "cannot assess".
const LEVELS = ['低', '中', '高', '極高'];
const UNAVAILABLE = '無法評估';
const sevOf = (lvl) => (lvl == null ? null : lvl === UNAVAILABLE ? -1 : LEVELS.indexOf(lvl));

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round0 = (x) => Math.round(x);
const round1 = (x) => Math.round(x * 10) / 10;
const signed = (x) => (x > 0 ? '+' : '') + x;

/** Ascending cut-points `cuts` (length 3) → one of LEVELS (length 4). */
function band(value, cuts) {
  for (let i = 0; i < cuts.length; i++) if (value < cuts[i]) return LEVELS[i];
  return LEVELS[cuts.length];
}

/** Format a positive volume to 3 significant figures with thousands grouping. */
function sig3(v) {
  if (!Number.isFinite(v) || v <= 0) return '0';
  const n = Number(v.toPrecision(3));
  const [int, frac] = String(n).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

const mk = (label, value, level = null) => ({ label, value, level, severity: sevOf(level) });

/** Terrain descriptors — available synchronously from the delineation. */
export function computeGeometryRows(geo) {
  const rows = [];
  if (Number.isFinite(geo.minEle) && Number.isFinite(geo.maxEle)) {
    const relief = Math.max(0, geo.reliefM);
    rows.push(mk('海拔範圍', `${round0(geo.minEle)}–${round0(geo.maxEle)} m（Δ${round0(relief)} m）`));
  } else rows.push(mk('海拔範圍', '—'));

  if (Number.isFinite(geo.meanSlopeDeg)) {
    const steep = Number.isFinite(geo.maxSlopeDeg) ? `（最陡 ${round0(geo.maxSlopeDeg)}°）` : '';
    rows.push(mk('平均坡度', `${round1(geo.meanSlopeDeg)}°${steep}`));
  } else rows.push(mk('平均坡度', '—'));

  if (Number.isFinite(geo.flowLenM) && geo.flowLenM > 0) {
    rows.push(mk('主流長度', geo.flowLenM >= 1000 ? `${(geo.flowLenM / 1000).toFixed(2)} km` : `${round0(geo.flowLenM)} m`));
  } else rows.push(mk('主流長度', '—'));
  return rows;
}

/** Discharge trend sign from GLOFAS: 1 rising, 0 steady, -1 falling, null unknown. */
function dischargeTrend(env) {
  if (env.discharge == null || env.dischargePrev == null) return null;
  const d = (env.discharge - env.dischargePrev) / Math.max(env.dischargePrev, 0.01);
  return d > 0.1 ? 1 : d < -0.1 ? -1 : 0;
}

/**
 * Hydrology indicators for the catchment at the chosen time. Every value is
 * null-safe (missing data → '—' or 無法評估, never NaN). Surge & debris-flow are
 * heuristic reference levels — the caller must show the disclaimer.
 */
export function computeHydroIndicators(geo, env) {
  const rows = [];
  const satPct = env.soilSaturation == null ? null : round0(clamp01(env.soilSaturation) * 100);

  // 1. Soil moisture (root-zone saturation %)
  rows.push(satPct == null
    ? mk('土壤含水量', '—')
    : mk('土壤含水量', `${satPct}%`, band(satPct, [50, 75, 90])));

  // 2. Antecedent rainfall (24h / 72h); band by the 72h total.
  const p24 = env.rainPast24, p72 = env.rainPast72;
  if (p24 == null && p72 == null) {
    rows.push(mk('前期降雨', '—'));
  } else {
    const v = `24h ${p24 == null ? '—' : round1(Math.max(0, p24)) + ' mm'} ｜ 72h ${p72 == null ? '—' : round1(Math.max(0, p72)) + ' mm'}`;
    rows.push(mk('前期降雨', v, p72 == null ? null : band(Math.max(0, p72), [20, 60, 130])));
  }

  // 3. Estimated event runoff volume — SCS-CN, slope+saturation adjusted.
  const P = env.rainNext24;
  if (P == null) {
    rows.push(mk('預估逕流量', '—'));
  } else {
    const alpha = Math.tan((geo.meanSlopeDeg || 0) * Math.PI / 180);
    const cnS = 60 * (322.79 + 15.63 * alpha) / (alpha + 323.52);
    let cn;
    if (satPct == null) {
      cn = Math.max(30, Math.min(98, cnS));                    // AMC-II fallback
    } else {
      const s = satPct / 100;
      const cnDry = cnS / (2.281 - 0.01281 * cnS);
      const cnWet = cnS / (0.427 + 0.00573 * cnS);
      cn = Math.max(30, Math.min(98, cnDry + (cnWet - cnDry) * s));
    }
    const S = 25400 / cn - 254;
    const Ia = 0.2 * S;
    const Pp = Math.max(0, P);
    const Q = Pp > Ia ? (Pp - Ia) ** 2 / (Pp - Ia + S) : 0;    // runoff depth, mm
    const V = Q / 1000 * geo.areaM2;                            // m³
    const coeff = Pp > 0 ? `（C ${(Q / Pp).toFixed(2)}）` : '';  // guard 0/0 → hidden
    rows.push(mk('預估逕流量', `${sig3(V)} m³${coeff}`));
  }

  // 4. Regional river discharge (GLOFAS) + trend + climatology anomaly.
  const trend = dischargeTrend(env);
  if (env.discharge == null) {
    rows.push(mk('河川流量', '—'));
  } else {
    const arrow = trend == null ? '' : trend > 0 ? ' ↑' : trend < 0 ? ' ↓' : ' →';
    let anomPct = null, anomTxt = '';
    if (env.dischargeMean != null) {
      anomPct = (env.discharge - env.dischargeMean) / Math.max(env.dischargeMean, 0.01) * 100;
      anomTxt = `（距平 ${signed(round0(anomPct))}%）`;
    }
    const qTxt = env.discharge < 1 ? env.discharge.toPrecision(2) : round1(env.discharge);
    // Bands top-down with full coverage (safety review: no gaps/overlaps).
    let lvl = null;
    if (anomPct != null) {
      if (anomPct > 100) lvl = '極高';
      else if (anomPct > 30 || (trend === 1 && anomPct > 0)) lvl = '高';
      else if (anomPct >= -20) lvl = '中';
      else lvl = '低';
    }
    rows.push(mk('河川流量', `${qTxt} m³/s${arrow}${anomTxt}`, lvl));
  }

  // 5. Stream-surge / flash-flood risk (heuristic).
  const Imax = env.peakIntensity;
  if (Imax == null || satPct == null) {
    rows.push(mk('溪水暴漲風險', '', UNAVAILABLE));
  } else {
    const s = satPct / 100;
    const wetness = clamp01(0.6 * s + 0.4 * Math.min((env.rainPast72 || 0) / 150, 1));
    const intensity = clamp01(Imax / 40);
    const areaKm2 = geo.areaM2 / 1e6;
    const flash = clamp01((geo.meanSlopeDeg / 30) * (1 / (1 + areaKm2 / 2)));
    const trendTerm = trend == null ? 0.5 : trend > 0 ? 1 : trend < 0 ? 0 : 0.5;
    const score = 100 * (0.35 * wetness + 0.40 * intensity + 0.15 * flash + 0.10 * trendTerm);
    let lvl = band(score, [25, 50, 75]);
    // High-intensity floor: a cloudburst can't read below these regardless of terrain.
    if (Imax >= 60) lvl = '極高';
    else if (Imax >= 30 && sevOf(lvl) < 2) lvl = '高';
    rows.push(mk('溪水暴漲風險', '', lvl));
  }

  // 6. Debris-flow susceptibility (Caine I–D threshold, slope+saturation gated).
  if (env.rainNext24 == null || satPct == null) {
    rows.push(mk('土石流風險', '', UNAVAILABLE));
  } else {
    const Dh = Math.max(env.wetHours || 0, 1);
    const Pevent = env.wetRainSum != null ? env.wetRainSum : env.rainNext24;
    const meanI = Pevent / Dh;
    const I = Math.max(Imax != null ? Imax : 0, meanI);
    const Ithr = 14.82 * Math.pow(Dh, -0.39);                  // Caine (1980), mm/h
    const ratio = I / Ithr;
    let slopeGate = clamp01((geo.meanSlopeDeg - 10) / 20);
    if (Number.isFinite(geo.maxSlopeDeg)) slopeGate = Math.max(slopeGate, clamp01((geo.maxSlopeDeg - 20) / 20));
    const satGate = clamp01((satPct / 100 - 0.3) / 0.6);
    const DF = ratio * (0.4 + 0.6 * slopeGate) * (0.5 + 0.5 * satGate);
    let lvl = band(DF, [0.6, 1.0, 1.6]);
    // Terrain too gentle to initiate a debris flow → hard floor to 低.
    if (geo.meanSlopeDeg < 10 && (!Number.isFinite(geo.maxSlopeDeg) || geo.maxSlopeDeg < 15)) lvl = '低';
    rows.push(mk('土石流風險', '', lvl));
  }

  return rows;
}
