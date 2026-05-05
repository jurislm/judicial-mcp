import axios from 'axios'
import { createBlobResponse } from './response.js'

// ─── Arg interfaces ──────────────────────────────────────────────────────────

interface TokenArgs { token: string }
interface GetJudgmentArgs { token: string; jid: string }
interface ListResourcesArgs { categoryNo: string; token: string }
interface DownloadFileArgs { fileSetId: string; token: string; top?: number; skip?: number }

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

// ─── Error helper ────────────────────────────────────────────────────────────

function apiErrorMessage(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    return e.response?.data?.message ?? e.message ?? String(error)
  }
  if (error instanceof Error) return error.message
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
      const mimeType = (result.headers['content-type'] as string) || 'application/octet-stream'
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
}
