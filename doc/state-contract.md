# Mapping Elf State Contract

Created: 2026-05-18

This document records the durable browser state used by Mapping Elf before the Android/iOS app expansion. Keep it in sync with `src/modules/stateKeys.js` and the `LS_*_KEY` constants in `src/main.js`.

## Principles

- Persistent values must have a named `LS_*_KEY` constant.
- `.melmap` state restore is allow-list based; never import arbitrary ZIP keys into `localStorage`.
- Missing fields must fall back to current defaults.
- Computed values such as elevation stats, cumulative times, and generated interval times are not authoritative user state.
- Reset defaults should clear route/session/runtime state without deleting user collections such as favorites.

## `.melmap` State Boundary

Exported in `.melmap` when "personal preferences" is selected:

- Route settings: route mode, round-trip/O-loop flags, map layer/view, geocode cache, custom names.
- Weather state: saved weather columns/cells, weather cache, cache toggles and thresholds, weather table collapsed state.
- Pace state: segment interval, speed mode/activity, pace params, calibration data, pace unit, per-segment mode, strict linear mode.
- Preferences: import sorting/naming, collective weather columns, waypoint centering, weather icon toggles, Windy layer/model, theme.
- Layout: side panel width and bottom panel height/ratio.

Not exported in `.melmap` state:

- `mappingElf_waypoints`, `mappingElf_waypointIds`, and `mappingElf_importedTrack`; route geometry is exported through `route.gpx`.
- `mappingElf_pendingGpx`; this is an internal reload bridge.
- `mappingElf_favorites`; favorites are a user collection and should not be overwritten by route packs.

## Key Groups

| Group | Keys | Format | Default/Fallback | `.melmap` | Reset |
| --- | --- | --- | --- | --- | --- |
| Route | `mappingElf_roundTrip`, `mappingElf_oLoop` | `'1'` or `'0'` | off; if both are on, O-loop is forced off | yes | yes |
| Route | `mappingElf_routeMode` | string: `walking`, `hiking`, `cycling`, `driving` | `hiking` | yes | yes |
| Route | `mappingElf_mapLayer` | string: `streets`, `topo`, `satellite` | `topo` after normalization | yes | yes |
| Route | `mappingElf_mapView` | JSON `{ lat, lng, zoom }` | app default map view | yes | yes |
| Route | `mappingElf_geocode` | JSON object keyed by rounded coordinates | `{}` | yes | yes |
| Route | `mappingElf_customNames` | JSON object keyed by rounded coordinates | `{}` | yes | yes |
| Route session | `mappingElf_waypoints` | JSON `[[lat,lng], ...]` | `null` / empty route | no | yes |
| Route session | `mappingElf_waypointIds` | JSON string array | generated ids | no | yes |
| Route session | `mappingElf_importedTrack` | JSON `{ coords, elevations, waypoints, waypointMeta, intermediates }` | no imported-track restore | no | yes |
| Weather | `mappingElf_weather` | JSON `{ byKey, cols }` | `null` | yes | yes |
| Weather | `mappingElf_weatherCells` | JSON object keyed by weather point | `{}` | yes | yes |
| Weather | `mappingElf_weatherCache` | normalized JSON cache store | `{}` | yes | yes |
| Weather | `mappingElf_weatherCacheEnabled` | `'1'` or `'0'` | enabled | yes | yes |
| Weather | `mappingElf_weatherCacheDistanceM` | numeric string | current app default | yes | yes |
| Weather | `mappingElf_weatherCacheElevationM` | numeric string | current app default | yes | yes |
| Weather | `mappingElf_weatherCacheMaxAgeDays` | numeric string | current app default | yes | yes |
| Weather | `mappingElf_weatherTableCollapsed` | `'1'` or `'0'` | expanded | yes | yes |
| Pace | `mappingElf_segmentKm` | numeric string | `0` | yes | yes |
| Pace | `mappingElf_speedMode` | `'1'` or `'0'` | enabled | yes | yes |
| Pace | `mappingElf_speedActivity` | string activity id | `hiking` | yes | yes |
| Pace | `mappingElf_paceParams` | JSON merged over `DEFAULT_PACE_PARAMS` | defaults from pace engine | yes | yes |
| Pace | `mappingElf_paceCalibration` | JSON calibration object | disabled / empty tracks | yes | yes |
| Pace | `mappingElf_paceUnit` | `kmh`, `minkm`, or `shanhe` | `kmh` | yes | yes |
| Pace | `mappingElf_perSegment` | `'1'` or `'0'` | off | yes | yes |
| Pace | `mappingElf_strictLinear` | `'1'` or `'0'` | on | yes | yes |
| Preference | `mappingElf_importAutoSort` | `'1'` or `'0'` | off | yes | yes |
| Preference | `mappingElf_importAutoName` | `'1'` or `'0'` | off | yes | yes |
| Preference | `mappingElf_collectiveMarked` | `'1'` or `'0'` | on | yes | yes |
| Preference | `mappingElf_collectiveIntermediate` | `'1'` or `'0'` | on | yes | yes |
| Preference | `mappingElf_collectiveAll` | `'1'` or `'0'` | off | yes | yes |
| Preference | `mappingElf_waypointCentering` | `'1'` or `'0'` | on | yes | yes |
| Preference | `mappingElf_showWpIcon` | `'1'` or `'0'` | on | yes | yes |
| Preference | `mappingElf_showImIcon` | `'1'` or `'0'` | desktop on, mobile off by default | yes | yes |
| Preference | `mappingElf_windyLayer` | Windy layer id | app default layer | yes | yes |
| Preference | `mappingElf_windyModel` | Windy model id | `ecmwf` | yes | yes |
| Preference | `mappingElf_theme` | `light` or `dark` | OS/app default | yes | yes |
| Layout | `mappingElf_panelWidth` | pixel width string | CSS default | yes | yes |
| Layout | `mappingElf_panelHeight` | legacy pixel height string | legacy fallback only | yes | yes |
| Layout | `mappingElf_panelHeightRatio` | numeric ratio string | CSS/default ratio | yes | yes |
| Session | `mappingElf_pendingGpx` | GPX XML string | none | no | yes |
| User collection | `mappingElf_favorites` | JSON favorite route list | `[]` | no | no |

## Import And Reset Rules

- `.melmap` import may restore `state.json` only through `MELMAP_STATE_KEYS`.
- `.melmap` route restore should use `route.gpx` and the regular GPX importer, not raw route-session keys.
- Reset defaults clears `RESET_STATE_KEYS`; favorites remain intact.
- Any new durable key must be added to exactly one group in `STATE_KEY_GROUPS`, then evaluated for `.melmap` export and reset behavior.
