import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import axios from 'axios'
import { readFileSync } from 'node:fs'
import { dispatchTool } from '../src/server.js'
import { TOOLS_CONFIG } from '../src/tools.js'
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

const searchForm = `
  <form id="form1">
    <input type="hidden" name="__VIEWSTATE" value="fixture-state">
    <input type="hidden" name="__EVENTVALIDATION" value="fixture-validation">
    <input type="hidden" name="__VIEWSTATEGENERATOR" value="fixture-generator">
    <select name="jud_court"><option value="TPD">臺灣臺北地方法院</option></select>
    <input type="submit" name="ctl00$cp_content$btnQry" value="送出查詢">
  </form>
`

const resultPage = `
  <table id="jud">
    <tr><th>裁判字號</th><th>日期</th><th>案由</th></tr>
    <tr>
      <td>1</td>
      <td><a class="hlTitle_scroll" href="data.aspx?ty=JD&amp;id=TPDV%2c113%2c訴%2c1234%2c20240401%2c1">113年度訴字第1234號</a></td>
      <td>113/04/01</td>
      <td>損害賠償</td>
    </tr>
    <tr class="summary"><td colspan="4"><span class="tdCut">判決摘要</span></td></tr>
  </table>
`

const officialNoResultPage = readFileSync(new URL('./fixtures/judgment-no-results.html', import.meta.url), 'utf8')

