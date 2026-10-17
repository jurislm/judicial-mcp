import { describe, expect, it } from 'vitest'
import {
  RELEASE_BRANCH,
  REPOSITORY,
  evaluateRequiredChecks,
  runReleasePrAutoMerge,
  selectReleaseCandidate,
  validateChangedFiles,
  validateReleaseContents,
  type ReleaseContents,
} from '../scripts/ci/release-pr-auto-merge'

const VERSION = '1.6.0'
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MERGE_SHA = 'c'.repeat(40)
const BODY =
  ':robot: I have created a release *beep* *boop*\n\nThis PR was generated with [Release Please](https://github.com/googleapis/release-please).'

function pull(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 20,
    state: 'open',
    draft: false,
    title: `chore(main): release ${VERSION}`,
    body: BODY,
    user: { login: 'terry90918' },
    base: { ref: 'main', sha: BASE_SHA, repo: { full_name: REPOSITORY } },
    head: { ref: RELEASE_BRANCH, sha: HEAD_SHA, repo: { full_name: REPOSITORY } },
    mergeable: true,
    ...overrides,
  }
}

const FILES = [
  { filename: '.release-please-manifest.json', status: 'modified' },
  { filename: 'CHANGELOG.md', status: 'modified' },
  { filename: 'package.json', status: 'modified' },
]

const PACKAGE = { name: '@jurislm/judicial-mcp', type: 'module' }
const HISTORY = '## [1.5.0](https://github.com/jurislm/judicial-mcp/compare/v1.4.0...v1.5.0)\n\n* old\n'

function contents(overrides: Partial<ReleaseContents> = {}): ReleaseContents {
  return {
    version: VERSION,
    baseManifestText: JSON.stringify({ '.': '1.5.0' }),
    headManifestText: JSON.stringify({ '.': VERSION }),
    basePackageText: JSON.stringify({ ...PACKAGE, version: '1.5.0' }),
    headPackageText: JSON.stringify({ ...PACKAGE, version: VERSION }),
    baseChangelogText: `# Changelog\n\n${HISTORY}`,
    headChangelogText: `# Changelog\n\n## [${VERSION}](https://github.com/jurislm/judicial-mcp/compare/v1.5.0...v${VERSION})\n\n* new\n\n${HISTORY}`,
    ...overrides,
  }
}

function checkRuns(runs: Array<Record<string, unknown>>): Record<string, unknown> {
  return { total_count: runs.length, check_runs: runs }
}

const GREEN = checkRuns([
  { name: 'lint', status: 'completed', conclusion: 'success' },
  { name: 'test', status: 'completed', conclusion: 'success' },
  { name: 'secret-scan', status: 'completed', conclusion: 'success' },
  { name: 'secret-scan', status: 'completed', conclusion: 'success' },
])

describe('selectReleaseCandidate', () => {
  it('accepts the official release-please PR', () => {
    expect(selectReleaseCandidate([pull()])).toEqual({ number: 20, version: VERSION, baseSha: BASE_SHA, headSha: HEAD_SHA })
  })
  it('returns null when there is no release PR', () => {
    expect(selectReleaseCandidate([])).toBeNull()
  })
  it.each([
    [{ user: { login: 'someone-else' } }, 'author is not allowed'],
    [{ draft: true }, 'is a draft'],
    [{ title: 'chore(main): release 1.6.0-beta' }, 'exact release title'],
    [{ body: 'hello' }, 'release-please markers'],
    [{ head: { ref: 'evil', sha: HEAD_SHA, repo: { full_name: REPOSITORY } } }, 'head branch mismatch'],
    [{ head: { ref: RELEASE_BRANCH, sha: HEAD_SHA, repo: { full_name: 'fork/judicial-mcp' } } }, 'head repository mismatch'],
  ])('rejects %o', (override, message) => {
    expect(() => selectReleaseCandidate([pull(override)])).toThrow(message)
  })
  it('rejects multiple candidates', () => {
    expect(() => selectReleaseCandidate([pull(), pull()])).toThrow('multiple')
  })
})

describe('validateChangedFiles', () => {
  it('accepts exactly the three release files', () => {
    expect(() => validateChangedFiles(FILES)).not.toThrow()
  })
  it('rejects an extra file', () => {
    expect(() => validateChangedFiles([...FILES, { filename: 'src/index.ts', status: 'modified' }])).toThrow('three allowed files')
  })
  it('rejects an added file', () => {
    expect(() => validateChangedFiles([FILES[0], FILES[1], { filename: 'package.json', status: 'added' }])).toThrow('must be modified')
  })
})

describe('validateReleaseContents', () => {
  it('accepts a version-only bump with prepended changelog', () => {
    expect(() => validateReleaseContents(contents())).not.toThrow()
  })
  it('rejects a non-increasing version', () => {
    expect(() => validateReleaseContents(contents({ baseManifestText: JSON.stringify({ '.': '1.6.0' }) }))).toThrow('earlier version')
  })
  it('rejects package changes beyond version', () => {
    expect(() =>
      validateReleaseContents(contents({ headPackageText: JSON.stringify({ ...PACKAGE, version: VERSION, scripts: { x: 'y' } }) })),
    ).toThrow('other than version')
  })
  it('rejects rewritten changelog history', () => {
    expect(() => validateReleaseContents(contents({ headChangelogText: `# Changelog\n\n## [${VERSION}](x)\n` }))).toThrow('history')
  })
})

