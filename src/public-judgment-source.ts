import axios, { type AxiosResponse } from 'axios'
import { load } from 'cheerio'
import { JudicialSourceError } from './source-error.js'

const BASE_URL = 'https://judgment.judicial.gov.tw/FJUD/'
const SEARCH_URL = new URL('Default_AD.aspx', BASE_URL)
const DETAIL_URL = new URL('data.aspx', BASE_URL)
const PAGE_SIZE = 10
const SOURCE_PAGE_SIZE = 20
const MAX_PAGE = 50
const MAX_TEXT_LENGTH = 40_000
const MAX_SUMMARY_LENGTH = 500
const REQUEST_LIMIT = 2_000_000
const NO_RESULTS = /查無.{0,12}(?:資料|裁判書)|沒有符合條件的資料/

interface SearchCriteria {
  keyword?: string
  court?: string
  year?: number
  caseNumber?: string
  limit: number
  page: number
  offset: number
}

interface CaseNumberParts {
  year?: number
  caseWord?: string
  number: string
}

interface JudgmentSearchResult {
  case_id: string
  case_number: string
  date: string | null
  court: string
  cause: string
  summary?: string
  source_url: string
  search_source_url: string
  retrieved_at: string
  cache: { status: 'not_cached' }
  truncated: boolean
  partial: false
  source_version: null
}

function optionalString(args: Record<string, unknown>, name: string, maxLength: number): string | undefined {
  const value = args[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`參數 ${name} 必須是 1 至 ${maxLength} 個字元的文字`)
  }
  return value.trim()
}

function optionalInteger(
  args: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const value = args[name]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`參數 ${name} 必須是 ${minimum} 至 ${maximum} 的整數`)
  }
  return value
}

function parseCriteria(args: Record<string, unknown>): SearchCriteria {
  const keyword = optionalString(args, 'keyword', 128)
  const court = optionalString(args, 'court', 80)
  const year = optionalInteger(args, 'year', 1, 9999, 0)
  const caseNumber = optionalString(args, 'caseNumber', 80)
  const limit = optionalInteger(args, 'limit', 1, PAGE_SIZE, 5)
  const page = optionalInteger(args, 'page', 1, MAX_PAGE, 1)
  const offset = optionalInteger(args, 'offset', 0, SOURCE_PAGE_SIZE - 1, 0)
  if (!keyword && !court && !caseNumber && year === 0) {
    throw new Error('至少需要提供 keyword、court、year 或 caseNumber 其中一項')
  }
  return {
    ...(keyword ? { keyword } : {}),
    ...(court ? { court } : {}),
    ...(year > 0 ? { year } : {}),
    ...(caseNumber ? { caseNumber } : {}),
    limit,
    page,
    offset,
  }
}

function parseCaseNumber(value: string): CaseNumberParts {
  const withYear = value.match(/^(\d{1,4})年度(.+?)字第([A-Za-z0-9-]+)號$/)
  if (withYear) {
    const year = Number(withYear[1])
    if (year < 1 || year > 9999) throw new Error('案號年度不在有效範圍')
    return { year, caseWord: withYear[2], number: withYear[3] }
  }
  const withCaseWord = value.match(/^(.+?)字第([A-Za-z0-9-]+)號$/)
  if (withCaseWord) return { caseWord: withCaseWord[1], number: withCaseWord[2] }
  if (/^[A-Za-z0-9-]+$/.test(value)) return { number: value }
  throw new Error('caseNumber 請使用案號數字或「年度案類字第號」格式')
}

function toTaiwanYear(year: number): number {
  return year > 1911 ? year - 1911 : year
}

function normalizeCourt(value: string): string {
  return value.replaceAll('台', '臺').replaceAll(/\s+/g, '').toLocaleLowerCase()
}

function readCourtCode(html: string, court: string): string {
  const $ = load(html)
  let code: string | undefined
  const target = normalizeCourt(court)
  $('select[name="jud_court"] option').each((_, option) => {
    const candidate = $(option)
    const value = candidate.attr('value')?.trim()
    const label = candidate.text().trim()
    if (value && (value === court || normalizeCourt(label) === target)) code = value
  })
  if (!code) throw new Error(`官方法院清單中找不到「${court}」，請使用司法院顯示的法院名稱`)
  return code
}

function readCookieHeader(cookies: string[] | undefined): string | undefined {
  if (!cookies) return undefined
  const values = cookies
    .map(cookie => cookie.split(';', 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie && cookie.includes('=')))
  return values.length > 0 ? values.join('; ') : undefined
}