function toolData(result: Awaited<ReturnType<typeof dispatchTool>>): Record<string, unknown> {
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error('Expected text tool response')
  const data: unknown = JSON.parse(content.text)
  if (!isRecord(data)) throw new Error('Expected object tool response')
  return data
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('judgment search and text tools', () => {
  test('exposes public high-level tools without credential inputs', () => {
    expect(TOOLS_CONFIG.search_judgments.inputSchema.properties).toEqual({
      keyword: expect.objectContaining({ type: 'string' }),
      court: expect.objectContaining({ type: 'string' }),
      year: expect.objectContaining({ type: 'integer' }),
      caseNumber: expect.objectContaining({ type: 'string' }),
      limit: expect.objectContaining({ type: 'integer' }),
      page: expect.objectContaining({ type: 'integer' }),
      offset: expect.objectContaining({ type: 'integer' }),
    })
    expect(TOOLS_CONFIG.search_judgments.inputSchema).not.toHaveProperty('required')
    expect(TOOLS_CONFIG.search_judgments.inputSchema.properties).not.toHaveProperty('token')
    expect(TOOLS_CONFIG.fetch_judgment_text.inputSchema.properties).toHaveProperty('caseId')
    expect(TOOLS_CONFIG.fetch_judgment_text.inputSchema.properties).not.toHaveProperty('token')
  })

  test('searches the official form with every supplied filter and returns checkable candidates', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: searchForm,
        headers: { 'set-cookie': ['ASP.NET_SessionId=fixture; path=/'] },
      })
      .mockResolvedValueOnce({ data: resultPage, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: '<iframe src="qryresultlst.aspx?sys=V&amp;judtype=JUDBOOK"></iframe>',
      headers: {},
    })

    const data = toolData(await dispatchTool('search_judgments', {
      keyword: '資料保護',
      court: '臺灣臺北地方法院',
      year: 113,
      caseNumber: '113年度訴字第1234號',
      limit: 5,
    }))

    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://judgment.judicial.gov.tw/FJUD/Default_AD.aspx',
      expect.objectContaining({ maxRedirects: 0, timeout: expect.any(Number) }),
    )
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://judgment.judicial.gov.tw/FJUD/Default_AD.aspx',
      expect.any(URLSearchParams),
      expect.objectContaining({ maxRedirects: 0, timeout: expect.any(Number) }),
    )
    const body = mockedAxios.post.mock.calls[0]?.[1]
    if (!(body instanceof URLSearchParams)) throw new Error('Expected form data')
    expect(body.get('jud_kw')).toBe('資料保護')
    expect(body.get('jud_court')).toBe('TPD')
    expect(body.get('jud_year')).toBe('113')
    expect(body.get('jud_case')).toBe('訴')
    expect(body.get('jud_no')).toBe('1234')
    expect(data).toMatchObject({
      count: 1,
      ambiguous: false,
      truncated: false,
      partial: false,
      source_version: null,
      results: [{
        case_id: 'TPDV,113,訴,1234,20240401,1',
        case_number: '113年度訴字第1234號',
        date: '2024-04-01',
        court: 'TPDV',
        cause: '損害賠償',
        source_url: expect.stringContaining('/FJUD/data.aspx?ty=JD'),
        search_source_url: expect.stringContaining('/FJUD/qryresultlst.aspx'),
        retrieved_at: expect.any(String),
        cache: { status: 'not_cached' },
      }],
    })
  })

  test('returns every result in an upstream page through page and offset pagination', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => {
      const number = index + 1
      return `<tr><td>${number}</td><td><a href="data.aspx?ty=JD&amp;id=TPDV%2c113%2c訴%2c${number}%2c20240401%2c1">113年度訴字第${number}號</a></td><td>113/04/01</td><td>案由${number}</td></tr><tr class="summary"><td colspan="4"><span class="tdCut">摘要${number}</span></td></tr>`
    }).join('')
    const page = `<table id="jud"><tr><th>裁判字號</th><th>日期</th><th>案由</th></tr>${rows}</table><a href="qryresultlst.aspx?page=2">下一頁</a>`
    mockedAxios.get
      .mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: page, headers: {} })
      .mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: page, headers: {} })
    mockedAxios.post
      .mockResolvedValueOnce({ data: '<iframe src="qryresultlst.aspx?sys=V&amp;judtype=JUDBOOK"></iframe>', headers: {} })
      .mockResolvedValueOnce({ data: '<iframe src="qryresultlst.aspx?sys=V&amp;judtype=JUDBOOK"></iframe>', headers: {} })

    const firstPage = toolData(await dispatchTool('search_judgments', { keyword: '資料保護', limit: 10 }))
    const secondPage = toolData(await dispatchTool('search_judgments', { keyword: '資料保護', limit: 10, page: 1, offset: 10 }))

    expect(firstPage).toMatchObject({ count: 10, truncated: true, next_page: 1, next_offset: 10 })
    expect(secondPage).toMatchObject({ count: 10, truncated: true, next_page: 2, next_offset: 0 })
    const firstResults = firstPage.results
    const secondResults = secondPage.results
    if (!Array.isArray(firstResults) || !Array.isArray(secondResults)) throw new Error('Expected judgment results')
    expect(firstResults.map(result => isRecord(result) ? result.case_id : undefined)).toEqual(
      Array.from({ length: 10 }, (_, index) => `TPDV,113,訴,${index + 1},20240401,1`),
    )
    expect(secondResults.map(result => isRecord(result) ? result.case_id : undefined)).toEqual(
      Array.from({ length: 10 }, (_, index) => `TPDV,113,訴,${index + 11},20240401,1`),
    )
  })

  test('accepts five-part legacy judgment IDs from search results and full-text retrieval', async () => {
    const legacyPage = resultPage.replace(
      'TPDV%2c113%2c訴%2c1234%2c20240401%2c1',
      'TPSV%2c88%2c台上%2c1864%2c19990820',
    ).replace('113年度訴字第1234號', '88年度台上字第1864號')
    mockedAxios.get
      .mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: legacyPage, headers: {} })
      .mockResolvedValueOnce({ data: '<div id="jud">最高法院判決全文</div>', headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: '<iframe src="qryresultlst.aspx?sys=V&amp;judtype=JUDBOOK"></iframe>',
      headers: {},
    })

    const search = toolData(await dispatchTool('search_judgments', { caseNumber: '1864' }))
    const results = search.results
    if (!Array.isArray(results) || !isRecord(results[0])) throw new Error('Expected legacy judgment result')
    expect(results[0].case_id).toBe('TPSV,88,台上,1864,19990820')

    const text = toolData(await dispatchTool('fetch_judgment_text', { caseId: 'TPSV,88,台上,1864,19990820' }))
    expect(text).toMatchObject({ case_id: 'TPSV,88,台上,1864,19990820', full_text: '最高法院判決全文' })
  })

  test('returns multiple exact-number matches as ambiguous instead of selecting one', async () => {
    const twoResults = resultPage.replace(
      '</table>',
      `<tr><td>2</td><td><a href="data.aspx?ty=JD&amp;id=TPDV%2c113%2c訴%2c1234%2c20240501%2c1">113年度訴字第1234號</a></td><td>113/05/01</td><td>另一案由</td></tr></table>`,
    )
    mockedAxios.get.mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: twoResults, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: '<iframe src="qryresultlst.aspx?sys=V&amp;judtype=JUDBOOK"></iframe>',
      headers: {},
    })

    const data = toolData(await dispatchTool('search_judgments', { caseNumber: '1234' }))

    expect(data).toMatchObject({ count: 2, ambiguous: true })
    const results = data.results
    expect(Array.isArray(results)).toBe(true)
    if (Array.isArray(results)) expect(results).toHaveLength(2)
  })

  test('ignores unrelated links containing the word next when determining ambiguity', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: `${resultPage}<a href="#">Next citation</a>`, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: '<iframe src="qryresultlst.aspx?sys=V&amp;judtype=JUDBOOK"></iframe>',
      headers: {},
    })

    const data = toolData(await dispatchTool('search_judgments', { caseNumber: '1234' }))

    expect(data).toMatchObject({ count: 1, ambiguous: false, truncated: false, next_page: null })
  })

  test('reports results omitted by the page limit as truncated and partial', async () => {
    const finalPage = resultPage.replace(
      '</table>',
      '</table><a href="qryresultlst.aspx?page=51">下一頁</a>',
    )
    mockedAxios.get.mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: finalPage, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: '<iframe src="qryresultlst.aspx?sys=V&amp;judtype=JUDBOOK"></iframe>',
      headers: {},
    })

    const data = toolData(await dispatchTool('search_judgments', { caseNumber: '1234', page: 50 }))

    expect(data).toMatchObject({
      count: 1,
      ambiguous: true,
      truncated: true,
      partial: true,
      next_page: null,
    })
  })

  test('requires a case ID before attempting full-text retrieval', async () => {
    await expect(dispatchTool('fetch_judgment_text', {})).rejects.toThrow('缺少必要參數: caseId')
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  test.each([
    ['iframe', 'Q003'],
    ['FJUD', 'not-found'],
  ])('returns an explicit empty result only when the official page says there are no matches ($0)', async (frame, error) => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: officialNoResultPage, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: `<iframe src="../ErrorPage.aspx?frm=${frame}&amp;err=${error}"></iframe>`,
      headers: {},
    })

    const data = toolData(await dispatchTool('search_judgments', { keyword: '不存在的查詢詞' }))

    expect(data).toMatchObject({
      count: 0,
      ambiguous: false,
      results: [],
      truncated: false,
      partial: false,
      source_version: null,
      cache: { status: 'not_cached' },
      source_url: `https://judgment.judicial.gov.tw/ErrorPage.aspx?frm=${frame}&err=${error}`,
      retrieved_at: expect.any(String),
    })
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      `https://judgment.judicial.gov.tw/ErrorPage.aspx?frm=${frame}&err=${error}`,
      expect.objectContaining({ maxRedirects: 0, timeout: expect.any(Number) }),
    )
    const errorPageOptions = mockedAxios.get.mock.calls[1]?.[1]
    if (!errorPageOptions || !('headers' in errorPageOptions)) throw new Error('Expected official error-page request options')
    expect(errorPageOptions.headers).not.toHaveProperty('Cookie')
  })

  test('does not treat an unrecognized official error page as an empty result', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: searchForm, headers: {} })
      .mockResolvedValueOnce({ data: '<html><body>系統訊息<script>const message = "查無資料"</script></body></html>', headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: '<iframe src="../ErrorPage.aspx?frm=FJUD&amp;err=unknown"></iframe>',
      headers: {},
    })

    await expect(dispatchTool('search_judgments', { keyword: '查無資料' })).rejects.toMatchObject({
      name: 'JudicialSourceError',
      code: 'source_changed',
    })
  })

  test('does not follow an off-site error iframe from the official search form', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: searchForm, headers: {} })
    mockedAxios.post.mockResolvedValueOnce({
      data: '<iframe src="https://example.com/ErrorPage.aspx?frm=FJUD&amp;err=not-found"></iframe>',
      headers: {},
    })

    await expect(dispatchTool('search_judgments', { keyword: '不存在的查詢詞' })).rejects.toMatchObject({
      name: 'JudicialSourceError',
      code: 'source_changed',
    })
    expect(mockedAxios.get).toHaveBeenCalledTimes(1)
  })

  test('fetches the full public judgment by case ID and marks output truncation', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: `<div id="jud">${'裁判全文'.repeat(15000)}</div>`,
      headers: {},
    })

    const data = toolData(await dispatchTool('fetch_judgment_text', {
      caseId: 'TPDV,113,訴,1234,20240401,1',
    }))

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDV%2C113%2C%E8%A8%B4%2C1234%2C20240401%2C1',
      expect.objectContaining({ maxRedirects: 0, timeout: expect.any(Number) }),
    )
    expect(data).toMatchObject({
      case_id: 'TPDV,113,訴,1234,20240401,1',
      date: '2024-04-01',
      truncated: true,
      partial: true,
      source_version: null,
      cache: { status: 'not_cached' },
      source_url: expect.stringContaining('/FJUD/data.aspx'),
      retrieved_at: expect.any(String),
    })
    expect(String(data.full_text)).toHaveLength(40000)
  })

  test('reports denied upstream access as a source error, never an empty result set', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 403 } })

    let failure: unknown
    try {
      await dispatchTool('search_judgments', { keyword: '資料保護' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toMatchObject({
      name: 'JudicialSourceError',
      code: 'source_unavailable',
    })
    const response = createErrorResponse(failure, 'should be replaced')
    const text = response.content[0]
    if (text?.type !== 'text') throw new Error('Expected text error response')
    const data: unknown = JSON.parse(text.text)
    expect(response.isError).toBe(true)
    expect(data).toMatchObject({
      error: {
        code: 'source_unavailable',
        message: '司法院公開裁判書來源暫時無法使用',
        source_url: 'https://judgment.judicial.gov.tw/FJUD/Default_AD.aspx',
        retrieved_at: expect.any(String),
      },
    })
  })

  test('treats unrecognized source markup as an upstream format error', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '<html><body>challenge page</body></html>', headers: {} })

    await expect(dispatchTool('search_judgments', { keyword: '資料保護' })).rejects.toMatchObject({
      name: 'JudicialSourceError',
      code: 'source_changed',
    })
  })

  test('does not report an unrecognized judgment page as a missing case', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: '<html><body>unexpected page layout</body></html>', headers: {} })

    await expect(dispatchTool('fetch_judgment_text', {
      caseId: 'TPDV,113,訴,1234,20240401,1',
    })).rejects.toMatchObject({
      name: 'JudicialSourceError',
      code: 'source_changed',
    })
  })
})
