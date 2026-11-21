import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { parseReleaseRepository, releaseRepoId } from './release-repository'

export async function runReleasePlease(
  mode: string | undefined,
  token: string | undefined,
  request: typeof fetch,
  run: (args: string[]) => Promise<number>,
  expectedBaseSha: string | undefined,
): Promise<void> {
  if (mode !== 'github-release' && mode !== 'release-pr')
    throw new Error('Unsupported release mode')
  if (!token) throw new Error('GITHUB_API_TOKEN is required')
  if (!expectedBaseSha || !/^[a-f0-9]{40}$/.test(expectedBaseSha))
    throw new Error('CI commit SHA is required for Release Please')
  async function readGitHub(path: string): Promise<unknown> {
    try {
      const response = await request(`https://api.github.com${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok || response.redirected) throw new Error()
      return (await response.json()) as unknown
    } catch {
      throw new Error('GitHub repository lookup failed')
    }
  }
  const repository = parseReleaseRepository(
    await readGitHub(`/repositories/${releaseRepoId}`),
  )
  let temporary: string | undefined
  try {
    temporary = await mkdtemp(join(tmpdir(), 'judicial-release-'))
    const tokenPath = join(temporary, 'token')
    await writeFile(tokenPath, token, { flag: 'wx', mode: 0o600 })
    const current = parseReleaseRepository(
      await readGitHub(`/repos/${repository.fullName}`),
    )
    if (current.fullName !== repository.fullName)
      throw new Error('GitHub release repository identity changed')
    const liveMain = await readGitHub(
      `/repos/${repository.fullName}/git/ref/heads/main`,
    )
    if (
      !liveMain ||
      typeof liveMain !== 'object' ||
      !('object' in liveMain) ||
      !liveMain.object ||
      typeof liveMain.object !== 'object' ||
      !('sha' in liveMain.object) ||
      typeof liveMain.object.sha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(liveMain.object.sha)
    ) {
      throw new Error('Invalid GitHub main ref')
    }
    if (liveMain.object.sha !== expectedBaseSha) return
    const code = await run([
      'bunx',
      'release-please@17.11.2',
      mode,
      `--token=${tokenPath}`,
      `--repo-url=https://github.com/${repository.fullName}`,
      '--target-branch=main',
      '--config-file=release-please-config.json',
      '--manifest-file=.release-please-manifest.json',
    ])
    if (code !== 0) throw new Error()
  } catch {
    throw new Error(`Release Please failed: ${mode}`)
  } finally {
    if (temporary)
      await rm(temporary, { recursive: true, force: true }).catch(() => {
        throw new Error('Release Please credential cleanup failed')
      })
  }
}

export async function spawnReleasePlease(
  args: string[],
  token: string | undefined,
  write: (stdout: string, stderr: string) => void,
): Promise<number> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'GITHUB_API_TOKEN'),
  )
  const executable = args[0]
  if (!executable) throw new Error('Release Please executable is required')
  const child = spawn(executable, args.slice(1), {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exit = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? -1))
  })
  const [stdout, stderr, code] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    exit,
  ])
  const redact = (output: string) =>
    token ? output.replaceAll(token, '[REDACTED]') : output
  write(redact(stdout), redact(stderr))
  return code
}

if (import.meta.main) {
  try {
    const token = process.env.GITHUB_API_TOKEN
    await runReleasePlease(
      process.argv[2],
      token,
      fetch,
      (args) =>
        spawnReleasePlease(args, token, (stdout, stderr) => {
          process.stdout.write(stdout)
          process.stderr.write(stderr)
        }),
      process.env.CI_COMMIT_SHA,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release failed')
    process.exitCode = 1
  }
}
