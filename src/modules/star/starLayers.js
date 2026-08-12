// Leaflet rendering for the star tool — the elf-side replacement for
// mapping_star's mapLayers.ts plus the App.tsx render effects.
//
// Everything draws into layer groups owned by main.js and handed in, so the
// tool never touches mapManager's own route/waypoint layers.
//
// The magic-circle animation is CSS-driven: each stroke element gets
// --magic-delay / --magic-duration custom properties and an animation-play-state,
// exactly as mapping_star did (see applyMagicStrokeTiming in magicPlayback.js).
// Re-rendering therefore has to re-apply timing from the current timeline
// position, or a paused circle silently restarts from zero.
import L from 'leaflet';
import { destinationPoint, normalizeDegrees } from './geo.js';
import { getMagicElement, makeMagicCircleStrokes } from './magicCircle.js';
import {
  MAGIC_POINT_DELAY_MS,
  MAGIC_POINT_DURATION_MS,
  MAGIC_POINT_STEP_MS,
  applyMagicMarkerTiming,
  applyMagicStrokeTiming,
  clampMagicTimelinePosition,
  getMagicTimelineDurationMs,
} from './magicPlayback.js';

export { getMagicTimelineDurationMs, clampMagicTimelinePosition };

/** Ring/sector geometry, ported from mapLayers.ts makeSectorPolygon. */
export function makeSectorPolygon(center, innerRadiusMeters, outerRadiusMeters, startDeg, endDeg) {
  const points = [];
  const span = normalizeDegrees(endDeg - startDeg) || 360;
  const steps = Math.max(8, Math.ceil(span / 6));
  const hasInner = innerRadiusMeters > 0;

  if (!hasInner) points.push([center.lat, center.lng]);
  for (let i = 0; i <= steps; i += 1) {
    const p = destinationPoint(center, outerRadiusMeters, startDeg + (span * i) / steps);
    points.push([p.lat, p.lng]);
  }
  if (hasInner) {
    for (let i = steps; i >= 0; i -= 1) {
      const p = destinationPoint(center, innerRadiusMeters, startDeg + (span * i) / steps);
      points.push([p.lat, p.lng]);
    }
  } else {
    points.push([center.lat, center.lng]);
  }
  return points;
}

export function makeStarBounds(result) {
  const bounds = L.latLngBounds([
    [result.center.lat, result.center.lng],
    ...result.points.map((p) => [p.lat, p.lng]),
  ]);
  const outerRadius = Math.max(
    result.radiusMeanMeters,
    ...result.points.map((p) => p.distanceMeters)
  );
  [0, 90, 180, 270].forEach((bearing) => {
    const edge = destinationPoint(result.center, outerRadius, bearing);
    bounds.extend([edge.lat, edge.lng]);
  });
  return bounds;
}

export function makeRadiusBounds(center, radiusMeters) {
  const bounds = L.latLngBounds([[center.lat, center.lng]]);
  [0, 90, 180, 270].forEach((bearing) => {
    const edge = destinationPoint(center, radiusMeters, bearing);
    bounds.extend([edge.lat, edge.lng]);
  });
  return bounds;
}

// POI names/labels come from OSM tags, which anyone can edit, and Leaflet
// tooltips and divIcons take HTML — escape before interpolating.
const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const makeCenterIcon = () => L.divIcon({
  className: 'star-center-pin',
  html: '<span class="star-center-pin__ring"></span><span class="star-center-pin__dot"></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/**
 * Apply a stroke's animation timing, retrying on the next frame if Leaflet has
 * not produced the layer's DOM element yet.
 *
 * applyMagicStrokeTiming() silently returns when `getElement()` is null, and a
 * stroke that misses it never gets `.magic-drawable` — it renders as a static
 * line with no draw-on animation and no play/pause control. That is exactly
 * what a whole circle looked like on a slow machine where the layers were not
 * rendered by the time the render loop reached them.
 */
function applyStrokeTimingWhenRendered(layer, stroke, speed, playback, direction, durationMs, positionMs) {
  const apply = () => {
    const hasElement = typeof layer.getElement === 'function' && layer.getElement();
    if (hasElement) {
      applyMagicStrokeTiming(layer, stroke, speed, playback, direction, durationMs, positionMs);
      return true;
    }
    return false;
  };
  if (apply()) return;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { apply(); });
  }
}