function formFields(html: string, criteria: SearchCriteria): URLSearchParams {
  const $ = load(html)
  const form = $('form').first()
  const state = new URLSearchParams()
  if (!form.length || !form.find('input[name="__VIEWSTATE"]').length || !form.find('input[name="__EVENTVALIDATION"]').length) {
    throw new JudicialSourceError('source_changed', SEARCH_URL.href)
  }
  form.find('input[type="hidden"][name]').each((_, input) => {
    const name = $(input).attr('name')
    const value = $(input).attr('value') ?? ''
    if (name) state.set(name, value)
  })
  const submit = form.find('input[type="submit"][name], button[type="submit"][name]').first()
  const submitName = submit.attr('name')
  const submitValue = submit.attr('value') ?? submit.text().trim()
  if (!submitName) throw new JudicialSourceError('source_changed', SEARCH_URL.href)
  state.set('judtype', 'JUDBOOK')
  state.set('whosub', '0')
  state.set(submitName, submitValue)
  if (criteria.keyword) state.set('jud_kw', criteria.keyword)
  if (criteria.court) state.set('jud_court', readCourtCode(html, criteria.court))
  if (criteria.year) state.set('jud_year', String(toTaiwanYear(criteria.year)))
  if (criteria.caseNumber) {
    const parsed = parseCaseNumber(criteria.caseNumber)
    if (parsed.year && criteria.year && toTaiwanYear(criteria.year) !== toTaiwanYear(parsed.year)) {
      throw new Error('year 與 caseNumber 的年度不一致')
    }
    const queryYear = criteria.year ?? parsed.year
    if (queryYear) state.set('jud_year', String(toTaiwanYear(queryYear)))
    if (parsed.caseWord) state.set('jud_case', parsed.caseWord)
    state.set('jud_no', parsed.number)
  }
  return state
}

function allowedOfficialUrl(value: string, base: URL): URL {
  const url = new URL(value, base)
  if (
    url.origin !== base.origin ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    !url.pathname.startsWith('/FJUD/')
  ) {
    throw new JudicialSourceError('source_changed', base.href)
  }
  return url
}

