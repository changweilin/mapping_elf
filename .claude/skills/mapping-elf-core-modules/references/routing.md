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

## Cancellation & caching (continuous placement)
- `getAlternativeRoutes(waypoints, { signal })` threads one `AbortController` signal through BRouter (combined + per-leg), the OSRM path, the OSRM fallback and `_fetchElevations`. `main.js` owns the controller (`activeRoutePlanAbort`) and aborts it from `invalidateRoutePlanRun()`, so a plan superseded by the next waypoint stops at once instead of holding the network while the fresh plan waits behind `isProcessing`.
- **Every catch in this file must rethrow when `signal?.aborted`.** The fallback chain is combined → per-leg → straight-line, and `_fetchElevations` returns zeros on failure: without the rethrow an aborted plan quietly "succeeds" as a straight line at elevation 0 for waypoints the user has already moved past.
- `_fetchElevations` caches by the 4dp coordinate it actually sends to Open-Meteo (`ELEVATION_CACHE_LIMIT`, oldest-first trim) and requests each distinct miss once. Terrain is static, so this changes no value — it mostly pays off on round-trip mode (the return leg re-samples the outbound points) and on re-selecting an alternative. Elevation is still fetched for ALL alternatives: `getAlternativeRoutes` ranks them 50/50 on distance and ascent+descent, so skipping it would change which route is recommended.
- Guarded by `test/request-race.spec.js` (abort timing, supersede, append-while-planning).
