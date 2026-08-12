import {
  MAGIC_SPEED_OPTIONS
} from "./magicCircle.js";
const MAGIC_POINT_DELAY_MS = 1880;
const MAGIC_POINT_STEP_MS = 90;
const MAGIC_POINT_DURATION_MS = 520;
const MAGIC_TIMELINE_END_PADDING_MS = 140;
const formatMagicSpeed = (speed) => `${speed}x`;
const parseMagicSpeed = (value) => {
  const numericValue = Number(value);
  return MAGIC_SPEED_OPTIONS.find((option) => option === numericValue) ?? MAGIC_SPEED_OPTIONS[0];
};
const getMagicTimelineDurationMs = (result, strokes) => {
  const strokeEndMs = strokes.reduce(
    (latestEndMs, stroke) => Math.max(latestEndMs, stroke.delayMs + stroke.durationMs),
    0
  );
  const pointEndMs = result.points.length > 0 ? MAGIC_POINT_DELAY_MS + (result.points.length - 1) * MAGIC_POINT_STEP_MS + MAGIC_POINT_DURATION_MS : 0;
  return Math.max(strokeEndMs, pointEndMs);
};
const getMagicDelayMs = (delayMs, durationMs, direction, timelineDurationMs, timelinePositionMs) => {
  const directedDelayMs = direction === "reverse" ? Math.max(0, timelineDurationMs - delayMs - durationMs) : delayMs;
  const directedPositionMs = direction === "reverse" ? Math.max(0, timelineDurationMs - timelinePositionMs) : timelinePositionMs;
  return directedDelayMs - directedPositionMs;
};
const clampMagicTimelinePosition = (positionMs, durationMs) => Math.max(0, Math.min(durationMs, positionMs));
const getMagicBoundaryPosition = (direction, durationMs) => direction === "reverse" ? durationMs : 0;
const getLayerElement = (layer) => {
  const pathLayer = layer;
  return typeof pathLayer.getElement === "function" ? pathLayer.getElement() : null;
};
const setElementAnimationPlayback = (element, playback, direction) => {
  const animationPlayState = playback === "playing" ? "running" : "paused";
  const animationDirection = direction === "reverse" ? "reverse" : "normal";
  const applyAnimationState = (target) => {
    target.style.animationPlayState = animationPlayState;
    target.style.animationDirection = animationDirection;
    if (direction === "reverse") {
      target.style.animationFillMode = "both";
    } else {
      target.style.removeProperty("animation-fill-mode");
    }
  };
  applyAnimationState(element);
  element.querySelectorAll("*").forEach(applyAnimationState);
};
const applyMagicStrokeTiming = (layer, stroke, speed, playback, direction, timelineDurationMs, timelinePositionMs) => {
  const element = getLayerElement(layer);
  if (!element) return;
  element.classList.add("magic-drawable");
  if (stroke.kind !== "symbol" && element instanceof SVGElement) {
    element.setAttribute("pathLength", "1");
  }
  element.style.setProperty(
    "--magic-delay",
    `${getMagicDelayMs(
      stroke.delayMs,
      stroke.durationMs,
      direction,
      timelineDurationMs,
      timelinePositionMs
    ) / speed}ms`
  );
  element.style.setProperty("--magic-duration", `${stroke.durationMs / speed}ms`);
  if (stroke.kind === "symbol") {
    element.style.setProperty("--magic-symbol-size", `${stroke.sizePx}px`);
    element.style.setProperty("--magic-symbol-rotate", `${stroke.bearingDeg}deg`);
    element.style.setProperty("--magic-symbol-color", stroke.color);
    element.style.setProperty("--magic-symbol-accent", stroke.accent);
    element.style.setProperty("--magic-symbol-pale", stroke.pale);
    element.style.setProperty("--magic-symbol-opacity", `${stroke.opacity}`);
    element.style.setProperty("--magic-symbol-phase", `${stroke.phase}deg`);
  }
  setElementAnimationPlayback(element, playback, direction);
};
const applyMagicMarkerTiming = (element, delayMs, durationMs, speed, playback, direction, timelineDurationMs, timelinePositionMs) => {
  element.style.setProperty(
    "--magic-delay",
    `${getMagicDelayMs(
      delayMs,
      durationMs,
      direction,
      timelineDurationMs,
      timelinePositionMs
    ) / speed}ms`
  );
  element.style.setProperty("--magic-duration", `${durationMs / speed}ms`);
  setElementAnimationPlayback(element, playback, direction);
};
const setMagicLayerPlayback = (group, playback, direction) => {
  group?.eachLayer((layer) => {
    const element = getLayerElement(layer);
    if (!element?.classList.contains("magic-drawable")) return;
    setElementAnimationPlayback(element, playback, direction);
  });
};
export {
  MAGIC_POINT_DELAY_MS,
  MAGIC_POINT_DURATION_MS,
  MAGIC_POINT_STEP_MS,
  MAGIC_TIMELINE_END_PADDING_MS,
  applyMagicMarkerTiming,
  applyMagicStrokeTiming,
  clampMagicTimelinePosition,
  formatMagicSpeed,
  getMagicBoundaryPosition,
  getMagicDelayMs,
  getMagicTimelineDurationMs,
  parseMagicSpeed,
  setMagicLayerPlayback
};
