---
name: mapping-elf-parameter-data-steward
description: Data-contract and parameter stewardship for Mapping Elf. Use when adding, changing, auditing, or debugging localStorage keys, DEFAULT_PACE_PARAMS, pace/weather/route settings, .melmap state, map-pack import/export compatibility, saved weather columns, calibration data, or persistent app defaults.
---

# Mapping Elf Parameter Data Steward

## Trigger Criteria

Use this skill for persistent settings, default parameters, imported/exported state, calibration data, weather table saved values, map-pack fields, and compatibility questions.

Do not use this skill for route math itself; hand off numeric model questions to `mapping-elf-geo-numeric-analysis`.

## Primary Ownership

- `LS_*_KEY` constants and load/save code in `src/main.js`
- `DEFAULT_PACE_PARAMS` and related pace parameter shape in `src/modules/paceEngine.js`
- `.melmap` state handled by map pack importer/exporter modules
- Weather table saved column data and cascade/persistence boundaries

## Required First Reads

- Read `src/main.js` around the relevant `LS_*_KEY`, load, save, and reset paths.
- Read `src/modules/paceEngine.js` before changing pace parameter shape.
- Read `src/modules/mapPackExporter.js` and `src/modules/mapPackImporter.js` for `.melmap` compatibility work.
- Read `references/data-contracts.md` before adding durable fields.

## Gotchas

- Every persistent state variable needs a named `LS_*_KEY`; avoid magic localStorage strings.
- `paceParams` must merge from `{ ...DEFAULT_PACE_PARAMS, ...userParams }`.
- Do not persist generated interval weather times as if they were waypoint user input.
- Changing `.melmap` state requires backward-compatible import behavior.
- Reset defaults must clear or restore all related fields as a coherent group.

## Handoff Format

List the field name, storage location, default value, migration/fallback behavior, and whether the value is user-authored, imported, cached, or computed.

## Verification Checklist

- Search for all reads/writes of the key or field.
- Verify load, save, reset, import, export, and missing-field behavior.
- Run smoke tests if product code changed.
