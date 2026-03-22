import { chromium, Browser, Page } from 'playwright';

export interface Interpretation {
  title: string;
  docNo: string;
  date: string;
  summary: string;
  url: string;
}

export class InterpretationScraper {
  private browser: Browser | null = null;
  private url = 'https://www.nlma.gov.tw/ch/titlelist/interpcomp';

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-logging',
        '--log-level=3'
      ]
    });
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  private async getPage(): Promise<Page> {
    if (!this.browser) await this.init();
    
    // 建立一個更像真實瀏覽器的 Context
    const context = await this.browser!.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
    });

    // 關鍵：繞過 webdriver 偵測
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    return await context.newPage();
  }

  async search(query: string, limit: number = 5): Promise<Interpretation[]> {
    const page = await this.getPage();
    try {
      console.error('正在連線至國土署解釋函系統...');
      
      // 增加延遲與模擬行為
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000); // 等待 WAF Challenge 執行

      const title = await page.title();
      console.error(`頁面標題: ${title}`);

      // 嘗試定位關鍵字輸入框
      // 在 Next.js 版面中，搜尋框通常在一個 form 內
      const searchInput = page.locator('input[placeholder*="關鍵字"], input#keyword, input[type="text"]').first();
      
      if (await searchInput.count() === 0) {
        console.error('找不到搜尋框，嘗試截圖...');
        await page.screenshot({ path: 'waf_blocked.png' });
        return [];
      }

      // 模擬人類打字
      await searchInput.click();
      await page.keyboard.type(query, { delay: 100 });
      
      // 點擊搜尋
      const searchBtn = page.locator('button:has-text("查詢"), .btn-primary').first();
      await searchBtn.click();
      
      console.error('已送出查詢，等待結果渲染...');
      await page.waitForTimeout(5000);

      // 解析結果
      const results = await page.evaluate(() => {
        const items: any[] = [];
        // 尋找列表，通常在 table 或具有列表特徵的 div 中
        const links = Array.from(document.querySelectorAll('a'))
          .filter(a => a.href.includes('/ch/titlelist/interpcomp/') && !a.href.includes('menuid'));

        links.forEach(link => {
          const row = link.closest('tr') || link.closest('.list-item') || link.parentElement;
          if (row) {
            items.push({
              title: link.textContent?.trim() || '無標題',
              url: link.href,
              fullText: row.textContent?.replace(/\s+/g, ' ').trim() || ''
            });
          }
        });
        return items;
      });

      console.error(`找到 ${results.length} 筆原始結果。`);

      return results
        .filter((v, i, a) => a.findIndex(t => t.url === v.url) === i) // 去重
        .slice(0, limit)
        .map(item => ({
          title: item.title,
          docNo: item.fullText.match(/[\u4e00-\u9fa5]+字第\d+號/)?.[0] || '點擊查看函號',
          date: item.fullText.match(/\d{3}\/\d{2}\/\d{2}/)?.[0] || '',
          summary: item.fullText.substring(0, 300),
          url: item.url
        }));

    } catch (error) {
      console.error('Scraping Error:', error);
      await page.screenshot({ path: 'error.png' });
      return [];
    } finally {
      await page.close();
    }
  }

  async getDetail(url: string): Promise<string> {
    const page = await this.getPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      
      const content = await page.evaluate(() => {
        const target = document.querySelector('.content_text, .article_content, #main-content, article');
        return target?.textContent?.trim() || document.body.textContent?.trim() || '無法讀取內容';
      });
      
      return content.replace(/\s+/g, ' ').substring(0, 1000);
    } catch (error) {
      return `讀取詳細內容失敗: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await page.close();
    }
  }
}
