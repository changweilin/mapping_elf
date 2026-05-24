# Mapping Elf 專案控管中心

Last updated: 2026-05-24

本文件是 Mapping Elf 唯一的進度、優先序、阻塞與驗證控管入口。`doc/` 內的 roadmap、部署、QA、隱私與商店文件保留細節與背景，不再各自作為進度來源。

## 管理規則

- 狀態與優先序只更新在本文件；細節文件若有待辦，必須同步收斂到這裡。
- 完成項目不留在執行看板，只保留在「已完成基線」中作為驗證背景。
- 每個完成項目都要留下對應驗證，至少寫清楚跑過哪些命令或還有哪些外部限制。
- 高風險區包含路徑/航點層級切換、天氣時間欄位、`.melmap` 相容性、localStorage key、離線圖磚與 App native bridge。
- 修改資料格式、隱私資料流、外部 API、商店揭露或 durable state 時，必須同步更新來源文件索引中指定的文件。
- 每輪 refactor 先保護既有行為，再談抽象化；不要同時改事件流程、UI 呈現與資料格式。

## 狀態總覽

| 工作流 | 狀態 | 控管決策 | 細節來源 |
| --- | --- | --- | --- |
| 本地整理與 refactor | 可執行 | 先做低風險 UI/測試整理，再進入 cache 與 weather point 拆分。 | 本文件、`doc/refactor-roadmap.md` |
| App/native 發布 | 外部阻塞 | Android 需要真機或修復 emulator；iOS 需要 Mac/Xcode。 | `doc/pre-app-optimization-progress.md`, `doc/native-app-qa.md` |
| 商店、隱私、離線條款 | 發布門檻 | 可先準備，但必須在 native QA 與公開發布前重新核對。 | `doc/offline-tile-strategy.md`, `doc/privacy-data-flow.md`, `doc/app-store-disclosure-draft.md`, `doc/store-listing-draft.md` |
| State/data contract | 持續護欄 | 新增 durable key 時同步更新 state contract、allow-list 與 reset/import 規則。 | `doc/state-contract.md`, `src/modules/stateKeys.js` |

## 執行順序

排序判斷：目前最合理的順序是先清掉小型、可驗證、低風險的整理，再補齊測試護欄與效能基線，最後才做會碰到核心資料流的 cache/weather refactor。App 發布事項另外作為 release gate，不阻塞本地 refactor 主線。

### 本地可執行主線

目前本地可執行項目改以產品體驗整併為主。A1-A6 已清出執行看板，摘要保留在「已完成基線」，詳細驗證保留在「合併紀錄」。

### 產品體驗整併主線

| 序 | 狀態 | 工作包 | 整併目標 | 完成條件 |
| --- | --- | --- | --- | --- |
| P1 | 完成 | 路線模式與配速活動整合 | 路線模式切換時帶出對應配速活動，並讓不適用的配速/熱量欄位在駕車模式下退場。 | 2026-05-24 完成；步行/山徑/自行車/駕車會同步配速活動，手動配速活動覆寫仍可用，完整 GUI suite 維持綠燈。 |
| P2 | 待辦 | 保存與分享整併 | 將 GPX/KML 匯入匯出、`.melmap`、離線圖磚與我的最愛收斂成「路線庫 / 保存與分享」流程。 | 使用者能從單一入口完成保存、匯入、匯出、備份、離線帶走；既有 `.melmap` 與 favorites 相容。 |
| P3 | 待辦 | 天氣中心整併 | 將天氣表、天氣卡、Windy 連結與天氣快取收斂成「取得、調整、查看、比對」的任務流。 | 更新天氣、調整時間、Windy 比對與快取設定入口清楚；不改變 weather column persistence 邊界。 |
| P4 | 待辦 | 航點顯示與批次操作整併 | 將中繼點生成、天氣圖示顯示、天氣卡批次收合與航點置中拆成更清楚的顯示/航點設定。 | 航點/中繼點與地圖顯示設定分組明確；現有集體操作與 weather card 行為維持。 |
| P5 | 待辦 | 搜尋工具輕量化 | 將搜尋從側欄完整面板調整為更靠近地圖操作的工具入口，側欄保留結果與加入航點流程。 | 關鍵字與座標搜尋仍可用；新增航點流程更短；手機與桌面 layout 不遮擋核心控制。 |

