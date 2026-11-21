import { spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  runReleasePlease,
  spawnReleasePlease,
} from '../scripts/ci/run-release-please'

const owner = 'renamed-owner'
const name = 'judicial-mcp'
const canonical = `${owner}/${name}`
const sha = 'd'.repeat(40)
const synthetic = 'synthetic-credential'

function fakeGitHub(
  mainSha = sha,
  nameId = 1010982060,
  ref = 'refs/heads/main',
  type = 'commit',
) {
  const identity = {
    id: 1010982060,
    name,
    full_name: canonical,
    default_branch: 'main',
    fork: false,
    owner: { login: owner, id: 273012487, type: 'Organization' },
  }
  return vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.redirect).toBe('error')
    const path = new URL(String(input)).pathname
    if (path === '/repositories/1010982060') return Response.json(identity)
    if (path === `/repos/${canonical}`)
      return Response.json({ ...identity, id: nameId })
    if (path === '/repositories/1010982060/git/ref/heads/main')
      return Response.json({ ref, object: { type, sha: mainSha } })
    return new Response('', { status: 404 })
  })
}

describe('runReleasePlease', () => {
  it.each(['github-release', 'release-pr'])(
    'launches the pinned %s on current main with a private temporary credential',
    async (mode) => {
      const github = fakeGitHub()
      let path = ''
      await runReleasePlease(
        mode,
        synthetic,
        github,
        async (args) => {
          expect(
            github.mock.calls.map(([url]) => new URL(String(url)).pathname),
          ).toEqual([
            '/repositories/1010982060',
            `/repos/${canonical}`,
            '/repositories/1010982060/git/ref/heads/main',
          ])
          path = args[3]!.slice('--token='.length)
          expect(isAbsolute(path)).toBe(true)
          expect(args).toEqual([
            'bunx',
            'release-please@17.11.2',
            mode,
            `--token=${path}`,
            `--repo-url=https://github.com/${canonical}`,
            '--target-branch=main',
            '--config-file=release-please-config.json',
            '--manifest-file=.release-please-manifest.json',
          ])
          expect(args.join(' ')).not.toContain(synthetic)
          expect(await readFile(path, 'utf8')).toBe(synthetic)
          expect((await stat(path)).mode & 0o777).toBe(0o600)
          expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
          return 0
        },
        sha,
      )
      await expect(stat(dirname(path))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it('does not launch if main has moved or the canonical name resolves to another ID', async () => {
    const run = vi.fn(async () => 0)
    await expect(
      runReleasePlease(
        'release-pr',
        synthetic,
        fakeGitHub('c'.repeat(40)),
        run,
        sha,
      ),
    ).resolves.toBeUndefined()
    await expect(
      runReleasePlease(
        'release-pr',
        synthetic,
        fakeGitHub(sha, 1010982061),
        run,
        sha,
      ),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    ['refs/heads/another-branch', 'commit'],
    ['refs/heads/main', 'tag'],
  ])('rejects a misleading GitHub main payload (%s, %s)', async (ref, type) => {
    const run = vi.fn(async () => 0)
    await expect(
      runReleasePlease(
        'release-pr',
        synthetic,
        fakeGitHub(sha, 1010982060, ref, type),
        run,
        sha,
      ),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a bare CI commit outside Woodpecker at the CLI boundary', () => {
    const result = spawnSync(
      'bun',
      ['scripts/ci/run-release-please.ts', 'release-pr'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          CI_SYSTEM_NAME: 'other-runner',
          CI_COMMIT_SHA: sha,
          GITHUB_API_TOKEN: synthetic,
        },
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'CI commit SHA is required for Release Please',
    )
    expect(result.stderr).not.toContain(synthetic)
  })

  it('does not expose the synthetic credential in the child environment or either output stream', async () => {
    const logs: string[] = []
    const previous = process.env.GITHUB_API_TOKEN
    process.env.GITHUB_API_TOKEN = synthetic
    try {
      const program = `const x = "synthetic-" + "credential";
        console.log("out=" + x); console.error("err=" + x);
        process.exit(process.env.GITHUB_API_TOKEN ? 9 : 3)`
      const args = [process.execPath, '-e', program]
      expect(args.join(' ')).not.toContain(synthetic)
      const status = await spawnReleasePlease(
        args,
        synthetic,
        (stdout, stderr) => logs.push(stdout, stderr),
      )
      expect(status).toBe(3)
      expect(logs.map((value) => value.trim())).toEqual([
        'out=[REDACTED]',
        'err=[REDACTED]',
      ])
    } finally {
      if (previous === undefined) delete process.env.GITHUB_API_TOKEN
      else process.env.GITHUB_API_TOKEN = previous
    }
  })

  it('cleans up after a throwing runner and hides the raw exception', async () => {
    let path = ''
    await expect(
      runReleasePlease(
        'release-pr',
        synthetic,
        fakeGitHub(),
        async (args) => {
          path = args[3]!.slice('--token='.length)
          throw new Error(synthetic)
        },
        sha,
      ),
    ).rejects.toThrow('Release Please failed: release-pr')
    expect(path).not.toBe('')
    await expect(stat(dirname(path))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
