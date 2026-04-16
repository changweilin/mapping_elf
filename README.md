# Mapping Elf — GPX 軌跡生成器

Mapping Elf 是一個強大且互動式的地圖應用程式，專為戶外愛好者設計，提供即時地圖瀏覽、路線規劃、高度剖面圖、距離統計與詳細的沿途天氣預報等功能。

## 🌟 主要功能 (Features)

*   **多模式路線規劃：** 支援步行、健行、越野跑、自行車、駕車等多種運動模式。可規劃單程、來回或是 O 型環狀路線。
*   **靈活的匯入與匯出：** 支援讀取與匯出 **GPX**、**KML** 以及 **YAML** (純文字天氣與行程計畫) 等多種格式。
*   **地形與高度顯示：** 內建 Chart.js 繪製的流暢高度剖面圖，並即時計算總距離、總爬升／下降及最高海拔。
*   **進階配速與體能參數：** 內建進階參數設定，考量體重、背包負重、地形起伏及個人疲勞程度，為您提供更準確的預估時間、熱量消耗和建議補給。
*   **離線地圖支援：** 結合 PWA 與 Service Worker 架構，支援下載當前畫面或「沿著規畫路線」的地圖圖資快取，確保在無網路連線的山區也能順利導航。
*   **天氣資訊整合：** 結合 Windy 服務與不同的天氣預報模型 (如 ECMWF, GFS, ICON 等)，提供路線沿途精準的預報時間軸，掌握每個節點的氣候變化。
*   **跨平台支援：** 透過 Capacitor 緊密結合，不僅是網頁版 (Web App)，也能輕鬆建置可安裝的 Android 與 iOS 原生應用程式。

## 🚀 技術棧 (Tech Stack)

*   **前端核心與建置：** Vanilla JavaScript (ES Module), HTML5, CSS3, Vite
*   **地圖引擎：** Leaflet (`^1.9.4`)
*   **資料視覺化：** Chart.js (`^4.5.1`)
*   **跨平台/原生封裝：** Capacitor (`^8.3.0`)
*   **架構與效能：** PWA (Progressive Web App) 架構、Service Worker 離線快取

## 🛠️ 安裝與執行 (Installation and Setup)

1. **安裝依賴套件**
   確保你的環境已安裝環境 Node.js，然後在專案根目錄下執行：
   ```bash
   npm install
   ```

2. **啟動開發伺服器**
   ```bash
   npm run dev
   ```

3. **建置生產版本**
   ```bash
   npm run build
   ```

4. **預覽生產版本**
   ```bash
   npm run preview
   ```

## 📱 行動端應用程式開發 (Mobile App Development)

本專案整合了 Capacitor，將前端 Web App 轉換為原生 Android 與 iOS 應用程式：

- **同步檔案至原生專案：**
  在執行 `npm run build` 生成最新編譯檔之後，執行下列指令以同步資源至 Android/iOS 原生目錄：
  ```bash
  npx cap sync
  ```
- **開啟原生開發環境：**
  ```bash
  npx cap open android
  # 或
  npx cap open ios
  ```

## 📂 專案結構 (Project Structure)

*   `src/` - 原始碼
    *   `modules/` - 地圖管理 (`mapManager.js`)、路線引擎 (`routeEngine.js`)、匯入/匯出 (`gpxExporter.js`) 等核心模組邏輯
    *   `styles/` - 樣式表 (`main.css` 等)
    *   `main.js` - 應用程式主要進入點
*   `public/` - 靜態資源（包含 PWA 清單檔案 manifesto 與 Service Worker 相關設定）
*   `android/` & `ios/` - Capacitor 產生的原生應用程式目錄
*   `dist/` - 執行 build 後產生的生產環境版本
*   `doc/` - 相關文件與說明
*   `.claude/` - 專案相關的 AI Agent 輔助配置檔

