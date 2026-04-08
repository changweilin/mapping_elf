/**
 * Mapping Elf — Offline Manager
 * Service Worker registration and cache management
 */

export class OfflineManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this._statusDot = document.querySelector('.status-dot');
    this._statusText = document.querySelector('.offline-status span:last-child');
    this._cacheInfo = document.getElementById('cache-info');

    window.addEventListener('online', () => this._updateStatus(true));
    window.addEventListener('offline', () => this._updateStatus(false));

    this._updateStatus(this.isOnline);
  }

  async register() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('Service Worker registered');
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
      this._statusText.textContent = online ? '線上模式' : '離線模式';
    }
    this.updateCacheInfo();
  }

  async updateCacheInfo() {
    if (!('caches' in window)) {
      if (this._cacheInfo) this._cacheInfo.querySelector('span').textContent = '快取瓦片：不支援';
      return;
    }
    try {
      const cache = await caches.open('mapping-elf-tiles');
      const keys = await cache.keys();
      if (this._cacheInfo) {
        this._cacheInfo.querySelector('span').textContent = `快取瓦片：${keys.length} 個`;
      }
    } catch {
      if (this._cacheInfo) {
        this._cacheInfo.querySelector('span').textContent = '快取瓦片：0 個';
      }
    }
  }

  async clearCache() {
    if ('caches' in window) {
      await caches.delete('mapping-elf-tiles');
      this.updateCacheInfo();
    }
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
          const url = layerInfo.urlTemplate
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y)
            .replace('{s}', 'a'); // hardcode sub-domain 'a' for simple fetch
          urlsToCache.push(url);
        }
      }
    }

    if (urlsToCache.length > 2000) {
      throw new Error(`範圍過大 (${urlsToCache.length} 張瓦片)，限制為 2000 張。請拉近畫面。`);
    }

    if (urlsToCache.length === 0) return;

    const cache = await caches.open('mapping-elf-tiles');
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
          } catch (e) {
            // Silently ignore individual tile failures
          }
          count++;
        })
      );
      onProgress(count, urlsToCache.length);
    }
    this.updateCacheInfo();
  }
}
