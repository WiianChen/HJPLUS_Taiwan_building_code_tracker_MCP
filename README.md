# Taiwan Building Code Tracker (台灣建築法規查詢 MCP)

![Version](https://img.shields.io/badge/version-v1.0.0-blue.svg)

基於 MCP 協定的台灣建築法規自動化查詢工具，直接介接全國法規資料庫，提供最即時、精確且高品質的建築法規情報（目前以《建築技術規則建築構造編》為主）。

---

## 核心特色 (Key Features)
- **法規資料庫直接介接**: 採用增強型爬蟲技術直接抓取 [全國法規資料庫](https://law.moj.gov.tw/)，確保資料與官網同步，免除手動更新。
- **條文結構化解析**: 
  - **智慧結構識別**：自動解析條文中的「編」、「章」、「節」與「條號」，並維持條文內容的完整性。
  - **編碼自動偵測**：支援 UTF-8 編碼處理，杜絕亂碼，確保條文內容精確呈現。
- **高效本地快取機制**: 內建快取功能，首次抓取後會存儲於本地 `data/law_cache.json`，大幅提升後續查詢速度並減少網路負擔。
- **條文全文檢索**: 支援關鍵字模糊搜尋，能快速從數百條法規中定位出相關的構造規範。
- **AI 整合**: 作為 Model Context Protocol (MCP) 伺服器，讓 AI (如 Claude) 能直接理解、分析並引用最新的台灣建築技術規範。

## 技術架構 (Technical Architecture)
- **Runtime**: Node.js (v20+)
- **Protocol**: Model Context Protocol (MCP)
- **Data Source**: 
  - 來源：[全國法規資料庫 (law.moj.gov.tw)](https://law.moj.gov.tw/)
  - 目標法規：建築技術規則建築構造編 (PCode: D0070115)
  - 方法：自動化網頁解析 (Web Scraping via Cheerio & Axios)
- **功能模組**:
  1. **Scraper**: 負責從官網抓取並解析 HTML 條文結構。
  2. **Search Engine**: 基於關鍵字的輕量級全文檢索功能。
  3. **Cache Layer**: 自動管理本地法規 JSON 快取。

## 部署與安裝 (Deployment & Setup)

### 1. 環境準備
- 安裝 [Node.js](https://nodejs.org/) (v20 或以上版本)。
- 確認已安裝 `npm`。

### 2. 下載與編譯 (Build)
```bash
# 進入專案目錄
npm install
npm run build
```

### 3. 設定 AI 客戶端 (Configure Client)
本服務為本機運行的 MCP Server，請將其加入 AI 客戶端（以 Claude Desktop 為例）。

找到 Claude Desktop 的設定檔 `claude_desktop_config.json`：
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

將以下內容加入 `mcpServers` 區塊（請將路徑修改為您本機的**絕對路徑**）：

```json
{
  "mcpServers": {
    "taiwan-building-code": {
      "command": "node",
      "args": [
        "C:/Users/[您的使用者名稱]/.../Taiwam_building_code_tracker/dist/index.js"
      ]
    }
  }
}
```
*注意：Windows 路徑建議使用正斜線 `/` 避免 JSON 格式錯誤。*

## 使用範例 (Usage Examples)
您可以對 AI 說：
- 「搜尋建築技術規則中關於『活載重』的規定。」
- 「幫我查一下地震力計算的相關條文。」
- 「基礎構造在軟弱地層有什麼特別要求？」
- 「重新更新法規資料 (refresh_data)。」

## 關於作者 (About the Author)
- **作者**: 加號設計數位工程有限公司 HJPLUS.DESIGN
- **網站**: [加號設計數位工程有限公司](https://hjplus.design)
- **粉絲專頁**: [加號設計數位工程有限公司](https://www.facebook.com/hjplus.design)
- **電子郵件**: [info@hjplusdesign.com](mailto:info@hjplusdesign.com)

我們是設計、建築與製造產業的外部研發夥伴，專門協助缺乏內部技術團隊的公司導入數位工作流程、工具與 AI，自動化你的知識與作業流程，以補足團隊技能升級的能量。我們專門解決以下情況：

- **技術缺口**：團隊中沒技術人員或團隊，卻需要自動化或資料串接。
- **整合困難**：專案複雜、資料格式多，但缺乏整合經驗。
- **轉型迷惘**：想導入 AI 或 BIM，但不知道從哪開始。
- **研發支援**：需要專案型的數位顧問或工具開發支援。

更多數位轉型諮詢與服務內容歡迎與我們聯絡。

## 授權與宣告 (License & Disclaimer)
- **免責聲明**：本工具僅供個人查詢輔助、學術研究或技術展示使用。法規資料內容以「全國法規資料庫」官方公告為準。使用者在進行設計或施工決策前，應自行核實資料的準確性與時效性，開發者不對因使用本工具資料而產生的任何損失負責。
- **授權條款**：本專案採用 [ISC License](./package.json) 開源授權。
- **版權所有**：Copyright (c) 2026 加號設計數位工程有限公司 (HJPLUS.DESIGN Ltd.)。
