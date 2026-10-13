/**
 * Mapping Elf — Preset Shape Library for Drawing Board
 *
 * Provides 12 preset shapes for GPS art / loop running route generation:
 * 愛心 (Heart), 星星 (Star), 月亮 (Moon), 太陽 (Sun), 鑽石 (Diamond),
 * 梅花 (Plum blossom), 貓 (Cat), 狗 (Dog), 鳥 (Bird), 魚 (Fish),
 * 馬 (Horse), 蝴蝶 (Butterfly).
 *
 * Each preset shape provides points normalized in [0, 1] canvas coordinates,
 * centered with comfortable margins, forming a smooth closed loop suitable for
 * shapeRoutePlanner.js and Leaflet map route generation.
 */

function normalizePoints(pts, targetPadding = 0.08) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = (1 - targetPadding * 2) / Math.max(w, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return pts.map(([x, y]) => [
    Number((0.5 + (x - cx) * scale).toFixed(4)),
    Number((0.5 + (y - cy) * scale).toFixed(4)),
  ]);
}

function interpolateSmoothRing(verts, totalCount = 96) {
  const n = verts.length - 1;
  const out = [];
  const stepsPerSeg = Math.max(2, Math.floor(totalCount / n));
  for (let i = 0; i < n; i++) {
    const p0 = verts[(i - 1 + n) % n];
    const p1 = verts[i];
    const p2 = verts[(i + 1) % n];
    const p3 = verts[(i + 2) % n];
    for (let s = 0; s < stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(out[0]);
  return normalizePoints(out);
}

function generateHeart(n = 80) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([x, y]);
  }
  return normalizePoints(pts);
}

function generateStar(nPerSegment = 8) {
  const pts = [];
  const points = 5;
  const R = 1.0, r = 0.42;
  const verts = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? R : r;
    verts.push([rad * Math.cos(angle), rad * Math.sin(angle)]);
  }
  verts.push(verts[0]);
  for (let i = 0; i < verts.length - 1; i++) {
    const p1 = verts[i], p2 = verts[i + 1];
    for (let j = 0; j < nPerSegment; j++) {
      const f = j / nPerSegment;
      pts.push([p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f]);
    }
  }
  pts.push(verts[0]);
  return normalizePoints(pts);
}

function generateMoon(n = 60) {
  const pts = [];
  const R_outer = 1.0;
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI * 0.42 + (i / n) * Math.PI * 0.84;
    pts.push([R_outer * Math.cos(t), R_outer * Math.sin(t)]);
  }
  const R_inner = 0.82;
  const cx_inner = 0.42;
  for (let i = n; i >= 0; i--) {
    const t = -Math.PI * 0.38 + (i / n) * Math.PI * 0.76;
    pts.push([cx_inner + R_inner * Math.cos(t), R_inner * Math.sin(t)]);
  }
  return normalizePoints(pts);
}

function generateSun(rays = 12, nPerRay = 6) {
  const pts = [];
  const totalSteps = rays * 2;
  const R_ray = 1.0;
  const R_base = 0.65;
  const verts = [];
  for (let i = 0; i < totalSteps; i++) {
    const angle = (i * Math.PI * 2) / totalSteps;
    const r = i % 2 === 0 ? R_ray : R_base;
    verts.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  verts.push(verts[0]);
  for (let i = 0; i < verts.length - 1; i++) {
    const p1 = verts[i], p2 = verts[i + 1];
    for (let j = 0; j < nPerRay; j++) {
      const f = j / nPerRay;
      pts.push([p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f]);
    }
  }
  pts.push(verts[0]);
  return normalizePoints(pts);
}

function generateDiamond() {
  const verts = [
    [0.32, 0.20],
    [0.68, 0.20],
    [0.88, 0.40],
    [0.50, 0.84],
    [0.12, 0.40],
    [0.32, 0.20],
  ];
  const pts = [];
  const stepsPerSeg = 14;
  for (let i = 0; i < verts.length - 1; i++) {
    const p1 = verts[i], p2 = verts[i + 1];
    for (let j = 0; j < stepsPerSeg; j++) {
      const f = j / stepsPerSeg;
      pts.push([p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f]);
    }
  }
  pts.push(verts[0]);
  return normalizePoints(pts);
}

function generatePlumBlossom(n = 100) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = 0.7 + 0.3 * Math.cos(5 * t);
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return normalizePoints(pts);
}

function generateCat(n = 90) {
  const verts = [
    [0.50, 0.82],
    [0.65, 0.80],
    [0.78, 0.68],
    [0.76, 0.50],
    [0.82, 0.22],
    [0.64, 0.32],
    [0.50, 0.35],
    [0.36, 0.32],
    [0.18, 0.22],
    [0.24, 0.50],
    [0.22, 0.68],
    [0.35, 0.80],
    [0.50, 0.82],
  ];
  return interpolateSmoothRing(verts, n);
}

