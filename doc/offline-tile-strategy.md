# Offline Tile Strategy

Reviewed: 2026-05-20

> Management note: technical boundaries stay here, but release status, provider-term blockers, and next actions are centralized in [`../TODO.md`](../TODO.md).

This note turns the pre-app optimization offline-map item into an implementation boundary. It documents the current `.melmap` tile behavior, the sizing model, the cleanup plan, and the provider-license checks that must happen before a public app release.

## Current Behavior

- Offline tiles live in the Cache API cache named `mapping-elf-tiles`.
- `.melmap` export can include route GPX and allow-listed `localStorage` state. Raster tile export is implemented, but the bundled public providers are currently disabled for public release until offline redistribution permission is confirmed.
- `.melmap` route/state export stays available for every map layer, but tile export is disabled when the current provider is outside the offline export allow-list.
- Native app offline basemap imports are managed separately from `.melmap`: Android can register copied Mapsforge `.map` and MBTiles files in the Cache API index named `mapping-elf-offline-map-sources`; web builds expose the registry state but do not enable import.
- Android can render raster MBTiles sources through the native `OfflineMaps.getOfflineMapTile` bridge and a Leaflet `GridLayer`. Mapsforge `.map` imports remain managed but marked `pending-native-renderer` until a Mapsforge renderer is added.
- Tile exports use the route bounds padded by 5%, then enumerate zoom levels from `8` through `min(17, layerInfo.maxZoom)` until the 8000-tile cap is reached.
- Exported tile files are stored as `tiles/{layer}/{z}/{x}/{y}.png`.
- Import restores tiles into `mapping-elf-tiles` and expands subdomain/retina URL variants so Leaflet can hit the cache regardless of the chosen subdomain.
- Imported/exported tile URLs and measured tile bytes are tracked in `mapping-elf-tile-index` so the UI can remove one pack and estimate future pack size without guessing from the current route.
- The existing "clear cache" behavior deletes the whole `mapping-elf-tiles` cache and the tile pack index.
- The file-management panel lists indexed offline tile packs and can delete one pack while preserving any tile URLs still referenced by other packs.

Relevant code:

- `src/modules/tileEstimator.js`: shared zoom range, 8000-tile cap, bounds-to-tile enumeration, and tile-count estimate.
- `src/main.js`: `_estimateTileCountForMapPack()`, `doExportMapPack()`, `.melmap` import modal flow.
- `src/modules/mapPackExporter.js`: manifest fields, shared tile enumeration, tile fetch/cache.
- `src/modules/mapManager.js`: tile layer provider metadata used by `.melmap` manifests.
- `src/modules/mapPackImporter.js`: manifest validation, tile restore, subdomain expansion.
- `src/modules/offlineTileIndex.js`: Cache API pack index, pack add/delete helpers, shared cache names.
- `src/modules/offlineManager.js`: service worker registration, cache count display, full cache clearing.
- `src/modules/offlineMapSourceIndex.js`: app-only offline basemap source registry for native imports.
- `android/app/src/main/java/com/mappingelf/app/OfflineMapsPlugin.java`: Android document-picker bridge that copies `.map` and `.mbtiles` files into app-private storage and reads raster MBTiles tiles through SQLite.

## Size Estimation

Use tile count as the primary app-facing estimate. Byte size is provider- and area-dependent, so it should be shown as a rough range only after measuring real downloaded blobs.

The tile-count formula must stay aligned between the UI and exporter:

1. Build bounds from `L.latLngBounds(currentRouteCoords).pad(0.05)`.
2. For each zoom `z = 8..min(17, layerInfo.maxZoom)`, convert west/east/north/south into slippy tile `x/y`.
3. Count `(xMax - xMin + 1) * (yMax - yMin + 1)`.
4. Stop before adding a zoom level that would exceed `8000` total tiles.

Implemented guard:

- Shared enumeration lives in `src/modules/tileEstimator.js` and is used by both `_estimateTileCountForMapPack()` and `MapPackExporter.export()`.
- `test/numeric-regression.mjs` checks estimator/enumerator alignment and the 8000-tile cap.
- `test/import-export.spec.js` checks that provider-gated layers disable the tile checkbox while leaving route/state `.melmap` export available, and that imported tile packs still write and clear the offline tile index.
- When a provider is explicitly allow-listed, tile exports record actual `manifest.downloadedTileCount` and `manifest.downloadedTileBytes`, and the export success message reports the final ZIP size.
- Tile-enabled `.melmap` exports include optional `manifest.tileProvider` metadata with provider id, name, attribution, and homepage when available.
- Provider allow-list metadata lives with the map layer definitions. Blocked providers disable only the tile checkbox, leaving route and state export available. As of the 2026-05-20 release review, all bundled public raster providers are blocked for tile export by default.
- Tile import/export writes a local pack index in `mapping-elf-tile-index`. The index stores source, layer, bounds, zoom range, provider, status, tile counts, measured tile bytes, and concrete cache URLs; it is not embedded in `.melmap` and is not stored in `localStorage`.
- The export modal uses measured bytes from previous indexed packs to show a rough pre-export byte-size preview. It prefers same-provider samples, then same-layer samples, then all measured packs; if no measured sample exists it keeps the original tile-count-only estimate.
- The indexed packs render in the file-management panel with byte size and per-pack delete controls, and `test/import-export.spec.js` verifies deleting one imported pack removes its cached URLs and index entry.
- Byte-size estimates never persist route coordinates for analytics.

