import axios from 'axios'
import { createBlobResponse } from './response.js'
import { fetchJudgmentText, searchJudgments } from './public-judgment-source.js'
import { JudicialSourceError } from './source-error.js'

// ─── Arg interfaces ──────────────────────────────────────────────────────────

export interface TokenArgs { token: string }
export interface GetJudgmentArgs { token: string; jid: string }
export interface ListResourcesArgs { categoryNo: string; token: string }
export interface DownloadFileArgs { fileSetId: string; token: string; top?: number; skip?: number }
export interface SearchJudgmentsArgs extends Record<string, unknown> {
  keyword?: string
  court?: string
  year?: number
  caseNumber?: string
  limit?: number
  page?: number
  offset?: number
}
export interface FetchJudgmentTextArgs extends Record<string, unknown> { caseId: string }

// ─── Input validation ────────────────────────────────────────────────────────

const validateInput = {
  required(params: Record<string, unknown>, required: string[]): void {
    const missing = required.filter(key => !params[key])
    if (missing.length > 0) {
      throw new Error(`缺少必要參數: ${missing.join(', ')}`)
    }
  },

  token(token: unknown): void {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('無效的授權 Token')
    }
  },
}

function optionalStringArgument(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`參數 ${key} 必須是文字`)
  return value
}

function optionalNumberArgument(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number') throw new Error(`參數 ${key} 必須是數字`)
  return value
}

function searchJudgmentsArgs(params: Record<string, unknown>): SearchJudgmentsArgs {
  const args: SearchJudgmentsArgs = {}
  const keyword = optionalStringArgument(params, 'keyword')
  const court = optionalStringArgument(params, 'court')
  const year = optionalNumberArgument(params, 'year')
  const caseNumber = optionalStringArgument(params, 'caseNumber')
  const limit = optionalNumberArgument(params, 'limit')
  const page = optionalNumberArgument(params, 'page')
  const offset = optionalNumberArgument(params, 'offset')
  if (keyword !== undefined) args.keyword = keyword
  if (court !== undefined) args.court = court
  if (year !== undefined) args.year = year
  if (caseNumber !== undefined) args.caseNumber = caseNumber
  if (limit !== undefined) args.limit = limit
  if (page !== undefined) args.page = page
  if (offset !== undefined) args.offset = offset
  return args
}

function fetchJudgmentTextArgs(params: Record<string, unknown>): FetchJudgmentTextArgs {
  validateInput.required(params, ['caseId'])
  const caseId = params.caseId
  if (typeof caseId !== 'string') throw new Error('參數 caseId 必須是文字')
  return { caseId }
}

// ─── Error helper ────────────────────────────────────────────────────────────

function apiErrorMessage(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    if (e.response?.data?.message) return e.response.data.message
    if (e.message) return e.message
  }
  return String(error)
}

// ─── API base URLs ───────────────────────────────────────────────────────────

const JUDICIAL_API_BASE = 'https://data.judicial.gov.tw/jdg/api'
const OPENDATA_API_BASE = 'https://opendata.judicial.gov.tw'

// ─── Tool definitions ────────────────────────────────────────────────────────

