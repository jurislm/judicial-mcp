import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { TOOLS_CONFIG, TOOL_HANDLERS } from './tools.js'
import { createSuccessResponse, createErrorResponse, type McpToolResult } from './response.js'
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

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const handler = Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name)
    ? TOOL_HANDLERS[name]
    : undefined
  if (!handler) {
    throw new Error(`未知的工具: ${name}`)
  }

  const result = await handler(args)

  if (
    result !== null &&
    typeof result === 'object' &&
    'content' in result &&
    Array.isArray((result as { content: unknown }).content) &&
    (result as { content: Array<{ type?: string }> }).content[0]?.type === 'resource'
  ) {
    return result as McpToolResult
  }
  return createSuccessResponse(result)
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    return await dispatchTool(name, (args ?? {}) as Record<string, unknown>)
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
