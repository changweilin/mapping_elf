# Mapping Elf App 版前置優化規劃書

建立日期：2026-05-18

## 1. 目標

在正式擴充 Android/iOS App 版之前，先整理 Web 版中會影響 App 化穩定性的基礎能力，降低後續 Capacitor 打包、真機測試、檔案處理、離線能力與商店上架的風險。

這份規劃書的重點不是先做 App 專屬功能，而是先把「Web 和 App 都會用到的地基」整理好。這些工作完成後，Web 版也會受益，App 版則能比較平順地接上。

## 2. 原則

- 維持同一 repo，不拆 Web/App 專案。
- 優先抽離平台差異，不複製核心邏輯。
- 先改善既有 Web 行為，再接 Capacitor 原生能力。
- 資料格式、localStorage key、`.melmap` 契約要向後相容。
- 每個前置優化都要能被測試或手動驗收。

## 3. 優先工作總覽

| 優先級 | 工作 | 目的 | App 化關聯 |
| --- | --- | --- | --- |
| P0 | 拆 Web/App build mode | 避免 App 白屏與資源路徑錯誤 | Capacitor 啟動基礎 |
| P0 | 建立 platform adapter | 集中處理平台差異 | 後續接原生 API |
| P0 | 匯入匯出解耦 | 分離資料產生與下載行為 | 接手機檔案/分享 |
| P1 | import/export round-trip 測試 | 確保資料不丟失 | App 檔案流程穩定 |
| P1 | localStorage 與 `.melmap` 契約盤點 | 避免版本升級破壞資料 | App 更新相容性 |
| P1 | 錯誤狀態整理 | 提升無網路/API/權限失敗體驗 | 真機常見失敗處理 |
| P1 | 行動版 UI QA | 改善手機觸控與小螢幕 | App 體驗基礎 |
| P2 | 長路線效能優化 | 避免長 GPX 與大量 waypoint 卡頓 | 手機效能更敏感 |
| P2 | 請求取消與防舊結果覆蓋 | 避免非同步結果錯亂 | App 網路波動較多 |
| P2 | 離線圖磚策略整理 | 控制快取大小與失敗狀態 | App 離線賣點 |
| P2 | 隱私資料流盤點 | 提前準備商店揭露 | 上架必要文件 |

## 4. 工作項目

### 4.1 拆 Web/App build mode

現況 `vite.config.js` 使用 GitHub Pages 需要的 `base: '/mapping_elf/'`。App 內部建議使用相對路徑 `./`，否則 Capacitor WebView 可能載不到 assets。

建議做法：

- 新增 `build:web`。
- 新增 `build:app`。
- Vite 依 mode 切換 base。
- Web mode 使用 `/mapping_elf/`。
- App mode 使用 `./`。
- 保留既有 `build` 行為，或明確改成 `build:web`。

建議 scripts：

```json
{
  "build:web": "vite build --mode web",
  "build:app": "vite build --mode app",
  "cap:sync": "npm run build:app && npx cap sync"
}
```

驗收標準：

- Web build 後資源仍可在 GitHub Pages 路徑載入。
- App build 後 `dist/index.html` 不出現 `/mapping_elf/assets/...` 的絕對資源依賴。
- `npx cap sync` 能複製正確的 App bundle。

### 4.2 建立 platform adapter

把會因 Web/App 平台不同而改變的能力集中起來，避免到處散落 `navigator`、`window.open`、`a.download`、`localStorage` 特例。

建議結構：

```text
src/platform/
  index.js
  webPlatform.js
  capacitorPlatform.js
```

第一階段可先抽象這些能力：

- `openExternalUrl(url)`
- `downloadFile({ filename, mimeType, content })`
- `pickFile({ accept })`
- `shareFile({ filename, mimeType, content })`
- `getCurrentPosition(options)`
- `vibrate(pattern)`
- `getNetworkStatus()`

驗收標準：

- Web 行為不變。
- main/modules 不直接新增新的平台特例。
- App 版後續可在 `capacitorPlatform.js` 替換實作。

### 4.3 匯入匯出解耦

目前 GPX/KML/`.melmap` 的內容產生與下載行為容易綁在一起。App 版需要接手機檔案儲存、分享、檔案關聯，應先將資料產生與輸出通道分離。

建議方向：

- exporter 負責產生 string/blob/metadata。
- platform 負責下載、分享、儲存。
- importer 負責解析內容，不負責 UI 或檔案來源。
- UI 只負責觸發流程與顯示結果。

驗收標準：

