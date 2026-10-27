export type Rule =
  | { kind: 'id_set'; ours: string; theirs: string; min: number | 'all'; nonEmpty?: boolean }
  | { kind: 'text_norm'; ours: string; theirs: string; similarity?: number }
  | { kind: 'field_presence'; ours: string; theirs: string }
  | { kind: 'field_equal'; ours: string; theirs: string }

export interface Call {
  tool: string
  args: Record<string, unknown>
  observe?: Record<string, string>
}

export type Expectation = 'pass' | 'expected_fail'
export type TimingPhase = 'cold' | 'warm'

export interface ParityCase {
  id: string
  card: string
  title: string
  ours: Call
  theirs: Call & { acceptError?: boolean }
  rule: Rule
  expect: Expectation
  timed?: boolean
  timingGate?: TimingPhase[]
}

export type SideResult = { ok: true; data: unknown } | { ok: false; data: unknown }
export type Verdict = 'PASS' | 'FAIL' | 'ERROR'
export type Outcome = 'ok' | 'xfail' | 'unexpected_fail' | 'unexpected_pass' | 'error'

export interface RuleResult {
  pass: boolean
  detail: string
}

export interface PassReport {
  verdict: Verdict
  detail: string
  ours_ms: number
  theirs_ms: number
  observed: { ours: Record<string, unknown>; theirs: Record<string, unknown> }
}

export interface TimingStats {
  ours_ms: number[]
  theirs_ms: number[]
  ours_median: number
  theirs_median: number
  within: boolean
  errors?: string[]
}

export interface CaseReport {
  id: string
  card: string
  title: string
  expect: Expectation
  verdict: Verdict
  outcome: Outcome
  passes: Partial<Record<TimingPhase, PassReport>>
  timing: Partial<Record<TimingPhase, TimingStats>> | null
}

export const TIMING_FACTOR = 1.5

export function pick(data: unknown, path: string): unknown {
  const [body, suffix] = path.split('#')
  let values: unknown[] = [data]
  let flattened = false
  for (const raw of body.split('.').filter(Boolean)) {
    const spread = raw.endsWith('[]')
    const key = spread ? raw.slice(0, -2) : raw
    values = values.flatMap((value) => {
      const next = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
      if (!spread) return [next]
      return Array.isArray(next) ? next : []
    })
    flattened ||= spread
  }
  const result = flattened ? values : values[0]
  if (suffix === 'len') return typeof result === 'string' || Array.isArray(result) ? result.length : undefined
  return result
}

export function normalizeText(value: unknown): string {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)
  return text.normalize('NFKC').replace(/\s+/g, '')
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0)

export function similarity(a: string, b: string): number {
  const total = a.length + b.length
  if (total === 0) return 1
  const max = total
  const offset = max
  const frontier = new Int32Array(2 * max + 2)
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && frontier[offset + k - 1] < frontier[offset + k + 1])
        ? frontier[offset + k + 1]
        : frontier[offset + k - 1] + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++
        y++
      }
      frontier[offset + k] = x
      if (x >= a.length && y >= b.length) return 1 - d / total
    }
  }
  return 0
}

const errorSummary = (data: unknown): string => {
  const error = pick(data, 'error')
  const code = pick(data, 'error.code')
  return typeof code === 'string' ? code : typeof error === 'string' ? error : JSON.stringify(data ?? null).slice(0, 200)
}

const preview = (value: unknown): string => JSON.stringify(value ?? null).slice(0, 160)

export function evaluateRule(rule: Rule, ours: SideResult, theirs: SideResult): RuleResult {
  if (!ours.ok) return { pass: false, detail: `我方回錯誤：${errorSummary(ours.data)}` }
  const a = pick(ours.data, rule.ours)
  const b = pick(theirs.data, rule.theirs)
  switch (rule.kind) {
    case 'id_set': {
      const leftValues = asList(a).map(normalizeText)
      const rightValues = asList(b).map(normalizeText)
      const hasBlankId = leftValues.some((id) => !id) || rightValues.some((id) => !id)
      const left = new Set(leftValues.filter(Boolean))
      const right = new Set(rightValues.filter(Boolean))
      const shared = [...left].filter((id) => right.has(id))
      const need = rule.min === 'all' ? Math.max(left.size, right.size) : rule.min
      const pass = !hasBlankId && (!rule.nonEmpty || (left.size > 0 && right.size > 0)) && (rule.min === 'all' ? shared.length === left.size && shared.length === right.size : shared.length >= need)
      return { pass, detail: `交集 ${shared.length}（我方 ${left.size}、對方 ${right.size}，門檻 ${rule.min === 'all' ? '全同' : need}）：${shared.join('、')}` }
    }
    case 'text_norm': {
      if (rule.similarity !== undefined) {
        const left = asList(a).map(normalizeText).join('')
        const right = asList(b).map(normalizeText).join('')
        const ratio = similarity(left, right)
        return { pass: right.length > 0 && ratio >= rule.similarity, detail: `相似度 ${ratio.toFixed(4)}（門檻 ${rule.similarity}；${left.length}／${right.length} 字）` }
      }
      const left = asList(a).map(normalizeText)
      const right = asList(b).map(normalizeText)
      const pass = right.join('').length > 0 && left.length === right.length && left.every((text, i) => text === right[i])
      return { pass, detail: `去空白後 ${pass ? '相同' : '不同'}（我方 ${left.join('').length} 字、對方 ${right.join('').length} 字）` }
    }
    case 'field_presence': {
      const pass = !isEmpty(a) && !isEmpty(b)
      return { pass, detail: `我方 ${isEmpty(a) ? '空' : '有'}、對方 ${isEmpty(b) ? '空' : '有'}` }
    }
    case 'field_equal': {
      const pass = !isEmpty(b) && normalizeText(a) === normalizeText(b)
      return { pass, detail: `我方 ${preview(a)}；對方 ${preview(b)}` }
    }
  }
}

export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function timingStats(ours: number[], theirs: number[]): TimingStats {
  const oursMedian = median(ours)
  const theirsMedian = median(theirs)
  return { ours_ms: ours, theirs_ms: theirs, ours_median: oursMedian, theirs_median: theirsMedian, within: oursMedian <= theirsMedian * TIMING_FACTOR }
}

export function judgeCase(verdict: Verdict, expectation: Expectation): Outcome {
  if (verdict === 'ERROR') return 'error'
  if (expectation === 'pass') return verdict === 'PASS' ? 'ok' : 'unexpected_fail'
  return verdict === 'PASS' ? 'unexpected_pass' : 'xfail'
}

export function exitCode(reports: CaseReport[]): number {
  return reports.every((report) => report.outcome === 'ok' || report.outcome === 'xfail') ? 0 : 1
}
