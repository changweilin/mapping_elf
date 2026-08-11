import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist', 'assets');

// 500 kB is the bar every chunk must clear. Two chunks are already over it and
// cannot be split without work this budget is not the place to force:
//   index-*  the app itself — main.js is a single 12k-line orchestrator whose
//            functions are coupled through shared closures (INC-207 forbids
//            splitting it), so this only shrinks by deleting code.
//   three-*  the Three.js runtime the 3D terrain viewer needs up front.
// They get a named allowance ≈5% above their measured size, so this stays a
// RATCHET: growth fails the build, and any allowance that goes slack should be
// lowered to the new measurement rather than left as headroom.
// Measured 2026-08-11: index 699.8 kB, three 590.6 kB.
const DEFAULT_MAX_KB = 500;
const ALLOWANCES_KB = [
  { pattern: /^index-/, maxKB: 730 },
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
