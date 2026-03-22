# 更新說明 (Changelog) - Taiwan Building Code Tracker

本文件記錄 Taiwan Building Code Tracker 的變更細節。所有版次變更遵循 [語意化版本 (SemVer)](https://semver.org/)。

---

## [1.1.0] - 2026-03-22

### 新功能 (Added)
- **解釋函查詢工具**：新增 `search_building_interpretations` 工具，可即時搜尋內政部國土管理署的解釋令。
- **動態網頁處理 (Playwright)**：引入 Playwright (Chromium) 核心，用於處理國土署網站的 Next.js 動態渲染與 WAF (Incapsula) 防護。
- **詳細內容抓取**：支援點擊詳細頁面並解析函釋的回覆內容。

### 優化 (Improved)
- **懶載入機制 (Lazy Loading)**：優化 MCP 啟動效能，Playwright 瀏覽器實例與法規快取僅在工具實際呼叫時才會啟動或產生。
- **免責聲明更新**：在 `README.md` 中加入詳盡的法律免責聲明與著作權說明。
- **專案結構優化**：分離法規爬蟲 (`scraper.ts`) 與解釋函爬蟲 (`interpretation_scraper.ts`)。

### 修正 (Fixed)
- 修正啟動 MCP 時自動產生 `law_cache.json` 的問題，避免在非搜尋任務時佔用資源。

---

## [1.0.0] - 2026-03-20

### 新功能 (Added)
- **建築構造編條文搜尋**：支援《建築技術規則建築構造編》的全文檢索與章節解析。
- **本地快取機制**：實作 JSON 快取層，減少對全國法規資料庫的頻繁請求。
- **MCP 伺服器基礎架構**：建立基於 Stdio Transport 的 Model Context Protocol 伺服器環境。

---
*最後編輯: 2026-03-22*
