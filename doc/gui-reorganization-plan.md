# GUI 功能整理與整併規劃

> 目標：GUI 功能過多，將視覺結構整理為更符合使用者直觀的分組，並整併相似的功能。
> 原則：遵守 CLAUDE.md 最小手術原則——**以「重排與整併」為主，不重寫、不動 main.js 架構（INC-207）、所有元素 ID 不變**。

## 1. 現況盤點

### 1.1 UI 入口總覽

| 區域 | 內容 |
|---|---|
| 頂部工具列 | 圖層切換（街道/地形/衛星）、2D/3D、深淺色、側欄開關 |
| 地圖浮動鈕 | 回到軌跡、回到當前位置、量測工具 |
| 量測面板 | 軌跡量測／距離面積／集水區 |
| 底部面板 | 垂直軌跡圖／詳細天氣／詳細集水區 + 摘要 chips |
| 側欄（9 區塊） | 關鍵字搜索、路線規劃、配速參數、航點設置、我的最愛、路線統計、天氣設置、操作說明、About |
| 3D 檢視器 | 自有工具列 + 圖層鈕 + 播放列 |

### 1.2 發現的相似／重複功能

| # | 重複項 | 判定 | 處置 |
|---|---|---|---|
| 1 | 關鍵字搜尋框 vs 「緯度, 經度」座標搜尋框 | **純重複**。主搜尋框已內建 `parseLatLngInput` 座標解析（且功能更完整：可導航、可加航點、可複製座標）；第二個輸入框只能導航 | ✅ Phase 1 已整併：移除座標列 |
| 2 | `btn-favorite-quick`（路線規劃列）vs `btn-favorite-add`（我的最愛列） | 刻意設計：quick 鈕是側欄收合區塊時的快速入口（`route-favorite-and-panel-toggle.spec.js` 釘住） | 保留兩者 |
| 3 | 路線模式（步行/山徑/自行車/駕車）vs 配速運動（步行/健行/…/駕車） | 已有 `defaultActivityForRouteMode` 連動；兩者語意不同（路網 profile vs 配速模型） | 保留，Phase 2 評估 UI 上視覺並置 |
| 4 | 路線統計卡 vs 底部摘要 chips（距離/時間/爬升/下降） | chips 是摘要、統計卡含海拔極值/熱量/補給；chips 為前次 UI 重構刻意保留（`ui-restructure.spec.js`） | 保留兩者 |
| 5 | 側欄寬度鈕位於「操作說明」標題列 | 前次決策（`smoke.spec.js` 釘住位置） | 保留；Phase 3 若做側欄 header 再歸位 |

### 1.3 視覺結構問題

原側欄順序把「設定、檔案、結果」交錯排列：
`搜索 → 路線 → 配速 → 航點設置 → 我的最愛 → 統計 → 天氣設置 → 說明`
使用者規劃完路線後，「路線統計」被夾在檔案與天氣設定之間，且顯示類設定（航點設置、天氣設置）被「我的最愛」切開。

## 2. Phase 1（本次 PR 已實作）

1. **搜尋二合一**：移除重複的座標輸入列（HTML、main.js 接線、CSS、i18n 三條字串）。主搜尋框 placeholder 本為「輸入地名、座標...」，行為與提示一致。
2. **側欄依工作流重排**（純 DOM 區塊搬移，ID/接線不變）：
   - **規劃與分析**：關鍵字搜索 → 路線規劃 → 配速參數 → 路線統計
   - **顯示設定**：航點設置 → 天氣設置
   - **檔案**：我的最愛（含匯入/匯出/離線包）
   - **說明**：操作說明 → About
3. **視覺分組線**：新增 `.panel-group-start`（6px 分隔帶），讓四個群組在視覺上成塊，不新增任何文字（零 i18n 成本）。

## 3. 後續階段

### Phase 2 — 區塊內整理（已實作/已決議）

