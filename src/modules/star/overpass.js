import { POI_CATEGORIES } from "./categories.js";
import { bearingDegrees, haversineDistanceMeters } from "./geo.js";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];
const MAX_OVERPASS_RESULTS = 1400;
const MAX_OVERPASS_BBOX_RESULTS = 900;
const OVERPASS_REQUEST_TIMEOUT_MS = 45e3;
const CATEGORY_QUERY_PAUSE_MS = 150;
const TRANSIENT_OVERPASS_STATUS = /* @__PURE__ */ new Set([408, 429, 500, 502, 503, 504]);
const OVERPASS_ELEMENT_TYPES = ["node", "way", "relation"];
class OverpassHttpError extends Error {
  constructor(endpoint, status) {
    super(`HTTP ${status}`);
    this.endpoint = endpoint;
    this.status = status;
  }
}
class OverpassQueryError extends Error {
  constructor(failures) {
    super(
      `Overpass 查詢暫時失敗（${failures.join(
        "；"
      )}）。請稍後重試，或縮小半徑、減少類別。`
    );
    this.failures = failures;
  }
}
const getName = (tags, fallback) => tags["name:zh"] || tags["name:zh-Hant"] || tags.name || tags["name:en"] || tags.brand || fallback;
const categoryForTags = (tags, categories = POI_CATEGORIES) => categories.find((category) => category.matches(tags));
const buildAroundStatements = (radius, lat, lng, filters) => filters.flatMap(
  (filter) => OVERPASS_ELEMENT_TYPES.map(
    (type) => `${type}(around:${radius},${lat},${lng})${filter};`
  )
);
const formatCoordinate = (value) => value.toFixed(6);
const formatQueryStatements = (statements, indent = "  ") => statements.map((statement) => `${indent}${statement}`).join("\n");
const buildOverpassQueryForFilters = (center, radiusMeters, filters, innerRadiusMeters = 0) => {
  const radius = Math.round(radiusMeters);
  const innerRadius = Math.max(
    0,
    Math.min(Math.round(innerRadiusMeters), radius - 1)
  );
  const lat = center.lat.toFixed(6);
  const lng = center.lng.toFixed(6);
  const outerStatements = buildAroundStatements(radius, lat, lng, filters);
  if (innerRadius === 0) {
    return `[out:json][timeout:35];
(
${formatQueryStatements(outerStatements)}
);
out center ${MAX_OVERPASS_RESULTS};`;
  }
  const innerStatements = buildAroundStatements(innerRadius, lat, lng, filters);
  return `[out:json][timeout:35];
(
  (
${formatQueryStatements(outerStatements, "    ")}
  );
  -
  (
${formatQueryStatements(innerStatements, "    ")}
  );
);
out center ${MAX_OVERPASS_RESULTS};`;
};
const buildOverpassQuery = (center, radiusMeters, categories, innerRadiusMeters = 0) => buildOverpassQueryForFilters(
  center,
  radiusMeters,
  categories.flatMap((category) => category.overpassFilters),
  innerRadiusMeters
);
const normalizeBounds = (bounds) => ({
  south: Math.max(-90, Math.min(90, Math.min(bounds.south, bounds.north))),
  north: Math.max(-90, Math.min(90, Math.max(bounds.south, bounds.north))),
  west: Math.max(-180, Math.min(180, Math.min(bounds.west, bounds.east))),
  east: Math.max(-180, Math.min(180, Math.max(bounds.west, bounds.east)))
});
const formatBbox = (bounds) => {
  const normalized = normalizeBounds(bounds);
  return [
    normalized.south,
    normalized.west,
    normalized.north,
    normalized.east
  ].map(formatCoordinate).join(",");
};
const buildBboxStatements = (boundsList, filters) => boundsList.flatMap((bounds) => {
  const bbox = formatBbox(bounds);
  return filters.map((filter) => `nwr${filter}(${bbox});`);
});
const buildOverpassBboxQuery = (boundsList, categories, resultLimit = MAX_OVERPASS_BBOX_RESULTS) => {
  const filters = categories.flatMap((category) => category.overpassFilters);
  const safeLimit = Math.max(
    1,
    Math.min(MAX_OVERPASS_RESULTS, Math.round(resultLimit))
  );
  const statements = buildBboxStatements(boundsList, filters);
  return `[out:json][timeout:20];
(
${formatQueryStatements(statements)}
);
out center qt ${safeLimit};`;
};
const parseOverpassElements = (elements, center, categories) => {
  const seen = /* @__PURE__ */ new Set();
  const pois = [];
  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    const tags = element.tags ?? {};
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const category = categoryForTags(tags, categories);
    if (!category) continue;
    const id = `${element.type}/${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const position = { lat, lng };
    pois.push({
      id,
      osmType: element.type,
      osmId: element.id,
      name: getName(tags, `${category.label} ${element.id}`),
      lat,
      lng,
      categoryId: category.id,
      categoryLabel: category.label,
      categoryColor: category.color,
      tags,
      distanceMeters: haversineDistanceMeters(center, position),
      bearingDeg: bearingDegrees(center, position)
    });
  }
  return pois.sort((a, b) => a.distanceMeters - b.distanceMeters);
};
const makeAbortError = () => {
  const error = new Error("搜尋已取消");
  error.name = "AbortError";
  return error;
};
const throwIfAborted = (signal) => {
  if (signal?.aborted) throw makeAbortError();
};
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  throwIfAborted(signal);
  const timeoutId = setTimeout(() => {
    signal?.removeEventListener("abort", abort);
    resolve();
  }, ms);
  const abort = () => {
    clearTimeout(timeoutId);
    reject(makeAbortError());
  };
  signal?.addEventListener("abort", abort, { once: true });
});
const fetchOverpassFromEndpoint = async (endpoint, query, signal) => {
  throwIfAborted(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeoutId = setTimeout(
    () => controller.abort(),
    OVERPASS_REQUEST_TIMEOUT_MS
  );
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new OverpassHttpError(endpoint, response.status);
    }
    return await response.json();
  } finally {
    signal?.removeEventListener("abort", abort);
    clearTimeout(timeoutId);
  }
};
const isRetryableOverpassError = (error) => {
  if (error instanceof OverpassHttpError) {
    return TRANSIENT_OVERPASS_STATUS.has(error.status);
  }
  return error instanceof Error ? error.name === "AbortError" || error instanceof TypeError : false;
};
const formatEndpoint = (endpoint) => {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint;
  }
};
const formatOverpassError = (error) => {
  if (error instanceof OverpassHttpError) {
    return `${formatEndpoint(error.endpoint)} HTTP ${error.status}`;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "請求逾時";
  }
  return error instanceof Error ? error.message : "未知錯誤";
};
const overpassFailureMessages = (error) => error instanceof OverpassQueryError ? error.failures : [error instanceof Error ? error.message : "未知錯誤"];
const uniqueMessages = (messages) => [...new Set(messages)];
const fetchOverpassElements = async (query, signal) => {
  const failures = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    throwIfAborted(signal);
    try {
      const data = await fetchOverpassFromEndpoint(endpoint, query, signal);
      return data.elements ?? [];
    } catch (error) {
      throwIfAborted(signal);
      failures.push(formatOverpassError(error));
      if (!isRetryableOverpassError(error)) {
        break;
      }
    }
  }
  throw new OverpassQueryError(failures);
};
const fetchOverpassElementsForFilters = (center, radiusMeters, filters, innerRadiusMeters = 0, signal) => fetchOverpassElements(
  buildOverpassQueryForFilters(
    center,
    radiusMeters,
    filters,
    innerRadiusMeters
  ),
  signal
);
const fetchOverpassElementsForBounds = (boundsList, categories, signal, resultLimit = MAX_OVERPASS_BBOX_RESULTS) => fetchOverpassElements(
  buildOverpassBboxQuery(boundsList, categories, resultLimit),
  signal
);
const fetchOverpassElementsForBoundsFilters = (boundsList, filters, signal, resultLimit = MAX_OVERPASS_BBOX_RESULTS) => fetchOverpassElements(
  buildOverpassBboxQuery(
    boundsList,
    [
      {
        id: "bbox-filter",
        group: "暫用",
        label: "範圍條件",
        description: "",
        color: "#000000",
        overpassFilters: filters,
        matches: () => false
      }
    ],
    resultLimit
  ),
  signal
);
const fetchCategoryElements = async (center, radiusMeters, innerRadiusMeters, category, signal) => {
  try {
    return {
      elements: await fetchOverpassElementsForFilters(
        center,
        radiusMeters,
        category.overpassFilters,
        innerRadiusMeters,
        signal
      ),
      warnings: []
    };
  } catch (primaryError) {
    if (category.overpassFilters.length <= 1) {
      throw primaryError;
    }
    const elements = [];
    const failures = [];
    let failedFilters = 0;
    for (const filter of category.overpassFilters) {
      try {
        elements.push(
          ...await fetchOverpassElementsForFilters(
            center,
            radiusMeters,
            [filter],
            innerRadiusMeters,
            signal
          )
        );
      } catch (filterError) {
        failedFilters += 1;
        failures.push(...overpassFailureMessages(filterError));
      }
      await sleep(CATEGORY_QUERY_PAUSE_MS, signal);
    }
    if (failedFilters === category.overpassFilters.length) {
      throw primaryError;
    }
    return {
      elements,
      warnings: failedFilters > 0 ? [
        `${category.label} 的部分條件查詢失敗（${uniqueMessages(
          failures
        ).join("、")}），已使用成功取得的資料繼續。`
      ] : []
    };
  }
};
const fetchCategoryBoundsElements = async (boundsList, category, signal, resultLimit = MAX_OVERPASS_BBOX_RESULTS, failOnPartialError = false) => {
  try {
    return {
      elements: await fetchOverpassElementsForBounds(
        boundsList,
        [category],
        signal,
        resultLimit
      ),
      warnings: []
    };
  } catch (primaryError) {
    if (category.overpassFilters.length <= 1) {
      throw primaryError;
    }
    const elements = [];
    const failures = [];
    let failedFilters = 0;
    for (const filter of category.overpassFilters) {
      try {
        elements.push(
          ...await fetchOverpassElementsForBoundsFilters(
            boundsList,
            [filter],
            signal,
            resultLimit
          )
        );
      } catch (filterError) {
        failedFilters += 1;
        failures.push(...overpassFailureMessages(filterError));
      }
      await sleep(CATEGORY_QUERY_PAUSE_MS, signal);
    }
    if (failedFilters === category.overpassFilters.length) {
      throw primaryError;
    }
    const warning = `${category.label} 的部分蜂巢條件查詢失敗（${uniqueMessages(
      failures
    ).join("、")}）`;
    if (failedFilters > 0 && failOnPartialError) {
      throw new Error(warning);
    }
    return {
      elements,
      warnings: failedFilters > 0 ? [`${warning}，已使用成功取得的資料繼續。`] : []
    };
  }
};
const formatCategoryFailure = (category, error) => {
  const details = error instanceof OverpassQueryError ? error.failures.join("、") : error instanceof Error ? error.message : "未知錯誤";
  return `${category.label}：${details}`;
};
const filterPoisByRadiusRange = (pois, innerRadiusMeters, outerRadiusMeters) => {
  const innerRadius = Math.max(0, innerRadiusMeters);
  return pois.filter(
    (poi) => poi.distanceMeters >= innerRadius && poi.distanceMeters <= outerRadiusMeters
  );
};
const fetchPoisDetailed = async (center, radiusMeters, categories, innerRadiusMeters = 0, options = {}) => {
  if (categories.length === 0) {
    throw new Error("請至少選擇一種目標類別。");
  }
  const { onCategoryResult, signal } = options;
  const elements = [];
  const failures = [];
  const partialWarnings = [];
  for (const [index, category] of categories.entries()) {
    throwIfAborted(signal);
    try {
      const result = await fetchCategoryElements(
        center,
        radiusMeters,
        innerRadiusMeters,
        category,
        signal
      );
      elements.push(...result.elements);
      partialWarnings.push(...result.warnings);
      onCategoryResult?.({
        category,
        completedCategories: index + 1,
        pois: filterPoisByRadiusRange(
          parseOverpassElements(result.elements, center, [category]),
          innerRadiusMeters,
          radiusMeters
        ),
        totalCategories: categories.length,
        warnings: result.warnings
      });
    } catch (error) {
      throwIfAborted(signal);
      failures.push(formatCategoryFailure(category, error));
    }
    if (categories.length > 1) {
      await sleep(CATEGORY_QUERY_PAUSE_MS, signal);
    }
  }
  if (failures.length === categories.length) {
    throw new Error(
      `Overpass 查詢暫時失敗（${failures.join(
        "；"
      )}）。請稍後重試，或縮小半徑、減少類別。`
    );
  }
  const warnings = [...partialWarnings];
  if (failures.length > 0) {
    warnings.push(
      `部分類別查詢失敗，已使用成功取得的資料繼續：${failures.join(
        "；"
      )}。`
    );
  }
  return {
    pois: filterPoisByRadiusRange(
      parseOverpassElements(elements, center, categories),
      innerRadiusMeters,
      radiusMeters
    ),
    warnings
  };
};
const fetchPoisForBoundsDetailed = async (center, boundsList, categories, innerRadiusMeters = 0, outerRadiusMeters = Number.POSITIVE_INFINITY, options = {}) => {
  if (categories.length === 0) {
    throw new Error("請至少選擇一種目標類別。");
  }
  const normalizedBounds = boundsList.map(normalizeBounds).filter(
    (bounds) => bounds.north > bounds.south && bounds.east > bounds.west
  );
  if (normalizedBounds.length === 0) {
    return { pois: [], warnings: [], hitLimit: false };
  }
  const {
    failOnPartialError = false,
    resultLimit = MAX_OVERPASS_BBOX_RESULTS,
    signal
  } = options;
  const safeLimit = Math.max(
    1,
    Math.min(MAX_OVERPASS_RESULTS, Math.round(resultLimit))
  );
  let elements = [];
  const warnings = [];
  try {
    elements = await fetchOverpassElementsForBounds(
      normalizedBounds,
      categories,
      signal,
      safeLimit
    );
  } catch (primaryError) {
    if (categories.length <= 1) {
      throw primaryError;
    }
    const failures = [];
    for (const category of categories) {
      try {
        const result = await fetchCategoryBoundsElements(
          normalizedBounds,
          category,
          signal,
          safeLimit,
          failOnPartialError
        );
        elements.push(...result.elements);
        warnings.push(...result.warnings);
      } catch (categoryError) {
        const failure = formatCategoryFailure(category, categoryError);
        if (failOnPartialError) {
          throw new Error(`蜂巢搜索查詢失敗：${failure}。`);
        }
        failures.push(failure);
      }
      await sleep(CATEGORY_QUERY_PAUSE_MS, signal);
    }
    if (failures.length === categories.length) {
      throw primaryError;
    }
    if (failures.length > 0) {
      warnings.push(
        `部分蜂巢類別查詢失敗，已使用成功取得的資料繼續：${failures.join(
          "；"
        )}。`
      );
    }
  }
  const hitLimit = elements.length >= safeLimit;
  if (hitLimit) {
    warnings.push(
      `單批蜂巢已讀取前 ${safeLimit} 筆資料；背景精修會繼續搜索其他蜂巢。`
    );
  }
  return {
    pois: filterPoisByRadiusRange(
      parseOverpassElements(elements, center, categories),
      innerRadiusMeters,
      outerRadiusMeters
    ),
    warnings,
    hitLimit
  };
};
const fetchPois = async (center, radiusMeters, categories, innerRadiusMeters = 0) => (await fetchPoisDetailed(center, radiusMeters, categories, innerRadiusMeters)).pois;
const overpassResultLimit = MAX_OVERPASS_RESULTS;
export {
  buildOverpassBboxQuery,
  buildOverpassQuery,
  categoryForTags,
  fetchPois,
  fetchPoisDetailed,
  fetchPoisForBoundsDetailed,
  overpassResultLimit,
  parseOverpassElements
};
