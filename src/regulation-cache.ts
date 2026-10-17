export interface RegulationCacheEntry {
  value: unknown
  expiresAt: number
}

const CACHE_TTL_MS = 15 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
const entries = new Map<string, RegulationCacheEntry>()

export function getRegulationCacheEntry(key: string): RegulationCacheEntry | undefined {
  const entry = entries.get(key)
  if (!entry) return undefined
  entries.delete(key)
  entries.set(key, entry)
  return entry
}

export function setRegulationCacheEntry(
  key: string,
  entry: Omit<RegulationCacheEntry, 'expiresAt'>,
  now = Date.now(),
): void {
  entries.delete(key)
  entries.set(key, { ...entry, expiresAt: now + CACHE_TTL_MS })
  while (entries.size > MAX_CACHE_ENTRIES) {
    const oldestKey = entries.keys().next().value
    if (oldestKey === undefined) return
    entries.delete(oldestKey)
  }
}

export function deleteRegulationCacheEntry(key: string): void {
  entries.delete(key)
}

export function clearRegulationCache(): void {
  entries.clear()
}
