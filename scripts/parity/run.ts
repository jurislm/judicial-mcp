import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CASES } from './cases.js'
import {
  evaluateRule, exitCode, judgeCase, pick, timingStats,
  type Call, type CaseReport, type ParityCase, type PassReport, type SideResult, type TimingPhase, type Verdict,
} from './compare.js'

type Side = 'ours' | 'theirs'
interface Measured { result: SideResult; ms: number; transportError?: boolean }

const { values } = parseArgs({
  options: {
    'theirs-dir': { type: 'string' },
    'theirs-python': { type: 'string' },
    'theirs-home': { type: 'string' },
    'playwright-dir': { type: 'string' },
    cases: { type: 'string' },
    rounds: { type: 'string', default: '5' },
    out: { type: 'string', default: 'parity-out' },
  },
})

const required = (name: 'theirs-dir' | 'theirs-python' | 'theirs-home' | 'playwright-dir'): string => {
  const value = values[name]
  if (!value) throw new Error(`缺少 --${name}；請用 scripts/parity/run.sh 執行`)
  return resolve(value)
}

const root = resolve(import.meta.dirname, '../..')
const theirsDir = required('theirs-dir')
const theirsPython = required('theirs-python')
const theirsHome = required('theirs-home')
const playwrightDir = required('playwright-dir')
const rounds = Number(values.rounds)
const wanted = values.cases ? new Set(values.cases.split(',')) : null
const cases = CASES.filter((c) => !wanted || wanted.has(c.id))
const REQUEST_GAP_MS = 1000
const CALL_TIMEOUT_MS = 300000

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
const taipei = (date: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(date)
const callKey = (side: Side, call: Call) => `${side}:${call.tool}:${JSON.stringify(call.args)}`

function clearTheirsCache() {
  for (const suffix of ['', '-wal', '-shm']) rmSync(join(theirsHome, `legal_mcp.db${suffix}`), { force: true })
}

async function connect(side: Side): Promise<Client> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const transport = side === 'ours'
    ? new StdioClientTransport({ command: 'bun', args: ['src/index.ts'], cwd: root, env, stderr: 'ignore' })
    : new StdioClientTransport({
      command: theirsPython, args: ['-m', 'mcp_server.server'], cwd: theirsDir, stderr: 'ignore',
      env: { ...env, MCP_TAIWAN_LEGAL_DB_HOME: theirsHome, PLAYWRIGHT_BROWSERS_PATH: playwrightDir },
    })
  const client = new Client({ name: 'judicial-parity', version: '1' })
  await client.connect(transport)
  return client
}

async function invoke(client: Client, side: Side, call: Call): Promise<Measured> {
  const started = performance.now()
  try {
    const response = await client.callTool({ name: call.tool, arguments: call.args }, undefined, { timeout: CALL_TIMEOUT_MS })
    const ms = Math.round(performance.now() - started)
    const content = response.content as Array<{ type: string; text?: string }>
    const text = content.find((part) => part.type === 'text')?.text ?? ''
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { error: text.slice(0, 500) }
    }
    const failed = response.isError === true || (side === 'theirs' && pick(data, 'success') === false)
    return { result: { ok: !failed, data }, ms }
  } catch (error) {
    return { result: { ok: false, data: { error: error instanceof Error ? error.message : String(error) } }, ms: Math.round(performance.now() - started), transportError: true }
  } finally {
    await sleep(REQUEST_GAP_MS)
  }
}

interface Session { ours: Client; theirs: Client }

async function openSession(): Promise<Session> {
  clearTheirsCache()
  return { ours: await connect('ours'), theirs: await connect('theirs') }
}

async function closeSession(session: Session) {
  await Promise.all([session.ours.close(), session.theirs.close()])
}

async function runPass(session: Session, selected: ParityCase[]): Promise<Map<string, Measured>> {
  const memo = new Map<string, Measured>()
  for (const c of selected) {
    for (const side of ['ours', 'theirs'] as const) {
      const key = callKey(side, c[side])
      if (!memo.has(key)) {
        memo.set(key, await invoke(session[side], side, c[side]))
        process.stderr.write(`  ${side} ${c[side].tool} ${memo.get(key)?.ms}ms ${memo.get(key)?.result.ok ? 'ok' : 'error'}\n`)
      }
    }
  }
  return memo
}

const observe = (call: Call, measured: Measured) =>
  Object.fromEntries(Object.entries(call.observe ?? {}).map(([name, path]) => [name, pick(measured.result.data, path)]))