1. ✅ **天氣設置說明移入操作說明**：`.settings-desc` 整塊從 `#settings-body` 搬到 `#instructions-body` 段尾（置於 `.instructions-content` 之外，避免被 `renderInstructionsContent()` 覆寫），加上重用既有 i18n key「天氣設置」的小標。字串文字節點原封不動，`translateTree` 逐節點翻譯照常作用，零新增翻譯成本。天氣設置區塊現在只剩 Windy 預設選單（header）與天氣快取設定。
2. ✅ **顯示設定合併評估 → 決議不合併**，理由：
   - 航點設置的「顯示設置」勾選含詳細集水區資訊與航點置中，並非天氣專屬；天氣設置的主體（Windy 預設、快取門檻）是資料取得設定而非顯示設定，合併後語意反而混雜。
   - 兩個 section header 各自掛著功能性快速控制（副航點 interval 模式 vs Windy 圖層/模式選單），合併為單一區塊無法保留兩組 header 控制。
   - Phase 1 已把兩區相鄰放入「顯示設定」視覺群組（`.panel-group-start` 分隔帶），視覺分組目標已達成；再搬 DOM 需同步改多個測試釘位，成本高於效益（最小手術原則）。
3. ✅ **路線模式 ↔ 配速運動連動回饋**：使用者切換路線模式且配速運動實際被自動連動改變時，`#speed-activity-select` 播放一次淡出脈衝（`flashPaceActivitySync()` + `.activity-sync-flash` CSS 動畫），讓「已連動」看得見。完整把配速運動選單搬進路線規劃區塊經評估不做：該選單的顯示/隱藏跟隨配速面板（interval 模式 off 時整列隱藏），搬離會脫離此語意並拆散「重置配速」按鈕的分組。

### Phase 3 — 結構性調整（第 1、2 項已實作）

1. ✅ **側欄常駐 header**：`#side-panel` 頂部新增 sticky header（`#side-panel-header`），標題重用既有 i18n key「設置面板」，actions 收納加寬/縮窄鈕（自操作說明 header 移入，行動版沿用 `.panel-width-btn` 隱藏規則）、操作說明鈕與主題切換（自頂部工具列移入）。`smoke.spec.js` 釘位已同步；`map-layer-theme.spec.js` 全數通過確認主題切換行為不變。
2. ✅ **操作說明抽成 modal**：`#instructions-section` 自側欄移除，內容（含 Phase 2 移入的天氣設置說明）原封搬進 `#instructions-modal`，由側欄 header 的「?」鈕開啟。`.instructions-content` class 不變，`renderInstructionsContent()` 語言切換重繪照常作用；modal 沿用既有 `hidden` + `body.modal-open` 模式與「僅按鈕關閉」慣例；`.instructions-modal-box` 放寬至 720px 容納雙欄說明。「說明」群組分隔帶移到 About 區塊。
3. ⏸ **行動版四群組 tab 導航 — 暫緩**：屬行動版導航重設計，需要真機/多斷點視覺 QA 才能安全落地；且操作說明抽出後側欄長度已大幅縮短，tab 化的急迫性降低。留待確認需求後另開工作包。

### Phase 4 — 群組命名、顯示設置矩陣化、集水區總開關（本次 PR）

