# Spatial Numeric Rules

## Coordinate Conventions

- App route coordinates: `[lat, lng]`
- Leaflet coordinates: `[lat, lng]` or `L.LatLng`
- GeoJSON coordinates: `[lng, lat]`
- OSRM coordinate URL: `lng,lat`
- BRouter `lonlats`: `lng,lat`

Always name conversion variables clearly when crossing these boundaries.

## Distance and Projection

- `haversineDistance` returns metres.
- `totalDistance` and `cumulativeDistances` return metres.
- `projectMileage` returns metres from polyline start plus perpendicular distance in metres.
- Projection ordering must be monotonic for imported tracks unless a feature explicitly supports reordering.

## Elevation and Pace

- Ascent and descent are accumulated from sampled elevation differences.
- Pace model input distance is kilometres, elevation is metres, and elapsed values are hours.
- Rest and fatigue modify elapsed time and calories; do not treat them as display-only.

## Route Scoring

Alternative route ranking currently balances distance and total elevation change. Any weighting change should document why, preserve deterministic ordering, and keep the displayed label logic coherent.
