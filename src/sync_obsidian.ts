import fs from 'fs/promises';
import path from 'path';
import { LAWS } from './laws.js';
import { LawData, Article } from './types.js';

const CACHE_FILE = path.join(process.cwd(), 'data', 'law_cache.json');
const DEFAULT_VAULT_PATH = 'H:\\Obsidian資料庫\\Secondbrain';
const TARGET_SUBDIR = '臺灣法規';

export async function syncToObsidian(customVaultPath?: string, targetLawNames?: string[]) {
  console.log('[Obsidian Sync] 正在啟動同步程序...');

  // 1. Read the cache file
  let lawData: LawData;
  try {
    const content = await fs.readFile(CACHE_FILE, 'utf-8');
    lawData = JSON.parse(content);
  } catch (error) {
    console.error(`[Obsidian Sync Error] 無法讀取快取檔案 ${CACHE_FILE}。請先執行爬蟲更新資料。`, error);
    return;
  }

  const articles = lawData.articles;
  if (!articles || articles.length === 0) {
    console.log('[Obsidian Sync] 快取庫中沒有任何條文，同步取消。');
    return;
  }

  // 2. Group articles by law name
  const lawMap = new Map<string, Article[]>();
  for (const art of articles) {
    if (!lawMap.has(art.lawName)) {
      lawMap.set(art.lawName, []);
    }
    lawMap.get(art.lawName)!.push(art);
  }

  console.log(`[Obsidian Sync] 快取庫中共有 ${lawMap.size} 部法規，準備匯出至 Obsidian...`);

  // Create base directories
  const vaultPath = customVaultPath || process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT_PATH;
  const syncDestPath = path.join(vaultPath, TARGET_SUBDIR);
  await fs.mkdir(syncDestPath, { recursive: true });

  let fileCount = 0;

  for (const [lawName, lawArticles] of lawMap.entries()) {
    if (targetLawNames && !targetLawNames.includes(lawName)) {
      continue;
    }
    // Look up metadata (authority and original URL) from LAWS
    const metadata = LAWS.find(l => l.name === lawName);
    const authority = metadata?.authority || '其他';
    const originalUrl = metadata?.url || '';

    // Get crawled date and docNo from the first article, fallback to laws.ts
    const firstArticle = lawArticles[0];
    const lawDate = firstArticle?.date || metadata?.date || '';
    const lawDocNo = firstArticle?.docNo || metadata?.docNo || '';

    // Create authority folder
    const authorityDir = path.join(syncDestPath, authority);
    await fs.mkdir(authorityDir, { recursive: true });

    // Build markdown content
    let mdContent = '---\n';
    mdContent += 'tags:\n';
    mdContent += '  - 法規\n';
    mdContent += `  - ${authority}\n`;
    mdContent += `lawName: "${lawName}"\n`;
    mdContent += `authority: "${authority}"\n`;
    if (originalUrl) {
      mdContent += `url: "${originalUrl}"\n`;
    }
    if (lawDate) {
      mdContent += `date: "${lawDate}"\n`;
    }
    if (lawDocNo) {
      mdContent += `docNo: "${lawDocNo}"\n`;
    }
    mdContent += `last_updated: "${lawData.lastUpdated}"\n`;
    mdContent += `sync_time: "${new Date().toISOString()}"\n`;
    mdContent += '---\n\n';

    mdContent += `# ${lawName}\n\n`;
    mdContent += `> [!NOTE] 法規基本資訊\n`;
    mdContent += `> * **主管機關**：${authority}\n`;
    if (lawDate) {
      mdContent += `> * **發布/修正日期**：${lawDate}\n`;
    }
    if (lawDocNo) {
      mdContent += `> * **發文字號**：${lawDocNo}\n`;
    }
    if (originalUrl) {
      mdContent += `> * **官方來源**：[全國法規資料庫/主管系統連結](${originalUrl})\n`;
    }
    mdContent += `> * **快取更新日期**：${new Date(lawData.lastUpdated).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\n\n`;
    mdContent += `---\n\n`;
    mdContent += `## 條文內容\n\n`;

    let currentChapter = '';
    for (const art of lawArticles) {
      // If the article belongs to a new chapter, output the chapter heading
      if (art.chapter && art.chapter !== currentChapter) {
        currentChapter = art.chapter;
        mdContent += `## ${currentChapter}\n\n`;
      }

      // Format article heading and content
      mdContent += `### ${art.articleNum}\n`;
      mdContent += `${art.content}\n\n`;
    }

    // Write file
    // Clean filename (replace invalid characters if any, though law names should be safe)
    const cleanFileName = lawName.replace(/[\\/:*?"<>|]/g, '_') + '.md';
    const filePath = path.join(authorityDir, cleanFileName);

    await fs.writeFile(filePath, mdContent, 'utf-8');
    fileCount++;
  }

  console.log(`[Obsidian Sync] 同步完成！共匯出 ${fileCount} 個 Markdown 檔案至 ${syncDestPath}`);
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('sync_obsidian.js') ||
  process.argv[1].endsWith('sync_obsidian.ts')
);

if (isDirectRun) {
  syncToObsidian().catch(console.error);
}
