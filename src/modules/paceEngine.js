/**
 * Mapping Elf — Pace Engine
 * Estimates travel time along a route using elevation-aware activity profiles,
 * inspired by ascent_descent.py (fatigue model, ascent/descent penalty).
 */

export const ACTIVITY_PROFILES = {
  walking:     { name: '步行',   speedKmH: 3.5, ascentMH: 400,  descentMH: 700,  fatigue: false },
  hiking:      { name: '健行',   speedKmH: 4.0, ascentMH: 450,  descentMH: 600,  fatigue: true  },
  'trail-run': { name: '越野跑', speedKmH: 8.0, ascentMH: 800,  descentMH: 1200, fatigue: true  },
  cycling:     { name: '自行車', speedKmH: 15,  ascentMH: 1200, descentMH: 0,    fatigue: false },
  driving:     { name: '駕車',   speedKmH: 40,  ascentMH: 0,    descentMH: 0,    fatigue: false },
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
 * Compute cumulative travel time (hours) at each sampled point.
 * Fatigue model from ascent_descent.py:
 *   after 2h, multiply speed/rate by exp(-0.06 * (t-2)), floor at 0.6.
 *
 * @param {number[]} elevations  - elevation (m) at each sample
 * @param {number[]} distances   - cumulative distance (m) at each sample
 * @param {string}   activity    - key in ACTIVITY_PROFILES
 * @returns {number[]}           - cumulative hours, same length as elevations
 */
export function computeCumulativeTimes(elevations, distances, activity) {
  const prof = ACTIVITY_PROFILES[activity] || ACTIVITY_PROFILES.hiking;
  const { speedKmH, ascentMH, descentMH, fatigue } = prof;
  const times = [0];
  let totalH = 0;

  for (let i = 1; i < elevations.length; i++) {
    const distKm = (distances[i] - distances[i - 1]) / 1000;
    const dElev  = (elevations[i] ?? 0) - (elevations[i - 1] ?? 0);
    const ascM   = Math.max(0, dElev);
    const descM  = Math.max(0, -dElev);

    // Fatigue: after 2h of moving time, exponential decay, min 60% efficiency
    let fm = 1.0;
    if (fatigue && totalH > 2.0) {
      fm = Math.max(0.6, Math.exp(-0.06 * (totalH - 2.0)));
    }

    let segH = distKm / Math.max(0.01, speedKmH * fm);
    if (ascentMH > 0) segH += ascM  / Math.max(1, ascentMH  * fm);
    if (descentMH > 0) segH += descM / Math.max(1, descentMH * fm);
    // cycling: descent is free (gravity); descentMH = 0 means no penalty

    totalH += segH;
    times.push(totalH);
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
 * Compute intermediate points at every intervalH hours of estimated travel time.
 *
 * @param {Array}    sampledCoords - [[lat, lng], …]
 * @param {number[]} elevations
 * @param {number[]} distances     - cumulative distances (m)
 * @param {string}   activity
 * @param {number}   intervalH     - hours between points (default 1)
 * @returns {Array<{lat, lng, cumDistM, estTimeH}>}
 */
export function computeHourlyPoints(sampledCoords, elevations, distances, activity, intervalH = 1.0) {
  const times  = computeCumulativeTimes(elevations, distances, activity);
  const totalH = times[times.length - 1] ?? 0;
  const result = [];

  // Stop before (totalH - 5% of interval) to avoid a duplicate very close to end waypoint
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
