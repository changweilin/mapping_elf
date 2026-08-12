// Star tool settings contract — the elf-side replacement for mapping_star's
// settings.ts. mapping_star stored one blob under "mapping-star:settings"; here
// the two blobs follow elf's own storage rules (mappingElf_ prefix, registered
// in stateKeys.js, default-merged on read so an old .melmap missing a field
// still loads).
//
// Everything is normalised on read: values arrive from localStorage and from
// .melmap archives written by older builds, so no field may be trusted.
import { DEFAULT_CATEGORY_IDS, POI_CATEGORIES } from './categories.js';
import { DEFAULT_MAGIC_DRAW_VARIANTS, getMagicDrawVariantOption, isMagicDrawShape } from './magicDraw.js';
import { MAGIC_ANIMATION_COUNT, MAGIC_SPEED_OPTIONS, normalizeMagicAnimationIndex } from './magicCircle.js';
import { isStarMode, maxAngleToleranceForMode } from './starPatterns.js';

export const LS_STAR_SETTINGS_KEY = 'mappingElf_starSettings';
export const LS_STAR_TOOL_KEY = 'mappingElf_starTool';

// mapping_star's product default is hexCellRadiusKm 0.5. solver.js also carries
// DEFAULT_HEX_CELL_RADIUS_METERS = 4000, but that is only the fallback for a
// caller passing nothing — at 4 km the cell ranking (cornerRing first) swamps
// angular accuracy and a geometrically perfect star drops out of first place.
// Always pass this value through.
export const DEFAULT_STAR_SETTINGS = Object.freeze({
  mode: 5,
  innerRadiusKm: 4,
  outerRadiusKm: 6,
  categoryIds: [...DEFAULT_CATEGORY_IDS],
  angleToleranceDeg: 6,
  candidatesPerSlot: 4,
  rotationStepDeg: 3,
  searchStrategy: 'honeycomb',
  hexCellRadiusKm: 0.5,
  maxResults: 5,
  magicShape: 'star',
  magicVariants: { ...DEFAULT_MAGIC_DRAW_VARIANTS },
  magicElement: 0,
  magicSpeed: 1,
});

const CATEGORY_IDS = new Set(POI_CATEGORIES.map((c) => c.id));
const STRATEGIES = new Set(['honeycomb', 'angular']);

