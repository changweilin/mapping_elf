import { normalizeDegrees } from "./geo.js";
const getStarCenterErrorMeters = (result) => typeof result.centerErrorMeters === "number" && Number.isFinite(result.centerErrorMeters) ? result.centerErrorMeters : 0;
const compareNumber = (left, right) => {
  const delta = left - right;
  return Math.abs(delta) > 1e-6 ? delta : 0;
};
const compareStarResultsByScore = (left, right) => compareNumber(left.score, right.score) || compareNumber(left.radiusStdMeters, right.radiusStdMeters) || compareNumber(getStarCenterErrorMeters(left), getStarCenterErrorMeters(right)) || left.id.localeCompare(right.id);
const sortStarResults = (results, sortKey, direction) => {
  const sorted = [...results].sort((left, right) => {
    switch (sortKey) {
      case "radius":
        return compareNumber(left.radiusMeanMeters, right.radiusMeanMeters) || compareStarResultsByScore(left, right);
      case "angle":
        return compareNumber(
          normalizeDegrees(left.rotationDeg),
          normalizeDegrees(right.rotationDeg)
        ) || compareStarResultsByScore(left, right);
      case "circumference-error":
        return compareNumber(left.radiusStdMeters, right.radiusStdMeters) || compareStarResultsByScore(left, right);
      case "center-error":
        return compareNumber(
          getStarCenterErrorMeters(left),
          getStarCenterErrorMeters(right)
        ) || compareStarResultsByScore(left, right);
      case "score":
      default:
        return compareStarResultsByScore(left, right);
    }
  });
  return direction === "asc" ? sorted : sorted.reverse();
};
const averageStarResultValue = (results, getValue) => results.length === 0 ? 0 : results.reduce((total, result) => total + getValue(result), 0) / results.length;
const getStarResultAggregateStats = (results) => {
  if (results.length === 0) return null;
  return {
    count: results.length,
    averageRadiusMeters: averageStarResultValue(
      results,
      (result) => result.radiusMeanMeters
    ),
    averageCircumferenceErrorMeters: averageStarResultValue(
      results,
      (result) => result.radiusStdMeters
    ),
    averageAngleErrorDeg: averageStarResultValue(
      results,
      (result) => result.angleErrorDeg
    ),
    averageCenterErrorMeters: averageStarResultValue(
      results,
      getStarCenterErrorMeters
    ),
    averageScore: averageStarResultValue(results, (result) => result.score)
  };
};
export {
  getStarCenterErrorMeters,
  getStarResultAggregateStats,
  sortStarResults
};
