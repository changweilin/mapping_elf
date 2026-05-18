# Offline Tile Strategy

Reviewed: 2026-05-18

This note turns the pre-app optimization offline-map item into an implementation boundary. It documents the current `.melmap` tile behavior, the sizing model, the cleanup plan, and the provider-license checks that must happen before a public app release.

## Current Behavior

- Offline tiles live in the Cache API cache named `mapping-elf-tiles`.
- `.melmap` export can include route GPX, allow-listed `localStorage` state, and raster tiles for the current map layer.
- `.melmap` route/state export stays available for every map layer, but tile export is disabled when the current provider is outside the offline export allow-list.
- Tile exports use the route bounds padded by 5%, then enumerate zoom levels from `8` through `min(17, layerInfo.maxZoom)` until the 8000-tile cap is reached.
- Exported tile files are stored as `tiles/{layer}/{z}/{x}/{y}.png`.
- Import restores tiles into `mapping-elf-tiles` and expands subdomain/retina URL variants so Leaflet can hit the cache regardless of the chosen subdomain.
- Imported/exported tile URLs are tracked in `mapping-elf-tile-index` so a future UI can remove one pack without guessing from the current route.
- The existing "clear cache" behavior deletes the whole `mapping-elf-tiles` cache and the tile pack index.

Relevant code:

- `src/modules/tileEstimator.js`: shared zoom range, 8000-tile cap, bounds-to-tile enumeration, and tile-count estimate.
- `src/main.js`: `_estimateTileCountForMapPack()`, `doExportMapPack()`, `.melmap` import modal flow.
- `src/modules/mapPackExporter.js`: manifest fields, shared tile enumeration, tile fetch/cache.
- `src/modules/mapManager.js`: tile layer provider metadata used by `.melmap` manifests.
- `src/modules/mapPackImporter.js`: manifest validation, tile restore, subdomain expansion.
- `src/modules/offlineTileIndex.js`: Cache API pack index, pack add/delete helpers, shared cache names.
- `src/modules/offlineManager.js`: service worker registration, cache count display, full cache clearing.

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
- `test/import-export.spec.js` checks that the export modal's tile estimate matches the exported `.melmap` `manifest.tileCount`.
- Tile-enabled `.melmap` exports include optional `manifest.tileProvider` metadata with provider id, name, attribution, and homepage when available.
- Provider allow-list metadata lives with the map layer definitions. Blocked providers disable only the tile checkbox, leaving route and state export available.
- Tile import/export writes a local pack index in `mapping-elf-tile-index`. The index stores source, layer, bounds, zoom range, provider, status, tile counts, and concrete cache URLs; it is not embedded in `.melmap` and is not stored in `localStorage`.

Future implementation guard:

- For byte-size display, calculate actual downloaded byte totals during export and report `tileCount`, `downloadedTileCount`, and `zipBlob.size`. Do not persist route coordinates for analytics.

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
| Streets | `basemaps.cartocdn.com` | Keep attribution visible; verify CARTO basemap/offline redistribution terms before enabling public app tile packs. |
| Topo | `tile.opentopomap.org` | Attribution and CC-BY-SA handling are required; service status is changing toward vector tiles, so keep this layer swappable. |
| Satellite | `server.arcgisonline.com` | Tile export disabled until Esri/ArcGIS licensing is confirmed for the app use case. |
| OSMF Standard | `tile.openstreetmap.org` | Do not add offline download support; OSMF policy prohibits bulk/offline tile archives. |

Source checks used for this note:

- CARTO attribution: https://carto.com/attribution/
- OpenTopoMap usage/about: https://services.opentopomap.org/about
- OSMF tile usage policy: https://operations.osmfoundation.org/policies/tiles/
- Esri basemap attribution guidance: https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040
- Esri website terms, third-party imagery and attribution sections: https://www.esri.com/content/dam/esrisites/en-us/media/legal/terms-and-conditions/website-terms.pdf

## Native App Checklist

- App tile requests should identify Mapping Elf with a stable app User-Agent or platform-provided app identifier where the provider requires it.
- Export UI should show tile count, current layer, and a provider warning before downloading tiles.
- `.melmap` manifest includes attribution/provider metadata when tiles are included.
- If a provider is not allow-listed for offline export, keep route/state export enabled but disable the tile checkbox with a clear reason. This is now implemented for the satellite layer.
- Re-check provider terms before each store release that changes map layers or offline behavior.
