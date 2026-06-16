import { chromium } from 'playwright';
import { LAWS } from './laws.js';
import { updateLawsByName } from './scraper.js';
import { syncToObsidian } from './sync_obsidian.js';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const ANNOUNCEMENT_PAGES = [
  {
    name: '內政部主管法規共用系統最新公告',
    url: 'https://glrs.moi.gov.tw/index.aspx?&size=40',
    selector: '#tbdy a'
  },
  {
    name: '經濟部主管法規共用系統最新公告',
    url: 'https://law.moea.gov.tw/?size=40',
    selector: '#tbdy a'
  },
  {
    name: '財政部主管法規共用系統最新公告',
    url: 'https://law-out.mof.gov.tw/?size=40',
    selector: '#tbdy a'
  },
  {
    name: '環境部主管法規共用系統最新公告',
    url: 'https://oaout.moenv.gov.tw/law/?size=40',
    selector: '#tbdy a'
  },
  {
    name: '文化部主管法規共用系統最新公告',
    url: 'https://law.moc.gov.tw/?size=40',
    selector: '#tbdy a'
  },
  {
    name: '工程會主管法規共用系統最新公告',
    url: 'https://lawweb.pcc.gov.tw/?size=40',
    selector: '#tbdy a'
  },
  {
    name: '國發會主管法規共用系統最新公告',
    url: 'https://theme.ndc.gov.tw/lawout/?size=40',
    selector: '#tbdy a'
  },
  {
    name: '勞動部勞動法令查詢系統最新公告',
    url: 'https://laws.mol.gov.tw/index.aspx',
    selector: 'table.news-table a'
  }
];

