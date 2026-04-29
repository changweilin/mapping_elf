import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist', 'assets');
const maxChunkBytes = 500 * 1024;

const jsAssets = fs.readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({
    name,
    size: fs.statSync(path.join(assetsDir, name)).size,
  }));

const tooLarge = jsAssets.filter((asset) => asset.size > maxChunkBytes);
if (tooLarge.length > 0) {
  throw new Error(`Large JS chunks remain: ${tooLarge.map((a) => `${a.name}=${a.size}`).join(', ')}`);
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

console.log(`Chunk output ok: ${jsAssets.map((a) => `${a.name} ${(a.size / 1024).toFixed(1)} kB`).join('; ')}`);
