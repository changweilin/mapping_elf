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

### 4. Writing 3D / route e2e steps
- **There is no viewer close button.** `#tv-close-btn` does not exist anywhere in the app; leaving the 3D viewer goes through the unified 2D/3D pill — `#tv-view-2d` is wired straight to `closeTerrainViewer()` (which also clears the resume-restore marker).
- **`await expect('#tv-loading').toBeHidden()` is not a build gate on its own** — it is already hidden before a build starts, so it passes instantly against a build that never began (INC-310). Assert `#terrain-viewer` is not `hidden` first, then the loading gate, then the canvas.
- **Map clicks are swallowed while the route/weather cycle runs**, and every added waypoint starts its own cycle. Wait for `#route-weather-busy-overlay` to be hidden *before* each click, not just after the last one.
- **Playback advances by real elapsed time** (`dt` capped at 0.1 s/frame), so a slow runner walks the route slower in wall-clock terms. Select 4x via `#tp-speed-toggle` → `.tp-speed-opt[data-speed="4"]` instead of widening the timeout; `_animate()` snaps the playhead back onto any stop a frame steps over, so a stop can never be skipped.

### 5. CI shard balance
- Playwright shards **whole files** while `fullyParallel` is false, so a single heavy file pins one job: all terrain-3d tests landed on shard 4 and it ran 29 min against another shard's 2 min. `fullyParallel: true` + `workers: 1` splits shards per test without letting anything run concurrently — every spec here owns its own `page` fixture, so per-test splitting is safe.
- Retries multiply the cost of a genuinely broken heavy test (1.5 min × 3 attempts). If a shard's wall-clock jumps, read the log for repeated `(retry #N)` lines before assuming the suite grew.

## Debugging Workflow
1. "Blank page on load" → console errors around imports and Vite base path (CLAUDE.md INC-278); hand off to `mapping-elf-deploy` if deploy-related.
2. "Map not loading" → tile-server/Nominatim rate limits, or offline mode toggle left on.
3. 3D viewer test hangs → see CLAUDE.md INC-310 (loading indicator must appear then disappear; never `waitForSelector('#el.hidden')`).
