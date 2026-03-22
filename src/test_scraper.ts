import { InterpretationScraper } from './interpretation_scraper.js';

async function test() {
  const scraper = new InterpretationScraper();
  console.log('正在初始化瀏覽器並搜尋「採光」...');
  
  const results = await scraper.search('採光', 3);
  
  if (results.length === 0) {
    console.log('搜尋不到任何結果，可能選取器 (Selectors) 需要調整。');
  } else {
    console.log(`搜尋到 ${results.length} 筆結果：`);
    for (const r of results) {
      console.log('---');
      console.log(`標題: ${r.title}`);
      console.log(`文號: ${r.docNo}`);
      console.log(`網址: ${r.url}`);
      
      console.log('正在抓取詳細內容...');
      const detail = await scraper.getDetail(r.url);
      console.log(`內容摘要: ${detail.substring(0, 100)}...`);
    }
  }
  
  await scraper.close();
}

test().catch(console.error);
