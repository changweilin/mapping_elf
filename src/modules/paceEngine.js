/**
 * Mapping Elf — Pace Engine
 * Estimates travel time with elevation penalty, load model, and fatigue/recovery.
 * Inspired by ascent_descent.py.
 */

export const ACTIVITY_PROFILES = {
  walking:     { name: '步行',   speedKmH: 3.5, ascentMH: 400,  descentMH: 700,  fatigue: false },
  hiking:      { name: '健行',   speedKmH: 4.0, ascentMH: 450,  descentMH: 600,  fatigue: true  },
  'trail-run': { name: '越野跑', speedKmH: 8.0, ascentMH: 800,  descentMH: 1200, fatigue: true  },
  cycling:     { name: '自行車', speedKmH: 15,  ascentMH: 1200, descentMH: 0,    fatigue: false },
  driving:     { name: '駕車',   speedKmH: 40,  ascentMH: 0,    descentMH: 0,    fatigue: false },
};

export const DEFAULT_PACE_PARAMS = {
  flatPaceKmH:  null,   // null = use activity default (adjusted by load)
  bodyWeightKg: 70,
  packWeightKg: 0,
  fatigue:      true,   // enable fatigue + rest model
  restEveryH:   1.0,    // rest every N moving-hours
  restMinutes:  10,     // minutes per rest break
};

