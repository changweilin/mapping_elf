# CLAUDE.md — Mapping Elf 記憶主檔（權威版）

本檔只放三種東西：**宏觀原則、歷史地雷、核心工作流**。領域細節一律放在 `.claude/skills/*`（見 §5），不在此重複。文件敘述與程式碼衝突時，以程式碼為準，並回頭修正文件。

## 1. 專案快照

- 純前端 Vanilla JS (ESM) + Vite (rolldown)。無框架、無 TS、無後端。函式庫：Leaflet（2D）、Three.js（3D 地形）、Chart.js（剖面）、JSZip（.melmap）、Capacitor 8（App 外殼）。
- 資料流：`src/main.js`（12k 行 orchestrator，持有全域 UI 狀態）→ `src/modules/*`（純邏輯）→ 持久化走 `localStorage`。**只有 main.js 有權接線**；模組之間不得互相 import UI 狀態。
- 外部 API：BRouter / OSRM demo（路線）、Open-Meteo（天氣＋高程）、Nominatim（地名）。全是免費公開端點，**必定偶發失敗**。
- 部署：GitHub Pages（web, base=`/mapping_elf/`）＋ Capacitor（app, base=`./`）。離線：PWA (`public/sw.js`) + `offlineManager.js`（Cache API 圖磚快取）。

## 2. 五大原則（所有細則的源頭）

1. **邊界原則** — 轉換與副作用只發生在指定邊界，其他地方一律視為唯讀：
   座標順序（`[lat,lng]` ↔ `[lng,lat]`）只在 `routeEngine.js` 轉換；Capacitor plugin 只經 `src/platform/index.js`；UI 狀態接線只在 main.js；資產路徑只透過 Vite base，不寫死絕對路徑。
2. **資料契約原則** — 分清「使用者輸入」與「程式產生」的資料，只持久化前者。
   所有 localStorage key 加 `mappingElf_` 前綴並登錄 `src/modules/stateKeys.js` 的正確分類陣列（漏登錄 = .melmap 存檔靜默遺失該設定）；讀取一律 default-merge（`{ ...DEFAULT_PACE_PARAMS, ...params }`），不假設參數齊全；新欄位必須容忍 undefined（舊存檔無此欄位）；程式產生的資料（interval 時間、cumTimes）永不當作使用者輸入存檔。
3. **防禦原則** — 外部世界一定會壞，UI 不准跟著壞。
   API 回應先驗證再用（`!resp.ok` throw、欄位檢查），失敗走 console.warn + fallback，單一 API 失敗不得炸掉 UI；非同步流程必做 race-guard（token/generation 比對，見 `test/request-race.spec.js`）；使用者可見字串全數進 `i18n.js` 並補齊 8 語系（zh-TW/en/ja/ko/fr/de/es/it），不硬編中文。
4. **最小手術原則** — 修改以最小 diff 為準。
   不為「乾淨」引入抽象層、class 階層、新 runtime 依賴或 CDN 資源（bundle 分包寫死在 `vite.config.js`，加大型依賴前先詢問）；main.js 不拆檔不搬函式（INC-207）；路線可達數千點，drag/mousemove 內不做 O(n) 以上運算，重算一律 debounce（先找 main.js 既有模式再寫）。
5. **實證原則** — 先實測再下結論，改完必跑對應測試。
   天氣有多層快取（記憶體＋`mappingElf_weatherCache`，含距離/高度/時效門檻），「沒看到 fetch」多半是快取命中而非 bug — 先讀 `weatherService.js` 再開 dev server 實測；關鍵事實以程式碼為準，不信過時記憶。

## 3. 歷史地雷（事故標記，勿刪）