export const TOOLS_CONFIG = {
  auth_token: {
    name: 'auth_token',
    description:
      '取得司法院裁判書查詢系統的授權 Token。帳密從環境變數 JUDICIAL_USER / JUDICIAL_PASSWORD 讀取。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  list_judgments: {
    name: 'list_judgments',
    description: '取得裁判書異動清單，包含新增、修改或刪除的裁判書資訊。',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: '從 auth_token 工具取得的授權 Token' },
      },
      required: ['token'],
      additionalProperties: false,
    },
  },

  get_judgment: {
    name: 'get_judgment',
    description: '取得特定裁判書的完整內容，包含裁判全文。',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: '從 auth_token 工具取得的授權 Token' },
        jid: { type: 'string', description: '從 list_judgments 工具取得的裁判書 ID' },
      },
      required: ['token', 'jid'],
      additionalProperties: false,
    },
  },

  list_categories: {
    name: 'list_categories',
    description: '取得司法院開放資料平台的所有主題分類清單。',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: '從 member_token 工具取得的會員授權 Token' },
      },
      required: ['token'],
      additionalProperties: false,
    },
  },

  list_resources: {
    name: 'list_resources',
    description: '取得指定分類下的所有資料源清單。',
    inputSchema: {
      type: 'object',
      properties: {
        categoryNo: {
          type: 'string',
          description: '從 list_categories 工具取得的分類編號',
        },
        token: { type: 'string', description: '從 member_token 工具取得的會員授權 Token' },
      },
      required: ['categoryNo', 'token'],
      additionalProperties: false,
    },
  },

  download_file: {
    name: 'download_file',
    description: '下載指定檔案集的資料檔案，支援分頁參數。',
    inputSchema: {
      type: 'object',
      properties: {
        fileSetId: { type: 'string', description: '從 list_resources 工具取得的檔案集 ID' },
        top: { type: 'integer', description: '限制回傳筆數（可選）', minimum: 0 },
        skip: { type: 'integer', description: '跳過筆數，用於分頁（可選）', minimum: 0 },
        token: { type: 'string', description: '從 member_token 工具取得的會員授權 Token' },
      },
      required: ['fileSetId', 'token'],
      additionalProperties: false,
    },
  },

  member_token: {
    name: 'member_token',
    description:
      '取得司法院開放平台的會員授權 Token，用於存取會員專屬資源。帳密從環境變數 JUDICIAL_USER / JUDICIAL_PASSWORD 讀取。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  search_judgments: {
    name: 'search_judgments',
    description: '透過司法院公開裁判書查詢頁搜尋裁判，不需要授權 Token。year 可使用西元或民國年；完整案號可同時指定案類。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '裁判全文關鍵字，最多 128 字元' },
        court: { type: 'string', description: '司法院法院名稱或官方法院代碼' },
        year: { type: 'integer', description: '裁判年度，可使用西元或民國年', minimum: 1, maximum: 9999 },
        caseNumber: { type: 'string', description: '案號數字，或「年度案類字第號」格式' },
        limit: { type: 'integer', description: '每頁最多回傳筆數，預設 5，上限 10', minimum: 1, maximum: 10 },
        page: { type: 'integer', description: '官方結果頁頁碼，預設 1，上限 50', minimum: 1, maximum: 50 },
        offset: { type: 'integer', description: '官方結果頁內的起始位置，預設 0，範圍 0–19；依回傳的 next_page 與 next_offset 繼續查詢', minimum: 0, maximum: 19 },
      },
      additionalProperties: false,
    },
  },

  fetch_judgment_text: {
    name: 'fetch_judgment_text',
    description: '依 search_judgments 回傳的 case_id 取得司法院公開裁判全文，不需要授權 Token。',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: 'search_judgments 回傳的 case_id' },
      },
      required: ['caseId'],
      additionalProperties: false,
    },
  },
} as const

// ─── Tool handlers ───────────────────────────────────────────────────────────