### 發布門檻主線

| 序 | 狀態 | 工作包 | 已整合項目 | 完成條件 |
| --- | --- | --- | --- | --- |
| R1 | 阻塞 | Native device validation | Android native bridge QA、iOS simulator/device validation | Android 完成 `doc/native-app-qa.md`；iOS 在 Mac/Xcode 驗證 safe area、檔案匯入匯出、外部連結與 TestFlight readiness。 |
| R2 | 阻塞 | Android signing 與 internal testing artifact | upload keystore、release AAB rebuild、Google Play internal testing upload | 2026-05-20 重建 `android/app/build/outputs/bundle/release/app-release.aab` 成功但未簽章；需提供 ignored `android/keystore.properties` 與 upload key 後重建，才能上傳 internal testing。 |
| R3 | 待辦 | 商店與合規收斂 | privacy URL、native screenshots、Google Play Data safety、Apple App Privacy、provider terms、dev-tool audit | 2026-05-20 已複查 audit 與 provider terms；bundled public raster providers 已禁用 tile export。仍需 live store forms、native screenshots、dev-tool findings 決策。 |

## 已完成基線

以下項目已清出執行看板，只作為後續驗證背景：

- GUI 與 smoke 護欄已建立，包含 4 層重疊路徑長按逐層切換、雙擊、匯入、匯出與地圖圖層基本流程。
- 第一輪低風險精簡已完成，包含配速單位轉換 helper、配速 placeholder 格式化集中化、天氣表 `timeOpts` 去重、天氣表 HTML helper 拆分與 GUI/Playwright 可靠度整理。
- Web/App build split、platform adapter、Capacitor sync helpers、Android APK/AAB build scripts 已建立。
- GPX/KML/`.melmap` round-trip、state contract、reset/import behavior 已有測試與文件基準。
- Privacy inventory、store disclosure draft、store listing draft、Google Play draft images 與 bundled privacy page 已建立。
- Android debug APK、debug AAB、release AAB 曾於 2026-05-19 本機 build 成功；native bridge QA 仍因沒有裝置/emulator 阻塞。

## 合併紀錄

### 2026-05-24 P1 Update

- 狀態變更：`P1 路線模式與配速活動整合` 完成；`P2-P5` 已加入產品體驗整併主線。
- 影響範圍：路線模式現在會同步預設配速活動，包含 walking→walking、hiking→hiking、cycling→cycling、driving→driving；保留配速活動 select 的手動覆寫。駕車活動下隱藏熱量/補給統計與體重、負重、疲勞、休息等不適用配速欄位。舊收藏若沒有 speedActivity，會依 routeMode 補預設活動。
- 驗證：`npm.cmd run test:numeric`、`npm.cmd run build`、`npm.cmd run test:chunks`、`node test/run-playwright-with-preview.mjs test/smoke.spec.js`、`npm.cmd run test:smoke`（63 passed）。
- 仍需追蹤：`P2 保存與分享整併`、`P3 天氣中心整併`、`P4 航點顯示與批次操作整併`、`P5 搜尋工具輕量化`。

### 2026-05-20 R2/R3 Update

- 狀態變更：`R2 Android signing 與 internal testing artifact` 改為阻塞，因為本機沒有 upload keystore；`R3 商店與合規收斂` 保持待辦。
- 影響範圍：確認 `android/keystore.properties` 已被 `.gitignore` 忽略，`android/keystore.properties.example` 已存在；執行 release bundle 重建，產出 `android/app/build/outputs/bundle/release/app-release.aab`，大小約 8.2 MB。複查 CARTO、OpenTopoMap、OSMF、Esri provider terms 後，將 bundled public raster providers 的離線圖磚匯出改為 disabled-by-default，保留路線/狀態 `.melmap` 匯出與既有 tile pack 匯入。
- 阻塞原因：`android/keystore.properties` 與 `android/release-upload-key.jks` 不存在，`jarsigner` 驗證結果為 unsigned，因此目前 AAB 不是 Google Play upload-ready artifact。
- 驗證：`npm.cmd run android:bundle:release`（需設定 `JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`）、`jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab`、`npm.cmd audit --omit=dev`（0 vulnerabilities）、`npm.cmd audit`（9 dev-tool vulnerabilities，主要在 `@capacitor/assets`/asset-generation tooling transitive dependencies）、`npm.cmd run build`、`npm.cmd run test:numeric`、`npm.cmd run test:chunks`、`node test/run-playwright-with-preview.mjs test/import-export.spec.js`、`npm.cmd run test:gui`（62 passed）。Provider terms sources 已同步到 `doc/offline-tile-strategy.md`。

