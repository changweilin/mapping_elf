/**
 * Mapping Elf Pace Engine
 *
 * Conservative, explainable estimator for hiking-first route planning.
 * The same segment model feeds elapsed time, rest/fatigue, and kcal stats.
 */
import L from 'leaflet';

export const ACTIVITY_PROFILES = {
  walking: { name: 'walking', speedKmH: 3.5, ascentMH: 400, descentMH: 700, fatigue: false, baseMET: 3.5 },
  hiking: { name: 'hiking', speedKmH: 4.0, ascentMH: 450, descentMH: 600, fatigue: true, baseMET: 6.5 },
  'trail-run': { name: 'trail run', speedKmH: 8.0, ascentMH: 800, descentMH: 1200, fatigue: true, baseMET: 10.0 },
  running: { name: 'running', speedKmH: 10, ascentMH: 600, descentMH: 900, fatigue: true, baseMET: 11.0 },
  cycling: { name: 'cycling', speedKmH: 15, ascentMH: 1200, descentMH: 0, fatigue: false, baseMET: 8.0 },
  driving: { name: 'driving', speedKmH: 40, ascentMH: 0, descentMH: 0, fatigue: false, baseMET: 2.0 },
};

/** MET during rest breaks */
const REST_MET = 1.5;
/** Suggested carbohydrate/fuel intake per moving hour (kcal) */
const KCAL_PER_MOVING_H = 250;
const MIN_CALIBRATION_FACTOR = 0.6;
const MAX_CALIBRATION_FACTOR = 1.8;

/**
 * Fatigue presets: onset (h before fatigue kicks in), decay (exp rate),
 * floor (minimum efficiency multiplier). 'none' disables fatigue.
 */
export const FATIGUE_PRESETS = {
  none: { fatigue: false, fatigueOnset: 0, fatigueDecay: 0, fatigueFloor: 1.0 },
  casual: { fatigue: true, fatigueOnset: 1.0, fatigueDecay: 0.12, fatigueFloor: 0.50 },
  general: { fatigue: true, fatigueOnset: 2.0, fatigueDecay: 0.06, fatigueFloor: 0.60 },
  trained: { fatigue: true, fatigueOnset: 3.5, fatigueDecay: 0.03, fatigueFloor: 0.75 },
};

export const DEFAULT_PACE_PARAMS = {
  flatPaceKmH: null,       // null = use activity default (adjusted by load)
  bodyWeightKg: 70,
  packWeightKg: 0,
  fatigueLevel: 'general',
  restEveryH: 1.0,
  restMinutes: 10,
  calibrationEnabled: false,
  calibrationFactor: 1,
};

export function formatDuration(hours, language = 'zh-TW') {
  if (!hours || hours <= 0) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const parts = {
    'zh-TW': { h: '小時', m: '分', between: ' ', unitGap: ' ' },
    en: { h: 'h', m: 'min', between: ' ', unitGap: ' ' },
    ja: { h: '時間', m: '分', between: '', unitGap: '' },
    ko: { h: '시간', m: '분', between: ' ', unitGap: '' },
    fr: { h: 'h', m: 'min', between: ' ', unitGap: ' ' },
    de: { h: 'Std.', m: 'Min.', between: ' ', unitGap: ' ' },
    es: { h: 'h', m: 'min', between: ' ', unitGap: ' ' },
    it: { h: 'h', m: 'min', between: ' ', unitGap: ' ' },
  }[language] || { h: 'h', m: 'min', between: ' ', unitGap: ' ' };
  const hourText = `${h}${parts.unitGap}${parts.h}`;
  const minuteText = `${m}${parts.unitGap}${parts.m}`;
  if (h === 0) return minuteText;
  if (m === 0) return hourText;
  return `${hourText}${parts.between}${minuteText}`;
}

