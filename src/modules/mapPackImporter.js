/**
 * Mapping Elf — Map Pack Importer
 *
 * Parses a `.melmap` ZIP and selectively restores:
 *   - route.gpx   → GpxExporter.parse()
 *   - state.json  → localStorage (caller triggers UI reload)
 *   - tiles/…     → caches.open('mapping-elf-tiles')
 */

import { LS_STATE_KEYS, MELMAP_VERSION, SUBDOMAINS } from './mapPackExporter.js';
import JSZip from 'jszip';

// Keep in sync with src/modules/mapManager.js TILE_LAYERS — used to rebuild
// cache keys so the Service Worker finds tiles on the next render.
const TILE_URL_TEMPLATES = {
  streets: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

export class MapPackImporter {
  /**
   * Read and validate a .melmap ZIP.
   * @param {File|Blob} file
   * @returns {Promise<{zip, manifest, hasGpx, hasState, hasTiles}>}
   */
  static async parse(file) {
    console.log('MapPackImporter: Parsing file...', file.name);
    try {
      const zip = await JSZip.loadAsync(file);
      return MapPackImporter._buildParsed(zip);
    } catch (err) {
      console.error('JSZip load failed:', err);
      throw new Error(`檔案解析失敗: ${err.message}`);
    }
  }

  static async _buildParsed(zip) {
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('manifest.json 缺失,不是有效的 .melmap 包');
    const manifest = JSON.parse(await manifestFile.async('string'));

    if (typeof manifest.version !== 'number') {
      throw new Error('manifest 格式錯誤');
    }
    if (manifest.version > MELMAP_VERSION) {
      throw new Error(`此 .melmap 版本 (${manifest.version}) 比本程式新,請先更新`);
    }

    return {
      zip,
      manifest,
      hasGpx: !!zip.file('route.gpx'),
      hasState: !!zip.file('state.json'),
      hasTiles: manifest.includes?.tiles && Object.keys(zip.files).some((n) => n.startsWith('tiles/')),
    };
  }

  /**
   * Apply selected parts of a parsed pack.
   *
   * @param {Object} parsed        Output of parse()
   * @param {Object} opts
   * @param {boolean} opts.restoreRoute
   * @param {boolean} opts.restoreState
   * @param {boolean} opts.restoreTiles
   * @param {Function} opts.onProgress (current, total, phase) → void
   * @returns {Promise<{gpxXml?: string, stateApplied?: boolean, tileCount?: number, layer?: string}>}
   */
  static async apply(parsed, {
    restoreRoute,
    restoreState,
    restoreTiles,
    onProgress = () => {},
  }) {
    const { zip, manifest } = parsed;
    const result = {};

    if (restoreRoute && parsed.hasGpx) {
      const gpxXml = await zip.file('route.gpx').async('string');
      result.gpxXml = gpxXml;   // caller hands to GpxExporter.parse() + mapManager
    }

    if (restoreState && parsed.hasState) {
      const stateJson = await zip.file('state.json').async('string');
      let state;
      try { state = JSON.parse(stateJson); } catch (_) { state = {}; }
      // Only apply known keys — never blindly trust ZIP contents.
      const allow = new Set(LS_STATE_KEYS);
      for (const [k, v] of Object.entries(state)) {
        if (!allow.has(k)) continue;
        if (typeof v !== 'string') continue;
        try { localStorage.setItem(k, v); } catch (_) {}
      }
      result.stateApplied = true;
    }

    if (restoreTiles && parsed.hasTiles) {
      const layer = manifest.layer;
      const tmpl = TILE_URL_TEMPLATES[layer];
      if (!tmpl) throw new Error(`未知圖層: ${layer}`);
      if (!('caches' in self)) throw new Error('瀏覽器不支援 Cache API,無法匯入圖磚');

      const tileEntries = [];
      zip.forEach((path, entry) => {
        if (entry.dir) return;
        // Normalize path for platform consistency
        const normalized = path.replace(/\\/g, '/').replace(/^\//, '');
        const m = /^tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(png|jpg|jpeg)$/i.exec(normalized);
        if (m && m[1] === layer) {
          tileEntries.push({ entry, z: +m[2], x: +m[3], y: +m[4] });
        }
      });

      const cache = await caches.open('mapping-elf-tiles');
      const total = tileEntries.length;
      let done = 0;
      onProgress(0, total, 'tiles');

      const chunkSize = 16;
      for (let i = 0; i < tileEntries.length; i += chunkSize) {
        const chunk = tileEntries.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async ({ entry, z, x, y }) => {
          try {
            const blob = await entry.async('blob');
            const urls = MapPackImporter._expandSubdomains(tmpl, z, x, y);
            // Replicate under every subdomain so Leaflet hash-picks hit.
            await Promise.all(urls.map((u) => cache.put(u, new Response(blob, {
              headers: { 'Content-Type': 'image/png' },
            }))));
          } catch (e) { console.warn('Tile restore failed', e); }
          done++;
          onProgress(done, total, 'tiles');
        }));
      }
      result.tileCount = total;
      result.layer = layer;
    }

    return result;
  }

  static _expandSubdomains(urlTemplate, z, x, y) {
    const base = urlTemplate
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
    if (!base.includes('{s}')) return [base];
    return SUBDOMAINS.map((s) => base.replace('{s}', s));
  }
}
