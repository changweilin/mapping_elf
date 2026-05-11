# Mapping Elf 待完成清單

## 修改原則

- 不改變既有遊戲規則、操作節奏、路徑顯示層級切換行為與整體遊戲體驗。
- 每次精簡前先確認 GUI 測試基準；修改後必須重跑完整 GUI 流程。
- 尤其要保護長按切換航點/路徑顯示層級：當軌跡重疊 4 層或以上時，長按循環切換仍要逐層顯示且能回到原層級。
- 優先做低風險整理：重複邏輯、格式化 helper、測試工具化；避免同時重構事件流程與 UI 呈現。

## 已建立護欄

- [x] 建立 GUI 測試涵蓋「4 層重疊路徑長按逐層切換」。
- [x] 完整 GUI suite 已可驗證長按、雙擊、匯入、匯出與地圖圖層基本流程。
- [x] smoke test 已過濾本機/沙盒造成的外部資源載入噪音，仍保留 JS error 偵測。
- [x] 第一輪低風險精簡：集中配速單位轉換 helper，移除天氣表重複的 `timeOpts`。

## 待完成精簡項目

- [ ] 天氣表 HTML 組裝拆小 helper
  - 目標：降低 `renderWeatherPanel()` 的長度與重複字串組裝。
  - 限制：不要改變欄寬計算、收合狀態、日期/時間選擇、Windy 連結與天氣資料顯示。

- [ ] 配速 placeholder 格式化集中化
  - 目標：整理 `updateFlatPlaceholder()` 與活動切換時的 placeholder 格式。
  - 限制：先補測或手動確認 `kmh`、`minkm`、`shanhe` 三種單位顯示完全一致，再修改。

- [ ] GUI 測試啟動流程文件化或腳本化
  - 目標：把目前手動 preview + no-webServer Playwright config 的 Windows 驗證流程變成可重複命令。
  - 限制：不能影響現有 CI 或一般 `playwright.config` 使用方式。

- [ ] layer-toggle 測試 helper 再整理
  - 目標：共用 waypoint/route overlap 狀態讀取與長按操作 helper，讓新增案例更容易。
  - 限制：測試語意要保持清楚，不能把關鍵驗證藏到過度抽象的 helper 裡。

- [ ] 路徑/航點層級切換邏輯 code review
  - 目標：找出可讀性可提升的重複片段或命名模糊處。
  - 限制：此區是高風險區，修改前必須先列出行為基準，並保留 4 層以上重疊長按測試全綠。

- [ ] 天氣/匯入匯出 smoke 測試補強
  - 目標：讓 smoke test 更明確區分「外部資源載入失敗」與「應用程式錯誤」。
  - 限制：不可把真正的 console error 或 pageerror 白名單化。

## 每輪修改後驗證

```powershell
npm.cmd run test:numeric
npm.cmd run build
npm.cmd run test:chunks
```

GUI 驗證至少要包含：

- [ ] 完整 Playwright GUI suite 通過。
- [ ] `long-pressing a route overlap with four stacked legs cycles every visible layer` 通過。
- [ ] 長按切換後 waypoint 數量不變、路徑頂層顏色逐層切換、循環後回到初始層級。

