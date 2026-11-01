# Mapping Elf Frontend Design

## Description
Guidelines for maintaining the UI, CSS patterns, and responsive behaviors in Mapping Elf.

## Core Rules

1. **Responsive Web Design (RWD)**
   - Prioritize Mobile-First design. Ensure all functional panels (Weather Table, Export Modal, Pace Settings) work seamlessly on small screens (e.g. 320px - 480px width) in both portrait and landscape orientation.
   - Use CSS Media Queries rather than JS width checks where possible.

2. **Z-Index Layering**
   - Leaflet map layers often conflict with UI modals. Ensure Modals have a high `z-index` (e.g., `1000`+) and the overlay backdrop correctly blocks map interactions.
   - Known trap (CLAUDE.md INC-325): the 3D viewer's `canvas-wrap` needs `z-index:1` to keep the loading overlay below toolbar dropdowns. Any overlay/dropdown style change must verify both stacking contexts.
   - The 2D/3D pill (`.view-mode-toggle`, `position:fixed`, z:940) now lives **only inside the 3D viewer** — the 2D map enters 3D from the 環狀功能選單 (`#btn-view-3d` is the 6th `.radial-btn`). Anything that expands into the band under the viewer toolbar — the 3D toolbar's 列印 dropdown — must sit above z:940 or it gets covered and its taps swallowed. Guarded by `test/panel-overlay-bounds.spec.js`.
   - The 環狀功能選單 is the single home for map features: add one `.radial-menu-item`, re-space **every** `--angle` to `360/n` and give the new item its own `--radial-item-color` plus a matching dot in `#btn-features-menu`'s glyph. Guarded by `test/features-radial-menu.spec.js`.

5. **Floating panels vs. the bottom panel**
   - Panels anchored off `--bottom-panel-height` (set by the 分割線 drag) must clamp against the viewport, or dragging the divider up pushes them — and their close button — off the top of the screen. `.measure-panel` pairs a `--mp-bottom` clamp with a matching `max-height` and pins its head `position:sticky`; phones drop the anchor entirely and overlay `#bottom-panel` (z:620 > z:200).
   - **Two vars, two jobs.** `--bottom-panel-height` is the panel's real height (map container, trash zone). Floating UI that must stay reachable — `.map-action-btns`, `.measure-panel`, the 環狀選單 centre — anchors off `--bottom-panel-offset` instead: the same height capped to leave `BOTTOM_PANEL_CLEARANCE` (300px, `main.js`) under the toolbar. `updateMapCenterVariables()` clamps `--map-center-y` into that same band, so a centred panel can never hang above the toolbar. Guarded by `test/panel-overlay-bounds.spec.js` + `test/bottom-panel-collapse.spec.js`.
   - **≥769px the bottom panel tiles with the 設置面板** (`body:has(#side-panel.open) #bottom-panel { right: var(--panel-width) }`) and `.side-panel` keeps `bottom: 0`. Never give the side panel back its `bottom: var(--bottom-panel-height)`: with both full-height-and-full-width, the side panel's sticky header lands on the 分割線 (z:950 vs 200) and swallows the dbl-click that reopens the panel. Phones are exempt — there the side panel is a full-screen sheet.
   - **Collapsed panel** = `.bottom-panel.bp-collapsed`, the grab bar alone (drag past the 56px floor, or the divider's dbl-click cycle 預設 → 全展開 → 全收起 → 預設, both in `initWeatherControls`). Its `display:none` rule must stay **after** the `bp-mode-*` rules — same specificity, so the later one wins. `#route-summary-bar` carries `flex-shrink: 0` on purpose: it is a flex item in elevation mode, and squashing it made the panel's default height depend on its current height.

3. **Styling Map Elements**
   - Markers (`custom-waypoint-icon`, `wp-weather-badge`) use HTML and CSS classes injected into Leaflet `L.divIcon`. Edit their styles in the main CSS file. Do not use default Leaflet images.
   - Keep interactions dynamic: Use modern aesthetics, smooth transitions, and responsive feedback for UI components to give a premium feel.

4. **DOM Updates**
   - Avoid aggressive re-rendering. Update only necessary nodes to prevent map flickering.
