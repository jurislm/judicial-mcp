import axios, { type AxiosResponse } from 'axios'
import { load } from 'cheerio'
import {
  deleteRegulationCacheEntry,
  getRegulationCacheEntry,
  setRegulationCacheEntry,
  type RegulationCacheEntry,
} from './regulation-cache.js'
import { RegulationSourceError } from './source-error.js'
import { resolveArticleEffectiveness, type ArticleEffectiveness } from './article-effectiveness.js'

const BASE_URL = 'https://law.moj.gov.tw'
const TERM_URL = new URL('/controls/GetTermList.ashx', BASE_URL)
const RESPONSE_LIMIT = 2_000_000
const FIRECRAWL_TIMEOUT_MS = 30_000
const FIRECRAWL_REQUEST_TIMEOUT_MS = 40_000
const MAX_ARTICLE_LENGTH = 30_000
const MAX_CANDIDATES = 10
const RESPONSE_TYPE: 'text' = 'text'

interface RegulationCandidate {
  name: string
  identifier: string
}

interface RegulationVersion {
  amendment_date: string | null
  promulgation_date: string | null
  effective_date: string | null
  effective_status: 'as_stated' | 'pending_or_mixed' | 'unknown'
}

interface RegulationResult {
  status: 'current' | 'ambiguous'
  regulation_name?: string
  regulation_id?: string
  article_number?: string
  article_text?: string
  article_text_version?: 'latest_promulgated'
  article_effectiveness?: ArticleEffectiveness
  version?: RegulationVersion
  candidates?: Array<{ regulation_name: string; regulation_id: string }>
  source_url: string
  search_source_url: string
  retrieved_at: string
  cache: { status: 'miss' | 'hit' | 'refreshed' | 'revalidated' | 'not_cached' }
  truncated: boolean
  partial: boolean
  source_version: string | null
}

interface ParsedArticle {
  text: string
  version: RegulationVersion
}

type CandidateResolution = { candidate: RegulationCandidate } | { ambiguous: RegulationResult }

type ValidatedRegulationCacheEntry = Omit<RegulationCacheEntry, 'value'> & { value: RegulationResult }

interface ArticleBlock {
  find(selector: string): { first(): { text(): string; html(): string | null; length: number }; length: number }
  text(): string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNullableDate(value: unknown): boolean {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function isRegulationResult(value: unknown): value is RegulationResult {
  if (!isRecord(value) || value.status !== 'current') return false
  if (!isRecord(value.cache) || !isRecord(value.version)) return false
  const cacheStatus = value.cache.status
  const effectiveStatus = value.version.effective_status
  if (!isRecord(value.article_effectiveness) || typeof value.article_effectiveness.checked_at !== 'string') return false
  return typeof value.regulation_name === 'string' &&
    typeof value.regulation_id === 'string' &&
    typeof value.article_number === 'string' &&
    typeof value.article_text === 'string' &&
    isNullableDate(value.version.amendment_date) &&
    isNullableDate(value.version.promulgation_date) &&
    isNullableDate(value.version.effective_date) &&
    (effectiveStatus === 'as_stated' || effectiveStatus === 'pending_or_mixed' || effectiveStatus === 'unknown') &&
    typeof value.source_url === 'string' &&
    typeof value.search_source_url === 'string' &&
    typeof value.retrieved_at === 'string' &&
    (cacheStatus === 'miss' || cacheStatus === 'hit' || cacheStatus === 'refreshed' || cacheStatus === 'revalidated') &&
    typeof value.truncated === 'boolean' &&
    typeof value.partial === 'boolean' &&
    (value.source_version === null || typeof value.source_version === 'string')
}

function validateName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 120) {
    throw new Error('lawName 必須是 1 至 120 個字元的法規名稱')
  }
  return value.trim()
}

function validateArticleNumber(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,5}(?:-\d{1,5})?$/.test(value.trim())) {
    throw new Error('articleNumber 必須使用阿拉伯數字，可含連字號，例如 1 或 1-1')
  }
  return value.trim().split('-').map(part => part.replace(/^0+(?=\d)/, '')).join('-')
}

function validateRefresh(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new Error('refresh 必須是布林值')
  return value
}

function normalizeName(value: string): string {
  return value.replaceAll('台', '臺').replaceAll(/\s+/g, '').toLocaleLowerCase()
}

