/**
 * Mapping Elf — Offline Manager
 * Service Worker registration and cache management
 */

import { translatePhrase } from './i18n.js';
import { showNotification as rawShowNotification } from './utils.js';
import {
  OFFLINE_TILE_CACHE_NAME,
  addOfflineTilePack,
  clearOfflineTileIndex,
  deleteOfflineTilePack,
  readOfflineTileIndex,
} from './offlineTileIndex.js';

export class OfflineManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this._statusDot = document.querySelector('.status-dot');
    this._statusText = document.querySelector('.offline-status span:last-child');
    this._cacheInfo = document.getElementById('cache-info');
    this._packList = document.getElementById('offline-pack-list');
    this._clearCacheBtn = document.getElementById('btn-clear-offline-cache');

    window.addEventListener('online', () => this._updateStatus(true));
    window.addEventListener('offline', () => this._updateStatus(false));
    this._packList?.addEventListener('click', (event) => this._handlePackListClick(event));
    this._clearCacheBtn?.addEventListener('click', () => this._handleClearAllClick());

    this._updateStatus(this.isOnline);
  }

  async register() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL });
      } catch (err) {
        console.warn('SW registration failed:', err.message);
      }
    }
  }

  _updateStatus(online) {
    this.isOnline = online;
    if (this._statusDot) {
      this._statusDot.className = `status-dot ${online ? 'online' : 'offline'}`;
    }
    if (this._statusText) {
      this._statusText.textContent = translatePhrase(online ? '線上模式' : '離線模式');
    }
    this.updateCacheInfo();
  }

  async updateCacheInfo() {
    if (!('caches' in window)) {
      this._setCacheInfo('快取瓦片：不支援');
      this._renderTilePacks([], { unsupported: true, cachedTileEntries: 0 });
      return;
    }
    try {
      const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
      const keys = await cache.keys();
      this._setCacheInfo(`快取瓦片：${keys.length} 個`);
      const index = await readOfflineTileIndex();
      this._renderTilePacks(Object.values(index.packs || {}), { cachedTileEntries: keys.length });
    } catch {
      this._setCacheInfo('快取瓦片：0 個');
      this._renderTilePacks([], { cachedTileEntries: 0 });
    }
  }

  async clearCache() {
    if ('caches' in window) {
      await caches.delete(OFFLINE_TILE_CACHE_NAME);
      await clearOfflineTileIndex();
      await this.updateCacheInfo();
    }
  }

  _setCacheInfo(text) {
    const span = this._cacheInfo?.querySelector('span');
    if (span) span.textContent = translatePhrase(text);
  }

  _notify(message, type = 'info', duration = 3000) {
    rawShowNotification(translatePhrase(message), type, duration);
  }

  async _handlePackListClick(event) {
    const button = event.target.closest?.('[data-delete-pack-id]');
    if (!button) return;
    const packId = button.dataset.deletePackId;
    if (!packId) return;
    button.disabled = true;
    try {
      const result = await deleteOfflineTilePack(packId);
      await this.updateCacheInfo();
      this._notify(`已刪除 ${result.deleted || 0} 張圖磚`, 'success');
    } catch (err) {
      console.error('Offline tile pack delete failed:', err);
      this._notify('刪除圖磚包失敗', 'error');
      button.disabled = false;
    }
  }

  async _handleClearAllClick() {
    if (!('caches' in window)) return;
    if (this._clearCacheBtn) this._clearCacheBtn.disabled = true;
    try {
      await this.clearCache();
      this._notify('已清除全部離線圖磚', 'success');
    } catch (err) {
      console.error('Offline tile cache clear failed:', err);
      this._notify('清除全部圖磚失敗', 'error');
    } finally {
      await this.updateCacheInfo();
    }
  }

  _renderTilePacks(packs, { unsupported = false, cachedTileEntries = 0 } = {}) {
    if (!this._packList) return;
    this._packList.textContent = '';
    const sortedPacks = [...packs].sort((a, b) => {
      const at = Date.parse(a.createdAt || '') || 0;
      const bt = Date.parse(b.createdAt || '') || 0;
      return bt - at;
    });

    if (this._clearCacheBtn) {
      this._clearCacheBtn.disabled = unsupported || (cachedTileEntries === 0 && sortedPacks.length === 0);
    }

    if (unsupported) {
      this._packList.appendChild(this._createEmptyPackMessage('離線快取不支援'));
      return;
    }

    if (sortedPacks.length === 0) {
      this._packList.appendChild(this._createEmptyPackMessage('尚無離線圖磚包'));
      return;
    }

    sortedPacks.forEach((pack) => this._packList.appendChild(this._createPackItem(pack)));
  }

  _createEmptyPackMessage(message) {
    const empty = document.createElement('div');
    empty.className = 'offline-pack-empty';
    empty.textContent = translatePhrase(message);
    return empty;
  }

  _createPackItem(pack) {
    const item = document.createElement('div');
    item.className = 'offline-pack-item';
    item.dataset.packId = pack.id || '';

    const content = document.createElement('div');
    content.className = 'offline-pack-content';

    const title = document.createElement('div');
    title.className = 'offline-pack-title';
    title.textContent = this._formatPackTitle(pack);

    const meta = document.createElement('div');
    meta.className = 'offline-pack-meta';
    meta.textContent = this._formatPackMeta(pack);

    content.append(title, meta);
    item.append(content, this._createDeleteButton(pack));
    return item;
  }

  _createDeleteButton(pack) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn offline-pack-delete';
    button.dataset.deletePackId = pack.id || '';
    button.title = translatePhrase('刪除此圖磚包');
    button.setAttribute('aria-label', translatePhrase('刪除此圖磚包'));
    button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4h-3.5z" fill="currentColor"/></svg>';
    return button;
  }

  _formatPackTitle(pack) {
    const providerName = pack.provider?.name || pack.layer || translatePhrase('未知圖層');
    return `${providerName} · ${this._sourceLabel(pack.source)}`;
  }

  _formatPackMeta(pack) {
    const expected = Number(pack.expectedTileCount || 0);
    const cached = Number(pack.cachedTileCount || 0);
    const urlCount = Number(pack.tileUrlCount || pack.tileUrls?.length || 0);
    const tileSize = this._formatByteSize(pack.tileBytes);
    const createdAt = this._formatPackDate(pack.createdAt);
    const parts = [
      `${cached}/${expected} ${translatePhrase('張圖磚')}`,
      ...(tileSize ? [tileSize] : []),
      `${urlCount} URL`,
      createdAt,
    ];
    if (pack.status === 'incomplete') parts.push(translatePhrase('不完整'));
    return parts.join(' · ');
  }

  _formatPackDate(value) {
    if (!value) return translatePhrase('未知時間');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return translatePhrase('未知時間');
    return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
  }

  _sourceLabel(source) {
    const labels = {
      import: '匯入',
      export: '匯出',
      'route-cache': '路線快取',
      'area-cache': '範圍快取',
    };
    return translatePhrase(labels[source] || '離線圖磚包');
  }

  _formatByteSize(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    const digits = unitIndex === 0 || size >= 10 ? 0 : 1;
    return `${size.toFixed(digits)} ${units[unitIndex]}`;
  }

  lng2tile(lon, zoom) {
    return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
  }

  lat2tile(lat, zoom) {
    return Math.floor(
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
        ) /
          Math.PI) /
        2) *
        Math.pow(2, zoom)
    );
  }

  buildTileUrl(urlTemplate, z, x, y, subdomain = 'a') {
    return urlTemplate
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{s}', subdomain)
      .replace('{r}', '');
  }

  async downloadArea(bounds, layerInfo, onProgress) {
    if (!('caches' in window)) throw new Error('不支援離線快取');

    // Download zooms 12 to 15 (reasonable balance for hiking)
    const minZ = 12;
    const maxZ = Math.min(15, layerInfo.maxZoom);
    const urlsToCache = [];

    for (let z = minZ; z <= maxZ; z++) {
      let xMin = this.lng2tile(bounds.getWest(), z);
      let xMax = this.lng2tile(bounds.getEast(), z);
      let yMin = this.lat2tile(bounds.getNorth(), z);
      let yMax = this.lat2tile(bounds.getSouth(), z);

      if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
      if (yMin > yMax) [yMin, yMax] = [yMax, yMin];

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const url = this.buildTileUrl(layerInfo.urlTemplate, z, x, y);
          urlsToCache.push(url);
        }
      }
    }

    if (urlsToCache.length > 2000) {
      throw new Error(`範圍過大 (${urlsToCache.length} 張瓦片)，限制為 2000 張。請拉近畫面。`);
    }

    if (urlsToCache.length === 0) return;

    const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
    const cachedTileUrls = new Set();
    let count = 0;
    onProgress(0, urlsToCache.length);

    // Fetch concurrently in chunks
    const chunkSize = 10;
    for (let i = 0; i < urlsToCache.length; i += chunkSize) {
      const chunk = urlsToCache.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (url) => {
          try {
            const resp = await fetch(url, { mode: 'no-cors' });
            await cache.put(url, resp);
            cachedTileUrls.add(url);
          } catch (e) {
            // Silently ignore individual tile failures
          }
          count++;
        })
      );
      onProgress(count, urlsToCache.length);
    }
    await addOfflineTilePack({
      source: 'area-cache',
      status: cachedTileUrls.size === urlsToCache.length ? 'complete' : 'incomplete',
      layer: layerInfo.name || null,
      bounds: {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      },
      minZoom: minZ,
      maxZoom: maxZ,
      expectedTileCount: urlsToCache.length,
      cachedTileCount: cachedTileUrls.size,
      provider: layerInfo.provider || null,
      tileUrls: [...cachedTileUrls],
    });
    this.updateCacheInfo();
  }

  /**
   * Download tiles covering the route corridor (±2 tiles buffer around each route point)
   * @param {Array} routeCoords - [[lat, lng], ...]
   * @param {Object} layerInfo - { urlTemplate, maxZoom }
   * @param {Function} onProgress - (current, total) callback
   */
  async downloadRoute(routeCoords, layerInfo, onProgress) {
    if (!routeCoords || routeCoords.length < 2) throw new Error('尚無路線資料');
    if (!('caches' in window)) throw new Error('不支援離線快取');

    const minZ = 12;
    const maxZ = Math.min(15, layerInfo.maxZoom);
    const bufferTiles = 2;
    const tileSet = new Set();

    // Sample route to ~500m intervals to avoid redundant tile calculations
    const sampled = this._sampleRoute(routeCoords, 500);

    for (const [lat, lng] of sampled) {
      for (let z = minZ; z <= maxZ; z++) {
        const tx = this.lng2tile(lng, z);
        const ty = this.lat2tile(lat, z);
        for (let dx = -bufferTiles; dx <= bufferTiles; dx++) {
          for (let dy = -bufferTiles; dy <= bufferTiles; dy++) {
            tileSet.add(`${z}/${tx + dx}/${ty + dy}`);
          }
        }
      }
    }

    const urlsToCache = [...tileSet].map(key => {
      const [z, x, y] = key.split('/').map(Number);
      return this.buildTileUrl(layerInfo.urlTemplate, z, x, y);
    });
    const routeBounds = this._boundsForCoords(routeCoords);

    if (urlsToCache.length > 5000) {
      throw new Error(`路線範圍過大 (${urlsToCache.length} 張瓦片)，請縮短路線後再試。`);
    }

    if (urlsToCache.length === 0) return;

    const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
    const cachedTileUrls = new Set();
    let count = 0;
    onProgress(0, urlsToCache.length);

    const chunkSize = 10;
    for (let i = 0; i < urlsToCache.length; i += chunkSize) {
      const chunk = urlsToCache.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (url) => {
          try {
            const resp = await fetch(url, { mode: 'no-cors' });
            await cache.put(url, resp);
            cachedTileUrls.add(url);
          } catch (e) {
            // Silently ignore individual tile failures
          }
          count++;
        })
      );
      onProgress(count, urlsToCache.length);
    }
    await addOfflineTilePack({
      source: 'route-cache',
      status: cachedTileUrls.size === urlsToCache.length ? 'complete' : 'incomplete',
      layer: layerInfo.name || null,
      bounds: routeBounds,
      minZoom: minZ,
      maxZoom: maxZ,
      expectedTileCount: urlsToCache.length,
      cachedTileCount: cachedTileUrls.size,
      provider: layerInfo.provider || null,
      tileUrls: [...cachedTileUrls],
    });
    this.updateCacheInfo();
  }

  /**
   * Sample route coordinates at a given interval (meters)
   */
  _boundsForCoords(coords) {
    if (!coords?.length) return null;
    const lats = coords.map(([lat]) => lat);
    const lngs = coords.map(([, lng]) => lng);
    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    };
  }

  _sampleRoute(coords, intervalMeters) {
    if (coords.length === 0) return [];
    const result = [coords[0]];
    let accDist = 0;
    for (let i = 1; i < coords.length; i++) {
      accDist += this._haversine(coords[i - 1], coords[i]);
      if (accDist >= intervalMeters) {
        result.push(coords[i]);
        accDist = 0;
      }
    }
    const last = coords[coords.length - 1];
    if (result[result.length - 1] !== last) result.push(last);
    return result;
  }

  _haversine([lat1, lng1], [lat2, lng2]) {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
