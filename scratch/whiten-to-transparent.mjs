import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

const root = path.resolve(process.cwd());

// Decide whether a hex color counts as "white-ish" — neutral + bright.
// Catches pure whites, creams (#F9F3E5), and light grays (#DADADE),
// rejects browns (#C49D6A), navy (#2F395D), and black.
function isNearWhite(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return (max - min) <= 50 && avg >= 190;
}

function isNearBlack(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  // Threshold: Neutral (low saturation) and average brightness below 40 (~15%)
  return (max - min) <= 40 && avg <= 40;
}

function isPalePattern(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  // Loosened threshold: catch more saturated (up to 100) and darker (down to 110)
  return (max - min) <= 100 && avg >= 110;
}

function getPathBoundingBox(d) {
  const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (!coords) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
      if (coords[i+1] === undefined) break;
      const x = parseFloat(coords[i]);
      const y = parseFloat(coords[i+1]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function isInsideTargetRegion(bbox) {
  if (!bbox) return false;
  
  // 1. Hard protection for hills and map base (raising line to 1170)
  // Also protect the far left edge (X < 450) where hills start
  if (bbox.minY > 1170 || bbox.minX < 450) return false;
  
  // 2. Head Top (Y < 550) - middle-focused
  const HEAD_TOP = bbox.maxY < 550 && bbox.minX > 800 && bbox.maxX < 1500;
  if (HEAD_TOP) return true;

  // 3. Right side protection: strictly skip everything on the right half (X > 1150)
  if (bbox.minX > 1150) return false;

  // 4. Tight Left Wing rectangles (targeting textures above the hill line)
  const wing_upper = (bbox.minX < 1050 && bbox.maxX > 450 && bbox.minY < 1000 && bbox.maxY > 600);
  const wing_lower = (bbox.minX < 900 && bbox.maxX > 550 && bbox.minY < 1170 && bbox.maxY > 1000);
  
  return wing_upper || wing_lower;
}

async function whitenSvg(filePath) {
  const before = await fs.readFile(filePath, 'utf8');
  const removed = new Set();
  const isMappingOwl = filePath.includes('mapping_owl_cursor.svg');

  const after = before.replace(/<path([^>]+)>/g, (m, attrs) => {
    const fillMatch = attrs.match(/fill="(#[0-9a-fA-F]{6})"/);
    const strokeMatch = attrs.match(/stroke="(#[0-9a-fA-F]{6})"/);
    const dMatch = attrs.match(/d="([^"]+)"/);

    let shouldClearFill = false;
    let shouldClearStroke = false;

    if (fillMatch) {
      const hex = fillMatch[1].toUpperCase();
      if (isNearWhite(hex) || isNearBlack(hex)) {
        shouldClearFill = true;
      } else if (isMappingOwl && isPalePattern(hex)) {
        const bbox = getPathBoundingBox(dMatch ? dMatch[1] : "");
        if (isInsideTargetRegion(bbox)) {
          shouldClearFill = true;
        }
      }
      if (shouldClearFill) removed.add(hex);
    }

    if (strokeMatch) {
      const hex = strokeMatch[1].toUpperCase();
      if (isNearWhite(hex) || isNearBlack(hex)) {
        shouldClearStroke = true;
      } else if (isMappingOwl && isPalePattern(hex)) {
        const bbox = getPathBoundingBox(dMatch ? dMatch[1] : "");
        if (isInsideTargetRegion(bbox)) {
          shouldClearStroke = true;
        }
      }
      if (shouldClearStroke) removed.add(hex);
    }

    let tag = m;
    if (shouldClearFill) tag = tag.replace(/fill="(#[0-9a-fA-F]{6})"/, 'fill="none"');
    if (shouldClearStroke) tag = tag.replace(/stroke="(#[0-9a-fA-F]{6})"/, 'stroke="none"');
    return tag;
  });

  await fs.writeFile(filePath, after);
  console.log(`updated ${path.relative(root, filePath)} — removed [${[...removed].join(', ')}]`);
}

// 1) Rewrite the three web SVGs
const svgs = [
  'public/simple_owl_cursor.svg',
  'public/mapping_owl_cursor.svg',
  'public/favicon.svg',
  'data/simple_owl_cursor.svg',
  'data/mapping_owl_cursor.svg',
];
for (const rel of svgs) {
  await whitenSvg(path.join(root, rel));
}

// 2) Regenerate the native asset masters from the updated SVGs
const OUT = path.join(root, 'assets');
await fs.mkdir(OUT, { recursive: true });

const simpleSvg = path.join(root, 'public/simple_owl_cursor.svg');
const mappingSvg = path.join(root, 'public/mapping_owl_cursor.svg');

// icon-only: 1024x1024 transparent
await sharp(simpleSvg, { density: 512 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(OUT, 'icon-only.png'));
console.log('wrote icon-only.png');

// icon-foreground: owl on transparent 1024 canvas at ~60% (safe zone for adaptive icons)
const fgSize = Math.round(1024 * 0.60);
const fgOwl = await sharp(simpleSvg, { density: 512 })
  .resize(fgSize, fgSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{ input: fgOwl, gravity: 'center' }]).png().toFile(path.join(OUT, 'icon-foreground.png'));
console.log('wrote icon-foreground.png');

// icon-background: flat tile matching app chrome
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0x0f, g: 0x11, b: 0x17, alpha: 1 } }
}).png().toFile(path.join(OUT, 'icon-background.png'));
console.log('wrote icon-background.png');

// splash: 2732x2732 on #0f1117, mapping owl centered at ~55%
const splashBg = { r: 0x0f, g: 0x11, b: 0x17, alpha: 1 };
const owlTargetW = Math.round(2732 * 0.55);
const owlBuffer = await sharp(mappingSvg, { density: 512 })
  .resize({ width: owlTargetW, withoutEnlargement: false })
  .png()
  .toBuffer();
await sharp({
  create: { width: 2732, height: 2732, channels: 3, background: splashBg }
}).composite([{ input: owlBuffer, gravity: 'center' }])
  .png()
  .toFile(path.join(OUT, 'splash.png'));
console.log('wrote splash.png');

await fs.copyFile(path.join(OUT, 'splash.png'), path.join(OUT, 'splash-dark.png'));
console.log('wrote splash-dark.png');
