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
// Measured 2026-08-12: index 735.1 kB, three 590.6 kB, star 60.8 kB.
// index moved 699.8 → 735.1 kB with the 魔法陣 tool — its main.js wiring plus
// 115 new 8-language phrases. The tool's own modules are split into star-*
// (vite.config.js), which is why index did not grow by the full ~95 kB.
const DEFAULT_MAX_KB = 500;
const ALLOWANCES_KB = [
  { pattern: /^index-/, maxKB: 772 },
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
