#!/usr/bin/env node

/**
 * @file src/index.js
 * @description 司法院 MCP 伺服器 - 遵循 Model Context Protocol 規範
 */

const originalConsole = { ...console };
console.log = console.info = console.warn = () => {};
try {
  require('dotenv').config();
} finally {
  Object.assign(console, originalConsole);
}
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
 * 處理工具調用請求
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (!TOOL_HANDLERS[name]) {
      throw new Error(`未知的工具: ${name}`);
    }

    const result = await TOOL_HANDLERS[name](args || {});
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
