import axios, { type AxiosResponse } from 'axios'
import { load } from 'cheerio'
import {
  deleteRegulationCacheEntry,
  getRegulationCacheEntry,
  setRegulationCacheEntry,
  type RegulationCacheEntry,
} from './regulation-cache.js'
import { RegulationSourceError } from './source-error.js'

const BASE_URL = 'https://law.moj.gov.tw'
const SEARCH_URL = new URL('/Law/LawSearchResult.aspx', BASE_URL)
const RESPONSE_LIMIT = 2_000_000
const MAX_ARTICLE_LENGTH = 30_000
const MAX_CANDIDATES = 10
const RESPONSE_TYPE: 'text' = 'text'
const NO_RESULTS = /查無.{0,16}(?:法規|資料|符合)|沒有符合條件的法規/

interface RegulationCandidate {
  name: string
  identifier: string
  abolished: boolean
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
  return value.trim().replace(/^0+(?=\d)/, '')
}

function validateRefresh(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new Error('refresh 必須是布林值')
  return value
}

function normalizeName(value: string): string {
  return value.replaceAll('台', '臺').replaceAll(/\s+/g, '').toLocaleLowerCase()
}

function searchUrl(name: string): URL {
  const url = new URL(SEARCH_URL.href)
  url.searchParams.set('cur', 'Ld')
  url.searchParams.set('ty', 'ONEBAR')
  url.searchParams.set('kw', name)
  url.searchParams.set('psize', '20')
  return url
}

function detailUrl(identifier: string): URL {
  const url = new URL('/LawClass/LawAll.aspx', BASE_URL)
  url.searchParams.set('pcode', identifier)
  return url
}

function requestOptions(conditional?: { etag?: string; lastModified?: string }) {
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': 'judicial-mcp/1.5 (https://github.com/jurislm/judicial-mcp)',
  }
  if (conditional?.etag) headers['If-None-Match'] = conditional.etag
  if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified
  return {
    timeout: 15_000,
    maxContentLength: RESPONSE_LIMIT,
    maxBodyLength: RESPONSE_LIMIT,
    maxRedirects: 0,
    responseType: RESPONSE_TYPE,
    validateStatus: (status: number) => (status >= 200 && status < 300) || status === 304,
    headers,
  }
}

