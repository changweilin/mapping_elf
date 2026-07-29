---
name: mapping-elf-geo-numeric-analysis
description: Spatial and numeric analysis workflow for Mapping Elf. Use when changing or auditing route geometry, distance calculations, coordinate ordering, waypoint projection, elevation sampling, ascent/descent accumulation, alternative route scoring, pace-time math, calories, round-trip mileage, or numeric stability in utils.js, routeEngine.js, paceEngine.js, and elevationProfile.js.
---

# Mapping Elf Geo Numeric Analysis

## Trigger Criteria

Use this skill for route math, spatial projection, distance/elevation calculations, pace model analysis, route ranking, and numeric regression review.

Do not use this skill for UI event wiring except to define the numeric behavior that UI events should trigger.

## Primary Ownership

- `src/modules/utils.js`
- `src/modules/routeEngine.js`
- `src/modules/paceEngine.js`
- `src/modules/elevationProfile.js`
- Numeric assumptions consumed by `src/main.js`

## Required First Reads

- Read `.claude/skills/mapping-elf-core-modules/references/routing.md` for route work.
- Read `.claude/skills/mapping-elf-core-modules/references/pace-engine.md` and `references/pace-engine/formulas.md` for pace work.
- Read `references/spatial-numeric-rules.md` before changing coordinate, projection, sampling, or scoring behavior.

## Gotchas

- Leaflet and most app arrays use `[lat,lng]`; GeoJSON and routing APIs use `[lng,lat]`.
- Round-trip waypoint ordering cannot assume `isReturn` flips at the midpoint.
- Segment-relative timing must subtract the segment start distance.
- Elevation sampling can smooth or exaggerate ascent/descent; document resolution changes.
- Avoid silently changing units: metres, kilometres, hours, km/h, kcal, and MET are all mixed in the codebase.
- Drawing-board (`shapeRoutePlanner.js`) shape fidelity: waypoints must sit on curvature features first (`selectWaypointTs`) — evenly spaced waypoints let the router chord across star tips / finger notches, and `shapeSimilarity` (mean-based) barely registers that loss; judge fidelity with `ringRouteDeviation.maxM` instead. Waypoint positions are arc-length fractions `t` so they survive ring re-scaling. Deviation-driven refinement and post-refinement mileage calibration must both be guarded (accept only if measurably better, damped √-step for calibration) — on a network coarser than the drawn feature, unguarded refinement buys mileage with no shape gain and full-step calibration oscillates. Regression harness: `test/helpers/gridWorld.mjs` + `test/helpers/testShapes.mjs` (deterministic Manhattan grid + heart/star/plum/palm strokes), guarded in `numeric-regression.mjs` and `shape-route-fidelity.spec.js`.
- Out-and-back spurs (零包圍面積來回段): product decision (2026-07-30) is that the drawn figure must ENCLOSE AREA — with the 修剪來回路段 toggle on (default), `planSpurRetraction` retracts EVERY whisker waypoint to its junction, including feature-tracing ones, so sharp tips round off (measured cost: maxDev 63→~130-190 m on the grid harness; user accepted). Retract-to-junction beats dropping the waypoint (drop fails to converge — the guard keeps reverting). Passes are bounded (≤3) and alternate with damped mileage recalibration (≤4); each pass must strictly shrink the whisker total or it is reverted. `offShapeRouteSpurs` (tip-to-ring distance classifier) remains for tests/optional use. Toggle key `mappingElf_shapeRouteTrimSpurs`; 實際距離 always stays the physical mileage — only the shape verdict uses the trimmed track. Grid-harness caveat: the old gridWorld entry rule overshot mid-block targets creating fake router whiskers no waypoint causes — entry now picks the shortest of both directions; real shortest-path routers only produce whiskers at via points.

## Handoff Format

State the formula or algorithm, input units, output units, invariants, edge cases, and a small numeric example when possible.

## Verification Checklist

- Check coordinate order at every API boundary.
- Test one-way, out-and-back, loop, imported track, and sparse-route cases when applicable.
- Run targeted module tests or smoke tests after product-code changes.
