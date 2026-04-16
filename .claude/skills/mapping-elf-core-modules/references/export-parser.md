---
name: mapping-elf-export-parser
description: Reference for GPX/KML file generation, importing, and Reverse Geocoding. Trigger when modifying exports, handling XML namespaces, or adjusting Nominatim API geocoding mechanisms.
type: library
---

# Mapping Elf — Export & Parsing Reference

Source: `src/modules/gpxExporter.js`, `src/modules/kmlExporter.js`

## Core Responsibilities
- Formatting `weatherPoints` and routes into valid GPX / KML XML.
- Reverse geocoding via Nominatim to convert `(Lat, Lng)` to human-readable names.
- Importing user GPX files, parsing `<trkpt>` and `<wpt>`.

## XML Generation Rules
- **Escape XML:** User-provided labels and Nominatim strings MUST be escaped (e.g., `&` -> `&amp;`, `<` -> `&lt;`). Unescaped strings corrupt the whole GPX.
- **Namespaces:** Custom elements (like interval markers) use a custom prefix (`<type>mel:interval</type>`) so the app can recognize and skip generating waypoints for them upon re-importing.
- `<ele>` tags must only be included if the elevation data is valid and numerical.

## Reverse Geocoding (Nominatim API)
- **Strict Rate Limits:** Nominatim strictly requires no more than 1 request per second. Violating this will result in IP bans (HTTP 429).
- Use local caching (like `localStorage` or memory) to never reverse-geocode the same coordinate twice in one session.

## Gotchas
- **Interval Points vs Waypoints:** GPX `<wpt>` tags must correctly map. Do not export automatically generated interval points as standard waypoints without the `mel:interval` type, otherwise importing the GPX will pollute the user's UI waypoint list.
- **Time/Date Tags:** GPX timestamps must be valid ISO 8601 strings (`YYYY-MM-DDTHH:mm:ssZ`). Ensure Timezone UTC offsets are handled correctly.
