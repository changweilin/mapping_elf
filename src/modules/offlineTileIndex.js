/**
 * Offline tile pack index.
 *
 * Tracks Cache API tile ownership so future cleanup can remove one imported or
 * exported pack without deleting tiles still referenced by another pack.
 */

export const OFFLINE_TILE_CACHE_NAME = 'mapping-elf-tiles';
export const OFFLINE_TILE_INDEX_CACHE_NAME = 'mapping-elf-tile-index';
export const OFFLINE_TILE_INDEX_URL = 'https://mapping-elf.local/offline-tile-index.json';

const OFFLINE_TILE_INDEX_VERSION = 1;

function getCaches() {
  return globalThis.caches || null;
}

function emptyIndex() {
  return {
    version: OFFLINE_TILE_INDEX_VERSION,
    packs: {},
  };
}

function toNonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function safeText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const normalized = {
    north: safeNumber(bounds.north),
    south: safeNumber(bounds.south),
    east: safeNumber(bounds.east),
    west: safeNumber(bounds.west),
  };
  return Object.values(normalized).every((value) => value !== null) ? normalized : null;
}

function normalizeRoute(route) {
  if (!route || typeof route !== 'object') return null;
  const normalized = {
    id: safeText(route.id),
    fingerprint: safeText(route.fingerprint),
    name: safeText(route.name),
    distanceM: safeNumber(route.distanceM),
    pointCount: toNonNegativeNumber(route.pointCount),
    waypointCount: toNonNegativeNumber(route.waypointCount),
    bounds: normalizeBounds(route.bounds),
  };
  return normalized.name || normalized.fingerprint || normalized.pointCount > 0 ? normalized : null;
}

function normalizeIndex(value) {
  if (!value || typeof value !== 'object') return emptyIndex();
  const packs = value.packs && typeof value.packs === 'object' ? value.packs : {};
  return {
    version: OFFLINE_TILE_INDEX_VERSION,
    packs: Object.fromEntries(
      Object.entries(packs)
        .filter(([, pack]) => pack && typeof pack === 'object')
        .map(([id, pack]) => {
          const tileUrls = uniqueUrls(pack.tileUrls);
          return [id, {
            ...pack,
            expectedTileCount: toNonNegativeNumber(pack.expectedTileCount),
            cachedTileCount: toNonNegativeNumber(pack.cachedTileCount),
            tileUrlCount: toNonNegativeNumber(pack.tileUrlCount) || tileUrls.length,
            tileBytes: toNonNegativeNumber(pack.tileBytes ?? pack.downloadedTileBytes),
            route: normalizeRoute(pack.route),
            sharePreset: safeText(pack.sharePreset),
            sourceFileName: safeText(pack.sourceFileName),
            tileUrls,
          }];
        })
    ),
  };
}

function makePackId(source, layer) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeSource = String(source || 'pack').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const safeLayer = String(layer || 'tiles').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `${safeSource}-${safeLayer}-${random}`;
}

function uniqueUrls(urls) {
  return [...new Set((urls || []).map((url) => String(url || '').trim()).filter(Boolean))];
}

export async function readOfflineTileIndex() {
  const caches = getCaches();
  if (!caches) return emptyIndex();
  try {
    const cache = await caches.open(OFFLINE_TILE_INDEX_CACHE_NAME);
    const response = await cache.match(OFFLINE_TILE_INDEX_URL);
    if (!response) return emptyIndex();
    return normalizeIndex(await response.json());
  } catch (err) {
    console.warn('Offline tile index read failed:', err);
    return emptyIndex();
  }
}

export async function writeOfflineTileIndex(index) {
  const caches = getCaches();
  if (!caches) return null;
  const normalized = normalizeIndex(index);
  try {
    const cache = await caches.open(OFFLINE_TILE_INDEX_CACHE_NAME);
    await cache.put(OFFLINE_TILE_INDEX_URL, new Response(JSON.stringify(normalized, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    }));
    return normalized;
  } catch (err) {
    console.warn('Offline tile index write failed:', err);
    return null;
  }
}

