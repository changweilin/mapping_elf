# Mapping Elf Follow-up Refactor Roadmap

This roadmap captures the next safe refactor steps after the first memory/speed cleanup pass. The goal is to keep UI behavior, route numerics, weather timing, and import/export compatibility unchanged while making the code easier to test and faster on large routes.

## Current Baseline

The current refactor baseline should remain green before starting any item:

```powershell
npm.cmd run test:numeric
npm.cmd run test:chunks
npm.cmd run build
npm.cmd run test:smoke
```

Known stable guardrails:

- Smoke tests cover app shell, sample KML import, route UI, export modal, and `.melmap` restore.
- Numeric tests cover distance accumulation, pace timing, kcal stats, hourly interval placement, and the rule that generated interval weather times are not restored as waypoint-authored times.
- `paceEngine.js` no longer depends on Leaflet at module load time.

## Priority 1: Versioned Caches

Replace string-heavy cache signatures with explicit version counters.

Implementation intent:

- Add internal `routeVersion` and `paceVersion` counters in `src/main.js`.
- Increment `routeVersion` whenever `currentRouteCoords`, route mode, waypoint order, imported track state, or selected alternative changes.
- Increment `paceVersion` whenever `speedActivity`, `paceParams`, `paceCalibration`, interval mode, or elevation sample data changes.
- Use `{ routeVersion, waypointVersion }` for route metrics cache keys instead of joining full coordinate arrays.
- Use `{ paceVersion, elevationVersion }` for pace computation cache keys instead of joining full elevation/distance arrays.

Acceptance checks:

- Imported KML and `.melmap` smoke tests still pass.
- Numeric output in `test:numeric` is unchanged.
- Route labels, waypoint distances, weather point order, and elevation marker positions remain unchanged.

## Priority 2: Extract Weather Point Generation

Split `buildWeatherPoints()` into testable pure logic.

Implementation intent:

- Move route/weather point construction into a small module, for example `src/modules/weatherPoints.js`.
- Keep DOM reads, localStorage reads, map calls, and UI rendering in `src/main.js`.
- The extracted function should receive explicit inputs:
  - waypoints and waypoint metadata
  - route coordinates and cumulative route distances
  - nav mode flags: one-way, round-trip, O-loop, imported track
  - interval settings and pace timeline helpers
  - label/name lookup callbacks or precomputed labels
- The output should be a `weatherPoints` array with the same shape currently consumed by the UI.

Acceptance checks:

- Add module tests for one-way, round-trip, O-loop, distance interval, pace interval, per-segment interval, and imported-track ordering.
- Confirm return-trip interval points keep `isReturn: true`.
- Confirm `_elapsedH` for all return points remains relative to trip start.
- Confirm generated interval columns remain non-persisted by weather settings.

## Priority 3: Broaden Numeric Regression Tests

Add targeted regression cases before larger `main.js` extraction.

Recommended scenarios:

- Round-trip route with three waypoints:
  - turnaround waypoint is the final outbound waypoint.
  - return waypoints sort after outbound points.
  - return `_elapsedH` is continuous from col-0.
- O-loop route:
  - route end returns to start without duplicating unrelated waypoint identities.
- Per-segment pace mode:
  - interval labels use segment-relative time.
  - total elapsed time remains cumulative.
- Imported track with intermediate points:
  - `cumDistM` values from the file win over projection fallback.
  - waypoint/intermediate order remains stable.
- Weather persistence:
  - `saveWeatherSettings()` skips interval points.
  - `getSavedCol()` returns `null` for interval points.

Acceptance checks:

- New tests fail if interval columns accidentally persist stale manual times.
- New tests fail if round-trip return timing becomes relative to turnaround instead of start.

## Priority 4: Restore Real Playwright Clicks

The smoke tests currently use a stable DOM-click helper for controls that can drift outside the viewport. Keep that helper for reliability, but eventually restore true Playwright actionability where possible.

Implementation intent:

- Audit why `#btn-clear-route` and `#btn-export-gpx` can be outside the viewport after import.
- Prefer UI/layout fixes that keep core controls reachable at the configured `1280x900` viewport.
- Change only the affected tests back from `evaluate((el) => el.click())` to `locator.click()` after the UI is reliably actionable.

Acceptance checks:

- `npm.cmd run test:smoke` passes repeatedly.
- No test relies on hidden or off-screen controls for core workflows.

## Priority 5: Add Performance Baselines

Add a small performance script so future refactors can prove speed improvements.

Implementation intent:

- Add a Playwright perf test or script that imports the sample KML and records:
  - time from file input set to first waypoint visible
  - time from file input set to chart visible
  - time for export modal open after route import
- Keep thresholds loose at first to avoid flaky CI, and report timings in console output.
- Use the same fixture route so performance trends are comparable over time.

Acceptance checks:

- Script runs locally without network dependency beyond existing app behavior.
- Performance output is stable enough to compare before/after refactors.

## Priority 6: I18n Runtime Test

Add browser coverage for dynamic translation after the MutationObserver batching change.

Implementation intent:

- Switch language in the UI.
- Trigger dynamic DOM creation, such as opening a weather card or rendering a weather table row.
- Assert translated text or translated attributes appear after one animation frame.

Acceptance checks:

- Dynamic text still translates after batched observer processing.
- Existing language switch behavior remains unchanged.

## Safety Rules

- Do not change GPX, KML, or `.melmap` public wire formats unless a migration plan is written first.
- Do not change Leaflet default marker icon URL handling.
- Keep `flatPaceKmH` stored internally as km/h.
- Keep interval weather date/time inputs generated and disabled.
- Do not persist generated interval times as waypoint-authored weather settings.
- For every refactor item, run tests before starting the next item.