export function formatDurationHHMM(hours) {
  if (!hours || hours <= 0) return '00:00';
  const totalMinutes = Math.round(hours * 60);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return d > 0 ? `${d}d ${hhmm}` : hhmm;
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function resolveModel(activity, params = {}) {
  const prof = ACTIVITY_PROFILES[activity] || ACTIVITY_PROFILES.hiking;
  const merged = { ...DEFAULT_PACE_PARAMS, ...params };
  const bodyWeightKg = Math.max(1, Number(merged.bodyWeightKg) || 70);
  const packWeightKg = Math.max(0, Number(merged.packWeightKg) || 0);
  const loadRatio = packWeightKg / bodyWeightKg;
  const speedLoadFactor = clamp(1 - loadRatio * 0.75, 0.55, 1.05);
  const energyLoadFactor = clamp(1 + loadRatio * 0.35, 1, 1.35);
  const baseSpeed = merged.flatPaceKmH != null
    ? Math.max(0.1, Number(merged.flatPaceKmH) || 0.1)
    : prof.speedKmH * speedLoadFactor;

  const preset = FATIGUE_PRESETS[merged.fatigueLevel] ?? FATIGUE_PRESETS.general;
  const fatigue = prof.fatigue ? preset.fatigue : false;
  const calibrationFactor = merged.calibrationEnabled
    ? clamp(Number(merged.calibrationFactor) || 1, MIN_CALIBRATION_FACTOR, MAX_CALIBRATION_FACTOR)
    : 1;

  return {
    prof,
    merged,
    bodyWeightKg,
    packWeightKg,
    loadRatio,
    speedLoadFactor,
    energyLoadFactor,
    baseSpeed,
    ascentRate: Math.max(1, prof.ascentMH * speedLoadFactor),
    descentRate: Math.max(1, prof.descentMH * speedLoadFactor),
    fatigue,
    fatigueOnset: preset.fatigueOnset,
    fatigueDecay: preset.fatigueDecay,
    fatigueFloor: preset.fatigueFloor,
    restEveryH: Math.max(0, Number(merged.restEveryH) || 0),
    restMinutes: Math.max(0, Number(merged.restMinutes) || 0),
    calibrationFactor,
  };
}

/**
 * Return the default flat speed for an activity given body/pack weight.
 * Useful for showing placeholder text in the UI.
 */
export function defaultSpeed(activity, bodyWeightKg = 70, packWeightKg = 0) {
  const model = resolveModel(activity, { bodyWeightKg, packWeightKg, calibrationEnabled: false });
  return +model.baseSpeed.toFixed(2);
}

function downhillAdjustmentH(horizontalH, descM, distM, prof) {
  if (descM <= 0 || distM <= 0 || prof.descentMH <= 0) return 0;
  const grade = descM / Math.max(1, distM);
  if (grade <= 0.06) {
    return -horizontalH * Math.min(0.12, grade * 1.6);
  }
  return horizontalH * Math.min(0.65, (grade - 0.06) * 3.0);
}

function estimateBaseSegment(distKm, ascM, descM, model) {
  const distM = distKm * 1000;
  const horizontalH = distKm / Math.max(0.01, model.baseSpeed);
  const ascentH = model.prof.ascentMH > 0 ? ascM / model.ascentRate : 0;
  const descAdjH = downhillAdjustmentH(horizontalH, descM, distM, model.prof);
  return Math.max(0, horizontalH + ascentH + descAdjH);
}

function estimateSegmentMET(distKm, ascM, descM, movingH, activity, model) {
  if (!movingH || movingH <= 0) return 0;
  const distM = distKm * 1000;
  const speedKmh = distKm / Math.max(0.001, movingH);
  const speedMMin = speedKmh * 1000 / 60;
  const grade = distM > 0 ? (ascM - descM) / distM : 0;
  const absGrade = Math.abs(grade);

  let met;
  if (speedKmh <= 9 && absGrade <= 0.35 && ['walking', 'hiking'].includes(activity)) {
    const uphillGrade = Math.max(0, grade);
    const downhillPenalty = grade < -0.08 ? speedMMin * Math.min(0.22, Math.abs(grade) - 0.08) * 0.6 : 0;
    const vo2 = 3.5 + 0.1 * speedMMin + 1.8 * speedMMin * uphillGrade + downhillPenalty;
    met = vo2 / 3.5;
    met = Math.max(met, activity === 'hiking' ? 5.0 : 2.5);
  } else if (speedKmh <= 18 && absGrade <= 0.25 && ['running', 'trail-run'].includes(activity)) {
    const vo2 = 3.5 + 0.2 * speedMMin + 0.9 * speedMMin * Math.max(0, grade);
    met = Math.max(model.prof.baseMET * 0.8, vo2 / 3.5);
  } else {
    met = model.prof.baseMET;
    if (grade > 0.04) met += Math.min(4, grade * 18);
    if (grade < -0.10) met += Math.min(2, Math.abs(grade) * 8);
  }

  return clamp(met * model.energyLoadFactor, 1.5, 18);
}

function fatigueMultiplier(model, fatH) {
  if (!model.fatigue || fatH <= model.fatigueOnset) return 1.0;
  return Math.max(model.fatigueFloor, Math.exp(-model.fatigueDecay * (fatH - model.fatigueOnset)));
}

function pushMovingChunk(ctx, rawMovingH, meta) {
  if (rawMovingH <= 0) return;
  const fm = fatigueMultiplier(ctx.model, ctx.fatH);
  const movingH = rawMovingH / Math.max(0.01, fm);
  const met = estimateSegmentMET(meta.distKm, meta.ascM, meta.descM, movingH, ctx.activity, ctx.model);
  const kcal = met * ctx.model.bodyWeightKg * movingH;

  ctx.movingH += movingH;
  ctx.elapsedH += movingH;
  ctx.fatH += movingH;
  ctx.kcalMoving += kcal;
  ctx.segments.push({
    index: meta.index,
    distKm: meta.distKm,
    ascM: meta.ascM,
    descM: meta.descM,
    movingH,
    restH: 0,
    elapsedH: movingH,
    met,
    kcal,
    fatigueMultiplier: fm,
  });
}

function pushRestChunk(ctx, restH) {
  if (restH <= 0) return;
  ctx.elapsedH += restH;
  ctx.kcalRest += REST_MET * ctx.model.bodyWeightKg * restH;
  ctx.fatH = Math.max(0, ctx.fatH - restH * 3);
  ctx.segments.push({
    index: null,
    distKm: 0,
    ascM: 0,
    descM: 0,
    movingH: 0,
    restH,
    elapsedH: restH,
    met: REST_MET,
    kcal: REST_MET * ctx.model.bodyWeightKg * restH,
    fatigueMultiplier: 1,
  });
}

function applyCalibration(result, factor) {
  if (factor === 1) return result;
  result.times = result.times.map(t => t * factor);
  result.totalH *= factor;
  result.movingH *= factor;
  result.restH *= factor;
  result.kcalMoving *= factor;
  result.kcalRest *= factor;
  result.segments = result.segments.map(seg => ({
    ...seg,
    movingH: seg.movingH * factor,
    restH: seg.restH * factor,
    elapsedH: seg.elapsedH * factor,
    kcal: seg.kcal * factor,
  }));
  return result;
}

/**
 * Compute reusable segment-level pace, rest, fatigue, and energy details.
 *
 * @returns {{
 *   times:number[], segments:Array, totalH:number, movingH:number, restH:number,
 *   kcalMoving:number, kcalRest:number, calibrationFactor:number, finalState:object
 * }}
 */
export function computePaceSegments(elevations, distances, activity, params = {}, state = null) {
  const elevs = Array.isArray(elevations) ? elevations : [];
  const dists = Array.isArray(distances) ? distances : [];
  if (elevs.length < 2 || dists.length < 2) {
    return {
      times: [0],
      segments: [],
      totalH: 0,
      movingH: 0,
      restH: 0,
      kcalMoving: 0,
      kcalRest: 0,
      calibrationFactor: 1,
      finalState: { movingH: state?.movingH ?? 0, fatH: state?.fatH ?? 0, nextRestH: state?.nextRestH ?? Infinity },
    };
  }

  const model = resolveModel(activity, params);
  const restH = model.restMinutes / 60;
  const ctx = {
    activity,
    model,
    segments: [],
    movingH: state?.movingH ?? 0,
    fatH: state?.fatH ?? 0,
    elapsedH: 0,
    kcalMoving: 0,
    kcalRest: 0,
    nextRestH: state?.nextRestH ?? ((model.fatigue && model.restEveryH > 0) ? (state?.movingH ?? 0) + model.restEveryH : Infinity),
  };
  const startMovingH = ctx.movingH;
  const times = [0];

  for (let i = 1; i < Math.min(elevs.length, dists.length); i++) {
    const distKm = Math.max(0, (dists[i] - dists[i - 1]) / 1000);
    const dElev = (elevs[i] ?? 0) - (elevs[i - 1] ?? 0);
    const ascM = Math.max(0, dElev);
    const descM = Math.max(0, -dElev);
    let rawRemH = estimateBaseSegment(distKm, ascM, descM, model);
    const meta = { index: i, distKm, ascM, descM };

    while (model.fatigue && model.restEveryH > 0 && rawRemH > 0) {
      const fm = fatigueMultiplier(model, ctx.fatH);
      const movingRemH = rawRemH / Math.max(0.01, fm);
      const toRestMovingH = ctx.nextRestH - ctx.movingH;
      if (toRestMovingH > 0 && movingRemH >= toRestMovingH) {
        const rawToRestH = toRestMovingH * Math.max(0.01, fm);
        pushMovingChunk(ctx, rawToRestH, meta);
        rawRemH -= rawToRestH;
        pushRestChunk(ctx, restH);
        ctx.nextRestH += model.restEveryH;
      } else {
        break;
      }
    }

    pushMovingChunk(ctx, rawRemH, meta);
    times.push(ctx.elapsedH);
  }

  const result = {
    times,
    segments: ctx.segments,
    totalH: ctx.elapsedH,
    movingH: ctx.movingH - startMovingH,
    restH: ctx.elapsedH - (ctx.movingH - startMovingH),
    kcalMoving: ctx.kcalMoving,
    kcalRest: ctx.kcalRest,
    calibrationFactor: model.calibrationFactor,
    finalState: { movingH: ctx.movingH, fatH: ctx.fatH, nextRestH: ctx.nextRestH },
  };
  return applyCalibration(result, model.calibrationFactor);
}

/**
 * Compute cumulative elapsed time (hours) at each sampled point.
 */
export function computeCumulativeTimes(elevations, distances, activity, params = {}) {
  return computePaceSegments(elevations, distances, activity, params).times;
}

/**
 * Linearly interpolate cumulative time at an arbitrary cumulative distance.
 */
export function interpolateTimeAtDist(cumDistM, distances, cumulativeTimes) {
  if (!distances.length || !cumulativeTimes.length) return 0;
  if (cumDistM <= distances[0]) return 0;
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] >= cumDistM) {
      const span = distances[i] - distances[i - 1];
      const f = span > 0 ? (cumDistM - distances[i - 1]) / span : 0;
      return cumulativeTimes[i - 1] + f * (cumulativeTimes[i] - cumulativeTimes[i - 1]);
    }
  }
  return cumulativeTimes[cumulativeTimes.length - 1] ?? 0;
}