function generateDog(n = 100) {
  const verts = [
    [0.22, 0.48],
    [0.24, 0.56],
    [0.32, 0.58],
    [0.32, 0.78],
    [0.38, 0.78],
    [0.40, 0.66],
    [0.55, 0.66],
    [0.62, 0.78],
    [0.68, 0.78],
    [0.70, 0.62],
    [0.76, 0.55],
    [0.86, 0.42],
    [0.80, 0.48],
    [0.66, 0.50],
    [0.52, 0.46],
    [0.48, 0.30],
    [0.42, 0.24],
    [0.36, 0.32],
    [0.38, 0.42],
    [0.22, 0.48],
  ];
  return interpolateSmoothRing(verts, n);
}

function generateBird(n = 90) {
  const verts = [
    [0.50, 0.20],
    [0.53, 0.25],
    [0.62, 0.30],
    [0.86, 0.26],
    [0.78, 0.46],
    [0.62, 0.52],
    [0.56, 0.78],
    [0.50, 0.74],
    [0.44, 0.78],
    [0.38, 0.52],
    [0.22, 0.46],
    [0.14, 0.26],
    [0.38, 0.30],
    [0.47, 0.25],
    [0.50, 0.20],
  ];
  return interpolateSmoothRing(verts, n);
}

function generateFish(n = 90) {
  const verts = [
    [0.16, 0.50],
    [0.26, 0.38],
    [0.42, 0.30],
    [0.52, 0.22],
    [0.58, 0.36],
    [0.70, 0.44],
    [0.84, 0.28],
    [0.78, 0.50],
    [0.84, 0.72],
    [0.70, 0.56],
    [0.54, 0.64],
    [0.46, 0.72],
    [0.38, 0.62],
    [0.26, 0.58],
    [0.16, 0.50],
  ];
  return interpolateSmoothRing(verts, n);
}

function generateHorse(n = 100) {
  const verts = [
    [0.18, 0.36],
    [0.20, 0.42],
    [0.28, 0.44],
    [0.34, 0.56],
    [0.34, 0.80],
    [0.38, 0.80],
    [0.40, 0.62],
    [0.44, 0.80],
    [0.48, 0.80],
    [0.50, 0.64],
    [0.62, 0.64],
    [0.64, 0.82],
    [0.68, 0.82],
    [0.70, 0.68],
    [0.74, 0.82],
    [0.78, 0.82],
    [0.80, 0.62],
    [0.82, 0.52],
    [0.88, 0.60],
    [0.84, 0.46],
    [0.72, 0.44],
    [0.60, 0.42],
    [0.50, 0.30],
    [0.40, 0.20],
    [0.34, 0.22],
    [0.26, 0.28],
    [0.18, 0.36],
  ];
  return interpolateSmoothRing(verts, n);
}

function generateButterfly(n = 100) {
  const rightHalf = [
    [0.50, 0.18],
    [0.52, 0.24],
    [0.60, 0.22],
    [0.78, 0.16],
    [0.88, 0.28],
    [0.82, 0.46],
    [0.68, 0.50],
    [0.80, 0.62],
    [0.76, 0.74],
    [0.62, 0.72],
    [0.54, 0.62],
    [0.50, 0.82],
  ];
  const leftHalf = rightHalf.slice(1, -1).reverse().map(([x, y]) => [1 - x, y]);
  const allVerts = [...rightHalf, ...leftHalf, rightHalf[0]];
  return interpolateSmoothRing(allVerts, n);
}

export const SHAPE_PRESETS = [
  { id: 'heart', name: '愛心', emoji: '❤️', points: generateHeart() },
  { id: 'star', name: '星星', emoji: '⭐', points: generateStar() },
  { id: 'moon', name: '月亮', emoji: '🌙', points: generateMoon() },
  { id: 'sun', name: '太陽', emoji: '☀️', points: generateSun() },
  { id: 'diamond', name: '鑽石', emoji: '💎', points: generateDiamond() },
  { id: 'club', name: '梅花', emoji: '♣️', points: generatePlumBlossom() },
  { id: 'cat', name: '貓', emoji: '🐱', points: generateCat() },
  { id: 'dog', name: '狗', emoji: '🐶', points: generateDog() },
  { id: 'bird', name: '鳥', emoji: '🐦', points: generateBird() },
  { id: 'fish', name: '魚', emoji: '🐟', points: generateFish() },
  { id: 'horse', name: '馬', emoji: '🐴', points: generateHorse() },
  { id: 'butterfly', name: '蝴蝶', emoji: '🦋', points: generateButterfly() },
];

const PRESETS_BY_ID = new Map(SHAPE_PRESETS.map((p) => [p.id, p]));

export function getShapePreset(id) {
  return PRESETS_BY_ID.get(id) || null;
}

export function getShapePresetPoints(id, canvasWidth = 216) {
  const preset = getShapePreset(id);
  if (!preset) return null;
  const w = canvasWidth >= 1 ? canvasWidth : 216;
  return preset.points.map(([x, y]) => [x * w, y * w]);
}