### 2026-05-20 A6 Update

- 狀態變更：`A6 Weather point generation extraction` 完成。
- 影響範圍：新增 `src/modules/weatherPointBuilder.js`，把 weather point 生成、interval 插點、回程/O-loop 合成、imported track cumDist 排序與 label 去重移出 `src/main.js`；`main.js` 保留 UI/app state adapter 與 `waypointCumDistM` 回寫。
- 契約確認：輸出欄位 shape 維持既有語意；round-trip return `_elapsedH` 仍相對旅程起點；imported track 強制單程並保留匯入 weather/windy 欄位；generated interval points 不帶 persistent weather/time 欄位。
- 驗證：`npm.cmd run test:weather-points`、`npm.cmd run build`、`npm.cmd run test:numeric`、`npm.cmd run test:chunks`、`node test/run-playwright-with-preview.mjs test/weather-regression.spec.js test/import-export.spec.js`、`npm.cmd run test:gui`（62 passed）。

### 2026-05-20 A5 Update

- 狀態變更：`A5 Versioned caches` 完成。
- 影響範圍：`src/main.js` route metrics / pace computation cache 加入測試事件，確認 cache key 走 `routeVersion` + `waypointVersion` 與 `paceVersion` + `elevationVersion`；新增 `test/cache-versioning.spec.js` 覆蓋 cache hit、pace activity 失效與 route mode 失效。
- 驗證：`node test/run-playwright-with-preview.mjs test/cache-versioning.spec.js`、`npm.cmd run build`、`npm.cmd run test:numeric`、`npm.cmd run test:chunks`、`npm.cmd run test:gui`（62 passed）。

### 2026-05-20 A4 Update

- 狀態變更：`A4 效能基線` 完成。
- 影響範圍：`test/long-route-performance.spec.js` 新增 sample KML baseline，量測 first waypoint visible、chart visible、import settled 與 export modal open；`package.json` 新增 `test:perf`。
- 目前基準：`test:perf` 輸出 sample KML 約 first waypoint 147ms、chart 289ms、import settled 309ms、export modal 470ms；完整 GUI run 中為 137ms、271ms、296ms、471ms。
- 驗證：`npm.cmd run test:perf`（3 passed）、`npm.cmd run build`、`npm.cmd run test:numeric`、`npm.cmd run test:chunks`、`npm.cmd run test:gui`（61 passed）。

### 2026-05-20 A3 Update

- 狀態變更：`A3 回歸測試補強` 完成。
- 影響範圍：新增 `test/weather-regression.spec.js`，覆蓋 round-trip/per-segment return timing、O-loop return-to-start column 與 generated interval persistence；補強 `test/import-export.spec.js` 的 imported-track weather column 順序；補強 `test/smoke.spec.js` 的 dynamic DOM 翻譯覆蓋。
- 驗證：`node test/run-playwright-with-preview.mjs test/weather-regression.spec.js`、`node test/run-playwright-with-preview.mjs test/smoke.spec.js`、`node test/run-playwright-with-preview.mjs test/import-export.spec.js`、`npm.cmd run build`、`npm.cmd run test:numeric`、`npm.cmd run test:chunks`、`npm.cmd run test:gui`（60 passed）。

### 2026-05-20 A2 Update

- 狀態變更：`A2 GUI/Playwright 測試可靠度整理` 完成。
- 影響範圍：`package.json` GUI 測試 scripts、`test/helpers/consoleErrors.js`、`smoke`/`import-export`/`mobile` console error collector、`smoke` 部分真實 click、`layer-toggle` route-overlap helper。
- 驗證：`npm.cmd run build`、`npm.cmd run test:numeric`、`npm.cmd run test:chunks`、`npm.cmd run test:layer-toggle`（31 passed）、`npm.cmd run test:gui`（57 passed，含 4 層重疊路徑護欄）。
- 仍需追蹤：`#btn-clear-route` 與 `#btn-export-gpx` 在匯入後仍會落在 viewport 外，測試保留 DOM click fallback；若要完全還原 Playwright actionability，需要後續 UI/layout 修正。

