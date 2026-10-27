import { describe, expect, it } from 'vitest'
import { evaluateRule, judgeCase, exitCode, median, pick, similarity, type CaseReport } from '../scripts/parity/compare.js'
import { CASES } from '../scripts/parity/cases.js'

const ok = (data: unknown) => ({ ok: true as const, data })
const failed = (data: unknown) => ({ ok: false as const, data })

describe('pick', () => {
  it('walks dotted paths, flattens [] segments and reports length with #len', () => {
    const data = { results: [{ jid: 'A' }, { jid: 'B' }], text: '一二三', list: [1, 2] }
    expect(pick(data, 'results[].jid')).toEqual(['A', 'B'])
    expect(pick(data, 'results.1.jid')).toBe('B')
    expect(pick(data, 'text#len')).toBe(3)
    expect(pick(data, 'list#len')).toBe(2)
    expect(pick(data, 'missing.path')).toBeUndefined()
  })
})

describe('evaluateRule', () => {
  it('id_set passes when the intersection reaches the threshold and fails below it', () => {
    const rule = { kind: 'id_set', ours: 'r[].id', theirs: 'x[].jid', min: 2 } as const
    expect(evaluateRule(rule, ok({ r: [{ id: 'a' }, { id: 'b' }] }), ok({ x: [{ jid: 'b' }, { jid: 'a' }] })).pass).toBe(true)
    expect(evaluateRule(rule, ok({ r: [{ id: 'a' }, { id: 'c' }] }), ok({ x: [{ jid: 'b' }, { jid: 'a' }] })).pass).toBe(false)
  })

  it('id_set with min all requires identical sets', () => {
    const rule = { kind: 'id_set', ours: 'a', theirs: 'b', min: 'all' } as const
    expect(evaluateRule(rule, ok({ a: ['x', 'y'] }), ok({ b: ['y', 'x'] })).pass).toBe(true)
    expect(evaluateRule(rule, ok({ a: ['x'] }), ok({ b: ['y', 'x'] })).pass).toBe(false)
  })

  it('text_norm ignores whitespace and full-width differences', () => {
    const rule = { kind: 'text_norm', ours: 't', theirs: 't' } as const
    expect(evaluateRule(rule, ok({ t: '第 １８４ 條\n因故意' }), ok({ t: '第184條因故意' })).pass).toBe(true)
    expect(evaluateRule(rule, ok({ t: '第184條因過失' }), ok({ t: '第184條因故意' })).pass).toBe(false)
  })

  it('exact text_norm fails when both sides are empty strings', () => {
    for (const id of ['Q5-main_text', 'Q5-reasoning', 'C-748-main_text']) {
      const rule = CASES.find((c) => c.id === id)!.rule
      expect(evaluateRule(rule, ok({ main_text: '', reasoning: '' }), ok({ main_text: '', reasoning: '' })).pass).toBe(false)
    }
  })

  it('exact text_norm fails when both sides are articles: [{}]', () => {
    const rule = { kind: 'text_norm', ours: 'articles[].content', theirs: 'articles[].content' } as const
    expect(evaluateRule(rule, ok({ articles: [{}] }), ok({ articles: [{}] })).pass).toBe(false)
  })

  it('exact text_norm fails when an article slot is empty even if later content matches', () => {
    const rule = { kind: 'text_norm', ours: 'articles[].content', theirs: 'articles[].content' } as const
    const mixed = { articles: [{}, { content: '第185條內容' }] }
    expect(evaluateRule(rule, ok(mixed), ok(mixed)).pass).toBe(false)
  })

  it('text_norm with a similarity threshold compares character similarity', () => {
    const rule = { kind: 'text_norm', ours: 't', theirs: 't', similarity: 0.98 } as const
    const base = '甲'.repeat(200)
    expect(evaluateRule(rule, ok({ t: base + '乙' }), ok({ t: base })).pass).toBe(true)
    expect(evaluateRule(rule, ok({ t: base.slice(0, 150) }), ok({ t: base })).pass).toBe(false)
  })

  it('field_presence needs a non-empty value on both sides', () => {
    const rule = { kind: 'field_presence', ours: 'f', theirs: 'f' } as const
    expect(evaluateRule(rule, ok({ f: ['a'] }), ok({ f: 'x' })).pass).toBe(true)
    expect(evaluateRule(rule, ok({ f: '' }), ok({ f: 'x' })).pass).toBe(false)
    expect(evaluateRule(rule, ok({}), ok({ f: 'x' })).pass).toBe(false)
  })

  it('field_equal compares values after normalization', () => {
    const rule = { kind: 'field_equal', ours: 'f', theirs: 'g' } as const
    expect(evaluateRule(rule, ok({ f: '2024-07-31' }), ok({ g: '2024-07-31' })).pass).toBe(true)
    expect(evaluateRule(rule, ok({ f: ['1', '2'] }), ok({ g: ['2', '1'] })).pass).toBe(false)
  })

  it('fails when our call returned an error', () => {
    const rule = { kind: 'field_equal', ours: 'f', theirs: 'f' } as const
    const result = evaluateRule(rule, failed({ error: { code: 'source_unavailable' } }), ok({ f: 1 }))
    expect(result.pass).toBe(false)
    expect(result.detail).toContain('source_unavailable')
  })
})