async function checkAndConditionalUpdate() {
  console.log('[Check Update] 正在啟動公告檢查器...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-logging',
      '--log-level=3'
    ]
  });

  const matchedLawsMap = new Map<string, { announcementTitle: string; url: string; portal: string }>();

  // Load processed announcements
  const PROCESSED_FILE = path.join(process.cwd(), 'data', 'processed_announcements.json');
  let processedUrls: string[] = [];
  try {
    const content = await fs.readFile(PROCESSED_FILE, 'utf-8');
    processedUrls = JSON.parse(content);
  } catch (err) {
    // Start empty if file doesn't exist
  }

  try {
    // Perform portal checks concurrently using Promise.all
    await Promise.all(ANNOUNCEMENT_PAGES.map(async (portal) => {
      console.log(`[Check Update] 正在讀取 ${portal.name}: ${portal.url}`);
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
        await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Get all announcement links in the table body using the custom selector
        const announcements = await page.evaluate((sel) => {
          const results: { text: string; href: string }[] = [];
          const anchors = document.querySelectorAll(sel);
          for (const a of anchors) {
            const text = (a as HTMLElement).innerText.trim();
            const href = (a as HTMLAnchorElement).href;
            if (text && href && !href.startsWith('javascript:')) {
              results.push({ text, href });
            }
          }
          return results;
        }, portal.selector);

        console.log(`[Check Update] ${portal.name} 成功讀取到 ${announcements.length} 筆最新公告。`);

        // Compare with our tracked laws list
        for (const ann of announcements) {
          // Skip if this announcement has already been processed
          if (processedUrls.includes(ann.href)) {
            continue;
          }
          for (const law of LAWS) {
            if (ann.text.includes(law.name)) {
              if (!matchedLawsMap.has(law.name)) {
                matchedLawsMap.set(law.name, {
                  announcementTitle: ann.text,
                  url: ann.href,
                  portal: portal.name
                });
              }
            }
          }
        }
      } catch (err) {
        console.error(`[Check Update Error] 讀取門戶網站 ${portal.name} 時發生錯誤:`, err instanceof Error ? err.message : String(err));
      } finally {
        await page.close();
        await context.close();
      }
    }));

    if (matchedLawsMap.size === 0) {
      console.log('[Check Update] 比對完成。沒有發現任何我們所追蹤之法規的更新公告。快取無須更新。');
      return;
    }

    console.log(`[Check Update] ⚠️ 發現有 ${matchedLawsMap.size} 個追蹤法規有新公告！`);
    const matchedLawNames: string[] = [];
    for (const [lawName, info] of matchedLawsMap.entries()) {
      console.log(`- 【${lawName}】來源：${info.portal} | 公告：${info.announcementTitle} (${info.url})`);
      matchedLawNames.push(lawName);
    }

    // Run the specific scrapers for these laws
    console.log('[Check Update] 啟動局部爬蟲更新受影響的法規...');
    const { updatedCache, diffs } = await updateLawsByName(matchedLawNames);
    console.log('[Check Update] 局部更新完成。');

    if (diffs.length === 0) {
      console.log('[Check Update] 雖然政府有新公告，但條文實質內容未變。更新 processedUrls 後結束，不彈出通知。');
      for (const info of matchedLawsMap.values()) {
        if (!processedUrls.includes(info.url)) {
          processedUrls.push(info.url);
        }
      }
      if (processedUrls.length > 500) {
        processedUrls = processedUrls.slice(processedUrls.length - 500);
      }
      await fs.mkdir(path.dirname(PROCESSED_FILE), { recursive: true });
      await fs.writeFile(PROCESSED_FILE, JSON.stringify(processedUrls, null, 2), 'utf-8');
      return;
    }

    // Since we have actual diffs, only sync the ones that actually changed
    const actuallyChangedLawNames = diffs.map(d => d.lawName);

    // Run Obsidian sync to ensure the markdown files are updated (incremental sync)
    console.log('[Check Update] 正在同步變更至 Obsidian...');
    await syncToObsidian(undefined, actuallyChangedLawNames);

    // Map updated info including date and docNo
    const matchedLawsInfo = new Map<string, { announcementTitle: string; url: string; portal: string; date?: string; docNo?: string }>();
    for (const [lawName, info] of matchedLawsMap.entries()) {
      if (actuallyChangedLawNames.includes(lawName)) {
        const art = updatedCache.articles.find(a => a.lawName === lawName);
        matchedLawsInfo.set(lawName, {
          ...info,
          date: art?.date,
          docNo: art?.docNo
        });
      }
    }

    // Generate 變更明細.md
    console.log('[Check Update] 正在生成變更明細...');
    const localVaultPath = 'H:\\Obsidian資料庫\\Secondbrain';
    const changelogName = '變更明細.md';
    const checkDateStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    
    let changelogMd = `# 臺灣法規更新變更明細\n\n`;
    changelogMd += `更新時間：${checkDateStr}\n\n`;
    changelogMd += `本機排程已於今日自動完成以下法規的爬取更新與 Obsidian 同步：\n\n`;
    changelogMd += `| 異動法規 | 發布/修正日期 | 來源門戶 | 公告內容 | 公告連結 |\n`;
    changelogMd += `| --- | --- | --- | --- | --- |\n`;
    
    for (const [lawName, info] of matchedLawsInfo.entries()) {
      const displayDate = info.date || '未知';
      changelogMd += `| **${lawName}** | ${displayDate} | ${info.portal} | ${info.announcementTitle} | [連結](${info.url}) |\n`;
    }
    
    changelogMd += `\n## 條文變更詳情\n\n`;
    for (const diff of diffs) {
      changelogMd += `### ${diff.lawName}\n\n`;
      for (const change of diff.changes) {
        if (change.isNew) {
          changelogMd += `#### ${change.articleNum} (新增)\n\n**新內容：**\n\`\`\`text\n${change.newContent}\n\`\`\`\n\n`;
        } else {
          changelogMd += `#### ${change.articleNum} (修改)\n\n**舊內容：**\n\`\`\`text\n${change.oldContent}\n\`\`\`\n\n**新內容：**\n\`\`\`text\n${change.newContent}\n\`\`\`\n\n`;
        }
      }
    }

    changelogMd += `\n請前往您的 Obsidian 知識庫的 \`臺灣法規\` 目錄查看最新同步的條文筆記。\n`;
    
    // Save to Obsidian vault's 臺灣法規 directory
    const obsidianChangelogPath = path.join(localVaultPath, '臺灣法規', changelogName);
    try {
      await fs.writeFile(obsidianChangelogPath, changelogMd, 'utf-8');
      console.log(`[Check Update] 變更明細已寫入至 Obsidian 臺灣法規目錄: ${obsidianChangelogPath}`);
    } catch (err) {
      console.error(`[Check Update Error] 無法寫入變更明細至 Obsidian 臺灣法規目錄:`, err instanceof Error ? err.message : String(err));
    }
    
    // Save processed URLs so we don't repeat them next time
    for (const info of matchedLawsMap.values()) {
      if (!processedUrls.includes(info.url)) {
        processedUrls.push(info.url);
      }
    }
    if (processedUrls.length > 500) {
      processedUrls = processedUrls.slice(processedUrls.length - 500);
    }
    await fs.mkdir(path.dirname(PROCESSED_FILE), { recursive: true });
    await fs.writeFile(PROCESSED_FILE, JSON.stringify(processedUrls, null, 2), 'utf-8');
    console.log(`[Check Update] 已處理公告清單已更新並存入: ${PROCESSED_FILE}`);

    // Trigger Windows popup MessageBox via PowerShell
    console.log('[Check Update] 觸發 Windows 系統彈出提示視窗...');
    
    let lawDetailsStr = '';
    for (const diff of diffs) {
      const info = matchedLawsInfo.get(diff.lawName);
      const dateStr = info?.date ? ` (日期：${info.date})` : '';
      const changedArts = diff.changes.map(c => c.articleNum).join(', ');
      
      // Extract a short snippet from the first changed article
      const firstChange = diff.changes[0];
      const snippet = firstChange.newContent.length > 100 
        ? firstChange.newContent.substring(0, 100).replace(/\n/g, ' ') + '...'
        : firstChange.newContent.replace(/\n/g, ' ');

      lawDetailsStr += `✅ 【${diff.lawName}】${dateStr}\\n異動條文：${changedArts}\\n內容摘要：${snippet}\\n\\n`;
    }

    const popupMsg = `【台灣建築法規更新通知】\\n\\n發現有 ${diffs.length} 個法規發生實質內容異動：\\n\\n${lawDetailsStr}完整的新舊比對細節已寫入 Obsidian 的『變更明細.md』，請前往查看。`;
    const safePopupMsg = popupMsg.replace(/'/g, "''"); // escape single quotes for PowerShell
    const popupTitle = '台灣建築法規自動更新通知';
    
    const psCommand = `powershell -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('${safePopupMsg}'.Replace('\\n', [Environment]::NewLine), '${popupTitle}', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)"`;
    
    exec(psCommand, (error) => {
      if (error) {
        console.error('[Check Update Error] 無法彈出 Windows 提示視窗:', error);
      } else {
        console.log('[Check Update] Windows 提示視窗彈出成功。');
      }
    });

  } catch (error) {
    console.error('[Check Update Error] 執行檢查更新時發生錯誤:', error);
  } finally {
    await browser.close();
  }
}

checkAndConditionalUpdate().catch(console.error);
