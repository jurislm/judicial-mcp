import { describe, expect, it } from 'vitest'
import { checkRelease, releaseInputs } from '../scripts/ci/check-release-tag'

describe('checkRelease', () => {
  it('tag 事件：CI_COMMIT_TAG 必須等於 v＋package 版本', () => {
    expect(() => checkRelease('1.6.2', { event: 'tag', tag: '1.6.2' })).toThrow(/v1\.6\.2/)
    expect(() => checkRelease('1.6.2', { event: 'tag', tag: 'v1.6.1' })).toThrow(/v1\.6\.2/)
    expect(() => checkRelease('1.6.2', { event: 'tag', tag: undefined })).toThrow(/unset/)
    expect(() => checkRelease('1.6.2', { event: 'tag', tag: 'v1.6.2' })).not.toThrow()
  })

  it('manual 事件（補發）：tag v＋版本必須存在', () => {
    expect(() =>
      checkRelease('1.6.2', { event: 'manual', tagExists: false, changedShippedFiles: [] }),
    ).toThrow(/v1\.6\.2/)
  })

  it('manual 事件（補發）：會打包進 npm 的檔案自 tag 起不得變動', () => {
    expect(() =>
      checkRelease('1.6.2', {
        event: 'manual',
        tagExists: true,
        changedShippedFiles: ['src/tools.ts'],
      }),
    ).toThrow(/src\/tools\.ts/)
    expect(() =>
      checkRelease('1.6.2', { event: 'manual', tagExists: true, changedShippedFiles: [] }),
    ).not.toThrow()
  })

  it('其他事件一律拒絕', () => {
    expect(() => checkRelease('1.6.2', { event: 'push' })).toThrow(/push/)
  })
})

describe('releaseInputs', () => {
  it('除了 files，也涵蓋 npm 自動帶的檔案和 types/ 的建置輸入', () => {
    expect(releaseInputs(['src', 'bin'])).toEqual(
      expect.arrayContaining(['src', 'bin', 'package.json', 'README.md', 'LICENSE', 'tsconfig.json', 'bun.lock']),
    )
  })
})
