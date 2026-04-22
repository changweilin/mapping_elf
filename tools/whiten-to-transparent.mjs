/**
 * SVG 白邊清理 + 原生資產生成工具
 *
 * 功能：
 * 1. 將 SVG 中的白色/黑色/淺色 path 替換為透明或主體色
 * 2. 針對 mapping_owl_cursor.svg 提供區域性精準過濾
 * 3. 從處理後的 SVG 重新生成 PNG 資產（icon, splash）
 *
 * 用法：node tools/whiten-to-transparent.mjs
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import {
  getBoundingBox,
  isNearWhite,
  isNearBlack,
  isPalePattern,
  parseHex,
} from './svg-utils.mjs';

const root = path.resolve(process.cwd());

/** 貓頭鷹 SVG 專用的主體色 */
const OWL_BODY_COLOR = "#2E3658";

/**
 * 判斷 path 的包圍框是否位於地圖區域 (Y > 1230)。
 * 使用較高的閾值以避免誤觸山丘底部邊界線。
 */
function isInsideMapRegion(bbox) {
  if (!bbox) return false;
  return bbox.minY > 1230;
}

/**
 * 判斷 path 的包圍框是否位於需要清理的目標區域。
 * 用於 mapping_owl_cursor.svg 的精準區域過濾。
 */
function isInsideTargetRegion(bbox) {
  if (!bbox) return false;

  // 1. 保護山丘和地圖底部（Y > 1170）以及最左側邊緣（X < 450）
  if (bbox.minY > 1170 || bbox.minX < 450) return false;

  // 2. 頭頂區域（Y < 550）— 只處理中間範圍
  const HEAD_TOP = bbox.maxY < 550 && bbox.minX > 800 && bbox.maxX < 1500;
  if (HEAD_TOP) return true;

  // 3. 嚴格跳過右半邊（X > 1150）
  if (bbox.minX > 1150) return false;

  // 4. 左翼精準矩形（只處理山丘線以上的紋理）
  const wing_upper = (bbox.minX < 1050 && bbox.maxX > 450 && bbox.minY < 1000 && bbox.maxY > 600);
  const wing_lower = (bbox.minX < 900 && bbox.maxX > 550 && bbox.minY < 1170 && bbox.maxY > 1000);

  return wing_upper || wing_lower;
}

/**
 * 清理單一 SVG 檔案中的白邊和淺色圖案。
 * @param {string} filePath - SVG 檔案的絕對路徑
 */
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
    let shouldConvertFill = false;
    let shouldConvertStroke = false;
    let mapFillTarget = null;
    let mapStrokeTarget = null;

    if (fillMatch) {
      const hex = fillMatch[1].toUpperCase();
      if (isNearWhite(hex) || isNearBlack(hex)) {
        shouldClearFill = true;
      } else if (isMappingOwl && hex !== OWL_BODY_COLOR) {
        const bbox = getBoundingBox(dMatch ? dMatch[1] : "");
        if (isInsideMapRegion(bbox)) {
          const { r, g, b } = parseHex(hex);
          const brightness = r + g + b;
          const w = bbox.maxX - bbox.minX;
          const h = bbox.maxY - bbox.minY;

          // 亮度夠高且非主體色才視為地圖米色區域，深色結構線（亮度 < 420）維持不變
          if (brightness >= 420) {
            if (w * h < 1500) {
              shouldClearFill = true; // 將極細微的紋路和斑點填補（移除以露出底色）
            } else {
              // 分類為較深或較淺的米色兩種
              mapFillTarget = (brightness > 480) ? '#D7B181' : '#C0956A';
            }
          }
        } else if (isInsideTargetRegion(bbox)) {
          if (isPalePattern(hex)) {
            shouldClearFill = true;
          } else {
            shouldConvertFill = true;
          }
        }
      }
      if (shouldClearFill) removed.add(hex);
    }

    if (strokeMatch) {
      const hex = strokeMatch[1].toUpperCase();
      if (isNearWhite(hex) || isNearBlack(hex)) {
        shouldClearStroke = true;
      } else if (isMappingOwl && hex !== OWL_BODY_COLOR) {
        const bbox = getBoundingBox(dMatch ? dMatch[1] : "");
        if (isInsideMapRegion(bbox)) {
          const { r, g, b } = parseHex(hex);
          const brightness = r + g + b;
          const w = bbox.maxX - bbox.minX;
          const h = bbox.maxY - bbox.minY;

          if (brightness >= 420) {
            if (w * h < 1500) {
              shouldClearStroke = true;
            } else {
              mapStrokeTarget = (brightness > 480) ? '#D7B181' : '#C0956A';
            }
          }
        } else if (isInsideTargetRegion(bbox)) {
          if (isPalePattern(hex)) {
            shouldClearStroke = true;
          } else {
            shouldConvertStroke = true;
          }
        }
      }
      if (shouldClearStroke) removed.add(hex);
    }

    let tag = m;
    if (shouldClearFill) tag = tag.replace(/fill="(#[0-9a-fA-F]{6})"/, 'fill="none"');
    else if (mapFillTarget) tag = tag.replace(/fill="(#[0-9a-fA-F]{6})"/, `fill="${mapFillTarget}"`);
    else if (shouldConvertFill) tag = tag.replace(/fill="(#[0-9a-fA-F]{6})"/, `fill="${OWL_BODY_COLOR}"`);

    if (shouldClearStroke) tag = tag.replace(/stroke="(#[0-9a-fA-F]{6})"/, 'stroke="none"');
    else if (mapStrokeTarget) tag = tag.replace(/stroke="(#[0-9a-fA-F]{6})"/, `stroke="${mapStrokeTarget}"`);
    else if (shouldConvertStroke) tag = tag.replace(/stroke="(#[0-9a-fA-F]{6})"/, `stroke="${OWL_BODY_COLOR}"`);

    return tag;
  });

  await fs.writeFile(filePath, after);
  console.log(`updated ${path.relative(root, filePath)} — removed [${[...removed].join(', ')}]`);
}

// ── 1) 清理 SVG 白邊 ──────────────────────────────────────────

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

// ── 2) 從處理後的 SVG 重新生成原生資產 ─────────────────────────

const OUT = path.join(root, 'assets');
await fs.mkdir(OUT, { recursive: true });

const simpleSvg = path.join(root, 'public/simple_owl_cursor.svg');
const mappingSvg = path.join(root, 'public/mapping_owl_cursor.svg');

// icon-only: 1024x1024 透明背景
await sharp(simpleSvg, { density: 512 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(OUT, 'icon-only.png'));
console.log('wrote icon-only.png');

// icon-foreground: 貓頭鷹置中於 1024 畫布，約 60%（自適應圖示安全區域）
const fgSize = Math.round(1024 * 0.60);
const fgOwl = await sharp(simpleSvg, { density: 512 })
  .resize(fgSize, fgSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{ input: fgOwl, gravity: 'center' }]).png().toFile(path.join(OUT, 'icon-foreground.png'));
console.log('wrote icon-foreground.png');

// icon-background: 與 app 主題色一致的純色背景
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0x0f, g: 0x11, b: 0x17, alpha: 1 } }
}).png().toFile(path.join(OUT, 'icon-background.png'));
console.log('wrote icon-background.png');

// splash: 2732x2732 暗色背景，mapping owl 置中約 55%
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