describe('evaluateRequiredChecks', () => {
  it('is success when lint, test and every secret-scan passed', () => {
    expect(evaluateRequiredChecks(GREEN)).toBe('success')
  })
  it('is pending when a required check has not appeared', () => {
    expect(evaluateRequiredChecks(checkRuns([{ name: 'lint', status: 'completed', conclusion: 'success' }]))).toBe('pending')
  })
  it('is pending while a required check is running', () => {
    expect(
      evaluateRequiredChecks(
        checkRuns([
          { name: 'lint', status: 'completed', conclusion: 'success' },
          { name: 'test', status: 'in_progress', conclusion: null },
          { name: 'secret-scan', status: 'completed', conclusion: 'success' },
        ]),
      ),
    ).toBe('pending')
  })
  it('throws when any required check failed', () => {
    expect(() =>
      evaluateRequiredChecks(
        checkRuns([
          { name: 'lint', status: 'completed', conclusion: 'success' },
          { name: 'test', status: 'completed', conclusion: 'success' },
          { name: 'secret-scan', status: 'completed', conclusion: 'success' },
          { name: 'secret-scan', status: 'completed', conclusion: 'failure' },
        ]),
      ),
    ).toThrow('required check failed: secret-scan')
  })
  it('throws when the response is paginated', () => {
    expect(() => evaluateRequiredChecks({ total_count: 150, check_runs: [] })).toThrow('pagination')
  })
})

function file(text: string): Record<string, unknown> {
  return { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') }
}

function fakeGitHub(options: { pulls?: unknown[]; checks?: unknown; mainSha?: string } = {}) {
  const c = contents()
  const calls: Array<{ method: string; path: string; body?: string }> = []
  const routes: Record<string, unknown> = {
    [`/repos/${REPOSITORY}/pulls/20`]: pull(),
    [`/repos/${REPOSITORY}/pulls/20/files`]: FILES,
    [`/repos/${REPOSITORY}/commits/${HEAD_SHA}/check-runs`]: options.checks ?? GREEN,
    [`/repos/${REPOSITORY}/git/ref/heads/main`]: { object: { sha: options.mainSha ?? BASE_SHA } },
  }
  const fileAt: Record<string, string> = {
    [`.release-please-manifest.json@${BASE_SHA}`]: c.baseManifestText,
    [`.release-please-manifest.json@${HEAD_SHA}`]: c.headManifestText,
    [`package.json@${BASE_SHA}`]: c.basePackageText,
    [`package.json@${HEAD_SHA}`]: c.headPackageText,
    [`CHANGELOG.md@${BASE_SHA}`]: c.baseChangelogText,
    [`CHANGELOG.md@${HEAD_SHA}`]: c.headChangelogText,
  }
  const fetchImpl = async (input: string, init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname, body: init?.body as string | undefined })
    let value: unknown
    if (url.pathname === `/repos/${REPOSITORY}/pulls`) value = options.pulls ?? [pull()]
    else if (url.pathname.startsWith(`/repos/${REPOSITORY}/contents/`)) {
      const path = decodeURIComponent(url.pathname.slice(`/repos/${REPOSITORY}/contents/`.length))
      value = file(fileAt[`${path}@${url.searchParams.get('ref')}`])
    } else if (method === 'PUT' && url.pathname === `/repos/${REPOSITORY}/pulls/20/merge`) value = { merged: true, sha: MERGE_SHA }
    else value = routes[url.pathname]
    if (value === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(value), { status: 200 })
  }
  return { calls, fetchImpl }
}

const quiet = { log: () => undefined }
const noSleep = async () => undefined

describe('runReleasePrAutoMerge', () => {
  it('merges the validated release PR at its head SHA once checks are green', async () => {
    const gh = fakeGitHub()
    const result = await runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, logger: quiet })
    expect(result).toEqual({ status: 'merged', pullNumber: 20, mergeSha: MERGE_SHA })
    const merge = gh.calls.find((call) => call.method === 'PUT')
    expect(merge && JSON.parse(merge.body ?? '{}')).toEqual({ sha: HEAD_SHA, merge_method: 'merge' })
  })
  it('is a no-op when there is no release PR', async () => {
    const gh = fakeGitHub({ pulls: [] })
    await expect(runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, logger: quiet })).resolves.toEqual({ status: 'no-op' })
  })
  it('does not merge when a required check failed', async () => {
    const gh = fakeGitHub({ checks: checkRuns([{ name: 'lint', status: 'completed', conclusion: 'failure' }]) })
    await expect(
      runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, logger: quiet }),
    ).rejects.toThrow('required check failed: lint')
    expect(gh.calls.some((call) => call.method === 'PUT')).toBe(false)
  })
  it('does not merge when checks never complete', async () => {
    const gh = fakeGitHub({ checks: checkRuns([]) })
    await expect(
      runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, maxAttempts: 2, logger: quiet }),
    ).rejects.toThrow('did not complete')
    expect(gh.calls.some((call) => call.method === 'PUT')).toBe(false)
  })
  it('yields without merging when main advanced during validation', async () => {
    const gh = fakeGitHub({ mainSha: 'd'.repeat(40) })
    await expect(
      runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, logger: quiet }),
    ).resolves.toEqual({ status: 'no-op' })
    expect(gh.calls.some((call) => call.method === 'PUT')).toBe(false)
  })
  it('refuses to run without the Woodpecker commit SHA', async () => {
    await expect(runReleasePrAutoMerge({ token: 't' })).rejects.toThrow('CI commit SHA is required')
  })
})
