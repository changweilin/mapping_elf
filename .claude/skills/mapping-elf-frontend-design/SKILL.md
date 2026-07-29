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

3. **Styling Map Elements**
   - Markers (`custom-waypoint-icon`, `wp-weather-badge`) use HTML and CSS classes injected into Leaflet `L.divIcon`. Edit their styles in the main CSS file. Do not use default Leaflet images.
   - Keep interactions dynamic: Use modern aesthetics, smooth transitions, and responsive feedback for UI components to give a premium feel.

4. **DOM Updates**
   - Avoid aggressive re-rendering. Update only necessary nodes to prevent map flickering.
