// JUR-766：Woodpecker 上自動合併 release-please 開的 release PR。
// 改寫自 coolify-plugin 的 scripts/ci/release-pr-auto-merge.ts，差異：
// - 只允許 release-please node 型別會動的 3 個檔（manifest、CHANGELOG.md、package.json）。
// - 必要檢查改讀 GitHub Actions check runs（lint、test、secret-scan），不是 Woodpecker commit status。
// - 不依賴 Bun 專屬 API，Vitest（Node）可直接測。

export const REPOSITORY = 'jurislm/judicial-mcp'
export const BASE_BRANCH = 'main'
export const RELEASE_BRANCH = 'release-please--branches--main--components--judicial-mcp'
export const RELEASE_AUTHOR = 'terry90918'
const RELEASE_BODY_START = ':robot: I have created a release *beep* *boop*'
const RELEASE_BODY_FOOTER =
  'This PR was generated with [Release Please](https://github.com/googleapis/release-please).'
const RELEASE_TITLE = /^chore\(main\): release ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/
export const RELEASE_FILES = ['.release-please-manifest.json', 'CHANGELOG.md', 'package.json'] as const
export const REQUIRED_CHECK_RUNS = ['lint', 'test', 'secret-scan'] as const
const GITHUB_API = 'https://api.github.com'
// 120 × 5 秒 = 10 分鐘：涵蓋 update branch 後 GitHub Actions 重跑 lint／test／secret-scan 的排隊時間。
const DEFAULT_ATTEMPTS = 120
const DEFAULT_POLL_DELAY_MS = 5_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface Logger {
  log(message: string): void
}

export interface AutoMergeOptions {
  token: string
  expectedBaseSha?: string
  fetchImpl?: FetchLike
  sleep?: (milliseconds: number) => Promise<void>
  maxAttempts?: number
  pollDelayMs?: number
  requestTimeoutMs?: number
  logger?: Logger
  apiBaseUrl?: string
}

export type AutoMergeResult =
  | { status: 'no-op' }
  | { status: 'merged'; pullNumber: number; mergeSha: string }

export interface ReleaseCandidate {
  number: number
  version: string
  baseSha: string
  headSha: string
}

export interface ReleaseContents {
  version: string
  baseManifestText: string
  headManifestText: string
  basePackageText: string
  headPackageText: string
  baseChangelogText: string
  headChangelogText: string
}

