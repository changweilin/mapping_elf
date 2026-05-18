const MAP_PACK_TILE_MIN_ZOOM = 8;
const MAP_PACK_TILE_MAX_ZOOM = 17;
const MAP_PACK_TILE_LIMIT = 8000;

function lngToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function latToTileY(lat, zoom) {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
}

function layerMaxZoom(layerInfo, fallbackMaxZoom) {
  const value = Number(layerInfo?.maxZoom);
  return Number.isFinite(value) ? value : fallbackMaxZoom;
}

function tilesForBoundsZoom(bounds, zoom) {
  let xMin = lngToTileX(bounds.getWest(), zoom);
  let xMax = lngToTileX(bounds.getEast(), zoom);
  let yMin = latToTileY(bounds.getNorth(), zoom);
  let yMax = latToTileY(bounds.getSouth(), zoom);
  if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
  if (yMin > yMax) [yMin, yMax] = [yMax, yMin];

  const tiles = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

function enumerateMapPackTiles(bounds, layerInfo, options = {}) {
  const minZoom = options.minZoom ?? MAP_PACK_TILE_MIN_ZOOM;
  const maxZoom = Math.min(
    options.maxZoom ?? MAP_PACK_TILE_MAX_ZOOM,
    layerMaxZoom(layerInfo, options.maxZoom ?? MAP_PACK_TILE_MAX_ZOOM),
  );
  const maxTiles = options.maxTiles ?? MAP_PACK_TILE_LIMIT;
  const tiles = [];
  let pickedMin = minZoom;
  let pickedMax = minZoom;

  for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
    const zoomTiles = tilesForBoundsZoom(bounds, zoom);
    if (tiles.length + zoomTiles.length > maxTiles) break;
    tiles.push(...zoomTiles);
    pickedMax = zoom;
  }

  return {
    minZoom: pickedMin,
    maxZoom: pickedMax,
    tileCount: tiles.length,
    tiles,
  };
}

function estimateMapPackTiles(bounds, layerInfo, options = {}) {
  const { minZoom, maxZoom, tileCount } = enumerateMapPackTiles(bounds, layerInfo, options);
  return { minZoom, maxZoom, tileCount };
}

export {
  MAP_PACK_TILE_LIMIT,
  MAP_PACK_TILE_MAX_ZOOM,
  MAP_PACK_TILE_MIN_ZOOM,
  enumerateMapPackTiles,
  estimateMapPackTiles,
  tilesForBoundsZoom,
};
