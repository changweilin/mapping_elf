/**
 * Mapping Elf — Map Pack Exporter
 *
 * Produces a .melmap ZIP containing any combination of:
 *   - manifest.json  (always)
 *   - route.gpx      (optional)
 *   - state.json     (optional — localStorage snapshot)
 *   - tiles/{layer}/{z}/{x}/{y}.png  (optional — current layer only)
 *
 * JSZip is pre-loaded at the top for reliability across environments.
 */
import JSZip from 'jszip';
import { MELMAP_STATE_KEYS } from './stateKeys.js';
import {
  enumerateMapPackTiles,
  tilesForBoundsZoom,
} from './tileEstimator.js';
import {
  OFFLINE_TILE_CACHE_NAME,
  addOfflineTilePack,
} from './offlineTileIndex.js';
import { platform } from '../platform/index.js';

const MELMAP_VERSION = 1;

// CARTO/OpenTopoMap use {a,b,c} subdomains; Esri has no {s}. When writing
// tiles into Cache API on import we replicate the response under every
// subdomain so Leaflet's hash-based subdomain pick always hits.
const SUBDOMAINS = ['a', 'b', 'c'];
const RETINA_SUFFIXES = ['', '@2x'];

const LS_STATE_KEYS = MELMAP_STATE_KEYS;

function buildTileProviderManifest(layerInfo) {
  const provider = layerInfo?.provider || {};
  return {
    id: provider.id || layerInfo?.name || null,
    name: provider.name || layerInfo?.name || null,
    attribution: provider.attribution || layerInfo?.attribution || null,
    homepage: provider.homepage || null,
  };
}

function cleanText(value, fallback = null) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const normalized = {
    north: cleanNumber(bounds.north),
    south: cleanNumber(bounds.south),
    east: cleanNumber(bounds.east),
    west: cleanNumber(bounds.west),
  };
  return Object.values(normalized).every((value) => value !== null) ? normalized : null;
}

function normalizeRouteManifest(routeMeta = {}) {
  if (!routeMeta || typeof routeMeta !== 'object') return null;
  const pointCount = Math.max(0, Number(routeMeta.pointCount || 0));
  const waypointCount = Math.max(0, Number(routeMeta.waypointCount || 0));
  const route = {
    id: cleanText(routeMeta.id),
    fingerprint: cleanText(routeMeta.fingerprint),
    name: cleanText(routeMeta.name, 'Mapping Elf Track'),
    distanceM: cleanNumber(routeMeta.distanceM),
    pointCount,
    waypointCount,
    bounds: normalizeBounds(routeMeta.bounds),
  };
  return route.name || route.fingerprint || route.pointCount > 0 ? route : null;
}

function getOfflineTileExportPolicy(layerInfo) {
  const policy = layerInfo?.provider?.offlineTileExport;
  if (policy?.allowed === false) {
    return {
      allowed: false,
      reason: policy.reason || '此圖層暫不支援離線圖磚匯出',
    };
  }
  return { allowed: true, reason: '' };
}

