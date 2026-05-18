# Pre-App Optimization Progress

Created: 2026-05-18
Source plan: `doc/pre-app-optimization-plan.md`

## Execution Order

| Sprint | Scope | Status | Verification |
| --- | --- | --- | --- |
| Sprint 1 | Build mode, platform adapter, external platform calls, export channel split | In progress | `npm run build:web`, `npm run build:app`, smoke/import-export tests |
| Sprint 2 | Import/export round-trip tests, state contract, reset/import behavior | In progress | `npm run test:import-export`, `npm run test:numeric` |
| Sprint 3 | Error states, mobile UI QA, safe area, WebView differences | Pending | Browser mobile smoke checklist |
| Sprint 4 | Long-route performance, request cancellation guards, offline strategy, privacy data flow | Pending | Long route fixture, request-race tests, privacy review |

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

## Next Safe Steps

1. Expand platform adapter native implementations once Capacitor plugins are chosen.
2. Add mobile viewport QA cases for export/import modal, waypoint touch flows, bottom panel, and safe-area spacing.
3. Add request version guards for route/weather/elevation updates before refactoring long-running calculations.
4. Add offline tile strategy details for size estimation, per-route cleanup, and provider license notes.
