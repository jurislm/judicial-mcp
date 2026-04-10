#!/usr/bin/env node

/**
 * @file src/index.js
 * @description 司法院 MCP 伺服器 - 遵循 Model Context Protocol 規範
 */

// MCP 使用 stdio transport，stdout 必須保持乾淨（僅 JSON-RPC 訊息）
// 將 console.log/info/warn 重定向到 stderr，永久生效
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(' ') + '\n');
require('dotenv').config();
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { TOOLS_CONFIG, TOOL_HANDLERS } = require('./tools.js');
const { createSuccessResponse, createErrorResponse } = require('./response.js');
const { version } = require('../package.json');

/**
 * MCP 伺服器實例
 */
const server = new Server(
  {
    name: 'judicial-mcp',
    version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * 列出所有可用的工具
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.values(TOOLS_CONFIG),
  };
});

/**
 * 協議層錯誤處理（server.onerror — MCP 規範要求）
 */
server.onerror = (error) => {
  console.error('MCP 協議錯誤:', error?.message || error);
};

/**
 * 處理工具調用請求
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (!TOOL_HANDLERS[name]) {
      throw new Error(`未知的工具: ${name}`);
    }

    const result = await TOOL_HANDLERS[name](args || {});

    // download_file 直接回傳 MCP 格式的 resource response，其餘 handler 回傳原始資料
    if (result?.content && Array.isArray(result.content)) {
      return result;
    }
    return createSuccessResponse(result);
  } catch (error) {
    console.error(`執行工具 ${name} 時發生錯誤:`, error?.message);
    return createErrorResponse(error, `執行工具 ${name} 時發生錯誤`);
  }
});

/**
 * 啟動 MCP 伺服器
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('伺服器啟動失敗:', error);
  process.exit(1);
});