const makeMagicSymbolIcon = (stroke) => L.divIcon({
  className: 'magic-symbol-anchor',
  html: `<span class="${stroke.className}"><span class="magic-symbol__aura"></span>`
    + '<span class="magic-symbol__trail"></span><span class="magic-symbol__glyph"></span></span>',
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

/**
 * Search context: centre pin, the inner/outer radius ring and the candidate
 * POIs. Cleared and rebuilt whenever the centre, radii or POI set change.
 */
export function renderSearchContext(group, { center, innerRadiusMeters, outerRadiusMeters, pois, showRing, onPoiClick }) {
  group.clearLayers();
  if (!center) return;

  if (showRing && outerRadiusMeters > 0) {
    L.polygon(makeSectorPolygon(center, innerRadiusMeters, outerRadiusMeters, 0, 360), {
      className: 'star-ring',
      color: 'var(--accent-primary)',
      weight: 1,
      opacity: 0.55,
      fillOpacity: 0.06,
      interactive: false,
    }).addTo(group);
  }

  (pois || []).forEach((poi) => {
    const marker = L.circleMarker([poi.lat, poi.lng], {
      radius: 4,
      color: poi.categoryColor,
      weight: 1,
      opacity: 0.9,
      fillColor: poi.categoryColor,
      fillOpacity: 0.55,
      className: 'star-candidate',
    });
    marker.bindTooltip(`${esc(poi.name)}<br><small>${esc(poi.categoryLabel)}</small>`, {
      direction: 'top',
      offset: [0, -6],
    });
    if (onPoiClick) marker.on('click', () => onPoiClick(poi));
    marker.addTo(group);
  });

  L.marker([center.lat, center.lng], {
    icon: makeCenterIcon(),
    interactive: false,
    keyboard: false,
    zIndexOffset: 700,
  }).addTo(group);
}

/**
 * The magic circle itself: every stroke from makeMagicCircleStrokes plus the
 * star's vertex markers. `playback`/`direction`/`positionMs` come from main.js
 * so a re-render mid-animation resumes where it left off instead of restarting.
 *
 * Returns the timeline duration so the caller can drive its own clock.
 */
export function renderMagicCircle(group, result, {
  elementIndex = 0,
  geometryPattern = 'combined',
  geometryOptions = {},
  speed = 1,
  playback = 'playing',
  direction = 'forward',
  positionMs = 0,
  showLabels = true,
  onPointClick = null,
} = {}) {
  group.clearLayers();
  if (!result) return { durationMs: 0, positionMs: 0 };

  const element = getMagicElement(elementIndex);
  const strokes = makeMagicCircleStrokes(result, elementIndex, geometryPattern, geometryOptions);
  const durationMs = getMagicTimelineDurationMs(result, strokes);
  const clampedPositionMs = clampMagicTimelinePosition(positionMs, durationMs);

  strokes.forEach((stroke) => {
    let layer;
    if (stroke.kind === 'circle') {
      layer = L.circle([stroke.center.lat, stroke.center.lng], {
        radius: stroke.radiusMeters,
        color: stroke.color,
        weight: stroke.weight,
        opacity: stroke.opacity,
        fill: false,
        interactive: false,
        className: stroke.className,
      });
    } else if (stroke.kind === 'symbol') {
      layer = L.marker([stroke.position.lat, stroke.position.lng], {
        icon: makeMagicSymbolIcon(stroke),
        interactive: false,
        keyboard: false,
        zIndexOffset: stroke.role === 'center' ? 760 : stroke.role === 'endpoint' ? 820 : 560,
      });
    } else {
      layer = L.polyline(stroke.points.map((p) => [p.lat, p.lng]), {
        color: stroke.color,
        weight: stroke.weight,
        opacity: stroke.opacity,
        interactive: false,
        className: stroke.className,
      });
    }
    layer.addTo(group);
    applyStrokeTimingWhenRendered(layer, stroke, speed, playback, direction, durationMs, clampedPositionMs);
  });

  result.points.forEach((poi, index) => {
    const marker = L.circleMarker([poi.lat, poi.lng], {
      radius: geometryPattern === 'combined' ? 14 : 12,
      color: element.accent,
      weight: 1,
      opacity: 0.38,
      fillColor: element.pale,
      fillOpacity: geometryPattern === 'combined' ? 0.2 : 0.26,
      bubblingMouseEvents: false,
      className: `star-point star-point--appear magic-element--${element.id}`,
    });
    if (showLabels) {
      marker.bindTooltip(`${index + 1}. ${esc(poi.name)}`, {
        direction: 'bottom',
        offset: [0, 22],
        permanent: true,
        className: 'star-label star-label--below',
      });
    }
    if (onPointClick) marker.on('click', () => onPointClick(poi, index));
    marker.addTo(group);

    // Same "element may not exist yet" retry as the strokes above — a vertex
    // that misses its timing never fades in and ignores play/pause.
    const applyPointTiming = () => {
      const el = marker.getElement();
      if (!el) return false;
      el.classList.add('magic-drawable');
      applyMagicMarkerTiming(
        el,
        MAGIC_POINT_DELAY_MS + index * MAGIC_POINT_STEP_MS,
        MAGIC_POINT_DURATION_MS,
        speed, playback, direction, durationMs, clampedPositionMs
      );
      return true;
    };
    if (!applyPointTiming() && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { applyPointTiming(); });
    }
  });

  return { durationMs, positionMs: clampedPositionMs };
}
