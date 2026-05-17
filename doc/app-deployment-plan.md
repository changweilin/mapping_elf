# Mapping Elf App 部署計畫書

建立日期：2026-05-18

## 1. 目標

將現有 Mapping Elf Web/PWA 擴充為 Android 與 iOS App 版本，採用 Capacitor 打包，不重寫核心功能。第一階段目標是完成 Android 內部測試版，再推進 iOS TestFlight 與正式上架。

目前專案已有 App 化基礎：

- `package.json` 已包含 Capacitor 相關依賴。
- `capacitor.config.json` 已設定 `appId`、`appName`、`webDir`。
- 專案已包含 `android/`、`ios/`、app icons 與 splash assets。
- Android 目前 `targetSdkVersion = 36`，符合目前 Google Play 對新 app 與 app updates 至少 Android 15/API 35 的要求。

## 2. 部署策略

採用「同一專案、雙目標建置」。

- Web：維持 GitHub Pages/PWA 發布。
- App：同一套核心程式，用 Capacitor 打包 Android/iOS。
- 不拆 repo，避免地圖、路線、天氣、i18n、GPX/KML、`.melmap` 邏輯重複維護。
- 平台差異集中在 platform adapter，例如檔案、分享、外部連結、定位權限、返回鍵。

目前最需要優先修正的是 `vite.config.js` 的 `base: '/mapping_elf/'`。這適合 GitHub Pages，但 App 內建議使用 `./`，否則 Capacitor WebView 可能載不到 assets 而白屏。

## 3. 專案管理建議

短中期建議維持同一 repo。

建議結構：

```text
src/
  main.js
  modules/
    routeEngine.js
    weatherService.js
    mapManager.js
    ...
  platform/
    webPlatform.js
    capacitorPlatform.js
    index.js
```

核心邏輯維持共用：

- 路線規劃
- 天氣資料
- 海拔計算
- GPX/KML 匯入匯出
- `.melmap` map pack
- i18n
- pace/time/math/numeric utilities

平台差異集中處理：

- 檔案選擇、儲存、分享
- 外部瀏覽器開啟 Windy 或其他連結
- 定位權限與錯誤訊息
- Android back button
- iOS safe area
- 網路狀態
- haptics/vibration

只有在 App 版後續出現大量原生 UI、背景 GPS 記錄、付費訂閱、帳號同步、或 Web/App release 節奏完全分離時，才考慮拆成獨立專案。

## 4. 階段規劃

| 階段 | 工作內容 | 產出 |
| --- | --- | --- |
| Phase 0：盤點 | 確認 App 範圍、必要功能、上架平台、隱私資料流 | App MVP 清單 |
| Phase 1：建置分流 | 新增 `build:web`、`build:app`、`cap:sync`；修正 Vite base | 可安裝 debug app |
| Phase 2：App 基礎體驗 | Android back、iOS safe area、外部連結、定位權限、橫直向、檔案匯入匯出 | App 可日常使用 |
| Phase 3：離線與資料 | 測試離線圖磚、`.melmap`、localStorage 相容、快取清除、容量提示 | 離線功能穩定 |
| Phase 4：QA | 真機測試 Android/iOS、長 GPX、天氣 API、路線 API、匯入匯出 | 測試報告與 bug 清單 |
| Phase 5：Beta | Android internal testing、iOS TestFlight | 測試版發布 |
| Phase 6：正式上架 | 商店素材、隱私政策、Data safety/App Privacy、簽章、送審 | Google Play / App Store 上架 |

## 5. MVP 必做項目

- App 專用 build mode。
- Android 可安裝 AAB/APK。
- iOS 可在 Xcode/TestFlight 跑。
- 定位權限與錯誤處理。
- GPX/KML/`.melmap` 匯入匯出在手機可用。
- Windy 與外部連結用系統瀏覽器開啟。
- 離線圖磚下載、清除、狀態顯示可用。
- Web 版本不受 App 修改影響。
- App 內有隱私政策入口。
- 商店隱私資料準備完成。

## 6. 建議 scripts

```json
{
  "build:web": "vite build --mode web",
  "build:app": "vite build --mode app",
  "cap:sync": "npm run build:app && npx cap sync",
  "android": "npm run cap:sync && npx cap open android",
  "ios": "npm run cap:sync && npx cap open ios"
}
```

後續也可增加：

```json
{
  "cap:sync:android": "npm run build:app && npx cap sync android",
  "cap:sync:ios": "npm run build:app && npx cap sync ios",
  "android:build": "npm run cap:sync:android && npx cap build android"
}
```

## 7. App 版擴充時可順手做的優化

### 7.1 檔案與分享

- 原生檔案匯入：支援從手機 Files/檔案管理器選擇 GPX/KML/`.melmap`。
- 原生檔案匯出：避免只依賴 `<a download>`。
- 分享功能：將 GPX/KML/`.melmap` 分享到其他 app。
- 檔案關聯：讓使用者點 GPX/KML/`.melmap` 時可以用 Mapping Elf 開啟。

### 7.2 離線能力

- 顯示快取大小。
- 顯示路線圖磚預估下載量。
- 支援清除單一路線或全部快取。
- 加入低儲存空間提示。
- 清楚區分「無網路」、「圖磚已快取」、「天氣資料過期」、「API 暫時不可用」。

### 7.3 定位體驗

- 權限前說明：告訴使用者定位只用於地圖定位與路線規劃。
- 定位失敗原因：權限拒絕、系統定位關閉、GPS timeout、訊號不足。
- 支援 approximate location 的提示。
- GPS 冷啟動時給等待狀態。

