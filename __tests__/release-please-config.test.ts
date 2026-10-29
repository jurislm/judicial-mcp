import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const config = JSON.parse(readFileSync(new URL('release-please-config.json', root), 'utf8'))
const excludePaths: string[] = config.packages['.']['exclude-paths'].map((path: string) =>
  path.replace(/^\//, '').replace(/\/$/, ''),
)

const skipsFile = (excluded: string, file: string) => excluded === '.' || file.startsWith(`${excluded}/`)

const packedFiles = (): string[] => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  })
  return JSON.parse(output)[0].files.map((file: { path: string }) => file.path)
}

describe('release-please exclude-paths', () => {
  it('never skips a commit that changes a file npm publishes', () => {
    const files = packedFiles()
    expect(files).toContain('dist/judicial-mcp.mjs')
    const conflicts = excludePaths.flatMap((excluded) =>
      files.filter((file) => skipsFile(excluded, file)).map((file) => `${excluded} ↔ ${file}`),
    )
    expect(conflicts).toEqual([])
  })

  it('lists only canonical subdirectories that hold tracked files, because release-please matches changed paths by literal directory prefix', () => {
    const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
      cwd: fileURLToPath(root),
      encoding: 'utf8',
    }).split('\0')
    const invalid = excludePaths.filter((path) => {
      const canonical = path.split('/').every((segment) => /^[\w.-]+$/.test(segment) && !/^\.\.?$/.test(segment))
      return !canonical || !trackedFiles.some((file) => file.startsWith(`${path}/`))
    })
    expect(invalid).toEqual([])
  })
})

describe('plugin release versions', () => {
  it('updates only both manifest version fields', () => {
    expect(config.packages['.']['extra-files']).toEqual([
      { type: 'json', path: 'plugin.json', jsonpath: '$.version' },
      {
        type: 'json',
        path: '.codex-plugin/plugin.json',
        jsonpath: '$.version',
      },
    ])
  })
})