export async function addOfflineTilePack(record = {}) {
  const tileUrls = uniqueUrls(record.tileUrls);
  if (tileUrls.length === 0) return null;

  const index = await readOfflineTileIndex();
  const id = record.id || makePackId(record.source, record.layer);
  const pack = {
    id,
    createdAt: record.createdAt || new Date().toISOString(),
    source: record.source || 'pack',
    status: record.status || 'complete',
    layer: record.layer || null,
    bounds: record.bounds || null,
    minZoom: record.minZoom ?? null,
    maxZoom: record.maxZoom ?? null,
    expectedTileCount: Number(record.expectedTileCount || 0),
    cachedTileCount: Number(record.cachedTileCount || 0),
    tileUrlCount: tileUrls.length,
    tileBytes: toNonNegativeNumber(record.tileBytes ?? record.downloadedTileBytes),
    provider: record.provider || null,
    route: normalizeRoute(record.route),
    sharePreset: safeText(record.sharePreset),
    sourceFileName: safeText(record.sourceFileName),
    tileUrls,
  };

  index.packs[id] = pack;
  const saved = await writeOfflineTileIndex(index);
  return saved ? pack : null;
}

export async function clearOfflineTileIndex() {
  const caches = getCaches();
  if (!caches) return false;
  try {
    return await caches.delete(OFFLINE_TILE_INDEX_CACHE_NAME);
  } catch (err) {
    console.warn('Offline tile index clear failed:', err);
    return false;
  }
}

export async function deleteOfflineTilePack(packId) {
  const caches = getCaches();
  if (!caches || !packId) return { deleted: 0, found: false };

  const index = await readOfflineTileIndex();
  const pack = index.packs[packId];
  if (!pack) return { deleted: 0, found: false };

  const referencedByOthers = new Set();
  Object.entries(index.packs).forEach(([id, otherPack]) => {
    if (id === packId) return;
    (otherPack.tileUrls || []).forEach((url) => referencedByOthers.add(url));
  });

  let deleted = 0;
  const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
  for (const url of uniqueUrls(pack.tileUrls)) {
    if (referencedByOthers.has(url)) continue;
    if (await cache.delete(url)) deleted++;
  }

  delete index.packs[packId];
  await writeOfflineTileIndex(index);
  return { deleted, found: true };
}

function sameToken(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function summarizeByteSamples(packs, predicate, source) {
  let totalBytes = 0;
  let totalTiles = 0;
  let samplePackCount = 0;

  packs.forEach((pack) => {
    if (!predicate(pack)) return;
    const tileBytes = toNonNegativeNumber(pack.tileBytes ?? pack.downloadedTileBytes);
    const cachedTileCount = toNonNegativeNumber(pack.cachedTileCount);
    if (tileBytes <= 0 || cachedTileCount <= 0) return;
    totalBytes += tileBytes;
    totalTiles += cachedTileCount;
    samplePackCount++;
  });

  if (totalBytes <= 0 || totalTiles <= 0) return null;
  return {
    source,
    averageTileBytes: totalBytes / totalTiles,
    sampleTileCount: totalTiles,
    samplePackCount,
  };
}

export async function estimateOfflineTilePackBytes({ layer, providerId, tileCount } = {}) {
  const count = toNonNegativeNumber(tileCount);
  if (count <= 0) return null;

  const index = await readOfflineTileIndex();
  const packs = Object.values(index.packs || {});
  const providerEstimate = summarizeByteSamples(
    packs,
    (pack) => sameToken(pack.provider?.id, providerId),
    'provider'
  );
  const layerEstimate = summarizeByteSamples(
    packs,
    (pack) => sameToken(pack.layer, layer),
    'layer'
  );
  const fallbackEstimate = summarizeByteSamples(
    packs,
    () => true,
    'all'
  );
  const sample = providerEstimate || layerEstimate || fallbackEstimate;
  if (!sample) return null;

  return {
    ...sample,
    estimatedBytes: Math.round(sample.averageTileBytes * count),
  };
}
