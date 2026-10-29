import { load, type CheerioAPI } from 'cheerio'

export interface ArticleEffectiveness {
  status: 'effective' | 'not_yet_effective' | 'unknown'
  effective_date: string | null
  reason: string
  basis: Array<{ source_url: string; text: string }>
  checked_at: string
}

interface ResolverInput {
  historyHtml: string
  articleHtml: string
  articleText: string
  lawName: string
  articleNumber: string
  checkedAt: string
  sourceUrl: string
}

interface HistoryRecord {
  text: string
  date: string | null
}

const NUMERALS = '〇零一二三四五六七八九十百千兩0-9'
const DATE_PATTERN = `(?:中華民國|民國)?([${NUMERALS}]+)年([${NUMERALS}]+)月([${NUMERALS}]+)日`
const ARTICLE_NUMBER = '[0-9]+(?:-[0-9]+)?'
const ARTICLE_RANGE = `${ARTICLE_NUMBER}(?:[～~至]${ARTICLE_NUMBER})?`
const ARTICLE_LIST = `(${ARTICLE_RANGE}(?:[、，,]${ARTICLE_RANGE})*)`
const COMPLETE_LIST = new RegExp(`^${ARTICLE_LIST}$`)

function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

function chineseNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  const digits: Record<string, number> = { '〇': 0, '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
  let result = 0
  let digit = 0
  let lastUnit = Infinity
  for (const char of text) {
    if (char in digits) {
      digit = digits[char] ?? 0
      continue
    }
    const unit = char === '十' ? 10 : char === '百' ? 100 : char === '千' ? 1000 : 0
    if (!unit || unit >= lastUnit) return null
    result += (digit || 1) * unit
    digit = 0
    lastUnit = unit
  }
  const number = result + digit
  const canonical = chineseNumeral(number)
  const normalized = text.replaceAll('〇', '零').replaceAll('兩', '二')
  return normalized === canonical || normalized === canonical.replace('百一十', '百十') ? number : null
}

function chineseNumeral(number: number): string {
  if (number === 0) return '零'
  const names = '零一二三四五六七八九'
  let result = ''
  let remainder = number
  let zero = false
  for (const [unit, label] of [[1000, '千'], [100, '百'], [10, '十'], [1, '']] satisfies Array<[number, string]>) {
    const digit = Math.floor(remainder / unit)
    remainder %= unit
    if (digit) {
      result += (zero ? '零' : '') + names[digit] + label
      zero = false
    } else if (result && remainder) zero = true
  }
  return result.replace(/^一十/, '十')
}

