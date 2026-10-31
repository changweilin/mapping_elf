import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist', 'assets');

// 500 kB is the bar every chunk must clear. Two chunks are already over it and
// cannot be split without work this budget is not the place to force:
//   index-*  the app itself — main.js is a single 15k-line orchestrator whose
//            functions are coupled through shared closures (INC-207 forbids
//            splitting it), so this only shrinks by deleting code.
//   three-*  the Three.js runtime the 3D terrain viewer needs up front.
// They get a named allowance ≈5% above their measured size, so this stays a
// RATCHET: growth fails the build, and any allowance that goes slack should be
// lowered to the new measurement rather than left as headroom. Re-baseline
// deliberately (measure, then set ≈5% above) when a feature legitimately grows
// a chunk — never to silence an unexplained jump.
// Measured 2026-10-31: index 925.6 kB, three 592.4 kB.
// index moved 735.1 → 860.5 kB with 3D diorama/chibi hiker redesign, shape-route
// search upgrades, and bottom-left weather/catchment tool panels, then
// 860.5 → 925.6 kB with the wider OSM object catalogue (17 point-landmark
// classes, 4 linear structures) and the satellite+DEM surface synthesis in
// terrainViewer.js. That module is statically imported by main.js, so its code
// lands in index-*; giving it a chunk group would move the bytes without making
// them any cheaper. Deferring it behind a dynamic import in openTerrainViewer()
// would — and would take the 592 kB Three.js chunk off the initial load with it.
const DEFAULT_MAX_KB = 500;
const ALLOWANCES_KB = [
  { pattern: /^index-/, maxKB: 970 },
  { pattern: /^three-/, maxKB: 620 },
];

const allowanceFor = (name) => (ALLOWANCES_KB.find((a) => a.pattern.test(name))?.maxKB ?? DEFAULT_MAX_KB) * 1024;

const jsAssets = fs.readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({
    name,
    size: fs.statSync(path.join(assetsDir, name)).size,
  }));

const tooLarge = jsAssets.filter((asset) => asset.size > allowanceFor(asset.name));
if (tooLarge.length > 0) {
  const detail = tooLarge
    .map((a) => `${a.name}=${(a.size / 1024).toFixed(1)}kB > ${(allowanceFor(a.name) / 1024).toFixed(0)}kB`)
    .join(', ');
  throw new Error(`Chunk size budget exceeded: ${detail}`);
}

const names = jsAssets.map((asset) => asset.name);
const expectedPatterns = [
  /^leaflet-/,
  /^chart-/,
  /^zip-/,
  // Guards the 魔法陣 split: give its group a priority above leaflet's and
  // rolldown folds the whole Leaflet runtime in here instead, which both
  // deletes leaflet-* and re-inflates this chunk.
  /^star-/,
];

for (const pattern of expectedPatterns) {
  if (!names.some((name) => pattern.test(name))) {
    throw new Error(`Missing expected chunk matching ${pattern}: ${names.join(', ')}`);
  }
}

// Print the headroom too, so a shrinking chunk shows up as an allowance worth
// lowering instead of quietly banking slack.
const report = jsAssets
  .sort((a, b) => b.size - a.size)
  .map((a) => `${a.name} ${(a.size / 1024).toFixed(1)}/${(allowanceFor(a.name) / 1024).toFixed(0)} kB`)
  .join('; ');
console.log(`Chunk output ok: ${report}`);
