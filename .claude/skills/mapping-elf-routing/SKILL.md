---
name: mapping-elf-routing
description: Reference for OSRM/Brouter pathfinding and Leaflet multi-segment management. Trigger when editing routeEngine.js, mapManager.js, debugging recursive calls, or altering waypoint dragging/sorting mechanics.
type: library
---

# Mapping Elf — Routing Engine Reference

Source: `src/modules/routeEngine.js`, `src/modules/mapManager.js`

## Core Responsibilities
- Interacting with Brouter (for hiking profiles) and OSRM (for driving/cycling).
- Polylines generation between multiple waypoints.
- Elevation extraction (often merged with routing or requested separately from Open-Meteo).

## Architectural Rules
- Avoid recursive route recalculation loops: dragging a waypoint triggers a recalculate, which updates the map, which should NOT trigger another recalculate.
- Segments must be parsed individually (WP 1 -> WP 2, WP 2 -> WP 3) and merged seamlessly to calculate total `cumTimes` and distances.

## Marker Management
- Uses default unpkg icons for Leaflet to fix Vite build issues. Do not change back to local `_getIconUrl`.
- Reordering waypoints must maintain interval configurations and immediately invalidate the route cache for those affected segments.

## Gotchas
- **Brouter vs OSRM:** They return different JSON structures. The codebase must abstract parsing logic so the rest of the app only consumes a unified `[lat, lng, elevation]` array per segment.
- **Coordinate Arrays:** Remember `[lat, lng]` (Leaflet) vs `[lng, lat]` (GeoJSON/API inputs).
- **Race conditions:** Rapidly dragging a marker can cause multiple inflight requests. The latest drag event must abort or discard previous API responses to prevent UI rubber-banding.
