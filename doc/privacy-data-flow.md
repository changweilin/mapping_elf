# Mapping Elf Privacy Data Flow

Created: 2026-05-18

This is a pre-app privacy inventory for future privacy policy, Google Play Data safety, and Apple App Privacy disclosures. It describes current app behavior; update it whenever a new external service, persistent key, analytics SDK, or crash-reporting SDK is added.

## Current Position

- No account system.
- No advertising SDK.
- No payment flow.
- No analytics or crash-reporting SDK is currently wired in the app source.
- Route, weather, pace, layout, and preference data are stored locally in `localStorage` and optional `.melmap` files.

## Data Leaving The Device

| User action | Data sent | Destination | Purpose | Notes |
| --- | --- | --- | --- | --- |
| Route calculation in hiking mode | Waypoint coordinates | BRouter `https://brouter.de/brouter` | Hiking route generation | Coordinates are sent as `lon,lat` pairs. |
| Route calculation in walking/cycling/driving modes | Waypoint coordinates | OSRM demo API `https://router.project-osrm.org` | Route generation | Coordinates are sent as `lon,lat` pairs. |
| Elevation lookup | Sampled route coordinates | Open-Meteo Elevation API `https://api.open-meteo.com/v1/elevation` | Elevation profile and ascent/descent | Imported tracks with embedded elevation can avoid this lookup. |
| Weather lookup | Coordinate, date, hour | Open-Meteo Forecast/Archive APIs | Weather table and weather cards | Uses route/weather-point coordinates and selected dates. |
| Reverse geocoding | Coordinate | Nominatim `https://nominatim.openstreetmap.org` | Place names for waypoints/search | Results may be cached locally. |
| Overpass lookup | Coordinate area query | Overpass API `https://overpass-api.de/api/interpreter` | Nearby feature/name lookup | Used as geocoding fallback/enrichment. |
| Keyword search | Search query text and optional country code | Nominatim | Search results | Query text may include user-entered place names or coordinates. |
| Windy link open | Coordinate, date/hour/layer/model in URL | Windy `https://www.windy.com` | External weather view | User explicitly opens the link. |
| Offline tile download | Tile coordinates/URLs for selected layer | CARTO, OpenTopoMap, or Esri tile servers | Cache map tiles | Tile URLs imply map area and zoom range. |
| External profile/about links | Browser request metadata | GitHub, LinkedIn, demo site, Google Forms | About/contact links | User explicitly opens external links. |

## Data Stored Locally

- `localStorage` stores route preferences, route sessions, weather cache/cells, pace settings/calibration, layout state, theme, favorites, and short-lived import bridges. See `doc/state-contract.md`.
- Cache Storage `mapping-elf-tiles` stores map tiles for offline use.
- `.melmap` files can contain `manifest.json`, optional `route.gpx`, optional `state.json`, and optional cached tiles.
- GPX/KML exports can include coordinates, waypoint labels, elevation, selected date/time, cached weather values, and Windy URLs.

## Sensitive Data Notes

- Location/route coordinates can reveal home, workplace, travel plans, or outdoor activity patterns.
- `.melmap`, GPX, and KML files are user-controlled exports; sharing them may disclose route coordinates, labels, dates, weather selections, and selected preferences.
- Browser/OS geolocation permission is used only when the user asks for current location or when no saved view exists and the browser grants a position. The app does not persist raw GPS permission state.

## App Store Disclosure Draft Basis

- Approximate/precise location may be processed for route planning, map display, weather, elevation, search, and offline tiles.
- User content may include saved routes, waypoint names, exported files, and favorites.
- No tracking should be disclosed unless analytics, advertising, cross-app identifiers, or third-party tracking SDKs are added later.
- Data is not linked to an account because the app currently has no account identity.

## Guardrails For Future Changes

- Add any new external service to this file before release.
- Add any new durable localStorage key to `doc/state-contract.md` and `src/modules/stateKeys.js`.
- Keep `.melmap` imports allow-list based.
- Add a clear user-facing option before adding analytics or crash reporting.
