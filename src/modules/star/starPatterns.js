const STAR_PATTERN_OPTIONS = [
  { mode: 5, label: "五芒星" },
  { mode: 6, label: "六芒星" },
  { mode: 7, label: "七芒星" },
  { mode: 4, label: "十字星" },
  { mode: 8, label: "八卦圖" }
];
const STAR_PATTERN_LABELS = new Map(
  STAR_PATTERN_OPTIONS.map(({ mode, label }) => [mode, label])
);
const isStarMode = (value) => typeof value === "number" && STAR_PATTERN_OPTIONS.some((option) => option.mode === value);
const starModeLabel = (mode) => STAR_PATTERN_LABELS.get(mode) ?? "五芒星";
const maxAngleToleranceForMode = (mode) => Math.floor(180 / mode);
const defaultRotationStepForMode = (mode) => mode === 5 ? 6 : mode === 8 ? 4 : 5;
const defaultCandidatesPerSlotForMode = (mode) => mode === 5 ? 5 : 4;
const starLineSequencesForMode = (mode) => {
  switch (mode) {
    case 4:
      return [
        [0, 2],
        [1, 3]
      ];
    case 6:
      return [
        [0, 2, 4, 0],
        [1, 3, 5, 1]
      ];
    case 7:
      return [[0, 2, 4, 6, 1, 3, 5, 0]];
    case 8:
      return [
        [0, 1, 2, 3, 4, 5, 6, 7, 0],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7]
      ];
    case 5:
    default:
      return [[0, 2, 4, 1, 3, 0]];
  }
};
export {
  STAR_PATTERN_OPTIONS,
  defaultCandidatesPerSlotForMode,
  defaultRotationStepForMode,
  isStarMode,
  maxAngleToleranceForMode,
  starLineSequencesForMode,
  starModeLabel
};
