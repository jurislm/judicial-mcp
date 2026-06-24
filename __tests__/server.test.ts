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

const mockedAxios = vi.mocked(axios, true)

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
