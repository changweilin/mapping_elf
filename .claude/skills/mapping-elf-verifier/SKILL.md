# Mapping Elf Verifier & Runbooks

## Description
Operational runbooks and product verification procedures. Mapping Elf is a PWA with heavy client-side logic, so pure unit tests miss browser-level edge cases (Service Worker caches, offline tile storage). Verify in a real browser via the project's Playwright drivers (`node test/run-playwright-with-preview.mjs test/<file>.spec.js`).

## Verification Runbooks

### 1. PWA / Offline
- **Cache versioning**: static-asset changes require checking the cache-name strategy in `public/sw.js` (CLAUDE.md INC-251; gated by `test/cache-versioning.spec.js`).
- **Tile storage**: offline tiles go through the **Cache API** (`caches.open(OFFLINE_TILE_CACHE_NAME)` in `offlineManager.js`), not IndexedDB. Verify tile downloads land in that cache and deletes clear it.
- **Simulating offline**: drive DevTools offline mode headlessly, or instruct the user: DevTools → Application → Service Workers → check "Offline" and reload. Watch for unhandled promise rejections.

### 2. Routing (BRouter/OSRM)
- Coordinate order is the #1 bug class: APIs speak `[lng, lat]`, the app and Leaflet speak `[lat, lng]`; conversion happens only at the `routeEngine.js` boundary (CLAUDE.md INC-101).

### 3. GPX Output
- Verify the XML is well-formed, user strings are escaped, and interval points carry `<type>mel:interval</type>` (importer relies on it to skip them).

## Debugging Workflow
1. "Blank page on load" → console errors around imports and Vite base path (CLAUDE.md INC-278); hand off to `mapping-elf-deploy` if deploy-related.
2. "Map not loading" → tile-server/Nominatim rate limits, or offline mode toggle left on.
3. 3D viewer test hangs → see CLAUDE.md INC-310 (loading indicator must appear then disappear; never `waitForSelector('#el.hidden')`).