### 7.4 App-like 行為

- Android back button：關 modal/panel 優先，其次才離開 app。
- iOS safe area：避免 notch/home indicator 擋住工具列。
- 外部連結：Windy、地圖服務、說明頁用系統瀏覽器開啟。
- 橫直向測試：地圖與底部面板在手機和平板都要可用。
- 啟動畫面：splash 後快速進入主工具，不做行銷式 landing page。

### 7.5 效能

- 長 GPX 匯入分段處理，避免主執行緒卡死。
- 天氣、海拔、路線請求可取消前一次任務。
- 地圖拖曳時避免重複昂貴重算。
- 大量 waypoint 時降低 DOM 更新頻率。
- 檢查 Chart.js、Leaflet chunk 對 App 首次啟動的影響。

### 7.6 隱私與信任

- App 內加入隱私政策入口。
- 清楚說明定位資料、路線資料、天氣查詢資料如何使用。
- 優先維持不登入也能用。
- 若未來加入 analytics/crash reporting，要同步更新隱私政策與商店揭露。

## 8. 驗收標準

### 8.1 Web 驗收

- `npm run build:web` 成功。
- GitHub Pages 資源路徑正確。
- Web/PWA 原有功能不退化。
- Playwright smoke test 通過。
- numeric regression test 通過。

### 8.2 Android 驗收

- `npm run cap:sync:android` 成功。
- Debug APK 可安裝並啟動。
- Release AAB 可產出。
- 定位權限流程正常。
- Android back button 行為符合預期。
- GPX/KML/`.melmap` 匯入匯出可用。
- 外部 Windy 連結不困在 WebView。
- 離線圖磚快取、清除、狀態顯示可用。

### 8.3 iOS 驗收

- `npm run cap:sync:ios` 成功。
- Xcode 可 build。
- TestFlight 可上傳。
- 定位權限文字正確。
- safe area 不遮擋 UI。
- 檔案匯入匯出可用。
- 外部連結正常開啟。
- 橫直向切換無重大 layout 問題。

### 8.4 商店驗收

- App icon 與 splash 完整。
- 商店截圖完成。
- App 描述、關鍵字、分類完成。
- Privacy policy URL 完成。
- Google Play Data safety 完成。
- Apple App Privacy 完成。
- App 內隱私政策入口完成。
- App Store Review 不會被視為單純網站包裝。

## 9. 風險與對策

| 風險 | 影響 | 對策 |
| --- | --- | --- |
| App 白屏 | 無法啟動 | 分離 Web/App base path |
| iOS 建置需要 Mac/Xcode | Windows 無法完整上架 iOS | Android 先行，iOS 用 Mac 環境處理 |
| 檔案下載不適用手機 WebView | 匯出失敗 | 導入 Capacitor Filesystem/Share |
| 離線圖磚容量大 | 儲存空間與授權風險 | 加容量提示、範圍限制、清除機制 |
| 第三方 API 不穩 | 路線/天氣失敗 | 加錯誤狀態、快取、重試、替代模式 |
| 商店隱私資料填寫不一致 | 審核卡關 | 盤點定位、API、快取、第三方服務並寫進政策 |
| Apple 認為只是網站包裝 | 退審 | 強化檔案、離線、定位、原生分享等 App 體驗 |
| Web/App 行為分歧 | 維護成本上升 | 平台差異集中在 adapter，不複製核心邏輯 |

## 10. 後續維護流程

### 10.1 開發流程

1. 先改共用核心邏輯。
2. Web smoke test。
3. App build sync。
4. Android 真機測試。
5. iOS 真機或 simulator 測試。
6. 若涉及資料格式，補相容性測試。
7. 若涉及隱私、API、權限，更新商店揭露與 privacy policy。

### 10.2 發版節奏

- Web：可小步快發。
- App：累積為版本發布，例如 `1.0.0`、`1.1.0`、`1.1.1`。
- 每次 App release 建議使用 `release/app-x.y.z` 分支。
- App 發版前跑完整 smoke test 與真機測試。
- `.melmap`、localStorage key、匯出格式必須維持向後相容。
- Android `versionCode` 每次上架遞增。
- iOS `CURRENT_PROJECT_VERSION` 每次上架遞增。
- 商店描述、截圖、隱私政策需跟功能同步更新。

### 10.3 版本分支建議

```text
main
  web hotfixes
  feature branches
  release/app-1.0.0
  release/app-1.1.0
```

若 Web 已經穩定，App release branch 只 cherry-pick 必要修正，避免臨近上架時導入大量新功能。

## 11. 預估時程

| 工作 | 預估 |
| --- | --- |
| Android MVP | 3-7 天 |
| Android internal testing 與修 bug | 約 1 週 |
| iOS TestFlight | 1-2 週 |
| 雙平台正式上架 | 2-4 週 |

實際時程會受 iOS 開發環境、Apple/Google 帳號、憑證、商店素材、隱私政策準備程度影響。

## 12. 參考資料

- Capacitor Workflow: <https://capacitorjs.com/docs/basics/workflow>
- Capacitor Configuration: <https://capacitorjs.com/docs/config>
- Google Play target API requirements: <https://developer.android.com/google/play/requirements/target-sdk>
- Google Play Data safety: <https://support.google.com/googleplay/android-developer/answer/10787469>
- Google Play User Data policy: <https://support.google.com/googleplay/android-developer/answer/10144311>
- Apple App Privacy Details: <https://developer.apple.com/app-store/app-privacy-details/>
- Apple App Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