### 2026-05-20 A1 Update

- 狀態變更：`A1 配速 placeholder 格式化集中化` 完成。
- 影響範圍：`src/main.js` 配速 placeholder/constraint helper、活動切換時的 placeholder 更新路徑、`test/smoke.spec.js` 回歸測試。
- 驗證：`npm.cmd run build`、`npm.cmd run test:numeric`、`npm.cmd run test:chunks`、`npm.cmd run test:smoke`（57 passed，含 4 層重疊路徑護欄）。
- 仍需追蹤：下一步回到 `A2 GUI/Playwright 測試可靠度整理`。

- Android native bridge QA 與 iOS validation 合併為 `R1 Native device validation`。
- Upload keystore、release AAB 與 internal testing upload 合併為 `R2 Android signing 與 internal testing artifact`。
- Privacy URL、store forms、native screenshots、offline provider terms 與 audit review 合併為 `R3 商店與合規收斂`。
- GUI 啟動腳本、smoke 錯誤判讀、layer-toggle helper 與 Playwright click actionability 合併為 `A2 GUI/Playwright 測試可靠度整理`。
- Numeric regression 與 i18n dynamic DOM coverage 合併為 `A3 回歸測試補強`。
- Versioned caches 與 weather point extraction 保持分開，因為前者是 cache key/效能整理，後者會碰到天氣點資料流與排序語意。

## 驗證門檻

每輪一般修改至少跑：

```powershell
npm.cmd run test:numeric
npm.cmd run test:chunks
npm.cmd run build
```

涉及 UI、匯入匯出、native 或發布時加跑：

```powershell
npm.cmd run test:smoke
npm.cmd run test:import-export
npm.cmd run test:mobile
npm.cmd run test:native-config
npm.cmd run build:web
npm.cmd run build:app
```

Android build 或 release 檢查依需求加跑：

```powershell
npm.cmd run android:build:debug
npm.cmd run android:bundle:debug
npm.cmd run android:bundle:release
```

GUI 驗證至少要保留：

- 完整 Playwright GUI suite 通過。
- `long-pressing a route overlap with four stacked legs cycles every visible layer` 通過。
- 長按切換後 waypoint 數量不變、路徑頂層顏色逐層切換、循環後回到初始層級。

## 來源文件索引

| 文件 | 角色 | 控管規則 |
| --- | --- | --- |
| `TODO.md` | 單一主控文件 | 只在這裡追蹤狀態、優先序、阻塞與下一步。 |
| `doc/refactor-roadmap.md` | 後續 refactor 詳細方案 | 保留設計細節；實際狀態同步到本文件。 |
| `doc/pre-app-optimization-progress.md` | App 化前置工作的歷史紀錄 | 不再作為 active tracker；剩餘工作同步到本文件。 |
| `doc/app-deployment-plan.md` | App 部署策略與驗收背景 | 保留策略；上架實際進度同步到本文件。 |
| `doc/native-app-qa.md` | native bridge 執行清單 | QA 執行細節在此；阻塞與完成狀態同步到本文件。 |
| `doc/offline-tile-strategy.md` | 離線圖磚技術與授權邊界 | 條款複查與 release blocker 同步到本文件。 |
| `doc/privacy-data-flow.md` | 隱私資料流盤點 | 新外部服務、analytics、crash reporting、持久資料都要更新。 |
| `doc/app-store-disclosure-draft.md` | 商店隱私揭露草稿 | live forms 核對結果同步到本文件。 |
| `doc/store-listing-draft.md` | 商店文案、素材與截圖草稿 | 截圖與送審 checklist 狀態同步到本文件。 |
| `doc/state-contract.md` | durable state 與 `.melmap` allow-list 契約 | 新 key、新 reset/import 行為必須同步更新。 |
| `Windy_API.md` | Windy URL 格式筆記 | 只作技術參考，不追蹤進度。 |

## 更新模板

新增或完成項目時，把紀錄集中寫在本文件對應區塊：

```markdown
### YYYY-MM-DD Update

- 狀態變更：
- 影響範圍：
- 驗證：
- 仍需追蹤：
```