/**
 * Compute cumulative elapsed time for one route segment, carrying fatigue state.
 */
export function computeSegmentTimesFromState(elevations, distances, activity, params = {}, state = null) {
  const res = computePaceSegments(elevations, distances, activity, params, state);
  return {
    times: res.times,
    finalState: res.finalState,
  };
}

/**
 * Apply rest/recovery at a waypoint before the next segment.
 */
export function applyWaypointRecovery(state, restH, params = {}) {
  const { restEveryH = 1.0, fatigue = true } = { ...DEFAULT_PACE_PARAMS, ...params };
  const safeRestH = Math.max(0, Number(restH) || 0);
  const newFatH = Math.max(0, (state?.fatH ?? 0) - safeRestH * 3);
  const movingH = state?.movingH ?? 0;
  return {
    movingH,
    fatH: newFatH,
    nextRestH: (fatigue && restEveryH > 0) ? movingH + restEveryH : Infinity,
  };
}

/**
 * Compute intermediate waypoints at every intervalH hours of elapsed travel time.
 */
export function computeHourlyPoints(sampledCoords, elevations, distances, activity, intervalH = 1.0, params = {}, wpTimes = null) {
  const times = computeCumulativeTimes(elevations, distances, activity, params);
  const totalH = times[times.length - 1] ?? 0;
  const result = [];

  if (wpTimes && wpTimes.length > 0) {
    for (let i = 0; i < wpTimes.length; i++) {
      const startH = wpTimes[i];
      const endH = wpTimes[i + 1] ?? totalH;
      let nextH = startH + intervalH;
      while (nextH < endH - intervalH * 0.05) {
        for (let j = 1; j < times.length; j++) {
          if (times[j] >= nextH) {
            const span = times[j] - times[j - 1];
            const f = span > 0 ? (nextH - times[j - 1]) / span : 0;
            const p1 = L.Projection.SphericalMercator.project(L.latLng(sampledCoords[j - 1][0], sampledCoords[j - 1][1]));
            const p2 = L.Projection.SphericalMercator.project(L.latLng(sampledCoords[j][0], sampledCoords[j][1]));
            const res = L.point(p1.x + f * (p2.x - p1.x), p1.y + f * (p2.y - p1.y));
            const unp = L.Projection.SphericalMercator.unproject(res);

            result.push({
              lat: unp.lat,
              lng: unp.lng,
              cumDistM: distances[j - 1] + f * (distances[j] - distances[j - 1]),
              estTimeH: nextH,
            });
            break;
          }
        }
        nextH += intervalH;
      }
    }
  } else {
    let nextH = intervalH;
    while (nextH < totalH - intervalH * 0.05) {
      for (let i = 1; i < times.length; i++) {
        if (times[i] >= nextH) {
          const span = times[i] - times[i - 1];
          const f = span > 0 ? (nextH - times[i - 1]) / span : 0;
          const p1 = L.Projection.SphericalMercator.project(L.latLng(sampledCoords[i - 1][0], sampledCoords[i - 1][1]));
          const p2 = L.Projection.SphericalMercator.project(L.latLng(sampledCoords[i][0], sampledCoords[i][1]));
          const res = L.point(p1.x + f * (p2.x - p1.x), p1.y + f * (p2.y - p1.y));
          const unp = L.Projection.SphericalMercator.unproject(res);

          result.push({
            lat: unp.lat,
            lng: unp.lng,
            cumDistM: distances[i - 1] + f * (distances[i] - distances[i - 1]),
            estTimeH: nextH,
          });
          break;
        }
      }
      nextH += intervalH;
    }
  }
  return result;
}

