# Offline Tile Strategy

Reviewed: 2026-05-18

This note turns the pre-app optimization offline-map item into an implementation boundary. It documents the current `.melmap` tile behavior, the sizing model, the cleanup plan, and the provider-license checks that must happen before a public app release.

## Current Behavior

- Offline tiles live in the Cache API cache named `mapping-elf-tiles`.
- `.melmap` export can include route GPX, allow-listed `localStorage` state, and raster tiles for the current map layer.
- Tile exports use the route bounds padded by 5%, then enumerate zoom levels from `8` through `min(17, layerInfo.maxZoom)` until the 8000-tile cap is reached.
- Exported tile files are stored as `tiles/{layer}/{z}/{x}/{y}.png`.
- Import restores tiles into `mapping-elf-tiles` and expands subdomain/retina URL variants so Leaflet can hit the cache regardless of the chosen subdomain.
- The existing "clear cache" behavior deletes the whole `mapping-elf-tiles` cache. It does not yet know which route or `.melmap` pack owns a tile.

Relevant code:

- `src/main.js`: `_estimateTileCountForMapPack()`, `doExportMapPack()`, `.melmap` import modal flow.
- `src/modules/mapPackExporter.js`: `MAX_TILES = 8000`, manifest fields, tile enumeration, tile fetch/cache.
- `src/modules/mapPackImporter.js`: manifest validation, tile restore, subdomain expansion.
- `src/modules/offlineManager.js`: service worker registration, cache count display, full cache clearing.

## Size Estimation

Use tile count as the primary app-facing estimate. Byte size is provider- and area-dependent, so it should be shown as a rough range only after measuring real downloaded blobs.

The tile-count formula must stay aligned between the UI and exporter:

1. Build bounds from `L.latLngBounds(currentRouteCoords).pad(0.05)`.
2. For each zoom `z = 8..min(17, layerInfo.maxZoom)`, convert west/east/north/south into slippy tile `x/y`.
3. Count `(xMax - xMin + 1) * (yMax - yMin + 1)`.
4. Stop before adding a zoom level that would exceed `8000` total tiles.

Future implementation guard:

- Extract this enumeration into one shared helper used by both `_estimateTileCountForMapPack()` and `MapPackExporter.export()`.
- Add a regression test that compares the modal estimate with the exported `manifest.tileCount`.
- For byte-size display, calculate actual downloaded byte totals during export and report `tileCount`, `downloadedTileCount`, and `zipBlob.size`. Do not persist route coordinates for analytics.

## Cleanup Model

The current all-or-nothing cache delete is safe but too blunt for App use. Per-route cleanup should be added as a pack index, not by guessing from current route bounds.

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

- Prefer IndexedDB for the index if tile URL lists grow large.
- A single Cache API JSON entry is acceptable for a first pass if the index stays small.
- Avoid large `localStorage` tile indexes; reserve `localStorage` for user preferences and small manifests.

Deletion rules:

- Deleting one pack removes only tile URLs that no other pack references.
- "Clear all offline tiles" remains available and deletes `mapping-elf-tiles` plus the pack index.
- Imported `.melmap` tile cleanup should be user-initiated. Do not automatically delete tiles just because the visible route changes.
- Failed partial imports should either roll back inserted tiles or mark the pack as incomplete so cleanup can find it.

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
| Satellite | `server.arcgisonline.com` | Treat offline redistribution as blocked until Esri/ArcGIS licensing is confirmed for the app use case. |
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
- `.melmap` manifest should include attribution/provider metadata when tiles are included.
- If a provider is not allow-listed for offline export, keep route/state export enabled but disable the tile checkbox with a clear reason.
- Re-check provider terms before each store release that changes map layers or offline behavior.
