import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const config = JSON.parse(readFileSync(new URL('release-please-config.json', root), 'utf8'))
const excludePaths: string[] = config.packages['.']['exclude-paths'].map((path: string) => path.replace(/^\//, '').replace(/\/$/, ''))

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
    expect(files).toContain('src/index.ts')
    const conflicts = excludePaths.flatMap((excluded) =>
      files.filter((file) => skipsFile(excluded, file)).map((file) => `${excluded} ↔ ${file}`),
    )
    expect(conflicts).toEqual([])
  })

  it('lists only canonical existing subdirectories, because release-please matches exclude-paths by literal directory prefix', () => {
    const invalid = excludePaths.filter((path) => {
      const canonical = path.split('/').every((segment) => /^[\w.-]+$/.test(segment) && !/^\.\.?$/.test(segment))
      const dir = join(fileURLToPath(root), path)
      return !canonical || !existsSync(dir) || !statSync(dir).isDirectory()
    })
    expect(invalid).toEqual([])
  })
})
