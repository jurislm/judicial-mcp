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
const CI_SHA = 'e'.repeat(40)
const NEW_HEAD_SHA = 'f'.repeat(40)
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

interface FakeUpdate {
  headSha: string
  baseSha: string
  pollsBeforeVisible?: number
}

interface FakeOptions {
  pulls?: unknown[]
  checks?: unknown
  pendingCheckPolls?: number
  mainSha?: string
  prBaseSha?: string
  compareStatus?: string
  update?: FakeUpdate | 'never'
}

function fakeGitHub(options: FakeOptions = {}) {
  const c = contents()
  const calls: Array<{ method: string; path: string; body?: string }> = []
  const prBaseSha = options.prBaseSha ?? BASE_SHA
  let current = pull({
    base: { ref: 'main', sha: prBaseSha, repo: { full_name: REPOSITORY } },
  })
  let updateRequested = false
  let pollsSinceUpdate = 0
  let checkPolls = 0
  const fileAt: Record<string, string> = {}
  for (const sha of [BASE_SHA, CI_SHA]) {
    fileAt[`.release-please-manifest.json@${sha}`] = c.baseManifestText
    fileAt[`package.json@${sha}`] = c.basePackageText
    fileAt[`CHANGELOG.md@${sha}`] = c.baseChangelogText
  }
  for (const sha of [HEAD_SHA, NEW_HEAD_SHA]) {
    fileAt[`.release-please-manifest.json@${sha}`] = c.headManifestText
    fileAt[`package.json@${sha}`] = c.headPackageText
    fileAt[`CHANGELOG.md@${sha}`] = c.headChangelogText
  }
  const pullDetail = (): unknown => {
    const update = options.update
    if (updateRequested && update && update !== 'never') {
      pollsSinceUpdate += 1
      if (pollsSinceUpdate > (update.pollsBeforeVisible ?? 0)) {
        current = pull({
          base: { ref: 'main', sha: update.baseSha, repo: { full_name: REPOSITORY } },
          head: { ref: RELEASE_BRANCH, sha: update.headSha, repo: { full_name: REPOSITORY } },
        })
      }
    }
    return current
  }
  const checksFor = (): unknown => {
    checkPolls += 1
    if (checkPolls <= (options.pendingCheckPolls ?? 0)) return checkRuns([])
    return options.checks ?? GREEN
  }
  const fetchImpl = async (input: string, init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const path = url.pathname
    calls.push({ method, path, body: init?.body as string | undefined })
    const headSha = (current.head as { sha: string }).sha
    let value: unknown
    if (path === `/repos/${REPOSITORY}/pulls`) value = options.pulls ?? [current]
    else if (path === `/repos/${REPOSITORY}/pulls/20`) value = pullDetail()
    else if (path === `/repos/${REPOSITORY}/pulls/20/files`) value = FILES
    else if (path === `/repos/${REPOSITORY}/commits/${headSha}/check-runs`) value = checksFor()
    else if (path === `/repos/${REPOSITORY}/git/ref/heads/main`) value = { object: { sha: options.mainSha ?? prBaseSha } }
    else if (path.startsWith(`/repos/${REPOSITORY}/compare/`)) value = { status: options.compareStatus ?? 'behind' }
    else if (path.startsWith(`/repos/${REPOSITORY}/contents/`)) {
      const filePath = decodeURIComponent(path.slice(`/repos/${REPOSITORY}/contents/`.length))
      const text = fileAt[`${filePath}@${url.searchParams.get('ref')}`]
      value = text === undefined ? undefined : file(text)
    } else if (method === 'PUT' && path === `/repos/${REPOSITORY}/pulls/20/update-branch`) {
      const expected = JSON.parse((init?.body as string | undefined) ?? '{}').expected_head_sha
      if (expected !== headSha) return new Response('{}', { status: 422 })
      updateRequested = true
      return new Response(JSON.stringify({ message: 'Updating pull request branch.' }), { status: 202 })
    } else if (method === 'PUT' && path === `/repos/${REPOSITORY}/pulls/20/merge`) value = { merged: true, sha: MERGE_SHA }
    if (value === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(value), { status: 200 })
  }
  const merges = () => calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/merge'))
  const updates = () => calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/update-branch'))
  return { calls, fetchImpl, merges, updates }
}

const quiet = { log: () => undefined }
const noSleep = async () => undefined

