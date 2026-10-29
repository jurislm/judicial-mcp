import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import axios from 'axios'
import { readFileSync } from 'node:fs'
import { dispatchTool } from '../src/server.js'
import { TOOLS_CONFIG } from '../src/tools.js'
import { clearRegulationCache } from '../src/regulation-cache.js'
import { createErrorResponse } from '../src/response.js'

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

const mockedAxios = vi.mocked(axios, true)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const lawSearch = '[{"PCODE":"B0000001","TERM":"民法"}]'

const lawArticle = `
  <main id="content">
    <h1>民法</h1>
    <div>修正日期： | 民國 115 年 08 月 17 日</div>
    <div>公布日期： | 民國 115 年 08 月 17 日</div>
    <div>施行日期： | 民國 115 年 08 月 17 日</div>
    <div class="law-reg-content">
      <div class="row">
        <div class="col-no"><a href="LawSingle.aspx?pcode=B0000001&amp;flno=1">第 1 條</a></div>
        <div class="col-data"><p>民事，法律所未規定者，依習慣；</p><p>無習慣者，依法理。</p></div>
      </div>
      <div class="row">
        <div class="col-no"><a href="LawSingle.aspx?pcode=B0000001&amp;flno=2">第 2 條</a></div>
        <div class="col-data">第二條內容不得混入第一條。</div>
      </div>
    </div>
    <div class="law-article"><div class="line-0000">民事，法律所未規定者，依習慣；無習慣者，依法理。</div></div>
    <div class="law-article"><div class="line-0000">民事所適用之習慣，以不背於公共秩序或善良風俗者為限。</div></div>
  </main>
`

const criminalCodeArticle = readFileSync(new URL('./fixtures/regulation-criminal-code-attachment.html', import.meta.url), 'utf8')

function firecrawlResponse(rawHtml: string, sourceURL = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001') {
  return { success: true, data: { rawHtml, metadata: { sourceURL } } }
}

function textData(result: Awaited<ReturnType<typeof dispatchTool>>): Record<string, unknown> {
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error('Expected text tool response')
  const data: unknown = JSON.parse(content.text)
  if (!isRecord(data) || typeof data.status !== 'string' || typeof data.source_url !== 'string') {
    throw new Error('Expected regulation result')
  }
  return data
}