export function formatDuration(hours) {
  if (!hours || hours <= 0) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} 分`;
  if (m === 0) return `${h} 小時`;
  return `${h} 小時 ${m} 分`;
}

/**
 * Return the default flat speed for an activity given body/pack weight.
 * Useful for showing placeholder text in the UI.
 */
export function defaultSpeed(activity, bodyWeightKg = 70, packWeightKg = 0) {
  const prof = ACTIVITY_PROFILES[activity] || ACTIVITY_PROFILES.hiking;
  const loadRatio   = packWeightKg / Math.max(1, bodyWeightKg);
  const loadPenalty = Math.max(0.5, 1.0 - loadRatio * 1.1);
  return +(prof.speedKmH * loadPenalty).toFixed(2);
}

/**
 * Compute cumulative ELAPSED time (hours) at each sampled point.
 *
 * Model:
 *  - Flat speed: flatPaceKmH (user input) or activity default scaled by load penalty
 *  - Ascent/descent rate: activity default scaled by load penalty
 *  - Load penalty (ascent_descent.py): loadPenalty = max(0.5, 1 − packKg/bodyKg × 1.1)
 *  - Fatigue: after 2 h of effective moving time, efficiency = exp(−0.06 × (t−2)), floor 0.6
 *  - Rest breaks every restEveryH moving-hours (if fatigue enabled):
 *      • Adds restMinutes to elapsed time
 *      • Partial recovery: each rest minute cancels 3 min of fatigue (reduces fatH by restMin/20)
 *
 * @param {number[]} elevations  elevation (m) at each sample
 * @param {number[]} distances   cumulative distance (m) at each sample
 * @param {string}   activity    key in ACTIVITY_PROFILES
 * @param {object}   params      pace parameters (see DEFAULT_PACE_PARAMS)
 * @returns {number[]}           cumulative elapsed hours at each sample
 */
export function computeCumulativeTimes(elevations, distances, activity, params = {}) {
  const prof = ACTIVITY_PROFILES[activity] || ACTIVITY_PROFILES.hiking;
  const {
    flatPaceKmH  = null,
    bodyWeightKg = 70,
    packWeightKg = 0,
    fatigue      = prof.fatigue,
    restEveryH   = 1.0,
    restMinutes  = 10,
  } = { ...DEFAULT_PACE_PARAMS, ...params };

  // Load penalty: heavier pack relative to body weight slows ascent/descent rates
  const loadRatio   = packWeightKg / Math.max(1, bodyWeightKg);
  const loadPenalty = Math.max(0.5, 1.0 - loadRatio * 1.1);

  // Effective rates
  const baseSpeed  = flatPaceKmH != null
    ? Math.max(0.1, flatPaceKmH)
    : prof.speedKmH * loadPenalty;
  const ascentRate  = Math.max(1, prof.ascentMH  * loadPenalty);
  const descentRate = Math.max(1, prof.descentMH * loadPenalty);

  const restH = restMinutes / 60;
  // fatH: effective moving-time for fatigue decay, partially reset on rest
  let movingH   = 0;   // total moving time (triggers rest intervals)
  let fatH      = 0;   // effective hours driving fatigue (resets on rest)
  let elapsedH  = 0;   // total elapsed (moving + rests)
  let nextRestH = (fatigue && restEveryH > 0) ? restEveryH : Infinity;

  const times = [0];

  for (let i = 1; i < elevations.length; i++) {
    const distKm = (distances[i] - distances[i - 1]) / 1000;
    const dElev  = (elevations[i] ?? 0) - (elevations[i - 1] ?? 0);
    const ascM   = Math.max(0, dElev);
    const descM  = Math.max(0, -dElev);

    // Current fatigue multiplier
    let fm = 1.0;
    if (fatigue && fatH > 2.0) {
      fm = Math.max(0.6, Math.exp(-0.06 * (fatH - 2.0)));
    }

    // Segment moving time (with current fatigue)
    let segH = distKm / Math.max(0.01, baseSpeed * fm);
    if (prof.ascentMH  > 0) segH += ascM  / Math.max(1, ascentRate  * fm);
    if (prof.descentMH > 0) segH += descM / Math.max(1, descentRate * fm);

    // Process rest breaks that fall within this segment
    let rem = segH;
    while (fatigue && restEveryH > 0 && movingH + rem >= nextRestH) {
      const toRest = nextRestH - movingH;
      movingH  += toRest;
      elapsedH += toRest;
      fatH     += toRest;
      rem      -= toRest;

      // Rest: add elapsed time, partial fatigue recovery
      elapsedH  += restH;
      fatH       = Math.max(0, fatH - restMinutes / 20.0); // 1 min rest ≈ 3 min fatigue recovery
      nextRestH += restEveryH;

      // Re-compute fm for the remaining segment after rest
      fm = 1.0;
      if (fatigue && fatH > 2.0) {
        fm = Math.max(0.6, Math.exp(-0.06 * (fatH - 2.0)));
      }
    }

    movingH  += rem;
    elapsedH += rem;
    fatH     += rem;
    times.push(elapsedH);
  }
  return times;
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
 * Compute intermediate waypoints at every intervalH hours of elapsed travel time.
 *
 * @param {Array}    sampledCoords [[lat,lng], …]
 * @param {number[]} elevations
 * @param {number[]} distances     cumulative (m)
 * @param {string}   activity
 * @param {number}   intervalH     hours between points (default 1)
 * @param {object}   params        pace parameters
 * @returns {Array<{lat, lng, cumDistM, estTimeH}>}
 */
export function computeHourlyPoints(sampledCoords, elevations, distances, activity, intervalH = 1.0, params = {}) {
  const times  = computeCumulativeTimes(elevations, distances, activity, params);
  const totalH = times[times.length - 1] ?? 0;
  const result = [];

  let nextH = intervalH;
  while (nextH < totalH - intervalH * 0.05) {
    for (let i = 1; i < times.length; i++) {
      if (times[i] >= nextH) {
        const span = times[i] - times[i - 1];
        const f = span > 0 ? (nextH - times[i - 1]) / span : 0;
        result.push({
          lat:      sampledCoords[i - 1][0] + f * (sampledCoords[i][0] - sampledCoords[i - 1][0]),
          lng:      sampledCoords[i - 1][1] + f * (sampledCoords[i][1] - sampledCoords[i - 1][1]),
          cumDistM: distances[i - 1] + f * (distances[i] - distances[i - 1]),
          estTimeH: nextH,
        });
        break;
      }
    }
    nextH += intervalH;
  }
  return result;
}