function parseDate(text: string): string | null {
  const match = compact(text).match(new RegExp(DATE_PATTERN))
  if (!match) return null
  const year = chineseNumber(match[1] ?? '')
  const month = chineseNumber(match[2] ?? '')
  const day = chineseNumber(match[3] ?? '')
  if (year === null || month === null || day === null || year < 1 || month < 1 || day < 1) return null
  const date = new Date(Date.UTC(year + 1911, month - 1, day))
  if (date.getUTCFullYear() !== year + 1911 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function metadata($: CheerioAPI): { name: string; version: string | null } {
  let name = compact($('#hlLawName').first().text())
  let amendment = $('#trLNNDate td').first().text()
  let promulgation = $('#trLNODate td').first().text()
  $('tr').each((_index, row) => {
    const label = compact($(row).find('th').first().text())
    const value = $(row).find('td').first()
    if (!name && label === '法規名稱：') name = compact(value.find('a').first().text() || value.text())
    if (!amendment && label === '修正日期：') amendment = value.text()
    if (!promulgation && label === '公布日期：') promulgation = value.text()
  })
  return { name, version: parseDate(amendment || promulgation) }
}

function articleTuple(value: string): [number, number] {
  const [base, suffix] = value.split('-')
  return [Number(base), Number(suffix ?? 0)]
}

function compareArticle(left: string, right: string): number {
  const [leftBase, leftSuffix] = articleTuple(left)
  const [rightBase, rightSuffix] = articleTuple(right)
  return leftBase - rightBase || leftSuffix - rightSuffix
}

function includesArticle(list: string, article: string): boolean {
  return list.split(/[、，,]/).some(item => {
    const range = item.split(/[～~至]/)
    const start = range[0]
    const end = range[1]
    if (!start) return false
    if (!end) return compareArticle(start, article) === 0
    return compareArticle(start, article) <= 0 && compareArticle(article, end) <= 0
  })
}

function referencesArticle(text: string, article: string): boolean {
  return Array.from(text.matchAll(new RegExp(`第${ARTICLE_LIST}條`, 'g')))
    .some(match => includesArticle(match[1] ?? '', article))
}

function revisionScopes(text: string): { complete: boolean; fullText: boolean; actions: Array<{ action: string; list: string; span: string }> } {
  const actions: Array<{ action: string; list: string; span: string }> = []
  let complete = true
  let fullText = false
  for (const match of text.matchAll(/(修正|增訂|刪除|制定)(?!條文|之條文)/g)) {
    const segment = text.slice(match.index + match[0].length).split(/[；。]/)[0] ?? ''
    if (/全文/.test(segment)) fullText = true
    const scope = segment.match(/^(?:公布|發布)?第([^條；。]+)條/)
    if (!scope || !COMPLETE_LIST.test(scope[1] ?? '') || /第[^；。]*條/.test(segment.slice(scope[0].length))) {
      complete = false
      continue
    }
    actions.push({ action: match[1] ?? '', list: scope[1] ?? '', span: match[0] + scope[0] })
  }
  for (const match of text.matchAll(/公布第([^條；。]+)條修正條文/g)) {
    if (!COMPLETE_LIST.test(match[1] ?? '')) complete = false
    else actions.push({ action: '修正', list: match[1] ?? '', span: match[0] })
  }
  return { complete: complete && actions.length > 0, fullText, actions }
}

function revisionAction(text: string, article: string): string | null {
  const scope = revisionScopes(text)
  if (!scope.complete) return null
  return scope.actions.find(action => includesArticle(action.list, article))?.action ?? null
}

function completeNoteScope(note: string): boolean {
  const scopes = Array.from(note.matchAll(/第([^；。]*?)條/g))
  return scopes.length > 0 && scopes.every(scope => COMPLETE_LIST.test(scope[1] ?? '')) && !/其他|全部|部分|其餘|分別|但|(?<!刪)除/.test(note)
}

function historyRecords($: CheerioAPI): HistoryRecord[] {
  const records: HistoryRecord[] = []
  $('.law-history > .row > .col-data').each((_index, node) => {
    const text = compact($(node).text())
    const starts = Array.from(text.matchAll(new RegExp(`中華民國[${NUMERALS}]+年[${NUMERALS}]+月[${NUMERALS}]+日(?=總統|國民政府|行政院|司法院)`, 'g')))
    if (!starts.length) {
      records.push({ text, date: null })
      return
    }
    starts.forEach((start, index) => {
      const record = text.slice(start.index, starts[index + 1]?.index)
      records.push({ text: record, date: parseDate(record) })
    })
  })
  return records
}

function warningNotes($: CheerioAPI): { pending: boolean; wholeLaw: boolean; notes: string[] } {
  const block = $('#VaildState')
  const notes: string[] = []
  block.find('.law-vaildMemo').each((_index, node) => {
    const html = $(node).html() ?? ''
    notes.push(...html.split(/<br\s*\/?\s*>/i).flatMap(part => compact(load(part).text()).split('。')).filter(Boolean))
  })
  return { pending: /尚未(?:生效|施行)/.test(block.text()), wholeLaw: /(?<!或)全部條文尚未(?:生效|施行)/.test(compact(block.text())), notes }
}

function withoutOtherExceptions(text: string): string | null {
  const parts = text.split('；但')
  const main = parts.shift() ?? ''
  for (const exception of parts) {
    if (!new RegExp(`^第${ARTICLE_LIST}條施行日期，由行政院會同司法院另定之$`).test(exception)) return null
  }
  return main
}

function explicitEffectiveDate(text: string): string | null {
  const dates = Array.from(text.matchAll(new RegExp(`(?:並)?自(${DATE_PATTERN})施行`, 'g')))
  if (dates.length !== 1 || !new RegExp(`自${DATE_PATTERN}施行[。；]?$`).test(text)) return null
  return parseDate(dates[0]?.[1] ?? '')
}

export function resolveArticleEffectiveness(input: ResolverInput): ArticleEffectiveness {
  const basis: ArticleEffectiveness['basis'] = []
  const result = (status: ArticleEffectiveness['status'], date: string | null, reason: string): ArticleEffectiveness => ({
    status, effective_date: date, reason, basis, checked_at: input.checkedAt,
  })
  const unknown = (reason: string) => result('unknown', null, reason)
  const checked = new Date(input.checkedAt)
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.checkedAt) || !Number.isFinite(checked.getTime())) return unknown('查核時間無效，無法判斷臺灣生效日期。')
  if (!/^\d+(?:-\d+)?$/.test(input.articleNumber)) return unknown('條號格式無法辨識。')
  const article = load(input.articleHtml)
  const history = load(input.historyHtml)
  if (/^[（(]?刪除[）)]?$/.test(compact(input.articleText))) return unknown('官方條文內容標示刪除，無法視為有效條文。')
  const articleMetadata = metadata(article)
  const historyMetadata = metadata(history)
  const lawName = compact(input.lawName)
  if (articleMetadata.name !== lawName || historyMetadata.name !== lawName) return unknown('官方條文頁與沿革頁法規名稱不一致或缺漏。')
  if (!articleMetadata.version || articleMetadata.version !== historyMetadata.version) return unknown('官方條文頁與沿革頁版本日期不一致或缺漏。')
  const records = historyRecords(history)
  if (records.some(record => record.date === null)) return unknown('官方沿革有無法辨識日期的紀錄，無法確認最新條文版本。')
  records.sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''))
  const candidate = records.find(record => revisionAction(record.text, input.articleNumber) !== null)
  if (!candidate) return unknown('官方沿革未提供可確認此條最新修正版本及施行日期的紀錄。')
  basis.push({ source_url: input.sourceUrl, text: candidate.text })
  if (records.some(record => record !== candidate && record.date === candidate.date && revisionAction(record.text, input.articleNumber) !== null && record.text !== candidate.text)) return unknown('同日有多筆涉及此條的修正紀錄，無法確認唯一施行依據。')
  if (records.some(record => (record.date ?? '') >= (candidate.date ?? '') && (!revisionScopes(record.text).complete || revisionScopes(record.text).fullText))) return unknown('較新或同日修正的完整條文範圍無法確認，不能沿用較舊施行證據。')
  if (revisionAction(candidate.text, input.articleNumber) === '刪除') return unknown('最新沿革刪除此條，不能將刪除日期視為條文生效日期。')
  const scoped = withoutOtherExceptions(candidate.text)
  if (!scoped || /(?:第[一二三四五六七八九十百\d]+(?:項|款|目)|但|(?<!刪)除|其餘|分別|涉及|部分|條件)/.test(scoped)) return unknown('沿革含分項施行、條件或未能解析的例外，無法確認全條生效狀態。')
  const remainingScope = revisionScopes(scoped).actions.reduce((remaining, action) => remaining.replace(action.span, ''), scoped)
  if (/第[〇零一二三四五六七八九十百千兩\d、，,～~至及-]+條/.test(remainingScope)) return unknown('施行說明另限定條號範圍，無法確認是否適用於所查全條。')
  const warning = warningNotes(article)
  if (warning.wholeLaw || (warning.pending && (!warning.notes.length || warning.notes.some(note => !completeNoteScope(note))))) return unknown('目前官方生效警示未提供可完整辨識的條號範圍，不能確認所查條文已排除於警示之外。')
  const targeted = warning.notes.filter(note => referencesArticle(note, input.articleNumber))
  if (targeted.length > 1) return unknown('目前生效警示有多筆涉及此條的說明，無法排除矛盾。')
  const note = targeted[0]
  if (note) {
    basis.push({ source_url: input.sourceUrl.replace('/LawHistory.aspx', '/LawAll.aspx'), text: note })
    if (parseDate(note) !== candidate.date) return unknown('目前生效警示與最新修正紀錄日期不一致。')
    if (/(?:第[一二三四五六七八九十百\d]+(?:項|款|目)|但|(?<!刪)除|其餘|分別|涉及|部分|條件)/.test(note)) return unknown('目前生效警示含分項或條件，無法確認全條生效狀態。')
    const undetermined = /施行日期，由行政院會同司法院另定之/.test(note)
    const delayed = /自公布(?:後[一二三四五六七八九十百\d]+個月|[一二三四五六七八九十百\d]+個月後)施行/.test(note)
    const targetedException = candidate.text.split('；但').slice(1).some(exception => referencesArticle(exception, input.articleNumber))
    if (explicitEffectiveDate(scoped) && !targetedException) return unknown('目前待施行警示與沿革全條明確施行日期矛盾。')
    if (warning.pending && (undetermined || delayed)) return result('not_yet_effective', null, undetermined ? '目前官方警示明確指出此條尚待另定施行日期。' : '目前官方警示明確列此條為延後施行；相對月數尚未換算為確定生效日。')
    return unknown('目前官方生效警示無法完整解析，不能據此判斷全條。')
  }
  if (candidate.text.split('；但').slice(1).some(exception => referencesArticle(exception, input.articleNumber))) return unknown('此條施行日期另定，且缺少目前官方待施行警示。')
  if (/另定|命令定之|公布(?:日|後|[一二三四五六七八九十百\d]+個月)|公告/.test(scoped)) return unknown('施行條件或相對日期未支援；不得直接將公布日視為生效日。')
  const effectiveDate = explicitEffectiveDate(scoped)
  if (!effectiveDate) return unknown('最新修正紀錄未提供唯一且有效的全條明確施行日期。')
  const taiwanDay = new Date(checked.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return result(effectiveDate <= taiwanDay ? 'effective' : 'not_yet_effective', effectiveDate, `最新涉及本條的官方修正紀錄明定自${effectiveDate}施行；依臺灣查核日期${taiwanDay}判斷。`)
}