describe('similarity', () => {
  it('is 1 for equal strings and drops with edits', () => {
    expect(similarity('abc', 'abc')).toBe(1)
    expect(similarity('abcd', 'abce')).toBeCloseTo(0.75)
    expect(similarity('', '')).toBe(1)
  })
})

describe('median', () => {
  it('returns the middle value', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('judgeCase and exitCode', () => {
  const report = (verdict: CaseReport['verdict'], expect_: CaseReport['expect']): CaseReport => ({
    id: 'X', card: 'JUR-0', title: 't', expect: expect_, verdict, outcome: judgeCase(verdict, expect_), passes: {}, timing: null,
  })

  it('maps verdicts against expectations', () => {
    expect(judgeCase('PASS', 'pass')).toBe('ok')
    expect(judgeCase('FAIL', 'expected_fail')).toBe('xfail')
    expect(judgeCase('FAIL', 'pass')).toBe('unexpected_fail')
    expect(judgeCase('PASS', 'expected_fail')).toBe('unexpected_pass')
    expect(judgeCase('ERROR', 'expected_fail')).toBe('error')
  })

  it('exits 0 only when every case matches its expectation', () => {
    expect(exitCode([report('PASS', 'pass'), report('FAIL', 'expected_fail')])).toBe(0)
    expect(exitCode([report('PASS', 'pass'), report('FAIL', 'pass')])).toBe(1)
    expect(exitCode([report('PASS', 'expected_fail')])).toBe(1)
    expect(exitCode([report('ERROR', 'expected_fail')])).toBe(1)
  })
})

describe('CASES', () => {
  it('have unique ids and only the four rule kinds', () => {
    const ids = CASES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CASES) expect(['id_set', 'text_norm', 'field_presence', 'field_equal']).toContain(c.rule.kind)
  })

  it('keep the JUR-814 baseline expectations for Q1–Q5 on current main', () => {
    const expectOf = (id: string) => CASES.find((c) => c.id === id)?.expect
    expect(expectOf('Q2')).toBe('pass')
    for (const id of ['Q1', 'Q3', 'Q4', 'Q5-main_text']) expect(expectOf(id)).toBe('expected_fail')
  })
})


describe('Q2 known judgment', () => {
  it('requires non-empty matching ids and rejects missing or blank ids', () => {
    const rule = CASES.find((c) => c.id === 'Q2')!.rule
    for (const results of [[], [{}], [{ case_id: '', jid: '' }], [{ case_id: ' ', jid: ' ' }]]) {
      expect(evaluateRule(rule, ok({ results }), ok({ results })).pass).toBe(false)
    }
    expect(evaluateRule(rule, ok({ results: [{ case_id: 'A' }] }), ok({ results: [{ jid: 'A' }] })).pass).toBe(true)
  })
  it('preserves legitimate empty-set equality', () => {
    expect(evaluateRule({ kind: 'id_set', ours: 'a', theirs: 'b', min: 'all' }, ok({ a: [] }), ok({ b: [] })).pass).toBe(true)
  })

  it('rejects a blank id mixed with a valid id even when the other side has only the valid id', () => {
    const rule = { kind: 'id_set', ours: 'a', theirs: 'b', min: 'all' } as const
    expect(evaluateRule(rule, ok({ a: ['A', ''] }), ok({ b: ['A'] })).pass).toBe(false)
    expect(evaluateRule(rule, ok({ a: ['A'] }), ok({ b: ['A', ''] })).pass).toBe(false)
  })
})
