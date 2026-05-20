# Mapping Elf 專案控管中心

Last updated: 2026-05-20

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

| 序 | 狀態 | 工作包 | 已整合項目 | 完成條件 |
| --- | --- | --- | --- | --- |
| A1 | 待辦 | 配速 placeholder 格式化集中化 | `updateFlatPlaceholder()`、活動切換 placeholder、`kmh`/`minkm`/`shanhe` 顯示一致性 | 三種單位顯示與現況一致；跑過 `test:numeric`、`test:chunks`、`build`。 |
| A2 | 待辦 | GUI/Playwright 測試可靠度整理 | GUI 啟動腳本化、smoke 外部資源錯誤判讀、layer-toggle helper、可行時還原 `locator.click()` | 有可重複 GUI 驗證命令；不白名單化真正的 `console error`/`pageerror`；4 層重疊長按測試仍通過。 |
| A3 | 待辦 | 回歸測試補強 | round-trip、O-loop、per-segment、imported track、weather persistence、i18n dynamic DOM | 新測試能保護 return timing、interval persistence、imported-track ordering 與動態翻譯。 |
| A4 | 待辦 | 效能基線 | sample KML 匯入、chart visible、export modal open timing | 本地可重複輸出 timing，門檻先寬鬆，後續 refactor 可比較前後。 |
| A5 | 待辦 | Versioned caches | `routeVersion`、`paceVersion`、route/pace/elevation cache key 簡化 | numeric、smoke、import/export 行為不變；路線標籤、距離、天氣點順序與海拔 marker 不變。 |
| A6 | 待辦 | Weather point generation extraction | `buildWeatherPoints()` 純邏輯拆分、one-way/round-trip/O-loop/interval/imported-track 測試 | 輸出 shape 不變；return `_elapsedH` 仍相對旅程起點；generated interval times 不持久化。 |

### 發布門檻主線

| 序 | 狀態 | 工作包 | 已整合項目 | 完成條件 |
| --- | --- | --- | --- | --- |
| R1 | 阻塞 | Native device validation | Android native bridge QA、iOS simulator/device validation | Android 完成 `doc/native-app-qa.md`；iOS 在 Mac/Xcode 驗證 safe area、檔案匯入匯出、外部連結與 TestFlight readiness。 |
| R2 | 待辦 | Android signing 與 internal testing artifact | upload keystore、release AAB rebuild、Google Play internal testing upload | 設定 ignored `android/keystore.properties`，重跑 `npm.cmd run android:bundle:release`，用重建 AAB 上傳 internal testing。 |
| R3 | 待辦 | 商店與合規收斂 | privacy URL、native screenshots、Google Play Data safety、Apple App Privacy、provider terms、dev-tool audit | 發布前核對 live store forms；重新確認離線圖磚 provider terms；擷取 tested native build 手機截圖；複查 full `npm audit` dev-tool findings。 |

## 已完成基線

以下項目已清出執行看板，只作為後續驗證背景：

- GUI 與 smoke 護欄已建立，包含 4 層重疊路徑長按逐層切換、雙擊、匯入、匯出與地圖圖層基本流程。
- 第一輪低風險精簡已完成，包含配速單位轉換 helper、天氣表 `timeOpts` 去重與天氣表 HTML helper 拆分。
- Web/App build split、platform adapter、Capacitor sync helpers、Android APK/AAB build scripts 已建立。
- GPX/KML/`.melmap` round-trip、state contract、reset/import behavior 已有測試與文件基準。
- Privacy inventory、store disclosure draft、store listing draft、Google Play draft images 與 bundled privacy page 已建立。
- Android debug APK、debug AAB、release AAB 曾於 2026-05-19 本機 build 成功；native bridge QA 仍因沒有裝置/emulator 阻塞。

## 合併紀錄

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