function evaluatePass(c: ParityCase, memo: Map<string, Measured>): PassReport {
  const ours = memo.get(callKey('ours', c.ours)) as Measured
  const theirs = memo.get(callKey('theirs', c.theirs)) as Measured
  const observed = { ours: observe(c.ours, ours), theirs: observe(c.theirs, theirs) }
  if (ours.transportError || theirs.transportError) {
    return { verdict: 'ERROR', detail: `連線失敗：${JSON.stringify({ ours: ours.transportError ? ours.result.data : null, theirs: theirs.transportError ? theirs.result.data : null }).slice(0, 300)}`, ours_ms: ours.ms, theirs_ms: theirs.ms, observed }
  }
  if (!ours.result.ok && pick(ours.result.data, 'error.code') === 'source_unavailable' && !(c.id === 'Q4' && !process.env.FIRECRAWL_API_URL?.trim())) {
    return { verdict: 'ERROR', detail: '我方來源無法使用', ours_ms: ours.ms, theirs_ms: theirs.ms, observed }
  }
  if (!theirs.result.ok && (!c.theirs.acceptError || pick(theirs.result.data, 'error.code') === 'source_unavailable')) {
    return { verdict: 'ERROR', detail: `對方回錯誤，無法比對：${JSON.stringify(pick(theirs.result.data, 'error') ?? theirs.result.data).slice(0, 200)}`, ours_ms: ours.ms, theirs_ms: theirs.ms, observed }
  }
  const rule = evaluateRule(c.rule, ours.result, { ok: true, data: theirs.result.data })
  return { verdict: rule.pass ? 'PASS' : 'FAIL', detail: rule.detail, ours_ms: ours.ms, theirs_ms: theirs.ms, observed }
}

const samples: Record<TimingPhase, Map<string, { ours: number[]; theirs: number[]; errors: string[] }>> = { cold: new Map(), warm: new Map() }
const timedCases = cases.filter((c) => c.timed)

function record(phase: TimingPhase, c: ParityCase, ours: Measured, theirs: Measured) {
  const bucket = samples[phase].get(c.id) ?? { ours: [], theirs: [], errors: [] }
  if (!ours.result.ok || !theirs.result.ok || ours.transportError || theirs.transportError) {
    bucket.errors.push(`第 ${bucket.ours.length + bucket.errors.length + 1} 輪：${JSON.stringify({ ours: ours.result, theirs: theirs.result }).slice(0, 400)}`)
  } else {
    bucket.ours.push(ours.ms)
    bucket.theirs.push(theirs.ms)
  }
  samples[phase].set(c.id, bucket)
}

async function sampleTimed(session: Session, phase: TimingPhase) {
  for (const c of timedCases) {
    const ours = await invoke(session.ours, 'ours', c.ours)
    const theirs = await invoke(session.theirs, 'theirs', c.theirs)
    record(phase, c, ours, theirs)
  }
}

const startedAt = new Date()
process.stderr.write(`冷快取第 1 輪（全部 ${cases.length} 案）\n`)
const session = await openSession()
const cold = await runPass(session, cases)
process.stderr.write('熱快取（全部案例）\n')
const warm = await runPass(session, cases)
for (const c of timedCases) {
  record('cold', c, cold.get(callKey('ours', c.ours)) as Measured, cold.get(callKey('theirs', c.theirs)) as Measured)
  record('warm', c, warm.get(callKey('ours', c.ours)) as Measured, warm.get(callKey('theirs', c.theirs)) as Measured)
}
for (let i = 1; i < rounds; i++) await sampleTimed(session, 'warm')
await closeSession(session)
for (let round = 2; round <= rounds; round++) {
  process.stderr.write(`冷快取第 ${round} 輪（計時案例）\n`)
  const fresh = await openSession()
  await sampleTimed(fresh, 'cold')
  await closeSession(fresh)
}
const finishedAt = new Date()

const reports: CaseReport[] = cases.map((c) => {
  const passes = { cold: evaluatePass(c, cold), warm: evaluatePass(c, warm) }
  const timing = c.timed
    ? Object.fromEntries((['cold', 'warm'] as const).map((phase) => {
      const bucket = samples[phase].get(c.id) as { ours: number[]; theirs: number[]; errors: string[] }
      const stats = timingStats(bucket.ours, bucket.theirs)
      return [phase, { ...stats, errors: bucket.errors, within: bucket.errors.length === 0 && bucket.ours.length === rounds && bucket.theirs.length === rounds && stats.within }]
    }))
    : null
  const verdicts = [passes.cold.verdict, passes.warm.verdict]
  const timingOk = (c.timingGate ?? []).every((phase) => timing?.[phase]?.within)
  const timingError = Object.values(timing ?? {}).some((stats) => stats.errors.length > 0 || stats.ours_ms.length !== rounds || stats.theirs_ms.length !== rounds)
  const verdict: Verdict = timingError || verdicts.includes('ERROR') ? 'ERROR' : verdicts.every((v) => v === 'PASS') && timingOk ? 'PASS' : 'FAIL'
  return { id: c.id, card: c.card, title: c.title, expect: c.expect, verdict, outcome: judgeCase(verdict, c.expect), passes, timing }
})