## Cleanup Model

The current all-or-nothing cache delete is safe but too blunt for App use. Per-route cleanup is backed by a pack index, not by guessing from current route bounds.

Recommended index:

```json
{
  "version": 1,
  "packs": {
    "pack-id": {
      "createdAt": "2026-05-18T00:00:00.000Z",
      "source": "import|export|route-cache",
      "layer": "topo",
      "bounds": { "north": 0, "south": 0, "east": 0, "west": 0 },
      "minZoom": 8,
      "maxZoom": 15,
      "tileBytes": 1048576,
      "tileUrls": ["https://.../{z}/{x}/{y}.png"]
    }
  }
}
```

Storage choice:

- Prefer IndexedDB later if tile URL lists grow large.
- First pass uses a single Cache API JSON entry in `mapping-elf-tile-index`.
- Avoid large `localStorage` tile indexes; reserve `localStorage` for user preferences and small manifests.

Deletion rules:

- `deleteOfflineTilePack(packId)` removes only tile URLs that no other pack references.
- "Clear all offline tiles" remains available and deletes `mapping-elf-tiles` plus the pack index.
- The single-pack delete UI is user-initiated from the file-management panel.
- Imported `.melmap` tile cleanup should be user-initiated. Do not automatically delete tiles just because the visible route changes.
- Failed partial imports/exports are marked as incomplete so cleanup can find inserted tiles.

## Provider Gate

Offline download/export should be controlled by a provider allow-list. A layer should be eligible only when the project has verified:

- attribution text required on-screen and in exported `.melmap` metadata;
- whether offline caching/prefetching is allowed;
- whether redistributing cached tiles inside `.melmap` is allowed;
- request identification requirements for native apps;
- rate limits, transaction limits, or terms that can change after release.

Current layer notes:

| Layer | URL host | Release posture |
| --- | --- | --- |
| Streets | `basemaps.cartocdn.com` | Tile export disabled. CARTO docs now state commercial use requires an Enterprise license; offline redistribution still needs explicit confirmation before enabling app tile packs. |
| Topo | `tile.opentopomap.org` | Tile export disabled. Attribution and CC-BY-SA handling are required; raster tiles are deprecated and the service is moving toward vector tiles, so keep this layer swappable. |
| Satellite | `server.arcgisonline.com` | Tile export disabled until Esri/ArcGIS licensing is confirmed for the app use case. |
| OSMF Standard | `tile.openstreetmap.org` | Do not add offline download support; OSMF policy prohibits bulk/offline tile archives. |

Source checks used for this note:

- CARTO attribution: https://carto.com/attribution/
- CARTO basemap license/pricing FAQ: https://docs.carto.com/faqs/carto-basemaps
- OpenTopoMap usage/about: https://services.opentopomap.org/about
- OSMF tile usage policy: https://operations.osmfoundation.org/policies/tiles/
- Esri offline data guide: https://developers.arcgis.com/documentation/offline-mapping-apps/partially-offline-apps/offline-data/
- Esri basemap attribution guidance: https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040
- Esri website terms, third-party imagery and attribution sections: https://www.esri.com/content/dam/esrisites/en-us/media/legal/terms-and-conditions/website-terms.pdf

## Native App Checklist

- App tile requests should identify Mapping Elf with a stable app User-Agent or platform-provided app identifier where the provider requires it.
- Export UI should show tile count, current layer, and a provider warning before downloading tiles.
- `.melmap` manifest includes attribution/provider metadata when tiles are included.
- If a provider is not allow-listed for offline export, keep route/state export enabled but disable the tile checkbox with a clear reason. This is now implemented for the bundled streets, topo, and satellite layers.
- Re-check provider terms before each store release that changes map layers or offline behavior.

## Native Basemap Source Imports

This is distinct from `.melmap` tile packs. `.melmap` remains a route/state/share format and must not embed full-size third-party basemap files such as Lu map/Rudy map `.map` files.

Current contract:

```json
{
  "version": 1,
  "sources": {
    "offline-map-mapsforge-example": {
      "source": "native-import",
      "platform": "android",
      "name": "MOI_OSM_Taiwan_TOPO_Lite.map",
      "format": "mapsforge",
      "rendererStatus": "pending-native-renderer",
      "storage": {
        "kind": "app-private-file",
        "relativePath": "offline_maps/MOI_OSM_Taiwan_TOPO_Lite.map"
      },
      "file": {
        "sizeBytes": 123456789,
        "checksumSha256": "..."
      }
    }
  }
}
```

Rules:

- Android import copies selected `.map` or `.mbtiles` files into app-private `offline_maps/` storage and records size/checksum metadata.
- Web import stays disabled because browsers cannot reliably persist and render these native basemap files.
- Raster MBTiles imports are marked `ready` and can be activated as a native offline Leaflet layer. Vector MBTiles are marked `unsupported-vector-tiles`.
- Mapsforge `.map` imports are intentionally marked `pending-native-renderer` until a Mapsforge renderer is wired in.
- Deleting a source should remove both the registry entry and the app-private file when native storage is available.
