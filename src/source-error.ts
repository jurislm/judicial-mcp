export type JudicialSourceErrorCode = 'source_unavailable' | 'source_changed' | 'source_not_found'

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
