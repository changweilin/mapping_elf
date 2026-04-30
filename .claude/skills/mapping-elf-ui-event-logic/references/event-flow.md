# Event Flow Notes

## State Change Pattern

For UI controls that change app behavior:

1. Read the control value.
2. Update the canonical in-memory state.
3. Persist through the matching `LS_*_KEY` if the setting is durable.
4. Trigger only the minimum required recomputation.
5. Update UI affordances without rebuilding unrelated panels.

## Common Boundaries

- Route point edits should flow through `MapManager` and then the central waypoint change callback.
- Weather table time/date edits must respect waypoint versus interval point rules.
- Pace control edits should update pace params, recompute stats/times, and refresh only dependent displays.
- Modal open/close handlers should restore focus or at least avoid trapping map interactions behind hidden overlays.

## Browser Verification Targets

- Mobile touch waypoint drag/delete.
- Side panel width and collapse behavior.
- Export/import modal open, option toggles, and cancel/confirm actions.
- Keyboard undo/redo and Escape flows.