- GPX export 回傳內容可被測試。
- KML export 回傳內容可被測試。
- `.melmap` export 回傳 blob 或 ArrayBuffer 可被測試。
- Web 下載功能維持可用。

### 4.4 補 import/export round-trip 測試

App 版最容易出問題的地方之一是檔案流程。前置階段應先讓 Web 的資料匯入匯出可自動驗證。

建議測試資料：

- 短路線：2-3 個 waypoint。
- 長路線：大量 track points。
- 中文檔名與中文 waypoint。
- 含天氣資料。
- 含海拔資料。
- 含去回程或 O-loop 設定。
- `.melmap` 含 localStorage state。

建議測試：

- GPX export -> import。
- KML export -> import。
- `.melmap` export -> import。
- 匯入後 waypoint 數量、座標、名稱、時間、天氣、海拔、設定不丟失。

驗收標準：

- 新增 `test:import-export` 或併入既有測試。
- 核心 round-trip 測試可在 CI/local 重複執行。

### 4.5 localStorage 與 `.melmap` 契約盤點

App 更新較慢，資料相容性比 Web 更重要。需要先確認哪些資料是永久設定、哪些是暫存、哪些應進入 `.melmap`。

建議產出：

```text
doc/state-contract.md
```

應記錄：

- localStorage key 名稱。
- 用途。
- 資料格式。
- 預設值。
- 是否進入 `.melmap`。
- 是否可清除。
- 是否需要 migration。

驗收標準：

- 新增或修改 state key 時有文件可對照。
- `.melmap` 匯入不會覆蓋不該覆蓋的使用者設定。
- 重置功能清楚區分設定、路線資料、快取資料。

### 4.6 錯誤狀態整理

App 真機環境更常遇到權限、網路、API、快取狀態的組合問題。前置階段可先整理錯誤訊息與 UI 狀態。

應區分：

- 無網路。
- 第三方 API timeout。
- 第三方 API 回傳錯誤。
- 定位權限拒絕。
- 系統定位關閉。
- GPS timeout。
- 離線快取不可用。
- 瀏覽器或 WebView 不支援某能力。

驗收標準：

- 使用者能知道問題原因與下一步。
- 錯誤不只寫在 console。
- 重試、取消、改用手動模式的流程清楚。

### 4.7 行動版 UI QA

App 版的第一印象會由手機 UI 決定。前置階段應先在 Web mobile viewport 把主要觸控流程修順。

檢查範圍：

- 地圖拖曳與點擊。
- waypoint 新增、拖曳、刪除。
- 底部面板。
- modal open/close。
- 天氣表格。
- 海拔圖。
- GPX/KML/`.melmap` 匯入匯出入口。
- 橫向畫面。
- 小螢幕與平板。

建議加入：

- `env(safe-area-inset-top)`
- `env(safe-area-inset-bottom)`
- `env(safe-area-inset-left)`
- `env(safe-area-inset-right)`

驗收標準：

- 手機寬度下主要按鈕不重疊。
- 觸控目標足夠大。
- 底部面板不遮住關鍵操作。
- modal 可正常關閉。
- 橫向畫面可用。

### 4.8 長路線效能優化

手機 CPU 與記憶體限制更明顯。正式 App 化前可先處理長 GPX、大量 waypoint、長天氣表格造成的卡頓。

建議方向：

- 長 GPX 匯入分段處理。
- 大量 DOM 更新批次化。
- 地圖拖曳時避免重算天氣與海拔。
- Chart.js 更新節流。
- 路線與天氣計算加入進度狀態。

驗收標準：

- 長路線匯入期間 UI 不完全凍結。
- 使用者可看到進度或忙碌狀態。
- 取消或切換路線時不留下舊結果。

### 4.9 請求取消與防舊結果覆蓋

路線、天氣、海拔、地名查詢都可能在使用者快速操作時發生舊請求晚回來覆蓋新狀態。

建議方向：

- 對 fetch 加入 `AbortController`。
- 對長計算使用 request id/version guard。
- 新路線產生時取消舊路線相關請求。
- 顯示資料前確認 routeVersion/waypointVersion。

驗收標準：

- 快速拖曳 waypoint 不會顯示舊天氣。
- 快速切換路線模式不會套用舊路線。
- 取消中的請求不視為使用者可見錯誤。

### 4.10 離線圖磚策略整理

離線是 App 版很重要的價值，但也容易遇到容量、授權、失敗重試與使用者預期問題。

建議方向：

- 顯示已快取圖磚數量與估計容量。
- 下載前估算圖磚數量。
- 對過大範圍明確提示。
- 清除全部快取。
- 後續可擴充清除單一路線快取。
- 記錄圖資來源與授權注意事項。

