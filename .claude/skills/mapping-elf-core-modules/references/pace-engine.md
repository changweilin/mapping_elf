---
name: pace-engine
description: Reference for Mapping Elf's pace engine (paceEngine.js). Trigger when adding new activity types, modifying fatigue/recovery logic, changing 上河速度 conversions, implementing per-segment recalculation, or debugging time estimate discrepancies.
type: library
---

# Mapping Elf — Pace Engine Reference

Source: `src/modules/paceEngine.js`

## Key Exports

| Function | Purpose |
|---|---|
| `computeCumulativeTimes(elevs, dists, activity, params)` | Full-trip elapsed hours array from start |
| `computeSegmentTimesFromState(elevs, dists, activity, params, state)` | One segment, starting from carry-over fatigue state |
| `applyWaypointRecovery(state, restH, params)` | Apply waypoint rest to fatigue state |
| `computeHourlyPoints(...)` | Interpolated points at regular time intervals |
| `computeTripStats(...)` | Total/moving/rest hours + kcal |
| `defaultSpeed(activity, bodyKg, packKg)` | Default flat speed for placeholder UI text |

## Fatigue / Recovery Model

See `references/formulas.md` for the full math.

Key rules:
- Fatigue only activates after **2 h of moving time** (`fatH > 2.0`)
- Multiplier: `fm = max(0.6, exp(-0.06 × (fatH − 2)))`
- Rest break every `restEveryH` moving hours; each break adds `restMinutes` elapsed time
- Rest recovery: **1 rest-minute cancels 3 fatigue-minutes** (`fatH -= restMin / 20`)
- Waypoint recovery uses the same 3× ratio: `newFatH = max(0, fatH − restH × 3)`

## Load Penalty

```js
loadRatio   = packWeightKg / max(1, bodyWeightKg)
loadPenalty = max(0.5, 1.0 − loadRatio × 1.1)
```
Applied to flat speed, ascent rate, and descent rate uniformly.

## 上河速度 (Shanhe Speed)

Defined in `src/main.js`, NOT in paceEngine.js.

```
SHANHE_BASE = 3.0   // km/h for S = 1.0 (5-person heavy-pack, flat)
V_km_h = SHANHE_BASE / S
S       = SHANHE_BASE / V_km_h
```

- **Higher S = slower** (S > 1 means you take longer than the standard group)
- Internal storage is **always km/h** (`paceParams.flatPaceKmH`)
- UI conversion helpers live in `init()`: `kmhToDisplay()` / `displayToKmh()`
- The unit toggle converts the displayed input value on change; pace params are always saved as km/h

## Per-Segment Recalculation Pattern

When `perSegmentMode` is on, `buildWeatherPoints()` runs a second pass:

1. First pass: `computeCumulativeTimes()` for a baseline `cumTimes[]`
2. For each segment between consecutive waypoints:
   - Call `computeSegmentTimesFromState(segElevs, segDists, activity, params, state)`
   - Compute `restH = scheduledDeparture − estimatedArrival` (clamped to ≥ 0)
   - Call `applyWaypointRecovery(finalState, restH, params)` to update fatigue
   - Advance `globalElapsedH` by `restH` if rest > 0, else by `arrivalH`
3. Scheduled departure times are read from **saved localStorage** (`loadWeatherSettings()` + `getSavedCol()`), not from the DOM (which doesn't exist yet during `buildWeatherPoints()`).

## Activity Profiles

```
walking:   3.5 km/h, 400 m/h ascent, no fatigue
hiking:    4.0 km/h, 450 m/h ascent, fatigue ON
trail-run: 8.0 km/h, 800 m/h ascent, fatigue ON
cycling:   15  km/h, 1200 m/h ascent, no fatigue
driving:   40  km/h, no ascent/descent penalty
```

## Gotchas

- `flatPaceKmH = null` means "use activity default adjusted by load". Never pass `0` — it sets speed to 0.1 (clamped minimum).
- `computeSegmentTimesFromState` distances must start from **0**, not the global cumulative distance. Slice and subtract the first value before passing.
- `applyWaypointRecovery` resets `nextRestH = movingH + restEveryH` — this means the rest-break clock restarts from the current moving time, NOT from zero.
- When fatigue is disabled on an activity profile, the `fatigue` param still overrides if explicitly set to `true`.
- `computeTripStats` returns `kcalExpended` (total burn) and `kcalSuggested` (carb intake, always 250 kcal × movingH).

Read `references/formulas.md` for derivation details.
