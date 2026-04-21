import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

const root = path.resolve(process.cwd());
const DATA = path.join(root, 'data');
const OUT = path.join(root, 'assets');

await fs.mkdir(OUT, { recursive: true });

// 1) icon-only: 1024x1024 transparent, simple_owl_cursor
await sharp(path.join(DATA, 'simple_owl_cursor.png'))
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(OUT, 'icon-only.png'));
console.log('wrote icon-only.png');

// Adaptive icon foreground needs extra padding (Android masks ~66% inside a safe zone).
// Place the owl on a transparent 1024x1024 at ~60% size so launcher masks don't crop it.
const fgSize = Math.round(1024 * 0.60);
const fgOwl = await sharp(path.join(DATA, 'simple_owl_cursor.png'))
  .resize(fgSize, fgSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{ input: fgOwl, gravity: 'center' }]).png().toFile(path.join(OUT, 'icon-foreground.png'));
console.log('wrote icon-foreground.png');

// Flat background tile matching the app chrome
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0x0f, g: 0x11, b: 0x17, alpha: 1 } }
}).png().toFile(path.join(OUT, 'icon-background.png'));
console.log('wrote icon-background.png');

// 2) splash: 2732x2732 on #0f1117, mapping_owl_cursor centered at ~55% of shorter side
const splashBg = { r: 0x0f, g: 0x11, b: 0x17, alpha: 1 };
const owlTargetW = Math.round(2732 * 0.55);
// preserve aspect ratio via fit:inside
const owlBuffer = await sharp(path.join(DATA, 'mapping_owl_cursor.png'))
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