1. ✅ **群組帶改為具名**：`.panel-group-start`（無字 6px 分隔帶）換成 `.panel-group-label`（規劃與分析 / 顯示與資料 / 檔案 / 關於）。分隔線仍在（label 自帶 `border-top: 6px`），但使用者現在看得到每一塊在整個流程裡的角色。緊接 sticky header 的第一條由 `.side-panel-header + .panel-group-label` 去掉上緣，避免雙線。
2. ✅ **航點設置「顯示設置」矩陣化**：原本三列各自重複「主航點 / 副航點」兩個標籤（6 個 `.pace-check-opt`、大量 inline style），改成 3×2 的 `.wp-display-matrix`（列＝設定、欄＝航點種類）。**所有 checkbox id 不變**，main.js 接線完全沒動；inline style 一併收進 CSS class（`.waypoint-centering-row`／`.collective-target-row`／`.collective-actions-row`）。移除後不再使用的字串「主航點資訊」「副航點資訊」已自 `i18n.js` 清除。
3. ✅ **集水區總開關 `#catchment-enable`**：放在**天氣設置區塊內**（`#settings-body` 末段的 `#catchment-settings-group`），一個 `.section-switch` 總開關 + 「取得集水區 / 詳細集水區」快捷鍵 + 說明。放這裡是因為每一筆集水區讀數本質上就是「天氣讀數 + 地形/水文」，不值得為它多開一個側欄區塊。
   - 新 key `mappingElf_catchmentEnabled`（預設開）已登錄 `stateKeys.js` 的 `PREFERENCE_STATE_KEYS`，隨 .melmap 匯出。
   - 關閉時**鎖定而非隱藏**這五個入口：量測工具 `[data-measure-mode="catchment"]`、下方面板 `[data-bp-view="catchment"]`、3D `#tv-toggle-catchment`、資訊卡的「集水區」分頁、航點設置的「詳細集水區資訊」列（`.catchment-gated.is-locked`）。
   - 單一收斂點：`catchmentDetailEnabledFor` 與 `isCatchmentView` 直接讀 `catchmentEnabled`，因此 basin 疊圖、卡片內容一併停用；`autoFetchCatchment` / `fetchAllCatchmentData` / `loadTerrain3DCatchments` 各自 early-return，關閉後不會發出任何 DEM 請求。
   - `setMeasureMode` / `setBottomPanelView` 也擋 catchment，所以**重新載入時還原的暫存**不會把使用者送回已鎖定的畫面；`applyCatchmentEnabled(false)` 會即時把使用者移出正在看的集水區畫面並清掉 3D 疊圖。
   - 卡片的 `_wcCatchmentViewMemory` 保留不清，重新開啟即回到原本翻到集水區的那些卡。
   - 測試：`test/catchment-master-toggle.spec.js`（6 例，含 reload 持久化與「鎖定的按鈕真的是死的」）。
4. 🩹 順手修掉 `test/numeric-regression.mjs` 的過期斷言：`STATE_KEY_GROUPS` 在前一個 commit（a7f025f）加了 `tool` 群組但斷言沒同步，`test:numeric` 在乾淨樹上就是紅的。

### Phase 4b — 取消載入後進度條卡死（同一 PR 的 bug fix）

症狀：取消載入後進度圈圈不消失，之後按「更新天氣 / 取得集水區」也清不掉。三個獨立成因：

1. **註冊順序**（根因，四個載入全中）：每個可暫停載入都先 `beginRouteWeatherBusyTask()`（內部立刻重繪 overlay）**才** `pausableLoadRuns.add(run)`，所以重繪當下 `hasPausableLoad()` 還是 false → 停止/繼續鈕是 `hidden`。批次載入靠每個項目的 `busyTask.set()` 再次重繪而僥倖看不出來；**沒有進度 tick 的 per-card 集水區計算則整段期間都藏著鈕**——使用者根本按不到停止，更按不到取消。已改為統一走 `registerPausableLoad(run)`（add + 重繪），四個呼叫點同步換掉。
2. **取消沒有涵蓋所有 run**：`cancelActivePausableLoads()` 只呼叫 weather / catchment / terrain3D 三個 `cancel*ForRouteReplan`。per-card 集水區計算沒有取消掛勾，X 一按只顯示「已取消載入」，run 仍停在 `waitIfLoadPaused` 或掛在 DEM fetch 上 → busy task 永遠留在 `routeWeatherBusyTasks`，進度條就此釘死，之後每一次載入都在一條關不掉的進度條底下跑完。改為在此處逐一拆除每個註冊過的 run（cancel flag → abort → unpark → 移出 set → `busyTask.end()`），並新增 `cancelCardCatchmentComputes()` 把各 key 的 token 進位 + abort（只停待辦工作，已畫出的集水區範圍保留）。`end()` 與 delete 都是冪等，會自行收尾的迴圈照跑 `finally` 不受影響。
3. **`unparkLoadRun` 沒清 `paused`**：被喚醒但仍標記 paused 的 run 會讓 overlay 停在「已暫停」外觀，並在迴圈下一個 `waitIfLoadPaused` 再度停車。四個呼叫點全是取消路徑，清掉是安全的。

