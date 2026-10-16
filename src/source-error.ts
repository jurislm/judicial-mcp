export type JudicialSourceErrorCode = 'source_unavailable' | 'source_changed' | 'source_not_found'

export type RegulationSourceErrorCode =
  | 'source_unavailable'
  | 'source_changed'
  | 'regulation_not_found'
  | 'regulation_abolished'
  | 'regulation_article_not_found'

const REGULATION_ERROR_MESSAGES: Record<RegulationSourceErrorCode, string> = {
  source_unavailable: '法務部全國法規資料庫暫時無法使用',
  source_changed: '法務部全國法規資料庫來源格式無法辨識',
  regulation_not_found: '官方來源查無指定法規',
  regulation_abolished: '指定法規已廢止，未回傳現行條文',
  regulation_article_not_found: '官方來源查無指定條文',
}

export class JudicialSourceError extends Error {
  readonly code: JudicialSourceErrorCode
  readonly sourceUrl: string
  readonly retrievedAt: string

  constructor(code: JudicialSourceErrorCode, sourceUrl: string) {
    super(
      code === 'source_changed'
        ? '司法院裁判書來源格式無法辨識'
        : code === 'source_not_found'
          ? '司法院裁判書來源未找到指定裁判'
          : '司法院公開裁判書來源暫時無法使用',
    )
    this.name = 'JudicialSourceError'
    this.code = code
    this.sourceUrl = sourceUrl
    this.retrievedAt = new Date().toISOString()
  }
}

export class RegulationSourceError extends Error {
  readonly code: RegulationSourceErrorCode
  readonly sourceUrl: string
  readonly retrievedAt: string

  constructor(code: RegulationSourceErrorCode, sourceUrl: string) {
    super(REGULATION_ERROR_MESSAGES[code])
    this.name = 'RegulationSourceError'
    this.code = code
    this.sourceUrl = sourceUrl
    this.retrievedAt = new Date().toISOString()
  }
}