function termUrl(name: string): URL {
  const url = new URL(TERM_URL.href)
  url.searchParams.set('term', name)
  url.searchParams.set('type', 'ONEBAR')
  return url
}

function detailUrl(identifier: string): URL {
  const url = new URL('/LawClass/LawAll.aspx', BASE_URL)
  url.searchParams.set('pcode', identifier)
  return url
}

function termRequestOptions() {
  return {
    timeout: 15_000,
    maxContentLength: RESPONSE_LIMIT,
    maxBodyLength: RESPONSE_LIMIT,
    maxRedirects: 0,
    responseType: RESPONSE_TYPE,
    validateStatus: (status: number) => status >= 200 && status < 300,
    headers: {
      Accept: 'application/json,text/plain',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'judicial-mcp/1.5 (https://github.com/jurislm/judicial-mcp)',
    },
  }
}

function firecrawlEndpoint(sourceUrl: URL): { endpoint: URL; apiKey?: string } {
  const configuredUrl = process.env.FIRECRAWL_API_URL?.trim()
  if (!configuredUrl) throw new RegulationSourceError('source_unavailable', sourceUrl.href)
  let endpoint: URL
  try {
    endpoint = new URL(configuredUrl)
  } catch {
    throw new RegulationSourceError('source_unavailable', sourceUrl.href)
  }
  if (
    (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
    endpoint.username.length > 0 || endpoint.password.length > 0 ||
    endpoint.search.length > 0 || endpoint.hash.length > 0
  ) throw new RegulationSourceError('source_unavailable', sourceUrl.href)
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  if (apiKey && endpoint.protocol === 'http:' && !loopbackHosts.has(endpoint.hostname.toLocaleLowerCase())) {
    throw new RegulationSourceError('source_unavailable', sourceUrl.href)
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/v1/scrape`
  return apiKey ? { endpoint, apiKey } : { endpoint }
}

function firecrawlRequestOptions(apiKey?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return {
    timeout: FIRECRAWL_REQUEST_TIMEOUT_MS,
    maxContentLength: RESPONSE_LIMIT,
    maxBodyLength: RESPONSE_LIMIT,
    maxRedirects: 0,
    validateStatus: (status: number) => status >= 200 && status < 300,
    headers,
  }
}

function sourceFailure(error: unknown, url: URL, notFoundOn404 = true): never {
  const status = error !== null && typeof error === 'object' && 'response' in error
    ? (error.response !== null && typeof error.response === 'object' && 'status' in error.response
      ? error.response.status
      : undefined)
    : undefined
  throw new RegulationSourceError(status === 404 && notFoundOn404 ? 'regulation_not_found' : 'source_unavailable', url.href)
}

function responseText(response: AxiosResponse<string>, url: URL): string {
  if (typeof response.data !== 'string' || response.data.length > RESPONSE_LIMIT) {
    throw new RegulationSourceError('source_changed', url.href)
  }
  return response.data
}

function responseHtml(payload: unknown, url: URL): string {
  if (!isRecord(payload)) throw new RegulationSourceError('source_changed', url.href)
  if (payload.success !== true) throw new RegulationSourceError('source_unavailable', url.href)
  if (!isRecord(payload.data) || typeof payload.data.rawHtml !== 'string' || payload.data.rawHtml.length === 0 || payload.data.rawHtml.length > RESPONSE_LIMIT) {
    throw new RegulationSourceError('source_changed', url.href)
  }
  const metadata = payload.data.metadata
  if (!isRecord(metadata) || typeof metadata.sourceURL !== 'string') {
    throw new RegulationSourceError('source_changed', url.href)
  }
  let resolvedUrl: URL
  try {
    resolvedUrl = new URL(metadata.sourceURL)
  } catch {
    throw new RegulationSourceError('source_changed', url.href)
  }
  const requestedPcode = url.searchParams.get('pcode')
  const sourceParameters = [...resolvedUrl.searchParams.entries()]
  if (
    resolvedUrl.origin !== url.origin ||
    resolvedUrl.username.length > 0 ||
    resolvedUrl.password.length > 0 ||
    resolvedUrl.pathname !== url.pathname ||
    resolvedUrl.hash.length > 0 ||
    requestedPcode === null ||
    sourceParameters.length !== 1 ||
    resolvedUrl.searchParams.getAll('pcode').length !== 1 ||
    resolvedUrl.searchParams.get('pcode') !== requestedPcode
  ) {
    throw new RegulationSourceError('source_changed', url.href)
  }
  return payload.data.rawHtml
}

function validPcode(value: string | undefined): value is string {
  return value !== undefined && /^[A-Z]\d{7}$/.test(value.toLocaleUpperCase())
}

function parseTermCandidates(payload: string, url: URL): RegulationCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new RegulationSourceError('source_changed', url.href)
  }
  if (!Array.isArray(parsed)) throw new RegulationSourceError('source_changed', url.href)
  const candidates: RegulationCandidate[] = []
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.PCODE !== 'string' || typeof item.TERM !== 'string') {
      throw new RegulationSourceError('source_changed', url.href)
    }
    const identifier = item.PCODE.trim()
    const name = item.TERM.replaceAll(/\s+/g, ' ').trim()
    if (identifier.length === 0 || name.length === 0) continue
    if (!validPcode(identifier)) throw new RegulationSourceError('source_changed', url.href)
    const normalizedIdentifier = identifier.toLocaleUpperCase()
    const duplicate = candidates.find(candidate => candidate.identifier === normalizedIdentifier && normalizeName(candidate.name) === normalizeName(name))
    if (!duplicate) candidates.push({ name, identifier: normalizedIdentifier })
  }
  return candidates
}

function parseRocDate(value: string): string | null {
  const match = value.match(/民國\s*(\d{1,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (!match) return null
  const year = Number(match[1]) + 1911
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
  ) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateForLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = text.match(new RegExp(`${escaped}\\s*[:：]?\\s*(?:\\|\\s*)?(民國\\s*\\d{1,3}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日)`))
    if (match?.[1]) return parseRocDate(match[1])
  }
  return null
}

function normalizeArticleText(value: string): string {
  return value
    .replaceAll('\u00a0', ' ')
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/\s*\n\s*/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeArticleHtml(value: string): string {
  const $ = load(`<div>${value}</div>`)
  $('script, style').remove()
  $('br').replaceWith('\n')
  $('p, li').each((_, element) => {
    $(element).prepend('\n').append('\n')
  })
  return normalizeArticleText($('div').first().text())
}

function regulationMetadataText(pageText: string): string {
  const firstArticle = pageText.search(/第\s*\d+(?:-\d+)?\s*條/)
  return firstArticle < 0 ? pageText : pageText.slice(0, firstArticle)
}

function articleHeading(block: ArticleBlock): string {
  const heading = block.find('.col-no, .law-reg-no, .article-number').first()
  const html = heading.html()
  if (html !== null) {
    const $heading = load(`<div>${html}</div>`)
    let linkedHeading: string | undefined
    $heading('a').each((_, anchor) => {
      const text = $heading(anchor).text().trim()
      if (!linkedHeading && /^第\s*\d+(?:-\d+)?\s*條$/.test(text)) linkedHeading = text
    })
    if (linkedHeading) return linkedHeading
  }
  return heading.text().trim()
}

function articleBlockText(block: ArticleBlock, articleNumber: string): string | undefined {
  const heading = articleHeading(block)
  if (!heading || !new RegExp(`^第\\s*${articleNumber.replace('-', '\\-')}\\s*條`).test(heading)) return undefined
  const content = block.find('.col-data, .law-reg-content-text, .article-content').first()
  if (!content.length) return undefined
  const html = content.html()
  if (html === null) return undefined
  return normalizeArticleHtml(html)
}

function isArticleBlock(block: ArticleBlock): boolean {
  const heading = articleHeading(block)
  const content = block.find('.col-data, .law-reg-content-text, .article-content').first()
  return /^第\s*\d+(?:-\d+)?\s*條/.test(heading) && content.length > 0 && content.text().trim().length > 0
}

function parseArticle(html: string, url: URL, lawName: string, articleNumber: string): ParsedArticle {
  const $ = load(html)
  const pageText = normalizeArticleText($('main, #content, #law_content').first().text() || $('body').text())
  const metadataText = regulationMetadataText(pageText)
  if (/法規名稱\s*[:：]\s*廢\s/.test(metadataText) || /廢止日期\s*[:：]/.test(metadataText)) {
    throw new RegulationSourceError('regulation_abolished', url.href)
  }
  if (!pageText || !normalizeName(pageText).includes(normalizeName(lawName))) {
    throw new RegulationSourceError('source_changed', url.href)
  }
  let articleText: string | undefined
  const numberedRows = $('.law-reg-content > .row').toArray()
  const blocks = numberedRows.length > 0
    ? numberedRows
    : $('.law-reg-content, .law-article, .article-content-row, [id^="law-reg-content"]').toArray()
  if (blocks.length === 0 || blocks.some(block => !isArticleBlock($(block)))) {
    throw new RegulationSourceError('source_changed', url.href)
  }
  for (const block of blocks) {
    articleText = articleBlockText($(block), articleNumber)
    if (articleText) break
  }
  if (!articleText) {
    throw new RegulationSourceError('regulation_article_not_found', url.href)
  }
  const effectiveDate = dateForLabel(metadataText, ['施行日期', '生效日期'])
  const version: RegulationVersion = {
    amendment_date: dateForLabel(metadataText, ['修正日期', '修正日']),
    promulgation_date: dateForLabel(metadataText, ['公布日期', '發布日期']),
    effective_date: effectiveDate,
    effective_status: /尚未生效|尚未施行/.test(metadataText)
      ? 'pending_or_mixed'
      : effectiveDate === null ? 'unknown' : 'as_stated',
  }
  return { text: articleText, version }
}

function makeResult(
  candidate: RegulationCandidate,
  articleNumber: string,
  article: ParsedArticle,
  sourceUrl: URL,
  searchSourceUrl: URL,
  retrievedAt: string,
  cacheStatus: RegulationResult['cache']['status'],
  articleEffectiveness: ArticleEffectiveness,
): RegulationResult {
  const truncated = article.text.length > MAX_ARTICLE_LENGTH
  const missingDates = article.version.amendment_date === null ||
    article.version.promulgation_date === null || article.version.effective_date === null
  const text = article.text.slice(0, MAX_ARTICLE_LENGTH)
  return {
    status: 'current',
    regulation_name: candidate.name,
    regulation_id: candidate.identifier,
    article_number: articleNumber,
    article_text: text,
    article_text_version: 'latest_promulgated',
    article_effectiveness: articleEffectiveness,
    version: article.version,
    source_url: sourceUrl.href,
    search_source_url: searchSourceUrl.href,
    retrieved_at: retrievedAt,
    cache: { status: cacheStatus },
    truncated,
    partial: truncated || missingDates || article.version.effective_status !== 'as_stated',
    source_version: article.version.amendment_date ?? article.version.promulgation_date,
  }
}

function resultWithCacheStatus(result: RegulationResult, status: RegulationResult['cache']['status'], retrievedAt = result.retrieved_at): RegulationResult {
  return { ...result, retrieved_at: retrievedAt, cache: { status } }
}

function cacheKey(lawName: string, articleNumber: string): string {
  return `${normalizeName(lawName)}\u0000${articleNumber}`
}

function ambiguousResult(candidates: RegulationCandidate[], lookupURL: URL): RegulationResult {
  return {
    status: 'ambiguous',
    candidates: candidates.slice(0, MAX_CANDIDATES).map(candidate => ({ regulation_name: candidate.name, regulation_id: candidate.identifier })),
    source_url: lookupURL.href,
    search_source_url: lookupURL.href,
    retrieved_at: new Date().toISOString(),
    cache: { status: 'not_cached' },
    truncated: candidates.length > MAX_CANDIDATES,
    partial: true,
    source_version: null,
  }
}

function resolveCandidate(candidates: RegulationCandidate[], lawName: string, lookupURL: URL): CandidateResolution {
  const requested = normalizeName(lawName)
  const exact = candidates.filter(candidate => normalizeName(candidate.name) === requested)
  if (exact.length === 1) {
    const candidate = exact[0]
    if (candidate) return { candidate }
    throw new RegulationSourceError('source_changed', lookupURL.href)
  }
  if (candidates.length === 0) throw new RegulationSourceError('regulation_not_found', lookupURL.href)
  return { ambiguous: ambiguousResult(exact.length > 1 ? exact : candidates, lookupURL) }
}

async function fetchHtml(url: URL): Promise<string> {
  const { endpoint, apiKey } = firecrawlEndpoint(url)
  let response: AxiosResponse<unknown>
  try {
    response = await axios.post<unknown>(
      endpoint.href,
      {
        url: url.href,
        formats: ['rawHtml'],
        onlyMainContent: false,
        timeout: FIRECRAWL_TIMEOUT_MS,
      },
      firecrawlRequestOptions(apiKey),
    )
  } catch (error: unknown) {
    sourceFailure(error, url, false)
  }
  return responseHtml(response.data, url)
}

async function fetchTermCandidates(name: string, url: URL): Promise<RegulationCandidate[]> {
  let response: AxiosResponse<string>
  try {
    const options = termRequestOptions()
    response = await axios.post<string>(
      url.href,
      new URLSearchParams({ term: name, type: 'ONEBAR' }).toString(),
      options,
    )
  } catch (error: unknown) {
    sourceFailure(error, url, false)
  }
  if (response.status < 200 || response.status >= 300) throw new RegulationSourceError('source_changed', url.href)
  return parseTermCandidates(responseText(response, url), url)
}

async function lookupRegulation(lawName: string): Promise<{ resolution: CandidateResolution; lookupURL: URL }> {
  const directURL = termUrl(lawName)
  const directCandidates = await fetchTermCandidates(lawName, directURL)
  return { resolution: resolveCandidate(directCandidates, lawName, directURL), lookupURL: directURL }
}

function taiwanDate(value: number | string): string {
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function articleEffectiveness(html: string, articleText: string, candidate: RegulationCandidate, articleNumber: string, checkedAt: string): Promise<ArticleEffectiveness> {
  const url = detailUrl(candidate.identifier)
  url.pathname = '/LawClass/LawHistory.aspx'
  try {
    const historyHtml = await fetchHtml(url)
    return resolveArticleEffectiveness({ historyHtml, articleHtml: html, articleText, lawName: candidate.name, articleNumber, checkedAt, sourceUrl: url.href })
  } catch {
    return { status: 'unknown', effective_date: null, reason: '無法取得或驗證官方沿革，無法確認本條文版本是否生效。', basis: [], checked_at: checkedAt }
  }
}

export async function queryRegulation(args: Record<string, unknown>): Promise<RegulationResult> {
  const lawName = validateName(args.lawName)
  const articleNumber = validateArticleNumber(args.articleNumber)
  const refresh = validateRefresh(args.refresh)
  const key = cacheKey(lawName, articleNumber)
  const now = Date.now()
  const rawCached = getRegulationCacheEntry(key)
  let cached: ValidatedRegulationCacheEntry | undefined
  if (rawCached) {
    if (isRegulationResult(rawCached.value)) cached = { ...rawCached, value: rawCached.value }
    else deleteRegulationCacheEntry(key)
  }

  const sameDate = cached?.value.article_effectiveness && taiwanDate(cached.value.article_effectiveness.checked_at) === taiwanDate(now)
  if (cached && cached.expiresAt > now && sameDate && !refresh) {
    return resultWithCacheStatus(cached.value, 'hit')
  }

  if (refresh) deleteRegulationCacheEntry(key)
  if (cached && (cached.expiresAt <= now || !sameDate) && !refresh) {
    const checkedAt = new Date().toISOString()
    try {
      const lookup = await lookupRegulation(lawName)
      const { lookupURL, resolution } = lookup
      if ('ambiguous' in resolution) {
        deleteRegulationCacheEntry(key)
        return resolution.ambiguous
      }
      const candidate = resolution.candidate
      const detailURL = detailUrl(candidate.identifier)
      const html = await fetchHtml(detailURL)
      const article = parseArticle(html, detailURL, candidate.name, articleNumber)
      const effectiveness = await articleEffectiveness(html, article.text, candidate, articleNumber, checkedAt)
      const result = makeResult(candidate, articleNumber, article, detailURL, lookupURL, checkedAt, 'revalidated', effectiveness)
      setRegulationCacheEntry(key, { value: result }, now)
      return result
    } catch (error: unknown) {
      deleteRegulationCacheEntry(key)
      throw error
    }
  }

  const lookup = await lookupRegulation(lawName)
  const { lookupURL, resolution } = lookup
  if ('ambiguous' in resolution) return resolution.ambiguous
  const candidate = resolution.candidate

  const articleURL = detailUrl(candidate.identifier)
  const html = await fetchHtml(articleURL)
  const article = parseArticle(html, articleURL, candidate.name, articleNumber)
  const retrievedAt = new Date().toISOString()
  const effectiveness = await articleEffectiveness(html, article.text, candidate, articleNumber, retrievedAt)
  const result = makeResult(candidate, articleNumber, article, articleURL, lookupURL, retrievedAt, refresh ? 'refreshed' : 'miss', effectiveness)
  setRegulationCacheEntry(key, { value: result }, now)
  return result
}