export type CheckState = 'success' | 'pending'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`invalid release PR shape: ${label}`)
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid release PR shape: ${label}`)
  return value
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  )
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!isRecord(value)) throw new Error(`${label} JSON must be an object`)
  return value
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) return null
  const parts = match.slice(1).map(Number)
  return parts.every(Number.isSafeInteger) ? [parts[0], parts[1], parts[2]] : null
}

export function isVersionGreater(target: string, base: string): boolean {
  const t = parseVersion(target)
  const b = parseVersion(base)
  if (!t || !b) return false
  for (let i = 0; i < 3; i += 1) {
    if (t[i] > b[i]) return true
    if (t[i] < b[i]) return false
  }
  return false
}

export function selectReleaseCandidate(value: unknown): ReleaseCandidate | null {
  if (!Array.isArray(value)) throw new Error('release PR response must be an array')
  if (value.length === 0) return null
  if (value.length !== 1) throw new Error('multiple release PR candidates found')
  const pull = requiredRecord(value[0], 'pull request')
  if (!Number.isSafeInteger(pull.number) || (pull.number as number) <= 0) {
    throw new Error('invalid release PR shape: number')
  }
  if (requiredString(pull.state, 'state') !== 'open') throw new Error('release PR candidate is not open')
  if (typeof pull.draft !== 'boolean') throw new Error('invalid release PR shape: draft')
  if (pull.draft) throw new Error('release PR candidate is a draft')
  const titleMatch = RELEASE_TITLE.exec(requiredString(pull.title, 'title'))
  if (!titleMatch) throw new Error('release PR title is not an exact release title')
  const body = requiredString(pull.body, 'body')
  if (!body.startsWith(RELEASE_BODY_START) || !body.includes(RELEASE_BODY_FOOTER)) {
    throw new Error('release PR body is missing the official release-please markers')
  }
  if (requiredRecord(pull.user, 'user').login !== RELEASE_AUTHOR) {
    throw new Error('release PR author is not allowed')
  }
  const base = requiredRecord(pull.base, 'base')
  if (requiredRecord(base.repo, 'base.repo').full_name !== REPOSITORY) {
    throw new Error('release PR base repository mismatch')
  }
  if (base.ref !== BASE_BRANCH) throw new Error('release PR base branch mismatch')
  const head = requiredRecord(pull.head, 'head')
  if (requiredRecord(head.repo, 'head.repo').full_name !== REPOSITORY) {
    throw new Error('release PR head repository mismatch')
  }
  if (head.ref !== RELEASE_BRANCH) throw new Error('release PR head branch mismatch')
  return {
    number: pull.number as number,
    version: titleMatch[1],
    baseSha: requiredString(base.sha, 'base.sha'),
    headSha: requiredString(head.sha, 'head.sha'),
  }
}

export function validateChangedFiles(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('release PR files response must be an array')
  const filenames = value
    .map((entry, index) => {
      const file = requiredRecord(entry, `files[${index}]`)
      const filename = requiredString(file.filename, `files[${index}].filename`)
      if (file.status !== 'modified') throw new Error(`${filename} must be modified, not added or deleted`)
      return filename
    })
    .sort()
  if (filenames.join('\n') !== [...RELEASE_FILES].sort().join('\n')) {
    throw new Error('release PR must change exactly the three allowed files')
  }
}

export function validateReleaseContents(contents: ReleaseContents): void {
  const baseManifest = parseJsonObject(contents.baseManifestText, 'base manifest')
  const headManifest = parseJsonObject(contents.headManifestText, 'head manifest')
  const baseVersion = baseManifest['.']
  if (typeof baseVersion !== 'string' || !isVersionGreater(contents.version, baseVersion)) {
    throw new Error('manifest base version must be an earlier version')
  }
  if (headManifest['.'] !== contents.version) {
    throw new Error('manifest version does not match the release PR title')
  }
  const { '.': _baseRoot, ...baseManifestRest } = baseManifest
  const { '.': _headRoot, ...headManifestRest } = headManifest
  if (!equalJson(baseManifestRest, headManifestRest)) throw new Error('manifest fields changed')

  const basePackage = parseJsonObject(contents.basePackageText, 'base package')
  const headPackage = parseJsonObject(contents.headPackageText, 'head package')
  if (basePackage.version !== baseVersion) throw new Error('manifest and package base versions must match')
  if (headPackage.version !== contents.version) {
    throw new Error('package version does not match the release PR title')
  }
  const { version: _baseVersion, ...basePackageRest } = basePackage
  const { version: _headVersion, ...headPackageRest } = headPackage
  if (!equalJson(basePackageRest, headPackageRest)) throw new Error('package fields other than version changed')

  const prefix = '# Changelog\n\n'
  if (!contents.baseChangelogText.startsWith(prefix) || !contents.headChangelogText.startsWith(prefix)) {
    throw new Error('CHANGELOG must preserve the standard header')
  }
  const baseHistory = contents.baseChangelogText.slice(prefix.length)
  const headHistory = contents.headChangelogText.slice(prefix.length)
  if (baseHistory.length === 0 || !headHistory.endsWith(baseHistory)) {
    throw new Error('CHANGELOG must preserve all existing release history')
  }
  const newBlock = headHistory.slice(0, headHistory.length - baseHistory.length)
  if (!newBlock.startsWith(`## [${contents.version}](`)) {
    throw new Error('CHANGELOG must prepend the title version heading')
  }
}