測試：`test/load-cancel-recovery.spec.js`（3 例）。故意讓 `/v1/elevation` 永不回應以製造「取消必須真的 abort 某個東西」的狀態；已確認**移除 main.js 修正後三例全紅**。

### Phase 4c — 載入優先順序與集水區資料保存

1. ✅ **批次載入優先順序**：`orderMainWaypointsFirst` 換成 `orderByLoadPriority(items, ptOf, tierOf)`，排序鍵依序為
   **資料層級（沒有數據 0 → 數據不完整 1 → 已有數據 2）→ 主航點(0)/副航點(1) → 原本的穩定順序**。
   資料需求是**主鍵**：使用者正在盯著空白的欄位先補，已經有值的欄位反正是磁碟/快取命中、幾乎不花時間，排後面沒差。
   - 天氣：`weatherDataTier(pt, colIdx, dateStr, hour)`，**刻意不看 `force`**——即使是強制重整，也先跑空白欄位。
   - 集水區：`catchmentDataTier(pt, colIdx)`，在該批次改寫讀數之前先算好存進 target。
   - 兩邊的 retry sweep 不傳 `tierOf`（重試清單裡每一項都是已知失敗＝同樣空），順序退化成原本的主航點優先。
2. ✅ **集水區地形資料永久保存**：集水區輪廓是 DEM 推出來的，與時間無關、重算必定同值，因此：
   - `pruneCatchmentCache()` **移除年齡門檻**（原本沿用 `weatherCacheMaxAgeDays`，預設 1 天就被清掉並重新下載），現在只丟掉格式壞掉或 schema 過期的項目。
   - `getCatchmentCacheHit()` / `setCatchmentCacheData()` **不再受 `weatherCacheEnabled` 影響**——集水區幾何不是天氣，關掉天氣快取不該讓它每次重算。
   - 新增 `clearCatchmentStoredData()` 與側欄「清除集水區資料」按鈕（`#btn-catchment-clear`）：這是資料唯一會消失的地方（另加既有的「回到預設」）。
   - 卡片／表格裡屬於天氣與水文的欄位仍照 schedule 重新取得——「與時間無關」只涵蓋地形那一段。
3. 測試：`test/load-priority-and-retention.spec.js`（3 例：資料層級主鍵、跨 reload 不因天氣年齡被清且不重新下載、關閉天氣快取仍保存＋清除按鈕確實清空）。主/副次鍵維持由 `data-load-edit-lock.spec.js:101` 釘住。

## 4. 守則對照

- 元素 ID 全數不變 → 既有測試（`smoke`、`route-favorite-and-panel-toggle`、`ui-restructure` 等）之 selector 不受影響。
- 不動 main.js 函式結構（INC-207）；Phase 1 僅刪除已無 DOM 對應的座標列事件接線，Phase 2 僅在 `applyRouteMode` 內加一個回饋 helper 呼叫，Phase 4 新增 `syncCatchmentEnabledUI` / `applyCatchmentEnabled` 兩個函式並在既有讀取點加 early-return，皆未搬移既有函式。
- 移除的使用者可見字串已同步自 `i18n.js` 清除（Phase 4 移除「主航點資訊」「副航點資訊」）；Phase 4 新增的字串已補齊 8 語系。
- 未動 `public/sw.js` precache 資產（INC-251 不適用）、未動 z-index 疊層（INC-325 不適用）。
- 新 localStorage key 一律登錄 `stateKeys.js`（Phase 4：`mappingElf_catchmentEnabled` → `PREFERENCE_STATE_KEYS`）。
