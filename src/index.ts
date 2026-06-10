#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { fetchLawData } from './scraper.js';
import { searchLaw } from './search.js';
import { LawData } from './types.js';
import { InterpretationScraper } from './interpretation_scraper.js';



class BuildingCodeServer {
  private server: Server;
  private lawData: LawData | null = null;
  private interpretationScraper: InterpretationScraper;

  constructor() {
    this.interpretationScraper = new InterpretationScraper();
    this.server = new Server(
      {
        name: 'taiwan-building-code-tracker',
        version: '1.1.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupPromptHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.interpretationScraper.close();
      await this.server.close();
      process.exit(0);
    });
  }

  private setupPromptHandlers() {
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'analyze-building-case',
          description: '綜合案例適法性分析 (Comprehensive Case Analysis)',
          arguments: [
            {
              name: 'caseName',
              description: '要分析的建築案例名稱 (例：陽台外推、頂樓加蓋、載重計算)',
              required: true,
            },
          ],
        },
        {
          name: 'track-interpretations',
          description: '解釋函令深度追蹤 (Interpretation Deep Dive)',
          arguments: [
            {
              name: 'topic',
              description: '要追蹤的實務議題 (例：採光面積、違章認定)',
              required: true,
            },
          ],
        },
      ],
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === 'analyze-building-case') {
        const caseName = request.params.arguments?.caseName || '未指定案例';
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `請針對「${caseName}」進行法律與構造適法性分析。\n\n執行步驟：\n1. 請優先使用 search_building_code 工具尋找相關的「母法條文」。\n2. 接著使用 search_building_interpretations 工具尋找相關的「解釋函」或「解釋令」。\n3. 請對比條文與函釋，分析該案例在實務上的判定標準、可能的罰則或合法申請的路徑。\n4. 最後請務必列出所有引用的條文編號、解釋函號與原始官網 URL 連結供複查。`,
              },
            },
          ],
        };
      } else if (request.params.name === 'track-interpretations') {
        const topic = request.params.arguments?.topic || '未指定議題';
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `請扮演專業地政與建築法律顧問，深度追蹤「${topic}」的官方見解。\n\n執行步驟：\n1. 使用 search_building_interpretations 工具檢索至少 5 筆相關函釋。\n2. 依照「發文日期」由新到舊排列。\n3. 重點分析：該議題在實務執行上的核心爭議點、近年來官方見解是否有變更、以及引用之函號與原文網址。`,
              },
            },
          ],
        };
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${request.params.name}`);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_building_code',
          description: "Search for official law articles in the 'Taiwan Building Code - Construction Works' (建築技術規則建築構造編). [IMPORTANT] The search 'query' MUST be in Traditional Chinese. Extract 1-3 core nouns from the conversation (e.g., '活載重', '地震力', '基礎構造') and use them as the query. Do not use long sentences.",
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search keyword in Traditional Chinese.',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default 10).',
                default: 10,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'search_building_interpretations',
          description: "Search for official interpretations (解釋函) and administrative orders (解釋令) from the Taiwan National Land Management Agency (內政部國土管理署). [IMPORTANT] Use this tool whenever the user mentions '解釋函' or '解釋令'. The search 'query' MUST be in Traditional Chinese (e.g., '採光', '違章建築', '防火避難'). Use 1-2 core nouns from the conversation. This tool returns document numbers and official URLs; you MUST provide these URLs to the user for verification.",
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search keyword in Traditional Chinese.',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default 5).',
                default: 5,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'refresh_data',
          description: 'Forcefully re-fetch the latest law articles from the official database and update the local cache.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },

      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (request.params.name === 'search_building_code') {
          const { query, limit = 10 } = z
            .object({
              query: z.string().min(1, '搜尋關鍵字不能為空').max(100, '關鍵字過長，上限 100 字'),
              limit: z.number().min(1).max(50).optional(),
            })
            .parse(request.params.arguments);

          if (!this.lawData) {
            this.lawData = await fetchLawData();
          }

          const results = searchLaw(this.lawData.articles, query, limit);

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: `找不到與「${query}」相關的條文。` }],
            };
          }

          const formattedResults = results
            .map((r) => `【${r.lawName} / ${r.chapter} / ${r.articleNum}】\n\n${r.content}${r.url ? `\n來源網址: ${r.url}` : ''}\n\n---`)
            .join('\n\n');

          return {
            content: [{ type: 'text', text: `搜尋到 ${results.length} 筆結果：\n\n${formattedResults}` }],
          };
        } else if (request.params.name === 'search_building_interpretations') {
          const { query, limit = 5 } = z
            .object({
              query: z.string().min(1, '搜尋關鍵字不能為空'),
              limit: z.number().min(1).max(20).optional(),
            })
            .parse(request.params.arguments);

          const results = await this.interpretationScraper.search(query, limit);

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: `找不到與「${query}」相關的解釋函。` }],
            };
          }

          const formattedResults = results
            .map((r) => 
              `【標題：${r.title}】\n發文日期：${r.date}\n函號：${r.docNo}\n摘要：${r.summary}...\n網址：${r.url}\n\n---`
            )
            .join('\n\n');

          return {
            content: [{ 
              type: 'text', 
              text: `搜尋到 ${results.length} 筆解釋函結果（來源：內政部國土管理署）：\n\n${formattedResults}` 
            }],
          };
        } else if (request.params.name === 'refresh_data') {
          this.lawData = await fetchLawData(true);
          return {
            content: [{ type: 'text', text: '法規資料已成功更新。' }],
          };

        } else {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return {
            content: [{ type: 'text', text: `參數錯誤: ${error.issues.map((i) => i.message).join(', ')}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: `發生錯誤: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Taiwan Building Code Tracker MCP server running on stdio');
  }
}

const server = new BuildingCodeServer();
server.run().catch(console.error);
