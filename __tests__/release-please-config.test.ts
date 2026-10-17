import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const readJson = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'))

const excludePaths: string[] = readJson('release-please-config.json').packages['.']['exclude-paths']
const packagedPaths: string[] = [...readJson('package.json').files, 'package.json', 'LICENSE']

const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

describe('release-please exclude-paths', () => {
  it('never skips a commit that changes a file published to npm', () => {
    const conflicts = excludePaths.flatMap((excluded) =>
      packagedPaths.filter((packaged) => overlaps(excluded, packaged)).map((packaged) => `${excluded} ↔ ${packaged}`),
    )
    expect(conflicts).toEqual([])
  })

  it('lists only existing directories, because release-please matches exclude-paths by directory prefix', () => {
    const notDirectories = excludePaths.filter((path) => {
      const url = new URL(path, root)
      return !existsSync(url) || !statSync(url).isDirectory()
    })
    expect(notDirectories).toEqual([])
  })
})
