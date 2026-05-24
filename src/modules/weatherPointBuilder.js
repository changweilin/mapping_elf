import { haversineDistance, projectMileage } from './utils.js';
import { computeCumulativeTimes, computeHourlyPoints, interpolateTimeAtDist } from './paceEngine.js';

const MERCATOR_R = 6378137;
const MERCATOR_MAX_LAT = 85.0511287798;

function clampMercatorLat(lat) {
  return Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
}

function projectMercator(lat, lng) {
  const d = Math.PI / 180;
  const clampedLat = clampMercatorLat(lat);
  return {
    x: MERCATOR_R * lng * d,
    y: MERCATOR_R * Math.log(Math.tan((Math.PI / 4) + (clampedLat * d / 2))),
  };
}

function unprojectMercator(x, y) {
  const d = 180 / Math.PI;
  return {
    lat: (2 * Math.atan(Math.exp(y / MERCATOR_R)) - (Math.PI / 2)) * d,
    lng: x * d / MERCATOR_R,
  };
}

function geocodeKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function getNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function computeWeatherRouteMetrics(coords = [], wps = []) {
  let totalDistM = 0;
  const routeDists = coords.length ? [0] : [];
  if (coords.length > 1) {
    for (let j = 1; j < coords.length; j++) {
      totalDistM += haversineDistance(coords[j - 1], coords[j]);
      routeDists.push(totalDistM);
    }
  }

  const wpCumDist = [];
  const wpRouteIndices = [];
  if (coords.length > 1) {
    let searchStart = 0;
    for (let i = 0; i < wps.length; i++) {
      let minDist = Infinity;
      let minIdx = searchStart;
      for (let j = searchStart; j < coords.length; j++) {
        const d = haversineDistance(wps[i], coords[j]);
        if (d < minDist) { minDist = d; minIdx = j; }
        if (minDist === 0) break;
      }
      wpRouteIndices.push(minIdx);
      wpCumDist.push(routeDists[minIdx] || 0);
      searchStart = minIdx;
    }
  } else {
    wps.forEach(() => {
      wpRouteIndices.push(0);
      wpCumDist.push(0);
    });
  }

  return { routeDists, totalDistM, wpCumDist, wpRouteIndices };
}

/**
 * Compute lat/lng points spaced every intervalKm along the route.
 * Returns [{lat, lng, cumDistM}]
 */
export function computeIntermediatePoints(coords, intervalKm) {
  const intervalM = intervalKm * 1000;
  const result = [];
  let cumDist = 0;
  let nextMarkM = intervalM;
  let totalRouteM = 0;
  for (let i = 1; i < coords.length; i++) {
    totalRouteM += haversineDistance(coords[i - 1], coords[i]);
  }

  for (let i = 1; i < coords.length; i++) {
    const segDist = haversineDistance(coords[i - 1], coords[i]);
    while (nextMarkM < totalRouteM - 1e-6 && nextMarkM <= cumDist + segDist + 1e-6) {
      const frac = segDist > 0 ? (nextMarkM - cumDist) / segDist : 0;

      const p1 = projectMercator(coords[i - 1][0], coords[i - 1][1]);
      const p2 = projectMercator(coords[i][0], coords[i][1]);
      const unprojected = unprojectMercator(
        p1.x + frac * (p2.x - p1.x),
        p1.y + frac * (p2.y - p1.y),
      );

      result.push({
        lat: unprojected.lat,
        lng: unprojected.lng,
        cumDistM: nextMarkM,
      });
      nextMarkM += intervalM;
    }
    cumDist += segDist;
  }
  return result;
}

