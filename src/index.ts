#!/usr/bin/env node

// MCP 使用 stdio transport，stdout 只能輸出 JSON-RPC 訊息
console.log = console.info = console.warn = (...args: unknown[]) =>
  process.stderr.write(args.join(' ') + '\n')

import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { TOOLS_CONFIG, TOOL_HANDLERS } from './tools.js'
import { createSuccessResponse, createErrorResponse } from './response.js'
import { createRequire } from 'module'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const server = new Server(
  { name: 'judicial-mcp', version },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(TOOLS_CONFIG),
}))

server.onerror = (error: unknown) => {
  console.error('MCP 協議錯誤:', error instanceof Error ? error.message : error)
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (!TOOL_HANDLERS[name]) {
      throw new Error(`未知的工具: ${name}`)
    }

    const result = await TOOL_HANDLERS[name](
      (args ?? {}) as Record<string, unknown>,
    )

    if (
      result !== null &&
      typeof result === 'object' &&
      'content' in result &&
      Array.isArray((result as { content: unknown }).content)
    ) {
      return result
    }
    return createSuccessResponse(result)
  } catch (error: unknown) {
    console.error(`執行工具 ${name} 時發生錯誤:`, error instanceof Error ? error.message : error)
    return createErrorResponse(error, `執行工具 ${name} 時發生錯誤`)
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error: unknown) => {
  console.error('伺服器啟動失敗:', error)
  process.exit(1)
})
