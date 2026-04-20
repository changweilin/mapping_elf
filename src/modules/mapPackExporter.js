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

const MELMAP_VERSION = 1;
const MAX_TILES = 8000;

// OSM/Topo use {a,b,c} subdomains; Esri has no {s}. When writing tiles into
// Cache API on import we replicate the response under every subdomain so
// Leaflet's hash-based subdomain pick always hits.
const SUBDOMAINS = ['a', 'b', 'c'];

const LS_STATE_KEYS = [
  'mappingElf_weather',
  'mappingElf_weatherCells',
  'mappingElf_weatherCache',
  'mappingElf_geocode',
  'mappingElf_segmentKm',
  'mappingElf_speedMode',
  'mappingElf_speedActivity',
  'mappingElf_paceParams',
  'mappingElf_paceUnit',
  'mappingElf_perSegment',
  'mappingElf_strictLinear',
  'mappingElf_importAutoSort',
  'mappingElf_importAutoName',
  'mappingElf_panelHeight',
  'mappingElf_panelHeightRatio',
  'mappingElf_windyLayer',
  'mappingElf_windyModel',
  'mappingElf_routeMode',
];

function lng2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
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

      const { minZoom, maxZoom, tiles } = this._enumerateTiles(bounds, layerInfo);
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
    // Walk from rough overview (z=8) up to layer maxZoom, stop when count exceeds MAX_TILES.
    const hardMin = 8;
    const hardMax = Math.min(17, layerInfo.maxZoom);   // cap at 17 to control size; adjust per layer below
    const tiles = [];
    let pickedMin = hardMin;
    let pickedMax = hardMin;

    for (let z = hardMin; z <= hardMax; z++) {
      const zTiles = this._tilesForZoom(bounds, z);
      if (tiles.length + zTiles.length > MAX_TILES) {
        // Too many at this zoom — stop adding.
        break;
      }
      tiles.push(...zTiles);
      pickedMax = z;
    }

    return { minZoom: pickedMin, maxZoom: pickedMax, tiles };
  }

  static _tilesForZoom(bounds, z) {
    let xMin = lng2tile(bounds.getWest(), z);
    let xMax = lng2tile(bounds.getEast(), z);
    let yMin = lat2tile(bounds.getNorth(), z);
    let yMax = lat2tile(bounds.getSouth(), z);
    if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
    if (yMin > yMax) [yMin, yMax] = [yMax, yMin];

    const out = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        out.push({ z, x, y });
      }
    }
    return out;
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
    if (!base.includes('{s}')) return [base];
    return SUBDOMAINS.map((s) => base.replace('{s}', s));
  }

  static triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export { LS_STATE_KEYS, MELMAP_VERSION, SUBDOMAINS };
