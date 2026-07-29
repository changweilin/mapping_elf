---
name: mapping-elf-offline-map
description: Reference for offline map tile downloading, PWA config, Service Worker (sw.js) caching, and offline tile storage. Trigger when modifying offlineManager.js, caching strategies, or fixing PWA silent failures.
type: library
---

# Mapping Elf — Offline Map & PWA Reference

Source: `src/modules/offlineManager.js`, `public/sw.js`, `src/modules/offlineTileIndex.js`

## Core Responsibilities
- Caching Leaflet map tiles for offline usage via the **Cache API** (`caches.open(OFFLINE_TILE_CACHE_NAME)` in `offlineManager.js`; `sw.js` intercepts tile-domain fetches with its own `TILE_CACHE` / `APP_CACHE`). Not IndexedDB.
- Managing PWA lifecycle and precaching core assets.
- Handling CORS when fetching map tiles from external domains.

## PWA & Service Worker Rules
- SW registration uses `import.meta.env.BASE_URL + 'sw.js'` so it works under both Vite base modes (CLAUDE.md INC-278). Never hard-code the path.
- Cache versioning is explicit in `sw.js` cache names and gated by `test/cache-versioning.spec.js` (CLAUDE.md INC-251) — check it whenever precached assets change.

## Offline Manager Logic
- Downloading tiles = estimate bounds → pick zoom levels (typically Z13–Z15 for hiking) → compute X/Y/Z tile URLs.
- Downloading must be throttled to prevent IP bans from public tile servers.

## Gotchas
- **Silent failures:** Cache API failing silently on CORS (opaque responses) can bloat storage or render blank tiles. Use `mode: 'cors'` where the server allows, or handle opaque responses defensively.
- **Storage quota:** large areas at high zoom hit browser storage limits fast; keep UI constraints on bounding box and zoom depth.
