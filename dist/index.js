#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const scraper_js_1 = require("./scraper.js");
const search_js_1 = require("./search.js");
class BuildingCodeServer {
    server;
    lawData = null;
    constructor() {
        this.server = new index_js_1.Server({
            name: 'taiwan-building-code-tracker',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'search_building_code',
                    description: '搜尋建築技術規則建築構造編條文 (Taiwan Building Code - Construction Works)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: '搜尋關鍵字 (例如: 活載重, 地震力, 基礎構造)',
                            },
                            limit: {
                                type: 'number',
                                description: '回傳結果數量上限 (預設 10)',
                                default: 10,
                            },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'refresh_data',
                    description: '重新從全國法規資料庫抓取最新法規資料',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
            ],
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            try {
                if (request.params.name === 'search_building_code') {
                    const { query, limit = 10 } = zod_1.z
                        .object({
                        query: zod_1.z.string().min(1, '搜尋關鍵字不能為空').max(100, '關鍵字過長，上限 100 字'),
                        limit: zod_1.z.number().min(1).max(50).optional(),
                    })
                        .parse(request.params.arguments);
                    if (!this.lawData) {
                        this.lawData = await (0, scraper_js_1.fetchLawData)();
                    }
                    const results = (0, search_js_1.searchLaw)(this.lawData.articles, query, limit);
                    if (results.length === 0) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `找不到與「${query}」相關的條文。`,
                                },
                            ],
                        };
                    }
                    const formattedResults = results
                        .map((r) => `【${r.chapter} / ${r.articleNum}】\n\n${r.content}\n\n---`)
                        .join('\n\n');
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `搜尋到 ${results.length} 筆結果：\n\n${formattedResults}`,
                            },
                        ],
                    };
                }
                else if (request.params.name === 'refresh_data') {
                    this.lawData = await (0, scraper_js_1.fetchLawData)(true);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: '法規資料已成功更新。',
                            },
                        ],
                    };
                }
                else {
                    throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }
            }
            catch (error) {
                if (error instanceof zod_1.z.ZodError) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `參數錯誤: ${error.issues.map((i) => i.message).join(', ')}`,
                            },
                        ],
                        isError: true,
                    };
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `發生錯誤: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('Taiwan Building Code Tracker MCP server running on stdio');
    }
}
const server = new BuildingCodeServer();
server.run().catch(console.error);