describe('runReleasePrAutoMerge', () => {
  it('merges the validated release PR at its head SHA once checks are green', async () => {
    const gh = fakeGitHub()
    const result = await runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, logger: quiet })
    expect(result).toEqual({ status: 'merged', pullNumber: 20, mergeSha: MERGE_SHA })
    const merge = gh.merges()[0]
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
    expect(gh.merges()).toEqual([])
  })
  it('does not merge when checks never complete', async () => {
    const gh = fakeGitHub({ checks: checkRuns([]) })
    await expect(
      runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, maxAttempts: 2, logger: quiet }),
    ).rejects.toThrow('did not complete')
    expect(gh.merges()).toEqual([])
  })
  it('yields without merging when main advanced during validation', async () => {
    const gh = fakeGitHub({ mainSha: 'd'.repeat(40) })
    await expect(
      runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, logger: quiet }),
    ).resolves.toEqual({ status: 'no-op' })
    expect(gh.merges()).toEqual([])
  })
  it('refuses to run without the Woodpecker commit SHA', async () => {
    await expect(runReleasePrAutoMerge({ token: 't' })).rejects.toThrow('CI commit SHA is required')
  })
})

describe('runReleasePrAutoMerge when the release PR base is behind main', () => {
  const run = (gh: ReturnType<typeof fakeGitHub>, extra: { maxAttempts?: number } = {}) =>
    runReleasePrAutoMerge({ token: 't', expectedBaseSha: CI_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, logger: quiet, ...extra })

  it('updates the release branch to the CI commit, then merges the new head once its checks are green', async () => {
    const gh = fakeGitHub({ mainSha: CI_SHA, update: { headSha: NEW_HEAD_SHA, baseSha: CI_SHA, pollsBeforeVisible: 2 } })
    await expect(run(gh)).resolves.toEqual({ status: 'merged', pullNumber: 20, mergeSha: MERGE_SHA })
    expect(gh.updates().map((call) => JSON.parse(call.body ?? '{}'))).toEqual([{ expected_head_sha: HEAD_SHA }])
    expect(gh.merges().map((call) => JSON.parse(call.body ?? '{}'))).toEqual([{ sha: NEW_HEAD_SHA, merge_method: 'merge' }])
  })

  it('does not update or merge when the release PR base diverged from main', async () => {
    const gh = fakeGitHub({ mainSha: CI_SHA, compareStatus: 'diverged', update: { headSha: NEW_HEAD_SHA, baseSha: CI_SHA } })
    await expect(run(gh)).rejects.toThrow('relation=diverged')
    expect(gh.updates()).toEqual([])
    expect(gh.merges()).toEqual([])
  })

  it('fails without merging when the branch update never lands', async () => {
    const gh = fakeGitHub({ mainSha: CI_SHA, update: 'never' })
    await expect(run(gh, { maxAttempts: 3 })).rejects.toThrow('release PR branch update')
    expect(gh.merges()).toEqual([])
  })

  it('yields without merging when main advanced while the branch was updating', async () => {
    const newerMain = 'd'.repeat(40)
    const gh = fakeGitHub({ mainSha: newerMain, update: { headSha: NEW_HEAD_SHA, baseSha: newerMain } })
    await expect(run(gh)).resolves.toEqual({ status: 'no-op' })
    expect(gh.merges()).toEqual([])
  })

  it('still rejects a release PR that touches files beyond the three release files after updating', async () => {
    const gh = fakeGitHub({ mainSha: CI_SHA, update: { headSha: NEW_HEAD_SHA, baseSha: CI_SHA } })
    const fetchImpl: typeof gh.fetchImpl = async (input, init) =>
      new URL(input).pathname.endsWith('/pulls/20/files')
        ? new Response(JSON.stringify([...FILES, { filename: 'src/index.ts', status: 'modified' }]), { status: 200 })
        : gh.fetchImpl(input, init)
    await expect(
      runReleasePrAutoMerge({ token: 't', expectedBaseSha: CI_SHA, fetchImpl, sleep: noSleep, logger: quiet }),
    ).rejects.toThrow('three allowed files')
    expect(gh.merges()).toEqual([])
  })
})

describe('runReleasePrAutoMerge check waiting', () => {
  it('merges when the required checks take ten minutes of 5-second polls to finish', async () => {
    const gh = fakeGitHub({ pendingCheckPolls: 119 })
    await expect(
      runReleasePrAutoMerge({ token: 't', expectedBaseSha: BASE_SHA, fetchImpl: gh.fetchImpl, sleep: noSleep, logger: quiet }),
    ).resolves.toEqual({ status: 'merged', pullNumber: 20, mergeSha: MERGE_SHA })
  })
})
