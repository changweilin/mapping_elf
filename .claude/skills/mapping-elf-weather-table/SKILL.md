---
name: weather-table
description: Reference for Mapping Elf's weather table data model and column lifecycle. Trigger when modifying weatherPoints, column date/time logic, interval cascade, localStorage save/restore, time ordering enforcement, or waypoint vs. interval column behavior.
type: library
---

# Mapping Elf — Weather Table Reference

The weather table is built in `src/main.js`. The key data structures and functions are described below.

## `weatherPoints` Array

Each entry is a plain object:

```js
{
  lat, lng,
  label,          // display name ("WP 1", "km 3.5", etc.)
  isWaypoint,     // true = user-placed marker; false = auto-generated interval point
  isReturn,       // true if this point is on the return-trip half
  wpIndex,        // index within waypoints[] array (waypoints only)
  date, time,     // filled by DOM reads during save/render cycle
  _elapsedH,      // computed elapsed hours from col-0 (set during buildWeatherPoints)
  weather: {      // keyed weather data, shape: { key: { label, value } }
    temp: { label: '氣溫', value: '18°C' },
    ...
  }
}
```

**Key invariant**: `_elapsedH` on interval points is set during `buildWeatherPoints()` and is the source of truth for their time. Never try to read/save interval times from localStorage.

## Column Lifecycle

```
buildWeatherPoints()
  └─ populates weatherPoints[], sets _elapsedH on each point
renderWeatherPanel()
  └─ creates DOM columns, calls getSavedCol() for waypoints
  └─ calls cascadeIntervalTimes() for interval points (NOT getSavedCol)
cascadeIntervalTimes()
  └─ reads col-0 date/hour from DOM, adds _elapsedH → writes to disabled inputs
enforceTimeOrdering()
  └─ ONLY checks isWaypoint columns; skips interval columns
```

## `getSavedCol(pt, idx, saved)` — Critical Rules

Returns saved date/time/hour for a column, or null.

**MUST return null for non-waypoint columns.** If it returns stale values for interval points, those points will show wrong times (the stale time overrides the cascade).

```js
// Early return pattern — do not remove:
if (!pt.isWaypoint) return null;
```

## `saveWeatherSettings()` — Critical Rules

Skips saving entries for non-waypoint columns:

```js
if (!pt.isWaypoint) continue; // interval times are always recomputed
```

Never save interval times to localStorage — they will conflict with cascade on next load.

## `cascadeIntervalTimes()`

Reads col-0 date + hour from DOM, then for each interval point (`!pt.isWaypoint`):

```js
const { date, hour } = addHoursToDateTime(startDate, startHour, pt._elapsedH || 0);
```

Writes result to the disabled `<input>` and `<select>` in the DOM. Does NOT write to localStorage.

Call after `renderWeatherPanel()` and after any change to col-0's date/time.

## `enforceTimeOrdering()`

Enforces non-decreasing date/time across columns, **waypoint columns only**.

On violation (user moved a waypoint's time earlier than predecessor):
1. **Pace-derived time first**: compute `addHoursToDateTime(col0Date, col0Hour, pt._elapsedH)`. If that time ≥ predecessor, apply it — this realigns the waypoint with actual route timing.
2. **Fallback**: if even the pace time is earlier than the predecessor (waypoints placed out of order), reset to the predecessor's date+time (minimum valid state).
- The date is never bumped to +1 day.

Interval columns are excluded — their ordering is guaranteed by the cascade.

## `updateDateConstraints()`

Sets the `min` attribute on each waypoint date input so the browser's date picker grays out dates that would violate strict linear ordering. No-op when `strictLinearMode` is off.

Call after `syncIntervalTimes()` on first render and after every `onTimeChange`.

## `shiftAllDates()`

When shifting all dates forward/backward:
- Skip interval columns (they will be updated by `cascadeIntervalTimes()` after)
- Call `cascadeIntervalTimes()` at the end

## Interval Mode State

```js
speedIntervalMode  // boolean: pace-based spacing
segmentIntervalKm  // number: distance-based spacing (0 = off)
```

These are mutually exclusive. Radio group: `off / distance / pace`.

- Distance mode still computes `cumTimes` (needs `_elapsedH` for interval points)
- Pace mode uses `computeHourlyPoints()` for placement

## localStorage Keys

| Key | Value |
|---|---|
| `mappingElf_segmentKm` | distance interval km |
| `mappingElf_speedMode` | `'1'` = pace interval mode on |
| `mappingElf_speedActivity` | activity key |
| `mappingElf_paceParams` | JSON object of pace params (flatPaceKmH always in km/h) |
| `mappingElf_perSegment` | `'1'` = per-segment recalc on |
| `mappingElf_paceUnit` | `'kmh'` or `'shanhe'` |
| `mappingElf_waypoints` | serialised waypoints array |
| `mappingElf_weatherCache` | weather API response cache |

The weather settings key pattern for a saved column: `mappingElf_weather_<key>` where key encodes waypoint identity (not index — indices shift when waypoints are added/removed).

## Gotchas

- **`_elapsedH` set to 0 if `cumTimes` is not available.** Distance mode without pace params will have all interval `_elapsedH = 0` → cascade sets them all to col-0 time. Always ensure `cumTimes` is populated before setting `_elapsedH`.
- **Round-trip middle point**: `isReturn: false` on the first half, `isReturn: true` on the return. The turnaround waypoint has both `isReturn: false` and is the last non-return waypoint — don't accidentally treat it as a return point.
- **Per-segment reads from saved, not DOM**: `buildWeatherPoints()` runs before `renderWeatherPanel()` so there is no DOM yet. It reads scheduled departure times from `loadWeatherSettings()` + `getSavedCol()`. If the user hasn't saved yet, `restH = 0` (no recovery applied).
- **Weather column header date inputs are `disabled` for interval points** — they appear grayed but their `.value` is still readable. Don't confuse disabled with empty.
