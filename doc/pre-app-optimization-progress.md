# Pre-App Optimization Progress

Created: 2026-05-18
Last updated: 2026-05-18
Source plan: `doc/pre-app-optimization-plan.md`

## Execution Order

| Sprint | Scope | Status | Verification |
| --- | --- | --- | --- |
| Sprint 1 | Build mode, platform adapter, external platform calls, export channel split | Done | `npm run build:web`, `npm run build:app`, smoke/import-export tests |
| Sprint 2 | Import/export round-trip tests, state contract, reset/import behavior | Done | `npm run test:import-export`, `npm run test:numeric` |
| Sprint 3 | Error states, mobile UI QA, safe area, WebView differences | In progress | `npm run test:mobile`, browser mobile smoke checklist |
| Sprint 4 | Long-route performance, request cancellation guards, offline strategy, privacy data flow | In progress | Long route fixture, request-race tests, privacy review |

## Completed In This Pass

- Added Vite Web/App build modes:
  - Web/default base: `/mapping_elf/`
  - App mode base: `./`
  - Scripts: `build:web`, `build:app`, `cap:sync`
- Added a first-stage platform adapter under `src/platform/`:
  - external URL opening
  - file download
  - file picking bridge
  - file reading
  - sharing fallback
  - geolocation
  - vibration
  - network status
- Routed existing export/import UI through the platform adapter where it affects App compatibility.
- Added platform-neutral GPX/KML download payload helpers while keeping legacy `download()` wrappers.
- Changed `.melmap` download to use the shared platform adapter.
- Added `test:import-export` with a Playwright round-trip covering GPX, KML, and route-only `.melmap`.
- Added `doc/state-contract.md`.
- Added `doc/privacy-data-flow.md`.

## Completed In Next Round

- Added App-focused test fixtures under `data/app-test-routes/`:
  - short GPX with Chinese names, elevation, date/time, weather extensions, and an interval point
  - compact KML with Chinese names, weather description rows, and a route line
- Expanded `test:import-export` to cover:
  - Chinese GPX fixture import
  - embedded weather/date/time metadata
  - interval-point preservation
  - `.melmap` state restore allow-list behavior
  - reset defaults clearing app state while preserving favorites
- Added `test:mobile` and `test/mobile-app-qa.spec.js`.
- Added modal safe-area padding and viewport-bounded scrolling for small/mobile landscape screens.
- Added route-planning version guards so stale route alternatives are discarded before they redraw the map, elevation chart, stats, or weather table.
- Added geocode run guards so late Nominatim/Overpass results do not relabel a newer waypoint set.
- Split stale route-plan results from real route failures and added an offline-specific route error message.
- Added `test/request-race.spec.js` for stale route-plan and stale geocode discard coverage.
- Prevented pending route recalculation from restarting after an imported track replaces the route while planning is still in flight.
- Added `test/long-route-performance.spec.js` with an in-memory 901-point GPX baseline import check.
- Aligned GPX no-waypoint fallback sampling with KML so generated waypoint anchors always include the real final track point without duplicating it.

## Next Safe Steps

1. Expand platform adapter native implementations once Capacitor plugins are chosen.
2. Expand mobile viewport QA to waypoint touch flows, bottom panel, and import modal.
3. Broaden long-route performance coverage to dense waypoint lists and interval-heavy weather columns.
4. Add offline tile strategy details for size estimation, per-route cleanup, and provider license notes.
