# Data Contract Rules

## Durable User Settings

Durable settings may be saved to `localStorage` when they represent explicit user preference, including route mode, map layer, pace settings, display toggles, panel width, and calibration enablement.

Requirements:

- Define a named `LS_*_KEY`.
- Load with a fallback.
- Save after canonical state changes.
- Include reset behavior if reset defaults should affect it.

## Computed or Cascaded Data

Computed data should not be persisted as authoritative user input.

Examples:

- Interval weather times generated from waypoint schedules.
- Derived cumulative route times.
- Elevation-profile stats computed from route/elevation arrays.

## Imported State

Imported `.melmap`, GPX, and KML data may contain route geometry, waypoints, labels, weather/state snapshots, and tiles. Importers should tolerate missing fields and older shapes.

When adding fields:

- Export the new field only where needed.
- Import with null-safe defaults.
- Avoid changing existing meaning of a field.
- Document whether the field should survive round trip.