const code = exitCode(reports)
const oursCommit = git(root, 'rev-parse', 'HEAD')
const report = {
  run_at_taipei: `${taipei(startedAt)} – ${taipei(finishedAt)}（台北時間 UTC+8）`,
  ours: { commit: oursCommit, dirty: git(root, 'status', '--porcelain').length > 0, firecrawl_configured: Boolean(process.env.FIRECRAWL_API_URL) },
  theirs: { repo: 'lawchat-oss/mcp-taiwan-legal-db', commit: git(theirsDir, 'rev-parse', 'HEAD') },
  rounds,
  timing_rule: `我方 ${rounds} 次中位數 ≤ 對方 ${rounds} 次中位數 × 1.5`,
  summary: Object.fromEntries(['ok', 'xfail', 'unexpected_fail', 'unexpected_pass', 'error'].map((o) => [o, reports.filter((r) => r.outcome === o).length])),
  exit_code: code,
  cases: reports,
}

const fmt = (stats?: { ours_median: number; theirs_median: number; within: boolean; errors?: string[] }) =>
  stats?.errors?.length ? `ERROR（${stats.errors.length} 輪失敗）` : stats ? `${stats.ours_median}／${stats.theirs_median} ms ${stats.within ? '✓' : '✗'}` : '—'
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const outcomeLabel: Record<string, string> = { ok: '符合預期', xfail: '預期失敗', unexpected_fail: '**意外 FAIL**', unexpected_pass: '**意外 PASS**', error: '**ERROR**' }
const markdown = [
  '# Judicial MCP 對照結果',
  '',
  `- 執行時間：${report.run_at_taipei}`,
  `- 我方：jurislm/judicial-mcp \`${oursCommit.slice(0, 7)}\`${report.ours.dirty ? '（有未提交變更）' : ''}，FIRECRAWL_API_URL ${report.ours.firecrawl_configured ? '有設' : '未設'}`,
  `- 對方：${report.theirs.repo} \`${report.theirs.commit.slice(0, 7)}\``,
  `- 耗時門檻：${report.timing_rule}；冷快取與熱快取分開比`,
  `- 結果：${Object.entries(report.summary).map(([k, v]) => `${outcomeLabel[k].replace(/\*/g, '')} ${v}`).join('、')}；exit code ${code}`,
  '',
  '| 案例 | 卡 | 預期 | 冷 | 熱 | 判定 | 冷中位 我方／對方 | 熱中位 我方／對方 | 說明（冷快取） |',
  '| -- | -- | -- | -- | -- | -- | -- | -- | -- |',
  ...reports.map((r) => `| ${r.id} | ${r.card} | ${r.expect} | ${r.passes.cold?.verdict} | ${r.passes.warm?.verdict} | ${outcomeLabel[r.outcome]} | ${fmt(r.timing?.cold)} | ${fmt(r.timing?.warm)} | ${cell(r.passes.cold?.detail ?? '')} |`),
  '',
  '## 觀測值（冷快取）',
  '',
  '| 案例 | 我方 | 對方 |',
  '| -- | -- | -- |',
  ...reports.filter((r) => Object.keys(r.passes.cold?.observed.ours ?? {}).length + Object.keys(r.passes.cold?.observed.theirs ?? {}).length > 0)
    .map((r) => `| ${r.id} | ${cell(JSON.stringify(r.passes.cold?.observed.ours))} | ${cell(JSON.stringify(r.passes.cold?.observed.theirs))} |`),
  '',
].join('\n')

const outDir = resolve(root, values.out as string)
mkdirSync(outDir, { recursive: true })
const stamp = taipei(startedAt).replace(/[-: ]/g, '').slice(0, 12)
writeFileSync(join(outDir, `parity-${stamp}.json`), JSON.stringify(report, null, 2))
writeFileSync(join(outDir, `parity-${stamp}.md`), markdown)
process.stdout.write(`${markdown}\n結果檔：${join(outDir, `parity-${stamp}.json`)}、.md\n`)
process.exit(code)
