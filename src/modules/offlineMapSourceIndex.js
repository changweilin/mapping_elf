/**
 * Native offline map source index.
 *
 * This registry tracks app-imported base map files such as Mapsforge `.map`
 * and MBTiles. The files themselves stay in native app storage; `.melmap`
 * route packs continue to reference only route/state/tile data.
 */

export const OFFLINE_MAP_SOURCE_INDEX_CACHE_NAME = 'mapping-elf-offline-map-sources';
export const OFFLINE_MAP_SOURCE_INDEX_URL = 'https://mapping-elf.local/offline-map-sources.json';

const OFFLINE_MAP_SOURCE_INDEX_VERSION = 1;
const SUPPORTED_FORMATS = new Set(['mapsforge', 'mbtiles']);

function getCaches() {
  return globalThis.caches || null;
}

function emptyIndex() {
  return {
    version: OFFLINE_MAP_SOURCE_INDEX_VERSION,
    sources: {},
  };
}

function toNonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function safeText(value) {
  return String(value || '').trim();
}

function extensionFromFilename(filename) {
  const match = safeText(filename).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

function normalizeFormat(format, filename = '') {
  const candidate = safeText(format).toLowerCase();
  if (SUPPORTED_FORMATS.has(candidate)) return candidate;
  const ext = extensionFromFilename(filename);
  if (ext === 'map') return 'mapsforge';
  if (ext === 'mbtiles') return 'mbtiles';
  return '';
}

function makeSourceId(format, name) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeFormat = safeText(format || 'map').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const safeName = safeText(name || 'source').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 48);
  return `offline-map-${safeFormat}-${safeName || 'source'}-${random}`;
}

function normalizeSource(record = {}) {
  const file = record.file && typeof record.file === 'object' ? record.file : {};
  const storage = record.storage && typeof record.storage === 'object' ? record.storage : {};
  const filename = safeText(record.filename || file.filename || record.name);
  const format = normalizeFormat(record.format, filename);
  if (!format) return null;

  const name = safeText(record.name || filename || (format === 'mapsforge' ? 'Mapsforge map' : 'MBTiles map'));
  const id = safeText(record.id) || makeSourceId(format, name);
  const sizeBytes = toNonNegativeNumber(record.sizeBytes ?? file.sizeBytes);
  const checksumSha256 = safeText(record.checksumSha256 || file.checksumSha256);
  const mimeType = safeText(record.mimeType || file.mimeType);

  return {
    id,
    version: 1,
    createdAt: safeText(record.createdAt) || new Date().toISOString(),
    updatedAt: safeText(record.updatedAt) || record.createdAt || new Date().toISOString(),
    source: safeText(record.source) || 'native-import',
    platform: safeText(record.platform) || 'android',
    name,
    format,
    enabled: record.enabled === true,
    bounds: record.bounds || null,
    attribution: record.attribution || null,
    license: record.license || null,
    rendererStatus: safeText(record.rendererStatus) || 'pending-native-renderer',
    storage: {
      kind: safeText(storage.kind || record.storageKind) || 'app-private-file',
      storedPath: safeText(storage.storedPath || record.storedPath),
      relativePath: safeText(storage.relativePath || record.relativePath),
      uri: safeText(storage.uri || record.uri),
      originalUri: safeText(storage.originalUri || record.originalUri),
    },
    file: {
      filename,
      extension: safeText(file.extension || extensionFromFilename(filename)),
      mimeType,
      sizeBytes,
      checksumSha256,
    },
  };
}

function normalizeIndex(value) {
  if (!value || typeof value !== 'object') return emptyIndex();
  const sources = value.sources && typeof value.sources === 'object' ? value.sources : {};
  return {
    version: OFFLINE_MAP_SOURCE_INDEX_VERSION,
    sources: Object.fromEntries(
      Object.entries(sources)
        .map(([id, source]) => normalizeSource({ id, ...source }))
        .filter(Boolean)
        .map((source) => [source.id, source])
    ),
  };
}

export async function readOfflineMapSourceIndex() {
  const caches = getCaches();
  if (!caches) return emptyIndex();
  try {
    const cache = await caches.open(OFFLINE_MAP_SOURCE_INDEX_CACHE_NAME);
    const response = await cache.match(OFFLINE_MAP_SOURCE_INDEX_URL);
    if (!response) return emptyIndex();
    return normalizeIndex(await response.json());
  } catch (err) {
    console.warn('Offline map source index read failed:', err);
    return emptyIndex();
  }
}

export async function writeOfflineMapSourceIndex(index) {
  const caches = getCaches();
  if (!caches) return null;
  const normalized = normalizeIndex(index);
  try {
    const cache = await caches.open(OFFLINE_MAP_SOURCE_INDEX_CACHE_NAME);
    await cache.put(OFFLINE_MAP_SOURCE_INDEX_URL, new Response(JSON.stringify(normalized, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    }));
    return normalized;
  } catch (err) {
    console.warn('Offline map source index write failed:', err);
    return null;
  }
}

export async function addOfflineMapSource(record = {}) {
  const source = normalizeSource(record);
  if (!source) return null;

  const index = await readOfflineMapSourceIndex();
  index.sources[source.id] = source;
  const saved = await writeOfflineMapSourceIndex(index);
  return saved ? source : null;
}

export async function getOfflineMapSource(sourceId) {
  const id = safeText(sourceId);
  if (!id) return null;
  const index = await readOfflineMapSourceIndex();
  return index.sources[id] || null;
}

export async function removeOfflineMapSource(sourceId) {
  const id = safeText(sourceId);
  if (!id) return null;
  const index = await readOfflineMapSourceIndex();
  const source = index.sources[id] || null;
  if (!source) return null;
  delete index.sources[id];
  await writeOfflineMapSourceIndex(index);
  return source;
}

export async function clearOfflineMapSourceIndex() {
  const caches = getCaches();
  if (!caches) return false;
  try {
    return await caches.delete(OFFLINE_MAP_SOURCE_INDEX_CACHE_NAME);
  } catch (err) {
    console.warn('Offline map source index clear failed:', err);
    return false;
  }
}
