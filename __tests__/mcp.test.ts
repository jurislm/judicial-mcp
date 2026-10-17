import { describe, test, expect, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Writable } from 'node:stream'
import { TOOLS_CONFIG, TOOL_HANDLERS } from '../src/tools.js'

vi.mock('axios')

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readResponse(
  lines: AsyncIterator<string>,
  id: number,
  stderr: () => string,
): Promise<Record<string, unknown>> {
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const next = await Promise.race([
      lines.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`MCP response ${id} timed out: ${stderr()}`)), 10_000)
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer)
    })
    if (next.done) throw new Error(`MCP server closed before response ${id}: ${stderr()}`)
    const parsed: unknown = JSON.parse(next.value)
    if (isRecord(parsed) && parsed.id === id) return parsed
  }
}

function sendMessage(
  input: Writable,
  message: Record<string, unknown>,
): void {
  input.write(`${JSON.stringify(message)}\n`)
}

describe('MCP 伺服器測試', () => {
  test('stdio 啟動、列出 token-free 工具並安全處理公開工具驗證錯誤', async () => {
    const child = spawn('bun', ['src/index.ts'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const lines = createInterface({ input: child.stdout })
    const iterator = lines[Symbol.asyncIterator]()
    let stderrText = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrText = `${stderrText}${chunk}`.slice(-2_000)
    })

    try {
      sendMessage(child.stdin, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'judicial-mcp-contract-test', version: '1.0.0' },
        },
      })
      const initialized = await readResponse(iterator, 1, () => stderrText)
      expect(isRecord(initialized.result)).toBe(true)

      sendMessage(child.stdin, { jsonrpc: '2.0', method: 'notifications/initialized' })
      sendMessage(child.stdin, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const listed = await readResponse(iterator, 2, () => stderrText)
      const listResult = listed.result
      expect(isRecord(listResult)).toBe(true)
      if (!isRecord(listResult) || !Array.isArray(listResult.tools)) {
        throw new Error(`Invalid tools/list response: ${JSON.stringify(listed)}`)
      }
      const tools = listResult.tools.filter(isRecord)
      const searchTool = tools.find(tool => tool.name === 'search_judgments')
      const fetchTool = tools.find(tool => tool.name === 'fetch_judgment_text')
      const regulationTool = tools.find(tool => tool.name === 'query_regulation')
      expect(searchTool).toBeDefined()
      expect(fetchTool).toBeDefined()
      expect(regulationTool).toBeDefined()
      if (!isRecord(searchTool?.inputSchema) || !isRecord(fetchTool?.inputSchema) || !isRecord(regulationTool?.inputSchema)) {
        throw new Error('New MCP tools did not expose object input schemas')
      }
      expect(isRecord(searchTool.inputSchema.properties)).toBe(true)
      expect(isRecord(fetchTool.inputSchema.properties)).toBe(true)
      expect(isRecord(regulationTool.inputSchema.properties)).toBe(true)
      if (!isRecord(searchTool.inputSchema.properties) || !isRecord(fetchTool.inputSchema.properties) || !isRecord(regulationTool.inputSchema.properties)) {
        throw new Error('New MCP tools did not expose input properties')
      }
      expect(searchTool.inputSchema.properties).not.toHaveProperty('token')
      expect(fetchTool.inputSchema.properties).not.toHaveProperty('token')
      expect(regulationTool.inputSchema.properties).not.toHaveProperty('token')
      expect(regulationTool.inputSchema.required).toEqual(['lawName', 'articleNumber'])

      sendMessage(child.stdin, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_judgments', arguments: {} },
      })
      const called = await readResponse(iterator, 3, () => stderrText)
      expect(isRecord(called.result)).toBe(true)
      if (!isRecord(called.result)) throw new Error(`Invalid tools/call response: ${JSON.stringify(called)}`)
      expect(called.result.isError).toBe(true)
      expect(called.result.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('至少需要提供 keyword') }),
      ])

      sendMessage(child.stdin, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'query_regulation', arguments: { lawName: '民法', articleNumber: '第一條' } },
      })
      const regulationCall = await readResponse(iterator, 4, () => stderrText)
      expect(isRecord(regulationCall.result)).toBe(true)
      if (!isRecord(regulationCall.result)) throw new Error(`Invalid tools/call response: ${JSON.stringify(regulationCall)}`)
      expect(regulationCall.result.isError).toBe(true)
      expect(regulationCall.result.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('articleNumber 必須使用阿拉伯數字') }),
      ])
    } finally {
      lines.close()
      child.kill('SIGTERM')
    }
  }, 20_000)

  describe('工具配置', () => {
    test('所有工具都有必要的屬性', () => {
      const tools = Object.values(TOOLS_CONFIG)

      tools.forEach(tool => {
        expect(tool).toHaveProperty('name')
        expect(tool).toHaveProperty('description')
        expect(tool).toHaveProperty('inputSchema')
        expect(tool.inputSchema).toHaveProperty('type')
        expect(tool.inputSchema.type).toBe('object')
      })
    })

    test('工具名稱唯一性', () => {
      const tools = Object.values(TOOLS_CONFIG)
      const names = tools.map(tool => tool.name)
      const uniqueNames = [...new Set(names)]

      expect(names.length).toBe(uniqueNames.length)
    })

    test('所有工具都有對應的處理器', () => {
      const toolNames = Object.keys(TOOLS_CONFIG)
      const handlerNames = Object.keys(TOOL_HANDLERS)

      expect(toolNames.sort()).toEqual(handlerNames.sort())
    })

    test('所有工具都禁止額外屬性', () => {
      const tools = Object.values(TOOLS_CONFIG)

      tools.forEach(tool => {
        expect(tool.inputSchema.additionalProperties).toBe(false)
      })
    })
  })

  describe('工具處理器', () => {
    test('list_categories 處理器存在', () => {
      expect(TOOL_HANDLERS.list_categories).toBeDefined()
      expect(typeof TOOL_HANDLERS.list_categories).toBe('function')
    })

    test('auth_token 處理器參數驗證', async () => {
      const originalUser = process.env.JUDICIAL_USER
      const originalPassword = process.env.JUDICIAL_PASSWORD

      delete process.env.JUDICIAL_USER
      delete process.env.JUDICIAL_PASSWORD

      await expect(TOOL_HANDLERS.auth_token({})).rejects.toThrow('未提供使用者帳號或密碼')

      if (originalUser) process.env.JUDICIAL_USER = originalUser
      if (originalPassword) process.env.JUDICIAL_PASSWORD = originalPassword
    })
  })

  describe('工具配置驗證', () => {
    test('auth_token 工具配置正確 — 不暴露帳密欄位', () => {
      const tool = TOOLS_CONFIG.auth_token

      expect(tool.name).toBe('auth_token')
      expect(tool.inputSchema.properties).not.toHaveProperty('user')
      expect(tool.inputSchema.properties).not.toHaveProperty('password')
    })

    test('list_judgments 工具配置正確', () => {
      const tool = TOOLS_CONFIG.list_judgments

      expect(tool.name).toBe('list_judgments')
      expect(tool.inputSchema.properties).toHaveProperty('token')
      expect(tool.inputSchema.required).toContain('token')
    })

    test('get_judgment 工具配置正確', () => {
      const tool = TOOLS_CONFIG.get_judgment

      expect(tool.name).toBe('get_judgment')
      expect(tool.inputSchema.properties).toHaveProperty('token')
      expect(tool.inputSchema.properties).toHaveProperty('jid')
      expect(tool.inputSchema.required).toContain('token')
      expect(tool.inputSchema.required).toContain('jid')
    })

    test('download_file 工具配置正確', () => {
      const tool = TOOLS_CONFIG.download_file

      expect(tool.name).toBe('download_file')
      expect(tool.inputSchema.properties).toHaveProperty('fileSetId')
      expect(tool.inputSchema.properties).toHaveProperty('top')
      expect(tool.inputSchema.properties).toHaveProperty('skip')
      expect(tool.inputSchema.properties).toHaveProperty('token')
      expect(tool.inputSchema.required).toEqual(['fileSetId', 'token'])
      expect(tool.inputSchema.properties.top.type).toBe('integer')
      expect(tool.inputSchema.properties.skip.type).toBe('integer')
    })

    test('list_categories 工具配置正確', () => {
      const tool = TOOLS_CONFIG.list_categories

      expect(tool.name).toBe('list_categories')
      expect(tool.inputSchema.properties).toEqual({
        token: { type: 'string', description: '從 member_token 工具取得的會員授權 Token' },
      })
      expect(tool.inputSchema.required).toEqual(['token'])
      expect(tool.inputSchema.additionalProperties).toBe(false)
    })

    test('list_resources 工具配置正確', () => {
      const tool = TOOLS_CONFIG.list_resources

      expect(tool.name).toBe('list_resources')
      expect(tool.inputSchema.properties).toHaveProperty('categoryNo')
      expect(tool.inputSchema.properties).toHaveProperty('token')
      expect(tool.inputSchema.required).toEqual(['categoryNo', 'token'])
      expect(tool.inputSchema.additionalProperties).toBe(false)
    })

    test('member_token 工具配置正確 — 不暴露帳密欄位', () => {
      const tool = TOOLS_CONFIG.member_token

      expect(tool.name).toBe('member_token')
      expect(tool.inputSchema.properties).not.toHaveProperty('user')
      expect(tool.inputSchema.properties).not.toHaveProperty('password')
      expect(tool.inputSchema.additionalProperties).toBe(false)
    })
  })
})
