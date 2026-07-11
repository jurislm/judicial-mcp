import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import axios from 'axios'

vi.mock('axios')
vi.mock('dotenv/config', () => ({}))
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    onerror: null,
  })),
}))
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}))

import { dispatchTool } from '../src/server.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TOOLS_CONFIG, TOOL_HANDLERS } from '../src/tools.js'

const mockedAxios = vi.mocked(axios, true)

type MockServerInstance = {
  setRequestHandler: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  onerror: ((error: unknown) => void) | null
}

const mockedServer = vi.mocked(Server, true)
const serverInstance = mockedServer.mock.results[0]!.value as MockServerInstance

type CallToolHandler = (request: {
  params: { name: string; arguments?: Record<string, unknown> }
}) => Promise<unknown>

function findHandler(schema: string) {
  const call = serverInstance.setRequestHandler.mock.calls.find(([s]) => s === schema)
  if (!call) {
    throw new Error(`src/server.ts 未依預期向 Server 註冊 ${schema} handler`)
  }
  return call[1] as CallToolHandler
}

// module-level side effects (Server construction, handler registration, main()) run exactly
// once when this file is first imported — capture everything derived from them now, before the
// top-level beforeEach's vi.clearAllMocks() wipes the recorded mock.calls history.
const listToolsHandler = findHandler('ListToolsRequestSchema')
const callToolHandler = findHandler('CallToolRequestSchema')
const mockedTransport = vi.mocked(StdioServerTransport, true)
const transportWasCreated = mockedTransport.mock.calls.length > 0
const connectWasCalledWithTransport = serverInstance.connect.mock.calls.length > 0

beforeEach(() => {
  vi.clearAllMocks()
  process.env.JUDICIAL_USER = 'test-user'
  process.env.JUDICIAL_PASSWORD = 'test-password'
})

afterEach(() => {
  delete process.env.JUDICIAL_USER
  delete process.env.JUDICIAL_PASSWORD
})

describe('dispatchTool', () => {
  test('未知工具名稱拋出錯誤', async () => {
    await expect(dispatchTool('nonexistent_tool', {})).rejects.toThrow('未知的工具: nonexistent_tool')
  })

  test('一般工具（非 blob）回傳以 createSuccessResponse 包裝的結果', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { token: 'abc123' } })

    const result = await dispatchTool('auth_token', {})

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ token: 'abc123' }, null, 2) }],
    })
  })

  test('download_file（blob 路徑）直接回傳 content[type=resource]，不被二次包裝', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from('binary'),
      headers: { 'content-type': 'application/zip' },
    })

    const result = await dispatchTool('download_file', { fileSetId: 'F1', token: 'tok' }) as {
      content: Array<{ type: string; resource: { uri: string; mimeType: string; blob: string } }>
    }

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('resource')
    expect(result.content[0].resource.mimeType).toBe('application/zip')
    expect(result.content[0].resource.blob).toBeDefined()
  })

  test('工具 handler 拋出例外時重新拋出（由 caller 的 catch 處理）', async () => {
    delete process.env.JUDICIAL_USER
    delete process.env.JUDICIAL_PASSWORD

    await expect(
      dispatchTool('auth_token', {}),
    ).rejects.toThrow('未提供使用者帳號或密碼')
  })
})

describe('ListTools handler（server.setRequestHandler(ListToolsRequestSchema, ...)）', () => {
  test('回傳 TOOLS_CONFIG 所有工具定義', async () => {
    const result = await listToolsHandler({ params: { name: '', arguments: {} } })

    expect(result).toEqual({ tools: Object.values(TOOLS_CONFIG) })
  })
})

describe('CallTool handler（server.setRequestHandler(CallToolRequestSchema, ...)）', () => {
  test('成功時回傳 dispatchTool 的結果', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { token: 'abc123' } })

    const result = await callToolHandler({ params: { name: 'auth_token', arguments: {} } })

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ token: 'abc123' }, null, 2) }],
    })
  })

  test('未提供 arguments 時，以空物件呼叫 dispatchTool', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { token: 'abc123' } })

    await callToolHandler({ params: { name: 'auth_token' } })

    expect(mockedAxios.post).toHaveBeenCalled()
  })

  test('dispatchTool 拋出錯誤時，記錄錯誤並回傳 createErrorResponse 包裝的結果', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await callToolHandler({ params: { name: 'nonexistent_tool', arguments: {} } }) as {
      isError?: boolean
      content: Array<{ type: string; text: string }>
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('未知的工具: nonexistent_tool')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '執行工具 nonexistent_tool 時發生錯誤:',
      '未知的工具: nonexistent_tool',
    )

    consoleErrorSpy.mockRestore()
  })

  test('handler 拋出非 Error 值時，記錄該值本身而非 .message', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const originalHandler = TOOL_HANDLERS.auth_token
    TOOL_HANDLERS.auth_token = async () => {
      throw 'boom'
    }

    const result = await callToolHandler({ params: { name: 'auth_token', arguments: {} } }) as {
      isError?: boolean
    }

    expect(result.isError).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalledWith('執行工具 auth_token 時發生錯誤:', 'boom')

    TOOL_HANDLERS.auth_token = originalHandler
    consoleErrorSpy.mockRestore()
  })
})

describe('server.onerror（協議層錯誤處理）', () => {
  test('Error 物件時記錄 error.message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    serverInstance.onerror?.(new Error('protocol failure'))

    expect(consoleErrorSpy).toHaveBeenCalledWith('MCP 協議錯誤:', 'protocol failure')
    consoleErrorSpy.mockRestore()
  })

  test('非 Error 值時直接記錄該值', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    serverInstance.onerror?.('plain string error')

    expect(consoleErrorSpy).toHaveBeenCalledWith('MCP 協議錯誤:', 'plain string error')
    consoleErrorSpy.mockRestore()
  })
})

describe('main()（伺服器啟動）', () => {
  test('建立 StdioServerTransport 並呼叫 server.connect', () => {
    expect(transportWasCreated).toBe(true)
    expect(connectWasCalledWithTransport).toBe(true)
  })
})
