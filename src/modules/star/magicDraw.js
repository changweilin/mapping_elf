import {
  ZODIAC_CONSTELLATIONS
} from "./magicCircle.js";

// Inlined from mapping_star's settings.ts: the elf port keeps its own
// preference storage (mappingElf_* keys), so only this default map is needed.
const DEFAULT_MAGIC_DRAW_VARIANTS = {
  star: "5",
  cross: "4",
  bagua: "8",
  rose: "k-7",
  sierpinski: "d-3",
  zodiac: "1"
};
const MAGIC_PLAYBACK_MODES = [
  { id: "single", label: "單曲播放" },
  { id: "continuous", label: "連續播放" },
  { id: "loop-all", label: "循環播放" },
  { id: "loop-one", label: "單曲循環播放" }
];
const makeCombinedVariant = (id, label, mode, combinedShape) => ({
  id,
  label,
  mode,
  geometryPattern: "combined",
  geometryOptions: { combinedShape }
});
const MAGIC_DRAW_SHAPE_OPTIONS = [
  { id: "star", label: "星芒" },
  { id: "cross", label: "十字星" },
  { id: "bagua", label: "八卦陣" },
  { id: "rose", label: "玫瑰曲線" },
  { id: "sierpinski", label: "Sierpinski 三角形" },
  { id: "zodiac", label: "星座" }
];
const MAGIC_DRAW_VARIANT_OPTIONS = {
  star: [
    makeCombinedVariant("5", "5", 5, "star"),
    makeCombinedVariant("6", "6", 6, "star"),
    makeCombinedVariant("7", "7", 7, "star"),
    makeCombinedVariant("8", "8", 8, "star")
  ],
  cross: [makeCombinedVariant("4", "4", 4, "cross")],
  bagua: [makeCombinedVariant("8", "8", 8, "bagua")],
  rose: [2, 3, 4, 5, 6, 7, 8, 9].map((petalFactor) => ({
    id: `k-${petalFactor}`,
    label: petalFactor % 2 === 0 ? `k=${petalFactor} (${petalFactor * 2}瓣)` : `k=${petalFactor}`,
    geometryPattern: "rose",
    geometryOptions: { rosePetalFactor: petalFactor }
  })),
  sierpinski: [1, 2, 3, 4].map((depth) => ({
    id: `d-${depth}`,
    label: `d=${depth}`,
    geometryPattern: "sierpinski",
    geometryOptions: { sierpinskiDepth: depth }
  })),
  zodiac: ZODIAC_CONSTELLATIONS.map(
    (constellation, index) => ({
      id: `${index + 1}`,
      label: `${index + 1} ${constellation.name}`,
      geometryPattern: "zodiac",
      geometryOptions: { zodiacIndex: index }
    })
  )
};
const isMagicDrawShape = (value) => MAGIC_DRAW_SHAPE_OPTIONS.some((option) => option.id === value);
const getMagicDrawShapeForMode = (mode) => mode === 4 ? "cross" : mode === 8 ? "bagua" : "star";
const getMagicDrawVariantOption = (shape, value) => {
  const options = MAGIC_DRAW_VARIANT_OPTIONS[shape];
  return options.find((option) => option.id === value) ?? options[0];
};
const makeInitialMagicDrawVariants = (mode) => {
  const shape = getMagicDrawShapeForMode(mode);
  return {
    ...DEFAULT_MAGIC_DRAW_VARIANTS,
    [shape]: String(mode)
  };
};
export {
  DEFAULT_MAGIC_DRAW_VARIANTS,
  MAGIC_DRAW_SHAPE_OPTIONS,
  MAGIC_DRAW_VARIANT_OPTIONS,
  MAGIC_PLAYBACK_MODES,
  getMagicDrawShapeForMode,
  getMagicDrawVariantOption,
  isMagicDrawShape,
  makeInitialMagicDrawVariants
};