export class MapPackExporter {
  /**
   * Build a .melmap Blob.
   *
   * @param {Object}   opts
   * @param {Object}   opts.bounds           Leaflet LatLngBounds (has get{North,South,East,West}())
   * @param {Array}    opts.routeCoords      [[lat,lng], ...]
   * @param {Object}   opts.layerInfo        { urlTemplate, maxZoom, name }
   * @param {boolean}  opts.includeRoute
   * @param {boolean}  opts.includeWeather
   * @param {boolean}  opts.includeTiles
   * @param {boolean}  opts.includeState
   * @param {string}   opts.sharePreset
   * @param {Object}   opts.routeMeta
   * @param {string}   opts.gpxXml           Pre-built GPX (required if includeRoute)
   * @param {string}   opts.filenameBase
   * @param {Function} opts.onProgress       (current, total, phase) → void
   * @returns {Promise<{blob: Blob, filename: string, tileCount: number, downloadedTileCount: number, downloadedTileBytes: number, zipBytes: number}>}
   */
  static async export({
    bounds,
    routeCoords,
    layerInfo,
    includeRoute,
    includeWeather = true,
    includeTiles,
    includeState,
    sharePreset = null,
    routeMeta = null,
    gpxXml,
    filenameBase = 'mapping-elf-pack',
    onProgress = () => {},
  }) {
    if (!includeRoute && !includeTiles && !includeState) {
      throw new Error('至少需勾選一項內容才能匯出');
    }

    const zip = new JSZip();

    // ---- manifest.json (always) ----
    const manifest = {
      version: MELMAP_VERSION,
      generator: 'Mapping Elf',
      createdAt: new Date().toISOString(),
      includes: {
        route: !!includeRoute,
        weather: !!(includeRoute && includeWeather),
        tiles: !!includeTiles,
        state: !!includeState,
      },
      sharePreset: sharePreset || null,
      route: includeRoute ? normalizeRouteManifest(routeMeta) : null,
      resources: {
        route: {
          included: !!includeRoute,
          weatherIncluded: !!(includeRoute && includeWeather),
        },
        state: {
          included: !!includeState,
          keyCount: 0,
        },
        tiles: {
          included: !!includeTiles,
          status: includeTiles ? 'pending' : 'not-included',
        },
      },
      layer: null,
      bounds: null,
      minZoom: null,
      maxZoom: null,
      tileCount: 0,
      downloadedTileCount: 0,
      downloadedTileBytes: 0,
      tileProvider: null,
    };

    // ---- route.gpx ----
    if (includeRoute) {
      if (!gpxXml) throw new Error('匯出路線時需要 GPX 資料');
      zip.file('route.gpx', gpxXml);
    }

    // ---- state.json ----
    if (includeState) {
      const snapshot = {};
      for (const key of LS_STATE_KEYS) {
        const v = localStorage.getItem(key);
        if (v !== null) snapshot[key] = v;
      }
      manifest.resources.state.keyCount = Object.keys(snapshot).length;
      zip.file('state.json', JSON.stringify(snapshot, null, 2));
    }

    // ---- tiles/ ----
    let totalTiles = 0;
    let downloadedTileCount = 0;
    let downloadedTileBytes = 0;
    if (includeTiles) {
      const tilePolicy = getOfflineTileExportPolicy(layerInfo);
      if (!tilePolicy.allowed) throw new Error(tilePolicy.reason || '此圖層暫不支援離線圖磚匯出');
      if (!bounds || !layerInfo) throw new Error('匯出圖磚時需要 bounds 與 layerInfo');
      if (!routeCoords || routeCoords.length < 2) throw new Error('匯出圖磚時需先建立路線');

      const { minZoom, maxZoom, tiles } = enumerateMapPackTiles(bounds, layerInfo);
      totalTiles = tiles.length;

      manifest.layer = layerInfo.name;
      manifest.bounds = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      };
      manifest.minZoom = minZoom;
      manifest.maxZoom = maxZoom;
      manifest.tileCount = totalTiles;
      manifest.tileProvider = buildTileProviderManifest(layerInfo);
      manifest.resources.tiles.layer = layerInfo.name;
      manifest.resources.tiles.provider = manifest.tileProvider;
      manifest.resources.tiles.bounds = manifest.bounds;
      manifest.resources.tiles.minZoom = minZoom;
      manifest.resources.tiles.maxZoom = maxZoom;
      manifest.resources.tiles.expectedTileCount = totalTiles;

      const cache = 'caches' in self ? await caches.open(OFFLINE_TILE_CACHE_NAME) : null;
      const cachedTileUrls = new Set();
      onProgress(0, totalTiles, 'tiles');

      const chunkSize = 10;
      let done = 0;
      for (let i = 0; i < tiles.length; i += chunkSize) {
        const chunk = tiles.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async ({ z, x, y }) => {
            const result = await this._fetchTile(layerInfo.urlTemplate, z, x, y, cache);
            if (result?.blob) {
              zip.file(`tiles/${layerInfo.name}/${z}/${x}/${y}.png`, result.blob);
              downloadedTileCount++;
              downloadedTileBytes += result.blob.size || 0;
              (result.cacheUrls || []).forEach((url) => cachedTileUrls.add(url));
            }
            done++;
            onProgress(done, totalTiles, 'tiles');
          })
        );
      }
      manifest.downloadedTileCount = downloadedTileCount;
      manifest.downloadedTileBytes = downloadedTileBytes;
      manifest.resources.tiles.status = downloadedTileCount === totalTiles ? 'complete' : 'incomplete';
      manifest.resources.tiles.cachedTileCount = downloadedTileCount;
      manifest.resources.tiles.tileBytes = downloadedTileBytes;

      await addOfflineTilePack({
        source: 'export',
        status: downloadedTileCount === totalTiles ? 'complete' : 'incomplete',
        route: manifest.route,
        sharePreset,
        layer: layerInfo.name,
        bounds: manifest.bounds,
        minZoom,
        maxZoom,
        expectedTileCount: totalTiles,
        cachedTileCount: downloadedTileCount,
        tileBytes: downloadedTileBytes,
        provider: manifest.tileProvider,
        tileUrls: [...cachedTileUrls],
      });
    }

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    onProgress(0, 1, 'zip');
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },   // PNG already compressed — don't re-compress
      (meta) => onProgress(Math.round(meta.percent), 100, 'zip')
    );
    onProgress(1, 1, 'zip');
    const zipBytes = blob.size || 0;

    return {
      blob,
      filename: `${filenameBase}.melmap`,
      tileCount: totalTiles,
      downloadedTileCount,
      downloadedTileBytes,
      zipBytes,
    };
  }

  static _enumerateTiles(bounds, layerInfo) {
    return enumerateMapPackTiles(bounds, layerInfo);
  }

  static _tilesForZoom(bounds, z) {
    return tilesForBoundsZoom(bounds, z);
  }

  static async _fetchTile(urlTemplate, z, x, y, cache) {
    // Try cache first (any subdomain), then fall back to network.
    const candidates = this._expandSubdomains(urlTemplate, z, x, y);
    if (cache) {
      for (const url of candidates) {
        try {
          const hit = await cache.match(url);
          if (hit) return { blob: await hit.blob(), cacheUrls: [url] };
        } catch (_) { /* fall through */ }
      }
    }
    for (const url of candidates) {
      try {
        const resp = await fetch(url, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          const cacheUrls = [];
          if (cache) {
            try {
              await cache.put(url, new Response(blob, { headers: resp.headers }));
              cacheUrls.push(url);
            } catch (_) {}
          }
          return { blob, cacheUrls };
        }
      } catch (_) { /* try next */ }
    }
    return null;
  }

  static _expandSubdomains(urlTemplate, z, x, y) {
    const base = urlTemplate
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
    const retinaBases = base.includes('{r}')
      ? RETINA_SUFFIXES.map((suffix) => base.replace('{r}', suffix))
      : [base];
    return retinaBases.flatMap((retinaBase) => (
      retinaBase.includes('{s}')
        ? SUBDOMAINS.map((s) => retinaBase.replace('{s}', s))
        : [retinaBase]
    ));
  }

  static triggerDownload(blob, filename) {
    return platform.downloadFile({
      filename,
      mimeType: 'application/zip',
      content: blob,
    });
  }
}

export { LS_STATE_KEYS, MELMAP_VERSION, SUBDOMAINS };
