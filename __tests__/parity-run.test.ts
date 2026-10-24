import { afterEach, expect, it, vi } from 'vitest'
import type { CaseReport } from '../scripts/parity/compare.js'

type RunReport = { cases: CaseReport[]; exit_code: number }
const state = vi.hoisted((): { report: RunReport | null; calls: { ours: number; theirs: number }; failure: string; failAt: number; side: string; selected: string } => ({ report: null, calls: { ours: 0, theirs: 0 }, failure: 'transport', failAt: 3, side: 'ours', selected: 'Q2' }))
vi.mock('node:child_process', () => ({ execFileSync: () => 'fixture-head' }))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), rmSync: vi.fn(), writeFileSync: (_path: string, text: string) => { if (_path.endsWith('.json')) state.report = JSON.parse(text) } }))
vi.mock('node:util', () => ({ parseArgs: () => ({ values: { 'theirs-dir': '/tmp/theirs', 'theirs-python': '/tmp/python', 'theirs-home': '/tmp/home', 'playwright-dir': '/tmp/browser', cases: state.selected, rounds: '2', out: '/tmp/out' } }) }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: class { constructor(public options: { command: string }) {} } }))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  side: 'ours' | 'theirs' = 'ours'
  async connect(transport: { options: { command: string } }) { this.side = transport.options.command === 'bun' ? 'ours' : 'theirs' }
  async close() {}
  async callTool() {
    const count = ++state.calls[this.side]
    if (this.side === state.side && count === state.failAt) {
      if (state.failure === 'transport') throw new Error('Request timed out')
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: state.failure } }) }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ results: [{ case_id: 'A', jid: 'A' }] }) }] }
  }
} }))

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetModules() })

const scenarios = [
  { side: 'ours', failure: 'transport', failAt: 1, selected: 'Q1', verdict: 'ERROR' },
  { side: 'theirs', failure: 'transport', failAt: 1, selected: 'P-不存在的法', verdict: 'ERROR' },
  { side: 'theirs', failure: 'source_unavailable', failAt: 1, selected: 'P-不存在的法', verdict: 'ERROR' },
  { side: 'ours', failure: 'source_unavailable', failAt: 1, selected: 'Q1', verdict: 'ERROR' },
  { side: 'ours', failure: 'invalid_argument', failAt: 1, selected: 'Q1-court_level', verdict: 'FAIL' },
  { side: 'ours', failure: 'source_unavailable', failAt: 1, selected: 'Q4', verdict: 'ERROR' },
  ...['ours', 'theirs'].flatMap((side) => [3, 4].flatMap((failAt) => ['transport', 'source_unavailable'].map((failure) => ({ side, failure, failAt, selected: 'Q2', verdict: 'ERROR' })))),
]
it.each(scenarios)('$side $failure at call $failAt for $selected yields $verdict', async (scenario) => {
  Object.assign(state, scenario, { calls: { ours: 0, theirs: 0 }, report: null })
  vi.useFakeTimers()
  vi.stubEnv('FIRECRAWL_API_URL', '')
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('finished') })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const run = import('../scripts/parity/run.js').catch((error: Error) => error.message)
  await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
  await vi.runAllTimersAsync()
  await run
  expect(state.report?.cases[0].verdict).toBe(scenario.verdict)
  if (scenario.verdict === 'ERROR') expect(state.report?.exit_code).toBe(1)
  if (scenario.failAt >= 3) {
    const phase = scenario.failAt === 3 ? 'warm' : 'cold'
    expect(state.report?.cases[0].timing?.[phase]?.ours_ms).toHaveLength(1)
    expect(state.report?.cases[0].timing?.[phase]?.within).toBe(false)
  }
  if (scenario.selected === 'Q4') expect(state.report?.cases[0].passes.cold?.verdict).toBe('FAIL')
})
