---
name: mapping-elf-ui-event-logic
description: UI behavior and event-logic workflow for Mapping Elf. Use when changing DOM event handlers, Leaflet interactions, waypoint drag/click/touch behavior, keyboard shortcuts, modal open/close flows, panel state, localStorage synchronization from UI controls, or expensive UI rerender behavior in src/main.js and src/modules/mapManager.js.
---

# Mapping Elf UI Event Logic

## Trigger Criteria

Use this skill for behavior bugs or feature work involving clicks, keyboard shortcuts, touch gestures, Leaflet markers, modal flows, side/bottom panels, weather table interactions, and UI state persistence.

Do not use this skill for pure CSS/RWD styling; hand off that work to `mapping-elf-frontend-design`.

## Primary Ownership

- `src/main.js`
- `src/modules/mapManager.js`
- UI-facing state transitions that persist through `localStorage`
- Interaction between event handlers and route/weather/pace updates

## Required First Reads

- Read the relevant handler area in `src/main.js`.
- Read `src/modules/mapManager.js` for Leaflet marker, route, drag, touch, or popup behavior.
- Read `references/event-flow.md` before adding new UI state transitions.

## Gotchas

- Avoid unnecessary `renderWeatherPanel()` calls; it rebuilds expensive DOM.
- Interval date/time inputs are generated state, not direct user-edit targets.
- Imported track mode freezes route-edit controls until replan/clear.
- Leaflet receives `[lat,lng]`, while GeoJSON and routing APIs may use `[lng,lat]`.
- Touch handlers must clean up listeners on cancel/end and avoid leaving drag state stuck.
- New persisted UI state needs a named `LS_*_KEY` constant and load/save symmetry.
- A map overlay driven by a panel/table read-out needs `syncCatchmentBasins()`-style reconcile on EVERY entry point, the all-cached fast path included — filling the table and showing 已更新 while the map stays blank reads as a broken feature. Basin overlays have two independent owners (per-card 集水區 view, and the 集水區 bottom panel's columns).
- Such a reconcile must not itself fetch for bulk (panel/table) rows: the batch loader is already walking the same rows and caching as it goes, so reading again fires every row's DEM at once and rate-limits the endpoint. Draw bulk rows from cache only and let each row's own compute draw it.

## Handoff Format

Describe the user action, affected DOM selectors, state variables, persistence keys, and downstream recomputation expected after the event.

## Verification Checklist

- Confirm keyboard, mouse, and touch paths stay consistent when applicable.
- Confirm event listeners are not duplicated after rerendering.
- Run or request a browser smoke test for modal/panel/Leaflet interactions after product-code changes.
