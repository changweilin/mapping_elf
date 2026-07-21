# CLAUDE.md — Mapping Elf 操作守則（權威版）

## 1. 專案定位與架構
- 純前端 Vanilla JS (ESM) + Vite (rolldown)。無框架、無 TypeScript、無後端。函式庫：Leaflet（2D 地圖）、Three.js（3D 地形）、Chart.js（高度剖面）、JSZip（.melmap / 圖資包）、Capacitor 8（Android/iOS 外殼）。
- 資料流心智模型：`src/main.js`（12k 行 orchestrator，持有全域 UI 狀態）→ 呼叫 `src/modules/*`（純邏輯，各自負責 route/pace/weather/offline/terrain）→ 持久化一律走 `localStorage`（key 由 `stateKeys.js` 統一列管）。模組之間**不得**互相 import UI 狀態；只有 main.js 有權接線。
- 外部 API：BRouter (brouter.de, hiking) / OSRM demo（路線）、Open-Meteo（天氣＋高程）。全部是免費公開端點，**必定會偶發失敗**，每個呼叫點都已有 fallback 路徑。
- 平台抽象：`src/platform/`（webPlatform / capacitorPlatform）。**MUST NOT** 在模組內直接呼叫 Capacitor plugin；一律經由 `src/platform/index.js`。
- 離線：PWA via `public/sw.js` + `offlineManager.js`（圖磚快取）。部署目標 GitHub Pages（`.github/workflows/deploy.yml`）。

## 2. 通用開發規範 (RFC-2119)

### 程式碼品質與型別安全
- 本專案無 TS。所有跨模組資料形狀（waypoint、route、weather point）**MUST** 沿用既有物件欄位，新增欄位 **MUST** 允許 undefined（舊 localStorage/.melmap 資料不含新欄位）。
- 外部 API 回應 **MUST** 先驗證再使用（`if (!resp.ok) throw`、欄位存在性檢查），並保留 console.warn + fallback，**MUST NOT** 讓單一 API 失敗炸掉整個 UI。
- **SHOULD** 用 early return 與循序程式碼；**MUST NOT** 為了「乾淨」引入新抽象層或 class 階層。

### 狀態管理與資料流
- 新增任何 localStorage key：**MUST** 加上 `mappingElf_` 前綴並登錄進 `src/modules/stateKeys.js` 的正確分類陣列。`MELMAP_STATE_KEYS` 決定 .melmap 匯出/匯入內容 — 漏登錄 = 使用者存檔靜默遺失該設定。
- `DEFAULT_PACE_PARAMS`（paceEngine.js）是資料契約：新參數 **MUST** 給預設值，讀取端一律 `{ ...DEFAULT_PACE_PARAMS, ...params }` merge，**MUST NOT** 假設參數齊全。
- i18n：所有使用者可見字串 **MUST** 進 `src/modules/i18n.js` 的 STRINGS，並補齊全部 8 個語系（zh-TW/en/ja/ko/fr/de/es/it）。**MUST NOT** 在 main.js 硬編中文字串。
- 天氣資料有多層快取（記憶體＋`mappingElf_weatherCache`，含距離/高度/時效門檻）。修改天氣流程前 **MUST** 先讀 `weatherService.js` 的快取判斷，**MUST NOT** 假設「沒看到 fetch = 有 bug」— 先開 dev server 實測再下結論。

### 效能與安全邊界
- 路線可達數千點。對 track 座標的迴圈 **MUST NOT** 在 drag/mousemove 事件內做 O(n) 以上運算；重算一律 debounce（main.js 已有既有模式，先找再寫）。
- 併發 API 請求已有 race-guard（見 `test/request-race.spec.js`）。新增非同步流程 **MUST** 處理「回應到達時使用者已改變路線」的情境（token/generation 比對）。
- **MUST NOT** 引入新的 runtime 依賴或 CDN 資源；bundle 分包規則寫死在 `vite.config.js` codeSplitting groups，新增大型依賴前 **MUST** 停下來詢問。

## 3. 危險模式與歷史地雷（事件標記）

- `[2025-11-04 #INC-101]` **座標順序**：專案內部一律 `[lat, lng]`；BRouter/OSRM GeoJSON 回傳 `[lng, lat, ele?]`。轉換只發生在 `routeEngine.js` 邊界。**MUST NOT** 在其他任何地方 swap 座標；看到「地圖跑到海上」先查這裡。
- `[2025-12-18 #INC-133]` **路線端點錨定**：BRouter/OSRM 會把端點吸附到道路，`routeEngine.js` 刻意把首尾座標覆寫回原始 waypoint。**MUST NOT** 「修正」這段看似多餘的覆寫，否則往返里程與 GPX 匯出端點會漂移。
- `[2026-02-09 #INC-207]` **main.js 重構禁令**：main.js 12k 行是已知技術債，但函式間靠共享閉包狀態耦合。**MUST NOT** 未經指示拆檔或搬移函式；一律最小 diff 手術式修改。
- `[2026-03-22 #INC-251]` **sw.js 快取版本**：改動任何會進 precache 的資產 **MUST** 檢查 `public/sw.js` 的 cache 版本策略（`test/cache-versioning.spec.js` 守門），否則使用者收到舊版白畫面。
- `[2026-04-15 #INC-278]` **Vite base path**：web 模式 base=`/mapping_elf/`、app 模式=`./`。**MUST NOT** 寫死絕對路徑引用資產；GitHub Pages 空白頁 90% 是這個。
- `[2026-05-30 #INC-310]` **3D 地形時序**：3D viewer 的天氣點徽章要等 per-point 天氣載入完成才出現；Playwright 測試 **MUST** 等 loading 指示「先出現、後消失」。另外 `waitForSelector('#el.hidden')` 會永久卡住 — 改 poll classList 或用 `state:'attached'`。既有 mock 在 `test/terrain-3d.spec.js`，**MUST** 先讀再寫新測試。
- `[2026-06-12 #INC-325]` **z-index 疊層**：3D viewer 的 `canvas-wrap` 需要 `z-index:1` 把 loading overlay 壓在 toolbar 下拉選單之下。動 overlay/dropdown 樣式 **MUST** 同時驗證兩者疊層。

## 4. 核心指令與工作流

```bash
npm run dev              # Vite dev server (--host)
npm run build:web        # Web 版建置 (base=/mapping_elf/)
npm run build:app        # Capacitor 版建置 (base=./)
npm run test:smoke       # Playwright GUI 冒煙測試（自動起 preview server）
npm run test:numeric     # 數值回歸（距離/爬升/配速，純 node，最快）
npm run test:weather-points
node test/run-playwright-with-preview.mjs test/<file>.spec.js   # 跑單一 spec
npm run cap:sync:android # 建置並同步到 Android 專案
```

- 測試策略：改數值邏輯 → `test:numeric` 必跑；改 UI/流程 → 對應 Playwright spec；改匯入匯出 → `test:import-export`。無 linter 設定 — 風格以周邊程式碼為準。
- 環境：Windows + PowerShell 5.1（無 `&&`，用 `;`）。本機無 chromium-cli；驗證一律用專案自帶 Playwright 驅動 dev/preview server。
- 專屬 sub-agent/skill 已就位：改核心邏輯先掛 `mapping-elf-core-modules`，改樣式掛 `mapping-elf-frontend-design`，動 localStorage/資料契約掛 `mapping-elf-parameter-data-steward`，review 用 `mapping-elf-review`，部署用 `mapping-elf-deploy`。