/**
 * Compute trip summary statistics including calorie expenditure.
 */
export function computeTripStats(elevations, distances, activity, params = {}) {
  const res = computePaceSegments(elevations, distances, activity, params);
  return {
    totalH: res.totalH,
    movingH: res.movingH,
    restH: res.restH,
    kcalExpended: Math.round(res.kcalMoving + res.kcalRest),
    kcalSuggested: Math.round(res.movingH * KCAL_PER_MOVING_H),
  };
}

function distM(a, b) {
  const R = 6371000;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cumulativeDistances(coords) {
  const dists = [0];
  for (let i = 1; i < coords.length; i++) dists.push(dists[i - 1] + distM(coords[i - 1], coords[i]));
  return dists;
}

function fillElevations(elevations) {
  const out = elevations.map(e => Number.isFinite(e) ? e : null);
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) continue;
    let nextI = i + 1;
    while (nextI < out.length && out[nextI] == null) nextI++;
    if (nextI < out.length) {
      const prev = i > 0 && out[i - 1] != null ? out[i - 1] : out[nextI];
      const next = out[nextI];
      const start = i - 1;
      for (let j = i; j < nextI; j++) {
        const f = start >= 0 ? (j - start) / (nextI - start) : 0;
        out[j] = prev + (next - prev) * f;
      }
      i = nextI - 1;
    } else {
      out[i] = i > 0 && out[i - 1] != null ? out[i - 1] : 0;
    }
  }
  return out;
}

