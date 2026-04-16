---
name: mapping-elf-offline-map
description: Reference for offline map tile downloading, PWA config, Service Worker (sw.js) caching, and IndexedDB usage. Trigger when modifying offlineManager.js, caching strategies, or fixing PWA silent failures.
type: library
---

# Mapping Elf — Offline Map & PWA Reference

Source: `src/modules/offlineManager.js`, `public/sw.js`

## Core Responsibilities
- Caching Leaflet map tiles for offline usage (usually via IndexedDB or Cache API).
- Managing PWA lifecycle and precaching core assets.
- Handling CORS when fetching map tiles from external domains (e.g., OpenStreetMap, SunRiver).

## PWA & Service Worker Rules
- `sw.js` MUST use relative paths when caching assets to ensure it works properly under GitHub Pages subdirectories (`/mapping_elf/`).
- Cache busting and versioning should be explicitly managed in `sw.js` (e.g., `CACHE_NAME = 'mapping-elf-v2'`).

## Offline Manager Logic
- Map tiles are often handled by local storage mechanisms or Service Worker interceptions.
- Downloading map tiles requires estimating bounds, determining zoom levels (usually Z13 to Z15 for hiking), and calculating tile URL coordinates (X/Y/Z).
- Downloading must be throttled to prevent IP bans from public tile servers.

## Gotchas
- **Silent Failures:** Cache API failing silently due to CORS (Opaque responses) can bloat storage or render blank tiles. Make sure to set `mode: 'cors'` if the server allows, or handle opaque responses defensively.
- **Storage Quota:** Downloading large areas on high zoom levels will hit browser storage limits fast. Ensure there are UI constraints on bounding boxes or zoom depths.
- **Vite Build:** Service worker registration must happen correctly after Vite builds; ensure URLs reflect the Vite `dist/` structure securely.
