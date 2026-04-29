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

## Handoff Format

State the formula or algorithm, input units, output units, invariants, edge cases, and a small numeric example when possible.

## Verification Checklist

- Check coordinate order at every API boundary.
- Test one-way, out-and-back, loop, imported track, and sparse-route cases when applicable.
- Run targeted module tests or smoke tests after product-code changes.
