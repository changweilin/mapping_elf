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
}
