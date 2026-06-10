import { chromium, Browser } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { LawData, Article } from './types.js';
import { LAWS } from './laws.js';

const CACHE_FILE = path.join(process.cwd(), 'data', 'law_cache.json');

function parseArticles(lawName: string, url: string, text: string): Article[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const articles: Article[] = [];
  let currentChapter = '';
  let currentArticleNum = '';
  let currentContentLines: string[] = [];

  const chapterRegex = /^\s*(第\s*[一二三四五六七八九十百]+\s*[章編節折]|第\s*\d+\s*[章編節折])/;
  // Matches "第 1 條" or "一、" or "1、"
  const articleRegex = /^\s*(第\s*\d+(?:\s*[-‐－]\s*\d+)?\s*條|[一二三四五六七八九十百]+[、]|[０-９\d]+[、])\s*(.*)/;

  for (const line of lines) {
    const chapterMatch = line.match(chapterRegex);
    if (chapterMatch) {
      currentChapter = line;
      continue;
    }

    const articleMatch = line.match(articleRegex);
    if (articleMatch) {
      if (currentArticleNum) {
        articles.push({
          lawName,
          chapter: currentChapter,
          articleNum: currentArticleNum,
          content: currentContentLines.join('\n'),
          url
        });
      }
      currentArticleNum = articleMatch[1];
      currentContentLines = articleMatch[2] ? [articleMatch[2]] : [];
    } else {
      if (currentArticleNum) {
        currentContentLines.push(line);
      }
    }
  }

  if (currentArticleNum) {
    articles.push({
      lawName,
      chapter: currentChapter,
      articleNum: currentArticleNum,
      content: currentContentLines.join('\n'),
      url
    });
  }

  return articles;
}

export async function fetchLawData(forceRefresh = false): Promise<LawData> {
  if (!forceRefresh) {
    try {
      const cacheExists = await fs.access(CACHE_FILE).then(() => true).catch(() => false);
      if (cacheExists) {
        const cacheContent = await fs.readFile(CACHE_FILE, 'utf-8');
        return JSON.parse(cacheContent);
      }
    } catch (error) {
      // Proceed to fetch if cache read fails
    }
  }

  console.error('開始使用 Playwright 啟動爬蟲，這將會需要數分鐘時間...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-logging',
      '--log-level=3'
    ]
  });

  const allArticles: Article[] = [];

  try {
    for (let i = 0; i < LAWS.length; i++) {
      const law = LAWS[i];
      if (!law.url) {
        console.error(`[Scraper] 跳過無連結法規: ${law.name}`);
        continue;
      }

      console.error(`[Scraper] [${i + 1}/${LAWS.length}] 正在爬取: ${law.name} (${law.url})`);
      
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'zh-TW',
        timezoneId: 'Asia/Taipei',
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
      });

      const page = await context.newPage();
      try {
        await page.goto(law.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000); // 讓頁面有時間渲染
        
        const hasContent = await page.locator('.law-reg-content').count() > 0;
        if (hasContent) {
          const text = await page.locator('.law-reg-content').innerText();
          const parsed = parseArticles(law.name, law.url, text);
          console.error(`[Scraper] 成功解析了 ${parsed.length} 筆條文。`);
          allArticles.push(...parsed);
        } else {
          // 嘗試 fallback，取 body 的內文
          const text = await page.evaluate(() => document.body.innerText);
          const parsed = parseArticles(law.name, law.url, text);
          if (parsed.length > 0) {
            console.error(`[Scraper Warning] 未找到 .law-reg-content，但成功利用 body 內文解析出 ${parsed.length} 筆條文。`);
            allArticles.push(...parsed);
          } else {
            console.error(`[Scraper Error] 無法解析法規內容: ${law.name}`);
          }
        }
      } catch (error) {
        console.error(`[Scraper Error] 爬取 ${law.name} 發生錯誤:`, error instanceof Error ? error.message : String(error));
      } finally {
        await page.close();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const lawData: LawData = {
    lawName: '綜合建築與工程法規資料庫',
    lastUpdated: new Date().toISOString(),
    articles: allArticles
  };

  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(lawData, null, 2), 'utf-8');
  console.error(`爬蟲結束。共儲存了 ${allArticles.length} 筆條文到快取檔案中。`);

  return lawData;
}

export async function updateLawsByName(lawNamesToUpdate: string[]): Promise<LawData> {
  let cachedData: LawData = {
    lawName: '綜合建築與工程法規資料庫',
    lastUpdated: new Date().toISOString(),
    articles: []
  };

  try {
    const cacheExists = await fs.access(CACHE_FILE).then(() => true).catch(() => false);
    if (cacheExists) {
      const cacheContent = await fs.readFile(CACHE_FILE, 'utf-8');
      cachedData = JSON.parse(cacheContent);
    }
  } catch (error) {
    console.error('[Scraper Warning] 讀取快取失敗，將會建立新的資料庫快取:', error);
  }

  const targetLaws = LAWS.filter(law => lawNamesToUpdate.includes(law.name));
  if (targetLaws.length === 0) {
    console.error(`[Scraper] 沒有找到任何相符的法規以進行局部更新。`);
    return cachedData;
  }

  console.error(`開始使用 Playwright 進行局部更新，目標法規：${targetLaws.map(l => l.name).join(', ')}`);
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-logging',
      '--log-level=3'
    ]
  });

  const updatedArticlesMap = new Map<string, Article[]>();

  try {
    for (let i = 0; i < targetLaws.length; i++) {
      const law = targetLaws[i];
      if (!law.url) {
        continue;
      }

      console.error(`[Scraper] [${i + 1}/${targetLaws.length}] 正在重新爬取: ${law.name}`);
      
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'zh-TW',
        timezoneId: 'Asia/Taipei',
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
      });

      const page = await context.newPage();
      try {
        await page.goto(law.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        
        const hasContent = await page.locator('.law-reg-content').count() > 0;
        let text = '';
        if (hasContent) {
          text = await page.locator('.law-reg-content').innerText();
        } else {
          text = await page.evaluate(() => document.body.innerText);
        }

        const parsed = parseArticles(law.name, law.url, text);
        if (parsed.length > 0) {
          console.error(`[Scraper] 成功解析了 ${parsed.length} 筆條文。`);
          updatedArticlesMap.set(law.name, parsed);
        } else {
          console.error(`[Scraper Error] 無法解析法規內容: ${law.name}`);
        }
      } catch (error) {
        console.error(`[Scraper Error] 爬取 ${law.name} 發生錯誤:`, error instanceof Error ? error.message : String(error));
      } finally {
        await page.close();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Merge back
  let finalArticles = cachedData.articles;
  for (const [lawName, newArticles] of updatedArticlesMap.entries()) {
    finalArticles = finalArticles.filter(art => art.lawName !== lawName);
    finalArticles.push(...newArticles);
  }

  cachedData.articles = finalArticles;
  cachedData.lastUpdated = new Date().toISOString();

  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cachedData, null, 2), 'utf-8');
  console.error(`局部更新結束。共儲存了 ${cachedData.articles.length} 筆條文到快取中。`);

  return cachedData;
}

