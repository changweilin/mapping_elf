---
name: review
description: Code quality rules specific to Mapping Elf. Trigger when reviewing a PR or diff, checking a new feature for correctness, or auditing changes to main.js, paceEngine.js, or the weather table for known anti-patterns and bugs.
type: review
---

# Mapping Elf — Code Review Rules

This skill captures patterns that have caused real bugs in this codebase. Apply these checks whenever reviewing changes.

## Pace Engine

- [ ] `flatPaceKmH` is stored **in km/h**, never in 上河速度 units. Conversion happens only in the UI layer (`kmhToDisplay` / `displayToKmh` in `init()`).
- [ ] `computeSegmentTimesFromState` segment distances must start from **0** — subtract `sampledDists[si]` before slicing.
- [ ] Per-segment code reads scheduled waypoint times from `loadWeatherSettings()` + `getSavedCol()`, NOT from the DOM. If you see DOM reads inside `buildWeatherPoints()`, that is a bug.
- [ ] `applyWaypointRecovery` is only called when `restH > 0`. A zero or negative `restH` should NOT call it — it would unnecessarily reset `nextRestH`.
- [ ] Activity switch in `applyIntervalMode` must convert the displayed pace value through km/h first (`displayToKmh()`) before re-displaying in the new activity's units.

## Weather Table

- [ ] `getSavedCol()` must return `null` for `!pt.isWaypoint`. If it returns a saved value for interval points, those columns will show stale times instead of cascaded times.
- [ ] `saveWeatherSettings()` must skip (`continue`) interval points — saving their times creates stale data that conflicts with cascade on next load.
- [ ] `shiftAllDates()` must skip interval columns and call `cascadeIntervalTimes()` after shifting waypoint columns.
- [ ] `enforceTimeOrdering()` must skip `!pt.isWaypoint` columns. Applying time ordering to interval points breaks the cascade.
- [ ] After any change to col-0's date or hour, `cascadeIntervalTimes()` must be called. If it's missing after a col-0 date-shift, interval times will be stale.

## State Management

- [ ] Every new persistent state variable needs a `LS_*_KEY` constant and `localStorage.getItem` on load. No magic strings.
- [ ] `paceParams` is always spread with `DEFAULT_PACE_PARAMS` as base: `{ ...DEFAULT_PACE_PARAMS, ...userParams }`. Never rely on a partial paceParams object being passed around.
- [ ] `speedIntervalMode` and `segmentIntervalKm` are mutually exclusive. Changing one should zero-out the other.

## UI / DOM

- [ ] Interval column date/time inputs are `disabled` — they should **only** be updated by `cascadeIntervalTimes()`, never by direct user edit handlers.
- [ ] Leaflet marker icon URLs are hard-coded to unpkg.com — do NOT change to local imports or default Leaflet icons (they 404 with Vite).
- [ ] `renderWeatherPanel()` is expensive (rebuilds all DOM). Only call it when `weatherPoints` actually changes, not on every UI interaction.

## Round Trip

- [ ] The turnaround waypoint is the last entry in `waypoints[]` before the return segment begins. It has `isReturn: false`. Do not assume `isReturn` flips exactly at the midpoint of `weatherPoints`.
- [ ] Return-trip interval points have `isReturn: true`. When calculating elapsed time for the full trip, return points' `_elapsedH` is relative to col-0 (start), not relative to the turnaround.

## GPX / KML Export

- [ ] Interval points are exported with `<type>mel:interval</type>` so the importer skips them on re-import. If a new point type is added, ensure it also gets the correct type tag.
- [ ] `_escapeXml` must be applied to all user-generated strings in XML output (label, date, time, weather values).

## Gotchas Checklist

- Copying the `computeCumulativeTimes` loop into `computeSegmentTimesFromState`? Ensure `segElapsed` is used instead of `elapsedH` for the segment-relative time array.
- Adding a new pace unit? Remember to update: placeholder text, display→km/h conversion, km/h→display conversion, localStorage restore, activity-switch conversion.
- Adding a new interval mode? Update the radio group, `applyIntervalMode`, and the `cumTimes` condition `(speedIntervalMode || segmentIntervalKm > 0)`.
