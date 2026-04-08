/**
 * Mapping Elf — Service Worker
 * Caches map tiles for offline use
 */

const TILE_CACHE = 'mapping-elf-tiles';
const APP_CACHE = 'mapping-elf-app-v1';

const TILE_DOMAINS = [
  'tile.openstreetmap.org',
  'tile.opentopomap.org',
  'server.arcgisonline.com',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if this is a tile request
  const isTile = TILE_DOMAINS.some((d) => url.hostname.includes(d));

  if (isTile) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const response = await fetch(event.request);
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch {
          // Return a transparent 256x256 PNG as fallback
          return new Response('', { status: 404, statusText: 'Offline' });
        }
      })
    );
  }
});