function queueLawResponse(
  termPayload = lawSearch,
  articleHtml = lawArticle,
  sourceURL = 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001',
): void {
  mockedAxios.post
    .mockResolvedValueOnce({ data: termPayload, headers: {} })
    .mockResolvedValueOnce({ data: firecrawlResponse(articleHtml, sourceURL), headers: {} })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedAxios.post.mockReset()
  clearRegulationCache()
  vi.stubEnv('FIRECRAWL_API_URL', 'http://127.0.0.1:3002')
  vi.stubEnv('FIRECRAWL_API_KEY', '')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('query_regulation', () => {
  test.each(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'])('recovers a transient name lookup failure %s', async code => {
    mockedAxios.post.mockRejectedValueOnce(Object.assign(new Error('temporary failure'), { code }))
    queueLawResponse()
    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1', refresh: true }))
    expect(data.article_text).toContain('民事')
    expect(mockedAxios.post.mock.calls[0]?.slice(0, 2)).toEqual(mockedAxios.post.mock.calls[1]?.slice(0, 2))
  })

  test('retries an aborted response stream but not other bad responses', async () => {
    mockedAxios.post.mockRejectedValueOnce(Object.assign(new Error('stream has been aborted'), { code: 'ERR_BAD_RESPONSE' }))
    queueLawResponse()
    expect(textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).status).toBe('current')
    clearRegulationCache()
    mockedAxios.post.mockReset().mockRejectedValueOnce(Object.assign(new Error('maxContentLength exceeded'), { code: 'ERR_BAD_RESPONSE' }))
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({ code: 'source_unavailable' })
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  test('retries an overall deadline cancellation with a fresh signal', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(5))
    try {
      mockedAxios.post.mockImplementationOnce((_url, _body, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })))
      }))
      queueLawResponse()
      const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
      expect(data.status).toBe('current')
      expect(timeoutSpy).toHaveBeenNthCalledWith(1, 15_000)
      expect(timeoutSpy).toHaveBeenNthCalledWith(2, 15_000)
      const first = mockedAxios.post.mock.calls[0]?.[2]?.signal
      const second = mockedAxios.post.mock.calls[1]?.[2]?.signal
      expect(first?.aborted).toBe(true)
      expect(second).toBeInstanceOf(AbortSignal)
      expect(second).not.toBe(first)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  test.each([502, 503, 504])('recovers a temporary name lookup HTTP %s', async status => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status } })
    queueLawResponse()
    expect(textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).status).toBe('current')
  })

  test('stops after two transient name lookup failures', async () => {
    mockedAxios.post.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({ code: 'source_unavailable' })
    expect(mockedAxios.post).toHaveBeenCalledTimes(2)
  })

  test.each([400, 401, 403, 404, 429])('does not retry name lookup HTTP %s', async status => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status } })
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({ code: 'source_unavailable' })
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  test('exposes a public, tokenless tool with bounded query options', () => {
    expect(TOOLS_CONFIG.query_regulation.inputSchema).toMatchObject({
      type: 'object',
      required: ['lawName', 'articleNumber'],
      additionalProperties: false,
    })
    expect(TOOLS_CONFIG.query_regulation.inputSchema.properties).toMatchObject({
      lawName: { type: 'string' },
      articleNumber: { type: 'string' },
      refresh: { type: 'boolean' },
    })
    expect(TOOLS_CONFIG.query_regulation.inputSchema.properties).not.toHaveProperty('token')
  })

  test('resolves an exact official name and returns one article with dates and provenance', async () => {
    queueLawResponse()

    const data = textData(await dispatchTool('query_regulation', {
      lawName: '民法',
      articleNumber: '1',
    }))

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      1,
      'https://law.moj.gov.tw/controls/GetTermList.ashx?term=%E6%B0%91%E6%B3%95&type=ONEBAR',
      'term=%E6%B0%91%E6%B3%95&type=ONEBAR',
      expect.objectContaining({ maxRedirects: 0, validateStatus: expect.any(Function), timeout: expect.any(Number) }),
    )
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3002/v1/scrape',
      expect.objectContaining({
        url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001',
        formats: ['rawHtml'],
        onlyMainContent: false,
      }),
      expect.objectContaining({ maxRedirects: 0, validateStatus: expect.any(Function), timeout: expect.any(Number) }),
    )
    expect(mockedAxios.get).not.toHaveBeenCalled()
    expect(data).toMatchObject({
      status: 'current',
      regulation_name: '民法',
      regulation_id: 'B0000001',
      article_number: '1',
      article_text: '民事，法律所未規定者，依習慣；\n無習慣者，依法理。',
      version: {
        amendment_date: '2026-08-17',
        promulgation_date: '2026-08-17',
        effective_date: '2026-08-17',
      },
      source_url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001',
      retrieved_at: expect.any(String),
      cache: { status: 'miss' },
      truncated: false,
      partial: false,
    })
  })

  test('uses the configured Firecrawl key without exposing it in source errors', async () => {
    const testKey = 'firecrawl-unit-test-secret'
    vi.stubEnv('FIRECRAWL_API_KEY', testKey)
    mockedAxios.post.mockResolvedValueOnce({ data: lawSearch, headers: {} })
    mockedAxios.post.mockRejectedValueOnce(new Error(testKey))

    let failure: unknown
    try {
      await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })
    } catch (error: unknown) {
      failure = error
    }
    if (failure === undefined) throw new Error('Expected a Firecrawl source error')

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3002/v1/scrape',
      expect.objectContaining({ url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${testKey}` }) }),
    )
    const renderedError = JSON.stringify(createErrorResponse(failure, 'unused'))
    expect(renderedError).not.toContain(testKey)
    expect(failure).toMatchObject({ code: 'source_unavailable', sourceUrl: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001' })
  })

  test('does not use a built-in Firecrawl URL or direct HTML fallback', async () => {
    vi.stubEnv('FIRECRAWL_API_URL', '')
    mockedAxios.post.mockResolvedValueOnce({ data: lawSearch, headers: {} })

    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'source_unavailable',
    })
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('does not follow a redirect from the official autocomplete endpoint', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 302 } })

    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'source_unavailable',
    })
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://law.moj.gov.tw/controls/GetTermList.ashx?term=%E6%B0%91%E6%B3%95&type=ONEBAR',
      'term=%E6%B0%91%E6%B3%95&type=ONEBAR',
      expect.objectContaining({ maxRedirects: 0, validateStatus: expect.any(Function) }),
    )
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  test('rejects Firecrawl HTML that does not identify an official law database URL', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: lawSearch, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({ data: firecrawlResponse(lawArticle, 'https://example.com/other'), headers: {} })

    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'source_changed',
      sourceUrl: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001',
    })
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test.each([
    'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000002',
    'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=B0000001',
    'https://law.moj.gov.tw:8443/LawClass/LawAll.aspx?pcode=B0000001',
    'https://law.moj.gov.tw.evil.example/LawClass/LawAll.aspx?pcode=B0000001',
    'https://user@law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001',
  ])('rejects a Firecrawl final URL outside the exact requested law page (%s)', async sourceURL => {
    mockedAxios.post.mockResolvedValueOnce({ data: lawSearch, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({ data: firecrawlResponse(lawArticle, sourceURL), headers: {} })

    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'source_changed',
      sourceUrl: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001',
    })
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('does not scrape a legacy search page when autocomplete has no usable law code', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: '[{"PCODE":"","TERM":"民法"}]', headers: {} })

    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'regulation_not_found',
      sourceUrl: 'https://law.moj.gov.tw/controls/GetTermList.ashx?term=%E6%B0%91%E6%B3%95&type=ONEBAR',
    })
    expect(mockedAxios.get).not.toHaveBeenCalled()
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  test('does not choose among fuzzy name matches', async () => {
    const candidates = '[{"PCODE":"B0000001","TERM":"民法"},{"PCODE":"B0000002","TERM":"民法施行法"}]'
    mockedAxios.post.mockResolvedValueOnce({ data: candidates, headers: {} })

    const data = textData(await dispatchTool('query_regulation', {
      lawName: '民',
      articleNumber: '1',
    }))

    expect(data).toMatchObject({ status: 'ambiguous', partial: true, cache: { status: 'not_cached' } })
    expect(data.candidates).toEqual([
      { regulation_name: '民法', regulation_id: 'B0000001' },
      { regulation_name: '民法施行法', regulation_id: 'B0000002' },
    ])
    expect(mockedAxios.get).not.toHaveBeenCalled()
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  test('reports abolished law as a typed source error', async () => {
    const lawName = '九二一震災重建暫行條例'
    const term = JSON.stringify([{ PCODE: 'A0030110', TERM: lawName }])
    const abolished = `<main id="content"><h1>${lawName}</h1><div>法規名稱：廢 ${lawName}</div><div>廢止日期：民國 95 年 02 月 05 日</div></main>`
    mockedAxios.post.mockResolvedValueOnce({ data: term, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: firecrawlResponse(abolished, 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030110'),
      headers: {},
    })

    let failure: unknown
    try {
      await dispatchTool('query_regulation', { lawName, articleNumber: '1' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeDefined()
    if (failure === undefined) throw new Error('Expected an abolished source error')
    const response = createErrorResponse(failure, 'unused')
    expect(response.isError).toBe(true)
    const data: unknown = JSON.parse(response.content[0]?.type === 'text' ? response.content[0].text : '{}')
    expect(data).toMatchObject({ error: { code: 'regulation_abolished', source_url: expect.stringContaining('LawAll.aspx') } })
  })

  test('does not mistake an active law beginning with 廢棄 for an abolished law', async () => {
    const search = '[{"PCODE":"B0000002","TERM":"廢棄物清理法"}]'
    const article = lawArticle.replaceAll('民法', '廢棄物清理法')
    queueLawResponse(search, article, 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000002')

    const data = textData(await dispatchTool('query_regulation', { lawName: '廢棄物清理法', articleNumber: '1' }))
    expect(data).toMatchObject({ status: 'current', regulation_name: '廢棄物清理法', regulation_id: 'B0000002' })
  })

  test('reads the criminal code article when another official row has an attachment accessibility label', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: '[{"PCODE":"C0000001","TERM":"中華民國刑法"}]', headers: {} })
      .mockResolvedValueOnce({
        data: firecrawlResponse(criminalCodeArticle, 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=C0000001'),
        headers: {},
      })

    const data = textData(await dispatchTool('query_regulation', {
      lawName: '中華民國刑法',
      articleNumber: '1',
    }))

    expect(data).toMatchObject({
      status: 'current',
      regulation_name: '中華民國刑法',
      regulation_id: 'C0000001',
      article_number: '1',
      source_url: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=C0000001',
      truncated: false,
    })
    expect(data.article_text).toBe('行為之處罰，以行為時之法律有明文規定者為限。')
  })

  test('normalizes zero-padded components of a hyphenated article number', async () => {
    const subArticle = lawArticle.replace('第 1 條', '第 1-1 條')
    mockedAxios.post
      .mockResolvedValueOnce({ data: lawSearch, headers: {} })
      .mockResolvedValueOnce({ data: firecrawlResponse(subArticle), headers: {} })

    const data = textData(await dispatchTool('query_regulation', {
      lawName: '民法',
      articleNumber: '001-001',
    }))

    expect(data).toMatchObject({
      status: 'current',
      regulation_name: '民法',
      regulation_id: 'B0000001',
      article_number: '1-1',
      article_text: '民事，法律所未規定者，依習慣；\n無習慣者，依法理。',
    })
  })

  test('returns a cache hit without another upstream request until refresh is requested', async () => {
    queueLawResponse()
    const first = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    const cached = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(first.cache).toEqual({ status: 'miss' })
    expect(cached.cache).toEqual({ status: 'hit' })
    expect(mockedAxios.post).toHaveBeenCalledTimes(3)
    expect(mockedAxios.get).not.toHaveBeenCalled()

    queueLawResponse(lawSearch, lawArticle)
    const refreshed = textData(await dispatchTool('query_regulation', {
      lawName: '民法',
      articleNumber: '1',
      refresh: true,
    }))
    expect(refreshed.cache).toEqual({ status: 'refreshed' })
    expect(mockedAxios.post).toHaveBeenCalledTimes(6)
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('refreshes expired cache through Firecrawl and never presents a failed refresh as current', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'))
    queueLawResponse()
    await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })
    vi.advanceTimersByTime(16 * 60 * 1000)
    queueLawResponse()

    const revalidated = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(mockedAxios.post).toHaveBeenCalledTimes(6)
    expect(mockedAxios.get).not.toHaveBeenCalled()
    expect(revalidated.cache).toEqual({ status: 'revalidated' })

    vi.advanceTimersByTime(16 * 60 * 1000)
    mockedAxios.post.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'source_unavailable',
    })
    expect(mockedAxios.post).toHaveBeenCalledTimes(7)
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('checks official status again after cache expiry and does not return an abolished law as current', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'))
    queueLawResponse()
    await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })
    vi.advanceTimersByTime(16 * 60 * 1000)
    const abolished = '<main id="content"><h1>民法</h1><div>法規名稱：廢 民法</div><div>廢止日期：民國 95 年 02 月 05 日</div></main>'
    mockedAxios.post.mockResolvedValueOnce({ data: lawSearch, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({ data: firecrawlResponse(abolished), headers: {} })

    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'regulation_abolished',
    })
    expect(mockedAxios.post).toHaveBeenCalledTimes(5)
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test('distinguishes a confirmed no-match response from an upstream failure', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: '[]', headers: {} })
    let failure: unknown
    try {
      await dispatchTool('query_regulation', { lawName: '不存在法規', articleNumber: '1' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'regulation_not_found' })
    expect(failure).toMatchObject({ sourceUrl: 'https://law.moj.gov.tw/controls/GetTermList.ashx?term=%E4%B8%8D%E5%AD%98%E5%9C%A8%E6%B3%95%E8%A6%8F&type=ONEBAR' })
    expect(mockedAxios.get).not.toHaveBeenCalled()

    clearRegulationCache()
    mockedAxios.post.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(dispatchTool('query_regulation', { lawName: '不存在法規', articleNumber: '1' })).rejects.toMatchObject({
      code: 'source_unavailable',
    })
  })

  test('bounds oversized article text and marks the response partial', async () => {
    queueLawResponse(lawSearch, lawArticle.replace(
      '民事，法律所未規定者，依習慣；',
      '法條'.repeat(20_000),
    ))
    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data.truncated).toBe(true)
    expect(data.partial).toBe(true)
    expect(String(data.article_text).length).toBeLessThanOrEqual(30_000)
  })

  test.each([
    '※本法規部分或全部條文尚未生效，最後生效日期：未定',
    '※本法規部分或全部條文尚未施行，最後生效日期： 未定',
  ])('preserves an explicit pending warning with an undetermined date (%s)', async warning => {
    const page = lawArticle
      .replace('<div>公布日期： | 民國 115 年 08 月 17 日</div>', '')
      .replace('<div>施行日期： | 民國 115 年 08 月 17 日</div>', `<div>生效狀態：${warning}</div>`)
    queueLawResponse(lawSearch, page)

    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data).toMatchObject({
      article_text: '民事，法律所未規定者，依習慣；\n無習慣者，依法理。',
      truncated: false,
      partial: true,
      version: {
        amendment_date: '2026-08-17',
        promulgation_date: null,
        effective_date: null,
        effective_status: 'pending_or_mixed',
      },
    })
  })

  test('does not assert effective status when the source supplies no effective information', async () => {
    queueLawResponse(lawSearch, lawArticle.replace('<div>施行日期： | 民國 115 年 08 月 17 日</div>', ''))

    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data).toMatchObject({
      partial: true,
      version: { effective_date: null, effective_status: 'unknown' },
    })
  })

  test('marks an undetermined effective date as unknown and partial', async () => {
    const page = lawArticle
      .replace('<div>施行日期： | 民國 115 年 08 月 17 日</div>', '<div>最後生效日期：未定</div>')
    queueLawResponse(lawSearch, page)

    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data).toMatchObject({
      partial: true,
      version: {
        amendment_date: '2026-08-17',
        effective_date: null,
        effective_status: 'unknown',
      },
    })
  })

  test('fails with source_changed when the official article layout cannot be safely isolated', async () => {
    queueLawResponse(lawSearch, '<main><h1>民法</h1><p>第 1 條 text</p><p>第 2 條 other text</p></main>')
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })).rejects.toMatchObject({
      code: 'source_changed',
    })
  })

  test('reports a missing article only after recognizing official article rows', async () => {
    queueLawResponse(lawSearch, '<main id="content"><h1>民法</h1><p>無此條文</p></main>')
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '99999' })).rejects.toMatchObject({
      code: 'source_changed',
    })

    const emptyRowPage = `
      <main id="content"><h1>民法</h1>
        <div class="law-reg-content">
          <div class="col-no">第 1 條</div>
          <div class="col-data"></div>
        </div>
      </main>
    `
    queueLawResponse(lawSearch, emptyRowPage)
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '99999' })).rejects.toMatchObject({
      code: 'source_changed',
    })

    const recognizedPage = `
      <main id="content"><h1>民法</h1>
        <div class="law-reg-content">
          <div class="col-no">第 1 條</div>
          <div class="col-data">民事，法律所未規定者，依習慣。</div>
        </div>
      </main>
    `
    queueLawResponse(lawSearch, recognizedPage)
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '99999' })).rejects.toMatchObject({
      code: 'regulation_article_not_found',
    })
  })

  test('rejects invalid inputs before making an upstream request', async () => {
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '第一條' })).rejects.toThrow()
    await expect(dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1', refresh: 'true' })).rejects.toThrow()
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })
})

describe('article effectiveness integration', () => {
  const articlePage = lawArticle.replace('<h1>民法</h1>', '<table><tr><th>法規名稱：</th><td>民法</td></tr><tr><th>修正日期：</th><td>民國 115 年 08 月 17 日</td></tr></table>')
  const historyUrl = 'https://law.moj.gov.tw/LawClass/LawHistory.aspx?pcode=B0000001'
  const history = `<main><table><tr><th>法規名稱：</th><td>民法</td></tr><tr><th>修正日期：</th><td>民國 115 年 08 月 17 日</td></tr></table><div class="law-history"><div class="row"><div class="col-data">1. 中華民國一百十五年八月十七日總統令修正公布第 1 條條文；並自民國 115 年 08 月 17 日施行</div></div></div></main>`

  function queueHistory(html = history, sourceURL = historyUrl) {
    mockedAxios.post.mockResolvedValueOnce({ data: firecrawlResponse(html, sourceURL), headers: {} })
  }

  test('returns article-specific evidence separately from law-wide version metadata', async () => {
    queueLawResponse(lawSearch, articlePage)
    queueHistory()
    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data).toMatchObject({
      article_text_version: 'latest_promulgated',
      article_effectiveness: { status: 'effective', effective_date: '2026-08-17', basis: [{ source_url: historyUrl }] },
    })
  })

  test('preserves article text but reports unknown when official history is unavailable', async () => {
    queueLawResponse(lawSearch, articlePage)
    mockedAxios.post.mockRejectedValueOnce(new Error('history unavailable'))
    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data).toMatchObject({ article_effectiveness: { status: 'unknown', effective_date: null } })
    expect(data.article_text).toContain('民事')
  })

  test('does not trust a history redirect or a different law identity', async () => {
    queueLawResponse(lawSearch, articlePage)
    queueHistory(history, 'https://law.moj.gov.tw/LawClass/LawHistory.aspx?pcode=B0000002')
    const redirected = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(redirected).toMatchObject({ article_effectiveness: { status: 'unknown' } })
    clearRegulationCache()
    queueLawResponse(lawSearch, articlePage)
    queueHistory(history.replace('民法', '其他法規'))
    const mismatched = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(mismatched).toMatchObject({ article_effectiveness: { status: 'unknown' } })
  })

  test('does not label deleted text in an alternative supported article layout effective', async () => {
    const deletedPage = articlePage.slice(0, articlePage.indexOf('<div class="law-reg-content">')) + '<div class="law-article"><div class="article-number">第 1 條</div><div class="article-content">（刪除）</div></div></main>'
    queueLawResponse(lawSearch, deletedPage)
    queueHistory()
    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data).toMatchObject({ article_text: '（刪除）', article_effectiveness: { status: 'unknown' } })
  })

  test('rechecks a cached decision across Taiwan midnight even before cache TTL expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T15:59:00.000Z'))
    queueLawResponse(lawSearch, articlePage)
    queueHistory()
    await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' })
    vi.setSystemTime(new Date('2026-10-28T16:01:00.000Z'))
    queueLawResponse(lawSearch, articlePage)
    queueHistory()
    const data = textData(await dispatchTool('query_regulation', { lawName: '民法', articleNumber: '1' }))
    expect(data.cache).toEqual({ status: 'revalidated' })
    expect(data).toMatchObject({ article_effectiveness: { checked_at: '2026-10-28T16:01:00.000Z' } })
  })
})
