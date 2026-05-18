# App Test Route Fixtures

These fixtures support the pre-app optimization checks in `doc/pre-app-optimization-plan.md`.

## Files

- `short-zh-weather.gpx`: short 3-waypoint GPX with Chinese waypoint names, elevation, date/time, weather extensions, and one interval marker.
- `waypoint-only-zh.kml`: compact KML with Chinese waypoint names, weather table description rows, and a route line.
- `../820 林道_24.2133,121.3472_20260420_1510.kml`: existing long/dense sample used by smoke and round-trip tests.
- `../820 林道_24.2133,121.3472_20260420_1510.melmap`: existing `.melmap` sample with route, tiles, and state.

## Intended Coverage

- Short route import/export.
- Chinese filenames and waypoint names.
- Embedded elevation data.
- Embedded weather/date/time metadata.
- Imported-track restore without calling routing APIs.
- `.melmap` state allow-list behavior.