/**
 * Summarize an imported GPX/KML track for personal calibration.
 */
export function summarizeImportedTrackForCalibration(parsedTrack, actualHours = null, activity = 'hiking', params = {}) {
  const points = Array.isArray(parsedTrack?.trackPoints) ? parsedTrack.trackPoints : [];
  if (points.length < 2) throw new Error('Track must contain at least two track points.');
  const coords = points.map(p => [p.lat, p.lon]);
  const elevations = fillElevations(points.map(p => Number.isFinite(p.ele) ? p.ele : null));
  const distances = cumulativeDistances(coords);
  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) ascentM += diff;
    else descentM += -diff;
  }
  const estimateParams = { ...params, calibrationEnabled: false, calibrationFactor: 1 };
  const stats = computeTripStats(elevations, distances, activity, estimateParams);
  return {
    distanceM: Math.round(distances[distances.length - 1] || 0),
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    estimatedH: stats.totalH,
    actualHours: actualHours != null && Number.isFinite(Number(actualHours)) ? Number(actualHours) : null,
  };
}

/**
 * Compute a total personal multiplier from calibration tracks.
 */
export function computeCalibrationFromTracks(trackSummaries) {
  const usable = (Array.isArray(trackSummaries) ? trackSummaries : [])
    .filter(t => Number(t?.actualHours) > 0 && Number(t?.estimatedH) > 0);
  const estimatedTotalH = usable.reduce((sum, t) => sum + Number(t.estimatedH), 0);
  const actualTotalH = usable.reduce((sum, t) => sum + Number(t.actualHours), 0);
  const rawFactor = estimatedTotalH > 0 ? actualTotalH / estimatedTotalH : 1;
  return {
    factor: clamp(rawFactor, MIN_CALIBRATION_FACTOR, MAX_CALIBRATION_FACTOR),
    rawFactor,
    estimatedTotalH,
    actualTotalH,
    count: usable.length,
    clipped: rawFactor !== clamp(rawFactor, MIN_CALIBRATION_FACTOR, MAX_CALIBRATION_FACTOR),
  };
}