export const TOOL_HANDLERS: Record<string, (_args: Record<string, unknown>) => Promise<unknown>> = {
  async auth_token(_args) {
    const user = process.env.JUDICIAL_USER
    const password = process.env.JUDICIAL_PASSWORD
    if (!user || !password) {
      throw new Error(
        '未提供使用者帳號或密碼，且環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 未設定',
      )
    }
    try {
      const result = await axios.post(`${JUDICIAL_API_BASE}/Auth`, { user, password })
      return result.data
    } catch (error: unknown) {
      throw new Error(`授權失敗: ${apiErrorMessage(error)}`)
    }
  },

  async list_judgments(args) {
    const typed = args as unknown as TokenArgs
    validateInput.required(args, ['token'])
    validateInput.token(typed.token)
    try {
      const result = await axios.post(`${JUDICIAL_API_BASE}/JList`, { token: typed.token })
      return result.data
    } catch (error: unknown) {
      throw new Error(`取得裁判書清單失敗: ${apiErrorMessage(error)}`)
    }
  },

  async get_judgment(args) {
    const typed = args as unknown as GetJudgmentArgs
    validateInput.required(args, ['token', 'jid'])
    validateInput.token(typed.token)
    try {
      const result = await axios.post(`${JUDICIAL_API_BASE}/JDoc`, {
        token: typed.token,
        j: typed.jid,
      })
      return result.data
    } catch (error: unknown) {
      throw new Error(`取得裁判書內容失敗: ${apiErrorMessage(error)}`)
    }
  },

  async list_categories(args) {
    const typed = args as unknown as TokenArgs
    validateInput.required(args, ['token'])
    validateInput.token(typed.token)
    try {
      const result = await axios.get(`${OPENDATA_API_BASE}/data/api/rest/categories`, {
        headers: { Authorization: `Bearer ${typed.token}` },
      })
      return result.data
    } catch (error: unknown) {
      throw new Error(`取得主題分類清單失敗: ${apiErrorMessage(error)}`)
    }
  },

  async list_resources(args) {
    const typed = args as unknown as ListResourcesArgs
    validateInput.required(args, ['categoryNo', 'token'])
    validateInput.token(typed.token)
    try {
      const url = `${OPENDATA_API_BASE}/data/api/rest/categories/${typed.categoryNo}/resources`
      const result = await axios.get(url, {
        headers: { Authorization: `Bearer ${typed.token}` },
      })
      return result.data
    } catch (error: unknown) {
      throw new Error(`取得資料源清單失敗: ${apiErrorMessage(error)}`)
    }
  },

  async download_file(args) {
    const typed = args as unknown as DownloadFileArgs
    validateInput.required(args, ['fileSetId', 'token'])
    validateInput.token(typed.token)
    try {
      const params = new URLSearchParams()
      if (typed.top != null) params.append('top', String(typed.top))
      if (typed.skip != null) params.append('skip', String(typed.skip))
      let url = `${OPENDATA_API_BASE}/api/FilesetLists/${typed.fileSetId}/file`
      if (params.toString()) url += `?${params.toString()}`
      const result = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${typed.token}` },
      })
      const mimeType = ((result.headers['content-type'] as string) ?? '').split(';')[0].trim() || 'application/octet-stream'
      const uri = `data:${mimeType};base64`
      return createBlobResponse(Buffer.from(result.data as ArrayBuffer), mimeType, uri)
    } catch (error: unknown) {
      throw new Error(`檔案下載失敗: ${apiErrorMessage(error)}`)
    }
  },

  async member_token(_args) {
    const user = process.env.JUDICIAL_USER
    const password = process.env.JUDICIAL_PASSWORD
    if (!user || !password) {
      throw new Error(
        '未提供使用者帳號或密碼，且環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 未設定',
      )
    }
    try {
      const result = await axios.post(`${OPENDATA_API_BASE}/api/MemberTokens`, {
        memberAccount: user,
        pwd: password,
      })
      return result.data
    } catch (error: unknown) {
      throw new Error(`會員授權失敗: ${apiErrorMessage(error)}`)
    }
  },

  async search_judgments(args) {
    try {
      return await searchJudgments(searchJudgmentsArgs(args))
    } catch (error: unknown) {
      if (error instanceof JudicialSourceError) throw error
      throw new Error(`搜尋裁判書失敗: ${apiErrorMessage(error)}`)
    }
  },

  async fetch_judgment_text(args) {
    try {
      return await fetchJudgmentText(fetchJudgmentTextArgs(args))
    } catch (error: unknown) {
      if (error instanceof JudicialSourceError) throw error
      throw new Error(`取得裁判全文失敗: ${apiErrorMessage(error)}`)
    }
  },
}