export function interpolateRoutePointAtCum(coords, dists, cumDistM) {
  if (!coords.length) return null;
  if (cumDistM <= 0) return { lat: coords[0][0], lng: coords[0][1] };
  const lastIdx = coords.length - 1;
  const total = dists[lastIdx] || 0;
  if (cumDistM >= total) return { lat: coords[lastIdx][0], lng: coords[lastIdx][1] };

  for (let i = 1; i < coords.length; i++) {
    if (dists[i] >= cumDistM) {
      const span = dists[i] - dists[i - 1];
      const frac = span > 0 ? (cumDistM - dists[i - 1]) / span : 0;
      const p1 = projectMercator(coords[i - 1][0], coords[i - 1][1]);
      const p2 = projectMercator(coords[i][0], coords[i][1]);
      const unprojected = unprojectMercator(
        p1.x + frac * (p2.x - p1.x),
        p1.y + frac * (p2.y - p1.y),
      );
      return { lat: unprojected.lat, lng: unprojected.lng };
    }
  }
  return { lat: coords[lastIdx][0], lng: coords[lastIdx][1] };
}

export function computeIntermediatePointsBySegments(coords, dists, anchorDists, intervalKm) {
  const intervalM = intervalKm * 1000;
  const result = [];
  for (let i = 0; i < anchorDists.length - 1; i++) {
    const start = anchorDists[i];
    const end = anchorDists[i + 1];
    if (end - start <= intervalM * 0.05) continue;
    for (let mark = start + intervalM; mark < end - 1e-6; mark += intervalM) {
      const pt = interpolateRoutePointAtCum(coords, dists, mark);
      if (pt) result.push({ ...pt, cumDistM: mark });
    }
  }
  return result;
}

export function buildSegmentSamples(coords, dists, startCum, endCum, getEleAt) {
  const samples = [];
  const addSample = (cum) => {
    const pt = interpolateRoutePointAtCum(coords, dists, cum);
    if (!pt) return;
    const prev = samples[samples.length - 1];
    if (prev && Math.abs(prev.cum - cum) < 1e-6) return;
    samples.push({ lat: pt.lat, lng: pt.lng, cum, ele: getEleAt(cum) ?? 0 });
  };

  addSample(startCum);
  for (let i = 1; i < coords.length - 1; i++) {
    if (dists[i] > startCum + 1e-6 && dists[i] < endCum - 1e-6) {
      samples.push({ lat: coords[i][0], lng: coords[i][1], cum: dists[i], ele: getEleAt(dists[i]) ?? 0 });
    }
  }
  addSample(endCum);

  const segDists = samples.map(s => s.cum - startCum);
  const segCoords = samples.map(s => [s.lat, s.lng]);
  const segElevs = samples.map(s => s.ele);
  return { samples, segCoords, segDists, segElevs };
}

/**
 * Deduplicate labels in-place: if two outbound items share a label the second
 * becomes "Name (2)", the third "Name (3)", etc. Return leg waypoints inherit
 * their outbound waypoint label.
 */
export function deduplicateWeatherPointLabels(pts) {
  const wpIndexToFinalLabel = {};
  const outboundCount = {};
  pts.forEach(p => {
    if (!p.isReturn) {
      outboundCount[p.label] = (outboundCount[p.label] || 0) + 1;
    }
  });

  const used = {};
  pts.forEach(p => {
    if (!p.isReturn) {
      if (outboundCount[p.label] > 1) {
        used[p.label] = (used[p.label] || 0) + 1;
        if (used[p.label] > 1) {
          p.label = `${p.label} (${used[p.label]})`;
        }
      }
      if (p.isWaypoint && p.wpIndex !== undefined) {
        wpIndexToFinalLabel[p.wpIndex] = p.label;
      }
    }
  });

  pts.forEach(p => {
    if (p.isReturn && p.isWaypoint && p.wpIndex !== undefined) {
      const mappedLabel = wpIndexToFinalLabel[p.wpIndex];
      if (mappedLabel) {
        p.label = mappedLabel;
      }
    }
  });
}

