import { describe, test, expect, vi } from 'vitest'

vi.mock('dotenv/config', () => ({}))
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockRejectedValue(new Error('連線失敗')),
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

describe('src/server.ts — 啟動失敗處理', () => {
  test('server.connect 失敗時記錄錯誤並以 exit code 1 結束程序', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    await import('../src/server.js')

    // main().catch(...) 是非同步鏈，需等待微任務佇列跑完
    await new Promise(resolve => setImmediate(resolve))

    expect(consoleErrorSpy).toHaveBeenCalledWith('伺服器啟動失敗:', expect.any(Error))
    expect(processExitSpy).toHaveBeenCalledWith(1)

    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })
})