- `[2025-11-04 #INC-101]` **座標順序**：只在 `routeEngine.js` 邊界轉換 `[lng,lat]`→`[lat,lng]`。「地圖跑到海上」先查這裡。
- `[2025-12-18 #INC-133]` **端點錨定**：`routeEngine.js` 刻意把路線首尾覆寫回原始 waypoint（抵銷 BRouter/OSRM 道路吸附）。勿「修正」這段看似多餘的覆寫，否則往返里程與 GPX 端點漂移。
- `[2026-02-09 #INC-207]` **main.js 重構禁令**：函式間靠共享閉包耦合，未經指示不得拆檔或搬移函式。
- `[2026-03-22 #INC-251]` **sw.js 快取版本**：改動 precache 資產必查 `public/sw.js` cache 版本策略（`test/cache-versioning.spec.js` 守門），否則使用者收到舊版白畫面。
- `[2026-04-15 #INC-278]` **Vite base 雙模式**：web=`/mapping_elf/`、app=`./`。GitHub Pages 空白頁 90% 是寫死絕對路徑。
- `[2026-05-30 #INC-310]` **3D 地形時序**：天氣點徽章等 per-point 載入完成才出現；Playwright 要等 loading「先出現、後消失」；`waitForSelector('#el.hidden')` 會永久卡住 — 改 poll classList 或 `state:'attached'`。寫新測試前先讀 `test/terrain-3d.spec.js` 既有 mock。
- `[2026-06-12 #INC-325]` **z-index 疊層**：3D viewer `canvas-wrap` 需 `z-index:1` 把 loading overlay 壓在 toolbar 下拉之下。動 overlay/dropdown 樣式必同時驗證兩者疊層。
- `[2026-08-10 #INC-338]` **可暫停載入的註冊與取消**：新增可暫停載入一律走 `registerPausableLoad(run)`（`beginRouteWeatherBusyTask` 會在 run 存在前就重繪 overlay，直接 `pausableLoadRuns.add` 會讓停止/取消鈕整段藏著）；同時要有取消掛勾並在 `cancelActivePausableLoads()` 涵蓋，否則 busy task 永遠留在 `routeWeatherBusyTasks`，進度條關不掉。

## 4. 核心指令與工作流

```bash
npm run dev              # dev server (--host)
npm run build:web        # base=/mapping_elf/
npm run build:app        # base=./（Capacitor）
npm run test:unit        # 純 node 閘門（numeric＋weather-points＋native-config，秒級）
npm run test:smoke       # Playwright 全套，不含 @perf（自動起 preview server）
npm run test:perf        # 只跑 @perf 效能預算（PERF_BUDGET_SCALE 可放寬）
npm run test:ci          # test:unit ＋ build:web ＋ 全套 e2e（CI 跑的同一組）
node test/run-playwright-with-preview.mjs test/<file>.spec.js   # 單一 spec
npm run cap:sync:android # 建置並同步 Android 專案
```

- 測試對應：改數值邏輯 → `test:numeric` 必跑；改 UI/流程 → 對應 Playwright spec；改匯入匯出 → `test:import-export`。無 linter — 風格以周邊程式碼為準。
- 外部 API stub（cone/fbm/flat DEM、OSRM、flood）一律用 `test/helpers/apiMocks.mjs`，不要再在 spec 內複製一份；`forecast` 各 spec 差異太大，刻意保留在各自檔案。
- CI：`.github/workflows/ci.yml`（PR＋main）跑 unit → build(web＋app＋chunks) → e2e 四路 sharding → perf；`deploy.yml` 在上 Pages 前跑同一組 node 閘門與雙模式建置。preview 服務的是 **既有 dist**，改 `src/**` 後沒重建就是測舊版（runner 會警告）。
- 本機環境：Windows + PowerShell 5.1（無 `&&`，用 `;`）。驗證一律用專案自帶 Playwright 驅動 dev/preview server。

## 5. 記憶檔案架構與維護規則

- **分層**：CLAUDE.md（宏觀原則）→ `.claude/skills/*/SKILL.md`（領域規則與 gotchas）→ `references/*`（深度細節，如 `pace-engine/formulas.md`）。改核心邏輯掛 `mapping-elf-core-modules`、樣式掛 `mapping-elf-frontend-design`、資料契約掛 `mapping-elf-parameter-data-steward`、review 掛 `mapping-elf-review`、部署掛 `mapping-elf-deploy`；完整路由表見 `mapping-elf-sub-agent-coordinator`。
- **單一真相源**：localStorage key 清單 = `stateKeys.js`；配速公式 = `references/pace-engine/formulas.md`；部署事實 = `.github/workflows/deploy.yml` + `vite.config.js`。文件引用它們，**不複製清單** — 複製品必過時。
- **新教訓歸檔**：領域性教訓 → 寫進所屬 skill 的 Gotchas；跨領域、會再咬人的事故 → 升級為 §3 一行地雷（附日期＋INC 編號）。定期把過細、重複、過時的條目往下層搬或刪除。
