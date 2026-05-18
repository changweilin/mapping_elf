const ROUTE_STATE_KEYS = [
  'mappingElf_roundTrip',
  'mappingElf_oLoop',
  'mappingElf_routeMode',
  'mappingElf_mapLayer',
  'mappingElf_mapView',
  'mappingElf_geocode',
  'mappingElf_customNames',
];

const ROUTE_SESSION_KEYS = [
  'mappingElf_waypoints',
  'mappingElf_waypointIds',
  'mappingElf_importedTrack',
];

const WEATHER_STATE_KEYS = [
  'mappingElf_weather',
  'mappingElf_weatherCells',
  'mappingElf_weatherCache',
  'mappingElf_weatherCacheEnabled',
  'mappingElf_weatherCacheDistanceM',
  'mappingElf_weatherCacheElevationM',
  'mappingElf_weatherCacheMaxAgeDays',
  'mappingElf_weatherTableCollapsed',
];

const PACE_STATE_KEYS = [
  'mappingElf_segmentKm',
  'mappingElf_speedMode',
  'mappingElf_speedActivity',
  'mappingElf_paceParams',
  'mappingElf_paceCalibration',
  'mappingElf_paceUnit',
  'mappingElf_perSegment',
  'mappingElf_strictLinear',
];

const PREFERENCE_STATE_KEYS = [
  'mappingElf_importAutoSort',
  'mappingElf_importAutoName',
  'mappingElf_collectiveMarked',
  'mappingElf_collectiveIntermediate',
  'mappingElf_collectiveAll',
  'mappingElf_waypointCentering',
  'mappingElf_showWpIcon',
  'mappingElf_showImIcon',
  'mappingElf_windyLayer',
  'mappingElf_windyModel',
  'mappingElf_theme',
];

const LAYOUT_STATE_KEYS = [
  'mappingElf_panelWidth',
  'mappingElf_panelHeight',
  'mappingElf_panelHeightRatio',
];

const SESSION_STATE_KEYS = [
  'mappingElf_pendingGpx',
];

const USER_COLLECTION_KEYS = [
  'mappingElf_favorites',
];

const unique = (keys) => [...new Set(keys)];

export const MELMAP_STATE_KEYS = unique([
  ...ROUTE_STATE_KEYS,
  ...WEATHER_STATE_KEYS,
  ...PACE_STATE_KEYS,
  ...PREFERENCE_STATE_KEYS,
  ...LAYOUT_STATE_KEYS,
]);

export const RESET_STATE_KEYS = unique([
  ...MELMAP_STATE_KEYS,
  ...ROUTE_SESSION_KEYS,
  ...SESSION_STATE_KEYS,
]);

export const USER_STATE_KEYS = unique([
  ...MELMAP_STATE_KEYS,
  ...ROUTE_SESSION_KEYS,
  ...SESSION_STATE_KEYS,
  ...USER_COLLECTION_KEYS,
]);

export const STATE_KEY_GROUPS = Object.freeze({
  route: ROUTE_STATE_KEYS,
  routeSession: ROUTE_SESSION_KEYS,
  weather: WEATHER_STATE_KEYS,
  pace: PACE_STATE_KEYS,
  preference: PREFERENCE_STATE_KEYS,
  layout: LAYOUT_STATE_KEYS,
  session: SESSION_STATE_KEYS,
  userCollection: USER_COLLECTION_KEYS,
});
