import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist', 'assets');

// 500 kB is the bar every chunk must clear. Two chunks are still over it:
//   index-*  the app itself — main.js is a single 15k-line orchestrator whose
//            functions are coupled through shared closures (INC-207 forbids
//            splitting it), so this now only shrinks by deleting code or by
//            deferring a whole module behind a dynamic import.
//   three-*  the Three.js runtime, reachable only from terrainViewer.js and
//            therefore no longer fetched until the 3D viewer is opened.
// They get a named allowance ≈5% above their measured size, so this stays a
// RATCHET: growth fails the build, and any allowance that goes slack should be
// lowered to the new measurement rather than left as headroom. Re-baseline
// deliberately (measure, then set ≈5% above) when a feature legitimately grows
// a chunk — never to silence an unexplained jump.
// Measured 2026-10-31: index 740.1 kB, three 592.4 kB, terrainViewer 185.3 kB.
// index moved 735.1 → 860.5 kB with the 3D diorama/chibi hiker redesign,
// shape-route search upgrades and the bottom-left weather/catchment panels, then
// 860.5 → 925.6 kB with the wider OSM object catalogue (17 point-landmark
// classes, 4 linear structures) and the satellite+DEM surface synthesis, then
// 925.6 → 740.1 kB once main.js stopped importing terrainViewer.js statically:
// the module and the Three.js runtime behind it now load on demand (warmed at
// idle), so neither is on the first-paint path.
const DEFAULT_MAX_KB = 500;
const ALLOWANCES_KB = [
  { pattern: /^index-/, maxKB: 775 },
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
  // Guards the on-demand 3D split: a static import of terrainViewer.js in
  // main.js folds this chunk (and Three.js with it) back into index-*, which
  // blows the index budget above. Failing here says which change caused it.
  /^terrainViewer-/,
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
