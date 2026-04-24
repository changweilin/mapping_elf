# 修正方案建議：路點累積距離與成員元數據同步問題

## 1. 主 Bug：回程路點累積距離計算錯誤
**適用場景：** 非匯入模式、開啟「往返 (Round-trip)」或「O-loop」。

### 當前問題
在 `src/main.js:buildWeatherPoints()` 中，回程路點的累積距離計算公式為：
`returnCum = totalDistM - wpCumDist[i]`
其中 `totalDistM` 僅為單程長度。這導致去程終點與回程起點的里程重疊（例如都是 10km），且排序與天氣/高度抓取位置會完全錯誤。

### 建議修正
1. **計算全路程距離**：定義 `fullTripDistM`。
   - 往返模式：`2 * totalDistM`。
   - O-loop：`totalDistM + haversine(最後一個點, 第一個點)`。
2. **修正回程公式**：`returnCum = fullTripDistM - wpCumDist[i]`。
3. **副作用修復**：確保 `getEleAt` 與 `getElapsedH` 使用 `fullTotalDistBuild` (應更新為全路程長度) 作為分母，避免高度插值範圍錯誤。

---

## 2. 次要 Bug：匯入模式下 Metadata 不同步
**適用場景：** 匯入模式 (Imported Track Mode)。

### 當前問題
`importedWaypointMeta` 陣列儲存了匯入時的原始里程與高度。但在 `mapManager.js` 中執行刪除 (`removeWaypoint`)、移動 (`moveWaypoint`) 或拖拽 (`dragend`) 時，僅修改了座標陣列，未同步修改 `importedWaypointMeta`。這導致 UI 上的路點與記憶體中的元數據索引錯位。

### 建議修正
1. **傳遞同步回調**：
   在 `mapManager.js` 的修改動作中，不僅觸發 `onWaypointChange(coords)`，還需告知具體的變動類型（例如 `delete(index)` 或 `swap(i, j)`）。
2. **同步更新陣列**：
   在 `src/main.js` 的監聽器中，對 `importedWaypointMeta` 執行對應的 `splice` 或交換操作。
3. **強制重算**：對於被移動的點，清除其 `meta.cumDistM` 與 `meta.ele`，迫使系統回頭使用 `projectCum` 與 `getEleAt` 重新計算正確值。

---

## 3. 待確認事項
- O-loop 閉環時的高度插值是否需要額外的 sample 資料支援（即回程段的地形可能與去程完全不同）。
- 匯出的 GPX 是否應優先寫入修正後的 `_cum` 距離以確保再次匯入時一致。
