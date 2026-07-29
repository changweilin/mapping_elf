// shapes.mjs — parametric test-stroke generators for the Mapping Elf drawing board.
// Pure ESM, zero dependencies. Canvas convention: size x size CSS px, y grows DOWNWARD.
// Each stroke traverses its outline exactly once, is resampled to ~spacing px between
// consecutive points, and stops short of the first point (small hand-drawn gap).
// Sharp corners (star vertices, heart cusps, palm notches) are piece boundaries, so the
// arc-length resampler always lands a sample exactly on them — no chord ever cuts
// across a sharp corner (which would violate the [1, 6] px spacing contract).

export const SHAPE_NAMES = ['heart', 'star', 'plum', 'palm'];

const TAU = Math.PI * 2;

function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function arcPts(c, r, a0, a1, steps) {
  const out = [];
  for (let j = 0; j <= steps; j++) {
    const a = a0 + ((a1 - a0) * j) / steps;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shape builders. Local coords are y-UP (math convention); fitToCanvas flips.
// Each builder returns an ordered list of "pieces" (polylines). Piece i ends
// exactly where piece i+1 begins; the last piece ends at the first piece's
// start point, closing the outline.
// ---------------------------------------------------------------------------

function heartPieces() {
  // Classic parametric heart. Cusps at t=0 (top dip) and t=pi (bottom point)
  // — both are piece boundaries. Traversal starts at the bottom cusp.
  const f = (t) => [
    16 * Math.sin(t) ** 3,
    13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
  ];
  const M = 1400;
  const half = (t0) => {
    const pts = [];
    for (let k = 0; k <= M; k++) pts.push(f(t0 + (Math.PI * k) / M));
    return pts;
  };
  return [half(Math.PI), half(0)]; // bottom cusp -> top dip -> bottom cusp
}

function starPieces() {
  // 5-pointed star, one tip straight up, straight edges (10 pieces).
  const v = [];
  for (let k = 0; k < 10; k++) {
    const ang = Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 === 0 ? 1 : 0.42;
    v.push([rad * Math.cos(ang), rad * Math.sin(ang)]);
  }
  const pieces = [];
  for (let k = 0; k < 10; k++) pieces.push([v[k], v[(k + 1) % 10]]);
  return pieces;
}

function plumPieces() {
  // 5-petal plum blossom: r = 0.70 + 0.30 cos(5*(theta - 90deg)), lobe up.
  const M = 3000;
  const pts = [];
  for (let k = 0; k <= M; k++) {
    const th = Math.PI / 2 + (TAU * k) / M;
    const r = 0.7 + 0.3 * Math.cos(5 * (th - Math.PI / 2));
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return [pts]; // single smooth closed piece
}

function palmPieces() {
  // Upright open hand: wrist bottom, thumb on the left, 4 fingers up with
  // rounded (semicircular) tips and V notches at ~58% of finger height.
  const pieces = [];
  const hw = 8; // finger half-width
  const baseY = 88; // finger base line (palm top)
  const fingers = [
    { cx: 38, top: 150 }, // index
    { cx: 57, top: 164 }, // middle
    { cx: 76, top: 154 }, // ring
    { cx: 95, top: 126 }, // pinky
  ];
  const notchY = [];
  for (let i = 0; i < 3; i++) {
    notchY.push(baseY + 0.58 * (Math.min(fingers[i].top, fingers[i + 1].top) - baseY));
  }

  // Thumb: capsule (two sides + semicircular tip) around an angled axis.
  const tb = [22, 34]; // thumb base (axis)
  const tt = [4, 58]; // thumb tip center (axis)
  const thw = 7; // thumb half-width
  const len = dist(tb, tt);
  const u = [(tt[0] - tb[0]) / len, (tt[1] - tb[1]) / len];
  const p = [-u[1], u[0]]; // normal pointing to the outer/lower thumb side
  const off = (pt, k) => [pt[0] + p[0] * k, pt[1] + p[1] * k];
  const wristL = [30, 0];
  const wristR = [74, 0];

  pieces.push([wristL, off(tb, thw)]); // left palm edge
  pieces.push([off(tb, thw), off(tt, thw)]); // thumb lower side
  const a0 = Math.atan2(p[1], p[0]);
  pieces.push(arcPts(tt, thw, a0, a0 - Math.PI, 16)); // rounded thumb tip (through axis dir)
  pieces.push([off(tt, -thw), off(tb, -thw)]); // thumb upper side
  pieces.push([off(tb, -thw), [31, 60], [fingers[0].cx - hw, baseY]]); // thumb-index web

  for (let i = 0; i < 4; i++) {
    const f = fingers[i];
    const tipc = f.top - hw; // fingertip arc center height
    const lY = i === 0 ? baseY : notchY[i - 1] + 2;
    const rY = i < 3 ? notchY[i] + 2 : 86;
    pieces.push([[f.cx - hw, lY], [f.cx - hw, tipc]]); // finger left side
    pieces.push(arcPts([f.cx, tipc], hw, Math.PI, 0, 16)); // rounded fingertip
    pieces.push([[f.cx + hw, tipc], [f.cx + hw, rY]]); // finger right side
    if (i < 3) {
      const midX = (f.cx + hw + fingers[i + 1].cx - hw) / 2;
      pieces.push([[f.cx + hw, rY], [midX, notchY[i]]]); // V notch, down leg
      pieces.push([[midX, notchY[i]], [fingers[i + 1].cx - hw, rY]]); // V notch, up leg
    }
  }

  pieces.push([[fingers[3].cx + hw, 86], [100, 40], wristR]); // right palm edge
  pieces.push([wristR, wristL]); // wrist bottom, closes the loop
  return pieces;
}

const BUILDERS = {
  heart: { build: heartPieces, fill: 0.82 },
  star: { build: starPieces, fill: 0.8 },
  plum: { build: plumPieces, fill: 0.8 },
  palm: { build: palmPieces, fill: 0.8 },
};

// ---------------------------------------------------------------------------
// Fit + resample
// ---------------------------------------------------------------------------

function fitToCanvas(pieces, size, fillFrac) {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const pc of pieces) {
    for (const [x, y] of pc) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const s = (fillFrac * size) / Math.max(xMax - xMin, yMax - yMin);
  const xm = (xMin + xMax) / 2;
  const ym = (yMin + yMax) / 2;
  const c = size / 2;
  // y flip: local y-up -> canvas y-down
  return pieces.map((pc) => pc.map(([x, y]) => [c + s * (x - xm), c - s * (y - ym)]));
}

function resampleClosed(pieces, spacing) {
  const out = [];
  for (const piece of pieces) {
    const cum = [0];
    for (let i = 1; i < piece.length; i++) cum.push(cum[i - 1] + dist(piece[i - 1], piece[i]));
    const L = cum[cum.length - 1];
    const n = Math.max(1, Math.round(L / spacing));
    let idx = 0;
    for (let j = 0; j < n; j++) {
      const s = (L * j) / n; // piece end excluded: it is the next piece's start
      while (idx < piece.length - 2 && cum[idx + 1] < s) idx++;
      const seg = cum[idx + 1] - cum[idx];
      const t = seg > 0 ? (s - cum[idx]) / seg : 0;
      out.push([
        piece[idx][0] + (piece[idx + 1][0] - piece[idx][0]) * t,
        piece[idx][1] + (piece[idx + 1][1] - piece[idx][1]) * t,
      ]);
    }
  }
  out.pop(); // stop ~2 samples early: hand-drawn gap, first point never repeated
  return out;
}

export function shapeStroke(name, opts = {}) {
  const { size = 300, spacing = 3 } = opts;
  const b = BUILDERS[name];
  if (!b) throw new Error(`unknown shape: ${name}`);
  return resampleClosed(fitToCanvas(b.build(), size, b.fill), spacing);
}

// ---------------------------------------------------------------------------
// SVG preview
// ---------------------------------------------------------------------------

export function strokesToSvg(namedStrokes, size = 300) {
  const n = namedStrokes.length;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n * size}" height="${size}" viewBox="0 0 ${n * size} ${size}">`,
    `<rect width="${n * size}" height="${size}" fill="white"/>`,
  ];
  namedStrokes.forEach(({ name, stroke }, i) => {
    const ox = i * size;
    const pts = stroke.map(([x, y]) => `${(ox + x).toFixed(2)},${y.toFixed(2)}`).join(' ');
    parts.push(`<g>`);
    parts.push(`<rect x="${ox + 0.5}" y="0.5" width="${size - 1}" height="${size - 1}" fill="none" stroke="#999"/>`);
    parts.push(`<polyline points="${pts}" fill="none" stroke="#1565c0" stroke-width="2"/>`);
    parts.push(`<circle cx="${(ox + stroke[0][0]).toFixed(2)}" cy="${stroke[0][1].toFixed(2)}" r="4" fill="#e53935"/>`);
    parts.push(`<text x="${ox + 10}" y="20" font-family="sans-serif" font-size="14" fill="#333">${name}</text>`);
    parts.push(`</g>`);
  });
  parts.push(`</svg>`);
  return parts.join('\n');
}