function responseHeader(response: AxiosResponse<string>, name: string): string | undefined {
  const value = response.headers[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function sourceFailure(error: unknown, url: URL): never {
  const status = error !== null && typeof error === 'object' && 'response' in error
    ? (error.response !== null && typeof error.response === 'object' && 'status' in error.response
      ? error.response.status
      : undefined)
    : undefined
  throw new RegulationSourceError(status === 404 ? 'regulation_not_found' : 'source_unavailable', url.href)
}

function responseHtml(response: AxiosResponse<string>, url: URL): string {
  if (typeof response.data !== 'string' || response.data.length > RESPONSE_LIMIT) {
    throw new RegulationSourceError('source_changed', url.href)
  }
  return response.data
}

function validPcode(value: string | undefined): value is string {
  return value !== undefined && /^[A-Z]\d{7}$/.test(value.toLocaleUpperCase())
}

function parseCandidates(html: string, url: URL): RegulationCandidate[] {
  const $ = load(html)
  const candidates: RegulationCandidate[] = []
  $('a[href*="LawAll.aspx"]').each((_, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')
    if (!href) return
    let link: URL
    try {
      link = new URL(href, url)
    } catch {
      throw new RegulationSourceError('source_changed', url.href)
    }
    if (link.protocol !== 'https:' || link.hostname !== 'law.moj.gov.tw' || link.pathname.toLocaleLowerCase() !== '/lawclass/lawall.aspx') {
      throw new RegulationSourceError('source_changed', url.href)
    }
    const identifier = link.searchParams.get('pcode') ?? link.searchParams.get('PCODE')
    if (!identifier || !validPcode(identifier)) throw new RegulationSourceError('source_changed', url.href)
    const displayName = anchor.text().replaceAll(/\s+/g, ' ').trim()
    if (!displayName) throw new RegulationSourceError('source_changed', url.href)
    const row = anchor.closest('tr')
    const rowText = (row.length ? row.text() : anchor.parent().text()).replaceAll(/\s+/g, ' ').trim()
    const abolished = /^廢\s+/.test(displayName) || /^廢(?!棄)/.test(displayName) || /(?:法規狀態|狀態)\s*[:：]?\s*(?:已)?廢止/.test(rowText)
    const name = abolished ? displayName.replace(/^廢(?:止)?\s*/, '').trim() : displayName
    const normalizedIdentifier = identifier.toLocaleUpperCase()
    const duplicate = candidates.find(candidate => candidate.identifier === normalizedIdentifier && normalizeName(candidate.name) === normalizeName(name))
    if (duplicate) duplicate.abolished = duplicate.abolished || abolished
    else candidates.push({ name, identifier: normalizedIdentifier, abolished })
  })
  if (candidates.length === 0 && !NO_RESULTS.test($('body').text())) {
    throw new RegulationSourceError('source_changed', url.href)
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

function articleBlockText(block: ArticleBlock, articleNumber: string): string | undefined {
  const heading = block.find('.col-no, .law-reg-no, .article-number').first().text().trim()
  if (!heading || !new RegExp(`^第\\s*${articleNumber.replace('-', '\\-')}\\s*條`).test(heading)) return undefined
  const content = block.find('.col-data, .law-reg-content-text, .article-content').first()
  if (!content.length) return undefined
  const html = content.html()
  if (html === null) return undefined
  return normalizeArticleHtml(html)
}

function parseArticle(html: string, url: URL, lawName: string, articleNumber: string): ParsedArticle {
  const $ = load(html)
  const pageText = normalizeArticleText($('main, #content, #law_content').first().text() || $('body').text())
  if (!pageText || !normalizeName(pageText).includes(normalizeName(lawName))) {
    throw new RegulationSourceError('source_changed', url.href)
  }
  let articleText: string | undefined
  const blocks = $('.law-reg-content, .law-article, .article-content-row, [id^="law-reg-content"]').toArray()
  for (const block of blocks) {
    articleText = articleBlockText($(block), articleNumber)
    if (articleText) break
  }
  if (!articleText) {
    if (/查無|無此條文|無此法規/.test(pageText)) {
      throw new RegulationSourceError('regulation_article_not_found', url.href)
    }
    throw new RegulationSourceError('source_changed', url.href)
  }
  const metadataText = regulationMetadataText(pageText)
  const version: RegulationVersion = {
    amendment_date: dateForLabel(metadataText, ['修正日期', '修正日']),
    promulgation_date: dateForLabel(metadataText, ['公布日期', '發布日期']),
    effective_date: dateForLabel(metadataText, ['施行日期', '生效日期']),
    effective_status: /尚未生效|尚未施行|最後生效日期：未定/.test(metadataText) ? 'pending_or_mixed' : 'as_stated',
  }
  if (/最後生效日期：未定/.test(metadataText) && version.effective_date === null) {
    version.effective_status = 'unknown'
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

async function fetchHtml(url: URL, cacheEntry?: Pick<ValidatedRegulationCacheEntry, 'etag' | 'lastModified'>): Promise<{
  response: AxiosResponse<string>
  html: string | null
}> {
  let response: AxiosResponse<string>
  try {
    response = await axios.get<string>(url.href, requestOptions(cacheEntry))
  } catch (error: unknown) {
    sourceFailure(error, url)
  }
  if (response.status === 304) return { response, html: null }
  return { response, html: responseHtml(response, url) }
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

  if (cached && cached.expiresAt > now && !refresh) {
    return resultWithCacheStatus(cached.value, 'hit')
  }

  if (refresh) deleteRegulationCacheEntry(key)
  if (cached && cached.expiresAt <= now && !refresh) {
    const lookupURL = searchUrl(lawName)
    const checkedAt = new Date().toISOString()
    try {
      const lookup = await fetchHtml(lookupURL)
      if (lookup.html === null) throw new RegulationSourceError('source_changed', lookupURL.href)
      const resolution = resolveCandidate(parseCandidates(lookup.html, lookupURL), lawName, lookupURL)
      if ('ambiguous' in resolution) {
        deleteRegulationCacheEntry(key)
        return resolution.ambiguous
      }
      const candidate = resolution.candidate
      if (candidate.abolished) throw new RegulationSourceError('regulation_abolished', lookupURL.href)
      const detailURL = detailUrl(candidate.identifier)
      const reusableValidators = candidate.identifier === cached.value.regulation_id ? cached : undefined
      const fetched = await fetchHtml(detailURL, reusableValidators)
      let result: RegulationResult
      if (fetched.html === null) {
        if (candidate.identifier !== cached.value.regulation_id) {
          throw new RegulationSourceError('source_changed', detailURL.href)
        }
        result = {
          ...cached.value,
          regulation_name: candidate.name,
          source_url: detailURL.href,
          search_source_url: lookupURL.href,
          retrieved_at: checkedAt,
          cache: { status: 'revalidated' },
        }
      } else {
        const article = parseArticle(fetched.html, detailURL, candidate.name, articleNumber)
        result = makeResult(candidate, articleNumber, article, detailURL, lookupURL, checkedAt, 'revalidated')
      }
      setRegulationCacheEntry(key, {
        value: result,
        etag: responseHeader(fetched.response, 'etag') ?? cached.etag,
        lastModified: responseHeader(fetched.response, 'last-modified') ?? cached.lastModified,
      }, now)
      return result
    } catch (error: unknown) {
      deleteRegulationCacheEntry(key)
      throw error
    }
  }

  const lookupURL = searchUrl(lawName)
  const lookup = await fetchHtml(lookupURL)
  if (lookup.html === null) throw new RegulationSourceError('source_changed', lookupURL.href)
  const candidates = parseCandidates(lookup.html, lookupURL)
  const resolution = resolveCandidate(candidates, lawName, lookupURL)
  if ('ambiguous' in resolution) return resolution.ambiguous
  const candidate = resolution.candidate
  if (candidate.abolished) throw new RegulationSourceError('regulation_abolished', lookupURL.href)

  const articleURL = detailUrl(candidate.identifier)
  const fetched = await fetchHtml(articleURL)
  if (fetched.html === null) throw new RegulationSourceError('source_changed', articleURL.href)
  const article = parseArticle(fetched.html, articleURL, candidate.name, articleNumber)
  const retrievedAt = new Date().toISOString()
  const result = makeResult(candidate, articleNumber, article, articleURL, lookupURL, retrievedAt, refresh ? 'refreshed' : 'miss')
  setRegulationCacheEntry(key, {
    value: result,
    etag: responseHeader(fetched.response, 'etag'),
    lastModified: responseHeader(fetched.response, 'last-modified'),
  }, now)
  return result
}
