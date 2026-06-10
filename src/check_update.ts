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

  try {
    for (const portal of ANNOUNCEMENT_PAGES) {
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
    }

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
    await updateLawsByName(matchedLawNames);
    console.log('[Check Update] 局部更新完成。');

    // Run Obsidian sync to ensure the markdown files are updated
    console.log('[Check Update] 正在同步變更至 Obsidian...');
    await syncToObsidian();

    // Generate 變更明細.md
    console.log('[Check Update] 正在生成變更明細...');
    const localVaultPath = 'H:\\Obsidian資料庫\\Secondbrain';
    const changelogName = '變更明細.md';
    const checkDateStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    
    let changelogMd = `# 臺灣法規更新變更明細\n\n`;
    changelogMd += `更新時間：${checkDateStr}\n\n`;
    changelogMd += `本機排程已於今日自動完成以下法規的爬取更新與 Obsidian 同步：\n\n`;
    changelogMd += `| 異動法規 | 來源門戶 | 公告內容 | 公告連結 |\n`;
    changelogMd += `| --- | --- | --- | --- |\n`;
    
    for (const [lawName, info] of matchedLawsMap.entries()) {
      changelogMd += `| **${lawName}** | ${info.portal} | ${info.announcementTitle} | [連結](${info.url}) |\n`;
    }
    
    changelogMd += `\n請前往您的 Obsidian 知識庫的 \`臺灣法規\` 目錄查看最新同步的條文筆記。\n`;
    
    // Save to project root
    const projectChangelogPath = path.join(process.cwd(), changelogName);
    await fs.writeFile(projectChangelogPath, changelogMd, 'utf-8');
    console.log(`[Check Update] 變更明細已寫入至專案根目錄: ${projectChangelogPath}`);
    
    // Save to Obsidian vault root
    const obsidianChangelogPath = path.join(localVaultPath, changelogName);
    try {
      await fs.writeFile(obsidianChangelogPath, changelogMd, 'utf-8');
      console.log(`[Check Update] 變更明細已寫入至 Obsidian 根目錄: ${obsidianChangelogPath}`);
    } catch (err) {
      console.error(`[Check Update Error] 無法寫入變更明細至 Obsidian 根目錄:`, err instanceof Error ? err.message : String(err));
    }
    
    // Trigger Windows popup MessageBox via PowerShell
    console.log('[Check Update] 觸發 Windows 系統彈出提示視窗...');
    const popupMsg = `【台灣建築法規更新通知】\\n\\n法規資料庫已於今日完成自動檢查與更新！\\n\\n發現有 ${matchedLawsMap.size} 個法規發生異動，已為您同步至 Obsidian 筆記中。\\n\\n詳細更新內容已寫入至『變更明細.md』，請點選確定後前往查看。`;
    const popupTitle = '台灣建築法規自動更新通知';
    
    const psCommand = `powershell -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('${popupMsg}', '${popupTitle}', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)"`;
    
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
