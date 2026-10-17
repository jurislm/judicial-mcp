import { afterEach, describe, expect, test } from 'vitest'
import {
  clearRegulationCache,
  getRegulationCacheEntry,
  setRegulationCacheEntry,
} from '../src/regulation-cache.js'

afterEach(() => {
  clearRegulationCache()
})

describe('regulation cache', () => {
  test('expires entries after fifteen minutes', () => {
    setRegulationCacheEntry('law\u00001', { value: 'article' }, 5_000)

    expect(getRegulationCacheEntry('law\u00001')?.expiresAt).toBe(905_000)
  })

  test('keeps the most recently used 100 entries and evicts the least recently used', () => {
    for (let index = 0; index < 100; index += 1) {
      setRegulationCacheEntry(`law-${index}`, { value: `article-${index}` })
    }
    getRegulationCacheEntry('law-0')
    setRegulationCacheEntry('law-100', { value: 'article-100' })

    expect(getRegulationCacheEntry('law-0')?.value).toBe('article-0')
    expect(getRegulationCacheEntry('law-1')).toBeUndefined()
    expect(getRegulationCacheEntry('law-2')?.value).toBe('article-2')
    expect(getRegulationCacheEntry('law-100')?.value).toBe('article-100')
  })
})
