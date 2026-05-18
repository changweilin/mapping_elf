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
import { platform } from '../platform/index.js';

const MELMAP_VERSION = 1;

// CARTO/OpenTopoMap use {a,b,c} subdomains; Esri has no {s}. When writing
// tiles into Cache API on import we replicate the response under every
// subdomain so Leaflet's hash-based subdomain pick always hits.
const SUBDOMAINS = ['a', 'b', 'c'];
const RETINA_SUFFIXES = ['', '@2x'];

const LS_STATE_KEYS = MELMAP_STATE_KEYS;

export class MapPackExporter {
  /**
   * Build a .melmap Blob.
   *
   * @param {Object}   opts
   * @param {Object}   opts.bounds           Leaflet LatLngBounds (has get{North,South,East,West}())
   * @param {Array}    opts.routeCoords      [[lat,lng], ...]
   * @param {Object}   opts.layerInfo        { urlTemplate, maxZoom, name }
   * @param {boolean}  opts.includeRoute
   * @param {boolean}  opts.includeTiles
   * @param {boolean}  opts.includeState
   * @param {string}   opts.gpxXml           Pre-built GPX (required if includeRoute)
   * @param {string}   opts.filenameBase
   * @param {Function} opts.onProgress       (current, total, phase) → void
   * @returns {Promise<{blob: Blob, filename: string, tileCount: number}>}
   */
  static async export({
    bounds,
    routeCoords,
    layerInfo,
    includeRoute,
    includeTiles,
    includeState,
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
        tiles: !!includeTiles,
        state: !!includeState,
      },
      layer: null,
      bounds: null,
      minZoom: null,
      maxZoom: null,
      tileCount: 0,
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
      zip.file('state.json', JSON.stringify(snapshot, null, 2));
    }

    // ---- tiles/ ----
    let totalTiles = 0;
    if (includeTiles) {
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

      const cache = 'caches' in self ? await caches.open('mapping-elf-tiles') : null;
      onProgress(0, totalTiles, 'tiles');

      const chunkSize = 10;
      let done = 0;
      for (let i = 0; i < tiles.length; i += chunkSize) {
        const chunk = tiles.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async ({ z, x, y }) => {
            const blob = await this._fetchTile(layerInfo.urlTemplate, z, x, y, cache);
            if (blob) {
              zip.file(`tiles/${layerInfo.name}/${z}/${x}/${y}.png`, blob);
            }
            done++;
            onProgress(done, totalTiles, 'tiles');
          })
        );
      }
    }

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    onProgress(0, 1, 'zip');
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },   // PNG already compressed — don't re-compress
      (meta) => onProgress(Math.round(meta.percent), 100, 'zip')
    );
    onProgress(1, 1, 'zip');

    return {
      blob,
      filename: `${filenameBase}.melmap`,
      tileCount: totalTiles,
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
          if (hit) return await hit.blob();
        } catch (_) { /* fall through */ }
      }
    }
    for (const url of candidates) {
      try {
        const resp = await fetch(url, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          if (cache) {
            try { await cache.put(url, new Response(blob, { headers: resp.headers })); } catch (_) {}
          }
          return blob;
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
