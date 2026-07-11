import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

vi.mock('../src/server.js', () => ({}))

describe('src/index.ts — bootstrap', () => {
  // src/index.ts's console.log/info/warn override runs once, at module-eval time. ESM module
  // caching means only this one import actually executes that code — importing it again in each
  // test would silently no-op and rely on this same mutation, so import it exactly once here.
  beforeAll(async () => {
    await import('../src/index.js')
  })

  function spyOnStderrWrite() {
    return vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  }

  let writeSpy: ReturnType<typeof spyOnStderrWrite>

  beforeEach(() => {
    writeSpy = spyOnStderrWrite()
  })

  afterEach(() => {
    writeSpy.mockRestore()
  })

  test('console.log/info/warn 被重定向到 process.stderr.write', () => {
    console.log('hello', 123)

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('hello'))
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('123'))
    expect(console.log).toBe(console.info)
    expect(console.log).toBe(console.warn)
  })

  test('safeSerialize：非字串引數以 JSON.stringify 序列化', () => {
    console.info({ a: 1 })

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('{"a":1}'))
  })

  test('safeSerialize：JSON.stringify 回傳 undefined（如函式）時退回 String(value)', () => {
    const fn = function namedFn() {}
    console.warn(fn)

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining(String(fn)))
  })

  test('safeSerialize：循環參照物件觸發 JSON.stringify 例外時退回 String(value)', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify')
    const circular: Record<string, unknown> = {}
    circular.self = circular

    console.log(circular)

    // 確認 catch 分支真的被觸發（JSON.stringify 對 circular 拋出），而不是恰好與非循環物件
    // 的輸出撞字串 —— String(plainObject) 同樣是 '[object Object]'，不足以證明 catch 分支執行。
    expect(stringifySpy).toHaveBeenCalledWith(circular)
    expect(stringifySpy.mock.results[0]?.type).toBe('throw')
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining(String(circular)))

    stringifySpy.mockRestore()
  })
})