const num = (value, fallback) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max, fallback) => {
  const n = num(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Category groups in the order POI_CATEGORIES declares them. */
export function getCategoryGroups() {
  const groups = new Map();
  POI_CATEGORIES.forEach((category) => {
    const bucket = groups.get(category.group);
    if (bucket) bucket.push(category);
    else groups.set(category.group, [category]);
  });
  return [...groups.entries()];
}

export function normalizeStarSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_STAR_SETTINGS, ...source };

  const mode = isStarMode(merged.mode) ? merged.mode : DEFAULT_STAR_SETTINGS.mode;

  // Radii: outer must stay strictly above inner, else the ring is empty and the
  // Overpass difference query returns nothing at all.
  let innerRadiusKm = clamp(merged.innerRadiusKm, 0, 49.5, DEFAULT_STAR_SETTINGS.innerRadiusKm);
  let outerRadiusKm = clamp(merged.outerRadiusKm, 0.5, 50, DEFAULT_STAR_SETTINGS.outerRadiusKm);
  if (outerRadiusKm <= innerRadiusKm) outerRadiusKm = Math.min(50, innerRadiusKm + 0.5);
  if (innerRadiusKm >= outerRadiusKm) innerRadiusKm = Math.max(0, outerRadiusKm - 0.5);

  const categoryIds = (Array.isArray(merged.categoryIds) ? merged.categoryIds : [])
    .filter((id) => CATEGORY_IDS.has(id));

  const magicShape = isMagicDrawShape(merged.magicShape)
    ? merged.magicShape
    : DEFAULT_STAR_SETTINGS.magicShape;
  const rawVariants = merged.magicVariants && typeof merged.magicVariants === 'object'
    ? merged.magicVariants
    : {};
  const magicVariants = {};
  Object.keys(DEFAULT_MAGIC_DRAW_VARIANTS).forEach((shape) => {
    magicVariants[shape] = getMagicDrawVariantOption(shape, rawVariants[shape]).id;
  });

  return {
    mode,
    innerRadiusKm,
    outerRadiusKm,
    categoryIds: categoryIds.length ? categoryIds : [...DEFAULT_CATEGORY_IDS],
    // Tolerance can never exceed half a slot, and that ceiling moves with mode —
    // a 36° tolerance saved under 五芒星 is illegal once the user picks 八卦圖.
    angleToleranceDeg: Math.round(
      clamp(merged.angleToleranceDeg, 1, maxAngleToleranceForMode(mode), DEFAULT_STAR_SETTINGS.angleToleranceDeg)
    ),
    candidatesPerSlot: Math.round(clamp(merged.candidatesPerSlot, 1, 16, DEFAULT_STAR_SETTINGS.candidatesPerSlot)),
    rotationStepDeg: Math.round(clamp(merged.rotationStepDeg, 1, 90, DEFAULT_STAR_SETTINGS.rotationStepDeg)),
    searchStrategy: STRATEGIES.has(merged.searchStrategy)
      ? merged.searchStrategy
      : DEFAULT_STAR_SETTINGS.searchStrategy,
    hexCellRadiusKm: clamp(merged.hexCellRadiusKm, 0.25, 10, DEFAULT_STAR_SETTINGS.hexCellRadiusKm),
    maxResults: Math.round(clamp(merged.maxResults, 1, 20, DEFAULT_STAR_SETTINGS.maxResults)),
    magicShape,
    magicVariants,
    magicElement: normalizeMagicAnimationIndex(num(merged.magicElement, 0)),
    magicSpeed: MAGIC_SPEED_OPTIONS.includes(num(merged.magicSpeed, NaN))
      ? num(merged.magicSpeed, 1)
      : DEFAULT_STAR_SETTINGS.magicSpeed,
  };
}

export function loadStarSettings() {
  try {
    return normalizeStarSettings(JSON.parse(localStorage.getItem(LS_STAR_SETTINGS_KEY) || 'null'));
  } catch (_) {
    return normalizeStarSettings(null);
  }
}

export function saveStarSettings(settings) {
  try {
    localStorage.setItem(LS_STAR_SETTINGS_KEY, JSON.stringify(normalizeStarSettings(settings)));
  } catch (_) { }
}

const isLatLng = (value) => !!value
  && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng))
  && Math.abs(Number(value.lat)) <= 90 && Math.abs(Number(value.lng)) <= 180;

/** Workspace state: panel open flag + the search centre the user last picked. */
export function loadStarToolState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_STAR_TOOL_KEY) || 'null'); }
  catch (_) { saved = null; }
  if (!saved || typeof saved !== 'object') return { open: false, center: null, centerName: '' };
  return {
    open: saved.open === true,
    center: isLatLng(saved.center)
      ? { lat: Number(saved.center.lat), lng: Number(saved.center.lng) }
      : null,
    centerName: typeof saved.centerName === 'string' ? saved.centerName : '',
  };
}

export function saveStarToolState(state) {
  try {
    if (!state || (!state.open && !state.center)) {
      localStorage.removeItem(LS_STAR_TOOL_KEY);
      return;
    }
    localStorage.setItem(LS_STAR_TOOL_KEY, JSON.stringify({
      open: state.open === true,
      center: isLatLng(state.center) ? { lat: state.center.lat, lng: state.center.lng } : null,
      centerName: typeof state.centerName === 'string' ? state.centerName : '',
    }));
  } catch (_) { }
}

export { MAGIC_ANIMATION_COUNT, MAGIC_SPEED_OPTIONS };