export function buildWeatherPointsFromState(options = {}) {
  const {
    waypoints = [],
    coords = [],
    routeMetrics = null,
    importedTrackMode = false,
    importedIntermediatePoints = [],
    roundTripMode = false,
    oLoopMode = false,
    speedIntervalMode = false,
    segmentIntervalKm = 0,
    perSegmentMode = false,
    elevationPoints = [],
    elevationElevations = [],
    elevationDistances = [],
    speedActivity = 'hiking',
    paceParams = {},
    getPaceComputation = (elevs, dists, activity, params) => ({
      times: computeCumulativeTimes(elevs, dists, activity, params),
    }),
    getWaypointMetadata = () => ({}),
    getWaypointLabel = (index, _lat, _lng, isReturn = false) => {
      if (isReturn) return '回程';
      if (index === 0) return '起點';
      if (index === waypoints.length - 1 && waypoints.length > 1) return '終點';
      return `航點 ${index + 1}`;
    },
    getCustomName = () => null,
    getPlaceName = () => null,
    getGeocodeKey = geocodeKey,
    interpolateElevAtCumM = () => 0,
  } = options;

  if (waypoints.length === 0) return { points: [], waypointCumDistM: [] };

  const metrics = routeMetrics || computeWeatherRouteMetrics(coords, waypoints);
  const totalDistM = metrics.totalDistM || 0;
  const routeDists = metrics.routeDists || [];
  const wpCumDist = [...(metrics.wpCumDist || [])];
  const waypointCumDistM = [...wpCumDist];

  const sampledPts = elevationPoints;
  const sampledElevs = elevationElevations;
  const sampledDists = elevationDistances;
  let cumTimes = null;
  const fullTotalDistBuild = totalDistM;
  if ((speedIntervalMode || segmentIntervalKm > 0) && sampledPts && sampledPts.length > 1 && sampledElevs.length > 1) {
    cumTimes = getPaceComputation(sampledElevs, sampledDists, speedActivity, paceParams).times;
  }

  const getWaypointAnchorDists = () => {
    const anchors = [0, ...wpCumDist, totalDistM]
      .filter(v => typeof v === 'number' && Number.isFinite(v));
    if ((roundTripMode || oLoopMode) && !importedTrackMode && waypoints.length >= 2 && totalDistM > 0) {
      if (roundTripMode) {
        for (let i = waypoints.length - 2; i >= 0; i--) anchors.push(totalDistM - wpCumDist[i]);
      } else if (oLoopMode) {
        anchors.push(totalDistM);
      }
    }
    anchors.sort((a, b) => a - b);
    return anchors.filter((v, i) => i === 0 || Math.abs(v - anchors[i - 1]) > 1e-3);
  };

  const getEleAt = (cumDistM) => {
    if (!sampledDists || !sampledDists.length || !sampledElevs || !sampledElevs.length) return null;
    const totalSampled = sampledDists[sampledDists.length - 1] || 0;
    if (totalSampled === 0 || totalDistM === 0) return sampledElevs[0] ?? null;
    const fraction = Math.max(0, Math.min(1, cumDistM / (totalDistM || 1)));
    return interpolateElevAtCumM(fraction * totalSampled);
  };

  let perSegmentPaceTimeline = null;
  const getPerSegmentPaceTimeline = () => {
    if (perSegmentPaceTimeline) return perSegmentPaceTimeline;
    const segments = [];
    let elapsedAtStart = 0;
    const anchors = getWaypointAnchorDists();
    for (let i = 0; i < anchors.length - 1; i++) {
      const startCum = anchors[i];
      const endCum = anchors[i + 1];
      if (endCum - startCum <= 1e-3) continue;
      const seg = buildSegmentSamples(coords, routeDists, startCum, endCum, getEleAt);
      if (seg.segDists.length < 2) continue;
      const times = computeCumulativeTimes(seg.segElevs, seg.segDists, speedActivity, paceParams);
      const totalH = times[times.length - 1] || 0;
      segments.push({ startCum, endCum, startElapsedH: elapsedAtStart, totalH, times, dists: seg.segDists });
      elapsedAtStart += totalH;
    }
    perSegmentPaceTimeline = { anchors, segments, totalH: elapsedAtStart };
    return perSegmentPaceTimeline;
  };

  /** Get elapsed hours for a given cumDistM (full-route metres). */
  const getElapsedH = (cumDistM) => {
    if (perSegmentMode && (speedIntervalMode || segmentIntervalKm > 0) && coords.length > 1 && routeDists.length > 1) {
      const timeline = getPerSegmentPaceTimeline();
      for (const seg of timeline.segments) {
        if (cumDistM >= seg.startCum - 1e-3 && cumDistM <= seg.endCum + 1e-3) {
          const localDist = Math.max(0, Math.min(seg.endCum - seg.startCum, cumDistM - seg.startCum));
          return seg.startElapsedH + interpolateTimeAtDist(localDist, seg.dists, seg.times);
        }
      }
      return timeline.totalH || 0;
    }
    if (!cumTimes || !sampledDists.length || fullTotalDistBuild === 0) return 0;
    const fraction = Math.max(0, Math.min(1, cumDistM / (totalDistM || 1)));
    const mappedDist = fraction * (sampledDists[sampledDists.length - 1] || 0);
    return interpolateTimeAtDist(mappedDist, sampledDists, cumTimes);
  };

  const all = [];

  if (importedTrackMode && coords.length > 1) {
    let projectCursor = 0;
    const projectCum = (lat, lng) => {
      const snap = projectMileage(coords, [lat, lng], projectCursor);
      projectCursor = snap.mileage;
      return snap.mileage;
    };

    const markers = [];
    waypoints.forEach((wp, i) => {
      const meta = getWaypointMetadata(i) || {};
      markers.push({
        lat: wp[0], lng: wp[1], isWaypoint: true, wpIndex: i,
        waypointId: meta.waypointId,
        fileOrder: meta.fileOrder ?? (i * 1000),
        ele: meta.ele ?? null,
        cumDistM: meta.cumDistM ?? null,
        label: meta.label ?? null,
      });
    });
    importedIntermediatePoints.forEach((p, i) => {
      markers.push({
        ...p, isWaypoint: false,
        fileOrder: p.fileOrder ?? (i * 1000 + 500),
      });
    });

    const allHaveCum = markers.length > 0 && markers.every(
      m => typeof m.cumDistM === 'number' && Number.isFinite(m.cumDistM),
    );
    if (allHaveCum) {
      markers.sort((a, b) => a.cumDistM - b.cumDistM);
    } else {
      markers.sort((a, b) => a.fileOrder - b.fileOrder);
    }

    markers.forEach(m => {
      const cum = getNumberOrNull(m.cumDistM) ?? projectCum(m.lat, m.lng);

      if (m.isWaypoint) {
        wpCumDist[m.wpIndex] = cum;
        waypointCumDistM[m.wpIndex] = cum;
        const customName = getCustomName(m.lat, m.lng, getGeocodeKey(m.lat, m.lng));
        const geocodedName = getPlaceName(m.lat, m.lng, getGeocodeKey(m.lat, m.lng));
        const isRet = false;
        const label = customName || m.label || geocodedName || getWaypointLabel(m.wpIndex, m.lat, m.lng, isRet);
        all.push({
          label, lat: m.lat, lng: m.lng, isWaypoint: true, wpIndex: m.wpIndex,
          waypointId: m.waypointId,
          isReturn: isRet,
          _cum: cum, _elapsedH: getElapsedH(cum),
          _ele: m.ele != null ? m.ele : getEleAt(cum),
        });
      } else {
        all.push({
          label: m.label || '—',
          lat: m.lat, lng: m.lng, isWaypoint: false,
          isReturn: false,
          _cum: cum, _elapsedH: getElapsedH(cum),
          _ele: m.ele != null ? m.ele : getEleAt(cum),
          weather: m.weather,
          windyUrl: m.windyUrl,
          _preserveLabel: !!m.label,
        });
      }
    });
  } else {
    for (let i = 0; i < waypoints.length; i++) {
      const lat = waypoints[i][0], lng = waypoints[i][1];
      const label = getWaypointLabel(i, lat, lng, false);
      all.push({
        label, lat, lng, isWaypoint: true, wpIndex: i,
        waypointId: getWaypointMetadata(i)?.waypointId,
        isReturn: false,
        _cum: wpCumDist[i], _elapsedH: getElapsedH(wpCumDist[i]),
        _ele: getEleAt(wpCumDist[i]),
      });
    }
  }

  const hasImportedIntersects = importedTrackMode && importedIntermediatePoints.length > 0 && coords.length > 1;

  if (hasImportedIntersects) {
    // Imported intermediates were already merged in the unified sequential pass above.
  } else if (coords.length > 1) {
    const integratedCoords = [...coords];

    if (speedIntervalMode) {
      const integratedDists = [0];
      for (let j = 1; j < integratedCoords.length; j++) {
        integratedDists.push(integratedDists[j - 1] + haversineDistance(integratedCoords[j - 1], integratedCoords[j]));
      }
      const integratedElevs = integratedCoords.map((_, i) => getEleAt(integratedDists[i]));

      if (!perSegmentMode) {
        const hourlyPts = computeHourlyPoints(integratedCoords, integratedElevs, integratedDists, speedActivity, 1.0, paceParams);
        hourlyPts.forEach((pt) => {
          const hLabel = Number.isInteger(pt.estTimeH) ? `第 ${pt.estTimeH} 小時` : `${pt.estTimeH.toFixed(1)} 小時`;
          all.push({
            label: hLabel, lat: pt.lat, lng: pt.lng, isWaypoint: false,
            isReturn: pt.cumDistM > (wpCumDist[waypoints.length - 1] + 1e-3),
            _cum: pt.cumDistM, _elapsedH: pt.estTimeH,
            _ele: pt._ele ?? getEleAt(pt.cumDistM),
          });
        });
      } else {
        const timeline = getPerSegmentPaceTimeline();
        timeline.segments.forEach(seg => {
          let nextH = 1.0;
          while (nextH < seg.totalH - 0.05) {
            for (let j = 1; j < seg.times.length; j++) {
              if (seg.times[j] >= nextH) {
                const span = seg.times[j] - seg.times[j - 1];
                const f = span > 0 ? (nextH - seg.times[j - 1]) / span : 0;
                const localDist = seg.dists[j - 1] + f * (seg.dists[j] - seg.dists[j - 1]);
                const cumDistM = seg.startCum + localDist;
                const pt = interpolateRoutePointAtCum(integratedCoords, integratedDists, cumDistM);
                if (pt) {
                  all.push({
                    label: `${nextH} h`, lat: pt.lat, lng: pt.lng, isWaypoint: false,
                    isReturn: cumDistM > (wpCumDist[waypoints.length - 1] + 1e-3),
                    _cum: cumDistM, _elapsedH: seg.startElapsedH + nextH,
                    _ele: getEleAt(cumDistM),
                  });
                }
                break;
              }
            }
            nextH += 1.0;
          }
        });
      }
    } else if (segmentIntervalKm > 0) {
      const integratedDists = [0];
      for (let j = 1; j < integratedCoords.length; j++) {
        integratedDists.push(integratedDists[j - 1] + haversineDistance(integratedCoords[j - 1], integratedCoords[j]));
      }
      const intermediates = perSegmentMode
        ? computeIntermediatePointsBySegments(integratedCoords, integratedDists, getWaypointAnchorDists(), segmentIntervalKm)
        : computeIntermediatePoints(integratedCoords, segmentIntervalKm);
      intermediates.forEach((pt) => {
        const kmLabel = (pt.cumDistM / 1000 % 1 === 0)
          ? `${pt.cumDistM / 1000 | 0} km`
          : `${(pt.cumDistM / 1000).toFixed(1)} km`;
        all.push({
          label: kmLabel, lat: pt.lat, lng: pt.lng, isWaypoint: false,
          isReturn: pt.cumDistM > (wpCumDist[waypoints.length - 1] + 1e-3),
          _cum: pt.cumDistM, _elapsedH: getElapsedH(pt.cumDistM),
          _ele: getEleAt(pt.cumDistM),
        });
      });
    } else {
      const wpIndices = [];
      let searchStart = 0;
      for (let i = 0; i < waypoints.length; i++) {
        let minDist = Infinity, minIdx = searchStart;
        for (let j = searchStart; j < coords.length; j++) {
          const d = haversineDistance(waypoints[i], coords[j]);
          if (d < minDist) { minDist = d; minIdx = j; }
          if (minDist === 0) break;
        }
        wpIndices.push(minIdx);
        searchStart = minIdx;
      }
      for (let i = 0; i < waypoints.length - 1; i++) {
        const si = wpIndices[i];
        const ei = wpIndices[i + 1] ?? coords.length - 1;
        const mc = coords[Math.max(0, Math.min(Math.floor((si + ei) / 2), coords.length - 1))];
        const labelA = i === 0 ? '起點' : `航點 ${i + 1}`;
        const labelB = (i + 1 === waypoints.length - 1) ? '終點' : `航點 ${i + 2}`;
        const midCum = (wpCumDist[i] + wpCumDist[i + 1]) / 2;
        all.push({
          label: `${labelA}→${labelB}`, lat: mc[0], lng: mc[1], isWaypoint: false,
          _cum: midCum, _elapsedH: getElapsedH(midCum),
          _ele: getEleAt(midCum),
        });

        if ((roundTripMode || oLoopMode) && !importedTrackMode) {
          const returnCumMid = totalDistM - midCum;
          all.push({
            label: `${labelA}→${labelB}`,
            lat: mc[0], lng: mc[1],
            isWaypoint: false,
            isReturn: true,
            _cum: returnCumMid,
            _elapsedH: getElapsedH(returnCumMid),
            _ele: getEleAt(returnCumMid),
          });
        }
      }
    }
  }

  if ((roundTripMode || oLoopMode) && !importedTrackMode && waypoints.length >= 2 && totalDistM > 0 && wpCumDist.length === waypoints.length) {
    if (roundTripMode) {
      for (let i = waypoints.length - 2; i >= 0; i--) {
        const lat = waypoints[i][0], lng = waypoints[i][1];
        const effectivePlaceName = getCustomName(lat, lng, getGeocodeKey(lat, lng)) || getPlaceName(lat, lng, getGeocodeKey(lat, lng));
        const outLabel = effectivePlaceName || (i === 0 ? '起點' : `航點 ${i + 1}`);
        const returnCum = totalDistM - wpCumDist[i];
        all.push({
          label: outLabel, lat, lng, isWaypoint: true, isReturn: true, wpIndex: i,
          waypointId: getWaypointMetadata(i)?.waypointId,
          _cum: returnCum, _elapsedH: getElapsedH(returnCum), _ele: getEleAt(returnCum),
        });
      }
    } else if (oLoopMode) {
      const i = 0;
      const lat = waypoints[i][0], lng = waypoints[i][1];
      const effectivePlaceName = getCustomName(lat, lng, getGeocodeKey(lat, lng)) || getPlaceName(lat, lng, getGeocodeKey(lat, lng));
      const returnCum = totalDistM;
      all.push({
        label: effectivePlaceName || '起點', lat, lng, isWaypoint: true, isReturn: true, wpIndex: i,
        _cum: returnCum, _elapsedH: getElapsedH(returnCum), _ele: getEleAt(returnCum),
      });
    }
  }

  all.sort((a, b) => {
    if (Math.abs(a._cum - b._cum) < 1e-3) {
      if (a.isWaypoint && !b.isWaypoint) return -1;
      if (!a.isWaypoint && b.isWaypoint) return 1;
      return 0;
    }
    return a._cum - b._cum;
  });

  {
    const fmtT = (h) => {
      if (h <= 0) return '0';
      const v = Math.round(h * 10) / 10;
      return v % 1 === 0 ? String(v | 0) : v.toFixed(1);
    };
    let prevWpIdx = 0;
    let prevWpElapsedH = 0;
    all.forEach(pt => {
      if (pt.isWaypoint) {
        prevWpIdx = pt.wpIndex ?? 0;
        prevWpElapsedH = pt._elapsedH || 0;
      } else if (!pt._preserveLabel) {
        const displayH = perSegmentMode
          ? (pt._elapsedH || 0) - prevWpElapsedH
          : (pt._elapsedH || 0);
        const n = prevWpIdx;
        const prefix = pt.isReturn ? `r${n}` : `${n + 1}`;
        pt.label = `${prefix}-${fmtT(displayH)}`;
      }
    });
  }

  deduplicateWeatherPointLabels(all);

  return { points: all, waypointCumDistM };
}