驗收標準：

- 使用者知道下載範圍是否過大。
- 快取失敗有明確訊息。
- 離線狀態下已快取圖磚可使用。

### 4.11 隱私資料流盤點

正式 App 上架前一定要處理隱私政策與商店揭露。前置階段可先盤點資料流，避免最後才補。

應盤點：

- 定位資料是否離開裝置。
- 路線座標是否送到 BRouter/OSRM/Overpass/Open-Meteo 等服務。
- 天氣查詢座標與時間如何使用。
- localStorage 儲存哪些資料。
- `.melmap` 會包含哪些資料。
- 是否有 analytics/crash reporting。
- 是否有帳號、廣告、付款。

建議產出：

```text
doc/privacy-data-flow.md
```

驗收標準：

- 可作為 privacy policy 草稿依據。
- 可作為 Google Play Data safety 與 Apple App Privacy 填寫依據。
- 每次新增外部服務或資料收集時同步更新。

## 5. 建議落地順序

### Sprint 1：建置與平台地基

1. 拆 Web/App build mode。
2. 建立 platform adapter。
3. 外部連結集中處理。
4. 匯入匯出解耦第一版。

### Sprint 2：資料與測試

1. 補 GPX/KML/`.melmap` round-trip 測試。
2. 盤點 localStorage 與 `.melmap` 契約。
3. 建立 App 測試路線資料集。
4. 整理 reset/import 行為。

### Sprint 3：行動體驗與穩定性

1. 錯誤狀態整理。
2. 行動版 UI QA。
3. safe area CSS 預留。
4. Android/iOS 常見 WebView 差異預先處理。

### Sprint 4：效能與離線

1. 長路線效能優化。
2. 請求取消與 version guard。
3. 離線圖磚策略整理。
4. 隱私資料流文件。

## 6. 測試清單

### 6.1 自動測試

- `npm run test:numeric`
- `npm run test:chunks`
- `npm run test:smoke`
- `npm run test:import-export`

### 6.2 手動測試資料

- 短路線。
- 長路線。
- 高密度 track points。
- 中文檔名。
- 中文 waypoint 名稱。
- 無海拔資料。
- 含天氣資料。
- 含 `.melmap` state。
- 離線圖磚快取資料。

### 6.3 手動測試流程

- 新增 waypoint。
- 拖曳 waypoint。
- 刪除 waypoint。
- 匯入 GPX。
- 匯出 GPX。
- 匯入 KML。
- 匯出 KML。
- 匯入 `.melmap`。
- 匯出 `.melmap`。
- 查詢天氣。
- 產生海拔圖。
- 下載離線圖磚。
- 清除快取。
- 無網路使用。

## 7. 風險與對策

| 風險 | 影響 | 前置對策 |
| --- | --- | --- |
| Web/App path 不同 | App 白屏 | 先拆 build mode |
| 平台特例散落 | 後續維護困難 | 先建 platform adapter |
| 下載 API 不適用手機 | 匯出失敗 | 先分離 exporter 與 download |
| 匯入匯出資料遺失 | 使用者資料受損 | 補 round-trip 測試 |
| state key 無契約 | App 更新破壞舊資料 | 寫 state contract |
| 真機網路不穩 | 舊資料覆蓋新資料 | AbortController/version guard |
| 手機 UI 不順 | App 體驗差 | 先做 mobile QA |
| 隱私揭露臨時補 | 上架延誤 | 先做資料流盤點 |

## 8. 完成定義

前置優化完成時，應滿足：

- Web/App build mode 已分離。
- 平台差異有 adapter 可承接。
- GPX/KML/`.melmap` 匯出內容與下載行為已解耦。
- 主要匯入匯出有 round-trip 測試。
- localStorage 與 `.melmap` 契約有文件。
- 主要手機 viewport 已完成 QA。
- 錯誤狀態可被使用者理解。
- 長路線與大量資料不會明顯卡死。
- 離線圖磚策略有清楚限制與清除機制。
- privacy data flow 有初稿。

## 9. 與 App 部署計畫的銜接

本文件完成後，可銜接 `doc/app-deployment-plan.md` 的 Phase 1 到 Phase 3：

- Phase 1：建置分流會直接使用本文件的 build mode 成果。
- Phase 2：App 基礎體驗會接上 platform adapter。
- Phase 3：離線與資料會接上 state contract、round-trip tests、offline strategy。

建議先完成本文件 P0 與 P1 項目，再開始正式 App 版功能開發。
