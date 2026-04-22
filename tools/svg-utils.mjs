/**
 * SVG 分析共用模組
 *
 * 提供 SVG path 解析、包圍框計算、顏色分類等可重用工具函式。
 * 從 scratch/ 中多個調查腳本的重複邏輯整合而來。
 */

/**
 * 從 SVG path 的 d 屬性中計算包圍框 (bounding box)。
 * @param {string} d - SVG path 的 d 屬性值
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, centerX: number, centerY: number } | null}
 */
export function getBoundingBox(d) {
  const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (!coords) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    if (coords[i + 1] === undefined) break;
    const x = parseFloat(coords[i]);
    const y = parseFloat(coords[i + 1]);
    if (isNaN(x) || isNaN(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

/**
 * 從 SVG 內容中解析所有 <path> 元素的 fill、stroke 和包圍框資訊。
 * @param {string} svgContent - SVG 檔案內容字串
 * @returns {Array<{ color: string, stroke: string|null, bbox: object, raw: string }>}
 */
export function parseSvgPaths(svgContent) {
  const pathRegex = /<path([^>]+)>/g;
  let match;
  const results = [];

  while ((match = pathRegex.exec(svgContent)) !== null) {
    const attrs = match[1];
    const fillMatch = attrs.match(/fill="(#[0-9a-fA-F]{6})"/);
    const strokeMatch = attrs.match(/stroke="(#[0-9a-fA-F]{6})"/);
    const dMatch = attrs.match(/d="([^"]+)"/);

    if (dMatch) {
      const bbox = getBoundingBox(dMatch[1]);
      if (bbox) {
        results.push({
          color: fillMatch ? fillMatch[1].toUpperCase() : null,
          stroke: strokeMatch ? strokeMatch[1].toUpperCase() : null,
          bbox,
          raw: match[0],
        });
      }
    }
  }

  return results;
}

/**
 * 列出 SVG 內容中所有使用到的顏色（fill 與 stroke）。
 * @param {string} svgContent - SVG 檔案內容字串
 * @returns {string[]} 排序過的唯一色碼陣列
 */
export function listColors(svgContent) {
  const colors = new Set();
  const matches = svgContent.matchAll(/(fill|stroke)="(#[0-9a-fA-F]{6})"/g);
  for (const match of matches) {
    colors.add(match[2].toUpperCase());
  }
  return Array.from(colors).sort();
}

/**
 * 解析 hex 色碼為 RGB 值。
 * @param {string} hex - 例如 "#FF00AA"
 * @returns {{ r: number, g: number, b: number }}
 */
export function parseHex(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * 判斷 hex 色碼是否接近白色（中性且高亮度）。
 * 捕捉純白、奶油色 (#F9F3E5)、淺灰 (#DADADE) 等。
 * @param {string} hex
 * @returns {boolean}
 */
export function isNearWhite(hex) {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return (max - min) <= 50 && avg >= 190;
}

/**
 * 判斷 hex 色碼是否接近黑色（中性且低亮度）。
 * @param {string} hex
 * @returns {boolean}
 */
export function isNearBlack(hex) {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return (max - min) <= 40 && avg <= 40;
}

/**
 * 判斷 hex 色碼是否為淺色圖案（低飽和 + 中亮度）。
 * 用於偵測 SVG 中不需要的淺色斑點或紋理。
 * @param {string} hex
 * @returns {boolean}
 */
export function isPalePattern(hex) {
  const { r, g, b } = parseHex(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  return (max - min) <= 100 && avg >= 110;
}

/**
 * 依顏色統計 path 數量及整體範圍。
 * @param {Array<{ color: string, bbox: object }>} paths - parseSvgPaths 的回傳結果
 * @returns {Object<string, { count: number, area: number, minX: number, minY: number, maxX: number, maxY: number }>}
 */
export function groupByColor(paths) {
  const groups = {};
  paths.forEach(item => {
    if (!item.color) return;
    if (!groups[item.color]) {
      groups[item.color] = {
        count: 0, area: 0,
        minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity
      };
    }
    const g = groups[item.color];
    g.count++;
    const w = item.bbox.maxX - item.bbox.minX;
    const h = item.bbox.maxY - item.bbox.minY;
    g.area += w * h;
    if (item.bbox.minX < g.minX) g.minX = item.bbox.minX;
    if (item.bbox.minY < g.minY) g.minY = item.bbox.minY;
    if (item.bbox.maxX > g.maxX) g.maxX = item.bbox.maxX;
    if (item.bbox.maxY > g.maxY) g.maxY = item.bbox.maxY;
  });
  return groups;
}
