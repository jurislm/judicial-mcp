// JUR-813：npm-release.yml 的 verify 步驟。tag 事件比對 CI_COMMIT_TAG；manual 事件用來補發既有 tag 的版本，
// 要求該 tag 存在，而且會打包進 npm 的檔案自 tag 起沒變，確保發出去的內容就是那個 tag。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type ReleaseContext =
  | { event: 'tag'; tag: string | undefined }
  | { event: 'manual'; tagExists: boolean; changedShippedFiles: string[] }
  | { event: string }

export function checkRelease(version: string, context: ReleaseContext): void {
  const expected = `v${version}`
  if (context.event === 'tag' && 'tag' in context) {
    if (context.tag !== expected) {
      throw new Error(`CI_COMMIT_TAG must be ${expected}; received ${context.tag ?? 'unset'}`)
    }
    return
  }
  if (context.event === 'manual' && 'tagExists' in context) {
    if (!context.tagExists) throw new Error(`manual release requires tag ${expected} to exist`)
    if (context.changedShippedFiles.length > 0) {
      throw new Error(
        `published files changed since ${expected}: ${context.changedShippedFiles.join(', ')}`,
      )
    }
    return
  }
  throw new Error(`npm release only runs on tag or manual events; received ${context.event}`)
}

// npm 一定會帶 package.json／README／LICENSE；types/ 由 tsconfig.json 和鎖定的 TypeScript 版本產生。
export function releaseInputs(files: string[]): string[] {
  return ['package.json', 'README.md', 'LICENSE', 'tsconfig.json', 'bun.lock', ...files]
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function readManualContext(tag: string, shippedPaths: string[]): ReleaseContext {
  try {
    git(['fetch', '--quiet', '--force', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`])
  } catch {
    return { event: 'manual', tagExists: false, changedShippedFiles: [] }
  }
  const diff = git(['diff', '--name-only', tag, 'HEAD', '--', ...shippedPaths])
  return { event: 'manual', tagExists: true, changedShippedFiles: diff ? diff.split('\n') : [] }
}

if (import.meta.main) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; files: string[] }
  const event = process.env.CI_PIPELINE_EVENT ?? 'unset'
  const tag = `v${pkg.version}`
  const context: ReleaseContext =
    event === 'tag'
      ? { event, tag: process.env.CI_COMMIT_TAG }
      : event === 'manual'
        ? readManualContext(tag, releaseInputs(pkg.files))
        : { event }
  checkRelease(pkg.version, context)
  console.error(`Release verified: ${tag} (${event})`)
}