// GitHub Actions check runs → 必要檢查狀態。任一失敗即丟錯；有缺或未完成回 pending。
export function evaluateRequiredChecks(value: unknown): CheckState {
  const record = requiredRecord(value, 'check runs')
  const runs = record.check_runs
  if (!Array.isArray(runs)) throw new Error('check runs response must contain check_runs')
  if (typeof record.total_count !== 'number' || record.total_count !== runs.length) {
    throw new Error('check runs pagination is incomplete')
  }
  let pending = false
  for (const name of REQUIRED_CHECK_RUNS) {
    const matching = runs.filter((run) => isRecord(run) && run.name === name) as Record<string, unknown>[]
    if (matching.length === 0) {
      pending = true
      continue
    }
    for (const run of matching) {
      if (run.status !== 'completed') {
        pending = true
        continue
      }
      if (run.conclusion !== 'success') throw new Error(`required check failed: ${name} (${String(run.conclusion)})`)
    }
  }
  return pending ? 'pending' : 'success'
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`)
  return resolved
}

function nonNegativeInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) throw new Error(`${label} must be a non-negative integer`)
  return resolved
}

function contentText(value: unknown, label: string): string {
  const content = requiredRecord(value, label)
  if (content.type !== 'file' || content.encoding !== 'base64') throw new Error(`${label} is not a base64 file response`)
  const encoded = requiredString(content.content, `${label}.content`).replaceAll('\n', '')
  if (Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
    throw new Error(`${label} content is not valid base64`)
  }
  return Buffer.from(encoded, 'base64').toString('utf8')
}

export async function runReleasePrAutoMerge(options: AutoMergeOptions): Promise<AutoMergeResult> {
  if (!options.token) throw new Error('GITHUB_API_TOKEN is required')
  const expectedBaseSha = options.expectedBaseSha
  if (!expectedBaseSha || !/^[a-f0-9]{40}$/.test(expectedBaseSha)) {
    throw new Error('CI commit SHA is required for a mutating release PR auto-merge')
  }
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const logger = options.logger ?? console
  const apiBaseUrl = (options.apiBaseUrl ?? GITHUB_API).replace(/\/$/u, '')
  const maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_ATTEMPTS, 'maxAttempts')
  const pollDelayMs = nonNegativeInteger(options.pollDelayMs, DEFAULT_POLL_DELAY_MS, 'pollDelayMs')
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs')

  async function githubRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    const method = init.method ?? 'GET'
    const label = `GitHub API ${method} ${path.split('?')[0]}`
    let response: Response
    try {
      response = await fetchImpl(`${apiBaseUrl}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${options.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
      })
    } catch {
      throw new Error(`${label} request failed`)
    }
    const text = await response.text()
    if (!response.ok) throw new Error(`${label} failed with status ${response.status}`)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error(`${label} did not return valid JSON`)
    }
  }

  async function mainSha(): Promise<string> {
    const value = requiredRecord(await githubRequest(`/repos/${REPOSITORY}/git/ref/heads/${BASE_BRANCH}`), 'base ref')
    return requiredString(requiredRecord(value.object, 'base ref.object').sha, 'base ref.object.sha')
  }

  const query = new URLSearchParams({
    state: 'open',
    base: BASE_BRANCH,
    head: `jurislm:${RELEASE_BRANCH}`,
    per_page: '100',
  })
  const candidate = selectReleaseCandidate(await githubRequest(`/repos/${REPOSITORY}/pulls?${query.toString()}`))
  if (!candidate) {
    logger.log('No open release-please Release PR found; nothing to merge.')
    return { status: 'no-op' }
  }

  const detailValue = await githubRequest(`/repos/${REPOSITORY}/pulls/${candidate.number}`)
  let detail = selectReleaseCandidate([detailValue])
  if (!detail || detail.headSha !== candidate.headSha || detail.baseSha !== candidate.baseSha) {
    throw new Error('release PR changed before content validation')
  }
  if (detail.baseSha !== expectedBaseSha) {
    const comparison = requiredRecord(
      await githubRequest(
        `/repos/${REPOSITORY}/compare/${encodeURIComponent(expectedBaseSha)}...${encodeURIComponent(detail.baseSha)}?per_page=1`,
      ),
      'commit comparison',
    )
    const relation = requiredString(comparison.status, 'commit comparison status')
    if (relation === 'ahead') {
      logger.log(`Release PR #${detail.number} is based on a newer build; yielding to ${detail.baseSha}.`)
      return { status: 'no-op' }
    }
    if (relation !== 'behind') {
      throw new Error(
        `release PR base SHA does not match CI commit (pr=${detail.baseSha}, ci=${expectedBaseSha}, relation=${relation})`,
      )
    }
    // release-please 回報 "PR remained the same" 時不會推 release 分支，PR base 就停在舊的 main。
    logger.log(`Release PR #${detail.number} base is behind ${expectedBaseSha}; updating its branch.`)
    await githubRequest(`/repos/${REPOSITORY}/pulls/${detail.number}/update-branch`, {
      method: 'PUT',
      body: JSON.stringify({ expected_head_sha: detail.headSha }),
    })
    const previousHeadSha = detail.headSha
    let updated: ReleaseCandidate | null = null
    for (let attempt = 1; attempt <= maxAttempts && !updated; attempt += 1) {
      if (attempt > 1) await sleep(pollDelayMs)
      const current = selectReleaseCandidate([await githubRequest(`/repos/${REPOSITORY}/pulls/${detail.number}`)])
      if (!current || current.number !== detail.number) throw new Error('release PR changed during branch update')
      if (current.headSha !== previousHeadSha) updated = current
    }
    if (!updated) throw new Error('release PR branch update did not produce a new head')
    if (updated.baseSha !== expectedBaseSha) {
      if ((await mainSha()) !== expectedBaseSha) {
        logger.log('main advanced during branch update; yielding to newer build.')
        return { status: 'no-op' }
      }
      throw new Error(`release PR base SHA does not match CI commit after branch update (pr=${updated.baseSha})`)
    }
    detail = updated
  }

  const changedFiles = await githubRequest(`/repos/${REPOSITORY}/pulls/${detail.number}/files?per_page=100`)
  validateChangedFiles(changedFiles)

  const getFile = async (path: string, ref: string): Promise<string> =>
    contentText(
      await githubRequest(`/repos/${REPOSITORY}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`),
      `${path}@${ref}`,
    )
  const [baseManifestText, headManifestText, basePackageText, headPackageText, baseChangelogText, headChangelogText] =
    await Promise.all([
      getFile('.release-please-manifest.json', detail.baseSha),
      getFile('.release-please-manifest.json', detail.headSha),
      getFile('package.json', detail.baseSha),
      getFile('package.json', detail.headSha),
      getFile('CHANGELOG.md', detail.baseSha),
      getFile('CHANGELOG.md', detail.headSha),
    ])
  validateReleaseContents({
    version: detail.version,
    baseManifestText,
    headManifestText,
    basePackageText,
    headPackageText,
    baseChangelogText,
    headChangelogText,
  })

  let checks: CheckState = 'pending'
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    checks = evaluateRequiredChecks(
      await githubRequest(`/repos/${REPOSITORY}/commits/${encodeURIComponent(detail.headSha)}/check-runs?per_page=100`),
    )
    if (checks === 'success') break
    if (attempt < maxAttempts) await sleep(pollDelayMs)
  }
  if (checks !== 'success') throw new Error('required checks did not complete')

  let mergeable = false
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentValue = await githubRequest(`/repos/${REPOSITORY}/pulls/${detail.number}`)
    const current = selectReleaseCandidate([currentValue])
    if (!current || current.headSha !== detail.headSha || current.baseSha !== detail.baseSha) {
      throw new Error('release PR changed during mergeability check')
    }
    const value = requiredRecord(currentValue, 'pull request detail').mergeable
    if (value === true) {
      mergeable = true
      break
    }
    if (value === false) throw new Error('release PR is not mergeable')
    if (value !== null) throw new Error('invalid release PR shape: mergeable')
    if (attempt < maxAttempts) await sleep(pollDelayMs)
  }
  if (!mergeable) throw new Error('release PR mergeability check timed out')

  if ((await mainSha()) !== expectedBaseSha) {
    logger.log('main advanced during validation; yielding to newer build.')
    return { status: 'no-op' }
  }

  const merged = requiredRecord(
    await githubRequest(`/repos/${REPOSITORY}/pulls/${detail.number}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ sha: detail.headSha, merge_method: 'merge' }),
    }),
    'merge response',
  )
  if (merged.merged !== true) throw new Error('GitHub merge response did not confirm a merge')
  const mergeSha = requiredString(merged.sha, 'merge response sha')
  logger.log(`Merged release-please Release PR #${detail.number} at validated head SHA.`)
  return { status: 'merged', pullNumber: detail.number, mergeSha }
}