function requestOptions(cookie?: string) {
  return {
    timeout: 15_000,
    maxContentLength: REQUEST_LIMIT,
    maxBodyLength: REQUEST_LIMIT,
    maxRedirects: 0,
    validateStatus: (status: number) => status >= 200 && status < 300,
    responseType: 'text' as const,
    headers: {
      'User-Agent': 'judicial-mcp/1.5 (https://github.com/jurislm/judicial-mcp)',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  }
}

function upstreamFailure(error: unknown, url: URL): never {
  let status: number | undefined
  if (error !== null && typeof error === 'object' && 'response' in error) {
    const response = error.response
    if (response !== null && typeof response === 'object' && 'status' in response && typeof response.status === 'number') {
      status = response.status
    }
  }
  const code = status === 404 && url.pathname.endsWith('/data.aspx') ? 'source_not_found' : 'source_unavailable'
  throw new JudicialSourceError(code, url.href)
}

function sourceText(value: unknown, url: URL): string {
  if (typeof value !== 'string') throw new JudicialSourceError('source_changed', url.href)
  return value
}

function visibleBodyText(html: string): string {
  const $ = load(html)
  $('script, style, noscript').remove()
  return $('body').text()
}

function resultDate(text: string, caseId: string): string | null {
  const dateMatch = text.match(/(\d{2,4})[./年-](\d{1,2})[./月-](\d{1,2})/)
  const idMatch = caseId.split(',')[4]?.match(/^(\d{4})(\d{2})(\d{2})$/)
  const match = dateMatch ?? idMatch
  if (!match) return null
  const rawYear = Number(match[1])
  const year = rawYear < 1912 ? rawYear + 1911 : rawYear
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function caseIdFromLink(href: string, base: URL): string | undefined {
  const url = allowedOfficialUrl(href, base)
  if (url.pathname !== '/FJUD/data.aspx' || url.searchParams.get('ty') !== 'JD') return undefined
  const caseId = url.searchParams.get('id')
  if (!caseId || !/^[A-Za-z0-9]{2,8},\d{1,4},[^,<>/?#]+,[A-Za-z0-9-]+,\d{8}(?:,\d+)?$/.test(caseId)) return undefined
  return caseId
}

function parseResults(html: string, sourceUrl: URL, retrievedAt: string): JudgmentSearchResult[] {
  const $ = load(html)
  const noResults = NO_RESULTS.test(visibleBodyText(html))
  const table = $('table#jud, table.jub-table').first()
  if (!table.length) {
    if (noResults) return []
    throw new JudicialSourceError('source_changed', sourceUrl.href)
  }
  const results: JudgmentSearchResult[] = []
  table.find('tr').each((_, row) => {
    const currentRow = $(row)
    if (currentRow.hasClass('summary')) return
    const link = currentRow.find('a[href*="data.aspx"]').first()
    const href = link.attr('href')
    if (!href) return
    const caseId = caseIdFromLink(href, sourceUrl)
    if (!caseId) throw new JudicialSourceError('source_changed', sourceUrl.href)
    const cells = currentRow.find('td')
    if (cells.length < 4) throw new JudicialSourceError('source_changed', sourceUrl.href)
    const summaryRow = currentRow.next('tr.summary')
    const rawSummary = summaryRow.find('span.tdCut').text().trim()
    const summary = rawSummary.slice(0, MAX_SUMMARY_LENGTH)
    const date = resultDate(cells.eq(2).text(), caseId)
    const candidate: JudgmentSearchResult = {
      case_id: caseId,
      case_number: link.text().trim(),
      date,
      court: caseId.split(',')[0] ?? '',
      cause: cells.eq(3).text().trim(),
      source_url: judgmentUrl(caseId).href,
      search_source_url: sourceUrl.href,
      retrieved_at: retrievedAt,
      cache: { status: 'not_cached' },
      truncated: rawSummary.length > MAX_SUMMARY_LENGTH,
      partial: false,
      source_version: null,
    }
    if (summary) candidate.summary = summary
    results.push(candidate)
  })
  if (results.length === 0 && !noResults) throw new JudicialSourceError('source_changed', sourceUrl.href)
  return results
}

function hasNextPage(html: string, page: number): boolean {
  const $ = load(html)
  let found = false
  $('a[href]').each((_, anchor) => {
    const link = $(anchor)
    const label = link.text().trim()
    const href = link.attr('href') ?? ''
    if (/^(?:下一頁|下頁|next)$/i.test(label) || new URLSearchParams(href.split('?')[1] ?? '').get('page') === String(page + 1)) {
      found = true
    }
  })
  return found
}

function makeSearchResultUrl(iframeSource: string, page: number): URL {
  const url = allowedOfficialUrl(iframeSource, SEARCH_URL)
  if (url.pathname !== '/FJUD/qryresultlst.aspx') throw new JudicialSourceError('source_changed', SEARCH_URL.href)
  if (page > 1) url.searchParams.set('page', String(page))
  return url
}

function makeSearchErrorPageUrl(iframeSource: string): URL | undefined {
  const url = new URL(iframeSource, SEARCH_URL)
  if (
    url.origin !== SEARCH_URL.origin ||
    url.pathname !== '/ErrorPage.aspx' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash ||
    url.href.length > 2_048
  ) return undefined
  const parameters = [...url.searchParams.entries()]
  if (
    parameters.length !== 2 ||
    url.searchParams.getAll('frm').length !== 1 ||
    url.searchParams.getAll('err').length !== 1 ||
    !['FJUD', 'iframe'].includes(url.searchParams.get('frm') ?? '') ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(url.searchParams.get('err') ?? '')
  ) return undefined
  return url
}

function emptySearchResult(sourceUrl: URL, retrievedAt: string) {
  return {
    count: 0,
    ambiguous: false,
    results: [],
    source_url: sourceUrl.href,
    retrieved_at: retrievedAt,
    cache: { status: 'not_cached' as const },
    truncated: false,
    partial: false,
    next_page: null,
    next_offset: null,
    source_version: null,
  }
}

function validCaseId(value: string): boolean {
  return /^[A-Za-z0-9]{2,8},\d{1,4},[^,<>/?#]+,[A-Za-z0-9-]+,\d{8}(?:,\d+)?$/.test(value)
}

function judgmentUrl(caseId: string): URL {
  const url = new URL(DETAIL_URL.href)
  url.searchParams.set('ty', 'JD')
  url.searchParams.set('id', caseId)
  return url
}

export async function searchJudgments(args: Record<string, unknown>): Promise<unknown> {
  const criteria = parseCriteria(args)
  const retrievedAt = new Date().toISOString()
  let formResponse: AxiosResponse<string>
  try {
    formResponse = await axios.get<string>(SEARCH_URL.href, requestOptions())
  } catch (error: unknown) {
    upstreamFailure(error, SEARCH_URL)
  }
  const formHtml = sourceText(formResponse.data, SEARCH_URL)
  const cookie = readCookieHeader(formResponse.headers['set-cookie'])
  const fields = formFields(formHtml, criteria)
  let queryResponse: AxiosResponse<string>
  try {
    queryResponse = await axios.post<string>(SEARCH_URL.href, fields, {
      ...requestOptions(cookie),
      headers: {
        ...requestOptions(cookie).headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: SEARCH_URL.href,
      },
    })
  } catch (error: unknown) {
    upstreamFailure(error, SEARCH_URL)
  }
  const queryHtml = sourceText(queryResponse.data, SEARCH_URL)
  const $ = load(queryHtml)
  const iframeSource = $('iframe').first().attr('src')
  if (!iframeSource) {
    if (NO_RESULTS.test(visibleBodyText(queryHtml))) {
      return emptySearchResult(SEARCH_URL, retrievedAt)
    }
    throw new JudicialSourceError('source_changed', SEARCH_URL.href)
  }
  const errorPageUrl = makeSearchErrorPageUrl(iframeSource)
  if (errorPageUrl) {
    let errorPageResponse: AxiosResponse<string>
    try {
      errorPageResponse = await axios.get<string>(errorPageUrl.href, requestOptions())
    } catch (error: unknown) {
      upstreamFailure(error, errorPageUrl)
    }
    const errorPageHtml = sourceText(errorPageResponse.data, errorPageUrl)
    if (!NO_RESULTS.test(visibleBodyText(errorPageHtml))) {
      throw new JudicialSourceError('source_changed', errorPageUrl.href)
    }
    return emptySearchResult(errorPageUrl, retrievedAt)
  }
  const resultUrl = makeSearchResultUrl(iframeSource, criteria.page)
  let resultResponse: AxiosResponse<string>
  try {
    resultResponse = await axios.get<string>(resultUrl.href, requestOptions(cookie))
  } catch (error: unknown) {
    upstreamFailure(error, resultUrl)
  }
  const resultsHtml = sourceText(resultResponse.data, resultUrl)
  const allResults = parseResults(resultsHtml, resultUrl, retrievedAt)
  const sourceHasNextPage = hasNextPage(resultsHtml, criteria.page)
  const pageHasNext = sourceHasNextPage && criteria.page < MAX_PAGE
  const pageResults = allResults.slice(criteria.offset, criteria.offset + criteria.limit)
  const hasMoreOnPage = allResults.length > criteria.offset + criteria.limit
  const truncated = hasMoreOnPage || sourceHasNextPage || pageResults.some(result => result.truncated)
  const ambiguous = Boolean(
    criteria.caseNumber && (allResults.length > 1 || criteria.page > 1 || criteria.offset > 0 || sourceHasNextPage),
  )
  const hasMoreResults = hasMoreOnPage || sourceHasNextPage
  const hasNextPageResult = hasMoreOnPage || pageHasNext
  return {
    count: pageResults.length,
    ambiguous,
    results: pageResults,
    source_url: resultUrl.href,
    retrieved_at: retrievedAt,
    cache: { status: 'not_cached' },
    truncated,
    partial: hasMoreResults && !hasNextPageResult,
    next_page: hasMoreOnPage ? criteria.page : pageHasNext ? criteria.page + 1 : null,
    next_offset: hasMoreOnPage ? criteria.offset + criteria.limit : pageHasNext ? 0 : null,
    source_version: null,
  }
}

export async function fetchJudgmentText(args: Record<string, unknown>): Promise<unknown> {
  const caseId = optionalString(args, 'caseId', 180)
  if (!caseId || !validCaseId(caseId)) throw new Error('caseId 必須是司法院裁判書來源提供的裁判 ID')
  const url = judgmentUrl(caseId)
  let response: AxiosResponse<string>
  try {
    response = await axios.get<string>(url.href, requestOptions())
  } catch (error: unknown) {
    upstreamFailure(error, url)
  }
  const html = sourceText(response.data, url)
  const $ = load(html)
  const noResults = NO_RESULTS.test(visibleBodyText(html))
  const judgment = $('#jud').first()
  if (!judgment.length) {
    throw new JudicialSourceError(noResults ? 'source_not_found' : 'source_changed', url.href)
  }
  judgment.find('br').replaceWith('\n')
  judgment.find('div, p, tr').each((_, element) => {
    $(element).append('\n')
  })
  const fullText = judgment.text()
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!fullText) throw new JudicialSourceError(noResults ? 'source_not_found' : 'source_changed', url.href)
  const truncated = fullText.length > MAX_TEXT_LENGTH
  return {
    case_id: caseId,
    date: resultDate('', caseId),
    full_text: fullText.slice(0, MAX_TEXT_LENGTH),
    source_url: url.href,
    retrieved_at: new Date().toISOString(),
    cache: { status: 'not_cached' },
    truncated,
    partial: truncated,
    source_version: null,
  }
}
